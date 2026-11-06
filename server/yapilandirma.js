// Üretim yapılandırma denetimi: NODE_ENV=production iken eksik ya da güvensiz ayarla sunucu AÇILMAZ (yarım güvenlikle yayına
// çıkmaktansa başlamamak daha iyidir). Uyarılar (isteğe bağlı özellikler) açılışı durdurmaz.
// v0.47'de kaldırılan siyaset ayarları: tanımlıysa etkisizdir, .env'den silinmeleri için uyarılır
const KALDIRILAN = ['SIYASET', 'SECIM_HIZI', 'SECIM_MIN_SECMEN', 'BELEDIYE_MIN_SECMEN'];
// Yalnızca testlerin kullandığı kısayollar (test/yardimci.js): üretimde açılışı durdurmaz ama mutlaka bilinmeli
const TEST_KISAYOLLARI = { ONBELLEK: 'kapali', HATIRLATMA: 'kapali', MINI_ETKINLIK: 'kapali', SESSIZ: null, GUNLUK_SESSIZ: null };
const pozitif = (v) => Number.isFinite(Number(v)) && Number(v) > 0;

function uretimDenetimi(env = process.env) {
  const hatalar = [], uyarilar = [];
  if (env.NODE_ENV !== 'production') return { hatalar, uyarilar, uretim: false };
  const url = env.TABAN_URL || '';
  if (!/^https:\/\/[^/]+/.test(url)) hatalar.push('TABAN_URL https:// ile başlayan kamu adresi olmalı (e-posta bağlantıları, passkey ve CSP için)');
  if (!/^[0-9a-f]{64}$/i.test(env.SIFRELEME_ANAHTARI || '')) hatalar.push('SIFRELEME_ANAHTARI 64 hex karakter olmalı (openssl rand -hex 32)');
  if (!/^smtps?:\/\//.test(env.SMTP_URL || '')) hatalar.push('SMTP_URL tanımlı olmalı (smtp:// ya da smtps://); yoksa doğrulama ve sıfırlama e-postaları gitmez');
  if (!env.POSTA_GONDEREN) uyarilar.push('POSTA_GONDEREN tanımlı değil; varsayılan (geçersiz) gönderen adresi kullanılacak');
  // Geliştirme ve test kısayolları
  if (env.OTOMATIK_DOGRULA === '1') hatalar.push('OTOMATIK_DOGRULA=1 üretimde kullanılamaz');
  if (env.YONETICI_2FA_ZORUNLU === '0') hatalar.push('YONETICI_2FA_ZORUNLU=0 üretimde kullanılamaz');
  if (env.KIMLIK_HIZ_CARPANI && !(pozitif(env.KIMLIK_HIZ_CARPANI) && Number(env.KIMLIK_HIZ_CARPANI) <= 1)) hatalar.push('KIMLIK_HIZ_CARPANI üretimde 0’dan büyük ve en çok 1 olmalı');
  if (env.KARO_KAYNAGI === 'sahte') hatalar.push('KARO_KAYNAGI=sahte üretimde kullanılamaz (testlerin yapay imar deseni)');
  if (env.HAVA_KAYNAGI === 'sahte') hatalar.push('HAVA_KAYNAGI=sahte üretimde kullanılamaz (testlerin yapay havası)');
  if (env.OYUN_HIZI && !pozitif(env.OYUN_HIZI)) hatalar.push('OYUN_HIZI pozitif bir sayı olmalı');
  else if (env.OYUN_HIZI && Number(env.OYUN_HIZI) !== 1) uyarilar.push(`OYUN_HIZI=${env.OYUN_HIZI}: oyun süreleri hızlandırılmış`);
  for (const ad of ['API_HIZ_SINIRI', 'AGIR_HIZ_SINIRI', 'WS_IP_SINIRI', 'WS_TOPLAM_SINIRI']) {
    if (env[ad] && !pozitif(env[ad])) hatalar.push(`${ad} pozitif bir sayı olmalı`);
  }
  if (env.BAKIM_ARALIGI_MS === '0') uyarilar.push('BAKIM_ARALIGI_MS=0: bakım işleri her API isteğinde çalışır (yalnızca testler için)');
  const test = Object.entries(TEST_KISAYOLLARI).filter(([ad, deger]) => env[ad] && (deger === null || env[ad] === deger)).map(([ad]) => ad);
  if (test.length) uyarilar.push(`Test kısayolları tanımlı: ${test.join(', ')} (üretimde gerekmez)`);
  const eski = KALDIRILAN.filter((ad) => env[ad] !== undefined);
  if (eski.length) uyarilar.push(`Kaldırılan ayarlar artık etkisiz, .env'den silin: ${eski.join(', ')}`);
  // İsteğe bağlı hizmetler
  if (!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY)) uyarilar.push('VAPID anahtarları yok; web push anahtarları veritabanında üretilecek (yedekten dönüşte abonelikler geçersiz kalabilir)');
  else if (!/^(mailto:|https:\/\/)/.test(env.VAPID_KONU || '')) uyarilar.push('VAPID_KONU tanımlı değil (mailto:destek@alanadi); push servisleri iletişim adresi ister');
  if (!env.SILINEN_KIMLIK_TUZU) uyarilar.push('SILINEN_KIMLIK_TUZU tanımlı değil; silinen hesap özetleri varsayılan tuzla tutulur (yayından önce belirleyin, sonra değiştirmeyin)');
  if (!env.ANTHROPIC_API_KEY && !env.ANTHROPIC_AUTH_TOKEN && env.YAPAY_ZEKA !== 'kapali') uyarilar.push('ANTHROPIC_API_KEY yok; yapay zekâ özellikleri kural tabanlı yedekle çalışır');
  if ((env.HAVA_KAYNAGI || 'open-meteo') === 'open-meteo') uyarilar.push('Open-Meteo ücretsiz uç noktası ticari olmayan kullanım içindir; ticari yayında abonelik gerekir');
  if (!env.VERI_DIZINI) uyarilar.push('VERI_DIZINI tanımlı değil; veri uygulama klasöründeki data/ altında tutulacak');
  // Giriş yolları (docs/giris-yollari.md)
  if (!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)) uyarilar.push('Google ile giriş kapalı (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET yok)');
  if (!(env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY)) uyarilar.push('Apple ile giriş kapalı (APPLE_* ayarları yok)');
  if (env.SMS_SAGLAYICI !== 'netgsm') uyarilar.push('SMS sağlayıcısı yok; telefon doğrulama kapalı');
  else if (!(env.NETGSM_KULLANICI && env.NETGSM_SIFRE && env.NETGSM_BASLIK)) hatalar.push('SMS_SAGLAYICI=netgsm için NETGSM_KULLANICI, NETGSM_SIFRE ve NETGSM_BASLIK gerekli');
  if (env.TELEFON_ZORUNLU === '1' && env.SMS_SAGLAYICI !== 'netgsm') hatalar.push('TELEFON_ZORUNLU=1 için SMS sağlayıcısı gerekli');
  return { hatalar, uyarilar, uretim: true };
}

// Geliştirmede açılan demo hesabı (server/seed.js: demo@sanalturkiye.test / demo1234) veritabanı geliştirme kipinde
// kurulduysa üretimde de durur; parolası herkesçe bilindiği için üretim açılışında kapatılır. Kapatıldıysa true döner.
function demoHesabiKapat(db) {
  const u = db.prepare(`SELECT id FROM users WHERE email = 'demo@sanalturkiye.test' AND (password_hash IS NOT NULL OR status = 'ACTIVE')`).get();
  if (!u) return false;
  db.transaction(() => {
    db.prepare(`UPDATE users SET password_hash = NULL, status = 'SUSPENDED' WHERE id = ?`).run(u.id);
    db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(u.id);
  })();
  return true;
}

module.exports = { uretimDenetimi, demoHesabiKapat, KALDIRILAN };
