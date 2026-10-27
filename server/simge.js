// Simge parseller ve koleksiyon albümü (§7.6): miras alanını içeren hücre edinilemez; oyuncu haritada simgeye gidip kartını toplar.
// Bir bölgenin tüm kartları ya da albümün tamamı rozet kazandırır. Günlük toplama sınırı kartların hızla "toplanmasını" yavaşlatır.
const db = require('./db');
const L = require('./lib/ledger');
const I = require('./harita/izgara');
const SIMGELER = require('./veri/simgeler');
const { OyunHatasi } = L;

const ODUL = 10, GUNLUK = 6;
const hucreli = SIMGELER.map((s) => { const c = I.hucre(...s.konum); return { ...s, parsel: I.parselId(c.x, c.y) }; });
const parseldenSimge = new Map(hucreli.map((s) => [s.parsel, s]));
const koddanSimge = new Map(hucreli.map((s) => [s.kod, s]));
const BOLGELER = [...new Set(SIMGELER.map((s) => s.bolge))];

const toplandiMi = (userId, kod) => !!userId && !!db.prepare(`SELECT 1 FROM koleksiyon WHERE user_id = ? AND simge = ?`).get(userId, kod);
function parselSimgesi(parcelId, userId = null) {
  const s = parseldenSimge.get(parcelId);
  return s ? { kod: s.kod, ad: s.ad, ikon: s.ikon, not: s.not, bolge: s.bolge, toplandi: toplandiMi(userId, s.kod) } : null;
}

const topla = db.transaction((userId, kod) => {
  const s = koddanSimge.get(String(kod));
  if (!s) throw new OyunHatasi(404, 'Simge bulunamadı');
  if (toplandiMi(userId, s.kod)) throw new OyunHatasi(409, 'Bu kart zaten albümünde');
  const bugun = db.prepare(`SELECT COUNT(*) c FROM koleksiyon WHERE user_id = ? AND created_at > ?`).get(userId, Date.now() - 24 * 3600e3).c;
  if (bugun >= GUNLUK) throw new OyunHatasi(429, `Günde en fazla ${GUNLUK} kart toplanabilir; yolculuğa yarın devam et`);
  db.prepare(`INSERT INTO koleksiyon (user_id, simge, created_at) VALUES (?, ?, ?)`).run(userId, s.kod, Date.now());
  const tx = L.yeniTx();
  L.odul(userId, ODUL, `Simge kartı: ${s.ad}`, tx);
  const p = db.prepare(`SELECT region_id FROM parcels WHERE id = ?`).get(s.parsel);
  L.denetim({ aktor: userId, eylem: 'LANDMARK_COLLECTED', varlik: s.parsel, sonra: { simge: s.ad }, bolge: p?.region_id ?? null, herkese: !!p });
  // Bölge seti ve tam albüm rozetleri
  const dunya = require('./dunya');
  const benim = new Set(db.prepare(`SELECT simge FROM koleksiyon WHERE user_id = ?`).all(userId).map((r) => r.simge));
  const rozetler = [];
  const bolgeTamam = SIMGELER.filter((x) => x.bolge === s.bolge).every((x) => benim.has(x.kod));
  if (bolgeTamam && dunya.rozetVer(userId, `ALBUM_${s.bolge}`, `${s.bolge} gezgini`, '🧭', `${s.bolge} bölgesindeki tüm simgeleri topladı.`)) rozetler.push(`${s.bolge} gezgini`);
  if (benim.size === SIMGELER.length && dunya.rozetVer(userId, 'ALBUM_TAM', 'Türkiye albümü', '📔', 'Bütün simge kartlarını topladı.')) rozetler.push('Türkiye albümü');
  return { tamam: true, simge: s.ad, odul: ODUL, rozetler, toplanan: benim.size, toplam: SIMGELER.length };
});

function album(userId) {
  const benim = new Map(userId ? db.prepare(`SELECT simge, created_at FROM koleksiyon WHERE user_id = ?`).all(userId).map((r) => [r.simge, r.created_at]) : []);
  return {
    toplam: SIMGELER.length, toplanan: benim.size, odul: ODUL, gunluk: GUNLUK,
    bolgeler: BOLGELER.map((b) => {
      const s = hucreli.filter((x) => x.bolge === b);
      return { ad: b, toplam: s.length, toplanan: s.filter((x) => benim.has(x.kod)).length,
        simgeler: s.map((x) => ({ kod: x.kod, ad: x.ad, ikon: x.ikon, not: x.not, plaka: x.plaka, konum: x.konum, parsel: x.parsel, toplandi: benim.get(x.kod) || null })) };
    }),
  };
}
const geojson = () => ({ type: 'FeatureCollection', features: hucreli.map((s) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: s.konum },
  properties: { kod: s.kod, ad: s.ad, ikon: s.ikon, parsel: s.parsel } })) });

function rotalar(app, { h, auth }) {
  app.get('/api/simgeler', h(require('./lib/onbellek').ortakYanit(30_000, () => geojson())));
  app.get('/api/album', h((req) => album(req.kullanici?.id ?? null)));
  app.post('/api/simge/:kod/topla', auth.girisGerekli, h((req) => topla(req.kullanici.id, req.params.kod)));
}

module.exports = { rotalar, parselSimgesi, topla, album, SIMGELER: hucreli };
