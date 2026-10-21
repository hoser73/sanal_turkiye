// Yaşayan dünya: yöresel ürünler, mevsim çarpanı, gerçek hava etkileri (yağmur, don), il ligi, gurbet puanı, sezon rozeti, memleket.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { ortamKur, istemciUret, hucreBul } = require('./yardimci');

const VERI = ortamKur('dunya');
const app = require('../server/index');
const db = require('../server/db');
const dunya = require('../server/dunya');
const { LIG, HAVA, URUNLER } = require('../server/config/rules');

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
const TRABZON = [39.61, 40.81];

test('yöresel ürün yalnızca kendi bölgesinde ekilir; kart uygunluğu ve mevsim çarpanını gösterir', async () => {
  const c = await oyuncu('yoresel');
  const konya = hucreBul('TARIM');
  await c(`/api/parsel/${konya}/edin`, {});
  const red = await c(`/api/parsel/${konya}/ek`, { urun: 'FINDIK' });
  assert.equal(red.durum, 422);
  assert.equal(red.veri.kod, 'BOLGE_DISI');
  const kart = (await c(`/api/parsel/${konya}`)).veri;
  assert.equal(kart.urunSecenekleri.find((u) => u.kod === 'FINDIK').uygun, false);
  assert.ok(kart.mevsim.ad);

  const trabzon = hucreBul('TARIM', TRABZON);
  assert.equal((await c(`/api/parsel/${trabzon}/edin`, {})).durum, 200);
  assert.equal(db.prepare(`SELECT r.plaka FROM parcels p JOIN regions r ON r.id = p.il_id WHERE p.id = ?`).get(trabzon).plaka, '61');
  const ek = await c(`/api/parsel/${trabzon}/ek`, { urun: 'FINDIK' });
  assert.equal(ek.durum, 200);
  const e = db.prepare(`SELECT * FROM crops WHERE parcel_id = ? AND status = 'GROWING'`).get(trabzon);
  assert.equal(e.ready_at - e.planted_at, Math.round(URUNLER.FINDIK.sureMs * ek.veri.buyume));
});

test('mevsim: kışın açık tarla yavaş büyür, sera mevsimden etkilenmez', () => {
  const ocak = Date.UTC(2027, 0, 15, 12);
  assert.equal(dunya.mevsim(ocak).kod, 'KIS');
  assert.equal(dunya.mevsim(Date.UTC(2027, 6, 15)).kod, 'YAZ');
  assert.ok(dunya.buyumeKati('DOMATES', false, ocak) > 1.5);
  assert.equal(dunya.buyumeKati('DOMATES', true, ocak), 1);
  assert.equal(dunya.buyumeKati('BUGDAY', false, ocak), 1, 'kışlık buğday');
});

test('gerçek hava: yağmur açık tarlayı sular, don hassas ürünün verimini düşürür, sera korur', async () => {
  const c = await oyuncu('havaci');
  const h1 = hucreBul('TARIM'), h2 = hucreBul('TARIM');
  for (const h of [h1, h2]) { await c(`/api/parsel/${h}/edin`, {}); await c(`/api/parsel/${h}/ek`, { urun: 'DOMATES' }); }
  // h2'de sera var
  const t0 = Date.now();
  db.prepare(`INSERT INTO structures (parcel_id, owner_user_id, type, status, started_at, completes_at, completed_at) VALUES (?, ?, 'SERA', 'ACTIVE', ?, ?, ?)`).run(h2, c.id, t0, t0, t0);
  const plaka = db.prepare(`SELECT r.plaka FROM parcels p JOIN regions r ON r.id = p.il_id WHERE p.id = ?`).get(h1).plaka;
  const sonuc = dunya.uygula({ plaka, sicaklik: -3, yagis: 2.5, kod: 63, ruzgar: 12, gunduz: 0 });
  assert.ok(sonuc.sulanan >= 1);
  const e1 = db.prepare(`SELECT * FROM crops WHERE parcel_id = ? AND status = 'GROWING'`).get(h1);
  const e2 = db.prepare(`SELECT * FROM crops WHERE parcel_id = ? AND status = 'GROWING'`).get(h2);
  assert.equal(e1.waterings, 1);
  assert.ok(e1.yagmur_at);
  assert.equal(e1.don, 1);
  assert.equal(e2.don, 0, 'sera dondan korur');
  assert.equal(e2.waterings, 0, 'sera yağmurla sulanmaz');
  assert.ok((await c('/api/bildirimler')).veri.some((b) => b.text.startsWith('❄️ Don')));
  const kart = (await c(`/api/parsel/${h1}`)).veri;
  assert.equal(kart.ekin.don, true);
  assert.equal(kart.hava.ikon, '🌧️');
  // Hasat verimi don katsayısıyla düşer
  db.prepare(`UPDATE crops SET ready_at = ?, waterings = 3 WHERE id IN (?, ?)`).run(Date.now() - 1000, e1.id, e2.id);
  const r1 = (await c(`/api/parsel/${h1}/hasat`, {})).veri;
  db.prepare(`DELETE FROM structures WHERE parcel_id = ?`).run(h2);
  const r2 = (await c(`/api/parsel/${h2}/hasat`, {})).veri;
  assert.equal(r1.miktar, Math.max(1, Math.round(r2.miktar * HAVA.donVerimKati)));
});

test('hava listesi: 81 il, mevsim ve atıf', async () => {
  await dunya.havaBakim();
  const h = (await istemci()('/api/hava')).veri;
  assert.equal(h.iller.length, 81);
  assert.match(h.kaynak, /Open-Meteo/);
  assert.ok(h.iller.every((x) => x.ikon && Number.isFinite(x.sicaklik)));
});

test('il ligi: eylemler ilin puanına yazılır; gurbetçi memleketine yarım puan taşır; memleket değişimi sınırlı', async () => {
  const c = await oyuncu('gurbetci');
  assert.equal((await c('/api/hesap/memleket', { plaka: '61' })).durum, 200);
  assert.equal((await c('/api/hesap/memleket', { plaka: '34' })).durum, 409, '30 gün dolmadan değişmez');
  assert.equal((await c('/api/ben')).veri.hesap.memleket.ad, 'Trabzon');
  const h = hucreBul('TARIM');
  await c(`/api/parsel/${h}/edin`, {});
  const lig = (await c('/api/lig')).veri;
  const konya = lig.tablo.find((x) => x.plaka === '42');
  const trabzon = lig.tablo.find((x) => x.plaka === '61');
  assert.ok(konya.puan >= LIG.puanlar.PARCEL_ACQUIRED);
  assert.ok(trabzon, 'memleket gurbet puanı aldı');
  assert.ok(lig.benimKatkim.some((k) => k.il === 'Konya'));
  assert.equal(lig.memleket, '61');
  const m = (await c('/api/memleket/61')).veri;
  assert.ok(m.hemsehri >= 1);
  assert.ok(m.gurbette >= 1);
  assert.equal(m.benimMemleketim, true);
});

test('sezon kapanınca sonuç yazılır ve ilk üç ilin katkı verenlerine rozet verilir', async () => {
  const c = await oyuncu('sampiyon');
  for (let i = 0; i < 3; i++) { const h = hucreBul('TARIM', [29.0, 41.05]); await c(`/api/parsel/${h}/edin`, {}); }
  const n = dunya.sezonNo();
  const gercek = Date.now;
  Date.now = () => gercek() + LIG.sezonMs;   // bir sonraki sezona geç
  try { dunya.sezonBakim(); dunya.sezonBakim(); } finally { Date.now = gercek; }
  const sonuc = db.prepare(`SELECT * FROM sezon_sonuclari WHERE sezon = ? ORDER BY sira`).all(n);
  assert.ok(sonuc.length >= 2);
  assert.equal(sonuc[0].sira, 1);
  const rozet = (await c('/api/rozetlerim')).veri;
  const istanbul = sonuc.find((x) => db.prepare(`SELECT plaka FROM regions WHERE id = ?`).get(x.il_id).plaka === '34');
  if (istanbul.sira <= 3) assert.ok(rozet.some((r) => r.kod === `SEZON_${n}_34`));
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM audit_events WHERE action = 'SEASON_CLOSED' AND entity = ?`).get(`SEZON:${n}`).c, 1, 'sezon bir kez kapanır');
});
