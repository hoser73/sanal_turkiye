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
   kapatılabilir (`YAPAY_ZEKA=kapali`); kapalıyken hiçbir oyuncu metni dışarı gönderilmez.
2. **13–17 yaş:** Genç hesaplar için veli onayı gerekip gerekmediği; mevcut tasarım: 13 yaş altı kayıt yok, gençlerde sohbet
   varsayılan kapalı, mola hatırlatıcısı zorunlu, aday olamaz, özel mesaj yok.
3. **Demo sakinler:** Oyunun canlandırdığı sakinlerin “demo” etiketiyle açıkça işaretlenmesi yeterli bilgilendirme mi;
   doldurma kipinde seçimlere katılmalarının oyun içi seçimlerin dürüstlüğü açısından kullanıcıya nasıl anlatılacağı
   (mevcut metin: Kullanım Koşulları §4a).
4. **Oyun içi seçimler ve siyaset:** Gerçek siyasi parti/kişi propagandasının yasaklanması ve moderasyonu (koşullar §4);
   seçim dönemlerinde (YSK yasakları) ek önlem gerekip gerekmediği.
5. **Sanal varlıklar:** Akçenin nakde çevrilemediği, parsellerin tapu olmadığı, oyun dışı alım satımın yasak olduğu
   hükümlerinin tüketici mevzuatı ve kumar/şans oyunu mevzuatı karşısında yeterliliği. Gerçek parayla satış (kozmetik vb.)
   eklenecekse mesafeli satış sözleşmesi, ön bilgilendirme ve cayma hakkı metinleri gerekir.
6. **Harita verisi:** OpenStreetMap türevi veritabanı (imar, mahalleler) için ODbL yükümlülükleri (atıf, paylaşım koşulu);
   OpenFreeMap ve Open-Meteo kullanım koşulları (Open-Meteo ücretsiz uç noktası ticari olmayan kullanım içindir).
7. **Ticari elektronik ileti (6563 / İYS):** Pazarlama izni İleti Yönetim Sistemi'ne kaydedilmeli mi; mevcut tasarım izni
   ayrı ve isteğe bağlı topluyor, işlemsel e-postalar (doğrulama, sıfırlama) izinden bağımsız.
8. **Saklama süreleri:** Silinen hesapların anonimleştirilmiş defter ve denetim kayıtlarının saklama süresi; günlüklerin
   (`gunluk/hatalar.jsonl`) ve yedeklerin saklama süresi (şu an yedekler 14 gün).
9. **Çerezler:** Yalnızca zorunlu çerez ve yerel depolama kullanılıyor; çerez bandı gerekmediği teyidi.
10. **Moderasyon kararlarına itiraz:** İtiraz kanalı ve süresi; iki kişi kuralı ve herkese açık karar kaydının metinlere yansıtılması.

## Teknik olarak hazır olanlar (metinlerde atıf yapılabilir)

- Onay kayıtları sürümlü ve yalnızca eklenir; pazarlama izni geri çekilebilir.
- KVKK m.11: veri dışa aktarma (Hesabım → Gizlilik ve veriler), hesap silme (kimlik silinir, defter anonim kalır).
- Gizli oy: oy içeriği kimlikle ilişkilendirilmez; dışa aktarımda yer almaz.
- Kişisel veri ifşası (kimlik no, telefon, IBAN) içeren sohbet ve duyurular otomatik olarak yayımlanmaz.
- Parolalar bcrypt ile özetlenir; 2FA sırları AES-256-GCM ile şifrelenir; oturum ve e-posta bağlantılarının yalnızca özetleri saklanır.
