// Mahalle ve il sohbetleri (§7.2). Özel mesaj yoktur; her kanal herkese açıktır ve moderasyona tabidir.
// Yazma: doğrulanmış e-posta + sohbet ayarı açık. Mahalle kanalına yalnızca o mahallenin sakinleri yazar.
// Kişisel veri (kimlik no, telefon, IBAN) içeren mesaj yayımlanmaz; şüpheli mesaj yayımlanır ama moderasyona işaretlenir.
const db = require('./db');
const L = require('./lib/ledger');
const { icerikDenetle } = require('./lib/icerik');
const { yay } = require('./lib/olaylar');
const { OyunHatasi } = L;

const SOHBET = { maxUzunluk: 280, pencereMs: 30_000, pencereSiniri: 5, sayfa: 40 };

// Kanal kimliği: "mahalle:<id>" / "il:<id>" / "memleket:<plaka>"
async function kanalCoz(kanal) {
  const m = /^(mahalle|il|memleket):([0-9]{1,9})$/.exec(String(kanal || ''));
  if (!m) throw new OyunHatasi(400, 'Geçersiz sohbet kanalı');
  const [, tur, id] = m;
  if (tur === 'memleket') {
    const il = await db.get(`SELECT id, name FROM regions WHERE type = 'IL' AND plaka = ?`, id.padStart(2, '0'));
    if (!il) throw new OyunHatasi(404, 'İl bulunamadı');
    return { tur, id: il.id, plaka: id.padStart(2, '0'), ad: `${il.name} hemşehrileri`, kanal: `memleket:${id.padStart(2, '0')}` };
  }
  const r = await db.get(`SELECT id, name, type FROM regions WHERE id = ?`, Number(id));
  if (!r || r.type !== (tur === 'mahalle' ? 'MAHALLE' : 'IL')) throw new OyunHatasi(404, 'Kanal bulunamadı');
  return { tur, id: r.id, ad: tur === 'mahalle' ? `${r.name} mahallesi` : `${r.name} meydanı`, kanal: `${tur}:${r.id}` };
}

async function yazmaEngeli(userId, k) {
  const u = await db.get(`SELECT status, email_dogrulandi_at, ayarlar, memleket_plaka FROM users WHERE id = ?`, userId);
  if (!u || u.status !== 'ACTIVE') return 'Hesabın sohbete yazamaz';
  if (!u.email_dogrulandi_at) return 'Sohbete yazmak için e-postanı doğrula';
  if (!JSON.parse(u.ayarlar || '{}').sohbet) return 'Sohbet ayarın kapalı (Hesabım → Oyun ayarları)';
  if (k.tur === 'mahalle' && !await db.get(`SELECT 1 FROM parcels WHERE region_id = ? AND owner_user_id = ? LIMIT 1`, k.id, userId)) {
    return 'Mahalle sohbetine yalnızca mahallede parseli olanlar yazabilir';
  }
  if (k.tur === 'memleket' && u.memleket_plaka !== k.plaka) return 'Bu kanal yalnızca bu ili memleket seçenlere açık';
  return null;
}

const mesajSatiri = (m, userId) => ({ id: m.id, metin: m.metin, ad: m.ad, ben: m.user_id === userId, zaman: m.created_at, demo: !!m.npc });

async function mesajlar(kanal, userId, onceId) {
  const k = await kanalCoz(kanal);
  const satirlar = await db.all(`SELECT m.*, u.display_name AS ad, u.is_npc AS npc FROM sohbet_mesajlari m JOIN users u ON u.id = m.user_id
                               WHERE m.kanal = ? AND m.gizlendi = 0 ${onceId ? 'AND m.id < ?' : ''} ORDER BY m.id DESC LIMIT ?`,
  ...[k.kanal, ...(onceId ? [Number(onceId)] : []), SOHBET.sayfa]);
  const engel = userId ? await yazmaEngeli(userId, k) : 'Yazmak için giriş yap';
  return { kanal: k.kanal, ad: k.ad, mesajlar: satirlar.reverse().map((m) => mesajSatiri(m, userId)),
    yazabilir: userId ? !engel : false, engel, maxUzunluk: SOHBET.maxUzunluk };
}

async function yaz(userId, kanal, govde = {}) {
  const k = await kanalCoz(kanal);
  const engel = await yazmaEngeli(userId, k);
  if (engel) throw new OyunHatasi(403, engel);
  const metin = typeof govde.metin === 'string' ? govde.metin.replace(/\s+/g, ' ').trim() : '';
  if (metin.length < 1 || metin.length > SOHBET.maxUzunluk) throw new OyunHatasi(400, `Mesaj 1–${SOHBET.maxUzunluk} karakter olmalı`);
  const t = Date.now();
  let onTarama = null;
  const id = await db.tx(async () => {
    // Hız sınırı denetimi ile yazma arasına aynı oyuncunun başka mesajı girmesin
    await db.kilit(`sohbet:${userId}`);
    const son = (await db.get(`SELECT COUNT(*) c FROM sohbet_mesajlari WHERE user_id = ? AND created_at > ?`, userId, t - SOHBET.pencereMs)).c;
    if (son >= SOHBET.pencereSiniri) throw new OyunHatasi(429, 'Biraz yavaş: kısa sürede çok mesaj gönderdin');
    const tarama = icerikDenetle(metin);
    if (tarama.karar === 'ENGEL') throw new OyunHatasi(422, `Mesaj gönderilmedi: ${tarama.nedenler.map((n) => n.not).join(', ')}. Kişisel bilgilerini sohbette paylaşma.`);
    onTarama = tarama.nedenler.length ? tarama.nedenler.map((n) => n.not).join(' · ') : null;
    const yeni = (await db.run(`INSERT INTO sohbet_mesajlari (kanal, user_id, metin, on_tarama, created_at) VALUES (?, ?, ?, ?, ?)`,
      k.kanal, userId, metin, onTarama, t)).lastInsertRowid;
    const ad = (await db.get(`SELECT display_name FROM users WHERE id = ?`, userId)).display_name;
    yay('sohbet', { kanal: k.kanal, mesaj: { id: yeni, metin, ad, zaman: t, userId } });   // işlem kaydedilince yayılır
    return yeni;
  });
  if (onTarama) await require('./yz').arkaPlandaTara('sohbet_mesajlari', id, metin, k.ad);   // kural şüphelendiyse ikinci görüş
  return { tamam: true, id, isaretlendi: !!onTarama };
}

// Demo sakin (yaşayan nüfus) mesajı: yazma engelleri insan hesapları içindir; içerik taraması ve hız sınırı yine uygulanır
async function npcYaz(userId, kanal, metinHam) {
  const k = await kanalCoz(kanal);
  const u = await db.get(`SELECT display_name, is_npc FROM users WHERE id = ?`, userId);
  if (!u?.is_npc) throw new OyunHatasi(403, 'Yalnızca demo sakinler');
  const metin = String(metinHam || '').replace(/\s+/g, ' ').trim().slice(0, SOHBET.maxUzunluk);
  if (!metin || icerikDenetle(metin).karar !== 'TEMIZ') return null;
  const t = Date.now();
  return db.tx(async () => {
    await db.kilit(`sohbet:${userId}`);
    if ((await db.get(`SELECT COUNT(*) c FROM sohbet_mesajlari WHERE user_id = ? AND created_at > ?`, userId, t - SOHBET.pencereMs)).c >= 2) return null;
    const id = (await db.run(`INSERT INTO sohbet_mesajlari (kanal, user_id, metin, created_at) VALUES (?, ?, ?, ?)`, k.kanal, userId, metin, t)).lastInsertRowid;
    yay('sohbet', { kanal: k.kanal, mesaj: { id, metin, ad: u.display_name, zaman: t, userId, demo: true } });
    return id;
  });
}

async function rotalar(app, { h, auth }) {
  app.get('/api/sohbet/:kanal', h((req) => mesajlar(req.params.kanal, req.kullanici?.id ?? null, req.query.once)));
  app.post('/api/sohbet/:kanal', auth.girisGerekli, h((req) => yaz(req.kullanici.id, req.params.kanal, req.body)));
}

module.exports = { rotalar, kanalCoz, mesajlar, yaz, npcYaz, SOHBET };
