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
  assert.equal((await db.get(`SELECT r.plaka FROM parcels p JOIN regions r ON r.id = p.il_id WHERE p.id = ?`, trabzon)).plaka, '61');
  const ek = await c(`/api/parsel/${trabzon}/ek`, { urun: 'FINDIK' });
  assert.equal(ek.durum, 200);
  const e = await db.get(`SELECT * FROM crops WHERE parcel_id = ? AND status = 'GROWING'`, trabzon);
  assert.equal(e.ready_at - e.planted_at, Math.round(URUNLER.FINDIK.sureMs * ek.veri.buyume));
});

test('mevsim: kışın açık tarla yavaş büyür, sera mevsimden etkilenmez', async () => {
  const ocak = Date.UTC(2027, 0, 15, 12);
  assert.equal(dunya.mevsim(ocak).kod, 'KIS');
  assert.equal(dunya.mevsim(Date.UTC(2027, 6, 15)).kod, 'YAZ');
  assert.ok(await dunya.buyumeKati('DOMATES', false, ocak) > 1.5);
  assert.equal(await dunya.buyumeKati('DOMATES', true, ocak), 1);
  assert.equal(await dunya.buyumeKati('BUGDAY', false, ocak), 1, 'kışlık buğday');
});

test('gerçek hava: yağmur açık tarlayı sular, don hassas ürünün verimini düşürür, sera korur', async () => {
  const c = await oyuncu('havaci');
  const h1 = hucreBul('TARIM'), h2 = hucreBul('TARIM');
  for (const h of [h1, h2]) { await c(`/api/parsel/${h}/edin`, {}); await c(`/api/parsel/${h}/ek`, { urun: 'DOMATES' }); }
  // h2'de sera var
  const t0 = Date.now();
  await db.run(`INSERT INTO structures (parcel_id, owner_user_id, type, status, started_at, completes_at, completed_at) VALUES (?, ?, 'SERA', 'ACTIVE', ?, ?, ?)`, h2, c.id, t0, t0, t0);
  const plaka = (await db.get(`SELECT r.plaka FROM parcels p JOIN regions r ON r.id = p.il_id WHERE p.id = ?`, h1)).plaka;
  const sonuc = await dunya.uygula({ plaka, sicaklik: -3, yagis: 2.5, kod: 63, ruzgar: 12, gunduz: 0 });
  assert.ok(sonuc.sulanan >= 1);
  const e1 = await db.get(`SELECT * FROM crops WHERE parcel_id = ? AND status = 'GROWING'`, h1);
  const e2 = await db.get(`SELECT * FROM crops WHERE parcel_id = ? AND status = 'GROWING'`, h2);
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
  await db.run(`UPDATE crops SET ready_at = ?, waterings = 3 WHERE id IN (?, ?)`, Date.now() - 1000, e1.id, e2.id);
  const r1 = (await c(`/api/parsel/${h1}/hasat`, {})).veri;
  await db.run(`DELETE FROM structures WHERE parcel_id = ?`, h2);
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

test('memleket: seçilir, 30 gün değişmez; hemşehri ve gurbet sayılır', async () => {
  const c = await oyuncu('gurbetci');
  assert.equal((await c('/api/hesap/memleket', { plaka: '61' })).durum, 200);
  assert.equal((await c('/api/hesap/memleket', { plaka: '34' })).durum, 409, '30 gün dolmadan değişmez');
  assert.equal((await c('/api/ben')).veri.hesap.memleket.ad, 'Trabzon');
  await c(`/api/parsel/${hucreBul('TARIM')}/edin`, {});
  const m = (await c('/api/memleket/61')).veri;
  assert.ok(m.hemsehri >= 1);
  assert.ok(m.gurbette >= 1);
  assert.equal(m.benimMemleketim, true);
  assert.equal((await c('/api/lig')).durum, 404, 'eski il ligi kaldırıldı');
});

test('aşırı sıcak: açık tarlanın sulaması gider; seralı tarla ve olgun ekin etkilenmez; bildirim afete göre', async () => {
  const c = await oyuncu('sicakci');
  await db.tx(() => require('../server/lib/ledger').odul(c.id, 2000, 'test bakiyesi'));
  const [acik, seralı, olgun] = [hucreBul('TARIM'), hucreBul('TARIM'), hucreBul('TARIM')];
  for (const h of [acik, seralı, olgun]) { await c(`/api/parsel/${h}/edin`, {}); await c(`/api/parsel/${h}/ek`, { urun: 'DOMATES' }); }
  const t0 = Date.now();
  await db.run(`INSERT INTO structures (parcel_id, owner_user_id, type, status, started_at, completes_at, completed_at) VALUES (?, ?, 'SERA', 'ACTIVE', ?, ?, ?)`, seralı, c.id, t0, t0, t0);
  await db.run(`UPDATE crops SET waterings = 2 WHERE parcel_id IN (?, ?, ?) AND status = 'GROWING'`, acik, seralı, olgun);
  await db.run(`UPDATE crops SET ready_at = ? WHERE parcel_id = ? AND status = 'GROWING'`, t0 - 1000, olgun);
  const plakalar = new Set();
  for (const h of [acik, seralı, olgun]) plakalar.add((await db.get(`SELECT r.plaka FROM parcels p JOIN regions r ON r.id = p.il_id WHERE p.id = ?`, h)).plaka);
  for (const plaka of plakalar) await dunya.afetleriUygula({ plaka, sicaklik: 41, yagis: 0, kod: 0, ruzgar: 5 }, Date.now());
  const sulama = async (h) => (await db.get(`SELECT waterings FROM crops WHERE parcel_id = ? AND status = 'GROWING'`, h)).waterings;
  assert.equal(await sulama(acik), 1);
  assert.equal(await sulama(seralı), 2, 'sera korur');
  assert.equal(await sulama(olgun), 2, 'olgun ekin etkilenmez');
  const b = (await c('/api/bildirimler')).veri.find((x) => x.text.startsWith('🔥'));
  assert.ok(b && b.text.includes('Sera ve sulama hattı korur'), b?.text);
});
