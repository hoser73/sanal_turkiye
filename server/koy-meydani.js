// Köy meydanı: oyuncunun kendi köy meydanına kurduğu topluluk binaları (çeşme, kahvehane, köy pazarı, okul, sağlık
// ocağı, kütüphane, postane). Her bina bir kez kurulur; oyuncu seviyesiyle açılır, akçe ve çiftlik ürünüyle yapılır,
// inşaat süresi dolunca kalıcı bonusu başlar (oran: ilgili tutara çarpan, ek: adet). Bonuslar oyunun ilgili yerlerinde
// oran(userId, kod) / ek(userId, kod) ile okunur.
const db = require('./db');
const L = require('./lib/ledger');
const { OyunHatasi } = L;
const { KOY_MEYDANI: M, URUNLER } = require('./config/rules');

db.exec(`CREATE TABLE IF NOT EXISTS koy_meydani (
  user_id INTEGER NOT NULL REFERENCES users(id), kod TEXT NOT NULL, bitis INTEGER NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kod)
) WITHOUT ROWID`);
const q = {
  bina: db.prepare('SELECT bitis FROM koy_meydani WHERE user_id = ? AND kod = ?'),
  binalar: db.prepare('SELECT kod, bitis FROM koy_meydani WHERE user_id = ?'),
  ekle: db.prepare('INSERT INTO koy_meydani (user_id, kod, bitis, created_at) VALUES (?, ?, ?, ?)'),
};
const aktif = (userId, kod, t = Date.now()) => { const b = userId && q.bina.get(userId, kod); return !!b && b.bitis <= t; };
const oran = (userId, kod) => (aktif(userId, kod) ? M[kod].oran : 1);
const ek = (userId, kod) => (aktif(userId, kod) ? M[kod].ek || 0 : 0);

function liste(userId, t = Date.now()) {
  const seviye = require('./ciftlik').oyuncuSeviyesi(userId);
  const var_ = new Map(q.binalar.all(userId).map((b) => [b.kod, b.bitis]));
  const binalar = Object.entries(M).map(([kod, b]) => {
    const bitis = var_.get(kod);
    const malzeme = Object.entries(b.malzeme).map(([urun, adet]) => ({ urun, ad: URUNLER[urun]?.ad || urun, ikon: URUNLER[urun]?.ikon || '📦', adet, eldeki: L.envanterMiktar(userId, urun) }));
    const durum = bitis == null ? (seviye < b.seviye ? 'KILITLI' : 'YOK') : bitis > t ? 'INSAATTA' : 'HAZIR';
    const eksik = durum === 'YOK' ? [...(L.bakiye(userId) < b.akce ? [`${b.akce} akçe`] : []), ...malzeme.filter((m) => m.eldeki < m.adet).map((m) => `${m.adet - m.eldeki} ${m.ad}`)] : [];
    return { kod, ad: b.ad, ikon: b.ikon, etki: b.etki, seviye: b.seviye, akce: b.akce, sureMs: b.sureMs, malzeme, durum, bitis: bitis ?? null, kalanMs: bitis ? Math.max(0, bitis - t) : null, eksik };
  });
  const kurulu = binalar.filter((b) => b.durum === 'HAZIR').length;
  return { seviye, binalar, kurulu, toplam: binalar.length, nufus: 12 + kurulu * 18 };
}

const insaEt = db.transaction((userId, kod) => {
  const b = Object.hasOwn(M, kod) ? M[kod] : null;
  if (!b) throw new OyunHatasi(404, 'Bina bulunamadı');
  if (q.bina.get(userId, kod)) throw new OyunHatasi(409, `${b.ad} zaten kurulu`);
  if (require('./ciftlik').oyuncuSeviyesi(userId) < b.seviye) throw new OyunHatasi(403, `${b.ad} seviye ${require('./lib/turkce').sayiBulunma(b.seviye)} açılır`, 'SEVIYE');
  for (const [urun, adet] of Object.entries(b.malzeme)) {
    if (L.envanterMiktar(userId, urun) < adet) throw new OyunHatasi(409, `${adet} ${URUNLER[urun]?.ad || urun} gerekiyor`, 'MALZEME');
  }
  const t = Date.now(), tx = L.yeniTx();
  L.harca(userId, b.akce, `Köy meydanı: ${b.ad}`, tx);
  for (const [urun, adet] of Object.entries(b.malzeme)) L.envanterDegis(userId, urun, -adet, `Köy meydanı: ${b.ad}`, tx);
  q.ekle.run(userId, kod, t + b.sureMs, t);
  L.denetim({ aktor: userId, eylem: 'SQUARE_BUILDING_STARTED', varlik: `MEYDAN:${kod}`, sonra: { akce: b.akce, malzeme: b.malzeme }, herkese: true });
  return { tamam: true, ad: b.ad, bitis: t + b.sureMs };
});

function rotalar(app, { h, auth }) {
  app.get('/api/meydan', auth.girisGerekli, h((req) => liste(req.kullanici.id)));
  app.post('/api/meydan/insa', auth.dogrulanmisGerekli, h((req) => insaEt(req.kullanici.id, String(req.body?.kod || ''))));
}

module.exports = { rotalar, liste, insaEt, aktif, oran, ek };
