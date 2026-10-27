#!/usr/bin/env node
// Gerçek tarla sınırlarını deneme ilçelerine aktarır: npm run tarla-aktar [-- 42:Meram,42:Selçuklu]
// Kaynak: Fields of the World (https://fieldsofthe.world, CC-BY-4.0) — Türkiye PMTiles dosyasından yalnızca ilçeyi örten
// z13 karoları HTTP aralık istekleriyle indirilir (Meram ≈ 240 karo, 8,5 MB) ve data/ftw altında saklanır.
// Tarla, merkezi deneme ilçesinde olan tarladır; daha önce sahiplenilmiş ya da üzerinde iş olan parseller korunur.
// Sunucu açıkken çalıştırılabilir (SQLite WAL); istemciler yeni tarlaları sayfa yenilenince görür.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { VectorTile } = require('@mapbox/vector-tile');
const PbfMod = require('pbf');
const Pbf = PbfMod.default || PbfMod;
const db = require('../server/db');
const I = require('../server/harita/izgara');
const { ilceler, ilceBul } = require('../server/harita/sinirlar');
const F = require('../server/harita/tarla-ftw');
const T = require('../server/harita/tarla');

const KAYNAK = 'https://data.source.coop/ftw/global-data/predictions/vectors/alpha/results-by-admin-conf/admin:country_code=TR/T%C3%BCrkiye.pmtiles';
const KATMAN = '2025', Z = 13;
const ONBELLEK = path.join(process.env.VERI_DIZINI || path.join(__dirname, '..', 'data'), 'ftw');

const secim = (process.argv[2] || process.env.TARLA_ILCELERI || '42:Meram').split(',').map((s) => s.trim()).filter(Boolean);
const pilot = ilceler.filter((c) => secim.includes(`${c.plaka}:${c.ad}`));
if (!pilot.length) { console.error(`İlçe bulunamadı: ${secim.join(', ')} (biçim: plaka:İlçe, ör. 42:Meram)`); process.exit(1); }

// ---------- PMTiles v3 okuyucu (yalnızca gereken baytlar)
async function aralik(bas, uzunluk) {
  for (let deneme = 1; ; deneme++) {
    try {
      const r = await fetch(KAYNAK, { headers: { range: `bytes=${bas}-${bas + uzunluk - 1}` }, signal: AbortSignal.timeout(30000) });
      if (r.status !== 206) throw new Error(`HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (deneme >= 4) throw e;
      await new Promise((c) => setTimeout(c, 1000 * deneme));
    }
  }
}
function dizinCoz(b) {
  const v = zlib.gunzipSync(b);
  let p = 0;
  const oku = () => { let s = 0, c = 1, x; do { x = v[p++]; s += (x & 0x7f) * c; c *= 128; } while (x & 0x80); return s; };
  const adet = oku(), g = [];
  let son = 0;
  for (let i = 0; i < adet; i++) { son += oku(); g.push({ id: son }); }
  for (const x of g) x.kosu = oku();
  for (const x of g) x.uzunluk = oku();
  for (let i = 0; i < adet; i++) { const o = oku(); g[i].ofset = o === 0 && i > 0 ? g[i - 1].ofset + g[i - 1].uzunluk : o - 1; }
  return g;
}
function karoKimligi(z, x, y) {
  let acc = 0; for (let t = 0; t < z; t++) acc += 4 ** t;
  const xy = [x, y]; let d = 0;
  for (let s = 2 ** (z - 1); s >= 1; s /= 2) {
    const rx = (xy[0] & s) > 0 ? 1 : 0, ry = (xy[1] & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) { if (rx === 1) { xy[0] = s - 1 - xy[0]; xy[1] = s - 1 - xy[1]; } [xy[0], xy[1]] = [xy[1], xy[0]]; }
  }
  return acc + d;
}
async function okuyucu() {
  const bas = await aralik(0, 16384);
  if (bas.subarray(0, 7).toString() !== 'PMTiles' || bas[7] !== 3) throw new Error('Beklenmeyen dosya biçimi');
  const u = (o) => Number(bas.readBigUInt64LE(o));
  const kok = dizinCoz(bas.subarray(u(8), u(8) + u(16)));
  const yaprakOfset = u(40), veriOfset = u(56);
  const yapraklar = new Map();
  const bul = async (dizin, id) => {
    let lo = 0, hi = dizin.length - 1, en = null;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (dizin[m].id <= id) { en = dizin[m]; lo = m + 1; } else hi = m - 1; }
    if (!en) return null;
    if (en.kosu === 0) {
      if (!yapraklar.has(en.ofset)) yapraklar.set(en.ofset, dizinCoz(await aralik(yaprakOfset + en.ofset, en.uzunluk)));
      return bul(yapraklar.get(en.ofset), id);
    }
    return id < en.id + en.kosu ? en : null;
  };
  return async (x, y) => {
    const dosya = path.join(ONBELLEK, `${Z}-${x}-${y}.mvt.gz`);
    if (fs.existsSync(dosya)) return fs.readFileSync(dosya);
    const g = await bul(kok, karoKimligi(Z, x, y));
    const ham = g ? await aralik(veriOfset + g.ofset, g.uzunluk) : Buffer.alloc(0);
    fs.writeFileSync(dosya, ham);
    return ham;
  };
}

(async () => {
  fs.mkdirSync(ONBELLEK, { recursive: true });
  const karoAl = await okuyucu();
  // Tüm deneme ilçelerini örten z13 karoları (+1 karo pay: sınırdaki tarlalar birleşebilsin)
  const kz = 2 ** Z;
  const lonX = (lon) => Math.floor(((lon + 180) / 360) * kz);
  const latY = (lat) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * kz); };
  const istenen = new Map();
  for (const c of pilot) {
    const [w, s, e, n] = c.bbox;
    for (let x = lonX(w) - 1; x <= lonX(e) + 1; x++) for (let y = latY(n) - 1; y <= latY(s) + 1; y++) istenen.set(`${x}:${y}`, [x, y]);
  }
  console.log(`${pilot.map((c) => c.ad).join(', ')}: ${istenen.size} karo okunuyor…`);
  const karolar = [];
  let bayt = 0, sayac = 0;
  const liste = [...istenen.values()];
  for (let i = 0; i < liste.length; i += 8) {
    await Promise.all(liste.slice(i, i + 8).map(async ([x, y]) => {
      const ham = await karoAl(x, y);
      bayt += ham.length;
      const parcalar = [];
      if (ham.length) {
        const katman = new VectorTile(new Pbf(zlib.gunzipSync(ham))).layers[KATMAN];
        for (let j = 0; katman && j < katman.length; j++) {
          const f = katman.feature(j), alanM2 = Number(f.properties['metrics:area']) || 0;
          for (const halka of F.disHalkalar(f, x, y)) parcalar.push({ halka, alanM2 });
        }
      }
      karolar.push({ tx: x, ty: y, parcalar });
      sayac += parcalar.length;
    }));
  }
  console.log(`${(bayt / 1e6).toFixed(1)} MB, ${sayac} tarla parçası`);

  // Korunanlar ve kurulum (hücre birimi kutusu)
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const { tx, ty } of karolar) { x0 = Math.min(x0, tx * 128); y0 = Math.min(y0, ty * 128); x1 = Math.max(x1, tx * 128 + 127); y1 = Math.max(y1, ty * 128 + 127); }
  const { hucreler: korunanHucre, tarlaKimlikleri } = T.korunanlar([x0, y0, x1, y1]);
  const t0 = Date.now();
  const tum = F.tarlalariKur({ karolar, uygun: (x, y) => !korunanHucre.has(`${x}:${y}`) });
  // Tarla, merkezi deneme ilçesindeyse alınır
  const pilotIdx = new Set(pilot.map((c) => c.idx));
  let son = null;
  const tarlalar = tum.filter((t) => { const c = ilceBul(I.xLon(t.merkez[0]), I.yLat(t.merkez[1]), son); son = c; return c && pilotIdx.has(c.idx); });
  const yazilan = T.tarlalariYaz(tarlalar, { koru: tarlaKimlikleri });
  const alanlar = tarlalar.map((t) => t.alanHucre * I.hucreAlani(t.capa[0], t.capa[1])).sort((a, b) => a - b);
  console.log(`${yazilan} tarla yazıldı (${((Date.now() - t0) / 1000).toFixed(1)} sn); korunan ${tarlaKimlikleri.size} tarla, ${korunanHucre.size} hücre`);
  if (alanlar.length) console.log(`alan m²: en küçük ${Math.round(alanlar[0])}, ortanca ${Math.round(alanlar[alanlar.length >> 1])}, en büyük ${Math.round(alanlar.at(-1))}`);
  console.log('Kaynak: Fields of the World (fieldsofthe.world), CC-BY-4.0');
})().catch((e) => { console.error('Aktarım başarısız:', e.message); process.exit(1); });
