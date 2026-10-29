// Yöre setleri (koleksiyon.js): setin her ilinde parsel → tamam, bir kerelik ödül ve rozet, o illerde hasat bonusu;
// set bozulunca bonus durur, ödül tekrarlanmaz.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { ortamKur, istemciUret, hucreBul } = require('./yardimci');

const VERI = ortamKur('koleksiyon');
const app = require('../server/index');
const db = require('../server/db');
const L = require('../server/lib/ledger');
const kol = require('../server/koleksiyon');
const { KOLEKSIYON: K } = require('../server/config/rules');

let sunucu, taban;
before(async () => {
  await new Promise((r) => { sunucu = app.listen(0, r); });
  taban = `http://127.0.0.1:${sunucu.address().port}`;
  await app.hazir;
});
after(() => { sunucu.close(); fs.rmSync(VERI, { recursive: true, force: true }); });
const istemci = istemciUret(() => taban);

test('set tamamlanınca bir kez ödül ve rozet; o ilde hasat bonusu; bozulunca bonus durur', async () => {
  const c = istemci();
  assert.equal((await c('/api/kayit', { email: 'set@test.local', sifre: 'parola123', dogumYili: 1990, kosullarOnay: true, kvkkOnay: true, ad: 'Setci' })).durum, 201);
  const id = (await c('/api/ben')).veri.kullanici.id;
  const parsel = hucreBul('TARIM');
  assert.equal((await c(`/api/parsel/${parsel}/edin`, {})).durum, 200);
  const p = await db.get('SELECT il_id FROM parcels WHERE id = ?', parsel);
  const plaka = (await db.get('SELECT plaka FROM regions WHERE id = ?', p.il_id)).plaka;
  const [kod, set] = Object.entries(K.setler).find(([, s]) => s.iller.includes(plaka));
  assert.equal(await kol.hasatBonusu(id, p.il_id), 0, 'set eksikken bonus yok');
  let l = (await c('/api/koleksiyon')).veri;
  assert.equal(l.setler.find((s) => s.kod === kod).sahip, 1);

  // Setin diğer illerine birer parsel (doğrudan tabloya: hücre üretimi sahte karoya bağlı)
  const ilId = async (pl) => (await db.get("SELECT id FROM regions WHERE type = 'IL' AND plaka = ?", pl)).id;
  const sablon = await db.get('SELECT * FROM parcels WHERE id = ?', parsel);
  for (const [i, pl] of set.iller.filter((x) => x !== plaka).entries()) {
    const satir = { ...sablon, id: `TR-0000${i}-SET`, il_id: await ilId(pl), grid_x: sablon.grid_x + 1000 + i };
    const k = Object.keys(satir);
    await db.run(`INSERT INTO parcels (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`, ...k.map((x) => satir[x]));
  }
  const once = await L.bakiye(id);
  l = (await c('/api/koleksiyon')).veri;
  const s = l.setler.find((x) => x.kod === kod);
  assert.equal(s.tamam, true);
  assert.equal(l.setler[0].kod, kod, 'tamamlanan set başta');
  assert.equal(Math.round(await L.bakiye(id) - once), K.odul);
  assert.equal(await kol.hasatBonusu(id, p.il_id), K.hasatBonus);
  assert.ok((await c('/api/rozetlerim')).veri.some((r) => r.kod === `SET_${kod}`));
  await c('/api/koleksiyon');
  assert.equal(Math.round(await L.bakiye(id) - once), K.odul, 'ödül bir kez');

  await db.run("DELETE FROM parcels WHERE id = 'TR-00000-SET'");
  assert.equal(await kol.hasatBonusu(id, p.il_id), 0, 'set bozulunca bonus durur');
});
