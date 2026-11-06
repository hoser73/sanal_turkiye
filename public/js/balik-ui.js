// Balık tutma (pencerede, 3B): takım seçimi (yem, derinlik, misina) ve olası türler, ilin gerçek saatine ve havasına göre
// balık aktivitesi, basılı tutup bırakarak atış gücü, yalancı vuruşlar, ısırınca "Çek!", türüne göre davranan balıkla makara
// mücadelesi (gerginlik misina dayanımını aşmamalı), balığın sudan kaldırılması. Isırma anı, tür, ağırlık ve takılmayı sunucu
// belirler; mücadele burada oynanır, sunucu en kısa süreyi denetler. WebGL yoksa 2B yedek (balik-2b.js) açılır.
import { esc, akce } from './yardimci.js';
import { gunesKonumu } from './gunes.js';

const DAVRANIS = {   // mücadele kişiliği: temel çekiş, çırpınma sıklığı (ms) ve gücü, sarma hızı
  inatci: { taban: 0.3, aralik: [3200, 5200], firtla: [0.5, 0.75], sure: [0.5, 0.9], hiz: 0.75, ad: 'ağır ve inatçı' },
  kacak: { taban: 0.16, aralik: [1700, 3000], firtla: [0.72, 0.95], sure: [1.0, 1.8], hiz: 0.95, kacis: true, ad: 'ani kaçışlar yapan' },
  sicrayan: { taban: 0.2, aralik: [2600, 4200], firtla: [0.55, 0.8], sure: [0.5, 0.8], hiz: 0.9, sicrar: true, ad: 'sudan sıçrayan' },
  surucu: { taban: 0.12, aralik: [1400, 2400], firtla: [0.35, 0.55], sure: [0.3, 0.5], hiz: 1.25, ad: 'çevik' },
};
const rast = ([a, b]) => a + Math.random() * (b - a);
const sinirla = (v, a, b) => Math.max(a, Math.min(b, v));
const tercih = (k, v) => { try { return localStorage.getItem(k) || v; } catch { return v; } };
const tercihYaz = (k, v) => { try { localStorage.setItem(k, v); } catch { /* özel pencere */ } };
let takimOnbellek = null;

export function balikOyunu(kap, { api, sonuc, ses }) {
  kap.innerHTML = `<div class="balik-oyun b3">
    <div class="balik-sahne">
      <canvas aria-label="Balık tutma sahnesi"></canvas>
      <div class="balik-ust"><span class="balik-aktivite"></span><span class="balik-hak"></span></div>
      <div class="balik-buyuk" hidden></div>
      <div class="balik-mesafe" hidden><span class="dolu"></span><b>🐟</b><small></small></div>
      <div class="balik-gerginlik" hidden><span class="sari"></span><span class="kirmizi"></span><span class="isaret"></span><small>GERGİNLİK</small></div>
      <div class="balik-guc" hidden><span></span><small>ATIŞ GÜCÜ</small></div>
      <div class="balik-kart" hidden></div>
      <div class="balik-yukleniyor">Göl hazırlanıyor…</div>
    </div>
    <div class="balik-takim" hidden></div>
    <p class="balik-yazi" aria-live="polite"></p>
    <div class="satir balik-dugmeler"><button type="button" class="dugme altin genis" data-balik="bos" disabled>🎣</button></div>
    <p class="kucuk balik-ipucu"></p></div>`;
  const $ = (s) => kap.querySelector(s);
  const tuval = $('canvas'), yazi = $('.balik-yazi'), dugme = $('[data-balik]'), ipucu = $('.balik-ipucu'), takimEl = $('.balik-takim');
  const kart = $('.balik-kart'), buyuk = $('.balik-buyuk'), gucEl = $('.balik-guc'), mesafeEl = $('.balik-mesafe'), gergEl = $('.balik-gerginlik');

  let sahne = null, yedek = null, kapandi = false, kare = 0, onceki = 0;
  let konum = null, ortam = null, takim = null;
  const secim = { yem: tercih('st-balik-yem', 'SOLUCAN'), derinlik: tercih('st-balik-derinlik', 'ORTA'), misina: tercih('st-balik-misina', 'ORTA') };
  // Oyun durumu
  let durum = 'yukleniyor', atis = null, atisGucu = 0, gucBas = 0, gucTut = false;
  let ucus = null, sam = null, isirmaAn = Infinity, isirmaBitis = 0, yalancilar = [], yaklasma = null;
  let m = null, tutuyor = false, cikis = null, sonucBalik = null, salinim = 0, makaraTik = 0, atisCevapAn = 0;

  // ---------- Kurulum
  async function hazirla(k) {
    konum = k;
    try {
      [ortam, takim] = await Promise.all([api(`/api/balik/ortam?lon=${encodeURIComponent(k.lon)}&lat=${encodeURIComponent(k.lat)}`), takimOnbellek || api('/api/balik/takim')]);
      takimOnbellek = takim;
    } catch (e) { $('.balik-yukleniyor').textContent = e.message; return; }
    if (kapandi) return;
    if (!ortam.su) { $('.balik-yukleniyor').textContent = 'Bu bölgede balık tutulacak su bulunamadı. Haritayı bir göl, nehir ya da kıyı yakınına kaydırıp yeniden dene.'; return; }
    const isikGunduz = tercih('st-isik', 'gercek') === 'gunduz';
    const g = isikGunduz ? { yukseklik: 42, azimut: 200 } : gunesKonumu(k.lon, k.lat);
    try {
      const { balikSahnesi } = await import('./balik3d.js');
      if (kapandi) return;
      sahne = balikSahnesi(tuval, { tip: ortam.su.tip, gunes: g, hava: ortam.aktivite.hava });
    } catch (e) {
      // WebGL yok: 2B yedek
      console.warn('3B balık sahnesi açılamadı, 2B yedek', e);
      const { balikOyunu2B } = await import('./balik-2b.js');
      yedek = balikOyunu2B(kap, { api, sonuc, ses });
      yedek.at(k);
      return;
    }
    $('.balik-yukleniyor').remove();
    const a = ortam.aktivite;
    $('.balik-aktivite').innerHTML = `Balık aktivitesi: <b class="akt-${a.etiket === 'yüksek' ? 'iyi' : a.etiket === 'düşük' ? 'kotu' : 'orta'}">${esc(a.etiket)}</b>${a.sebepler.length ? `<small>${a.sebepler.map(esc).join(' · ')}</small>` : ''}`;
    hakYaz(ortam.kalan);
    kurulumGoster();
    kare = requestAnimationFrame(dongu);
  }
  const hakYaz = (n) => { $('.balik-hak').textContent = `Bugün ${n} atış hakkın`; };

  function olasiliklar() {
    const d = ortam.turler.map((t) => ({ ad: t.ad, w: t.w * (t.yem[secim.yem] ?? 1) * (t.derinlik[secim.derinlik] ?? 1), w0: t.w }));
    const top = d.reduce((x, y) => x + y.w, 0) || 1, top0 = d.reduce((x, y) => x + y.w0, 0) || 1;
    const uyum = top / top0;
    return { turler: d.map((x) => ({ ad: x.ad, yuzde: Math.round((x.w / top) * 100) })).sort((x, y) => y.yuzde - x.yuzde), uyum };
  }
  function kurulumGoster() {
    kap.querySelector('.balik-oyun')?.classList.remove('mucadelede');
    durum = 'kurulum'; sam = null; m = null; cikis = null; sonucBalik = null; isirmaAn = Infinity; kart.hidden = true; buyuk.hidden = true;
    mesafeEl.hidden = true; gergEl.hidden = true; gucEl.hidden = true; sahne?.balikGoster(null);
    const grup = (ad, anahtar, tablo, etiket) => `<div class="balik-secim"><span>${ad}</span><div role="radiogroup" aria-label="${ad}">${Object.entries(tablo).map(([kod, x]) =>
      `<button type="button" role="radio" aria-checked="${secim[anahtar] === kod}" data-takim="${anahtar}" data-kod="${kod}">${etiket(x)}</button>`).join('')}</div></div>`;
    const o = olasiliklar();
    const hiz = ortam.aktivite.kat * takim.misinalar[secim.misina].isirma / Math.max(0.35, Math.min(1.6, o.uyum));
    const stok = ortam.stok || {};
    const yemEtiket = (kod, y) => `${y.ikon} ${esc(y.ad)}${stok[kod] ? ` <small>${kod === 'SAHTE' ? 'sende' : `stok ${stok[kod]}`}</small>` : y.fiyat ? ` <small>${akce(y.fiyat)}</small>` : ''}`;
    takimEl.innerHTML = grup('Yem', 'yem', Object.fromEntries(Object.entries(takim.yemler).map(([k, y]) => [k, { ...y, kod: k }])), (y) => yemEtiket(y.kod, y))
      + grup('Derinlik', 'derinlik', takim.derinlikler, (d) => `${esc(d.ad)} <small>${d.m} m</small>`)
      + grup('Misina', 'misina', takim.misinalar, (x) => esc(x.ad))
      + `<p class="balik-olasi">${ortam.su.tip === 'deniz' ? '🌊 Deniz' : '🏞️ Tatlı su'} · Olası: ${o.turler.map((t) => `<b>${esc(t.ad)}</b> %${t.yuzde}`).join(', ')}
         · Vuruş: <b>${hiz < 0.8 ? 'hızlı' : hiz < 1.15 ? 'normal' : 'yavaş'}</b>${secim.misina === 'INCE' ? ' · ince misina kolay kopar' : secim.misina === 'KALIN' ? ' · kalın misina dayanıklı ama balık ürker' : ''}</p>`;
    takimEl.hidden = false;
    dugmeAyarla('at');
    yazi.textContent = 'Takımını seç, sonra oltayı at.';
    ipucu.innerHTML = '<b>Oltayı at</b> düğmesini (ya da boşluğu) <b>basılı tut</b>, güç çubuğu istediğin yere gelince <b>bırak</b>. Uzak atış derin ve sakin suya düşer.';
  }
  takimEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-takim]');
    if (!b || durum !== 'kurulum') return;
    secim[b.dataset.takim] = b.dataset.kod; tercihYaz(`st-balik-${b.dataset.takim}`, b.dataset.kod);
    ses('tik'); kurulumGoster();
  });

  // ---------- Atış: basılı tut → güç salınır, bırak → at
  const gucDegeri = (an) => { const p = ((an - gucBas) / 1300) % 2; return p < 1 ? p : 2 - p; };
  function gucBasla() { if (durum !== 'kurulum') return; gucTut = true; gucBas = performance.now(); gucEl.hidden = false; durum = 'guc'; }
  async function gucBirak() {
    if (durum !== 'guc') return;
    gucTut = false; atisGucu = sinirla(gucDegeri(performance.now()), 0.05, 1); gucEl.hidden = true;
    durum = 'atiliyor'; takimEl.hidden = true; dugmeAyarla('bos');
    yazi.textContent = 'Olta atılıyor…'; ses('atis');
    const bas = performance.now();
    let r;
    try { r = await api('/api/balik/at', { ...konum, ...secim }); } catch (e) { kurulumGoster(); yazi.textContent = e.message; return; }
    if (kapandi) return;
    atis = r; hakYaz(r.kalan);
    if (r.yemStok && ortam.stok && r.yem !== 'SAHTE') ortam.stok[r.yem] = Math.max(0, (ortam.stok[r.yem] || 1) - 1);
    atisCevapAn = performance.now();   // ısırma anı sunucuda yanıt anına göredir (geç kalma payı erken payından geniş)
    const uc = sahne.oltaUcu(), hedef = { x: (Math.random() - 0.5) * 5 * (0.4 + atisGucu), z: 2.5 - (7 + atisGucu * 26) };
    ucus = { bas: Math.max(bas, atisCevapAn - 200), sure: 900 + atisGucu * 500, x0: uc.x, y0: uc.y, z0: uc.z, ...hedef };
  }
  function suyaDustu(an) {
    sam = { x: ucus.x, z: ucus.z, ek: 0 }; ucus = null;
    sahne.sicrat(sam.x, sam.z, 26, 0.7); sahne.halka(sam.x, sam.z, 1.2); ses('su');
    durum = 'bekliyor';
    isirmaAn = Math.max(an + 600, atisCevapAn + atis.isirmaMs);
    isirmaBitis = Math.max(isirmaAn + 500, atisCevapAn + atis.isirmaMs + atis.pencereMs + 250);   // sunucunun penceresiyle hizalı
    yalancilar = [];
    const adet = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < adet; i++) { const v = an + 700 + Math.random() * Math.max(300, isirmaAn - an - 1400); if (v < isirmaAn - 600) yalancilar.push({ an: v, oldu: false }); }
    yaklasma = { aci: Math.random() * Math.PI * 2 };
    dugmeAyarla('cek');
    yazi.textContent = `${atis.tip === 'deniz' ? 'Denize' : 'Suya'} ${Math.round(Math.abs(sam.z - 3))} m attın. Şamandırayı izle…`;
    ipucu.innerHTML = 'Şamandıra <b>suya gömülünce</b> hemen <b>Çek!</b> (tıkla, dokun ya da boşluk). Yalancı vuruşlara aldanma.';
  }

  // ---------- Isırma ve çekme
  function isirdi(an) {
    durum = 'isirdi';
    sahne.sicrat(sam.x, sam.z, 14, 0.5); sahne.halka(sam.x, sam.z, 1.6); ses('isirdi');
    buyuk.textContent = 'ISIRDI! ÇEK!'; buyuk.hidden = false; buyuk.className = 'balik-buyuk uyari';
    yazi.textContent = 'Isırdı! Çek!';
  }
  async function cek() {
    if (durum !== 'isirdi' && durum !== 'bekliyor') return;
    const once = durum;
    durum = 'cekiliyor'; dugmeAyarla('bos'); buyuk.hidden = true;
    let r;
    try { r = await api(`/api/balik/${atis.id}/cek`, {}); } catch (e) { yazi.textContent = e.message; bitisDugmesi(); return; }
    if (kapandi) return;
    if (!r.takildi) {
      sahne.halka(sam.x, sam.z, 0.6); ses('su');
      yazi.textContent = r.sebep === 'erken' ? (once === 'bekliyor' ? 'Çok erken çektin: balık ürktü ve kaçtı.' : 'Çok erken çektin; balık kaçtı.') : 'Geç kaldın: balık yemi alıp kaçtı.';
      sonuc?.(r); bitisDugmesi(); return;
    }
    const d = DAVRANIS[r.davranis] || DAVRANIS.inatci, an = performance.now();
    m = { d, guc: r.guc, dayanim: r.dayanim, sarma: r.sarmaHiz || 1, minMs: r.minMs, maksMs: r.maksMs, bas: an, x: sam.x, z: sam.z, z0: sam.z, yon: 0,
      gerginlik: 0.35, ilerleme: 0.04, gevsek: 0, firtla: 0.5, firtlaGuc: rast(d.firtla), sonraki: an + 1500, sicrama: null, kacisYon: 1 };
    durum = 'mucadele'; sam = null;
    sahne.sicrat(m.x, m.z, 30, 0.9); sahne.halka(m.x, m.z, 2); sahne.sars(2); ses('su');
    gergEl.hidden = false; mesafeEl.hidden = false; gergBolgeleri(); kap.querySelector('.balik-oyun').classList.add('mucadelede');
    const gucAd = ['', 'küçük', 'orta boy', 'güçlü', 'çok güçlü', 'efsanevi'][r.guc] || '';
    yazi.textContent = `Takıldı! ${gucAd ? `${gucAd[0].toLocaleUpperCase('tr-TR') + gucAd.slice(1)}, ${d.ad} bir balık. ` : ''}Sar, ama misinayı koparma!`;
    ipucu.innerHTML = '<b>Sar</b>: düğmeyi, sahneyi ya da boşluğu <b>basılı tut</b>. Gösterge sarıya gelince yavaşla, kırmızıda misina kopar. Balık kaçarken sarma; fazla gevşetirsen kurtulur.';
    dugmeAyarla('sar');
  }
  function gergBolgeleri() {
    // Gösterge 0…1,25; sarı: dayanımın %85'i, kırmızı: dayanım
    const olcek = (v) => `${(1 - Math.min(1.25, v) / 1.25) * 100}%`;
    gergEl.style.setProperty('--sari', olcek(m.dayanim * 0.85)); gergEl.style.setProperty('--kirmizi', olcek(m.dayanim));
  }

  // ---------- Mücadele
  function mucadeleAdim(dt, an) {
    const d = m.d, sure = an - m.bas;
    if (an > m.sonraki && !m.sicrama) {
      m.firtla = rast(d.sure); m.firtlaGuc = rast(d.firtla) + m.guc * 0.04;
      m.sonraki = an + rast(d.aralik) * (1.1 - m.guc * 0.06);
      m.kacisYon = Math.random() < 0.5 ? -1 : 1;
      sahne.sicrat(m.x, m.z, 10, 0.6); sahne.halka(m.x, m.z, 1.2);
      if (d.sicrar && Math.random() < 0.6) { m.sicrama = { bas: an, sure: 900 }; sahne.balikGoster('SILUET'); sahne.sicrat(m.x, m.z, 30, 1.1); ses('su'); }
    }
    const firtlarken = m.firtla > 0;
    m.firtla = Math.max(0, m.firtla - dt);
    let cekis = firtlarken ? m.firtlaGuc : d.taban + m.guc * 0.035;
    if (m.sicrama) cekis = 0.05;   // havadayken misina gevşer
    const hedef = tutuyor ? 0.28 + cekis * 0.85 : cekis * 0.32;
    m.gerginlik += (hedef - m.gerginlik) * Math.min(1, dt * (tutuyor ? 3.4 : 2.6));
    if (firtlarken && tutuyor) m.gerginlik += dt * 0.4;
    m.gerginlik = sinirla(m.gerginlik, 0, 1.3);
    const hiz = (0.2 - m.guc * 0.022) * d.hiz * m.sarma;   // karbon kamış daha hızlı sarar
    if (tutuyor && m.gerginlik < m.dayanim * 0.85) m.ilerleme += hiz * dt * (firtlarken ? 0.25 : 1);
    if (firtlarken && d.kacis) m.ilerleme -= 0.09 * dt;                 // kaçarken makaradan misina boşalır
    if (!tutuyor) m.ilerleme -= (0.015 + m.guc * 0.01) * dt;
    m.ilerleme = sinirla(m.ilerleme, 0, sure < m.minMs + 150 ? 0.96 : 1);
    m.gevsek = m.gerginlik < 0.1 && !m.sicrama ? m.gevsek + dt : 0;
    if (m.gerginlik >= m.dayanim) return bitir('koptu');
    if (m.gevsek > 2.6 && sure > 1500) return bitir('kacti');
    if (sure > m.maksMs - 500) return bitir('kacti');
    if (m.ilerleme >= 1) return cikar();
    // Balığın yeri: ilerledikçe iskeleye yaklaşır; çırpınırken yana ve açığa kaçar
    const hedefZ = m.z0 + (2.2 - m.z0) * m.ilerleme - (firtlarken ? 3 : 0);
    const hedefX = Math.sin(an / 900) * (2 + (1 - m.ilerleme) * 4) + (firtlarken ? m.kacisYon * 5 : 0);
    const ex = m.x, ez = m.z;
    m.x += (hedefX - m.x) * Math.min(1, dt * (firtlarken ? 2.2 : 1));
    m.z += (hedefZ - m.z) * Math.min(1, dt * 1.2);
    m.yon = Math.atan2(m.z - ez, m.x - ex) || m.yon;
    if (m.gerginlik > 0.7 && Math.random() < dt * 30) sahne.sicrat(m.x, m.z, 1, 0.35);
    if (Math.random() < dt * 1.2) sahne.halka(m.x, m.z, 0.5);
    if (m.gerginlik > m.dayanim * 0.85) sahne.sars(0.6);
    if (tutuyor && an > makaraTik) { ses('makara'); makaraTik = an + 90; }
    // HUD
    gergEl.querySelector('.isaret').style.top = `${(1 - Math.min(1.25, m.gerginlik) / 1.25) * 100}%`;
    gergEl.classList.toggle('tehlike', m.gerginlik > m.dayanim * 0.85);
    mesafeEl.querySelector('.dolu').style.width = `${m.ilerleme * 100}%`;
    mesafeEl.querySelector('b').style.left = `${m.ilerleme * 100}%`;
    mesafeEl.querySelector('small').textContent = `${Math.max(1, Math.round(Math.hypot(m.x, m.z - 7.7)))} m`;
  }
  async function bitir(neden) {
    if (durum !== 'mucadele') return;
    durum = 'kaybetti'; tutuyor = false; dugmeAyarla('bos'); gergEl.hidden = true; mesafeEl.hidden = true;
    if (neden === 'koptu') { ses('kopma'); sahne.sars(3); sahne.sicrat(m.x, m.z, 16, 0.8); }
    else sahne.halka(m.x, m.z, 1.5);
    buyuk.textContent = neden === 'koptu' ? 'MİSİNA KOPTU!' : 'BALIK KAÇTI'; buyuk.className = 'balik-buyuk kotu'; buyuk.hidden = false;
    yazi.textContent = neden === 'koptu' ? 'Misina koptu: gerginliği sarıda yavaşlat, kırmızıya çıkarma. Kalın misina daha dayanıklıdır.' : 'Balık kurtuldu: misinayı çok uzun süre gevşek bıraktın.';
    try { sonuc?.(await api(`/api/balik/${atis.id}/cikar`, { basari: false, neden })); } catch { /* zaten kaçtı */ }
    if (neden === 'koptu' && atis.yem === 'SAHTE' && atis.yemStok) { yazi.textContent += ' Sahte yemin de misinayla gitti.'; ortam.stok.SAHTE = 0; }
    bitisDugmesi();
  }
  async function cikar() {
    durum = 'cekiliyor'; tutuyor = false;
    let r;
    try { r = await api(`/api/balik/${atis.id}/cikar`, { basari: true }); }
    catch (e) {
      if (/yorulmadı/.test(e.message)) { m.ilerleme = 0.9; durum = 'mucadele'; return; }
      yazi.textContent = e.message; bitisDugmesi(); return;
    }
    if (kapandi) return;
    gergEl.hidden = true; mesafeEl.hidden = true;
    if (!r.tutuldu) { yazi.textContent = 'Balık son anda kurtuldu.'; bitisDugmesi(); sonuc?.(r); return; }
    sonucBalik = r;
    sahne.balikGoster(r.urun);
    const boy = sinirla(Math.cbrt(r.agirlik) * 0.45, 0.3, 0.8);   // küçük balık da yakından seçilsin
    cikis = { bas: performance.now(), sure: 1500, x0: m.x, z0: m.z, boy };
    durum = 'cikiyor'; dugmeAyarla('bos');
    sahne.sicrat(m.x, m.z, 40, 1.3); sahne.halka(m.x, m.z, 2.2); sahne.sars(1.5); ses('su');
    yazi.textContent = 'Geliyor…';
    sonuc?.(r);
  }
  function sonucGoster() {
    const r = sonucBalik;
    durum = 'sonuc'; ses('hasat');
    const kg = r.agirlik.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    kart.innerHTML = `<div class="balik-kart-ic ${r.urun === 'ALTIN_BALIK' ? 'altin' : ''}">
      <b>${esc(r.ad)}</b><span class="balik-kart-kg">${kg} kg</span>
      ${r.rekor ? `<span class="balik-rekor">🏆 Kişisel rekor${r.oncekiRekor != null ? ` (önceki ${r.oncekiRekor.toLocaleString('tr-TR')} kg)` : ''}</span>` : ''}
      ${r.odul ? `<span class="balik-rekor">✨ Nadir altın balık: +${akce(r.odul)}</span>` : ''}</div>`;
    kart.hidden = false;
    yazi.innerHTML = `${r.ikon} <b>${esc(r.ad)}</b> tuttun! Kovaya (envanterine) girdi.`;
    ipucu.textContent = 'Balıkları pazarda satabilir ya da komşuna gönderebilirsin.';
    bitisDugmesi();
  }
  function bitisDugmesi() { if (durum !== 'sonuc') durum = 'bitti'; dugmeAyarla('yeniden'); }

  // ---------- Ana döngü: oyun durumundan sahne hâli
  function dongu(an) {
    kare = requestAnimationFrame(dongu);
    const dt = Math.min(0.05, (an - (onceki || an)) / 1000); onceki = an;
    if (durum === 'guc') { const p = gucDegeri(an); gucEl.querySelector('span').style.height = `${p * 100}%`; salinim = -p * 0.25; }
    else salinim += (0 - salinim) * Math.min(1, dt * 6);
    let samHal = null, balikHal = null, cikisHal = null, egilme = 0, gerginlik = 0.15;
    if (ucus) {
      const p = sinirla((an - ucus.bas) / ucus.sure, 0, 1);
      samHal = { havada: true, x: ucus.x0 + (ucus.x - ucus.x0) * p, z: ucus.z0 + (ucus.z - ucus.z0) * p, y: ucus.y0 + (0 - ucus.y0) * p + Math.sin(p * Math.PI) * (3 + atisGucu * 5) };
      salinim = Math.sin(Math.min(1, p * 3) * Math.PI) * 0.35;
      if (p >= 1) suyaDustu(an);
    }
    if (sam && (durum === 'bekliyor' || durum === 'isirdi' || durum === 'cekiliyor')) {
      let ek = 0;
      for (const v of yalancilar) {
        const d = an - v.an;
        if (d > 0 && d < 320) { ek -= Math.sin((d / 320) * Math.PI) * 0.09; if (!v.oldu) { v.oldu = true; sahne.halka(sam.x, sam.z, 0.5); } }
      }
      if (durum === 'isirdi') ek = -0.32 + Math.sin(an / 40) * 0.04;
      samHal = { x: sam.x, z: sam.z, ek };
      // Isırmadan ~3,5 sn önce balık gölgesi yaklaşır
      const kalan = isirmaAn - an;
      if (yaklasma && (kalan < 3500 || durum === 'isirdi')) {
        const p = sinirla(1 - kalan / 3500, 0, 1), r = (1 - p) * 4 + 0.4, a = yaklasma.aci + p * 2.2;
        balikHal = { goster: true, x: sam.x + Math.cos(a) * r, z: sam.z + Math.sin(a) * r, derinlik: 1.6 - p * 1.1, yon: a + Math.PI / 2, boy: 0.6 };
      }
    }
    if (durum === 'bekliyor' && an >= isirmaAn) isirdi(an);
    if (durum === 'isirdi' && an > isirmaBitis) { durum = 'bekliyor'; isirmaAn = Infinity; buyuk.hidden = true; yazi.textContent = 'Balık yemi alıp gitti… yine de çekmeyi deneyebilirsin.'; }
    if (durum === 'mucadele') {
      mucadeleAdim(dt, an);
      if (m) {
        gerginlik = m.gerginlik; egilme = Math.min(1.1, m.gerginlik);
        balikHal = { goster: !m.sicrama, x: m.x, z: m.z, derinlik: 0.4 + (1 - m.ilerleme) * 0.6, yon: m.yon, boy: 0.5 + m.guc * 0.12 };
        if (m.sicrama) {
          const p = (an - m.sicrama.bas) / m.sicrama.sure;
          if (p >= 1) { m.sicrama = null; sahne.balikGoster(null); sahne.sicrat(m.x, m.z, 24, 0.9); sahne.halka(m.x, m.z, 1.8); m.gerginlik += 0.35; ses('su'); }
          else cikisHal = { x: m.x, y: Math.sin(p * Math.PI) * 1.6, z: m.z, rz: (0.5 - p) * 1.6, ry: -m.yon, olcek: 0.45 + m.guc * 0.06, cirpinma: 26 };
        }
      }
    }
    if (durum === 'cikiyor' || durum === 'sonuc') {
      const c = cikis, p = sinirla((an - c.bas) / c.sure, 0, 1), e = 1 - (1 - p) ** 3;
      const hx = 0.2, hy = 2.2, hz = 7.65;   // kameranın önünde, misinada asılı
      cikisHal = { x: c.x0 + (hx - c.x0) * e, y: Math.sin(p * Math.PI) * 1.4 + (hy - 0) * e, z: c.z0 + (hz - c.z0) * e,
        rz: durum === 'sonuc' ? Math.sin(an / 260) * 0.12 : (1 - e) * 1.2, ry: Math.sin(an / 900) * 0.25, olcek: c.boy, cirpinma: durum === 'sonuc' ? 7 : 22 };
      if (Math.random() < dt * 8) sahne.sicrat(cikisHal.x, cikisHal.z, 1, 0.1, cikisHal.y - 0.1);
      egilme = 0.5 + Math.sin(an / 300) * 0.05;
      if (p >= 1 && durum === 'cikiyor') sonucGoster();
    }
    sahne.ciz({ durum, samandira: samHal, balik: balikHal, cikis: cikisHal, egilme, gerginlik, salinim, misina: durum !== 'kaybetti' && durum !== 'bitti' || !!sam,
      kirmiziEsik: m ? m.dayanim * 0.85 : 2, makaraHiz: tutuyor ? 18 : 0 }, dt);
  }

  // ---------- Düğme ve girdi
  function dugmeAyarla(kip) {
    dugme.dataset.balik = kip; dugme.disabled = kip === 'bos';
    dugme.textContent = { at: '🎣 Oltayı at (basılı tut, bırak)', cek: '🎣 Çek!', sar: '🌀 Sar (basılı tut)', yeniden: '🎣 Yeniden at', bos: '…' }[kip];
    dugme.classList.toggle('sar', kip === 'sar');
  }
  function basildi(e) {
    if (durum === 'kurulum') { e?.preventDefault?.(); gucBasla(); return; }
    if (durum === 'mucadele') { e?.preventDefault?.(); tutuyor = true; return; }
    if (durum === 'bekliyor' || durum === 'isirdi') cek();
  }
  function birakildi() { tutuyor = false; if (durum === 'guc') gucBirak(); }
  dugme.addEventListener('pointerdown', (e) => {
    if (dugme.dataset.balik === 'yeniden') return;
    dugme.setPointerCapture?.(e.pointerId); basildi(e);
  });
  for (const o of ['pointerup', 'pointercancel']) dugme.addEventListener(o, birakildi);
  dugme.addEventListener('click', () => { if (dugme.dataset.balik === 'yeniden') kurulumGoster(); });
  tuval.addEventListener('pointerdown', (e) => { tuval.setPointerCapture?.(e.pointerId); basildi(e); });
  for (const o of ['pointerup', 'pointercancel']) tuval.addEventListener(o, birakildi);
  const tusBas = (e) => {
    if (e.code !== 'Space' || !kap.isConnected) return;
    e.preventDefault();
    if (e.repeat) return;
    if (dugme.dataset.balik === 'yeniden') { kurulumGoster(); return; }
    basildi(e);
  };
  const tusBirak = (e) => { if (e.code === 'Space') birakildi(); };
  document.addEventListener('keydown', tusBas);
  document.addEventListener('keyup', tusBirak);
  window.addEventListener('blur', birakildi);
  if (['localhost', '127.0.0.1'].includes(location.hostname)) window.__balik = { hal: () => ({ durum, gerginlik: m?.gerginlik ?? 0, ilerleme: m?.ilerleme ?? 0, dayanim: m?.dayanim }) };   // yalnızca yerel test

  return {
    hazirla,
    at: hazirla,
    kapat() {
      kapandi = true;
      cancelAnimationFrame(kare);
      document.removeEventListener('keydown', tusBas); document.removeEventListener('keyup', tusBirak); window.removeEventListener('blur', birakildi);
      delete window.__balik;
      if (durum === 'mucadele' && atis) api(`/api/balik/${atis.id}/cikar`, { basari: false }).catch(() => {});   // yarıda kalan mücadele: balık kaçar
      sahne?.kapat(); yedek?.kapat();
    },
  };
}
