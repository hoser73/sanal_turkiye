// Türkçe ek uyumu (özel adlar): bulunma (Rize'de, Kars'ta) ve tamlayan (Rize'nin, Kars'ın)
const UNLULER = 'aıoueiöüAIOUEİÖÜ';
const sonUnlu = (s) => { for (let i = s.length - 1; i >= 0; i--) if (UNLULER.includes(s[i])) return s[i].toLocaleLowerCase('tr-TR'); return 'e'; };
function bulunma(ad) {
  const kalin = 'aıou'.includes(sonUnlu(ad));
  const sert = 'çfhkpsştÇFHKPSŞT'.includes(ad.at(-1));
  return `${ad}'${sert ? 't' : 'd'}${kalin ? 'a' : 'e'}`;
}
module.exports = { bulunma };
