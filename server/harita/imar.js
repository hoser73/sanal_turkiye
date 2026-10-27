// Gerçek arazi kullanımından oyun imarı (plan §2.2 "karma" yaklaşım: gerçek yerler + kontrollü ekonomi).
// Her z14 karosu (64 × 64 hücre) OpenMapTiles katmanlarından sınıflandırılır:
//   landcover / landuse / building / park / water / transportation / poi / place
// Sonuç (hücre başına imar kodu + ilçe) veritabanında önbelleklenir. Bir parsel edinildiğinde imarı parsel
// kaydına yazılır ve sonradan OSM değişse bile değişmez.
const db = require('../db');
const I = require('./izgara');
const { ilceler, ilceBul, kutudakiIlceler } = require('./sinirlar');
const { vektorKaro, SAHTE, veriSurumu } = require('./karolar');
const { pngKodla } = require('./png');

const IMAR_SURUM = 3;   // sınıflandırma algoritması değişince artır (önbellek yenilenir)
const K = { DIS: 0, KONUT: 1, TICARET: 2, TARIM: 3, SANAYI: 4, TURIZM: 5, KARMA: 6, KORUMA: 7, PARK: 8, SU: 9, YOL: 10 };
const KOD_AD = Object.fromEntries(Object.entries(K).map(([k, v]) => [v, k]));
const ILCE_YOK = 0xffff;
const KENAR = I.KARO_KENAR;           // 64
const EXTENT = 4096;
const HUCRE = EXTENT / KENAR;         // 64 karo birimi

// ---------- Sınıf eşlemeleri ----------
const LANDUSE = {
  residential: K.KONUT, suburb: K.KONUT, quarter: K.KONUT, neighbourhood: K.KONUT,
  commercial: K.TICARET, retail: K.TICARET,
  industrial: K.SANAYI, garages: K.SANAYI, railway: K.SANAYI, bus_station: K.SANAYI, quarry: K.SANAYI,
  school: K.PARK, university: K.PARK, college: K.PARK, kindergarten: K.PARK, library: K.PARK, hospital: K.PARK,
  cemetery: K.PARK, military: K.PARK, stadium: K.PARK, pitch: K.PARK, playground: K.PARK, track: K.PARK,
  theme_park: K.TURIZM, zoo: K.TURIZM,
};
const LANDCOVER = { farmland: K.TARIM, grass: K.TARIM, wood: K.KORUMA, wetland: K.KORUMA, sand: K.KORUMA, rock: K.KORUMA, ice: K.KORUMA };
const YOL_YARI_GENISLIK_M = { motorway: 18, trunk: 15, primary: 13, secondary: 11, tertiary: 9, rail: 8 };
const TICARI_POI = new Set(['shop', 'grocery', 'restaurant', 'cafe', 'fast_food', 'bar', 'bank', 'clothing_store', 'bakery', 'butcher', 'pharmacy', 'fuel', 'car', 'hardware', 'furniture', 'mobile_phone', 'jewelry', 'florist']);
const YERLESIM_YARICAP_M = { city: 2500, town: 1400, suburb: 700, quarter: 450, neighbourhood: 450, village: 280, hamlet: 160 };
const MAHALLE_AGIRLIK = { neighbourhood: 0.8, quarter: 0.85, suburb: 1, village: 1, hamlet: 1.25, isolated_dwelling: 1.6, town: 1.7, city: 2.2 };

// ---------- Tarama çizgisi ile poligon doldurma (karo koordinatlarında) ----------
function poligonBoya(halkalar, kod, grid, kosul) {
  let minY = Infinity, maxY = -Infinity;
  for (const h of halkalar) for (const p of h) { if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
  const j0 = Math.max(0, Math.ceil((minY - HUCRE / 2) / HUCRE));
  const j1 = Math.min(KENAR - 1, Math.floor((maxY - HUCRE / 2) / HUCRE));
  const kes = [];
  for (let j = j0; j <= j1; j++) {
    const cy = j * HUCRE + HUCRE / 2;
    kes.length = 0;
    for (const h of halkalar) {
      for (let a = 0, b = h.length - 1; a < h.length; b = a++) {
        const p = h[a], q = h[b];
        if ((p.y > cy) !== (q.y > cy)) kes.push(p.x + ((cy - p.y) * (q.x - p.x)) / (q.y - p.y));
      }
    }
    kes.sort((m, n) => m - n);
    for (let t = 0; t + 1 < kes.length; t += 2) {
      const i0 = Math.max(0, Math.ceil((kes[t] - HUCRE / 2) / HUCRE));
      const i1 = Math.min(KENAR - 1, Math.floor((kes[t + 1] - HUCRE / 2) / HUCRE));
      for (let i = i0; i <= i1; i++) {
        const idx = j * KENAR + i;
        if (!kosul || kosul(grid[idx])) grid[idx] = kod;
      }
    }
  }
}

// Çizgiye yakın hücre merkezlerini işaretle (ana yollar, demiryolu)
function cizgiBoya(cizgiler, yariGenislik, kod, grid, kosul) {
  for (const c of cizgiler) {
    for (let s = 1; s < c.length; s++) {
      const a = c[s - 1], b = c[s];
      const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - yariGenislik) / HUCRE));
      const i1 = Math.min(KENAR - 1, Math.floor((Math.max(a.x, b.x) + yariGenislik) / HUCRE));
      const j0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - yariGenislik) / HUCRE));
      const j1 = Math.min(KENAR - 1, Math.floor((Math.max(a.y, b.y) + yariGenislik) / HUCRE));
      const dx = b.x - a.x, dy = b.y - a.y, uz = dx * dx + dy * dy || 1;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const cx = i * HUCRE + HUCRE / 2, cy = j * HUCRE + HUCRE / 2;
          const t = Math.max(0, Math.min(1, ((cx - a.x) * dx + (cy - a.y) * dy) / uz));
          const ex = a.x + t * dx - cx, ey = a.y + t * dy - cy;
          if (ex * ex + ey * ey <= yariGenislik * yariGenislik) {
            const idx = j * KENAR + i;
            if (!kosul || kosul(grid[idx])) grid[idx] = kod;
          }
        }
      }
    }
  }
}

function katmanGez(karo, ad, fn) {
  const l = karo?.layers[ad];
  if (!l) return;
  for (let i = 0; i < l.length; i++) {
    const f = l.feature(i);
    fn(f, f.properties);
  }
}

// ---------- Yerleşim noktaları (mahalle adları + gazetteer) ----------
function karoNoktasiLonLat(z, kx, ky, p) {
  const n = 2 ** z;
  const lon = ((kx + p.x / EXTENT) / n) * 360 - 180;
  const yy = (ky + p.y / EXTENT) / n;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * yy))) * 180) / Math.PI;
  return [lon, lat];
}

function yerleriTopla(karo, z, kx, ky, hedef) {
  katmanGez(karo, 'place', (f, p) => {
    const sinif = p.class;
    if (!(sinif in MAHALLE_AGIRLIK)) return;
    const ad = p['name:tr'] || p['name:latin'] || p.name;
    if (!ad) return;
    const nokta = f.loadGeometry()[0]?.[0];
    if (!nokta) return;
    const [lon, lat] = karoNoktasiLonLat(z, kx, ky, nokta);
    const id = f.id != null ? String(f.id) : `${sinif}:${ad}:${lon.toFixed(4)}:${lat.toFixed(4)}`;
    hedef.set(id, { id, ad, sinif, lon, lat });
  });
}

// ---------- Sahte kaynak (testler / çevrimdışı) ----------
const SAHTE_DIZI = [K.KONUT, K.KONUT, K.TARIM, K.TARIM, K.TARIM, K.TICARET, K.SANAYI, K.TURIZM, K.KARMA, K.KORUMA, K.PARK, K.TARIM];
function sahteImar(x, y) {
  if (x % 32 === 0 || y % 32 === 0) return K.YOL;
  const h = (((x >> 3) * 73856093) ^ ((y >> 3) * 19349663)) >>> 0;
  return SAHTE_DIZI[h % SAHTE_DIZI.length];
}
const SAHTE_ADLAR = ['Yenimahalle', 'Cumhuriyet', 'Fatih', 'Hürriyet', 'Gazi', 'Kocatepe', 'Bahçelievler', 'Esentepe', 'Yıldız', 'Çamlık', 'Pınarbaşı', 'Kavaklı'];

// ---------- Karo sınıflandırma ----------
const bellek = new Map();   // LRU: "kx:ky" → { kod, ilce }
const BELLEK_MAKS = 3000;
const q = {
  oku: db.prepare(`SELECT kod, ilce FROM imar_karolari WHERE kx = ? AND ky = ? AND surum = ?`),
  yaz: db.prepare(`INSERT OR REPLACE INTO imar_karolari (kx, ky, surum, kod, ilce, kaynak, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`),
  yerYaz: db.prepare(`INSERT OR IGNORE INTO yerler (id, ad, ad_norm, sinif, lon, lat, ilce_idx) VALUES (?, ?, ?, ?, ?, ?, ?)`),
};
const ucusta = new Map();

function bellegeKoy(anahtar, deger) {
  bellek.delete(anahtar);
  bellek.set(anahtar, deger);
  if (bellek.size > BELLEK_MAKS) bellek.delete(bellek.keys().next().value);
}

async function karoSiniflandir(kx, ky) {
  const anahtar = `${kx}:${ky}`;
  if (bellek.has(anahtar)) { const v = bellek.get(anahtar); bellegeKoy(anahtar, v); return v; }
  const satir = q.oku.get(kx, ky, IMAR_SURUM);
  if (satir) {
    const v = { kod: new Uint8Array(satir.kod), ilce: new Uint16Array(new Uint8Array(satir.ilce).buffer) };
    bellegeKoy(anahtar, v);
    return v;
  }
  if (ucusta.has(anahtar)) return ucusta.get(anahtar);
  const is = hesapla(kx, ky).then((v) => { bellegeKoy(anahtar, v); return v; }).finally(() => ucusta.delete(anahtar));
  ucusta.set(anahtar, is);
  return is;
}

async function hesapla(kx, ky) {
  const kod = new Uint8Array(KENAR * KENAR);
  const ilce = new Uint16Array(KENAR * KENAR).fill(ILCE_YOK);
  const x0 = kx * KENAR, y0 = ky * KENAR;
  const kutu = [I.xLon(x0), I.yLat(y0 + KENAR), I.xLon(x0 + KENAR), I.yLat(y0)];

  // 1) Türkiye içinde mi, hangi ilçe? (aday yoksa ağ isteği bile yapılmaz: deniz / yurt dışı)
  const adaylar = kutudakiIlceler(kutu);
  let icerde = 0;
  if (adaylar.length) {
    let son = null;
    for (let j = 0; j < KENAR; j++) {
      for (let i = 0; i < KENAR; i++) {
        const [lon, lat] = I.hucreMerkezi(x0 + i, y0 + j);
        const c = ilceBul(lon, lat, son);
        if (c) { son = c; ilce[j * KENAR + i] = c.idx; icerde++; }
      }
    }
  }
  const yerler = new Map();

  if (icerde) {
    if (SAHTE) {
      for (let j = 0; j < KENAR; j++) for (let i = 0; i < KENAR; i++) {
        const idx = j * KENAR + i;
        if (ilce[idx] !== ILCE_YOK) kod[idx] = sahteImar(x0 + i, y0 + j);
      }
      const [lon, lat] = I.hucreMerkezi(x0 + 32, y0 + 32);
      yerler.set(`sahte:${kx}:${ky}`, { id: `sahte:${kx}:${ky}`, ad: SAHTE_ADLAR[(kx * 7 + ky * 13) % SAHTE_ADLAR.length], sinif: 'suburb', lon, lat });
    } else {
      await gercekSiniflandir(kx, ky, kod, yerler);
      for (let idx = 0; idx < kod.length; idx++) if (ilce[idx] === ILCE_YOK) kod[idx] = K.DIS;
    }
  }

  // Gazetteer: yerleşim noktalarını ilçeleriyle kaydet (arama + mahalle ataması)
  db.transaction(() => {
    for (const y of yerler.values()) {
      const c = ilceBul(y.lon, y.lat);
      if (c) q.yerYaz.run(y.id, y.ad, normalize(y.ad), y.sinif, y.lon, y.lat, c.idx);
    }
    q.yaz.run(kx, ky, IMAR_SURUM, Buffer.from(kod), Buffer.from(ilce.buffer), veriSurumu());
  })();
  return { kod, ilce };
}

async function gercekSiniflandir(kx, ky, grid, yerler) {
  // Yerleşim noktaları için üst karo (z12, ≈ 10 km) de okunur: kenar hücreleri komşu mahalleleri görebilsin
  const [karo, ust] = await Promise.all([vektorKaro(14, kx, ky), vektorKaro(12, kx >> 2, ky >> 2)]);
  yerleriTopla(karo, 14, kx, ky, yerler);
  yerleriTopla(ust, 12, kx >> 2, ky >> 2, yerler);

  // Karo birimi başına metre (z14, karo merkezi enlemi)
  const lat = I.yLat((ky + 0.5) * KENAR);
  const birimM = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / 2 ** 14 / EXTENT;

  // 0) Taban: yerleşim yarıçapındaysa konut, değilse tarım (Anadolu'nun büyük kısmı haritalanmamış kırsaldır)
  grid.fill(K.TARIM);
  const yakindakiler = [...yerler.values()].filter((y) => YERLESIM_YARICAP_M[y.sinif]);
  if (yakindakiler.length) {
    const noktalar = yakindakiler.map((y) => {
      const x = (I.lonX(y.lon) - kx * KENAR) * HUCRE, yy = (I.latY(y.lat) - ky * KENAR) * HUCRE;
      return { x, y: yy, r2: (YERLESIM_YARICAP_M[y.sinif] / birimM) ** 2 };
    });
    for (let j = 0; j < KENAR; j++) for (let i = 0; i < KENAR; i++) {
      const cx = i * HUCRE + HUCRE / 2, cy = j * HUCRE + HUCRE / 2;
      if (noktalar.some((p) => (p.x - cx) ** 2 + (p.y - cy) ** 2 <= p.r2)) grid[j * KENAR + i] = K.KONUT;
    }
  }
  if (!karo) return;

  // 1) Arazi örtüsü
  katmanGez(karo, 'landcover', (f, p) => {
    let k = LANDCOVER[p.class];
    if (p.class === 'grass' && p.subclass === 'park') k = K.PARK;
    if (k != null && f.type === 3) poligonBoya(f.loadGeometry(), k, grid);
  });
  // 2) Arazi kullanımı
  katmanGez(karo, 'landuse', (f, p) => {
    const k = LANDUSE[p.class];
    if (k != null && f.type === 3) poligonBoya(f.loadGeometry(), k, grid);
  });
  // 3) Binalar: kırsalda / ormanda bina → yerleşim
  katmanGez(karo, 'building', (f) => {
    if (f.type === 3) poligonBoya(f.loadGeometry(), K.KONUT, grid, (m) => m === K.TARIM || m === K.KORUMA);
  });
  // 4) Korunan alanlar (milli park, tabiat koruma)
  katmanGez(karo, 'park', (f, p) => {
    if (f.type !== 3) return;
    poligonBoya(f.loadGeometry(), p.class === 'park' ? K.PARK : K.KORUMA, grid);
  });
  katmanGez(karo, 'aeroway', (f) => { if (f.type === 3) poligonBoya(f.loadGeometry(), K.PARK, grid); });
  // 5) Noktasal işletmeler: konaklama → turizm, dükkân → karma / ticaret
  katmanGez(karo, 'poi', (f, p) => {
    const n = f.loadGeometry()[0]?.[0];
    if (!n) return;
    const i = Math.floor(n.x / HUCRE), j = Math.floor(n.y / HUCRE);
    if (i < 0 || j < 0 || i >= KENAR || j >= KENAR) return;
    const idx = j * KENAR + i;
    if (p.class === 'lodging' && grid[idx] !== K.PARK) grid[idx] = K.TURIZM;
    else if (TICARI_POI.has(p.class)) {
      if (grid[idx] === K.KONUT) grid[idx] = K.KARMA;
      else if (grid[idx] === K.TARIM) grid[idx] = K.TICARET;
    }
  });
  // 6) Su
  katmanGez(karo, 'water', (f, p) => {
    if (f.type === 3 && p.class !== 'swimming_pool') poligonBoya(f.loadGeometry(), K.SU, grid);
  });
  // 7) Ana yollar ve demiryolu
  katmanGez(karo, 'transportation', (f, p) => {
    if (f.type !== 2 || p.brunnel === 'tunnel') return;
    const m = YOL_YARI_GENISLIK_M[p.class];
    if (m) cizgiBoya(f.loadGeometry(), m / birimM, K.YOL, grid, (g) => g !== K.SU);
  });
}

// ---------- Hücre sorguları ----------
async function hucreImari(x, y) {
  const { kx, ky, i } = I.karoOf(x, y);
  const s = await karoSiniflandir(kx, ky);
  const ilceIdx = s.ilce[i];
  return { kod: KOD_AD[s.kod[i]], ilce: ilceIdx === ILCE_YOK ? null : ilceler[ilceIdx] };
}

// En yakın yerleşim noktası (aynı ilçede), sınıf ağırlıklı mesafe
function mahalleBul(lon, lat, ilce) {
  const yakin = db.prepare(`SELECT id, ad, sinif, lon, lat FROM yerler WHERE ilce_idx = ? AND lon BETWEEN ? AND ? AND lat BETWEEN ? AND ?`)
    .all(ilce.idx, lon - 0.12, lon + 0.12, lat - 0.1, lat + 0.1);
  const kx = Math.cos((lat * Math.PI) / 180);
  let enIyi = null, enIyiD = Infinity;
  for (const y of yakin) {
    const d = Math.hypot((y.lon - lon) * kx, y.lat - lat) * (MAHALLE_AGIRLIK[y.sinif] || 2);
    if (d < enIyiD) { enIyiD = d; enIyi = y; }
  }
  return enIyi;
}

// ---------- İmar karosu görüntüsü (64 × 64 PNG; her piksel bir hücre) ----------
let RENKLER = null;
function renkTablosu(imarKurallari) {
  if (RENKLER) return RENKLER;
  RENKLER = new Map();
  for (const [ad, v] of Object.entries(K)) {
    const kural = imarKurallari[ad];
    if (!kural?.renk || v === K.DIS) continue;
    const h = kural.renk.replace('#', '');
    RENKLER.set(v, [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), Math.round((kural.karoOpaklik ?? 0.62) * 255)]);
  }
  return RENKLER;
}

// `bos`: boş bırakılacak hücreler (64 × 64; tarlalar haritada ayrı çizilir)
async function imarPng(kx, ky, imarKurallari, bos = null) {
  const { kod } = await karoSiniflandir(kx, ky);
  const renk = renkTablosu(imarKurallari);
  const rgba = Buffer.alloc(KENAR * KENAR * 4);
  for (let idx = 0; idx < kod.length; idx++) {
    if (bos?.[idx]) continue;
    const c = renk.get(kod[idx]);
    if (c) rgba.set(c, idx * 4);
  }
  return pngKodla(KENAR, KENAR, rgba);
}

// Türkçe büyük/küçük ve aksan duyarsız arama anahtarı
function normalize(s) {
  return String(s).toLocaleLowerCase('tr-TR')
    .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/i̇/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

module.exports = { K, KOD_AD, IMAR_SURUM, karoSiniflandir, hucreImari, mahalleBul, imarPng, normalize, sahteImar, yerleriTopla, MAHALLE_AGIRLIK };
