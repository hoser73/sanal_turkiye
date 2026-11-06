// Kooperatifler (§7.5): aynı ilde parseli olan oyuncular birlikte üretir ve satar. Ortak kasa (KOOP:<id>) şeffaftır;
// üye aidat yatırır, başkan kasayı üyelere eşit dağıtır. Aktif (3+ üyeli) kooperatif üyeleri tüccara satışta fiyat primi
// ve küçük bir hasat primi alır. Bir oyuncu aynı anda tek kooperatife üye olabilir.
const db = require('./db');
const { tl } = require('./lib/para');
const L = require('./lib/ledger');
const { KOOPERATIF } = require('./config/rules');
const { icerikDenetle } = require('./lib/icerik');
const { OyunHatasi } = L;

const simdi = () => Date.now();
const kasa = (id) => `KOOP:${id}`;
const bildir = (userId, metin, link) => require('./pazar').bildir(userId, metin, link);

const q = {
  koop: db.prepare(`SELECT k.*, r.name AS il, r.plaka FROM kooperatifler k JOIN regions r ON r.id = k.il_id WHERE k.id = ?`),
  uyelik: db.prepare(`SELECT k.* FROM kooperatif_uyeleri u JOIN kooperatifler k ON k.id = u.koop_id WHERE u.user_id = ? AND k.durum = 'AKTIF'`),
  uyeSayisi: db.prepare(`SELECT COUNT(*) c FROM kooperatif_uyeleri WHERE koop_id = ?`),
  uyeler: db.prepare(`SELECT u.user_id, u.katilim, x.display_name AS ad FROM kooperatif_uyeleri u JOIN users x ON x.id = u.user_id WHERE u.koop_id = ? ORDER BY u.katilim`),
  ilSakini: db.prepare(`SELECT 1 FROM parcels WHERE il_id = ? AND owner_user_id = ? LIMIT 1`),
};

function aktifMi(koopId) { return q.uyeSayisi.get(koopId).c >= KOOPERATIF.minAktifUye; }
function satisPrimi(userId) {
  const k = userId && q.uyelik.get(userId);
  return k && aktifMi(k.id) ? KOOPERATIF.satisPrimi : 0;
}
const hasatPrimi = (userId) => (satisPrimi(userId) ? 0.03 : 0);

const kur = db.transaction((userId, govde = {}) => {
  if (q.uyelik.get(userId)) throw new OyunHatasi(409, 'Zaten bir kooperatife üyesin');
  const ilId = Number(govde.ilId);
  const il = db.prepare(`SELECT id, name FROM regions WHERE id = ? AND type = 'IL'`).get(ilId);
  if (!il) throw new OyunHatasi(400, 'Geçersiz il');
  if (!q.ilSakini.get(ilId, userId)) throw new OyunHatasi(403, `${il.name} ilinde parselin olmalı`);
  const ad = typeof govde.ad === 'string' ? govde.ad.trim() : '';
  if (ad.length < KOOPERATIF.adMin || ad.length > KOOPERATIF.adMax || !/^[\p{L}\p{N} .'’-]+$/u.test(ad)) throw new OyunHatasi(400, `Ad ${KOOPERATIF.adMin}–${KOOPERATIF.adMax} karakter olmalı`);
  const aciklama = typeof govde.aciklama === 'string' ? govde.aciklama.trim().slice(0, 300) : null;
  for (const m of [ad, aciklama || '']) if (icerikDenetle(m).karar !== 'TEMIZ') throw new OyunHatasi(422, 'Ad ya da açıklama uygun değil');
  const kucuk = (x) => x.toLocaleLowerCase('tr-TR');
  if (db.prepare(`SELECT ad FROM kooperatifler WHERE il_id = ? AND durum = 'AKTIF'`).all(ilId).some((x) => kucuk(x.ad) === kucuk(ad))) {
    throw new OyunHatasi(409, 'Bu ilde aynı adlı kooperatif var');
  }
  const t = simdi();
  L.harca(userId, KOOPERATIF.kurulusBedeli, `Kooperatif kuruluşu: ${ad}`);
  let id;
  try { id = db.prepare(`INSERT INTO kooperatifler (il_id, ad, aciklama, baskan_id, created_at) VALUES (?, ?, ?, ?, ?)`).run(ilId, ad, aciklama, userId, t).lastInsertRowid; } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new OyunHatasi(409, 'Bu ad bu ilde daha önce kullanıldı');
    throw e;
  }
  db.prepare(`INSERT INTO kooperatif_uyeleri (koop_id, user_id, katilim) VALUES (?, ?, ?)`).run(id, userId, t);
  L.denetim({ aktor: userId, eylem: 'COOP_FOUNDED', varlik: `KOOP:${id}`, bolge: ilId, herkese: true, sonra: { ad } });
  return { tamam: true, id };
});

const katil = db.transaction((userId, koopId) => {
  const k = q.koop.get(Number(koopId));
  if (!k || k.durum !== 'AKTIF') throw new OyunHatasi(404, 'Kooperatif bulunamadı');
  if (q.uyelik.get(userId)) throw new OyunHatasi(409, 'Zaten bir kooperatife üyesin');
  if (!q.ilSakini.get(k.il_id, userId)) throw new OyunHatasi(403, `${k.il} ilinde parselin olmalı`);
  if (q.uyeSayisi.get(k.id).c >= KOOPERATIF.maxUye) throw new OyunHatasi(409, 'Kooperatif dolu');
  db.prepare(`INSERT INTO kooperatif_uyeleri (koop_id, user_id, katilim) VALUES (?, ?, ?)`).run(k.id, userId, simdi());
  L.denetim({ aktor: userId, eylem: 'COOP_JOINED', varlik: `KOOP:${k.id}`, bolge: k.il_id, herkese: true, sonra: { ad: k.ad } });
  bildir(k.baskan_id, `Kooperatifinize yeni üye katıldı (${q.uyeSayisi.get(k.id).c}/${KOOPERATIF.maxUye}).`, null);
  return { tamam: true };
});

const ayril = db.transaction((userId) => {
  const k = q.uyelik.get(userId);
  if (!k) throw new OyunHatasi(409, 'Bir kooperatife üye değilsin');
  db.prepare(`DELETE FROM kooperatif_uyeleri WHERE koop_id = ? AND user_id = ?`).run(k.id, userId);
  const kalan = q.uyeler.all(k.id);
  if (!kalan.length) {
    // Son üye ayrılırsa kasa ona iade edilir ve kooperatif kapanır
    const b = L.hesapBakiye(kasa(k.id));
    if (b > 0) L.aktar({ kaynak: kasa(k.id), hedef: L.hesap(userId), tutar: b, sebep: `Kooperatif tasfiyesi: ${k.ad}` });
    db.prepare(`UPDATE kooperatifler SET durum = 'KAPANDI' WHERE id = ?`).run(k.id);
  } else if (k.baskan_id === userId) {
    db.prepare(`UPDATE kooperatifler SET baskan_id = ? WHERE id = ?`).run(kalan[0].user_id, k.id);   // en kıdemli üye başkan olur
    bildir(kalan[0].user_id, `${k.ad} kooperatifinin yeni başkanı sensin.`, null);
  }
  L.denetim({ aktor: userId, eylem: 'COOP_LEFT', varlik: `KOOP:${k.id}`, bolge: k.il_id });
  return { tamam: true };
});

const aidat = db.transaction((userId, tutar) => {
  const k = q.uyelik.get(userId);
  if (!k) throw new OyunHatasi(409, 'Bir kooperatife üye değilsin');
  const t = Math.floor(Number(tutar));
  if (!Number.isInteger(t) || t < 1 || t > 100000) throw new OyunHatasi(400, 'Geçersiz tutar');
  L.aktar({ kaynak: L.hesap(userId), hedef: kasa(k.id), tutar: t, sebep: `Kooperatif aidatı: ${k.ad}` });
  L.denetim({ aktor: userId, eylem: 'COOP_DEPOSIT', varlik: `KOOP:${k.id}`, sonra: { tutar: t } });
  return { tamam: true };
});

// Başkan kasayı (ya da bir kısmını) üyelere eşit dağıtır; kalan kuruş kasada kalır
const dagit = db.transaction((userId, tutar) => {
  const k = q.uyelik.get(userId);
  if (!k || k.baskan_id !== userId) throw new OyunHatasi(403, 'Dağıtımı yalnızca kooperatif başkanı yapar');
  const uyeler = q.uyeler.all(k.id);
  const toplam = Math.min(Number(tutar) || L.hesapBakiye(kasa(k.id)), L.hesapBakiye(kasa(k.id)));
  const pay = Math.floor((toplam / uyeler.length) * 100) / 100;
  if (!(pay >= 0.01)) throw new OyunHatasi(409, 'Kasada dağıtılacak tutar yok');
  const tx = L.yeniTx();
  for (const u of uyeler) {
    L.aktar({ kaynak: kasa(k.id), hedef: L.hesap(u.user_id), tutar: pay, sebep: `Kooperatif dağıtımı: ${k.ad}`, tx });
    if (u.user_id !== userId) bildir(u.user_id, `${k.ad} kooperatifi kasasından ${tl(pay)} payın hesabına geçti.`, null);
  }
  L.denetim({ aktor: userId, eylem: 'COOP_DISTRIBUTED', varlik: `KOOP:${k.id}`, sonra: { pay, uye: uyeler.length } });
  return { tamam: true, pay, uye: uyeler.length };
});

function detay(koopId, userId) {
  const k = q.koop.get(Number(koopId));
  if (!k) throw new OyunHatasi(404, 'Kooperatif bulunamadı');
  const uyeler = q.uyeler.all(k.id);
  const uye = !!userId && uyeler.some((u) => u.user_id === userId);
  return {
    id: k.id, ad: k.ad, aciklama: k.aciklama, il: k.il, ilId: k.il_id, durum: k.durum, kurulus: k.created_at,
    uyeler: uyeler.map((u) => ({ ad: u.ad, baskan: u.user_id === k.baskan_id, ben: u.user_id === userId, katilim: u.katilim })),
    aktif: aktifMi(k.id), maxUye: KOOPERATIF.maxUye, minAktifUye: KOOPERATIF.minAktifUye, satisPrimi: KOOPERATIF.satisPrimi,
    kasa: L.hesapBakiye(kasa(k.id)),
    // Kasa hareketleri yalnızca üyelere açıktır
    hareketler: uye ? db.prepare(`SELECT debit, credit, reason, created_at FROM wallet_ledger WHERE account = ? ORDER BY id DESC LIMIT 20`).all(kasa(k.id)) : null,
    ben: userId ? { uye, baskan: k.baskan_id === userId, katilabilir: !uye && !q.uyelik.get(userId) && !!q.ilSakini.get(k.il_id, userId) && uyeler.length < KOOPERATIF.maxUye } : null,
  };
}
function liste(ilId, userId) {
  const benim = userId ? q.uyelik.get(userId) : null;
  const satirlar = db.prepare(`SELECT k.id, k.ad, k.aciklama, r.name AS il, (SELECT COUNT(*) FROM kooperatif_uyeleri u WHERE u.koop_id = k.id) AS uye
                               FROM kooperatifler k JOIN regions r ON r.id = k.il_id WHERE k.durum = 'AKTIF' ${ilId ? 'AND k.il_id = ?' : ''}
                               ORDER BY uye DESC, k.id LIMIT 30`).all(...(ilId ? [Number(ilId)] : []));
  return { benim: benim ? detay(benim.id, userId) : null, kooperatifler: satirlar, kurulusBedeli: KOOPERATIF.kurulusBedeli };
}

function rotalar(app, { h, auth }) {
  app.get('/api/kooperatifler', h((req) => liste(req.query.il, req.kullanici?.id ?? null)));
  app.get('/api/kooperatif/:id', h((req) => detay(req.params.id, req.kullanici?.id ?? null)));
  app.post('/api/kooperatif', auth.dogrulanmisGerekli, h((req) => kur(req.kullanici.id, req.body)));
  app.post('/api/kooperatif/:id/katil', auth.dogrulanmisGerekli, h((req) => katil(req.kullanici.id, req.params.id)));
  app.post('/api/kooperatif/ayril', auth.girisGerekli, h((req) => ayril(req.kullanici.id)));
  app.post('/api/kooperatif/aidat', auth.dogrulanmisGerekli, h((req) => aidat(req.kullanici.id, req.body?.tutar)));
  app.post('/api/kooperatif/dagit', auth.dogrulanmisGerekli, h((req) => dagit(req.kullanici.id, req.body?.tutar)));
}

module.exports = { rotalar, satisPrimi, hasatPrimi, kur, katil, ayril, aidat, dagit, detay, liste };
