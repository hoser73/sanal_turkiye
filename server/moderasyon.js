// Moderasyon ve denetim (§10, §14): şikâyetler, iki kişi kuralıyla ağır işlemler (parsel dondurma, hesap askısı,
// görevden alma, seçim iptali), seçim/meclis denetim görünümü ve sakinlerin görevden alma (geri çağırma) dilekçesi.
const db = require('./db');
const L = require('./lib/ledger');
const { icerikDenetle } = require('./lib/icerik');
const { MODERASYON, GOREVDEN_ALMA, SECIM, ROLLER, OZELLIK } = require('./config/rules');
const { OyunHatasi } = L;

const simdi = () => Date.now();
const YETKILI = ['MODERATOR', 'DENETCI', 'ADMIN'];
const bildir = (userId, metin, link) => require('./pazar').bildir(userId, metin, link);
const metinAl = (v, ad, min, max) => {
  if (typeof v !== 'string' || v.trim().length < min || v.trim().length > max) throw new OyunHatasi(400, `${ad} ${min}–${max} karakter olmalı`);
  return v.trim();
};
const rolu = async (userId) => (await db.get(`SELECT rol FROM users WHERE id = ?`, userId))?.rol;
// Rol hiyerarşisi: yetkili bir hesaba yönelik işlemi yalnızca ondan üst roldeki biri önerir ve onaylar
const RUTBE = { OYUNCU: 0, MODERATOR: 1, DENETCI: 2, ADMIN: 3 };
const rutbe = async (userId) => RUTBE[await rolu(userId)] ?? 0;
const sqlMs = (s) => new Date(String(s).replace(' ', 'T') + 'Z').getTime();
const yetkililer = () => db.all(`SELECT id FROM users WHERE rol IN ('MODERATOR', 'DENETCI', 'ADMIN') AND status = 'ACTIVE'`);
// Hatası yutulan okuma: geçersiz kimlik sorgu hatası üretmesin. İşlem içindeyse kayıt noktasında çalışır (Postgres'te
// işlem içi sorgu hatası bütün işlemi bozar); sayısal olmayan kimlik sorguya hiç gitmez.
async function guvenliOku(sql, ...p) {
  if (p.some((v) => typeof v === 'number' && !Number.isFinite(v))) return null;
  try { return (await (db.islemde() ? db.tx(() => db.get(sql, ...p)) : db.get(sql, ...p))) || null; } catch { return null; }
}

// ---------- Şikâyet hedefleri
const GIZLENEBILIR = { DUYURU: 'mahalle_duyurulari', MESAJ: 'sohbet_mesajlari' };
async function hedefOzeti(tur, id) {
  const tek = guvenliOku;
  switch (tur) {
    case 'KULLANICI': { const u = await tek(`SELECT id, display_name, status FROM users WHERE id = ? AND is_npc = 0`, Number(id)); return u && { baslik: u.display_name, durum: u.status }; }
    case 'PARSEL': { const p = await tek(`SELECT p.id, p.status, u.display_name AS sahip FROM parcels p LEFT JOIN users u ON u.id = p.owner_user_id WHERE p.id = ?`, String(id)); return p && { baslik: `${p.id}${p.sahip ? ` · ${p.sahip}` : ''}`, durum: p.status, link: `parsel:${p.id}` }; }
    case 'DUYURU': { const d = await tek(`SELECT d.metin, d.region_id, d.gizlendi, u.display_name AS ad FROM mahalle_duyurulari d JOIN users u ON u.id = d.user_id WHERE d.id = ?`, Number(id)); return d && { baslik: `${d.ad}: “${d.metin.slice(0, 140)}”`, durum: d.gizlendi ? 'GIZLI' : 'YAYINDA', link: `mahalle:${d.region_id}` }; }
    case 'MESAJ': { const m = await tek(`SELECT m.metin, m.gizlendi, u.display_name AS ad FROM sohbet_mesajlari m JOIN users u ON u.id = m.user_id WHERE m.id = ?`, Number(id)); return m && { baslik: `${m.ad}: “${m.metin.slice(0, 140)}”`, durum: m.gizlendi ? 'GIZLI' : 'YAYINDA' }; }
    case 'ILAN': { const i = await tek(`SELECT parcel_id, asking_price, status FROM listings WHERE id = ?`, Number(id)); return i && { baslik: `İlan #${id} · ${i.parcel_id} · ₳${i.asking_price}`, durum: i.status, link: `parsel:${i.parcel_id}` }; }
    case 'PROJE': { const p = await tek(`SELECT tur, maliyet, durum, region_id FROM projeler WHERE id = ?`, Number(id)); return p && { baslik: `Proje #${id} · ${p.tur} · ₳${p.maliyet}`, durum: p.durum, link: `belediye:${p.region_id}` }; }
    default: return null;
  }
}
const hedefMetni = async (tur, id) => {
  const t = GIZLENEBILIR[tur];
  if (!t) return '';
  return (await guvenliOku(`SELECT metin FROM ${t} WHERE id = ?`, Number(id)))?.metin || '';
};

async function sikayetEt(userId, govde = {}) {
  const tur = String(govde.hedefTur || '');
  if (!MODERASYON.hedefTurleri.includes(tur)) throw new OyunHatasi(400, 'Geçersiz şikâyet hedefi');
  const hedefId = String(govde.hedefId ?? '').slice(0, 40);
  if (!await hedefOzeti(tur, hedefId)) throw new OyunHatasi(404, 'Şikâyet edilen içerik bulunamadı');
  if (tur === 'KULLANICI' && Number(hedefId) === userId) throw new OyunHatasi(400, 'Kendini şikâyet edemezsin');
  const sebep = String(govde.sebep || '');
  if (!Object.hasOwn(MODERASYON.sebepler, sebep)) throw new OyunHatasi(400, 'Şikâyet sebebini seç');
  const aciklama = govde.aciklama ? metinAl(govde.aciklama, 'Açıklama', 0, 500) : null;
  const metin = await hedefMetni(tur, hedefId);
  const tarama = icerikDenetle(metin);
  const onTarama = tarama.nedenler.length ? tarama.nedenler.map((n) => n.not).join(' · ') : null;
  const id = await db.tx(async () => {
    // Açık şikâyet sınırı oyuncu başına: denetim ile yazma arasına aynı oyuncunun başka şikâyeti girmesin
    await db.kilit(`sikayet:${userId}`);
    if ((await db.get(`SELECT COUNT(*) c FROM sikayetler WHERE sikayetci_id = ? AND durum = 'ACIK'`, userId)).c >= MODERASYON.acikSikayetSiniri) {
      throw new OyunHatasi(429, 'Açık şikâyetlerin incelenmeden yenisini gönderemezsin');
    }
    // Aynı içerik için tek açık şikâyet (kısmi benzersiz indeks ux_sikayet_acik); ihlal işlemi bozmasın diye DO NOTHING
    const r = await db.run(`INSERT INTO sikayetler (sikayetci_id, hedef_tur, hedef_id, sebep, aciklama, on_tarama, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
                            ON CONFLICT DO NOTHING`, userId, tur, hedefId, sebep, aciklama, onTarama, simdi());
    if (r.changes !== 1) throw new OyunHatasi(409, 'Bu içerik için açık bir şikâyetin zaten var');
    await L.denetim({ aktor: userId, eylem: 'REPORT_FILED', varlik: `${tur}:${hedefId}`, sonra: { sebep }, herkese: false });
    for (const y of await yetkililer()) await bildir(y.id, `Yeni şikâyet: ${MODERASYON.sebepler[sebep]} (${tur})`, 'yonetim');
    return r.lastInsertRowid;
  });
  await require('./yz').arkaPlandaTara('sikayetler', id, metin || aciklama, `şikâyet: ${MODERASYON.sebepler[sebep]}`);
  return { tamam: true, id };
}

async function sikayetKarar(modId, sikayetId, { karar, not } = {}) {
  if (!['KARARA_BAGLANDI', 'REDDEDILDI'].includes(karar)) throw new OyunHatasi(400, 'Karar KARARA_BAGLANDI ya da REDDEDILDI olmalı');
  const aciklama = metinAl(not || '', 'Karar notu', 5, 500);
  const no = Number(sikayetId);
  return db.tx(async () => {
    const s = Number.isFinite(no) ? await db.get(`SELECT * FROM sikayetler WHERE id = ?`, no) : null;
    if (!s) throw new OyunHatasi(404, 'Şikâyet bulunamadı');
    if (s.durum !== 'ACIK') throw new OyunHatasi(409, 'Şikâyet zaten sonuçlandı');
    if (s.sikayetci_id === modId) throw new OyunHatasi(403, 'Kendi şikâyetini sonuçlandıramazsın');
    // Koşullu yazma: iki yetkili aynı anda karar verirse yalnızca biri geçer
    const r = await db.run(`UPDATE sikayetler SET durum = ?, karar = ?, karar_veren = ?, kapandi_at = ? WHERE id = ? AND durum = 'ACIK'`, karar, aciklama, modId, simdi(), s.id);
    if (r.changes !== 1) throw new OyunHatasi(409, 'Şikâyet zaten sonuçlandı');
    await L.denetim({ aktor: modId, eylem: 'REPORT_RESOLVED', varlik: `SIKAYET:${s.id}`, sonra: { karar }, herkese: false });
    await bildir(s.sikayetci_id, `Şikâyetin incelendi: ${karar === 'REDDEDILDI' ? 'ihlal bulunmadı' : 'gerekli işlem yapıldı'}. Not: ${aciklama}`, null);
    return { tamam: true };
  });
}

// ---------- Makam boşaltma (görevden alma, hesap silme, moderasyon)
async function makamBosalt(regionId, makam, hedefId, sebep, aktor = null) {
  const t = simdi();
  const r = makam === 'MUHTAR'
    ? await db.run(`UPDATE muhtarlar SET bitis = ? WHERE region_id = ? AND user_id = ? AND baslangic <= ? AND bitis > ?`, t, regionId, hedefId, t, t)
    : await db.run(`UPDATE belediye_uyeleri SET bitis = ? WHERE region_id = ? AND user_id = ? AND makam = ? AND baslangic <= ? AND bitis > ?`, t, regionId, hedefId, makam, t, t);
  if (!r.changes) return false;
  await L.denetim({ aktor, eylem: 'OFFICE_VACATED', varlik: `${makam}:${regionId}:${hedefId}`, bolge: regionId, herkese: true, sonra: { makam, sebep } });
  const secim = require('./secim');
  const tur = makam === 'MUHTAR' ? SECIM.turler.MUHTAR : SECIM.turler.BELEDIYE;
  const ad = { MUHTAR: 'Muhtarlık', BASKAN: 'Belediye başkanlığı', MECLIS: 'Bir meclis üyeliği' }[makam];
  const link = makam === 'MUHTAR' ? `mahalle:${regionId}` : `belediye:${regionId}`;
  const sonra = { MUHTAR: ' Yeni muhtarlık seçimi takvimi açılacak.', BASKAN: ' Meclis görevini sürdürür; başkanlık için ara seçim takvimi açılacak.',
    MECLIS: ' Koltuk dönem sonuna dek boş kalır.' }[makam];
  for (const s of await secim.sakinler(tur, regionId)) await bildir(s.id, `${ad} boşaldı: ${sebep}.${sonra}`, link);
  return true;
}
async function tumMakamlariBosalt(userId, sebep, aktor = userId) {
  const t = simdi();
  for (const m of await db.all(`SELECT region_id FROM muhtarlar WHERE user_id = ? AND baslangic <= ? AND bitis > ?`, userId, t, t)) await makamBosalt(m.region_id, 'MUHTAR', userId, sebep, aktor);
  for (const b of await db.all(`SELECT region_id, makam FROM belediye_uyeleri WHERE user_id = ? AND baslangic <= ? AND bitis > ?`, userId, t, t)) await makamBosalt(b.region_id, b.makam, userId, sebep, aktor);
}

// Görevdeki makam sahibi (yoksa null). Sayısal olmayan kimlik sorguya gitmez (Postgres'te tür hatası olurdu).
async function gorevdeki(regionId, makam, hedefId) {
  const t = simdi();
  if (!Number.isFinite(regionId)) return null;
  if (makam === 'MUHTAR') return (await db.get(`SELECT m.*, u.display_name AS ad FROM muhtarlar m JOIN users u ON u.id = m.user_id WHERE m.region_id = ? AND m.baslangic <= ? AND m.bitis > ? ORDER BY m.id DESC LIMIT 1`, regionId, t, t)) || null;
  const sql = `SELECT b.*, u.display_name AS ad FROM belediye_uyeleri b JOIN users u ON u.id = b.user_id WHERE b.region_id = ? AND b.makam = ? AND b.baslangic <= ? AND b.bitis > ?`;
  if (makam === 'BASKAN') return (await db.get(`${sql} ORDER BY b.id DESC LIMIT 1`, regionId, 'BASKAN', t, t)) || null;
  if (!Number.isFinite(Number(hedefId))) return null;
  return (await db.get(`${sql} AND b.user_id = ?`, regionId, 'MECLIS', t, t, Number(hedefId))) || null;
}

// ---------- İki kişi kuralı
async function hedefCoz(tur, hedef) {
  const h = String(hedef || '');
  switch (tur) {
    case 'ICERIK_GIZLE': { const [t, id] = h.split(':'); if (!GIZLENEBILIR[t] || !await hedefOzeti(t, id)) throw new OyunHatasi(404, 'İçerik bulunamadı (DUYURU:<id> / MESAJ:<id>)'); return { t, id: Number(id) }; }
    case 'PARSEL_DONDUR': case 'PARSEL_COZ': { if (!await hedefOzeti('PARSEL', h)) throw new OyunHatasi(404, 'Parsel bulunamadı'); return { id: h }; }
    case 'HESAP_ASKI': case 'HESAP_AC': { if (!await hedefOzeti('KULLANICI', h)) throw new OyunHatasi(404, 'Hesap bulunamadı'); return { id: Number(h) }; }
    case 'GOREVDEN_AL': {
      const [makam, r, u] = h.split(':');
      if (!['MUHTAR', 'BASKAN', 'MECLIS'].includes(makam)) throw new OyunHatasi(400, 'Hedef MAKAM:<bölge>:<kullanıcı> biçiminde olmalı');
      const g = await gorevdeki(Number(r), makam, Number(u));
      if (!g || g.user_id !== Number(u)) throw new OyunHatasi(404, 'Bu makamda görevde böyle biri yok');
      return { makam, regionId: Number(r), userId: Number(u) };
    }
    case 'SECIM_IPTAL': { const s = await guvenliOku(`SELECT * FROM secimler WHERE id = ?`, Number(h)); if (!s) throw new OyunHatasi(404, 'Seçim bulunamadı'); if (s.asama === 'IPTAL') throw new OyunHatasi(409, 'Seçim zaten iptal'); return { secim: s }; }
    default: throw new OyunHatasi(400, 'Geçersiz işlem türü');
  }
}

// İşlem içinde çağrılır (islemOner / islemKarar)
async function uygula(islem) {
  const tur = islem.tur;
  const x = await hedefCoz(tur, islem.hedef);
  const t = simdi();
  const sebep = `Moderasyon kararı #${islem.id}: ${islem.gerekce}`;
  switch (tur) {
    case 'ICERIK_GIZLE': await db.run(`UPDATE ${GIZLENEBILIR[x.t]} SET gizlendi = 1 WHERE id = ?`, x.id); break;
    case 'PARSEL_DONDUR': {
      await db.get(`SELECT id FROM parcels WHERE id = ? FOR UPDATE`, x.id);
      await db.run(`UPDATE parcels SET status = 'FROZEN', version = version + 1 WHERE id = ?`, x.id);
      const ilan = await db.get(`SELECT id, seller_id FROM listings WHERE parcel_id = ? AND status = 'ACTIVE'`, x.id);
      if (ilan) await require('./pazar').ilanIptal(ilan.seller_id, ilan.id);
      const sahip = (await db.get(`SELECT owner_user_id FROM parcels WHERE id = ?`, x.id)).owner_user_id;
      if (sahip) await bildir(sahip, `${x.id} parselin inceleme süresince donduruldu. Gerekçe: ${islem.gerekce}`, `parsel:${x.id}`);
      break;
    }
    case 'PARSEL_COZ': await db.run(`UPDATE parcels SET status = 'ACTIVE', version = version + 1 WHERE id = ?`, x.id); break;
    case 'HESAP_ASKI':
      if ((await db.run(`UPDATE users SET status = 'SUSPENDED' WHERE id = ? AND status = 'ACTIVE'`, x.id)).changes) await tumMakamlariBosalt(x.id, sebep, islem.onaylayan_id);
      break;
    case 'HESAP_AC': await db.run(`UPDATE users SET status = 'ACTIVE' WHERE id = ? AND status = 'SUSPENDED'`, x.id); break;
    case 'GOREVDEN_AL': await makamBosalt(x.regionId, x.makam, x.userId, sebep, islem.onaylayan_id); break;
    case 'SECIM_IPTAL': {
      // Koşullu: aynı anda kapanan / iptal edilen seçimle yarışmasın
      const r = await db.run(`UPDATE secimler SET asama = 'IPTAL', iptal_sebebi = ?, bitis_at = ? WHERE id = ? AND asama <> 'IPTAL'`, `Denetim kurulu: ${islem.gerekce}`, t, x.secim.id);
      if (r.changes !== 1) throw new OyunHatasi(409, 'Seçim zaten iptal');
      // Sonuçlanmış seçim iptal edilirse o seçimle göreve gelenlerin görevi biter
      const tab = x.secim.tur === 'BELEDIYE' ? 'belediye_uyeleri' : 'muhtarlar';
      await db.run(`UPDATE ${tab} SET bitis = ? WHERE secim_id = ? AND bitis > ?`, t, x.secim.id, t);
      await L.denetim({ anahtar: `ELECTION_ANNULLED:${x.secim.id}`, aktor: islem.onaylayan_id, eylem: 'ELECTION_ANNULLED', varlik: `SECIM:${x.secim.id}`,
        bolge: x.secim.region_id, herkese: true, sonra: { tur: x.secim.tur, sebep: `Denetim kurulu: ${islem.gerekce}` } });
      break;
    }
  }
}

async function rutbeDenetle(aktorId, tur, hedef) {
  if (tur !== 'HESAP_ASKI') return;
  if (await rutbe(aktorId) <= await rutbe(Number(hedef))) throw new OyunHatasi(403, 'Yetkili bir hesabı askıya alma işlemini yalnızca ondan üst roldeki biri önerebilir ya da onaylayabilir');
}

async function islemOner(modId, govde = {}) {
  const tur = String(govde.tur || '');
  const tanim = Object.hasOwn(MODERASYON.islemler, tur) ? MODERASYON.islemler[tur] : null;
  if (!tanim) throw new OyunHatasi(400, 'Geçersiz işlem türü');
  const gerekce = metinAl(govde.gerekce || '', 'Gerekçe', 10, 500);
  const hedef = String(govde.hedef || '').slice(0, 80);
  await hedefCoz(tur, hedef);
  if (tur === 'HESAP_ASKI' && Number(hedef) === modId) throw new OyunHatasi(400, 'Kendi hesabın için işlem öneremezsin');
  await rutbeDenetle(modId, tur, hedef);
  const sikayetId = govde.sikayetId ? Number(govde.sikayetId) : null;
  const t = simdi();
  return db.tx(async () => {
    const id = (await db.run(`INSERT INTO moderasyon_islemleri (tur, hedef, gerekce, sikayet_id, oneren_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      tur, hedef, gerekce, sikayetId, modId, t)).lastInsertRowid;
    await L.denetim({ aktor: modId, eylem: 'MOD_ACTION_PROPOSED', varlik: `MOD:${id}`, sonra: { tur, hedef }, herkese: false });
    if (!tanim.ikiKisi) {
      const islem = await db.get(`UPDATE moderasyon_islemleri SET durum = 'UYGULANDI', onaylayan_id = ?, karar_at = ? WHERE id = ? RETURNING *`, modId, t, id);
      await uygula(islem);
      await L.denetim({ aktor: modId, eylem: 'MOD_ACTION_APPLIED', varlik: `MOD:${id}`, sonra: { tur, hedef }, herkese: tur !== 'ICERIK_GIZLE' });
      return { tamam: true, id, uygulandi: true };
    }
    for (const y of await yetkililer()) if (y.id !== modId) await bildir(y.id, `Onay bekleyen moderasyon işlemi: ${tanim.ad}`, 'yonetim');
    return { tamam: true, id, uygulandi: false, mesaj: 'İkinci bir yetkilinin onayı bekleniyor (iki kişi kuralı).' };
  });
}

const islemKarar = (modId, islemId, govde = {}) => db.tx(async () => {
  const onay = govde?.onay;
  if (typeof onay !== 'boolean') throw new OyunHatasi(400, 'Karar onay: true ya da onay: false olmalı');
  const no = Number(islemId);
  // Satır kilitlenir: iki yetkili aynı anda karar verirse ikincisi ilkinin sonucunu görür
  const i = Number.isFinite(no) ? await db.get(`SELECT * FROM moderasyon_islemleri WHERE id = ? FOR UPDATE`, no) : null;
  if (!i) throw new OyunHatasi(404, 'İşlem bulunamadı');
  if (i.durum !== 'ONAY_BEKLIYOR') throw new OyunHatasi(409, 'İşlem zaten karara bağlandı');
  if (i.oneren_id === modId) throw new OyunHatasi(403, 'Önerdiğin işlemi sen onaylayamazsın (iki kişi kuralı)');
  const tanim = MODERASYON.islemler[i.tur];
  if (onay) await rutbeDenetle(modId, i.tur, i.hedef);
  if (onay && tanim.denetciGerekli && ![await rolu(i.oneren_id), await rolu(modId)].some((r) => r === 'DENETCI' || r === 'ADMIN')) {
    throw new OyunHatasi(403, 'Bu işlem için iki kişiden biri denetçi ya da yönetici olmalı');
  }
  const t = simdi();
  const g = await db.get(`UPDATE moderasyon_islemleri SET durum = ?, onaylayan_id = ?, karar_at = ? WHERE id = ? AND durum = 'ONAY_BEKLIYOR' RETURNING *`,
    onay ? 'UYGULANDI' : 'REDDEDILDI', modId, t, i.id);
  if (!g) throw new OyunHatasi(409, 'İşlem zaten karara bağlandı');
  if (onay) await uygula(g);
  await L.denetim({ aktor: modId, eylem: onay ? 'MOD_ACTION_APPLIED' : 'MOD_ACTION_REJECTED', varlik: `MOD:${i.id}`, sonra: { tur: i.tur, hedef: i.hedef }, herkese: !!onay });
  await bildir(i.oneren_id, `${tanim.ad} önerin ${onay ? 'onaylandı ve uygulandı' : 'reddedildi'}.`, 'yonetim');
  return { tamam: true };
});

// ---------- Görevden alma dilekçesi (sakinler)
const dilekceBolgeTuru = (makam) => (makam === 'MUHTAR' ? SECIM.turler.MUHTAR : SECIM.turler.BELEDIYE);
async function imzaSayisi(id) { return (await db.get(`SELECT COUNT(*) c FROM gorevden_alma_imzalar WHERE dilekce_id = ?`, id)).c; }

// Sonuç koşullu UPDATE ile yazılır (durum = 'ACIK'): eşzamanlı son imza ve bakım turu dilekçeyi iki kez sonuçlandıramaz
async function dilekceSonucla(d, t) {
  if (await imzaSayisi(d.id) >= d.esik) {
    if ((await db.run(`UPDATE gorevden_alma SET durum = 'BASARILI', kapandi_at = ? WHERE id = ? AND durum = 'ACIK'`, t, d.id)).changes !== 1) return;
    await L.denetim({ anahtar: `RECALL_SUCCEEDED:${d.id}`, eylem: 'RECALL_SUCCEEDED', varlik: `GOREVDEN_ALMA:${d.id}`, bolge: d.region_id, herkese: true, sonra: { makam: d.makam, imza: await imzaSayisi(d.id), esik: d.esik } });
    await makamBosalt(d.region_id, d.makam, d.hedef_id, 'sakinlerin görevden alma dilekçesi imza eşiğini geçti');
  } else if (d.bitis <= t) {
    if ((await db.run(`UPDATE gorevden_alma SET durum = 'BASARISIZ', kapandi_at = ? WHERE id = ? AND durum = 'ACIK'`, t, d.id)).changes !== 1) return;
    await L.denetim({ anahtar: `RECALL_FAILED:${d.id}`, eylem: 'RECALL_FAILED', varlik: `GOREVDEN_ALMA:${d.id}`, bolge: d.region_id, herkese: true, sonra: { makam: d.makam, imza: await imzaSayisi(d.id), esik: d.esik } });
  }
}
async function gorevdenAlmaBakim() {
  const t = simdi();
  for (const d of await db.all(`SELECT * FROM gorevden_alma WHERE durum = 'ACIK' AND bitis <= ?`, t)) {
    await db.tx(async () => {
      // İmzalarla yarışmasın: dilekçe satırı kilitlenir
      await db.get(`SELECT id FROM gorevden_alma WHERE id = ? FOR UPDATE`, d.id);
      await dilekceSonucla(d, t);
    });
  }
  // Hedef görevden başka yolla ayrıldıysa dilekçe düşer
  for (const d of await db.all(`SELECT * FROM gorevden_alma WHERE durum = 'ACIK'`)) {
    if ((await gorevdeki(d.region_id, d.makam, d.hedef_id))?.user_id !== d.hedef_id) {
      await db.run(`UPDATE gorevden_alma SET durum = 'DUSTU', kapandi_at = ? WHERE id = ? AND durum = 'ACIK'`, t, d.id);
    }
  }
}

const kutukVar = async (id) => !!await db.get(`SELECT 1 FROM gorevden_alma_kutuk WHERE dilekce_id = ? LIMIT 1`, id);
const kutukte = async (id, userId) => !!await db.get(`SELECT 1 FROM gorevden_alma_kutuk WHERE dilekce_id = ? AND user_id = ?`, id, userId);
// İmza kütüğü (dilekçe açılırken): bölgede parseli olan, hesabı yeterince eski sakinler; hedef hariç
async function imzaKutugu(makam, regionId, hedefId, t) {
  const sinir = t - SECIM.secmenMinHesapYasiMs;
  return (await require('./secim').sakinler(dilekceBolgeTuru(makam), regionId)).filter((s) => s.id !== hedefId && sqlMs(s.created_at) <= sinir);
}

async function imzaHakki(userId, d) {
  const secim = require('./secim');
  if (userId === d.hedef_id) return 'Kendi görevden alma dilekçeni imzalayamazsın';
  if (d.id && await kutukVar(d.id)) return await kutukte(d.id, userId) ? null : 'Dilekçe açıldığında bu bölgenin imza kütüğünde değildin';
  if (!await secim.sakinMi(dilekceBolgeTuru(d.makam), d.region_id, userId)) return d.makam === 'MUHTAR' ? 'Bu mahallede parselin olmalı' : 'Bu ilçede parselin olmalı';
  return null;
}

const dilekceBaslat = (userId, govde = {}) => db.tx(async () => {
  const makam = String(govde.makam || '');
  if (!['MUHTAR', 'BASKAN', 'MECLIS'].includes(makam)) throw new OyunHatasi(400, 'Geçersiz makam');
  const regionId = Number(govde.bolgeId);
  // Aynı makam için eşzamanlı iki dilekçe açılmasın (bekleme süresi denetimi ile ekleme arasına başka istek girmesin)
  if (Number.isFinite(regionId)) await db.kilit(`gorevden-alma:${regionId}:${makam}`);
  const g = await gorevdeki(regionId, makam, govde.hedefId);
  if (!g) throw new OyunHatasi(404, 'Bu makamda görevde kimse yok');
  const gerekce = metinAl(govde.gerekce || '', 'Gerekçe', GOREVDEN_ALMA.gerekceMin, 600);
  const tarama = icerikDenetle(gerekce);
  if (tarama.karar === 'ENGEL') throw new OyunHatasi(422, `Gerekçe yayımlanamaz: ${tarama.nedenler.map((n) => n.not).join(', ')}`);
  const d0 = { hedef_id: g.user_id, makam, region_id: regionId };
  const engel = await imzaHakki(userId, d0);
  if (engel) throw new OyunHatasi(403, engel);
  const t = simdi();
  const kutuk = await imzaKutugu(makam, regionId, g.user_id, t);
  if (!kutuk.some((s) => s.id === userId)) throw new OyunHatasi(403, `Dilekçe başlatmak için hesabın en az ${Math.max(1, Math.round(SECIM.secmenMinHesapYasiMs / SECIM.gunMs))} günlük olmalı`);
  if (t < g.baslangic + (g.bitis - g.baslangic) * GOREVDEN_ALMA.korumaOrani) throw new OyunHatasi(409, 'Görevin ilk döneminde (ilk %20) görevden alma dilekçesi başlatılamaz');
  const son = await db.get(`SELECT kapandi_at FROM gorevden_alma WHERE region_id = ? AND makam = ? AND hedef_id = ? AND durum = 'BASARISIZ' ORDER BY id DESC LIMIT 1`, regionId, makam, g.user_id);
  if (son && son.kapandi_at + GOREVDEN_ALMA.beklemeMs > t) throw new OyunHatasi(409, 'Başarısız bir dilekçeden sonra bekleme süresi dolmadı');
  const uygun = kutuk.length;
  const esik = Math.max(GOREVDEN_ALMA.minImza, Math.ceil(uygun * GOREVDEN_ALMA.imzaOrani));
  if (esik > uygun) throw new OyunHatasi(409, `Dilekçe için en az ${esik} imza gerekir; bölgede imza atabilecek ${uygun} sakin var`);
  // Makam başına tek açık dilekçe (kısmi benzersiz indeks ux_gorevden_alma_acik); ihlal işlemi bozmasın diye DO NOTHING
  const ek = await db.run(`INSERT INTO gorevden_alma (region_id, makam, hedef_id, baslatan_id, gerekce, esik, bitis, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                           ON CONFLICT DO NOTHING`, regionId, makam, g.user_id, userId, gerekce, esik, t + GOREVDEN_ALMA.sureMs, t);
  if (ek.changes !== 1) throw new OyunHatasi(409, 'Bu makam için zaten açık bir dilekçe var');
  const id = ek.lastInsertRowid;
  const kutukEkle = db.sorgu(`INSERT INTO gorevden_alma_kutuk (dilekce_id, user_id) VALUES (?, ?)`);
  for (const s of kutuk) await kutukEkle.run(id, s.id);
  await db.run(`INSERT INTO gorevden_alma_imzalar (dilekce_id, user_id, created_at) VALUES (?, ?, ?)`, id, userId, t);
  await L.denetim({ anahtar: `RECALL_STARTED:${id}`, aktor: userId, eylem: 'RECALL_STARTED', varlik: `GOREVDEN_ALMA:${id}`, bolge: regionId, herkese: true, sonra: { makam, hedef: g.ad, esik } });
  const link = makam === 'MUHTAR' ? `mahalle:${regionId}` : `belediye:${regionId}`;
  for (const s of kutuk) if (s.id !== userId) await bildir(s.id, `${g.ad} için görevden alma dilekçesi açıldı (${esik} imza gerekli).`, link);
  await dilekceSonucla(await db.get(`SELECT * FROM gorevden_alma WHERE id = ?`, id), t);
  return { tamam: true, id, esik };
});

const dilekceImzala = (userId, dilekceId) => db.tx(async () => {
  const no = Number(dilekceId);
  // Dilekçe satırı kilitlenir: imza ile sonuçlandırma (bakım turu, son imza) sıraya girer
  const d = Number.isFinite(no) ? await db.get(`SELECT * FROM gorevden_alma WHERE id = ? FOR UPDATE`, no) : null;
  if (!d) throw new OyunHatasi(404, 'Dilekçe bulunamadı');
  const t = simdi();
  if (d.durum !== 'ACIK' || d.bitis <= t) throw new OyunHatasi(409, 'Dilekçe imzaya kapalı');
  const engel = await imzaHakki(userId, d);
  if (engel) throw new OyunHatasi(403, engel);
  if ((await db.run(`INSERT OR IGNORE INTO gorevden_alma_imzalar (dilekce_id, user_id, created_at) VALUES (?, ?, ?)`, d.id, userId, t)).changes !== 1) {
    throw new OyunHatasi(409, 'Bu dilekçeyi zaten imzaladın');
  }
  await L.denetim({ aktor: userId, eylem: 'RECALL_SIGNED', varlik: `GOREVDEN_ALMA:${d.id}`, bolge: d.region_id });
  await dilekceSonucla(d, t);
  const g = await db.get(`SELECT durum FROM gorevden_alma WHERE id = ?`, d.id);
  return { tamam: true, imza: await imzaSayisi(d.id), esik: d.esik, durum: g.durum };
});

// Bölge sayfası için dilekçeler (açık olanlar + son kapananlar). İmza listesi açık değildir; yalnızca sayı.
async function dilekceler(regionId, userId) {
  const r = Number(regionId);
  if (!Number.isFinite(r)) return [];
  const liste = [];
  for (const d of await db.all(`SELECT g.*, u.display_name AS hedef_ad, b.display_name AS baslatan_ad FROM gorevden_alma g
                     JOIN users u ON u.id = g.hedef_id JOIN users b ON b.id = g.baslatan_id
                     WHERE g.region_id = ? AND (g.durum = 'ACIK' OR g.kapandi_at > ?) ORDER BY g.id DESC LIMIT 5`, r, simdi() - GOREVDEN_ALMA.beklemeMs)) {
    liste.push({ id: d.id, makam: d.makam, hedef: d.hedef_ad, baslatan: d.baslatan_ad, gerekce: d.gerekce, esik: d.esik, imza: await imzaSayisi(d.id),
      durum: d.durum, bitis: d.bitis, imzaladim: !!userId && !!await db.get(`SELECT 1 FROM gorevden_alma_imzalar WHERE dilekce_id = ? AND user_id = ?`, d.id, userId),
      imzaHakki: userId ? !await imzaHakki(userId, d) : false });
  }
  return liste;
}

// ---------- Yönetim paneli
async function panel(modId) {
  const t = simdi();
  const sikayet = [];
  for (const s of await db.all(`SELECT s.*, u.display_name AS sikayetci FROM sikayetler s JOIN users u ON u.id = s.sikayetci_id
                              ORDER BY (s.durum = 'ACIK') DESC, s.id DESC LIMIT 60`)) {
    sikayet.push({ ...s, sebepAd: MODERASYON.sebepler[s.sebep], hedef: await hedefOzeti(s.hedef_tur, s.hedef_id) });
  }
  const islemler = (await db.all(`SELECT m.*, o.display_name AS oneren, a.display_name AS onaylayan FROM moderasyon_islemleri m
                               JOIN users o ON o.id = m.oneren_id LEFT JOIN users a ON a.id = m.onaylayan_id ORDER BY (m.durum = 'ONAY_BEKLIYOR') DESC, m.id DESC LIMIT 40`))
    .map((m) => ({ ...m, ad: MODERASYON.islemler[m.tur]?.ad, benOnerdim: m.oneren_id === modId }));
  const secimler = await db.all(`SELECT s.id, s.tur, s.asama, s.region_id, s.bitis_at, s.iptal_sebebi, s.ozet_hash, r.name AS bolge,
                                 (SELECT COUNT(*) FROM itirazlar i WHERE i.secim_id = s.id) AS itiraz,
                                 (SELECT COUNT(*) FROM secim_katilim k WHERE k.secim_id = s.id) AS katilim
                               FROM secimler s JOIN regions r ON r.id = s.region_id ORDER BY s.id DESC LIMIT 30`);
  const kararlar = (await db.all(`SELECT p.id, p.tur, p.maliyet, p.durum, p.nitelikli, p.karar_json, r.name AS ilce, u.display_name AS teklif_eden
                               FROM projeler p JOIN regions r ON r.id = p.region_id JOIN users u ON u.id = p.teklif_eden_id ORDER BY p.id DESC LIMIT 30`))
    .map((p) => ({ ...p, karar: JSON.parse(p.karar_json || 'null') }));
  const dilekce = [];
  for (const d of await db.all(`SELECT g.id, g.makam, g.durum, g.esik, g.bitis, r.name AS bolge, u.display_name AS hedef FROM gorevden_alma g
                              JOIN regions r ON r.id = g.region_id JOIN users u ON u.id = g.hedef_id ORDER BY g.id DESC LIMIT 20`)) {
    dilekce.push({ ...d, imza: await imzaSayisi(d.id) });
  }
  const isaretliMesajlar = await db.all(`SELECT m.id, m.kanal, m.metin, m.on_tarama, m.created_at, u.display_name AS ad FROM sohbet_mesajlari m
                                       JOIN users u ON u.id = m.user_id WHERE m.on_tarama IS NOT NULL AND m.gizlendi = 0 ORDER BY m.id DESC LIMIT 40`);
  const say = async (sql, ...p) => (await db.get(sql, ...p)).c;
  const rol = await rolu(modId);
  return {
    isaretliMesajlar,
    ben: { id: modId, rol, rolAd: ROLLER[rol] },
    ozet: {
      oyuncu: await say(`SELECT COUNT(*) c FROM users WHERE is_npc = 0 AND status <> 'DELETED'`),
      aktif24: await say(`SELECT COUNT(DISTINCT user_id) c FROM sessions WHERE son_gorulme > datetime('now', '-1 day')`),
      askida: await say(`SELECT COUNT(*) c FROM users WHERE status = 'SUSPENDED'`),
      donmusParsel: await say(`SELECT COUNT(*) c FROM parcels WHERE status = 'FROZEN'`),
      acikSikayet: await say(`SELECT COUNT(*) c FROM sikayetler WHERE durum = 'ACIK'`),
      onayBekleyen: await say(`SELECT COUNT(*) c FROM moderasyon_islemleri WHERE durum = 'ONAY_BEKLIYOR'`),
      supheliIslem: await say(`SELECT COUNT(*) c FROM trades WHERE flags <> '[]' AND created_at > ?`, t - 7 * SECIM.gunMs),
    },
    sikayetler: sikayet, islemler, secimler, kararlar, dilekceler: dilekce,
    tanimlar: { sebepler: MODERASYON.sebepler, islemler: MODERASYON.islemler, roller: ROLLER },
  };
}

async function rolDegistir(adminId, { userId, rol } = {}) {
  if (!Object.hasOwn(ROLLER, rol)) throw new OyunHatasi(400, 'Geçersiz rol');
  const hedef = Number(userId);
  if (hedef === adminId) throw new OyunHatasi(400, 'Kendi rolünü değiştiremezsin');
  if (!Number.isFinite(hedef)) throw new OyunHatasi(404, 'Kullanıcı bulunamadı');
  return db.tx(async () => {
    const u = await db.get(`SELECT id, rol FROM users WHERE id = ? AND is_npc = 0 AND status <> 'DELETED' FOR UPDATE`, hedef);
    if (!u) throw new OyunHatasi(404, 'Kullanıcı bulunamadı');
    await db.run(`UPDATE users SET rol = ? WHERE id = ?`, rol, hedef);
    await L.denetim({ aktor: adminId, eylem: 'ROLE_CHANGED', varlik: `USER:${hedef}`, once: { rol: u.rol }, sonra: { rol }, herkese: false });
    return { tamam: true };
  });
}

async function rotalar(app, { h, auth }) {
  const yetkili = auth.rolGerekli(...YETKILI);
  app.post('/api/sikayet', auth.dogrulanmisGerekli, h((req) => sikayetEt(req.kullanici.id, req.body)));
  app.get('/api/sikayet/tanimlar', h(() => ({ sebepler: MODERASYON.sebepler, hedefTurleri: MODERASYON.hedefTurleri })));
  if (OZELLIK.siyaset) {   // siyaset kapalıyken görevden alma uçları hiç kaydedilmez
    app.post('/api/gorevden-alma', auth.dogrulanmisGerekli, h((req) => dilekceBaslat(req.kullanici.id, req.body)));
    app.post('/api/gorevden-alma/:id/imza', auth.dogrulanmisGerekli, h((req) => dilekceImzala(req.kullanici.id, req.params.id)));
  }
  app.get('/api/yonetim/panel', yetkili, h((req) => panel(req.kullanici.id)));
  app.post('/api/yonetim/sikayet/:id', yetkili, h((req) => sikayetKarar(req.kullanici.id, req.params.id, req.body)));
  app.post('/api/yonetim/islem', yetkili, h((req) => islemOner(req.kullanici.id, req.body)));
  app.post('/api/yonetim/islem/:id', yetkili, h((req) => islemKarar(req.kullanici.id, req.params.id, req.body)));
  app.post('/api/yonetim/rol', auth.rolGerekli('ADMIN'), h((req) => rolDegistir(req.kullanici.id, req.body)));
}

// İstemci metinleri için dilekçe kuralları (sabit metin yerine)
const dilekceKurallari = { imzaOrani: GOREVDEN_ALMA.imzaOrani, minImza: GOREVDEN_ALMA.minImza, sureMs: GOREVDEN_ALMA.sureMs,
  korumaOrani: GOREVDEN_ALMA.korumaOrani, minHesapYasiMs: SECIM.secmenMinHesapYasiMs };

module.exports = {
  dilekceKurallari,
  rotalar, sikayetEt, sikayetKarar, islemOner, islemKarar, makamBosalt, tumMakamlariBosalt, gorevdeki,
  dilekceBaslat, dilekceImzala, dilekceler, gorevdenAlmaBakim, panel, rolDegistir, YETKILI,
};
