// Üretim yapılandırma denetimi: NODE_ENV=production iken eksik ya da güvensiz ayarla sunucu AÇILMAZ (yarım güvenlikle yayına
// çıkmaktansa başlamamak daha iyidir). Uyarılar (isteğe bağlı özellikler) açılışı durdurmaz.
function uretimDenetimi(env = process.env) {
  const hatalar = [], uyarilar = [];
  if (env.NODE_ENV !== 'production') return { hatalar, uyarilar, uretim: false };
  const url = env.TABAN_URL || '';
  if (!/^https:\/\/[^/]+/.test(url)) hatalar.push('TABAN_URL https:// ile başlayan kamu adresi olmalı (e-posta bağlantıları ve CSP için)');
  if (!/^[0-9a-f]{64}$/i.test(env.SIFRELEME_ANAHTARI || '')) hatalar.push('SIFRELEME_ANAHTARI 64 hex karakter olmalı (openssl rand -hex 32)');
  if (!/^smtps?:\/\//.test(env.SMTP_URL || '')) hatalar.push('SMTP_URL tanımlı olmalı (smtp:// ya da smtps://); yoksa doğrulama ve sıfırlama e-postaları gitmez');
  if (!env.POSTA_GONDEREN) uyarilar.push('POSTA_GONDEREN tanımlı değil; varsayılan gönderen adresi kullanılacak');
  if (env.OTOMATIK_DOGRULA === '1') hatalar.push('OTOMATIK_DOGRULA=1 üretimde kullanılamaz');
  if (env.YONETICI_2FA_ZORUNLU === '0') hatalar.push('YONETICI_2FA_ZORUNLU=0 üretimde kullanılamaz');
  if (env.KIMLIK_HIZ_CARPANI && Number(env.KIMLIK_HIZ_CARPANI) > 1) hatalar.push('KIMLIK_HIZ_CARPANI üretimde 1’den büyük olamaz');
  if (env.SECIM_HIZI && Number(env.SECIM_HIZI) !== 1) uyarilar.push(`SECIM_HIZI=${env.SECIM_HIZI}: seçim takvimi hızlandırılmış`);
  if (env.OYUN_HIZI && Number(env.OYUN_HIZI) !== 1) uyarilar.push(`OYUN_HIZI=${env.OYUN_HIZI}: oyun süreleri hızlandırılmış`);
  if (!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY)) uyarilar.push('VAPID anahtarları yok; web push anahtarları veritabanında üretilecek (yedekten dönüşte abonelikler geçersiz kalabilir)');
  if (!env.ANTHROPIC_API_KEY && env.YAPAY_ZEKA !== 'kapali') uyarilar.push('ANTHROPIC_API_KEY yok; yapay zekâ özellikleri kural tabanlı yedekle çalışır');
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

module.exports = { uretimDenetimi };
