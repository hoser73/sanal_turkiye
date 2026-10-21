// Ulusal parsel ızgarası (istemci): Web Mercator z20 hücreleri. server/harita/izgara.js ile senkron tutulmalı.
export const Z = 20;
export const N = 2 ** Z;
export const KARO_Z = 14;

export const lonX = (lon) => ((lon + 180) / 360) * N;
export const latY = (lat) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * N;
};
export const xLon = (x) => (x / N) * 360 - 180;
export const yLat = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / N))) * 180) / Math.PI;

export const hucre = (lon, lat) => ({ x: Math.floor(lonX(lon)), y: Math.floor(latY(lat)) });
export const parselId = (x, y) => `TR-${String(x).padStart(7, '0')}-${String(y).padStart(7, '0')}`;
export function idCoz(id) {
  const m = /^TR-(\d{7})-(\d{7})$/.exec(id || '');
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}
export const sinirlar = (x, y) => ({ w: xLon(x), e: xLon(x + 1), n: yLat(y), s: yLat(y + 1) });
export const merkez = (x, y) => [xLon(x + 0.5), yLat(y + 0.5)];

export function poligon(x, y) {
  const { w, e, n, s } = sinirlar(x, y);
  return { type: 'Polygon', coordinates: [[[w, n], [e, n], [e, s], [w, s], [w, n]]] };
}

// Hücre içi yerel koordinat (u: batı→doğu, v: kuzey→güney, 0..1) → [lon, lat]
export function yerel(x, y, u, v) {
  return [xLon(x + u), yLat(y + v)];
}
