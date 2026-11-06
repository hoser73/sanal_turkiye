// Yaşayan nüfus: demo sakinlerin yerleşmesi, oyun kurallarıyla eylemleri, sohbet yanıtı ve taşınma.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { ortamKur } = require('./yardimci');

const VERI = ortamKur('nufus');
const app = require('../server/index');
const db = require('../server/db');
const I = require('../server/harita/izgara');
const nufus = require('../server/nufus');
const { NUFUS } = require('../server/config/rules');
const { sahteImar, KOD_AD } = require('../server/harita/imar');

let sunucu, taban;
before(async () => {
  await new Promise((r) => { sunucu = app.listen(0, r); });
  taban = `http://127.0.0.1:${sunucu.address().port}`;
  await app.hazir;
});
after(() => { sunucu.close(); fs.rmSync(VERI, { recursive: true, force: true }); });

function istemci() {
  let cerez = '';
  return async (yol, govde) => {
    const r = await fetch(taban + yol, { method: govde ? 'POST' : 'GET', headers: { 'content-type': 'application/json', cookie: cerez }, body: govde ? JSON.stringify(govde) : undefined });
    const sc = r.headers.get('set-cookie');
    if (sc) cerez = sc.split(';')[0];
    return { durum: r.status, veri: await r.json().catch(() => null) };
  };
}
async function oyuncu(ad, hucre) {
  const c = istemci();
  assert.equal((await c('/api/kayit', { email: `${ad}@test.local`, sifre: 'parola123', dogumYili: 1990, kosullarOnay: true, kvkkOnay: true, ad })).durum, 201);
  db.prepare(`UPDATE users SET created_at = datetime('now', '-40 days') WHERE email = ?`).run(`${ad}@test.local`);
  if (hucre) assert.equal((await c(`/api/parsel/${hucre}/edin`, {})).durum, 200);
  c.id = (await c('/api/ben')).veri.kullanici.id;
  return c;
}
function mahalleHucreleri([lon, lat], imar = 'TARIM') {
  const c = I.hucre(lon, lat);
  const kx = c.x >> 6, ky = c.y >> 6;
  const liste = [];
  for (let dy = -14; dy <= 14; dy++) for (let dx = -14; dx <= 14; dx++) {
    const x = kx * 64 + 32 + dx, y = ky * 64 + 32 + dy;
    if (KOD_AD[sahteImar(x, y)] === imar) liste.push(I.parselId(x, y));
  }
  return liste;
}
const demolar = (mahalleId) => db.prepare(`SELECT * FROM users WHERE is_npc = 1 AND npc_mahalle = ? AND npc_durum = 'AKTIF'`).all(mahalleId);

const MERKEZ = [33.05, 38.25];
let ilk, mahalle, hucreler;

test('tek gerçek oyuncunun mahallesine kişilikli demo sakinler yerleşir; aynı kurallarla parsel edinirler', async () => {
  hucreler = mahalleHucreleri(MERKEZ);
  ilk = await oyuncu('yalniz', hucreler[0]);
  mahalle = db.prepare(`SELECT region_id FROM parcels WHERE id = ?`).get(hucreler[0]).region_id;
  const r = await nufus.nufusDongusu({ yerlestirmeSiniri: 3 });
  assert.equal(r.yerlesen, 3);
  const d = demolar(mahalle);
  assert.equal(d.length, NUFUS.mahalleHedef - 1, 'gerçek + demo = hedef');
  for (const n of d) {
    assert.ok(nufus.KISILIKLER[n.npc_kisilik]);
    const p = db.prepare(`SELECT * FROM parcels WHERE owner_user_id = ?`).all(n.id);
    assert.equal(p.length, 1);
    assert.equal(p[0].region_id, mahalle, 'aynı mahallede');
    assert.ok(db.prepare(`SELECT 1 FROM wallet_ledger WHERE user_id = ? AND reason LIKE 'Birincil tahsis%'`).get(n.id), 'parseli bedelini ödeyerek edindi');
  }
  // İkinci döngü hedefi aşmaz
  assert.equal((await nufus.nufusDongusu({ yerlestirmeSiniri: 3 })).yerlesen, 0);
  const kart = (await ilk(`/api/parsel/${db.prepare(`SELECT id FROM parcels WHERE owner_user_id = ?`).get(d[0].id).id}`)).veri;
  assert.equal(kart.sahip.demoSakin, true);
  assert.equal((await ilk(`/api/mahalle/${mahalle}/nufus`)).veri.length, 3);
});

test('demo sakin eylemi: tarımcı ekim yapar, bakiye kuralları geçerlidir', async () => {
  const d = demolar(mahalle);
  let ekildi = false;
  for (const n of d) {
    const tarla = db.prepare(`SELECT id FROM parcels WHERE owner_user_id = ? AND zoning_type = 'TARIM'`).get(n.id);
    const yapilanlar = nufus.eylem(n);
    assert.ok(Array.isArray(yapilanlar));
    if (tarla && db.prepare(`SELECT 1 FROM crops WHERE parcel_id = ? AND status = 'GROWING'`).get(tarla.id)) ekildi = true;
    assert.ok(db.prepare(`SELECT npc_sonraki FROM users WHERE id = ?`).get(n.id).npc_sonraki > Date.now());
    assert.ok(require('../server/lib/ledger').bakiye(n.id) >= 0);
  }
  assert.ok(ekildi, 'en az bir demo sakin tarlasına ekin ekti');
  // Olgun ekin hasat edilir
  const n = d.find((x) => db.prepare(`SELECT 1 FROM crops c JOIN parcels p ON p.id = c.parcel_id WHERE p.owner_user_id = ? AND c.status = 'GROWING'`).get(x.id));
  db.prepare(`UPDATE crops SET ready_at = ?, waterings = 5 WHERE user_id = ? AND status = 'GROWING'`).run(Date.now() - 1, n.id);
  assert.ok(nufus.eylem(n).includes('hasat'));
});

test('yeni gerçek oyuncular mahalleye katılır; eşiğin altında demo sakinler kalır', async () => {
  for (const [i, ad] of ['ikinci', 'ucuncu'].entries()) await oyuncu(ad, hucreler[i + 10]);
  const m = nufus.aktifMahalleler().find((x) => x.id === mahalle);
  assert.equal(m.gercek, 3);
  assert.ok(m.gercek < NUFUS.cekilmeEsigi && demolar(mahalle).length > 0);
});

test('sohbet: gerçek oyuncunun mahalle mesajına demo sakin yanıt verir (etiketli)', async () => {
  NUFUS.sohbetYanitMs = [0, 5];
  assert.equal((await ilk(`/api/sohbet/mahalle:${mahalle}`, { metin: 'Merhaba komşular!' })).durum, 200);
  await nufus.sohbetYanitla(`mahalle:${mahalle}`, { userId: ilk.id, metin: 'Merhaba komşular!' }).catch(() => {});
  // Olay yolu üzerinden de tetiklenmiş olabilir; en az bir demo yanıtı beklenir
  await new Promise((r) => setTimeout(r, 50));
  const mesajlar = (await ilk(`/api/sohbet/mahalle:${mahalle}`)).veri.mesajlar;
  const demo = mesajlar.find((m) => m.demo);
  assert.ok(demo, 'demo sakin yanıtladı');
  assert.ok(demo.metin.length > 3);
  assert.match(nufus.kalipYanit('selam', mahalle), /selam|Merhaba|hoş geldin|Selam/i);
});

test('mahallede gerçek oyuncu çoğalınca demo sakinler ilan açıp taşınır; satılmayan parsel devlete döner', async () => {
  await oyuncu('dorduncu', hucreler[14]);
  nufus.tasinma();
  const tasinan = db.prepare(`SELECT * FROM users WHERE is_npc = 1 AND npc_mahalle = ? AND npc_durum = 'TASINIYOR'`).all(mahalle);
  assert.equal(tasinan.length, 3);
  for (const n of tasinan) assert.ok(db.prepare(`SELECT 1 FROM listings WHERE seller_id = ? AND status = 'ACTIVE'`).get(n.id), 'parselini ilana koydu');
  db.prepare(`UPDATE users SET npc_sonraki = ? WHERE npc_durum = 'TASINIYOR'`).run(Date.now() - 1);
  nufus.tasinma();
  for (const n of tasinan) {
    assert.equal(db.prepare(`SELECT npc_durum FROM users WHERE id = ?`).get(n.id).npc_durum, 'TASINDI');
    assert.equal(db.prepare(`SELECT COUNT(*) c FROM parcels WHERE owner_user_id = ?`).get(n.id).c, 0);
  }
  assert.equal((await nufus.nufusDongusu()).yerlesen, 0, 'yeterli gerçek oyuncu olan mahalleye yeni demo sakin gelmez');
});
