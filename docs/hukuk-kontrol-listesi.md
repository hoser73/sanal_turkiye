# Hukuk kontrol listesi (yayın öncesi)

Bu liste, hukukçunun incelemesi için hazırlanmıştır; hukuki görüş değildir. Metinler `public/yasal/` altındadır.
Bir metin değiştiğinde `server/config/rules.js` → `YASAL` içindeki `surum` artırılmalıdır: oyunculardan girişte yeniden
onay istenir ve onay kaydı (`yasal_onaylar`) sürümüyle saklanır.

## Doldurulması gereken bilgiler

- [ ] Veri sorumlusunun unvanı, adresi, MERSİS, KEP adresi ve iletişim e-postası (KVKK metni, koşullar).
- [ ] VERBİS kaydı gerekip gerekmediği (çalışan sayısı / yıllık bilanço eşiği ya da özel nitelikli veri işleme).
- [ ] Barındırma sağlayıcısı ve veri merkezi ülkesi; e-posta sağlayıcısı.
- [ ] Yetkili mahkeme ve icra daireleri; uygulanacak hukuk.
- [ ] Başvuru usulü (KVKK m.13): başvuru kanalı, 30 günlük yanıt süreci.

## Karar verilmesi gereken konular

1. **Yurt dışı aktarım (KVKK m.9, 2024 değişikliği):** Anthropic (yapay zekâ, ABD), tarayıcı push servisleri, e-posta
   sağlayıcısı yurt dışındaysa dayanak (standart sözleşme bildirimi / yeterlilik / açık rıza) seçilmeli. Yapay zekâ
   kapatılabilir (`YAPAY_ZEKA=kapali`); kapalıyken hiçbir oyuncu metni dışarı gönderilmez. Açıkken giden veri: sohbet ve
   şikâyet metinleri (ön tarama), demo sakine yazılan mesaj, mahalle olaylarındaki oyun adları; e-posta, telefon gibi kimlik
   verisi gönderilmez. Ayrıca tarayıcı harita karolarını (OpenFreeMap, AWS'deki yükselti karoları) ve yazı tiplerini
   (Google Fonts) doğrudan yükler; bu sağlayıcılar oyuncunun IP adresini görür (kendi karo sunucusuna geçiş: docs/karo-sunucusu.md).
2. **13–17 yaş:** Genç hesaplar için veli onayı gerekip gerekmediği; mevcut tasarım: 13 yaş altı kayıt yok, gençlerde sohbet
   varsayılan kapalı, mola hatırlatıcısı zorunlu, özel mesaj yok.
3. **Demo sakinler:** Oyunun canlandırdığı sakinlerin “demo” etiketiyle açıkça işaretlenmesi yeterli bilgilendirme mi;
   (mevcut metin: Kullanım Koşulları §4a).
4. **Siyasi içerik:** Oyun içi seçimler v0.47'de kaldırıldı; gerçek siyasi parti/kişi propagandasının sohbette yasaklanması
   ve moderasyonu (koşullar §4) yeterli mi.
5. **Sanal varlıklar:** Oyun parasının (v0.49'dan beri TL görünümünde: ₺, gerçekçi tutarlar) nakde çevrilemediği; TL adı ve
   simgesinin gerçek para algısı yaratıp yaratmadığı (tüketici mevzuatı, TCMB/ödeme hizmetleri, kumar mevzuatı); parsellerin tapu olmadığı, oyun dışı alım satımın yasak olduğu
   hükümlerinin tüketici mevzuatı ve kumar/şans oyunu mevzuatı karşısında yeterliliği. Gerçek parayla satış (kozmetik vb.)
   eklenecekse mesafeli satış sözleşmesi, ön bilgilendirme ve cayma hakkı metinleri gerekir.
6. **Harita verisi:** OpenStreetMap türevi veritabanı (imar, mahalleler) için ODbL yükümlülükleri (atıf, paylaşım koşulu);
   OpenFreeMap ve Open-Meteo kullanım koşulları (Open-Meteo ücretsiz uç noktası ticari olmayan kullanım içindir).
7. **Ticari elektronik ileti (6563 / İYS):** Pazarlama izni İleti Yönetim Sistemi'ne kaydedilmeli mi; mevcut tasarım izni
   ayrı ve isteğe bağlı topluyor, işlemsel e-postalar (doğrulama, sıfırlama) izinden bağımsız.
8. **Saklama süreleri:** Silinen hesapların anonimleştirilmiş defter ve denetim kayıtlarının saklama süresi; günlüklerin
   (`gunluk/hatalar.jsonl`, 5 MB'ta döner), giden e-postaların (şu an 30 gün) ve yedeklerin saklama süresi (şu an yedekler 14 gün;
   sunucu dışı kopyanın süresi ayrıca belirlenmeli). Silinen hesabın verisi yedeklerde saklama süresi dolana kadar kalır.
9. **Çerezler:** Yalnızca zorunlu çerez ve yerel depolama kullanılıyor; çerez bandı gerekmediği teyidi.
10. **Moderasyon kararlarına itiraz:** İtiraz kanalı ve süresi; iki kişi kuralı ve herkese açık karar kaydının metinlere yansıtılması.
11. **Sponsor işletmeler (banka, nalbur, market, zirai bayi):** Her türden tek marka. Sözleşmede marka, logo ve şube verisinin
    kullanım lisansı, süresi ve bitince kaldırılacağı yer almalı (sistem bitiş tarihinde markayı kendiliğinden kaldırır).
    Oyunda "Sponsor" etiketiyle gösteriliyor; ticari reklam ve haksız ticari uygulamalar mevzuatı açısından yeterliliği
    (gizli reklam yasağı) teyit edilmeli. **Banka sponsorluğu:** oyundaki "banka" oyun parasıyla çalışır, nakde çevrilmez; bunun
    gerçek bankacılık, kredi ya da yatırım hizmeti olmadığı metinlerde açıkça yazmalı; banka reklamına ilişkin BDDK/TBB
    düzenlemeleri ve 13–17 yaş oyunculara banka reklamı gösterilmesi değerlendirilmeli (mevcut tasarım: oyunda kredi yok,
    yalnızca oyun parasıyla vadeli hesap; marka herkese görünür). Sponsorla oyuncu verisi paylaşılmıyor; paylaşılacaksa KVKK aydınlatma ve açık rıza gerekir.
12. **Giriş yolları ve telefon:** Google/Apple ile girişte alınan veriler (e-posta, ad, sağlayıcı kimliği) ve telefon numarası
    (hesap güvenliği, sahte hesapların önlenmesi) KVKK aydınlatma metnine eklenmeli; sağlayıcılar yurt dışındaysa aktarım
    dayanağı (madde 1). SMS doğrulama kodunun ticari elektronik ileti sayılmadığı (İYS) teyit edilmeli. Google ve Apple
    marka kullanım kuralları (düğme görselleri) yayından önce uygulanmalı.

## Teknik olarak hazır olanlar (metinlerde atıf yapılabilir)

- Onay kayıtları sürümlü ve yalnızca eklenir; pazarlama izni geri çekilebilir.
- KVKK m.11: veri dışa aktarma (Hesabım → Gizlilik ve veriler), hesap silme (kimlik silinir, defter anonim kalır).
- Silinen hesabın kişisel tercih ve ilişki kayıtları (arkadaşlıklar, fiyat alarmları, hatırlatmalar) da silinir; e-posta ve
  telefonun yalnızca tuzlu özeti, aynı kimlikle başlangıç hediyelerinin tekrar alınmaması için saklanır.
- Giden e-postalar (adres ve bağlantı içerir) 30 gün sonra silinir; hata günlüğü kişisel veri (e-posta, parola, çerez, IP) yazmaz.
- Kişisel veri ifşası (kimlik no, telefon, IBAN) içeren sohbet mesajları otomatik olarak yayımlanmaz.
- Parolalar bcrypt ile özetlenir; 2FA sırları AES-256-GCM ile şifrelenir; oturum ve e-posta bağlantılarının yalnızca özetleri saklanır.
