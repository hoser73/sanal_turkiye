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
  assert.equal((await A.c(`/api/yapi/${y.id}/yukselt`, {})).durum, 200);
  assert.equal((await A.c(`/api/yapi/${y.id}/yukselt`, {})).durum, 409, 'en üst seviye');
  kart = (await A.c(`/api/parsel/${p}`)).veri;
  const h = kart.yapilar.find((x) => x.tip === 'KUMES').hayvan;
  assert.equal(h.miktar, HAYVANLAR.KUMES.miktar + Math.ceil(HAYVANLAR.KUMES.miktar / 2) * 2);
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
