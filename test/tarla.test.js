// Gerçek tarla aktarımının saf işleyicisi (tarla-ftw.js): karo sınırında bölünen tarla birleşir, hücreler merkezlerine göre
// tek tarlaya atanır, 10 m piksel basamakları düzleşir, aşırı küçük/büyük parçalar atılır. Sahte karo verisiyle kapalıdır.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ortamKur } = require('./yardimci');

ortamKur('tarla');
const F = require('../server/harita/tarla-ftw');
const T = require('../server/harita/tarla');

const kare = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
// 10 m (⅓ hücre) basamaklı çapraz kenarlı tarla: (0,0)–(6,0)–(6,6) üçgeni, hipotenüs merdiven
function merdivenUcgen(adim = 1 / 3, n = 18) {
  const r = [[0, 0], [n * adim, 0], [n * adim, n * adim]];
  for (let k = n; k > 0; k--) r.push([(k - 1) * adim, k * adim], [(k - 1) * adim, (k - 1) * adim]);
  r.pop();
  return r;
}

test('yumuşatma piksel basamaklarını düz kenara çevirir, alanı korur', () => {
  const ham = merdivenUcgen();
  const duz = F.yumusat(ham);
  assert.ok(ham.length > 30 && duz.length <= 8, `köşe sayısı ${ham.length} → ${duz.length}`);
  const a0 = F.halkaAlani(ham), a1 = F.halkaAlani(duz);
  assert.ok(Math.abs(a1 - a0) / a0 < 0.1, `alan ${a0.toFixed(2)} → ${a1.toFixed(2)}`);
});

test('karo sınırında bölünen tarla tek tarla olur; hücreler tek tarlaya atanır', () => {
  // İki z13 karosu yan yana (x: 0–128 | 128–256). Tarla x 120–136; her karo sınırdan 2,5 hücre taşan tampon içerir.
  const karolar = [
    { tx: 0, ty: 0, parcalar: [{ halka: kare(120, 10, 130.5, 20), alanM2: 140000 }, { halka: kare(20, 20, 30, 30), alanM2: 90000 }] },
    { tx: 1, ty: 0, parcalar: [{ halka: kare(125.5, 10, 136, 20), alanM2: 140000 }] },
  ];
  const tarlalar = F.tarlalariKur({ karolar });
  assert.equal(tarlalar.length, 2, 'bölünen tarla birleşir, diğeri ayrı kalır');
  const buyuk = tarlalar.find((t) => t.uyeler.length > 100);
  assert.equal(buyuk.uyeler.length, 16 * 10, 'x 120–135, y 10–19 hücreleri');
  assert.ok(buyuk.uyeler.some(([x]) => x < 128) && buyuk.uyeler.some(([x]) => x >= 128), 'iki karodan hücre');
  assert.ok(buyuk.uyeler.some(([x, y]) => x === buyuk.capa[0] && y === buyuk.capa[1]), 'çapa tarlanın hücresi');
  assert.ok(Math.abs(buyuk.alanHucre - 160) < 8, `birleşik sınır alanı ≈ 160 hücre (${buyuk.alanHucre.toFixed(1)})`);
  const [x0, , x1] = [Math.min(...buyuk.halka.map((p) => p[0])), 0, Math.max(...buyuk.halka.map((p) => p[0]))];
  assert.ok(x0 < 120.5 && x1 > 135.5, 'sınır iki karoyu da kapsar');
  const hepsi = tarlalar.flatMap((t) => t.uyeler.map(([x, y]) => `${x}:${y}`));
  assert.equal(new Set(hepsi).size, hepsi.length, 'hücre iki tarlaya girmez');
});

test('aşırı küçük ve dev parçalar atılır; korunan hücreler tarlaya girmez', () => {
  const karolar = [{ tx: 0, ty: 0, parcalar: [
    { halka: kare(1, 1, 2, 2), alanM2: 300 },            // çok küçük
    { halka: kare(10, 10, 100, 100), alanM2: 8e6 },      // hatalı dev alan
    { halka: kare(40, 2, 46, 6), alanM2: 22000 },
  ] }];
  const tarlalar = F.tarlalariKur({ karolar, uygun: (x, y) => !(x === 40 && y === 2) });
  assert.equal(tarlalar.length, 1);
  assert.equal(tarlalar[0].uyeler.length, 6 * 4 - 1);
  assert.ok(!tarlalar[0].uyeler.some(([x, y]) => x === 40 && y === 2));
});

test('maske sınır izleme L biçimini doğru alanla çizer; yön uzun kenara göre', () => {
  const gen = 6, yuk = 5, m = new Uint8Array(gen * yuk);
  for (let j = 0; j < 5; j++) m[j * gen] = m[j * gen + 1] = 1;   // dikey kol 2 × 5
  for (let i = 2; i < 6; i++) m[4 * gen + i] = 1;                // yatay kol 4 × 1
  assert.equal(F.halkaAlani(F.sinirIzle(m, gen, yuk)), 14);
  assert.equal(Math.abs(F.yonu(kare(0, 0, 10, 2))), 0);
  assert.equal(Math.abs(F.yonu(kare(0, 0, 2, 10))), 90);
});

test('sahte karo verisiyle tarlalar kapalı: kare parseller değişmez', async () => {
  assert.equal(T.etkin(), false);
  assert.equal(await T.tarlaBul(618901, 405277), null);
  assert.equal(await T.karoVerisi(9669, 6332), null);
});
