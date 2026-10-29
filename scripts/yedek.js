#!/usr/bin/env node
// Çevrimiçi yedek: SQLite yedekleme API'siyle (sunucu çalışırken güvenli) tutarlı kopya alır, bütünlüğünü denetler, gzip'ler,
// eski yedekleri döndürür. Kullanım: npm run yedek [-- --dizin data/yedekler --sakla 14]
// Şifreleme anahtarı (.sifreleme-anahtari) yedeğe GİRMEZ: 2FA sırları onsuz çözülemez; anahtarı ayrı ve güvenli saklayın.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const Database = require('better-sqlite3');

// Bu betik SQLite veri dosyası içindir; Postgres'te pg_dump / pg_restore kullanılır (docs/yayina-alma.md)
if (process.env.VERITABANI === 'postgres' && require.main === module) {
  console.error('VERITABANI=postgres: %s için pg_dump/pg_restore kullanın (bkz. docs/yayina-alma.md)', 'yedek');
  process.exit(1);
}

const arg = (ad, vars) => { const i = process.argv.indexOf(`--${ad}`); return i > 0 ? process.argv[i + 1] : vars; };
const VERI = process.env.VERI_DIZINI || path.join(__dirname, '..', 'data');
const KAYNAK = path.join(VERI, 'sanalturkiye-tr.db');
const HEDEF_DIZIN = path.resolve(arg('dizin', path.join(VERI, 'yedekler')));
const SAKLA = Number(arg('sakla', 14));

async function yedekAl() {
  if (!fs.existsSync(KAYNAK)) throw new Error(`Veritabanı yok: ${KAYNAK}`);
  fs.mkdirSync(HEDEF_DIZIN, { recursive: true });
  const ad = `sanalturkiye-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
  const gecici = path.join(HEDEF_DIZIN, ad);
  const db = new Database(KAYNAK, { readonly: true, fileMustExist: true });
  await db.backup(gecici);
  db.close();
  const kopya = new Database(gecici, { readonly: true });
  const butunluk = kopya.pragma('integrity_check', { simple: true });
  const sayilar = Object.fromEntries(['users', 'parcels', 'wallet_ledger', 'audit_events'].map((t) => [t, kopya.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c]));
  kopya.close();
  if (butunluk !== 'ok') { fs.rmSync(gecici); throw new Error(`Yedek bütünlük denetimi başarısız: ${butunluk}`); }
  const gz = `${gecici}.gz`;
  await new Promise((coz, red) => fs.createReadStream(gecici).pipe(zlib.createGzip({ level: 9 })).pipe(fs.createWriteStream(gz)).on('finish', coz).on('error', red));
  fs.rmSync(gecici);
  // Döndürme: en yeni SAKLA yedek kalır
  const eski = fs.readdirSync(HEDEF_DIZIN).filter((f) => /^sanalturkiye-.*\.db\.gz$/.test(f)).sort().reverse().slice(SAKLA);
  for (const f of eski) fs.rmSync(path.join(HEDEF_DIZIN, f));
  return { dosya: gz, boyutKb: Math.round(fs.statSync(gz).size / 1024), sayilar, silinen: eski.length };
}

if (require.main === module) {
  yedekAl().then((r) => console.log(JSON.stringify({ tamam: true, ...r }))).catch((e) => { console.error(JSON.stringify({ tamam: false, hata: e.message })); process.exit(1); });
}
module.exports = { yedekAl };
