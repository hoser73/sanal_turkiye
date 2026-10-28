// Sezon yolu (mevsim-yolu.js): dönem, eylemden puan, günlük tavan, kademe ödülü (akçe, eşya, kozmetik), tek seferlik alma.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { ortamKur, istemciUret } = require('./yardimci');

const VERI = ortamKur('mevsim-yolu');
const app = require('../server/index');
const db = require('../server/db');
const L = require('../server/lib/ledger');
const yolu = require('../server/mevsim-yolu');
const { MEVSIM_YOLU: Y } = require('../server/config/rules');

let sunucu, taban;
before(async () => {
  await new Promise((r) => { sunucu = app.listen(0, r); });
  taban = `http://127.0.0.1:${sunucu.address().port}`;
  await app.hazir;
});
after(() => { sunucu.close(); fs.rmSync(VERI, { recursive: true, force: true }); });
const istemci = istemciUret(() => taban);

test('dönem: mevsimler Türkiye saatiyle; kış aralıkta başlar ve şubatta aynı dönemdir', () => {
  const tr = (s) => Date.parse(`${s}+03:00`);
  assert.equal(yolu.donem(tr('2026-10-27T12:00:00')).kod, '2026-SONBAHAR');
  assert.equal(yolu.donem(tr('2026-12-01T00:30:00')).kod, '2026-KIS');
  assert.equal(yolu.donem(tr('2027-02-20T12:00:00')).kod, '2026-KIS');
  assert.equal(yolu.donem(tr('2027-03-01T00:00:00')).kod, '2027-ILKBAHAR');
  assert.equal(yolu.donem(tr('2026-10-27T12:00:00')).bitis, tr('2026-12-01T00:00:00'));
  assert.equal(yolu.esik(1), Y.taban + Y.artis);
});

let A, id;
test('puan: eylemlerden; günlük tavan; ödül bir kez alınır; akçe, eşya ve kozmetik verilir', async () => {
  A = istemci();
  assert.equal((await A('/api/kayit', { email: 'yolcu@test.local', sifre: 'parola123', dogumYili: 1990, kosullarOnay: true, kvkkOnay: true, ad: 'Yolcu' })).durum, 201);
  id = (await A('/api/ben')).veri.kullanici.id;
  // Günlük tavan: aynı eylemden en çok gunlukTavan kayıt
  for (let i = 0; i < Y.gunlukTavan + 5; i++) yolu.puanVer(id, 'CROP_PLANTED');
  let d = (await A('/api/yol')).veri;
  assert.equal(d.puan, Y.gunlukTavan * Y.puanlar.CROP_PLANTED);
  assert.equal(yolu.puanVer(id, 'BILINMEYEN'), 0);

  // Yeterli puanla 10. kademeye kadar: elle puan ekle (farklı eylemler)
  db.prepare('UPDATE yol_puanlari SET puan = ? WHERE user_id = ?').run(yolu.esik(10), id);
  d = (await A('/api/yol')).veri;
  assert.equal(d.ulasilan, 10);
  assert.equal(d.alinabilir, 10);
  assert.equal((await A('/api/yol/al', { kademe: 11 })).durum, 409, 'ulaşılmamış kademe alınamaz');
  for (const kademe of [true, [1], '1']) assert.equal((await A('/api/yol/al', { kademe })).durum, 400, JSON.stringify(kademe));
  const once = L.bakiye(id);
  const r = await A('/api/yol/al', { kademe: 1 });
  assert.equal(r.durum, 200);
  assert.equal(Math.round(L.bakiye(id) - once), Y.odul(1).akce);
  assert.equal((await A('/api/yol/al', { kademe: 1 })).durum, 409, 'aynı kademe iki kez alınmaz');

  const hepsi = await A('/api/yol/al', {});
  assert.equal(hepsi.durum, 200);
  assert.deepEqual(hepsi.veri.kademeler, [2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(L.envanterMiktar(id, 'KALIP_SETI'), 2, '5. kademe kalıp seti');
  assert.equal(L.envanterMiktar(id, 'YEM'), 40, '3. ve 8. kademe yem');
  assert.ok(db.prepare("SELECT 1 FROM kozmetikler WHERE user_id = ? AND kod = 'BAYRAK_YOLCU'").get(id), '10. kademe flama');
  assert.equal((await A('/api/yol/al', {})).durum, 409, 'alınacak ödül kalmadı');
  assert.equal((await A('/api/kozmetik/al', { kod: 'CATI_BAKIR' })).durum, 409, 'yol kozmetiği satılmaz');
});

test('olay yolu: oyun eylemi puan verir; demo/NPC hesaplar puan almaz', async () => {
  const once = (await A('/api/yol')).veri.puan;
  L.denetim({ aktor: id, eylem: 'ORDER_DELIVERED', varlik: 'deneme' });
  assert.equal((await A('/api/yol')).veri.puan, once + Y.puanlar.ORDER_DELIVERED);
  const npc = db.prepare('INSERT INTO users (display_name, is_npc) VALUES (?, 1)').run('Demo Yolcu').lastInsertRowid;
  assert.equal(yolu.puanVer(npc, 'ORDER_DELIVERED'), 0);
  assert.equal((await istemci()('/api/yol')).durum, 401);
});
