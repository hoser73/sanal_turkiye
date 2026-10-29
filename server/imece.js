// İmece: iki komşunun haftalık ortak hedefi (haftalar LIG.baslangic'tan 7'şer gün). Oyuncu bir komşusunu davet eder,
// komşu kabul edince ortaklık o hafta için kurulur. İkisinin oyun işleri (olay yolu) ortak puana yazar; aynı işten günde
// en çok IMECE.gunlukTavan kayıt sayılır. Ortak puan bir kademenin eşiğini geçince, en az minKatki puan katmış ortak o
// kademenin ödülünü alır (katkısı sonradan yetişen ortak geçilmiş kademeleri o an alır). Pasif ortak bırakılabilir; haftada
// en çok haftalikOrtak ortaklık kurulur. Demo komşu ortak olabilir (yalnız oynayan da imece yapsın) ama ödül almaz.
const db = require('./db');
const L = require('./lib/ledger');
const { OyunHatasi } = L;
const { IMECE: I, LIG, URUNLER } = require('./config/rules');
const { yol } = require('./lib/olaylar');


const HAFTA = 7 * 86_400_000;
const haftaNo = (t = Date.now()) => Math.floor((t - LIG.baslangic) / HAFTA);
const haftaBitis = (h) => LIG.baslangic + (h + 1) * HAFTA;
const gunAnahtari = (t) => new Date(t + 3 * 3600_000).toISOString().slice(0, 10);
const q = {
  aktif: db.sorgu(`SELECT * FROM imece WHERE hafta = ? AND durum = 'AKTIF' AND (a_id = ? OR b_id = ?)`),
  aktifler: db.sorgu(`SELECT * FROM imece WHERE hafta = ? AND durum = 'AKTIF' AND (a_id = ? OR b_id = ?)`),
  kurulan: db.sorgu(`SELECT COUNT(*) AS c FROM imece WHERE hafta = ? AND durum IN ('AKTIF', 'BITTI') AND (a_id = ? OR b_id = ?)`),
  gelen: db.sorgu(`SELECT i.id, i.created_at, u.display_name AS ad FROM imece i JOIN users u ON u.id = i.a_id
    WHERE i.hafta = ? AND i.b_id = ? AND i.durum = 'DAVET' AND i.created_at > ?`),
  giden: db.sorgu(`SELECT i.id, u.display_name AS ad FROM imece i JOIN users u ON u.id = i.b_id
    WHERE i.hafta = ? AND i.a_id = ? AND i.durum = 'DAVET' AND i.created_at > ?`),
  imece: db.sorgu('SELECT * FROM imece WHERE id = ?'),
  gunluk: db.sorgu(`INSERT INTO imece_gunluk (user_id, gun, eylem, adet) VALUES (?, ?, ?, 1)
    ON CONFLICT (user_id, gun, eylem) DO UPDATE SET adet = imece_gunluk.adet + 1 RETURNING adet`),   // tablo adıyla: Postgres'te yalın ad belirsiz
  arkadas: db.sorgu(`SELECT 1 FROM arkadasliklar WHERE durum = 'KABUL' AND ((isteyen = ? AND hedef = ?) OR (isteyen = ? AND hedef = ?))`),
  kullanici: db.sorgu('SELECT id, display_name AS ad, is_npc FROM users WHERE id = ?'),
};
const ortakId = (i, userId) => (i.a_id === userId ? i.b_id : i.a_id);
const katkisi = (i, userId) => (i.a_id === userId ? i.puan_a : i.puan_b);
const bildir = (userId, m) => require('./pazar').bildir(userId, m, 'gorevler');

// Geçilen kademelerin ödülü, katkısı yeten ve henüz almamış (gerçek) ortaklara (işlem içinde çağrılır)
async function oduller(i) {
  const toplam = i.puan_a + i.puan_b, t = Date.now();
  for (const userId of [i.a_id, i.b_id]) {
    if (katkisi(i, userId) < I.minKatki || (await q.kullanici.get(userId))?.is_npc) continue;
    for (const [n, k] of I.kademeler.entries()) {
      if (toplam < k.esik) continue;
      if ((await db.run('INSERT OR IGNORE INTO imece_odul (imece_id, user_id, kademe, at) VALUES (?, ?, ?, ?)', i.id, userId, n + 1, t)).changes !== 1) continue;
      const tx = L.yeniTx();
      await L.odul(userId, k.akce, `İmece ${n + 1}. kademe`, tx);
      if (k.esya) await L.envanterDegis(userId, k.esya[0], k.esya[1], `İmece ${n + 1}. kademe`, tx);
      await bildir(userId, `🤝 İmece ${n + 1}. kademe tamam! +${k.akce} akçe${k.esya ? ` ve ${k.esya[1]} ${URUNLER[k.esya[0]].ad}` : ''}`);
    }
  }
}

// Kendi işlemini açar (çağıran işlemdeyse kayıt noktası olur)
function puanVer(userId, eylem, t = Date.now()) {
  const p = I.puanlar[eylem];
  if (!p || !userId) return Promise.resolve(0);
  return db.tx(async () => {
    // Gerçek oyuncunun tek imecesi olur; demo komşu birden çok oyuncuya ortak olabilir
    const satirlar = await q.aktifler.all(haftaNo(t), userId, userId);
    if (!satirlar.length) return 0;
    if ((await q.gunluk.get(userId, gunAnahtari(t), eylem)).adet > I.gunlukTavan) return 0;
    for (const i of satirlar) {
      await db.run(`UPDATE imece SET ${i.a_id === userId ? 'puan_a = puan_a' : 'puan_b = puan_b'} + ? WHERE id = ?`, p, i.id);
      await oduller(await q.imece.get(i.id));
    }
    return p;
  });
}
yol.on('eylem', ({ eylem, aktor }) => {
  puanVer(aktor, eylem).catch(() => { /* kullanıcı silinmiş olabilir */ });
});

// İmece kuran oyuncular işlem sonuna kadar kilitlenir: haftalık sınır ve tek imece kuralı eşzamanlı isteklerde de geçerli
const kilitle = (...idler) => db.kilit(...idler.map((id) => `imece:${id}`));

const davet = (userId, hedefId) => db.tx(async () => {
  const t = Date.now(), h = haftaNo(t);
  hedefId = Number(hedefId);
  if (!await q.kullanici.get(hedefId) || hedefId === userId) throw new OyunHatasi(404, 'Komşu bulunamadı');
  if (!await q.arkadas.get(userId, hedefId, hedefId, userId)) throw new OyunHatasi(403, 'Yalnızca komşunu imeceye çağırabilirsin');
  await kilitle(userId, hedefId);
  if (await q.aktif.get(h, userId, userId)) throw new OyunHatasi(409, 'Bu hafta zaten bir imecen var');
  const hedef = await q.kullanici.get(hedefId);
  if (!hedef.is_npc && await q.aktif.get(h, hedefId, hedefId)) throw new OyunHatasi(409, 'Komşunun bu hafta başka bir imecesi var');
  if ((await q.kurulan.get(h, userId, userId)).c >= I.haftalikOrtak) throw new OyunHatasi(409, `Haftada en çok ${I.haftalikOrtak} imece kurulur`, 'HAFTALIK');
  if ((await q.giden.all(h, userId, t - I.davetSuresiMs)).length) throw new OyunHatasi(409, 'Zaten bekleyen bir davetin var');
  const id = Number((await db.run('INSERT INTO imece (hafta, a_id, b_id, created_at) VALUES (?, ?, ?, ?)', h, userId, hedefId, t)).lastInsertRowid);
  if (hedef.is_npc) return kabulEt(hedefId, id);   // demo komşu hemen kabul eder
  await bildir(hedefId, `🤝 ${(await q.kullanici.get(userId)).ad} seni bu haftanın imecesine çağırıyor`);
  return { tamam: true, id };
});
// İşlem içinde çağrılır
async function kabulEt(userId, id) {
  const i = await q.imece.get(Number(id)), t = Date.now(), h = haftaNo(t);
  if (!i || i.b_id !== userId || i.durum !== 'DAVET' || i.hafta !== h || i.created_at <= t - I.davetSuresiMs) throw new OyunHatasi(404, 'Davet bulunamadı');
  await kilitle(i.a_id, i.b_id);
  for (const u of [i.a_id, i.b_id]) {
    if ((await q.kullanici.get(u)).is_npc) continue;
    if (await q.aktif.get(h, u, u)) throw new OyunHatasi(409, 'Bu hafta zaten bir imece var');
    if ((await q.kurulan.get(h, u, u)).c >= I.haftalikOrtak) throw new OyunHatasi(409, `Haftada en çok ${I.haftalikOrtak} imece kurulur`, 'HAFTALIK');
  }
  // Koşullu yazma: davet bu arada reddedilmiş ya da kabul edilmiş olabilir
  if ((await db.run(`UPDATE imece SET durum = 'AKTIF', kabul_at = ? WHERE id = ? AND durum = 'DAVET'`, t, i.id)).changes !== 1) throw new OyunHatasi(404, 'Davet bulunamadı');
  await db.run(`UPDATE imece SET durum = 'RED' WHERE hafta = ? AND durum = 'DAVET' AND id <> ? AND (a_id IN (?, ?) OR b_id IN (?, ?))`, h, i.id, i.a_id, i.b_id, i.a_id, i.b_id);
  const ben = await q.kullanici.get(userId);
  if (!ben.is_npc) await bildir(i.a_id, `🤝 ${ben.ad} imece davetini kabul etti`);
  return { tamam: true, id: i.id };
}
const kabul = (userId, id) => db.tx(() => kabulEt(userId, id));
const reddet = (userId, id) => db.tx(async () => {
  const i = await q.imece.get(Number(id));
  if (!i || i.b_id !== userId || i.durum !== 'DAVET') throw new OyunHatasi(404, 'Davet bulunamadı');
  if ((await db.run(`UPDATE imece SET durum = 'RED' WHERE id = ? AND durum = 'DAVET'`, i.id)).changes !== 1) throw new OyunHatasi(404, 'Davet bulunamadı');
  return { tamam: true };
});
// Ortaklığı bırak: alınmış ödüller kalır; aynı hafta (sınır dahilinde) yeni ortak aranabilir
const birak = (userId) => db.tx(async () => {
  const i = await q.aktif.get(haftaNo(), userId, userId);
  if (!i) throw new OyunHatasi(404, 'Bu hafta imecen yok');
  if ((await db.run(`UPDATE imece SET durum = 'BITTI' WHERE id = ? AND durum = 'AKTIF'`, i.id)).changes !== 1) throw new OyunHatasi(404, 'Bu hafta imecen yok');
  const o = ortakId(i, userId);
  if (!(await q.kullanici.get(o))?.is_npc) await bildir(o, `🤝 ${(await q.kullanici.get(userId)).ad} imeceden ayrıldı; yeni bir komşuyla imece kurabilirsin`);
  return { tamam: true };
});

async function durumu(userId, t = Date.now()) {
  const h = haftaNo(t), i = await q.aktif.get(h, userId, userId);
  let aktif = null;
  if (i) {
    const o = await q.kullanici.get(ortakId(i, userId)), toplam = i.puan_a + i.puan_b;
    const alinan = new Set((await db.all('SELECT kademe FROM imece_odul WHERE imece_id = ? AND user_id = ?', i.id, userId)).map((r) => r.kademe));
    aktif = {
      id: i.id, ortak: { id: o.id, ad: o.ad, demo: !!o.is_npc }, toplam, katkim: katkisi(i, userId), ortakKatki: katkisi(i, o.id),
      kademeler: I.kademeler.map((k, n) => ({ esik: k.esik, akce: k.akce, esya: k.esya ? { ikon: URUNLER[k.esya[0]].ikon, ad: URUNLER[k.esya[0]].ad, adet: k.esya[1] } : null,
        gecildi: toplam >= k.esik, alindi: alinan.has(n + 1) })),
    };
  }
  const arkadaslar = [];
  if (!i) {
    for (const a of await db.all(`SELECT u.id, u.display_name AS ad, u.is_npc AS demo FROM arkadasliklar a
      JOIN users u ON u.id = CASE WHEN a.isteyen = ? THEN a.hedef ELSE a.isteyen END
      WHERE a.durum = 'KABUL' AND (a.isteyen = ? OR a.hedef = ?) ORDER BY u.is_npc, u.display_name LIMIT 30`, userId, userId, userId)) {
      if (a.demo || !await q.aktif.get(h, a.id, a.id)) arkadaslar.push({ ...a, demo: !!a.demo });
    }
  }
  return {
    hafta: h, bitis: haftaBitis(h), kalanMs: haftaBitis(h) - t, aktif,
    gelen: await q.gelen.all(h, userId, t - I.davetSuresiMs), giden: (await q.giden.all(h, userId, t - I.davetSuresiMs))[0] || null,
    adaylar: arkadaslar, kalanOrtaklik: Math.max(0, I.haftalikOrtak - (await q.kurulan.get(h, userId, userId)).c), minKatki: I.minKatki,
    kademeler: I.kademeler.map((k) => k.esik),
  };
}

function rotalar(app, { h, auth }) {
  app.get('/api/imece', auth.girisGerekli, h((req) => durumu(req.kullanici.id)));
  app.post('/api/imece/davet', auth.dogrulanmisGerekli, h((req) => davet(req.kullanici.id, req.body?.kullaniciId)));
  app.post('/api/imece/:id/kabul', auth.dogrulanmisGerekli, h((req) => kabul(req.kullanici.id, req.params.id)));
  app.post('/api/imece/:id/reddet', auth.girisGerekli, h((req) => reddet(req.kullanici.id, req.params.id)));
  app.post('/api/imece/birak', auth.girisGerekli, h((req) => birak(req.kullanici.id)));
}

module.exports = { rotalar, durumu, davet, kabul, reddet, birak, puanVer, haftaNo };
