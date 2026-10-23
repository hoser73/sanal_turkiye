# Giriş ve kayıt yolları — kurulum

Oyun e-posta + parolayla her zaman çalışır. Aşağıdaki yollar, ilgili ayarlar girilince **kendiliğinden açılır**; ayar yoksa
düğmeleri görünmez. Tüm adresler `TABAN_URL` (ör. `https://sanalturkiye.com.tr`) üzerinden kurulur; üretimde https zorunludur.

## Google ile giriş
1. [Google Cloud Console](https://console.cloud.google.com/) → yeni proje → **APIs & Services → OAuth consent screen**: uygulama adı
   "Sanal Türkiye", destek e-postası, logo, gizlilik politikası ve kullanım koşulları adresleri (`/yasal/...`). Kapsamlar: `openid`, `email`, `profile`.
2. **Credentials → Create credentials → OAuth client ID → Web application**
   - Authorized JavaScript origins: `TABAN_URL`
   - Authorized redirect URI: `TABAN_URL/api/oauth/google/donus`
3. Ortam değişkenleri: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
4. Yayına almadan önce onay ekranını "Production" durumuna geçir (test modunda yalnızca eklenen test kullanıcıları girebilir).

## Apple ile giriş
Ücretli Apple Developer Program üyeliği gerekir.
1. **Certificates, Identifiers & Profiles → Identifiers**: bir App ID (Sign in with Apple açık) ve bir **Services ID** oluştur
   (ör. `tr.sanalturkiye.web`). Services ID'de Sign in with Apple → Configure: alan adı ve
   Return URL `TABAN_URL/api/oauth/apple/donus`.
2. **Keys**: Sign in with Apple yetkili bir anahtar oluştur, `.p8` dosyasını indir (bir kez indirilebilir).
3. Ortam değişkenleri: `APPLE_CLIENT_ID` (Services ID), `APPLE_TEAM_ID`, `APPLE_KEY_ID`,
   `APPLE_PRIVATE_KEY` (.p8 içeriği; tek satırda `\n` ile yazılabilir).
4. Apple dönüşü siteler arası POST olduğu için yalnızca https'te çalışır.
5. Düğmede Apple'ın resmî logosu ve "Apple ile devam et" metni kullanılmalı (Human Interface Guidelines); oyundaki çizim
   yer tutucudur, yayından önce Apple'ın resmî görseliyle değiştir. Google için de "Sign in with Google" marka kuralları geçerlidir.

## Passkey (şifresiz giriş)
Ek ayar gerekmez. Tarayıcı, passkey'i `TABAN_URL`'in alan adına bağlar; alan adı değişirse eski passkey'ler çalışmaz.
Yerelde `http://localhost` desteklenir.

## Telefon doğrulama (SMS)
- Geliştirmede SMS gönderilmez; kod ekranda ve `/api/gelistirici/sms` adresinde görünür.
- Üretimde: `SMS_SAGLAYICI=netgsm`, `NETGSM_KULLANICI`, `NETGSM_SIFRE`, `NETGSM_BASLIK` (BTK onaylı gönderici adı).
  Gönderim Netgsm REST v2 biçimiyle yazıldı (`server/sms.js`); **canlıya almadan önce Netgsm'in güncel belgesiyle doğrulanmalı.**
  Doğrulama kodu bilgilendirme iletisidir; İYS izni gerektirmez (ticari ileti değildir) — hukukçuyla teyit edin.
- `TELEFON_ZORUNLU=1`: değer aktaran işlemler (pazar, banka, komşuluk hediyeleri…) doğrulanmış telefon da ister.
- Numara AES-GCM ile şifreli saklanır (`SIFRELEME_ANAHTARI`), tekillik özetle denetlenir; KVKK aydınlatma metnine telefon
  numarasının işlenme amacı (hesap güvenliği, sahte hesapların önlenmesi) ve saklama süresi eklenmelidir.

## Güvenlik notları
- Google/Apple: tek kullanımlık `state` + `nonce`, tarayıcıya bağlı çerez (giriş CSRF'ine karşı), Google'da PKCE; kimlik jetonu
  sağlayıcının anahtarıyla doğrulanır (yayıncı, hedef, süre, nonce).
- Sağlayıcının doğruladığı e-posta mevcut bir hesaba aitse o hesaba bağlanır. O hesabın e-postası doğrulanmamışsa
  (başkası açmış olabilir) e-postanın kanıtlı sahibi devralır: parola, passkey'ler, bağlı hesaplar, 2FA ve oturumlar silinir.
  Parola sıfırlama bağlantısıyla doğrulama da aynı kuralı uygular.
- Hız sınırları: kayıt/giriş/passkey/OAuth 15 dakikada 30, telefon 15, ad denetimi 90 istek (IP başına);
  telefon kodu dakikada bir, günde en çok 5 (hesap ve numara başına), kod 5 dakika / 5 deneme.
