// Hassas alanlar için AES-256-GCM (ör. 2FA sırrı). Anahtar SIFRELEME_ANAHTARI ortam değişkeninden (64 hex) gelir.
// Geliştirmede anahtar yoksa veri dizininde bir kez üretilir. ÜRETİMDE anahtar mutlaka ortamdan / anahtar kasasından gelmeli.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let anahtar = null;
function anahtarAl() {
  if (anahtar) return anahtar;
  const ortam = process.env.SIFRELEME_ANAHTARI;
  if (ortam && /^[0-9a-f]{64}$/i.test(ortam)) return (anahtar = Buffer.from(ortam, 'hex'));
  if (process.env.NODE_ENV === 'production') throw new Error('SIFRELEME_ANAHTARI (64 hex) üretimde zorunludur');
  const dizin = process.env.VERI_DIZINI || path.join(__dirname, '..', '..', 'data');
  const dosya = path.join(dizin, '.sifreleme-anahtari');
  try { anahtar = Buffer.from(fs.readFileSync(dosya, 'utf8').trim(), 'hex'); } catch {
    anahtar = crypto.randomBytes(32);
    fs.mkdirSync(dizin, { recursive: true });
    fs.writeFileSync(dosya, anahtar.toString('hex'), { mode: 0o600 });
  }
  return anahtar;
}

function sifrele(metin) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', anahtarAl(), iv);
  const govde = Buffer.concat([c.update(String(metin), 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${govde.toString('base64')}`;
}
function coz(paket) {
  const [s, iv, etiket, govde] = String(paket).split(':');
  if (s !== 'v1') throw new Error('Bilinmeyen şifre biçimi');
  const d = crypto.createDecipheriv('aes-256-gcm', anahtarAl(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(etiket, 'base64'));
  return Buffer.concat([d.update(Buffer.from(govde, 'base64')), d.final()]).toString('utf8');
}

module.exports = { sifrele, coz };
