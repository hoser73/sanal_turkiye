// Ulusal bölge hiyerarşisi: Türkiye → 81 il → 973 ilçe (server/veri/*.json, kaynak: OSM / geoBoundaries).
// Mahalleler gerçek yerleşim noktalarından ihtiyaç anında oluşturulur (server/harita/parsel.js).
const bcrypt = require('bcryptjs');
const db = require('./db');
const { HESAP, IL_CEKICILIK } = require('./config/rules');
const { iller, ilceler } = require('./harita/sinirlar');

function seedEt({ sessiz = false } = {}) {
  if (db.prepare(`SELECT COUNT(*) AS c FROM regions WHERE type = 'ILCE'`).get().c >= ilceler.length) {
    // Sınır verisi yeniden hazırlandıysa ilçe adlarını eşitle (kodlar değişmez)
    const guncelle = db.prepare(`UPDATE regions SET name = ? WHERE type = 'ILCE' AND source_idx = ? AND name <> ?`);
    db.transaction(() => ilceler.forEach((c, idx) => guncelle.run(c.ad, idx, c.ad)))();
    return false;
  }

  const ekle = db.prepare(`INSERT OR IGNORE INTO regions (parent_id, type, code, name, plaka, center_lon, center_lat, bbox, source_idx, attractiveness)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const idBul = db.prepare(`SELECT id FROM regions WHERE code = ?`);
  db.transaction(() => {
    ekle.run(null, 'ULKE', 'TR', 'Türkiye', null, 35.2, 39.0, JSON.stringify([25.6, 35.8, 44.9, 42.2]), null, 1);
    const tr = idBul.get('TR').id;
    const ilId = new Map();
    for (const il of iller) {
      ekle.run(tr, 'IL', il.kod, il.ad, il.plaka, il.merkez[0], il.merkez[1], JSON.stringify(il.bbox), null, IL_CEKICILIK[il.plaka] || 0.95);
      ilId.set(il.plaka, idBul.get(il.kod).id);
    }
    ilceler.forEach((c, idx) => {
      ekle.run(ilId.get(c.plaka), 'ILCE', c.kod, c.ad, c.plaka, c.merkez[0], c.merkez[1], JSON.stringify(c.bbox), idx, IL_CEKICILIK[c.plaka] || 0.95);
    });

    // Test hesabı (yalnızca yerel geliştirme): demo@sanalturkiye.test / demo1234
    if (process.env.NODE_ENV !== 'production' && !db.prepare(`SELECT 1 FROM users WHERE email = 'demo@sanalturkiye.test'`).get()) {
      const demo = db.prepare(`INSERT INTO users (email, password_hash, display_name, dogum_yili, email_dogrulandi_at) VALUES (?, ?, ?, 1990, datetime('now'))`)
        .run('demo@sanalturkiye.test', bcrypt.hashSync('demo1234', 10), 'Demo Oyuncu').lastInsertRowid;
      const { YASAL } = require('./config/rules');
      for (const [k, b] of Object.entries(YASAL)) db.prepare(`INSERT INTO yasal_onaylar (user_id, belge, surum, onay) VALUES (?, ?, ?, ?)`).run(demo, k, b.surum, b.zorunlu ? 1 : 0);
      require('./lib/ledger').odul(demo, HESAP.baslangicBakiye, 'Hoş geldin hibesi');
    }
  })();
  if (!sessiz) console.log(`Bölgeler hazır: ${iller.length} il, ${ilceler.length} ilçe`);
  return true;
}

if (require.main === module) seedEt();
module.exports = { seedEt };
