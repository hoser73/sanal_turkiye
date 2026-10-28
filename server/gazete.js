// Pazar gazetesi: Pazar sekmesinin ilk sayfası. Günün piyasa özeti tek bakışta: Türkiye endeksi ve en çok değer kazanan
// mahalleler, yeni parsel ilanları, tüccarın bugün iyi fiyat verdiği ürünler, son parsel satışları; oyuncuya özel olarak
// yöre setini tamamlayacak illerdeki ilanlar ve kooperatifindeki açık yardım istekleri. Ortak kısım 60 sn önbellekte.
const db = require('./db');
const { KOLEKSIYON: K, URUNLER } = require('./config/rules');

let onbellek = { t: 0, v: null };
function ortak(t = Date.now()) {
  if (process.env.ONBELLEK !== 'kapali' && onbellek.v && t - onbellek.t < 60_000) return onbellek.v;
  const piyasa = require('./piyasa').piyasaOzeti();
  const tuccar = require('./ekonomi').borsa(null).urunler
    .filter((u) => u.taban && u.npcFiyat && !URUNLER[u.kod]?.yoresel && !URUNLER[u.kod]?.dukkan && !URUNLER[u.kod]?.sarf)   // çiftlikte üretilenler
    .map((u) => ({ kod: u.kod, ad: u.ad, ikon: u.ikon, fiyat: u.npcFiyat, oran: u.npcFiyat / u.taban }))
    .sort((a, b) => b.oran - a.oran || b.fiyat - a.fiyat).slice(0, 4);
  const v = {
    endeks: { deger: piyasa.tr.endeks, degisim7: piyasa.tr.degisim7 },
    yukselenler: piyasa.yukselenler.slice(0, 3).map((m) => ({ ad: m.ad, ilce: m.ilce, il: m.il, degisim7: m.degisim7 })),
    ilanlar: require('./pazar').ilanlar({ sirala: 'yeni' }).slice(0, 4).map((i) => ({ id: i.id, parsel: i.parsel, mahalle: i.mahalle, il: i.il, fiyat: i.fiyat, alan: i.alan })),
    satislar: require('./pazar').sonIslemler().filter((x) => !x.incelemede).slice(0, 3).map((x) => ({ mahalle: x.mahalle, il: x.il, fiyat: x.price, alici: x.alici })),
    tuccar,
  };
  onbellek = { t, v };
  return v;
}

// Oyuncunun eksik yöre seti illerindeki ilan sayısı ve en ucuzu (en çok tamamlanmaya yakın setler önce)
function setFirsatlari(userId) {
  const l = require('./koleksiyon').liste(userId);
  const adaylar = l.setler.filter((s) => !s.tamam && s.sahip > 0).slice(0, 3);
  return adaylar.map((s) => {
    const eksik = s.iller.filter((i) => !i.var);
    const ilan = db.prepare(`SELECT COUNT(*) AS c, MIN(l.asking_price) AS enUcuz FROM listings l JOIN parcels p ON p.id = l.parcel_id
      JOIN regions r ON r.id = p.il_id WHERE l.status = 'ACTIVE' AND l.seller_id <> ? AND r.plaka IN (${eksik.map(() => '?').join(',')})`).get(userId, ...eksik.map((i) => i.plaka));
    return { kod: s.kod, ad: s.ad, ikon: s.ikon, eksik: eksik.map((i) => i.ad), ilanSayisi: ilan.c, enUcuz: ilan.enUcuz };
  });
}

async function gazete(userId) {
  const v = { ...ortak(), tarih: Date.now(), hasatBonus: K.hasatBonus };
  const ih = await require('./ihale').liste(null).catch(() => null);
  if (ih) v.ihale = { ad: ih.set.ad, ikon: ih.set.ikon, adet: ih.ihaleler.filter((i) => i.durum === 'ACIK').length };
  if (userId) {
    v.setler = setFirsatlari(userId);
    const y = require('./yardim').durumu(userId);
    v.yardim = y.uye ? y.istekler.filter((i) => !i.ben).slice(0, 3) : null;
  }
  return v;
}

function rotalar(app, { h }) {
  app.get('/api/gazete', h((req) => gazete(req.kullanici?.id ?? null)));
}

module.exports = { rotalar, gazete };
