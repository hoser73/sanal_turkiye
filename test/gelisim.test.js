// Çiftlik gelişimi: yapı yükseltme (bedel, üst sınır, barınakta fazla ürün), işçi (tut, otomatik hasat/sulama),
// günlük görevler (ilerleme denetim kayıtlarından, ödül bir kez).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { ortamKur, istemciUret, hucreBul } = require('./yardimci');

const VERI = ortamKur('gelisim');
const app = require('../server/index');
const db = require('../server/db');
const L = require('../server/lib/ledger');
const gelisim = require('../server/gelisim');
const { YAPILAR, HAYVANLAR } = require('../server/config/rules');

let sunucu, taban;
before(async () => {
  await new Promise((r) => { sunucu = app.listen(0, r); });
  taban = `http://127.0.0.1:${sunucu.address().port}`;
  await app.hazir;
});
after(() => { sunucu.close(); fs.rmSync(VERI, { recursive: true, force: true }); });
const istemci = istemciUret(() => taban);
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const kayit = async (ad) => {
  const c = istemci();
  await c('/api/kayit', { email: `${ad}@test.local`, sifre: 'parola123', ad, dogumYili: 1990, kosullarOnay: true, kvkkOnay: true });
  const id = db.prepare(`SELECT id FROM users WHERE email = ?`).get(`${ad}@test.local`).id;
  L.odul(id, 5000, 'test bakiyesi');
  db.prepare(`UPDATE users SET tp = 5000 WHERE id = ?`).run(id);   // seviye kilitleri açık
  return { c, id };
};

test('yapı yükseltme: bedel ödenir, seviye artar, en üstte durur; barınak fazla ürün verir', async () => {
  const A = await kayit('yukselten');
  const p = hucreBul('TARIM');
  assert.equal((await A.c(`/api/parsel/${p}/edin`, {})).durum, 200);
  assert.equal((await A.c(`/api/parsel/${p}/insaat`, { tip: 'KUMES' })).durum, 200);
  await bekle(YAPILAR.KUMES.sureMs + 80);
  let kart = (await A.c(`/api/parsel/${p}`)).veri;
  const y = kart.yapilar.find((x) => x.tip === 'KUMES');
  assert.equal(y.durum, 'ACTIVE'); assert.equal(y.seviye, 1);
  const bakiye = L.bakiye(A.id);
  const r = await A.c(`/api/yapi/${y.id}/yukselt`, {});
  assert.equal(r.durum, 200, JSON.stringify(r.veri));
  assert.equal(r.veri.seviye, 2);
  assert.equal(Math.round(bakiye - L.bakiye(A.id)), Math.round(YAPILAR.KUMES.maliyet * 2 * gelisim.GELISIM.yukseltKat));
  L.odul(A.id, 3000, 'test');
  const maks = gelisim.GELISIM.maxSeviye;
  for (let sv = 3; sv <= maks; sv++) assert.equal((await A.c(`/api/yapi/${y.id}/yukselt`, {})).durum, 200);
  assert.equal((await A.c(`/api/yapi/${y.id}/yukselt`, {})).durum, 409, 'en üst seviye');
  kart = (await A.c(`/api/parsel/${p}`)).veri;
  const ky = kart.yapilar.find((x) => x.tip === 'KUMES');
  assert.equal(ky.maxSeviye, maks);
  assert.equal(ky.hayvan.miktar, HAYVANLAR.KUMES.miktar + Math.ceil(HAYVANLAR.KUMES.miktar / 2) * (maks - 1));
  // Başkası yükseltemez
  const B = await kayit('baskasi');
  assert.notEqual((await B.c(`/api/yapi/${y.id}/yukselt`, {})).durum, 200);
});

test('işçi: tutulur, olgun ekini kendiliğinden hasat eder', async () => {
  const A = await kayit('patron');
  const p = hucreBul('TARIM');
  assert.equal((await A.c(`/api/parsel/${p}/edin`, {})).durum, 200);
  assert.equal((await A.c(`/api/parsel/${p}/ek`, { urun: 'DOMATES' })).durum, 200);
  const r = await A.c('/api/isci/tut', { gun: 2 });
  assert.equal(r.durum, 200);
  assert.equal(r.veri.bedel, gelisim.GELISIM.isciGunluk * 2);
  assert.equal((await A.c('/api/isci')).veri.aktif, true);
  db.prepare(`UPDATE crops SET ready_at = ? WHERE parcel_id = ?`).run(Date.now() - 1000, p);
  gelisim.isciTuru();
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM crops WHERE parcel_id = ? AND status = 'GROWING'`).get(p).c, 0, 'işçi hasat etti');
  assert.ok(L.envanterMiktar(A.id, 'DOMATES') > 0);
});

test('günlük görevler: üç görev, ilerleme sayılır, hepsi bitmeden ödül yok; ödül bir kez', async () => {
  const A = await kayit('gorevci');
  const d = (await A.c('/api/gunluk-gorevler')).veri;
  assert.equal(d.gorevler.length, 3);
  assert.equal(new Set(d.gorevler.map((g) => g.kod)).size, 3);
  assert.equal((await A.c('/api/gunluk-gorevler/odul', {})).durum, 409);
  // Görevleri denetim kayıtlarıyla tamamla (her eylemden yeterince)
  const ESLEME = { HASAT: 'CROP_HARVESTED', EKIM: 'CROP_PLANTED', SULA: 'CROP_WATERED', HAYVAN: 'ANIMAL_PRODUCE_COLLECTED', SATIS: 'TRADE_SETTLED', SIPARIS: 'ORDER_DELIVERED' };
  for (const g of d.gorevler) for (let i = 0; i < g.hedef; i++) L.denetim({ aktor: A.id, eylem: ESLEME[g.kod], varlik: 'test' });
  const d2 = (await A.c('/api/gunluk-gorevler')).veri;
  assert.ok(d2.hepsi, JSON.stringify(d2.gorevler));
  const once = L.bakiye(A.id);
  assert.equal((await A.c('/api/gunluk-gorevler/odul', {})).durum, 200);
  assert.equal(Math.round(L.bakiye(A.id) - once), gelisim.GELISIM.gunlukOdul);
  assert.equal((await A.c('/api/gunluk-gorevler/odul', {})).durum, 409);
});

test('ev ve keyif: bağ evi tarlaya kurulur, kira birikir ve bir kez toplanır; havuz konutta kirayı artırır; peyzaj atölyede yok', async () => {
  const A = await kayit('evci');
  const p = hucreBul('TARIM');
  assert.equal((await A.c(`/api/parsel/${p}/edin`, {})).durum, 200);
  let kart = (await A.c(`/api/parsel/${p}`)).veri;
  assert.ok(!kart.insaatSecenekleri.some((s) => s.tip === 'PEYZAJ'), 'peyzaj gizli');
  assert.ok(!kart.insaatSecenekleri.some((s) => s.tip === 'VILLA'), 'tarlaya villa yapılamaz');
  assert.equal((await A.c(`/api/parsel/${p}/insaat`, { tip: 'BAG_EVI' })).durum, 200);
  await bekle(YAPILAR.BAG_EVI.sureMs + 80);
  kart = (await A.c(`/api/parsel/${p}`)).veri;
  const y = kart.yapilar.find((x) => x.tip === 'BAG_EVI');
  assert.equal(y.durum, 'ACTIVE');
  // Bir gün geçmiş gibi: kira = günlük gelir
  db.prepare(`UPDATE structures SET gelir_at = ? WHERE id = ?`).run(Date.now() - gelisim.KIRA.gunMs, y.id);
  const once = L.bakiye(A.id);
  const r = await A.c(`/api/yapi/${y.id}/kira`, {});
  assert.equal(r.durum, 200, JSON.stringify(r.veri));
  assert.equal(r.veri.tutar, YAPILAR.BAG_EVI.gelir);
  assert.equal(Math.round(L.bakiye(A.id) - once), YAPILAR.BAG_EVI.gelir);
  assert.equal((await A.c(`/api/yapi/${y.id}/kira`, {})).durum, 409, 'hemen ikinci kez toplanmaz');
  // En çok 2 günlük birikir
  db.prepare(`UPDATE structures SET gelir_at = ? WHERE id = ?`).run(Date.now() - 5 * gelisim.KIRA.gunMs, y.id);
  assert.equal((await A.c(`/api/yapi/${y.id}/kira`, {})).veri.tutar, YAPILAR.BAG_EVI.gelir * gelisim.KIRA.birikmeGun);
  // Konut parselinde havuz kirayı %50 artırır
  const k = hucreBul('KONUT');
  assert.equal((await A.c(`/api/parsel/${k}/edin`, {})).durum, 200);
  assert.equal((await A.c(`/api/parsel/${k}/insaat`, { tip: 'EV' })).durum, 200);
  assert.equal((await A.c(`/api/parsel/${k}/insaat`, { tip: 'HAVUZ' })).durum, 200);
  await bekle(Math.max(YAPILAR.EV.sureMs, YAPILAR.HAVUZ.sureMs) + 80);
  const ev = (await A.c(`/api/parsel/${k}`)).veri.yapilar.find((x) => x.tip === 'EV');
  assert.equal(ev.kira.gunluk, Math.round(YAPILAR.EV.gelir * 1.5));
});

test('yükseltme yalnızca etkisi olan yapıda; hedef seviye uyuşmazsa 409; birikmiş kira eski seviyeden ödenir', async () => {
  const A = await kayit('yukseltmekurali');
  const p = hucreBul('TARIM');
  assert.equal((await A.c(`/api/parsel/${p}/edin`, {})).durum, 200);
  const t0 = Date.now();
  const yapi = (tip) => db.prepare(`INSERT INTO structures (parcel_id, owner_user_id, type, status, started_at, completes_at, completed_at) VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?)`).run(p, A.id, tip, t0, t0, t0).lastInsertRowid;
  const cit = yapi('TEL_CIT'), ev = yapi('BAG_EVI');
  const kart = (await A.c(`/api/parsel/${p}`)).veri;
  const kc = kart.yapilar.find((x) => x.id === cit), ke = kart.yapilar.find((x) => x.id === ev);
  assert.equal(kc.yukseltBedeli, null); assert.equal(kc.yukseltEtki, null);
  assert.deepEqual(ke.yukseltEtki, { tur: 'KIRA', simdi: YAPILAR.BAG_EVI.gelir, sonraki: Math.round(YAPILAR.BAG_EVI.gelir * 1.5) });
  const once = L.bakiye(A.id);
  assert.equal((await A.c(`/api/yapi/${cit}/yukselt`, {})).veri.kod, 'YUKSELMEZ');
  assert.equal(L.bakiye(A.id), once, 'etkisiz yapı için para alınmaz');
  // Bir günlük kira birikmiş: yükseltmede eski seviyeden ödenir, sayaç sıfırlanır
  db.prepare(`UPDATE structures SET gelir_at = ? WHERE id = ?`).run(Date.now() - gelisim.KIRA.gunMs, ev);
  const r = await A.c(`/api/yapi/${ev}/yukselt`, { hedef: 2 });
  assert.equal(r.durum, 200, JSON.stringify(r.veri));
  assert.equal(r.veri.kira, YAPILAR.BAG_EVI.gelir);
  assert.equal((await A.c(`/api/yapi/${ev}/kira`, {})).durum, 409, 'geriye dönük artış yok');
  // Çift tıklama: aynı hedefle ikinci istek
  const ikinci = await A.c(`/api/yapi/${ev}/yukselt`, { hedef: 2 });
  assert.equal(ikinci.durum, 409); assert.equal(ikinci.veri.kod, 'SEVIYE_DEGISTI');
  assert.equal(db.prepare(`SELECT seviye FROM structures WHERE id = ?`).get(ev).seviye, 2);
});

test('bakımsız dönemin kirası bakımdan sonra toplanmaz', async () => {
  const A = await kayit('bakimsizev');
  const p = hucreBul('TARIM');
  assert.equal((await A.c(`/api/parsel/${p}/edin`, {})).durum, 200);
  const { BAKIM } = require('../server/config/rules');
  const eski = Date.now() - 30 * BAKIM.gunMs;   // sağlık eşiğin altında
  const ev = db.prepare(`INSERT INTO structures (parcel_id, owner_user_id, type, status, started_at, completes_at, completed_at, bakim_at, gelir_at) VALUES (?, ?, 'BAG_EVI', 'ACTIVE', ?, ?, ?, ?, ?)`)
    .run(p, A.id, eski, eski, eski, eski, Date.now() - 2 * gelisim.KIRA.gunMs).lastInsertRowid;
  assert.equal((await A.c(`/api/yapi/${ev}/kira`, {})).veri.kod, 'BAKIM');
  assert.equal((await A.c(`/api/parsel/${p}/bakim`, {})).durum, 200);
  assert.equal((await A.c(`/api/yapi/${ev}/kira`, {})).veri.kod, 'BOS');
});

test('işçi: geçersiz gün sayısı 400 ve ücret kesilmez', async () => {
  const A = await kayit('iscigun');
  const once = L.bakiye(A.id);
  for (const gun of [-5, 'abc', null, 1.4, 0, 8, { toString: 1 }]) assert.equal((await A.c('/api/isci/tut', { gun })).durum, 400, JSON.stringify(gun));
  assert.equal(L.bakiye(A.id), once);
  assert.equal((await A.c('/api/isci/tut', { gun: 3 })).durum, 200);
});
