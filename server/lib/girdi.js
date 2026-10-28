// İstek gövdesi ve sorgusundaki değerleri güvenle okuma. String(v) / Number(v) gövdedeki {"toString":1} gibi nesnelerde
// TypeError atar (500); burada yalnızca dize (ve sayı) kabul edilir, gerisi boş/NaN sayılır ve doğrulama 400 döner.
const metin = (v) => (typeof v === 'string' ? v : '');
const sayi = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
module.exports = { metin, sayi };
