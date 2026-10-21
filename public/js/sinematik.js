// Sinematik kamera: oyuna giriş uçuşu (uzaydan Türkiye'ye) ve ünlü yerler turu (uçuş + yörünge + alt yazı).
// Kullanıcı haritaya dokunur, tekerlek çevirir ya da bir tuşa basarsa tur hemen durur. Hareket azaltma tercihine uyar.
const hareketAz = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const TUR = [
  { ad: 'Türkiye', alt: '81 il, gerçek harita üzerinde', merkez: [35.2, 39.1], zoom: 5.2, pitch: 32, bearing: 0, yorunge: 12 },
  { ad: 'İstanbul Boğazı', alt: 'İki kıtanın buluştuğu su yolu', merkez: [29.056, 41.085], zoom: 13.6, pitch: 66, bearing: -28 },
  { ad: 'Kapadokya', alt: 'Peri bacaları ve vadiler', merkez: [34.835, 38.643], zoom: 14.3, pitch: 70, bearing: 40 },
  { ad: 'Pamukkale', alt: 'Bembeyaz traverten basamaklar', merkez: [29.123, 37.923], zoom: 15.1, pitch: 66, bearing: -40 },
  { ad: 'Ölüdeniz', alt: 'Turkuaz lagün ve Babadağ', merkez: [29.121, 36.552], zoom: 14.2, pitch: 72, bearing: 140 },
  { ad: 'Nemrut Dağı', alt: '2.134 metrede dev heykeller', merkez: [38.741, 37.981], zoom: 14.4, pitch: 70, bearing: 20 },
  { ad: 'Ağrı Dağı', alt: 'Türkiye\'nin zirvesi, 5.137 metre', merkez: [44.29, 39.71], zoom: 11.4, pitch: 76, bearing: 200 },
  { ad: 'Uzungöl', alt: 'Karadeniz yaylalarında bir göl', merkez: [40.292, 40.619], zoom: 14.7, pitch: 72, bearing: 160 },
  { ad: 'Ankara', alt: 'Başkent', merkez: [32.837, 39.925], zoom: 14.6, pitch: 64, bearing: -15 },
  { ad: 'Meram, Konya', alt: 'Oyunun başladığı yer — parselini seç', merkez: [32.4325, 37.8397], zoom: 16.4, pitch: 62, bearing: -25 },
];

function altYaziKutusu(kap) {
  let el = kap.querySelector('.sinema-yazi');
  if (!el) {
    el = document.createElement('div');
    el.className = 'sinema-yazi';
    el.setAttribute('aria-live', 'polite');
    kap.appendChild(el);
  }
  return el;
}
function yaz(kap, baslik, alt) {
  const el = altYaziKutusu(kap);
  el.classList.remove('acik');
  el.innerHTML = '';
  if (!baslik) return;
  const b = document.createElement('strong'); b.textContent = baslik;
  const a = document.createElement('span'); a.textContent = alt || '';
  el.append(b, a);
  requestAnimationFrame(() => el.classList.add('acik'));
}

// Giriş: oturumda bir kez, bağlantıda konum yoksa. Uzaydan dünya → Türkiye'ye süzülüş.
// Sayfa açılırkenki adres: harita yüklenince kendi konumunu adrese yazar, karar ondan önceki hâle göre verilir
const ILK_ADRES = { hash: location.hash, arama: location.search };
export function girisOynayacakMi() {
  let ilk = false;
  try { ilk = !sessionStorage.getItem('st-giris'); } catch { /* özel pencere */ }
  return ilk && !hareketAz() && !/konum=/.test(ILK_ADRES.hash) && !/parsel=/.test(ILK_ADRES.arama);
}
// Uçuş bitince (ya da kullanıcı keserse) çözülen söz; oynamayacaksa null
export function girisUcusu(map, { hedefKutu, dolgu, kap }) {
  if (!girisOynayacakMi()) return null;
  try { sessionStorage.setItem('st-giris', '1'); } catch { /* özel pencere */ }
  map.jumpTo({ center: [32, 30], zoom: 1.75, pitch: 0, bearing: -12 });
  sinemaKipi(kap, 'giris-oynuyor', true);
  yaz(kap, 'SANAL TÜRKİYE', 'Yaşayan dijital ülke');
  return new Promise((coz) => {
    let bitti = false;
    const bitir = () => { if (bitti) return; bitti = true; sinemaKipi(kap, 'giris-oynuyor', false); setTimeout(() => yaz(kap, null), 600); coz(); };
    setTimeout(() => {
      map.fitBounds(hedefKutu, { padding: dolgu, duration: 5200, essential: true, curve: 1.3, pitch: 18, bearing: 0 });
      map.once('moveend', bitir);
    }, 900);
    ['mousedown', 'wheel', 'touchstart'].forEach((t) => kap.addEventListener(t, () => { if (!bitti) { map.stop(); bitir(); } }, { once: true, passive: true }));
  });
}
// Sinema sırasında harita üstü arayüz (lejant, ipucu) çekilir
function sinemaKipi(kap, sinif, acik) {
  kap.classList.toggle(sinif, acik);
  document.body.classList.toggle('sinema', acik);
}

// Tur: her durakta uçuş + yavaş yörünge. Döndürülen fonksiyon turu durdurur.
export function turBaslat(map, kap, { kipAyarla, bitince } = {}) {
  let durdu = false;
  const durdur = () => {
    if (durdu) return;
    durdu = true;
    map.stop();
    yaz(kap, null);
    sinemaKipi(kap, 'tur-oynuyor', false);
    for (const t of OLAYLAR) kap.removeEventListener(t, durdur);
    window.removeEventListener('keydown', durdur);
    bitince?.();
  };
  const OLAYLAR = ['mousedown', 'wheel', 'touchstart'];
  for (const t of OLAYLAR) kap.addEventListener(t, durdur, { passive: true });
  window.addEventListener('keydown', durdur);
  sinemaKipi(kap, 'tur-oynuyor', true);
  kipAyarla?.('3d');

  const hareket = (fn) => new Promise((coz) => { if (durdu) return coz(); map.once('moveend', () => coz()); fn(); });
  (async () => {
    for (const d of TUR) {
      if (durdu) return;
      yaz(kap, d.ad, d.alt);
      if (hareketAz()) map.jumpTo({ center: d.merkez, zoom: d.zoom, pitch: d.pitch, bearing: d.bearing });
      else await hareket(() => map.flyTo({ center: d.merkez, zoom: d.zoom, pitch: d.pitch, bearing: d.bearing, duration: 7000, curve: 1.5, essential: true }));
      if (durdu) return;
      // Yörünge: karolar yüklenirken yavaşça dön
      if (!hareketAz()) await hareket(() => map.easeTo({ bearing: d.bearing + (d.yorunge ?? 55), duration: 9000, easing: (t) => t, essential: true }));
      else await new Promise((r) => setTimeout(r, 4000));
    }
    if (!durdu) { durdu = true; sinemaKipi(kap, 'tur-oynuyor', false); setTimeout(() => yaz(kap, null), 2500); for (const t of OLAYLAR) kap.removeEventListener(t, durdur); window.removeEventListener('keydown', durdur); bitince?.(); }
  })();
  return durdur;
}
