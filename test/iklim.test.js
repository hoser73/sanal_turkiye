// Gerçek havanın oyun kuralları: erken uyarı, tarla örtüsü, güneşte hızlı büyüme, rüzgârda hızlı değirmen,
// kurak ile sulama indirimi, üst üste afete destek, Open-Meteo tahmin ayrıştırma.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { ortamKur, istemciUret, hucreBul } = require('./yardimci');

const VERI = ortamKur('iklim');
const app = require('../server/index');
const db = require('../server/db');
const dunya = require('../server/dunya');
const iklim = require('../server/iklim');
const L = require('../server/lib/ledger');
const { HAVA, TARIM, RECETELER } = require('../server/config/rules');

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
const plakaBul = async (id) => (await db.get(`SELECT r.plaka FROM parcels p JOIN regions r ON r.id = p.il_id WHERE p.id = ?`, id)).plaka;
const ekin = (id) => db.get(`SELECT * FROM crops WHERE parcel_id = ? AND status = 'GROWING'`, id);
const bakiye = async (c) => (await c('/api/ben')).veri.bakiye;
const SAKIN = { sicaklik: 10, yagis: 0, kod: 3, ruzgar: 5, gunduz: 0 };
const tahmin = (saat) => ({ saat: { min: 5, max: 15, yagisMaks: 0, kodlar: [3], ruzgarMaks: 10, ...saat }, yarin: { min: 2, max: 14, yagis: 0, kod: 2, ruzgar: 9 } });

test('tahmin ayrıştırma: Open-Meteo saatlik ve günlük alanları, eksik/null değerler', () => {
  const t = dunya.tahminCikar({
    hourly: { temperature_2m: [3, -1.5, null, 2], precipitation: [0, 0.4, 12.1, null], weather_code: [3, 61, 96, 3], wind_speed_10m: [10, 25, 70, 5] },
    daily: { temperature_2m_min: [1, -2.2], temperature_2m_max: [9, 11], precipitation_sum: [0, 4.2], weather_code: [3, 63], wind_speed_10m_max: [20, 33] },
  });
  assert.deepEqual(t.saat, { min: -1.5, max: 3, yagisMaks: 12.1, kodlar: [3, 61, 96], ruzgarMaks: 70 });
  assert.deepEqual(t.yarin, { min: -2.2, max: 11, yagis: 4.2, kod: 63, ruzgar: 33 });
  assert.deepEqual(iklim.riskler(t).map((r) => r.tur), ['DON', 'DOLU', 'SAGANAK', 'FIRTINA']);
  assert.equal(dunya.tahminCikar({}), null);
  assert.equal(dunya.tahminCikar({ hourly: { temperature_2m: 'x' } }), null);
});

test('erken uyarı: don tahmini hassas ekini olan oyuncuya bir kez bildirilir; seralı ve dayanıklı ekin uyarılmaz', async () => {
  const c = await oyuncu('uyarilan'), s = await oyuncu('seraci');
  const h1 = hucreBul('TARIM'), h2 = hucreBul('TARIM'), h3 = hucreBul('TARIM');
  await c(`/api/parsel/${h1}/edin`, {}); await c(`/api/parsel/${h1}/ek`, { urun: 'DOMATES' });
  await c(`/api/parsel/${h3}/edin`, {}); await c(`/api/parsel/${h3}/ek`, { urun: 'BUGDAY' });
  await s(`/api/parsel/${h2}/edin`, {}); await s(`/api/parsel/${h2}/ek`, { urun: 'DOMATES' });
  const t0 = Date.now();
  await db.run(`INSERT INTO structures (parcel_id, owner_user_id, type, status, started_at, completes_at, completed_at) VALUES (?, ?, 'SERA', 'ACTIVE', ?, ?, ?)`, h2, s.id, t0, t0, t0);
  const plaka = await plakaBul(h1);
  assert.equal(await plakaBul(h2), plaka);
  const r = await dunya.uygula({ plaka, ...SAKIN, tahmin: tahmin({ min: -3 }) });
  assert.equal(r.uyarilan, 1, 'yalnızca açık tarlada domatesi olan uyarılır');
  const b = (await c('/api/bildirimler')).veri.filter((x) => x.text.startsWith('❄️'));
  assert.equal(b.length, 1);
  assert.match(b[0].text, /^❄️ Konya'da önümüzdeki 12 saatte don \(-3°\) bekleniyor\. Tarlandaki Domates zarar görebilir: .*örtü ser/);
  assert.doesNotMatch(b[0].text, /Buğday/, 'buğday dona dayanıklı');
  assert.equal(b[0].link, `parsel:${h1}`);
  assert.equal((await s('/api/bildirimler')).veri.filter((x) => x.text.startsWith('❄️')).length, 0);
  // Aynı risk 12 saat içinde tekrar bildirilmez; yeni risk (dolu) tek bildirimde gelir, eski risk tekrarlanmaz
  assert.equal((await dunya.uygula({ plaka, ...SAKIN, tahmin: tahmin({ min: -4 }) })).uyarilan, 0);
  assert.equal((await dunya.uygula({ plaka, ...SAKIN, tahmin: tahmin({ min: -4, kodlar: [96] }) })).uyarilan, 1);
  const son = (await c('/api/bildirimler')).veri[0].text;
  assert.match(son, /^🧊 Konya'da önümüzdeki 12 saatte dolu bekleniyor\. 2 tarlandaki Domates, Buğday zarar görebilir/);
  // İl listesi ve kart riski gösterir
  const il = (await c('/api/hava')).veri.iller.find((x) => x.plaka === plaka);
  assert.equal(il.uyari, '❄️');
  const kart = (await c(`/api/parsel/${h1}`)).veri;
  assert.deepEqual(kart.iklim.riskler.map((x) => x.tur), ['DON', 'DOLU']);
  assert.equal(kart.iklim.yarin.min, 2);
  assert.ok(kart.iklim.yarin.ikon);
  // Oyuncunun hava özeti: tehdit altındaki tarla
  const benim = (await c('/api/hava/benim')).veri;
  const ozet = benim.iller.find((x) => x.plaka === plaka);
  assert.deepEqual(ozet.tarlalar.find((x) => x.parselId === h1).tehdit, ['DON', 'DOLU']);
  assert.deepEqual(ozet.tarlalar.find((x) => x.parselId === h3).tehdit, ['DOLU'], 'buğday dona dayanıklı, doluya değil');
  assert.equal((await istemci()('/api/hava/benim')).durum, 401);
  await dunya.uygula({ plaka, ...SAKIN, tahmin: tahmin({}) });
});

test('tarla örtüsü: ücretli, 12 saat dondan ve doludan korur; tekrar, yabancı ve ekinsiz tarla reddedilir', async () => {
  const c = await oyuncu('ortucu'), y = await oyuncu('yabanci');
  const h1 = hucreBul('TARIM'), h2 = hucreBul('TARIM'), bos = hucreBul('TARIM');
  for (const h of [h1, h2]) { await c(`/api/parsel/${h}/edin`, {}); await c(`/api/parsel/${h}/ek`, { urun: 'DOMATES' }); }
  await c(`/api/parsel/${bos}/edin`, {});
  const once = await bakiye(c);
  const r = await c(`/api/parsel/${h1}/ortu`, {});
  assert.equal(r.durum, 200);
  assert.equal(r.veri.maliyet, HAVA.ortu.birimMaliyet * Math.min(TARIM.maxVerimKati, Math.max(1, Math.round((await db.get(`SELECT area_m2 FROM parcels WHERE id = ?`, h1)).area_m2 / TARIM.verimAlanBirimi))));
  assert.equal(L.yuvarla(once - (await bakiye(c))), r.veri.maliyet);
  assert.ok(Math.abs(r.veri.bitis - (Date.now() + HAVA.ortu.sureMs)) < 5000);
  assert.equal((await c(`/api/parsel/${h1}/ortu`, {})).durum, 409, 'zaten örtülü');
  assert.equal((await y(`/api/parsel/${h2}/ortu`, {})).durum, 403);
  assert.equal((await c(`/api/parsel/${bos}/ortu`, {})).durum, 409);
  assert.equal((await istemci()(`/api/parsel/${h2}/ortu`, {})).durum, 401);
  assert.ok((await c(`/api/parsel/${h1}`)).veri.ekin.ortuBitis > Date.now());

  // Gerçek don ve dolu: örtülü tarla korunur, örtüsüz zarar görür
  const plaka = await plakaBul(h1);
  await dunya.uygula({ plaka, sicaklik: -2, yagis: 0, kod: 3, ruzgar: 5, gunduz: 0 });
  assert.equal((await ekin(h1)).don, 0);
  assert.equal((await ekin(h2)).don, 1);
  await db.run(`UPDATE afetler SET created_at = created_at - 86400000 WHERE plaka = ?`, plaka);   // 12 saatlik tekrar sınırını geç
  await dunya.afetleriUygula({ plaka, sicaklik: 12, yagis: 0, kod: 96, ruzgar: 5 }, Date.now());
  assert.equal((await ekin(h1)).afet_kati, 1);
  assert.ok((await ekin(h2)).afet_kati < 1);
  // Süresi dolan örtü artık korumaz
  await db.run(`UPDATE crops SET ortu_bitis = ? WHERE id = ?`, Date.now() - 1, (await ekin(h1)).id);
  assert.equal(iklim.ekinEtkilenir(await ekin(h1), 'DON', Date.now(), 0), true);
  assert.equal((await c(`/api/parsel/${h1}`)).veri.ekin.ortuBitis, null);
});

test('güneş: açık ve ılık gündüz ekilen açık tarla %15 hızlı büyür; gece ya da bayat ölçümde bonus yok', async () => {
  const c = await oyuncu('gunesli');
  const h = hucreBul('TARIM');
  await c(`/api/parsel/${h}/edin`, {});
  const plaka = await plakaBul(h);
  await dunya.uygula({ plaka, sicaklik: 22, yagis: 0, kod: 0, ruzgar: 5, gunduz: 1 });
  assert.equal(await iklim.gunesKati(plaka), HAVA.gunes.kati);
  const kart = (await c(`/api/parsel/${h}`)).veri;
  assert.equal(kart.iklim.gunesli, true);
  const golgede = await dunya.buyumeKati('BUGDAY', false);
  assert.equal(kart.urunSecenekleri.find((u) => u.kod === 'BUGDAY').buyume, Math.round(golgede * HAVA.gunes.kati * 100) / 100);
  const ek = (await c(`/api/parsel/${h}/ek`, { urun: 'BUGDAY' })).veri;
  assert.equal(ek.buyume, Math.round(golgede * HAVA.gunes.kati * 100) / 100);
  assert.equal(await dunya.buyumeKati('BUGDAY', true, Date.now(), plaka), 1, 'sera her zaman 1');
  await dunya.uygula({ plaka, sicaklik: 22, yagis: 0, kod: 0, ruzgar: 5, gunduz: 0 });
  assert.equal(await iklim.gunesKati(plaka), 1, 'gece güneş yok');
  await dunya.uygula({ plaka, sicaklik: 36, yagis: 0, kod: 0, ruzgar: 5, gunduz: 1 });
  assert.equal(await iklim.gunesKati(plaka), 1, 'kavurucu sıcakta bonus yok');
  await dunya.uygula({ plaka, sicaklik: 22, yagis: 0, kod: 0, ruzgar: 5, gunduz: 1 });
  await db.run(`UPDATE hava_durumu SET guncellendi = ? WHERE plaka = ?`, Date.now() - HAVA.yenilemeMs * 3, plaka);
  assert.equal(await iklim.gunesKati(plaka), 1, 'bayat ölçüm');
});

test('rüzgâr: rüzgârlı havada değirmen %25 hızlı öğütür', async () => {
  const c = await oyuncu('degirmenci');
  const h = hucreBul('TARIM');
  await c(`/api/parsel/${h}/edin`, {});
  const t0 = Date.now();
  await db.run(`INSERT INTO structures (parcel_id, owner_user_id, type, status, started_at, completes_at, completed_at) VALUES (?, ?, 'DEGIRMEN', 'ACTIVE', ?, ?, ?)`, h, c.id, t0, t0, t0);
  await db.tx(() => L.envanterDegis(c.id, 'BUGDAY', 40, 'test', L.yeniTx()));
  const plaka = await plakaBul(h);
  const sure = async () => {
    const r = await c(`/api/parsel/${h}/uretim`, { recete: 'UN' });
    assert.equal(r.durum, 200, JSON.stringify(r.veri));
    const u = await db.get(`SELECT * FROM uretimler WHERE id = ?`, r.veri.id);
    await db.run(`UPDATE uretimler SET durum = 'TOPLANDI' WHERE id = ?`, u.id);
    return { ms: u.bitis - u.baslangic, ruzgarli: r.veri.ruzgarli };
  };
  await dunya.uygula({ plaka, sicaklik: 15, yagis: 0, kod: 3, ruzgar: 5, gunduz: 1 });
  const sakin = await sure();
  await dunya.uygula({ plaka, sicaklik: 15, yagis: 0, kod: 3, ruzgar: 32, gunduz: 1 });
  const ruzgarli = await sure();
  assert.equal(sakin.ruzgarli, false);
  assert.equal(ruzgarli.ruzgarli, true);
  assert.equal(sakin.ms, RECETELER.UN.sureMs);
  assert.equal(ruzgarli.ms, Math.round(RECETELER.UN.sureMs * HAVA.ruzgar.kati));
  assert.equal((await c(`/api/parsel/${h}`)).veri.iklim.ruzgar.degirmenHizli, true);
});

test('kuraklık: son 7 günde neredeyse hiç yağış almayan ilde elle sulama %30 ucuz', async () => {
  const c = await oyuncu('kurakci');
  const h = hucreBul('TARIM');
  await c(`/api/parsel/${h}/edin`, {});
  await c(`/api/parsel/${h}/ek`, { urun: 'DOMATES' });
  const plaka = await plakaBul(h);
  const gun = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(Date.now() - n * 864e5);
  await db.run(`DELETE FROM hava_gecmisi WHERE plaka = ?`, plaka);
  const normal = (await c(`/api/parsel/${h}`)).veri.ekin.sulamaMaliyeti;
  assert.equal((await c(`/api/parsel/${h}`)).veri.iklim.kuraklik.kurak, false, 'veri azken kurak sayılmaz');
  for (let i = 1; i <= 5; i++) await db.run(`INSERT INTO hava_gecmisi (plaka, gun, olcum, yagisli) VALUES (?, ?, 48, 0)`, plaka, gun(i));
  await db.run(`INSERT INTO hava_gecmisi (plaka, gun, olcum, yagisli) VALUES (?, ?, 48, 0)`, plaka, gun(30));   // pencere dışı
  const kart = (await c(`/api/parsel/${h}`)).veri;
  assert.equal(kart.iklim.kuraklik.kurak, true);
  assert.equal(kart.ekin.sulamaMaliyeti, L.yuvarla(normal * (1 - HAVA.kuraklik.indirim)));
  const r = await c(`/api/parsel/${h}/sula`, {});
  assert.equal(r.durum, 200);
  assert.equal(r.veri.maliyet, kart.ekin.sulamaMaliyeti);
  const kayit = await db.get(`SELECT debit FROM wallet_ledger WHERE user_id = ? AND reason LIKE 'Sulama/enerji%' ORDER BY id DESC LIMIT 1`, c.id);
  assert.equal(kayit.debit, r.veri.maliyet, 'cüzdandan indirimli tutar düşer');
  // Yağışlı günler gelince indirim kalkar
  await db.run(`UPDATE hava_gecmisi SET yagisli = 40 WHERE plaka = ? AND gun = ?`, plaka, gun(1));
  assert.equal((await iklim.kuraklik(plaka)).kurak, false);
  // Ölçüm geçmişi her uygulamada birikir
  const say = () => db.get(`SELECT olcum, yagisli FROM hava_gecmisi WHERE plaka = ? AND gun = ?`, plaka, gun(0));
  const s0 = (await say())?.olcum || 0;
  await dunya.uygula({ plaka, sicaklik: 15, yagis: 1.5, kod: 61, ruzgar: 5, gunduz: 1 });
  assert.equal((await say()).olcum, s0 + 1);
  assert.ok((await say()).yagisli >= 1);
});

test('afet desteği: 7 günde ikinci afette doğrulanmış, 7 günlük hesaba bir kez destek; haftada en çok bir; yeni hesaba yok', async () => {
  const c = await oyuncu('afetzede');
  const h = hucreBul('TARIM');
  await c(`/api/parsel/${h}/edin`, {});
  await c(`/api/parsel/${h}/ek`, { urun: 'BUGDAY' });
  const plaka = await plakaBul(h);
  const geriAl = () => db.run(`UPDATE afetler SET created_at = created_at - 86400000 WHERE plaka = ?`, plaka);   // 12 saatlik tekrar sınırını geç
  await geriAl();
  const destek = async () => (await db.get(`SELECT COUNT(*) AS c FROM afet_destekleri WHERE user_id = ?`, c.id)).c;
  // Yeni hesap destek alamaz (sahte hesaplarla toplanmasın)
  await dunya.afetleriUygula({ plaka, sicaklik: 12, yagis: 0, kod: 96, ruzgar: 5 }, Date.now());
  await geriAl();
  await dunya.afetleriUygula({ plaka, sicaklik: 12, yagis: 0, kod: 96, ruzgar: 5 }, Date.now());
  assert.equal(await destek(), 0, 'yeni hesap');
  await db.run(`DELETE FROM afet_etkilenen WHERE user_id = ?`, c.id);
  await geriAl();
  await db.run(`UPDATE users SET created_at = datetime('now', '-8 days') WHERE id = ?`, c.id);
  const once = await bakiye(c);
  await dunya.afetleriUygula({ plaka, sicaklik: 12, yagis: 0, kod: 96, ruzgar: 5 }, Date.now());
  assert.equal(await destek(), 0, 'ilk afette destek yok');
  await dunya.afetleriUygula({ plaka, sicaklik: 12, yagis: 15, kod: 82, ruzgar: 5 }, Date.now());
  assert.equal(await destek(), 1);
  assert.equal(L.yuvarla((await bakiye(c)) - once), HAVA.afetDestegi.tutar);
  assert.ok((await c('/api/bildirimler')).veri.some((b) => b.text.startsWith('🤝 Afet desteği')));
  await dunya.afetleriUygula({ plaka, sicaklik: 12, yagis: 0, kod: 3, ruzgar: 80 }, Date.now());   // fırtına: yapı yok, etkilenmez
  await geriAl();
  await dunya.afetleriUygula({ plaka, sicaklik: 12, yagis: 0, kod: 99, ruzgar: 5 }, Date.now());
  assert.equal(await destek(), 1, 'haftada bir');
  const ozet = (await c('/api/hava/benim')).veri.afetDestegi;
  assert.ok(ozet.etkilenme >= 3);
  assert.ok(ozet.sonDestek);
});
