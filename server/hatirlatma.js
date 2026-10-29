// Geri çağıran bildirimler: hasadı gelen tarla, ürünü hazır hayvanlar, süresi dolmak üzere olan sipariş. Her olay için
// bir kez (hatirlatmalar tablosu), oyuncu başına tek iletide toplanır; gece 23.00–08.00 (Türkiye saati) gönderilmez,
// sabah toplu gelir. Oyuncu Hesabım → Oyun ayarları'ndan kapatabilir. Bildirim canlı bağlantıya ve web push'a gider.
// Ayrıca öğretici rehber için yakındaki boş tarla önerisi.
const db = require('./db');
const { HATIRLATMA, URUNLER, YAPILAR, HAYVANLAR } = require('./config/rules');


const trSaat = (t) => new Date(t + 3 * 3600_000).getUTCHours();
const sessizMi = (t) => { const s = trSaat(t), [a, b] = HATIRLATMA.sessiz; return s >= a || s < b; };
const izinli = async (userId) => {
  const u = await db.get(`SELECT ayarlar, is_npc, status FROM users WHERE id = ?`, userId);
  if (!u || u.is_npc || u.status === 'DELETED') return false;
  try { return JSON.parse(u.ayarlar || '{}').hatirlatma !== false; } catch { return true; }
};

async function bakim(t = Date.now()) {
  if (sessizMi(t)) return 0;
  const adaylar = new Map();   // user → [{ anahtar, metin, link }]
  const ekle = async (userId, anahtar, metin, link) => {
    if (await db.get(`SELECT 1 FROM hatirlatmalar WHERE anahtar = ?`, anahtar)) return;
    if (!adaylar.has(userId)) adaylar.set(userId, []);
    adaylar.get(userId).push({ anahtar, metin, link });
  };
  // Hasat hazır (son 2 günde olgunlaşan, henüz hasat edilmemiş)
  for (const e of await db.all(`SELECT c.id, c.user_id, c.parcel_id, c.crop_type, r.name AS mahalle FROM crops c JOIN parcels p ON p.id = c.parcel_id
                              JOIN regions r ON r.id = p.region_id WHERE c.status = 'GROWING' AND c.ready_at <= ? AND c.ready_at > ? ORDER BY c.id`, t, t - 2 * 86400_000)) {
    await ekle(e.user_id, `ekin:${e.id}`, `🧺 ${e.mahalle} tarlanda ${URUNLER[e.crop_type]?.ad || 'ekin'} hasada hazır`, `parsel:${e.parcel_id}`);
  }
  // Hayvan ürünü hazır
  for (const h of await db.all(`SELECT b.structure_id, b.user_id, b.hazir_at, s.type, s.parcel_id FROM hayvan_bakim b JOIN structures s ON s.id = b.structure_id
                              WHERE b.durum = 'BESLENDI' AND b.hazir_at <= ? AND b.hazir_at > ? ORDER BY b.structure_id`, t, t - 2 * 86400_000)) {
    const urun = URUNLER[HAYVANLAR[h.type]?.urun];
    await ekle(h.user_id, `hayvan:${h.structure_id}:${h.hazir_at}`, `${urun?.ikon || '🧺'} ${YAPILAR[h.type]?.ad || 'Barınak'}: ${urun ? urun.ad.toLocaleLowerCase('tr-TR') : 'ürünler'} toplanmayı bekliyor`, `parsel:${h.parcel_id}`);
  }
  // Sipariş bitmek üzere (teslim edilebilir durumda olmasa da)
  for (const s of await db.all(`SELECT id, user_id, musteri, son FROM siparisler WHERE durum = 'ACIK' AND son > ? AND son <= ? ORDER BY id`, t, t + HATIRLATMA.siparisUyariMs)) {
    await ekle(s.user_id, `siparis:${s.id}`, `📋 ${s.musteri} siparişinin süresi bir saat içinde doluyor`, 'gorevler');
  }
  let n = 0;
  for (const [userId, liste] of adaylar) {
    // Kayıt ve bildirim aynı işlemde; yalnızca bu turda gerçekten yazılan anahtarlar bildirilir (başka sunucu aldıysa geç)
    const gonderildi = await db.tx(async () => {
      const yeni = [];
      for (const x of liste) {
        if ((await db.run(`INSERT OR IGNORE INTO hatirlatmalar (anahtar, user_id, at) VALUES (?, ?, ?)`, x.anahtar, userId, t)).changes === 1) yeni.push(x);
      }
      if (!yeni.length || !await izinli(userId)) return false;
      const metin = yeni.length === 1 ? yeni[0].metin : `${yeni[0].metin} · ve ${yeni.length - 1} hatırlatma daha`;
      await require('./pazar').bildir(userId, metin, yeni[0].link);
      return true;
    });
    if (gonderildi) n++;
  }
  return n;
}

let zaman = null;
async function baslat() {
  if (zaman || process.env.HATIRLATMA === 'kapali') return;
  zaman = setInterval(() => {
    db.tekOrnek('hatirlatma', () => bakim())
      .catch((e) => require('./lib/gunluk').gunluk.warn('hatırlatma bakımı', { hataIletisi: e.message }));
  }, HATIRLATMA.aralikMs);
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
