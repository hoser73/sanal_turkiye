// Vektör karo kaynağı: OpenFreeMap (OpenMapTiles şeması, © OpenStreetMap katkıcıları, ODbL).
// Karolar diskte önbelleklenir; aynı karo için eşzamanlı istekler birleştirilir; dış istek sayısı sınırlıdır.
// KARO_KAYNAGI=sahte → ağ kullanılmaz (testler / çevrimdışı geliştirme).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { VectorTile } = require('@mapbox/vector-tile');
const PbfMod = require('pbf');
const Pbf = PbfMod.default || PbfMod;

const SAHTE = process.env.KARO_KAYNAGI === 'sahte';
// Kendi karo sunucusu (ör. PMTiles + martin/tileserver-gl): VEKTOR_TILEJSON aynı OpenMapTiles şemasını sunmalı
const TILEJSON = process.env.VEKTOR_TILEJSON || 'https://tiles.openfreemap.org/planet';
const KULLANICI_AJANI = 'SanalTurkiye/0.3 (game prototype; zoning classification cache)';   // HTTP başlığı: yalnızca ASCII
const VERI_DIZINI = process.env.VERI_DIZINI || path.join(__dirname, '..', '..', 'data');
const DIZIN = path.join(VERI_DIZINI, 'karolar');

let sablon = null;
let sablonZamani = 0;
let veriSurumu = 'bilinmiyor';

async function karoSablonu() {
  if (sablon && Date.now() - sablonZamani < 24 * 3600 * 1000) return sablon;
  const r = await fetch(TILEJSON, { headers: { 'user-agent': KULLANICI_AJANI }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`TileJSON alınamadı (${r.status})`);
  const tj = await r.json();
  sablon = tj.tiles[0];
  sablonZamani = Date.now();
  veriSurumu = (sablon.match(/planet\/([^/]+)\//) || [])[1] || 'bilinmiyor';
  return sablon;
}

// Basit eşzamanlılık sınırı
const MAKS_ES_ZAMANLI = 6;
let aktif = 0;
const kuyruk = [];
async function sirayla(fn) {
  if (aktif >= MAKS_ES_ZAMANLI) await new Promise((r) => kuyruk.push(r));
  aktif++;
  try { return await fn(); } finally { aktif--; kuyruk.shift()?.(); }
}

const ucusta = new Map();

async function hamKaro(z, x, y) {
  const dosya = path.join(DIZIN, String(z), String(x), `${y}.pbf`);
  try { return fs.readFileSync(dosya); } catch { /* önbellekte yok */ }
  const anahtar = `${z}/${x}/${y}`;
  if (ucusta.has(anahtar)) return ucusta.get(anahtar);
  const is = sirayla(async () => {
    const url = (await karoSablonu()).replace('{z}', z).replace('{x}', x).replace('{y}', y);
    let son;
    for (let deneme = 0; deneme < 3; deneme++) {
      try {
        const r = await fetch(url, { headers: { 'user-agent': KULLANICI_AJANI }, signal: AbortSignal.timeout(20000) });
        if (r.status === 404 || r.status === 204) return Buffer.alloc(0);   // boş karo (açık deniz vb.)
        if (!r.ok) throw new Error(`karo ${anahtar}: HTTP ${r.status}`);
        let buf = Buffer.from(await r.arrayBuffer());
        if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
        fs.mkdirSync(path.dirname(dosya), { recursive: true });
        fs.writeFileSync(dosya, buf);
        return buf;
      } catch (e) {
        son = e;
        await new Promise((r) => setTimeout(r, 400 * 2 ** deneme));
      }
    }
    throw son;
  }).finally(() => ucusta.delete(anahtar));
  ucusta.set(anahtar, is);
  return is;
}

async function vektorKaro(z, x, y) {
  const buf = await hamKaro(z, x, y);
  return buf.length ? new VectorTile(new Pbf(buf)) : null;
}

module.exports = { vektorKaro, SAHTE, veriSurumu: () => (SAHTE ? 'sahte' : veriSurumu), KULLANICI_AJANI };
