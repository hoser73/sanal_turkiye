// Çiftlik görünümünün elle boyanmış dokuları (tuvalde üretilir, kenarlarda kesintisiz döşenir): çiçekli çimen, sürülmüş
// toprak, ekin sıraları, buğday, orman tacı, avlu toprağı, patika, arnavut kaldırımı, su, kiremit. Harita desenleri
// (fill-pattern / line-pattern) ve 3B dünya (three.js dokuları) aynı çizimleri kullanır.

// Kararlı rastgele: her açılışta aynı doku
function tohum(s) {
  let h = s | 0 || 1;
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}
function tuval(w, h, oran = 1) {
  const c = document.createElement('canvas');
  c.width = Math.round(w * oran); c.height = Math.round(h * oran);
  const g = c.getContext('2d');
  g.scale(oran, oran);
  return [c, g];
}
// Öğeyi dört kenardan sarmalayarak çiz (döşemede dikiş görünmesin)
function sar(w, h, x, y, ciz) { for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) ciz(x + dx, y + dy); }
function leke(g, x, y, r, renk) {
  const d = g.createRadialGradient(x, y, 0, x, y, r);
  d.addColorStop(0, renk); d.addColorStop(1, renk.replace(/[\d.]+\)$/, '0)'));
  g.fillStyle = d; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
}

const CIZIM = {
  // Gür çimen: yeşil tonlarında yumuşak lekeler, ot telleri, seyrek çiçekler
  'doku-cimen': (o) => {
    const W = 128, [c, g] = tuval(W, W, o), r = tohum(7);
    g.fillStyle = '#76ab3d'; g.fillRect(0, 0, W, W);
    for (let i = 0; i < 70; i++) {
      const x = r() * W, y = r() * W, rr = 6 + r() * 16;
      const renk = ['rgba(98,150,48,0.45)', 'rgba(138,186,72,0.4)', 'rgba(86,134,42,0.4)', 'rgba(160,196,84,0.3)'][Math.floor(r() * 4)];
      sar(W, W, x, y, (a, b) => leke(g, a, b, rr, renk));
    }
    for (let i = 0; i < 420; i++) {
      const x = r() * W, y = r() * W, L = 2 + r() * 4, egik = (r() - 0.5) * 2;
      g.strokeStyle = r() < 0.5 ? 'rgba(62,108,30,0.55)' : 'rgba(176,214,96,0.6)';
      g.lineWidth = 0.9;
      sar(W, W, x, y, (a, b) => { g.beginPath(); g.moveTo(a, b); g.lineTo(a + egik, b - L); g.stroke(); });
    }
    for (let i = 0; i < 9; i++) {
      const x = r() * W, y = r() * W, renk = ['#ffffff', '#ffe25a', '#f6a6d8', '#b9a6ff'][Math.floor(r() * 4)];
      sar(W, W, x, y, (a, b) => {
        g.fillStyle = renk;
        for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(a + Math.cos(k * 1.57) * 1.4, b + Math.sin(k * 1.57) * 1.4, 1.2, 0, Math.PI * 2); g.fill(); }
        g.fillStyle = '#f2b51c'; g.beginPath(); g.arc(a, b, 0.9, 0, Math.PI * 2); g.fill();
      });
    }
    return c;
  },
  // Sürülmüş toprak: karıklar (koyu çizgi + açık sırt), toprak kırıntıları
  'doku-toprak': (o) => {
    const W = 64, [c, g] = tuval(W, W, o), r = tohum(11);
    g.fillStyle = '#8c5a2e'; g.fillRect(0, 0, W, W);
    for (let i = 0; i < 40; i++) sar(W, W, r() * W, r() * W, (a, b) => leke(g, a, b, 4 + r() * 8, 'rgba(120,76,36,0.4)'));
    for (let y = 0; y < W; y += 8) {
      g.fillStyle = 'rgba(92,56,24,0.85)'; g.fillRect(0, y + 4, W, 2.2);
      g.fillStyle = 'rgba(176,122,70,0.55)'; g.fillRect(0, y + 1.5, W, 1.6);
    }
    for (let i = 0; i < 160; i++) { g.fillStyle = r() < 0.5 ? 'rgba(60,36,14,0.5)' : 'rgba(196,146,92,0.5)'; g.fillRect(r() * W, r() * W, 1.2, 1.2); }
    return c;
  },
  // Yeşil ekin sıraları (toprak üstünde yapraklı öbekler)
  'doku-ekin': (o) => {
    const W = 64, [c, g] = tuval(W, W, o), r = tohum(13);
    g.drawImage(CIZIM['doku-toprak'](o), 0, 0, W, W);
    for (let y = 2; y < W; y += 8) {
      for (let x = 2; x < W; x += 5) {
        const yx = x + (r() - 0.5) * 1.5;
        g.fillStyle = 'rgba(40,90,24,0.45)'; g.beginPath(); g.arc(yx + 0.8, y + 1.2, 2.6, 0, Math.PI * 2); g.fill();
        g.fillStyle = ['#5da637', '#6fbd42', '#4f9630'][Math.floor(r() * 3)]; g.beginPath(); g.arc(yx, y, 2.5, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(190,232,120,0.7)'; g.beginPath(); g.arc(yx - 0.8, y - 0.8, 0.9, 0, Math.PI * 2); g.fill();
      }
    }
    return c;
  },
  // Olgun buğday: altın sarısı başaklar
  'doku-bugday': (o) => {
    const W = 64, [c, g] = tuval(W, W, o), r = tohum(17);
    g.fillStyle = '#d4a63e'; g.fillRect(0, 0, W, W);
    for (let i = 0; i < 30; i++) sar(W, W, r() * W, r() * W, (a, b) => leke(g, a, b, 5 + r() * 9, 'rgba(236,196,96,0.45)'));
    for (let i = 0; i < 300; i++) {
      const x = r() * W, y = r() * W;
      g.strokeStyle = r() < 0.5 ? 'rgba(170,124,34,0.7)' : 'rgba(250,220,130,0.8)'; g.lineWidth = 1;
      sar(W, W, x, y, (a, b) => { g.beginPath(); g.moveTo(a, b); g.lineTo(a + 0.6, b - 3.2); g.stroke(); });
    }
    return c;
  },
  // Orman: üstten bakılan yoğun ağaç taçları (gölge, ışık, gövde arası koyuluk)
  'doku-orman': (o) => {
    const W = 96, [c, g] = tuval(W, W, o), r = tohum(19);
    g.fillStyle = '#2f5e22'; g.fillRect(0, 0, W, W);
    for (let i = 0; i < 38; i++) {
      const x = r() * W, y = r() * W, rr = 7 + r() * 7;
      const ton = ['#3f7d2c', '#4a8a32', '#3a7428', '#56963a'][Math.floor(r() * 4)];
      sar(W, W, x, y, (a, b) => {
        g.fillStyle = 'rgba(20,40,12,0.45)'; g.beginPath(); g.arc(a + 2.5, b + 3, rr, 0, Math.PI * 2); g.fill();
        g.fillStyle = ton; g.beginPath(); g.arc(a, b, rr, 0, Math.PI * 2); g.fill();
        leke(g, a - rr * 0.35, b - rr * 0.35, rr * 0.75, 'rgba(150,200,90,0.55)');
      });
    }
    return c;
  },
  // Avlu / yerleşim: çimen üstünde yer yer aşınmış toprak yamaları ve çakıl (köy ve kasaba aralarında yeşil kalır)
  'doku-avlu': (o) => {
    const W = 128, [c, g] = tuval(W, W, o), r = tohum(23);
    g.drawImage(CIZIM['doku-cimen'](o), 0, 0, W, W);
    for (let i = 0; i < 7; i++) {
      const x = r() * W, y = r() * W, rr = 7 + r() * 11;
      sar(W, W, x, y, (a, b) => { leke(g, a, b, rr, 'rgba(190,156,104,0.75)'); leke(g, a + 2, b + 1, rr * 0.6, 'rgba(170,134,86,0.5)'); });
    }
    for (let i = 0; i < 60; i++) { g.fillStyle = r() < 0.5 ? 'rgba(120,96,64,0.55)' : 'rgba(240,226,196,0.65)'; g.beginPath(); g.arc(r() * W, r() * W, 0.6 + r() * 0.8, 0, Math.PI * 2); g.fill(); }
    return c;
  },
  // Patika (çizgi deseni: yükseklik çizgi genişliğine gerilir)
  'doku-patika': (o) => {
    const W = 64, H = 16, [c, g] = tuval(W, H, o), r = tohum(29);
    g.fillStyle = '#b48d5c'; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(110,84,48,0.55)'; g.fillRect(0, 0, W, 2); g.fillRect(0, H - 2, W, 2);
    g.fillStyle = 'rgba(96,140,52,0.7)'; for (let x = 0; x < W; x += 3) { g.fillRect(x, 0, 1.5, 1 + r() * 2); g.fillRect(x + 1, H - 1 - r() * 2, 1.5, 3); }
    for (let i = 0; i < 40; i++) { g.fillStyle = r() < 0.5 ? 'rgba(140,110,72,0.8)' : 'rgba(218,196,156,0.8)'; g.beginPath(); g.arc(r() * W, 3 + r() * (H - 6), 0.6 + r() * 0.8, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = 'rgba(150,118,76,0.5)'; g.fillRect(0, H / 2 - 3, W, 1); g.fillRect(0, H / 2 + 2, W, 1);
    return c;
  },
  // Arnavut kaldırımı (ana yollar)
  'doku-kaldirim': (o) => {
    const W = 48, H = 24, [c, g] = tuval(W, H, o), r = tohum(31);
    g.fillStyle = '#7c7366'; g.fillRect(0, 0, W, H);
    for (let sira = 0; sira < 4; sira++) {
      const y = sira * 6, kay = (sira % 2) * 4;
      for (let x = -8 + kay; x < W + 8; x += 8) {
        const ton = ['#b8ad9a', '#a89d8a', '#c4b9a5', '#9d927f'][Math.floor(r() * 4)];
        g.fillStyle = 'rgba(40,34,28,0.45)'; g.beginPath(); g.roundRect(x + 1, y + 1.3, 7, 4.8, 2); g.fill();
        g.fillStyle = ton; g.beginPath(); g.roundRect(x + 0.5, y + 0.5, 7, 4.6, 2); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(x + 1.5, y + 1, 4, 1);
      }
    }
    g.fillStyle = 'rgba(70,60,48,0.6)'; g.fillRect(0, 0, W, 1.5); g.fillRect(0, H - 1.5, W, 1.5);
    return c;
  },
  // Su: boyanmış mavi, açık dalgacıklar (faz ile kayar)
  'doku-su': (o, faz = 0) => {
    const W = 96, [c, g] = tuval(W, W, o), r = tohum(37);
    g.fillStyle = '#3d97cf'; g.fillRect(0, 0, W, W);
    for (let i = 0; i < 18; i++) sar(W, W, r() * W, r() * W, (a, b) => leke(g, a, b, 10 + r() * 14, 'rgba(84,170,222,0.45)'));
    g.lineCap = 'round';
    for (let i = 0; i < 16; i++) {
      const x0 = r() * W, y = r() * W, L = 6 + r() * 8, kay = (faz * W + y * 0.4) % W;
      sar(W, W, x0 + kay, y, (a, b) => {
        g.strokeStyle = 'rgba(214,240,255,0.75)'; g.lineWidth = 1.4;
        g.beginPath(); g.moveTo(a, b); g.quadraticCurveTo(a + L / 2, b - 2, a + L, b); g.stroke();
      });
    }
    return c;
  },
};

export const CIFTLIK_DOKULARI = Object.keys(CIZIM);
export function dokuCiz(ad, oran = Math.min(2, window.devicePixelRatio || 1), ...arg) { return CIZIM[ad]?.(oran, ...arg) || null; }

// 3B dünya için büyük dokular (three.js): kiremit çatı, sıvalı cephe, toprak ve çimen zemin
export function kiremitTuvali() {
  const W = 256, [c, g] = tuval(W, W), r = tohum(41);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, W);
  const sira = 16;
  for (let y = 0; y < W; y += sira) {
    const kay = ((y / sira) % 2) * 8;
    for (let x = -16 + kay; x < W + 16; x += 16) {
      const ton = 0.86 + r() * 0.14;
      const d = g.createLinearGradient(0, y, 0, y + sira);
      d.addColorStop(0, `rgba(${Math.round(255 * ton)},${Math.round(255 * ton)},${Math.round(255 * ton)},1)`);
      d.addColorStop(0.75, `rgba(${Math.round(220 * ton)},${Math.round(220 * ton)},${Math.round(220 * ton)},1)`);
      d.addColorStop(1, 'rgba(120,120,120,1)');
      g.fillStyle = d; g.beginPath(); g.roundRect(x + 0.5, y, 15, sira, [0, 0, 7, 7]); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x + 3, y + 2, 3, sira - 6);
    }
  }
  return c;
}
export function zeminTuvali(ad) { return dokuCiz(ad, 2); }
