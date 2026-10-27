// Türkçe ek uyumu (özel adlar): bulunma (Rize'de, Kars'ta) ve tamlayan (Rize'nin, Kars'ın); sayılara bulunma eki
const UNLULER = 'aıoueiöüAIOUEİÖÜ';
const sonUnlu = (s) => { for (let i = s.length - 1; i >= 0; i--) if (UNLULER.includes(s[i])) return s[i].toLocaleLowerCase('tr-TR'); return 'e'; };
function bulunma(ad) {
  const kalin = 'aıou'.includes(sonUnlu(ad));
  const sert = 'çfhkpsştÇFHKPSŞT'.includes(ad.at(-1));
  return `${ad}'${sert ? 't' : 'd'}${kalin ? 'a' : 'e'}`;
}
// Sayılara bulunma eki: 2'de, 3'te, 6'da, 40'ta (sayının okunuşunun son hecesine göre)
const BIRLER = { 1: 'de', 2: 'de', 3: 'te', 4: 'te', 5: 'te', 6: 'da', 7: 'de', 8: 'de', 9: 'da' };
const ONLAR = { 1: 'da', 2: 'de', 3: 'da', 4: 'ta', 5: 'de', 6: 'ta', 7: 'te', 8: 'de', 9: 'da' };
function sayiBulunma(n) {
  n = Math.abs(Math.trunc(Number(n) || 0));
  const ek = n === 0 ? 'da' : n % 10 ? BIRLER[n % 10] : n % 100 ? ONLAR[(n / 10) % 10] : 'de';   // 100 yüz, 1000 bin → de
  return `${n}'${ek}`;
}
module.exports = { bulunma, sayiBulunma };
