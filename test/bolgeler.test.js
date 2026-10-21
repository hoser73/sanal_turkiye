// İl → ilçe → mahalle gezintisi: ilin ilçe sınırları, ilçenin oyun kuralıyla çıkarılan mahalle alanları,
// haritada tıklanan mahallenin oyun bölgesi olarak açılması.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { ortamKur, istemciUret, hucreBul } = require('./yardimci');

const VERI = ortamKur('bolgeler');
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

test('ilin ilçeleri: Konya 31 ilçe, sadeleştirilmiş poligon ve bölge kimliği', async () => {
  const r = await fetch(`${taban}/api/il/42/ilceler`);
  assert.equal(r.status, 200);
  const fc = await r.json();
  assert.equal(fc.features.length, 31);
  const meram = fc.features.find((f) => f.properties.ad === 'Meram');
  assert.ok(meram && ['Polygon', 'MultiPolygon'].includes(meram.geometry.type));
  assert.equal(meram.id, db.prepare(`SELECT id FROM regions WHERE code = 'TR-42-meram'`).get().id);
  assert.equal((await fetch(`${taban}/api/il/99/ilceler`)).status, 404);
});

test('ilçenin mahalle alanları oyunun mahalle atamasıyla aynıdır; tıklanan mahalle bölge olarak açılır', async () => {
  // Bir parsel edinmek ilçenin yerleşim noktalarını (sahte karo kaynağında) doldurur
  const c = istemci();
  await c('/api/kayit', { email: 'bolge@test.local', sifre: 'parola123', ad: 'Bölgeci', dogumYili: 1990, kosullarOnay: true, kvkkOnay: true });
  const h = hucreBul('TARIM');
  assert.equal((await c(`/api/parsel/${h}/edin`, {})).durum, 200);
  const p = db.prepare(`SELECT p.region_id, p.ilce_id, r.name FROM parcels p JOIN regions r ON r.id = p.region_id WHERE p.id = ?`).get(h);
  const fc = await (await fetch(`${taban}/api/ilce/${p.ilce_id}/mahalleler`)).json();
  const alanlar = fc.features.filter((f) => f.properties.tur === 'alan');
  assert.ok(alanlar.length >= 1);
  assert.ok(fc.features.some((f) => f.properties.tur === 'ad'));
  // Parselin mahallesi haritadaki alanlardan biridir ve tıklayınca aynı bölge döner
  const alan = alanlar.find((f) => f.properties.ad === p.name);
  assert.ok(alan, `${p.name} alanı haritada`);
  const ac = await fetch(`${taban}/api/ilce/${p.ilce_id}/mahalle`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ yerId: alan.properties.yerId }) });
  assert.equal((await ac.json()).id, p.region_id);
});
