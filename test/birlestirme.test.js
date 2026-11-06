// Parsel birleştirme (birlestirme.js): uygunluk, alan ve maliyetin aktarımı, hücre yönlendirmesi, harita parçaları,
// parsel sınırının hücre sayısıyla sayılması, parsel devlete dönerken birleşimin çözülmesi.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { ortamKur, istemciUret } = require('./yardimci');

const VERI = ortamKur('birlestirme');
const app = require('../server/index');
const db = require('../server/db');
const L = require('../server/lib/ledger');
const I = require('../server/harita/izgara');
const { sahteImar, KOD_AD } = require('../server/harita/imar');
const { BIRLESTIRME, YAPILAR } = require('../server/config/rules');

let sunucu, taban;
before(async () => {
  await new Promise((r) => { sunucu = app.listen(0, r); });
  taban = `http://127.0.0.1:${sunucu.address().port}`;
  await app.hazir;
});
after(() => { sunucu.close(); fs.rmSync(VERI, { recursive: true, force: true }); });

const istemci = istemciUret(() => taban);

// Yan yana altı tarım hücresi (aynı satır): P Q R bitişik, S ayrı (iki hücre ötede)
function sira() {
  const c = I.hucre(32.49, 37.87);
  for (let y = c.y; y < c.y + 200; y++) for (let x = c.x; x < c.x + 200; x++) {
    if ([0, 1, 2, 3, 4, 5].every((k) => KOD_AD[sahteImar(x + k, y)] === 'TARIM')) return [0, 1, 2, 3, 4, 5].map((k) => I.parselId(x + k, y));
  }
  throw new Error('altı bitişik tarım hücresi bulunamadı');
}

let A, B, uidA, P, Q, R, T, S, U, kartP0, kartQ0;
const kart = async (c, id) => (await c(`/api/parsel/${id}`)).veri;
test('hazırlık: dört tarla, biri yapılı; adaylar yalnızca kenardan bitişik kendi parselleri', async () => {
  [A, B] = [istemci(), istemci()];
  for (const [c, ad] of [[A, 'Nehir'], [B, 'Deniz']]) {
    assert.equal((await c('/api/kayit', { email: `${ad.toLowerCase()}@test.local`, sifre: 'parola123', dogumYili: 1990, kosullarOnay: true, kvkkOnay: true, ad })).durum, 201);
  }
  uidA = db.prepare(`SELECT id FROM users WHERE email = 'nehir@test.local'`).get().id;
  L.odul(uidA, 20000, 'test');
  [P, Q, R, T, S, U] = sira();
  for (const id of [P, Q, R, S]) assert.equal((await A(`/api/parsel/${id}/edin`, {})).durum, 200, id);
  assert.equal(new Set([P, Q, R, S].map((id) => db.prepare('SELECT region_id FROM parcels WHERE id = ?').get(id).region_id)).size, 1, 'aynı mahalle');
  assert.equal((await A(`/api/parsel/${Q}/insaat`, { tip: 'TEL_CIT' })).durum, 200);
  kartP0 = await kart(A, P); kartQ0 = await kart(A, Q);
  assert.equal(kartP0.parca, 1);
  assert.deepEqual(kartP0.birlestirme.adaylar.map((a) => [a.id, a.uygun]), [[Q, true]], 'yalnızca doğudaki Q (R ve S bitişik değil)');
  assert.equal(kartP0.birlestirme.harc, BIRLESTIRME.harc);
  assert.equal((await kart(B, P)).birlestirme, null, 'başkasına birleştirme bilgisi gitmez');
});

test('birleştir: alan toplanır, yapı ve maliyet asıl parsele geçer, parça hücresi asıl parsele yönlenir', async () => {
  const once = L.bakiye(uidA);
  const pf0 = (await A('/api/portfoy')).veri.parseller, alis = (id) => pf0.find((x) => x.id === id).alis;
  const r = await A(`/api/parsel/${P}/birlestir`, { uye: Q });
  assert.equal(r.durum, 200, JSON.stringify(r.veri));
  assert.deepEqual([r.veri.alan, r.veri.parca], [kartP0.alan + kartQ0.alan, 2]);
  assert.equal(L.bakiye(uidA), once - BIRLESTIRME.harc);
  const k = await kart(A, Q);   // Q'nun hücresi P'ye yönlenir
  assert.equal(k.id, P);
  assert.equal(k.alan, kartP0.alan + kartQ0.alan);
  assert.equal(k.parca, 2);
  assert.deepEqual(k.yapilar.map((y) => y.tip), ['TEL_CIT'], 'Q\'nun çiti P\'ye geçti');
  assert.equal(k.imarKullanimi.maxTaban, Math.floor(k.alan * k.imar.taks), 'yapılaşma hakkı toplam alandan');
  assert.equal(k.geometri.coordinates[0].length, 5, '2 × 1 dikdörtgen: dört köşe');
  assert.ok(k.komsular.some((n) => n.dx === 1 && n.dy === 0 && n.uye && n.id === P), 'Q hücresi komşularda "bu parsel"');
  const q = db.prepare('SELECT owner_user_id, status, birlesik_id FROM parcels WHERE id = ?').get(Q);
  assert.deepEqual(q, { owner_user_id: null, status: 'BIRLESIK', birlesik_id: P });
  // Portföy: Q ayrı satır değil; P'nin alışı = iki alış + Q'daki yatırım + harç
  const pf = (await A('/api/portfoy')).veri.parseller;
  assert.ok(!pf.some((x) => x.id === Q));
  const p = pf.find((x) => x.id === P);
  assert.equal(p.alis, alis(P) + alis(Q) + YAPILAR.TEL_CIT.maliyet + BIRLESTIRME.harc);
  assert.equal(p.yatirim, 0);
});

test('reddedilenler: bitişik olmayan, zaten parça, başkasının, ekili parsel', async () => {
  const hata = async (c, id, uye, metin) => {
    const r = await c(`/api/parsel/${id}/birlestir`, { uye });
    assert.equal(r.durum, 409, `${id} + ${uye}`);
    assert.match(r.veri.hata, metin);
  };
  await hata(A, P, S, /yan yana/);
  await hata(A, P, Q, /zaten bu parselin parçası/);
  assert.equal((await B(`/api/parsel/${U}/edin`, {})).durum, 200);
  await hata(A, S, U, /İki parsel de senin/);
  await hata(B, P, R, /İki parsel de senin/);
  // Ekili parsel birleştirilmez (ekin büyürken alan değişmesin)
  assert.equal((await A(`/api/parsel/${R}/ek`, { urun: 'BUGDAY' })).durum, 200);
  const k = await kart(A, P);
  assert.match(k.birlestirme.adaylar.find((a) => a.id === R).sebep, /ekin var/);
  await hata(A, P, R, /ekin var/);
});

test('üçüncü parça: parçanın hücresinden de birleştirilir; harita parçaları ve sınır sayımı', async () => {
  db.prepare(`UPDATE crops SET status = 'HARVESTED' WHERE parcel_id = ?`).run(R);   // hasat edilmiş say
  const r = await A(`/api/parsel/${Q}/birlestir`, { uye: R });   // Q hücresi P'ye yönlenir
  assert.equal(r.durum, 200, JSON.stringify(r.veri));
  assert.equal(r.veri.parca, 3);
  const k = await kart(A, P);
  assert.equal(k.geometri.coordinates[0].length, 5, '3 × 1 dikdörtgen: ara köşeler atılır');
  assert.deepEqual(k.birlestirme.uyeler.map((u) => u.id).sort(), [Q, R].sort());
  // Haritada asıl özellik bütün sınırla, parçalar `uye` işaretiyle aynı kimlikte
  const s0 = I.hucreSinirlari(...Object.values(I.idCoz(P))), s1 = I.hucreSinirlari(...Object.values(I.idCoz(R)));
  const h = (await A(`/api/harita/parseller?bbox=${[s0.w, s1.s, s1.e, s0.n].join(',')}`)).veri;
  const benimki = h.features.filter((f) => f.properties.id === P);
  assert.equal(benimki.length, 3);
  assert.equal(benimki.filter((f) => f.properties.uye).length, 2);
  assert.ok(benimki.every((f) => f.properties.s === 1));
  assert.ok(benimki.filter((f) => f.properties.uye).every((f) => f.properties.yp === ''), 'yapılar asıl hücrede çizilir');
  // Yalnızca parçanın hücresini kapsayan kutu da asıl parseli getirir
  const yalnizR = (await A(`/api/harita/parseller?bbox=${[s1.w + 1e-6, s1.s + 1e-6, s1.e - 1e-6, s1.n - 1e-6].join(',')}`)).veri;
  assert.ok(yalnizR.features.some((f) => f.properties.id === P));
  // Mahalle sınırı hücreyle sayılır: P (3 parça) + S = 4 → aynı mahallede yeni tahsis olmaz
  const e = await A(`/api/parsel/${T}/edin`, {});
  assert.equal(e.durum, 409);
  assert.match(e.veri.hata, /mahallede en fazla/);
});

test('birleşik parsel: arsa bedeli hücre hücre, alıcıya hücre sayısıyla sayılır, Hazine her parçanın tutma süresine bakar', async () => {
  const oyun = require('../server/oyun'), piyasa = require('../server/piyasa');
  const { IMAR } = require('../server/config/rules');
  // Yamaçtaki ucuz hücre düz hücreye katılınca asıl parselin konum değerini almaz
  db.prepare('UPDATE parcels SET konum_kati = 0.2 WHERE id = ?').run(R);
  const p = oyun.parselGetir(P), h = (id) => db.prepare('SELECT area_m2, konum_kati FROM parcels WHERE id = ?').get(id);
  const [q, r] = [h(Q), h(R)];
  const beklenen = Math.round(((p.area_m2 - q.area_m2 - r.area_m2) * p.konum_kati + q.area_m2 * q.konum_kati + r.area_m2 * 0.2) * IMAR.TARIM.m2Fiyat);
  assert.equal(oyun.birincilBedel(p), beklenen);
  assert.ok(beklenen < Math.round(p.area_m2 * IMAR.TARIM.m2Fiyat * p.konum_kati));

  // Hazine: asıl parsel eski, son katılan parça yeni → bekler; parça hediye arsaysa 30 gün kuralı sürer
  db.prepare(`UPDATE structures SET completes_at = ? WHERE parcel_id = ? AND status = 'BUILDING'`).run(Date.now() - 1, P);
  oyun.bekleyenleriIsle();   // çit tamamlansın
  db.prepare(`UPDATE parcel_ownership SET start_at = datetime('now', '-30 days') WHERE parcel_id IN (?, ?) AND user_id = ?`).run(P, Q, uidA);
  assert.match(piyasa.hazineTeklifi(uidA, oyun.parselGetir(P)).sebep, /her parçası/);
  db.prepare(`UPDATE parcel_ownership SET start_at = datetime('now', '-30 days') WHERE parcel_id = ? AND user_id = ?`).run(R, uidA);
  assert.equal(piyasa.hazineTeklifi(uidA, oyun.parselGetir(P)).uygun, true);
  db.prepare(`UPDATE parcel_ownership SET reason = 'BASLANGIC', start_at = datetime('now') WHERE parcel_id = ? AND user_id = ?`).run(R, uidA);
  assert.match(piyasa.hazineTeklifi(uidA, oyun.parselGetir(P)).sebep, /hediye/);

  // Pazar: 3 parçalı parsel alıcının mahalle sınırına 3 sayılır (B: U ve T, + 3 > 4)
  const uidB = db.prepare(`SELECT id FROM users WHERE email = 'deniz@test.local'`).get().id;
  L.odul(uidB, 50000, 'test');
  assert.equal((await B(`/api/parsel/${T}/edin`, {})).durum, 200);
  const ilan = await A(`/api/parsel/${P}/ilan`, { fiyat: 100000, gun: 1 });
  assert.equal(ilan.durum, 200, JSON.stringify(ilan.veri));
  const al = await B(`/api/ilan/${ilan.veri.ilanId}/hemen-al`, {});
  assert.equal(al.durum, 403);
  assert.match(al.veri.hata, /mahallede en fazla 4 parsel.*3 parçalı/);
  assert.equal((await A(`/api/ilan/${ilan.veri.ilanId}/iptal`, {})).durum, 200);
});

test('parsel devlete dönünce birleşim çözülür: parçalar kendi alanlarıyla sahipsiz', () => {
  const oyun = require('../server/oyun');
  db.transaction(() => oyun.parseliBosalt(P))();
  const satirlar = db.prepare(`SELECT id, owner_user_id, status, birlesik_id, uye_sayisi, area_m2 FROM parcels WHERE id IN (?, ?, ?) ORDER BY id`).all(P, Q, R);
  assert.ok(satirlar.every((x) => x.owner_user_id === null && x.status === 'ACTIVE' && x.birlesik_id === null && x.uye_sayisi === 0));
  assert.equal(satirlar.find((x) => x.id === P).area_m2, kartP0.alan);
  assert.equal(satirlar.find((x) => x.id === Q).area_m2, kartQ0.alan);
});
