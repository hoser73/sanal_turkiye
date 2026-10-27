// Uygulamanın tek ayarı: oyun sunucusunun adresi.
// Simülatörde Mac'teki geliştirme sunucusuna (localhost:3400) bağlanır. Yayında derlerken:
//   flutter build ios --dart-define=SUNUCU=https://alan-adi.com.tr
const String sunucuAdresi = String.fromEnvironment('SUNUCU', defaultValue: 'http://localhost:3400');

// Marka renkleri (oyunun üst çubuğu ve açılış ekranı)
const int yesilAcik = 0xFF5CC062;
const int yesilKoyu = 0xFF3FA34D;
const int zumrut = 0xFF0E5E50;
