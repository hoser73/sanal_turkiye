// Siyaset ayarı (OZELLIK.siyaset): kapalıyken seçim, muhtarlık, belediye, referandum ve görevden alma uçları kapalı;
// kurallar istemciye ayarı bildirir, haber akışında siyasi olay görünmez.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { ortamKur, istemciUret } = require('./yardimci');

const VERI = ortamKur('siyaset');
process.env.SIYASET = 'kapali';
const app = require('../server/index');
const L = require('../server/lib/ledger');

let sunucu, taban;
before(async () => {
  await new Promise((r) => { sunucu = app.listen(0, r); });
  taban = `http://127.0.0.1:${sunucu.address().port}`;
  await app.hazir;
});
after(() => { sunucu.close(); fs.rmSync(VERI, { recursive: true, force: true }); });
const istemci = istemciUret(() => taban);

test('siyaset kapalıyken uçlar 404, kurallar ayarı bildirir, akışta siyasi olay yok', async () => {
  const A = istemci();
  assert.equal((await A('/api/kurallar')).veri.ozellikler.siyaset, false);
  for (const yol of ['/api/mahalle/1', '/api/belediye/1', '/api/mahallelerim', '/api/harita/secimler?bbox=32,37,33,38']) {
    assert.equal((await A(yol)).durum, 404, yol);
  }
  assert.equal((await A('/api/secim/1/oy', {})).durum, 404);
  assert.equal((await A('/api/gorevden-alma', {})).durum, 404);
  L.denetim({ eylem: 'ELECTION_ANNOUNCED', varlik: 'SECIM:1', herkese: true, sonra: {} });
  L.denetim({ eylem: 'CROP_HARVESTED', varlik: 'PARSEL:x', herkese: true, sonra: {} });
  const akis = (await A('/api/akis')).veri;
  assert.ok(!akis.some((a) => a.action === 'ELECTION_ANNOUNCED'));
  assert.ok(akis.some((a) => a.action === 'CROP_HARVESTED'));
});
