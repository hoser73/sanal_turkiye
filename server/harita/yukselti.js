// Arazi yükseltisi (AWS Terrain Tiles, "terrarium" PNG; açık veri, istemcideki 3B arazi de aynı kaynağı kullanır).
// Karolar diskte (VERI_DIZINI/yukselti) ve bellekte saklanır; çözülmüş karo metre cinsinden Int16 dizisidir.
// KARO_KAYNAGI=sahte → ağ yok, her yer deniz seviyesinde düz (testler).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const I = require('./izgara');
const { KULLANICI_AJANI } = require('./karolar');

const SAHTE = process.env.KARO_KAYNAGI === 'sahte';
const KAYNAK = process.env.YUKSELTI_KAYNAGI || process.env.YUKSELTI_KARO || 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const VERI_DIZINI = process.env.VERI_DIZINI || path.join(__dirname, '..', '..', 'data');
const DIZIN = path.join(VERI_DIZINI, 'yukselti');
const Z = 11;            // ≈ 60 m piksel (Türkiye enlemlerinde): eğim ve çevre yükseltisi için yeterli
const KENAR = 256;

// Bağımlılıksız PNG çözücü: 8 bit RGB / RGBA, taramasız (terrarium karoları böyledir)
function pngCoz(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG değil');
  let o = 8, gen = 0, yuk = 0, renk = 0, derinlik = 0;
  const idat = [];
  while (o < buf.length) {
    const uz = buf.readUInt32BE(o), tur = buf.toString('ascii', o + 4, o + 8), veri = buf.subarray(o + 8, o + 8 + uz);
    if (tur === 'IHDR') { gen = veri.readUInt32BE(0); yuk = veri.readUInt32BE(4); derinlik = veri[8]; renk = veri[9]; }
    else if (tur === 'IDAT') idat.push(veri);
    else if (tur === 'IEND') break;
    o += 12 + uz;
  }
  if (derinlik !== 8 || (renk !== 2 && renk !== 6)) throw new Error(`desteklenmeyen PNG (derinlik ${derinlik}, renk ${renk})`);
  const bpp = renk === 6 ? 4 : 3, satir = gen * bpp;
  const ham = zlib.inflateSync(Buffer.concat(idat));
  const cikti = Buffer.alloc(satir * yuk);
  for (let y = 0; y < yuk; y++) {
    const f = ham[y * (satir + 1)], kaynak = ham.subarray(y * (satir + 1) + 1, (y + 1) * (satir + 1)), hedef = y * satir;
    for (let i = 0; i < satir; i++) {
      const a = i >= bpp ? cikti[hedef + i - bpp] : 0, b = y ? cikti[hedef - satir + i] : 0, c = y && i >= bpp ? cikti[hedef - satir + i - bpp] : 0;
      let v = kaynak[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cikti[hedef + i] = v & 255;
    }
  }
  return { gen, yuk, bpp, veri: cikti };
}

const bellek = new Map();   // "x:y" → Promise<Int16Array>
const BELLEK_MAKS = 400;
async function karo(x, y) {
  const anahtar = `${x}:${y}`;
  if (bellek.has(anahtar)) { const v = bellek.get(anahtar); bellek.delete(anahtar); bellek.set(anahtar, v); return v; }
  const is = (async () => {
    const dosya = path.join(DIZIN, String(Z), String(x), `${y}.png`);
    let buf;
    try { buf = fs.readFileSync(dosya); } catch {
      const r = await fetch(KAYNAK.replace('{z}', Z).replace('{x}', x).replace('{y}', y), { headers: { 'user-agent': KULLANICI_AJANI }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`yükselti karosu ${Z}/${x}/${y}: HTTP ${r.status}`);
      buf = Buffer.from(await r.arrayBuffer());
      fs.mkdirSync(path.dirname(dosya), { recursive: true });
      fs.writeFileSync(dosya, buf);
    }
    const p = pngCoz(buf);
    const h = new Int16Array(KENAR * KENAR);
    for (let i = 0; i < KENAR * KENAR; i++) {
      const r = p.veri[i * p.bpp], g = p.veri[i * p.bpp + 1], b = p.veri[i * p.bpp + 2];
      h[i] = Math.round(r * 256 + g + b / 256 - 32768);
    }
    return h;
  })();
  bellek.set(anahtar, is);
  is.catch(() => bellek.delete(anahtar));
  if (bellek.size > BELLEK_MAKS) bellek.delete(bellek.keys().next().value);
  return is;
}

// Dünya pikseli (z11) → yükselti (m)
async function piksel(px, py) {
  const tx = Math.floor(px / KENAR), ty = Math.floor(py / KENAR);
  const h = await karo(tx, ty);
  return h[(py - ty * KENAR) * KENAR + (px - tx * KENAR)];
}

// Noktanın arazi özeti: yükselti, eğim (%) ve çevresine göre yüksekliği (m): yakın çevredeki (≈ 2,5 km) en alçak
// noktadan farkı — vadi tabanında 0'a yakın, dağ yamacında ve sırtta büyük. Denizde ve sahte kaynakta düz.
async function araziOzeti(lon, lat) {
  if (SAHTE) return { yukselti: 0, egim: 0, cevreFarki: 0 };
  const olcek = 2 ** (Z + 8) / I.N;   // ızgara biriminden z11 pikseline
  const px = Math.floor(I.lonX(lon) * olcek), py = Math.floor(I.latY(lat) * olcek);
  const pikselM = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / 2 ** (Z + 8);
  const h = await piksel(px, py);
  const [d, b, k, g] = await Promise.all([piksel(px + 2, py), piksel(px - 2, py), piksel(px, py - 2), piksel(px, py + 2)]);
  const egim = Math.round((Math.hypot((d - b) / (4 * pikselM), (g - k) / (4 * pikselM)) * 100) * 10) / 10;
  const halka = [];
  for (const r of [20, 40]) for (let a = 0; a < 16; a++) halka.push(piksel(px + Math.round(r * Math.cos((a * Math.PI) / 8)), py + Math.round(r * Math.sin((a * Math.PI) / 8))));
  const enAlcak = Math.min(h, ...(await Promise.all(halka)).map((v) => Math.max(v, 0)));   // deniz tabanı (negatif) kıyıyı sırt gibi göstermesin
  return { yukselti: h, egim, cevreFarki: Math.max(0, h - enAlcak) };
}

module.exports = { araziOzeti, pngCoz };
