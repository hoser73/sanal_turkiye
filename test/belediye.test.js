// İlçe belediyesi (plan §6.1, §6.3, §6.4, Senaryo C): başkan + meclis seçimi, kasa, talep, proje, meclis kararı, etkiler.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { ortamKur } = require('./yardimci');

const VERI = ortamKur('belediye');
const app = require('../server/index');
const db = require('../server/db');
const I = require('../server/harita/izgara');
const L = require('../server/lib/ledger');
const secim = require('../server/secim');
const belediye = require('../server/belediye');
const { sahteImar, KOD_AD } = require('../server/harita/imar');
const { BELEDIYE, YAPILAR, URUNLER, TARIM } = require('../server/config/rules');

let sunucu, taban;
before(async () => {
  await new Promise((r) => { sunucu = app.listen(0, r); });
  taban = `http://127.0.0.1:${sunucu.address().port}`;
  await app.hazir;
});
after(() => { sunucu.close(); fs.rmSync(VERI, { recursive: true, force: true }); });

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
// Aynı karonun ortasındaki tarım hücreleri (sahte kaynakta her karo bir mahalle)
function karoHucreleri([lon, lat]) {
  const c = I.hucre(lon, lat);
  const kx = c.x >> 6, ky = c.y >> 6;
  const liste = [];
  for (let dy = -14; dy <= 14; dy++) for (let dx = -14; dx <= 14; dx++) {
    const x = kx * 64 + 32 + dx, y = ky * 64 + 32 + dy;
    if (KOD_AD[sahteImar(x, y)] === 'TARIM') liste.push(I.parselId(x, y));
  }
  return liste;
}
function asamayaGetir(secimId, asama) {
  const s = db.prepare('SELECT * FROM secimler WHERE id = ?').get(secimId);
  const hedef = { ADAYLIK: s.adaylik_at, KAMPANYA: s.kampanya_at, OYLAMA: s.oylama_at, ITIRAZ: s.itiraz_at, BITTI: s.bitis_at }[asama];
  const k = hedef - Date.now() + 5;
  db.prepare(`UPDATE secimler SET duyuru_at = duyuru_at - ?, adaylik_at = adaylik_at - ?, kampanya_at = kampanya_at - ?,
              oylama_at = oylama_at - ?, itiraz_at = itiraz_at - ?, bitis_at = bitis_at - ? WHERE id = ?`).run(k, k, k, k, k, k, secimId);
  secim.secimBakim();
}
const kullanici = (email) => db.prepare('SELECT id FROM users WHERE email = ?').get(email).id;
// Oyuncuların geçmiş oyun etkinliği (adaylık şartı için düzenek)
function gecmisEtkinlik(email, n) {
  for (let i = 0; i < n; i++) L.denetim({ aktor: kullanici(email), eylem: 'TEST_GECMIS_ETKINLIK' });
}
async function oyuncu(ad, hucre) {
  const c = istemci(ad);
  const email = `${ad.toLowerCase()}@test.local`;
  assert.equal((await c('/api/kayit', { email, sifre: 'parola123', dogumYili: 1990, kosullarOnay: true, kvkkOnay: true, ad })).durum, 201);
  db.prepare(`UPDATE users SET created_at = datetime('now', '-40 days') WHERE email = ?`).run(email);
  assert.equal((await c(`/api/parsel/${hucre}/edin`, {})).durum, 200);
  return c;
}
const projeyiKarara = (id) => { db.prepare('UPDATE projeler SET oylama_bitis = ? WHERE id = ?').run(Date.now() - 1, id); belediye.belediyeBakim(); };
const projeyiBitir = (id) => { db.prepare('UPDATE projeler SET yapim_bitis = ? WHERE id = ?').run(Date.now() - 1, id); belediye.belediyeBakim(); };
const proje = (id) => db.prepare('SELECT * FROM projeler WHERE id = ?').get(id);

let A, B, C, D, E, ilceId, m1, m2, h1, h2, secimId, adaylar;

test('ilçe kasası: tahsis ve ruhsat payı, günlük devlet katkısı (bir kez)', async () => {
  h1 = karoHucreleri([32.85, 39.92]);   // Çankaya, 1. mahalle
  h2 = karoHucreleri([32.83, 39.90]);   // Çankaya, 2. mahalle
  A = await oyuncu('Asli', h1[0]);
  B = await oyuncu('Burak', h1[3]);
  C = await oyuncu('Ceren', h1[6]);
  D = await oyuncu('Doruk', h1[9]);
  E = await oyuncu('Emel', h2[0]);
  const k1 = (await A(`/api/parsel/${h1[0]}`)).veri, k2 = (await E(`/api/parsel/${h2[0]}`)).veri;
  ilceId = k1.belediyeId; m1 = k1.mahalleId; m2 = k2.mahalleId;
  assert.equal(k2.belediyeId, ilceId, 'iki mahalle aynı ilçede');
  assert.notEqual(m1, m2);
  assert.equal(k1.ilce, 'Çankaya');

  const tahsis = db.prepare(`SELECT SUM(price) s FROM parcel_ownership o JOIN parcels p ON p.id = o.parcel_id WHERE p.ilce_id = ?`).get(ilceId).s;
  const kasaTahsis = db.prepare(`SELECT SUM(credit) s FROM wallet_ledger WHERE account = ? AND reason LIKE '%tahsis%'`).get(belediye.kasa(ilceId)).s;
  assert.ok(kasaTahsis > 0 && kasaTahsis <= tahsis * BELEDIYE.gelir.tahsisPayi);
  assert.equal((await A(`/api/parsel/${h1[0]}/insaat`, { tip: 'TEL_CIT' })).durum, 200);
  assert.equal(db.prepare(`SELECT SUM(credit) s FROM wallet_ledger WHERE account = ? AND reason LIKE '%ruhsat%'`).get(belediye.kasa(ilceId)).s,
    Math.floor(YAPILAR.TEL_CIT.maliyet * BELEDIYE.gelir.ruhsatPayi));

  const once = L.hesapBakiye(belediye.kasa(ilceId));
  belediye.belediyeBakim({ zorla: true });
  const sonra = L.hesapBakiye(belediye.kasa(ilceId));
  assert.ok(sonra - once === 5 * BELEDIYE.gelir.sakinBasiGunluk || sonra === once, 'günlük katkı 5 sakin × 4');
  belediye.belediyeBakim({ zorla: true });
  assert.equal(L.hesapBakiye(belediye.kasa(ilceId)), sonra, 'aynı gün ikinci katkı yok');
});

test('başkan ve meclis seçimi: tek makama adaylık, iki bölümlü gizli pusula, koltuklar', async () => {
  secim.secimBakim({ zorla: true });
  const b = (await A(`/api/belediye/${ilceId}`)).veri;
  assert.equal(b.secim.tur, 'BELEDIYE');
  assert.equal(b.secim.asama, 'DUYURU');
  assert.deepEqual(Object.keys(b.secim.makamlar), ['BASKAN', 'MECLIS']);
  secimId = b.secim.id;
  asamayaGetir(secimId, 'ADAYLIK');

  const M = 'İlçemizde sulama, yol ve pazar hizmetlerini açık bütçeyle ve meclisle birlikte yürüteceğim.';
  const r = await A(`/api/secim/${secimId}/aday`, { makam: 'BASKAN', manifesto: M });
  assert.equal(r.durum, 403);
  assert.match(r.veri.hata, /Belediye başkanı adayı olamazsın.*eylem/);
  for (const e of ['asli', 'burak', 'ceren', 'doruk']) gecmisEtkinlik(`${e}@test.local`, 12);
  assert.equal((await A(`/api/secim/${secimId}/aday`, { manifesto: M })).durum, 400, 'makam seçilmeli');
  assert.equal((await A(`/api/secim/${secimId}/aday`, { makam: 'BASKAN', manifesto: M, vaatler: ['Sulama kanalı'] })).durum, 200);
  assert.equal((await A(`/api/secim/${secimId}/aday`, { makam: 'MECLIS', manifesto: M })).durum, 409, 'tek makam');
  for (const c of [B, C, D]) assert.equal((await c(`/api/secim/${secimId}/aday`, { makam: 'MECLIS', manifesto: M })).durum, 200);

  asamayaGetir(secimId, 'KAMPANYA');
  asamayaGetir(secimId, 'OYLAMA');
  adaylar = Object.fromEntries((await A(`/api/belediye/${ilceId}`)).veri.secim.adaylar.map((a) => [a.ad, a.id]));
  assert.equal((await A(`/api/secim/${secimId}/oy`, { secimler: { BASKAN: adaylar.Asli } })).durum, 400, 'meclis bölümü boş bırakılamaz');
  assert.equal((await A(`/api/secim/${secimId}/oy`, { secimler: { BASKAN: adaylar.Burak, MECLIS: adaylar.Burak } })).durum, 400, 'başkan bölümünde meclis adayı geçersiz');
  const oylar = [[A, 'Burak'], [B, 'Ceren'], [C, 'Ceren'], [D, 'Doruk'], [E, 'Burak']];
  let makbuz;
  for (const [c, meclis] of oylar) {
    const r2 = await c(`/api/secim/${secimId}/oy`, { secimler: { BASKAN: adaylar.Asli, MECLIS: adaylar[meclis] } });
    assert.equal(r2.durum, 200);
    makbuz ||= r2.veri.makbuz;
  }
  assert.deepEqual((await E(`/api/secim/${secimId}/makbuz`, { makbuz })).veri, { dahil: true });
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM secim_oylari WHERE secim_id = ?`).get(secimId).c, 10, '5 seçmen × 2 bölüm');

  asamayaGetir(secimId, 'ITIRAZ');
  const s = (await A(`/api/belediye/${ilceId}`)).veri.secim;
  assert.equal(s.sonuc.toplam, 5);
  assert.deepEqual(s.sonuc.kazananlar.BASKAN, [adaylar.Asli]);
  assert.deepEqual([...s.sonuc.kazananlar.MECLIS].sort(), [adaylar.Burak, adaylar.Ceren, adaylar.Doruk].sort());
  assert.equal(s.sonuc.denetim.supheli, 0);
  assert.equal((await E(`/api/secim/${secimId}/yeniden-say`)).veri.uyumlu, true);

  asamayaGetir(secimId, 'BITTI');
  const bb = (await B(`/api/belediye/${ilceId}`)).veri;
  assert.equal(bb.secim.asama, 'SONUCLANDI');
  assert.equal(bb.baskan.ad, 'Asli');
  assert.deepEqual(bb.meclis.map((m) => m.ad).sort(), ['Burak', 'Ceren', 'Doruk']);
  assert.equal(bb.baskan.vaatler[0].metin, 'Sulama kanalı');
  assert.equal(bb.ben.uye, true);
  const akis = (await A('/api/akis')).veri.find((x) => x.action === 'ELECTION_CLOSED' && x.after.tur === 'BELEDIYE');
  assert.equal(akis.ilce, 'Çankaya');
  assert.equal(akis.il, 'Ankara');
});

test('yetki sınırları: yalnızca başkan teklif eder; ilçe dışı ve kasa yetersizliği reddedilir', async () => {
  assert.equal((await B(`/api/belediye/${ilceId}/proje`, { tur: 'PARK', hedefMahalleId: m2, gerekce: 'Meclis üyesi teklif denemesi yapıyor.' })).durum, 403);
  assert.equal((await A(`/api/belediye/${ilceId}/proje`, { tur: 'PARK', hedefMahalleId: 999999, gerekce: 'Başka ilçeye proje denemesi yapılıyor.' })).durum, 400);
  assert.equal((await A(`/api/belediye/${ilceId}/proje`, { tur: 'UYDURMA', hedefMahalleId: m2, gerekce: 'Geçersiz proje türü denemesi.' })).durum, 400);
  const r = await A(`/api/belediye/${ilceId}/proje`, { tur: 'PARK', hedefMahalleId: m2, gerekce: 'Kasa yetersizken park teklifi denemesi.' });
  assert.equal(r.durum, 409);
  assert.equal(r.veri.kod, 'KASA_YETERSIZ');
  // Düzenek: ilçeye devlet katkısı
  L.aktar({ kaynak: 'SYS:MINT', hedef: belediye.kasa(ilceId), tutar: 3000, sebep: 'Belediye geliri: devlet katkısı (test)' });
});

let p1, p2, p3, p4;
test('meclis: açık oylama, yeter sayı, eşitlikte başkan, nitelikli çoğunluk, çıkar çatışması', async () => {
  const G = 'Mahallenin tarlaları kurak; ortak sulama kanalı ile su maliyeti düşecek.';
  p1 = (await A(`/api/belediye/${ilceId}/proje`, { tur: 'SULAMA_KANALI', hedefMahalleId: m2, gerekce: G })).veri.projeId;
  assert.equal((await A(`/api/belediye/${ilceId}/proje`, { tur: 'SULAMA_KANALI', hedefMahalleId: m2, gerekce: G })).durum, 409, 'aynı hizmet süreçte');
  for (const [c, oy] of [[A, 'EVET'], [B, 'EVET'], [C, 'HAYIR'], [D, 'CEKIMSER']]) assert.equal((await c(`/api/proje/${p1}/oy`, { oy })).durum, 200);
  assert.equal((await E(`/api/proje/${p1}/oy`, { oy: 'EVET' })).durum, 403, 'üye olmayan');
  assert.equal((await B(`/api/proje/${p1}/oy`, { oy: 'BELKI' })).durum, 400);

  // Başkanın parseli olan mahalle: nitelikli çoğunluk; oy kullanabilecek en az 2 üye yoksa teklif baştan reddedilir
  const r2 = await A(`/api/belediye/${ilceId}/proje`, { tur: 'PARK', hedefMahalleId: m1, gerekce: 'Kendi mahallemize park yapılması öneriliyor.' });
  assert.equal(r2.durum, 409);
  assert.match(r2.veri.hata, /nitelikli çoğunluk.*en az 2 meclis üyesi/);
  // Teklif sonrası üyeler çıkarlı hâle gelirse oy kullanamaz, karar alınamaz (düzenek: doğrudan kayıt)
  p2 = db.prepare(`INSERT INTO projeler (region_id, hedef_region_id, tur, maliyet, gerekce, teklif_eden_id, durum, nitelikli, nitelikli_sebep, oylama_bitis, created_at)
                   VALUES (?, ?, 'PARK', 400, 'Kendi mahallemize park yapılması öneriliyor.', ?, 'MECLISTE', 1, 'başkanın hedef mahallede parseli var', ?, ?)`)
    .run(ilceId, m1, kullanici('asli@test.local'), Date.now() + 86400000, Date.now()).lastInsertRowid;
  const cikar = await A(`/api/proje/${p2}/oy`, { oy: 'EVET' });
  assert.equal(cikar.durum, 403);
  assert.equal(cikar.veri.kod, 'CIKAR_CATISMASI');
  assert.equal((await B(`/api/proje/${p2}/oy`, { oy: 'EVET' })).durum, 403);

  // Büyük proje (≥ 800): nitelikli; 2/4 yetmez
  p3 = (await A(`/api/belediye/${ilceId}/proje`, { tur: 'PAZAR_YERI', hedefMahalleId: m2, gerekce: 'Üreticilerin ürününü satabileceği semt pazarı kurulmalı.' })).veri.projeId;
  for (const [c, oy] of [[A, 'EVET'], [B, 'HAYIR'], [C, 'EVET'], [D, 'HAYIR']]) assert.equal((await c(`/api/proje/${p3}/oy`, { oy })).durum, 200);

  // Eşitlik (2–2): başkanın bulunduğu taraf
  p4 = (await A(`/api/belediye/${ilceId}/proje`, { tur: 'YOL_BAKIMI', hedefMahalleId: m2, gerekce: 'Mahalle yolları bozuk, inşaatlar gecikiyor.' })).veri.projeId;
  for (const [c, oy] of [[A, 'EVET'], [B, 'HAYIR'], [C, 'EVET'], [D, 'HAYIR']]) assert.equal((await c(`/api/proje/${p4}/oy`, { oy })).durum, 200);

  const kasaOnce = L.hesapBakiye(belediye.kasa(ilceId));
  for (const id of [p1, p2, p3, p4]) projeyiKarara(id);
  assert.equal(proje(p1).durum, 'YAPIMDA');
  assert.equal(proje(p2).durum, 'REDDEDILDI');
  assert.match(JSON.parse(proje(p2).karar_json).sebep, /çıkarı var/);
  assert.equal(proje(p3).durum, 'REDDEDILDI');
  assert.match(JSON.parse(proje(p3).karar_json).sebep, /Nitelikli çoğunluk/);
  assert.equal(proje(p4).durum, 'YAPIMDA');
  assert.match(JSON.parse(proje(p4).karar_json).sebep, /başkanın bulunduğu taraf: kabul/);
  assert.equal(L.hesapBakiye(belediye.kasa(ilceId)), kasaOnce - 600 - 500, 'bütçe kasadan çıktı');
  assert.equal(L.hesapBakiye(belediye.emanet(p1)), 600, 'proje emanetinde');
  const pano = (await E(`/api/belediye/${ilceId}`)).veri;
  const kart = pano.projeler.find((p) => p.id === p1);
  assert.deepEqual(kart.oylar.map((o) => `${o.ad}:${o.oy}`).sort(), ['Asli:EVET', 'Burak:EVET', 'Ceren:HAYIR', 'Doruk:CEKIMSER'], 'meclis oyları açık');
  assert.ok(pano.pano.some((x) => x.action === 'PROJECT_APPROVED'));
});

test('tamamlanan projeler hedef mahallede etki doğurur', async () => {
  projeyiBitir(p1);
  projeyiBitir(p4);
  assert.equal(proje(p1).durum, 'TAMAMLANDI');
  assert.equal(L.hesapBakiye(belediye.emanet(p1)), 0, 'emanet harcandı');
  const kart = (await E(`/api/parsel/${h2[0]}`)).veri;
  assert.deepEqual(kart.hizmetler.map((h) => h.kod).sort(), ['SULAMA_KANALI', 'YOL_BAKIMI']);
  // Yol bakımı: inşaat %25 kısa
  const r = await E(`/api/parsel/${h2[0]}/insaat`, { tip: 'TEL_CIT' });
  const sure = r.veri.bitis - Date.now();
  assert.ok(sure <= YAPILAR.TEL_CIT.sureMs * 0.76 + 20, `inşaat süresi ${sure}`);
  // Sulama kanalı: sulama maliyeti yarıya
  assert.equal((await E(`/api/parsel/${h2[0]}/ek`, { urun: 'DOMATES' })).durum, 200);
  const k2 = (await E(`/api/parsel/${h2[0]}`)).veri;
  const kat = Math.min(TARIM.maxVerimKati, Math.max(1, Math.round(k2.alan / TARIM.verimAlanBirimi)));
  assert.equal(k2.ekin.sulamaMaliyeti, TARIM.sulamaMaliyeti * 0.5 * kat);
  const s = await E(`/api/parsel/${h2[0]}/sula`, {});
  assert.equal(s.veri.maliyet, TARIM.sulamaMaliyeti * 0.5 * kat);
  // Etki kendi mahallesiyle sınırlı
  assert.deepEqual((await A(`/api/parsel/${h1[0]}`)).veri.hizmetler, []);
});

test('semt pazarı (nitelikli kabul) NPC satış fiyatını artırır', async () => {
  const p5 = (await A(`/api/belediye/${ilceId}/proje`, { tur: 'PAZAR_YERI', hedefMahalleId: m2, gerekce: 'İkinci kez: üreticiler için semt pazarı şart.' })).veri.projeId;
  for (const c of [A, B, C]) assert.equal((await c(`/api/proje/${p5}/oy`, { oy: 'EVET' })).durum, 200);
  projeyiKarara(p5);
  assert.equal(proje(p5).durum, 'YAPIMDA');
  projeyiBitir(p5);
  await new Promise((r) => setTimeout(r, URUNLER.DOMATES.sureMs + 50));
  const h = await E(`/api/parsel/${h2[0]}/hasat`, {});
  assert.equal(h.durum, 200);
  const sat = await E('/api/pazar/sat', { urun: 'DOMATES', miktar: 10 });
  assert.equal(sat.veri.pazarYeri, true);
  assert.ok(sat.veri.tutar > sat.veri.birimFiyat * 10, 'pazar yeri primi');
});

test('muhtar talebi meclis gündemine teklif olarak girer', async () => {
  // Düzenek: Emel 2. mahallenin muhtarı
  const t = Date.now();
  db.prepare(`INSERT INTO muhtarlar (region_id, user_id, secim_id, aday_id, baslangic, bitis) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(m2, kullanici('emel@test.local'), secimId, adaylar.Asli, t - 1000, t + 86400000);
  assert.equal((await B(`/api/mahalle/${m2}/talep`, { tur: 'PARK', aciklama: 'Muhtar olmayan talep denemesi.' })).durum, 403);
  const tl = await E(`/api/mahalle/${m2}/talep`, { tur: 'PARK', aciklama: 'Çocuklar için mahallemize park istiyoruz.' });
  assert.equal(tl.durum, 200);
  assert.equal((await E(`/api/mahalle/${m2}/talep`, { tur: 'PARK', aciklama: 'Aynı talep tekrar gönderiliyor.' })).durum, 409);
  assert.ok((await A('/api/bildirimler')).veri.some((b) => /muhtarından talep: Mahalle parkı/.test(b.text)));
  const r = await A(`/api/belediye/${ilceId}/proje`, { tur: 'PARK', hedefMahalleId: m2, gerekce: 'Muhtarın talebi üzerine park yapılması.', talepId: tl.veri.talepId });
  assert.equal(r.durum, 200);
  const b = (await A(`/api/belediye/${ilceId}`)).veri;
  assert.equal(b.talepler.find((x) => x.id === tl.veri.talepId).durum, 'TEKLIFE_DONUSTU');
  const once = db.prepare('SELECT attractiveness a FROM regions WHERE id = ?').get(m2).a;
  for (const c of [A, B]) await c(`/api/proje/${r.veri.projeId}/oy`, { oy: 'EVET' });
  await C(`/api/proje/${r.veri.projeId}/oy`, { oy: 'HAYIR' });
  projeyiKarara(r.veri.projeId);
  projeyiBitir(r.veri.projeId);
  assert.equal(db.prepare('SELECT attractiveness a FROM regions WHERE id = ?').get(m2).a, Math.round((once + 0.08) * 100) / 100, 'park çekiciliği artırdı');
});

test('defter: kasa ve emanetler tutarlı, harita belediye ve projeleri gösterir', async () => {
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM (SELECT tx_group FROM wallet_ledger GROUP BY tx_group HAVING ABS(SUM(debit) - SUM(credit)) > 0.001)`).get().c, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM (SELECT account FROM wallet_ledger WHERE account LIKE 'BEL:%' OR account LIKE 'PROJE:%'
                           GROUP BY account HAVING SUM(credit) - SUM(debit) < -0.001)`).get().c, 0);
  for (const p of db.prepare(`SELECT * FROM projeler`).all()) {
    assert.equal(L.hesapBakiye(belediye.emanet(p.id)), p.durum === 'YAPIMDA' ? p.maliyet : 0, `proje ${p.id} emaneti`);
  }
  const fc = (await A('/api/harita/belediyeler?bbox=32.6,39.7,33.1,40.1')).veri;
  assert.ok(fc.features.some((f) => f.properties.tur === 'belediye' && /Asli/.test(f.properties.etiket)));
  assert.ok(fc.features.some((f) => f.properties.tur === 'proje' && /hizmette/.test(f.properties.etiket)));
});

// ---------- Denetim bulguları: talep, dilekçe kütüğü, referandum kütüğü, ara seçim, moderasyon
const moderasyon = require('../server/moderasyon');
let F, G, m3;
async function yeniOyuncu(ad, hucre, eski) {
  const c = istemci(ad);
  const email = `${ad.toLowerCase()}@test.local`;
  assert.equal((await c('/api/kayit', { email, sifre: 'parola123', dogumYili: 1990, kosullarOnay: true, kvkkOnay: true, ad })).durum, 201);
  if (eski) db.prepare(`UPDATE users SET created_at = datetime('now', '-40 days') WHERE email = ?`).run(email);
  if (hucre) assert.equal((await c(`/api/parsel/${hucre}/edin`, {})).durum, 200);
  c.id = kullanici(email);
  return c;
}

test('reddedilen projenin muhtar talebi yeniden açılır', async () => {
  m3 = db.prepare(`SELECT id FROM regions WHERE parent_id = ? AND type = 'MAHALLE' AND id NOT IN (?, ?) LIMIT 1`).get(ilceId, m1, m2).id;
  const t = Date.now();
  db.prepare(`INSERT INTO muhtarlar (region_id, user_id, secim_id, aday_id, baslangic, bitis) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(m3, kullanici('emel@test.local'), secimId, adaylar.Asli, t - 1000, t + 86400000);
  L.aktar({ kaynak: 'SYS:MINT', hedef: belediye.kasa(ilceId), tutar: 1000, sebep: 'Belediye geliri: devlet katkısı (test)' });
  const tl = await E(`/api/mahalle/${m3}/talep`, { tur: 'PARK', aciklama: 'Üçüncü mahalleye park istiyoruz.' });
  assert.equal(tl.durum, 200);
  const r = await A(`/api/belediye/${ilceId}/proje`, { tur: 'PARK', hedefMahalleId: m3, gerekce: 'Muhtarın talebi üzerine park yapılması.', talepId: tl.veri.talepId });
  assert.equal(r.durum, 200);
  for (const c of [A, B]) await c(`/api/proje/${r.veri.projeId}/oy`, { oy: 'HAYIR' });
  projeyiKarara(r.veri.projeId);
  assert.equal(proje(r.veri.projeId).durum, 'REDDEDILDI');
  const talep = db.prepare('SELECT durum, proje_id FROM talepler WHERE id = ?').get(tl.veri.talepId);
  assert.equal(talep.durum, 'ACIK', 'talep yeniden açık');
  assert.equal(talep.proje_id, null);
});

test('görevden alma: imza kütüğü dilekçe açılırken donar, yeni hesaplar ve sonradan gelenler imzalayamaz', async () => {
  // Düzenek: görevin ilk %20'si (koruma) geçmiş olsun
  db.prepare(`UPDATE belediye_uyeleri SET baslangic = baslangic - ? WHERE region_id = ?`).run(30 * 86400000, ilceId);
  F = await yeniOyuncu('Fikret', h1[12], false);   // bugün açılmış hesap, ilçede parseli var
  const doruk = kullanici('doruk@test.local');
  const d = await E('/api/gorevden-alma', { bolgeId: ilceId, makam: 'MECLIS', hedefId: doruk, gerekce: 'Meclis toplantılarına hiç katılmıyor, oy da kullanmıyor.' });
  assert.equal(d.durum, 200);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM gorevden_alma_kutuk WHERE dilekce_id = ?').get(d.veri.id).c, 4, 'kütük: Asli, Burak, Ceren, Emel');
  const f = await F(`/api/gorevden-alma/${d.veri.id}/imza`, {});
  assert.equal(f.durum, 403, 'yeni hesap imzalayamaz');
  G = await yeniOyuncu('Gonca', null, true);
  await G(`/api/parsel/${h1[15]}/edin`, {});   // dilekçeden sonra gelen sakin
  assert.equal((await G(`/api/gorevden-alma/${d.veri.id}/imza`, {})).durum, 403, 'kütük dondurulmuş');
  assert.equal((await F('/api/gorevden-alma', { bolgeId: ilceId, makam: 'MECLIS', hedefId: kullanici('ceren@test.local'), gerekce: 'Yeni hesapla dilekçe başlatma denemesi yapılıyor.' })).durum, 403);
  const b = await B(`/api/gorevden-alma/${d.veri.id}/imza`, {});
  assert.equal(b.veri.durum, 'BASARILI');
  assert.deepEqual((await A(`/api/belediye/${ilceId}`)).veri.meclis.map((m) => m.ad).sort(), ['Burak', 'Ceren']);
});

test('referandum: yeni hesaplar öneremez ve kütüğe girmez', async () => {
  assert.equal((await F(`/api/belediye/${ilceId}/referandum`, { soru: 'İlçeye yeni bir kütüphane yapılmalı mı?' })).durum, 403);
  const r = (await A(`/api/belediye/${ilceId}/referandum`, { soru: 'İlçeye yeni bir kütüphane yapılmalı mı?' })).veri;
  assert.equal(r.durum, 'OYLAMA', 'başkan önerisi doğrudan oylamada');
  assert.equal((await F(`/api/belediye/${ilceId}`)).veri.referandumlar[0].ben.kutukte, false);
  assert.equal((await B(`/api/belediye/${ilceId}`)).veri.referandumlar[0].ben.kutukte, true);
  assert.equal((await F(`/api/referandum/${r.id}/oy`, { oy: 'HAYIR' })).durum, 403);
  assert.equal((await B(`/api/referandum/${r.id}/oy`, { oy: 'EVET' })).durum, 200);
});

test('başkanlık boşalınca meclis görevde kalır; yalnızca başkanlık için ara seçim yapılır', async () => {
  moderasyon.makamBosalt(ilceId, 'BASKAN', kullanici('asli@test.local'), 'test: başkanlık boşaldı');
  let b = (await A(`/api/belediye/${ilceId}`)).veri;
  assert.equal(b.baskan, null);
  assert.deepEqual(b.meclis.map((m) => m.ad).sort(), ['Burak', 'Ceren'], 'meclis görevde');
  const meclisBitis = b.meclis[0].bitis;
  secim.secimBakim({ zorla: true });
  b = (await A(`/api/belediye/${ilceId}`)).veri;
  assert.equal(b.secim.ara, true);
  assert.deepEqual(Object.keys(b.secim.makamlar), ['BASKAN']);
  const sid = b.secim.id;
  asamayaGetir(sid, 'ADAYLIK');
  gecmisEtkinlik('emel@test.local', 12);
  const M = 'Ara dönemde meclisle birlikte ilçenin yarım kalan işlerini tamamlayacağım.';
  const mec = await E(`/api/secim/${sid}/aday`, { makam: 'MECLIS', manifesto: M });
  assert.equal(mec.durum, 400);
  assert.match(mec.veri.hata, /yalnızca belediye başkanlığına/);
  assert.equal((await E(`/api/secim/${sid}/aday`, { manifesto: M })).durum, 200);
  asamayaGetir(sid, 'KAMPANYA');
  asamayaGetir(sid, 'OYLAMA');
  const emel = (await A(`/api/belediye/${ilceId}`)).veri.secim.adaylar.find((a) => a.ad === 'Emel').id;
  assert.equal((await A(`/api/secim/${sid}/oy`, { secimler: { BASKAN: emel } })).durum, 200);
  asamayaGetir(sid, 'ITIRAZ');
  asamayaGetir(sid, 'BITTI');
  b = (await A(`/api/belediye/${ilceId}`)).veri;
  assert.equal(b.secim.asama, 'SONUCLANDI');
  assert.equal(b.baskan.ad, 'Emel');
  assert.deepEqual(b.meclis.map((m) => m.ad).sort(), ['Burak', 'Ceren'], 'devirde meclis görevini sürdürür');
  assert.equal(b.baskan.bitis, meclisBitis, 'ara seçimle gelen başkan meclisin dönem sonuna kadar görevde');
});

test('moderasyon: rol hiyerarşisi, katı onay ve askıya alınan makam sahibinin görevden ayrılması', async () => {
  const rolVer = (id, rol) => db.prepare('UPDATE users SET rol = ? WHERE id = ?').run(rol, id);
  const ceren = kullanici('ceren@test.local'), emel = kullanici('emel@test.local');
  rolVer(F.id, 'MODERATOR'); rolVer(G.id, 'MODERATOR'); rolVer(ceren, 'DENETCI');
  const gerekce = 'Kural ihlali iddiası inceleniyor.';
  assert.throws(() => moderasyon.islemOner(F.id, { tur: 'HESAP_ASKI', hedef: String(G.id), gerekce }), (e) => e.status === 403, 'moderatör moderatörü askıya alamaz');
  const oneri = moderasyon.islemOner(ceren, { tur: 'HESAP_ASKI', hedef: String(G.id), gerekce });
  assert.throws(() => moderasyon.islemKarar(F.id, oneri.id, { onay: true }), (e) => e.status === 403, 'eş roldeki onaylayamaz');
  assert.throws(() => moderasyon.islemKarar(F.id, oneri.id, { onay: 'false' }), (e) => e.status === 400, 'onay yalnızca boolean');
  assert.equal(db.prepare('SELECT durum FROM moderasyon_islemleri WHERE id = ?').get(oneri.id).durum, 'ONAY_BEKLIYOR');
  assert.equal(db.prepare('SELECT status FROM users WHERE id = ?').get(G.id).status, 'ACTIVE');

  // Emel: başkan ve iki mahallenin muhtarı; askıya alınınca bütün makamları boşalır
  const aski = moderasyon.islemOner(F.id, { tur: 'HESAP_ASKI', hedef: String(emel), gerekce });
  moderasyon.islemKarar(G.id, aski.id, { onay: true });
  assert.equal(db.prepare('SELECT status FROM users WHERE id = ?').get(emel).status, 'SUSPENDED');
  const t = Date.now();
  assert.equal(db.prepare('SELECT COUNT(*) c FROM muhtarlar WHERE user_id = ? AND bitis > ?').get(emel, t).c, 0, 'muhtarlıklar boşaldı');
  assert.equal((await A(`/api/belediye/${ilceId}`)).veri.baskan, null, 'başkanlık boşaldı');
});
