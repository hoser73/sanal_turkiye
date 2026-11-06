// v0.50 para dengesi geçişi (bir kez, açılışta): 1 oyun birimi ₺10.000'den ₺300'e indi; arsa m² fiyatı ARSA_OLCEK, yapı
// maliyetleri YAPI_OLCEK kadar büyüdü (config/rules.js). Kayıtlı arsa tutarları aynı TL değerinde kalsın diye ARSA_OLCEK'le
// çarpılır: sahiplik alış bedeli, ilan ve satış fiyatları, ihale taban/fiyatı, endeks hacmi. Cüzdan bakiyeleri, ürün ve
// görev kayıtları olduğu gibi kalır (TL karşılıkları küçülür; çiftlik ekonomisi gerçeğe yaklaştı). Teklif emanetteki açık
// teklifler önce olağan yoldan iade edilir. Geçiş zamanı saklanır: değiştirilemeyen denetim kaydındaki eski yapı
// maliyetleri (portföy yatırımı) okunurken YAPI_OLCEK'le çarpılır (piyasa.yatirimVeGelir).
const db = require('./db');
const { ARSA_OLCEK } = require('./config/rules');

const ANAHTAR = 'para_gecisi_v050';
const zamani = () => db.prepare(`SELECT deger FROM ayarlar WHERE anahtar = ?`).get(ANAHTAR)?.deger ?? null;

function gec() {
  if (zamani()) return false;
  const yeniKurulum = !db.prepare(`SELECT 1 FROM wallet_ledger LIMIT 1`).get();
  db.transaction(() => {
    if (!yeniKurulum) {
      const pazar = require('./pazar');
      for (const b of db.prepare(`SELECT buyer_id, listing_id FROM bids WHERE status = 'ACTIVE'`).all()) pazar.teklifGeriCek(b.buyer_id, b.listing_id);
      for (const t of db.prepare(`SELECT DISTINCT user_id FROM ihale_teklifleri WHERE durum = 'AKTIF'`).all()) require('./ihale').tekliflerIade(t.user_id);
      const k = ARSA_OLCEK;
      db.prepare(`UPDATE parcel_ownership SET price = ROUND(price * ?, 2) WHERE price IS NOT NULL`).run(k);
      db.prepare(`UPDATE listings SET asking_price = ROUND(asking_price * ?)`).run(k);
      db.prepare(`UPDATE trades SET price = ROUND(price * ?, 2), fee = ROUND(fee * ?, 2), deger_ani = ROUND(deger_ani * ?, 2)`).run(k, k, k);
      db.prepare(`UPDATE ihaleler SET taban = ROUND(taban * ?), fiyat = ROUND(fiyat * ?)`).run(k, k);
      db.prepare(`UPDATE deger_endeksi SET hacim = ROUND(hacim * ?)`).run(k);
    }
    db.prepare(`INSERT INTO ayarlar (anahtar, deger) VALUES (?, ?)`).run(ANAHTAR, new Date().toISOString().replace('T', ' ').slice(0, 19));
  })();
  return true;
}

module.exports = { gec, zamani };
