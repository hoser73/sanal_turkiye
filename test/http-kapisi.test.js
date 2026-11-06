// HTTP kapısı: kaldırılan siyasi uçlar (v0.47) büyük/küçük harfle de yok; Express ve gövde ayrıştırıcı hataları 4xx
// (500 ve hata günlüğü değil); hız sınırı Türkçe JSON döner; istemci hata raporu boş olamaz; hata günlüğü döner;
// başka kökenden gelen yazma isteği reddedilir; güvenlik başlıkları ve çerez bayrakları; sağlık ucu.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ortamKur, istemciUret } = require('./yardimci');

const VERI = ortamKur('http-kapisi');
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

test('kaldırılan siyasi uçlar büyük harfle de 404', async () => {
  const A = istemci();
  for (const yol of ['/api/Secim/1/aday', '/api/SECIM/1/oy', '/api/Mahalle/1/duyuru', '/api/Gorevden-Alma', '/api/GOREVDEN-ALMA/1/imza', '/api/Belediye/1/proje', '/api/belediye/1/referandum']) {
    assert.equal((await A(yol, {})).durum, 404, yol);
  }
  assert.equal((await A('/api/Mahallelerim')).durum, 404);
  assert.ok(!sunucuHatasiVar());
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

test('başka siteden gelen durum değiştiren istek reddedilir; aynı köken, Origin\'siz istek ve Apple dönüşü geçer', async () => {
  const post = (yol, origin, govde = {}) => fetch(taban + yol, { method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(govde) });
  const kotu = await post('/api/cikis', 'https://kotu.example');
  assert.equal(kotu.status, 403);
  assert.equal((await kotu.json()).kod, 'KOKEN');
  assert.equal((await post('/api/cikis', 'null')).status, 403, 'Origin: null de yabancı sayılır');
  assert.equal((await post('/api/cikis', taban)).status, 200);
  assert.equal((await post('/api/cikis')).status, 200, 'Origin göndermeyen istemci (eski tarayıcı, uygulama içi)');
  assert.equal((await fetch(`${taban}/api/kurallar`, { headers: { origin: 'https://kotu.example' } })).status, 200, 'GET serbest');
  const apple = await fetch(`${taban}/api/oauth/apple/donus`, { method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://appleid.apple.com' }, body: 'state=x&code=y' });
  assert.equal(apple.status, 303, 'Apple form_post dönüşü köken denetimine takılmaz');
});

test('güvenlik başlıkları ve oturum çerezi', async () => {
  const r = await fetch(`${taban}/`);
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /script-src 'self'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer', 'doğrulama/sıfırlama jetonu adres çubuğundayken dışarı sızmasın');
  const k = await fetch(`${taban}/api/kayit`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'cerez@test.local', sifre: 'parola123', dogumYili: 1990, kosullarOnay: true, kvkkOnay: true, ad: 'Çerezci' }) });
  assert.equal(k.status, 201);
  const cerez = k.headers.get('set-cookie');
  assert.match(cerez, /st_oturum=/);
  assert.match(cerez, /HttpOnly/i);
  assert.match(cerez, /SameSite=Lax/i);
});

test('sağlık ucu önbelleğe alınmaz ve veritabanını yoklar', async () => {
  const r = await fetch(`${taban}/api/saglik`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal((await r.json()).durum, 'iyi');
});
