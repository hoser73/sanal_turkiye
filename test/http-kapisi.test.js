// HTTP kapısı: siyaset kapalıyken büyük/küçük harf oyunu siyasi uçları açmaz; Express ve gövde ayrıştırıcı hataları 4xx
// (500 ve hata günlüğü değil); hız sınırı Türkçe JSON döner; istemci hata raporu boş olamaz; hata günlüğü döner.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ortamKur, istemciUret } = require('./yardimci');

const VERI = ortamKur('http-kapisi');
process.env.SIYASET = 'kapali';
const app = require('../server/index');

let sunucu, taban;
before(async () => {
  await new Promise((r) => { sunucu = app.listen(0, r); });
  taban = `http://127.0.0.1:${sunucu.address().port}`;
  await app.hazir;
});
after(() => { sunucu.close(); fs.rmSync(VERI, { recursive: true, force: true }); });
const istemci = istemciUret(() => taban);
const hataDosyasi = () => path.join(VERI, 'gunluk', 'hatalar.jsonl');
const sunucuHatasiVar = () => fs.existsSync(hataDosyasi()) && fs.readFileSync(hataDosyasi(), 'utf8').includes('sunucu hatası');

test('siyaset kapalıyken büyük harfli siyasi yollar da 404', async () => {
  const A = istemci();
  for (const yol of ['/api/Secim/1/aday', '/api/SECIM/1/oy', '/api/Mahalle/1/duyuru', '/api/Gorevden-Alma', '/api/GOREVDEN-ALMA/1/imza', '/api/Belediye/1/proje']) {
    const r = await A(yol, {});
    assert.equal(r.durum, 404, yol); assert.equal(r.veri.kod, 'KAPALI', yol);
  }
  assert.equal((await A('/api/Mahallelerim')).durum, 404);
});

test('bozuk yüzde kodlaması ve desteklenmeyen sıkıştırma 4xx; sunucu hatası günlüğe yazılmaz', async () => {
  for (const yol of ['/api/parsel/TR-%E0%A4%A', '/api/il/%ZZ/ilceler', '/api/karo/imar/%ZZ/1.png']) {
    const r = await fetch(taban + yol);
    assert.equal(r.status, 400, yol);
    assert.equal((await r.json()).hata, 'Geçersiz istek');
  }
  const r = await fetch(`${taban}/api/giris`, { method: 'POST', headers: { 'content-type': 'application/json', 'content-encoding': 'br2' }, body: '{}' });
  assert.ok(r.status >= 400 && r.status < 500, String(r.status));
  assert.equal(sunucuHatasiVar(), false);
});

test('istemci hata raporu: boş ileti reddedilir; hız sınırı Türkçe JSON döner', async () => {
  const gonder = (govde) => fetch(`${taban}/api/istemci-hata`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(govde) });
  assert.equal((await gonder({})).status, 400);
  assert.equal((await gonder({ ileti: { toString: 1 } })).status, 400);
  let son;
  for (let i = 0; i < 25; i++) son = await gonder({ ileti: 'deneme', surum: '1' });
  assert.equal(son.status, 429);
  assert.match(son.headers.get('content-type'), /json/);
  assert.equal((await son.json()).kod, 'HIZ_SINIRI');
});

test('hata günlüğü sınırı aşınca .1\'e taşınır; son hatalar dosyanın sonundan okunur', () => {
  const { gunluk, sonHatalar } = require('../server/lib/gunluk');
  fs.mkdirSync(path.dirname(hataDosyasi()), { recursive: true });
  fs.writeFileSync(hataDosyasi(), `${JSON.stringify({ ileti: 'eski'.repeat(25) })}\n`.repeat(60_000));   // > 5 MB
  gunluk.error('yeni hata', { deneme: 1 });
  assert.ok(fs.existsSync(`${hataDosyasi()}.1`));
  assert.ok(fs.statSync(hataDosyasi()).size < 1000);
  assert.equal(sonHatalar(5)[0].ileti, 'yeni hata');
  fs.writeFileSync(hataDosyasi(), `${JSON.stringify({ ileti: 'x'.repeat(100) })}\n`.repeat(5000));
  assert.equal(sonHatalar(10).length, 10);
});
