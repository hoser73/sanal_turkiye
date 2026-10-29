// Web push bildirimleri (VAPID). Anahtarlar VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY ortamından gelir; geliştirmede bir kez üretilip
// ayarlar tablosunda saklanır. Bildirim metni push servisine (tarayıcı üreticisinin sunucusu) şifreli gider.
const webpush = require('web-push');
const db = require('./db');
const { yol } = require('./lib/olaylar');
const { OyunHatasi } = require('./lib/ledger');

let anahtarlar = null;
async function vapid() {
  if (anahtarlar) return anahtarlar;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    anahtarlar = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  } else {
    let kayit = await db.get(`SELECT deger FROM ayarlar WHERE anahtar = 'vapid'`);
    if (!kayit) {
      // Çok sunucuda (ya da eşzamanlı iki istekte) ilk yazan kazanır; herkes kayıtlı olanı kullanır
      await db.run(`INSERT OR IGNORE INTO ayarlar (anahtar, deger) VALUES ('vapid', ?)`, JSON.stringify(webpush.generateVAPIDKeys()));
      kayit = await db.get(`SELECT deger FROM ayarlar WHERE anahtar = 'vapid'`);
    }
    anahtarlar = JSON.parse(kayit.deger);
  }
  webpush.setVapidDetails(process.env.VAPID_KONU || 'mailto:destek@sanalturkiye.test', anahtarlar.publicKey, anahtarlar.privateKey);
  return anahtarlar;
}

// Testlerde gerçek ağ yerine sahte gönderici takılabilir
let gonderici = async (abonelik, yuk) => { await vapid(); return webpush.sendNotification(abonelik, yuk, { TTL: 3600 }); };
const gondericiAyarla = (fn) => { gonderici = fn; };

async function abone(userId, govde = {}) {
  const ab = govde.abonelik || govde;
  const endpoint = ab?.endpoint, p256dh = ab?.keys?.p256dh, auth = ab?.keys?.auth;
  if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || endpoint.length > 1000) throw new OyunHatasi(400, 'Geçersiz abonelik');
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || p256dh.length > 200 || auth.length > 100) throw new OyunHatasi(400, 'Geçersiz abonelik anahtarı');
  await db.run(`INSERT INTO push_abonelikleri (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
              ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`, userId, endpoint, p256dh, auth);
  return { tamam: true };
}
async function iptal(userId, govde = {}) {
  await db.run(`DELETE FROM push_abonelikleri WHERE user_id = ? AND endpoint = ?`, userId, String(govde.endpoint || ''));
  return { tamam: true };
}

async function kullaniciyaGonder(userId, { baslik = 'Sanal Türkiye', metin, link }) {
  const abonelikler = await db.all(`SELECT * FROM push_abonelikleri WHERE user_id = ?`, userId);
  const yuk = JSON.stringify({ baslik, metin, link });
  await Promise.all(abonelikler.map(async (a) => {
    try { await gonderici({ endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } }, yuk); } catch (e) {
      // 404/410: abonelik artık geçersiz → sil
      if (e.statusCode === 404 || e.statusCode === 410) await db.run(`DELETE FROM push_abonelikleri WHERE id = ?`, a.id);
      else if (!process.env.SESSIZ) console.warn('Push gönderilemedi:', e.statusCode || e.message);
    }
  }));
  return abonelikler.length;
}

// Her bildirim, cihaz aboneliği olan oyuncuya push olarak da gider (çevrimiçi sekme varsa servis çalışanı göstermez)
yol.on('bildirim', async (b) => { await kullaniciyaGonder(b.userId, { metin: b.metin, link: b.link }).catch(() => {}); });

function rotalar(app, { h, auth }) {
  app.get('/api/push/anahtar', h(async () => ({ publicKey: (await vapid()).publicKey })));
  app.post('/api/push/abone', auth.girisGerekli, h((req) => abone(req.kullanici.id, req.body)));
  app.post('/api/push/iptal', auth.girisGerekli, h((req) => iptal(req.kullanici.id, req.body)));
}

module.exports = { rotalar, abone, iptal, kullaniciyaGonder, gondericiAyarla, vapid };
