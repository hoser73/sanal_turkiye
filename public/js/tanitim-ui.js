// Açılış (tanıtım) sayfası: elle çizilmiş katmanlı SVG manzara (derinlik efekti, gece/gündüz), dönen başlık, canlı veriler
// (/api/tanitim: sayılar, son olaylar, büyük şehirlerin havası, yöresel ürünler, sponsorlar), kaydırınca beliren bölümler
// ve etkileşimli Türkiye il haritası. Hesap kartı giris-ui.js'dedir; burası yalnızca vitrini yönetir.
import { esc, sayi } from './yardimci.js';

const hareketAz = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const DONEN = ['çiftliğini kur.', 'tarlanı ek.', 'hasadını sat.', 'göle olta at.', 'bulmaca çöz.', 'köyünü büyüt.'];
const AKIS_METIN = {
  CROP_HARVESTED: (o) => ['🧺', `${o.urun ? `${o.urun.ikon} ${o.urun.ad}` : 'Ürün'} hasat edildi`],
  CROP_PLANTED: (o) => ['🌱', `${o.urun ? `${o.urun.ikon} ${o.urun.ad}` : 'Tohum'} ekildi`],
  PARCEL_ACQUIRED: () => ['🏡', 'yeni bir çiftçi tarla aldı'],
  STRUCTURE_COMPLETED: () => ['🏗️', 'yeni bir yapı tamamlandı'],
  GI_PRODUCED: () => ['⭐', 'yöresel ürün üretildi'],
  NEIGHBOR_HELPED: () => ['🤝', 'komşu tarlasına yardım edildi'],
  PRODUCTION_COLLECTED: (o) => ['📦', `${o.urun ? `${o.urun.ikon} ${o.urun.ad}` : 'ürün'} üretildi`],
};
function once(zaman) {
  const dk = Math.max(0, Math.round((Date.now() - Date.parse(`${zaman.replace(' ', 'T')}Z`)) / 60000));
  return dk < 1 ? 'az önce' : dk < 60 ? `${dk} dk önce` : dk < 1440 ? `${Math.round(dk / 60)} sa önce` : `${Math.round(dk / 1440)} gün önce`;
}

// ---------- Manzara (SVG): uzak dağlar, tarlalı tepeler, yel değirmeni, ev, ahır, çit, hayvanlar, kuşlar
function manzara() {
  const agac = (x, y, s = 1, r = '#4f8f3a') => `<g transform="translate(${x} ${y}) scale(${s})"><rect x="-4" y="-6" width="8" height="26" rx="2" fill="#7a5130"/>
    <circle cx="0" cy="-22" r="20" fill="${r}"/><circle cx="-14" cy="-12" r="14" fill="${r}"/><circle cx="14" cy="-12" r="14" fill="${r}"/><circle cx="-5" cy="-30" r="9" fill="rgba(255,255,255,.14)"/></g>`;
  const servi = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})"><rect x="-2.5" y="-4" width="5" height="12" fill="#6a4628"/><path d="M0 -70 C14 -40 12 -10 0 0 C-12 -10 -14 -40 0 -70Z" fill="#2f6b34"/></g>`;
  const cit = Array.from({ length: 22 }, (_, i) => { const x = 520 + i * 22, y = 772 - Math.sin(i / 3) * 6; return `<rect x="${x}" y="${y - 26}" width="5" height="30" rx="1.5" fill="#f4ecdc"/>`; }).join('');
  const cicek = Array.from({ length: 46 }, (_, i) => { const x = (i * 137) % 1600, y = 800 + ((i * 53) % 90); return `<circle cx="${x}" cy="${y}" r="${2 + (i % 3)}" fill="${['#ffd23f', '#ff7aa2', '#ffffff', '#b38bff'][i % 4]}"/>`; }).join('');
  return `<svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="tnGunes"><stop offset="0" stop-color="#fffbe0"/><stop offset=".35" stop-color="#ffe680"/><stop offset="1" stop-color="#ffd24a" stop-opacity="0"/></radialGradient>
    <linearGradient id="tnDag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8eaec6"/><stop offset="1" stop-color="#c3d6e2"/></linearGradient>
    <linearGradient id="tnTepe1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a6d374"/><stop offset="1" stop-color="#7bb34c"/></linearGradient>
    <linearGradient id="tnOn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7dbb4c"/><stop offset="1" stop-color="#4c872c"/></linearGradient>
    <linearGradient id="tnNehir" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6fc3e8"/><stop offset="1" stop-color="#3b97cf"/></linearGradient>
    <pattern id="tnBugday" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(-10)"><rect width="12" height="12" fill="#ecc85c"/><rect width="12" height="3" fill="#d8ac3c"/></pattern>
    <pattern id="tnEkin" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(8)"><rect width="12" height="12" fill="#8cc45a"/><rect width="12" height="4" fill="#5f9b38"/></pattern>
    <pattern id="tnLavanta" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(-6)"><rect width="12" height="12" fill="#b49be0"/><rect width="12" height="4" fill="#8a6bc6"/></pattern>
    <pattern id="tnToprak" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(12)"><rect width="12" height="12" fill="#b57e48"/><rect width="12" height="3" fill="#94622f"/></pattern>
  </defs>
  <g class="tn-k" data-d="0.08">
    <g class="tn-gunes-g"><circle cx="1290" cy="190" r="170" fill="url(#tnGunes)" opacity=".75"/><circle cx="1290" cy="190" r="62" fill="#fff4b8"/></g>
    <g class="tn-yildizlar">${Array.from({ length: 60 }, (_, i) => `<circle cx="${(i * 263) % 1600}" cy="${(i * 97) % 380}" r="${1 + (i % 3) * 0.6}" fill="#fff"/>`).join('')}</g>
    <g class="tn-bulutlar">${[[180, 150, 1], [620, 90, 0.75], [980, 230, 0.6], [1460, 120, 0.85]].map(([x, y, s], i) => `<g class="tn-bulut" style="--s:${70 + i * 18}s;--g:-${i * 17}s"><g transform="translate(${x} ${y}) scale(${s})"><ellipse cx="0" cy="0" rx="90" ry="34" fill="#fff"/><circle cx="-30" cy="-24" r="36" fill="#fff"/><circle cx="26" cy="-30" r="44" fill="#fff"/><ellipse cx="0" cy="12" rx="92" ry="16" fill="#e3eef6"/></g></g>`).join('')}</g>
    <path d="M0 540 L120 450 L210 488 L330 372 L432 452 L540 398 L650 462 L780 350 L900 440 L1010 386 L1130 460 L1260 368 L1380 448 L1480 410 L1600 470 V640 H0Z" fill="url(#tnDag)"/>
    <path d="M330 372 L352 392 L338 390 L326 400 L312 388Z M780 350 L804 372 L790 370 L776 382 L760 368Z M1260 368 L1284 390 L1270 388 L1256 398 L1242 386Z" fill="#f4f8fb"/>
  </g>
  <g class="tn-k" data-d="0.22">
    <path d="M0 585 C220 520 420 540 620 570 S1020 500 1240 548 S1500 530 1600 545 V900 H0Z" fill="url(#tnTepe1)"/>
    <path d="M90 632 L300 592 L352 630 L140 676Z" fill="url(#tnBugday)"/><path d="M340 626 L540 596 L590 636 L390 670Z" fill="url(#tnEkin)"/>
    <path d="M610 640 L830 612 L870 660 L640 690Z" fill="url(#tnBugday)"/><path d="M880 590 L1090 566 L1130 610 L910 636Z" fill="url(#tnLavanta)"/>
    <path d="M1150 600 L1370 584 L1410 628 L1180 646Z" fill="url(#tnToprak)"/><path d="M1380 590 L1600 578 V630 L1420 640Z" fill="url(#tnEkin)"/>
    ${[[60, 600], [380, 590], [570, 612], [1110, 588], [1300, 575], [1530, 572]].map(([x, y]) => agac(x, y, 0.55, '#5b9a40')).join('')}
    <path d="M640 700 C760 680 880 700 1000 690 S1300 660 1600 672" stroke="url(#tnNehir)" stroke-width="16" fill="none" stroke-linecap="round"/>
    <path d="M700 694 C780 686 840 690 900 688 M1100 680 C1200 672 1300 668 1380 670" stroke="#d8f1ff" stroke-width="2.5" fill="none" opacity=".7" class="tn-parilti"/>
    <g transform="translate(1040 600)">
      <path d="M-14 0 L14 0 L22 86 L-22 86Z" fill="#f2e7d2"/><path d="M-18 0 L18 0 L0 -18Z" fill="#b5532a"/><rect x="-6" y="56" width="12" height="30" fill="#8a5a32"/>
      <g class="tn-pervane"><g fill="#fffaf0" stroke="#c9b48a" stroke-width="1.5">${[0, 90, 180, 270].map((a) => `<rect x="-5" y="-78" width="10" height="72" rx="3" transform="rotate(${a})"/>`).join('')}</g><circle r="7" fill="#7a5130"/></g>
    </g>
  </g>
  <g class="tn-k" data-d="0.45">
    <path d="M0 720 C300 668 600 690 840 722 S1320 676 1600 706 V900 H0Z" fill="url(#tnOn)"/>
    <path d="M780 900 C820 830 900 780 1000 730 L1030 734 C950 790 900 840 880 900Z" fill="#e2c592"/>
    <g transform="translate(1170 732)">
      <rect x="-70" y="-58" width="140" height="62" fill="#fff4e2"/><path d="M-84 -56 L0 -112 L84 -56Z" fill="#c8402e"/><path d="M-84 -56 L0 -112 L84 -56" stroke="#9e2f20" stroke-width="5" fill="none"/>
      <rect x="40" y="-108" width="16" height="34" fill="#9e2f20"/>
      <g class="tn-duman"><circle cx="48" cy="-122" r="9" fill="#fff"/><circle cx="56" cy="-142" r="12" fill="#fff"/><circle cx="66" cy="-168" r="15" fill="#fff"/></g>
      <rect x="-14" y="-34" width="28" height="38" rx="3" fill="#8a5a32"/>
      <rect class="tn-pencere" x="-56" y="-42" width="28" height="22" rx="2" fill="#bfe3f5" stroke="#fff" stroke-width="3"/><rect class="tn-pencere" x="28" y="-42" width="28" height="22" rx="2" fill="#bfe3f5" stroke="#fff" stroke-width="3"/>
    </g>
    <g transform="translate(1385 742)">
      <path d="M-62 0 L-62 -60 L0 -98 L62 -60 L62 0Z" fill="#b5332a"/><path d="M-62 -60 L0 -98 L62 -60" stroke="#f4ecdc" stroke-width="6" fill="none"/>
      <rect x="-24" y="-48" width="48" height="48" fill="#8e2620" stroke="#f4ecdc" stroke-width="5"/><path d="M-24 -48 L24 0 M24 -48 L-24 0" stroke="#f4ecdc" stroke-width="4"/>
      <circle cx="88" cy="-14" r="16" fill="#e3c072"/><circle cx="112" cy="-12" r="14" fill="#d9b25c"/>
    </g>
    ${agac(70, 730, 1.25)}${agac(330, 742, 1.05, '#5c9c42')}${agac(1575, 722, 1.4, '#4a8a36')}${servi(1278, 742, 1.1)}${servi(1302, 748, 0.85)}
    <g>${cit}<rect x="520" y="752" width="485" height="5" rx="2" fill="#f4ecdc"/><rect x="520" y="765" width="485" height="5" rx="2" fill="#f4ecdc"/></g>
    <g class="tn-hayvanlar" font-size="46"><text class="tn-hayvan" x="600" y="830">🐄</text><text class="tn-hayvan h2" x="690" y="812" font-size="38">🐑</text>
      <text class="tn-hayvan h3" x="1110" y="842" font-size="32">🐓</text><text class="tn-hayvan h2" x="420" y="852" font-size="34">🐕</text></g>
    ${cicek}
  </g>
  <g class="tn-kuslar" stroke="#36404a" stroke-width="2.4" fill="none" stroke-linecap="round">${[[0, 0], [30, -14], [56, 6], [86, -8]].map(([x, y]) => `<path d="M${x} ${y} q8 -8 16 0 q8 -8 16 0"/>`).join('')}</g>
  </svg>
  <span class="tn-traktor" aria-hidden="true">🚜</span>`;
}

export function tanitimKur({ api, girisli, kayitAc, epostaKayit, girisAc, kapat, kartKapat, ilOner }) {
  const kok = document.getElementById('acilis');
  if (!kok) return { yenile() {} };
  const az = hareketAz();
  const saat = Number(new Intl.DateTimeFormat('en', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/Istanbul' }).format(new Date()));
  const kahraman = kok.querySelector('.tn-kahraman');
  kahraman.classList.toggle('gece', saat >= 20 || saat < 6);
  kahraman.classList.toggle('aksam', saat >= 17 && saat < 20);
  kok.querySelector('.tn-manzara').innerHTML = manzara();

  // Dönen başlık kelimesi
  if (!az) {
    let i = 0;
    const el = document.getElementById('tnDonen');
    setInterval(() => {
      if (kok.hidden || document.hidden) return;
      i = (i + 1) % DONEN.length;
      el.classList.remove('gir'); void el.offsetWidth;
      el.textContent = DONEN[i]; el.classList.add('gir');
    }, 2600);
  }

  // Derinlik: fare (masaüstü) ve kaydırma
  const katmanlar = [...kok.querySelectorAll('.tn-k')];
  let fx = 0, fy = 0, kaydir = 0, kare = 0;
  const uygula = () => {
    kare = 0;
    for (const k of katmanlar) { const d = Number(k.dataset.d); k.style.transform = `translate(${-fx * d * 60}px, ${kaydir * d * 0.6 - fy * d * 20}px)`; }
  };
  const planla = () => { if (!kare && !az) kare = requestAnimationFrame(uygula); };
  kahraman.addEventListener('pointermove', (e) => { if (e.pointerType !== 'mouse') return; fx = e.clientX / innerWidth - 0.5; fy = e.clientY / innerHeight - 0.5; planla(); });
  kok.addEventListener('scroll', () => { kaydir = Math.min(kok.scrollTop, innerHeight); planla(); kok.classList.toggle('kaydi', kok.scrollTop > 40); }, { passive: true });

  // Bölümler kaydırınca belirsin; sayaçlar sayar
  const gozcu = new IntersectionObserver((girdiler) => {
    for (const g of girdiler) if (g.isIntersecting) { g.target.classList.add('gorundu'); gozcu.unobserve(g.target); }
  }, { root: kok, threshold: 0.15 });
  kok.querySelectorAll('.tn-gorun').forEach((el) => (az ? el.classList.add('gorundu') : gozcu.observe(el)));
  const sayacGozcu = new IntersectionObserver((girdiler) => {
    for (const g of girdiler) {
      if (!g.isIntersecting) continue;
      sayacGozcu.unobserve(g.target);
      const hedef = Number(g.target.dataset.sayac), bas = performance.now();
      if (az || !hedef) continue;
      const adim = (t) => { const p = Math.min(1, (t - bas) / 1400); g.target.textContent = sayi(Math.round(hedef * (1 - (1 - p) ** 3))); if (p < 1) requestAnimationFrame(adim); };
      requestAnimationFrame(adim);
    }
  }, { root: kok });
  kok.querySelectorAll('[data-sayac]').forEach((el) => sayacGozcu.observe(el));

  // Gezinme ve düğmeler (adres çubuğundaki #konum'u bozmadan kaydırır)
  kok.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#tn"]');
    if (a) { e.preventDefault(); kok.querySelector(a.getAttribute('href'))?.scrollIntoView({ behavior: az ? 'auto' : 'smooth', block: 'start' }); return; }
    if (e.target.id === 'tnGirisModal') { kartKapat(); return; }   // pencerenin dışına tık
    const b = e.target.closest('[data-tn]');
    if (!b) return;
    const t = b.dataset.tn;
    // Giriş yapmış biri (ör. kayıdın son adımında pencereyi kapattıysa) OYNA ile doğrudan oyuna geçer
    const hesapAc = (f) => (girisli() ? kapat() : f());
    if (t === 'yukari') { e.preventDefault(); kok.scrollTo({ top: 0, behavior: az ? 'auto' : 'smooth' }); }
    if (t === 'oyna' || t === 'kayit') hesapAc(kayitAc);
    if (t === 'kayit-eposta') hesapAc(epostaKayit);
    if (t === 'giris') hesapAc(girisAc);
    if (t === 'gez') kapat();
    if (t === 'kart-kapat') kartKapat();
    if (t === 'il-basla') { ilOner?.(b.dataset.plaka); hesapAc(kayitAc); }
  });

  // Canlı veri
  let veri = null;
  async function yenile() {
    try { veri = await api('/api/tanitim'); } catch { return; }
    const s = veri.sayilar;
    document.getElementById('tnCanliEtiket').textContent = s.hasat24 > 0
      ? `Şu an canlı · son 24 saatte ${sayi(s.hasat24)} hasat, ${sayi(s.ekim24)} ekim` : 'Yaşayan dijital Türkiye';
    const akis = veri.akis.map((o) => { const [ikon, metin] = (AKIS_METIN[o.eylem] || (() => ['•', 'oyunda bir şey oldu']))(o); return `<span class="tn-akis-oge">${ikon} <b>${esc(o.yer)}</b> ${esc(metin)} <small>${once(o.zaman)}</small></span>`; });
    const ak = document.getElementById('tnAkis');
    if (akis.length) ak.innerHTML = akis.join('') + akis.join('');
    else ak.innerHTML = veri.hava.concat(veri.hava).map((h) => `<span class="tn-akis-oge">${h.ikon} <b>${esc(h.il)}</b> şu an ${h.sicaklik}° · ${esc(h.durum)}</span>`).join('');
    const yr = veri.yoresel.map((y) => `<span class="tn-yoresel-oge"><span>${y.ikon}</span><b>${esc(y.ad)}</b><small>${esc(y.il)}</small></span>`).join('');
    document.getElementById('tnYoresel').innerHTML = yr + yr;
    if (veri.sponsorlar.length) {
      document.getElementById('tnSponsor').hidden = false;
      document.getElementById('tnSponsorListe').innerHTML = veri.sponsorlar.map((m) => `<span class="tn-sponsor-oge" style="--renk:${esc(m.renk)}">${m.logo ? `<img src="${esc(m.logo)}" alt="" width="40" height="40">` : `<span>${esc(m.ikon)}</span>`}<b>${esc(m.ad)}</b><small>${esc(m.tur)}</small></span>`).join('');
    }
  }
  yenile().finally(() => { if (!kok.hidden) ucKur(); });

  // 3B kahraman: gerçek zamanlı sevimli çiftlik sahnesi (tanitim-sevimli.js); WebGL yoksa SVG manzara kalır
  const webgl = (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } })();
  let uc = null, ucYukleniyor = false;
  async function ucKur() {
    if (uc || ucYukleniyor || !webgl) return;   // hareket azaltılmışsa da çizilir; yalnızca kamera sabit durur
    ucYukleniyor = true;
    try {
      // Oyunun görsel diliyle aynı sevimli çiftlik
      const { sevimliTanitim } = await import('./tanitim-sevimli.js');
      if (kok.hidden) return;
      uc = sevimliTanitim(kok.querySelector('.tn-manzara'), { sakin: az });
      await uc.hazir;
      kahraman.classList.add('uc');
      kahraman.classList.toggle('gece', uc.gece > 0.5);
      kahraman.classList.toggle('aksam', uc.alaca > 0.4 && uc.gece <= 0.5);
    } catch { uc?.durdur(); uc = null; } finally { ucYukleniyor = false; }
  }

  // Açılış kapanınca 3B sahne kapatılır; yeniden açılınca kurulur
  new MutationObserver(() => {
    if (kok.hidden) { uc?.durdur(); uc = null; kahraman.classList.remove('uc'); }
    else ucKur();
  }).observe(kok, { attributes: true, attributeFilter: ['hidden'] });

  // Etkileşimli Türkiye haritası (bölüme yaklaşınca yüklenir)
  let haritaKuruldu = false;
  const haritaGozcu = new IntersectionObserver((g) => { if (g[0].isIntersecting && !haritaKuruldu) { haritaKuruldu = true; haritaGozcu.disconnect(); haritaKur(); } }, { root: kok, rootMargin: '400px' });
  haritaGozcu.observe(document.getElementById('tn-turkiye'));
  async function haritaKur() {
    const kap = document.getElementById('tnHarita'), kart = document.getElementById('tnIlKart');
    let g, etiket, hava, ist;
    try {
      [g, etiket, hava, ist] = await Promise.all([fetch('/veri/iller.geojson').then((r) => r.json()), fetch('/veri/il-etiketleri.geojson').then((r) => r.json()),
        api('/api/hava').catch(() => null), api('/api/istatistik/iller').catch(() => [])]);
    } catch { kap.innerHTML = '<p class="kucuk">Harita yüklenemedi.</p>'; return; }
    const L0 = 25.5, L1 = 44.9, B0 = 35.75, B1 = 42.2, K = Math.cos((39 * Math.PI) / 180), W = 1000, olcek = W / ((L1 - L0) * K), H = Math.round((B1 - B0) * olcek);
    const xy = ([lon, lat]) => [(lon - L0) * K * olcek, (B1 - lat) * olcek];
    const halka = (h) => { let d = '', son = null; for (const p of h) { const [x, y] = xy(p); if (son && Math.abs(x - son[0]) + Math.abs(y - son[1]) < 1.1) continue; d += `${d ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`; son = [x, y]; } return `${d}Z`; };
    const yol = (geo) => (geo.type === 'Polygon' ? [geo.coordinates] : geo.coordinates).map((p) => p.map(halka).join('')).join('');
    const istMap = new Map((ist || []).map((x) => [x.plaka, x]));
    const havaMap = new Map((hava?.iller || []).map((x) => [x.plaka, x]));
    const yoresel = new Map();
    for (const y of veri?.yoresel || []) yoresel.set(y.plaka, [...(yoresel.get(y.plaka) || []), y]);
    const aktiflik = (p) => Math.min(1, (istMap.get(p)?.parsel || 0) / 8);
    kap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
      <g class="tn-iller">${g.features.map((f) => `<path class="tn-il" data-plaka="${esc(f.properties.plaka)}" d="${yol(f.geometry)}" style="--a:${aktiflik(f.properties.plaka)}"><title>${esc(f.properties.ad)}</title></path>`).join('')}</g>
      <g class="tn-ikonlar">${etiket.features.filter((f) => yoresel.has(f.properties.plaka)).map((f) => { const [x, y] = xy(f.geometry.coordinates); return `<text x="${x.toFixed(1)}" y="${(y + 6).toFixed(1)}">${yoresel.get(f.properties.plaka)[0].ikon}</text>`; }).join('')}</g>
    </svg>`;
    const adlar = new Map(g.features.map((f) => [f.properties.plaka, f.properties.ad]));
    let secili = null;
    const goster = (p) => {
      if (!p) return;
      kap.querySelectorAll('.tn-il.ust').forEach((e) => e.classList.remove('ust'));
      kap.querySelector(`.tn-il[data-plaka="${p}"]`)?.classList.add('ust');
      const h = havaMap.get(p), s = istMap.get(p), y = yoresel.get(p) || [];
      kart.innerHTML = `<p class="tn-il-plaka">${esc(p)}</p><h3>${esc(adlar.get(p))}</h3>
        ${h ? `<p class="tn-il-hava">${h.ikon} <b>${h.sicaklik}°</b> ${esc(h.durum)}</p>` : ''}
        ${y.length ? `<p class="tn-il-yoresel">${y.map((x) => `${x.ikon} ${esc(x.ad)}`).join('<br>')}</p>` : '<p class="kucuk">Bu ilin ürünlerini sen keşfet: tarla, bahçe, hayvancılık.</p>'}
        <p class="kucuk">${s?.parsel ? `${sayi(s.oyuncu)} çiftçi · ${sayi(s.parsel)} tarla` : 'Henüz kimse yok — ilk çiftçi sen ol!'}</p>
        <button type="button" class="dugme altin ince" data-tn="il-basla" data-plaka="${esc(p)}">Bu ilde başla →</button>`;
    };
    kap.addEventListener('pointerover', (e) => { const p = e.target.closest('.tn-il')?.dataset.plaka; if (p && e.pointerType === 'mouse') goster(p); });
    kap.addEventListener('pointerleave', () => { if (secili) goster(secili); });
    kap.addEventListener('click', (e) => { const p = e.target.closest('.tn-il')?.dataset.plaka; if (p) { secili = p; goster(p); } });
    goster('42');
  }

  return { yenile };
}
