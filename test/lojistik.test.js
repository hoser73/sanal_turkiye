// Liman/lojistik, kiralama ve ortaklık, hava kaynaklı afetler, referandum.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { ortamKur, istemciUret, hucreBul } = require('./yardimci');

const VERI = ortamKur('lojistik');
const app = require('../server/index');
const db = require('../server/db');
const L = require('../server/lib/ledger');
const I = require('../server/harita/izgara');
const { KIRA, LOJISTIK, AFET, BAKIM, REFERANDUM } = require('../server/config/rules');
const { sahteImar, KOD_AD } = require('../server/harita/imar');

let sunucu, taban;
before(async () => {
  await new Promise((r) => { sunucu = app.listen(0, r); });
  taban = `http://127.0.0.1:${sunucu.address().port}`;
  await app.hazir;
});
after(() => { sunucu.close(); fs.rmSync(VERI, { recursive: true, force: true }); });

const istemci = istemciUret(() => taban);
async function oyuncu(ad) {
  const c = istemci();
  assert.equal((await c('/api/kayit', { email: `${ad}@test.local`, sifre: 'parola123', dogumYili: 1990, kosullarOnay: true, kvkkOnay: true, ad })).durum, 201);
  c.id = (await c('/api/ben')).veri.kullanici.id;
  await c('/api/ben');
  return c;
}
const urunVer = (userId, urun, adet) => db.transaction(() => L.envanterDegis(userId, urun, adet, 'Test stoku'))();
const akceVer = (userId, tutar) => db.transaction(() => L.odul(userId, tutar, 'Test hibesi'))();
// Aynı mahallede tarım hücreleri
function mahalleHucreleri([lon, lat]) {
  const c = I.hucre(lon, lat);
  const kx = c.x >> 6, ky = c.y >> 6;
  const liste = [];
  for (let dy = -14; dy <= 14; dy++) for (let dx = -14; dx <= 14; dx++) {
    const x = kx * 64 + 32 + dx, y = ky * 64 + 32 + dy;
    if (KOD_AD[sahteImar(x, y)] === 'TARIM') liste.push(I.parselId(x, y));
  }
  return liste;
}

test('lojistik: teklif formülü, liman şartı, gönderim, varışta il talebine satış, fırtına gecikmesi', async () => {
  const c = await oyuncu('nakliyeci');
  await c(`/api/parsel/${hucreBul('TARIM')}/edin`, {});   // Konya
  urunVer(c.id, 'BUGDAY', 100);
  assert.equal((await c('/api/lojistik/teklif?urun=BUGDAY&miktar=10&kaynak=42&hedef=34&mod=DENIZ')).durum, 422, 'Konya liman değil');
  const t = (await c('/api/lojistik/teklif?urun=BUGDAY&miktar=50&kaynak=42&hedef=34&mod=KARA')).veri;
  assert.ok(t.km > 450 && t.km < 750);
  assert.equal(t.maliyet, Math.round((LOJISTIK.modlar.KARA.sabit + t.km * LOJISTIK.modlar.KARA.kmUcret * 50) * 100) / 100);
  assert.ok(t.ilKati > 1, 'İstanbul tüketim primi');
  assert.equal((await c('/api/sevkiyat', { urun: 'BUGDAY', miktar: 50, kaynak: '06', hedef: '34', mod: 'KARA' })).durum, 403, 'Ankara’da parsel yok');
  const bakiye0 = (await c('/api/ben')).veri.bakiye;
  const s = (await c('/api/sevkiyat', { urun: 'BUGDAY', miktar: 50, kaynak: '42', hedef: '34', mod: 'KARA' })).veri;
  assert.equal(L.envanterMiktar(c.id, 'BUGDAY'), 50);
  assert.equal((await c('/api/ben')).veri.bakiye, Math.round((bakiye0 - s.maliyet) * 100) / 100);
  db.prepare(`UPDATE sevkiyatlar SET varis = ? WHERE id = ?`).run(Date.now() - 1, s.id);
  await c('/api/lojistik');
  const teslim = db.prepare(`SELECT * FROM sevkiyatlar WHERE id = ?`).get(s.id);
  assert.equal(teslim.durum, 'TESLIM');
  assert.ok(teslim.gelir > 50, 'İstanbul fiyatı tabanın üstünde');
  assert.equal(db.prepare(`SELECT satilan FROM il_talep WHERE plaka = '34' AND urun = 'BUGDAY'`).get().satilan, 50);
  // Yöresel ürün: uzak ilde pahalı, kendi bölgesinde ucuz
  const lj = require('../server/lojistik');
  assert.ok(lj.ilKati('FINDIK', '06') > lj.ilKati('FINDIK', '61'));
  // Deniz: fırtınada gecikme (iki liman ili arasında, kaynak ilde parsel)
  const g = await oyuncu('gemici');
  await g(`/api/parsel/${hucreBul('TARIM', [27.3, 38.5])}/edin`, {});   // İzmir (35)
  urunVer(g.id, 'ELMA', 30);
  const d = (await g('/api/sevkiyat', { urun: 'ELMA', miktar: 30, kaynak: '35', hedef: '34', mod: 'DENIZ' })).veri;
  db.prepare(`INSERT OR REPLACE INTO hava_durumu (plaka, sicaklik, yagis, kod, ruzgar, gunduz, guncellendi) VALUES ('34', 12, 0, 3, 75, 1, ?)`).run(Date.now());
  db.prepare(`UPDATE sevkiyatlar SET varis = ? WHERE id = ?`).run(Date.now() - 1, d.id);
  await g('/api/lojistik');
  const dd = db.prepare(`SELECT * FROM sevkiyatlar WHERE id = ?`).get(d.id);
  assert.equal(dd.durum, 'YOLDA');
  assert.equal(dd.notlar, 'fırtına gecikmesi');
});

test('kiralama: bedel peşin, kullanım hakkı kiracıda, kirada satış yok; süre bitince sahibe döner', async () => {
  const sahip = await oyuncu('arsasahibi'), kiraci = await oyuncu('kiraci');
  const h = hucreBul('TARIM');
  await sahip(`/api/parsel/${h}/edin`, {});
  const k = (await sahip(`/api/parsel/${h}/kira`, { gunluk: 10, gun: 3 })).veri;
  assert.ok((await kiraci('/api/kiraliklar')).veri.some((x) => x.id === k.id));
  const bS = (await sahip('/api/ben')).veri.bakiye, bK = (await kiraci('/api/ben')).veri.bakiye;
  assert.equal((await kiraci(`/api/kira/${k.id}/kirala`, {})).durum, 200);
  assert.equal((await kiraci('/api/ben')).veri.bakiye, bK - 30);
  assert.equal((await sahip('/api/ben')).veri.bakiye, bS + 30 - Math.max(1, Math.floor(30 * KIRA.ucretOrani)));
  assert.equal((await sahip(`/api/parsel/${h}/ek`, { urun: 'BUGDAY' })).durum, 403, 'sahip kirada ekemez');
  assert.equal((await sahip(`/api/parsel/${h}/ilan`, { fiyat: 500, gun: 3 })).durum, 409);
  assert.equal((await kiraci(`/api/parsel/${h}/ek`, { urun: 'BUGDAY' })).durum, 200);
  assert.equal((await kiraci(`/api/parsel/${h}`)).veri.kullanimHakkim, true);
  db.prepare(`UPDATE crops SET ready_at = ?, waterings = 2 WHERE parcel_id = ? AND status = 'GROWING'`).run(Date.now() - 1, h);
  const r = (await kiraci(`/api/parsel/${h}/hasat`, {})).veri;
  assert.ok(L.envanterMiktar(kiraci.id, 'BUGDAY') === r.miktar && r.miktar > 0);
  db.prepare(`UPDATE kiralar SET bitis = ? WHERE id = ?`).run(Date.now() - 1, k.id);
  await sahip('/api/ben');
  assert.equal((await kiraci(`/api/parsel/${h}/ek`, { urun: 'BUGDAY' })).durum, 403, 'kira bitti');
  assert.equal((await sahip(`/api/parsel/${h}/ek`, { urun: 'BUGDAY' })).durum, 200);
});

test('ortaklık: davet, kabul, hasat paylaşımı; toplam pay sınırı', async () => {
  const s = await oyuncu('ciftlik'), o = await oyuncu('ortakoyuncu'), o2 = await oyuncu('ikinciortak');
  const h = hucreBul('TARIM');
  await s(`/api/parsel/${h}/edin`, {});
  const d = (await s(`/api/parsel/${h}/ortak`, { ortakAd: 'ortakoyuncu', pay: 0.3 })).veri;
  assert.equal((await s(`/api/parsel/${h}/ortak`, { ortakAd: 'ikinciortak', pay: 0.25 })).durum, 409, 'toplam %50 sınırı');
  assert.equal((await o2(`/api/ortak/${d.id}/yanit`, { kabul: true })).durum, 404, 'başkasının daveti');
  assert.equal((await o(`/api/ortak/${d.id}/yanit`, { kabul: true })).durum, 200);
  await s(`/api/parsel/${h}/ek`, { urun: 'BUGDAY' });
  db.prepare(`UPDATE crops SET ready_at = ?, waterings = 2 WHERE parcel_id = ? AND status = 'GROWING'`).run(Date.now() - 1, h);
  const r = (await s(`/api/parsel/${h}/hasat`, {})).veri;
  const ortakPayi = Math.floor(r.toplam * 0.3);
  assert.equal(L.envanterMiktar(o.id, 'BUGDAY'), ortakPayi);
  assert.equal(r.miktar, r.toplam - ortakPayi);
  assert.equal((await o(`/api/ortak/${d.id}/bitir`, {})).durum, 200);
});

test('afetler: fırtına yapıları yıpratır, sağanak açık tarlanın verimini düşürür (sera korur), aynı afet 12 saatte bir', async () => {
  const c = await oyuncu('afetzede');
  const [h1, h2] = mahalleHucreleri([33.6, 39.2]);
  for (const h of [h1, h2]) { await c(`/api/parsel/${h}/edin`, {}); await c(`/api/parsel/${h}/ek`, { urun: 'BUGDAY' }); }
  const t = Date.now();
  db.prepare(`INSERT INTO structures (parcel_id, owner_user_id, type, status, started_at, completes_at, completed_at) VALUES (?, ?, 'SERA', 'ACTIVE', ?, ?, ?)`).run(h2, c.id, t, t, t);
  db.prepare(`INSERT INTO structures (parcel_id, owner_user_id, type, status, started_at, completes_at, completed_at) VALUES (?, ?, 'TEL_CIT', 'ACTIVE', ?, ?, ?)`).run(h1, c.id, t, t, t);
  const plaka = db.prepare(`SELECT r.plaka FROM parcels p JOIN regions r ON r.id = p.il_id WHERE p.id = ?`).get(h1).plaka;
  const dunya = require('../server/dunya');
  const r = dunya.uygula({ plaka, sicaklik: 15, yagis: 14, kod: 82, ruzgar: 72, gunduz: 1 });
  assert.deepEqual(r.afetler.sort(), ['FIRTINA', 'SAGANAK']);
  const cit = (await c(`/api/parsel/${h1}`)).veri.yapilar.find((y) => y.tip === 'TEL_CIT');
  assert.equal(cit.saglik, 100 - AFET.FIRTINA.yapiHasari);
  assert.equal(db.prepare(`SELECT afet_kati FROM crops WHERE parcel_id = ? AND status = 'GROWING'`).get(h1).afet_kati, AFET.SAGANAK.verimKati);
  assert.equal(db.prepare(`SELECT afet_kati FROM crops WHERE parcel_id = ? AND status = 'GROWING'`).get(h2).afet_kati, 1, 'sera korur');
  assert.deepEqual(dunya.uygula({ plaka, sicaklik: 15, yagis: 14, kod: 82, ruzgar: 72, gunduz: 1 }).afetler, [], '12 saat içinde tekrar yok');
  assert.ok((await c('/api/bildirimler')).veri.some((b) => /fırtına/i.test(b.text)));
  assert.ok((await c('/api/hava')).veri.afetler.some((a) => a.tur === 'FIRTINA' && a.plaka === plaka));
  void BAKIM;
});

test('referandum: imza eşiği, gizli oy, kütük, sonuç ve nisap', async () => {
  const hucreler = mahalleHucreleri([32.2, 38.4]);
  const [a, b, c] = [await oyuncu('refa'), await oyuncu('refb'), await oyuncu('refc')];
  for (const [i, x] of [a, b, c].entries()) assert.equal((await x(`/api/parsel/${hucreler[i]}/edin`, {})).durum, 200);
  const ilce = db.prepare(`SELECT ilce_id FROM parcels WHERE id = ?`).get(hucreler[0]).ilce_id;
  assert.equal((await a(`/api/belediye/${ilce}/referandum`, { soru: 'kısa?' })).durum, 400);
  const r = (await a(`/api/belediye/${ilce}/referandum`, { soru: 'İlçeye yeni bir semt pazarı kurulmalı mı?', aciklama: 'Ürünlerimizi daha iyi satmak için.' })).veri;
  assert.equal(r.durum, 'IMZA');
  assert.equal(r.esik, Math.max(REFERANDUM.minImza, Math.ceil(3 * REFERANDUM.imzaOrani)));
  assert.equal((await b(`/api/referandum/${r.id}/oy`, { oy: 'EVET' })).durum, 409, 'henüz imza aşaması');
  assert.equal((await b(`/api/referandum/${r.id}/imza`, {})).veri.imza, 2);
  assert.equal(db.prepare(`SELECT durum FROM referandumlar WHERE id = ?`).get(r.id).durum, 'OYLAMA');
  // Oylama açıldıktan sonra gelen sakin oy kullanamaz
  const d = await oyuncu('refd');
  await d(`/api/parsel/${hucreler[3]}/edin`, {});
  assert.equal((await d(`/api/referandum/${r.id}/oy`, { oy: 'HAYIR' })).durum, 403);
  const m = (await a(`/api/referandum/${r.id}/oy`, { oy: 'EVET' })).veri.makbuz;
  assert.equal((await a(`/api/referandum/${r.id}/oy`, { oy: 'HAYIR' })).durum, 409);
  await b(`/api/referandum/${r.id}/oy`, { oy: 'EVET' });
  await c(`/api/referandum/${r.id}/oy`, { oy: 'HAYIR' });
  assert.equal((await istemci()(`/api/referandum/${r.id}/makbuz`, { makbuz: m })).veri.dahil, true);
  const kolonlar = db.prepare(`PRAGMA table_info(referandum_oylari)`).all().map((k) => k.name);
  assert.ok(!kolonlar.includes('user_id'), 'oy tablosunda kimlik yok');
  db.prepare(`UPDATE referandumlar SET oylama_bitis = ? WHERE id = ?`).run(Date.now() - 1, r.id);
  await a('/api/ben');
  const son = db.prepare(`SELECT durum, sonuc_json FROM referandumlar WHERE id = ?`).get(r.id);
  assert.equal(son.durum, 'SONUCLANDI');
  const sonuc = JSON.parse(son.sonuc_json);
  assert.deepEqual(sonuc.oylar, { EVET: 2, HAYIR: 1 });
  assert.equal(sonuc.kazanan, 'EVET');
  assert.equal(sonuc.butunluk, true);
  const bilgi = (await a(`/api/belediye/${ilce}`)).veri;
  assert.equal(bilgi.referandumlar[0].sonuc.kazanan, 'EVET');
});
