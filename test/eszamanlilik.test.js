// Veri katmanı: işlem anlamı ve eşzamanlılık. Aynı hesaptan / envanterden eşzamanlı harcamalar bakiyeyi eksiye
// düşüremez (Postgres'te gerçek paralel bağlantılarla, SQLite ve PGlite'ta tek yazıcıyla); iç içe işlem kayıt noktasıdır;
// işlem sonrası olaylar yalnızca kayıttan sonra çalışır.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { ortamKur } = require('./yardimci');

const VERI = ortamKur('eszamanlilik');
const db = require('../server/db');
const L = require('../server/lib/ledger');

after(() => fs.rmSync(VERI, { recursive: true, force: true }));

async function kullanici(ad) {
  return (await db.run(`INSERT INTO users (email, display_name) VALUES (?, ?)`, `${ad}@test.local`, ad)).lastInsertRowid;
}

test('aynı hesaptan eşzamanlı harcamalar bakiyeyi aşamaz', async () => {
  const u = await kullanici('harcayan');
  await db.tx(() => L.odul(u, 100, 'test'));
  const sonuclar = await Promise.allSettled(Array.from({ length: 20 }, () => db.tx(() => L.harca(u, 30, 'test'))));
  assert.equal(sonuclar.filter((s) => s.status === 'fulfilled').length, 3);
  assert.ok(sonuclar.filter((s) => s.status === 'rejected').every((s) => s.reason.kod === 'YETERSIZ_BAKIYE'));
  assert.equal(await L.bakiye(u), 10);
});

test('aynı üründen eşzamanlı düşümler envanteri eksiye düşüremez', async () => {
  const u = await kullanici('ambar');
  await db.tx(() => L.envanterDegis(u, 'BUGDAY', 5, 'test'));
  const sonuclar = await Promise.allSettled(Array.from({ length: 12 }, () => db.tx(() => L.envanterDegis(u, 'BUGDAY', -1, 'test'))));
  assert.equal(sonuclar.filter((s) => s.status === 'fulfilled').length, 5);
  assert.equal(await L.envanterMiktar(u, 'BUGDAY'), 0);
});

test('iç içe işlem kayıt noktasıdır: iç hata yalnızca kendi yazdıklarını geri alır', async () => {
  const u = await kullanici('ic-ice');
  await db.tx(async () => {
    await L.odul(u, 50, 'dış');
    await assert.rejects(db.tx(async () => { await L.odul(u, 7, 'iç'); throw new Error('iç hata'); }), /iç hata/);
    await L.odul(u, 5, 'dış 2');
  });
  assert.equal(await L.bakiye(u), 55);
  // Dış işlem hata verirse her şey geri alınır
  await assert.rejects(db.tx(async () => { await L.odul(u, 1000, 'geri alınacak'); throw new Error('dış hata'); }), /dış hata/);
  assert.equal(await L.bakiye(u), 55);
});

test('db.sonra yalnızca işlem kaydedilince çalışır; defter yazımı işlem dışında reddedilir', async () => {
  const calisan = [];
  await db.tx(async () => { db.sonra(() => calisan.push('kaydedildi')); });
  await assert.rejects(db.tx(async () => { db.sonra(() => calisan.push('geri alındı')); throw new Error('x'); }), /x/);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(calisan, ['kaydedildi']);
  const u = await kullanici('dis');
  await assert.rejects(L.odul(u, 1, 'işlem dışı'), /işlem dışında/);
  await assert.rejects(L.harca(u, 1, 'işlem dışı'), /işlem/);
});

test('tekOrnek: aynı bakım işi süreç içinde aynı anda bir kez çalışır', async () => {
  let n = 0;
  const is = () => db.tekOrnek('deneme', async () => { n++; await new Promise((r) => setTimeout(r, 20)); return n; });
  const [a, b] = await Promise.all([is(), is()]);
  assert.equal(n, 1);
  assert.equal(a, b);
});

test('işlem dışı sorgu açık işlemin yazdığını görmez ve ona karışmaz', async () => {
  const u = await kullanici('yalitim');
  let icerde;
  const islem = db.tx(async () => {
    await L.odul(u, 9, 'yalıtım');
    icerde = new Promise((r) => setTimeout(r, 10));
    await icerde;
    throw new Error('geri al');
  });
  // İşlem açıkken işlem dışından okuma: kaydedilmemiş yazıyı görmemeli
  await new Promise((r) => setTimeout(r, 2));
  assert.equal(await L.bakiye(u), 0);
  await assert.rejects(islem, /geri al/);
  assert.equal(await L.bakiye(u), 0);
});
