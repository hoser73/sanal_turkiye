// Bağımlılıksız RGBA PNG kodlayıcı (imar karoları için küçük görüntüler).
const zlib = require('zlib');

const CRC_TABLO = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLO[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function parca(tur, veri) {
  const uz = Buffer.alloc(4); uz.writeUInt32BE(veri.length);
  const tv = Buffer.concat([Buffer.from(tur, 'ascii'), veri]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(tv));
  return Buffer.concat([uz, tv, crc]);
}

function pngKodla(genislik, yukseklik, rgba) {
  const ham = Buffer.alloc((genislik * 4 + 1) * yukseklik);
  for (let y = 0; y < yukseklik; y++) {
    ham[y * (genislik * 4 + 1)] = 0;   // filtre yok
    rgba.copy ? rgba.copy(ham, y * (genislik * 4 + 1) + 1, y * genislik * 4, (y + 1) * genislik * 4)
      : ham.set(rgba.subarray(y * genislik * 4, (y + 1) * genislik * 4), y * (genislik * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(genislik, 0); ihdr.writeUInt32BE(yukseklik, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    parca('IHDR', ihdr), parca('IDAT', zlib.deflateSync(ham, { level: 9 })), parca('IEND', Buffer.alloc(0)),
  ]);
}

module.exports = { pngKodla };
