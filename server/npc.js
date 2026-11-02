// Demo komşular (NPC): haritanın ilk açılışta boş görünmemesi için Türkiye'nin farklı yerlerinde birkaç yerleşik oyuncu.
// Her biri gerçek imara uygun hücrelere yerleşir, yapı kurar, ekin eker ve bir parselini ilana koyar.
// Platformun stok üretme aracı değildir (§8.1): yalnızca az sayıda, açıkça "demo komşu" etiketli kayıt.
const db = require('./db');
const { YAPILAR, URUNLER } = require('./config/rules');
const { parselHazirla, hucreAra } = require('./harita/parsel');

const NPCLER = [
  { ad: 'Çiftçi Hasan',     yer: [32.43, 37.84], imar: ['TARIM'], adet: 3, yapilar: ['TEL_CIT', 'SULAMA_HATTI'], ekin: true, ilan: true },   // Konya Meram
  { ad: 'Mimar Selin',      yer: [32.86, 39.90], imar: ['KONUT'], adet: 2, yapilar: ['EV', 'PEYZAJ'], ilan: true },                       // Ankara Çankaya
  { ad: 'Esnaf Murat',      yer: [29.03, 40.99], imar: ['TICARET', 'KARMA', 'KONUT'], adet: 2, yapilar: ['DUKKAN'], ilan: true },        // İstanbul Kadıköy
  { ad: 'Lojistikçi Kerem', yer: [28.88, 40.22], imar: ['SANAYI'], adet: 2, yapilar: ['DEPO'] },                                          // Bursa Nilüfer
  { ad: 'Pansiyoncu Zehra', yer: [27.43, 37.04], imar: ['TURIZM', 'KONUT'], adet: 2, yapilar: ['PANSIYON', 'PEYZAJ'], ilan: true },       // Muğla Bodrum
  { ad: 'Bahçıvan Emine',   yer: [27.20, 38.42], imar: ['TARIM'], adet: 2, yapilar: ['SERA'], ekin: true },                               // İzmir
  { ad: 'Çaycı Fadime',     yer: [40.52, 41.02], imar: ['TARIM'], adet: 2, yapilar: ['TEL_CIT'], ekin: true },                   // Rize
  { ad: 'Fındıkçı Rıza',    yer: [38.39, 40.90], imar: ['TARIM'], adet: 2, yapilar: ['AMBAR'], ekin: true, ilan: true },                  // Giresun
  { ad: 'Kayısıcı Ahmet',   yer: [38.31, 38.35], imar: ['TARIM'], adet: 2, yapilar: ['SULAMA_HATTI'], ekin: true },                       // Malatya
  { ad: 'Fıstıkçı Sevgi',   yer: [37.38, 37.06], imar: ['TARIM'], adet: 2, yapilar: ['TEL_CIT'], ekin: true },                            // Gaziantep
];

let calisiyor = null;
async function npcSeedEt({ sessiz = false } = {}) {
  if (calisiyor) return calisiyor;
  calisiyor = (async () => {
    const pazar = require('./pazar');
    const oyun = require('./oyun');
    let yeni = 0;
    for (const n of NPCLER) {
      if (db.prepare('SELECT 1 FROM users WHERE display_name = ? AND is_npc = 1').get(n.ad)) continue;
      try {
        const kimlikler = await hucreAra(n.yer[0], n.yer[1], n.imar, n.adet, 3);
        if (!kimlikler.length) continue;
        for (let k = 0; k < kimlikler.length; k++) kimlikler[k] = await parselHazirla(kimlikler[k]);
        kimlikler.splice(0, kimlikler.length, ...new Set(kimlikler));   // aynı tarlaya düşen hücreler tek parsel
        db.transaction(() => {
          const uid = db.prepare('INSERT INTO users (display_name, is_npc) VALUES (?, 1)').run(n.ad).lastInsertRowid;
          const simdi = Date.now();
          kimlikler.forEach((id, sira) => {
            const p = oyun.parselGetir(id);
            db.prepare(`UPDATE parcels SET owner_user_id = ?, acquired_at = datetime('now'), version = version + 1 WHERE id = ? AND owner_user_id IS NULL AND status = 'ACTIVE'`).run(uid, id);
            db.prepare(`INSERT INTO parcel_ownership (parcel_id, user_id, reason) VALUES (?, ?, 'SEED_NPC')`).run(id, uid);
            for (const tip of n.yapilar) {
              const y = YAPILAR[tip];
              if (!y.izin.includes(p.zoning_type) || !oyun.insaatUygunluk(p, tip, db.prepare('SELECT * FROM structures WHERE parcel_id = ?').all(id)).uygun) continue;
              db.prepare(`INSERT INTO structures (parcel_id, owner_user_id, type, footprint_m2, floor_area_m2, status, started_at, completes_at, completed_at)
                          VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`).run(id, uid, tip, y.taban, y.taban * y.kat, simdi, simdi, simdi);
            }
            if (n.ekin && p.zoning_type === 'TARIM') {
              const urun = Object.keys(URUNLER)[sira % 3];
              db.prepare(`INSERT INTO crops (parcel_id, user_id, crop_type, planted_at, ready_at, waterings) VALUES (?, ?, ?, ?, ?, ?)`)
                .run(id, uid, urun, simdi, simdi + URUNLER[urun].sureMs, URUNLER[urun].sulama);
            }
            if (n.ilan && sira === kimlikler.length - 1 && oyun.parselGetir(id).zoning_type !== 'KORUMA') {
              const fiyat = Math.max(20, Math.round((oyun.birincilBedel(oyun.parselGetir(id)) * 1.5) / 5) * 5);
              pazar.ilanAc(uid, id, { fiyat, gun: 7, kosul: 'HERKES' });
            }
          });
        })();
        yeni++;
      } catch (e) {
        if (!sessiz) console.warn(`Demo komşu yerleştirilemedi (${n.ad}): ${e.message}`);
      }
    }
    if (!sessiz && yeni) console.log(`${yeni} demo komşu yerleştirildi`);
    return yeni;
  })().finally(() => { calisiyor = null; });
  return calisiyor;
}

module.exports = { npcSeedEt, NPCLER };
