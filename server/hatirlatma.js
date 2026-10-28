// Geri çağıran bildirimler: hasadı gelen tarla, ürünü hazır hayvanlar, süresi dolmak üzere olan sipariş. Her olay için
// bir kez (hatirlatmalar tablosu), oyuncu başına tek iletide toplanır; gece 23.00–08.00 (Türkiye saati) gönderilmez,
// sabah toplu gelir. Oyuncu Hesabım → Oyun ayarları'ndan kapatabilir. Bildirim canlı bağlantıya ve web push'a gider.
// Ayrıca öğretici rehber için yakındaki boş tarla önerisi.
const db = require('./db');
const { HATIRLATMA, URUNLER, YAPILAR, HAYVANLAR } = require('./config/rules');

db.exec(`CREATE TABLE IF NOT EXISTS hatirlatmalar (
  anahtar TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  at      INTEGER NOT NULL
)`);

const trSaat = (t) => new Date(t + 3 * 3600_000).getUTCHours();
const sessizMi = (t) => { const s = trSaat(t), [a, b] = HATIRLATMA.sessiz; return s >= a || s < b; };
const izinli = (userId) => {
  const u = db.prepare(`SELECT ayarlar, is_npc, status FROM users WHERE id = ?`).get(userId);
  if (!u || u.is_npc || u.status === 'DELETED') return false;
  try { return JSON.parse(u.ayarlar || '{}').hatirlatma !== false; } catch { return true; }
};

function bakim(t = Date.now()) {
  if (sessizMi(t)) return 0;
  const adaylar = new Map();   // user → [{ anahtar, metin, link }]
  const ekle = (userId, anahtar, metin, link) => {
    if (db.prepare(`SELECT 1 FROM hatirlatmalar WHERE anahtar = ?`).get(anahtar)) return;
    if (!adaylar.has(userId)) adaylar.set(userId, []);
    adaylar.get(userId).push({ anahtar, metin, link });
  };
  // Hasat hazır (son 2 günde olgunlaşan, henüz hasat edilmemiş)
  for (const e of db.prepare(`SELECT c.id, c.user_id, c.parcel_id, c.crop_type, r.name AS mahalle FROM crops c JOIN parcels p ON p.id = c.parcel_id
                              JOIN regions r ON r.id = p.region_id WHERE c.status = 'GROWING' AND c.ready_at <= ? AND c.ready_at > ?`).all(t, t - 2 * 86400_000)) {
    ekle(e.user_id, `ekin:${e.id}`, `🧺 ${e.mahalle} tarlanda ${URUNLER[e.crop_type]?.ad || 'ekin'} hasada hazır`, `parsel:${e.parcel_id}`);
  }
  // Hayvan ürünü hazır
  for (const h of db.prepare(`SELECT b.structure_id, b.user_id, b.hazir_at, s.type, s.parcel_id FROM hayvan_bakim b JOIN structures s ON s.id = b.structure_id
                              WHERE b.durum = 'BESLENDI' AND b.hazir_at <= ? AND b.hazir_at > ?`).all(t, t - 2 * 86400_000)) {
    const urun = URUNLER[HAYVANLAR[h.type]?.urun];
    ekle(h.user_id, `hayvan:${h.structure_id}:${h.hazir_at}`, `${urun?.ikon || '🧺'} ${YAPILAR[h.type]?.ad || 'Barınak'}: ${urun ? urun.ad.toLocaleLowerCase('tr-TR') : 'ürünler'} toplanmayı bekliyor`, `parsel:${h.parcel_id}`);
  }
  // Sipariş bitmek üzere (teslim edilebilir durumda olmasa da)
  for (const s of db.prepare(`SELECT id, user_id, musteri, son FROM siparisler WHERE durum = 'ACIK' AND son > ? AND son <= ?`).all(t, t + HATIRLATMA.siparisUyariMs)) {
    ekle(s.user_id, `siparis:${s.id}`, `📋 ${s.musteri} siparişinin süresi bir saat içinde doluyor`, 'gorevler');
  }
  let n = 0;
  for (const [userId, liste] of adaylar) {
    const kayit = db.prepare(`INSERT OR IGNORE INTO hatirlatmalar (anahtar, user_id, at) VALUES (?, ?, ?)`);
    for (const x of liste) kayit.run(x.anahtar, userId, t);
    if (!izinli(userId)) continue;
    const metin = liste.length === 1 ? liste[0].metin : `${liste[0].metin} · ve ${liste.length - 1} hatırlatma daha`;
    require('./pazar').bildir(userId, metin, liste[0].link);
    n++;
  }
  return n;
}

let zaman = null;
function baslat() {
  if (zaman || process.env.HATIRLATMA === 'kapali') return;
  zaman = setInterval(() => { try { bakim(); } catch (e) { require('./lib/gunluk').gunluk.warn('hatırlatma bakımı', { hataIletisi: e.message }); } }, HATIRLATMA.aralikMs);
  zaman.unref?.();
}

// Rehber: oyuncunun baktığı yere yakın, sahipsiz bir tarım hücresi
// Yalnızca Türkiye içindeki bir nokta için, kısa yarıçapta (≈1 km) arar: yurt dışı / deniz noktaları karo hesaplatamaz
async function tarlaOner(lon, lat) {
  lon = Number(lon); lat = Number(lat);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || !require('./harita/sinirlar').ilceBul(lon, lat)) return { parsel: null };
  const { hucreAra } = require('./harita/parsel');
  const [id] = await hucreAra(lon, lat, ['TARIM'], 1, 1, 24);
  return { parsel: id || null };
}

function rotalar(app, { h, auth }) {
  app.get('/api/oneri/tarla', auth.girisGerekli, h((req) => tarlaOner(req.query.lon, req.query.lat)));
}

module.exports = { rotalar, bakim, baslat, sessizMi, tarlaOner };
