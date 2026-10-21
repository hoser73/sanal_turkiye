# Yayına alma

Tek sunucuda (2 vCPU / 2–4 GB RAM yeterli bir VPS) Docker ile kurulum. SQLite (WAL) tek sunucuda binlerce eşzamanlı
oyuncuyu taşır; çok sunucuya geçmeden PostgreSQL gerekmez (bkz. docs/postgres-gecisi.md).

## 1. Önkoşullar

- Bir alan adı ve sunucunun IP'sine yönlenen `A` kaydı.
- Sunucuda Docker ve Docker Compose eklentisi.
- Bir SMTP sağlayıcısı (ör. Amazon SES, Brevo, Postmark, Resend SMTP). Gönderen alan adı için **SPF, DKIM ve DMARC**
  kayıtlarını sağlayıcının yönergesine göre ekleyin; yoksa doğrulama e-postaları spam'e düşer.

## 2. Ayarlar

```bash
cp .env.ornek .env
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
curl https://ALAN_ADI/api/saglik
```

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

- Günlük çevrimiçi yedek: `deploy/yedek.cron` (Docker için içindeki `docker compose exec` satırı).
- Yedekler veri biriminde `yedekler/` altında gzip'li tutulur ve 14 gün döner. **Sunucu dışına kopyalayın**
  (ör. `rclone` ile nesne deposuna); aynı diskteki yedek disk arızasına karşı korumaz.
- Geri yükleme: sunucuyu durdurun, `node scripts/geri-yukle.js <yedek> --onayla`, yeniden başlatın. Önce `--onayla`
  olmadan çalıştırıp bütünlük ve defter denetimini görün.

## 7. İzleme

- `GET /api/saglik`: sürüm, çalışma süresi, bellek, canlı bağlantı sayısı (Docker sağlık denetimi bunu kullanır).
- Günlükler JSON satırlarıdır (`docker compose logs`); sunucu hataları ayrıca `/veri/gunluk/hatalar.jsonl` dosyasına ve
  yönetim panelinin **Sistem** sekmesine düşer. İstemci tarafı hatalar da raporlanır.
- Harici bir çalışma süresi izleyicisini (UptimeRobot vb.) `/api/saglik` adresine bağlayın.

## 8. Docker'sız kurulum (systemd)

`deploy/sanalturkiye.service` birimi: uygulamayı `/opt/sanalturkiye`, veriyi `/var/lib/sanalturkiye` altına koyun, ortam
değişkenlerini `/etc/sanalturkiye.env` dosyasına yazın ve önüne Caddy ya da nginx koyun (WebSocket yükseltmesini iletmeyi unutmayın).

## 9. Yayın öncesi kontrol listesi

- [ ] Yasal metinler hukukçu tarafından onaylandı (docs/hukuk-kontrol-listesi.md); `public/yasal/*` güncellendi ve `YASAL` sürümleri artırıldı.
- [ ] SMTP ile doğrulama ve sıfırlama e-postası denendi, spam'e düşmüyor.
- [ ] İlk yönetici 2FA ile panele girebiliyor.
- [ ] Yedek alındı, başka bir makinede geri yüklenip denendi.
- [ ] Open-Meteo kullanım koşulları (ticari kullanımda abonelik) ve harita karo sağlayıcısının adil kullanım koşulları gözden geçirildi.
- [ ] `ANTHROPIC_API_KEY` kullanılacaksa KVKK metninde yurt dışı aktarım belirtildi.
