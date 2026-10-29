// Köy meydanı: oyuncunun kendi köy meydanına kurduğu topluluk binaları (çeşme, kahvehane, köy pazarı, okul, sağlık
// ocağı, kütüphane, postane). Her bina bir kez kurulur; oyuncu seviyesiyle açılır, akçe ve çiftlik ürünüyle yapılır,
// inşaat süresi dolunca kalıcı bonusu başlar (oran: ilgili tutara çarpan, ek: adet). Bonuslar oyunun ilgili yerlerinde
// oran(userId, kod) / ek(userId, kod) ile okunur.
const db = require('./db');
const { metin } = require('./lib/girdi');
const L = require('./lib/ledger');
const { OyunHatasi } = L;
const { KOY_MEYDANI: M, URUNLER } = require('./config/rules');

const q = {
  bina: db.sorgu('SELECT bitis FROM koy_meydani WHERE user_id = ? AND kod = ?'),
  binalar: db.sorgu('SELECT kod, bitis FROM koy_meydani WHERE user_id = ?'),
  ekle: db.sorgu('INSERT OR IGNORE INTO koy_meydani (user_id, kod, bitis, created_at) VALUES (?, ?, ?, ?)'),
};
const aktif = async (userId, kod, t = Date.now()) => { const b = userId && await q.bina.get(userId, kod); return !!b && b.bitis <= t; };
const oran = async (userId, kod) => (await aktif(userId, kod) ? M[kod].oran : 1);
const ek = async (userId, kod) => (await aktif(userId, kod) ? M[kod].ek || 0 : 0);

async function liste(userId, t = Date.now()) {
  const seviye = await require('./ciftlik').oyuncuSeviyesi(userId);
  const var_ = new Map((await q.binalar.all(userId)).map((b) => [b.kod, b.bitis]));
  // Bakiye ve stoklar önce toplanır (senkron eşlemede bekleme yapılmaz)
  const bakiye = await L.bakiye(userId);
  const stok = {};
  for (const i of await L.envanter(userId)) stok[i.item_id] = i.miktar;
  const binalar = Object.entries(M).map(([kod, b]) => {
    const bitis = var_.get(kod);
    const malzeme = Object.entries(b.malzeme).map(([urun, adet]) => ({ urun, ad: URUNLER[urun]?.ad || urun, ikon: URUNLER[urun]?.ikon || '📦', adet, eldeki: stok[urun] || 0 }));
    const durum = bitis == null ? (seviye < b.seviye ? 'KILITLI' : 'YOK') : bitis > t ? 'INSAATTA' : 'HAZIR';
    const eksik = durum === 'YOK' ? [...(bakiye < b.akce ? [`${b.akce} akçe`] : []), ...malzeme.filter((m) => m.eldeki < m.adet).map((m) => `${m.adet - m.eldeki} ${m.ad}`)] : [];
    return { kod, ad: b.ad, ikon: b.ikon, etki: b.etki, seviye: b.seviye, akce: b.akce, sureMs: b.sureMs, malzeme, durum, bitis: bitis ?? null, kalanMs: bitis ? Math.max(0, bitis - t) : null, eksik };
  });
  const kurulu = binalar.filter((b) => b.durum === 'HAZIR').length;
  return { seviye, binalar, kurulu, toplam: binalar.length, nufus: 12 + kurulu * 18 };
}

const insaEt = (userId, kod) => db.tx(async () => {
  const b = Object.hasOwn(M, kod) ? M[kod] : null;
  if (!b) throw new OyunHatasi(404, 'Bina bulunamadı');
  if (await q.bina.get(userId, kod)) throw new OyunHatasi(409, `${b.ad} zaten kurulu`);
  if (await require('./ciftlik').oyuncuSeviyesi(userId) < b.seviye) throw new OyunHatasi(403, `${b.ad} seviye ${require('./lib/turkce').sayiBulunma(b.seviye)} açılır`, 'SEVIYE');
  for (const [urun, adet] of Object.entries(b.malzeme)) {
    if (await L.envanterMiktar(userId, urun) < adet) throw new OyunHatasi(409, `${adet} ${URUNLER[urun]?.ad || urun} gerekiyor`, 'MALZEME');
  }
  const t = Date.now(), tx = L.yeniTx();
  // Birincil anahtar (oyuncu, bina): eşzamanlı ikinci istek satır yazamaz ve ödeme yapmaz
  if ((await q.ekle.run(userId, kod, t + b.sureMs, t)).changes !== 1) throw new OyunHatasi(409, `${b.ad} zaten kurulu`);
  await L.harca(userId, b.akce, `Köy meydanı: ${b.ad}`, tx);
  for (const [urun, adet] of Object.entries(b.malzeme)) await L.envanterDegis(userId, urun, -adet, `Köy meydanı: ${b.ad}`, tx);
  await L.denetim({ aktor: userId, eylem: 'SQUARE_BUILDING_STARTED', varlik: `MEYDAN:${kod}`, sonra: { akce: b.akce, malzeme: b.malzeme }, herkese: true });
  return { tamam: true, ad: b.ad, bitis: t + b.sureMs };
});

function rotalar(app, { h, auth }) {
  app.get('/api/meydan', auth.girisGerekli, h((req) => liste(req.kullanici.id)));
  app.post('/api/meydan/insa', auth.dogrulanmisGerekli, h((req) => insaEt(req.kullanici.id, metin(req.body?.kod))));
}

module.exports = { rotalar, liste, insaEt, aktif, oran, ek };
