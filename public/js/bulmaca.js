// Motif bulmacası: nar, lale, çini, başak, nazar ve fındık taşlarıyla 3'lü eşleştirme (tam ekran pencere).
// Komşu iki taş kaydırılarak yer değiştirir; yan yana ya da üst üste en az üç aynı motif patlar, üstteki taşlar düşer.
// 4'lü eşleşme şerit taşı (satırı ya da sütunu temizler), L/T biçimi bohça (3×3 patlar), 5'li eşleşme rozet (seçilen
// motifin hepsini toplar) bırakır. Ot kaplı karelerdeki taş patlayınca ot bir kat azalır. Hedefler hamle bitmeden
// tamamlanınca bölüm kazanılır; sonuç sunucuya bildirilir, ödülü sunucu verir.
import { api, esc, tost, akce } from './yardimci.js';
import { ses } from './ses.js';

// ---------- Motif çizimleri (40×40 SVG)
const MOTIF = {
  NAR: `<circle cx="20" cy="23" r="12.5" fill="#d8323c"/><path d="M14 12l2.2 3.4L20 10l3.8 5.4L26 12l.6 5.2h-13.2z" fill="#a51f2a"/>
    <circle cx="20" cy="23" r="12.5" fill="url(#bmNar)"/><ellipse cx="15.5" cy="19" rx="3.4" ry="2.2" fill="#fff" opacity=".45" transform="rotate(-30 15.5 19)"/>
    <g fill="#ffd6dc"><circle cx="20" cy="26" r="1.2"/><circle cx="23.6" cy="23.6" r="1.1"/><circle cx="16.6" cy="24" r="1"/></g>`,
  LALE: `<path d="M20 36V22" stroke="#3f9a3a" stroke-width="2.6" stroke-linecap="round"/><path d="M20 31c-5-1-8-5-8-9 4 1 7 4 8 9z" fill="#5cb84a"/>
    <path d="M11.5 10c0 8 3.5 13 8.5 13s8.5-5 8.5-13l-4.2 4L20 7l-4.3 7z" fill="#e24a6e"/><path d="M20 7l-4.3 7L20 23z" fill="#c42f57"/>
    <path d="M14 13c0 4 1.2 7 3 8.6" stroke="#ff9ab4" stroke-width="1.6" fill="none" stroke-linecap="round"/>`,
  CINI: `<path d="M20 5l4.2 6.8L32 11l-.8 7.8L37 20l-5.8 1.2L32 29l-7.8-.8L20 35l-4.2-6.8L8 29l.8-7.8L3 20l5.8-1.2L8 11l7.8.8z" fill="#1f5fae"/>
    <path d="M20 10l3 5 5.4-.6-.6 5.6L32 20l-4.2 0 .6 5.6-5.4-.6-3 5-3-5-5.4.6.6-5.6L8 20h4.2l-.6-5.6 5.4.6z" fill="#3fb6c7"/>
    <circle cx="20" cy="20" r="4.4" fill="#fff"/><circle cx="20" cy="20" r="2" fill="#d8323c"/>`,
  BUGDAY: `<path d="M20 37V9" stroke="#b07a1e" stroke-width="2" stroke-linecap="round"/>
    <g fill="#f2b632" stroke="#c98a16" stroke-width=".8">${[10, 15, 20, 25].map((y) => `<ellipse cx="16.2" cy="${y}" rx="2.6" ry="4.4" transform="rotate(-28 16.2 ${y})"/><ellipse cx="23.8" cy="${y}" rx="2.6" ry="4.4" transform="rotate(28 23.8 ${y})"/>`).join('')}
    <ellipse cx="20" cy="6.5" rx="2.4" ry="4"/></g>`,
  NAZAR: `<circle cx="20" cy="20" r="15" fill="#1d4fb8"/><circle cx="20" cy="20" r="10.5" fill="#fff"/><circle cx="20" cy="20" r="7" fill="#5fb7f0"/>
    <circle cx="20" cy="20" r="3.6" fill="#10213f"/><ellipse cx="14" cy="13" rx="3.2" ry="2" fill="#fff" opacity=".5" transform="rotate(-35 14 13)"/>`,
  FINDIK: `<path d="M20 9c7 0 11 7 11 14s-5 12-11 12S9 30 9 23 13 9 20 9z" fill="#a8652c"/><path d="M20 9c7 0 11 7 11 14-3-3-7-4-11-4s-8 1-11 4C9 16 13 9 20 9z" fill="#c9884a"/>
    <path d="M10 13c2-6 6-8 10-6 4-2 8 0 10 6-3-2-6-2-10 0-4-2-7-2-10 0z" fill="#6fae3c"/><ellipse cx="15" cy="25" rx="2" ry="3.4" fill="#fff" opacity=".25"/>`,
};
const OT_IKON = `<path d="M8 34c2-8 1-14-3-20 6 3 8 9 8 16 0-9 2-17 7-23-1 8 0 15 2 22 1-6 4-11 9-14-3 5-4 12-4 19z" fill="#5fae3a" stroke="#3f8a26" stroke-width="1"/>`;
const svg = (ic) => `<svg viewBox="3 3 34 34" aria-hidden="true"><defs><radialGradient id="bmNar" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#ff7b7b" stop-opacity=".55"/><stop offset="1" stop-color="#7d0f1c" stop-opacity=".25"/></radialGradient></defs>${ic}</svg>`;
const ADLAR = { NAR: 'Nar', LALE: 'Lale', CINI: 'Çini', BUGDAY: 'Başak', NAZAR: 'Nazar', FINDIK: 'Fındık', OT: 'Ot' };
const hedefIkon = (tur) => svg(tur === 'OT' ? OT_IKON : MOTIF[tur]);
const uyu = (ms) => new Promise((r) => setTimeout(r, ms));

let acik = null;
export async function bulmacaAc({ yenile } = {}) {
  if (acik) return;
  const el = document.createElement('div');
  el.className = 'bm-perde';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Motif bulmacası');
  document.body.appendChild(el);
  const tus = (e) => { if (e.key === 'Escape') kapat(); };
  document.addEventListener('keydown', tus);
  let oyun = null, odulAlindi = false;
  acik = { el };
  function kapat() {
    if (oyun && !oyun.bitti) api('/api/bulmaca/bitir', { oyunId: oyun.id, kazandi: false }).catch(() => {});
    oyun?.durdur();
    document.removeEventListener('keydown', tus);
    el.remove(); acik = null;
    if (odulAlindi) yenile?.();
  }
  el.addEventListener('click', (e) => {
    const c = e.target.closest('[data-bm]')?.dataset.bm;
    if (c === 'kapat') kapat();
    else if (c === 'oyna') baslat();
    else if (c === 'menu') menu();
  });

  const ust = (alt = '') => `<div class="bm-ust"><span class="bm-logo">${svg(MOTIF.CINI)}</span><div><b>Motif bulmacası</b><small>${alt}</small></div>
    <button type="button" class="kapat" data-bm="kapat" aria-label="Kapat"></button></div>`;
  const odulHtml = (o) => o.map((x) => `<span class="bm-odul"><i>${esc(x.ikon)}</i>${esc(x.metin)}</span>`).join('');
  const hedefHtml = (h) => h.map((x) => `<span class="bm-hedef-k">${hedefIkon(x.tur)}<b>${x.adet}</b><small>${ADLAR[x.tur]}</small></span>`).join('');
  const yildizlar = (n, buyuk) => `<span class="bm-yildizlar${buyuk ? ' buyuk' : ''}">${[1, 2, 3].map((i) => `<i class="${i <= n ? 'dolu' : ''}">★</i>`).join('')}</span>`;

  async function menu() {
    el.innerHTML = `<div class="bm-kutu">${ust('yükleniyor…')}<div class="bm-bekle"><i></i><i></i><i></i></div></div>`;
    const d = await api('/api/bulmaca').catch((e) => { tost(e.message, 'hata'); return null; });
    if (!d || !acik) return d ? null : kapat();
    const yol = [...d.gecmis.map((g) => ({ n: g.seviye, yildiz: g.yildiz })), { n: d.seviye, simdi: true }, { n: d.seviye + 1 }, { n: d.seviye + 2 }];
    el.innerHTML = `<div class="bm-kutu">${ust(`${d.yildiz} yıldız · ${d.gunluk.kalan ? `bugün ${d.gunluk.kalan} ödüllü bölüm kaldı` : 'bugünkü ödüller alındı'}`)}
      <div class="bm-yol">${yol.map((b) => `<span class="bm-durak${b.simdi ? ' simdi' : b.yildiz ? ' gecti' : ''}"><b>${b.n}</b>${b.yildiz ? yildizlar(b.yildiz) : b.simdi ? '<small>sıradaki</small>' : '<small>🔒</small>'}</span>`).join('<i class="bm-yol-cizgi"></i>')}</div>
      <div class="bm-kart">
        <div class="bm-kart-bas"><span>Bölüm</span><b>${d.seviye}</b></div>
        <div class="bm-satir"><span>Hedef</span><div class="bm-hedefler">${hedefHtml(d.bolum.hedefler)}</div></div>
        <div class="bm-satir"><span>Hamle</span><b>${d.bolum.hamle}</b></div>
        <div class="bm-satir"><span>Ödül</span><div>${d.gunluk.kalan ? odulHtml(d.odul) : '<small>Bugünkü ödüllü bölümler bitti; yine de oynayıp ilerleyebilirsin.</small>'}</div></div>
      </div>
      <button type="button" class="bm-b ana" data-bm="oyna">▶️ Oyna</button>
      <details class="bm-nasil"><summary>Nasıl oynanır?</summary>
        <p>Komşu iki taşı kaydırıp yer değiştir; yan yana ya da üst üste üç aynı motif patlar. Dörtlü eşleşme <b>şerit</b>, L ya da T biçimi <b>bohça</b>, beşli eşleşme <b>rozet</b> bırakır. Otlu karelerdeki taşı patlatınca ot temizlenir.</p>
        <p class="bm-kucuk">Günde ${d.gunluk.tavan} bölüm ödül verir; her 5. bölümde gübre, her 10. bölümde kalıp seti. Oyun parası (TL) oyun içidir, nakde çevrilmez.</p></details>
    </div>`;
  }

  async function baslat() {
    const b = el.querySelector('[data-bm="oyna"]'); if (b) b.disabled = true;
    const r = await api('/api/bulmaca/basla', {}).catch((e) => { tost(e.message, 'hata'); return null; });
    if (!r || !acik) return;
    oyun = tahtaKur(el, r, { ust, bitti: sonuc });
    oyun.basladi = performance.now();
    oyun.enKisa = r.enKisa || { tabanMs: 0, hamleMs: 0 };
  }

  // Sunucu en kısa süreyi denetler (HIZLI): çok hızlı bitirilen bölüm kaybolmasın, süre dolunca yeniden gönderilir
  async function gonder(kazandi, hamle) {
    if (!kazandi) return api('/api/bulmaca/bitir', { oyunId: oyun.id, kazandi: false });
    for (let deneme = 0; ; deneme++) {
      try { return await api('/api/bulmaca/bitir', { oyunId: oyun.id, kazandi: true, hamle }); } catch (e) {
        if (e.kod !== 'HIZLI' || deneme >= 4 || !acik) throw e;
        if (!deneme) tost('⏳ Sonuç kaydediliyor…');
        const gereken = oyun.enKisa.tabanMs + hamle * oyun.enKisa.hamleMs - (performance.now() - oyun.basladi);
        await uyu(Math.max(800, gereken + 300));
      }
    }
  }

  async function sonuc(kazandi, hamle) {
    let hata = null;
    const r = await gonder(kazandi, hamle).catch((e) => { hata = e; return null; });
    if (!acik) return;
    const perde = document.createElement('div');
    perde.className = `bm-sonuc ${kazandi ? 'kazandi' : 'kaybetti'}`;
    if (kazandi && r) {
      if (r.odul) { odulAlindi = true; ses('para'); }
      perde.innerHTML = `<div class="bm-sonuc-kutu"><div class="bm-sonuc-bas">Bölüm ${r.seviye} tamam!</div>${yildizlar(r.yildiz, true)}
        ${r.odul ? `<div class="bm-sonuc-odul"><span class="bm-odul"><i>₺</i>${akce(r.odul.akce)}</span>${r.odul.esya ? `<span class="bm-odul"><i>${esc(r.odul.esya.ikon)}</i>${r.odul.esya.adet} ${esc(r.odul.esya.ad)}</span>` : ''}</div>`
          : `<p class="bm-kucuk">${r.gunlukDoldu ? 'Bugünkü ödüllü bölümler bitti; yarın yine ödül var.' : ''}</p>`}
        <button type="button" class="bm-b ana" data-bm="menu">Sonraki bölüm</button><button type="button" class="bm-b" data-bm="kapat">Çiftliğe dön</button></div>`;
    } else {
      // Ağ hatasında bağlantı uyarısı; sunucu reddettiyse (ör. AZ_HAMLE, SURE) sunucunun iletisi
      const neden = !kazandi ? 'Az kaldı! Kaybetmenin cezası yok, yeniden dene.' : !hata || hata.kod === 'AG_YOK' ? 'Bağlantıyı denetleyip yeniden dene.' : hata.message;
      perde.innerHTML = `<div class="bm-sonuc-kutu"><div class="bm-sonuc-bas">${kazandi ? 'Kaydedilemedi' : 'Hamleler bitti'}</div>
        <p class="bm-kucuk">${esc(neden)}</p>
        <button type="button" class="bm-b ana" data-bm="menu">Yeniden dene</button><button type="button" class="bm-b" data-bm="kapat">Çiftliğe dön</button></div>`;
    }
    el.querySelector('.bm-kutu').appendChild(perde);
  }

  menu();
}

// ---------- Oyun tahtası
function tahtaKur(el, { oyunId, bolum: b }, { ust, bitti }) {
  const S = b.satir, C = b.sutun, K = b.turler.length;
  const hedef = b.hedefler.map((h) => ({ ...h, kalan: h.adet }));
  const ot = Array.from({ length: S }, () => Array(C).fill(0));
  for (const [s, c, k] of b.ot) ot[s][c] = k;
  let kalanHamle = b.hamle, kullanilan = 0, mesgul = false, bitti_ = false, sayac = 0;
  const izgara = Array.from({ length: S }, () => Array(C).fill(null));
  const rasgeleTur = () => Math.floor(Math.random() * K);
  const yeniTas = (tur = rasgeleTur(), ozel = null) => ({ id: ++sayac, tur, ozel });

  el.querySelector('.bm-kutu').innerHTML = `${ust(`Bölüm ${b.seviye}`)}
    <div class="bm-durum"><div class="bm-hamle"><b>${kalanHamle}</b><small>hamle</small></div><div class="bm-hedefler oyun">${hedef.map((h, i) => `<span class="bm-hedef-k" data-h="${i}">${hedefIkon(h.tur)}<b>${h.kalan}</b></span>`).join('')}</div></div>
    <div class="bm-tahta-kap"><div class="bm-tahta" style="--s:${S};--c:${C}"></div></div>
    <p class="bm-ipucu">Taşı komşusuna doğru kaydır</p>`;
  const tahta = el.querySelector('.bm-tahta');
  const hamleEl = el.querySelector('.bm-hamle b');
  // Kare boyu: pencere genişliği ve yüksekliğine sığacak biçimde
  const boyut = () => Math.floor(Math.min((Math.min(window.innerWidth, 520) - 28) / C, (window.innerHeight - 250) / S, 64));
  let H = boyut();
  const elemanlar = new Map();
  const zeminler = [];
  function zeminCiz() {
    tahta.style.width = `${C * H}px`; tahta.style.height = `${S * H}px`; tahta.style.setProperty('--h', `${H}px`);
    zeminler.forEach((z) => z.remove()); zeminler.length = 0;
    for (let s = 0; s < S; s++) for (let c = 0; c < C; c++) {
      const z = document.createElement('div');
      z.className = `bm-kare${(s + c) % 2 ? ' koyu' : ''}`;
      z.style.transform = `translate(${c * H}px, ${s * H}px)`;
      z.dataset.k = `${s},${c}`;
      if (ot[s][c]) { z.classList.add(`ot${ot[s][c]}`); z.innerHTML = svg(OT_IKON); }
      tahta.appendChild(z); zeminler.push(z);
    }
  }
  const otGuncelle = (s, c) => { const z = zeminler[s * C + c]; z.classList.remove('ot1', 'ot2'); if (ot[s][c]) z.classList.add(`ot${ot[s][c]}`); else z.innerHTML = ''; };
  function tasEl(t) {
    let e = elemanlar.get(t.id);
    if (!e) {
      e = document.createElement('div');
      e.className = 'bm-tas';
      tahta.appendChild(e); elemanlar.set(t.id, e);
    }
    e.className = `bm-tas t-${b.turler[t.tur]}${t.ozel ? ` oz-${t.ozel}` : ''}`;
    e.innerHTML = svg(MOTIF[b.turler[t.tur]]) + (t.ozel ? '<i class="bm-oz"></i>' : '');
    return e;
  }
  const yerlestir = (t, s, c) => { tasEl(t).style.transform = `translate(${c * H}px, ${s * H}px)`; };
  function hepsiniCiz() { for (let s = 0; s < S; s++) for (let c = 0; c < C; c++) if (izgara[s][c]) yerlestir(izgara[s][c], s, c); }

  // ---------- Eşleşme bulma
  function kosular() {
    const sonuc = [];
    for (let s = 0; s < S; s++) for (let c = 0; c < C;) {
      const t = izgara[s][c]; let n = 1;
      while (t && c + n < C && izgara[s][c + n]?.tur === t.tur) n++;
      if (t && n >= 3) sonuc.push({ yon: 'Y', hucreler: Array.from({ length: n }, (_, i) => [s, c + i]) });
      c += n;
    }
    for (let c = 0; c < C; c++) for (let s = 0; s < S;) {
      const t = izgara[s][c]; let n = 1;
      while (t && s + n < S && izgara[s + n][c]?.tur === t.tur) n++;
      if (t && n >= 3) sonuc.push({ yon: 'D', hucreler: Array.from({ length: n }, (_, i) => [s + i, c]) });
      s += n;
    }
    return sonuc;
  }
  function olasiHamleVar() {
    const dene = (s1, c1, s2, c2) => {
      [izgara[s1][c1], izgara[s2][c2]] = [izgara[s2][c2], izgara[s1][c1]];
      const var_ = kosular().length > 0;
      [izgara[s1][c1], izgara[s2][c2]] = [izgara[s2][c2], izgara[s1][c1]];
      return var_;
    };
    for (let s = 0; s < S; s++) for (let c = 0; c < C; c++) {
      if (izgara[s][c]?.ozel === 'rozet') return true;
      if (c + 1 < C && dene(s, c, s, c + 1)) return true;
      if (s + 1 < S && dene(s, c, s + 1, c)) return true;
    }
    return false;
  }
  // Başlangıç tahtası: hazır eşleşme yok, en az bir hamle var
  function doldur() {
    do {
      for (let s = 0; s < S; s++) for (let c = 0; c < C; c++) {
        let tur;
        do tur = rasgeleTur();
        while ((c >= 2 && izgara[s][c - 1]?.tur === tur && izgara[s][c - 2]?.tur === tur) || (s >= 2 && izgara[s - 1][c]?.tur === tur && izgara[s - 2][c]?.tur === tur));
        const eski = izgara[s][c];
        izgara[s][c] = eski ? Object.assign(eski, { tur, ozel: null }) : yeniTas(tur);
      }
    } while (!olasiHamleVar());
  }

  // ---------- Patlatma: özel taşlar zincirleme etki eder
  function hedefSay(tur, n = 1) {
    const h = hedef.find((x) => x.tur === tur && x.kalan > 0);
    if (!h) return;
    h.kalan = Math.max(0, h.kalan - n);
    const k = el.querySelector(`[data-h="${hedef.indexOf(h)}"]`);
    if (k) { k.querySelector('b').textContent = h.kalan || '✓'; k.classList.toggle('tamam', !h.kalan); k.classList.remove('sek'); void k.offsetWidth; k.classList.add('sek'); }
  }
  async function patlat(kume, koru = new Map(), zincir = 0) {
    // kume: "s,c" kümesi; koru: yerinde özel taşa dönüşecek hücreler (s,c → {tur, ozel})
    const kuyruk = [...kume], islenen = new Set();
    while (kuyruk.length) {
      const k = kuyruk.pop();
      if (islenen.has(k)) continue;
      islenen.add(k);
      const [s, c] = k.split(',').map(Number), t = izgara[s]?.[c];
      if (!t || koru.has(k)) continue;
      const ek = [];
      if (t.ozel === 'yatay') for (let i = 0; i < C; i++) ek.push(`${s},${i}`);
      if (t.ozel === 'dikey') for (let i = 0; i < S; i++) ek.push(`${i},${c}`);
      if (t.ozel === 'bohca') for (let a = -1; a <= 1; a++) for (let d = -1; d <= 1; d++) if (izgara[s + a]?.[c + d]) ek.push(`${s + a},${c + d}`);
      if (t.ozel === 'rozet') for (let a = 0; a < S; a++) for (let d = 0; d < C; d++) if (izgara[a][d]?.tur === t.tur) ek.push(`${a},${d}`);
      kuyruk.push(...ek);
    }
    for (const k of islenen) {
      const [s, c] = k.split(',').map(Number), t = izgara[s]?.[c];
      if (ot[s][c] && t) { ot[s][c]--; otGuncelle(s, c); hedefSay('OT'); }
      if (!t) continue;
      if (koru.has(k)) { Object.assign(t, koru.get(k)); tasEl(t).classList.add('dogdu'); continue; }
      hedefSay(b.turler[t.tur]);
      const e = elemanlar.get(t.id);
      e?.classList.add('patla');
      setTimeout(() => { e?.remove(); }, 260);
      elemanlar.delete(t.id);
      izgara[s][c] = null;
    }
    ses(koru.size ? 'ozel' : 'esles', zincir);   // zincirde perde yükselir
    await uyu(230);
  }
  // Yerçekimi: taşlar aşağı düşer, üstten yeni taş gelir
  async function dusur() {
    for (let c = 0; c < C; c++) {
      let yaz = S - 1;
      for (let s = S - 1; s >= 0; s--) if (izgara[s][c]) { const t = izgara[s][c]; izgara[s][c] = null; izgara[yaz][c] = t; yaz--; }
      for (let s = yaz, i = 1; s >= 0; s--, i++) {
        const t = yeniTas(); izgara[s][c] = t;
        const e = tasEl(t); e.style.transition = 'none'; e.style.transform = `translate(${c * H}px, ${-i * H}px)`;
      }
    }
    void tahta.offsetWidth;
    for (const e of elemanlar.values()) e.style.transition = '';
    hepsiniCiz();
    await uyu(260);
  }
  // Eşleşmeleri çöz; oyuncunun hamlesiyle oluşanlarda özel taş hamlenin yapıldığı karede doğar
  async function coz(hamleKareleri = []) {
    for (let tur = 0; ; tur++) {
      const k = kosular();
      if (!k.length) break;
      const kume = new Set(), koru = new Map(), sayim = new Map();
      for (const x of k) for (const [s, c] of x.hucreler) { const a = `${s},${c}`; kume.add(a); sayim.set(a, (sayim.get(a) || 0) + 1); }
      for (const x of k) {
        const anahtarlar = x.hucreler.map(([s, c]) => `${s},${c}`);
        const tercih = (tur === 0 && anahtarlar.find((a) => hamleKareleri.includes(a))) || anahtarlar[Math.floor(anahtarlar.length / 2)];
        const [s, c] = tercih.split(',').map(Number), t = izgara[s][c];
        const kesisim = anahtarlar.find((a) => sayim.get(a) > 1);
        if (x.hucreler.length >= 5) koru.set(tercih, { tur: t.tur, ozel: 'rozet' });
        else if (kesisim && !koru.has(kesisim)) { const [a, d] = kesisim.split(',').map(Number); koru.set(kesisim, { tur: izgara[a][d].tur, ozel: 'bohca' }); }
        else if (x.hucreler.length === 4) koru.set(tercih, { tur: t.tur, ozel: x.yon === 'Y' ? 'dikey' : 'yatay' });
      }
      // Korunan karede zaten özel taş varsa önce onun etkisi çalışsın
      for (const [a] of koru) { const [s, c] = a.split(',').map(Number); if (izgara[s][c]?.ozel) koru.delete(a); }
      await patlat(kume, koru, tur);
      await dusur();
      if (hedefTamam()) return;
    }
  }
  const hedefTamam = () => hedef.every((h) => h.kalan <= 0);

  async function takas(s1, c1, s2, c2) {
    if (mesgul || bitti_) return;
    if (s2 < 0 || s2 >= S || c2 < 0 || c2 >= C) return;
    mesgul = true;
    const a = izgara[s1][c1], d = izgara[s2][c2];
    izgara[s1][c1] = d; izgara[s2][c2] = a;
    yerlestir(a, s2, c2); yerlestir(d, s1, c1);
    await uyu(190);
    let gecerli = false;
    if (a.ozel === 'rozet' || d.ozel === 'rozet') {
      // Rozet: değdiği motifin hepsini toplar; iki rozet bütün tahtayı temizler
      gecerli = true;
      const kume = new Set();
      const [roz, diger, rs, rc] = a.ozel === 'rozet' ? [a, d, s2, c2] : [d, a, s1, c1];
      if (diger.ozel === 'rozet') for (let s = 0; s < S; s++) for (let c = 0; c < C; c++) kume.add(`${s},${c}`);
      else for (let s = 0; s < S; s++) for (let c = 0; c < C; c++) if (izgara[s][c]?.tur === diger.tur) kume.add(`${s},${c}`);
      roz.ozel = null; kume.add(`${rs},${rc}`);
      hamleSay();
      await patlat(kume); await dusur(); await coz();
    } else if (a.ozel && d.ozel) {
      gecerli = true; hamleSay();
      await patlat(new Set([`${s1},${c1}`, `${s2},${c2}`])); await dusur(); await coz();
    } else if (kosular().length) {
      gecerli = true; hamleSay();
      await coz([`${s1},${c1}`, `${s2},${c2}`]);
    }
    if (!gecerli) {
      izgara[s1][c1] = a; izgara[s2][c2] = d;
      yerlestir(a, s1, c1); yerlestir(d, s2, c2);
      tasEl(a).classList.add('salla'); setTimeout(() => elemanlar.get(a.id)?.classList.remove('salla'), 300);
      await uyu(190);
    }
    mesgul = false;
    if (!gecerli) return;
    if (hedefTamam()) return bitir(true);
    if (kalanHamle <= 0) return bitir(false);
    if (!olasiHamleVar()) { mesgul = true; await uyu(250); karistir(); mesgul = false; }
  }
  function hamleSay() { kalanHamle--; kullanilan++; hamleEl.textContent = kalanHamle; hamleEl.parentElement.classList.toggle('az', kalanHamle <= 3); }
  function karistir() {
    tost('🔀 Hamle kalmadı, taşlar karıştı');
    doldur(); hepsiniCiz();
  }
  async function bitir(kazandi) {
    if (bitti_) return;
    bitti_ = true; api_.bitti = true; mesgul = true;
    if (kazandi) { ses('kazandi'); tahta.classList.add('kutla'); await uyu(450); } else ses('kaybetti');
    bitti(kazandi, kullanilan);
  }

  // ---------- Dokunma: kaydırma ya da iki dokunuş
  let basla = null, secili = null;
  const kare = (e) => { const r = tahta.getBoundingClientRect(); return [Math.floor((e.clientY - r.top) / H), Math.floor((e.clientX - r.left) / H)]; };
  const secimGoster = (k) => { tahta.querySelectorAll('.bm-tas.secili').forEach((x) => x.classList.remove('secili')); if (k) elemanlar.get(izgara[k[0]][k[1]]?.id)?.classList.add('secili'); };
  tahta.addEventListener('pointerdown', (e) => {
    if (mesgul || bitti_) return;
    const [s, c] = kare(e);
    if (s < 0 || s >= S || c < 0 || c >= C) return;
    tahta.setPointerCapture?.(e.pointerId);
    basla = { s, c, x: e.clientX, y: e.clientY };
  });
  tahta.addEventListener('pointermove', (e) => {
    if (!basla) return;
    const dx = e.clientX - basla.x, dy = e.clientY - basla.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < H * 0.4) return;
    const [s2, c2] = Math.abs(dx) > Math.abs(dy) ? [basla.s, basla.c + Math.sign(dx)] : [basla.s + Math.sign(dy), basla.c];
    const { s, c } = basla; basla = null; secili = null; secimGoster(null);
    takas(s, c, s2, c2);
  });
  tahta.addEventListener('pointerup', () => {
    if (!basla) return;
    const { s, c } = basla; basla = null;
    if (secili && Math.abs(secili[0] - s) + Math.abs(secili[1] - c) === 1) { const [a, d] = secili; secili = null; secimGoster(null); return takas(a, d, s, c); }
    secili = secili && secili[0] === s && secili[1] === c ? null : [s, c];
    secimGoster(secili);
  });
  tahta.addEventListener('pointercancel', () => { basla = null; });
  const boyutla = () => { const yeni = boyut(); if (yeni === H) return; H = yeni; zeminCiz(); hepsiniCiz(); };
  window.addEventListener('resize', boyutla);

  zeminCiz(); doldur();
  // Açılışta taşlar yukarıdan dökülür
  for (let s = 0; s < S; s++) for (let c = 0; c < C; c++) { const e = tasEl(izgara[s][c]); e.style.transition = 'none'; e.style.transform = `translate(${c * H}px, ${(s - S - 1) * H}px)`; }
  void tahta.offsetWidth;
  for (const e of elemanlar.values()) e.style.transition = '';
  requestAnimationFrame(hepsiniCiz);

  const api_ = { id: oyunId, bitti: false, durdur: () => window.removeEventListener('resize', boyutla) };
  return api_;
}
