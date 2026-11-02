// Gerçek tarlalar (deneme: Meram). Kaynak: Fields of the World (CC-BY-4.0) — Sentinel-2 uydu görüntülerinden çıkarılmış
// tarla sınırları (tapu/kadastro parseli değil; uydudan görünen tarla). `npm run tarla-aktar` ile bir kez içeri alınır
// (scripts/tarla-aktar.js, işleme: tarla-ftw.js); burada yalnızca saklanan tarlalar okunur.
// Oyun motoru değişmez: tarla bir parseldir; kimliği merkeze en yakın hücresinin TR-x-y kimliği, alanı tarla alanıdır.
// Merkezi hiçbir tarlada olmayan hücreler kare parsel kalır; aktarımdan önce sahiplenilmiş ya da üzerinde iş olan
// kare parseller ve tarlalar korunur.
const db = require('../db');
const I = require('./izgara');
const { SAHTE } = require('./karolar');

const KENAR = I.KARO_KENAR;
const etkin = () => !SAHTE;   // sahte karo verisiyle (testler) kapalı

db.exec(`
CREATE TABLE IF NOT EXISTS tarlalar (
  id TEXT PRIMARY KEY, kx INTEGER NOT NULL, ky INTEGER NOT NULL, alan_m2 INTEGER NOT NULL,
  merkez_lon REAL NOT NULL, merkez_lat REAL NOT NULL, yon REAL NOT NULL, uye INTEGER NOT NULL, geom TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_tarlalar_karo ON tarlalar(kx, ky);
CREATE TABLE IF NOT EXISTS tarla_hucreleri (x INTEGER NOT NULL, y INTEGER NOT NULL, tarla_id TEXT NOT NULL, PRIMARY KEY (x, y));
CREATE INDEX IF NOT EXISTS ix_tarla_hucreleri_tarla ON tarla_hucreleri(tarla_id);
DROP TABLE IF EXISTS tarla_karolari;
`);
const q = {
  hucre: db.prepare(`SELECT t.* FROM tarla_hucreleri h JOIN tarlalar t ON t.id = h.tarla_id WHERE h.x = ? AND h.y = ?`),
  tarla: db.prepare(`SELECT * FROM tarlalar WHERE id = ?`),
  karoHucreleri: db.prepare(`SELECT x, y, tarla_id FROM tarla_hucreleri WHERE x BETWEEN ? AND ? AND y BETWEEN ? AND ?`),
};

// Hücrenin ait olduğu tarla (tarla dışındaki hücrede null)
async function tarlaBul(x, y) {
  if (!etkin()) return null;
  return q.hucre.get(x, y) || null;
}
const tarlaGetir = (id) => q.tarla.get(id) || null;
const geometri = (t) => ({ type: 'Polygon', coordinates: [JSON.parse(t.geom)] });

const karoHucreleri = (kx, ky) => {
  if (!etkin()) return [];
  const x0 = kx * KENAR, y0 = ky * KENAR;
  return q.karoHucreleri.all(x0, x0 + KENAR - 1, y0, y0 + KENAR - 1);
};
// Karodaki tarla hücreleri: 64 × 64 bayt (1 = tarlanın parçası). Tarla yoksa null.
// İmar karosu bu hücreleri boş bırakır (tarlayı harita kendi çizer), ızgara çizgileri de bu hücrelerde çizilmez.
async function karoMaskesi(kx, ky) {
  const satirlar = karoHucreleri(kx, ky);
  if (!satirlar.length) return null;
  const m = new Uint8Array(KENAR * KENAR);
  for (const { x, y } of satirlar) m[(y - ky * KENAR) * KENAR + (x - kx * KENAR)] = 1;
  return m;
}

// Haritanın tarla karosu (sıkıştırılmış; tarlalar sabit olduğundan önbelleğe alınabilir):
//   m: tarla hücreleri (4096 bit, base64) — istemci ızgarayı bu hücrelerde çizmez
//   t: [[çapa i, çapa j, alan m², ton, x₁, y₁, x₂, y₂, …]] — karoya hücresi düşen her tarla (komşu karoda yinelenebilir;
//      istemci kimliğe göre tekilleştirir); köşeler karo köşesine göre hücre biriminin 100 katı (tamsayı)
// Tarlasız karoda null.
async function karoVerisi(kx, ky) {
  const satirlar = karoHucreleri(kx, ky);
  if (!satirlar.length) return null;
  const x0 = kx * KENAR, y0 = ky * KENAR;
  const bit = Buffer.alloc(KENAR * KENAR / 8), kimlikler = new Set();
  for (const { x, y, tarla_id: id } of satirlar) { const k = (y - y0) * KENAR + (x - x0); bit[k >> 3] |= 1 << (k & 7); kimlikler.add(id); }
  const t = [...kimlikler].map((id) => {
    const r = q.tarla.get(id), c = I.idCoz(id), h = [...id].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
    const koseler = JSON.parse(r.geom).slice(0, -1).flatMap(([lon, lat]) => [Math.round((I.lonX(lon) - x0) * 100), Math.round((I.latY(lat) - y0) * 100)]);
    return [c.x - x0, c.y - y0, r.alan_m2, h % 4, ...koseler];
  });
  return { m: bit.toString('base64'), t };
}

// ---------- Aktarım (scripts/tarla-aktar.js)
// Korunacaklar: üzerinde iş olan (sahipli, ilanlı, yapılı, ekili) kare parseller ve tarlalar — hücreleri yeni tarlalara girmez
function korunanlar([x0, y0, x1, y1]) {
  const satirlar = db.prepare(`SELECT p.id, p.grid_x AS x, p.grid_y AS y FROM parcels p WHERE grid_x BETWEEN ? AND ? AND grid_y BETWEEN ? AND ? AND (
    owner_user_id IS NOT NULL OR birlesik_id IS NOT NULL OR EXISTS (SELECT 1 FROM structures s WHERE s.parcel_id = p.id) OR EXISTS (SELECT 1 FROM crops c WHERE c.parcel_id = p.id)
    OR EXISTS (SELECT 1 FROM listings l WHERE l.parcel_id = p.id))`).all(x0, x1, y0, y1);
  const hucreler = new Set(), tarlaKimlikleri = new Set();
  const uyeler = db.prepare(`SELECT x, y FROM tarla_hucreleri WHERE tarla_id = ?`);
  for (const p of satirlar) {
    hucreler.add(`${p.x}:${p.y}`);
    if (q.tarla.get(p.id)) { tarlaKimlikleri.add(p.id); for (const h of uyeler.all(p.id)) hucreler.add(`${h.x}:${h.y}`); }
  }
  return { hucreler, tarlaKimlikleri };
}
// tarlalar: tarla-ftw.tarlalariKur() sonucu (hücre birimi). Korunanlar dışındaki eski tarlalar silinir; tarlası kalmayan
// sahipsiz tarla parselleri hücre karesine döner, tarlası olanların alanı ve merkezi güncellenir.
function tarlalariYaz(tarlalar, { koru = new Set() } = {}) {
  const r7 = (v) => Math.round(v * 1e7) / 1e7;
  const yaz = db.prepare(`INSERT INTO tarlalar (id, kx, ky, alan_m2, merkez_lon, merkez_lat, yon, uye, geom) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const hucreYaz = db.prepare(`INSERT INTO tarla_hucreleri (x, y, tarla_id) VALUES (?, ?, ?)`);
  let yazilan = 0;
  db.transaction(() => {
    for (const id of db.prepare(`SELECT id FROM tarlalar`).pluck().all()) {
      if (koru.has(id)) continue;
      db.prepare(`DELETE FROM tarla_hucreleri WHERE tarla_id = ?`).run(id);
      db.prepare(`DELETE FROM tarlalar WHERE id = ?`).run(id);
    }
    for (const t of tarlalar) {
      const [x, y] = t.capa, id = I.parselId(x, y), kenarM2 = I.hucreAlani(x, y);
      if (koru.has(id)) continue;
      const geom = t.halka.map(([hx, hy]) => [r7(I.xLon(hx)), r7(I.yLat(hy))]);
      geom.push(geom[0]);
      yaz.run(id, x >> 6, y >> 6, Math.round(t.alanHucre * kenarM2), r7(I.xLon(t.merkez[0])), r7(I.yLat(t.merkez[1])), t.yon, t.uyeler.length, JSON.stringify(geom));
      for (const [hx, hy] of t.uyeler) hucreYaz.run(hx, hy, id);
      yazilan++;
    }
    const guncelle = db.prepare(`UPDATE parcels SET area_m2 = ?, centroid_lon = ?, centroid_lat = ? WHERE id = ?`);
    const kareyeDon = db.prepare(`UPDATE parcels SET geom_version = 'z20-v1', area_m2 = ?, centroid_lon = ?, centroid_lat = ? WHERE id = ?`);
    for (const p of db.prepare(`SELECT p.id, p.grid_x, p.grid_y, t.id AS tid, t.alan_m2, t.merkez_lon, t.merkez_lat FROM parcels p
        LEFT JOIN tarlalar t ON t.id = p.id WHERE p.geom_version = 'tarla-v1' AND p.owner_user_id IS NULL AND p.birlesik_id IS NULL`).all()) {
      if (p.tid) guncelle.run(p.alan_m2, p.merkez_lon, p.merkez_lat, p.id);
      else { const [lon, lat] = I.hucreMerkezi(p.grid_x, p.grid_y); kareyeDon.run(I.hucreAlani(p.grid_x, p.grid_y), lon, lat, p.id); }
    }
  })();
  return yazilan;
}

module.exports = { tarlaBul, tarlaGetir, geometri, karoMaskesi, karoVerisi, etkin, korunanlar, tarlalariYaz };
