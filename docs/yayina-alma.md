# Yayına alma

Docker Compose ile kurulum: uygulama + PostgreSQL 18 / PostGIS 3.6 + Caddy (2 vCPU / 4 GB RAM bir VPS başlangıç için
yeterli). Uygulama örneği sayısı `--scale` ile artırılabilir; olaylar ve bakım işleri Postgres üzerinden eşgüdümlenir
(bkz. docs/postgres-gecisi.md). Tek sunucuda Postgres'siz çalışmak isteyen `VERITABANI=sqlite` ile (8. bölüm) kurabilir.

## 1. Önkoşullar

- Bir alan adı ve sunucunun IP'sine yönlenen `A` kaydı.
- Sunucuda Docker ve Docker Compose eklentisi.
- Bir SMTP sağlayıcısı (ör. Amazon SES, Brevo, Postmark, Resend SMTP). Gönderen alan adı için **SPF, DKIM ve DMARC**
  kayıtlarını sağlayıcının yönergesine göre ekleyin; yoksa doğrulama e-postaları spam'e düşer.

## 2. Ayarlar

```bash
cp .env.ornek .env
openssl rand -hex 24          # POSTGRES_PAROLA
openssl rand -hex 32          # SIFRELEME_ANAHTARI
npx web-push generate-vapid-keys   # VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
```

`.env` dosyasını doldurun. Sunucu üretimde eksik ya da güvensiz ayarla **başlamaz** ve nedenini günlüğe yazar
(`server/yapilandirma.js`): https olmayan `TABAN_URL`, eksik `SIFRELEME_ANAHTARI` / `SMTP_URL`, geliştirme kısayolları.

`SIFRELEME_ANAHTARI` iki adımlı doğrulama sırlarını şifreler. Kaybederseniz oyuncuların 2FA kurulumu çözülemez (kurtarma
kodlarıyla girip yeniden kurmaları gerekir). Anahtarı parola yöneticisinde ya da gizli anahtar kasasında ayrıca saklayın.

## 3. Başlatma

```bash
docker compose up -d --build
docker compose logs -f uygulama
curl https://ALAN_ADI/api/saglik          # "veritabani": "postgres" görünmeli (günlükte de yazar)
```

Uygulama ilk açılışta şemayı (`db/postgres/sema.sql`) kendisi kurar; sonraki sürümlerde yalnızca eksik tablo/kolonları
ekler. Var olan bir SQLite kurulumundan geçiyorsanız önce docs/postgres-gecisi.md'deki taşıma adımlarını izleyin.

Daha fazla örnek: `docker compose up -d --scale uygulama=3`. Caddy örnekleri DNS'ten bulur ve sağlık denetimiyle dağıtır;
canlı bağlantılar hangi örneğe düşerse düşsün olayları alır (LISTEN/NOTIFY).

Caddy, Let's Encrypt sertifikasını kendisi alır ve yeniler; WebSocket (`/canli`) dahil tüm trafiği uygulamaya iletir.
Uygulama `trust proxy` ile gerçek istemci IP'sini görür (hız sınırları ve oturum listesi için).

## 4. İlk yönetici

1. Sitede normal bir hesap açın, e-postanızı doğrulayın, **Hesabım → Güvenlik**'ten iki adımlı doğrulamayı kurun.
2. Rolü sunucuda verin:
   ```bash
   docker compose exec uygulama node scripts/rol-ver.js eposta@ornek.com ADMIN
   ```
3. `/yonetim.html` panelini açın. Sonraki moderatör ve denetçileri panelden atayabilirsiniz.

## 5. E-posta testi

```bash
docker compose exec uygulama node scripts/posta-dene.js sizin@adresiniz.com
```

Gelen kutusuna HTML biçimli deneme iletisi gelmelidir. Gönderilemeyen iletiler `giden_postalar` tablosunda kalır ve
artan aralıklarla (1, 5, 30 dk, 2 sa) yeniden denenir.

## 6. Yedekleme

**PostgreSQL (docker-compose):**

```bash
# Günlük mantıksal yedek (sıkıştırılmış, tutarlı anlık görüntü; uygulama çalışırken alınabilir)
docker compose exec -T postgres pg_dump -U sanalturkiye -Fc sanalturkiye > yedek-$(date +%F).dump
# Geri yükleme (boş veritabanına; önce uygulamayı durdurun)
docker compose stop uygulama
docker compose exec -T postgres pg_restore -U sanalturkiye -d sanalturkiye --clean --if-exists < yedek-2026-10-21.dump
docker compose exec -T postgres psql -U sanalturkiye -d sanalturkiye -c 'SELECT COUNT(*) FROM defter_dengesiz'   # 0 olmalı
docker compose start uygulama
```

- `deploy/yedek.cron`'daki örnek satırla günlük çalıştırın ve **sunucu dışına kopyalayın** (ör. `rclone` ile nesne
  deposuna); aynı diskteki yedek disk arızasına karşı korumaz. Büyüyen kurulumda zamana göre geri dönüş için WAL
  arşivleme (ör. pgBackRest, WAL-G) ya da yönetilen bir Postgres hizmeti önerilir.
- `pg_dump` şifreleme anahtarını (`SIFRELEME_ANAHTARI`) içermez; 2FA sırları onsuz çözülemez, anahtarı ayrıca saklayın.

**SQLite (`VERITABANI=sqlite`):**

- Günlük çevrimiçi yedek: `deploy/yedek.cron` (`scripts/yedek.js`). Yedekler veri biriminde `yedekler/` altında gzip'li
  tutulur ve 14 gün döner; sunucu dışına kopyalayın.
- Geri yükleme: sunucuyu durdurun, `node scripts/geri-yukle.js <yedek> --onayla`, yeniden başlatın. Önce `--onayla`
  olmadan çalıştırıp bütünlük ve defter denetimini görün.

## 7. İzleme

- `GET /api/saglik`: sürüm, veritabanı motoru, çalışma süresi, bellek, canlı bağlantı sayısı (Docker sağlık denetimi bunu kullanır).
- Günlükler JSON satırlarıdır (`docker compose logs`); sunucu hataları ayrıca `/veri/gunluk/hatalar.jsonl` dosyasına ve
  yönetim panelinin **Sistem** sekmesine düşer. İstemci tarafı hatalar da raporlanır.
- Harici bir çalışma süresi izleyicisini (UptimeRobot vb.) `/api/saglik` adresine bağlayın.

## 8. Docker'sız kurulum (systemd) ve SQLite ile tek sunucu

`deploy/sanalturkiye.service` birimi: uygulamayı `/opt/sanalturkiye`, veriyi `/var/lib/sanalturkiye` altına koyun, ortam
değişkenlerini `/etc/sanalturkiye.env` dosyasına yazın ve önüne Caddy ya da nginx koyun (WebSocket yükseltmesini iletmeyi unutmayın).
Postgres için `VERITABANI=postgres` ve `DATABASE_URL=postgres://…` (PostGIS eklentisi kurulu olmalı); `VERITABANI`
verilmezse uygulama tek dosya SQLite ile çalışır (yalnızca tek örnek). Docker Compose'u SQLite ile kullanmak için
`uygulama` hizmetinde `VERITABANI: sqlite` yazıp `postgres` hizmetini ve `depends_on`'u kaldırın.

## 9. Yayın öncesi kontrol listesi

- [ ] Yasal metinler hukukçu tarafından onaylandı (docs/hukuk-kontrol-listesi.md); `public/yasal/*` güncellendi ve `YASAL` sürümleri artırıldı.
- [ ] SMTP ile doğrulama ve sıfırlama e-postası denendi, spam'e düşmüyor.
- [ ] İlk yönetici 2FA ile panele girebiliyor.
- [ ] Yedek alındı, başka bir makinede geri yüklenip denendi.
- [ ] Test takımı bir kez gerçek Postgres'e karşı çalıştırıldı (`VERITABANI=postgres DATABASE_URL=postgres://… npm test`).
- [ ] Open-Meteo kullanım koşulları (ticari kullanımda abonelik) ve harita karo sağlayıcısının adil kullanım koşulları gözden geçirildi.
- [ ] `ANTHROPIC_API_KEY` kullanılacaksa KVKK metninde yurt dışı aktarım belirtildi.
