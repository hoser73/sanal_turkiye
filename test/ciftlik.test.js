// Çiftlik katmanı: seviye ve TP, seviye kilidi, hayvancılık (yemle → bekle → topla), seviye ve günlük ödüller,
// sipariş panosu (teslim / reddet), çiftlik süsleri (haritada görünür).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { ortamKur, istemciUret, hucreBul } = require('./yardimci');

const VERI = ortamKur('ciftlik');
const app = require('../server/index');
const db = require('../server/db');
const L = require('../server/lib/ledger');
const ciftlik = require('../server/ciftlik');
const { SEVIYE, HAYVANLAR, SUSLER } = require('../server/config/rules');

let sunucu, taban;
before(async () => {
  await new Promise((r) => { sunucu = app.listen(0, r); });
  taban = `http://127.0.0.1:${sunucu.address().port}`;
  await app.hazir;
});
after(() => { sunucu.close(); fs.rmSync(VERI, { recursive: true, force: true }); });
const istemci = istemciUret(() => taban);
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

let c, uid, parsel;
test('kayıt ve tarla: eylemler TP kazandırır', async () => {
  c = istemci();
  assert.equal((await c('/api/kayit', { email: 'ciftci@test.local', sifre: 'parola123', ad: 'Çiftçi', dogumYili: 1990, kosullarOnay: true, kvkkOnay: true })).durum, 201);
  uid = db.prepare(`SELECT id FROM users WHERE email = 'ciftci@test.local'`).get().id;
  parsel = hucreBul('TARIM');
  assert.equal((await c(`/api/parsel/${parsel}/edin`, {})).durum, 200);
  assert.equal((await c(`/api/parsel/${parsel}/ek`, { urun: 'BUGDAY' })).durum, 200);
  await bekle(20);   // TP olay yolundan (işlem sonrası) yazılır
  assert.equal(db.prepare(`SELECT tp FROM users WHERE id = ?`).get(uid).tp, SEVIYE.tp.PARCEL_ACQUIRED + SEVIYE.tp.CROP_PLANTED);
  assert.ok(db.prepare(`SELECT COUNT(*) c FROM tp_kayitlari WHERE user_id = ? AND region_id IS NOT NULL`).get(uid).c >= 2);
});

test('seviye formülü ve seviye kilidi', async () => {
  assert.deepEqual([0, 39, 40, 119, 120, 240].map(ciftlik.seviyeHesap), [1, 1, 2, 2, 3, 4]);
  // 5'ten sonra eğri dikleşir: eşik × max(1, n / 5)
  assert.equal(ciftlik.seviyeEsigi(10), 3600);
  assert.deepEqual([3599, 3600, 30399, 30400].map(ciftlik.seviyeHesap), [9, 10, 19, 20]);
  const kart = (await c(`/api/parsel/${parsel}`)).veri;
  const kumes = kart.insaatSecenekleri.find((s) => s.tip === 'KUMES');
  assert.equal(kumes.kilitli, true);
  const r = await c(`/api/parsel/${parsel}/insaat`, { tip: 'KUMES' });
  assert.equal(r.durum, 403);
  assert.match(r.veri.hata, /seviye 2/);
});

test('seviye ödülü: birikmiş seviyeler tek seferde, ikinci kez alınamaz', async () => {
  db.prepare(`UPDATE users SET tp = 130 WHERE id = ?`).run(uid);   // seviye 3
  const once = L.bakiye(uid);
  const r = await c('/api/seviye-odul', {});
  assert.equal(r.durum, 200);
  assert.equal(r.veri.tutar, SEVIYE.seviyeOdulu(2) + SEVIYE.seviyeOdulu(3));
  assert.equal(L.bakiye(uid), L.yuvarla(once + r.veri.tutar));
  assert.equal((await c('/api/seviye-odul', {})).durum, 409);
});

test('günlük ödül: günde bir kez', async () => {
  const once = L.bakiye(uid);
  const r = await c('/api/gunluk-odul', {});
  assert.equal(r.durum, 200);
  assert.equal(r.veri.seri, 1);
  assert.equal(L.bakiye(uid), L.yuvarla(once + r.veri.akce));
  assert.equal((await c('/api/gunluk-odul', {})).durum, 409);
});

test('kümes: yemle (eksik yem satın alınır) → hazır olunca topla → yumurta envantere', async () => {
  assert.equal((await c(`/api/parsel/${parsel}/insaat`, { tip: 'KUMES' })).durum, 200);
  await bekle(260);   // OYUN_HIZI 600: 2 dk → 200 ms
  let kart = (await c(`/api/parsel/${parsel}`)).veri;
  const kumes = kart.yapilar.find((y) => y.tip === 'KUMES');
  assert.equal(kumes.durum, 'ACTIVE');
  assert.equal(kumes.hayvan.durum, 'AC');
  const once = L.bakiye(uid);
  const b = await c(`/api/yapi/${kumes.id}/besle`, {});
  assert.equal(b.durum, 200);
  assert.equal(b.veri.yemSatin, HAYVANLAR.KUMES.yem);
  assert.ok(L.bakiye(uid) < once);
  assert.equal((await c(`/api/yapi/${kumes.id}/besle`, {})).durum, 409, 'tok hayvan yeniden yemlenmez');
  assert.equal((await c(`/api/yapi/${kumes.id}/topla`, {})).durum, 409, 'vakti gelmeden toplanmaz');
  await bekle(260);
  // Haritada "hayvan ürünü hazır" işareti
  const [lon, lat] = [kart.konum.lon, kart.konum.lat];
  const harita = (await c(`/api/harita/parseller?bbox=${lon - 0.001},${lat - 0.001},${lon + 0.001},${lat + 0.001}`)).veri;
  assert.equal(harita.features.find((f) => f.properties.id === parsel).properties.hh, 1);
  const t = await c(`/api/yapi/${kumes.id}/topla`, {});
  assert.equal(t.durum, 200);
  assert.equal(L.envanterMiktar(uid, 'YUMURTA'), HAYVANLAR.KUMES.miktar);
  kart = (await c(`/api/parsel/${parsel}`)).veri;
  assert.equal(kart.yapilar.find((y) => y.tip === 'KUMES').hayvan.durum, 'AC');
  // Başkasının barınağı yemlenemez
  const d = istemci();
  await d('/api/kayit', { email: 'baska@test.local', sifre: 'parola123', ad: 'Başka', dogumYili: 1990, kosullarOnay: true, kvkkOnay: true });
  assert.equal((await d(`/api/yapi/${kumes.id}/besle`, {})).durum, 403);
});

test('sipariş panosu: dolu başlar, eksik ürünle teslim edilemez, tamamlanınca ödenir; reddedilen kapanır', async () => {
  const o = (await c('/api/ciftlik')).veri;
  assert.equal(o.siparisler.liste.length, 3);
  const s = o.siparisler.liste[0];
  assert.ok(s.odul > 0 && s.tp > 0 && s.kalemler.length >= 1);
  // Önceki testlerden kalan ürünler (ör. yumurta) siparişi karşılamasın: envanteri boşalt
  for (const i of L.envanter(uid)) L.envanterDegis(uid, i.item_id, -i.miktar, 'test');
  const eksik = await c(`/api/siparis/${s.id}/teslim`, {});
  assert.ok([409].includes(eksik.durum));
  for (const k of s.kalemler) L.envanterDegis(uid, k.kod, k.adet, 'test');
  const once = L.bakiye(uid);
  const t = await c(`/api/siparis/${s.id}/teslim`, {});
  assert.equal(t.durum, 200);
  assert.equal(L.bakiye(uid), L.yuvarla(once + s.odul));
  for (const k of s.kalemler) assert.ok(L.envanterMiktar(uid, k.kod) >= 0);
  const r = o.siparisler.liste[1];
  assert.equal((await c(`/api/siparis/${r.id}/reddet`, {})).durum, 200);
  const sonra = (await c('/api/ciftlik')).veri.siparisler.liste;
  assert.ok(!sonra.some((x) => x.id === s.id || x.id === r.id));
  assert.equal((await c(`/api/siparis/${s.id}/teslim`, {})).durum, 409);
});

test('süsler: satın alınır, yuvaya yerleşir, haritada görünür; seviyesi yetmeyen kilitli', async () => {
  const once = L.bakiye(uid);
  const r = await c(`/api/parsel/${parsel}/sus`, { tur: 'KORKULUK' });
  assert.equal(r.durum, 200);
  assert.equal(r.veri.yuva, 0);
  assert.equal(L.bakiye(uid), L.yuvarla(once - SUSLER.KORKULUK.fiyat));
  const kart = (await c(`/api/parsel/${parsel}`)).veri;
  assert.deepEqual(kart.susler.map((s) => s.tur), ['KORKULUK']);
  const harita = (await c(`/api/harita/parseller?bbox=${kart.konum.lon - 0.001},${kart.konum.lat - 0.001},${kart.konum.lon + 0.001},${kart.konum.lat + 0.001}`)).veri;
  assert.equal(harita.features.find((f) => f.properties.id === parsel).properties.ss, 'KORKULUK:0');
  assert.equal((await c(`/api/parsel/${parsel}/sus`, { tur: 'YEL_DEGIRMENI' })).durum, 403);
  assert.equal((await c(`/api/sus/${kart.susler[0].id}/kaldir`, {})).durum, 200);
});

