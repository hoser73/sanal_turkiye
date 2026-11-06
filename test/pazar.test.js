// Oyuncular arası pazar (plan §8, §20.1: "İlan/teklif/devirde sahiplik ve defter tutarlılığı %100").
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { ortamKur, istemciUret, hucreBul } = require('./yardimci');

const VERI = ortamKur('pazar');
const app = require('../server/index');
const db = require('../server/db');

let sunucu, taban;
before(async () => {
  await new Promise((r) => { sunucu = app.listen(0, r); });
  taban = `http://127.0.0.1:${sunucu.address().port}`;
  await app.hazir;   // demo komşular ve ilanları
});
after(() => { sunucu.close(); fs.rmSync(VERI, { recursive: true, force: true }); });

const istemci = istemciUret(() => taban);
const bakiye = async (c) => (await c('/api/ben')).veri.bakiye;
const sahip = (id) => db.prepare('SELECT owner_user_id FROM parcels WHERE id = ?').get(id).owner_user_id;
const kullaniciId = (email) => db.prepare('SELECT id FROM users WHERE email = ?').get(email).id;
const bosTarla = () => hucreBul('TARIM');

let A, B, C, D, parsel, ilan;
test('hazırlık: satıcı parsel edinir ve geliştirir', async () => {
  [A, B, C, D] = [istemci(), istemci(), istemci(), istemci()];
  for (const [c, ad] of [[A, 'Ayse'], [B, 'Bora'], [C, 'Cem'], [D, 'Deniz']]) {
    assert.equal((await c('/api/kayit', { email: `${ad.toLowerCase()}@test.local`, sifre: 'parola123', dogumYili: 1990, kosullarOnay: true, kvkkOnay: true, ad })).durum, 201);
  }
  parsel = bosTarla();
  assert.equal((await A(`/api/parsel/${parsel}/edin`, {})).durum, 200);
  assert.equal((await A(`/api/parsel/${parsel}/insaat`, { tip: 'TEL_CIT' })).durum, 200);
  assert.equal((await A(`/api/parsel/${parsel}/ek`, { urun: 'BUGDAY' })).durum, 200);
});

test('ilan oluşturma kuralları', async () => {
  assert.equal((await B(`/api/parsel/${parsel}/ilan`, { fiyat: 300, gun: 3 })).durum, 403, 'sahibi olmayan ilan açamaz');
  assert.equal((await A(`/api/parsel/${parsel}/ilan`, { fiyat: 0, gun: 3 })).durum, 400);
  assert.equal((await A(`/api/parsel/${parsel}/ilan`, { fiyat: 300, gun: 2 })).durum, 400);
  assert.equal((await A(`/api/parsel/${parsel}/ilan`, { fiyat: 300, gun: 3, kosul: '__proto__' })).durum, 400);
  const r = await A(`/api/parsel/${parsel}/ilan`, { fiyat: 300, gun: 3 });
  assert.equal(r.durum, 200);
  ilan = r.veri.ilanId;
  assert.equal(r.veri.ucret, 15);   // %5 × 300
  assert.equal((await A(`/api/parsel/${parsel}/ilan`, { fiyat: 250, gun: 3 })).durum, 409, 'aynı parsel iki kez ilanda olamaz');
  const I = require('../server/harita/izgara');
  const [lon, lat] = I.hucreMerkezi(...Object.values(I.idCoz(parsel)));
  const harita = (await A(`/api/harita/parseller?bbox=${lon - 0.005},${lat - 0.005},${lon + 0.005},${lat + 0.005}`)).veri.features
    .find((f) => f.properties.id === parsel);
  assert.equal(harita.properties.l, 1);
});

test('teklif: fon kilidi, yükseltme, sınırlar', async () => {
  assert.equal((await A(`/api/ilan/${ilan}/teklif`, { tutar: 100 })).durum, 409, 'kendi ilanına teklif yok');
  assert.equal((await B(`/api/ilan/${ilan}/teklif`, { tutar: 300 })).durum, 409, 'istenen fiyat ve üstü → hemen al');
  assert.equal((await B(`/api/ilan/${ilan}/teklif`, { tutar: 100 })).durum, 200);
  assert.equal(await bakiye(B), 400);
  assert.equal((await B(`/api/ilan/${ilan}/teklif`, { tutar: 90 })).durum, 409, 'düşürme yok');
  assert.equal((await B(`/api/ilan/${ilan}/teklif`, { tutar: 150 })).durum, 200);
  assert.equal(await bakiye(B), 350, 'eski kilit iade, yeni tutar kilitli');
  assert.equal((await B('/api/ben')).veri.pazar.kilitli, 150);
  assert.equal((await C(`/api/ilan/${ilan}/teklif`, { tutar: 120 })).durum, 200);
  assert.equal((await B(`/api/ilan/${ilan}/teklif`, { tutar: 10000 })).durum, 409);
  assert.equal((await D(`/api/ilan/${ilan}/teklif`, { tutar: 299, ekstra: 1 })).durum, 200);
  assert.equal((await D(`/api/ilan/${ilan}/teklif-geri`, {})).durum, 200);
  assert.equal(await bakiye(D), 500, 'geri çekilen teklif iade edildi');
});

test('parsel kartı: satıcı teklif sahiplerini görür, diğerleri anonim', async () => {
  const s = (await A(`/api/parsel/${parsel}`)).veri.pazar;
  assert.equal(s.ilan.teklifler.length, 2);
  assert.deepEqual(s.ilan.teklifler.map((t) => t.kim).sort(), ['Bora', 'Cem']);
  assert.equal(s.ilan.enYuksekTeklif, 150);
  assert.equal(s.piyasa.guvenilirlikDusuk, true);
  const c = (await C(`/api/parsel/${parsel}`)).veri.pazar;
  assert.equal(c.ilan.teklifler, null);
  const adlar = c.ilan.gecmis.filter((g) => g.tur === 'TEKLIF').map((g) => g.kim);
  assert.ok(!adlar.includes('Bora'), 'başka alıcının adı sızmaz');
  assert.ok(adlar.includes('Cem'), 'kendi teklifini adıyla görür');
  assert.equal(c.ilan.benimTeklifim.tutar, 120);
  const bildirim = (await A('/api/bildirimler')).veri;
  assert.ok(bildirim.some((b) => /Bora ₺1\.500\.000/.test(b.text)), "bildirimde tutar TL olarak (150 × 10.000)");
});

test('kabul: atomik devir, masraf, diğer tekliflerin iadesi, yapı ve ekin devri', async () => {
  const teklifId = (await A(`/api/parsel/${parsel}`)).veri.pazar.ilan.teklifler.find((t) => t.kim === 'Bora').id;
  const aOnce = await bakiye(A);
  assert.equal((await C(`/api/teklif/${teklifId}/kabul`, {})).durum, 403, 'yalnızca satıcı kabul eder');
  const r = await A(`/api/teklif/${teklifId}/kabul`, {});
  assert.equal(r.durum, 200);
  assert.equal(r.veri.ucret, 7);
  assert.equal(sahip(parsel), kullaniciId('bora@test.local'));
  assert.equal(await bakiye(A), aOnce + 143);
  assert.equal(await bakiye(B), 350, 'kilitli tutar satıcıya geçti');
  assert.equal(await bakiye(C), 500, 'kaybeden teklif iade edildi');
  const b = kullaniciId('bora@test.local');
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM structures WHERE parcel_id = ? AND owner_user_id <> ?`).get(parsel, b).c, 0);
  assert.equal(db.prepare(`SELECT user_id FROM crops WHERE parcel_id = ? AND status = 'GROWING'`).get(parsel).user_id, b);
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM parcel_ownership WHERE parcel_id = ? AND end_at IS NULL`).get(parsel).c, 1);
  assert.equal((await A(`/api/teklif/${teklifId}/kabul`, {})).durum, 409, 'ikinci kabul yok');
  assert.equal((await A(`/api/parsel/${parsel}/ek`, { urun: 'ELMA' })).durum, 403, 'eski sahip artık işlem yapamaz');
});

test('hemen al: 20 eşzamanlı alıcıdan yalnızca biri kazanır', async () => {
  const r = await B(`/api/parsel/${parsel}/ilan`, { fiyat: 200, gun: 1 });
  assert.equal(r.durum, 200);
  const id = r.veri.ilanId;
  assert.equal((await C(`/api/ilan/${id}/hemen-al`, { fiyat: 150 })).durum, 409, 'görülen fiyat değiştiyse işlem yapılmaz');
  const sonuc = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? C : D)(`/api/ilan/${id}/hemen-al`, { fiyat: 200 })));
  assert.equal(sonuc.filter((x) => x.durum === 200).length, 1);
  const kazanan = sahip(parsel);
  assert.ok([kullaniciId('cem@test.local'), kullaniciId('deniz@test.local')].includes(kazanan));
  assert.equal((await C('/api/ben')).veri.bakiye + (await D('/api/ben')).veri.bakiye, 800, 'yalnızca bir kez ödeme alındı');
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM trades WHERE listing_id = ?`).get(id).c, 1);
});

test('A→B→A geri dönüş işlemi işaretlenir ve referans fiyata girmez', async () => {
  // A ikinci bir parsel alır, B'ye satar, B geri A'ya satar
  const p2 = bosTarla();
  assert.equal((await A(`/api/parsel/${p2}/edin`, {})).durum, 200);
  const i1 = (await A(`/api/parsel/${p2}/ilan`, { fiyat: 100, gun: 1 })).veri.ilanId;
  assert.equal((await B(`/api/ilan/${i1}/hemen-al`, {})).durum, 200);
  const i2 = (await B(`/api/parsel/${p2}/ilan`, { fiyat: 110, gun: 1 })).veri.ilanId;
  assert.equal((await A(`/api/ilan/${i2}/hemen-al`, {})).durum, 200);
  const son = db.prepare(`SELECT flags FROM trades WHERE listing_id = ?`).get(i2);
  assert.match(son.flags, /GERI_DONUS/);
  const piyasa = (await A(`/api/parsel/${p2}`)).veri.pazar.piyasa;
  assert.equal(piyasa.sonIslem.fiyat, 100, 'işaretli işlem son gerçekleşen fiyat sayılmaz');
  const liste = (await A('/api/islemler')).veri;
  assert.equal(liste.find((t) => t.price === 110 && t.parcel_id === p2).incelemede, true);
});

test('iptal ve süre dolumu kilitli teklifleri iade eder', async () => {
  const p3 = bosTarla();
  assert.equal((await D(`/api/parsel/${p3}/edin`, {})).durum, 200);
  const i1 = (await D(`/api/parsel/${p3}/ilan`, { fiyat: 400, gun: 1 })).veri.ilanId;
  const cOnce = await bakiye(C);
  assert.equal((await C(`/api/ilan/${i1}/teklif`, { tutar: 50 })).durum, 200);
  assert.equal((await D(`/api/ilan/${i1}/iptal`, {})).durum, 200);
  assert.equal(await bakiye(C), cOnce);

  const i2 = (await D(`/api/parsel/${p3}/ilan`, { fiyat: 400, gun: 1 })).veri.ilanId;
  assert.equal((await C(`/api/ilan/${i2}/teklif`, { tutar: 60 })).durum, 200);
  db.prepare(`UPDATE listings SET expires_at = ? WHERE id = ?`).run(Date.now() - 1, i2);
  assert.equal(await bakiye(C), cOnce, 'süre dolunca bir sonraki istekte iade');
  assert.equal(db.prepare(`SELECT status FROM listings WHERE id = ?`).get(i2).status, 'EXPIRED');
  assert.equal((await C(`/api/ilan/${i2}/teklif`, { tutar: 70 })).durum, 409);
});

test('alıcı koşulu: yeni hesap 7 günlük şartlı ilana teklif veremez', async () => {
  const p4 = bosTarla();
  assert.equal((await A(`/api/parsel/${p4}/edin`, {})).durum, 200);
  const i = (await A(`/api/parsel/${p4}/ilan`, { fiyat: 200, gun: 1, kosul: 'HESAP_7_GUN' })).veri.ilanId;
  const r = await C(`/api/ilan/${i}/teklif`, { tutar: 100 });
  assert.equal(r.durum, 403);
  assert.match(r.veri.hata, /7 günlük/);
  db.prepare(`UPDATE users SET created_at = datetime('now', '-10 days') WHERE email = 'cem@test.local'`).run();
  assert.equal((await C(`/api/ilan/${i}/teklif`, { tutar: 100 })).durum, 200);
});

test('demo komşu (NPC): düşük teklifi reddeder, %90 ve üstünü kabul eder', async () => {
  const npcIlan = db.prepare(`SELECT l.* FROM listings l JOIN users u ON u.id = l.seller_id WHERE u.is_npc = 1 AND l.status = 'ACTIVE' ORDER BY l.asking_price LIMIT 1`).get();
  const once = await bakiye(D);
  const dusuk = await D(`/api/ilan/${npcIlan.id}/teklif`, { tutar: Math.floor(npcIlan.asking_price * 0.5) });
  assert.equal(dusuk.durum, 200);
  assert.equal(dusuk.veri.npcRed, true);
  assert.equal(await bakiye(D), once);
  const yuksek = await D(`/api/ilan/${npcIlan.id}/teklif`, { tutar: Math.ceil(npcIlan.asking_price * 0.9) });
  assert.equal(yuksek.durum, 200);
  assert.equal(yuksek.veri.npcKabul, true);
  assert.equal(sahip(npcIlan.parcel_id), kullaniciId('deniz@test.local'));
});

async function yeniOyuncular(adlar) {
  const liste = [];
  for (const ad of adlar) {
    const c = istemci();
    assert.equal((await c('/api/kayit', { email: `${ad.toLowerCase()}@test.local`, sifre: 'parola123', dogumYili: 1990, kosullarOnay: true, kvkkOnay: true, ad })).durum, 201);
    c.id = kullaniciId(`${ad.toLowerCase()}@test.local`);
    liste.push(c);
  }
  return liste;
}

test('A→B→C→A döngüsü işaretlenir; süren üretim yapıyla birlikte alıcıya geçer', async () => {
  const [E, F, G] = await yeniOyuncular(['Ece', 'Fuat', 'Gul']);
  const p = bosTarla();
  assert.equal((await E(`/api/parsel/${p}/edin`, {})).durum, 200);
  assert.equal((await E(`/api/parsel/${p}/insaat`, { tip: 'TEL_CIT' })).durum, 200);
  const yapi = db.prepare('SELECT id FROM structures WHERE parcel_id = ?').get(p).id;
  db.prepare(`INSERT INTO uretimler (user_id, parcel_id, structure_id, recete, parti, cikti, baslangic, bitis) VALUES (?, ?, ?, 'UN', 1, 1, ?, ?)`)
    .run(E.id, p, yapi, Date.now(), Date.now() + 1e7);
  const sat = async (satici, alici) => {
    const i = (await satici(`/api/parsel/${p}/ilan`, { fiyat: 100, gun: 1 })).veri.ilanId;
    const r = await alici(`/api/ilan/${i}/hemen-al`, {});
    assert.equal(r.durum, 200, JSON.stringify(r.veri));
    return r.veri.isaretler;
  };
  assert.ok(!(await sat(E, F)).includes('GERI_DONUS'));
  assert.equal(db.prepare(`SELECT user_id FROM uretimler WHERE parcel_id = ? AND durum = 'URETIMDE'`).get(p).user_id, F.id);
  assert.ok(!(await sat(F, G)).includes('GERI_DONUS'));
  assert.ok((await sat(G, E)).includes('GERI_DONUS'), 'parsel 30 gün içinde eski sahibine döndü');
});

test('Hazine ilanı: teklif kabul edilmez, tutar kilitlenmez; satıcı Hazine olarak işaretli (demo komşu değil)', async () => {
  const [H, I] = await yeniOyuncular(['Hilal', 'Irmak']);
  const p = bosTarla();
  assert.equal((await H(`/api/parsel/${p}/edin`, {})).durum, 200);
  db.prepare(`UPDATE parcel_ownership SET start_at = datetime(start_at, '-4 days') WHERE parcel_id = ? AND end_at IS NULL`).run(p);
  assert.equal((await H(`/api/parsel/${p}/hazineye-sat`, {})).durum, 200);
  const kart = (await I(`/api/parsel/${p}`)).veri.pazar.ilan;
  assert.equal(kart.satici.hazine, true);
  assert.equal(kart.satici.npc, false);
  const once = await bakiye(I);
  const r = await I(`/api/ilan/${kart.id}/teklif`, { tutar: Math.max(1, Math.ceil(kart.fiyat * 0.95) - 1) });
  assert.equal(r.durum, 409);
  assert.match(r.veri.hata, /Hazine pazarlık yapmaz/);
  assert.equal(await bakiye(I), once, 'tutar emanete alınmadı');
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM bids WHERE listing_id = ?`).get(kart.id).c, 0);
  assert.equal((await I('/api/ilanlar?sirala=yeni')).veri.find((x) => x.id === kart.id).satici.hazine, true);
});

test('defter: işlem grupları dengeli, emanetler teklif durumlarıyla tutarlı', () => {
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM (SELECT tx_group FROM wallet_ledger GROUP BY tx_group HAVING ABS(SUM(debit) - SUM(credit)) > 0.001)`).get().c, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM (SELECT user_id FROM wallet_ledger WHERE user_id IS NOT NULL GROUP BY user_id HAVING SUM(credit) - SUM(debit) < 0)`).get().c, 0);
  const tutarsiz = db.prepare(`
    SELECT b.id, b.status, b.amount, COALESCE((SELECT SUM(credit) - SUM(debit) FROM wallet_ledger w WHERE w.account = 'ESCROW:BID:' || b.id), 0) AS emanet
    FROM bids b`).all().filter((b) => (b.status === 'ACTIVE' ? b.emanet !== b.amount : b.emanet !== 0));
  assert.deepEqual(tutarsiz, []);
  // Her parselin tek açık sahiplik kaydı var ve parcels.owner_user_id ile aynı
  const uyumsuz = db.prepare(`SELECT p.id FROM parcels p JOIN parcel_ownership o ON o.parcel_id = p.id AND o.end_at IS NULL
                              WHERE o.user_id <> p.owner_user_id`).all();
  assert.deepEqual(uyumsuz, []);
});
