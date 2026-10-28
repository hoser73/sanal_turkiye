// Günlük sandık: her GUNLUK_SANDIK.aralikMs'de (8 saat) bir ücretsiz sandık; oyuncuya günde birkaç kez dönmek için bir
// sebep. İçerik rastgeledir (akçe, gübre, yem, nadiren kalıp seti); oranlar arayüzde açıkça gösterilir. Parayla satılmaz.
const db = require('./db');
const L = require('./lib/ledger');
const { OyunHatasi } = L;
const { GUNLUK_SANDIK: S, URUNLER } = require('./config/rules');

db.exec('CREATE TABLE IF NOT EXISTS gunluk_sandik (user_id INTEGER PRIMARY KEY REFERENCES users(id), son_at INTEGER NOT NULL)');
const sonAcilis = (userId) => db.prepare('SELECT son_at FROM gunluk_sandik WHERE user_id = ?').get(userId)?.son_at || 0;

function ozet(userId, t = Date.now()) {
  const kalan = Math.max(0, sonAcilis(userId) + S.aralikMs - t);
  return { hazir: kalan === 0, kalanMs: kalan };
}
const oranlar = () => S.icerik.map((x) => ({ oran: x.oran, metin: x.tur === 'akce' ? `${x.min}–${x.max} akçe` : `${x.adet} ${URUNLER[x.kod].ad}`,
  ikon: x.tur === 'akce' ? '₳' : URUNLER[x.kod].ikon }));

const ac = db.transaction((userId, rastgele = Math.random) => {
  const t = Date.now();
  if (!ozet(userId, t).hazir) throw new OyunHatasi(409, 'Sandık henüz dolmadı', 'BEKLE');
  db.prepare(`INSERT INTO gunluk_sandik (user_id, son_at) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET son_at = excluded.son_at`).run(userId, t);
  let z = rastgele(), secilen = S.icerik.at(-1);
  for (const x of S.icerik) { if (z < x.oran) { secilen = x; break; } z -= x.oran; }
  const tx = L.yeniTx();
  let odul;
  if (secilen.tur === 'akce') {
    const tutar = secilen.min + Math.floor(rastgele() * (secilen.max - secilen.min + 1));
    L.odul(userId, tutar, 'Günlük sandık', tx);
    odul = { ikon: '₳', metin: `${tutar} akçe`, akce: tutar };
  } else {
    L.envanterDegis(userId, secilen.kod, secilen.adet, 'Günlük sandık', tx);
    odul = { ikon: URUNLER[secilen.kod].ikon, metin: `${secilen.adet} ${URUNLER[secilen.kod].ad}` };
  }
  L.denetim({ aktor: userId, eylem: 'CHEST_OPENED', varlik: 'SANDIK', sonra: odul });
  return { tamam: true, odul, sonraki: t + S.aralikMs };
});

function rotalar(app, { h, auth }) {
  app.get('/api/sandik', auth.girisGerekli, h((req) => ({ ...ozet(req.kullanici.id), oranlar: oranlar() })));
  app.post('/api/sandik/ac', auth.girisGerekli, h((req) => ac(req.kullanici.id)));
}

module.exports = { rotalar, ozet, ac, oranlar };
