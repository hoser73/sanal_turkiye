// Rehber: Hasan Dayı (kendi çizimimiz, SVG) yeni oyuncuya ilk adımları gösterir. Adım, sunucudaki ilk görevlerin
// (ILK_PARSEL, ILK_EKIM, …) durumundan çıkar; oyuncu bir şey yaptıkça rehber kendiliğinden sonraki adıma geçer.
// "Göster" ilgili düğmeyi ışıkla vurgular (gerekirse haritayı uçurur, kartı açar). Küçültülebilir; tamamen kapatılabilir.
import { esc } from './yardimci.js';

export const HASAN_DAYI = `<svg viewBox="0 0 120 120" aria-hidden="true">
  <circle cx="60" cy="62" r="48" fill="#f6d77a" stroke="#8a5414" stroke-width="4"/>
  <path d="M22 104c6-20 22-28 38-28s32 8 38 28" fill="#3f7d2a" stroke="#2c5a1d" stroke-width="3"/>
  <path d="M46 78l14 10 14-10" fill="none" stroke="#2c5a1d" stroke-width="3"/>
  <ellipse cx="60" cy="58" rx="24" ry="27" fill="#f2c9a0" stroke="#a8754a" stroke-width="2.5"/>
  <circle cx="36" cy="60" r="6" fill="#efbb8e" stroke="#a8754a" stroke-width="2"/><circle cx="84" cy="60" r="6" fill="#efbb8e" stroke="#a8754a" stroke-width="2"/>
  <path d="M33 42c2-16 14-22 27-22s27 6 29 21c-10-5-48-5-56 1z" fill="#6b4a2a" stroke="#4a3018" stroke-width="2.5"/>
  <path d="M30 43c10-6 50-6 62 0l-4 5c-12-4-42-4-54 0z" fill="#5a3a1e"/>
  <circle cx="51" cy="56" r="3.2" fill="#3b2410"/><circle cx="69" cy="56" r="3.2" fill="#3b2410"/>
  <path d="M46 49q5-3 10 0M64 49q5-3 10 0" stroke="#7a5a3a" stroke-width="2.4" fill="none" stroke-linecap="round"/>
  <path d="M60 58q-3 7 0 9" stroke="#c48a5e" stroke-width="2.4" fill="none" stroke-linecap="round"/>
  <path d="M42 70q9-6 18-1q9-5 18 1q-6 6-18 3q-12 3-18-3z" fill="#e8e2d6" stroke="#9a9488" stroke-width="1.6"/>
  <path d="M52 77q8 5 16 0" stroke="#8a4a2a" stroke-width="2.4" fill="none" stroke-linecap="round"/>
  <circle cx="45" cy="66" r="4" fill="#f2a08a" opacity=".5"/><circle cx="75" cy="66" r="4" fill="#f2a08a" opacity=".5"/>
</svg>`;

// Adımlar: görev kodu tamamlanmamışsa sıradaki adım odur
const ADIMLAR = [
  { kod: 'ILK_PARSEL', baslik: 'Hoş geldin evlat!', metin: 'Ben Hasan Dayı. Önce kendine bir tarla edinelim: haritada yeşil (tarım) bir parsele dokun, kartındaki <b>Parseli edin</b> düğmesine bas.',
    dugme: 'Bana tarla göster', hedef: '[data-eylem="edin"]', is: 'tarlaGoster' },
  { kod: 'ILK_EKIM', baslik: 'Tohum zamanı', metin: 'Tarlan hazır. Kartındaki ürünlerden birini seç ve ek; buğday hızlı büyür, iyi bir başlangıç.',
    dugme: 'Göster', hedef: '[data-eylem="ek"]', is: 'tarlamaGit' },
  { kod: 'ILK_SULAMA', baslik: 'Toprak susadı', metin: 'Ekinler suyu sever. <b>Sula</b> düğmesine bas; her sulama hasadı bereketlendirir.',
    dugme: 'Göster', hedef: '[data-eylem="sula"]', is: 'tarlamaGit' },
  { kod: 'ILK_YAPI', baslik: 'Tarlanı geliştir', metin: 'İnşaat atölyesinden bir çit, sulama hattı ya da ağaç dik. Sulama hattı ekinini kendiliğinden sular.',
    dugme: 'Göster', hedef: '[data-eylem="insaat"]:not([disabled])', is: 'tarlamaGit' },
  { kod: 'ILK_HASAT', baslik: 'Sabır, bereket getirir', metin: 'Ekinin olgunlaşınca tarlanın üstünde 🧺 balonu belirir. O zaman <b>Hasat et</b>. Beklerken komşulara göz atabilirsin.',
    dugme: 'Tarlama git', hedef: '[data-eylem="hasat"]', is: 'tarlamaGit' },
  { kod: 'ILK_SATIS', baslik: 'Pazara gidelim', metin: 'Ürünlerin <b>Arazilerim</b> sekmesindeki envanterde. Bir kısmını pazara sat, akçe kazan; geri kalanı siparişler için sakla.',
    dugme: 'Göster', hedef: '.sat-form button', is: 'arazilerim' },
  { kod: 'KOMSU_ZIYARET', baslik: 'Komşuluk hakkı', metin: 'Bir komşunun tarlasına dokun, <b>Ziyaret et</b> ve <b>Komşu ol</b>. Komşular birbirinin tarlasını sular, hediye gönderir.',
    dugme: 'Komşularım', hedef: '[data-eylem="ziyaret"]', is: 'komsular' },
  { kod: 'CIFTLIK', baslik: 'Çiftliğin seni bekliyor', metin: '<b>Çiftliğim</b> sekmesinde günlük ödülün, köylülerin siparişleri, komşuların ve yöresel ürünlerin var. Hadi bakalım!',
    dugme: 'Çiftliğim', hedef: '#gorevler-cift', is: 'ciftlik' },
];

export function rehberKur({ durum, harita, parselSec, sekmeSec, ciftlikAlt }) {
  const kok = document.createElement('div');
  kok.className = 'rehber';
  kok.innerHTML = `<button type="button" class="rehber-avatar" aria-label="Hasan Dayı: rehber">${HASAN_DAYI}<span class="rehber-nokta" hidden></span></button>
    <div class="rehber-balon" role="dialog" aria-live="polite" hidden></div>`;
  document.body.appendChild(kok);
  const avatar = kok.querySelector('.rehber-avatar'), balon = kok.querySelector('.rehber-balon'), nokta = kok.querySelector('.rehber-nokta');
  const isik = document.createElement('div');
  isik.className = 'rehber-isik';
  isik.hidden = true;
  document.body.appendChild(isik);
  const oku = (k, v) => { try { return localStorage.getItem(k) ?? v; } catch { return v; } };
  const yaz = (k, v) => { try { localStorage.setItem(k, v); } catch { /* özel pencere */ } };

  let adim = null, isikHedef = null, isikKare = 0, isikBitis = 0;
  function sonrakiAdim() {
    const b = durum.ben;
    if (!b) return null;
    const tamam = new Set(b.gorevler.filter((g) => g.tamam).map((g) => g.kod));
    const a = ADIMLAR.find((x) => x.kod !== 'CIFTLIK' && !tamam.has(x.kod));
    if (a) return a;
    return oku('st-rehber-ciftlik', '') ? null : ADIMLAR.at(-1);
  }
  function ciz() {
    if (!adim) { balon.hidden = true; return; }
    const b = durum.ben;
    const sira = ADIMLAR.indexOf(adim) + 1;
    balon.innerHTML = `<div class="rehber-ust"><b>${adim.baslik.replace('{ad}', esc(b?.kullanici?.ad || ''))}</b><span class="kucuk">${sira}/${ADIMLAR.length}</span></div>
      <p>${adim.metin}</p>
      <div class="satir"><button type="button" class="dugme altin ince" data-rehber="goster">👉 ${esc(adim.dugme)}</button>
        <span><button type="button" class="bag" data-rehber="sonra">sonra</button> · <button type="button" class="bag" data-rehber="kapat">rehberi kapat</button></span></div>`;
  }
  function ac() { if (!adim) return; ciz(); balon.hidden = false; nokta.hidden = true; }
  function kucult() { balon.hidden = true; isikKapat(); }

  // Işık: hedef öğenin çevresi parlak, gerisi loş; öğe kaydırılırsa izler
  function isikKapat() { cancelAnimationFrame(isikKare); isik.hidden = true; isikHedef = null; }
  function isikTut(secici, sure = 9000) {
    isikKapat();
    isikBitis = performance.now() + sure;
    const dongu = () => {
      if (performance.now() > isikBitis) return isikKapat();
      isikKare = requestAnimationFrame(dongu);
      if (!isikHedef || !isikHedef.isConnected) {
        isikHedef = [...document.querySelectorAll(secici)].find((el) => el.offsetParent !== null) || null;
        if (isikHedef) isikHedef.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      if (!isikHedef) { isik.hidden = true; return; }
      const r = isikHedef.getBoundingClientRect();
      Object.assign(isik.style, { left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` });
      isik.hidden = false;
    };
    isikKare = requestAnimationFrame(dongu);
  }
  document.addEventListener('pointerdown', (e) => { if (isikHedef && isikHedef.contains(e.target)) setTimeout(isikKapat, 50); }, true);

  const ISLER = {
    async tarlaGoster() {
      const m = harita.map.getCenter();
      const [lon, lat] = harita.zoom() >= 10 ? [m.lng, m.lat] : [32.4325, 37.8397];   // uzaktaysa Meram
      const r = await fetch(`/api/oneri/tarla?lon=${lon}&lat=${lat}`).then((x) => x.json()).catch(() => ({}));
      if (!r.parsel) return;
      harita.parseleGit(r.parsel, { zoom: 17.6 });
      parselSec(r.parsel);
    },
    tarlamaGit() {
      const p = durum.ben?.portfoy?.find((x) => x.imarAd === 'Tarım') || durum.ben?.portfoy?.[0];
      if (!p) return;
      harita.parseleGit(p.id, { zoom: 17.6 });
      parselSec(p.id);
    },
    arazilerim() { sekmeSec('arazilerim'); },
    komsular() { ciftlikAlt('komsular'); },
    ciftlik() { ciftlikAlt('ciftlik'); yaz('st-rehber-ciftlik', '1'); setTimeout(guncelle, 50); },
  };
  balon.addEventListener('click', async (e) => {
    const r = e.target.closest('[data-rehber]')?.dataset.rehber;
    if (r === 'sonra') kucult();
    else if (r === 'kapat') { yaz('st-rehber', 'kapali'); kok.hidden = true; isikKapat(); }
    else if (r === 'goster' && adim) {
      kucult();
      await ISLER[adim.is]?.();
      if (adim?.hedef) isikTut(adim.hedef);
    }
  });
  avatar.addEventListener('click', () => (balon.hidden ? ac() : kucult()));

  // Oyuncu durumu değiştikçe çağrılır: adım değiştiyse balon kendiliğinden açılır
  function guncelle() {
    if (oku('st-rehber', '') === 'kapali' || !durum.ben) { kok.hidden = true; return; }
    const yeni = sonrakiAdim();
    kok.hidden = !yeni;
    if (!yeni) { adim = null; isikKapat(); return; }
    if (yeni !== adim) {
      adim = yeni;
      const gorulen = oku('st-rehber-adim', '');
      if (gorulen !== adim.kod) { yaz('st-rehber-adim', adim.kod); ac(); }
      else { ciz(); nokta.hidden = false; }
    }
  }
  return { guncelle, ac, yeniden() { yaz('st-rehber', ''); yaz('st-rehber-adim', ''); yaz('st-rehber-ciftlik', ''); adim = null; guncelle(); } };
}
