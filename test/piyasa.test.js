// Oyun içi piyasa (piyasa.js): mahalle çarpanı, tahmini değer, fiyat geçmişi, endeks kareleri, portföy kâr/zarar.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { ortamKur, istemciUret, hucreBul } = require('./yardimci');

const VERI = ortamKur('piyasa');
const app = require('../server/index');
const db = require('../server/db');
const piyasa = require('../server/piyasa');
const { YAPILAR, PIYASA } = require('../server/config/rules');

let sunucu, taban;
before(async () => {
  await new Promise((r) => { sunucu = app.listen(0, r); });
  taban = `http://127.0.0.1:${sunucu.address().port}`;
  await app.hazir;
});
after(() => { sunucu.close(); fs.rmSync(VERI, { recursive: true, force: true }); });

const istemci = istemciUret(() => taban);

test('çarpan: talep + gelişme modeli, yeterli satışta işlem fiyatına çekilir, sınırlar içinde kalır', () => {
  const b = { sahipli: 10, yeni: 2, arsa: 1000, yapi: 1000, islemler: [] };
  const model = 1 + (10 * PIYASA.talepParsel + 2 * PIYASA.talepYeni) + PIYASA.gelisimKat;
  assert.equal(piyasa.carpanHesapla(b).carpan, Math.round(model * 1000) / 1000);
  // Üç farklı satıcı ve alıcı arasında üç satış, değerinin iki katına: işlem çarpanı 2, ağırlık tam
  const islemler = Array.from({ length: 3 }, (_, i) => ({ price: 200, deger_ani: 100, carpan_ani: 1, seller_id: i + 1, buyer_id: i + 10 }));
  const c = piyasa.carpanHesapla({ ...b, islemler });
  assert.equal(c.islemCarpani, 2);
  assert.equal(c.carpan, Math.round((model * (1 - PIYASA.islemAgirlik) + 2 * PIYASA.islemAgirlik) * 1000) / 1000);
  // Tek uç satış ya da üç hesabın kendi arasındaki döngüsü endeksi oynatamaz: işlem sinyali devreye girmez
  const uc = piyasa.carpanHesapla({ ...b, islemler: [{ price: 100000, deger_ani: 100, carpan_ani: 1, seller_id: 1, buyer_id: 2 }] });
  assert.equal(uc.carpan, Math.round(model * 1000) / 1000);
  const dongu = [[1, 2], [2, 3], [3, 1], [1, 2]].map(([s, a]) => ({ price: 199, deger_ani: 100, carpan_ani: 1, seller_id: s, buyer_id: a }));
  assert.equal(piyasa.carpanHesapla({ ...b, islemler: dongu.slice(0, 2) }).islemCarpani, null);
  assert.ok(piyasa.carpanHesapla({ ...b, islemler: dongu }).islemCarpani > 1, 'üç farklı satıcı ve alıcı: sinyal devrede');
  assert.equal(piyasa.carpanHesapla(null).carpan, 1, 'sahipli parseli olmayan mahalle tahsis seviyesinde');
});

let A, B, parsel, fiyat;
test('tahmini değer ve kart: arsa = tahsis × mahalle çarpanı; fiyat geçmişinde tahsis', async () => {
  [A, B] = [istemci(), istemci()];
  for (const [c, ad] of [[A, 'Pelin'], [B, 'Kaan']]) {
    assert.equal((await c('/api/kayit', { email: `${ad.toLowerCase()}@test.local`, sifre: 'parola123', dogumYili: 1990, kosullarOnay: true, kvkkOnay: true, ad })).durum, 201);
  }
  parsel = hucreBul('TARIM');
  assert.equal((await A(`/api/parsel/${parsel}/edin`, {})).durum, 200);
  assert.equal((await A(`/api/parsel/${parsel}/insaat`, { tip: 'TEL_CIT' })).durum, 200);
  const k = (await A(`/api/parsel/${parsel}`)).veri;
  assert.ok(k.deger.carpan >= 1, 'sahipli parsel mahalleye talep getirir');
  assert.equal(k.deger.arsa, Math.round(k.deger.tahsis * k.deger.carpan));
  assert.equal(k.piyasa.endeks, Math.round(1000 * k.deger.carpan) / 10);
  assert.deepEqual(k.piyasa.fiyatGecmisi.map((x) => x.tur), ['TAHSIS']);
  assert.equal(k.piyasa.fiyatGecmisi[0].fiyat, k.deger.tahsis);
});

test('portföy: alış + yatırım = maliyet; getiri = değer + kira − maliyet', async () => {
  const r = await A('/api/portfoy');
  assert.equal(r.durum, 200);
  const x = r.veri.parseller.find((p) => p.id === parsel);
  const k = (await A(`/api/parsel/${parsel}`)).veri;
  assert.equal(x.alis, k.deger.tahsis);
  assert.equal(x.yatirim, YAPILAR.TEL_CIT.maliyet);
  assert.equal(x.maliyet, x.alis + x.yatirim);
  assert.equal(x.getiri, x.deger + x.kira - x.maliyet);
  assert.equal(r.veri.ozet.maliyet, r.veri.parseller.reduce((a, p) => a + p.maliyet, 0));
  assert.equal((await istemci()('/api/portfoy')).durum, 401, 'giriş gerekir');
});

test('satış: değer anı kaydedilir, alıcının maliyeti satış fiyatı, satıcıda gerçekleşmiş kâr', async () => {
  fiyat = 400;   // alıcının başlangıç bakiyesi 500
  const ilan = (await A(`/api/parsel/${parsel}/ilan`, { fiyat, gun: 3 })).veri.ilanId;
  assert.equal((await B(`/api/ilan/${ilan}/hemen-al`, { fiyat })).durum, 200);
  const t = db.prepare('SELECT deger_ani, carpan_ani, fee FROM trades WHERE parcel_id = ?').get(parsel);
  assert.ok(t.deger_ani > 0 && t.carpan_ani >= 1);

  const alici = (await B('/api/portfoy')).veri.parseller.find((p) => p.id === parsel);
  assert.equal(alici.alisTuru, 'TRADE');
  assert.equal(alici.alis, fiyat);
  assert.equal(alici.yatirim, 0, 'önceki sahibin yatırımı alıcının maliyetine girmez');

  const s = (await A('/api/portfoy')).veri;
  assert.ok(!s.parseller.some((p) => p.id === parsel));
  const satis = s.satislar.find((x) => x.id === parsel);
  assert.equal(satis.net, fiyat - t.fee);
  assert.equal(satis.kar, satis.net + satis.kira - satis.alis - satis.yatirim);
  assert.equal(s.ozet.gerceklesen, satis.kar);

  const g = (await B(`/api/parsel/${parsel}`)).veri.piyasa.fiyatGecmisi;
  assert.deepEqual(g.map((x) => x.tur), ['TAHSIS', 'SATIS']);
  assert.equal(g[1].fiyat, fiyat);
});

test('endeks: mahalle, ilçe, il ve Türkiye kareleri; gün içinde tazelenir; özet ve seri uçları', async () => {
  const p = db.prepare('SELECT region_id, ilce_id, il_id FROM parcels WHERE id = ?').get(parsel);
  piyasa.endeksKaydet(Date.now());
  piyasa.endeksKaydet(Date.now());   // aynı gün ikinci kayıt üzerine yazar
  const gun = piyasa.gunAnahtari(Date.now());
  for (const [tur, id] of [['MAHALLE', p.region_id], ['ILCE', p.ilce_id], ['IL', p.il_id], ['TR', 0]]) {
    const satir = db.prepare('SELECT COUNT(*) AS c, MAX(islem) AS islem, MAX(hacim) AS hacim FROM deger_endeksi WHERE tur = ? AND bolge_id = ? AND gun = ?').get(tur, id, gun);
    assert.equal(satir.c, 1, tur);
    assert.equal(satir.islem, 1, `${tur}: bugünkü satış sayılır`);
    assert.equal(satir.hacim, fiyat);
  }
  const ozet = (await istemci()('/api/piyasa')).veri;
  assert.ok(ozet.tr.endeks >= 100, JSON.stringify(ozet.tr));
  assert.ok(ozet.degerliler.length > 0 && ozet.degerliler.every((m, i, d) => !i || d[i - 1].endeks >= m.endeks), "en değerliler sıralı");
  assert.equal(ozet.islem30.sayi, 1);
  const seri = (await istemci()(`/api/piyasa/endeks?tur=MAHALLE&id=${p.region_id}`)).veri;
  assert.equal(seri.seri.at(-1).gun, gun);
  assert.deepEqual((await istemci()('/api/piyasa/endeks?tur=__proto__&id=1')).veri, { seri: [] });
});

const geriAl = (parcelId, gun) => db.prepare(`UPDATE parcel_ownership SET start_at = datetime(start_at, ?) WHERE parcel_id = ? AND end_at IS NULL`).run(`-${gun} days`, parcelId);

test('tahsis güncel endeksle fiyatlanır: taban bedel × mahalle çarpanı', async () => {
  const oyun = require('../server/oyun');
  const I = require('../server/harita/izgara');
  const p = oyun.parselGetir(parsel);
  let kontrol = 0;
  for (let d = 1; d <= 6 && !kontrol; d++) {
    for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d]]) {
      const id = I.parselId(p.grid_x + dx, p.grid_y + dy);
      const k = (await A(`/api/parsel/${id}`)).veri;
      if (k?.birincilBedel == null || k.mahalleId !== p.region_id) continue;
      const taban = oyun.birincilBedel(oyun.parselGetir(id));
      assert.ok(piyasa.mahalleCarpani(p.region_id).carpan > 1);
      assert.equal(k.birincilBedel, Math.round(taban * piyasa.mahalleCarpani(p.region_id).carpan));
      assert.equal(k.deger.arsa, k.birincilBedel, 'yeni tahsiste anında kâğıt kârı yok');
      kontrol++;
      break;
    }
  }
  assert.equal(kontrol, 1, 'aynı mahallede boş bir tarım hücresi bulunmalı');
});

test('Hazine teklifi: satıcının kendi parselleri, yapıları ve işlemleri mahalle çarpanına sayılmaz', () => {
  const r = db.prepare('SELECT region_id FROM parcels WHERE id = ?').get(parsel).region_id;
  const sahip = db.prepare('SELECT owner_user_id FROM parcels WHERE id = ?').get(parsel).owner_user_id;
  const tum = piyasa.carpanHesapla(piyasa.bolgeSinyalleri(Date.now(), r).get(r));
  const haric = piyasa.carpanHesapla(piyasa.bolgeSinyalleri(Date.now(), r, { haric: sahip }).get(r));
  assert.ok(haric.carpan <= tum.carpan);
  assert.ok(haric.sahipli < tum.sahipli);
});

test('Hazine: 3 gün tutma, güncel teklif, %85 ödeme, parsel Hazine ilanına çıkar, günde bir satış', async () => {
  // İnşaat bitsin (Hazine sürmekte olan inşaatı almaz)
  db.prepare('UPDATE structures SET completes_at = ? WHERE parcel_id = ?').run(Date.now() - 1, parsel);
  require('../server/oyun').bekleyenleriIsle();
  let k = (await B(`/api/parsel/${parsel}`)).veri;
  assert.equal(k.hazine.uygun, false);
  assert.match(k.hazine.sebep, /3 gün/);
  assert.equal((await B(`/api/parsel/${parsel}/hazineye-sat`, {})).durum, 409);
  geriAl(parsel, 4);
  k = (await B(`/api/parsel/${parsel}`)).veri;
  assert.equal(k.hazine.uygun, true);
  assert.equal(k.hazine.teklif, Math.floor(k.hazine.deger * PIYASA.hazine.oran));
  assert.equal((await istemci()(`/api/parsel/${parsel}/hazineye-sat`, {})).durum, 401);
  assert.equal((await A(`/api/parsel/${parsel}/hazineye-sat`, {})).durum, 403, 'sahibi olmayan satamaz');
  assert.equal((await B(`/api/parsel/${parsel}/hazineye-sat`, { teklif: k.hazine.teklif + 1 })).durum, 409, 'eski teklifle işlem yapılmaz');

  const once = (await B('/api/ben')).veri.bakiye;
  const r = await B(`/api/parsel/${parsel}/hazineye-sat`, { teklif: k.hazine.teklif });
  assert.equal(r.durum, 200);
  assert.equal((await B('/api/ben')).veri.bakiye, once + k.hazine.teklif);
  const hz = piyasa.hazineId(false);
  assert.equal(db.prepare('SELECT owner_user_id FROM parcels WHERE id = ?').get(parsel).owner_user_id, hz);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM structures WHERE parcel_id = ? AND owner_user_id <> ?').get(parsel, hz).c, 0);
  const ilan = db.prepare(`SELECT seller_id, asking_price FROM listings WHERE parcel_id = ? AND status = 'ACTIVE'`).get(parsel);
  assert.equal(ilan.seller_id, hz);
  assert.ok(ilan.asking_price > k.hazine.teklif, 'Hazine bugünkü değerle satar (alım-satım farkı oyundan çıkar)');

  const pf = (await B('/api/portfoy')).veri;
  const s = pf.satislar.find((x) => x.hazine);
  assert.equal(s.fiyat, k.hazine.teklif);
  assert.equal(s.alis, 400);
  const g = (await B(`/api/parsel/${parsel}`)).veri.piyasa.fiyatGecmisi;
  assert.deepEqual(g.map((x) => x.tur), ['TAHSIS', 'SATIS', 'HAZINE']);

  // Aynı gün ikinci Hazine satışı yok
  const yeni = hucreBul('TARIM', [32.6, 37.95]);
  assert.equal((await B(`/api/parsel/${yeni}/edin`, {})).durum, 200);
  geriAl(yeni, 4);
  const k2 = (await B(`/api/parsel/${yeni}`)).veri;
  assert.equal(k2.hazine.uygun, false);
  assert.match(k2.hazine.sebep, /günde/);
});

test('Hazine: başlangıç hediyesi arsa ikinci hesaba devredilse de 30 gün dolmadan Hazine\'ye satılamaz', async () => {
  const [S, M] = [istemci(), istemci()];
  for (const [c, ad] of [[S, 'Sibel'], [M, 'Murat']]) {
    assert.equal((await c('/api/kayit', { email: `${ad.toLowerCase()}@test.local`, sifre: 'parola123', dogumYili: 1990, kosullarOnay: true, kvkkOnay: true, ad })).durum, 201);
    await c('/api/ben');
  }
  const r = await S('/api/baslangic/tarla', {});
  assert.equal(r.durum, 200, JSON.stringify(r.veri));
  const p = r.veri.parsel;
  const ilan = (await S(`/api/parsel/${p}/ilan`, { fiyat: 1, gun: 1 })).veri.ilanId;
  assert.equal((await M(`/api/ilan/${ilan}/hemen-al`, { fiyat: 1 })).durum, 200);
  geriAl(p, 4);
  const k = (await M(`/api/parsel/${p}`)).veri;
  assert.equal(k.hazine.uygun, false);
  assert.match(k.hazine.sebep, /hediye/i);
  assert.equal((await M(`/api/parsel/${p}/hazineye-sat`, {})).durum, 409);
  // Hediyenin üstünden 30 gün geçince satılabilir
  db.prepare(`UPDATE parcel_ownership SET start_at = datetime(start_at, '-31 days') WHERE parcel_id = ? AND reason = 'BASLANGIC'`).run(p);
  assert.equal((await M(`/api/parsel/${p}`)).veri.hazine.uygun, true);
});

test('fiyat alarmı: açık alarm sayısı ne olursa olsun hedefe ulaşan her alarm tetiklenir', () => {
  const alarm = require('../server/alarm');
  const r = db.prepare('SELECT region_id FROM parcels WHERE id = ?').get(parsel).region_id;
  piyasa.endeksKaydet(Date.now());
  const u = db.prepare('SELECT owner_user_id FROM parcels WHERE id = ?').get(parsel).owner_user_id;
  const ekle = db.prepare('INSERT INTO fiyat_alarmlari (user_id, bolge_id, yon, hedef, created_at) VALUES (?, ?, ?, ?, ?)');
  db.transaction(() => { for (let i = 0; i < 600; i++) ekle.run(u, r, 'YUKARI', 9999, Date.now()); })();
  const id = ekle.run(u, r, 'YUKARI', 1, Date.now()).lastInsertRowid;
  alarm.alarmBakim(Date.now() + 120_000);
  assert.ok(db.prepare('SELECT tetiklendi_at FROM fiyat_alarmlari WHERE id = ?').get(id).tetiklendi_at != null);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM fiyat_alarmlari WHERE hedef = 9999 AND tetiklendi_at IS NOT NULL').get().c, 0);
});

test('Hazine: tesisinde süren üretim olan parseli almaz (eski sahibin partisi kaybolmasın)', async () => {
  const U = istemci();
  assert.equal((await U('/api/kayit', { email: 'uretici@test.local', sifre: 'parola123', dogumYili: 1990, kosullarOnay: true, kvkkOnay: true, ad: 'Uretici' })).durum, 201);
  const uid = (await U('/api/ben')).veri.kullanici.id;
  const p = hucreBul('TARIM', [32.4, 37.8]);
  assert.equal((await U(`/api/parsel/${p}/edin`, {})).durum, 200);
  assert.equal((await U(`/api/parsel/${p}/insaat`, { tip: 'TEL_CIT' })).durum, 200);
  db.prepare('UPDATE structures SET completes_at = ? WHERE parcel_id = ?').run(Date.now() - 1, p);
  require('../server/oyun').bekleyenleriIsle();
  const yapi = db.prepare('SELECT id FROM structures WHERE parcel_id = ?').get(p).id;
  const parti = db.prepare(`INSERT INTO uretimler (user_id, parcel_id, structure_id, recete, parti, cikti, baslangic, bitis) VALUES (?, ?, ?, 'UN', 1, 1, ?, ?)`)
    .run(uid, p, yapi, Date.now(), Date.now() + 1e7).lastInsertRowid;
  geriAl(p, 4);
  const r = await U(`/api/parsel/${p}/hazineye-sat`, {});
  assert.equal(r.durum, 409);
  assert.match(r.veri.hata, /süren üretimi topla/);
  db.prepare(`UPDATE uretimler SET durum = 'TOPLANDI' WHERE id = ?`).run(parti);
  assert.equal((await U(`/api/parsel/${p}`)).veri.hazine.uygun, true);
});
