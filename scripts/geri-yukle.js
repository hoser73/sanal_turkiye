#!/usr/bin/env node
// Yedekten geri yükleme: npm run geri-yukle -- <yedek.db.gz> [--onayla]
// Sunucu DURDURULMUŞ olmalı. Önce yedek geçici dosyaya açılır ve bütünlüğü denetlenir; mevcut veritabanı
// "onceki-<zaman>.db" olarak kenara alınır (silinmez). --onayla verilmezse yalnızca deneme (kuru çalıştırma) yapılır.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const Database = require('better-sqlite3');

async function geriYukle(yedek, { onayla = false, veri = process.env.VERI_DIZINI || path.join(__dirname, '..', 'data') } = {}) {
  if (!yedek || !fs.existsSync(yedek)) throw new Error('Yedek dosyası bulunamadı');
  const hedef = path.join(veri, 'sanalturkiye-tr.db');
  const acik = path.join(veri, `.geri-yukleme-${Date.now()}.db`);
  await new Promise((coz, red) => fs.createReadStream(yedek).pipe(yedek.endsWith('.gz') ? zlib.createGunzip() : new (require('stream').PassThrough)())
    .pipe(fs.createWriteStream(acik)).on('finish', coz).on('error', red));
  const db = new Database(acik, { readonly: true });
  const butunluk = db.pragma('integrity_check', { simple: true });
  const sayilar = Object.fromEntries(['users', 'parcels', 'wallet_ledger', 'audit_events'].map((t) => [t, db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c]));
  // Defter denetimi: işlem grupları dengeli olmalı
  const dengesiz = db.prepare(`SELECT COUNT(*) c FROM (SELECT tx_group FROM wallet_ledger GROUP BY tx_group HAVING ROUND(SUM(debit) - SUM(credit), 2) <> 0)`).get().c;
  db.close();
  if (butunluk !== 'ok' || dengesiz) { fs.rmSync(acik); throw new Error(`Yedek kullanılamaz: bütünlük=${butunluk}, dengesiz işlem=${dengesiz}`); }
  if (!onayla) { fs.rmSync(acik); return { kuru: true, sayilar, mesaj: 'Yedek sağlam. Geri yüklemek için --onayla ekleyin (sunucu durdurulmuş olmalı).' }; }
  let kenar = null;
  if (fs.existsSync(hedef)) {
    kenar = path.join(veri, `onceki-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
    fs.renameSync(hedef, kenar);
    for (const ek of ['-wal', '-shm']) if (fs.existsSync(hedef + ek)) fs.renameSync(hedef + ek, kenar + ek);
  }
  fs.renameSync(acik, hedef);
  return { kuru: false, sayilar, oncekiVeritabani: kenar };
}

if (require.main === module) {
  const dosya = process.argv.slice(2).find((a) => !a.startsWith('--'));
  geriYukle(dosya, { onayla: process.argv.includes('--onayla') }).then((r) => console.log(JSON.stringify({ tamam: true, ...r })))
    .catch((e) => { console.error(JSON.stringify({ tamam: false, hata: e.message })); process.exit(1); });
}
module.exports = { geriYukle };
