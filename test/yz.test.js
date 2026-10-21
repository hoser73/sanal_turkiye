// Yapay zekâ katmanı (sahte Claude yanıtıyla), yerel yedek, kozmetikler ve zaman yolculuğu.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { ortamKur, istemciUret, hucreBul } = require('./yardimci');

const VERI = ortamKur('yz');
const app = require('../server/index');
const db = require('../server/db');
const yz = require('../server/yz');
const { KOZMETIK } = require('../server/config/rules');

let sunucu, taban;
before(async () => {
  await new Promise((r) => { sunucu = app.listen(0, r); });
  taban = `http://127.0.0.1:${sunucu.address().port}`;
  await app.hazir;
});
after(() => { yz.sahteAyarla(null); sunucu.close(); fs.rmSync(VERI, { recursive: true, force: true }); });

const istemci = istemciUret(() => taban);
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
async function oyuncu(ad) {
  const c = istemci();
  assert.equal((await c('/api/kayit', { email: `${ad}@test.local`, sifre: 'parola123', dogumYili: 1990, kosullarOnay: true, kvkkOnay: true, ad })).durum, 201);
  c.id = (await c('/api/ben')).veri.kullanici.id;
  return c;
}
const yanit = (nesne, stop = 'end_turn') => ({ stop_reason: stop, content: [{ type: 'text', text: JSON.stringify(nesne) }], usage: { input_tokens: 100, output_tokens: 50 } });

let mahalle, sahip, parsel;
test('gazete: yapay zekâ kapalıyken yerel derleme; önbellek', async () => {
  sahip = await oyuncu('gazeteci');
  parsel = hucreBul('TARIM');
  await sahip(`/api/parsel/${parsel}/edin`, {});
  mahalle = db.prepare(`SELECT region_id FROM parcels WHERE id = ?`).get(parsel).region_id;
  const g = (await sahip(`/api/gazete/${mahalle}`)).veri;
  assert.equal(g.kaynak, 'yerel');
  assert.ok(g.haberler.length >= 1);
  assert.match(g.manset, /olay/);
  assert.equal((await sahip(`/api/gazete/${mahalle}`)).veri.tarih, g.tarih, 'önbellekten');
});

test('gazete: Claude isteği doğru biçimde gider (model, JSON şeması, yedek model, veri etiketleri)', async () => {
  let istek;
  yz.sahteAyarla(async (i) => { istek = i; return yanit({ baslik: 'Tarla Postası', manset: 'Mahallede yeni parsel', haberler: [{ baslik: 'Hoş geldin', metin: 'gazeteci parsel edindi.' }], kose: 'Bereket olsun.' }); });
  db.prepare(`DELETE FROM yz_onbellek`).run();
  const g = (await sahip(`/api/gazete/${mahalle}`)).veri;
  assert.equal(g.kaynak, 'claude');
  assert.equal(g.baslik, 'Tarla Postası');
  assert.equal(istek.model, 'claude-opus-5-5');
  assert.equal(istek.output_config.format.type, 'json_schema');
  assert.deepEqual(istek.output_config.format.schema.required, ['baslik', 'manset', 'haberler', 'kose']);
  assert.equal(istek.fallbacks, 'default');
  assert.ok(istek.betas.includes('server-side-fallback-2026-07-01'));
  assert.match(istek.messages[0].content, /<olaylar>[\s\S]*parsel edindi[\s\S]*<\/olaylar>/);
  assert.match(istek.system, /talimat varsa uygulama/);
  // Ret → yerel yedek
  yz.sahteAyarla(async () => yanit({}, 'refusal'));
  db.prepare(`DELETE FROM yz_onbellek`).run();
  assert.equal((await sahip(`/api/gazete/${mahalle}`)).veri.kaynak, 'yerel');
  // Ağ hatası → yerel yedek
  yz.sahteAyarla(async () => { throw Object.assign(new Error('bağlantı yok'), { status: 503 }); });
  db.prepare(`DELETE FROM yz_onbellek`).run();
  assert.equal((await sahip(`/api/gazete/${mahalle}`)).veri.kaynak, 'yerel');
});

test('danışman: yalnızca sahibine; Claude önerisi en çok 3; saatlik sınırda kural tabanlı', async () => {
  const baska = await oyuncu('meraklikomsu');
  assert.equal((await baska(`/api/parsel/${parsel}/danisman`, {})).durum, 403);
  let girdi;
  yz.sahteAyarla(async (i) => { girdi = i; return yanit({ oneriler: [1, 2, 3, 4].map((n) => ({ baslik: `Öneri ${n}`, neden: 'çünkü' })) }); });
  const r = (await sahip(`/api/parsel/${parsel}/danisman`, {})).veri;
  assert.equal(r.kaynak, 'claude');
  assert.equal(r.oneriler.length, 3);
  assert.match(girdi.messages[0].content, /<parsel>/);
  for (let i = 0; i < 10; i++) db.prepare(`INSERT INTO yz_kullanim (user_id, islev, kaynak, created_at) VALUES (?, 'danisman', 'claude', ?)`).run(sahip.id, Date.now());
  const sinir = (await sahip(`/api/parsel/${parsel}/danisman`, {})).veri;
  assert.equal(sinir.kaynak, 'yerel');
  assert.match(sinir.not, /sınır/);
});

test('moderasyon ön taraması: şikâyete arka planda yapay zekâ notu eklenir', async () => {
  yz.sahteAyarla(async () => yanit({ karar: 'IHLAL', kategori: 'TACIZ', gerekce: 'Doğrudan hakaret içeriyor.' }));
  const bildiren = await oyuncu('bildiren');
  const r = await bildiren('/api/sikayet', { hedefTur: 'KULLANICI', hedefId: String(sahip.id), sebep: 'TACIZ', aciklama: 'Sohbette bana hakaret etti' });
  assert.equal(r.durum, 200);
  await bekle(30);
  const s = db.prepare(`SELECT on_tarama FROM sikayetler WHERE id = ?`).get(r.veri.id);
  assert.match(s.on_tarama, /🤖 Muhtemel ihlal \(TACIZ\)/);
  yz.sahteAyarla(null);
});

test('kozmetik: satın alma oyundan çıkar, seçim haritaya ve karta yansır; rozetli olan kilitli', async () => {
  const c = await oyuncu('suslu');
  const h = hucreBul('KONUT');
  await c(`/api/parsel/${h}/edin`, {});
  const L = require('../server/lib/ledger');
  db.transaction(() => L.odul(c.id, 300, 'Test hibesi'))();
  const bakiye0 = (await c('/api/ben')).veri.bakiye;
  assert.equal((await c('/api/kozmetik/al', { kod: 'CATI_YESIL' })).durum, 200);
  assert.equal((await c('/api/ben')).veri.bakiye, bakiye0 - KOZMETIK.CATI_YESIL.fiyat);
  assert.equal((await c('/api/kozmetik/al', { kod: 'CATI_YESIL' })).durum, 409);
  assert.equal((await c('/api/kozmetik/sec', { tur: 'cati', kod: 'CATI_ALTIN' })).durum, 403, 'rozetsiz kilitli');
  assert.equal((await c('/api/kozmetik/al', { kod: 'UNVAN_GEZGIN' })).durum, 409, 'rozetle açılır');
  assert.equal((await c('/api/kozmetik/al', { kod: 'UNVAN_TOPRAK' })).durum, 200);
  assert.equal((await c('/api/kozmetik/sec', { tur: 'cati', kod: 'CATI_YESIL' })).durum, 200);
  assert.equal((await c('/api/kozmetik/sec', { tur: 'unvan', kod: 'UNVAN_TOPRAK' })).durum, 200);
  const kart = (await c(`/api/parsel/${h}`)).veri;
  assert.equal(kart.kozmetik, `cati:${KOZMETIK.CATI_YESIL.renk}`);
  assert.equal(kart.sahip.unvan, KOZMETIK.UNVAN_TOPRAK.ad);
  const [lon, lat] = [kart.konum.lon, kart.konum.lat];
  const harita = (await c(`/api/harita/parseller?bbox=${lon - 0.001},${lat - 0.001},${lon + 0.001},${lat + 0.001}`)).veri;
  assert.equal(harita.features.find((f) => f.properties.id === h).properties.kz, `cati:${KOZMETIK.CATI_YESIL.renk}`);
  // Rozet kazanınca altın çatı açılır
  db.prepare(`INSERT INTO rozetler (user_id, kod, ad, ikon, created_at) VALUES (?, 'SEZON_1_42', 'test', '🥇', ?)`).run(c.id, Date.now());
  assert.equal((await c('/api/kozmetik/sec', { tur: 'cati', kod: 'CATI_ALTIN' })).durum, 200);
});

test('zaman yolculuğu: parsel geçmişi kareleri ve ülke edinim noktaları', async () => {
  await sahip(`/api/parsel/${parsel}/ek`, { urun: 'BUGDAY' });
  const kareler = (await sahip(`/api/parsel/${parsel}/zaman`)).veri;
  assert.ok(kareler.length >= 2);
  assert.match(kareler[0].etiket, /edindi/);
  assert.ok(kareler.some((k) => /Buğday ekildi/.test(k.etiket) && k.ek.startsWith('BUGDAY:')));
  const ulke = (await istemci()('/api/zaman/turkiye?gun=7')).veri;
  assert.ok(ulke.length >= 2);
  assert.ok(ulke.every((n, i) => i === 0 || n.t >= ulke[i - 1].t), 'zaman sıralı');
});
