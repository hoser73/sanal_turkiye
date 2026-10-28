// Haftalık arazi ihalesi (ihale.js) ve fiyat alarmı (alarm.js).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { ortamKur, istemciUret, hucreBul } = require('./yardimci');

const VERI = ortamKur('ihale');
const app = require('../server/index');
const db = require('../server/db');
const L = require('../server/lib/ledger');
const ihale = require('../server/ihale');
const alarm = require('../server/alarm');
const { IHALE: I } = require('../server/config/rules');

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

test('ihale: hafta kurulur, ihaledeki tarla edinilemez, teklif emanete geçer, geçilen iade, kazanan tarlayı alır', async () => {
  const a = await oyuncu('ihaleci'), b = await oyuncu('rakip');
  const l = (await a('/api/ihale')).veri;
  assert.ok(l.ihaleler.length >= 1, 'en az bir tarla ihalede');
  assert.equal((await a('/api/ihale')).veri.ihaleler.length, l.ihaleler.length, 'hafta bir kez kurulur');
  const i = l.ihaleler[0];
  assert.equal((await a(`/api/parsel/${i.parsel}/edin`, {})).veri.kod, 'IHALEDE');
  assert.equal((await a(`/api/ihale/${i.id}/teklif`, { tutar: i.taban - 1 })).veri.kod, 'DUSUK');
  const onceA = L.bakiye(a.id), onceB = L.bakiye(b.id);
  assert.equal((await a(`/api/ihale/${i.id}/teklif`, { tutar: i.taban })).durum, 200);
  assert.equal(Math.round(onceA - L.bakiye(a.id)), i.taban, 'teklif emanette');
  const asgari = Math.ceil(i.taban * (1 + I.artis));
  assert.equal((await b(`/api/ihale/${i.id}/teklif`, { tutar: asgari - 1 })).veri.kod, 'DUSUK');
  assert.equal((await b(`/api/ihale/${i.id}/teklif`, { tutar: asgari })).durum, 200);
  assert.equal(Math.round(L.bakiye(a.id)), Math.round(onceA), 'geçilen teklif iade');
  const g = (await b('/api/ihale')).veri.ihaleler.find((x) => x.id === i.id);
  assert.equal(g.liderBen, true); assert.equal(g.enYuksek, asgari);
  // Bitir ve sonuçlandır
  db.prepare('UPDATE ihaleler SET bitis = ? WHERE id = ?').run(Date.now() - 1, i.id);
  ihale.sonuclandir();
  assert.equal(db.prepare('SELECT owner_user_id FROM parcels WHERE id = ?').get(i.parsel).owner_user_id, b.id);
  const ilkParsel = require('../server/config/rules').GOREVLER.find((x) => x.kod === 'ILK_PARSEL').odul;   // ilk parsel görevi ödülü
  assert.equal(Math.round(onceB - L.bakiye(b.id)), asgari - ilkParsel);
  assert.equal(Math.round(L.hesapBakiye(`IHALE:${i.id}`)), 0, 'emanet boşaldı');
  assert.equal(db.prepare('SELECT durum, fiyat FROM ihaleler WHERE id = ?').get(i.id).durum, 'SATILDI');
});

test('fiyat alarmı: hedef yönü kendiliğinden; endeks hedefe ulaşınca bir kez bildirim; sınır', async () => {
  const c = await oyuncu('alarmci');
  const h = hucreBul('TARIM');
  await c(`/api/parsel/${h}/edin`, {});
  const bolge = db.prepare('SELECT region_id FROM parcels WHERE id = ?').get(h).region_id;
  require('../server/piyasa').endeksKaydet(Date.now());
  const e = require('../server/piyasa').endeksSerisi('MAHALLE', bolge, 1).endeks;
  assert.ok(e > 0);
  const r = (await c('/api/alarm', { bolgeId: bolge, hedef: Math.floor(e) - 1 })).veri;
  assert.equal(r.yon, 'ASAGI');
  const yukari = (await c('/api/alarm', { bolgeId: bolge, hedef: e + 50 })).veri;
  assert.equal(yukari.yon, 'YUKARI');
  // Aşağı alarmın hedefi zaten karşılanmış sayılsın: hedefi endeksin üstüne çek
  db.prepare('UPDATE fiyat_alarmlari SET hedef = ? WHERE id = ?').run(e + 1, r.id);
  alarm.alarmBakim(Date.now() + 120_000);
  const l = (await c('/api/alarm')).veri;
  assert.ok(l.find((x) => x.id === r.id).tetiklendi);
  assert.ok(!l.find((x) => x.id === yukari.id).tetiklendi);
  assert.ok((await c('/api/bildirimler')).veri.some((x) => /endeksi/.test(x.text)));
  assert.equal((await c(`/api/alarm/${yukari.id}/sil`, {})).durum, 200);
});
