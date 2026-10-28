// Canlılık: WebSocket kimliği ve Origin denetimi, anlık bildirim, sohbet kuralları ve canlı iletim, web push aboneliği.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const WebSocket = require('ws');
const { ortamKur, hucreBul } = require('./yardimci');

const VERI = ortamKur('canli');
const app = require('../server/index');
const db = require('../server/db');
const push = require('../server/push');

let sunucu, taban, host;
before(async () => {
  await new Promise((r) => { sunucu = app.listen(0, r); });
  app.canliBagla(sunucu);
  host = `127.0.0.1:${sunucu.address().port}`;
  taban = `http://${host}`;
  await app.hazir;
});
const soketler = [];
after(() => { for (const ws of soketler) ws.terminate(); sunucu.closeAllConnections?.(); sunucu.close(); fs.rmSync(VERI, { recursive: true, force: true }); });

function istemci() {
  let cerez = '';
  const c = async (yol, govde) => {
    const r = await fetch(taban + yol, { method: govde ? 'POST' : 'GET', headers: { 'content-type': 'application/json', cookie: cerez }, body: govde ? JSON.stringify(govde) : undefined });
    const sc = r.headers.get('set-cookie');
    if (sc) cerez = sc.split(';')[0];
    return { durum: r.status, veri: await r.json().catch(() => null) };
  };
  c.cerez = () => cerez;
  return c;
}
async function oyuncu(ad, ek = {}) {
  const c = istemci();
  assert.equal((await c('/api/kayit', { email: `${ad}@test.local`, sifre: 'parola123', dogumYili: 1990, kosullarOnay: true, kvkkOnay: true, ad, ...ek })).durum, 201);
  c.id = (await c('/api/ben')).veri.kullanici.id;
  return c;
}
// Gelen iletileri biriktiren WebSocket; bekle(tip) ilgili ileti gelene kadar bekler
function soket(c, origin = taban) {
  const ws = new WebSocket(`ws://${host}/canli`, { headers: { cookie: c?.cerez() || '', origin } });
  soketler.push(ws);
  const gelen = [];
  const bekleyen = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    gelen.push(m);
    for (const b of [...bekleyen]) if (b.kosul(m)) { bekleyen.splice(bekleyen.indexOf(b), 1); b.coz(m); }
  });
  ws.bekle = (kosul, ms = 2000) => new Promise((coz, red) => {
    const k = typeof kosul === 'string' ? (m) => m.tip === kosul : kosul;
    const hazir = gelen.find(k);
    if (hazir) return coz(hazir);
    bekleyen.push({ kosul: k, coz });
    setTimeout(() => red(new Error('İleti gelmedi')), ms);
  });
  ws.gelen = gelen;
  return new Promise((coz, red) => { ws.on('open', () => coz(ws)); ws.on('error', red); ws.on('unexpected-response', (_q, r) => red(new Error(`HTTP ${r.statusCode}`))); });
}
const ilId = () => db.prepare(`SELECT id FROM regions WHERE type = 'IL' AND plaka = '42'`).get().id;

test('WebSocket: oturum çereziyle kimlik; yabancı Origin reddedilir', async () => {
  const c = await oyuncu('soketci');
  const ws = await soket(c);
  const m = await ws.bekle('merhaba');
  assert.equal(m.kullanici.id, c.id);
  ws.close();
  const misafir = await soket(null);
  assert.equal((await misafir.bekle('merhaba')).kullanici, null);
  misafir.close();
  await assert.rejects(soket(c, 'https://kotu.example'), /403/);
  // Bozuk yüzde kodlamalı çerez sunucuyu düşürmez: misafir olarak bağlanır
  const bozuk = await soket({ cerez: () => 'st_oturum=%' });
  assert.equal((await bozuk.bekle('merhaba')).kullanici, null);
  bozuk.close();
});

test('bildirim anında canlı bağlantıya düşer', async () => {
  const c = await oyuncu('bildirimci');
  const ws = await soket(c);
  await ws.bekle('merhaba');
  require('../server/pazar').bildir(c.id, 'Test bildirimi', 'pazar:borsa');
  const b = await ws.bekle('bildirim');
  assert.equal(b.metin, 'Test bildirimi');
  assert.equal(b.link, 'pazar:borsa');
  ws.close();
});

test('sohbet: il meydanı canlı iletim, kişisel veri engeli, hız sınırı, mahalle kanalı sakinlere açık', async () => {
  const a = await oyuncu('ayse'), b = await oyuncu('bora');
  const kanal = `il:${ilId()}`;
  const wsB = await soket(b);
  await wsB.bekle('merhaba');
  wsB.send(JSON.stringify({ tip: 'abone', kanallar: [kanal, 'gecersiz:1'] }));
  await wsB.bekle((m) => m.tip === 'cevrimici' && m.kanal === kanal);

  const r = await a(`/api/sohbet/${kanal}`, { metin: 'Merhaba Konya, hasat nasıl gidiyor?' });
  assert.equal(r.durum, 200);
  const gelen = await wsB.bekle('sohbet');
  assert.equal(gelen.mesaj.metin, 'Merhaba Konya, hasat nasıl gidiyor?');
  assert.equal(gelen.mesaj.ben, false);
  assert.equal(gelen.mesaj.userId, undefined, 'kullanıcı kimliği yayılmaz');

  const tel = await a(`/api/sohbet/${kanal}`, { metin: 'beni ara 0532 111 22 33' });
  assert.equal(tel.durum, 422);
  const supheli = await a(`/api/sohbet/${kanal}`, { metin: 'sen ne salak bir tüccarsın' });
  assert.equal(supheli.veri.isaretlendi, true);
  for (let i = 0; i < 3; i++) await a(`/api/sohbet/${kanal}`, { metin: `mesaj ${i}` });
  assert.equal((await a(`/api/sohbet/${kanal}`, { metin: 'bir tane daha' })).durum, 429);

  const gecmis = (await b(`/api/sohbet/${kanal}`)).veri;
  assert.ok(gecmis.mesajlar.some((m) => m.metin.startsWith('Merhaba Konya')));
  assert.equal(gecmis.yazabilir, true);
  assert.equal((await istemci()(`/api/sohbet/${kanal}`)).veri.yazabilir, false, 'misafir okur, yazamaz');

  // Mahalle kanalı: yalnızca sakin yazar
  const c = await oyuncu('cemil');
  const h = hucreBul('TARIM');
  assert.equal((await c(`/api/parsel/${h}/edin`, {})).durum, 200);
  const mahalle = db.prepare(`SELECT region_id FROM parcels WHERE id = ?`).get(h).region_id;
  assert.equal((await c(`/api/sohbet/mahalle:${mahalle}`, { metin: 'Komşular merhaba' })).durum, 200);
  assert.equal((await b(`/api/sohbet/mahalle:${mahalle}`, { metin: 'Ben de buradayım' })).durum, 403);
  wsB.close();
});

test('genç hesapta sohbet varsayılan kapalı; moderatör mesajı gizleyince listeden düşer', async () => {
  const g = await oyuncu('gencoyuncu', { dogumYili: new Date().getUTCFullYear() - 15 });
  const kanal = `il:${ilId()}`;
  const r = await g(`/api/sohbet/${kanal}`, { metin: 'selam' });
  assert.equal(r.durum, 403);
  assert.match(r.veri.hata, /ayarın kapalı/);
  const m = db.prepare(`SELECT id FROM sohbet_mesajlari WHERE on_tarama IS NOT NULL LIMIT 1`).get();
  assert.ok(require('../server/moderasyon').panel(1).isaretliMesajlar.some((x) => x.id === m.id));
  db.prepare(`UPDATE sohbet_mesajlari SET gizlendi = 1 WHERE id = ?`).run(m.id);
  assert.ok(!(await g(`/api/sohbet/${kanal}`)).veri.mesajlar.some((x) => x.id === m.id));
});

test('web push: abonelik kaydı, bildirimde gönderim, geçersiz abonelik silinir', async () => {
  const c = await oyuncu('pushcu');
  assert.ok((await c('/api/push/anahtar')).veri.publicKey.length > 60);
  assert.equal((await c('/api/push/abone', { abonelik: { endpoint: 'http://duz.example/x', keys: { p256dh: 'a', auth: 'b' } } })).durum, 400, 'yalnızca https');
  const ab = { endpoint: 'https://push.example/abc', keys: { p256dh: 'BAAAA', auth: 'xyz' } };
  assert.equal((await c('/api/push/abone', { abonelik: ab })).durum, 200);
  const gonderilen = [];
  push.gondericiAyarla(async (abonelik, yuk) => { gonderilen.push({ abonelik, yuk: JSON.parse(yuk) }); });
  require('../server/pazar').bildir(c.id, 'Teklifin kabul edildi', 'parsel:TR-1');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(gonderilen.length, 1);
  assert.equal(gonderilen[0].abonelik.endpoint, ab.endpoint);
  assert.equal(gonderilen[0].yuk.metin, 'Teklifin kabul edildi');
  push.gondericiAyarla(async () => { const e = new Error('gitti'); e.statusCode = 410; throw e; });
  require('../server/pazar').bildir(c.id, 'İkinci', null);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM push_abonelikleri WHERE user_id = ?`).get(c.id).c, 0);
});

test('PWA: servis çalışanı ve çevrimdışı sayfası sunulur', async () => {
  const sw = await fetch(`${taban}/sw.js`);
  assert.equal(sw.status, 200);
  const metin = await sw.text();
  for (const yol of metin.match(/'\/[^']*'/g).map((x) => x.slice(1, -1)).filter((y) => !y.startsWith('/api') && y !== '/canli' && !y.includes('#') && /\.[a-z]+$/.test(y))) {
    if (yol === '/') continue;
    assert.equal((await fetch(taban + yol)).status, 200, `önbellek listesindeki ${yol} sunulmalı`);
  }
});

test('canlı dünya: herkese açık olay parsel konumunu taşır; eylemi yapanı söylemez, yalnızca alıcının kendisi mi', async () => {
  const a = await oyuncu('baloncu'), b = await oyuncu('izleyici');
  const [wa, wb, wz] = await Promise.all([soket(a), soket(b), soket(null)]);
  await Promise.all([wa.bekle('merhaba'), wb.bekle('merhaba'), wz.bekle('merhaba')]);
  const id = hucreBul('TARIM');
  assert.equal((await a(`/api/parsel/${id}/edin`, {})).durum, 200);
  const k = (m) => m.tip === 'olay' && m.eylem === 'PARCEL_ACQUIRED' && m.parsel === id;
  const [ma, mb, mz] = await Promise.all([wa.bekle(k), wb.bekle(k), wz.bekle(k)]);
  assert.equal(ma.ben, true);
  assert.equal(mb.ben, false);
  assert.equal(mz.ben, false, 'ziyaretçi');
  for (const m of [ma, mb, mz]) assert.deepEqual(Object.keys(m).sort(), ['ben', 'bolge', 'eylem', 'parsel', 'tip']);
});
