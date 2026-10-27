// Komşuluk, yöresel ürünler, etkinlikler, balık tutma ve hatırlatmalar.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { ortamKur, istemciUret, hucreBul } = require('./yardimci');

const VERI = ortamKur('komsuluk');
const app = require('../server/index');
const db = require('../server/db');
const L = require('../server/lib/ledger');
const { KOMSULUK, YORESEL, YORESEL_KURAL, BALIK, ETKINLIKLER } = require('../server/config/rules');

let sunucu, taban;
before(async () => {
  await new Promise((r) => { sunucu = app.listen(0, r); });
  taban = `http://127.0.0.1:${sunucu.address().port}`;
  await app.hazir;
});
after(() => { sunucu.close(); fs.rmSync(VERI, { recursive: true, force: true }); });
const istemci = istemciUret(() => taban);
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const kayit = async (ad) => {
  const c = istemci();
  await c('/api/kayit', { email: `${ad}@test.local`, sifre: 'parola123', ad, dogumYili: 1990, kosullarOnay: true, kvkkOnay: true });
  return { c, id: db.prepare(`SELECT id FROM users WHERE email = ?`).get(`${ad}@test.local`).id };
};

let A, B, parselB;
test('arkadaşlık: istek → kabul; parsel kartı ilişkiyi gösterir', async () => {
  A = await kayit('ali'); B = await kayit('ayse');
  parselB = hucreBul('TARIM');
  assert.equal((await B.c(`/api/parsel/${parselB}/edin`, {})).durum, 200);
  let kart = (await A.c(`/api/parsel/${parselB}`)).veri;
  assert.equal(kart.komsuluk.durum, 'YOK');
  const r = await A.c('/api/arkadas/istek', { parselId: parselB });
  assert.equal(r.durum, 200); assert.equal(r.veri.kabul, false);
  assert.equal((await A.c('/api/arkadas/istek', { parselId: parselB })).durum, 409);
  assert.equal((await B.c('/api/komsuluk')).veri.gelen[0].id, A.id);
  assert.equal((await B.c(`/api/arkadas/${A.id}/kabul`, {})).durum, 200);
  kart = (await A.c(`/api/parsel/${parselB}`)).veri;
  assert.equal(kart.komsuluk.durum, 'ARKADAS');
  assert.equal((await A.c('/api/komsuluk')).veri.arkadaslar[0].ad, 'ayse');
});

test('tarla yardımı: sulama sayılır, günde bir kez, kendi tarlana olmaz; sahibine bildirim', async () => {
  assert.equal((await B.c(`/api/parsel/${parselB}/ek`, { urun: 'BUGDAY' })).durum, 200);
  const once = L.bakiye(A.id);
  const r = await A.c(`/api/parsel/${parselB}/yardim`, {});
  assert.equal(r.durum, 200);
  assert.equal(r.veri.etki, 'SULADI');
  assert.equal(db.prepare(`SELECT waterings FROM crops WHERE parcel_id = ? AND status = 'GROWING'`).get(parselB).waterings, 1);
  assert.equal(L.bakiye(A.id), L.yuvarla(once + KOMSULUK.yardimOdul));
  assert.equal((await A.c(`/api/parsel/${parselB}/yardim`, {})).durum, 409);
  assert.equal((await B.c(`/api/parsel/${parselB}/yardim`, {})).durum, 409);
  assert.ok(db.prepare(`SELECT text FROM notifications WHERE user_id = ? ORDER BY id DESC`).get(B.id).text.includes('suladı'));
});

test('hediye: seviye 3 ister; arkadaşa günde bir; alıcı açar; arkadaş olmayana gönderilemez', async () => {
  assert.equal((await A.c('/api/hediye/gonder', { kullaniciId: B.id })).durum, 403, 'seviye 1 gönderemez');
  db.prepare(`UPDATE users SET tp = 130 WHERE id = ?`).run(A.id);   // seviye 3
  assert.equal((await A.c('/api/hediye/gonder', { kullaniciId: B.id })).durum, 200);
  assert.equal((await A.c('/api/hediye/gonder', { kullaniciId: B.id })).durum, 409);
  const C = await kayit('cem');
  assert.equal((await C.c('/api/hediye/gonder', { kullaniciId: B.id })).durum, 403);
  const h = (await B.c('/api/komsuluk')).veri.hediyeler[0];
  const once = L.bakiye(B.id);
  const al = await B.c(`/api/hediye/${h.id}/al`, {});
  assert.equal(al.durum, 200);
  if (al.veri.akce) assert.equal(L.bakiye(B.id), L.yuvarla(once + al.veri.akce));
  else assert.equal(L.envanterMiktar(B.id, al.veri.urun), al.veri.adet);
  assert.equal((await B.c(`/api/hediye/${h.id}/al`, {})).durum, 409);
});

test('ürün gönderme: arkadaşa, günlük sınırla', async () => {
  L.envanterDegis(A.id, 'ELMA', 40, 'test');
  assert.equal((await A.c('/api/urun/gonder', { kullaniciId: B.id, urun: 'ELMA', adet: 10 })).durum, 200);
  assert.equal(L.envanterMiktar(B.id, 'ELMA'), 10);
  assert.equal((await A.c('/api/urun/gonder', { kullaniciId: B.id, urun: 'ELMA', adet: KOMSULUK.gonderimGunlukAdet })).durum, 429);
});

test('yöresel ürün: yalnızca kendi ilinde, günde bir parti; albüme eklenir', async () => {
  // Test parselleri Konya'da: Konya etli ekmeği üretilebilir, Rize çayı üretilemez
  const plaka = db.prepare(`SELECT r.plaka FROM parcels p JOIN regions r ON r.id = p.il_id WHERE p.id = ?`).get(parselB).plaka;
  const kod = Object.entries(YORESEL).find(([, y]) => y.il === plaka)?.[0];
  assert.ok(kod, `${plaka} ilinde yöresel ürün tanımlı`);
  const y = YORESEL[kod];
  for (const [u, n] of Object.entries(y.girdi || {})) L.envanterDegis(B.id, u, n, 'test');
  if (y.akce) L.odul(B.id, y.akce, 'test');
  const r = await B.c(`/api/yoresel/${kod}/uret`, {});
  assert.equal(r.durum, 200);
  assert.equal(L.envanterMiktar(B.id, kod), YORESEL_KURAL.partiCikti);
  assert.equal((await B.c(`/api/yoresel/${kod}/uret`, {})).durum, 409);
  const baska = Object.entries(YORESEL).find(([, x]) => x.il !== plaka)[0];
  assert.equal((await B.c(`/api/yoresel/${baska}/uret`, {})).durum, 403);
  const once = L.bakiye(B.id);
  assert.equal((await B.c(`/api/yoresel/${kod}/album`, {})).durum, 200);
  assert.equal(L.bakiye(B.id), L.yuvarla(once + YORESEL_KURAL.albumOdul));
  assert.equal((await B.c(`/api/yoresel/${kod}/album`, {})).durum, 409);
  const d = (await B.c('/api/yoresel')).veri;
  assert.equal(d.urunler.find((u) => u.kod === kod).albumde, true);
  // Yöresel ürün borsada işlem görebilir (bilinen ürün)
  assert.notEqual((await B.c('/api/borsa/emir', { urun: kod, yon: 'SAT', miktar: 1, fiyat: 20 })).durum, 400);
});

test('etkinlik: tarih aralığı yıl dönümünü aşar; görev ilerlemesi ve ödül bir kez', async () => {
  const E = require('../server/etkinlik');
  const t = Date.UTC(2027, 0, 1, 12);   // 1 Ocak: Yeni Yıl etkinliği (12-26 → 01-02)
  assert.equal(E.aktifEtkinlik(t)?.kod, 'YILBASI');
  assert.equal(E.aktifEtkinlik(Date.UTC(2026, 9, 29, 12))?.kod, 'CUMHURIYET');
  assert.equal(E.aktifEtkinlik(Date.UTC(2026, 6, 1, 12)), null);
  const d = E.durum(B.id);
  if (!d.aktif) return;   // test günü etkinlik yoksa ödül akışı atlanır
  const g = d.aktif.gorevler[0];
  const gecici = ETKINLIKLER[d.aktif.kod].gorevler[0];
  for (let i = 0; i < g.hedef; i++) L.denetim({ aktor: B.id, eylem: gecici.eylem });
  const once = L.bakiye(B.id);
  const r = await B.c('/api/etkinlik/odul', { gorev: 0 });
  assert.equal(r.durum, 200);
  assert.equal(L.bakiye(B.id), L.yuvarla(once + g.odul));
  assert.equal((await B.c('/api/etkinlik/odul', { gorev: 0 })).durum, 409);
});

test('balık: su olmayan yerde atılmaz; zamanında çekilen balık takılır, mücadeleden sonra envantere girer; erken çekince ya da misina kopunca kaçar', async () => {
  const balik = require('../server/balik');
  const eski = balik.ayar.suBul;
  balik.ayar.suBul = async () => null;
  assert.equal((await A.c('/api/balik/at', { lon: 32.5, lat: 37.9 })).durum, 422);
  balik.ayar.suBul = async () => ({ tip: 'ic', plaka: '65' });   // Van Gölü
  const at = await A.c('/api/balik/at', { lon: 43.2, lat: 38.6 });
  assert.equal(at.durum, 200);
  const erken = await A.c(`/api/balik/${at.veri.id}/cek`, {});
  assert.equal(erken.veri.tutuldu, false);
  // İkinci atış: ısırma anını bekleyip çek
  const at2 = (await A.c('/api/balik/at', { lon: 43.2, lat: 38.6 })).veri;
  await bekle(at2.isirmaMs + 100);
  const cek = (await A.c(`/api/balik/${at2.id}/cek`, {})).veri;
  assert.equal(cek.takildi, true, 'balık oltaya takılır; mücadele başlar');
  assert.ok(cek.guc >= 1 && cek.minMs >= BALIK.mucadele.tabanMs);
  assert.equal(cek.urun, undefined, 'tür balık çıkana kadar söylenmez');
  assert.equal((await A.c(`/api/balik/${at2.id}/cek`, {})).durum, 409);
  // Hemen "çıkardım" demek olmaz: balık en kısa mücadele süresinden önce çıkmaz
  const erkenCikar = await A.c(`/api/balik/${at2.id}/cikar`, { basari: true });
  assert.equal(erkenCikar.durum, 409);
  await bekle(cek.minMs + 50);
  const cikar = (await A.c(`/api/balik/${at2.id}/cikar`, { basari: true })).veri;
  assert.equal(cikar.tutuldu, true);
  assert.ok(['INCI_KEFALI', 'ALTIN_BALIK'].includes(cikar.urun));
  const kg = BALIK.turler[cikar.urun].kg;
  assert.ok(cikar.agirlik >= kg[0] && cikar.agirlik <= kg[1]);
  assert.equal(cikar.rekor, true, 'ilk balık kişisel rekordur');
  assert.equal(L.envanterMiktar(A.id, cikar.urun), 1);
  assert.equal((await A.c(`/api/balik/${at2.id}/cikar`, { basari: true })).durum, 409);
  // Misina koparsa balık kaçar, envanter değişmez
  const at3 = (await A.c('/api/balik/at', { lon: 43.2, lat: 38.6 })).veri;
  await bekle(at3.isirmaMs + 100);
  assert.equal((await A.c(`/api/balik/${at3.id}/cek`, {})).veri.takildi, true);
  const koptu = (await A.c(`/api/balik/${at3.id}/cikar`, { basari: false })).veri;
  assert.equal(koptu.tutuldu, false);
  assert.equal(L.envanterMiktar(A.id, cikar.urun), 1);
  // Başka oyuncu benim oltamı çekemez
  assert.equal((await B.c(`/api/balik/${at3.id}/cikar`, { basari: true })).durum, 404);
  // Günlük sınır
  db.prepare(`UPDATE balik_atislari SET gun = gun WHERE user_id = ?`).run(A.id);
  for (let i = 0; i < BALIK.gunlukAtis; i++) db.prepare(`INSERT INTO balik_atislari (user_id, tur, isirma, gun, at, durum) VALUES (?, 'SAZAN', 0, ?, 0, 'KACTI')`).run(A.id, new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10));
  assert.equal((await A.c('/api/balik/at', { lon: 43.2, lat: 38.6 })).durum, 429);
  balik.ayar.suBul = eski;
});

test('hatırlatma: hasadı gelen tarla bir kez bildirilir; sessiz saatte gönderilmez; kapatılabilir', async () => {
  const H = require('../server/hatirlatma');
  db.prepare(`UPDATE crops SET ready_at = ? WHERE parcel_id = ? AND status = 'GROWING'`).run(Date.now() - 1000, parselB);
  const ogle = Date.UTC(2026, 9, 21, 9);   // 12.00 Türkiye
  const gece = Date.UTC(2026, 9, 21, 22);  // 01.00 Türkiye
  assert.equal(H.sessizMi(gece), true);
  assert.equal(H.bakim(gece), 0);
  const once = db.prepare(`SELECT COUNT(*) c FROM notifications WHERE user_id = ?`).get(B.id).c;
  db.prepare(`UPDATE crops SET ready_at = ? WHERE parcel_id = ? AND status = 'GROWING'`).run(ogle - 1000, parselB);
  assert.ok(H.bakim(ogle) >= 1);
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM notifications WHERE user_id = ?`).get(B.id).c, once + 1);
  assert.match(db.prepare(`SELECT text FROM notifications WHERE user_id = ? ORDER BY id DESC`).get(B.id).text, /hasada hazır/);
  H.bakim(ogle);
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM notifications WHERE user_id = ?`).get(B.id).c, once + 1, 'aynı olay ikinci kez bildirilmez');
  // Kapatılan oyuncuya gitmez
  assert.equal((await A.c('/api/hesap/ayarlar', { hatirlatma: false })).durum, 200);
  const parselA = hucreBul('TARIM');
  await A.c(`/api/parsel/${parselA}/edin`, {});
  await A.c(`/api/parsel/${parselA}/ek`, { urun: 'BUGDAY' });
  db.prepare(`UPDATE crops SET ready_at = ? WHERE parcel_id = ? AND status = 'GROWING'`).run(ogle - 1000, parselA);
  const onceA = db.prepare(`SELECT COUNT(*) c FROM notifications WHERE user_id = ?`).get(A.id).c;
  H.bakim(ogle);
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM notifications WHERE user_id = ?`).get(A.id).c, onceA);
});

test('güvenlik: arkadaş olmayana yardım edilemez; silinen istek hemen yeniden gönderilemez', async () => {
  const D = await kayit('deniz');
  const parselD = hucreBul('TARIM');
  await D.c(`/api/parsel/${parselD}/edin`, {});
  await D.c(`/api/parsel/${parselD}/ek`, { urun: 'BUGDAY' });
  assert.equal((await A.c(`/api/parsel/${parselD}/yardim`, {})).durum, 403);
  assert.equal((await A.c('/api/arkadas/istek', { parselId: parselD })).durum, 200);
  assert.equal((await A.c(`/api/arkadas/${D.id}/sil`, {})).durum, 200);
  assert.equal((await A.c('/api/arkadas/istek', { parselId: parselD })).durum, 429, 'aynı kişiye bir hafta içinde ikinci istek');
});

test('güvenlik: tarla önerisi giriş ister ve Türkiye dışını reddeder; yarışma ve mahalle uçları', async () => {
  assert.equal((await fetch(`${taban}/api/oneri/tarla?lon=32.5&lat=37.9`)).status, 401);
  assert.deepEqual((await A.c('/api/oneri/tarla?lon=10&lat=50')).veri, { parsel: null });
  // Ziyaretçinin mahalle tıklaması veritabanına bölge yazmaz
  const ilce = db.prepare(`SELECT p.ilce_id, r.source_idx FROM parcels p JOIN regions r ON r.id = p.ilce_id WHERE p.id = ?`).get(parselB);
  const yer = db.prepare(`SELECT id FROM yerler WHERE ilce_idx = ? AND id NOT IN (SELECT substr(code, length((SELECT code FROM regions WHERE id = ?)) + 2) FROM regions WHERE parent_id = ?) LIMIT 1`).get(ilce.source_idx, ilce.ilce_id, ilce.ilce_id);
  if (yer) {
    const once = db.prepare(`SELECT COUNT(*) c FROM regions`).get().c;
    const r = await fetch(`${taban}/api/ilce/${ilce.ilce_id}/mahalle`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ yerId: yer.id }) });
    assert.equal((await r.json()).id, null);
    assert.equal(db.prepare(`SELECT COUNT(*) c FROM regions`).get().c, once);
  }
});

test('güvenlik: suya düşmeyen olta da günlük hakkı tüketir', async () => {
  const balik = require('../server/balik');
  const eski = balik.ayar.suBul;
  balik.ayar.suBul = async () => null;
  const E = await kayit('ece');
  db.prepare('UPDATE users SET tp = 240 WHERE id = ?').run(E.id);   // balık 3. seviyede açılır
  const g = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  for (let i = 0; i < BALIK.gunlukAtis; i++) assert.equal((await E.c('/api/balik/at', { lon: 32, lat: 37 })).durum, 422);
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM balik_atislari WHERE user_id = ? AND gun = ?`).get(E.id, g).c, BALIK.gunlukAtis);
  assert.equal((await E.c('/api/balik/at', { lon: 32, lat: 37 })).durum, 429);
  balik.ayar.suBul = eski;
});

test('NPC pazarı: ortak limit dolsa da her oyuncunun günlük kişisel tabanı kadar alım yapılır', async () => {
  const { NPC_PAZAR } = require('../server/config/rules');
  const F = await kayit('fatma');
  const bugun = new Date().toISOString().slice(0, 10);   // oyun.js günü (UTC)
  db.prepare(`INSERT INTO npc_demand (day, item_id, sold) VALUES (?, 'BUGDAY', ?) ON CONFLICT(day, item_id) DO UPDATE SET sold = excluded.sold`).run(bugun, NPC_PAZAR.gunlukTalep);
  L.envanterDegis(F.id, 'BUGDAY', 60, 'test');
  const r = await F.c('/api/pazar/sat', { urun: 'BUGDAY', miktar: 60 });
  assert.equal(r.durum, 200, JSON.stringify(r.veri));
  assert.equal(r.veri.adet, NPC_PAZAR.kisiselTaban);
  assert.equal((await F.c('/api/pazar/sat', { urun: 'BUGDAY', miktar: 5 })).durum, 409);
  assert.equal((await F.c('/api/ben')).veri.gorevler.find((g) => g.kod === 'ILK_SATIS').tamam, true, 'ilk satış görevi tamamlanır');
});

test('hediye: günlük açma sınırı açılış gününe göre sayılır (birikmiş hediyeler sınırı aşamaz)', async () => {
  const { KOMSULUK } = require('../server/config/rules');
  const G = await kayit('gul');
  const eski = new Date(Date.now() - 3 * 86400e3 + 3 * 3600e3).toISOString().slice(0, 10);
  const ekle = db.prepare(`INSERT INTO hediyeler (gonderen, alici, gun, icerik, at) VALUES (?, ?, ?, ?, ?)`);
  for (let i = 0; i < KOMSULUK.hediyeGunlukAlim + 3; i++) ekle.run(A.id, G.id, `${eski}-${i}`, JSON.stringify({ akce: 1 }), Date.now());
  const ids = db.prepare(`SELECT id FROM hediyeler WHERE alici = ? ORDER BY id`).all(G.id).map((r) => r.id);
  let acilan = 0;
  for (const id of ids) if ((await G.c(`/api/hediye/${id}/al`, {})).durum === 200) acilan++;
  assert.equal(acilan, KOMSULUK.hediyeGunlukAlim);
});
