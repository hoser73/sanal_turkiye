// Kooperatif yardım istekleri (yardim.js) ve pazar gazetesi (gazete.js).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { ortamKur, istemciUret, hucreBul } = require('./yardimci');

const VERI = ortamKur('yardim');
const app = require('../server/index');
const db = require('../server/db');
const L = require('../server/lib/ledger');
const { YARDIM: Y } = require('../server/config/rules');

let sunucu, taban;
before(async () => {
  await new Promise((r) => { sunucu = app.listen(0, r); });
  taban = `http://127.0.0.1:${sunucu.address().port}`;
  await app.hazir;
});
after(() => { sunucu.close(); fs.rmSync(VERI, { recursive: true, force: true }); });
const istemci = istemciUret(() => taban);

const o = [];
test('hazırlık: üç üye bir kooperatifte, biri dışarıda', async () => {
  for (const ad of ['Iste', 'Ver1', 'Ver2', 'Disari']) {
    const c = istemci();
    assert.equal((await c('/api/kayit', { email: `${ad.toLowerCase()}@test.local`, sifre: 'parola123', dogumYili: 1990, kosullarOnay: true, kvkkOnay: true, ad })).durum, 201);
    c.id = (await c('/api/ben')).veri.kullanici.id;
    assert.equal((await c(`/api/parsel/${hucreBul('TARIM')}/edin`, {})).durum, 200);
    o.push(c);
  }
  const ilId = db.prepare('SELECT il_id FROM parcels WHERE owner_user_id = ?').get(o[0].id).il_id;
  assert.equal((await o[0]('/api/kooperatif', { ilId, ad: 'Imece Koop' })).durum, 200);
  const id = db.prepare('SELECT id FROM kooperatifler ORDER BY id DESC LIMIT 1').get().id;
  for (const x of [o[1], o[2]]) assert.equal((await x(`/api/kooperatif/${id}/katil`, {})).durum, 200);
});

test('istek, gönderim, tamamlanma; sınırlar', async () => {
  const [a, b, c, d] = o;
  assert.equal((await a('/api/yardim', { urun: 'BUGDAY', adet: Y.maksAdet + 1 })).durum, 400);
  assert.equal((await a('/api/yardim', { urun: 'GUBRE', adet: 5 })).durum, 400, 'dükkân ürünü istenmez');
  assert.equal((await d('/api/yardim', { urun: 'BUGDAY', adet: 5 })).durum, 403, 'kooperatifsiz');
  const r = (await a('/api/yardim', { urun: 'BUGDAY', adet: 10 })).veri;
  assert.equal((await a('/api/yardim', { urun: 'DOMATES', adet: 3 })).durum, 409, 'tek açık istek');
  L.envanterDegis(b.id, 'BUGDAY', 6, 'deneme'); L.envanterDegis(c.id, 'BUGDAY', 20, 'deneme');
  const tpOnce = db.prepare('SELECT tp FROM users WHERE id = ?').get(b.id).tp;
  assert.equal((await b(`/api/yardim/${r.id}/gonder`, { adet: 8 })).durum, 409, 'elinde yok');
  assert.equal((await b(`/api/yardim/${r.id}/gonder`, { adet: 6 })).durum, 200);
  assert.equal(L.envanterMiktar(a.id, 'BUGDAY'), 6);
  assert.equal(L.envanterMiktar(b.id, 'BUGDAY'), 0);
  assert.ok(db.prepare('SELECT tp FROM users WHERE id = ?').get(b.id).tp > tpOnce, 'yardım TP kazandırır');
  assert.equal((await a(`/api/yardim/${r.id}/gonder`, { adet: 1 })).durum, 400, 'kendine gönderemez');
  assert.equal((await d(`/api/yardim/${r.id}/gonder`, { adet: 1 })).durum, 403, 'başka kooperatif');
  const son = (await c(`/api/yardim/${r.id}/gonder`, { adet: 20 })).veri;
  assert.equal(son.adet, 4, 'kalan kadar gider'); assert.equal(son.istekTamam, true);
  assert.equal(L.envanterMiktar(a.id, 'BUGDAY'), 10);
  assert.equal((await a('/api/yardim', { urun: 'DOMATES', adet: 3 })).veri.kod, 'BEKLE', 'istekler arası bekleme');
  const durum = (await b('/api/yardim')).veri;
  assert.equal(durum.uye, true);
  assert.equal(durum.istekler.length, 0);
});

test('gazete: genel özet herkese; oyuncuya set fırsatı ve yardım istekleri', async () => {
  const misafir = (await istemci()('/api/gazete')).veri;
  assert.ok('endeks' in misafir && Array.isArray(misafir.ilanlar) && Array.isArray(misafir.tuccar));
  assert.equal(misafir.setler, undefined);
  db.prepare('UPDATE yardim_istekleri SET created_at = created_at - ?').run(Y.beklemeMs + 1);
  await o[0]('/api/yardim', { urun: 'DOMATES', adet: 3 });
  const g = (await o[1]('/api/gazete')).veri;
  assert.ok(Array.isArray(g.setler));
  assert.equal(g.yardim.length, 1);
  assert.equal(g.yardim[0].urun, 'DOMATES');
});
