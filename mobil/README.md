# Sanal Türkiye — iOS uygulaması (Flutter)

Oyunun kendisi sunucuda çalışır; bu uygulama onu tam ekran WebView içinde açan Flutter kabuğudur. Böylece
haritadaki, 3B çiftlikteki ve paneldeki her yenilik uygulamaya kendiliğinden gelir (mağaza güncellemesi gerekmez).

Kabuğun sağladıkları:
- Açılış ekranı (logo, ilerleme çubuğu) ve yerel açılış görüntüsü
- Bağlantı yoksa "Çiftliğe ulaşılamıyor" ekranı, "Tekrar dene"; uygulamaya dönünce kendiliğinden yeniden dener
- Dokunsal geri bildirim: oyun `StMobil` kanalına `{"tur":"titresim","guc":"hafif|orta|agir|secim"}` gönderir
  (hasat, para, seviye atlama, balık ısırması…; bkz. `public/js/ses.js`, `public/js/uygulama.js`)
- Kenardan kaydırınca geri (çiftlikten haritaya), dış bağlantılar Safari'de açılır
- Uygulamada sayfa yakınlaştırılmaz, uzun basınca metin seçimi/büyüteç çıkmaz (`html.uygulama`)

## Çalıştırma (simülatör)

Sunucu Mac'te açık olmalı (`npm run dev`, port 3400). Sonra:

```bash
cd mobil
flutter run
```

Simülatör Mac'teki `http://localhost:3400` adresine bağlanır. Not: iOS Simülatörü'nde emojiler `?` kutusu olarak
görünebilir (simülatördeki yazı tipi sorunu); gerçek iPhone'da düzgün görünür.

## Sunucu adresi

Tek ayar `lib/ayarlar.dart` içindeki `SUNUCU`dur; derlerken verilir:

```bash
flutter build ios --dart-define=SUNUCU=https://alan-adi.com.tr
```

Yayında sunucu https ile çalışmalı ve `TABAN_URL=https://…` verilmeli (sunucu ancak o zaman HSTS ve
`upgrade-insecure-requests` gönderir; http geliştirmede bu ikisi kapalıdır).

## Geliştirici kancası (yalnızca debug)

Debug derlemede uygulama, kendi geçici klasörüne yazılan `st_js.txt` dosyasını sayfada çalıştırır (simülatörde
klavyesiz giriş yapmak, sayfaya gitmek için). Yayın derlemesinde bu kanca yoktur.

```bash
K=$(xcrun simctl get_app_container booted com.sanalturkiye.sanalTurkiye data)
echo "location.href='/'" > "$K/tmp/st_js.txt"
```

## Kendi iPhone'unda (aynı Wi‑Fi)

1. Bir kez: `open ios/Runner.xcworkspace` → Xcode › Settings › Accounts'ta Apple kimliğini ekle → Runner hedefi ›
   Signing & Capabilities › Team olarak kendi adını seç (ücretsiz kişisel ekip yeter; uygulama 7 gün geçerli olur).
2. iPhone'da Ayarlar › Gizlilik ve Güvenlik › Geliştirici Modu açık olmalı.
3. Mac'in yerel adresiyle çalıştır (adres `ipconfig getifaddr en0` ile öğrenilir, modem yeniden adres verirse değişir):

```bash
flutter run --release -d <iPhone-kimliği> --dart-define=SUNUCU=http://192.168.1.106:3400
```

4. İlk açılışta "yerel ağdaki aygıtları bul" izni sorulur → İzin Ver. "Güvenilmeyen geliştirici" uyarısı çıkarsa:
   Ayarlar › Genel › VPN ve Aygıt Yönetimi › kendi Apple kimliğin › Güven.

`--release` ile yüklenen uygulama ana ekrandan da açılır (debug derleme yalnızca `flutter run` açıkken çalışır).

## Gerçek iPhone ve App Store

- Cihaza yüklemek için Xcode'da `ios/Runner.xcworkspace` açılır, Signing & Capabilities'te Apple geliştirici
  hesabı (Team) seçilir. Paket kimliği: `com.sanalturkiye.sanalTurkiye`.
- Aynı Wi‑Fi'deki iPhone'dan Mac'teki sunucuya: `--dart-define=SUNUCU=http://<Mac'in-yerel-IP'si>:3400`
  (bu durumda Info.plist'e o adres için ATS istisnası gerekir; yayında https kullanılır).
- Anlık bildirim (push) için Apple Push Notification hizmeti ve sunucu tarafı gerekir; henüz yok.
