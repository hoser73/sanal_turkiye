# Yayına alma

Tek sunucuda (2 vCPU / 2–4 GB RAM, 20 GB disk yeterli bir VPS) Docker ile kurulum. SQLite (WAL) tek sunucuda binlerce
eşzamanlı oyuncuyu taşır; çok sunucuya geçmeden PostgreSQL gerekmez (bkz. docs/olcekleme.md, docs/postgres-gecisi.md).

## 1. Önkoşullar

- Bir alan adı ve sunucunun IP'sine yönlenen `A` (varsa `AAAA`) kaydı. 80 ve 443 (TCP, HTTP/3 için 443/UDP) açık olmalı.
- Sunucuda Docker ve Docker Compose eklentisi.
- Bir SMTP sağlayıcısı (ör. Amazon SES, Brevo, Postmark, Resend SMTP). Gönderen alan adı için **SPF, DKIM ve DMARC**
  kayıtlarını sağlayıcının yönergesine göre ekleyin; yoksa doğrulama e-postaları spam'e düşer.
- Sunucunun dışarıya erişebilmesi gereken adresler: `tiles.openfreemap.org` (imar ve mahalle verisi; kendi karo sunucunuz
  varsa o), `s3.amazonaws.com` (yükselti karoları), `api.open-meteo.com` (hava), SMTP sağlayıcısı; kullanılıyorsa
  `api.anthropic.com`, Google/Apple, `api.netgsm.com.tr`, tarayıcı push servisleri.

## 2. Ayarlar

```bash
cp .env.ornek .env
openssl rand -hex 32               # SIFRELEME_ANAHTARI
openssl rand -hex 16               # SILINEN_KIMLIK_TUZU
npx web-push generate-vapid-keys   # VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
chmod 600 .env
```

`.env` dosyasını doldurun. Sunucu üretimde (`NODE_ENV=production`) eksik ya da güvensiz ayarla **başlamaz**, nedenini
günlüğe yazar (`server/yapilandirma.js`); isteğe bağlı eksikler yalnızca uyarıdır.

| Değişken | Durum | Açıklama |
|---|---|---|
| `NODE_ENV=production` | zorunlu | Güvenli çerez, `trust proxy`, geliştirme uçlarının kapanması, açılış denetimi |
| `TABAN_URL` | zorunlu | `https://alan-adi` — e-posta bağlantıları, passkey (WebAuthn) kökeni, CSP, HSTS |
| `ALAN_ADI` | Docker | Caddy'nin sertifika alacağı ad (TABAN_URL ile aynı alan) |
| `SIFRELEME_ANAHTARI` | zorunlu | 64 hex; 2FA sırlarını ve telefon numaralarını şifreler. **Yedekte yoktur, ayrıca saklayın** |
| `SMTP_URL`, `POSTA_GONDEREN` | zorunlu | `smtps://kullanici:parola@sunucu:465`; gönderen adresi SPF/DKIM'li alan adından |
| `VERI_DIZINI` | önerilen | Docker'da `/veri` (imajda hazır); systemd'de `/var/lib/sanalturkiye` |
| `SILINEN_KIMLIK_TUZU` | önerilen | Silinen hesapların e-posta/telefon özetleri için tuz. Yayından önce belirleyin, **sonra değiştirmeyin** |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_KONU` | önerilen | Web push; yoksa anahtar veritabanında üretilir |
| `ANTHROPIC_API_KEY` (`YAPAY_ZEKA=kapali`, `YZ_MODEL`) | isteğe bağlı | Yapay zekâ; yoksa kural tabanlı yedek çalışır |
| `GOOGLE_CLIENT_ID/SECRET`, `APPLE_CLIENT_ID/TEAM_ID/KEY_ID/PRIVATE_KEY` | isteğe bağlı | Google/Apple ile giriş (docs/giris-yollari.md). Dönüş adresi: `TABAN_URL/api/oauth/<google\|apple>/donus` |
| `SMS_SAGLAYICI=netgsm`, `NETGSM_*`, `TELEFON_ZORUNLU` | isteğe bağlı | Telefon doğrulama; netgsm seçilip bilgiler eksikse açılmaz |
| `HAVA_KAYNAGI`, `NUFUS`, `VEKTOR_TILEJSON`, `HARF_KARO`, `YUKSELTI_KARO`, `YUKSELTI_KAYNAGI`, `EK_KARO_KOKENLERI`, `TARLA_ILCELERI` | isteğe bağlı | Hava, demo sakinler, kendi karo sunucusu (docs/karo-sunucusu.md), deneme ilçeleri |
| `API_HIZ_SINIRI`, `AGIR_HIZ_SINIRI`, `WS_IP_SINIRI`, `WS_TOPLAM_SINIRI`, `GUNLUK_DUZEYI` | isteğe bağlı | Sınırlar (pozitif sayı) ve günlük düzeyi |

**Yalnızca geliştirme/test** (üretimde açılışı durdurur ya da uyarır): `OTOMATIK_DOGRULA=1`, `YONETICI_2FA_ZORUNLU=0`,
`KIMLIK_HIZ_CARPANI` > 1, `KARO_KAYNAGI=sahte`, `HAVA_KAYNAGI=sahte`, `OYUN_HIZI` ≠ 1, `BAKIM_ARALIGI_MS=0`,
`ONBELLEK=kapali`, `HATIRLATMA=kapali`, `MINI_ETKINLIK=kapali`, `SESSIZ`, `GUNLUK_SESSIZ`.

**Kaldırılan** (v0.47, etkisiz; tanımlıysa açılışta uyarılır, `.env`'den silin): `SIYASET`, `SECIM_HIZI`, `SECIM_MIN_SECMEN`,
`BELEDIYE_MIN_SECMEN`.

Üretimde kendiliğinden kapalı olanlar: geliştirme posta/SMS kutuları (`/api/gelistirici/*`), demo hesabı
(`demo@sanalturkiye.test` yalnızca geliştirmede açılır; geliştirme kipinde kurulmuş bir veritabanında bulunursa açılışta
kapatılır), SMS geliştirme kodu, `npm run akce` (oyun parası basma).

## 3. Başlatma

```bash
docker compose up -d --build
docker compose logs -f uygulama     # "yapılandırma uyarısı" satırlarını okuyun
curl https://ALAN_ADI/api/saglik
```

Caddy, uygulama sağlıklı olunca başlar; Let's Encrypt sertifikasını kendisi alır ve yeniler, WebSocket (`/canli`) dahil
tüm trafiği uygulamaya iletir. Uygulama `trust proxy` ile gerçek istemci IP'sini görür (hız sınırları, canlı bağlantı
sınırı, oturum listesi).

İlk açılışta: bölgeler (81 il, 973 ilçe) kurulur, demo komşular yerleşir ve arsa konum değerleri (kıyı, merkez, yükselti)
arka planda hesaplanır; bu sırada imar ve yükselti karoları indirilip veri biriminde (`karolar/`, `yukselti/`) önbelleğe
alınır. Sunucu bu sırada hizmet verir.

İsteğe bağlı — deneme ilçelerine gerçek tarla sınırları (Fields of the World, CC-BY-4.0; Meram ≈ 8,5 MB indirir):

```bash
docker compose exec uygulama node scripts/tarla-aktar.js 42:Meram
```

## 4. İlk yönetici

1. Sitede normal bir hesap açın, e-postanızı doğrulayın, **Hesabım → Güvenlik**'ten iki adımlı doğrulamayı kurun
   (yetkili hesaplarda zorunludur; kapatılamaz).
2. Rolü sunucuda verin:
   ```bash
   docker compose exec uygulama node scripts/rol-ver.js eposta@ornek.com ADMIN
   ```
3. `/yonetim.html` panelini açın. Sonraki moderatör ve denetçileri panelden atayabilirsiniz. Hesap askısı ve parsel
   dondurma iki kişi kuralıyla çalışır: en az iki yetkili atayın.

## 5. E-posta testi

```bash
docker compose exec uygulama node scripts/posta-dene.js sizin@adresiniz.com
```

Gelen kutusuna HTML biçimli deneme iletisi gelmelidir. Gönderilemeyen iletiler `giden_postalar` tablosunda kalır ve
artan aralıklarla (1, 5, 30 dk, 2 sa) yeniden denenir; kuyruk durumu yönetim panelindedir. Gönderilmiş iletiler 30 gün
sonra silinir.

## 6. Veri birimi

Docker'da `veri` birimi (`/veri`), systemd'de `/var/lib/sanalturkiye`:

| Yol | İçerik | Yedek |
|---|---|---|
| `sanalturkiye-tr.db` (+ `-wal`, `-shm`) | Bütün oyun verisi | **evet** (`scripts/yedek.js`) |
| `yedekler/` | Günlük yedekler (gzip, 14 gün döner) | sunucu dışına kopyalayın |
| `gunluk/hatalar.jsonl` | Sunucu ve istemci hataları (5 MB'ta döner) | hayır |
| `karolar/`, `yukselti/` | İmar ve yükselti karo önbelleği | hayır (yeniden indirilir) |
| `ftw/` | Tarla sınırı kaynağı (`tarla-aktar`) | hayır |

Geliştirmede anahtar yoksa `.sifreleme-anahtari` dosyası üretilir; üretimde kullanılmaz (anahtar ortamdan gelir).

## 7. Güncelleme (yeni sürüm)

```bash
docker compose exec -T uygulama node scripts/yedek.js        # önce yedek
git pull
docker compose up -d --build
docker compose logs -f uygulama
```

Veritabanı geçişleri açılışta kendiliğinden ve bir kez uygulanır; bazıları geri alınamaz, bu yüzden güncellemeden önce
yedek şarttır. v0.50'ye geçerken bilinmesi gerekenler:

- v0.47: siyaset (seçim, belediye, referandum, görevden alma) tabloları silinir; eski siyasi olaylar akışta gösterilmez.
- v0.48: arsa fiyatı konuma göre; konum değerleri arka planda doldurulur (yükselti karoları indirilir: `yukselti/`).
- v0.49–v0.50: oyun parası TL görünümünde; kayıtlı arsa tutarları yeni ölçeğe bir kez çevrilir (`server/para-gecisi.js`,
  günlükte "para dengesi geçişi (v0.50) uygulandı").
- Yasal metin sürümleri arttıysa oyunculardan girişte yeniden onay istenir.

## 8. Yedekleme ve geri yükleme

- Günlük çevrimiçi yedek: `deploy/yedek.cron` (sunucu çalışırken güvenlidir; bütünlük denetimi yapılır).
- Yedekler veri biriminde `yedekler/` altında tutulur. **Sunucu dışına kopyalayın** (ör. `rclone` ile nesne deposuna);
  aynı diskteki yedek disk arızasına karşı korumaz. `SIFRELEME_ANAHTARI` yedekte yoktur.
- Geri yükleme (önce `--onayla` olmadan çalıştırıp bütünlük ve defter denetimini görün; mevcut veritabanı silinmez,
  `onceki-<zaman>.db` olarak kenara alınır):
  ```bash
  docker compose stop uygulama
  docker compose run --rm uygulama node scripts/geri-yukle.js /veri/yedekler/<dosya>.db.gz
  docker compose run --rm uygulama node scripts/geri-yukle.js /veri/yedekler/<dosya>.db.gz --onayla
  docker compose start uygulama
  ```
  systemd'de: `systemctl stop sanalturkiye`, `VERI_DIZINI=/var/lib/sanalturkiye node scripts/geri-yukle.js <yedek> --onayla`,
  `systemctl start sanalturkiye`.

## 9. İzleme

- `GET /api/saglik`: durum, sürüm, çalışma süresi, bellek, canlı bağlantı sayısı; veritabanı okunamıyorsa 503 (Docker
  sağlık denetimi bunu kullanır).
- Günlükler JSON satırlarıdır (`docker compose logs`); sunucu hataları ayrıca `/veri/gunluk/hatalar.jsonl` dosyasına ve
  yönetim panelinin **Sistem** sekmesine düşer. İstemci tarafı hatalar da raporlanır. Günlüğe e-posta, parola, çerez ve IP yazılmaz.
- Harici bir çalışma süresi izleyicisini (UptimeRobot vb.) `/api/saglik` adresine bağlayın.

## 10. Docker'sız kurulum (systemd)

`deploy/sanalturkiye.service`: uygulama `/opt/sanalturkiye` (`npm ci --omit=dev`, Node 24), veri `/var/lib/sanalturkiye`
(sahibi `sanalturkiye` kullanıcısı), gizli ayarlar `/etc/sanalturkiye.env` (chmod 600). Birim `NODE_ENV` ve `VERI_DIZINI`'ni
kendisi verir; yazılabilir tek yer veri dizinidir. Önüne Caddy (`deploy/Caddyfile`, `uygulama:3400` yerine `127.0.0.1:3400`)
ya da nginx koyun; WebSocket yükseltmesini iletmeyi ve `X-Forwarded-For`'u istemcinin değil vekilin yazmasını sağlayın.

## 11. Yerleşik güvenlik (bilgi)

- Çerezler `HttpOnly`, `SameSite=Lax`, üretimde `Secure`; durum değiştiren API istekleri başka bir kökenden gelirse reddedilir.
- CSP (`script-src 'self'`, `frame-ancestors 'none'`), HSTS (https'te), `nosniff`, `Referrer-Policy: no-referrer`.
- Hız sınırları: genel API (IP/dk 600), giriş/kayıt, parola sıfırlama, 2FA, telefon, ağır uçlar, WebSocket (IP başına 8).
- Parolalar bcrypt; 2FA (TOTP) sırları ve telefonlar AES-256-GCM; oturum ve e-posta bağlantılarının yalnızca özeti saklanır.
  Yetkili hesaplarda 2FA zorunlu; hassas işlemler son 15 dakikada açılmış oturum ister.
- Web push yalnızca tarayıcı üreticilerinin push servislerine gider.
- KVKK: Hesabım → Gizlilik'te veri dışa aktarma ve hesap silme (kimlik silinir, ekonomi defteri anonim kalır).

## 12. Yayın öncesi kontrol listesi

- [ ] Açılış günlüğünde "yapılandırma hatası" yok; uyarılar okunup kabul edildi.
- [ ] Yasal metinler hukukçu tarafından onaylandı (docs/hukuk-kontrol-listesi.md); `public/yasal/*` içindeki veri sorumlusu
      bilgileri dolduruldu, "taslak" ibareleri kaldırıldı ve `YASAL` sürümleri artırıldı.
- [ ] SMTP ile doğrulama ve sıfırlama e-postası denendi, spam'e düşmüyor (SPF/DKIM/DMARC).
- [ ] İlk yönetici 2FA ile panele girebiliyor; en az iki yetkili var.
- [ ] Yedek alındı, sunucu dışına kopyalandı, başka bir makinede geri yüklenip denendi.
- [ ] `SIFRELEME_ANAHTARI` ve `.env` parola yöneticisinde/kasada ayrıca saklı.
- [ ] Open-Meteo kullanım koşulları (ticari kullanımda abonelik) ve harita karo sağlayıcısının adil kullanım koşulları gözden
      geçirildi; yüksek trafik bekleniyorsa kendi karo sunucusu (docs/karo-sunucusu.md).
- [ ] `ANTHROPIC_API_KEY` kullanılacaksa KVKK metninde yurt dışı aktarım belirtildi.
- [ ] Google/Apple girişi açılacaksa dönüş adresleri sağlayıcı panelinde kayıtlı, düğmeler marka kurallarına uygun.
- [ ] Mobil uygulama `--dart-define=SUNUCU=https://alan-adi` ile derlendi (mobil/README.md).

## 13. Yayından önce insanın yapması gerekenler

Bunlar koddan yapılamaz; sırası önemli değildir ama hepsi yayından önce bitmeli.

1. **Alan adı ve sunucu:** alan adını alın, VPS kiralayın (veri merkezi ülkesi KVKK metnine yazılacak), DNS `A`/`AAAA`
   kaydını sunucuya yönlendirin, 80/443'ü açın.
2. **E-posta:** SMTP sağlayıcısında hesap açın, gönderen alan adını doğrulayın, SPF/DKIM/DMARC kayıtlarını ekleyin,
   `SMTP_URL` ve `POSTA_GONDEREN`'i alın; destek adresi (`destek@…`) için bir posta kutusu açın.
3. **Anahtarlar:** `SIFRELEME_ANAHTARI`, `SILINEN_KIMLIK_TUZU`, VAPID anahtarlarını üretip parola yöneticisine kaydedin;
   isteğe bağlı olarak Anthropic API anahtarı (harcama sınırıyla), Google OAuth istemcisi, Apple Sign in (Services ID,
   anahtar .p8), Netgsm hesabı ve onaylı gönderici adı.
4. **Hukukçu:** docs/hukuk-kontrol-listesi.md'deki maddeleri inceletin; veri sorumlusu unvanı, adres, MERSİS, KEP,
   başvuru kanalı ve yurt dışı aktarım dayanağı belirlensin; VERBİS ve İYS kararları verilsin; koşullar, KVKK ve çerez
   metinleri son hâline getirilsin.
5. **Hizmet koşulları:** Open-Meteo ticari aboneliği (ya da `HAVA_KAYNAGI=kapali`), OpenFreeMap / karo kullanımı, Fields of
   the World atfı (CC-BY-4.0) ve OpenStreetMap (ODbL) atıflarının sitede göründüğü kontrol edilsin.
6. **Yedek hedefi:** sunucu dışı bir nesne deposu (S3 uyumlu) açın, `rclone`'u yapılandırın, geri yüklemeyi bir kez deneyin.
7. **İzleme:** çalışma süresi izleyicisini kurun, uyarıların gideceği e-posta/telefonu belirleyin.
8. **Yetkililer:** ilk yöneticiyi ve en az bir moderatörü belirleyin; şikâyetlere kimin, ne kadar sürede bakacağını kararlaştırın.
