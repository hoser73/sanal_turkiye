// İlk giriş sihirbazı: yer seçimi → 3 aday arsa → seçilen arsa hediye; ilk ekin 1 dakikada olur; adım ödülleri yalnızca
// yapılan adım için ve bir kez; "atla" sihirbazı bitirir. Oyun içi Ada/Parsel numarası kararlıdır.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { ortamKur, istemciUret } = require('./yardimci');

const VERI = ortamKur('sihirbaz');
const app = require('../server/index');
const db = require('../server/db');
const L = require('../server/lib/ledger');
const { SIHIRBAZ } = require('../server/sihirbaz');
const { adaParsel } = require('../server/harita/ada');

let sunucu, taban;
before(async () => {
  await new Promise((r) => { sunucu = app.listen(0, r); });
  taban = `http://127.0.0.1:${sunucu.address().port}`;
  await app.hazir;
});
after(() => { sunucu.close(); fs.rmSync(VERI, { recursive: true, force: true }); });
const istemci = istemciUret(() => taban);
const kayit = async (ad) => {
  const c = istemci();
  await c('/api/kayit', { email: `${ad}@test.local`, sifre: 'parola123', ad, dogumYili: 1990, kosullarOnay: true, kvkkOnay: true });
  return { c, id: (await db.get(`SELECT id FROM users WHERE email = ?`, `${ad}@test.local`)).id };
};
// Konya Meram çevresindeki bir ilçe (test verisi sahte karo kullanır; her yerde tarım hücresi bulunur)
const ilce = async () => (await db.get(`SELECT id FROM regions WHERE type = 'ILCE' ORDER BY id LIMIT 1`)).id;

test('Ada/Parsel numarası kararlı ve sınırlar içinde; komşu hücreler farklı parsel no alır', () => {
  const a = adaParsel(618103, 405974), b = adaParsel(618103, 405974), c = adaParsel(618104, 405974);
  assert.deepEqual(a, b);
  assert.ok(a.ada >= 100 && a.ada <= 999 && a.parsel >= 1 && a.parsel <= 256);
  assert.notEqual(`${a.ada}/${a.parsel}`, `${c.ada}/${c.parsel}`);
});

test('yeni oyuncu: sihirbaz açık; 3 aday arsa gelir, seçtiği arsa hediye olur, önerilmeyen arsa reddedilir', async () => {
  const A = await kayit('sihirbazci');
  assert.equal((await A.c('/api/ben')).veri.sihirbaz, true);
  let d = (await A.c('/api/sihirbaz')).veri;
  assert.equal(d.aktif, true);
  assert.equal(d.adimlar.find((x) => x.kod === 'ARSA').tamam, false);
  const r = await A.c(`/api/baslangic/adaylar?ilce=${await ilce()}`);
  assert.equal(r.durum, 200, JSON.stringify(r.veri));
  assert.ok(r.veri.adaylar.length >= 1 && r.veri.adaylar.length <= 3);
  for (const a of r.veri.adaylar) {
    assert.ok(a.adaParsel?.ada && a.adaParsel?.parsel, 'ada/parsel no');
    assert.ok(a.alan > 0 && a.hediye > 0);
  }
  assert.equal(new Set(r.veri.adaylar.map((a) => a.id)).size, r.veri.adaylar.length);
  // Başka bir (önerilmeyen) tarım parseli hediye alınamaz
  const yabanci = await db.get(`SELECT id FROM parcels WHERE owner_user_id IS NULL AND zoning_type = 'TARIM' AND id NOT IN (${r.veri.adaylar.map(() => '?').join(',')}) LIMIT 1`, ...r.veri.adaylar.map((a) => a.id));
  if (yabanci) assert.equal((await A.c('/api/baslangic/tarla', { parsel: yabanci.id })).durum, 409);
  const secilen = r.veri.adaylar.at(-1).id;
  const al = await A.c('/api/baslangic/tarla', { parsel: secilen });
  assert.equal(al.durum, 200, JSON.stringify(al.veri));
  assert.equal(al.veri.parsel, secilen);
  const ben = (await A.c('/api/ben')).veri;
  assert.equal(ben.portfoy[0].id, secilen);
  assert.ok(ben.portfoy[0].adaParsel.ada);
  d = (await A.c('/api/sihirbaz')).veri;
  assert.equal(d.adimlar.find((x) => x.kod === 'ARSA').tamam, true);
  assert.equal((await A.c(`/api/baslangic/adaylar?ilce=${await ilce()}`)).durum, 409, 'arsası olan aday istemez');
});

test('sihirbazdaki ilk ekin 1 dakikada olur; adım ödülü yalnızca yapılan adıma ve bir kez; GUNLUK sihirbazı bitirir', async () => {
  const A = await kayit('ilkekim');
  const ad = (await A.c(`/api/baslangic/adaylar?ilce=${await ilce()}`)).veri.adaylar[0];
  assert.equal((await A.c('/api/baslangic/tarla', { parsel: ad.id })).durum, 200);
  assert.equal((await A.c('/api/sihirbaz/odul', { adim: 'EKIM' })).durum, 409, 'ekim yapılmadan ödül yok');
  assert.equal((await A.c(`/api/parsel/${ad.id}/ek`, { urun: 'BUGDAY' })).durum, 200);
  const e = await db.get(`SELECT planted_at, ready_at FROM crops WHERE parcel_id = ?`, ad.id);
  assert.ok(e.ready_at - e.planted_at <= SIHIRBAZ.ilkEkinMs, 'ilk ekin en geç 1 dakikada olur');
  const once = await L.bakiye(A.id);
  const o = await A.c('/api/sihirbaz/odul', { adim: 'EKIM' });
  assert.equal(o.durum, 200);
  assert.equal(Math.round(await L.bakiye(A.id) - once), SIHIRBAZ.adimlar.find((x) => x.kod === 'EKIM').odul);
  assert.equal((await A.c('/api/sihirbaz/odul', { adim: 'EKIM' })).veri.odul, 0, 'ikinci kez ödül yok');
  assert.equal((await A.c('/api/sihirbaz/odul', { adim: 'GUNLUK' })).durum, 409, 'önceki adımlar bitmeden son adım yok');
  // Diğer adımları denetim kayıtlarıyla tamamla → son adım ödülü sihirbazı bitirir
  for (const eylem of ['CROP_WATERED', 'CROP_HARVESTED', 'TRADE_SETTLED', 'STRUCTURE_STARTED']) await L.denetim({ aktor: A.id, eylem, varlik: 'test' });
  const son = await A.c('/api/sihirbaz/odul', { adim: 'GUNLUK' });
  assert.equal(son.durum, 200);
  assert.equal(son.veri.bitti, true);
  assert.equal((await A.c('/api/ben')).veri.sihirbaz, false);
  // Sihirbaz bittikten sonraki ekimler olağan sürede büyür
  await db.run(`DELETE FROM crops WHERE parcel_id = ?`, ad.id);
  assert.equal((await A.c(`/api/parsel/${ad.id}/ek`, { urun: 'BUGDAY' })).durum, 200);
  const e2 = await db.get(`SELECT planted_at, ready_at FROM crops WHERE parcel_id = ?`, ad.id);
  assert.ok(e2.ready_at - e2.planted_at >= e.ready_at - e.planted_at);
});

test('atla: sihirbaz biter, adım ödülleri artık verilmez', async () => {
  const A = await kayit('atlayan');
  assert.equal((await A.c('/api/sihirbaz/bitir', {})).durum, 200);
  assert.equal((await A.c('/api/sihirbaz')).veri.aktif, false);
  assert.equal((await A.c('/api/sihirbaz/odul', { adim: 'ARSA' })).durum, 409);
});

test('sulama adımı yağmur/komşu sulamasıyla da tamam sayılır; sulamasız hasatta son adım yine alınır', async () => {
  const A = await kayit('yagmurlu');
  const ad = (await A.c(`/api/baslangic/adaylar?ilce=${await ilce()}`)).veri.adaylar[0];
  assert.equal((await A.c('/api/baslangic/tarla', { parsel: ad.id })).durum, 200);
  assert.equal((await A.c(`/api/parsel/${ad.id}/ek`, { urun: 'BUGDAY' })).durum, 200);
  assert.equal((await A.c('/api/sihirbaz/odul', { adim: 'SULAMA' })).durum, 409);
  await db.run(`UPDATE crops SET waterings = 1 WHERE parcel_id = ?`, ad.id);   // yağmur denetim kaydı yazmaz
  assert.equal((await A.c('/api/sihirbaz')).veri.adimlar.find((x) => x.kod === 'SULAMA').tamam, true);
  assert.equal((await A.c('/api/sihirbaz/odul', { adim: 'SULAMA' })).durum, 200);
  // Başka oyuncu: hiç sulamadan hasat etti
  const B = await kayit('sulamasiz');
  const bAd = (await B.c(`/api/baslangic/adaylar?ilce=${await ilce()}`)).veri.adaylar[0];
  assert.equal((await B.c('/api/baslangic/tarla', { parsel: bAd.id })).durum, 200);
  for (const eylem of ['CROP_PLANTED', 'CROP_HARVESTED', 'TRADE_SETTLED', 'STRUCTURE_STARTED']) await L.denetim({ aktor: B.id, eylem, varlik: 'test' });
  const son = await B.c('/api/sihirbaz/odul', { adim: 'GUNLUK' });
  assert.equal(son.durum, 200, JSON.stringify(son.veri));
  assert.equal(son.veri.bitti, true);
});

test('silinen hesabın e-postasıyla açılan hesap sihirbaz adımlarını yapar ama akçe ödülü almaz', async () => {
  const A = await kayit('odulcu');
  assert.equal((await A.c('/api/hesap/sil', { sifre: 'parola123', onayMetni: 'SİL' })).durum, 200);
  const B = await kayit('odulcu');
  await L.denetim({ aktor: B.id, eylem: 'CROP_PLANTED', varlik: 'test' });
  const once = await L.bakiye(B.id);
  const r = await B.c('/api/sihirbaz/odul', { adim: 'EKIM' });
  assert.equal(r.durum, 200);
  assert.equal(r.veri.odul, 0);
  assert.equal(await L.bakiye(B.id), once);
});
