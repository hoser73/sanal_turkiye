// Çarşı: her türden tek işletme (sponsor markası yönetici panelinden, sözleşme bitince varsayılan), şubeler, dükkân ürünleri ve
// oyundaki etkileri (gübre, ilaç, aşı, kalıp seti, bakım kiti, örtü, balık takımı), banka (vadeli mevduat, kredi, gecikme, tahsilat).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { ortamKur, hucreBul } = require('./yardimci');

const VERI = ortamKur('carsi');
const app = require('../server/index');
const db = require('../server/db');
const L = require('../server/lib/ledger');
const dunya = require('../server/dunya');
const carsi = require('../server/carsi');
const balik = require('../server/balik');
const totp = require('../server/lib/totp');
const { CARSI, YAPILAR } = require('../server/config/rules');

let sunucu, taban;
before(async () => {
  await new Promise((r) => { sunucu = app.listen(0, r); });
  taban = `http://127.0.0.1:${sunucu.address().port}`;
  await app.hazir;
  balik.ayar.suBul = async () => ({ tip: 'deniz', plaka: '34' });
});
after(() => { sunucu.close(); fs.rmSync(VERI, { recursive: true, force: true }); });

function istemci() {
  let cerez = '';
  const c = async (yol, govde, method) => {
    const r = await fetch(taban + yol, { method: method || (govde ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', cookie: cerez }, body: govde ? JSON.stringify(govde) : undefined });
    const sc = r.headers.get('set-cookie');
    if (sc) cerez = sc.split(';')[0];
    return { durum: r.status, veri: await r.json().catch(() => null) };
  };
  return c;
}
let sayac = 0;
async function oyuncu(ad = `oyuncu${++sayac}`, ek = {}) {
  const c = istemci();
  assert.equal((await c('/api/kayit', { email: `${ad}@test.local`, sifre: 'parola123', dogumYili: 1990, kosullarOnay: true, kvkkOnay: true, ad, ...ek })).durum, 201);
  c.id = (await c('/api/ben')).veri.kullanici.id;
  return c;
}
async function yonetici() {
  const c = await oyuncu('patron');
  db.prepare(`UPDATE users SET rol = 'ADMIN' WHERE id = ?`).run(c.id);
  const kur = (await c('/api/2fa/kur', {})).veri;
  await c('/api/2fa/etkinlestir', { kod: totp.kodUret(kur.sir) });
  return c;
}
const ekin = (id) => db.prepare(`SELECT * FROM crops WHERE parcel_id = ? AND status = 'GROWING'`).get(id);
const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('işletmeler: her türden tek işletme, varsayılan adlar; vitrin; şubeler her il merkezinde', async () => {
  const z = istemci();
  const c = (await z('/api/carsi')).veri;
  assert.deepEqual(c.isletmeler.map((m) => m.kategori), ['BANKA', 'NALBUR', 'MARKET', 'ZIRAI']);
  assert.ok(c.isletmeler.every((m) => !m.sponsor && m.ad));
  const v = (await z('/api/carsi/NALBUR')).veri;
  assert.ok(v.urunler.some((u) => u.kod === 'KALIP_SETI'));
  assert.ok(v.urunler.every((u) => CARSI.urunler[u.kod].dukkan === 'NALBUR'));
  assert.equal((await z('/api/carsi/__proto__')).durum, 404);
  const s = (await z('/api/carsi/subeler')).veri;
  assert.equal(s.length, 81 * 4);
  assert.ok(s.every((x) => x.lon > 25 && x.lat > 35));
});

test('sponsor markası: yalnızca yönetici; doğrulama; sözleşme bitince varsayılan; şube yükleme; sıfırlama', async () => {
  const o = await oyuncu(), y = await yonetici();
  const marka = { ad: 'Örnek Bank', ikon: '🏦', renk: '#123456', renk2: '#eef4fa', slogan: 'Deneme sloganı', web: 'https://ornek.example/', sponsor: true, sozlesmeBas: '2026-01-01', sozlesmeBit: '2030-01-01', logo: LOGO };
  assert.equal((await o('/api/yonetim/isletme/BANKA', marka, 'PUT')).durum, 403);
  assert.equal((await istemci()('/api/yonetim/isletme/BANKA', marka, 'PUT')).durum, 401);
  for (const [k, v] of [['logo', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='], ['web', 'http://ornek.example'], ['renk', 'mavi'], ['ad', 'x'], ['ad', '<b>Bank</b>'], ['sozlesmeBit', '2025-01-01']]) {
    assert.equal((await y('/api/yonetim/isletme/BANKA', { ...marka, [k]: v }, 'PUT')).durum, 400, `${k} reddedilmeli`);
  }
  assert.equal((await y('/api/yonetim/isletme/BANKA', { ...marka, logo: `data:image/png;base64,${'A'.repeat(220_000)}` }, 'PUT')).durum, 413);
  assert.equal((await y('/api/yonetim/isletme/YOK', marka, 'PUT')).durum, 404);
  const r = await y('/api/yonetim/isletme/BANKA', marka, 'PUT');
  assert.equal(r.durum, 200, JSON.stringify(r.veri));
  const b = (await o('/api/carsi')).veri.isletmeler.find((m) => m.kategori === 'BANKA');
  assert.equal(b.ad, 'Örnek Bank'); assert.equal(b.sponsor, true); assert.equal(b.logo, LOGO); assert.equal(b.web, 'https://ornek.example/');
  assert.ok(db.prepare(`SELECT 1 FROM audit_events WHERE action = 'BUSINESS_BRAND_UPDATED'`).get());
  // Sözleşme biterse varsayılana döner
  db.prepare(`UPDATE isletmeler SET sozlesme_bit = ? WHERE kategori = 'BANKA'`).run(Date.now() - 1000);
  assert.equal(carsi.marka('BANKA').ad, CARSI.kategoriler.BANKA.ad);
  assert.equal(carsi.marka('BANKA').sponsor, false);
  // Gerçek şubeler
  assert.equal((await y('/api/yonetim/isletme/MARKET/subeler', { subeler: [{ ad: 'Kadıköy', lon: 29.03, lat: 40.99 }, { ad: 'Meram', lon: 32.43, lat: 37.84 }] }, 'PUT')).durum, 200);
  assert.equal((await y('/api/yonetim/isletme/MARKET/subeler', { subeler: [{ ad: 'Paris', lon: 2.35, lat: 48.85 }] }, 'PUT')).durum, 400, 'Türkiye dışı');
  assert.equal(carsi.subeler().filter((s) => s.kategori === 'MARKET').length, 2);
  const liste = (await y('/api/yonetim/isletmeler')).veri;
  assert.equal(liste.find((x) => x.kategori === 'MARKET').gercekSube, 2);
  assert.equal((await y('/api/yonetim/isletme/BANKA', { sifirla: true }, 'PUT')).durum, 200);
  assert.equal(carsi.marka('BANKA').ad, CARSI.kategoriler.BANKA.ad);
});

test('dükkân: satın alma akçe düşer, paket sarf verir, kalıcı ürün bir kez; NPC tüccar dükkân ürünü almaz', async () => {
  const c = await oyuncu();
  const once = L.bakiye(c.id);
  const r = await c('/api/carsi/satin-al', { urun: 'GUBRE', adet: 3 });
  assert.equal(r.durum, 200);
  assert.equal(L.yuvarla(once - L.bakiye(c.id)), CARSI.urunler.GUBRE.fiyat * 3);
  assert.equal(L.envanterMiktar(c.id, 'GUBRE'), 3);
  await c('/api/carsi/satin-al', { urun: 'KARIDES_PAKETI' });
  assert.equal(L.envanterMiktar(c.id, 'YEM_KARIDES'), 10);
  assert.equal((await c('/api/carsi/satin-al', { urun: 'ORGU_MISINA' })).durum, 200);
  assert.equal((await c('/api/carsi/satin-al', { urun: 'ORGU_MISINA' })).durum, 409, 'kalıcı ürün bir kez');
  for (const [u, a] of [['YOK', 1], ['GUBRE', 0], ['GUBRE', 21], ['GUBRE', 1.5]]) assert.equal((await c('/api/carsi/satin-al', { urun: u, adet: a })).durum, 400);
  assert.equal((await c('/api/pazar/sat', { urun: 'GUBRE', miktar: 1 })).durum, 422);
  assert.equal((await istemci()('/api/carsi/satin-al', { urun: 'GUBRE' })).durum, 401);
});

test('zirai bayi: gübre hasadı %20 artırır; ilaç dondan korur; aşı barınakta fazladan ürün verir', async () => {
  const c = await oyuncu();
  const h1 = hucreBul('TARIM'), h2 = hucreBul('TARIM');
  for (const h of [h1, h2]) { await c(`/api/parsel/${h}/edin`, {}); await c(`/api/parsel/${h}/ek`, { urun: 'DOMATES' }); }
  db.prepare(`UPDATE parcels SET area_m2 = 600 WHERE id IN (?, ?)`).run(h1, h2);
  await c('/api/carsi/satin-al', { urun: 'GUBRE' }); await c('/api/carsi/satin-al', { urun: 'ILAC' });
  assert.equal((await c('/api/carsi/kullan', { urun: 'GUBRE', parselId: h1 })).durum, 200);
  assert.equal((await c('/api/carsi/kullan', { urun: 'GUBRE', parselId: h1 })).durum, 409, 'gübre yok / zaten verildi');
  assert.equal((await c('/api/carsi/kullan', { urun: 'ILAC', parselId: h1 })).durum, 200);
  assert.equal(ekin(h1).gubre, 1); assert.equal(ekin(h1).ilac, 1);
  assert.equal((await c(`/api/parsel/${h1}`)).veri.ekin.gubre, true);
  const plaka = db.prepare(`SELECT r.plaka FROM parcels p JOIN regions r ON r.id = p.il_id WHERE p.id = ?`).get(h1).plaka;
  dunya.uygula({ plaka, sicaklik: -3, yagis: 0, kod: 3, ruzgar: 5, gunduz: 0 });
  assert.equal(ekin(h1).don, 0, 'ilaç dondan korur');
  assert.equal(ekin(h2).don, 1);
  db.prepare(`UPDATE crops SET don = 0, ready_at = ?, waterings = 3 WHERE parcel_id IN (?, ?) AND status = 'GROWING'`).run(Date.now() - 1000, h1, h2);
  const m1 = (await c(`/api/parsel/${h1}/hasat`, {})).veri.miktar, m2 = (await c(`/api/parsel/${h2}/hasat`, {})).veri.miktar;
  assert.equal(m1, Math.round(m2 * (1 + CARSI.etki.gubreBonus)));
  // Aşı
  const h3 = hucreBul('TARIM');
  await c(`/api/parsel/${h3}/edin`, {});
  const t = Date.now();
  const yid = db.prepare(`INSERT INTO structures (parcel_id, owner_user_id, type, status, started_at, completes_at, completed_at) VALUES (?, ?, 'KUMES', 'ACTIVE', ?, ?, ?)`).run(h3, c.id, t, t, t).lastInsertRowid;
  await c('/api/carsi/satin-al', { urun: 'ASI' });
  assert.equal((await c('/api/carsi/kullan', { urun: 'ASI', yapiId: yid })).durum, 200);
  L.envanterDegis(c.id, 'YEM', 20, 'test');
  assert.equal((await c(`/api/yapi/${yid}/besle`, {})).durum, 200);
  db.prepare(`UPDATE hayvan_bakim SET hazir_at = ? WHERE structure_id = ?`).run(Date.now() - 1, yid);
  const top = (await c(`/api/yapi/${yid}/topla`, {})).veri;
  assert.equal(top.asili, true);
  assert.equal(top.miktar, require('../server/config/rules').HAYVANLAR.KUMES.miktar + CARSI.etki.asiEk);
});

test('nalbur: kalıp seti inşaatı kısaltır, bakım kiti bakımı ücretsiz yapar, örtü stoktan serilir', async () => {
  const c = await oyuncu();
  const h = hucreBul('TARIM');
  await c(`/api/parsel/${h}/edin`, {});
  await c('/api/carsi/satin-al', { urun: 'KALIP_SETI' });
  const ins = (await c(`/api/parsel/${h}/insaat`, { tip: 'TEL_CIT' })).veri;
  assert.equal(ins.kalip, true, JSON.stringify(ins));
  const s = db.prepare(`SELECT * FROM structures WHERE id = ?`).get(ins.yapiId);
  assert.ok(Math.abs((s.completes_at - s.started_at) - YAPILAR.TEL_CIT.sureMs * (1 - CARSI.etki.kalipKisalma)) < 5);
  assert.equal(L.envanterMiktar(c.id, 'KALIP_SETI'), 0);
  db.prepare(`UPDATE structures SET status = 'ACTIVE', completed_at = ?, bakim_at = ? WHERE id = ?`).run(Date.now() - 864e5 * 5, Date.now() - 864e5 * 5, ins.yapiId);
  await c('/api/carsi/satin-al', { urun: 'BAKIM_KITI' });
  const once = L.bakiye(c.id);
  const b = (await c(`/api/parsel/${h}/bakim`, {})).veri;
  assert.equal(b.kit, true); assert.equal(b.tutar, 0); assert.equal(L.bakiye(c.id), once);
  await c(`/api/parsel/${h}/ek`, { urun: 'BUGDAY' });
  await c('/api/carsi/satin-al', { urun: 'TARLA_ORTUSU' });
  const o = (await c(`/api/parsel/${h}/ortu`, {})).veri;
  assert.equal(o.stoktan, true); assert.equal(o.maliyet, 0);
});

test('balık takımı: karides paketi ve sahte yem stoktan; misina koparsa sahte yem gider; örgü misina ve karbon kamış', async () => {
  const c = await oyuncu();
  await c('/api/carsi/satin-al', { urun: 'KARIDES_PAKETI' });
  const once = L.bakiye(c.id);
  const a = (await c('/api/balik/at', { lon: 29, lat: 41, yem: 'KARIDES' })).veri;
  assert.equal(a.yemStok, true); assert.equal(L.bakiye(c.id), once); assert.equal(L.envanterMiktar(c.id, 'YEM_KARIDES'), 9);
  await c('/api/carsi/satin-al', { urun: 'SAHTE_YEM_TAKIMI' });
  await c('/api/carsi/satin-al', { urun: 'ORGU_MISINA' }); await c('/api/carsi/satin-al', { urun: 'KARBON_KAMIS' });
  const once2 = L.bakiye(c.id);
  const s = (await c('/api/balik/at', { lon: 29, lat: 41, yem: 'SAHTE', misina: 'ORTA' })).veri;
  assert.equal(s.yemStok, true); assert.equal(L.bakiye(c.id), once2, 'sahte yem takımıyla atış ücretsiz');
  db.prepare(`UPDATE balik_atislari SET isirma = ? WHERE id = ?`).run(Date.now(), s.id);
  const cek = (await c(`/api/balik/${s.id}/cek`, {})).veri;
  assert.equal(cek.takildi, true);
  assert.ok(cek.dayanim > 1, 'örgü misina dayanımı artırır');
  assert.equal(cek.sarmaHiz, CARSI.etki.kamisSarma);
  await c(`/api/balik/${s.id}/cikar`, { basari: false, neden: 'koptu' });
  assert.equal(L.envanterMiktar(c.id, 'SAHTE_YEM_TAKIMI'), 0, 'koptu: sahte yem kayboldu');
});

test('banka: vadeli hesap (bozdurunca faiz yok, vadesinde getiri), üst sınır', async () => {
  const c = await oyuncu();
  const once = L.bakiye(c.id);
  const v1 = await c('/api/banka/vadeli', { tutar: 100 });
  assert.equal(v1.durum, 200);
  assert.equal(L.bakiye(c.id), L.yuvarla(once - 100));
  assert.equal((await c('/api/banka/vadeli', { tutar: 10 })).durum, 400, 'en az');
  assert.equal((await c('/api/banka/vadeli', { tutar: CARSI.banka.vadeliMaks })).durum, 409, 'üst sınır');
  const bozdur = (await c(`/api/banka/vadeli/${v1.veri.id}/kapat`, {})).veri;
  assert.equal(bozdur.bozuldu, true); assert.equal(bozdur.faiz, 0); assert.equal(L.bakiye(c.id), once);
  const v2 = (await c('/api/banka/vadeli', { tutar: 200 })).veri;
  db.prepare(`UPDATE banka_vadeli SET vade = ? WHERE id = ?`).run(Date.now() - 1, v2.id);
  const kapat = (await c(`/api/banka/vadeli/${v2.id}/kapat`, {})).veri;
  assert.equal(kapat.faiz, L.yuvarla(200 * CARSI.banka.vadeliFaiz));
  assert.equal(L.bakiye(c.id), L.yuvarla(once + kapat.faiz));
  assert.equal((await c(`/api/banka/vadeli/${v2.id}/kapat`, {})).durum, 409);
  const ozet = (await c('/api/banka')).veri;
  assert.ok(ozet.uyari.includes('nakde çevrilemez'));
});

test('banka: kredi koşulları, limit, kısmi ödeme, gecikme bedeli, vadesinde tahsilat, kredi notu', async () => {
  const c = await oyuncu();
  assert.equal((await c('/api/banka/kredi', { tutar: 50 })).durum, 409, 'yeni hesap kredi alamaz');
  db.prepare(`UPDATE users SET created_at = datetime('now', '-5 days') WHERE id = ?`).run(c.id);
  const genc = await oyuncu(undefined, { dogumYili: new Date().getFullYear() - 15 });
  db.prepare(`UPDATE users SET created_at = datetime('now', '-5 days') WHERE id = ?`).run(genc.id);
  assert.match((await genc('/api/banka/kredi', { tutar: 50 })).veri.hata || '', /18 yaşından/);
  const limit = (await c('/api/banka')).veri.limit;
  assert.ok(limit >= CARSI.banka.krediTaban);
  assert.equal((await c('/api/banka/kredi', { tutar: limit + 1 })).durum, 400);
  const once = L.bakiye(c.id);
  const k = (await c('/api/banka/kredi', { tutar: 100 })).veri;
  assert.equal(L.bakiye(c.id), L.yuvarla(once + 100));
  assert.equal(k.geriOdeme, L.yuvarla(100 * (1 + CARSI.banka.krediFaiz)));
  assert.equal((await c('/api/banka/kredi', { tutar: 20 })).durum, 409, 'açık kredi varken yenisi yok');
  const o1 = (await c('/api/banka/kredi/ode', { tutar: 50 })).veri;
  assert.equal(o1.kapandi, false); assert.equal(o1.kalan, L.yuvarla(k.geriOdeme - 50));
  // Vade geçti: gecikme bedeli işler, bakımda bakiyeden tahsil edilir
  db.prepare(`UPDATE banka_kredi SET vade = ? WHERE id = ?`).run(Date.now() - 2.5 * 864e5, k.id);
  const b = (await c('/api/banka')).veri.kredi;
  assert.equal(b.gecGun, 3);
  assert.equal(b.gecikme, L.yuvarla(100 * 3 * CARSI.banka.gecikmeGunluk));
  carsi.bankaBakim(Date.now() + 120_000);
  assert.equal((await c('/api/banka')).veri.kredi, null, 'bakiyeden tahsil edildi');
  assert.ok((await c('/api/bildirimler')).veri.some((x) => /tahsil edildi/.test(x.text)));
  assert.ok(carsi.krediNotu(c.id) < 600, 'geç kapanan kredi notu düşürür');
  assert.equal((await c('/api/banka/kredi/ode', {})).durum, 404);
});
