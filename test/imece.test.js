// İmece (imece.js): yalnızca komşu çağrılır, kabulle başlar, iki ortağın işleri ortak puana yazar, kademe ödülü katkısı
// yeten ortağa bir kez, ortak bırakılabilir, haftalık ortaklık sınırı.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { ortamKur, istemciUret } = require('./yardimci');

const VERI = ortamKur('imece');
const app = require('../server/index');
const db = require('../server/db');
const L = require('../server/lib/ledger');
const imece = require('../server/imece');
const { IMECE: I } = require('../server/config/rules');

let sunucu, taban;
before(async () => {
  await new Promise((r) => { sunucu = app.listen(0, r); });
  taban = `http://127.0.0.1:${sunucu.address().port}`;
  await app.hazir;
});
after(() => { sunucu.close(); fs.rmSync(VERI, { recursive: true, force: true }); });
const istemci = istemciUret(() => taban);
const komsuYap = (a, b) => db.run("INSERT INTO arkadasliklar (isteyen, hedef, durum, at, kabul_at) VALUES (?, ?, 'KABUL', ?, ?)", a, b, Date.now(), Date.now());
// Olay yolu dinleyicileri işlem kaydedildikten sonra zaman uyumsuz çalışır: etkisini denetlemeden önce kısa bekle
const olaylariBekle = () => new Promise((r) => setTimeout(r, 50));

const o = [];
test('davet, kabul, ortak puan, kademe ödülü, bırakma, haftalık sınır', async () => {
  for (const ad of ['Imececi', 'Ortak', 'Yabanci', 'Ucuncu', 'Dorduncu']) {
    const c = istemci();
    assert.equal((await c('/api/kayit', { email: `${ad.toLowerCase()}@test.local`, sifre: 'parola123', dogumYili: 1990, kosullarOnay: true, kvkkOnay: true, ad })).durum, 201);
    c.id = (await c('/api/ben')).veri.kullanici.id;
    o.push(c);
  }
  const [a, b, yabanci, c3, c4] = o;
  await komsuYap(a.id, b.id); await komsuYap(a.id, c3.id); await komsuYap(a.id, c4.id);
  assert.equal((await a('/api/imece/davet', { kullaniciId: yabanci.id })).durum, 403, 'komşu değil');
  const d = (await a('/api/imece/davet', { kullaniciId: b.id })).veri;
  assert.equal((await a('/api/imece/davet', { kullaniciId: c3.id })).durum, 409, 'bekleyen davet');
  assert.equal((await b('/api/imece')).veri.gelen.length, 1);
  assert.equal((await b(`/api/imece/${d.id}/kabul`, {})).durum, 200);

  // a çok çalışır, b az: ilk kademe geçilir; yalnızca a ödül alır, b katkısı yetişince alır
  const once = [await L.bakiye(a.id), await L.bakiye(b.id)];
  for (let i = 0; i < 12; i++) await imece.puanVer(a.id, 'DAILY_QUESTS_REWARDED');   // 12 × 15 = 180
  assert.equal(Math.round(await L.bakiye(a.id) - once[0]), I.kademeler[0].akce);
  assert.equal(await L.bakiye(b.id), once[1], 'katkısı yetmeyen ortak henüz almaz');
  await L.denetim({ aktor: b.id, eylem: 'ORDER_DELIVERED', varlik: 'deneme' });   // olay yolu: 12
  await olaylariBekle();
  for (let i = 0; i < 2; i++) await imece.puanVer(b.id, 'DAILY_QUESTS_REWARDED');  // +30 → 42
  assert.equal(Math.round(await L.bakiye(b.id) - once[1]), I.kademeler[0].akce, 'katkısı yetişince geçilmiş kademeyi alır');
  let m = (await a('/api/imece')).veri;
  assert.equal(m.aktif.toplam, 180 + 42);
  assert.equal(m.aktif.kademeler[0].alindi, true);
  for (let i = 0; i < I.gunlukTavan + 5; i++) await imece.puanVer(a.id, 'CROP_HARVESTED');
  assert.equal((await a('/api/imece')).veri.aktif.katkim, 180 + I.gunlukTavan * I.puanlar.CROP_HARVESTED, 'günlük tavan');

  // Bırak, yeniden kur; haftalık sınır
  assert.equal((await b('/api/imece/birak', {})).durum, 200);
  assert.equal((await a('/api/imece')).veri.aktif, null);
  const d2 = (await a('/api/imece/davet', { kullaniciId: c3.id })).veri;
  assert.equal((await c3(`/api/imece/${d2.id}/kabul`, {})).durum, 200);
  assert.equal((await a('/api/imece/birak', {})).durum, 200);
  assert.equal((await a('/api/imece/davet', { kullaniciId: c4.id })).veri.kod, 'HAFTALIK');
  assert.equal(Math.round(await L.bakiye(a.id) - once[0]), I.kademeler[0].akce, 'ödül bir kez');
});
