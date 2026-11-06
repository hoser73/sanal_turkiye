// Pilot lansman ön şartları (plan §20.1) — ulusal ızgara üzerinde uçtan uca testler.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { ortamKur, istemciUret, hucreBul } = require('./yardimci');

const VERI = ortamKur('oyun');
const app = require('../server/index');
const db = require('../server/db');
const I = require('../server/harita/izgara');
const { YAPILAR, URUNLER, HESAP, IMAR } = require('../server/config/rules');

let sunucu, taban;
before(async () => {
  await new Promise((r) => { sunucu = app.listen(0, r); });
  taban = `http://127.0.0.1:${sunucu.address().port}`;
  await app.hazir;
});
after(() => { sunucu.close(); fs.rmSync(VERI, { recursive: true, force: true }); });

const istemci = istemciUret(() => taban);
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

let a, b;
test('kayıt ve başlangıç bakiyesi', async () => {
  a = istemci(); b = istemci();
  assert.equal((await a('/api/kayit', { email: 'a@test.local', sifre: 'parola123', dogumYili: 1990, kosullarOnay: true, kvkkOnay: true, ad: 'Ali' })).durum, 201);
  assert.equal((await b('/api/kayit', { email: 'b@test.local', sifre: 'parola123', dogumYili: 1990, kosullarOnay: true, kvkkOnay: true, ad: 'Berna' })).durum, 201);
  assert.equal((await a('/api/kayit', { email: 'a@test.local', sifre: 'parola123', dogumYili: 1990, kosullarOnay: true, kvkkOnay: true, ad: 'Ali2' })).durum, 409);
  assert.equal((await a('/api/ben')).veri.bakiye, HESAP.baslangicBakiye);
  assert.equal((await istemci()('/api/ben')).veri, null);
  assert.equal((await istemci()('/api/cuzdan')).durum, 401);
});

test('81 il ve 973 ilçe yüklü; konum ve arama çalışır', async () => {
  const bolgeler = (await a('/api/bolgeler')).veri;
  assert.equal(bolgeler.filter((r) => r.type === 'IL').length, 81);
  assert.equal(bolgeler.filter((r) => r.type === 'ILCE').length, 973);
  const k = (await a('/api/konum?lon=32.49&lat=37.87')).veri;
  assert.equal(k.il, 'Konya');
  assert.ok(['Meram', 'Selçuklu', 'Karatay'].includes(k.ilce));
  const s = (await a('/api/ara?q=trabzon')).veri;
  assert.equal(s[0].ad, 'Trabzon');
  assert.equal(s[0].tur, 'il');
  assert.ok((await a('/api/ara?q=kadikoy')).veri.some((r) => r.ad === 'Kadıköy' && r.tur === 'ilce'));
});

test('parsel kartı: gerçek il/ilçe, hücre alanı, Türkiye dışı reddedilir', async () => {
  const id = hucreBul('TARIM');
  const k = (await a(`/api/parsel/${id}`)).veri;
  assert.equal(k.il, 'Konya');
  assert.ok(k.alan > 800 && k.alan < 1000, `alan ${k.alan}`);
  assert.equal(k.komsular.length, 8);
  assert.ok(k.komsular.every((n) => n.imar));
  const { x, y } = I.hucre(33.36, 35.17);   // Lefkoşa
  assert.equal((await a(`/api/parsel/${I.parselId(x, y)}`)).durum, 404);
  const deniz = I.hucre(30.0, 34.5);        // Akdeniz
  assert.equal((await a(`/api/parsel/${I.parselId(deniz.x, deniz.y)}`)).durum, 404);
});

test('parsel iki kullanıcıya aynı anda tahsis edilemez', async () => {
  const p = hucreBul('TARIM');
  const sonuclar = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b)(`/api/parsel/${p}/edin`, {})));
  assert.equal(sonuclar.filter((r) => r.durum === 200).length, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM parcel_ownership WHERE parcel_id = ? AND end_at IS NULL`).get(p).c, 1);
});

test('park, koruma alanı ve yol hücreleri edinilemez', async () => {
  assert.equal((await a(`/api/parsel/${hucreBul('PARK')}/edin`, {})).durum, 409);
  assert.equal((await a(`/api/parsel/${hucreBul('KORUMA')}/edin`, {})).durum, 409);
  assert.equal((await a(`/api/parsel/${hucreBul('YOL')}/edin`, {})).durum, 409);
});

let tarla, konut, c;
// Test için oyun içi hibe (defter üzerinden, dengeli)
const odulVer = (email, tutar) => require('../server/lib/ledger').odul(db.prepare('SELECT id FROM users WHERE email = ?').get(email).id, tutar, 'Test hibesi');
test('imar ihlalleri engellenir (tarlaya ev, TAKS aşımı, sahibi olmayan)', async () => {
  tarla = hucreBul('TARIM');
  assert.equal((await a(`/api/parsel/${tarla}/edin`, {})).durum, 200);
  assert.equal((await a(`/api/parsel/${tarla}/insaat`, { tip: 'EV' })).durum, 422);
  assert.equal((await a(`/api/parsel/${tarla}/insaat`, { tip: 'FABRIKA' })).durum, 422);
  assert.equal((await b(`/api/parsel/${tarla}/insaat`, { tip: 'TEL_CIT' })).durum, 403);
  assert.equal((await a(`/api/parsel/${tarla}/insaat`, { tip: 'TEL_CIT' })).durum, 200);
  assert.equal((await a(`/api/parsel/${tarla}/insaat`, { tip: 'TEL_CIT' })).durum, 422, 'tekil yapı ikinci kez kurulamaz');

  // ≈ 910 m² konut: TAKS 0,30 → ≈ 273 m² taban. Ev (120) sığar; ardından apartman (130 × 4 kat) KAKS'ı aşar
  // Konut, şehirde tarladan pahalıdır: yeni bir oyuncu tam hibesiyle alır
  c = istemci();
  assert.equal((await c('/api/kayit', { email: 'c@test.local', sifre: 'parola123', dogumYili: 1990, kosullarOnay: true, kvkkOnay: true, ad: 'Cemre' })).durum, 201);
  konut = hucreBul('KONUT');
  const kart = (await c(`/api/parsel/${konut}`)).veri;
  // Bedel konum değerini içerir: alan × konut m² fiyatı × konum çarpanı (il, ilçe, kıyı, merkez, arazi, yol) × mahalle endeksi
  assert.ok(kart.konumDegeri?.kat > 0 && kart.konumDegeri.il === require('../server/config/konum-fiyat').IL_FIYAT[kart.plaka]);
  assert.equal(kart.deger.tahsis, Math.round(kart.alan * IMAR.KONUT.m2Fiyat * kart.konumDegeri.kat), 'taban bedel konum çarpanıyla');
  assert.equal((await c(`/api/parsel/${konut}/edin`, {})).durum, 200);
  assert.equal((await c(`/api/parsel/${konut}/insaat`, { tip: 'PEYZAJ' })).durum, 200);
  odulVer('c@test.local', YAPILAR.EV.maliyet);
  assert.equal((await c(`/api/parsel/${konut}/insaat`, { tip: 'EV' })).durum, 200);
  const ikinci = await c(`/api/parsel/${konut}/insaat`, { tip: 'APARTMAN' });
  assert.equal(ikinci.durum, 422);
  assert.match(ikinci.veri.hata, /TAKS|KAKS/);
});

test('yapı süresi dolunca tamamlanır', async () => {
  await bekle(YAPILAR.EV.sureMs + 50);
  const kart = await c(`/api/parsel/${konut}`);
  assert.ok(kart.veri.yapilar.every((y) => y.durum === 'ACTIVE'));
});

// Parsel boşaltılınca (hesap silme, demo sakin taşınması) yapılar silinir; SQLite en büyük kimliği yeniden verebilir.
// Yeni yapının başlangıç/tamamlanma denetim kaydı eskisininkiyle çakışmamalı (çakışınca hiç kimse yapı kuramıyordu).
test('silinen yapının kimliği yeniden verilse de yeni yapı kurulur ve tamamlanır', async () => {
  const d = istemci();
  assert.equal((await d('/api/kayit', { email: 'yeniden@test.local', sifre: 'parola123', dogumYili: 1990, kosullarOnay: true, kvkkOnay: true, ad: 'Yeniden' })).durum, 201);
  const ilk = hucreBul('TARIM'), ikinci = hucreBul('TARIM');
  assert.equal((await d(`/api/parsel/${ilk}/edin`, {})).durum, 200);
  assert.equal((await d(`/api/parsel/${ilk}/insaat`, { tip: 'TEL_CIT' })).durum, 200);
  const eski = db.prepare(`SELECT id FROM structures WHERE parcel_id = ?`).get(ilk).id;
  assert.equal(eski, db.prepare(`SELECT MAX(id) m FROM structures`).get().m, 'en son kurulan yapı');
  await bekle(YAPILAR.TEL_CIT.sureMs + 50);
  await d(`/api/parsel/${ilk}`);   // tamamlanma işlenir
  require('../server/oyun').parseliBosalt(ilk);
  assert.equal((await d(`/api/parsel/${ikinci}/edin`, {})).durum, 200);
  const r = await d(`/api/parsel/${ikinci}/insaat`, { tip: 'TEL_CIT' });
  assert.equal(r.durum, 200, JSON.stringify(r.veri));
  assert.equal(r.veri.yapiId, eski, 'SQLite kimliği yeniden verdi (senaryo gerçekleşti)');
  await bekle(YAPILAR.TEL_CIT.sureMs + 50);
  assert.equal((await d(`/api/parsel/${ikinci}`)).durum, 200);
  assert.equal(db.prepare(`SELECT status FROM structures WHERE id = ?`).get(eski).status, 'ACTIVE');
});

test('tarla döngüsü: ek → sula → hasat; çift hasat yok', async () => {
  const once = (await a('/api/ben')).veri.bakiye;
  assert.equal((await a(`/api/parsel/${tarla}/ek`, { urun: 'DOMATES' })).durum, 200);
  assert.equal((await a(`/api/parsel/${tarla}/ek`, { urun: 'BUGDAY' })).durum, 409, 'aynı tarlaya ikinci ekin');
  assert.equal((await a(`/api/parsel/${tarla}/hasat`, {})).durum, 409, 'olgunlaşmadan hasat');
  assert.equal((await a(`/api/parsel/${tarla}/sula`, {})).durum, 200);
  assert.equal((await a(`/api/parsel/${tarla}/sula`, {})).durum, 429, 'art arda sulama');
  await bekle(URUNLER.DOMATES.sureMs + 50);
  assert.equal((await a(`/api/parsel/${tarla}/sula`, {})).durum, 409, 'olgun ekin sulanmaz');
  const [h1, h2] = await Promise.all([a(`/api/parsel/${tarla}/hasat`, {}), a(`/api/parsel/${tarla}/hasat`, {})]);
  assert.deepEqual([h1.durum, h2.durum].sort(), [200, 409]);
  const ben = (await a('/api/ben')).veri;
  assert.ok(ben.envanter.find((i) => i.item_id === 'DOMATES').miktar > 0);
  assert.ok(ben.bakiye < once + 100);
});

test('NPC pazarı: satış bakiyeyi artırır, olmayan ürün satılamaz', async () => {
  const ben = (await a('/api/ben')).veri;
  const stok = ben.envanter.find((i) => i.item_id === 'DOMATES').miktar;
  assert.equal((await a('/api/pazar/sat', { urun: 'DOMATES', miktar: stok + 1 })).durum, 409);
  assert.equal((await a('/api/pazar/sat', { urun: 'DOMATES', miktar: stok })).durum, 200);
  const sonra = (await a('/api/ben')).veri;
  assert.ok(sonra.bakiye > ben.bakiye);
  assert.equal((await a('/api/pazar/sat', { urun: 'ALTIN', miktar: 1 })).durum, 400);
});

test('NPC pazarı kuruş hassasiyetinde öder (aşağı yuvarlama ürünü bedavaya götürmez); gün Türkiye saatiyle', async () => {
  const L = require('../server/lib/ledger'), oyun = require('../server/oyun');
  const c = istemci();
  await c('/api/kayit', { email: 'kurus@test.local', sifre: 'parola123', dogumYili: 1990, kosullarOnay: true, kvkkOnay: true, ad: 'Kuruş' });
  const id = (await c('/api/ben')).veri.kullanici.id;
  L.envanterDegis(id, 'BUGDAY', 5, 'test');
  const once = L.bakiye(id);
  const r = (await c('/api/pazar/sat', { urun: 'BUGDAY', miktar: 5 })).veri;
  assert.ok(r.tutar > 5 && !Number.isInteger(r.tutar), JSON.stringify(r));
  assert.equal(L.yuvarla(L.bakiye(id) - once), r.tutar);
  assert.equal(oyun.bugun(Date.parse('2026-01-01T21:30:00Z')), '2026-01-02');
  assert.equal(oyun.bugun(Date.parse('2026-01-01T20:59:00Z')), '2026-01-01');
});

test('harita: görünür alandaki sahipli parseller ve imar karosu', async () => {
  const { x, y } = I.idCoz(tarla);
  const [lon, lat] = I.hucreMerkezi(x, y);
  const fc = (await a(`/api/harita/parseller?bbox=${lon - 0.01},${lat - 0.01},${lon + 0.01},${lat + 0.01}`)).veri;
  const benim = fc.features.find((f) => f.properties.id === tarla);
  assert.equal(benim.properties.s, 1);
  assert.match(benim.properties.yp, /TEL_CIT:1/);
  assert.equal((await a(`/api/harita/parseller?bbox=26,36,45,42`)).durum, 400, 'ülke ölçeğinde parsel istenmez');
  const { kx, ky } = I.karoOf(x, y);
  const png = await a(`/api/karo/imar/${kx}/${ky}.png`);
  assert.equal(png.durum, 200);
  assert.equal(png.tur, 'image/png');
  assert.deepEqual([...new Uint8Array(png.veri.slice(1, 4))], [0x50, 0x4e, 0x47]);
  const ist = (await a('/api/istatistik/iller')).veri;
  assert.equal(ist.length, 81);
  assert.ok(ist.find((i) => i.plaka === '42').parsel >= 2);
});

test('defter tutarlılığı %100: her işlem grubu dengeli', () => {
  const dengesiz = db.prepare(`SELECT tx_group FROM wallet_ledger GROUP BY tx_group HAVING ABS(SUM(debit) - SUM(credit)) > 0.001`).all();
  assert.equal(dengesiz.length, 0);
  const negatif = db.prepare(`SELECT user_id FROM wallet_ledger WHERE user_id IS NOT NULL GROUP BY user_id HAVING SUM(credit) - SUM(debit) < 0`).all();
  assert.equal(negatif.length, 0);
});

test('denetim kaydı değiştirilemez', () => {
  assert.throws(() => db.prepare(`UPDATE audit_events SET action = 'X'`).run(), /değiştirilemez/);
  assert.throws(() => db.prepare(`DELETE FROM audit_events`).run(), /silinemez/);
});

test('geçersiz girdiler 400 döner, 500 değil', async () => {
  assert.equal((await a('/api/parsel/..%2F..%2Fetc/edin', {})).durum, 400);
  assert.equal((await a('/api/parsel/XYZ/edin', {})).durum, 400);
  assert.equal((await a('/api/parsel/TR-9999999-0000001')).durum, 400, 'ızgara dışı kimlik');
  assert.equal((await a('/api/giris', { email: { $ne: 1 }, sifre: 'x' })).durum, 400);
  assert.equal((await a(`/api/parsel/${tarla}/insaat`, { tip: '__proto__' })).durum, 422);
  assert.equal((await a('/api/karo/imar/99999/1.png')).durum, 400);
  assert.equal((await a('/api/harita/parseller?bbox=abc')).durum, 400);
  for (const k of ['0x25c6/6327', '9670e0/6327', '%209670/6327']) assert.equal((await a(`/api/karo/imar/${k}.png`)).durum, 400, k);
  // Metin beklenen alanda nesne: String() TypeError'ı 500 vermesin
  const nesne = { toString: 1, valueOf: 1 };
  for (const [yol, govde] of [[`/api/parsel/${tarla}/insaat`, { tip: nesne }], [`/api/parsel/${tarla}/ek`, { urun: nesne }], [`/api/parsel/${tarla}/sus`, { tur: nesne }],
    ['/api/pazar/sat', { urun: nesne, miktar: 1 }], ['/api/pazar/sat', { urun: 'DOMATES', miktar: nesne }], ['/api/carsi/satin-al', { urun: nesne }],
    ['/api/carsi/kullan', { urun: 'GUBRE', parselId: nesne }], [`/api/parsel/${tarla}/uretim`, { recete: nesne, parti: nesne }]]) {
    const r = await a(yol, govde);
    assert.ok(r.durum >= 400 && r.durum < 500, `${yol} ${r.durum}`);
  }
});
