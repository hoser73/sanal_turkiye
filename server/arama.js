// İl / ilçe / mahalle-köy arama ve konumdan il-ilçe bulma (plan §12.1: "İl/ilçe/mahalle filtresi, arama").
// Mahalle ve köyler, imar karoları işlendikçe dolan gazetteer'dan (yerler) gelir.
const db = require('./db');
const { iller, ilceler, ilceBul } = require('./harita/sinirlar');
const { normalize } = require('./harita/imar');

// Bölge kimlikleri seed'den sonra oluştuğu için ilk kullanımda okunur
let _il = null, _ilce = null;
const ilIdleri = { get: (plaka) => (_il ||= new Map(db.prepare(`SELECT plaka, id FROM regions WHERE type = 'IL'`).all().map((r) => [r.plaka, r.id]))).get(plaka) };
const ilceIdleri = { get: (idx) => (_ilce ||= new Map(db.prepare(`SELECT source_idx, id FROM regions WHERE type = 'ILCE'`).all().map((r) => [r.source_idx, r.id]))).get(idx) };
const ilDizini = iller.map((i) => ({ ...i, norm: normalize(i.ad) }));
const ilceDizini = ilceler.map((c) => ({ ...c, norm: normalize(c.ad) }));
const SINIF_AD = { city: 'şehir', town: 'ilçe merkezi', suburb: 'mahalle', quarter: 'mahalle', neighbourhood: 'mahalle', village: 'köy', hamlet: 'mezra', isolated_dwelling: 'yerleşim' };

function puan(norm, sorgu) {
  if (norm === sorgu) return 0;
  if (norm.startsWith(sorgu)) return 1;
  if (norm.split(' ').some((p) => p.startsWith(sorgu))) return 2;
  return norm.includes(sorgu) ? 3 : 9;
}

function ara(metin) {
  const sorgu = normalize(String(metin || '').slice(0, 60));
  if (sorgu.length < 2) return [];
  const sonuc = [];
  for (const i of ilDizini) {
    const p = puan(i.norm, sorgu);
    if (p < 9) sonuc.push({ tur: 'il', p, ad: i.ad, ust: `${i.plaka} · il`, merkez: i.merkez, bbox: i.bbox, ilId: ilIdleri.get(i.plaka) });
  }
  for (const c of ilceDizini) {
    const p = puan(c.norm, sorgu);
    if (p < 9) sonuc.push({ tur: 'ilce', p: p + 0.5, ad: c.ad, ust: `${c.il} · ilçe`, merkez: c.merkez, bbox: c.bbox, ilId: ilIdleri.get(c.plaka) });
  }
  const yerler = db.prepare(`SELECT ad, sinif, lon, lat, ilce_idx FROM yerler WHERE ad_norm LIKE ? ORDER BY length(ad_norm) LIMIT 40`).all(`%${sorgu}%`);
  for (const y of yerler) {
    const c = ilceler[y.ilce_idx];
    sonuc.push({ tur: 'yer', p: puan(normalize(y.ad), sorgu) + 1, ad: y.ad, ust: `${c.ad}, ${c.il} · ${SINIF_AD[y.sinif] || y.sinif}`, merkez: [y.lon, y.lat] });
  }
  return sonuc.sort((a, b) => a.p - b.p || a.ad.length - b.ad.length).slice(0, 12).map(({ p, ...r }) => r);
}

function konum(lon, lat) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const c = ilceBul(lon, lat);
  if (!c) return null;
  return { il: c.il, ilce: c.ad, plaka: c.plaka, ilId: ilIdleri.get(c.plaka), ilceId: ilceIdleri.get(c.idx) };
}

module.exports = { ara, konum };
