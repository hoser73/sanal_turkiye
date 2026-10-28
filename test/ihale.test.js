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

test('ihale: kendi teklifini yükseltmek yalnızca son teklifi kilitler; geçilen teklif hemen iade edilir', async () => {
  const l = (await (await oyuncu('ihc'))('/api/ihale')).veri;
  const i = l.ihaleler.find((x) => x.durum === 'ACIK');
  assert.ok(i, 'açık ihale');
  const a = await oyuncu('iha2'), b = await oyuncu('ihb2');
  const onceA = L.bakiye(a.id), onceB = L.bakiye(b.id);
  assert.equal((await b(`/api/ihale/${i.id}/teklif`, { tutar: i.taban })).durum, 200);
  const asgari = Math.ceil(i.taban * (1 + I.artis));
  assert.equal((await a(`/api/ihale/${i.id}/teklif`, { tutar: asgari })).durum, 200);
  assert.equal(Math.round(L.bakiye(b.id)), Math.round(onceB), 'geçilen teklif iade');
  // A kendi teklifini yükseltir: eski teklif iade, yenisi kilitlenir (kilitli toplam = yeni teklif)
  const yeni = Math.ceil(asgari * (1 + I.artis));
  assert.equal((await a(`/api/ihale/${i.id}/teklif`, { tutar: yeni })).durum, 200);
  assert.equal(Math.round(onceA - L.bakiye(a.id)), yeni, 'yalnızca son teklif emanette');
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM ihale_teklifleri WHERE ihale_id = ? AND durum = 'AKTIF'`).get(i.id).c, 1, 'tek aktif teklif');
  assert.equal(Math.round(L.hesapBakiye(`IHALE:${i.id}`)), yeni);
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM (SELECT tx_group FROM wallet_ledger GROUP BY tx_group HAVING ROUND(SUM(debit) - SUM(credit), 2) <> 0)`).get().c, 0);
});

test('ihale: önde olunan ihale parsel sınırına sayılır (sınırdaki lider başka parsel alamaz, sınırdaki oyuncu teklif veremez)', async () => {
  const H = require('../server/config/rules').HESAP, eskiSinir = H.maxParsel;
  const i = (await (await oyuncu('ihd'))('/api/ihale')).veri.ihaleler.find((x) => x.durum === 'ACIK');
  assert.ok(i, 'açık ihale');
  const a = await oyuncu('iha3'), b = await oyuncu('ihb3');
  const ust = db.prepare(`SELECT MAX(tutar) m FROM ihale_teklifleri WHERE ihale_id = ? AND durum = 'AKTIF'`).get(i.id).m;
  const tutar = ust ? Math.ceil(ust * (1 + I.artis)) : i.taban;
  H.maxParsel = 1;
  try {
    // B'nin bir parseli var: sınırda, teklif veremez
    assert.equal((await b(`/api/parsel/${hucreBul('TARIM')}/edin`, {})).durum, 200);
    assert.equal((await b(`/api/ihale/${i.id}/teklif`, { tutar })).veri.kod, 'PARSEL_SINIRI');
    // A parselsiz: teklif verir ve önde; artık başka parsel edinemez (ihale sınıra sayılır)
    assert.equal((await a(`/api/ihale/${i.id}/teklif`, { tutar })).durum, 200);
    const r = await a(`/api/parsel/${hucreBul('TARIM')}/edin`, {});
    assert.equal(r.durum, 409);
    assert.match(r.veri.hata, /ihale/);
    // İhale bitince A tarlayı alır (kendi ihalesi sınırdan düşülür)
    db.prepare('UPDATE ihaleler SET bitis = ? WHERE id = ?').run(Date.now() - 1, i.id);
    ihale.sonuclandir();
  } finally { H.maxParsel = eskiSinir; }
  assert.equal(db.prepare('SELECT owner_user_id FROM parcels WHERE id = ?').get(i.parsel).owner_user_id, a.id);
  assert.equal(db.prepare('SELECT durum FROM ihaleler WHERE id = ?').get(i.id).durum, 'SATILDI');
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
