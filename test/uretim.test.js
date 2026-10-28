// Üretim zinciri, meslekler, kooperatifler, simge parseller ve koleksiyon albümü.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { ortamKur, istemciUret, hucreBul } = require('./yardimci');

const VERI = ortamKur('uretim');
const app = require('../server/index');
const db = require('../server/db');
const L = require('../server/lib/ledger');
const { RECETELER, MESLEKLER, KOOPERATIF } = require('../server/config/rules');
const simge = require('../server/simge');

let sunucu, taban;
before(async () => {
  await new Promise((r) => { sunucu = app.listen(0, r); });
  taban = `http://127.0.0.1:${sunucu.address().port}`;
  await app.hazir;
});
after(() => { sunucu.close(); fs.rmSync(VERI, { recursive: true, force: true }); });

const istemci = istemciUret(() => taban);
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
async function oyuncu(ad) {
  const c = istemci();
  assert.equal((await c('/api/kayit', { email: `${ad}@test.local`, sifre: 'parola123', dogumYili: 1990, kosullarOnay: true, kvkkOnay: true, ad })).durum, 201);
  c.id = (await c('/api/ben')).veri.kullanici.id;
  await c('/api/ben');
  return c;
}
const urunVer = (userId, urun, adet) => db.transaction(() => L.envanterDegis(userId, urun, adet, 'Test stoku'))();
const tesisKur = (parsel, userId, tip) => { const t = Date.now(); db.prepare(`INSERT INTO structures (parcel_id, owner_user_id, type, status, started_at, completes_at, completed_at) VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?)`).run(parsel, userId, tip, t, t, t); };

test('meslek: seçim, haftalık değişim sınırı, deneyim ve seviye bonusu', async () => {
  const c = await oyuncu('ciftci');
  assert.equal((await c('/api/meslek', { meslek: 'YOK' })).durum, 400);
  assert.equal((await c('/api/meslek', { meslek: 'CIFTCI' })).durum, 200);
  assert.equal((await c('/api/meslek', { meslek: 'TUCCAR' })).durum, 409);
  const h = hucreBul('TARIM');
  await c(`/api/parsel/${h}/edin`, {});
  await c(`/api/parsel/${h}/ek`, { urun: 'BUGDAY' });
  db.prepare(`UPDATE crops SET ready_at = ?, waterings = 2 WHERE parcel_id = ?`).run(Date.now() - 1, h);
  assert.equal((await c(`/api/parsel/${h}/hasat`, {})).durum, 200);
  await bekle(20);
  const m = (await c('/api/meslek')).veri;
  assert.equal(m.meslek, 'CIFTCI');
  assert.equal(m.xp, 1);
  assert.equal(m.bonus, MESLEKLER.CIFTCI.bonus);
  db.prepare(`UPDATE users SET meslek_xp = 90 WHERE id = ?`).run(c.id);
  const m2 = (await c('/api/meslek')).veri;
  assert.equal(m2.seviye, 4);
  assert.equal(m2.bonus, Math.round((MESLEKLER.CIFTCI.bonus + 3 * MESLEKLER.CIFTCI.seviyeBonus) * 1000) / 1000);
});

test('üretim: değirmende buğday una dönüşür; tek parti, süre, enerji; zanaatkâr süreyi kısaltır; mamul ekilmez', async () => {
  const c = await oyuncu('degirmenci');
  const h = hucreBul('TARIM');
  await c(`/api/parsel/${h}/edin`, {});
  assert.equal((await c(`/api/parsel/${h}/uretim`, { recete: 'UN' })).durum, 409, 'değirmen yok');
  tesisKur(h, c.id, 'DEGIRMEN');
  urunVer(c.id, 'BUGDAY', 25);
  const kart = (await c(`/api/parsel/${h}`)).veri;
  assert.equal(kart.uretim.receteler[0].kod, 'UN');
  assert.equal(kart.uretim.receteler[0].girdi[0].stok, 25);
  const bakiye0 = (await c('/api/ben')).veri.bakiye;
  const r = (await c(`/api/parsel/${h}/uretim`, { recete: 'UN', parti: 2 })).veri;
  assert.equal(L.envanterMiktar(c.id, 'BUGDAY'), 5);
  assert.equal((await c('/api/ben')).veri.bakiye, bakiye0 - RECETELER.UN.enerji * 2);
  assert.equal((await c(`/api/parsel/${h}/uretim`, { recete: 'UN' })).durum, 409, 'tesis meşgul');
  assert.equal((await c(`/api/uretim/${r.id}/topla`, {})).durum, 409, 'henüz bitmedi');
  db.prepare(`UPDATE uretimler SET bitis = ? WHERE id = ?`).run(Date.now() - 1, r.id);
  const t = (await c(`/api/uretim/${r.id}/topla`, {})).veri;
  assert.equal(t.miktar, RECETELER.UN.cikti * 2);
  assert.equal(L.envanterMiktar(c.id, 'UN'), 12);
  assert.equal((await c(`/api/uretim/${r.id}/topla`, {})).durum, 409);
  assert.equal((await c(`/api/parsel/${h}/ek`, { urun: 'UN' })).durum, 400, 'mamul ekilmez');
  // Zanaatkâr
  await c('/api/meslek', { meslek: 'ZANAATKAR' });
  urunVer(c.id, 'BUGDAY', 10);
  const r2 = (await c(`/api/parsel/${h}/uretim`, { recete: 'UN' })).veri;
  const u = db.prepare(`SELECT * FROM uretimler WHERE id = ?`).get(r2.id);
  assert.equal(u.bitis - u.baslangic, Math.round(RECETELER.UN.sureMs * (1 - MESLEKLER.ZANAATKAR.bonus)));
  // Parsel el değiştirdiyse (ör. Hazine'ye satış) süren üretimi eski sahip toplayamaz
  const yeni = await oyuncu('yenisahip');
  db.prepare(`UPDATE parcels SET owner_user_id = ? WHERE id = ?`).run(yeni.id, h);
  db.prepare(`UPDATE uretimler SET bitis = ? WHERE id = ?`).run(Date.now() - 1, r2.id);
  assert.equal((await c(`/api/uretim/${r2.id}/topla`, {})).veri.kod, 'DEVREDILDI');
});

test('tüccar mesleği borsa ücretini düşürür', async () => {
  const s = await oyuncu('tuccar'), a = await oyuncu('musteri');
  await s('/api/meslek', { meslek: 'TUCCAR' });
  urunVer(s.id, 'ELMA', 100);
  await s('/api/borsa/emir', { urun: 'ELMA', yon: 'SAT', fiyat: 2, miktar: 50 });
  await a('/api/borsa/emir', { urun: 'ELMA', yon: 'AL', fiyat: 2, miktar: 50 });
  const islem = db.prepare(`SELECT ucret FROM urun_islemleri ORDER BY id DESC LIMIT 1`).get();
  assert.equal(islem.ucret, Math.round(100 * 0.02 * (1 - MESLEKLER.TUCCAR.bonus) * 100) / 100);
});

test('kooperatif: kuruluş, katılım, aidat, eşit dağıtım, satış primi, başkan devri', async () => {
  const [a, b, c] = [await oyuncu('koopa'), await oyuncu('koopb'), await oyuncu('koopc')];
  for (const x of [a, b, c]) await x(`/api/parsel/${hucreBul('TARIM')}/edin`, {});
  const ilId = db.prepare(`SELECT id FROM regions WHERE type = 'IL' AND plaka = '42'`).get().id;
  const bakiye0 = (await a('/api/ben')).veri.bakiye;
  const k = (await a('/api/kooperatif', { ilId, ad: 'Meram Üreticileri', aciklama: 'Birlikte daha güçlüyüz' })).veri;
  assert.equal((await a('/api/ben')).veri.bakiye, bakiye0 - KOOPERATIF.kurulusBedeli);
  assert.equal((await b('/api/kooperatif', { ilId, ad: 'meram üreticileri' })).durum, 409, 'aynı ad');
  assert.equal((await b(`/api/kooperatif/${k.id}/katil`, {})).durum, 200);
  assert.equal((await b(`/api/kooperatif/${k.id}/katil`, {})).durum, 409);
  // 2 üyede prim yok
  urunVer(a.id, 'BUGDAY', 10);
  const s1 = (await a('/api/pazar/sat', { urun: 'BUGDAY', miktar: 5 })).veri;
  assert.equal(s1.koopPrimi, 0);
  await c(`/api/kooperatif/${k.id}/katil`, {});
  const s2 = (await a('/api/pazar/sat', { urun: 'BUGDAY', miktar: 5 })).veri;
  assert.equal(s2.koopPrimi, KOOPERATIF.satisPrimi);
  await b('/api/kooperatif/aidat', { tutar: 30 });
  await c('/api/kooperatif/aidat', { tutar: 30 });
  assert.equal((await b('/api/kooperatif/dagit', {})).durum, 403, 'yalnızca başkan dağıtır');
  const bB = (await b('/api/ben')).veri.bakiye;
  const d = (await a('/api/kooperatif/dagit', {})).veri;
  assert.equal(d.pay, 20);
  assert.equal((await b('/api/ben')).veri.bakiye, bB + 20);
  const detay = (await b(`/api/kooperatif/${k.id}`)).veri;
  assert.equal(detay.uyeler.length, 3);
  assert.ok(detay.hareketler.length >= 3, 'üye kasa hareketlerini görür');
  assert.equal((await istemci()(`/api/kooperatif/${k.id}`)).veri.hareketler, null, 'dışarıdan görünmez');
  assert.equal((await a('/api/kooperatif/ayril', {})).durum, 200);
  assert.equal((await b(`/api/kooperatif/${k.id}`)).veri.uyeler.find((u) => u.baskan).ad, 'koopb', 'en kıdemli üye başkan olur');
});

test('simge parsel edinilemez; kart toplanır, ödül ve bölge rozeti verilir', async () => {
  const c = await oyuncu('gezgin');
  const ani = simge.SIMGELER.find((s) => s.kod === 'ANI');
  const r = await c(`/api/parsel/${ani.parsel}/edin`, {});
  assert.equal(r.veri.kod, 'SIMGE');
  const kart = (await c(`/api/parsel/${ani.parsel}`)).veri;
  assert.equal(kart.simge.ad, 'Ani Harabeleri');
  assert.equal(kart.simge.toplandi, false);
  const bakiye0 = (await c('/api/ben')).veri.bakiye;
  // Kart yalnızca simgenin parsel kartı açıldıktan sonra toplanır
  assert.equal((await c('/api/simge/ISHAKPASA/topla', {})).veri.kod, 'GORULMEDI');
  const gez = (kod) => c(`/api/parsel/${simge.SIMGELER.find((s) => s.kod === kod).parsel}`);
  for (const kod of ['ANI', 'ISHAKPASA']) { await gez(kod); assert.equal((await c(`/api/simge/${kod}/topla`, {})).durum, 200); }
  assert.equal((await c('/api/simge/ANI/topla', {})).durum, 409);
  await gez('AKDAMAR');
  const son = (await c('/api/simge/AKDAMAR/topla', {})).veri;
  assert.deepEqual(son.rozetler, ['Doğu Anadolu gezgini']);
  assert.equal((await c('/api/ben')).veri.bakiye, bakiye0 + 30);
  const album = (await c('/api/album')).veri;
  assert.equal(album.toplanan, 3);
  assert.equal(album.bolgeler.find((b) => b.ad === 'Doğu Anadolu').toplanan, 3);
  for (const kod of ['NEMRUT', 'GOBEKLITEPE', 'ZEUGMA', 'MARDIN']) await gez(kod);
  for (const kod of ['NEMRUT', 'GOBEKLITEPE', 'ZEUGMA']) await c(`/api/simge/${kod}/topla`, {});
  assert.equal((await c('/api/simge/MARDIN/topla', {})).durum, 429, 'günlük sınır');
  assert.equal((await c('/api/simgeler')).veri.features.length, simge.SIMGELER.length);
});

test('v0.44 zincirler: arı kovanı bal verir; zeytin sıkma evi tarım arazisinde zeytinyağı yapar; lokma fırında baldan', async () => {
  const { HAYVANLAR, YAPILAR } = require('../server/config/rules');
  assert.ok(YAPILAR.ZEYTIN_SIKMA.izin.includes('TARIM') && YAPILAR.CAY_ATOLYESI.izin.includes('TARIM'));
  const c = await oyuncu('arici');
  const h = hucreBul('TARIM');
  await c(`/api/parsel/${h}/edin`, {});
  // Arı kovanı: yemlenince (şerbet) belli sürede bal
  tesisKur(h, c.id, 'ARI_KOVANI');
  let kart = (await c(`/api/parsel/${h}`)).veri;
  const kovan = kart.yapilar.find((y) => y.tip === 'ARI_KOVANI');
  assert.equal(kovan.hayvan.durum, 'AC');
  assert.equal((await c(`/api/yapi/${kovan.id}/besle`, {})).durum, 200);
  db.prepare(`UPDATE hayvan_bakim SET hazir_at = ? WHERE structure_id = ?`).run(Date.now() - 1, kovan.id);
  const t = await c(`/api/yapi/${kovan.id}/topla`, {});
  assert.equal(t.durum, 200, JSON.stringify(t.veri));
  assert.equal(L.envanterMiktar(c.id, 'BAL'), HAYVANLAR.ARI_KOVANI.miktar);
  // Zeytin sıkma evi: fabrika olmadan zeytinyağı
  tesisKur(h, c.id, 'ZEYTIN_SIKMA');
  urunVer(c.id, 'ZEYTIN', 8);
  const u = await c(`/api/parsel/${h}/uretim`, { recete: 'ZEYTINYAGI' });
  assert.equal(u.durum, 200, JSON.stringify(u.veri));
  kart = (await c(`/api/parsel/${h}`)).veri;
  assert.equal(kart.uretim.surenler[0].tesis, 'ZEYTIN_SIKMA');
  assert.ok(kart.uretim.receteler.some((r) => r.kod === 'ZEYTINYAGI' && r.tesis === 'ZEYTIN_SIKMA'));
  // Lokma: fırın + un + bal
  tesisKur(h, c.id, 'FIRIN');
  urunVer(c.id, 'UN', 3);
  assert.equal((await c(`/api/parsel/${h}/uretim`, { recete: 'LOKMA' })).durum, 200);
  assert.equal(L.envanterMiktar(c.id, 'BAL'), HAYVANLAR.ARI_KOVANI.miktar - 2);
});
