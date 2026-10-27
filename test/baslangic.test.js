// Başlangıç tarlası: yeni oyuncuya bir kez, hiç parseli yokken hediye edilir; bakiyesi azalmaz, ilk görev tamamlanır.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { ortamKur, istemciUret, hucreBul } = require('./yardimci');

const VERI = ortamKur('baslangic');
const app = require('../server/index');
const db = require('../server/db');

let sunucu, taban;
before(async () => {
  await new Promise((r) => { sunucu = app.listen(0, r); });
  taban = `http://127.0.0.1:${sunucu.address().port}`;
  await app.hazir;
});
after(() => { sunucu.close(); fs.rmSync(VERI, { recursive: true, force: true }); });
const istemci = istemciUret(() => taban);
const kayit = async (ad) => {
  const c = istemci();
  await c('/api/kayit', { email: `${ad}@test.local`, sifre: 'parola123', ad, dogumYili: 1990, kosullarOnay: true, kvkkOnay: true });
  return { c, id: db.prepare(`SELECT id FROM users WHERE email = ?`).get(`${ad}@test.local`).id };
};

test('yeni oyuncu tarlasını hediye alır; bakiye değişmez, ilk görev biter, ikinci kez alınamaz', async () => {
  const A = await kayit('yeniciftci');
  let ben = (await A.c('/api/ben')).veri;
  assert.equal(ben.baslangicTarlasi, true);
  const once = ben.bakiye;
  const r = await A.c('/api/baslangic/tarla', {});
  assert.equal(r.durum, 200, JSON.stringify(r.veri));
  assert.ok(r.veri.parsel && r.veri.hediye > 0);
  ben = (await A.c('/api/ben')).veri;
  assert.equal(ben.portfoy.length, 1);
  assert.equal(ben.portfoy[0].id, r.veri.parsel);
  assert.equal(ben.portfoy[0].imarAd, 'Tarım');
  assert.ok(Math.abs(ben.bakiye - once - (ben.gorevler.find((g) => g.kod === 'ILK_PARSEL').odul || 0)) < 0.01, 'tahsis bedeli hediyeyle karşılanır');
  assert.ok(ben.gorevler.find((g) => g.kod === 'ILK_PARSEL').tamam);
  assert.equal(ben.baslangicTarlasi, false);
  assert.equal((await A.c('/api/baslangic/tarla', {})).durum, 409);
});

test('parseli olan oyuncu başlangıç tarlası alamaz', async () => {
  const B = await kayit('eskiciftci');
  assert.equal((await B.c(`/api/parsel/${hucreBul('TARIM')}/edin`, {})).durum, 200);
  assert.equal((await B.c('/api/ben')).veri.baslangicTarlasi, false);
  assert.equal((await B.c('/api/baslangic/tarla', {})).durum, 409);
});
