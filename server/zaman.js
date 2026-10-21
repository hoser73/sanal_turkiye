// Zaman yolculuğu (timelapse): bir parselin geçmişini kare kare, ülke genelinde ise parsel edinimlerini zamana yayılmış noktalar olarak verir.
// Kareler denetim kaydı ve yapı/ekin tablolarından türetilir; ayrıca kayıt tutulmaz.
const db = require('./db');
const { YAPILAR, URUNLER } = require('./config/rules');

const ms = (sql) => new Date(String(sql).replace(' ', 'T') + 'Z').getTime();

function parselZamani(parcelId) {
  const p = require('./oyun').parselGetir(parcelId);
  const yapilar = db.prepare(`SELECT type, started_at, completed_at, status FROM structures WHERE parcel_id = ? ORDER BY started_at`).all(p.id);
  const ekinler = db.prepare(`SELECT crop_type, planted_at, ready_at, status, harvested_qty FROM crops WHERE parcel_id = ? ORDER BY planted_at`).all(p.id);
  const sahiplik = db.prepare(`SELECT o.start_at, o.reason, u.display_name AS ad FROM parcel_ownership o JOIN users u ON u.id = o.user_id WHERE o.parcel_id = ? ORDER BY o.id`).all(p.id);
  const olaylar = [];
  for (const s of sahiplik) olaylar.push({ t: ms(s.start_at), etiket: `${s.ad} ${s.reason === 'TRADE' ? 'satın aldı' : 'edindi'}` });
  for (const y of yapilar) {
    olaylar.push({ t: y.started_at, etiket: `${YAPILAR[y.type]?.ad || y.type} inşaatı başladı` });
    if (y.completed_at) olaylar.push({ t: y.completed_at, etiket: `${YAPILAR[y.type]?.ad || y.type} tamamlandı` });
  }
  for (const e of ekinler) {
    olaylar.push({ t: e.planted_at, etiket: `${URUNLER[e.crop_type]?.ad} ekildi` });
    if (e.status === 'HARVESTED') olaylar.push({ t: e.ready_at, etiket: e.harvested_qty ? `${e.harvested_qty} ${URUNLER[e.crop_type]?.ad} hasat` : `${URUNLER[e.crop_type]?.ad} çürüdü` });
  }
  olaylar.sort((a, b) => a.t - b.t);
  // Her olay anında parselin durumu: o ana dek başlamış yapılar (tamamlanmış mı?) ve o an tarladaki ekin
  return olaylar.slice(-40).map((o) => {
    const yp = yapilar.filter((y) => y.started_at <= o.t).map((y) => `${y.type}:${y.completed_at && y.completed_at <= o.t ? 1 : 0}`).join(',');
    const e = ekinler.find((x) => x.planted_at <= o.t && o.t < x.ready_at + 1);
    const ek = e ? `${e.crop_type}:${Math.min(1, (o.t - e.planted_at) / (e.ready_at - e.planted_at)).toFixed(2)}` : '';
    return { t: o.t, etiket: o.etiket, yp, ek };
  });
}

// Türkiye geneli: son N günde edinilen parseller (zaman sırasıyla) — haritada "ülke büyüyor" animasyonu
function ulkeZamani(gun = 30) {
  const g = Math.min(90, Math.max(1, Number(gun) || 30));
  return db.prepare(`SELECT p.centroid_lon AS lon, p.centroid_lat AS lat, p.zoning_type AS z, o.start_at FROM parcel_ownership o
                     JOIN parcels p ON p.id = o.parcel_id WHERE o.start_at >= datetime('now', ?) ORDER BY o.start_at LIMIT 5000`).all(`-${g} days`)
    .map((r) => ({ lon: r.lon, lat: r.lat, z: r.z, t: ms(r.start_at) }));
}

function rotalar(app, { h }) {
  app.get('/api/parsel/:id/zaman', h((req) => parselZamani(String(req.params.id))));
  app.get('/api/zaman/turkiye', h((req) => ulkeZamani(req.query.gun)));
}
module.exports = { rotalar, parselZamani, ulkeZamani };
