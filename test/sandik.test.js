// Günlük sandık (sandik.js) ve hafta sonu mini etkinlikleri (mini-etkinlik.js).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { ortamKur, istemciUret } = require('./yardimci');

const VERI = ortamKur('sandik');
const app = require('../server/index');
const db = require('../server/db');
const L = require('../server/lib/ledger');
const sandik = require('../server/sandik');
const mini = require('../server/mini-etkinlik');
const { GUNLUK_SANDIK: S, MINI_ETKINLIK: M } = require('../server/config/rules');

let sunucu, taban;
before(async () => {
  await new Promise((r) => { sunucu = app.listen(0, r); });
  taban = `http://127.0.0.1:${sunucu.address().port}`;
  await app.hazir;
});
after(() => { sunucu.close(); fs.rmSync(VERI, { recursive: true, force: true }); });
const istemci = istemciUret(() => taban);

test('sandık: hazırken açılır, 8 saat bekler; oranlar gösterilir; içerik oranlara göre', async () => {
  const c = istemci();
  assert.equal((await c('/api/kayit', { email: 'sandik@test.local', sifre: 'parola123', dogumYili: 1990, kosullarOnay: true, kvkkOnay: true, ad: 'Sandikci' })).durum, 201);
  const id = (await c('/api/ben')).veri.kullanici.id;
  const d = (await c('/api/sandik')).veri;
  assert.equal(d.hazir, true);
  assert.equal(d.oranlar.reduce((t, x) => t + x.oran, 0).toFixed(2), '1.00');
  const once = L.bakiye(id);
  const r = sandik.ac(id, () => 0.1);   // ilk dilim: akçe
  assert.ok(r.odul.akce >= S.icerik[0].min && r.odul.akce <= S.icerik[0].max);
  assert.equal(Math.round(L.bakiye(id) - once), r.odul.akce);
  assert.equal((await c('/api/sandik/ac', {})).veri.kod, 'BEKLE');
  assert.equal((await c('/api/ben')).veri.sandik.hazir, false);
  db.prepare('UPDATE gunluk_sandik SET son_at = son_at - ? WHERE user_id = ?').run(S.aralikMs, id);
  sandik.ac(id, () => 0.99);   // son dilim: kalıp seti
  assert.equal(L.envanterMiktar(id, 'KALIP_SETI'), 1);
});

test('mini etkinlik: yalnızca cuma–pazar; şablon haftaya göre döner; etkiler', () => {
  delete process.env.MINI_ETKINLIK;
  try {
    const carsamba = Date.UTC(2026, 9, 28, 9), cumartesi = Date.UTC(2026, 9, 31, 9);
    assert.equal(mini.aktif(carsamba), null);
    const a = mini.aktif(cumartesi);
    assert.ok(a && M.sablonlar.some((s) => s.kod === a.kod));
    assert.equal(new Date(a.bitis + 3 * 3600_000).getUTCDay(), 1, 'pazartesi biter');
    assert.equal(mini.sonraki(carsamba).kod, a.kod, 'hafta içinde sıradaki gösterilir');
    const sonrakiHafta = mini.aktif(cumartesi + 7 * 86_400_000);
    assert.notEqual(sonrakiHafta.kod, a.kod);
    const tp = M.sablonlar.find((s) => s.tpKat);
    let t = cumartesi; while (mini.aktif(t).kod !== tp.kod) t += 7 * 86_400_000;
    assert.equal(mini.tpKat(t), tp.tpKat);
    assert.equal(mini.tuccarKat(t), 1);
    assert.equal(mini.balikEk(t), 0);
  } finally { process.env.MINI_ETKINLIK = 'kapali'; }
});
