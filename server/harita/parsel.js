// Parsel hazırlama: bir hücreye ilk kez dokunulduğunda imarı, ilçesi ve mahallesiyle kaydedilir (async).
// Oyun motoru (oyun.js) senkron çalışır; HTTP katmanı her işlemden önce parselHazirla() çağırır.
const db = require('../db');
const I = require('./izgara');
const { hucreImari, karoSiniflandir, mahalleBul, KOD_AD } = require('./imar');
const { veriSurumu } = require('./karolar');
const { IMAR, YERLESIM_CEKICILIK } = require('../config/rules');
const { OyunHatasi } = require('../lib/ledger');
const { tarlaBul } = require('./tarla');

const q = {
  var: db.prepare(`SELECT 1 FROM parcels WHERE id = ?`),
  birlesik: db.prepare(`SELECT birlesik_id FROM parcels WHERE id = ?`),
  ilce: db.prepare(`SELECT id, parent_id, code, name, attractiveness FROM regions WHERE type = 'ILCE' AND source_idx = ?`),
  bolge: db.prepare(`SELECT id FROM regions WHERE code = ?`),
  bolgeEkle: db.prepare(`INSERT OR IGNORE INTO regions (parent_id, type, code, name, plaka, center_lon, center_lat, place_class, attractiveness)
                         VALUES (?, 'MAHALLE', ?, ?, ?, ?, ?, ?, ?)`),
  tarlaGuncelle: db.prepare(`UPDATE parcels SET area_m2 = ?, centroid_lon = ?, centroid_lat = ?, geom_version = 'tarla-v1'
                              WHERE id = ? AND owner_user_id IS NULL`),
  parselEkle: db.prepare(`INSERT OR IGNORE INTO parcels (id, region_id, ilce_id, il_id, district_code, area_m2, zoning_type, zoning_source,
                           centroid_lon, centroid_lat, grid_x, grid_y) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
};

function koordinatlar(id) {
  const c = I.idCoz(id);
  if (!c) throw new OyunHatasi(400, 'Geçersiz parsel kimliği');
  return c;
}

// Mahalle bölgesi: en yakın gerçek yerleşim noktası; yoksa "<İlçe> kırsalı"
function mahalleBolgesi(ilceSatir, ilceVeri, lon, lat) {
  const yer = mahalleBul(lon, lat, ilceVeri);
  const kod = yer ? `${ilceSatir.code}-${yer.id}` : `${ilceSatir.code}-kirsal`;
  let r = q.bolge.get(kod);
  if (r) return r.id;
  const ad = yer ? yer.ad : `${ilceSatir.name} kırsalı`;
  const sinif = yer ? yer.sinif : 'KIRSAL';
  const cekicilik = Math.round(ilceSatir.attractiveness * (YERLESIM_CEKICILIK[sinif] || 1) * 100) / 100;
  q.bolgeEkle.run(ilceSatir.id, kod, ad, ilceVeri.plaka, yer?.lon ?? ilceVeri.merkez[0], yer?.lat ?? ilceVeri.merkez[1], sinif, cekicilik);
  return q.bolge.get(kod).id;
}

// Döndürdüğü kimlik asıl parseldir: deneme ilçesinde hücre bir tarlaya aitse tarlanın kimliği (tarla.js); başka bir
// parsele katılmış (birleştirilmiş) hücrede o parselin kimliği (birlestirme.js)
async function parselHazirla(id) {
  const { x, y } = koordinatlar(id);
  const tarla = await tarlaBul(x, y);
  if (tarla) {
    if (q.var.get(tarla.id)) {
      q.tarlaGuncelle.run(tarla.alan_m2, tarla.merkez_lon, tarla.merkez_lat, tarla.id);   // önce kare olarak açılmış ya da tarla yeniden üretilmişse
      return tarla.id;
    }
    const c = I.idCoz(tarla.id);
    const { ilce } = await hucreImari(c.x, c.y);
    const ilceSatir = q.ilce.get(ilce.idx);
    db.transaction(() => {
      const mahalleId = mahalleBolgesi(ilceSatir, ilce, tarla.merkez_lon, tarla.merkez_lat);
      q.parselEkle.run(tarla.id, mahalleId, ilceSatir.id, ilceSatir.parent_id, ilceSatir.code, tarla.alan_m2, 'TARIM', veriSurumu(),
        tarla.merkez_lon, tarla.merkez_lat, c.x, c.y);
      db.prepare(`UPDATE parcels SET geom_version = 'tarla-v1' WHERE id = ?`).run(tarla.id);
    })();
    return tarla.id;
  }
  const kayit = q.birlesik.get(id);
  if (kayit) return kayit.birlesik_id || id;
  let kod, ilce;
  try {
    ({ kod, ilce } = await hucreImari(x, y));
  } catch (e) {
    console.warn(`Hücre imarı alınamadı (${id}): ${e.message}`);
    throw new OyunHatasi(503, 'Harita verisine şu an ulaşılamıyor; biraz sonra tekrar dene', 'VERI_YOK');
  }
  if (!ilce || kod === 'DIS') throw new OyunHatasi(404, 'Bu nokta Türkiye sınırları dışında', 'SINIR_DISI');
  const ilceSatir = q.ilce.get(ilce.idx);
  const [lon, lat] = I.hucreMerkezi(x, y);
  db.transaction(() => {
    const mahalleId = mahalleBolgesi(ilceSatir, ilce, lon, lat);
    q.parselEkle.run(id, mahalleId, ilceSatir.id, ilceSatir.parent_id, ilceSatir.code, I.hucreAlani(x, y), kod, veriSurumu(),
      Math.round(lon * 1e7) / 1e7, Math.round(lat * 1e7) / 1e7, x, y);
  })();
  return id;
}

// Komşu 8 hücrenin imarı (çoğu aynı karodadır; önbellekten gelir)
async function komsuImarlari(x, y) {
  const sonuc = {};
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const { kx, ky, i } = I.karoOf(x + dx, y + dy);
      const s = await karoSiniflandir(kx, ky);
      sonuc[`${dx},${dy}`] = KOD_AD[s.kod[i]];
    }
  }
  return sonuc;
}

// Belirli imarda, hedefe yakın, birbirinden aralıklı hücreler (NPC yerleşimi ve testler için)
async function hucreAra(lon, lat, imarlar, adet, aralik = 2, maksYaricap = 96) {
  const merkez = I.hucre(lon, lat);
  const bulunan = [];
  const adaylar = [];
  for (let r = 0; r <= maksYaricap && adaylar.length < adet * 12; r += 1) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = merkez.x + dx, y = merkez.y + dy;
        const { kx, ky, i } = I.karoOf(x, y);
        const s = await karoSiniflandir(kx, ky);
        if (imarlar.includes(KOD_AD[s.kod[i]])) adaylar.push({ x, y });
      }
    }
  }
  for (const a of adaylar) {
    if (bulunan.length >= adet) break;
    if (bulunan.every((b) => Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) >= aralik)
        && !db.prepare('SELECT 1 FROM parcels WHERE grid_x = ? AND grid_y = ? AND (owner_user_id IS NOT NULL OR birlesik_id IS NOT NULL)').get(a.x, a.y)) {
      bulunan.push(a);
    }
  }
  return bulunan.map((b) => I.parselId(b.x, b.y));
}

const satilabilirMi = (imar) => !!IMAR[imar]?.satilik;

module.exports = { parselHazirla, komsuImarlari, hucreAra, koordinatlar, satilabilirMi, mahalleBolgesi };
