// Balık tutma takımı ve ortam: yem/derinlik tür olasılığını değiştirir, ücretli yem akçe düşer, misina mücadelede dayanımı
// belirler, ilin gerçek saati ve havası balık aktivitesini çarpar; atıştan önce ortam bilgisi.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { ortamKur, istemciUret } = require('./yardimci');

const VERI = ortamKur('balik');
const app = require('../server/index');
const db = require('../server/db');
const L = require('../server/lib/ledger');
const balik = require('../server/balik');
const { BALIK } = require('../server/config/rules');

let sunucu, taban;
before(async () => {
  await new Promise((r) => { sunucu = app.listen(0, r); });
  taban = `http://127.0.0.1:${sunucu.address().port}`;
  await app.hazir;
  balik.ayar.suBul = async (lon) => (lon > 40 ? { tip: 'ic', plaka: '65' } : lon > 30 ? { tip: 'ic', plaka: '42' } : lon > 20 ? { tip: 'deniz', plaka: '34' } : null);
});
after(() => { sunucu.close(); fs.rmSync(VERI, { recursive: true, force: true }); });

const istemci = istemciUret(() => taban);
async function oyuncu(ad) {
  const c = istemci();
  assert.equal((await c('/api/kayit', { email: `${ad}@test.local`, sifre: 'parola123', dogumYili: 1990, kosullarOnay: true, kvkkOnay: true, ad })).durum, 201);
  c.id = (await c('/api/ben')).veri.kullanici.id;
  // Balık 3., çarşı 4. seviyede açılır (SEVIYE_KILIDI)
  await db.run('UPDATE users SET tp = ? WHERE id = ?', require('../server/config/rules').SEVIYE.katsayi * 4 * 3, c.id);
  return c;
}
const KONYA = { lon: 32.5, lat: 37.9 }, ISTANBUL = { lon: 29, lat: 41 };

test('tür dağılımı: mısır ve derin su sazanı, sahte yem ve sığ su alabalığı öne çıkarır; uyumsuz yem geç ısırtır', () => {
  const su = { tip: 'ic', plaka: '42' };
  const misir = balik.turDagilimi(su, 'MISIR', 'DERIN').dagilim, sahte = balik.turDagilimi(su, 'SAHTE', 'SIG').dagilim;
  const oran = (d, k) => d[k] / Object.values(d).reduce((a, b) => a + b, 0);
  assert.ok(oran(misir, 'SAZAN') > 0.9);
  assert.ok(oran(sahte, 'ALABALIK') > 0.6);
  assert.ok(balik.turDagilimi(su, 'MISIR', 'DERIN').uyum > balik.turDagilimi(su, 'KARIDES', 'SIG').uyum);
  const deniz = balik.turDagilimi({ tip: 'deniz', plaka: '34' }, 'SAHTE', 'ORTA').dagilim;
  assert.ok(oran(deniz, 'LUFER') > 0.5, 'Karadeniz kıyısında sahte yemle lüfer');
});

test('aktivite: fırtınada balık durgun, bulutlu havada iştahlı; sebepler açıklanır', async () => {
  const t = Date.now();
  await db.run(`INSERT INTO hava_durumu (plaka, sicaklik, yagis, kod, ruzgar, gunduz, guncellendi) VALUES ('06', 18, 0, 96, 10, 1, ?)
              ON CONFLICT(plaka) DO UPDATE SET kod = 96, sicaklik = 18, ruzgar = 10`, t);
  const firtina = await balik.aktivite('06', t);
  await db.run(`UPDATE hava_durumu SET kod = 3 WHERE plaka = '06'`);
  const bulutlu = await balik.aktivite('06', t);
  assert.ok(firtina.kat > bulutlu.kat);
  assert.ok(firtina.sebepler.some((s) => /fırtına/.test(s)));
  assert.ok(bulutlu.sebepler.some((s) => /bulutlu/.test(s)));
  assert.ok(['yüksek', 'normal', 'düşük'].includes(firtina.etiket));
});

test('ortam: atıştan önce su türü, yöre türleri ve kalan hak; su olmayan yerde bölgenin suyu; giriş yapmamış ziyaretçi', async () => {
  const c = await oyuncu('ortamci');
  const o = (await c(`/api/balik/ortam?lon=${KONYA.lon}&lat=${KONYA.lat}`)).veri;
  assert.equal(o.su.tip, 'ic');
  assert.deepEqual(o.turler.map((t) => t.kod).sort(), ['ALABALIK', 'SAZAN']);
  assert.ok(o.turler[0].yem && o.turler[0].derinlik);
  assert.equal(o.kalan, BALIK.gunlukAtis);
  assert.ok(o.aktivite.kat > 0);
  // Su olmayan yer ya da konum yok: oyuncunun bölgesinin suyu (tarlası/memleketi yoksa Konya: göl)
  assert.deepEqual((await c('/api/balik/ortam?lon=10&lat=10')).veri.su, { tip: 'ic', plaka: '42' });
  assert.equal((await c('/api/balik/ortam')).veri.su.plaka, '42');
  assert.equal((await istemci()(`/api/balik/ortam?lon=${KONYA.lon}&lat=${KONYA.lat}`)).durum, 401);
  const tk = (await istemci()('/api/balik/takim')).veri;
  assert.ok(tk.yemler.KARIDES.fiyat > 0 && tk.misinalar.INCE.dayanim < tk.misinalar.KALIN.dayanim);
});

test('atış: ücretli yem akçe düşer, bilinmeyen takım varsayılana döner; misina dayanımı mücadeleye geçer', async () => {
  const c = await oyuncu('takimci');
  const once = await L.bakiye(c.id);
  const a = (await c('/api/balik/at', { ...ISTANBUL, yem: 'KARIDES', derinlik: 'DERIN', misina: 'KALIN' })).veri;
  assert.equal(a.yem, 'KARIDES'); assert.equal(a.derinlik, 'DERIN'); assert.equal(a.misina, 'KALIN');
  assert.equal(L.yuvarla(once - (await L.bakiye(c.id))), BALIK.yemler.KARIDES.fiyat);
  assert.ok(a.isirmaMs >= BALIK.aktivite.min && a.isirmaMs <= BALIK.aktivite.maks);
  assert.ok(a.aktivite.etiket);
  const kayit = await db.get(`SELECT yem, derinlik, misina FROM balik_atislari WHERE id = ?`, a.id);
  assert.deepEqual({ ...kayit }, { yem: 'KARIDES', derinlik: 'DERIN', misina: 'KALIN' });
  // Isırma anına çek: misina dayanımı ve davranış gelir
  await db.run(`UPDATE balik_atislari SET isirma = ? WHERE id = ?`, Date.now(), a.id);
  const cek = (await c(`/api/balik/${a.id}/cek`, {})).veri;
  assert.equal(cek.takildi, true);
  assert.equal(cek.dayanim, BALIK.misinalar.KALIN.dayanim);
  assert.ok(['inatci', 'kacak', 'sicrayan', 'surucu'].includes(cek.davranis));
  // Bilinmeyen takım varsayılan; solucan ücretsiz
  const b = (await c('/api/balik/at', { ...KONYA, yem: '__proto__', derinlik: 'UZAY', misina: 1 })).veri;
  assert.deepEqual([b.yem, b.derinlik, b.misina], ['SOLUCAN', 'ORTA', 'ORTA']);
  assert.equal(b.yemFiyat, 0);
});

test('atış: yem parası yetmezse atış olmaz ve hak düşmez', async () => {
  const c = await oyuncu('bosceb');
  await db.tx(async () => L.harca(c.id, await L.bakiye(c.id), 'test: cüzdanı boşalt'));
  const r = await c('/api/balik/at', { ...ISTANBUL, yem: 'SAHTE' });
  assert.ok(r.durum >= 400);
  assert.equal((await db.get(`SELECT COUNT(*) c FROM balik_atislari WHERE user_id = ?`, c.id)).c, 0);
  assert.equal((await c('/api/balik/at', { ...ISTANBUL, yem: 'SOLUCAN' })).durum, 200, 'solucan bedava');
});
