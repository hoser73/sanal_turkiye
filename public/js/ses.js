// Ses ve müzik: tamamı Web Audio ile anında üretilir (ses dosyası yok). Efektler: düğme, para, hasat, sulama, ekim,
// yemleme, seviye. Müzik: pentatonik, yavaş, kendiliğinden değişen hafif bir çiftlik ezgisi. Tercihler tarayıcıda saklanır;
// tarayıcılar sesi ancak ilk dokunuştan sonra açtığı için bağlam ilk tıklamada kurulur.
import { titret } from './uygulama.js';

// Şimdilik bütün sesler kapalı (efektler, müzik, ortam sesleri): yeni ses tasarımı gelene kadar hiçbir ses çalınmaz,
// ses bağlamı (AudioContext) hiç kurulmaz ve ayarlardaki ses/müzik seçenekleri gizlidir. Telefondaki titreşim sürer.
export const SESLER_KAPALI = true;

let bag = null, ana = null, muzikKazanc = null;
const tercih = (k, v) => { try { return localStorage.getItem(k) || v; } catch { return v; } };
const yaz = (k, v) => { try { localStorage.setItem(k, v); } catch { /* özel pencere */ } };
let sesAcik = tercih('st-ses', 'acik') === 'acik';
let muzikAcik = tercih('st-muzik', 'kapali') === 'acik';

function baglam() {
  if (SESLER_KAPALI) return null;
  if (bag) return bag;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  bag = new AC();
  ana = bag.createGain(); ana.gain.value = 0.5; ana.connect(bag.destination);
  muzikKazanc = bag.createGain(); muzikKazanc.gain.value = 0; muzikKazanc.connect(ana);
  return bag;
}
document.addEventListener('pointerdown', () => { if (baglam()?.state === 'suspended') bag.resume(); if (muzikAcik) muzikBaslat(); }, { once: false, passive: true });

// Tek nota: dalga türü, başlangıç/bitiş frekansı, süre, ses düzeyi, gecikme
function nota({ tur = 'sine', f0, f1 = f0, sure = 0.12, duzey = 0.15, gecikme = 0, hedef = ana }) {
  const t = bag.currentTime + gecikme;
  const o = bag.createOscillator(), g = bag.createGain();
  o.type = tur;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + sure);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(duzey, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + sure);
  o.connect(g); g.connect(hedef);
  o.start(t); o.stop(t + sure + 0.02);
}
function gurultu({ sure = 0.3, f0 = 3000, f1 = 600, duzey = 0.12, gecikme = 0 }) {
  const t = bag.currentTime + gecikme;
  const n = Math.round(bag.sampleRate * sure);
  const tampon = bag.createBuffer(1, n, bag.sampleRate), d = tampon.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const k = bag.createBufferSource(); k.buffer = tampon;
  const filtre = bag.createBiquadFilter(); filtre.type = 'bandpass'; filtre.Q.value = 1.2;
  filtre.frequency.setValueAtTime(f0, t); filtre.frequency.exponentialRampToValueAtTime(f1, t + sure);
  const g = bag.createGain();
  g.gain.setValueAtTime(duzey, t); g.gain.exponentialRampToValueAtTime(0.0001, t + sure);
  k.connect(filtre); filtre.connect(g); g.connect(ana);
  k.start(t); k.stop(t + sure);
}

const EFEKT = {
  tik: () => nota({ tur: 'sine', f0: 900, f1: 520, sure: 0.05, duzey: 0.05 }),
  bildirim: () => nota({ tur: 'sine', f0: 880, sure: 0.35, duzey: 0.08 }),
  para: () => { nota({ tur: 'square', f0: 988, sure: 0.08, duzey: 0.06 }); nota({ tur: 'square', f0: 1319, sure: 0.22, duzey: 0.06, gecikme: 0.08 }); },
  hasat: () => {
    gurultu({ sure: 0.12, f0: 1800, f1: 400, duzey: 0.1 });
    [1047, 1319, 1568, 2093].forEach((f, i) => nota({ tur: 'triangle', f0: f, sure: 0.18, duzey: 0.08, gecikme: 0.06 + i * 0.07 }));
  },
  sula: () => { gurultu({ sure: 0.55, f0: 4000, f1: 500, duzey: 0.09 }); gurultu({ sure: 0.4, f0: 2500, f1: 700, duzey: 0.05, gecikme: 0.15 }); },
  ek: () => { nota({ tur: 'sine', f0: 320, f1: 160, sure: 0.16, duzey: 0.16 }); nota({ tur: 'triangle', f0: 784, sure: 0.12, duzey: 0.05, gecikme: 0.1 }); },
  besle: () => [0, 0.11, 0.2].forEach((g, i) => nota({ tur: 'square', f0: 620 + i * 60, f1: 480, sure: 0.07, duzey: 0.04, gecikme: g })),
  seviye: () => [523, 659, 784, 1047, 1319].forEach((f, i) => nota({ tur: 'triangle', f0: f, sure: i === 4 ? 0.5 : 0.16, duzey: 0.09, gecikme: i * 0.11 })),
  // Balık tutma: suya düşüş, ısırma, makara cırcırı, misina kopması
  atis: () => { gurultu({ sure: 0.45, f0: 900, f1: 3200, duzey: 0.07 }); nota({ tur: 'sine', f0: 700, f1: 1400, sure: 0.3, duzey: 0.03 }); },
  su: () => { gurultu({ sure: 0.35, f0: 1400, f1: 300, duzey: 0.14 }); nota({ tur: 'sine', f0: 260, f1: 90, sure: 0.22, duzey: 0.1 }); },
  isirdi: () => { nota({ tur: 'sine', f0: 420, f1: 880, sure: 0.09, duzey: 0.12 }); nota({ tur: 'sine', f0: 420, f1: 880, sure: 0.09, duzey: 0.12, gecikme: 0.12 }); },
  makara: () => nota({ tur: 'square', f0: 2400, f1: 1800, sure: 0.02, duzey: 0.025 }),
  kopma: () => { nota({ tur: 'sawtooth', f0: 1800, f1: 200, sure: 0.18, duzey: 0.08 }); gurultu({ sure: 0.15, f0: 5000, f1: 1500, duzey: 0.08 }); },
  // Çiftlik ortamı: kuş cıvıltısı, horoz, inek
  kus: () => { const n = 2 + Math.floor(Math.random() * 3), f = 2600 + Math.random() * 1400; for (let i = 0; i < n; i++) nota({ tur: 'sine', f0: f, f1: f * (1.25 + Math.random() * 0.3), sure: 0.07, duzey: 0.018, gecikme: i * 0.11 }); },
  horoz: () => { nota({ tur: 'sawtooth', f0: 520, f1: 880, sure: 0.18, duzey: 0.025 }); nota({ tur: 'sawtooth', f0: 880, f1: 760, sure: 0.5, duzey: 0.025, gecikme: 0.18 }); nota({ tur: 'sawtooth', f0: 760, f1: 420, sure: 0.3, duzey: 0.02, gecikme: 0.68 }); },
  inek: () => { nota({ tur: 'sawtooth', f0: 150, f1: 120, sure: 0.9, duzey: 0.03 }); nota({ tur: 'triangle', f0: 300, f1: 240, sure: 0.9, duzey: 0.02 }); },
};
// Ortam sesleri: çiftlik açıkken arada bir kuşlar öter, bazen horoz ya da inek ses verir
let ortamZaman = 0;
export function ortamSesi(acik) {
  clearTimeout(ortamZaman); ortamZaman = 0;
  if (!acik || SESLER_KAPALI) return;
  const sonraki = () => {
    ortamZaman = setTimeout(() => { const z = Math.random(); ses(z < 0.75 ? 'kus' : z < 0.88 ? 'horoz' : 'inek'); sonraki(); }, 4000 + Math.random() * 7000);
  };
  sonraki();
}
// Uygulamada oyun efektleri telefonda dokunsal geri bildirim de verir (ses kapalı olsa bile)
// (ortam sesleri — kuş, horoz, inek — titretmez)
const TITRESIM = { tik: 'secim', para: 'orta', hasat: 'orta', seviye: 'agir', bildirim: 'hafif', sula: 'hafif', ek: 'hafif', besle: 'hafif', atis: 'hafif', isirdi: 'agir', makara: 'secim', kopma: 'agir' };
export function ses(tur) {
  if (TITRESIM[tur]) titret(TITRESIM[tur]);
  if (!sesAcik || !baglam() || bag.state !== 'running') return;
  try { EFEKT[tur]?.(); } catch { /* ses kartı yok */ }
}

// ---------- Müzik: C pentatonik, I–vi–IV–V döngüsü, yumuşak üçgen dalga ezgi + sinüs bas
const OLCEK = [523.25, 587.33, 659.25, 783.99, 880, 1046.5];
const AKOR = [[130.81, 261.63], [110, 220], [87.31, 174.61], [98, 196]];
let muzikZaman = 0, adim = 0, ezgi = 2;
function muzikBaslat() {
  if (!baglam() || muzikZaman) return;
  muzikKazanc.gain.cancelScheduledValues(bag.currentTime);
  muzikKazanc.gain.setTargetAtTime(0.35, bag.currentTime, 0.8);
  let sonraki = bag.currentTime + 0.1;
  const vurus = 0.32;
  muzikZaman = setInterval(() => {
    while (sonraki < bag.currentTime + 0.6) {
      const olcu = Math.floor(adim / 8) % 4;
      if (adim % 8 === 0) for (const f of AKOR[olcu]) nota({ tur: 'sine', f0: f, sure: vurus * 7.5, duzey: 0.05, gecikme: sonraki - bag.currentTime, hedef: muzikKazanc });
      if (Math.random() < 0.72) {
        ezgi = Math.max(0, Math.min(OLCEK.length - 1, ezgi + [-1, 0, 1, 1, -1, 2, -2][Math.floor(Math.random() * 7)]));
        nota({ tur: 'triangle', f0: OLCEK[ezgi], sure: vurus * (Math.random() < 0.3 ? 2 : 0.9), duzey: 0.05, gecikme: sonraki - bag.currentTime, hedef: muzikKazanc });
      }
      sonraki += vurus; adim++;
    }
  }, 150);
}
function muzikDurdur() {
  if (!muzikZaman) return;
  clearInterval(muzikZaman); muzikZaman = 0;
  if (bag) muzikKazanc.gain.setTargetAtTime(0, bag.currentTime, 0.3);
}
document.addEventListener('visibilitychange', () => { if (document.hidden) muzikDurdur(); else if (muzikAcik && bag) muzikBaslat(); });

export const sesDurumu = () => ({ ses: sesAcik && !SESLER_KAPALI, muzik: muzikAcik && !SESLER_KAPALI });
export function sesAyarla(acik) { sesAcik = !!acik; yaz('st-ses', sesAcik ? 'acik' : 'kapali'); if (sesAcik) { baglam(); bag?.resume(); ses('tik'); } }
export function muzikAyarla(acik) {
  muzikAcik = !!acik; yaz('st-muzik', muzikAcik ? 'acik' : 'kapali');
  if (muzikAcik) { baglam(); bag?.resume(); muzikBaslat(); } else muzikDurdur();
}
