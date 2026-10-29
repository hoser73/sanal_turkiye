// Kooperatifler (§7.5): aynı ilde parseli olan oyuncular birlikte üretir ve satar. Ortak kasa (KOOP:<id>) şeffaftır;
// üye aidat yatırır, başkan kasayı üyelere eşit dağıtır. Aktif (3+ üyeli) kooperatif üyeleri tüccara satışta fiyat primi
// ve küçük bir hasat primi alır. Bir oyuncu aynı anda tek kooperatife üye olabilir.
const db = require('./db');
const L = require('./lib/ledger');
const { KOOPERATIF } = require('./config/rules');
const { icerikDenetle } = require('./lib/icerik');
const { OyunHatasi } = L;

const simdi = () => Date.now();
const kasa = (id) => `KOOP:${id}`;
const bildir = (userId, metin, link) => require('./pazar').bildir(userId, metin, link);

const q = {
  koop: db.sorgu(`SELECT k.*, r.name AS il, r.plaka FROM kooperatifler k JOIN regions r ON r.id = k.il_id WHERE k.id = ?`),
  // Üyelik ve kasa değişiklikleri kooperatif satırını işlem sonuna kadar kilitler (üye sınırı, başkanlık, kasa bakiyesi)
  koopKilitle: db.sorgu(`SELECT k.*, r.name AS il, r.plaka FROM kooperatifler k JOIN regions r ON r.id = k.il_id WHERE k.id = ? FOR UPDATE OF k`),
  uyelik: db.sorgu(`SELECT k.* FROM kooperatif_uyeleri u JOIN kooperatifler k ON k.id = u.koop_id WHERE u.user_id = ? AND k.durum = 'AKTIF'`),
  uyeSayisi: db.sorgu(`SELECT COUNT(*) c FROM kooperatif_uyeleri WHERE koop_id = ?`),
  uyeler: db.sorgu(`SELECT u.user_id, u.katilim, x.display_name AS ad FROM kooperatif_uyeleri u JOIN users x ON x.id = u.user_id WHERE u.koop_id = ? ORDER BY u.katilim`),
  ilSakini: db.sorgu(`SELECT 1 FROM parcels WHERE il_id = ? AND owner_user_id = ? LIMIT 1`),
};

async function aktifMi(koopId) { return (await q.uyeSayisi.get(koopId)).c >= KOOPERATIF.minAktifUye; }
async function satisPrimi(userId) {
  const k = userId && await q.uyelik.get(userId);
  return k && await aktifMi(k.id) ? KOOPERATIF.satisPrimi : 0;
}
const hasatPrimi = async (userId) => (await satisPrimi(userId) ? 0.03 : 0);
// Bir oyuncu tek kooperatife üye olabilir: kurma ve katılma oyuncu başına sıraya girer
const uyelikKilidi = (userId) => db.kilit(`koop-uyelik:${userId}`);

const kur = (userId, govde = {}) => db.tx(async () => {
  await uyelikKilidi(userId);
  if (await q.uyelik.get(userId)) throw new OyunHatasi(409, 'Zaten bir kooperatife üyesin');
  const ilId = Number(govde.ilId);
  const il = await db.get(`SELECT id, name FROM regions WHERE id = ? AND type = 'IL'`, ilId);
  if (!il) throw new OyunHatasi(400, 'Geçersiz il');
  if (!await q.ilSakini.get(ilId, userId)) throw new OyunHatasi(403, `${il.name} ilinde parselin olmalı`);
  const ad = typeof govde.ad === 'string' ? govde.ad.trim() : '';
  if (ad.length < KOOPERATIF.adMin || ad.length > KOOPERATIF.adMax || !/^[\p{L}\p{N} .'’-]+$/u.test(ad)) throw new OyunHatasi(400, `Ad ${KOOPERATIF.adMin}–${KOOPERATIF.adMax} karakter olmalı`);
  const aciklama = typeof govde.aciklama === 'string' ? govde.aciklama.trim().slice(0, 300) : null;
  for (const m of [ad, aciklama || '']) if (icerikDenetle(m).karar !== 'TEMIZ') throw new OyunHatasi(422, 'Ad ya da açıklama uygun değil');
  const kucuk = (x) => x.toLocaleLowerCase('tr-TR');
  await db.kilit(`koop-ad:${ilId}`);   // aynı ilde aynı adla eşzamanlı kuruluş olmasın
  if ((await db.all(`SELECT ad FROM kooperatifler WHERE il_id = ? AND durum = 'AKTIF'`, ilId)).some((x) => kucuk(x.ad) === kucuk(ad))) {
    throw new OyunHatasi(409, 'Bu ilde aynı adlı kooperatif var');
  }
  const t = simdi();
  await L.harca(userId, KOOPERATIF.kurulusBedeli, `Kooperatif kuruluşu: ${ad}`);
  // UNIQUE (il_id, ad) çakışması hata yerine 409 olur; işlem (harcama dahil) geri alınır
  const r = await db.run(`INSERT OR IGNORE INTO kooperatifler (il_id, ad, aciklama, baskan_id, created_at) VALUES (?, ?, ?, ?, ?)`, ilId, ad, aciklama, userId, t);
  if (r.changes !== 1) throw new OyunHatasi(409, 'Bu ad bu ilde daha önce kullanıldı');
  const id = r.lastInsertRowid;
  await db.run(`INSERT INTO kooperatif_uyeleri (koop_id, user_id, katilim) VALUES (?, ?, ?)`, id, userId, t);
  await L.denetim({ aktor: userId, eylem: 'COOP_FOUNDED', varlik: `KOOP:${id}`, bolge: ilId, herkese: true, sonra: { ad } });
  return { tamam: true, id };
});

const katil = (userId, koopId) => db.tx(async () => {
  await uyelikKilidi(userId);
  const k = await q.koopKilitle.get(Number(koopId));
  if (!k || k.durum !== 'AKTIF') throw new OyunHatasi(404, 'Kooperatif bulunamadı');
  if (await q.uyelik.get(userId)) throw new OyunHatasi(409, 'Zaten bir kooperatife üyesin');
  if (!await q.ilSakini.get(k.il_id, userId)) throw new OyunHatasi(403, `${k.il} ilinde parselin olmalı`);
  if ((await q.uyeSayisi.get(k.id)).c >= KOOPERATIF.maxUye) throw new OyunHatasi(409, 'Kooperatif dolu');
  await db.run(`INSERT INTO kooperatif_uyeleri (koop_id, user_id, katilim) VALUES (?, ?, ?)`, k.id, userId, simdi());
  await L.denetim({ aktor: userId, eylem: 'COOP_JOINED', varlik: `KOOP:${k.id}`, bolge: k.il_id, herkese: true, sonra: { ad: k.ad } });
  await bildir(k.baskan_id, `Kooperatifinize yeni üye katıldı (${(await q.uyeSayisi.get(k.id)).c}/${KOOPERATIF.maxUye}).`, null);
  return { tamam: true };
});

// Oyuncunun kooperatifini bulup satırını kilitler (kilitten sonra üyelik yeniden doğrulanır)
async function uyelikKilitle(userId) {
  const k0 = await q.uyelik.get(userId);
  if (!k0) return null;
  const k = await q.koopKilitle.get(k0.id);
  if (!k || k.durum !== 'AKTIF' || !await db.get(`SELECT 1 FROM kooperatif_uyeleri WHERE koop_id = ? AND user_id = ?`, k.id, userId)) return null;
  return k;
}

const ayril = (userId) => db.tx(async () => {
  const k = await uyelikKilitle(userId);
  if (!k) throw new OyunHatasi(409, 'Bir kooperatife üye değilsin');
  await db.run(`DELETE FROM kooperatif_uyeleri WHERE koop_id = ? AND user_id = ?`, k.id, userId);
  const kalan = await q.uyeler.all(k.id);
  if (!kalan.length) {
    // Son üye ayrılırsa kasa ona iade edilir ve kooperatif kapanır
    const b = await L.hesapBakiye(kasa(k.id));
    if (b > 0) await L.aktar({ kaynak: kasa(k.id), hedef: L.hesap(userId), tutar: b, sebep: `Kooperatif tasfiyesi: ${k.ad}` });
    await db.run(`UPDATE kooperatifler SET durum = 'KAPANDI' WHERE id = ?`, k.id);
  } else if (k.baskan_id === userId) {
    await db.run(`UPDATE kooperatifler SET baskan_id = ? WHERE id = ?`, kalan[0].user_id, k.id);   // en kıdemli üye başkan olur
    await bildir(kalan[0].user_id, `${k.ad} kooperatifinin yeni başkanı sensin.`, null);
  }
  await L.denetim({ aktor: userId, eylem: 'COOP_LEFT', varlik: `KOOP:${k.id}`, bolge: k.il_id });
  return { tamam: true };
});

const aidat = (userId, tutar) => db.tx(async () => {
  const k = await uyelikKilitle(userId);
  if (!k) throw new OyunHatasi(409, 'Bir kooperatife üye değilsin');
  const t = Math.floor(Number(tutar));
  if (!Number.isInteger(t) || t < 1 || t > 100000) throw new OyunHatasi(400, 'Geçersiz tutar');
  await L.aktar({ kaynak: L.hesap(userId), hedef: kasa(k.id), tutar: t, sebep: `Kooperatif aidatı: ${k.ad}` });
  await L.denetim({ aktor: userId, eylem: 'COOP_DEPOSIT', varlik: `KOOP:${k.id}`, sonra: { tutar: t } });
  return { tamam: true };
});

// Başkan kasayı (ya da bir kısmını) üyelere eşit dağıtır; kalan kuruş kasada kalır
const dagit = (userId, tutar) => db.tx(async () => {
  const k = await uyelikKilitle(userId);   // kasa bakiyesi denetimi ile dağıtım arasına başka çekiş girmesin
  if (!k || k.baskan_id !== userId) throw new OyunHatasi(403, 'Dağıtımı yalnızca kooperatif başkanı yapar');
  const uyeler = await q.uyeler.all(k.id);
  const kasaBakiye = await L.hesapBakiye(kasa(k.id));
  const toplam = Math.min(Number(tutar) || kasaBakiye, kasaBakiye);
  const pay = Math.floor((toplam / uyeler.length) * 100) / 100;
  if (!(pay >= 0.01)) throw new OyunHatasi(409, 'Kasada dağıtılacak tutar yok');
  const tx = L.yeniTx();
  for (const u of uyeler) {
    await L.aktar({ kaynak: kasa(k.id), hedef: L.hesap(u.user_id), tutar: pay, sebep: `Kooperatif dağıtımı: ${k.ad}`, tx });
    if (u.user_id !== userId) await bildir(u.user_id, `${k.ad} kooperatifi kasasından ₳${pay} payın hesabına geçti.`, null);
  }
  await L.denetim({ aktor: userId, eylem: 'COOP_DISTRIBUTED', varlik: `KOOP:${k.id}`, sonra: { pay, uye: uyeler.length } });
  return { tamam: true, pay, uye: uyeler.length };
});

async function detay(koopId, userId) {
  const k = await q.koop.get(Number(koopId));
  if (!k) throw new OyunHatasi(404, 'Kooperatif bulunamadı');
  const uyeler = await q.uyeler.all(k.id);
  const uye = !!userId && uyeler.some((u) => u.user_id === userId);
  const katilabilir = userId && !uye ? !await q.uyelik.get(userId) && !!await q.ilSakini.get(k.il_id, userId) && uyeler.length < KOOPERATIF.maxUye : false;
  return {
    id: k.id, ad: k.ad, aciklama: k.aciklama, il: k.il, ilId: k.il_id, durum: k.durum, kurulus: k.created_at,
    uyeler: uyeler.map((u) => ({ ad: u.ad, baskan: u.user_id === k.baskan_id, ben: u.user_id === userId, katilim: u.katilim })),
    aktif: await aktifMi(k.id), maxUye: KOOPERATIF.maxUye, minAktifUye: KOOPERATIF.minAktifUye, satisPrimi: KOOPERATIF.satisPrimi,
    kasa: await L.hesapBakiye(kasa(k.id)),
    // Kasa hareketleri yalnızca üyelere açıktır
    hareketler: uye ? await db.all(`SELECT debit, credit, reason, created_at FROM wallet_ledger WHERE account = ? ORDER BY id DESC LIMIT 20`, kasa(k.id)) : null,
    ben: userId ? { uye, baskan: k.baskan_id === userId, katilabilir } : null,
  };
}
async function liste(ilId, userId) {
  const benim = userId ? await q.uyelik.get(userId) : null;
  const satirlar = await db.all(`SELECT k.id, k.ad, k.aciklama, r.name AS il, (SELECT COUNT(*) FROM kooperatif_uyeleri u WHERE u.koop_id = k.id) AS uye
                               FROM kooperatifler k JOIN regions r ON r.id = k.il_id WHERE k.durum = 'AKTIF' ${ilId ? 'AND k.il_id = ?' : ''}
                               ORDER BY uye DESC, k.id LIMIT 30`, ...(ilId ? [Number(ilId)] : []));
  return { benim: benim ? await detay(benim.id, userId) : null, kooperatifler: satirlar, kurulusBedeli: KOOPERATIF.kurulusBedeli };
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
