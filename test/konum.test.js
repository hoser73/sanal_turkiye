// Arsa konum değeri (harita/konum.js, config/konum-fiyat.js): kıyı, merkez, arazi ve bölge etkenleri; PNG yükselti
// çözücüsü; parselin bedeline yansıması; başlangıç hediyesinin üst sınırı.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const zlib = require('zlib');
const { ortamKur, istemciUret, hucreBul } = require('./yardimci');

const VERI = ortamKur('konum');
const app = require('../server/index');
const db = require('../server/db');
const { carpanHesapla } = require('../server/harita/konum');
const { pngCoz } = require('../server/harita/yukselti');
const { IL_FIYAT, ILCE_FIYAT, KONUM } = require('../server/config/konum-fiyat');
const { IMAR, HESAP } = require('../server/config/rules');

let sunucu, taban;
before(async () => {
  await new Promise((r) => { sunucu = app.listen(0, r); });
  taban = `http://127.0.0.1:${sunucu.address().port}`;
  await app.hazir;
});
after(() => { sunucu.close(); fs.rmSync(VERI, { recursive: true, force: true }); });
const istemci = istemciUret(() => taban);

const duz = { yukselti: 10, egim: 2, cevreFarki: 10 };
const kat = (c, a = duz, plaka = '07', ilce = 'Alanya', yol = false) => carpanHesapla({ plaka, ilce, c, a, yol }).kat;
const kasaba = (m) => ({ denizM: Infinity, golM: Infinity, sehir: null, kasaba: { ad: 'Kasaba', m } });

test('veri: 81 il fiyatlı; ilçe adları sınır verisiyle eşleşir', () => {
  assert.equal(Object.keys(IL_FIYAT).length, 81);
  const { ilceler } = require('../server/harita/sinirlar');
  const { normalize } = require('../server/harita/imar');
  for (const [plaka, t] of Object.entries(ILCE_FIYAT)) {
    for (const ad of Object.keys(t)) assert.ok(ilceler.some((c) => c.plaka === plaka && normalize(c.ad) === normalize(ad)), `${plaka} ${ad}`);
  }
  assert.ok(IL_FIYAT['48'] > IL_FIYAT['34'] && IL_FIYAT['34'] > IL_FIYAT['06'] && IL_FIYAT['06'] > IL_FIYAT['30'], 'Muğla > İstanbul > Ankara > Hakkari');
});

test('kıyı: denize yaklaştıkça pahalanır; 3 km ötede etkisi kalmaz; göl primi denizden küçük', () => {
  const k = (denizM, golM = Infinity) => kat({ ...kasaba(3000), denizM, golM });
  assert.ok(k(50) > k(500) && k(500) > k(1500) && k(1500) > k(5000));
  assert.ok(k(50) / k(20000) > 2.5, 'sahil şeridi iç kesimin 2,5 katından pahalı');
  assert.ok(Math.abs(k(8000) / k(Infinity) - 1) < 0.01);
  assert.ok(k(Infinity, 50) > k(Infinity) && k(Infinity, 50) < k(50));
});

test('merkez: şehir ve kasaba merkezine yakın pahalı, kasabadan 12 km ötesi giderek ucuz', () => {
  assert.ok(kat(kasaba(300)) > kat(kasaba(3000)) && kat(kasaba(3000)) > kat(kasaba(11000)));
  assert.ok(kat(kasaba(40000)) < kat(kasaba(11000)), 'uzak köy');
  const sehirde = kat({ denizM: Infinity, golM: Infinity, sehir: { m: 500 }, kasaba: { m: 500 } });
  assert.ok(sehirde > kat(kasaba(500)), 'şehir merkezi kasabadan pahalı');
});

test('arazi: dik yamaç ve çevresinden yüksek (dağ) yer ucuz; ova düz arazi tam değer', () => {
  const c = kasaba(3000);
  const dag = kat(c, { yukselti: 1700, egim: 45, cevreFarki: 600 }), yamac = kat(c, { yukselti: 400, egim: 20, cevreFarki: 200 });
  assert.ok(kat(c) > yamac && yamac > dag);
  assert.ok(dag / kat(c) >= KONUM.egim.taban * KONUM.dag.taban - 0.01, 'en çok iki taban çarpımı kadar düşer');
  assert.ok(kat(c, duz, '07', 'Alanya', true) > kat(c), 'yola yakın parsel biraz pahalı');
});

test('bölge: aynı konumda pahalı ilçe ve il farkı; sonuç alt/üst sınırda kalır', () => {
  const c = kasaba(3000);
  assert.ok(kat(c, duz, '48', 'Bodrum') > kat(c, duz, '48', 'Kavaklıdere'));
  assert.ok(kat(c, duz, '34', 'Beşiktaş') > kat(c, duz, '30', 'Yüksekova'));
  assert.equal(kat(c, duz, '34', 'Ayvacik'), kat(c, duz, '34', 'Bilinmeyen'), 'listede olmayan ilçe 1');
  const ucuz = kat(kasaba(90000), { yukselti: 2500, egim: 80, cevreFarki: 1500 }, '30', 'Yüksekova');
  const pahali = kat({ denizM: 0, golM: Infinity, sehir: { m: 0 }, kasaba: { m: 0 } }, duz, '48', 'Bodrum', true);
  assert.equal(ucuz, KONUM.alt); assert.equal(pahali, KONUM.ust);
  // Gerçek örnek: Alanya sahili Alanya'nın dağ köyünden kat kat pahalı
  const sahil = kat({ denizM: 300, golM: Infinity, sehir: null, kasaba: { m: 1600 } });
  const koy = kat({ denizM: 19800, golM: Infinity, sehir: null, kasaba: { m: 16700 } }, { yukselti: 1744, egim: 52, cevreFarki: 344 });
  assert.ok(sahil / koy > 4, `${sahil} / ${koy}`);
});

test('PNG çözücü: süzgeçli RGB satırları doğru açılır (terrarium yükselti)', () => {
  // 2 × 2 RGB, satır süzgeçleri: 0 (yok) ve 2 (üst): ikinci satır birinciye eklenir
  const ham = Buffer.from([0, 128, 0, 0, 128, 1, 0, 2, 0, 10, 0, 0, 20, 0]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 2;
  const parca = (tur, v) => { const u = Buffer.alloc(4); u.writeUInt32BE(v.length); return Buffer.concat([u, Buffer.from(tur), v, Buffer.alloc(4)]); };
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), parca('IHDR', ihdr), parca('IDAT', zlib.deflateSync(ham)), parca('IEND', Buffer.alloc(0))]);
  const p = pngCoz(png);
  const yuk = (i) => p.veri[i * 3] * 256 + p.veri[i * 3 + 1] + p.veri[i * 3 + 2] / 256 - 32768;
  assert.deepEqual([0, 1, 2, 3].map(yuk), [0, 1, 10, 21]);
});

test('parsel: konum değeri kayda yazılır, kartta dökümüyle görünür, taban bedel onunla hesaplanır', async () => {
  const id = hucreBul('TARIM');
  const k = (await istemci()(`/api/parsel/${id}`)).veri;
  const p = db.prepare(`SELECT konum_kati, konum_surum FROM parcels WHERE id = ?`).get(id);
  assert.equal(p.konum_surum, KONUM.surum);
  assert.equal(k.konumDegeri.kat, p.konum_kati);
  assert.ok(k.konumDegeri.merkez.kat > 0 && k.konumDegeri.arazi.kat === 1, 'sahte kaynakta arazi düz');
  assert.equal(k.deger.tahsis, Math.round(k.alan * IMAR.TARIM.m2Fiyat * p.konum_kati));
  // Formül sürümü değişince arka plan doldurucu yeniden hesaplar
  db.prepare(`UPDATE parcels SET konum_kati = NULL, konum_surum = NULL WHERE id = ?`).run(id);
  // Konum değeri yokken bedel geçici çekicilikle çıkar: o fiyattan tahsis yapılmaz
  assert.throws(() => require('../server/oyun').parselEdin(1, id), (e) => e.kod === 'KONUM_YOK' && e.status === 503);
  assert.ok(await require('../server/harita/parsel').eksikKonumlariDoldur({ ara: 0 }) >= 1);
  assert.equal(db.prepare(`SELECT konum_kati FROM parcels WHERE id = ?`).get(id).konum_kati, p.konum_kati);
});

test('başlangıç hediyesi en çok üst sınır kadar; pahalı tarlada farkı oyuncu öder', async () => {
  const c = istemci();
  assert.equal((await c('/api/kayit', { email: 'hediye@test.local', sifre: 'parola123', dogumYili: 1990, kosullarOnay: true, kvkkOnay: true, ad: 'Hediye' })).durum, 201);
  const id = hucreBul('TARIM');
  await c(`/api/parsel/${id}`);
  db.prepare(`UPDATE parcels SET konum_kati = 5 WHERE id = ?`).run(id);   // kıyıda pahalı bir tarla gibi
  const oyun = require('../server/oyun');
  const tahsis = oyun.tahsisFiyati(oyun.parselGetir(id));
  assert.ok(tahsis > HESAP.baslangicHediyeUst);
  const uid = db.prepare(`SELECT id FROM users WHERE email = 'hediye@test.local'`).get().id;
  const L = require('../server/lib/ledger');
  L.odul(uid, tahsis, 'test bakiyesi');   // farkı başlangıç bakiyesinden bağımsız ödeyebilsin
  const once = L.bakiye(uid);
  const r = require('../server/baslangic').hediyeEt(uid, id);
  assert.equal(r.hediye, HESAP.baslangicHediyeUst);
  assert.equal(Math.round((once - L.bakiye(uid)) * 100) / 100, tahsis - HESAP.baslangicHediyeUst - (r.gorev?.odul || 0), 'oyuncu yalnızca hediyeyi aşan kısmı öder (ilk parsel görevi ödülü ayrı)');
});

test('para birimi: oyun birimi ekranda TL (₺) gösterilir; istemci ve sunucu katsayısı aynı', () => {
  const { BIRIM } = require('../server/config/rules');
  const { tl, tlDegeri } = require('../server/lib/para');
  assert.deepEqual([BIRIM.sembol, BIRIM.kat], ['₺', 300]);
  assert.equal(tl(3600), '₺1.080.000');
  assert.equal(tl(0.36), '₺108', 'kuruş hassasiyetindeki oyun birimi tam TL olur');
  assert.equal(tlDegeri('12.5'), 3750);
  const istemci = fs.readFileSync(require('path').join(__dirname, '../public/js/yardimci.js'), 'utf8');
  assert.match(istemci, new RegExp(`export const TL_KAT = ${BIRIM.kat};`));
});
