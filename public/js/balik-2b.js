// Balık tutma mini oyununun 2B yedeği (WebGL olmayan cihazlar; ana oyun balik-ui.js + balik3d.js): olta atışı, su altında dolaşan balıklar, yalancı vuruşlar, ısırma,
// oltaya takma ve makara mücadelesi (gerginlik yeşil bölgede kalmalı), balığın sudan sıçrayarak çıkışı.
// Isırma anını, oltaya takılmayı, türü ve ağırlığı sunucu belirler; mücadele burada oynanır, sunucu en kısa süreyi denetler.
import { esc, akce } from './yardimci.js';
import { emojiCiz } from './emoji.js';

const W = 640, H = 360, SU = 150;                 // mantıksal tuval boyutu ve su yüzeyi
const KANCA_DERINLIK = 92;
const TUR_RENK = {
  HAMSI: ['#3f6f95', '#d4e4ee'], LUFER: ['#45666f', '#c9d7d0'], CIPURA: ['#8d98a2', '#efeadc'], LEVREK: ['#56707a', '#dfe5e6'],
  SAZAN: ['#8a6a2e', '#e8cf8f'], ALABALIK: ['#62794a', '#f2c8b6'], INCI_KEFALI: ['#7b8e9b', '#eef3f6'], ALTIN_BALIK: ['#e39a12', '#ffe27a'],
};
const hareketAz = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const sinirla = (v, a, b) => Math.max(a, Math.min(b, v));
const yumusak = (t) => t * t * (3 - 2 * t);

// ---------- Çizim yardımcıları
function balikCiz(g, x, y, boy, yon, renk, t, { golge = false, isilti = false } = {}) {
  g.save();
  g.translate(x, y);
  g.scale(yon, 1);
  const k = Math.sin(t * 13) * boy * 0.16;
  g.fillStyle = golge ? 'rgba(8,32,52,.42)' : renk[0];
  g.beginPath(); g.moveTo(-boy * 0.42, 0); g.quadraticCurveTo(-boy * 0.62, k * 0.5, -boy * 0.82, -boy * 0.3 + k); g.lineTo(-boy * 0.72, k * 0.6); g.lineTo(-boy * 0.82, boy * 0.3 + k); g.closePath(); g.fill();
  g.beginPath(); g.ellipse(0, 0, boy * 0.56, boy * 0.24, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.moveTo(-boy * 0.15, -boy * 0.2); g.quadraticCurveTo(boy * 0.02, -boy * 0.42, boy * 0.18, -boy * 0.2); g.fill();
  if (!golge) {
    g.fillStyle = renk[1];
    g.beginPath(); g.ellipse(boy * 0.06, boy * 0.09, boy * 0.44, boy * 0.11, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(boy * 0.28, -boy * 0.17); g.quadraticCurveTo(boy * 0.22, 0, boy * 0.28, boy * 0.17); g.stroke();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(boy * 0.38, -boy * 0.05, boy * 0.065, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#111'; g.beginPath(); g.arc(boy * 0.4, -boy * 0.05, boy * 0.035, 0, Math.PI * 2); g.fill();
    if (isilti) {
      g.fillStyle = 'rgba(255,255,220,.9)';
      for (let i = 0; i < 4; i++) { const a = t * 3 + i * 1.6; g.beginPath(); g.arc(Math.cos(a) * boy * 0.5, Math.sin(a * 1.3) * boy * 0.3, 1.6, 0, Math.PI * 2); g.fill(); }
    }
  }
  g.restore();
}
function bulut(g, x, y, s) {
  g.fillStyle = 'rgba(255,255,255,.92)';
  for (const [dx, dy, r] of [[0, 0, 18], [20, -8, 22], [42, 0, 17], [22, 6, 16]]) { g.beginPath(); g.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2); g.fill(); }
}

export function balikOyunu2B(kap, { api, sonuc, ses }) {
  kap.innerHTML = `<div class="balik-oyun">
    <div class="balik-sahne"><canvas aria-label="Balık tutma sahnesi"></canvas><div class="balik-kart" hidden></div></div>
    <p class="balik-yazi" aria-live="polite">Olta atılıyor…</p>
    <div class="satir balik-dugmeler"><button type="button" class="dugme altin genis" data-balik="cek" disabled>🎣 Çek!</button></div>
    <p class="kucuk balik-ipucu">Şamandıra suya gömülünce hemen <b>Çek!</b> (ya da boşluk). Yalancı vuruşlara aldanma: erken çekersen balık kaçar.</p></div>`;
  const tuval = kap.querySelector('canvas'), g = tuval.getContext('2d');
  const yazi = kap.querySelector('.balik-yazi'), dugme = kap.querySelector('[data-balik]'), ipucu = kap.querySelector('.balik-ipucu');
  const kart = kap.querySelector('.balik-kart');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  tuval.width = W * dpr; tuval.height = H * dpr;
  const az = hareketAz();

  // Oyun durumu
  let durum = 'atiliyor', atis = null, tip = 'ic', sonKonum = null, kare = 0, onceki = 0, zamanlayici = 0;
  let isirmaAn = 0, isirmaBitis = 0, atisAn = 0, yalancilar = [];
  let gerginlik = 0, ilerleme = 0, tutuyor = false, gevsekSure = 0, firtlama = 0, firtlamaGuc = 0, sonrakiFirtlama = 0, sarmaTik = 0;
  let mucadele = null, cikis = null, sonucBalik = null, sarsinti = 0;
  const parcaciklar = [], halkalar = [];
  const hedefX = W * 0.4;
  const cevre = Array.from({ length: 4 }, (_, i) => ({ x: Math.random() * W, y: SU + 60 + i * 38, h: (14 + Math.random() * 10) * (Math.random() < 0.5 ? -1 : 1), boy: 22 + Math.random() * 16, faz: Math.random() * 6 }));
  const kabarcik = Array.from({ length: 14 }, () => ({ x: Math.random() * W, y: SU + Math.random() * (H - SU), h: 12 + Math.random() * 20 }));
  const yosun = Array.from({ length: 9 }, (_, i) => ({ x: 20 + i * 70 + Math.random() * 30, boy: 40 + Math.random() * 45, faz: Math.random() * 6 }));

  const sicrat = (x, y, adet, guc = 1, renk = 'rgba(220,240,255,.95)') => {
    for (let i = 0; i < adet; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      parcaciklar.push({ x, y, vx: Math.cos(a) * (60 + Math.random() * 140) * guc, vy: Math.sin(a) * (90 + Math.random() * 160) * guc, omur: 0.7 + Math.random() * 0.5, yas: 0, r: 1.5 + Math.random() * 2.5, renk });
    }
  };
  const halka = (x, y, buyuk = false) => halkalar.push({ x, y, yas: 0, omur: buyuk ? 1.4 : 0.9, r: buyuk ? 34 : 18 });

  // ---------- Sahne
  function sahne(t) {
    const gok = g.createLinearGradient(0, 0, 0, SU);
    gok.addColorStop(0, '#6fb7e8'); gok.addColorStop(1, '#d9eef8');
    g.fillStyle = gok; g.fillRect(0, 0, W, SU);
    g.fillStyle = 'rgba(255,240,180,.55)'; g.beginPath(); g.arc(510, 46, 34, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff6cf'; g.beginPath(); g.arc(510, 46, 22, 0, Math.PI * 2); g.fill();
    for (const [x0, y, s, h] of [[60, 40, 1, 6], [300, 26, 0.8, 4], [620, 62, 0.9, 5]]) bulut(g, ((x0 + t * h) % (W + 140)) - 70, y, s);
    if (tip === 'deniz') {
      g.fillStyle = '#7fa7b8'; g.beginPath(); g.moveTo(40, SU); g.quadraticCurveTo(120, SU - 26, 210, SU); g.fill();
      const yx = ((t * 8) % (W + 100)) - 50, yy = SU - 4 + Math.sin(t * 1.5) * 1.5;
      g.fillStyle = '#7a4a28'; g.fillRect(yx - 14, yy - 4, 28, 5);
      g.fillStyle = '#fff'; g.beginPath(); g.moveTo(yx, yy - 4); g.lineTo(yx, yy - 30); g.lineTo(yx + 16, yy - 6); g.closePath(); g.fill();
      g.strokeStyle = '#333'; g.lineWidth = 1.4;
      for (const [x0, y0, f] of [[150, 70, 0], [380, 52, 2]]) { const x = (x0 + t * 22) % (W + 40), y = y0 + Math.sin(t * 2 + f) * 4, k = Math.sin(t * 9 + f) * 3; g.beginPath(); g.moveTo(x - 8, y + k); g.quadraticCurveTo(x - 4, y - 4, x, y); g.quadraticCurveTo(x + 4, y - 4, x + 8, y + k); g.stroke(); }
    } else {
      g.fillStyle = '#8fbf6a'; g.beginPath(); g.moveTo(0, SU); g.quadraticCurveTo(140, SU - 70, 300, SU); g.quadraticCurveTo(470, SU - 55, W, SU - 10); g.lineTo(W, SU); g.fill();
      g.fillStyle = '#6fa553'; g.beginPath(); g.moveTo(0, SU); g.quadraticCurveTo(90, SU - 30, 210, SU); g.fill();
      for (const [x, y, r] of [[60, SU - 26, 14], [84, SU - 20, 11], [420, SU - 36, 13], [446, SU - 30, 10], [560, SU - 26, 12]]) {
        g.fillStyle = '#6b4a2b'; g.fillRect(x - 2, y, 4, 12); g.fillStyle = '#3f7d3a'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      }
    }
    // Su gövdesi ve su altı
    const su = g.createLinearGradient(0, SU, 0, H);
    su.addColorStop(0, tip === 'deniz' ? '#2f8fc2' : '#3c8f9e'); su.addColorStop(1, tip === 'deniz' ? '#0b3456' : '#123f3f');
    g.fillStyle = su; g.fillRect(0, SU, W, H - SU);
    g.save(); g.globalAlpha = 0.09; g.fillStyle = '#fff';
    for (let i = 0; i < 5; i++) { const x = 60 + i * 130 + Math.sin(t * 0.6 + i) * 20; g.beginPath(); g.moveTo(x, SU); g.lineTo(x + 40, SU); g.lineTo(x + 90, H); g.lineTo(x + 20, H); g.fill(); }
    g.restore();
    g.strokeStyle = tip === 'deniz' ? '#2f7a4a' : '#3d7a30'; g.lineWidth = 4; g.lineCap = 'round';
    for (const y of yosun) { const s = Math.sin(t * 1.4 + y.faz) * 10; g.beginPath(); g.moveTo(y.x, H); g.quadraticCurveTo(y.x + s, H - y.boy * 0.6, y.x + s * 1.6, H - y.boy); g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,.35)';
    for (const k of kabarcik) { k.y -= k.h * (1 / 60); if (k.y < SU + 4) { k.y = H; k.x = Math.random() * W; } g.beginPath(); g.arc(k.x + Math.sin(k.y * 0.08) * 3, k.y, 1.8, 0, Math.PI * 2); g.fill(); }
    for (const c of cevre) {
      c.x += c.h * (1 / 60); if (c.x < -40) c.x = W + 40; if (c.x > W + 40) c.x = -40;
      balikCiz(g, c.x, c.y + Math.sin(t * 1.2 + c.faz) * 6, c.boy, Math.sign(c.h), null, t + c.faz, { golge: true });
    }
    // Yüzey: dalga çizgileri ve güneş parıltısı
    g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2;
    for (let i = 0; i < 12; i++) { const y = SU + 6 + (i % 4) * 9, x = ((t * 26 + i * 83) % (W + 60)) - 30; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 12, y - 3, x + 24, y); g.stroke(); }
    g.fillStyle = 'rgba(255,250,210,.8)';
    for (let i = 0; i < 10; i++) { if (Math.sin(t * 4 + i * 2.1) > 0.6) { g.beginPath(); g.arc(470 + i * 11 + Math.sin(i) * 20, SU + 8 + (i % 3) * 6, 1.6, 0, Math.PI * 2); g.fill(); } }
    g.fillStyle = 'rgba(255,255,255,.4)'; g.fillRect(0, SU, W, 2);
  }
  function iskele() {
    g.fillStyle = '#6b4325';
    for (const x of [W - 230, W - 120]) g.fillRect(x, H - 64, 12, 64);
    for (let i = 0; i < 4; i++) {
      g.fillStyle = i % 2 ? '#b27843' : '#a66d3a';
      g.fillRect(W - 260 + i * 6, H - 70 + i * 10, 270, 10);
    }
    g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(W - 260, H - 30, 270, 30);
    // Kova
    g.fillStyle = '#7b8a93'; g.beginPath(); g.moveTo(W - 210, H - 74); g.lineTo(W - 176, H - 74); g.lineTo(W - 180, H - 46); g.lineTo(W - 206, H - 46); g.closePath(); g.fill();
    g.strokeStyle = '#5c6870'; g.lineWidth = 2; g.beginPath(); g.arc(W - 193, H - 74, 16, Math.PI, 0); g.stroke();
  }

  // Olta: sapı sağ altta; ucun konumu gerginlikle eğilir
  const sap = { x: W - 52, y: H + 6 };
  function oltaUcu() {
    const egil = durum === 'mucadele' ? gerginlik : durum === 'isirdi' ? 0.25 : 0;
    const a = -2.05 + egil * 0.55, L = 250;
    return { x: sap.x + Math.cos(a) * L, y: sap.y + Math.sin(a) * L + egil * 30, a, egil };
  }
  function olta(uc) {
    const ox = (sap.x + uc.x) / 2 + uc.egil * 40, oy = (sap.y + uc.y) / 2 + uc.egil * 22;
    g.strokeStyle = '#3b2412'; g.lineWidth = 7; g.lineCap = 'round';
    g.beginPath(); g.moveTo(sap.x, sap.y); g.quadraticCurveTo(ox, oy, uc.x, uc.y); g.stroke();
    g.strokeStyle = '#c8962e'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(sap.x, sap.y); g.quadraticCurveTo(ox, oy, uc.x, uc.y); g.stroke();
    g.fillStyle = '#2b2b2b'; g.beginPath(); g.arc(sap.x - 26, sap.y - 52, 11, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#999'; g.lineWidth = 2; g.beginPath(); const m = performance.now() / (tutuyor ? 60 : 400); g.moveTo(sap.x - 26, sap.y - 52); g.lineTo(sap.x - 26 + Math.cos(m) * 9, sap.y - 52 + Math.sin(m) * 9); g.stroke();
  }

  // ---------- Şamandıra, kanca ve hedef balık
  function samandiraKonumu(t, an) {
    if (durum === 'atiliyor') {
      const p = sinirla((an - atisAn) / 900, 0, 1), uc = oltaUcu();
      return { x: uc.x + (hedefX - uc.x) * p, y: uc.y + (SU - uc.y) * p - Math.sin(p * Math.PI) * 120, havada: p < 1 };
    }
    let y = SU + Math.sin(t * 2.4) * 2.5;
    for (const v of yalancilar) { const d = an - v; if (d > 0 && d < 280) y += Math.sin((d / 280) * Math.PI) * 6; }
    if (durum === 'isirdi') y = SU + 12 + Math.sin(t * 40) * 3;
    return { x: hedefX, y, havada: false };
  }
  function hedefBalik(t, an) {
    // Isırmadan ~3 sn önce bir balık kancaya yaklaşır, etrafında döner; ısırınca kancadadır
    const kalan = isirmaAn - an;
    if (durum === 'bekliyor' && kalan < 3200) {
      const p = yumusak(sinirla(1 - kalan / 3200, 0, 1));
      const bas = hedefX - 220;
      return { x: bas + (hedefX - 26 - bas) * p + Math.sin(t * 3) * 8 * p, y: SU + KANCA_DERINLIK + 18 - p * 14 + Math.sin(t * 2) * 5, yon: 1 };
    }
    if (durum === 'isirdi' || durum === 'cekiliyor') return { x: hedefX - 18 + Math.sin(t * 30) * 3, y: SU + KANCA_DERINLIK + 4, yon: 1 };
    return null;
  }

  // ---------- Mücadele simülasyonu
  function mucadeleAdim(dt, an) {
    const m = mucadele, guc = m.guc;
    if (an > sonrakiFirtlama) {
      firtlama = 0.35 + Math.random() * 0.55; firtlamaGuc = 0.45 + guc * 0.12 + Math.random() * 0.2;
      sonrakiFirtlama = an + (2600 - guc * 260) * (0.6 + Math.random() * 0.8);
      sicrat(m.fx, SU, 8, 0.6); halka(m.fx, SU);
    }
    const cekis = firtlama > 0 ? firtlamaGuc : 0.12 + guc * 0.05;
    firtlama = Math.max(0, firtlama - dt);
    const hedef = tutuyor ? 0.32 + cekis * 0.75 : cekis * 0.3;
    gerginlik += (hedef - gerginlik) * Math.min(1, dt * (tutuyor ? 3.2 : 2.4));
    gerginlik = sinirla(gerginlik + (firtlama > 0 && tutuyor ? dt * 0.35 : 0), 0, 1.05);
    const hiz = 0.21 - guc * 0.024;
    if (tutuyor && gerginlik < 0.86) ilerleme += hiz * dt * (firtlama > 0 ? 0.3 : 1);
    if (!tutuyor) ilerleme -= (0.02 + guc * 0.012) * dt;
    // Sunucunun en kısa mücadele süresinden önce balık çıkmaz
    const sure = an - m.bas;
    ilerleme = sinirla(ilerleme, 0, sure < m.minMs + 120 ? 0.96 : 1);
    gevsekSure = gerginlik < 0.12 ? gevsekSure + dt : 0;
    if (gerginlik >= 1) return bitir('koptu');
    if (gevsekSure > 2.4 && sure > 1500) return bitir('kacti');
    if (sure > m.maksMs - 500) return bitir('kacti');
    if (ilerleme >= 1) return cikar();
    // Balık konumu: ilerledikçe iskeleye yaklaşır, fırtlamada uzağa atılır
    const hedefFx = hedefX + (W - 250 - hedefX) * ilerleme + Math.sin(an / 520) * 40 - (firtlama > 0 ? 50 : 0);
    m.fx += (hedefFx - m.fx) * Math.min(1, dt * 3);
    m.fy = SU + 40 + (1 - ilerleme) * 70 + Math.sin(an / 300) * 8;
    m.yon = hedefFx < m.fx ? -1 : 1;
    if (tutuyor && an > sarmaTik) { ses('makara'); sarmaTik = an + 95; }
    if (gerginlik > 0.8 && !az) sarsinti = Math.max(sarsinti, (gerginlik - 0.8) * 8);
    if (gerginlik > 0.7 && Math.random() < dt * 25) sicrat(m.fx, SU, 1, 0.4);
  }
  function hud() {
    // Gerginlik göstergesi (sağda dikey)
    const x = W - 26, y0 = 54, h = 190;
    g.fillStyle = 'rgba(30,20,10,.55)'; g.beginPath(); g.roundRect(x - 9, y0 - 8, 18, h + 16, 9); g.fill();
    const bolge = (a, b, renk) => { g.fillStyle = renk; g.fillRect(x - 5, y0 + h * (1 - b), 10, h * (b - a)); };
    bolge(0, 0.12, '#8aa0b2'); bolge(0.12, 0.86, '#56b45a'); bolge(0.86, 1, '#e0453a');
    const iy = y0 + h * (1 - Math.min(1, gerginlik));
    g.fillStyle = '#fff'; g.strokeStyle = '#3b2412'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x - 14, iy); g.lineTo(x - 6, iy - 6); g.lineTo(x - 6, iy + 6); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#fff'; g.font = 'bold 10px system-ui, sans-serif'; g.textAlign = 'center';
    g.fillText('GERGİN', x, y0 - 14);
    // Mesafe çubuğu (üstte)
    const bx = 160, bw = 320, by = 18;
    g.fillStyle = 'rgba(30,20,10,.55)'; g.beginPath(); g.roundRect(bx - 10, by - 9, bw + 20, 18, 9); g.fill();
    g.fillStyle = '#f2c14e'; g.beginPath(); g.roundRect(bx, by - 4, bw * ilerleme, 8, 4); g.fill();
    g.font = '16px system-ui, sans-serif'; emojiCiz(g, '🐟', bx + bw * ilerleme, by + 6, 17); emojiCiz(g, '🪣', bx + bw + 18, by + 6, 17);
  }

  // ---------- Ana döngü
  function ciz(an) {
    kare = requestAnimationFrame(ciz);
    const dt = Math.min(0.05, (an - (onceki || an)) / 1000); onceki = an;
    const t = an / 1000;
    if (durum === 'mucadele') mucadeleAdim(dt, an);
    if (durum === 'bekliyor' && an >= isirmaAn) isirdi(an);
    if (durum === 'isirdi' && an > isirmaBitis) { durum = 'bekliyor'; isirmaAn = Infinity; yazi.textContent = 'Balık yemi alıp gitti… yine de çekmeyi deneyebilirsin.'; }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (sarsinti > 0) { g.translate((Math.random() - 0.5) * sarsinti, (Math.random() - 0.5) * sarsinti); sarsinti = Math.max(0, sarsinti - dt * 20); }
    sahne(t);
    // Halkalar
    for (let i = halkalar.length - 1; i >= 0; i--) {
      const h = halkalar[i]; h.yas += dt; if (h.yas > h.omur) { halkalar.splice(i, 1); continue; }
      const p = h.yas / h.omur; g.strokeStyle = `rgba(255,255,255,${0.8 * (1 - p)})`; g.lineWidth = 2;
      g.beginPath(); g.ellipse(h.x, h.y + 2, h.r * (0.4 + p), h.r * (0.4 + p) * 0.3, 0, 0, Math.PI * 2); g.stroke();
    }
    const uc = oltaUcu();
    const hb = hedefBalik(t, an);
    if (hb) balikCiz(g, hb.x, hb.y, 34, hb.yon, null, t, { golge: true });
    if (durum === 'mucadele' || durum === 'cikiyor') {
      const m = mucadele;
      let fx = m.fx, fy = m.fy;
      if (durum === 'cikiyor') {
        const p = sinirla((an - cikis.bas) / 1100, 0, 1);
        fx = cikis.x0 + (W - 195 - cikis.x0) * p; fy = SU - Math.sin(p * Math.PI) * 120 + (H - 100 - SU) * p * p;
        if (p >= 1 && !cikis.bitti) { cikis.bitti = true; sonucGoster(); }
      }
      const renk = durum === 'cikiyor' && sonucBalik ? TUR_RENK[sonucBalik.urun] || TUR_RENK.SAZAN : null;
      const boy = durum === 'cikiyor' && sonucBalik ? 30 + Math.min(40, sonucBalik.agirlik * 9) : 30 + m.guc * 6;
      g.strokeStyle = gerginlik > 0.86 ? '#ff6b5e' : 'rgba(250,250,250,.85)'; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(uc.x, uc.y);
      if (durum === 'mucadele') { g.quadraticCurveTo((uc.x + fx) / 2, Math.min(uc.y, SU) + (1 - gerginlik) * 40, fx, SU); g.lineTo(fx + 10, fy); }
      else g.lineTo(fx, fy);
      g.stroke();
      balikCiz(g, fx, fy, boy, durum === 'cikiyor' ? 1 : m.yon, renk, t * (durum === 'mucadele' && firtlama > 0 ? 2.2 : 1),
        { golge: !renk && fy > SU, isilti: sonucBalik?.urun === 'ALTIN_BALIK' });
    } else if (durum === 'bitti' && sonucBalik) {
      // Tutulan balık iskelede çırpınır
      const renk = TUR_RENK[sonucBalik.urun] || TUR_RENK.SAZAN, boy = 30 + Math.min(40, sonucBalik.agirlik * 9);
      g.save(); g.translate(W - 195, H - 92); g.rotate(Math.sin(t * 9) * 0.15);
      balikCiz(g, 0, 0, boy, 1, renk, t * 0.6, { isilti: sonucBalik.urun === 'ALTIN_BALIK' }); g.restore();
    } else if (!(durum === 'bitti' && mucadele)) {   // mücadele kaybedildiyse misina kopmuş ya da balık götürmüştür: şamandıra yok
      const s = samandiraKonumu(t, an);
      g.strokeStyle = 'rgba(250,250,250,.85)'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(uc.x, uc.y); g.quadraticCurveTo((uc.x + s.x) / 2, Math.max(uc.y, s.y) - 20, s.x, s.y - 8); g.stroke();
      if (!s.havada && durum !== 'bitti') {
        g.strokeStyle = 'rgba(230,230,230,.5)'; g.lineWidth = 1; g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(s.x, SU + KANCA_DERINLIK); g.stroke();
        g.strokeStyle = '#ccc'; g.lineWidth = 1.6; g.beginPath(); g.arc(s.x - 3, SU + KANCA_DERINLIK, 4, 0, Math.PI); g.stroke();
        g.fillStyle = '#d0745a'; g.beginPath(); g.ellipse(s.x - 3, SU + KANCA_DERINLIK + 5, 3, 5, 0.4, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = '#e23b2e'; g.beginPath(); g.arc(s.x, s.y - 6, 8, Math.PI, 0); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(s.x, s.y - 6, 8, 0, Math.PI); g.fill();
      g.fillStyle = '#222'; g.fillRect(s.x - 1, s.y - 20, 2, 7);
      if (durum === 'isirdi') { g.font = 'bold 40px system-ui, sans-serif'; g.fillStyle = '#ffd23f'; g.strokeStyle = '#7a4a10'; g.lineWidth = 4; g.textAlign = 'center'; g.strokeText('!', s.x, s.y - 30); g.fillText('!', s.x, s.y - 30); }
    }
    iskele();
    olta(uc);
    // Parçacıklar
    for (let i = parcaciklar.length - 1; i >= 0; i--) {
      const p = parcaciklar[i]; p.yas += dt; if (p.yas > p.omur) { parcaciklar.splice(i, 1); continue; }
      p.vy += 420 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      g.fillStyle = p.renk; g.globalAlpha = 1 - p.yas / p.omur; g.beginPath(); g.arc(p.x, p.y, p.r, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
    }
    if (durum === 'mucadele') hud();
  }

  // ---------- Akış
  function dugmeAyarla(kip) {
    dugme.dataset.balik = kip;
    dugme.disabled = kip === 'bos';
    dugme.textContent = kip === 'sar' ? '🌀 Sar (basılı tut)' : kip === 'yeniden' ? '🎣 Yeniden at' : '🎣 Çek!';
    dugme.classList.toggle('sar', kip === 'sar');
  }
  async function baslat(konum) {
    clearTimeout(zamanlayici);
    durum = 'atiliyor'; atisAn = performance.now(); mucadele = null; cikis = null; sonucBalik = null; kart.hidden = true;
    gerginlik = 0; ilerleme = 0; tutuyor = false; yalancilar = []; isirmaAn = Infinity;
    dugmeAyarla('bos'); yazi.textContent = 'Olta atılıyor…';
    ipucu.innerHTML = 'Şamandıra suya gömülünce hemen <b>Çek!</b> (ya da boşluk). Yalancı vuruşlara aldanma: erken çekersen balık kaçar.';
    ses('tik');
    try { atis = await api('/api/balik/at', konum); } catch (e) { yazi.textContent = e.message; durum = 'bitti'; dugmeAyarla('yeniden'); return; }
    // Isırma anı sunucuda yanıt anına göredir; yanıt geldiği an esas alınır (sunucunun geç kalma payı erken payından geniş)
    const cevapAn = performance.now();
    tip = atis.tip;
    const kalanAtis = Math.max(0, 900 - (cevapAn - atisAn));
    zamanlayici = setTimeout(() => {
      durum = 'bekliyor'; ses('su'); sicrat(hedefX, SU, 14, 0.7); halka(hedefX, SU, true);
      const simdi = performance.now();
      isirmaAn = Math.max(simdi + 300, cevapAn + atis.isirmaMs);
      isirmaBitis = isirmaAn + atis.pencereMs + 300;
      // Isırmadan önce 1–3 yalancı vuruş
      const adet = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < adet; i++) { const v = simdi + 500 + Math.random() * Math.max(200, isirmaAn - simdi - 900); if (v < isirmaAn - 500) yalancilar.push(v); }
      dugmeAyarla('cek');
      yazi.textContent = `${tip === 'deniz' ? 'Denize' : 'Suya'} olta attın. Şamandırayı izle… (bugün ${atis.kalan} hakkın kaldı)`;
    }, kalanAtis);
  }
  function isirdi() {
    durum = 'isirdi'; isirmaBitis = performance.now() + atis.pencereMs + 300;
    ses('isirdi'); sicrat(hedefX, SU, 10, 0.6); halka(hedefX, SU, true);
    yazi.textContent = 'Isırdı! ÇEK!';
  }
  async function cek() {
    if (durum !== 'isirdi' && durum !== 'bekliyor') return;
    const once = durum;
    durum = 'cekiliyor'; dugmeAyarla('bos');
    let r;
    try { r = await api(`/api/balik/${atis.id}/cek`, {}); } catch (e) { yazi.textContent = e.message; durum = 'bitti'; dugmeAyarla('yeniden'); return; }
    if (!r.takildi) {
      durum = 'bitti'; ses('su');
      yazi.textContent = r.sebep === 'erken' ? (once === 'bekliyor' ? 'Çok erken çektin; balık ürktü ve kaçtı.' : 'Çok erken çektin; balık kaçtı.') : 'Geç kaldın; balık yemi alıp kaçtı.';
      dugmeAyarla('yeniden'); sonuc?.(r); return;
    }
    // Oltaya takıldı: mücadele
    const an = performance.now();
    mucadele = { guc: r.guc, minMs: r.minMs, maksMs: r.maksMs, bas: an, fx: hedefX - 10, fy: SU + KANCA_DERINLIK, yon: -1 };
    gerginlik = 0.3; ilerleme = 0.05; gevsekSure = 0; firtlama = 0.5; firtlamaGuc = 0.5 + r.guc * 0.1; sonrakiFirtlama = an + 1600;
    durum = 'mucadele'; ses('su'); sicrat(hedefX, SU, 18, 0.9); halka(hedefX, SU, true); if (!az) sarsinti = 6;
    const gucAd = ['', 'küçük', 'orta boy', 'güçlü', 'çok güçlü', 'efsanevi'][r.guc] || '';
    yazi.textContent = `Takıldı! ${gucAd ? `Hissediyorsun: ${gucAd} bir balık. ` : ''}Sar ama misinayı koparma!`;
    ipucu.innerHTML = '<b>Sar</b> düğmesini (ya da boşluğu, ya da sahneyi) <b>basılı tut</b>. Gerginlik kırmızıya çıkarsa bırak; balık çırpınırken sarma. Fazla gevşetirsen balık kaçar.';
    dugmeAyarla('sar');
  }
  async function bitir(neden) {
    if (durum !== 'mucadele') return;
    durum = 'bitti'; tutuyor = false; dugmeAyarla('bos');
    if (neden === 'koptu') { ses('kopma'); if (!az) sarsinti = 8; sicrat(mucadele.fx, SU, 10, 0.8); }
    else { halka(mucadele.fx, SU, true); }
    yazi.textContent = neden === 'koptu' ? '💥 Misina koptu! Gerginliği kırmızıda tutma.' : '🌊 Balık kaçtı: misinayı çok gevşettin.';
    try { const r = await api(`/api/balik/${atis.id}/cikar`, { basari: false }); sonuc?.(r); } catch { /* sonuç zaten kaçtı */ }
    ipucu.textContent = 'Bir daha dene: sarmayı balık çırpınmadığında yap, gerginliği yeşilde tut.';
    dugmeAyarla('yeniden');
  }
  async function cikar() {
    durum = 'cekiliyor'; tutuyor = false;
    let r;
    try { r = await api(`/api/balik/${atis.id}/cikar`, { basari: true }); }
    catch (e) {
      // Sunucu "henüz yorulmadı" derse mücadele sürer
      if (/yorulmadı/.test(e.message)) { ilerleme = 0.9; durum = 'mucadele'; return; }
      yazi.textContent = e.message; durum = 'bitti'; dugmeAyarla('yeniden'); return;
    }
    if (!r.tutuldu) { durum = 'bitti'; yazi.textContent = 'Balık son anda kurtuldu.'; dugmeAyarla('yeniden'); sonuc?.(r); return; }
    sonucBalik = r;
    cikis = { bas: performance.now(), x0: mucadele.fx, bitti: false };
    durum = 'cikiyor'; dugmeAyarla('bos');
    ses('su'); sicrat(mucadele.fx, SU, 26, 1.2); halka(mucadele.fx, SU, true);
    yazi.textContent = 'Geliyor…';
    sonuc?.(r);
  }
  function sonucGoster() {
    const r = sonucBalik;
    durum = 'bitti'; ses('hasat');
    sicrat(W - 195, H - 100, 16, 0.6, r.urun === 'ALTIN_BALIK' ? 'rgba(255,215,80,.95)' : 'rgba(220,240,255,.95)');
    const kg = r.agirlik.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    kart.innerHTML = `<div class="balik-kart-ic ${r.urun === 'ALTIN_BALIK' ? 'altin' : ''}">
      <span class="balik-kart-ikon">${r.ikon}</span>
      <b>${esc(r.ad)}</b><span class="balik-kart-kg">${kg} kg</span>
      ${r.rekor ? `<span class="balik-rekor">🏆 Kişisel rekor${r.oncekiRekor != null ? ` (önceki ${r.oncekiRekor.toLocaleString('tr-TR')} kg)` : ''}</span>` : ''}
      ${r.odul ? `<span class="balik-rekor">✨ Nadir altın balık: +${akce(r.odul)}</span>` : ''}</div>`;
    kart.hidden = false;
    yazi.innerHTML = `${r.ikon} <b>${esc(r.ad)}</b> tuttun! Kovaya (envanterine) girdi.`;
    ipucu.textContent = 'Balıkları pazarda satabilir ya da komşuna gönderebilirsin.';
    dugmeAyarla('yeniden');
  }

  // ---------- Girdi: tıkla/boşluk = çek; mücadelede basılı tut = sar
  const bas = (e) => {
    if (durum === 'mucadele') { e?.preventDefault?.(); tutuyor = true; return; }
    if (e?.type === 'pointerdown' && e.currentTarget === dugme) return;   // düğmenin kendisi click ile işlenir
    if (durum === 'isirdi' || durum === 'bekliyor') cek();
  };
  const birak = () => { tutuyor = false; };
  dugme.addEventListener('click', () => {
    if (dugme.dataset.balik === 'yeniden') baslat(sonKonum);
    else if (dugme.dataset.balik === 'cek') cek();
  });
  dugme.addEventListener('pointerdown', (e) => { if (durum === 'mucadele') { e.preventDefault(); tutuyor = true; dugme.setPointerCapture?.(e.pointerId); } });
  for (const o of ['pointerup', 'pointercancel', 'lostpointercapture']) dugme.addEventListener(o, birak);
  tuval.addEventListener('pointerdown', (e) => { tuval.setPointerCapture?.(e.pointerId); bas(e); });
  for (const o of ['pointerup', 'pointercancel', 'lostpointercapture']) tuval.addEventListener(o, birak);
  const tusBas = (e) => {
    if (e.code !== 'Space' || !kap.isConnected) return;
    e.preventDefault();
    if (e.repeat) return;
    if (durum === 'mucadele') tutuyor = true;
    else if (dugme.dataset.balik !== 'bos') dugme.click();
  };
  const tusBirak = (e) => { if (e.code === 'Space') tutuyor = false; };
  document.addEventListener('keydown', tusBas);
  document.addEventListener('keyup', tusBirak);
  window.addEventListener('blur', birak);
  kare = requestAnimationFrame(ciz);

  return {
    at(konum) { sonKonum = konum; baslat(konum); },
    kapat() {
      cancelAnimationFrame(kare); clearTimeout(zamanlayici);
      document.removeEventListener('keydown', tusBas); document.removeEventListener('keyup', tusBirak); window.removeEventListener('blur', birak);
      // Mücadele yarıdaysa pencere kapanınca balık kaçar
      if (durum === 'mucadele' && atis) api(`/api/balik/${atis.id}/cikar`, { basari: false }).catch(() => {});
    },
  };
}
