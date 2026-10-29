// İl → ilçe → mahalle gezintisi: ilin ilçe sınırları (geoBoundaries) ve ilçenin mahalle alanları.
// Mahalle alanı oyunun kendi kuralıdır: bir hücre, ilçedeki en yakın yerleşim noktasına (sınıf ağırlıklı uzaklık,
// imar.js mahalleBul) aittir. Alanlar ilçe üzerinde ince bir ızgara örneklenerek bu kuralla çıkarılır; böylece haritada
// görülen sınır, parsellerin gerçekten bağlandığı mahalleyle birebir aynıdır.
const db = require('../db');
const { ilceler, ilPlakadan } = require('./sinirlar');
const { geometrideMi, sadelestir } = require('./geo');
const { yerleriTopla, MAHALLE_AGIRLIK, normalize } = require('./imar');
const { vektorKaro, SAHTE } = require('./karolar');
const { mahalleBolgesi } = require('./parsel');
const { OyunHatasi } = require('../lib/ledger');

const q = {
  ilceSatirlari: db.sorgu(`SELECT id, parent_id, code, name, plaka, source_idx, attractiveness FROM regions WHERE type = 'ILCE' AND plaka = ?`),
  ilce: db.sorgu(`SELECT id, parent_id, code, name, plaka, source_idx, attractiveness FROM regions WHERE type = 'ILCE' AND id = ?`),
  yerler: db.sorgu(`SELECT id, ad, sinif, lon, lat FROM yerler WHERE ilce_idx = ?`),
  tarandi: db.sorgu(`SELECT 1 FROM ilce_yer_taramasi WHERE ilce_idx = ?`),
  taramaYaz: db.sorgu(`INSERT INTO ilce_yer_taramasi (ilce_idx, at) VALUES (?, ?) ON CONFLICT (ilce_idx) DO UPDATE SET at = excluded.at`),
  yerYaz: db.sorgu(`INSERT OR IGNORE INTO yerler (id, ad, ad_norm, sinif, lon, lat, ilce_idx) VALUES (?, ?, ?, ?, ?, ?, ?)`),
};

// ---------- İlin ilçeleri
const ilceOnbellek = new Map();
async function ilIlceleri(plaka) {
  if (!ilPlakadan.has(String(plaka))) throw new OyunHatasi(404, 'İl bulunamadı');
  if (ilceOnbellek.has(plaka)) return ilceOnbellek.get(plaka);
  const satirlar = new Map((await q.ilceSatirlari.all(String(plaka))).map((r) => [r.source_idx, r]));
  const features = [];
  ilceler.forEach((c, idx) => {
    if (c.plaka !== String(plaka) || !satirlar.has(idx)) return;
    const r = satirlar.get(idx);
    features.push({ type: 'Feature', id: r.id, geometry: sadelestir(c.geo, 0.0006, 4),
      properties: { id: r.id, ad: r.name, renk: features.length % 8, merkez: c.merkez, bbox: c.bbox } });
  });
  const sonuc = { type: 'FeatureCollection', features };
  ilceOnbellek.set(plaka, sonuc);
  return sonuc;
}

// ---------- İlçenin yerleşim noktaları: gazetteer imar karoları işlendikçe dolar; ilk istekte ilçenin tamamı
// orta ölçekli karolardan (z12, ≈10 km) bir kez taranır. Aynı anda tek ilçe taranır (karo kaynağı ve oyuncu istekleri
// yorulmasın); karolardan biri alınamazsa ilçe "tarandı" sayılmaz, sonraki istekte yeniden denenir.
const taramada = new Map();
let taramaSirasi = Promise.resolve();
async function yerleriTara(idx) {
  if (SAHTE || await q.tarandi.get(idx)) return;
  if (taramada.has(idx)) return taramada.get(idx);
  const c = ilceler[idx];
  const is = (taramaSirasi = taramaSirasi.catch(() => {}).then(async () => {
    if (await q.tarandi.get(idx)) return;
    const [w, s, e, n] = c.bbox, Z = 12, N = 2 ** Z;
    const tx = (lon) => Math.floor(((lon + 180) / 360) * N);
    const ty = (lat) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * N); };
    const karolar = [];
    for (let x = tx(w); x <= tx(e); x++) for (let y = ty(n); y <= ty(s); y++) karolar.push([x, y]);
    const yerler = new Map();
    let eksik = 0;
    for (let i = 0; i < karolar.length; i += 4) {
      await Promise.all(karolar.slice(i, i + 4).map(async ([x, y]) => {
        try { yerleriTopla(await vektorKaro(Z, x, y), Z, x, y, yerler); } catch { eksik++; }
      }));
    }
    await db.tx(async () => {
      for (const y of yerler.values()) if (geometrideMi(y.lon, y.lat, c.geo)) await q.yerYaz.run(y.id, y.ad, normalize(y.ad), y.sinif, y.lon, y.lat, idx);
      if (!eksik) await q.taramaYaz.run(idx, Date.now());
    });
  })).finally(() => taramada.delete(idx));
  taramada.set(idx, is);
  return is;
}

// ---------- Mahalle alanları (ızgara örneklemesi → dolgu dikdörtgenleri + sınır çizgileri + etiket noktaları)
const mahalleOnbellek = new Map();
const IZGARA = 200;
async function ilceMahalleleri(ilceId) {
  const r = await q.ilce.get(Number(ilceId));
  if (!r) throw new OyunHatasi(404, 'İlçe bulunamadı');
  const c = ilceler[r.source_idx];
  await yerleriTara(r.source_idx);
  const yerler = (await q.yerler.all(r.source_idx)).filter((y) => y.sinif in MAHALLE_AGIRLIK);
  const anahtar = `${r.id}:${yerler.length}`;
  if (mahalleOnbellek.has(anahtar)) return mahalleOnbellek.get(anahtar);
  const kalici = await db.get(`SELECT veri FROM ilce_mahalle_alanlari WHERE ilce_id = ? AND yer_sayisi = ?`, r.id, yerler.length);
  if (kalici) { const v = JSON.parse(kalici.veri); mahalleOnbellek.set(anahtar, v); return v; }

  const [w, s, e, n] = c.bbox;
  const kx = Math.cos((((s + n) / 2) * Math.PI) / 180);
  // Hücreler yaklaşık kare: uzun kenar IZGARA hücre
  const enM = (e - w) * kx, boyM = n - s;
  const nx = Math.max(20, Math.round(IZGARA * Math.min(1, enM / boyM))), ny = Math.max(20, Math.round(IZGARA * Math.min(1, boyM / enM)));
  const dx = (e - w) / nx, dy = (n - s) / ny;
  const etiket = new Int32Array(nx * ny).fill(-2);   // -2 ilçe dışı, -1 kırsal, ≥0 yer sırası
  for (let j = 0; j < ny; j++) {
    const lat = n - (j + 0.5) * dy;
    for (let i = 0; i < nx; i++) {
      const lon = w + (i + 0.5) * dx;
      if (!geometrideMi(lon, lat, c.geo)) continue;
      // mahalleBul ile aynı kural: ±0,12° / ±0,1° kutudaki noktalar, sınıf ağırlıklı uzaklık
      let en = -1, enD = Infinity;
      for (let k = 0; k < yerler.length; k++) {
        const y = yerler[k];
        if (Math.abs(y.lon - lon) > 0.12 || Math.abs(y.lat - lat) > 0.1) continue;
        const d = Math.hypot((y.lon - lon) * kx, y.lat - lat) * (MAHALLE_AGIRLIK[y.sinif] || 2);
        if (d < enD) { enD = d; en = k; }
      }
      etiket[j * nx + i] = en;
    }
  }
  // Dolgu: her satırdaki aynı etiketli ardışık hücreler tek dikdörtgen
  const dolgu = new Map();
  for (let j = 0; j < ny; j++) {
    let i = 0;
    while (i < nx) {
      const l = etiket[j * nx + i];
      let k = i + 1;
      while (k < nx && etiket[j * nx + k] === l) k++;
      if (l >= 0) {
        const x0 = w + i * dx, x1 = w + k * dx, y0 = n - (j + 1) * dy, y1 = n - j * dy;
        if (!dolgu.has(l)) dolgu.set(l, []);
        dolgu.get(l).push([[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map(([a, b]) => [+a.toFixed(5), +b.toFixed(5)])]);
      }
      i = k;
    }
  }
  // Sınır: farklı mahalleye ait komşu hücreler arasındaki kenarlar (ilçe sınırı ayrıca çizilir), ardışık kenarlar birleşir
  const cizgiler = [];
  for (let j = 0; j < ny; j++) {           // dikey kenarlar (i | i+1)
    for (let i = 0; i + 1 < nx; i++) {
      const a = etiket[j * nx + i], b = etiket[j * nx + i + 1];
      if (a === b || a === -2 || b === -2) continue;
      const x = w + (i + 1) * dx;
      cizgiler.push([[x, n - j * dy], [x, n - (j + 1) * dy]]);
    }
  }
  for (let j = 0; j + 1 < ny; j++) {       // yatay kenarlar (j / j+1)
    for (let i = 0; i < nx; i++) {
      const a = etiket[j * nx + i], b = etiket[(j + 1) * nx + i];
      if (a === b || a === -2 || b === -2) continue;
      const y = n - (j + 1) * dy;
      cizgiler.push([[w + i * dx, y], [w + (i + 1) * dx, y]]);
    }
  }
  const features = [];
  for (const [l, poligonlar] of dolgu) {
    const y = yerler[l];
    features.push({ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: poligonlar },
      properties: { tur: 'alan', yerId: y.id, ad: y.ad, sinif: y.sinif, renk: l % 8 } });
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [y.lon, y.lat] },
      properties: { tur: 'ad', yerId: y.id, ad: y.ad, sinif: y.sinif } });
  }
  if (cizgiler.length) features.push({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: cizgiler.map((s) => s.map(([a, b]) => [+a.toFixed(5), +b.toFixed(5)])) }, properties: { tur: 'sinir' } });
  const sonuc = { type: 'FeatureCollection', features, ilce: { id: r.id, ad: r.name, bbox: c.bbox, mahalleSayisi: dolgu.size } };
  mahalleOnbellek.set(anahtar, sonuc);
  if (mahalleOnbellek.size > 60) mahalleOnbellek.delete(mahalleOnbellek.keys().next().value);
  await db.run(`INSERT INTO ilce_mahalle_alanlari (ilce_id, yer_sayisi, veri, at) VALUES (?, ?, ?, ?)
    ON CONFLICT (ilce_id) DO UPDATE SET yer_sayisi = excluded.yer_sayisi, veri = excluded.veri, at = excluded.at`, r.id, yerler.length, JSON.stringify(sonuc), Date.now());
  return sonuc;
}

// Haritada tıklanan mahalle: oyun bölgesi varsa kimliği döner; yoksa yalnızca giriş yapmış oyuncu için oluşturulur
// (parsel edinildiğinde oluşacağı gibi). Ziyaretçi isteği veritabanına satır yazmaz.
async function mahalleBolgesiAc(ilceId, yerId, userId = null) {
  const r = await q.ilce.get(Number(ilceId));
  if (!r) throw new OyunHatasi(404, 'İlçe bulunamadı');
  const y = await db.get(`SELECT id, ad, sinif, lon, lat FROM yerler WHERE ilce_idx = ? AND id = ?`, r.source_idx, String(yerId ?? ''));
  if (!y) throw new OyunHatasi(404, 'Mahalle bulunamadı');
  const var_ = await db.get(`SELECT id FROM regions WHERE code = ?`, `${r.code}-${y.id}`);
  if (var_) return { id: var_.id, ad: y.ad };
  if (!userId) return { id: null, ad: y.ad };
  const id = await db.tx(() => mahalleBolgesi(r, ilceler[r.source_idx], y.lon, y.lat));
  return { id, ad: y.ad };
}

module.exports = { ilIlceleri, ilceMahalleleri, mahalleBolgesiAc };
