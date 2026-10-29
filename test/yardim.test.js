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
// Olay yolu dinleyicileri (TP …) işlem kaydedildikten sonra zaman uyumsuz çalışır: etkisini denetlemeden önce kısa bekle
const olaylariBekle = () => new Promise((r) => setTimeout(r, 50));

const o = [];
test('hazırlık: üç üye bir kooperatifte, biri dışarıda', async () => {
  for (const ad of ['Iste', 'Ver1', 'Ver2', 'Disari']) {
    const c = istemci();
    assert.equal((await c('/api/kayit', { email: `${ad.toLowerCase()}@test.local`, sifre: 'parola123', dogumYili: 1990, kosullarOnay: true, kvkkOnay: true, ad })).durum, 201);
    c.id = (await c('/api/ben')).veri.kullanici.id;
    assert.equal((await c(`/api/parsel/${hucreBul('TARIM')}/edin`, {})).durum, 200);
    o.push(c);
  }
  const ilId = (await db.get('SELECT il_id FROM parcels WHERE owner_user_id = ?', o[0].id)).il_id;
  assert.equal((await o[0]('/api/kooperatif', { ilId, ad: 'Imece Koop' })).durum, 200);
  const id = (await db.get('SELECT id FROM kooperatifler ORDER BY id DESC LIMIT 1')).id;
  for (const x of [o[1], o[2]]) assert.equal((await x(`/api/kooperatif/${id}/katil`, {})).durum, 200);
});

test('istek, gönderim, tamamlanma; sınırlar', async () => {
  const [a, b, c, d] = o;
  assert.equal((await a('/api/yardim', { urun: 'BUGDAY', adet: Y.maksAdet + 1 })).durum, 400);
  assert.equal((await a('/api/yardim', { urun: 'GUBRE', adet: 5 })).durum, 400, 'dükkân ürünü istenmez');
  assert.equal((await d('/api/yardim', { urun: 'BUGDAY', adet: 5 })).durum, 403, 'kooperatifsiz');
  const r = (await a('/api/yardim', { urun: 'BUGDAY', adet: 10 })).veri;
  assert.equal((await a('/api/yardim', { urun: 'DOMATES', adet: 3 })).durum, 409, 'tek açık istek');
  await L.envanterDegis(b.id, 'BUGDAY', 6, 'deneme'); await L.envanterDegis(c.id, 'BUGDAY', 20, 'deneme');
  assert.equal((await b(`/api/yardim/${r.id}/gonder`, { adet: 1 })).veri.kod, 'SEVIYE', 'seviye 1 yan hesap ürün akıtamaz');
  await db.run('UPDATE users SET tp = 130 WHERE id IN (?, ?)', b.id, c.id);   // seviye 3
  const tpOnce = (await db.get('SELECT tp FROM users WHERE id = ?', b.id)).tp;
  assert.equal((await b(`/api/yardim/${r.id}/gonder`, { adet: 8 })).durum, 409, 'elinde yok');
  assert.equal((await b(`/api/yardim/${r.id}/gonder`, { adet: 6 })).durum, 200);
  assert.equal(await L.envanterMiktar(a.id, 'BUGDAY'), 6);
  assert.equal(await L.envanterMiktar(b.id, 'BUGDAY'), 0);
  await olaylariBekle();
  assert.ok((await db.get('SELECT tp FROM users WHERE id = ?', b.id)).tp > tpOnce, 'yardım TP kazandırır');
  assert.equal((await a(`/api/yardim/${r.id}/gonder`, { adet: 1 })).durum, 400, 'kendine gönderemez');
  assert.equal((await d(`/api/yardim/${r.id}/gonder`, { adet: 1 })).durum, 403, 'başka kooperatif');
  const sayac = async () => (await db.get("SELECT COUNT(*) c FROM audit_events WHERE actor_id = ? AND action = 'COOP_HELPED'", c.id)).c;
  assert.equal((await c(`/api/yardim/${r.id}/gonder`, { adet: 1 })).durum, 200);
  assert.equal((await c(`/api/yardim/${r.id}/gonder`, { adet: 1 })).durum, 200);
  assert.equal(await sayac(), 1, 'aynı isteğe parça parça gönderim ödülü katlamaz');
  const son = (await c(`/api/yardim/${r.id}/gonder`, { adet: 20 })).veri;
  assert.equal(son.adet, 2, 'kalan kadar gider'); assert.equal(son.istekTamam, true);
  assert.equal(await sayac(), 1);
  assert.equal(await L.envanterMiktar(a.id, 'BUGDAY'), 10);
  assert.equal((await a('/api/yardim', { urun: 'DOMATES', adet: 3 })).veri.kod, 'BEKLE', 'istekler arası bekleme');
  const durum = (await b('/api/yardim')).veri;
  assert.equal(durum.uye, true);
  assert.equal(durum.istekler.length, 0);
});

test('gazete: genel özet herkese; oyuncuya set fırsatı ve yardım istekleri', async () => {
  const misafir = (await istemci()('/api/gazete')).veri;
  assert.ok('endeks' in misafir && Array.isArray(misafir.ilanlar) && Array.isArray(misafir.tuccar));
  assert.equal(misafir.setler, undefined);
  await db.run('UPDATE yardim_istekleri SET created_at = created_at - ?', Y.beklemeMs + 1);
  await o[0]('/api/yardim', { urun: 'DOMATES', adet: 3 });
  const g = (await o[1]('/api/gazete')).veri;
  assert.ok(Array.isArray(g.setler));
  assert.equal(g.yardim.length, 1);
  assert.equal(g.yardim[0].urun, 'DOMATES');
});
