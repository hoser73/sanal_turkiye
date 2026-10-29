// Tek bağlantılı motorlar (SQLite dosyası, gömülü PGlite) için işlem kilidi: bir işlem açıkken bağlantıyı yalnızca o işlem
// kullanır; işlem dışı sorgular işlemin bitmesini bekler. Aksi hâlde başka bir isteğin sorgusu açık işleme karışır
// (geri alınırsa kaybolur, kaydedilmemiş veriyi okur).
class TekBaglanti {
  constructor() {
    this.aktif = null;   // açık işlem bitince çözülen söz
  }

  // Bağlantıyı özel kullanım için al; dönen fonksiyon bırakır
  async al() {
    while (this.aktif) await this.aktif;
    let coz;
    this.aktif = new Promise((r) => { coz = r; });
    return () => { this.aktif = null; coz(); };
  }

  // Bağlantı boşken fn'i çalıştır (fn eşzamanlı ise denetim ile çalıştırma arasına başka iş giremez)
  async bosken(fn) {
    while (this.aktif) await this.aktif;
    return fn();
  }
}

module.exports = { TekBaglanti };
