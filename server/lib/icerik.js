// Kural tabanlı içerik ön taraması (sohbet mesajı, şikâyet edilen metin). Yapay zekâ katmanı varsa onun notu buna eklenir.
// Amaç sansür değil, moderatörün önüne öncelik sırası koymak ve kişisel verinin yanlışlıkla ifşasını engellemektir.
const KUFUR = ['amk', 'aq', 'orospu', 'piç', 'siktir', 'yarrak', 'göt', 'pezevenk', 'şerefsiz', 'gerizekalı', 'salak'];
const normal = (m) => m.toLocaleLowerCase('tr-TR').replace(/[1!]/g, 'i').replace(/0/g, 'o').replace(/3/g, 'e').replace(/[@4]/g, 'a').replace(/\$/g, 's');

// Tam genişlikli/matematiksel rakamlar NFKC ile, Arapça-Hint rakamları elle ASCII'ye çevrilir; görünmez karakterler atılır
const sadelestir = (m) => m.normalize('NFKC').replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '')
  .replace(/[\u0660-\u0669]/g, (c) => c.charCodeAt(0) - 0x660).replace(/[\u06F0-\u06F9]/g, (c) => c.charCodeAt(0) - 0x6F0);

// Ayırıcılarla (boşluk, nokta, tire, parantez, eğik çizgi) bölünmüş rakam gruplarından, grup sınırında başlayıp biten
// 10–12 haneli birleşimler. Binlik ayırıcılı sayılar (1.250.000) yalnız başına denetlenir, komşularıyla birleştirilmez.
function rakamAdaylari(metin) {
  const adaylar = [];
  const pencere = (g) => {
    for (let i = 0; i < g.length; i++) {
      let s = '';
      for (let j = i; j < g.length && s.length < 12; j++) { s += g[j]; if (s.length >= 10 && s.length <= 12) adaylar.push(s); }
    }
  };
  for (const [kosu] of metin.matchAll(/\d+(?:[\s.,\-\u2010-\u2015()/_]{1,3}\d+)*/g)) {
    let grup = [];
    for (const kelime of kosu.split(/\s+/)) {
      const rakamlar = kelime.split(/\D+/).filter(Boolean);
      if (/^\d{1,3}(?:[.,]\d{3})+$/.test(kelime)) { pencere(grup); pencere([rakamlar.join('')]); grup = []; }
      else grup.push(...rakamlar);
    }
    pencere(grup);
  }
  return adaylar;
}

function icerikDenetle(metin = '') {
  const nedenler = [];
  metin = sadelestir(String(metin));
  const n = normal(metin);
  const kelimeler = new Set(n.split(/[^\p{L}]+/u).filter(Boolean));
  if (KUFUR.some((k) => kelimeler.has(k))) nedenler.push({ kod: 'TACIZ', not: 'Hakaret içerebilecek ifade' });
  // T.C. kimlik no (11 hane, 0 ile başlamaz), cep telefonu, e-posta, IBAN → kişisel veri ifşası
  const sayilar = rakamAdaylari(metin);
  if (sayilar.some((s) => /^[1-9]\d{10}$/.test(s))) nedenler.push({ kod: 'KISISEL_VERI', not: 'Kimlik numarasına benzeyen 11 haneli sayı', engel: true });
  if (sayilar.some((s) => /^(?:90|0)?5\d{9}$/.test(s))) nedenler.push({ kod: 'KISISEL_VERI', not: 'Telefon numarası', engel: true });
  if (/TR\d{24}/i.test(metin.replace(/[\s.\-\u2010-\u2015]/g, ''))) nedenler.push({ kod: 'KISISEL_VERI', not: 'IBAN', engel: true });
  if (/[^\s@]+@[^\s@]+\.[^\s@]{2,}/.test(metin)) nedenler.push({ kod: 'KISISEL_VERI', not: 'E-posta adresi' });
  if ((metin.match(/https?:\/\/|www\./gi) || []).length >= 2) nedenler.push({ kod: 'SPAM', not: 'Çok sayıda bağlantı' });
  if (/(.)\1{9,}/u.test(metin) || (metin.length > 20 && metin === metin.toLocaleUpperCase('tr-TR') && /\p{L}{10}/u.test(metin))) nedenler.push({ kod: 'SPAM', not: 'Tekrar / tamamı büyük harf' });
  return { karar: nedenler.some((x) => x.engel) ? 'ENGEL' : nedenler.length ? 'SUPHELI' : 'TEMIZ', nedenler };
}

module.exports = { icerikDenetle };
