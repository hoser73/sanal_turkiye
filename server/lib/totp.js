// RFC 6238 TOTP (SHA-1, 30 sn, 6 hane) — kimlik doğrulayıcı uygulamalarla uyumlu. Bağımlılıksız.
const crypto = require('crypto');

const ALFABE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Kodla(buf) {
  let bitler = 0, deger = 0, cikti = '';
  for (const b of buf) {
    deger = (deger << 8) | b;
    bitler += 8;
    while (bitler >= 5) { cikti += ALFABE[(deger >>> (bitler - 5)) & 31]; bitler -= 5; }
  }
  if (bitler > 0) cikti += ALFABE[(deger << (5 - bitler)) & 31];
  return cikti;
}
function base32Coz(s) {
  const temiz = s.replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
  let bitler = 0, deger = 0;
  const bayt = [];
  for (const c of temiz) {
    const i = ALFABE.indexOf(c);
    if (i < 0) throw new Error('Geçersiz base32');
    deger = (deger << 5) | i;
    bitler += 5;
    if (bitler >= 8) { bayt.push((deger >>> (bitler - 8)) & 255); bitler -= 8; }
  }
  return Buffer.from(bayt);
}

function hotp(sir, sayac) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(sayac));
  const h = crypto.createHmac('sha1', base32Coz(sir)).update(b).digest();
  const o = h[h.length - 1] & 15;
  const kod = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(kod % 1e6).padStart(6, '0');
}

const yeniSir = () => base32Kodla(crypto.randomBytes(20));
const kodUret = (sir, zaman = Date.now()) => hotp(sir, Math.floor(zaman / 30000));

// ±1 adım (±30 sn) saat kaymasına izin verir; sabit zamanlı karşılaştırma.
// Eşleşen zaman adımını döndürür (yoksa -1): çağıran, aynı adımın ikinci kez kullanılmasını engeller.
function eslesenAdim(sir, kod, zaman = Date.now()) {
  if (typeof kod !== 'string' || !/^\d{6}$/.test(kod)) return -1;
  const adim = Math.floor(zaman / 30000);
  let bulunan = -1;
  for (const d of [-1, 0, 1]) {
    if (crypto.timingSafeEqual(Buffer.from(hotp(sir, adim + d)), Buffer.from(kod))) bulunan = adim + d;
  }
  return bulunan;
}
const dogrula = (sir, kod, zaman) => eslesenAdim(sir, kod, zaman) >= 0;

const otpauthUri = (sir, hesap, yayinci = 'Sanal Türkiye') =>
  `otpauth://totp/${encodeURIComponent(`${yayinci}:${hesap}`)}?secret=${sir}&issuer=${encodeURIComponent(yayinci)}&algorithm=SHA1&digits=6&period=30`;

module.exports = { yeniSir, kodUret, dogrula, eslesenAdim, otpauthUri, base32Kodla, base32Coz };
