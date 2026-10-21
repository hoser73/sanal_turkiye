// Geometri yardımcıları: nokta-poligon testi, sınır kutusu, sadeleştirme (Douglas–Peucker).
// Koordinatlar [lon, lat]. Poligonlar GeoJSON Polygon / MultiPolygon koordinat dizileridir.

function halkadaMi(x, y, halka) {
  let ic = false;
  for (let i = 0, j = halka.length - 1; i < halka.length; j = i++) {
    const [xi, yi] = halka[i], [xj, yj] = halka[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ic = !ic;
  }
  return ic;
}

// Delikli poligon: dış halkanın içinde ve hiçbir deliğin içinde değil
function poligondaMi(x, y, poligon) {
  if (!halkadaMi(x, y, poligon[0])) return false;
  for (let i = 1; i < poligon.length; i++) if (halkadaMi(x, y, poligon[i])) return false;
  return true;
}

function geometrideMi(x, y, geo) {
  if (geo.type === 'Polygon') return poligondaMi(x, y, geo.coordinates);
  if (geo.type === 'MultiPolygon') return geo.coordinates.some((p) => poligondaMi(x, y, p));
  return false;
}

function sinirKutusu(geo) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const poligonlar = geo.type === 'Polygon' ? [geo.coordinates] : geo.coordinates;
  for (const p of poligonlar) for (const [x, y] of p[0]) {
    if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y;
  }
  return [w, s, e, n];
}

// Douglas–Peucker; kapalı halkaları en az 4 noktada tutar
function sadelestirHalka(halka, tolerans) {
  if (halka.length <= 8) return halka;
  const t2 = tolerans * tolerans;
  const tut = new Uint8Array(halka.length);
  tut[0] = tut[halka.length - 1] = 1;
  const yigin = [[0, halka.length - 1]];
  while (yigin.length) {
    const [a, b] = yigin.pop();
    const [ax, ay] = halka[a], [bx, by] = halka[b];
    const dx = bx - ax, dy = by - ay, uz = dx * dx + dy * dy;
    let enUzak = -1, enMesafe = 0;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = halka[i];
      let t = uz ? ((px - ax) * dx + (py - ay) * dy) / uz : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - px, ey = ay + t * dy - py;
      const m = ex * ex + ey * ey;
      if (m > enMesafe) { enMesafe = m; enUzak = i; }
    }
    if (enMesafe > t2) { tut[enUzak] = 1; yigin.push([a, enUzak], [enUzak, b]); }
  }
  const sonuc = halka.filter((_, i) => tut[i]);
  return sonuc.length >= 4 ? sonuc : halka;
}

const yuvarla = (n, b = 5) => Math.round(n * 10 ** b) / 10 ** b;

function sadelestir(geo, tolerans, basamak = 5, minAlanKutusu = 0) {
  const poligon = (p) => p.map((h) => sadelestirHalka(h, tolerans).map(([x, y]) => [yuvarla(x, basamak), yuvarla(y, basamak)]));
  const kucukMu = (p) => {
    if (!minAlanKutusu) return false;
    const xs = p[0].map((c) => c[0]), ys = p[0].map((c) => c[1]);
    return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)) < minAlanKutusu;
  };
  if (geo.type === 'Polygon') return { type: 'Polygon', coordinates: poligon(geo.coordinates) };
  const parcalar = geo.coordinates.filter((p) => !kucukMu(p)).map(poligon);
  return { type: 'MultiPolygon', coordinates: parcalar.length ? parcalar : geo.coordinates.map(poligon) };
}

// Poligonun içinde kalan bir etiket noktası: kutu merkezi içerdeyse o, değilse yatay tarama ile en geniş aralığın ortası
function icNokta(geo) {
  const [w, s, e, n] = sinirKutusu(geo);
  const cx = (w + e) / 2, cy = (s + n) / 2;
  if (geometrideMi(cx, cy, geo)) return [cx, cy];
  let enIyi = null, enGenis = 0;
  for (let k = 1; k < 20; k++) {
    const y = s + ((n - s) * k) / 20;
    const kesisimler = [];
    const poligonlar = geo.type === 'Polygon' ? [geo.coordinates] : geo.coordinates;
    for (const p of poligonlar) for (const h of p) for (let i = 0, j = h.length - 1; i < h.length; j = i++) {
      const [xi, yi] = h[i], [xj, yj] = h[j];
      if ((yi > y) !== (yj > y)) kesisimler.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
    }
    kesisimler.sort((a, b) => a - b);
    for (let i = 0; i + 1 < kesisimler.length; i += 2) {
      const g = kesisimler[i + 1] - kesisimler[i];
      if (g > enGenis) { enGenis = g; enIyi = [(kesisimler[i] + kesisimler[i + 1]) / 2, y]; }
    }
  }
  return enIyi || [cx, cy];
}

module.exports = { halkadaMi, poligondaMi, geometrideMi, sinirKutusu, sadelestir, icNokta, yuvarla };
