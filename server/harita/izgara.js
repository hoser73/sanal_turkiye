// Ulusal parsel ızgarası: Web Mercator z20 hücreleri (Türkiye enlemlerinde ≈ 28–32 m kenar).
// Türkiye ≈ 870 milyon olası hücre içerir; bir parsel yalnızca dokunulduğunda veritabanına yazılır.
// Parsel kimliği hücre koordinatından türetilir ve hiç değişmez: TR-<x 7 hane>-<y 7 hane>.
// İmar karoları z14'tür: her karo 64 × 64 = 4.096 hücre.
// Not: public/js/izgara.js aynı hesapları istemcide yapar — ikisi senkron tutulmalı.

const Z = 20;
const KARO_Z = 14;
const KARO_KENAR = 1 << (Z - KARO_Z);   // 64
const N = 2 ** Z;
const DUNYA_CEVRE = 40075016.686;       // m (ekvator)

const lonX = (lon) => ((lon + 180) / 360) * N;
const latY = (lat) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * N;
};
const xLon = (x) => (x / N) * 360 - 180;
const yLat = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / N))) * 180) / Math.PI;

function hucre(lon, lat) {
  return { x: Math.floor(lonX(lon)), y: Math.floor(latY(lat)) };
}

function hucreSinirlari(x, y) {
  return { w: xLon(x), e: xLon(x + 1), n: yLat(y), s: yLat(y + 1) };
}

function hucreMerkezi(x, y) {
  return [xLon(x + 0.5), yLat(y + 0.5)];
}

function hucrePoligonu(x, y, basamak = 7) {
  const { w, e, n, s } = hucreSinirlari(x, y);
  const r = (v) => Math.round(v * 10 ** basamak) / 10 ** basamak;
  return { type: 'Polygon', coordinates: [[[r(w), r(n)], [r(e), r(n)], [r(e), r(s)], [r(w), r(s)], [r(w), r(n)]]] };
}

// Gerçek yüzölçümü (m²): Mercator ölçek faktörü cos(enlem)
function hucreAlani(x, y) {
  const [, lat] = hucreMerkezi(x, y);
  const kenar = (DUNYA_CEVRE * Math.cos((lat * Math.PI) / 180)) / N;
  return Math.round(kenar * kenar);
}

const ID_RE = /^TR-(\d{7})-(\d{7})$/;
const parselId = (x, y) => `TR-${String(x).padStart(7, '0')}-${String(y).padStart(7, '0')}`;
function idCoz(id) {
  const m = typeof id === 'string' && ID_RE.exec(id);
  if (!m) return null;
  const x = Number(m[1]), y = Number(m[2]);
  if (x >= N || y >= N) return null;
  return { x, y };
}

const karoOf = (x, y) => ({ kx: x >> (Z - KARO_Z), ky: y >> (Z - KARO_Z), i: (y & (KARO_KENAR - 1)) * KARO_KENAR + (x & (KARO_KENAR - 1)) });

// Bir sınır kutusunu kapsayan hücre aralığı (tümüyle Mercator'da)
function kutuHucreleri([w, s, e, n]) {
  return { x0: Math.floor(lonX(w)), x1: Math.floor(lonX(e)), y0: Math.floor(latY(n)), y1: Math.floor(latY(s)) };
}

module.exports = {
  Z, KARO_Z, KARO_KENAR, N, lonX, latY, xLon, yLat,
  hucre, hucreSinirlari, hucreMerkezi, hucrePoligonu, hucreAlani, parselId, idCoz, karoOf, kutuHucreleri,
};
