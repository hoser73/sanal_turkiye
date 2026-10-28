// Statik metin dosyalarını (JS, CSS, JSON, SVG) brotli ya da gzip ile sıkıştırarak gönderir. Sıkıştırılmış hâl
// bellekte tutulur; dosya değişince (mtime) yeniden üretilir. Ek bağımlılık yok (Node zlib). Sıkıştırma kabul etmeyen
// istemcide ya da bilinmeyen türde istek express.static'e düşer. Ölçüm (v0.45): ilk açılış 3,8 MB → ~0,9 MB.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const TURLER = {
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml',
};
const onbellek = new Map();

function sikistir(ham, kod) {
  return kod === 'br'
    ? zlib.brotliCompressSync(ham, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: ham.length } })
    : zlib.gzipSync(ham, { level: 9 });
}

function sikistirilmisStatik(kok, { maxAge = 0 } = {}) {
  kok = path.resolve(kok);
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const tur = TURLER[path.extname(req.path)];
    if (!tur) return next();
    const kabul = req.get('accept-encoding') || '';
    const kod = /\bbr\b/.test(kabul) ? 'br' : /\bgzip\b/.test(kabul) ? 'gzip' : null;
    if (!kod) return next();
    let dosya;
    try { dosya = path.join(kok, decodeURIComponent(req.path)); } catch { return next(); }
    if (!dosya.startsWith(kok + path.sep)) return next();
    let st;
    try { st = fs.statSync(dosya); } catch { return next(); }
    if (!st.isFile() || st.size < 1024) return next();   // küçük dosyada sıkıştırma kazandırmaz
    const anahtar = `${dosya}|${kod}`;
    let k = onbellek.get(anahtar);
    if (!k || k.mtime !== st.mtimeMs) {
      k = { mtime: st.mtimeMs, govde: sikistir(fs.readFileSync(dosya), kod), etag: `W/"${st.size.toString(16)}-${Math.round(st.mtimeMs).toString(16)}-${kod}"` };
      onbellek.set(anahtar, k);
    }
    res.set({ 'Content-Type': tur, 'Content-Encoding': kod, Vary: 'Accept-Encoding', ETag: k.etag, 'Cache-Control': `public, max-age=${maxAge}` });
    if (req.fresh) return res.status(304).end();
    res.send(k.govde);
  };
}

module.exports = { sikistirilmisStatik };
