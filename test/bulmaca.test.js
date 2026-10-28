// Motif bulmacası (bulmaca.js): bölüm tanımı, en kısa süre ve hamle denetimi, ilerleme, ödül ve günlük ödül sınırı.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { ortamKur, istemciUret } = require('./yardimci');

const VERI = ortamKur('bulmaca');
const app = require('../server/index');
const db = require('../server/db');
const L = require('../server/lib/ledger');
const bulmaca = require('../server/bulmaca');
const { BULMACA: B } = require('../server/config/rules');

let sunucu, taban;
before(async () => {
  await new Promise((r) => { sunucu = app.listen(0, r); });
  taban = `http://127.0.0.1:${sunucu.address().port}`;
  await app.hazir;
});
after(() => { sunucu.close(); fs.rmSync(VERI, { recursive: true, force: true }); });
const istemci = istemciUret(() => taban);
// Oyunu geçmişte başlamış say (en kısa süre testte beklenmesin)
const eskit = (oyunId, ms = 10 * 60_000) => db.prepare('UPDATE bulmaca_oyun SET basla_at = basla_at - ? WHERE id = ?').run(ms, oyunId);

test('bölüm tanımı her seferinde aynı; zorluk bölümle artar', () => {
  assert.deepEqual(bulmaca.bolum(7), bulmaca.bolum(7));
  const b1 = bulmaca.bolum(1), b20 = bulmaca.bolum(20);
  assert.equal(b1.turler.length, 4);
  assert.equal(b20.turler.length, 6);
  assert.equal(b1.ot.length, 0);
  assert.ok(b20.ot.length > 0 && b20.hedefler.some((h) => h.tur === 'OT'));
  for (let n = 1; n <= 60; n++) {
    const b = bulmaca.bolum(n);
    assert.ok(b.hedefler.length >= 1, `bölüm ${n} hedefsiz`);
    assert.ok(b.hamle >= 14 && b.hamle <= 32);
    for (const [s, c] of b.ot) assert.ok(s >= 0 && s < b.satir && c >= 0 && c < b.sutun);
  }
  assert.equal(bulmaca.yildizHesapla(5, 20), 3);
  assert.equal(bulmaca.yildizHesapla(19, 20), 1);
});

test('kazanınca ilerler ve ödül alır; hızlı ya da fazla hamleli bitiş reddedilir; kaybetmenin cezası yok', async () => {
  const A = istemci();
  assert.equal((await A('/api/kayit', { email: 'bulmaca@test.local', sifre: 'parola123', dogumYili: 1990, kosullarOnay: true, kvkkOnay: true, ad: 'Bulmacaci' })).durum, 201);
  const id = (await A('/api/ben')).veri.kullanici.id;
  let d = (await A('/api/bulmaca')).veri;
  assert.equal(d.seviye, 1);
  assert.equal(d.gunluk.kalan, B.gunlukOdul);

  let o = (await A('/api/bulmaca/basla', {})).veri;
  assert.equal(o.bolum.seviye, 1);
  assert.deepEqual(o.enKisa, { tabanMs: B.minSureMs, hamleMs: B.hamleMs }, 'istemci HIZLI yanıtında ne kadar bekleyeceğini bilir');
  assert.equal((await A('/api/bulmaca/bitir', { oyunId: o.oyunId, kazandi: true, hamle: 5 })).durum, 409, 'çok hızlı');
  eskit(o.oyunId);
  assert.equal((await A('/api/bulmaca/bitir', { oyunId: o.oyunId, kazandi: true, hamle: o.bolum.hamle + 1 })).durum, 400, 'hamle sınırı');
  assert.equal((await A('/api/bulmaca/bitir', { oyunId: o.oyunId, kazandi: true, hamle: 1 })).veri.kod, 'AZ_HAMLE', '18 hedef taş tek hamlede toplanmaz');
  const once = L.bakiye(id);
  const r = await A('/api/bulmaca/bitir', { oyunId: o.oyunId, kazandi: true, hamle: 4 });
  assert.equal(r.durum, 200, JSON.stringify(r.veri));
  assert.equal(r.veri.yildiz, 3);
  assert.equal(r.veri.sonraki, 2);
  assert.equal(Math.round(L.bakiye(id) - once), B.odul(1).akce + 2 * B.yildizAkce);
  assert.equal((await A('/api/bulmaca/bitir', { oyunId: o.oyunId, kazandi: true, hamle: 4 })).durum, 409, 'ikinci kez bitmez');

  // Kaybetmek: ilerleme yok, ödül yok
  o = (await A('/api/bulmaca/basla', {})).veri;
  const once2 = L.bakiye(id);
  eskit(o.oyunId);
  assert.equal((await A('/api/bulmaca/bitir', { oyunId: o.oyunId, kazandi: 'false', hamle: 5 })).veri.kazandi, false, 'yalnızca true kazanç sayılır');
  assert.equal(L.bakiye(id), once2);
  assert.equal((await A('/api/bulmaca')).veri.seviye, 2);

  // Yeni oyun başlatınca yarım kalan bırakılır
  const y1 = (await A('/api/bulmaca/basla', {})).veri, y2 = (await A('/api/bulmaca/basla', {})).veri;
  eskit(y1.oyunId);
  assert.equal((await A('/api/bulmaca/bitir', { oyunId: y1.oyunId, kazandi: true, hamle: 5 })).durum, 409);
  eskit(y2.oyunId);
  assert.equal((await A('/api/bulmaca/bitir', { oyunId: y2.oyunId, kazandi: true, hamle: 5 })).durum, 200);

  // Sezon yolu puanı (olay yolu)
  assert.equal(require('../server/mevsim-yolu').ozet(id).puan >= 2 * require('../server/config/rules').MEVSIM_YOLU.puanlar.PUZZLE_WON, true);
});

test('günlük ödül sınırından sonra bölümler ilerler ama ödül vermez', async () => {
  const A = istemci();
  assert.equal((await A('/api/kayit', { email: 'bulmaca2@test.local', sifre: 'parola123', dogumYili: 1990, kosullarOnay: true, kvkkOnay: true, ad: 'Bulmacaci2' })).durum, 201);
  const id = (await A('/api/ben')).veri.kullanici.id;
  let son;
  for (let i = 0; i <= B.gunlukOdul; i++) {
    const o = (await A('/api/bulmaca/basla', {})).veri;
    eskit(o.oyunId);
    const once = L.bakiye(id);
    son = (await A('/api/bulmaca/bitir', { oyunId: o.oyunId, kazandi: true, hamle: o.bolum.hamle })).veri;
    if (i < B.gunlukOdul) assert.ok(son.odul && L.bakiye(id) > once, `bölüm ${i + 1} ödül vermeli`);
  }
  assert.equal(son.odul, null);
  assert.equal(son.gunlukDoldu, true);
  assert.equal(son.sonraki, B.gunlukOdul + 2);
  assert.equal(L.envanterMiktar(id, 'GUBRE'), 2, '5. bölümde gübre');
});
