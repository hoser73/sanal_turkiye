// Rehber: görev şeridi. Haritanın üstünde ince bir şerit yeni oyuncuya sıradaki adımı (ilerleme, ödül, "Göster")
// söyler; dokununca adımın açıklaması ve bütün başlangıç yolculuğu açılır. Adım, sunucudaki ilk görevlerin
// (ILK_PARSEL, ILK_EKIM, …) durumundan çıkar; oyuncu bir şey yaptıkça şerit kısa bir kutlamayla sonraki adıma geçer.
// Başlangıç bitince şerit yalnızca söylenecek bir ipucu olduğunda görünür. "Göster" ekranı loşlaştırır, hedef düğmeyi
// parlak bir halka ve zıplayan bir elle gösterir (gerekirse haritayı uçurur). Şerit küçültülebilir; tamamen
// kapatılabilir (Hesap → Rehberi yeniden başlat).
import { esc, tost } from './yardimci.js';

// Başlangıç adımları: görev kodu tamamlanmamışsa sıradaki adım odur (başlık şeritte görünen kısa eylemdir)
const ADIMLAR = [
  { kod: 'ILK_PARSEL', ikon: '🗺️', baslik: 'Bir tarla edin', metin: 'Haritada yeşil (tarım) bir parsele dokun, kartındaki <b>Parseli edin</b> düğmesine bas. Yakındaki boş bir tarlayı biz de gösterebiliriz.',
    dugme: 'Tarla göster', hedef: '[data-eylem="edin"]', is: 'tarlaGoster' },
  { kod: 'ILK_EKIM', ikon: '🌱', baslik: 'İlk tohumu ek', metin: 'Tarlan hazır. Kartındaki ürünlerden birini seç ve ek; buğday ucuzdur, iyi bir başlangıç.',
    dugme: 'Göster', hedef: '[data-eylem="ek"]', is: 'tarlamaGit' },
  { kod: 'ILK_SULAMA', ikon: '💧', baslik: 'Tarlanı sula', metin: 'Ekinler suyu sever. <b>Sula</b> düğmesine bas; her sulama hasadı bereketlendirir.',
    dugme: 'Göster', hedef: '[data-eylem="sula"]', is: 'tarlamaGit' },
  { kod: 'ILK_YAPI', ikon: '🔨', baslik: 'Çit ya da sulama hattı kur', metin: 'İnşaat atölyesinden bir tel çit ya da sulama hattı kur. Sulama hattı ekinini kendiliğinden sular.',
    dugme: 'Göster', hedef: '[data-eylem="insaat"]:not([disabled])', is: 'tarlamaGit' },
  { kod: 'ILK_HASAT', ikon: '🧺', baslik: 'İlk hasadını yap', metin: 'Ekinin olgunlaşınca tarlanın üstünde 🧺 balonu belirir. O zaman <b>Hasat et</b>. Beklerken komşulara göz atabilirsin.',
    dugme: 'Tarlama git', hedef: '[data-eylem="hasat"]', is: 'tarlamaGit' },
  { kod: 'ILK_SATIS', ikon: '💰', baslik: 'Ürününü pazarda sat', metin: 'Ürünlerin <b>Ben → Arazilerim</b> bölümündeki envanterde. Bir kısmını pazara sat, akçe kazan; geri kalanı siparişler için sakla.',
    dugme: 'Göster', hedef: '.sat-form button', is: 'arazilerim' },
  { kod: 'KOMSU_ZIYARET', ikon: '🤝', baslik: 'Bir komşuyu ziyaret et', metin: 'Yakındaki bir oyuncunun tarlasına dokun ve <b>👋 Ziyaret et</b>. Seviye 3\'te komşu olup birbirinizin tarlasını sulayabilir, hediye gönderebilirsiniz.',
    dugme: 'Komşu bul', hedef: '[data-eylem="ziyaret"]', is: 'komsuBul' },
  { kod: 'CIFTLIK', ikon: '🐔', baslik: 'Çiftliğini keşfet', metin: '<b>Çiftlik</b> sekmesinde günlük ödülün, köylülerin siparişleri, komşuların ve yöresel ürünlerin var.',
    dugme: 'Çiftliğim', hedef: '#gorevler-cift', is: 'ciftlik' },
];

// Akıllı ipuçları (başlangıç bittikten sonra): oyuncunun durumundan çıkan en önemli tek ipucu
function ipucuBul(b) {
  const portfoy = b?.portfoy || [];
  const olgun = portfoy.find((p) => p.ekin?.olgun);
  if (olgun) return { onemli: true, kod: `hasat:${olgun.id}:${olgun.ekin.id}`, ikon: '🧺', baslik: 'Hasat zamanı!', metin: `${esc(olgun.mahalle)} tarlandaki <b>${esc(olgun.ekin.ad)}</b> olgunlaştı. Bekletme, tazeliği kaçmasın.`, dugme: 'Tarlama git', hedef: '[data-eylem="hasat"]', is: 'parseleGit', parsel: olgun.id };
  const susuz = portfoy.find((p) => p.ekin && !p.ekin.olgun && !p.ekin.otomatikSulama && p.ekin.sulama < p.ekin.gerekenSulama && !p.ekin.sonrakiSulamaMs);
  if (susuz) return { kod: `sula:${susuz.id}:${susuz.ekin.id}:${susuz.ekin.sulama}`, ikon: '💧', baslik: 'Toprak susadı', metin: `<b>${esc(susuz.ekin.ad)}</b> tarlan sulanmayı bekliyor (${susuz.ekin.sulama}/${susuz.ekin.gerekenSulama}). Sulanan tarla daha bereketli olur.`, dugme: 'Sulamaya git', hedef: '[data-eylem="sula"]', is: 'parseleGit', parsel: susuz.id };
  const bos = portfoy.find((p) => p.imarAd === 'Tarım' && !p.ekin);
  if (b?.gunlukOdul) return { onemli: true, kod: `gunluk:${new Date().toDateString()}`, ikon: '🎁', baslik: 'Günlük ödülün hazır', metin: 'Bugünkü hediyen <b>Çiftlik</b> sekmesinde seni bekliyor. Her gün gelirsen ödül büyür!', dugme: 'Ödülü al', hedef: '#gorevler-cift', is: 'ciftlik' };
  if (b?.seviye?.odulBekleyen) return { onemli: true, kod: `seviye:${b.seviye.seviye}`, ikon: '⭐', baslik: 'Seviye ödülü', metin: `Seviye ${b.seviye.seviye} oldun, aferin! Ödülün <b>Çiftlik</b> sekmesinde.`, dugme: 'Ödülü al', hedef: '#gorevler-cift', is: 'ciftlik' };
  if (b?.yol?.alinabilir) return { onemli: true, kod: `yol:${b.yol.ulasilan}`, ikon: '🛤️', baslik: 'Sezon yolu ödülün hazır', metin: `Sezon yolunda <b>${b.yol.alinabilir}</b> kademe ödülü seni bekliyor.`, dugme: 'Ödülü al', hedef: '[data-eylem="yol-al"]', is: 'yol' };
  if (bos) return { kod: `bos:${bos.id}`, ikon: '🌱', baslik: 'Tarla boş kalmasın', metin: `${esc(bos.mahalle)} tarlan boş duruyor. Bir şey ek, toprak çalışsın.`, dugme: 'Tarlama git', hedef: '[data-eylem="ek"]', is: 'parseleGit', parsel: bos.id };
  return null;
}

export function rehberKur({ durum, harita, parselSec, sekmeSec, ciftlikAlt, tarlaAl }) {
  const kok = document.createElement('div');
  kok.className = 'rehber';
  kok.hidden = true;
  kok.innerHTML = '<div class="gs" role="status" aria-live="polite"></div><div class="gs-kart" role="dialog" aria-label="Görevler" hidden></div>';
  (document.querySelector('.sahne') || document.body).appendChild(kok);
  const serit = kok.querySelector('.gs'), kart = kok.querySelector('.gs-kart');

  const spot = document.createElement('div');
  spot.className = 'rehber-spot';
  spot.hidden = true;
  spot.innerHTML = '<div class="rehber-spot-halka"></div><div class="rehber-el" aria-hidden="true">👆</div><div class="rehber-spot-yazi">Buraya dokun</div>';
  document.body.appendChild(spot);
  const halka = spot.querySelector('.rehber-spot-halka'), elIsaret = spot.querySelector('.rehber-el'), spotYazi = spot.querySelector('.rehber-spot-yazi');
  const oku = (k, v) => { try { return localStorage.getItem(k) ?? v; } catch { return v; } };
  const yaz = (k, v) => { try { localStorage.setItem(k, v); } catch { /* özel pencere */ } };

  let adim = null, ipucu = null, kutlama = null, kutlamaZaman = 0;
  const tamamlananlar = () => new Set((durum.ben?.gorevler || []).filter((g) => g.tamam).map((g) => g.kod));
  const gorev = (kod) => (durum.ben?.gorevler || []).find((g) => g.kod === kod);
  const bitti = (x, tamam) => tamam.has(x.kod) || (x.kod === 'CIFTLIK' && !!oku('st-rehber-ciftlik', ''));
  function sonrakiAdim() {
    if (!durum.ben) return null;
    const tamam = tamamlananlar();
    const a = ADIMLAR.find((x) => x.kod !== 'CIFTLIK' && !tamam.has(x.kod));
    // Hiç parseli olmayan yeni oyuncuya tarla hediye edilir (haritada aramaya gerek kalmaz)
    if (a?.kod === 'ILK_PARSEL' && durum.ben.baslangicTarlasi) return { ...a, baslik: 'Hediye tarlanı al', dugme: 'Tarlamı al 🎁', is: 'baslangic', hedef: null,
      metin: 'Sana yakında güzel bir tarla ayrıldı, <b>hediye!</b> Hadi gidip görelim; ekip biçmeyi orada öğrenirsin.' };
    if (a) return a;
    return oku('st-rehber-ciftlik', '') ? null : ADIMLAR.at(-1);
  }
  // Şeritte gösterilen: kutlama > başlangıç adımı > ipucu
  const gosterilen = () => adim || ipucu;

  // ---------- Şerit
  function ilerlemeCiz() {
    const tamam = tamamlananlar(), sira = ADIMLAR.findIndex((x) => x.kod === adim?.kod);
    return `<div class="gs-ilerleme" aria-hidden="true">${ADIMLAR.map((x, i) => `<i class="${bitti(x, tamam) ? 'bitti' : i === sira ? 'simdi' : ''}"></i>`).join('')}</div>`;
  }
  function seritCiz() {
    const acik = !kart.hidden;
    if (kutlama) {
      serit.className = 'gs kutlama';
      serit.innerHTML = `<div class="gs-ana"><span class="gs-ikon">✓</span><span class="gs-yazi"><small>Adım tamam</small><b>${esc(kutlama.baslik)}</b></span>
        ${kutlama.odul ? `<span class="gs-odul">+${kutlama.odul} ₳</span>` : ''}</div>${ilerlemeCiz()}`;
      return;
    }
    const h = gosterilen();
    if (!h) return;
    const kucuk = adim && oku('st-rehber-kucuk', '') === adim.kod && !acik;
    document.body.classList.toggle('gs-var', !kucuk);   // küçük rozet sağdaki denetimleri itmez
    serit.className = `gs${adim ? '' : ' ipucu'}${kucuk ? ' kucuk' : ''}${!adim && ipucu?.onemli ? ' onemli' : ''}`;
    if (kucuk) {
      const sira = ADIMLAR.findIndex((x) => x.kod === adim.kod) + 1;
      serit.innerHTML = `<button type="button" class="gs-ana" data-rehber="buyut" aria-label="Görev şeridini aç: ${esc(adim.baslik)}"><span class="gs-ikon">${adim.ikon}</span><b>${sira}/${ADIMLAR.length}</b></button>`;
      return;
    }
    const g = adim && gorev(adim.kod);
    const ust = adim ? `Adım ${ADIMLAR.findIndex((x) => x.kod === adim.kod) + 1}/${ADIMLAR.length}` : 'İpucu';
    serit.innerHTML = `<button type="button" class="gs-ana" data-rehber="${acik ? 'kapat-kart' : 'kart'}" aria-expanded="${acik}">
        <span class="gs-ikon">${h.ikon}</span><span class="gs-yazi"><small>${ust}${g?.odul ? ` · <em>+${g.odul} ₳</em>` : ''}</small><b>${esc(h.baslik)}</b></span>
        <span class="gs-ok" aria-hidden="true">${acik ? '▴' : '▾'}</span></button>
      <button type="button" class="gs-goster" data-rehber="goster">${esc(h.dugme)} ›</button>
      <button type="button" class="gs-kucult" data-rehber="${adim ? 'kucult' : 'tamam'}" aria-label="${adim ? 'Küçült' : 'Tamam'}">✕</button>
      ${adim ? ilerlemeCiz() : ''}`;
  }

  // ---------- Açılan kart: adımın açıklaması + başlangıç yolculuğu (ipucunda yalnızca açıklama)
  function kartCiz() {
    const h = gosterilen();
    if (!h) { kart.hidden = true; return; }
    const tamam = tamamlananlar();
    const g = adim && gorev(adim.kod);
    const biten = ADIMLAR.filter((x) => bitti(x, tamam)).length;
    kart.innerHTML = `<p class="gs-metin">${h.metin}</p>
      ${g?.odul ? `<div class="gs-odul-kutu">🎁 Bu adımın ödülü <b>+${g.odul} ₳</b></div>` : ''}
      <button type="button" class="gs-goster genis" data-rehber="goster">👉 ${esc(h.dugme)}</button>
      ${adim ? `<div class="gs-yol"><div class="gs-yol-ust"><b>📜 Başlangıç yolculuğu</b><span>${biten}/${ADIMLAR.length}</span></div>
        <ol class="gs-liste">${ADIMLAR.map((x) => {
          const gx = gorev(x.kod), b = bitti(x, tamam);
          return `<li class="${b ? 'bitti' : x.kod === adim.kod ? 'simdi' : ''}"><span class="gs-tik">${b ? '✓' : x.ikon}</span>
            <span class="gs-ad">${esc(x.baslik)}</span>${gx?.odul ? `<span class="gs-odul-cip">+${gx.odul} ₳</span>` : ''}</li>`;
        }).join('')}</ol></div>
        <button type="button" class="gs-bag" data-rehber="kapat">Rehberi kapat</button>`
      : '<button type="button" class="gs-bag" data-rehber="tamam">Anladım, gizle</button>'}`;
  }
  function kartAc() { kartCiz(); kart.hidden = false; yaz('st-rehber-kucuk', ''); seritCiz(); }
  function kartKapat() { kart.hidden = true; seritCiz(); }

  function goster(gorunur) {
    kok.hidden = !gorunur;
    document.body.classList.toggle('gs-var', gorunur);
    if (!gorunur) { kart.hidden = true; spotKapat(); }
  }
  function ciz() {
    const h = kutlama || gosterilen();
    goster(!!h);
    if (!h) return;
    seritCiz();
    if (!kart.hidden) kartCiz();
  }
  // Şeridi kısa bir parlamayla dikkat çeker (yeni adım ya da önemli ipucu)
  function parla() { serit.classList.remove('parla'); void serit.offsetWidth; serit.classList.add('parla'); }

  // ---------- Spot ışığı: ekran loş, hedef parlak halka içinde; zıplayan el hedefi gösterir
  let spotHedef = null, spotKare = 0, spotBitis = 0;
  function spotKapat() { cancelAnimationFrame(spotKare); spot.hidden = true; spotHedef = null; }
  function spotTut(secici, sure = 10000) {
    spotKapat();
    spotBitis = performance.now() + sure;
    const dongu = () => {
      if (performance.now() > spotBitis) return spotKapat();
      spotKare = requestAnimationFrame(dongu);
      if (!spotHedef || !spotHedef.isConnected) {
        spotHedef = [...document.querySelectorAll(secici)].find((el) => el.offsetParent !== null) || null;
        if (spotHedef) spotHedef.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      if (!spotHedef) { spot.hidden = true; return; }
      const r = spotHedef.getBoundingClientRect();
      Object.assign(halka.style, { left: `${r.left - 8}px`, top: `${r.top - 8}px`, width: `${r.width + 16}px`, height: `${r.height + 16}px` });
      const asagi = r.top < innerHeight * 0.4;   // el, hedefin altından ya da üstünden gösterir
      Object.assign(elIsaret.style, { left: `${r.left + r.width / 2 - 22}px`, top: asagi ? `${r.bottom + 10}px` : `${r.top - 62}px` });
      elIsaret.classList.toggle('ters', !asagi);
      Object.assign(spotYazi.style, { left: `${r.left + r.width / 2}px`, top: asagi ? `${r.bottom + 66}px` : `${r.top - 96}px` });
      spot.hidden = false;
    };
    spotKare = requestAnimationFrame(dongu);
  }
  document.addEventListener('pointerdown', (e) => { if (spotHedef && spotHedef.contains(e.target)) setTimeout(spotKapat, 50); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') spotKapat(); });

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
    parseleGit(i) { harita.parseleGit(i.parsel, { zoom: 17.6 }); parselSec(i.parsel); },
    async baslangic() { await tarlaAl?.(); },
    arazilerim() { sekmeSec('arazilerim'); },
    komsular() { ciftlikAlt('komsular'); },
    yol() { ciftlikAlt('yol'); },
    // Ziyaret görevi: oyuncunun tarlasının çevresinde başka bir oyuncuya ait parseli haritada aç
    async komsuBul() {
      for (const p of durum.ben?.portfoy || []) {
        const k = await fetch(`/api/parsel/${encodeURIComponent(p.id)}`).then((x) => x.json()).catch(() => null);
        const n = [...(k?.komsular || []), ...(k?.cevre || [])].find((x) => x.sahip && !x.ben);
        if (n) { harita.parseleGit(n.id, { zoom: 17.6 }); parselSec(n.id); return; }
      }
      tost('Yakınında başka oyuncu yok: haritada gezinip birinin tarlasına dokun ve 👋 Ziyaret et.');
    },
    ciftlik() { ciftlikAlt('ciftlik'); if (adim?.kod === 'CIFTLIK') { yaz('st-rehber-ciftlik', '1'); setTimeout(guncelle, 50); } },
  };
  kok.addEventListener('click', async (e) => {
    const r = e.target.closest('[data-rehber]')?.dataset.rehber;
    if (r === 'kart') kartAc();
    else if (r === 'kapat-kart') kartKapat();
    else if (r === 'buyut') { yaz('st-rehber-kucuk', ''); seritCiz(); }
    else if (r === 'kucult') { if (adim) yaz('st-rehber-kucuk', adim.kod); kartKapat(); }
    else if (r === 'kapat') { yaz('st-rehber', 'kapali'); goster(false); }
    else if (r === 'tamam') { if (ipucu) yaz('st-rehber-ipucu', ipucu.kod); ipucu = null; kart.hidden = true; ciz(); }
    else if (r === 'goster') {
      const hedef = adim || ipucu;
      if (!hedef) return;
      if (!adim) { yaz('st-rehber-ipucu', hedef.kod); ipucu = null; }
      kart.hidden = true; ciz();
      await ISLER[hedef.is]?.(hedef);
      if (hedef.hedef) spotTut(hedef.hedef);
    }
  });

  // Oyuncu durumu değiştikçe çağrılır: adım bittiyse şerit kısa bir kutlama gösterip sonrakine geçer;
  // başlangıç bittiyse en önemli ipucu aranır (aynı ipucu bir kez gösterilir)
  function guncelle() {
    if (oku('st-rehber', '') === 'kapali' || !durum.ben) { goster(false); return; }
    const yeni = sonrakiAdim();
    if (yeni?.kod !== adim?.kod || yeni?.is !== adim?.is) {
      const biten = adim && adim.kod !== yeni?.kod && (tamamlananlar().has(adim.kod) || adim.kod === 'CIFTLIK');
      if (biten) {
        kutlama = { baslik: adim.baslik, odul: gorev(adim.kod)?.odul };
        clearTimeout(kutlamaZaman);
        kutlamaZaman = setTimeout(() => { kutlama = null; ciz(); parla(); }, 2200);
      }
      adim = yeni;
      kart.hidden = true;
      if (adim && oku('st-rehber-adim', '') !== adim.kod) { yaz('st-rehber-adim', adim.kod); setTimeout(parla, 50); }
    }
    if (!adim) {
      const i = ipucuBul(durum.ben);
      const yeniIpucu = i && oku('st-rehber-ipucu', '') !== i.kod ? i : null;
      if (yeniIpucu?.kod !== ipucu?.kod) { ipucu = yeniIpucu; if (ipucu?.onemli) setTimeout(parla, 50); }
    } else ipucu = null;
    ciz();
  }
  return { guncelle, ac: kartAc, yeniden() { for (const k of ['st-rehber', 'st-rehber-adim', 'st-rehber-ciftlik', 'st-rehber-ipucu', 'st-rehber-kucuk']) yaz(k, ''); adim = null; ipucu = null; guncelle(); } };
}
