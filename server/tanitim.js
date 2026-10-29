// Açılış (tanıtım) sayfası için herkese açık, kişisel veri içermeyen canlı özet: oyun istatistikleri, son olaylar
// (yalnızca yer ve eylem; oyuncu adı yok), büyük şehirlerin anlık havası, süren etkinlik, yöresel ürünler, sponsorlar.
// Tüm ziyaretçilere aynı yanıt gider; 60 saniye önbellekte tutulur.
const db = require('./db');
const { YORESEL, URUNLER } = require('./config/rules');

const SEHIRLER = ['34', '06', '35', '07', '42', '16', '61', '27'];   // 42 (Konya) 3B açılış sahnesinin havasıdır
const AKIS_EYLEMLERI = ['CROP_HARVESTED', 'CROP_PLANTED', 'PARCEL_ACQUIRED', 'STRUCTURE_COMPLETED', 'GI_PRODUCED', 'NEIGHBOR_HELPED', 'PRODUCTION_COLLECTED'];
let onbellek = null;

async function sayilar(t) {
  const gun = new Date(t - 864e5).toISOString().replace('T', ' ').slice(0, 19);
  const say = async (sql, ...p) => Number((await db.get(sql, ...p)).c);
  return {
    oyuncu: await say(`SELECT COUNT(*) c FROM users WHERE is_npc = 0 AND status = 'ACTIVE'`),
    parsel: await say(`SELECT COUNT(*) c FROM parcels WHERE owner_user_id IS NOT NULL`),
    ilSayisi: await say(`SELECT COUNT(DISTINCT il_id) c FROM parcels WHERE owner_user_id IS NOT NULL`),
    hasat24: await say(`SELECT COUNT(*) c FROM audit_events WHERE action = 'CROP_HARVESTED' AND created_at > ?`, gun),
    ekim24: await say(`SELECT COUNT(*) c FROM audit_events WHERE action = 'CROP_PLANTED' AND created_at > ?`, gun),
    balik24: await say(`SELECT COUNT(*) c FROM balik_atislari WHERE durum = 'TUTULDU' AND at > ?`, t - 864e5).catch(() => 0),
  };
}
async function akis() {
  return (await db.all(`
    SELECT a.action, a.after_json, a.created_at,
      CASE r.type WHEN 'MAHALLE' THEN r.name WHEN 'ILCE' THEN r.name END AS yer,
      CASE r.type WHEN 'MAHALLE' THEN rl.name WHEN 'ILCE' THEN ri.name WHEN 'IL' THEN r.name END AS il
    FROM audit_events a LEFT JOIN regions r ON r.id = a.region_id LEFT JOIN regions ri ON ri.id = r.parent_id LEFT JOIN regions rl ON rl.id = ri.parent_id
    WHERE a.public = 1 AND a.action IN (${AKIS_EYLEMLERI.map(() => '?').join(',')}) ORDER BY a.id DESC LIMIT 14`, ...AKIS_EYLEMLERI))
    .filter((s) => s.il)
    .map((s) => {
      let urun = null;
      try { const a = s.after_json ? JSON.parse(s.after_json) : null; urun = a?.urun && URUNLER[a.urun] ? { ad: URUNLER[a.urun].ad, ikon: URUNLER[a.urun].ikon } : null; } catch { /* yok */ }
      return { eylem: s.action, yer: s.yer && s.yer !== s.il ? `${s.yer}, ${s.il}` : s.il, urun, zaman: s.created_at };
    });
}
async function tanitim(t = Date.now()) {
  if (onbellek && t - onbellek.t < 60_000) return onbellek.v;
  const dunya = require('./dunya');
  const iller = new Map((await db.all(`SELECT plaka, name FROM regions WHERE type = 'IL'`)).map((r) => [r.plaka, r.name]));
  const etk = require('./etkinlik').aktifEtkinlik(t);
  const hava = [];
  for (const p of SEHIRLER) {
    hava.push({ plaka: p, il: iller.get(p), ...((await dunya.ilHavasi(p)) || {}), ...((await db.get(`SELECT kod, ruzgar FROM hava_durumu WHERE plaka = ?`, p)) || {}) });
  }
  const v = {
    sayilar: { ...await sayilar(t), il: 81, ilce: 973, yoresel: Object.keys(YORESEL).length },
    akis: await akis(),
    hava: hava.filter((h) => h.ikon),
    etkinlik: etk ? { ad: etk.ad, ikon: etk.ikon, renk: etk.renk, aciklama: etk.aciklama } : null,
    yoresel: Object.values(YORESEL).map((y) => ({ ad: y.ad, ikon: y.ikon, il: iller.get(y.il), plaka: y.il })),
    sponsorlar: (await require('./carsi').markalar(t)).filter((m) => m.sponsor).map(({ ad, ikon, logo, renk, tur }) => ({ ad, ikon, logo, renk, tur })),
  };
  onbellek = { t, v };
  return v;
}

function rotalar(app, { h }) {
  app.get('/api/tanitim', h(() => tanitim()));
}

module.exports = { rotalar, tanitim };
