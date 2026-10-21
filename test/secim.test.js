// Mahalle muhtarlığı seçimi (plan §6, §14.3, §20.1: "Seçimde aynı kimlik/sistem kontrolü aşılmış çoklu oylar tespit ediliyor").
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { ortamKur } = require('./yardimci');

const VERI = ortamKur('secim');
const app = require('../server/index');
const db = require('../server/db');
const I = require('../server/harita/izgara');
const secim = require('../server/secim');
const { sahteImar, KOD_AD } = require('../server/harita/imar');

let sunucu, taban;
before(async () => {
  await new Promise((r) => { sunucu = app.listen(0, r); });
  taban = `http://127.0.0.1:${sunucu.address().port}`;
  await app.hazir;
});
after(() => { sunucu.close(); fs.rmSync(VERI, { recursive: true, force: true }); });

// Her oyuncu kendi "cihazından" (tarayıcı kimliği) bağlanır; aynı cihaz paylaşımı bilerek kurulur
function istemci(cihaz) {
  let cerez = '';
  return async (yol, govde) => {
    const r = await fetch(taban + yol, {
      method: govde ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', cookie: cerez, 'user-agent': `TestTarayici/${cihaz}` },
      body: govde ? JSON.stringify(govde) : undefined,
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cerez = sc.split(';')[0];
    return { durum: r.status, veri: await r.json() };
  };
}

// Aynı mahallede (karonun ortasında) tarım hücreleri: sahte kaynakta her karonun tek yerleşim noktası vardır
function mahalleHucreleri([lon, lat]) {
  const c = I.hucre(lon, lat);
  const kx = c.x >> 6, ky = c.y >> 6;
  const liste = [];
  for (let dy = -14; dy <= 14; dy++) for (let dx = -14; dx <= 14; dx++) {
    const x = kx * 64 + 32 + dx, y = ky * 64 + 32 + dy;
    if (KOD_AD[sahteImar(x, y)] === 'TARIM') liste.push(I.parselId(x, y));
  }
  return liste;
}

// Seçim takvimini, şu an verilen aşamanın içinde olacak şekilde geriye kaydır
function asamayaGetir(secimId, asama) {
  const s = db.prepare('SELECT * FROM secimler WHERE id = ?').get(secimId);
  const hedef = { ADAYLIK: s.adaylik_at, KAMPANYA: s.kampanya_at, OYLAMA: s.oylama_at, ITIRAZ: s.itiraz_at, BITTI: s.bitis_at }[asama];
  const kaydir = hedef - Date.now() + 5;
  db.prepare(`UPDATE secimler SET duyuru_at = duyuru_at - ?, adaylik_at = adaylik_at - ?, kampanya_at = kampanya_at - ?,
              oylama_at = oylama_at - ?, itiraz_at = itiraz_at - ?, bitis_at = bitis_at - ? WHERE id = ?`)
    .run(kaydir, kaydir, kaydir, kaydir, kaydir, kaydir, secimId);
  secim.secimBakim();
  return db.prepare('SELECT * FROM secimler WHERE id = ?').get(secimId);
}
const eskit = (email) => db.prepare(`UPDATE users SET created_at = datetime('now', '-40 days') WHERE email = ?`).run(email);

async function oyuncu(ad, cihaz, hucre) {
  const c = istemci(cihaz);
  assert.equal((await c('/api/kayit', { email: `${ad.toLowerCase()}@test.local`, sifre: 'parola123', dogumYili: 1990, kosullarOnay: true, kvkkOnay: true, ad })).durum, 201);
  eskit(`${ad.toLowerCase()}@test.local`);
  if (hucre) assert.equal((await c(`/api/parsel/${hucre}/edin`, {})).durum, 200);
  return c;
}
// Adaylık için itibar ve etkinlik: birkaç gerçek oyun eylemi
async function etkinOl(c, hucre) {
  for (const tip of ['TEL_CIT', 'PEYZAJ', 'SULAMA_HATTI']) assert.equal((await c(`/api/parsel/${hucre}/insaat`, { tip })).durum, 200);
}

let A, B, C, D, E, F, mahalleId, secimId, hucreler;
const MANIFESTO = 'Mahallemize sulama kanalı ve ortak ambar kazandıracağım; her ay açık toplantı yapacağım.';

test('yeterli sakin olunca mahallede seçim duyurulur', async () => {
  hucreler = mahalleHucreleri([32.85, 39.92]);   // Ankara
  A = await oyuncu('Ayla', 'a', hucreler[0]);
  B = await oyuncu('Baris', 'b', hucreler[3]);
  C = await oyuncu('Cem', 'cd', hucreler[6]);
  D = await oyuncu('Deniz', 'cd', hucreler[9]);    // Cem ile aynı cihaz
  E = await oyuncu('Ece', 'e', null);              // mahallede parseli yok
  const kartlar = await Promise.all([0, 3, 6, 9].map((i) => A(`/api/parsel/${hucreler[i]}`)));
  mahalleId = kartlar[0].veri.mahalleId;
  assert.ok(kartlar.every((k) => k.veri.mahalleId === mahalleId), 'dört oyuncu aynı mahallede');

  secim.secimBakim({ zorla: true });
  const m = (await A(`/api/mahalle/${mahalleId}`)).veri;
  assert.equal(m.sakinSayisi, 4);
  assert.equal(m.secim.asama, 'DUYURU');
  assert.equal(m.secim.takvim.length, 6);
  secimId = m.secim.id;
  assert.equal((await A(`/api/secim/${secimId}/aday`, { manifesto: MANIFESTO })).durum, 409, 'duyuru aşamasında adaylık yok');
  assert.ok((await A('/api/bildirimler')).veri.some((b) => /seçimi duyuruldu/.test(b.text)));
});

test('adaylık şartları: sakinlik, itibar, etkinlik; ücret yok', async () => {
  asamayaGetir(secimId, 'ADAYLIK');
  const r = await A(`/api/secim/${secimId}/aday`, { manifesto: MANIFESTO });
  assert.equal(r.durum, 403);
  assert.match(r.veri.hata, /eylem/);
  await etkinOl(A, hucreler[0]);
  await etkinOl(B, hucreler[3]);
  const bakiyeOnce = (await A('/api/ben')).veri.bakiye;
  assert.equal((await A(`/api/secim/${secimId}/aday`, { manifesto: 'kısa' })).durum, 400);
  assert.equal((await A(`/api/secim/${secimId}/aday`, { manifesto: MANIFESTO, vaatler: ['a1a', 'b2b', 'c3c', 'd4d', 'e5e', 'f6f'] })).durum, 400);
  assert.equal((await A(`/api/secim/${secimId}/aday`, { manifesto: MANIFESTO, vaatler: ['Sulama kanalı', 'Ortak ambar'], butce: 400 })).durum, 200);
  assert.equal((await A('/api/ben')).veri.bakiye, bakiyeOnce, 'adaylık ücretsiz');
  assert.equal((await A(`/api/secim/${secimId}/aday`, { manifesto: MANIFESTO })).durum, 409);
  const e = await E(`/api/secim/${secimId}/aday`, { manifesto: MANIFESTO });
  assert.equal(e.durum, 403);
  assert.match(e.veri.hata, /parselin olmalı/);
  assert.equal((await B(`/api/secim/${secimId}/aday`, { manifesto: 'Pazar yeri ve yol bakımı önceliğim olacak, her şey şeffaf olacak.', vaatler: ['Pazar yeri'] })).durum, 200);
});

test('kampanya başında kütük dondurulur: sonradan parsel alan oy kullanamaz', async () => {
  asamayaGetir(secimId, 'KAMPANYA');
  const m = (await A(`/api/mahalle/${secimId && mahalleId}`)).veri;
  assert.equal(m.secim.asama, 'KAMPANYA');
  assert.equal(m.secim.kutukSayisi, 4);
  F = await oyuncu('Fatih', 'f', hucreler[12]);
  assert.equal((await F(`/api/mahalle/${mahalleId}`)).veri.secim.ben.kutukte, false);
});

let adayA, adayB, makbuzA;
test('gizli oy: tek hesap tek oy, makbuz yalnızca dahil olduğunu kanıtlar', async () => {
  asamayaGetir(secimId, 'OYLAMA');
  const m = (await A(`/api/mahalle/${mahalleId}`)).veri;
  adayA = m.secim.adaylar.find((x) => x.ad === 'Ayla').id;
  adayB = m.secim.adaylar.find((x) => x.ad === 'Baris').id;
  assert.ok(m.secim.adaylar.every((x) => x.oy === null), 'oylama sürerken sonuç görünmez');

  const r = await A(`/api/secim/${secimId}/oy`, { adayId: adayA });
  assert.equal(r.durum, 200);
  makbuzA = r.veri.makbuz;
  assert.equal(r.veri.gorev?.kod, 'ILK_OY');
  assert.equal(Object.keys(r.veri).includes('adayId'), false);
  assert.equal((await A(`/api/secim/${secimId}/oy`, { adayId: adayB })).durum, 409, 'çift oy');
  assert.equal((await B(`/api/secim/${secimId}/oy`, { adayId: 99999 })).durum, 400);
  assert.equal((await B(`/api/secim/${secimId}/oy`, { adayId: adayA })).durum, 200);
  assert.equal((await C(`/api/secim/${secimId}/oy`, { adayId: adayB })).durum, 200);
  assert.equal((await D(`/api/secim/${secimId}/oy`, { adayId: adayA })).durum, 200);
  assert.equal((await F(`/api/secim/${secimId}/oy`, { adayId: adayB })).durum, 403, 'kütük dışı');
  assert.equal((await E(`/api/secim/${secimId}/oy`, { adayId: adayB })).durum, 403);

  const dogrula = (await E(`/api/secim/${secimId}/makbuz`, { makbuz: makbuzA })).veri;
  assert.deepEqual(dogrula, { dahil: true }, 'makbuz kime oy verildiğini söylemez');
  assert.deepEqual((await E(`/api/secim/${secimId}/makbuz`, { makbuz: 'uydurma-makbuz' })).veri, { dahil: false });
  assert.equal((await A(`/api/mahalle/${mahalleId}`)).veri.secim.katilimSayisi, 4);
});

test('oy kaydı kimlik içermez ve değiştirilemez', () => {
  const oyKolonlari = db.prepare(`PRAGMA table_info(secim_oylari)`).all().map((k) => k.name);
  const katilimKolonlari = db.prepare(`PRAGMA table_info(secim_katilim)`).all().map((k) => k.name);
  assert.ok(!oyKolonlari.some((k) => /user|created|zaman/.test(k)), `oy tablosu: ${oyKolonlari}`);
  assert.ok(!katilimKolonlari.some((k) => /aday/.test(k)), `katılım tablosu: ${katilimKolonlari}`);
  assert.throws(() => db.prepare(`UPDATE secim_oylari SET aday_id = ?`).run(adayB), /değiştirilemez/);
  assert.throws(() => db.prepare(`DELETE FROM secim_oylari`).run(), /silinemez/);
  const audit = db.prepare(`SELECT after_json FROM audit_events WHERE action = 'VOTE_CAST'`).all();
  assert.ok(audit.every((a) => a.after_json === null), 'denetim kaydında oy tercihi yok');
});

test('oylama bitince sayım, katılım ve aynı cihaz bulgusu açıklanır; itiraz edilebilir', async () => {
  asamayaGetir(secimId, 'ITIRAZ');
  const s = (await A(`/api/mahalle/${mahalleId}`)).veri.secim;
  assert.equal(s.asama, 'ITIRAZ');
  assert.equal(s.sonuc.toplam, 4);
  assert.equal(s.sonuc.kutuk, 4);
  assert.equal(s.adaylar.find((x) => x.id === adayA).oy, 3);
  assert.equal(s.sonuc.marj, 2);
  assert.equal(s.sonuc.denetim.supheli, 1);
  assert.ok(s.sonuc.denetim.bulgular.some((b) => b.tur === 'AYNI_CIHAZ' && b.sayi === 2));
  assert.equal(s.sonuc.kazananAdayId, adayA);
  assert.ok(/^[0-9a-f]{64}$/.test(s.sonuc.ozetHash));

  assert.equal((await C(`/api/secim/${secimId}/itiraz`, { sebep: 'Aynı cihazdan birden fazla oy kullanıldığı görülüyor.' })).durum, 200);
  assert.equal((await C(`/api/secim/${secimId}/itiraz`, { sebep: 'İkinci itiraz denemesi yapılıyor.' })).durum, 409);
  assert.equal((await E(`/api/secim/${secimId}/itiraz`, { sebep: 'Seçmen olmayan itiraz denemesi.' })).durum, 403);
  const say = (await E(`/api/secim/${secimId}/yeniden-say`)).veri;
  assert.equal(say.uyumlu, true);
});

test('şüpheli katılım farkı değiştiremiyorsa sonuç kesinleşir, muhtar devralır', async () => {
  asamayaGetir(secimId, 'BITTI');
  const m = (await A(`/api/mahalle/${mahalleId}`)).veri;
  assert.equal(m.secim.asama, 'SONUCLANDI');
  assert.equal(m.muhtar.ad, 'Ayla');
  assert.equal(m.muhtar.ben, true);
  assert.deepEqual(m.muhtar.vaatler.map((v) => v.metin), ['Sulama kanalı', 'Ortak ambar']);
  assert.equal(m.secim.itirazlar[0].durum, 'RED');
  assert.match(m.secim.itirazlar[0].yanit, /yeniden sayım/i);
  const akis = (await A('/api/akis')).veri;
  assert.ok(akis.some((a) => a.action === 'ELECTION_CLOSED' && a.after.kazanan === 'Ayla'));
  secim.secimBakim({ zorla: true });
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM secimler WHERE region_id = ? AND asama = 'DUYURU'`).get(mahalleId).c, 0, 'görev sürerken yeni seçim yok');
});

test('muhtar yetkileri: duyuru ve vaat takibi yalnızca muhtara açık', async () => {
  assert.equal((await A(`/api/mahalle/${mahalleId}/duyuru`, { metin: 'Cumartesi mahalle toplantısı yapılacak.' })).durum, 200);
  assert.equal((await B(`/api/mahalle/${mahalleId}/duyuru`, { metin: 'Ben de duyuru yapmak istiyorum.' })).durum, 403);
  const vaat = (await A(`/api/mahalle/${mahalleId}`)).veri.muhtar.vaatler[0];
  assert.equal((await B(`/api/vaat/${vaat.id}`, { durum: 'TAMAMLANDI' })).durum, 403);
  assert.equal((await A(`/api/vaat/${vaat.id}`, { durum: 'BASLADI', aciklama: 'Keşif yapıldı' })).durum, 200);
  assert.equal((await A(`/api/vaat/${vaat.id}`, { durum: 'UYDURMA' })).durum, 400);
  const m = (await B(`/api/mahalle/${mahalleId}`)).veri;
  assert.equal(m.muhtar.vaatler[0].durum, 'BASLADI');
  assert.equal(m.duyurular[0].metin, 'Cumartesi mahalle toplantısı yapılacak.');
  assert.ok((await B('/api/bildirimler')).veri.some((b) => /Muhtardan duyuru/.test(b.text)));
});

test('şüpheli oylar sonucu değiştirebilecekse seçim iptal edilir', async () => {
  const h = mahalleHucreleri([32.49, 37.87]);   // Konya: başka mahalle
  const G = await oyuncu('Gul', 'ortak', h[0]);
  const H = await oyuncu('Hakan', 'ortak', h[3]);
  const K = await oyuncu('Kemal', 'ortak', h[6]);
  await etkinOl(G, h[0]);
  await etkinOl(H, h[3]);
  const mid = (await G(`/api/parsel/${h[0]}`)).veri.mahalleId;
  secim.secimBakim({ zorla: true });
  const sid = (await G(`/api/mahalle/${mid}`)).veri.secim.id;
  asamayaGetir(sid, 'ADAYLIK');
  assert.equal((await G(`/api/secim/${sid}/aday`, { manifesto: MANIFESTO })).durum, 200);
  assert.equal((await H(`/api/secim/${sid}/aday`, { manifesto: MANIFESTO })).durum, 200);
  asamayaGetir(sid, 'OYLAMA');
  const adaylar = (await G(`/api/mahalle/${mid}`)).veri.secim.adaylar;
  const g = adaylar.find((x) => x.ad === 'Gul').id, hh = adaylar.find((x) => x.ad === 'Hakan').id;
  for (const [c, a] of [[G, g], [H, hh], [K, g]]) assert.equal((await c(`/api/secim/${sid}/oy`, { adayId: a })).durum, 200);
  asamayaGetir(sid, 'ITIRAZ');
  asamayaGetir(sid, 'BITTI');
  const m = (await G(`/api/mahalle/${mid}`)).veri;
  assert.equal(m.secim.asama, 'IPTAL');
  assert.match(m.secim.iptalSebebi, /Şüpheli katılım \(2\).*\(1\)/);
  assert.equal(m.muhtar, null);
  assert.ok((await G('/api/akis')).veri.some((a) => a.action === 'ELECTION_ANNULLED'));
});

test('aday çıkmazsa seçim kapanır, geçici yönetim sürer', async () => {
  const h = mahalleHucreleri([30.52, 39.78]);   // Eskişehir
  const oyuncular = [];
  for (const [i, ad] of ['Lale', 'Mert', 'Nil'].entries()) oyuncular.push(await oyuncu(ad, ad, h[i * 3]));
  const mid = (await oyuncular[0](`/api/parsel/${h[0]}`)).veri.mahalleId;
  secim.secimBakim({ zorla: true });
  const sid = (await oyuncular[0](`/api/mahalle/${mid}`)).veri.secim.id;
  asamayaGetir(sid, 'ADAYLIK');
  asamayaGetir(sid, 'KAMPANYA');
  const m = (await oyuncular[0](`/api/mahalle/${mid}`)).veri;
  assert.equal(m.secim.asama, 'ADAY_YOK');
  assert.equal(m.muhtar, null);
});

test('az sakinli mahallede seçim açılmaz; gerekçe gösterilir', async () => {
  const h = mahalleHucreleri([38.39, 40.90]);   // Giresun
  const P = await oyuncu('Pinar', 'p', h[0]);
  const mid = (await P(`/api/parsel/${h[0]}`)).veri.mahalleId;
  secim.secimBakim({ zorla: true });
  const m = (await P(`/api/mahalle/${mid}`)).veri;
  assert.equal(m.secim, null);
  // Yaşayan nüfus açıkken demo sakinler yerleşince seçim kendiliğinden açılır; kapalıyken eşik açıklanır
  assert.match(m.yeniSecim, /Demo sakinler yerleştikçe|en az 3 oyuncu/);
});
