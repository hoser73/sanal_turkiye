// Hasat yarışı (hasat-yarisi.js): üye eylemi takım ve il puanı, günlük tavan, sandıklar, sıralama, il sıralaması ve il ödülü, haftalık sonuç bir kez.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { ortamKur, istemciUret, hucreBul } = require('./yardimci');

const VERI = ortamKur('hasat-yarisi');
const app = require('../server/index');
const db = require('../server/db');
const L = require('../server/lib/ledger');
const yaris = require('../server/hasat-yarisi');
const { HASAT_YARISI: Y } = require('../server/config/rules');

let sunucu, taban;
before(async () => {
  await new Promise((r) => { sunucu = app.listen(0, r); });
  taban = `http://127.0.0.1:${sunucu.address().port}`;
  await app.hazir;
});
after(() => { sunucu.close(); fs.rmSync(VERI, { recursive: true, force: true }); });
const istemci = istemciUret(() => taban);
// Olay yolu dinleyicileri işlem kaydedildikten sonra zaman uyumsuz çalışır: etkisini denetlemeden önce kısa bekle
const olaylariBekle = () => new Promise((r) => setTimeout(r, 50));

const oyuncular = [];
test('hazırlık: aynı ilde üç oyuncu, biri kooperatif kurar, ikisi katılır', async () => {
  for (const ad of ['Takim1', 'Takim2', 'Takim3', 'Yalniz']) {
    const c = istemci();
    assert.equal((await c('/api/kayit', { email: `${ad.toLowerCase()}@test.local`, sifre: 'parola123', dogumYili: 1990, kosullarOnay: true, kvkkOnay: true, ad })).durum, 201);
    c.id = (await c('/api/ben')).veri.kullanici.id;
    assert.equal((await c(`/api/parsel/${hucreBul('TARIM')}/edin`, {})).durum, 200);
    oyuncular.push(c);
  }
  const [a, b, c] = oyuncular;
  const ilId = (await db.get('SELECT il_id FROM parcels WHERE owner_user_id = ?', a.id)).il_id;
  const k = await a('/api/kooperatif', { ilId, ad: 'Bereket Koop', aciklama: 'deneme' });
  assert.equal(k.durum, 200, JSON.stringify(k.veri));
  const id = k.veri.id ?? k.veri.koopId ?? (await db.get('SELECT id FROM kooperatifler ORDER BY id DESC LIMIT 1')).id;
  for (const x of [b, c]) assert.equal((await x(`/api/kooperatif/${id}/katil`, {})).durum, 200);
});

test('puan: üye eylemi takıma yazılır, üye olmayan ve demo puan almaz, günlük tavan', async () => {
  const [a, b, , yalniz] = oyuncular;
  assert.equal(await yaris.puanVer(yalniz.id, 'ORDER_DELIVERED'), Y.puanlar.ORDER_DELIVERED, 'kooperatifi yok ama ili için puan alır');
  for (let i = 0; i < Y.gunlukTavan + 3; i++) await yaris.puanVer(a.id, 'CROP_HARVESTED');
  await L.denetim({ aktor: b.id, eylem: 'ORDER_DELIVERED', varlik: 'deneme' });   // olay yolu üzerinden
  await olaylariBekle();
  const d = (await a('/api/hasat-yarisi')).veri;
  assert.equal(d.benim.puan, Y.gunlukTavan * Y.puanlar.CROP_HARVESTED + Y.puanlar.ORDER_DELIVERED);
  assert.equal(d.benim.katkim, Y.gunlukTavan * Y.puanlar.CROP_HARVESTED);
  assert.equal(d.benim.sira, 1);
  assert.equal(d.siralama[0].ben, true);
  assert.equal((await yalniz('/api/hasat-yarisi')).veri.benim, null);
});

test('sonuç: sandık ödülü yalnızca yeterli katkı verenlere, ilk sıraya kasa bonusu, ikinci kez dağıtılmaz', async () => {
  const [a, b, c] = oyuncular;
  const h = yaris.haftaNo() - 4;   // daha önce hiç açılmamış eski bir hafta (h - 1 = sonuçlanacak hafta)
  const koop = (await db.get('SELECT koop_id FROM kooperatif_uyeleri WHERE user_id = ?', a.id)).koop_id;
  // Geçen hafta: takım 900 puan (iki sandık); c katkısı eşiğin altında
  await db.run('INSERT INTO koop_yaris (hafta, koop_id, user_id, puan) VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)',
    h - 1, koop, a.id, 600, h - 1, koop, b.id, 290, h - 1, koop, c.id, Y.minKatki - 1);
  const once = [];
  for (const x of [a, b, c]) once.push(await L.bakiye(x.id));
  const kasaOnce = await L.hesapBakiye(`KOOP:${koop}`);
  assert.equal(await yaris.sonuclandir(h - 1), true);
  assert.equal(await yaris.sonuclandir(h - 1), false, 'bir kez');
  const odul = Y.sandiklar[0].odul + Y.sandiklar[1].odul;
  assert.equal(Math.round(await L.bakiye(a.id) - once[0]), odul);
  assert.equal(Math.round(await L.bakiye(b.id) - once[1]), odul);
  assert.equal(Math.round(await L.bakiye(c.id) - once[2]), 0, 'katkı eşiğin altında');
  assert.equal(Math.round(await L.hesapBakiye(`KOOP:${koop}`) - kasaOnce), Y.kasaBonusu[0]);
  const sonuc = await db.get('SELECT sira, sandik, bonus FROM koop_yaris_sonuc WHERE hafta = ? AND koop_id = ?', h - 1, koop);
  assert.deepEqual(sonuc, { sira: 1, sandik: 2, bonus: Y.kasaBonusu[0] });
});

test('sonuç: kooperatif değiştiren haftada bir kez sandık payı alır; aktif olmayan (tek üyeli) kooperatif sandık açmaz', async () => {
  const [a] = oyuncular;
  const h = yaris.haftaNo() - 12;
  const koop1 = (await db.get('SELECT koop_id FROM kooperatif_uyeleri WHERE user_id = ?', a.id)).koop_id;
  const ilId = (await db.get('SELECT il_id FROM kooperatifler WHERE id = ?', koop1)).il_id;
  const yeniUye = db.sorgu('INSERT INTO users (display_name) VALUES (?)');
  const yeniKoop = async (ad, n) => {
    const uyeler = [];
    for (let i = 0; i < n; i++) uyeler.push(Number((await yeniUye.run(`${ad}${i}`)).lastInsertRowid));
    const id = Number((await db.run('INSERT INTO kooperatifler (il_id, ad, baskan_id, created_at) VALUES (?, ?, ?, ?)', ilId, ad, uyeler[0], Date.now())).lastInsertRowid);
    for (const u of uyeler) await db.run('INSERT INTO kooperatif_uyeleri (koop_id, user_id, katilim) VALUES (?, ?, ?)', id, u, Date.now());
    return { id, uyeler };
  };
  const k2 = await yeniKoop('Ikinci Koop', 3), k3 = await yeniKoop('Tek Koop', 1);
  const yaz = db.sorgu('INSERT INTO koop_yaris (hafta, koop_id, user_id, puan) VALUES (?, ?, ?, ?)');
  await yaz.run(h, koop1, a.id, 900);           // a: önce koop1'de 900 (iki sandık)
  await yaz.run(h, k2.id, a.id, 400);           // sonra koop2'ye geçip 400 daha (koop2 de iki sandık)
  await yaz.run(h, k2.id, k2.uyeler[0], 500);
  await yaz.run(h, k3.id, k3.uyeler[0], 1600);  // tek üyeli: üç sandık puanı var ama aktif değil
  const once = [];
  for (const id of [a.id, k2.uyeler[0], k3.uyeler[0]]) once.push(await L.bakiye(id));
  assert.equal(await yaris.sonuclandir(h), true);
  const iki = Y.sandiklar[0].odul + Y.sandiklar[1].odul;
  assert.equal(Math.round(await L.bakiye(a.id) - once[0]), iki, 'yalnızca en çok katkı verdiği kooperatiften bir pay');
  assert.equal(Math.round(await L.bakiye(k2.uyeler[0]) - once[1]), iki);
  assert.equal(Math.round(await L.bakiye(k3.uyeler[0]) - once[2]), 0, 'tek üyeli kooperatif sandık açmaz');
  assert.deepEqual(await db.get('SELECT sira, sandik FROM koop_yaris_sonuc WHERE hafta = ? AND koop_id = ?', h, k3.id), { sira: null, sandik: 0 });
});

test('il sıralaması: kooperatifsiz oyuncu da iline puan yazar; ilk üç ilin yeterli katkı verenlerine il ödülü', async () => {
  const [a, , , yalniz] = oyuncular;
  const d = (await yalniz('/api/hasat-yarisi')).veri;
  assert.ok(d.benimIl, 'oyuncunun ili var (ilk tarlasının ili)');
  assert.ok(d.benimIl.katkim >= Y.puanlar.ORDER_DELIVERED);
  assert.equal(d.iller[0].ben, true);
  assert.equal(d.iller[0].sira, 1);
  // Geçmiş bir hafta: aynı ilde yalnız 100, a eşiğin altında
  const h = yaris.haftaNo() - 8;
  const ilId = d.benimIl && (await db.get("SELECT id FROM regions WHERE type = 'IL' AND plaka = ?", d.benimIl.plaka)).id;
  await db.run('INSERT INTO koop_yaris_il (hafta, il_id, user_id, puan) VALUES (?, ?, ?, ?), (?, ?, ?, ?)', h, ilId, yalniz.id, 100, h, ilId, a.id, Y.minKatki - 1);
  const once = [await L.bakiye(yalniz.id), await L.bakiye(a.id)];
  assert.equal(await yaris.sonuclandir(h), true);
  assert.equal(Math.round(await L.bakiye(yalniz.id) - once[0]), Y.ilOdulu[0]);
  assert.equal(Math.round(await L.bakiye(a.id) - once[1]), 0, 'katkı eşiğin altında');
  const koz = (await yalniz('/api/kozmetik')).veri;
  assert.ok((Array.isArray(koz) ? koz : koz.katalog || koz.liste).find((k) => k.kod === 'UNVAN_SAMPIYON').sahip, 'il rozeti şampiyon unvanını açar');
  const s = await db.get('SELECT sira, oyuncu, il_puani FROM koop_yaris_il_sonuc WHERE hafta = ? AND il_id = ?', h, ilId);
  assert.equal(s.sira, 1); assert.equal(s.oyuncu, 2);
  assert.equal(s.il_puani, Math.round(((100 + Y.minKatki - 1) / Math.sqrt(2)) * 10) / 10);
  assert.equal((await yalniz(`/api/memleket/${d.benimIl.plaka}`)).veri.yarisSirasi, 1);
});
