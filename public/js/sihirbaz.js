// İlk giriş sihirbazı (istemci). Oyunu hiç bilmeyen yeni oyuncu için:
// 1) Arsa sihirbazı (tam ekran): karşılama → il / ilçe / köy seçimi → o köyde 3 boş tarla (Ada/Parsel, alan) → seçilen
//    arsa hediye olarak oyuncunun olur → oyun içi tapu belgesi → "Çiftliğime git".
// 2) Çiftlik turu (kilitli): çiftlikte yalnızca sıradaki düğme dokunulabilir, parmak işareti onu gösterir:
//    ek → sula → (ilk ekin 1 dakikada olur) hasat → pazarda sat → ilk yapı → günlük görevler. Her adımın ödülü sunucudan
//    (sihirbaz.js) gelir. "Atla" her zaman var. Sunucu adımları denetim kayıtlarından okur; sayfa yenilense de kalınan
//    yerden devam edilir.
import { api, esc, akce, sayi } from './yardimci.js';

// Karşılama çizimi: güneş, tepeler, ahır ve ekili tarla (kendi çizimimiz)
const CIFTLIK_RESMI = `<svg viewBox="0 0 260 130" role="img">
  <defs><linearGradient id="shzGok" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfe8ff"/><stop offset="1" stop-color="#eaf8ff"/></linearGradient></defs>
  <rect width="260" height="130" rx="22" fill="url(#shzGok)"/>
  <circle cx="212" cy="34" r="17" fill="#ffd45c"/><circle cx="212" cy="34" r="24" fill="#ffd45c" opacity=".25"/>
  <g fill="#fff"><ellipse cx="62" cy="30" rx="22" ry="9"/><ellipse cx="78" cy="25" rx="14" ry="10"/><ellipse cx="150" cy="22" rx="16" ry="6"/></g>
  <path d="M0 84 Q55 46 118 74 T260 66 V130 H0Z" fill="#8fd16a"/>
  <path d="M0 98 Q80 70 160 92 T260 88 V130 H0Z" fill="#6cc35a"/>
  <g transform="translate(150 60)"><path d="M0 26 L22 6 L44 26 V52 H0Z" fill="#d9534a"/><path d="M-4 27 L22 3 L48 27" fill="none" stroke="#fff" stroke-width="4" stroke-linejoin="round"/>
    <rect x="15" y="31" width="14" height="21" fill="#7a3a24"/><path d="M15 31 L29 52 M29 31 L15 52" stroke="#f6d7b0" stroke-width="2"/><rect x="18" y="13" width="8" height="8" rx="1" fill="#fff3c4"/></g>
  <g transform="translate(30 92) skewX(-28)"><rect width="96" height="30" rx="5" fill="#a5683a"/>
    <g stroke="#8a5530" stroke-width="3"><path d="M6 8 H90 M6 16 H90 M6 24 H90"/></g>
    <g fill="#5fbf4a"><circle cx="16" cy="7" r="3"/><circle cx="36" cy="7" r="3"/><circle cx="56" cy="7" r="3"/><circle cx="76" cy="7" r="3"/><circle cx="26" cy="15" r="3"/><circle cx="46" cy="15" r="3"/><circle cx="66" cy="15" r="3"/><circle cx="86" cy="15" r="3"/><circle cx="16" cy="23" r="3"/><circle cx="36" cy="23" r="3"/><circle cx="56" cy="23" r="3"/><circle cx="76" cy="23" r="3"/></g></g>
  <g stroke="#fff" stroke-width="3" stroke-linecap="round"><path d="M206 104 V88 M222 104 V88 M238 104 V88 M200 92 H244 M200 100 H244"/></g>
  <g transform="translate(108 70)"><rect x="-2" y="10" width="4" height="14" fill="#7a4a24"/><circle cy="6" r="11" fill="#3f9a3a"/><circle cx="-4" cy="3" r="2.5" fill="#e8483a"/><circle cx="5" cy="8" r="2.5" fill="#e8483a"/></g>
</svg>`;

const ETIKET_SINIF = { village: 'köy', hamlet: 'mezra', suburb: 'mahalle', neighbourhood: 'mahalle', quarter: 'mahalle', town: 'kasaba', city: 'şehir' };
const trSirala = (a, b) => a.localeCompare(b, 'tr');
const kucuk = (s) => s.toLocaleLowerCase('tr');

export function sihirbazKur({ durum, tost, ses, benYenile, haritaYenile, ciftligeGir, sunucuSimdi }) {
  let kap = null, tur = null;

  // ================= 1) Arsa sihirbazı =================
  const secim = { plaka: null, ilce: null, ilceAd: '', yer: null, yerAd: '', adaylar: [], secilen: null };

  function ekranAc() {
    if (kap) return;
    kap = document.createElement('div');
    kap.className = 'shz';
    kap.setAttribute('role', 'dialog');
    kap.setAttribute('aria-modal', 'true');
    kap.innerHTML = '<div class="shz-ic"></div>';
    document.body.appendChild(kap);
    document.body.classList.add('sihirbazda');
  }
  function ekranKapat() {
    kap?.remove(); kap = null;
    if (!tur) document.body.classList.remove('sihirbazda');
  }
  const ic = () => kap.querySelector('.shz-ic');
  // Adım noktaları (1 karşılama, 2 yer, 3 arsa, 4 tapu)
  const noktalar = (n) => `<div class="shz-noktalar" aria-label="Adım ${n} / 4">${[1, 2, 3, 4].map((i) => `<i class="${i < n ? 'bitti' : i === n ? 'simdi' : ''}"></i>`).join('')}</div>`;

  function karsilama() {
    const ad = durum.ben?.kullanici?.ad?.split(' ')[0] || '';
    ic().innerHTML = `${noktalar(1)}
      <div class="shz-resim" aria-hidden="true">${CIFTLIK_RESMI}</div>
      <h1>Hoş geldin${ad ? `, ${esc(ad)}` : ''}!</h1>
      <p class="shz-giris">Bu oyunda Türkiye'nin gerçek haritasında <b>kendi toprağın</b> olacak. Üç kısa adımda çiftliğin hazır.</p>
      <ol class="shz-plan">
        <li><span>🗺️</span><div><b>Arsanı seç</b><small>Bir köy seç, oradaki boş tarlalardan birini al. İlk arsan hediye!</small></div></li>
        <li><span>🌱</span><div><b>Ek, sula, hasat et</b><small>İlk ekinin bir dakikada olgunlaşacak.</small></div></li>
        <li><span>💰</span><div><b>Sat ve büyüt</b><small>Ürününü pazarda sat, kazancınla çiftliğini geliştir.</small></div></li>
      </ol>
      <div class="shz-alt"><button type="button" class="shz-b ana" data-shz="yer">Başlayalım →</button></div>`;
  }

  async function yerSecimi() {
    const iller = (durum.bolgeler || []).filter((b) => b.type === 'IL').sort((a, b) => trSirala(a.name, b.name));
    secim.plaka ??= (durum.ben?.hesap?.memleket || durum.ben?.memleket)?.plaka || '42';
    ic().innerHTML = `${noktalar(2)}
      <button type="button" class="shz-geri" data-shz="karsilama" aria-label="Geri">←</button>
      <h2>Çiftliğin nerede olsun?</h2>
      <p class="shz-not">Memleketini ya da sevdiğin bir yeri seç; o köydeki boş tarlaları göstereceğim. Bilmiyorsan <b>Sen seç</b> de, ben bulayım.</p>
      <label class="shz-alan"><span>İl</span><select data-shz-il>${iller.map((i) => `<option value="${i.plaka}" ${i.plaka === secim.plaka ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select></label>
      <label class="shz-alan"><span>İlçe</span><select data-shz-ilce disabled><option>yükleniyor…</option></select></label>
      <div class="shz-alan"><span>Köy ya da mahalle</span>
        <input type="search" data-shz-ara placeholder="Ara: ör. Ayanbey" autocomplete="off" disabled>
        <div class="shz-yerler" data-shz-yerler><p class="shz-not">Önce ilçeyi seç.</p></div></div>
      <div class="shz-alt">
        <button type="button" class="shz-b" data-shz="farketmez" disabled>Sen seç</button>
        <button type="button" class="shz-b ana" data-shz="adaylar" disabled>Arsaları göster</button></div>`;
    await ilceleriYukle();
  }
  async function ilceleriYukle() {
    const s = kap.querySelector('[data-shz-ilce]');
    s.disabled = true; s.innerHTML = '<option>yükleniyor…</option>';
    const fc = await api(`/api/il/${secim.plaka}/ilceler`).catch(() => null);
    if (!kap) return;
    const ilceler = (fc?.features || []).map((f) => f.properties).sort((a, b) => trSirala(a.ad, b.ad));
    if (!ilceler.length) { s.innerHTML = '<option>ilçe bulunamadı</option>'; return; }
    if (!ilceler.some((i) => i.id === secim.ilce)) { secim.ilce = (ilceler.find((i) => i.ad === 'Merkez') || ilceler[0]).id; secim.yer = null; }
    s.innerHTML = ilceler.map((i) => `<option value="${i.id}" ${i.id === secim.ilce ? 'selected' : ''}>${esc(i.ad)}</option>`).join('');
    s.disabled = false;
    secim.ilceAd = ilceler.find((i) => i.id === secim.ilce)?.ad || '';
    await yerleriYukle();
  }
  let yerListesi = [];
  async function yerleriYukle() {
    const kutu = kap.querySelector('[data-shz-yerler]'), ara = kap.querySelector('[data-shz-ara]');
    kutu.innerHTML = '<p class="shz-not">Köyler yükleniyor…</p>';
    ara.disabled = true;
    kap.querySelector('[data-shz="farketmez"]').disabled = false;
    const fc = await api(`/api/ilce/${secim.ilce}/mahalleler`).catch(() => null);
    if (!kap) return;
    const gorulen = new Set();
    yerListesi = (fc?.features || []).map((f) => f.properties).filter((p) => p.yerId && !gorulen.has(p.yerId) && gorulen.add(p.yerId))
      .sort((a, b) => trSirala(a.ad, b.ad));
    ara.disabled = !yerListesi.length; ara.value = '';
    yerleriCiz('');
  }
  function yerleriCiz(sorgu) {
    const kutu = kap.querySelector('[data-shz-yerler]');
    const s = kucuk(sorgu.trim());
    const liste = yerListesi.filter((y) => !s || kucuk(y.ad).includes(s)).slice(0, 80);
    kutu.innerHTML = liste.length
      ? liste.map((y) => `<button type="button" class="shz-yer ${y.yerId === secim.yer ? 'secili' : ''}" data-shz-yer="${esc(y.yerId)}"><b>${esc(y.ad)}</b><small>${ETIKET_SINIF[y.sinif] || 'yerleşim'}</small></button>`).join('')
      : `<p class="shz-not">${yerListesi.length ? 'Bu adla bir yer yok.' : 'Bu ilçede köy listesi yok; "Sen seç" ile devam et.'}</p>`;
    kap.querySelector('[data-shz="adaylar"]').disabled = !secim.yer;
  }

  // Aday arsanın şekli: üstten görünüm (çimen zemin, sürülmüş toprak, karıklar, kuzey oku)
  function sekilSvg(g, i) {
    const halka = g?.type === 'Polygon' ? g.coordinates[0] : g?.type === 'MultiPolygon' ? g.coordinates[0][0] : null;
    if (!halka?.length) return '';
    const lat0 = halka.reduce((t, p) => t + p[1], 0) / halka.length, kx = Math.cos((lat0 * Math.PI) / 180);
    const pts = halka.map(([x, y]) => [x * kx, -y]);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const W = 160, H = 110, P = 12, o = Math.min((W - 2 * P) / (x1 - x0 || 1), (H - 2 * P) / (y1 - y0 || 1));
    const ox = (W - (x1 - x0) * o) / 2, oy = (H - (y1 - y0) * o) / 2;
    const d = pts.map(([x, y], k) => `${k ? 'L' : 'M'}${(ox + (x - x0) * o).toFixed(1)},${(oy + (y - y0) * o).toFixed(1)}`).join('') + 'Z';
    return `<svg viewBox="0 0 ${W} ${H}" class="shz-sekil" aria-hidden="true">
      <defs><pattern id="shzKarik${i}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(28)">
        <rect width="7" height="7" fill="#c97b4a"/><rect width="3" height="7" fill="#b4673c"/></pattern></defs>
      <rect width="${W}" height="${H}" rx="12" fill="#8fd14f"/>
      <path d="${d}" fill="url(#shzKarik${i})" stroke="#fff6d8" stroke-width="2.5" stroke-linejoin="round"/>
      <g transform="translate(${W - 16},16)"><circle r="9" fill="rgba(255,255,255,.85)"/><path d="M0,-6 L3,3 L0,1 L-3,3Z" fill="#c8402e"/></g></svg>`;
  }
  const donum = (m2) => (m2 >= 1000 ? `${(m2 / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} dönüm` : `${sayi(m2)} m²`);

  async function adaylariGoster() {
    ic().innerHTML = `${noktalar(3)}
      <button type="button" class="shz-geri" data-shz="yer" aria-label="Geri">←</button>
      <h2>Arsanı seç</h2>
      <p class="shz-not"><b>${esc(secim.yerAd || secim.ilceAd)}</b> çevresindeki boş tarlalar aranıyor…</p>
      <div class="shz-adaylar"><div class="shz-yukleniyor"><i></i><i></i><i></i></div></div>`;
    const qs = new URLSearchParams({ ilce: secim.ilce });
    if (secim.yer) qs.set('yer', secim.yer);
    let r;
    try { r = await api(`/api/baslangic/adaylar?${qs}`); } catch (e) {
      if (!kap) return;
      ic().querySelector('.shz-adaylar').innerHTML = `<div class="shz-hata"><p>${esc(e.message)}</p><button type="button" class="shz-b" data-shz="yer">← Başka bir yer seç</button></div>`;
      return;
    }
    if (!kap) return;
    secim.adaylar = r.adaylar; secim.secilen = null;
    ic().innerHTML = `${noktalar(3)}
      <button type="button" class="shz-geri" data-shz="yer" aria-label="Geri">←</button>
      <h2>Arsanı seç</h2>
      <p class="shz-not"><b>${esc(r.yer)}</b> çevresinde ${r.adaylar.length} boş tarla buldum. Birini seç; <b>ilk arsan hediye</b>.</p>
      <div class="shz-adaylar">${r.adaylar.map((a, i) => `
        <button type="button" class="shz-aday" data-shz-aday="${esc(a.id)}">
          ${sekilSvg(a.geometri, i)}
          <div class="shz-aday-bilgi">
            <b class="shz-adano">Ada ${a.adaParsel?.ada ?? '–'} · Parsel ${a.adaParsel?.parsel ?? '–'}</b>
            <span>${esc(a.mahalle)}, ${esc(a.ilce)}</span>
            <small>🌾 Tarım arazisi · ${donum(a.alan)}</small>
            ${a.hediye ? `<em>🎁 Hediye · değeri ${akce(a.hediye)}</em>` : ''}
          </div><i class="shz-tik" aria-hidden="true">✓</i></button>`).join('')}</div>
      <div class="shz-alt"><button type="button" class="shz-b ana" data-shz="al" disabled>Bu arsa benim olsun</button></div>`;
  }

  async function arsayiAl() {
    const b = kap.querySelector('[data-shz="al"]');
    b.disabled = true; b.textContent = 'Tapun hazırlanıyor…';
    try {
      const r = await api('/api/baslangic/tarla', { parsel: secim.secilen });
      ses?.('seviye');
      const a = secim.adaylar.find((x) => x.id === r.parsel) || {};
      await benYenile({ sessiz: true });
      haritaYenile?.();
      api('/api/sihirbaz/odul', { adim: 'ARSA' }).catch(() => {});
      tapu(r.parsel, a);
    } catch (e) {
      tost(e.message, 'hata');
      b.disabled = false; b.textContent = 'Bu arsa benim olsun';
      if (e.kod === 'ADAY_DEGIL' || e.kod === 'TAHSISLI') adaylariGoster();
    }
  }

  // Oyun içi tapu belgesi (gerçek tapu değildir)
  function tapu(parsel, a) {
    const tarih = new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
    ic().innerHTML = `${noktalar(4)}
      <h2>Tebrikler, artık toprak sahibisin!</h2>
      <div class="shz-tapu">
        <div class="shz-tapu-baslik"><span>SANAL TÜRKİYE</span><b>Tapu Belgesi</b><small>oyun içi · gerçek tapu değildir</small></div>
        <dl>
          <dt>İl / İlçe</dt><dd>${esc(a.il || '')} / ${esc(a.ilce || '')}</dd>
          <dt>Mahalle / Köy</dt><dd>${esc(a.mahalle || '')}</dd>
          <dt>Ada / Parsel</dt><dd><b>${a.adaParsel?.ada ?? '–'} / ${a.adaParsel?.parsel ?? '–'}</b></dd>
          <dt>Yüzölçümü</dt><dd>${sayi(a.alan || 0)} m²</dd>
          <dt>Niteliği</dt><dd>Tarla</dd>
          <dt>Malik</dt><dd>${esc(durum.ben?.kullanici?.ad || '')}</dd>
          <dt>Tarih</dt><dd>${tarih}</dd>
        </dl>
        <div class="shz-muhur" aria-hidden="true">HEDİYE</div>
      </div>
      <p class="shz-not">Şimdi çiftliğine gidelim. Orada ilk tohumunu birlikte ekeceğiz.</p>
      <div class="shz-alt"><button type="button" class="shz-b ana" data-shz="ciftlik" data-parsel="${esc(parsel)}">Çiftliğime git 🏡</button></div>`;
  }

  function tikla(e) {
    if (!kap) return;
    const b = e.target.closest('[data-shz], [data-shz-yer], [data-shz-aday]');
    if (!b || b.disabled) return;
    if (b.dataset.shzYer) {
      secim.yer = b.dataset.shzYer; secim.yerAd = yerListesi.find((y) => y.yerId === secim.yer)?.ad || '';
      kap.querySelectorAll('.shz-yer').forEach((x) => x.classList.toggle('secili', x === b));
      kap.querySelector('[data-shz="adaylar"]').disabled = false;
      return;
    }
    if (b.dataset.shzAday) {
      secim.secilen = b.dataset.shzAday;
      kap.querySelectorAll('.shz-aday').forEach((x) => x.classList.toggle('secili', x === b));
      kap.querySelector('[data-shz="al"]').disabled = false;
      ses?.('tik');
      return;
    }
    const is = b.dataset.shz;
    if (is === 'karsilama') karsilama();
    else if (is === 'yer') yerSecimi();
    else if (is === 'adaylar') adaylariGoster();
    else if (is === 'farketmez') { secim.yer = null; secim.yerAd = ''; adaylariGoster(); }
    else if (is === 'al') arsayiAl();
    else if (is === 'ciftlik') { const p = b.dataset.parsel; ekranKapat(); ciftligeGir(p).then(() => turBaslat()); }
  }
  function degisti(e) {
    if (!kap) return;
    if (e.target.matches('[data-shz-il]')) { secim.plaka = e.target.value; secim.ilce = null; secim.yer = null; ilceleriYukle(); }
    else if (e.target.matches('[data-shz-ilce]')) { secim.ilce = Number(e.target.value); secim.ilceAd = e.target.selectedOptions[0]?.textContent || ''; secim.yer = null; yerleriYukle(); }
  }
  document.addEventListener('click', (e) => { if (kap?.contains(e.target)) tikla(e); });
  document.addEventListener('change', (e) => { if (kap?.contains(e.target)) degisti(e); });
  document.addEventListener('input', (e) => { if (kap?.contains(e.target) && e.target.matches('[data-shz-ara]')) yerleriCiz(e.target.value); });

  // ================= 2) Çiftlik turu (kilitli, adım adım) =================
  const kart = () => durum.kart || {};
  const sayfaBasligi = () => { const s = document.querySelector('.ci-sayfa:not([hidden])'); return s ? s.textContent : ''; };
  const ilk = (...seciciler) => { for (const s of seciciler) { const el = document.querySelector(s); if (el) return el; } return null; };
  // Ekilen ürünün adı (buğday dışında bir şey ekildiyse metin ona göre)
  const ekinAdi = () => { const e = kart().ekin; return e?.ad ? `${e.ikon || ''} ${esc(e.ad)}`.trim() : 'Ekinin'; };
  const TUR = [
    { kod: 'EKIM', ikon: '🌱', baslik: 'İlk tohumunu ek',
      metin: () => (sayfaBasligi().includes('Ne ekelim') ? '<b>Buğday</b> en ucuz tohumdur; ilk ekinin bir dakikada olgunlaşır. Ona dokun, çiftçin gidip eksin.' : 'Tarlan hazır! Önce bir şey ekelim. Aşağıdaki <b>Ek</b> düğmesine dokun.'),
      hedef: () => (sayfaBasligi().includes('Ne ekelim') ? ilk('.ci-tohum[data-urun="BUGDAY"]:not([disabled])', '.ci-tohum:not([disabled])') : ilk('.ci-alt [data-ci="ek"]')),
      bitti: () => !!kart().ekin },
    { kod: 'SULAMA', ikon: '💧', baslik: 'Toprağı sula', metin: () => 'Ekinler suyu sever. <b>Sula</b> düğmesine dokun; sulanan tarla daha bereketli olur.',
      hedef: () => ilk('.ci-alt [data-eylem="sula"]'),
      bitti: () => !kart().ekin || kart().ekin.otomatikSulama || (kart().ekin.sulama || 0) >= 1 },
    { kod: 'BEKLE', ikon: '⏳', baslik: 'Büyümesini bekle', serbest: true,
      metin: () => { const e = kart().ekin; const kalan = e ? Math.max(0, Math.ceil((e.hazir - sunucuSimdi()) / 1000)) : 0;
        const sandik = document.querySelector('.ci-alt [data-ci="sandik"].altin');
        return `${ekinAdi()} büyüyor… <b class="shz-sayac">${Math.floor(kalan / 60)}:${String(kalan % 60).padStart(2, '0')}</b><br>${sandik
          ? 'Beklerken <b>🎁 Sandık</b>\'ı aç: sana hoş geldin hediyesi birikti.' : 'Bu arada ekranı parmağınla çevirip çiftliğine bakabilirsin.'}`; },
      hedef: () => null,
      bitti: () => !kart().ekin || sunucuSimdi() >= kart().ekin.hazir },
    { kod: 'HASAT', ikon: '🧺', baslik: 'Hasat zamanı!', metin: () => `${ekinAdi()} olgunlaştı. <b>Hasat</b> düğmesine dokun, ürünler ambarına girsin.`,
      hedef: () => ilk('.ci-alt [data-eylem="hasat"]'), bitti: () => !kart().ekin },
    { kod: 'SATIS', ikon: '💰', baslik: 'Pazarda sat', ozel: 'satis',
      metin: () => { const u = satilacak(); return u ? `Ambarında <b>${sayi(u.miktar)} ${esc(u.ad)}</b> var. Bir kısmını pazardaki tüccara satalım, akçe kazan. (Sonra <b>Pazar</b> sekmesinden istediğin zaman satabilirsin.)` : 'Ürünlerin pazarda satılır. Aşağıdan sat.'; },
      hedef: () => document.querySelector('.shz-kilit [data-shz-tur="sat"]'), bitti: () => false },
    { kod: 'YAPI', ikon: '🔨', baslik: 'İlk yapını kur',
      metin: () => (sayfaBasligi().includes('İnşaat atölyesi') ? '<b>Sulama hattı</b> tarlanı kendiliğinden sular ve verimi %15 artırır. Fiyatına dokun, inşaat başlasın.' : 'Kazancınla çiftliğini geliştirelim. <b>İnşa et</b> düğmesine dokun.'),
      hedef: () => (sayfaBasligi().includes('İnşaat atölyesi') ? ilk('.ci-sayfa [data-eylem="insaat"][data-tip="SULAMA_HATTI"]:not([disabled])', '.ci-sayfa [data-eylem="insaat"][data-tip="TEL_CIT"]:not([disabled])', '.ci-sayfa [data-eylem="insaat"]:not([disabled])') : ilk('.ci-alt [data-ci="insaat"]')),
      bitti: () => (kart().yapilar || []).length > (tur?.yapiBas ?? 0) },
    { kod: 'GUNLUK', ikon: '🎯', baslik: 'Günlük görevler', metin: () => 'Her gün yeni görevler ve ödüller var. <b>Günlük</b> düğmesine dokun, bugünkü görevlerine bak.',
      hedef: () => ilk('.ci-alt [data-ci="gunluk"]'), bitti: () => sayfaBasligi().includes('Günlük görevler') && !sayfaBasligi().includes('yükleniyor') },
  ];
  // Satılacak ürün: son hasat edilen (yoksa ambardaki en çok olan) tarla ürünü
  function satilacak() {
    const env = (durum.ben?.envanter || []).filter((i) => i.miktar > 0 && durum.kurallar?.urunler?.[i.item_id]?.tohum);
    return env.find((i) => i.item_id === tur?.ekinTip) || env.sort((a, b) => b.miktar - a.miktar)[0] || null;
  }

  async function turBaslat() {
    if (tur) return;
    let d;
    try { d = await api('/api/sihirbaz'); } catch { return; }
    if (!d.aktif) return;
    // Yapılmış ama ödülü alınmamış adımların ödülü (sayfa yenilendiyse)
    for (const a of d.adimlar) if (a.tamam && !a.alindi && a.kod !== 'GUNLUK') await odul(a.kod, { sessiz: true });
    const yapilan = new Set(d.adimlar.filter((a) => a.tamam).map((a) => a.kod));
    if (!yapilan.has('ARSA')) return;
    tur = { adim: 0, ekinTip: kart().ekin?.tip || 'BUGDAY', yapiBas: (kart().yapilar || []).length, odullenen: new Set(), kilit: null, zaman: 0 };
    // Kalınan yer: ilk yapılmamış adım (bekleme adımı ekim/hasat arasındadır)
    const sira = TUR.findIndex((a) => (a.kod === 'BEKLE' ? yapilan.has('EKIM') && !yapilan.has('HASAT') && kart().ekin && sunucuSimdi() < kart().ekin.hazir : !yapilan.has(a.kod)));
    tur.adim = sira < 0 ? TUR.length - 1 : sira;
    if (TUR[tur.adim].kod === 'SULAMA' && !kart().ekin) tur.adim = TUR.findIndex((a) => a.kod === 'SATIS');
    document.body.classList.add('sihirbazda');
    kilitKur();
    tur.zaman = setInterval(turKare, 300);
    turKare();
  }

  function kilitKur() {
    const k = document.createElement('div');
    k.className = 'shz-kilit';
    k.innerHTML = `<div class="shz-perde" data-p="ust"></div><div class="shz-perde" data-p="alt"></div><div class="shz-perde" data-p="sol"></div><div class="shz-perde" data-p="sag"></div>
      <div class="shz-halka" hidden></div><div class="shz-el" hidden aria-hidden="true">👆</div>
      <div class="shz-turkart" role="status" aria-live="polite"></div>`;
    k.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-shz-tur]');
      if (!b) return;
      if (b.dataset.shzTur === 'atla') {
        if (!confirm('Tanıtımı atlamak istiyor musun? Üstteki görev şeridi ipuçlarıyla yine yol gösterecek.')) return;
        await api('/api/sihirbaz/bitir', {}).catch(() => {});
        turBitir(false);
      } else if (b.dataset.shzTur === 'sat') satisYap(b);
    });
    document.body.appendChild(k);
    tur.kilit = k;
  }

  async function odul(kod, { sessiz = false } = {}) {
    if (tur?.odullenen.has(kod)) return;
    tur?.odullenen.add(kod);
    try {
      const r = await api('/api/sihirbaz/odul', { adim: kod });
      // Tur ödülü ayrı bildirim yerine tur kartında rozet olarak görünür (görev bildirimiyle üst üste binmesin)
      if (r.odul > 0 && !sessiz) { if (tur) tur.odulRozet = { tutar: r.odul, bitis: Date.now() + 3500 }; else tost(`🎉 Aferin! +${akce(r.odul)} ödül`); ses?.('para'); }
      if (r.odul > 0) benYenile({ sessiz: true });
      return r;
    } catch { tur?.odullenen.delete(kod); return null; }
  }

  async function satisYap(b) {
    const u = satilacak();
    if (!u) { ileri(); return; }
    b.disabled = true; b.textContent = 'Satılıyor…';
    tur.satiliyor = true;
    try {
      const r = await api('/api/pazar/sat', { urun: u.item_id, miktar: Math.max(1, Math.ceil(u.miktar / 2)) });
      tost(`💰 ${sayi(r.adet)} ${u.ad} sattın: +${akce(r.tutar)}`);
      ses?.('para');
      await benYenile({ sessiz: true });
      await odul('SATIS');
      ileri();
    } catch (e) { tost(e.message, 'hata'); ileri(); }   // tüccar bugün alamıyorsa sonraki adıma geç
    finally { if (tur) tur.satiliyor = false; }
  }

  function ileri() {
    if (!tur) return;
    tur.adim += 1;
    if (tur.adim >= TUR.length) { turBitir(true); return; }
    if (TUR[tur.adim].kod === 'YAPI') tur.yapiBas = (kart().yapilar || []).length;
    turKare();
  }

  function turKare() {
    if (!tur) return;
    if (!durum.ciftlikIci?.acik()) {
      // Çiftlik açılamıyorsa (ör. cihazda WebGL yok) sonsuza dek denenmez: 3 sn'de bir, en çok 5 kez; sonra tur kapanır
      kilitCiz(null, TUR[tur.adim], 'Çiftliğine dönüyoruz…');
      const t = Date.now();
      if (t - (tur.sonDonus || 0) > 3000) {
        tur.sonDonus = t; tur.donus = (tur.donus || 0) + 1;
        if (tur.donus > 5) { turBitir(false); tost('Çiftlik bu cihazda açılamadı; tanıtım kapatıldı. Görev şeridi yol göstermeye devam edecek.', 'hata'); return; }
        ciftligeGir();
      }
      return;
    }
    tur.donus = 0;
    const a = TUR[tur.adim];
    if (a.kod === 'EKIM' && kart().ekin) tur.ekinTip = kart().ekin.tip;
    if (a.bitti()) {
      if (a.kod === 'BEKLE') benYenile({ sessiz: true }).then(() => durum.ciftlikIci?.yenile());   // hasat düğmesi görünsün
      if (a.kod === 'GUNLUK') { odul('GUNLUK', { sessiz: true }).then(() => turBitir(true)); clearInterval(tur.zaman); return; }
      if (a.kod !== 'BEKLE') odul(a.kod);
      ses?.('tik');
      ileri();
      return;
    }
    const hedef = a.serbest ? null : a.hedef();
    // Hedef alt eylem çubuğundaysa açık kalan sayfa (ör. hasat sonucu) onu örtmesin: sayfayı kapat
    if (hedef?.closest('.ci-alt') && document.querySelector('.ci-sayfa:not([hidden])')) durum.ciftlikIci.sayfaKapat?.();
    kilitCiz(hedef, a);
  }

  // Kilit: hedefin çevresi dört perdeyle kapanır (yalnızca hedef dokunulabilir), halka ve parmak hedefi gösterir
  function kilitCiz(hedef, a, ozelMetin) {
    const k = tur.kilit, perdeler = k.querySelectorAll('.shz-perde'), halka = k.querySelector('.shz-halka'), el = k.querySelector('.shz-el');
    const W = innerWidth, H = innerHeight;
    let r = hedef?.getBoundingClientRect();
    // Hedef kaydırılabilir bir listede ekran dışında ya da alt kenara çok yakınsa ortaya kaydır (perde kaydırmayı engeller)
    if (r && r.width > 0 && !hedef.closest('.ci-alt, .shz-kilit') && (r.top < 60 || r.bottom > H - 150)) { hedef.scrollIntoView({ block: 'center' }); r = hedef.getBoundingClientRect(); }
    if (r && (r.width === 0 || r.bottom < 0 || r.top > H)) r = null;
    k.classList.toggle('serbest', !!a.serbest);
    if (r) {
      const p = 6, x0 = Math.max(0, r.left - p), y0 = Math.max(0, r.top - p), x1 = Math.min(W, r.right + p), y1 = Math.min(H, r.bottom + p);
      const kutular = { ust: [0, 0, W, y0], alt: [0, y1, W, H - y1], sol: [0, y0, x0, y1 - y0], sag: [x1, y0, W - x1, y1 - y0] };
      perdeler.forEach((d) => { const [x, y, w, h] = kutular[d.dataset.p]; Object.assign(d.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`, display: '' }); });
      Object.assign(halka.style, { left: `${x0}px`, top: `${y0}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` });
      Object.assign(el.style, { left: `${(x0 + x1) / 2 - 18}px`, top: `${y0 > H * 0.5 ? y0 - 54 : y1 + 6}px` });
      el.classList.toggle('asagi', y0 > H * 0.5);
      halka.hidden = el.hidden = false;
    } else {
      // Hedef yokken (bekleme, satış kartı) arkası tamamen kapalı; serbest adımda hiç perde yok
      perdeler.forEach((d, i) => Object.assign(d.style, i === 0 && !a.serbest ? { left: '0', top: '0', width: `${W}px`, height: `${H}px`, display: '' } : { display: 'none' }));
      halka.hidden = el.hidden = true;
    }
    const kartEl = k.querySelector('.shz-turkart');
    const sira = TUR.filter((x) => x.kod !== 'BEKLE').findIndex((x) => x.kod === a.kod);
    const toplam = TUR.filter((x) => x.kod !== 'BEKLE').length;
    const html = `<div class="shz-turust"><span class="shz-turikon">${a.ikon}</span><div><small>${sira >= 0 ? `Adım ${sira + 1} / ${toplam}` : 'Az kaldı'}</small><b>${esc(a.baslik)}</b></div>
        ${tur.odulRozet && Date.now() < tur.odulRozet.bitis ? `<span class="shz-odul">🎉 +${akce(tur.odulRozet.tutar)}</span>` : ''}
        <button type="button" class="shz-atla" data-shz-tur="atla">Atla</button></div>
      <p>${ozelMetin || a.metin()}</p>
      ${a.ozel === 'satis' ? `<button type="button" class="shz-b ana genis" data-shz-tur="sat">${satilacak() ? `Yarısını sat 💰` : 'Devam'}</button>` : ''}`;
    // Satış sürerken (düğme "Satılıyor…") aynı adımın kartı yeniden çizilmez
    if (kartEl.dataset.html !== html && !(tur.satiliyor && a.kod === 'SATIS')) { kartEl.innerHTML = html; kartEl.dataset.html = html; }
    // Kart, hedefin karşı tarafında dursun; hedefsiz adımda çiftlik sayfası açıksa (ör. beklerken sandık) üste çıkar, sayfayı örtmesin
    kartEl.classList.toggle('ustte', r ? r.top > H * 0.45 : !!document.querySelector('.ci-sayfa:not([hidden])'));
  }

  function turBitir(tamamlandi) {
    if (!tur) return;
    clearInterval(tur.zaman);
    tur.kilit?.remove();
    tur = null;
    document.body.classList.remove('sihirbazda');
    durum.rehber?.guncelle?.();
    if (!tamamlandi) return;
    ses?.('seviye');
    const m = document.createElement('div');
    m.className = 'shz shz-bitis';
    m.innerHTML = `<div class="shz-ic"><div class="shz-konfeti" aria-hidden="true">🎉</div>
      <h1>Artık gerçek bir çiftçisin!</h1>
      <p class="shz-giris">Tarlanı ektin, suladın, hasat ettin, ürününü sattın ve ilk yapını kurdun. Bundan sonrası senin elinde.</p>
      <ul class="shz-ipuclari">
        <li><span>🏘️</span><div><b>Köy</b> düğmesiyle haritaya çık; komşularını ve yeni arsaları gör.</div></li>
        <li><span>📋</span><div><b>Sipariş</b> panosundaki köylülere ürün teslim et: tüccardan çok daha iyi öder.</div></li>
        <li><span>🎁</span><div><b>Sandık</b> her 8 saatte bir dolar; sık uğra.</div></li>
        <li><span>🎯</span><div><b>Günlük</b> görevleri bitir, her gün ödül kazan.</div></li>
        <li><span>📜</span><div>Takıldığında üstteki görev şeridi sıradaki adımı gösterir.</div></li>
      </ul>
      <div class="shz-alt"><button type="button" class="shz-b ana" data-shz-son>Oyuna devam 🚜</button></div></div>`;
    document.body.appendChild(m);
    m.querySelector('[data-shz-son]').addEventListener('click', () => m.remove());
  }

  return {
    // Oturum başında: sihirbaz sürüyorsa arsa sihirbazı (arsası yoksa) ya da çiftlik turu
    async baslat() {
      if (!durum.ben?.sihirbaz) return false;
      if (!(durum.ben.portfoy || []).length) { ekranAc(); karsilama(); return true; }
      await ciftligeGir();
      turBaslat();
      return true;
    },
    aktif: () => !!kap || !!tur,
  };
}
