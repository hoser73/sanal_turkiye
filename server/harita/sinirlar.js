// İl / ilçe bulma: 973 ilçe poligonu bellekte, 0,25° kova indeksiyle.
const { geometrideMi } = require('./geo');
const iller = require('../veri/iller.json');
const ilceler = require('../veri/ilceler.json');

const KOVA = 0.25;
const kova = new Map();
const anahtar = (i, j) => `${i}:${j}`;
ilceler.forEach((ilce, idx) => {
  ilce.idx = idx;
  const [w, s, e, n] = ilce.bbox;
  for (let i = Math.floor(w / KOVA); i <= Math.floor(e / KOVA); i++) {
    for (let j = Math.floor(s / KOVA); j <= Math.floor(n / KOVA); j++) {
      const k = anahtar(i, j);
      if (!kova.has(k)) kova.set(k, []);
      kova.get(k).push(ilce);
    }
  }
});
const ilPlakadan = new Map(iller.map((i) => [i.plaka, i]));

// Nokta hangi ilçede? (Türkiye dışı → null). sonAday: aynı karoda art arda sorgular için hızlandırma.
function ilceBul(lon, lat, sonAday = null) {
  if (sonAday && lon >= sonAday.bbox[0] && lon <= sonAday.bbox[2] && lat >= sonAday.bbox[1] && lat <= sonAday.bbox[3]
      && geometrideMi(lon, lat, sonAday.geo)) return sonAday;
  const adaylar = kova.get(anahtar(Math.floor(lon / KOVA), Math.floor(lat / KOVA)));
  if (!adaylar) return null;
  for (const c of adaylar) {
    if (c === sonAday) continue;
    const [w, s, e, n] = c.bbox;
    if (lon >= w && lon <= e && lat >= s && lat <= n && geometrideMi(lon, lat, c.geo)) return c;
  }
  return null;
}

// Bir kutuyla kesişebilecek ilçeler (karo sınıflandırmasında aday listesi)
function kutudakiIlceler([w, s, e, n]) {
  const sonuc = new Set();
  for (let i = Math.floor(w / KOVA); i <= Math.floor(e / KOVA); i++) {
    for (let j = Math.floor(s / KOVA); j <= Math.floor(n / KOVA); j++) {
      for (const c of kova.get(anahtar(i, j)) || []) {
        if (c.bbox[0] <= e && c.bbox[2] >= w && c.bbox[1] <= n && c.bbox[3] >= s) sonuc.add(c);
      }
    }
  }
  return [...sonuc];
}

module.exports = { iller, ilceler, ilPlakadan, ilceBul, kutudakiIlceler };
