// Açılış ekranı ve hesap akışları (tam sayfa): karşılama → Google / Apple / passkey / e-posta ile devam;
// kayıt 4 adım: (1) hesap (e-posta + parola ya da şifresiz passkey), (2) profil (oyuncu adı, avatar, doğum yılı, onaylar),
// (3) telefon doğrulama (isteğe bağlı), (4) memleket. Giriş: passkey, Google/Apple, e-posta + parola, iki adımlı kod,
// parola sıfırlama. Kurallar sunucuda; burası yalnızca akışı ve görünümü yönetir.
import { esc } from './yardimci.js';
import { avatarSVG, avatarCoz, avatarKod, TENLER, SACLAR, BASLIKLAR, GIYSILER } from './avatar.js';
import { passkeyDestekli, passkeyOlustur, passkeyImzala, iptalMi } from './webauthn.js';

const HATALAR = {
  iptal: 'Giriş iptal edildi.', oturum: 'Giriş oturumunun süresi doldu; yeniden dene.', dogrulama: 'Hesap sağlayıcısından gelen kimlik doğrulanamadı; yeniden dene.',
  eposta: 'Hesabının e-posta adresi paylaşılmadı; e-postayla kayıt olabilirsin.', baska_hesap: 'Bu hesap başka bir oyuncuya bağlı.',
  askida: 'Hesap askıya alınmış.', kapali: 'Bu giriş yolu şu an kapalı.',
};
// Kayıt: hesap → profil → ilk giriş sihirbazı (arsa seçimi). Telefon ve memleket isteğe bağlı, adım çubuğunda yok.
const ADIMLAR = ['Hesap', 'Profil', 'Çiftlik'];
const GOOGLE_G = '<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z"/><path fill="#FBBC05" d="M10.6 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.1 1.4-4.9 2.3-8.2 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>';
const APPLE = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor"><path d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9s-2.1-.9-3.4-.9c-1.7 0-3.4 1-4.3 2.6-1.8 3.2-.5 7.9 1.3 10.5.9 1.3 1.9 2.7 3.2 2.6 1.3 0 1.8-.8 3.3-.8s2 .8 3.4.8c1.4 0 2.3-1.3 3.1-2.6 1-1.5 1.4-2.9 1.4-3-.1 0-2.6-1-2.6-4.2zM13.9 4.9c.7-.9 1.2-2 1-3.2-1 .1-2.2.7-3 1.6-.6.7-1.2 1.9-1 3.1 1.1.1 2.3-.6 3-1.5z"/></svg>';

export function girisKur({ api, tost, girisSonrasi, iller, rehberBaslat, sihirbazda }) {
  const kok = document.getElementById('acilis');
  const kart = document.getElementById('acilisKart');
  let ekran = 'karsilama', yollar = { google: false, apple: false, passkey: true, telefon: false }, hata = '', bilgi = '';
  let taslak = null, kayitBilgi = null, avatar = { t: 1, s: 0, p: 1, g: 0 }, adDurum = null, adZaman = 0, sifirlamaTokeni = null, telefonKodu = null, onerilenIl = null, oyundan = false;
  const passkeyVar = passkeyDestekli();
  api('/api/giris/yollar').then((y) => { yollar = y; if (!kok.hidden) ciz(); }).catch(() => {});

  // ---------- Görünüm parçaları
  const sosyal = () => `${yollar.google ? `<a class="dugme sosyal google" href="/api/oauth/google/basla">${GOOGLE_G}<span>Google ile devam et</span></a>` : ''}
    ${yollar.apple ? `<a class="dugme sosyal apple" href="/api/oauth/apple/basla">${APPLE}<span>Apple ile devam et</span></a>` : ''}
    ${passkeyVar ? '<button type="button" class="dugme sosyal passkey" data-a="passkey-giris"><span class="ikon">🔑</span><span>Passkey ile giriş yap</span></button>' : ''}`;
  const uyari = () => `${hata ? `<p class="acilis-hata" role="alert">${esc(hata)}</p>` : ''}${bilgi ? `<p class="acilis-bilgi">${esc(bilgi)}</p>` : ''}`;
  const adimCubugu = (i) => (i < 0 ? '' : `<ol class="kayit-adimlar" aria-label="Kayıt adımları">${ADIMLAR
    .map((a, k) => `<li class="${k < i ? 'bitti' : k === i ? 'simdi' : ''}" aria-current="${k === i ? 'step' : 'false'}"><span>${k < i ? '✓' : k + 1}</span>${a}</li>`).join('')}</ol>`);

  const EKRANLAR = {
    karsilama: () => `
      <h2 id="acilisBaslik">Hoş geldin, çiftçi!</h2>
      <p class="alt">Gerçek Türkiye haritasında tarlanı seç, ek, hasat et, komşularınla ticaret yap.</p>
      ${uyari()}
      <div class="sosyal-liste">${sosyal()}</div>
      <div class="ayirici"><span>ya da</span></div>
      <button type="button" class="dugme birincil genis" data-a="ekran" data-e="hesap">✉️ E-postayla kayıt ol</button>
      <p class="acilis-alt">Hesabın var mı? <button type="button" class="bag" data-a="ekran" data-e="giris">Giriş yap</button></p>
      <button type="button" class="bag acilis-misafir" data-a="kapat">Önce haritayı gez →</button>`,
    giris: () => `
      <h2 id="acilisBaslik">Tekrar hoş geldin</h2>
      ${uyari()}
      <div class="sosyal-liste">${sosyal()}</div>
      <div class="ayirici"><span>ya da e-postayla</span></div>
      <form class="form" data-f="giris">
        <label>E-posta<input name="email" type="email" aria-label="E-posta" autocomplete="username webauthn" required></label>
        <label>Parola<span class="sifre-alan"><input name="sifre" type="password" aria-label="Parola" autocomplete="current-password" required><button type="button" class="goster" data-a="goster" aria-label="Parolayı göster">👁</button></span></label>
        <button class="dugme birincil genis">Giriş yap</button>
      </form>
      <p class="acilis-alt"><button type="button" class="bag" data-a="ekran" data-e="unuttum">Parolamı unuttum</button> · Hesabın yok mu? <button type="button" class="bag" data-a="ekran" data-e="karsilama">Kayıt ol</button></p>`,
    ikiAdim: () => `
      <h2 id="acilisBaslik">İki adımlı doğrulama</h2>
      <p class="alt">Kimlik doğrulayıcı uygulamandaki 6 haneli kodu ya da bir kurtarma kodunu gir.</p>${uyari()}
      <form class="form" data-f="ikiAdim"><label>Doğrulama kodu<input name="kod" inputmode="numeric" autocomplete="one-time-code" maxlength="9" required autofocus></label>
        <button class="dugme birincil genis">Doğrula</button></form>
      <p class="acilis-alt"><button type="button" class="bag" data-a="ekran" data-e="giris">← Girişe dön</button></p>`,
    unuttum: () => `
      <h2 id="acilisBaslik">Parolanı mı unuttun?</h2>
      <p class="alt">Hesabının e-posta adresini yaz; sıfırlama bağlantısı gönderelim.</p>${uyari()}
      <form class="form" data-f="unuttum"><label>E-posta<input name="email" type="email" aria-label="E-posta" autocomplete="email" required></label>
        <button class="dugme birincil genis">Bağlantı gönder</button></form>
      <p class="acilis-alt"><button type="button" class="bag" data-a="ekran" data-e="giris">← Girişe dön</button></p>`,
    sifirla: () => `
      <h2 id="acilisBaslik">Yeni parola</h2>
      <p class="alt">Kaydedince tüm cihazlardaki oturumların kapatılır.</p>${uyari()}
      <form class="form" data-f="sifirla"><label>Yeni parola<input name="sifre" type="password" aria-label="Parola" autocomplete="new-password" minlength="8" required></label>
        ${sifreGucu('')}<button class="dugme birincil genis">Kaydet</button></form>`,
    hesap: () => `
      ${adimCubugu(0)}
      <h2 id="acilisBaslik">Hesabını oluştur</h2>${uyari()}
      ${yollar.google || yollar.apple ? `<div class="sosyal-liste yatay">${yollar.google ? `<a class="dugme sosyal google" href="/api/oauth/google/basla">${GOOGLE_G}<span>Google</span></a>` : ''}${yollar.apple ? `<a class="dugme sosyal apple" href="/api/oauth/apple/basla">${APPLE}<span>Apple</span></a>` : ''}</div><div class="ayirici"><span>ya da</span></div>` : ''}
      <form class="form" data-f="hesap">
        <label>E-posta<input name="email" type="email" aria-label="E-posta" autocomplete="email" required value="${esc(kayitBilgi?.email || '')}"></label>
        <label>Parola<span class="sifre-alan"><input name="sifre" type="password" aria-label="Parola" autocomplete="new-password" minlength="8" required><button type="button" class="goster" data-a="goster" aria-label="Parolayı göster">👁</button></span></label>
        ${sifreGucu('')}
        <button class="dugme birincil genis">Devam →</button>
      </form>
      ${passkeyVar ? `<div class="ayirici"><span>ya da şifresiz</span></div>
        <button type="button" class="dugme genis passkey-yeni" data-a="passkey-yeni">🔑 Passkey ile şifresiz devam et</button>
        <p class="kucuk">Parmak izi, yüz tanıma ya da cihaz kilidinle girersin; parola yok, çalınacak bir şey de yok. Önce yukarıya e-postanı yaz.</p>` : ''}
      <p class="acilis-alt"><button type="button" class="bag" data-a="ekran" data-e="karsilama">← Geri</button></p>`,
    profil: () => {
      const a = avatarKod(avatar);
      return `${adimCubugu(1)}
      <h2 id="acilisBaslik">Seni tanıyalım</h2>
      ${taslak ? `<p class="alt">${esc(taslak.email)} ile ${taslak.saglayici === 'passkey' ? 'passkey' : taslak.saglayici === 'google' ? 'Google' : 'Apple'} hesabın bağlanacak.</p>` : ''}${uyari()}
      <div class="avatar-yapici">
        <div class="avatar-onizleme">${avatarSVG(a, 112, { baslik: 'Avatarın' })}<button type="button" class="bag" data-a="avatar-rastgele">🎲 Rastgele</button></div>
        <div class="avatar-secenekler">
          ${secenekSatiri('Ten', 't', TENLER.map((r, i) => [i, `<span class="renk" style="background:${r}"></span>`]))}
          ${secenekSatiri('Saç', 's', SACLAR.map((x, i) => [i, `<span class="renk" style="background:${x.renk || 'transparent'}" title="${x.ad}">${x.renk ? '' : '∅'}</span>`]))}
          ${secenekSatiri('Başlık', 'p', BASLIKLAR.map((x, i) => [i, `<span class="yazi">${x}</span>`]))}
          ${secenekSatiri('Giysi', 'g', GIYSILER.map((r, i) => [i, `<span class="renk" style="background:${r}"></span>`]))}
        </div>
      </div>
      <form class="form" data-f="profil">
        <label>Oyuncu adı<input name="ad" autocomplete="nickname" maxlength="32" required value="${esc(kayitBilgi?.ad || taslak?.adOneri || '')}" placeholder="ör. Meramlı Çiftçi" aria-describedby="adDurum">
          <span class="ad-durum ${adDurum?.uygun ? 'iyi' : adDurum ? 'kotu' : ''}" id="adDurum" aria-live="polite">${adDurum ? (adDurum.uygun ? '✓ Bu ad senin olabilir' : esc(adDurum.sebep)) : 'Haritada ve sohbette bu adla görüneceksin.'}</span></label>
        <label>Doğum yılı<input name="dogumYili" type="number" inputmode="numeric" min="1900" max="2100" required placeholder="ör. 1994" value="${esc(kayitBilgi?.dogumYili || '')}">
          <span class="kucuk">13 yaşından itibaren katılabilirsin. 18 yaş altında sohbet kapalı başlar.</span></label>
        <div class="onaylar">
          <label class="onay"><input type="checkbox" name="kosullarOnay" required> <span><a href="/yasal/kullanim-kosullari.html" target="_blank" rel="noopener">Kullanım Koşulları</a>'nı kabul ediyorum ve <a href="/yasal/kvkk.html" target="_blank" rel="noopener">KVKK Aydınlatma Metni</a>'ni okudum.</span></label>
          <label class="onay"><input type="checkbox" name="pazarlamaOnay"> <span>Etkinlik ve yenilik e-postaları istiyorum (isteğe bağlı).</span></label>
        </div>
        <button class="dugme birincil genis">Hesabımı oluştur 🎉</button>
      </form>
      ${taslak ? '' : '<p class="acilis-alt"><button type="button" class="bag" data-a="ekran" data-e="hesap">← Geri</button></p>'}`;
    },
    telefon: () => `${adimCubugu(-1)}
      <h2 id="acilisBaslik">Telefonunu doğrula</h2>
      <p class="alt">Hesabını korur, sahte hesapları engeller. Numaran şifreli saklanır, kimseyle paylaşılmaz ve reklam için kullanılmaz.</p>${uyari()}
      ${telefonKodu ? `<form class="form" data-f="telefon-dogrula"><label>${esc(telefonKodu.telefon)} numarasına gelen 6 haneli kod
          <input name="kod" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="\\d{6}" required autofocus class="kod-kutusu"></label>
          ${telefonKodu.gelistirmeKodu ? `<p class="kucuk gelistirme">Geliştirme ortamı: SMS gönderilmedi, kod <b>${esc(telefonKodu.gelistirmeKodu)}</b></p>` : ''}
          <button class="dugme birincil genis">Doğrula</button></form>
          <p class="acilis-alt"><button type="button" class="bag" data-a="telefon-yeniden">Numarayı değiştir / yeniden gönder</button></p>`
      : `<form class="form" data-f="telefon-kod"><label>Cep telefonu<span class="tel-alan"><span class="on-ek">🇹🇷 +90</span><input name="telefon" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="5xx xxx xx xx" required></span></label>
          <button class="dugme birincil genis">Kod gönder</button></form>`}
      <p class="acilis-alt"><button type="button" class="bag" data-a="ekran" data-e="memleket">Şimdilik geç →</button></p>`,
    memleket: () => `${adimCubugu(-1)}
      <h2 id="acilisBaslik">Memleketin neresi?</h2>
      <p class="alt">Hasat yarışında puanın memleketine yazılır; hemşehrilerini görürsün. Tarlanı Türkiye'nin her yerinde açabilirsin.</p>${uyari()}
      <form class="form" data-f="memleket">
        <label>İl<select name="plaka" required><option value="">İl seç…</option>${iller().slice().sort((x, y) => x.name.localeCompare(y.name, 'tr')).map((il) => `<option value="${esc(il.plaka)}"${il.plaka === onerilenIl ? ' selected' : ''}>${esc(il.name)}</option>`).join('')}</select></label>
        <button type="button" class="dugme genis" data-a="konum">📍 Konumumu kullan</button>
        <button class="dugme birincil genis">Kaydet ve oyuna başla</button>
      </form>
      <p class="acilis-alt"><button type="button" class="bag" data-a="bitir">Sonra seçerim →</button></p>`,
  };
  function secenekSatiri(ad, alan, ogeler) {
    return `<div class="avatar-satir"><span>${ad}</span><div role="radiogroup" aria-label="${ad}">${ogeler.map(([i, ic]) =>
      `<button type="button" role="radio" aria-checked="${avatar[alan] === i}" aria-label="${ad} ${i + 1}" data-a="avatar" data-alan="${alan}" data-i="${i}">${ic}</button>`).join('')}</div></div>`;
  }
  function sifreGucu(s) {
    const p = (s.length >= 8) + (s.length >= 12) + /[A-ZÇĞİÖŞÜ]/.test(s) + /\d/.test(s) + /[^\p{L}\d]/u.test(s);
    const d = !s ? 0 : Math.min(4, Math.max(1, p - (s.length < 8 ? 2 : 0)));
    return `<div class="sifre-gucu g${d}" aria-live="polite"><span></span><small>${['Parola en az 8 karakter', 'Zayıf', 'Orta', 'İyi', 'Güçlü'][d]}</small></div>`;
  }

  function ciz() {
    kart.innerHTML = EKRANLAR[ekran]();
    kart.dataset.ekran = ekran;
    kart.querySelector('input:not([type=checkbox])[autofocus], input:not([type=checkbox])')?.focus({ preventScroll: true });
  }
  function git(e, { koru = false } = {}) { ekran = e; if (!koru) { hata = ''; bilgi = ''; } ciz(); }
  function ac(e = 'karsilama', ek = {}) {
    hata = ek.hata || ''; bilgi = ek.bilgi || '';
    if (ek.token) sifirlamaTokeni = ek.token;
    kok.hidden = false; document.body.classList.add('acilis-acik');
    // Kart açılış ekranının üstünde pencere olarak açılır; ilk ziyarette yalnızca açılış ekranı görünür
    kok.classList.toggle('kart-acik', !ek.kartGizli);
    oyundan = !!ek.oyundan;
    ekran = e; ciz();
  }
  function kapat() { kok.hidden = true; kok.classList.remove('kart-acik'); document.body.classList.remove('acilis-acik'); }
  // Pencereyi kapat: oyunun içinden açıldıysa oyuna döner, yoksa açılış ekranında kalır
  function kartKapat() { if (oyundan) kapat(); else kok.classList.remove('kart-acik'); }
  const yuklen = (d, f) => async (...a) => { if (d) d.disabled = true; try { return await f(...a); } catch (e) { hata = e.message; bilgi = ''; ciz(); return null; } finally { if (d && d.isConnected) d.disabled = false; } };

  // ---------- Akışlar
  async function kayitBitti() {
    await girisSonrasi(null);
    // Yeni oyuncuyu ilk giriş sihirbazı karşılar (arsa seçimi + çiftlik turu): kayıt penceresi ve açılış kapanır;
    // telefon ve memleket isteğe bağlıdır, sonra Ben → Hesabım'dan eklenir (yoksa pencere turun altında kalıyordu)
    if (sihirbazda?.()) { kapat(); return; }
    git(yollar.telefon ? 'telefon' : 'memleket');
  }
  async function passkeyGiris(d) {
    try {
      const s = await api('/api/passkey/giris/secenekler', {});
      const yanit = await passkeyImzala(s.secenekler);
      await api('/api/passkey/giris/dogrula', { sorguId: s.sorguId, yanit });
      kapat(); await girisSonrasi('🔑 Passkey ile giriş yapıldı. Tekrar hoş geldin!');
    } catch (e) { if (!iptalMi(e)) { hata = e.message; ciz(); } } finally { if (d?.isConnected) d.disabled = false; }
  }
  async function passkeyYeni(d) {
    const email = kart.querySelector('[name=email]')?.value.trim();
    if (!email) { hata = 'Önce e-posta adresini yaz.'; ciz(); return; }
    try {
      const s = await api('/api/passkey/yeni/secenekler', { email });
      const yanit = await passkeyOlustur(s.secenekler);
      await api('/api/passkey/yeni/dogrula', { sorguId: s.sorguId, yanit });
      taslak = await api('/api/kayit/taslak');
      git('profil');
    } catch (e) { if (!iptalMi(e)) { hata = e.message; ciz(); } } finally { if (d?.isConnected) d.disabled = false; }
  }
  // Oyuncu adının anlık denetimi (yazmayı bırakınca)
  function adDenetle(ad) {
    clearTimeout(adZaman);
    adZaman = setTimeout(async () => {
      if (ad.trim().length < 2) { adDurum = null; } else { try { adDurum = await api(`/api/oyuncu-adi/uygun?ad=${encodeURIComponent(ad.trim())}`); } catch { adDurum = null; } }
      const el = kart.querySelector('#adDurum');
      if (el) { el.className = `ad-durum ${adDurum?.uygun ? 'iyi' : adDurum ? 'kotu' : ''}`; el.textContent = adDurum ? (adDurum.uygun ? '✓ Bu ad senin olabilir' : adDurum.sebep) : 'Haritada ve sohbette bu adla görüneceksin.'; }
    }, 400);
  }

  kart.addEventListener('input', (e) => {
    if (e.target.name === 'ad' && ekran === 'profil') { kayitBilgi = { ...kayitBilgi, ad: e.target.value }; adDenetle(e.target.value); }
    if (e.target.name === 'dogumYili') kayitBilgi = { ...kayitBilgi, dogumYili: e.target.value };
    if (e.target.name === 'sifre' && (ekran === 'hesap' || ekran === 'sifirla')) kart.querySelector('.sifre-gucu').outerHTML = sifreGucu(e.target.value);
  });
  kart.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    if (a === 'ekran') return git(b.dataset.e);
    if (a === 'kapat') return kapat();
    if (a === 'goster') { const i = b.previousElementSibling; i.type = i.type === 'password' ? 'text' : 'password'; return; }
    if (a === 'passkey-giris') { b.disabled = true; return passkeyGiris(b); }
    if (a === 'passkey-yeni') { b.disabled = true; return passkeyYeni(b); }
    if (a === 'avatar') { avatar[b.dataset.alan] = Number(b.dataset.i); return yenileAvatar(); }
    if (a === 'avatar-rastgele') { avatar = { t: rnd(5), s: rnd(6), p: rnd(6), g: rnd(8) }; return yenileAvatar(); }
    if (a === 'telefon-yeniden') { telefonKodu = null; return git('telefon'); }
    if (a === 'bitir') return bitir();
    if (a === 'konum') {
      if (!navigator.geolocation) { hata = 'Tarayıcın konumu desteklemiyor'; return ciz(); }
      b.disabled = true;
      navigator.geolocation.getCurrentPosition(async (p) => {
        try {
          const k = await api(`/api/konum?lon=${p.coords.longitude}&lat=${p.coords.latitude}`);
          if (!k?.plaka) throw new Error('Konumun Türkiye dışında görünüyor; listeden seç');
          kart.querySelector('[name=plaka]').value = k.plaka; bilgi = `📍 ${k.ilce}, ${k.il}`; hata = '';
          const p2 = kart.querySelector('.acilis-bilgi'); if (p2) p2.textContent = bilgi; else kart.querySelector('form').insertAdjacentHTML('beforebegin', `<p class="acilis-bilgi">${esc(bilgi)}</p>`);
        } catch (err) { hata = err.message; ciz(); } finally { if (b.isConnected) b.disabled = false; }
      }, () => { b.disabled = false; hata = 'Konum izni verilmedi; listeden seçebilirsin.'; ciz(); }, { timeout: 10_000 });
    }
  });
  const rnd = (n) => Math.floor(Math.random() * n);
  function yenileAvatar() {
    const ad = kart.querySelector('[name=ad]')?.value, dy = kart.querySelector('[name=dogumYili]')?.value;
    const onay = [...kart.querySelectorAll('[type=checkbox]')].map((x) => x.checked);
    kayitBilgi = { ...kayitBilgi, ad, dogumYili: dy };
    ciz();
    [...kart.querySelectorAll('[type=checkbox]')].forEach((x, i) => { x.checked = onay[i]; });
  }
  async function bitir() {
    kapat();
    tost('🌾 Hazırsın! Üstteki görev şeridi ilk adımlarını gösterecek.');
    rehberBaslat?.();
  }

  kart.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, v = Object.fromEntries(new FormData(f)), d = f.querySelector('button:not([type=button])');
    const calis = yuklen(d, async () => {
      hata = '';
      switch (f.dataset.f) {
        case 'giris': {
          const r = await api('/api/giris', { email: v.email, sifre: v.sifre });
          if (r.ikinciAdim) return git('ikiAdim');
          kapat(); return girisSonrasi('Tekrar hoş geldin!');
        }
        case 'ikiAdim': await api('/api/giris/2fa', { kod: v.kod }); kapat(); return girisSonrasi('Tekrar hoş geldin!');
        case 'unuttum': { const r = await api('/api/sifre/unuttum', { email: v.email }); bilgi = r.mesaj; return ciz(); }
        case 'sifirla':
          await api('/api/sifre/sifirla', { token: sifirlamaTokeni, sifre: v.sifre });
          sifirlamaTokeni = null; ekran = 'giris'; bilgi = '✅ Parolan değişti. Yeni parolanla giriş yapabilirsin.'; return ciz();
        case 'hesap':
          if (String(v.sifre).length < 8) throw new Error('Parola en az 8 karakter olmalı');
          kayitBilgi = { ...kayitBilgi, email: v.email, sifre: v.sifre }; taslak = null; return git('profil');
        case 'profil': {
          const govde = { ad: v.ad, dogumYili: Number(v.dogumYili) || null, avatar: avatarKod(avatar), kosullarOnay: !!v.kosullarOnay, kvkkOnay: !!v.kosullarOnay, pazarlamaOnay: !!v.pazarlamaOnay };
          kayitBilgi = { ...kayitBilgi, ad: v.ad, dogumYili: v.dogumYili };
          if (taslak) await api('/api/kayit/tamamla', govde);
          else await api('/api/kayit', { ...govde, email: kayitBilgi.email, sifre: kayitBilgi.sifre });
          kayitBilgi = { ...kayitBilgi, sifre: null }; taslak = null;
          return kayitBitti();
        }
        case 'telefon-kod': telefonKodu = await api('/api/telefon/kod', { telefon: v.telefon }); if (telefonKodu.zatenDogrulandi) return git('memleket'); return ciz();
        case 'telefon-dogrula': await api('/api/telefon/dogrula', { kod: v.kod }); telefonKodu = null; bilgi = '📱 Telefonun doğrulandı.'; ekran = 'memleket'; return ciz();
        case 'memleket': await api('/api/hesap/memleket', { plaka: v.plaka }); return bitir();
      }
    });
    calis();
  });
  kok.addEventListener('keydown', (e) => { if (e.key === 'Escape' && kok.classList.contains('kart-acik')) kartKapat(); });

  // Dönüş parametreleri (Google/Apple, sıfırlama bağlantısı): adres çubuğundan temizlenir
  async function adresIsle({ girisli, sifirla }) {
    const u = new URL(location.href), p = u.searchParams;
    const al = (k) => { const x = p.get(k); p.delete(k); return x; };
    const kayit = al('kayit'), giris = al('giris'), iki = al('ikiAdim'), hataKod = al('giris_hata'), baglandi = al('baglandi');
    history.replaceState(null, '', u.pathname + (p.toString() ? `?${p}` : '') + u.hash);
    if (sifirla) return ac('sifirla', { token: sifirla });
    if (kayit === 'tamamla') {
      try { taslak = await api('/api/kayit/taslak'); kayitBilgi = { ad: taslak.adOneri || '' }; return ac('profil'); }
      catch { return ac('karsilama', { hata: 'Kayıt oturumunun süresi doldu; yeniden dene.' }); }
    }
    if (iki) return ac('ikiAdim');
    if (hataKod) return ac('karsilama', { hata: HATALAR[hataKod] || 'Giriş tamamlanamadı.' });
    if (giris === 'tamam' && girisli) { tost('Tekrar hoş geldin!'); return null; }
    if (baglandi) { tost(`✅ ${baglandi === 'google' ? 'Google' : baglandi === 'apple' ? 'Apple' : 'Hesap'} hesabın bağlandı`); return 'hesap'; }
    if (!girisli) return ac('karsilama', { kartGizli: true });
    return null;
  }

  return { ac, kapat, kartKapat, adresIsle, acikMi: () => !kok.hidden, ilOner: (p) => { onerilenIl = p; } };
}
