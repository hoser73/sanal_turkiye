// Web push bildirimleri (VAPID). Anahtarlar VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY ortamından gelir; geliştirmede bir kez üretilip
// ayarlar tablosunda saklanır. Bildirim metni push servisine (tarayıcı üreticisinin sunucusu) şifreli gider.
const webpush = require('web-push');
const db = require('./db');
const { yol } = require('./lib/olaylar');
const { OyunHatasi } = require('./lib/ledger');

let anahtarlar = null;
function vapid() {
  if (anahtarlar) return anahtarlar;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    anahtarlar = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  } else {
    const kayit = db.prepare(`SELECT deger FROM ayarlar WHERE anahtar = 'vapid'`).get();
    anahtarlar = kayit ? JSON.parse(kayit.deger) : webpush.generateVAPIDKeys();
    if (!kayit) db.prepare(`INSERT INTO ayarlar (anahtar, deger) VALUES ('vapid', ?)`).run(JSON.stringify(anahtarlar));
  }
  webpush.setVapidDetails(process.env.VAPID_KONU || 'mailto:destek@sanalturkiye.test', anahtarlar.publicKey, anahtarlar.privateKey);
  return anahtarlar;
}

// Testlerde gerçek ağ yerine sahte gönderici takılabilir
let gonderici = (abonelik, yuk) => { vapid(); return webpush.sendNotification(abonelik, yuk, { TTL: 3600 }); };
const gondericiAyarla = (fn) => { gonderici = fn; };

// Sunucu bildirimi abonelik adresine POST eder: adres yalnızca tarayıcı üreticilerinin push servisleri olabilir (yoksa
// oyuncu herhangi bir adresi, ör. iç ağdaki bir hizmeti, sunucuya çağırtabilirdi)
const PUSH_SERVISLERI = /(^|\.)(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/;
function pushAdresiMi(endpoint) {
  try { const u = new URL(endpoint); return u.protocol === 'https:' && !u.port && PUSH_SERVISLERI.test(u.hostname); } catch { return false; }
}
function abone(userId, govde = {}) {
  const ab = govde.abonelik || govde;
  const endpoint = ab?.endpoint, p256dh = ab?.keys?.p256dh, auth = ab?.keys?.auth;
  if (typeof endpoint !== 'string' || endpoint.length > 1000 || !pushAdresiMi(endpoint)) throw new OyunHatasi(400, 'Geçersiz abonelik');
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || p256dh.length > 200 || auth.length > 100) throw new OyunHatasi(400, 'Geçersiz abonelik anahtarı');
  db.prepare(`INSERT INTO push_abonelikleri (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
              ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`).run(userId, endpoint, p256dh, auth);
  return { tamam: true };
}
function iptal(userId, govde = {}) {
  db.prepare(`DELETE FROM push_abonelikleri WHERE user_id = ? AND endpoint = ?`).run(userId, String(govde.endpoint || ''));
  return { tamam: true };
}

async function kullaniciyaGonder(userId, { baslik = 'Sanal Türkiye', metin, link }) {
  const abonelikler = db.prepare(`SELECT * FROM push_abonelikleri WHERE user_id = ?`).all(userId);
  const yuk = JSON.stringify({ baslik, metin, link });
  await Promise.all(abonelikler.map(async (a) => {
    try { await gonderici({ endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } }, yuk); } catch (e) {
      // 404/410: abonelik artık geçersiz → sil
      if (e.statusCode === 404 || e.statusCode === 410) db.prepare(`DELETE FROM push_abonelikleri WHERE id = ?`).run(a.id);
      else if (!process.env.SESSIZ) console.warn('Push gönderilemedi:', e.statusCode || e.message);
    }
  }));
  return abonelikler.length;
}

// Her bildirim, cihaz aboneliği olan oyuncuya push olarak da gider (çevrimiçi sekme varsa servis çalışanı göstermez)
yol.on('bildirim', (b) => { kullaniciyaGonder(b.userId, { metin: b.metin, link: b.link }).catch(() => {}); });

function rotalar(app, { h, auth }) {
  app.get('/api/push/anahtar', h(() => ({ publicKey: vapid().publicKey })));
  app.post('/api/push/abone', auth.girisGerekli, h((req) => abone(req.kullanici.id, req.body)));
  app.post('/api/push/iptal', auth.girisGerekli, h((req) => iptal(req.kullanici.id, req.body)));
}

module.exports = { rotalar, abone, iptal, kullaniciyaGonder, gondericiAyarla, vapid };
