// Yapılandırılmış günlük: tek satır JSON (zaman, düzey, ileti, istek kimliği, kullanıcı, yol, süre). Hatalar ayrıca
// data/gunluk/hatalar.jsonl dosyasına yazılır ve yönetim panelinde görünür. Kişisel veri (e-posta, parola, çerez, IP) yazılmaz.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DUZEYLER = { debug: 10, info: 20, warn: 30, error: 40 };
const esik = () => DUZEYLER[process.env.GUNLUK_DUZEYI || (process.env.SESSIZ ? 'error' : 'info')] ?? 20;
const dizin = () => path.join(process.env.VERI_DIZINI || path.join(__dirname, '..', '..', 'data'), 'gunluk');
const HASSAS = /(sifre|parola|password|token|cerez|cookie|email|kod|makbuz|authorization)/i;

function temizle(v, derinlik = 0) {
  if (v == null || derinlik > 3) return v;
  if (v instanceof Error) return { ad: v.name, ileti: v.message, yigin: v.stack?.split('\n').slice(0, 8).join('\n'), durum: v.status };
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => temizle(x, derinlik + 1));
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, HASSAS.test(k) ? '[gizli]' : temizle(x, derinlik + 1)]));
  if (typeof v === 'string' && v.length > 2000) return v.slice(0, 2000) + '…';
  return v;
}

function yaz(duzey, ileti, alanlar = {}) {
  if (DUZEYLER[duzey] < esik()) return;
  const satir = JSON.stringify({ ...temizle(alanlar), t: new Date().toISOString(), duzey, ileti });
  if (!(process.env.SESSIZ && duzey !== 'error') && !process.env.GUNLUK_SESSIZ) (duzey === 'error' || duzey === 'warn' ? process.stderr : process.stdout).write(satir + '\n');
  if (duzey === 'error') {
    // Hatalar seyrektir: eşzamanlı ekleme, süreç çökerken bile satırın diske yazılmasını sağlar
    try { fs.mkdirSync(dizin(), { recursive: true }); fs.appendFileSync(path.join(dizin(), 'hatalar.jsonl'), satir + '\n'); } catch { /* günlük yazılamazsa uygulama durmaz */ }
  }
}
const gunluk = { debug: (m, a) => yaz('debug', m, a), info: (m, a) => yaz('info', m, a), warn: (m, a) => yaz('warn', m, a), error: (m, a) => yaz('error', m, a) };

// İstek günlüğü: her isteğe kimlik verir (X-Istek-Kimligi), bitişte süre ve durum kodunu yazar
function istekGunlugu(req, res, next) {
  req.istekId = crypto.randomBytes(6).toString('hex');
  res.set('x-istek-kimligi', req.istekId);
  const bas = process.hrtime.bigint();
  res.on('finish', () => {
    if (req.path.startsWith('/api/karo/') && res.statusCode < 400) return;   // karo akışı gürültü yapmasın
    const ms = Number(process.hrtime.bigint() - bas) / 1e6;
    const duzey = res.statusCode >= 500 ? 'error' : ms > 1500 ? 'warn' : 'info';
    if (!req.path.startsWith('/api/') && duzey === 'info') return;
    yaz(duzey, 'istek', { id: req.istekId, yontem: req.method, yol: req.route?.path || req.path, durum: res.statusCode, ms: Math.round(ms), kullanici: req.kullanici?.id });
  });
  next();
}

function sonHatalar(adet = 50) {
  try {
    const metin = fs.readFileSync(path.join(dizin(), 'hatalar.jsonl'), 'utf8');
    return metin.trim().split('\n').slice(-adet).reverse().map((s) => { try { return JSON.parse(s); } catch { return { ileti: s }; } });
  } catch { return []; }
}

module.exports = { gunluk, istekGunlugu, sonHatalar, temizle };
