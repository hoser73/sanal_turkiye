// Köy meydanı (koy-meydani.js): seviye kilidi, malzeme ve akçe, inşaat süresi, bir kez kurulum, bonusların oyuna etkisi.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { ortamKur, istemciUret, hucreBul } = require('./yardimci');

const VERI = ortamKur('koy-meydani');
const app = require('../server/index');
const db = require('../server/db');
const L = require('../server/lib/ledger');
const meydan = require('../server/koy-meydani');
const { KOY_MEYDANI: M, SEVIYE } = require('../server/config/rules');

let sunucu, taban;
before(async () => {
  await new Promise((r) => { sunucu = app.listen(0, r); });
  taban = `http://127.0.0.1:${sunucu.address().port}`;
  await app.hazir;
});
after(() => { sunucu.close(); fs.rmSync(VERI, { recursive: true, force: true }); });
const istemci = istemciUret(() => taban);
const seviyeTp = (n) => require('../server/ciftlik').seviyeEsigi(n);

let A, id, parsel;
test('kilit, malzeme ve akçe; inşaat bitince bonus; ikinci kez kurulmaz', async () => {
  A = istemci();
  assert.equal((await A('/api/kayit', { email: 'meydan@test.local', sifre: 'parola123', dogumYili: 1990, kosullarOnay: true, kvkkOnay: true, ad: 'Meydanci' })).durum, 201);
  id = (await A('/api/ben')).veri.kullanici.id;
  let l = (await A('/api/meydan')).veri;
  assert.equal(l.binalar.find((b) => b.kod === 'CESME').durum, 'KILITLI');
  assert.equal((await A('/api/meydan/insa', { kod: 'CESME' })).durum, 403, 'seviye yetmez');

  db.prepare('UPDATE users SET tp = ? WHERE id = ?').run(seviyeTp(3), id);
  assert.equal((await A('/api/meydan/insa', { kod: 'CESME' })).durum, 409, 'malzeme yok');
  L.envanterDegis(id, 'BUGDAY', M.CESME.malzeme.BUGDAY, 'deneme');
  const once = L.bakiye(id);
  const r = await A('/api/meydan/insa', { kod: 'CESME' });
  assert.equal(r.durum, 200, JSON.stringify(r.veri));
  assert.equal(Math.round(once - L.bakiye(id)), M.CESME.akce);
  assert.equal(L.envanterMiktar(id, 'BUGDAY'), 0);
  assert.equal(meydan.oran(id, 'CESME'), 1, 'inşaat bitmeden bonus yok');
  assert.equal((await A('/api/meydan/insa', { kod: 'CESME' })).durum, 409, 'bir kez kurulur');
  db.prepare('UPDATE koy_meydani SET bitis = ? WHERE user_id = ?').run(Date.now() - 1, id);
  l = (await A('/api/meydan')).veri;
  assert.equal(l.binalar.find((b) => b.kod === 'CESME').durum, 'HAZIR');
  assert.equal(l.kurulu, 1);
  assert.equal(meydan.oran(id, 'CESME'), M.CESME.oran);
  assert.equal((await A('/api/meydan/insa', { kod: '__proto__' })).durum, 404);
});

test('bonus: çeşme sulamayı ucuzlatır, kahvehane sipariş ödülünü artırır', async () => {
  parsel = hucreBul('TARIM');
  assert.equal((await A(`/api/parsel/${parsel}/edin`, {})).durum, 200);
  assert.equal((await A(`/api/parsel/${parsel}/ek`, { urun: 'BUGDAY' })).durum, 200);
  const k = (await A(`/api/parsel/${parsel}`)).veri;
  const s = await A(`/api/parsel/${parsel}/sula`, {});
  assert.equal(s.durum, 200, JSON.stringify(s.veri));
  assert.equal(s.veri.maliyet, k.ekin.sulamaMaliyeti, 'kart ve işlem aynı (indirimli) bedeli gösterir');
  const kayit = db.prepare(`SELECT debit FROM wallet_ledger WHERE user_id = ? AND reason LIKE 'Sulama/enerji%' ORDER BY id DESC LIMIT 1`).get(id);
  assert.equal(kayit.debit, s.veri.maliyet);
  // Çeşmesiz bir oyuncunun aynı tarladaki bedeliyle karşılaştır: oran kadar ucuz
  db.prepare('DELETE FROM koy_meydani WHERE user_id = ?').run(id);
  const tam = (await A(`/api/parsel/${parsel}`)).veri.ekin.sulamaMaliyeti;
  assert.ok(Math.abs(s.veri.maliyet - tam * M.CESME.oran) < 0.02, `${s.veri.maliyet} ≈ ${tam} × ${M.CESME.oran}`);

  db.prepare('INSERT INTO koy_meydani (user_id, kod, bitis, created_at) VALUES (?, ?, ?, ?)').run(id, 'KAHVEHANE', Date.now() - 1, Date.now());
  const sip = db.prepare(`INSERT INTO siparisler (user_id, musteri, kalemler, odul, tp, olusturma, son) VALUES (?, 'Deneme', '{}', 100, 5, ?, ?)`).run(id, Date.now(), Date.now() + 3600_000).lastInsertRowid;
  const t = await A(`/api/siparis/${sip}/teslim`, {});
  assert.equal(t.durum, 200, JSON.stringify(t.veri));
  assert.equal(t.veri.odul, Math.round(100 * M.KAHVEHANE.oran));
});
