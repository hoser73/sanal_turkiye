// Ekonomi: ekin tazeliği/çürüme, yapı yıpranması ve bakım, depoda bozulma, ürün borsası (emir defteri), ekonomi gözlemi.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { ortamKur, istemciUret, hucreBul } = require('./yardimci');

const VERI = ortamKur('ekonomi');
const app = require('../server/index');
const db = require('../server/db');
const L = require('../server/lib/ledger');
const { BOZULMA, BAKIM, YAPILAR } = require('../server/config/rules');

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
const urunVer = (userId, urun, adet) => db.tx(() => L.envanterDegis(userId, urun, adet, 'Test stoku'));
const stok = (userId, urun) => L.envanterMiktar(userId, urun);

test('olgun ekin önce taze kalır, sonra verimi düşer, sonunda tarlada çürür', async () => {
  const c = await oyuncu('ciftci');
  const h1 = hucreBul('TARIM');
  assert.equal((await c(`/api/parsel/${h1}/edin`, {})).durum, 200);
  assert.equal((await c(`/api/parsel/${h1}/ek`, { urun: 'BUGDAY' })).durum, 200);
  const kaydir = (ms) => db.run(`UPDATE crops SET planted_at = planted_at - ?, ready_at = ready_at - ? WHERE parcel_id = ? AND status = 'GROWING'`, ms, ms, h1);
  // Bozulma süresinin yarısı: verim ~%65
  await kaydir(BOZULMA.tazeMs + BOZULMA.bozulmaMs / 2 + 500);
  const kart = (await c(`/api/parsel/${h1}`)).veri;
  assert.equal(kart.ekin.tazelik, 'BOZULUYOR');
  assert.ok(kart.ekin.verimOrani > 0.6 && kart.ekin.verimOrani < 0.7);
  const r = (await c(`/api/parsel/${h1}/hasat`, {})).veri;
  assert.ok(r.miktar > 0 && r.verimOrani < 0.7);

  assert.equal((await c(`/api/parsel/${h1}/ek`, { urun: 'DOMATES' })).durum, 200);
  await kaydir(BOZULMA.tazeMs + BOZULMA.bozulmaMs + 10 * 60_000);
  assert.equal((await c(`/api/parsel/${h1}`)).veri.ekin.tazelik, 'CURUDU');
  const once = await stok(c.id, 'DOMATES');
  const cur = (await c(`/api/parsel/${h1}/hasat`, {})).veri;
  assert.equal(cur.curudu, true);
  assert.equal(await stok(c.id, 'DOMATES'), once);
  assert.equal((await c(`/api/parsel/${h1}`)).veri.ekin, null, 'tarla temizlendi');
});

test('yapılar yıpranır; eşiğin altında etkisi kesilir; bakım ücretli ve belediye payı ayrılır', async () => {
  const c = await oyuncu('bakimci');
  const h = hucreBul('TARIM');
  await c(`/api/parsel/${h}/edin`, {});
  assert.equal((await c(`/api/parsel/${h}/insaat`, { tip: 'SULAMA_HATTI' })).durum, 200);
  await db.run(`UPDATE structures SET status = 'ACTIVE', completed_at = ? WHERE parcel_id = ?`, Date.now() - 25 * BAKIM.gunMs, h);
  const kart = (await c(`/api/parsel/${h}`)).veri;
  const y = kart.yapilar[0];
  assert.equal(y.saglik, 100 - 25 * BAKIM.yipranmaGunluk);
  assert.equal(y.etkisiz, true, 'sağlık 25 < 40');
  // Bakımsız sulama hattı otomatik sulamaz
  assert.equal((await c(`/api/parsel/${h}/ek`, { urun: 'BUGDAY' })).durum, 200);
  assert.equal((await c(`/api/parsel/${h}`)).veri.ekin.otomatikSulama, false);
  const beklenen = Math.round(YAPILAR.SULAMA_HATTI.maliyet * BAKIM.onarimOrani * 0.75 * 100) / 100;
  assert.equal(y.bakimMaliyeti, beklenen);
  const bakiye0 = (await c('/api/ben')).veri.bakiye;
  const r = (await c(`/api/parsel/${h}/bakim`, {})).veri;
  assert.equal(r.tutar, beklenen);
  assert.equal((await c('/api/ben')).veri.bakiye, Math.round((bakiye0 - beklenen) * 100) / 100);
  const sonra = (await c(`/api/parsel/${h}`)).veri;
  assert.equal(sonra.yapilar[0].saglik, 100);
  assert.equal(sonra.ekin.otomatikSulama, true);
  assert.equal((await c(`/api/parsel/${h}/bakim`, {})).durum, 409, 'bakım gerektiren yapı yok');
});

test('depodaki ürün oyun günü başına bozulur; bildirim gelir', async () => {
  const c = await oyuncu('depocu');
  await c('/api/ben');   // bozulma sayacı başlar
  await urunVer(c.id, 'DOMATES', 100);
  await urunVer(c.id, 'BUGDAY', 100);
  await db.run(`UPDATE users SET bozulma_gun = bozulma_gun - 2 WHERE id = ?`, c.id);
  const ben = (await c('/api/ben')).veri;
  const domates = ben.envanter.find((i) => i.item_id === 'DOMATES');
  assert.equal(domates.miktar, 100 - Math.floor(100 * (1 - (1 - BOZULMA.envanterGunluk.DOMATES) ** 2)));
  assert.equal(ben.envanter.find((i) => i.item_id === 'BUGDAY').miktar, 100, 'buğday yavaş bozulur (%0,5/gün, aşağı yuvarlanır)');
  assert.ok((await c('/api/bildirimler')).veri.some((b) => b.text.includes('bozuldu')));
  // Aynı gün içinde ikinci kez işlenmez
  assert.equal((await c('/api/ben')).veri.envanter.find((i) => i.item_id === 'DOMATES').miktar, domates.miktar);
});

test('borsa: fiyat-zaman önceliği, bekleyen emrin fiyatından eşleşme, fark iadesi, ücret, kendi emriyle eşleşmeme', async () => {
  const satici = await oyuncu('satici'), alici = await oyuncu('alici'), ucuncu = await oyuncu('ucuncu');
  await satici('/api/ben'); await ucuncu('/api/ben');
  await urunVer(satici.id, 'BUGDAY', 200);
  await urunVer(ucuncu.id, 'BUGDAY', 50);
  assert.equal((await satici('/api/borsa/emir', { urun: 'BUGDAY', yon: 'SAT', fiyat: 9, miktar: 10 })).durum, 400, 'fiyat bandı dışında');
  const s1 = (await satici('/api/borsa/emir', { urun: 'BUGDAY', yon: 'SAT', fiyat: 1.6, miktar: 50 })).veri;
  assert.equal(await stok(satici.id, 'BUGDAY'), 150, 'satış emri ürünü kilitler');
  // Kendi alış emri kendi satışıyla eşleşmez
  const kendi = (await satici('/api/borsa/emir', { urun: 'BUGDAY', yon: 'AL', fiyat: 1.6, miktar: 5 })).veri;
  assert.equal(kendi.dolan, 0);
  assert.equal((await satici(`/api/borsa/emir/${kendi.id}/iptal`, {})).durum, 200);
  const s2 = (await ucuncu('/api/borsa/emir', { urun: 'BUGDAY', yon: 'SAT', fiyat: 1.5, miktar: 20 })).veri;
  // Alıcı 30 adet ₳2'ye kadar: önce en ucuz (ücüncü 20 × 1.5), sonra satıcı 10 × 1.6
  const bakiye0 = (await alici('/api/ben')).veri.bakiye;
  const a1 = (await alici('/api/borsa/emir', { urun: 'BUGDAY', yon: 'AL', fiyat: 2, miktar: 30 })).veri;
  assert.equal(a1.dolan, 30);
  assert.deepEqual(a1.islemler.map((i) => [i.miktar, i.fiyat]), [[20, 1.5], [10, 1.6]]);
  assert.equal(await stok(alici.id, 'BUGDAY'), 30);
  assert.equal((await alici('/api/ben')).veri.bakiye, bakiye0 - 46, '20×1.5 + 10×1.6 = 46; limit farkı iade');
  const ucretUcuncu = 0.6, gelir = 30 - ucretUcuncu;
  assert.equal((await ucuncu('/api/ben')).veri.bakiye, 500 + gelir);
  const defter = (await alici('/api/borsa')).veri.urunler.find((u) => u.kod === 'BUGDAY');
  assert.equal(defter.satis[0].fiyat, 1.6);
  assert.equal(defter.satis[0].miktar, 40);
  assert.equal(defter.sonIslemler[0].fiyat, 1.6);
  // İptal: kalan ürün ve kilitli akçe iade edilir
  assert.equal((await satici(`/api/borsa/emir/${s1.id}/iptal`, {})).durum, 200);
  assert.equal(await stok(satici.id, 'BUGDAY'), 190);
  assert.equal((await alici(`/api/borsa/emir/${s2.id}/iptal`, {})).durum, 404, 'başkasının emri');
  // Kapalı emirlerin emanet hesapları sıfırlanmıştır
  const emanetler = await db.all(`SELECT account, ROUND(SUM(credit) - SUM(debit), 2) b FROM wallet_ledger WHERE account LIKE 'ESCROW:EMIR:%' GROUP BY account`);
  const acik = new Set((await db.all(`SELECT id FROM urun_emirleri WHERE durum = 'ACIK'`)).map((e) => `ESCROW:EMIR:${e.id}`));
  for (const e of emanetler) if (!acik.has(e.account)) assert.equal(e.b, 0, e.account);
});

test('borsa: süresi dolan emir iade edilir; ekonomi paneli yalnızca yetkiliye açık', async () => {
  const c = await oyuncu('suresi');
  await c('/api/ben');
  await urunVer(c.id, 'ELMA', 20);
  const e = (await c('/api/borsa/emir', { urun: 'ELMA', yon: 'SAT', fiyat: 2, miktar: 20, gun: 1 })).veri;
  await db.run(`UPDATE urun_emirleri SET expires_at = ? WHERE id = ?`, Date.now() - 1, e.id);
  await c('/api/borsa');
  assert.equal((await db.get(`SELECT durum FROM urun_emirleri WHERE id = ?`, e.id)).durum, 'SURESI_DOLDU');
  assert.equal(await stok(c.id, 'ELMA'), 20);
  assert.equal((await c('/api/yonetim/ekonomi')).durum, 403);
  const panel = await require('../server/ekonomi').ekonomiPaneli();
  assert.ok(panel.ozet.arz > 0);
  assert.ok(panel.ozet.yakilan7 > 0);
  assert.ok(panel.kaynaklar.some((k) => k.sebep === 'Borsa işlem ücreti'));
  assert.equal(require('../server/ekonomi').gini([1, 1, 1, 1]), 0);
  assert.ok(require('../server/ekonomi').gini([0.01, 0.01, 0.01, 100]) > 0.7);
});

test('envantere giren ürün (hasat, hediye, toplama …) geçmiş günlerin bozulmasına uğramaz; eski stok bozulur', async () => {
  const c = await oyuncu('gecikmis');
  await c('/api/ben');
  await urunVer(c.id, 'DOMATES', 100);
  await db.run('UPDATE users SET bozulma_gun = bozulma_gun - 4 WHERE id = ?', c.id);   // 4 gün uğramadı
  await urunVer(c.id, 'DOMATES', 100);   // bugün gelen 100 domates
  const eski = 100 - Math.floor(100 * (1 - (1 - BOZULMA.envanterGunluk.DOMATES) ** 4));
  assert.equal(await stok(c.id, 'DOMATES'), eski + 100);
  await c('/api/ben');
  assert.equal(await stok(c.id, 'DOMATES'), eski + 100, 'bugün gelenler bir daha bozulmaz');
});

test('borsa: bugün alınan ürün alıcının geçmiş günlerdeki bozulmasına uğramaz', async () => {
  const alici = await oyuncu('tazealici'), satici = await oyuncu('tazesatici');
  await satici('/api/ben');
  await urunVer(satici.id, 'DOMATES', 100);
  assert.equal((await alici('/api/borsa/emir', { urun: 'DOMATES', yon: 'AL', fiyat: 2, miktar: 100, gun: 7 })).durum, 200);
  await db.run('UPDATE users SET bozulma_gun = bozulma_gun - 5 WHERE id = ?', alici.id);   // alıcı 5 gün uğramadı
  assert.equal((await satici('/api/borsa/emir', { urun: 'DOMATES', yon: 'SAT', fiyat: 2, miktar: 100, gun: 7 })).veri.dolan, 100);
  await alici('/api/ben');
  assert.equal(await stok(alici.id, 'DOMATES'), 100);
});

test('borsa: satış emrinde bekleyen ürün de bozulur; iptalde açık kalınan günlerin bozulması düşülür', async () => {
  const c = await oyuncu('bekleyen');
  await c('/api/ben');
  await urunVer(c.id, 'DOMATES', 100);
  const e = (await c('/api/borsa/emir', { urun: 'DOMATES', yon: 'SAT', fiyat: 4, miktar: 100, gun: 7 })).veri;
  await db.run('UPDATE urun_emirleri SET created_at = created_at - ? WHERE id = ?', 3 * BOZULMA.gunMs, e.id);
  await db.run('UPDATE users SET bozulma_gun = bozulma_gun - 3 WHERE id = ?', c.id);   // depo da 3 gündür işlenmedi
  const r = await c(`/api/borsa/emir/${e.id}/iptal`, {});
  assert.equal(r.durum, 200);
  const emir = await db.get('SELECT created_at, closed_at FROM urun_emirleri WHERE id = ?', e.id);
  const gun = Math.floor(emir.closed_at / BOZULMA.gunMs) - Math.floor(emir.created_at / BOZULMA.gunMs);
  const bozulan = Math.floor(100 * (1 - (1 - BOZULMA.envanterGunluk.DOMATES) ** gun));
  assert.ok(bozulan > 0);
  assert.equal(r.veri.bozulan, bozulan);
  assert.equal(await stok(c.id, 'DOMATES'), 100 - bozulan, 'iade edilen ürün bir daha bozulmaz');
  assert.equal((await c('/api/ben')).veri.envanter.find((i) => i.item_id === 'DOMATES').miktar, 100 - bozulan);
});
