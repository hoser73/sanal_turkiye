// Kural tabanlı içerik ön taraması (duyuru, sohbet, aday metni). Yapay zekâ katmanı varsa onun notu buna eklenir.
// Amaç sansür değil, moderatörün önüne öncelik sırası koymak ve kişisel verinin yanlışlıkla ifşasını engellemektir.
const KUFUR = ['amk', 'aq', 'orospu', 'piç', 'siktir', 'yarrak', 'göt', 'pezevenk', 'şerefsiz', 'gerizekalı', 'salak'];
const normal = (m) => m.toLocaleLowerCase('tr-TR').replace(/[1!]/g, 'i').replace(/0/g, 'o').replace(/3/g, 'e').replace(/[@4]/g, 'a').replace(/\$/g, 's');

function icerikDenetle(metin = '') {
  const nedenler = [];
  const n = normal(String(metin));
  const kelimeler = new Set(n.split(/[^\p{L}]+/u).filter(Boolean));
  if (KUFUR.some((k) => kelimeler.has(k))) nedenler.push({ kod: 'TACIZ', not: 'Hakaret içerebilecek ifade' });
  // T.C. kimlik no (11 hane, 0 ile başlamaz), cep telefonu, e-posta, IBAN → kişisel veri ifşası
  if (/\b[1-9]\d{10}\b/.test(metin)) nedenler.push({ kod: 'KISISEL_VERI', not: 'Kimlik numarasına benzeyen 11 haneli sayı', engel: true });
  if (/(\+?90[\s-]?)?\b0?5\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/.test(metin)) nedenler.push({ kod: 'KISISEL_VERI', not: 'Telefon numarası', engel: true });
  if (/\bTR\s?\d{2}(\s?\d{4}){5}\s?\d{2}\b/i.test(metin)) nedenler.push({ kod: 'KISISEL_VERI', not: 'IBAN', engel: true });
  if (/[^\s@]+@[^\s@]+\.[^\s@]{2,}/.test(metin)) nedenler.push({ kod: 'KISISEL_VERI', not: 'E-posta adresi' });
  if ((metin.match(/https?:\/\/|www\./gi) || []).length >= 2) nedenler.push({ kod: 'SPAM', not: 'Çok sayıda bağlantı' });
  if (/(.)\1{9,}/u.test(metin) || (metin.length > 20 && metin === metin.toLocaleUpperCase('tr-TR') && /\p{L}{10}/u.test(metin))) nedenler.push({ kod: 'SPAM', not: 'Tekrar / tamamı büyük harf' });
  return { karar: nedenler.some((x) => x.engel) ? 'ENGEL' : nedenler.length ? 'SUPHELI' : 'TEMIZ', nedenler };
}

module.exports = { icerikDenetle };
