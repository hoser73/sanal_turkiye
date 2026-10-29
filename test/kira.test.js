// Tarla kiralama (kira.js): ekin/kira çakışması, dondurulmuş parsel, kira bitince kiracının kendi ekinini hasadı.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { ortamKur, istemciUret, hucreBul } = require('./yardimci');

const VERI = ortamKur('kira');
const app = require('../server/index');
const db = require('../server/db');
const L = require('../server/lib/ledger');

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
  return c;
}
const olgunlastir = (p) => db.run(`UPDATE crops SET ready_at = ? WHERE parcel_id = ? AND status = 'GROWING'`, Date.now() - 1, p);

let A, K, p;
test('ekinli tarla kiraya verilemez; teklif sonrası ekilirse kiralama bedel alınmadan reddedilir', async () => {
  [A, K] = [await oyuncu('sahip'), await oyuncu('kiraci')];
  p = hucreBul('TARIM');
  assert.equal((await A(`/api/parsel/${p}/edin`, {})).durum, 200);
  assert.equal((await A(`/api/parsel/${p}/ek`, { urun: 'BUGDAY' })).durum, 200);
  const r = await A(`/api/parsel/${p}/kira`, { gunluk: 10, gun: 2 });
  assert.equal(r.durum, 409);
  assert.match(r.veri.hata, /ekin/);
  await olgunlastir(p);
  assert.equal((await A(`/api/parsel/${p}/hasat`, {})).durum, 200);

  const kr = await A(`/api/parsel/${p}/kira`, { gunluk: 10, gun: 2 });
  assert.equal(kr.durum, 200);
  assert.equal((await A(`/api/parsel/${p}/ek`, { urun: 'BUGDAY' })).durum, 200, 'teklif beklerken sahip hâlâ ekebilir');
  const once = await L.bakiye(K.id);
  assert.equal((await K(`/api/kira/${kr.veri.id}/kirala`, {})).durum, 409);
  assert.equal(await L.bakiye(K.id), once);
  await olgunlastir(p);
  assert.equal((await A(`/api/parsel/${p}/hasat`, {})).durum, 200);
});

test('dondurulmuş parsel kiralanamaz; bedel alınmaz', async () => {
  const kr = await db.get(`SELECT id FROM kiralar WHERE parcel_id = ? AND durum = 'TEKLIF'`, p);
  await db.run(`UPDATE parcels SET status = 'FROZEN' WHERE id = ?`, p);
  const once = await L.bakiye(K.id);
  assert.equal((await K(`/api/kira/${kr.id}/kirala`, {})).durum, 423);
  assert.equal(await L.bakiye(K.id), once);
  assert.equal((await db.get('SELECT durum FROM kiralar WHERE id = ?', kr.id)).durum, 'TEKLIF');
  await db.run(`UPDATE parcels SET status = 'ACTIVE' WHERE id = ?`, p);
});

test('kira bitince kiracı kendi ektiği ekini hasat eder; yeni ekin ekemez, sahibi de kiraya veremez', async () => {
  const kr = await db.get(`SELECT id FROM kiralar WHERE parcel_id = ? AND durum = 'TEKLIF'`, p);
  assert.equal((await K(`/api/kira/${kr.id}/kirala`, {})).durum, 200);
  assert.equal((await K(`/api/parsel/${p}/ek`, { urun: 'BUGDAY' })).durum, 200);
  await db.run('UPDATE kiralar SET bitis = ? WHERE id = ?', Date.now() - 1, kr.id);
  await A('/api/ben');   // bakım: kira biter
  assert.equal((await db.get('SELECT durum FROM kiralar WHERE id = ?', kr.id)).durum, 'BITTI');
  assert.equal((await A(`/api/parsel/${p}/kira`, { gunluk: 10, gun: 2 })).durum, 409, 'kiracının ekini dururken yeniden kiraya verilemez');
  await olgunlastir(p);
  const once = await L.envanterMiktar(K.id, 'BUGDAY');
  const h = await K(`/api/parsel/${p}/hasat`, {});
  assert.equal(h.durum, 200, JSON.stringify(h.veri));
  assert.equal(await L.envanterMiktar(K.id, 'BUGDAY'), once + h.veri.miktar);
  assert.equal((await K(`/api/parsel/${p}/ek`, { urun: 'BUGDAY' })).durum, 403, 'kira bitti: yeni ekim hakkı yok');
  assert.equal((await A(`/api/parsel/${p}/ek`, { urun: 'BUGDAY' })).durum, 200, 'kullanım hakkı sahibinde');
});
