// Ses ve müzik: tamamı Web Audio ile anında üretilir (ses dosyası yok). v0.44 ses tasarımı: yumuşak, sıcak tınılar (sinüs
// ve üçgen dalga, hızlı sönen marimba benzeri vuruşlar), ana çıkışta tiz kesen süzgeç, hafif yankı ve sıkıştırıcı; seviyeler
// düşük tutulur. Efektler: düğme, para, hasat, sulama, ekim, yemleme, seviye, sandık, bulmaca eşleşmesi; balık tutma sesleri.
// Ortam: çiftlik açıkken gündüz kuş, horoz, inek; gece cırcır böceği ve baykuş. Müzik: pentatonik, yavaş çiftlik ezgisi
// (varsayılan kapalı). Ses ⚙️ menüsünden açılıp kapanır; tercihler tarayıcıda saklanır. Tarayıcılar sesi ancak ilk
// dokunuştan sonra açtığı için bağlam ilk dokunuşta kurulur. Uygulamada oyun efektleri telefonda titreşim de verir.
import { titret } from './uygulama.js';

let bag = null, ana = null, muzikKazanc = null, yankiGiris = null;
const tercih = (k, v) => { try { return localStorage.getItem(k) || v; } catch { return v; } };
const yaz = (k, v) => { try { localStorage.setItem(k, v); } catch { /* özel pencere */ } };
let sesAcik = tercih('st-ses', 'acik') === 'acik';
let muzikAcik = tercih('st-muzik', 'kapali') === 'acik';

function baglam() {
  if (bag) return bag;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  bag = new AC();
  // ana → tiz süzgeç → sıkıştırıcı → çıkış; ayrıca kısa geri beslemeli yankı (sesleri yumuşatır, "oda" hissi verir)
  const suzgec = bag.createBiquadFilter(); suzgec.type = 'lowpass'; suzgec.frequency.value = 5200; suzgec.Q.value = 0.4;
  const sik = bag.createDynamicsCompressor(); sik.threshold.value = -20; sik.ratio.value = 3;
  ana = bag.createGain(); ana.gain.value = 0.55;
  ana.connect(suzgec); suzgec.connect(sik); sik.connect(bag.destination);
  yankiGiris = bag.createGain(); yankiGiris.gain.value = 0.16;
  const gecikme = bag.createDelay(); gecikme.delayTime.value = 0.13;
  const geri = bag.createGain(); geri.gain.value = 0.28;
  const yankiSuzgec = bag.createBiquadFilter(); yankiSuzgec.type = 'lowpass'; yankiSuzgec.frequency.value = 2400;
  yankiGiris.connect(gecikme); gecikme.connect(yankiSuzgec); yankiSuzgec.connect(geri); geri.connect(gecikme); yankiSuzgec.connect(ana);
  muzikKazanc = bag.createGain(); muzikKazanc.gain.value = 0; muzikKazanc.connect(ana);
  return bag;
}
document.addEventListener('pointerdown', () => { if (!sesAcik && !muzikAcik) return; if (baglam()?.state === 'suspended') bag.resume(); if (muzikAcik) muzikBaslat(); }, { passive: true });

// Tek nota: dalga türü, başlangıç/bitiş frekansı, süre, ses düzeyi, gecikme; yanki: yankıya gönderme oranı
function nota({ tur = 'sine', f0, f1 = f0, sure = 0.12, duzey = 0.12, gecikme = 0, hedef = ana, yanki = 0.6, atak = 0.008 }) {
  const t = bag.currentTime + gecikme;
  const o = bag.createOscillator(), g = bag.createGain();
  o.type = tur;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + sure);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(duzey, t + atak);
  g.gain.exponentialRampToValueAtTime(0.0001, t + sure);
  o.connect(g); g.connect(hedef);
  if (yanki && hedef === ana) { const y = bag.createGain(); y.gain.value = yanki; g.connect(y); y.connect(yankiGiris); }
  o.start(t); o.stop(t + sure + 0.03);
}
// Marimba benzeri vuruş: temel ses + yumuşak üst ses, hızlı sönüm
const tahta = (f, gecikme = 0, duzey = 0.09, sure = 0.32) => {
  nota({ tur: 'sine', f0: f, sure, duzey, gecikme });
  nota({ tur: 'sine', f0: f * 4, sure: sure * 0.25, duzey: duzey * 0.18, gecikme });
};
function gurultu({ sure = 0.3, f0 = 3000, f1 = 600, duzey = 0.08, gecikme = 0, tur = 'bandpass' }) {
  const t = bag.currentTime + gecikme;
  const n = Math.round(bag.sampleRate * sure);
  const tampon = bag.createBuffer(1, n, bag.sampleRate), d = tampon.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const k = bag.createBufferSource(); k.buffer = tampon;
  const filtre = bag.createBiquadFilter(); filtre.type = tur; filtre.Q.value = 1.1;
  filtre.frequency.setValueAtTime(f0, t); filtre.frequency.exponentialRampToValueAtTime(f1, t + sure);
  const g = bag.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(duzey, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + sure);
  k.connect(filtre); filtre.connect(g); g.connect(ana);
  k.start(t); k.stop(t + sure);
}

// C majör pentatonik (Do Re Mi Sol La): bütün efektler aynı tonda kalır, birbirine karışınca da kulak tırmalamaz
const DO = 523.25, RE = 587.33, MI = 659.25, SOL = 783.99, LA = 880;
const EFEKT = {
  tik: () => nota({ tur: 'sine', f0: 1320, f1: 990, sure: 0.045, duzey: 0.035, yanki: 0 }),
  bildirim: () => { tahta(SOL * 2, 0, 0.06); tahta(DO * 4, 0.1, 0.05); },
  para: () => { tahta(MI * 2, 0, 0.07, 0.22); tahta(SOL * 2, 0.07, 0.07, 0.22); tahta(DO * 4, 0.14, 0.08, 0.4); },
  hasat: () => {
    gurultu({ sure: 0.18, f0: 2200, f1: 700, duzey: 0.05 });
    [DO * 2, MI * 2, SOL * 2, DO * 4].forEach((f, i) => tahta(f, 0.05 + i * 0.06, 0.07, 0.28));
  },
  sula: () => { gurultu({ sure: 0.6, f0: 3200, f1: 900, duzey: 0.05, tur: 'lowpass' }); gurultu({ sure: 0.45, f0: 1800, f1: 600, duzey: 0.03, gecikme: 0.15 }); },
  ek: () => { nota({ tur: 'sine', f0: 220, f1: 140, sure: 0.14, duzey: 0.12, yanki: 0.2 }); tahta(SOL, 0.09, 0.05, 0.2); },
  besle: () => [0, 0.1, 0.19].forEach((g, i) => tahta([RE, MI, SOL][i] * 2, g, 0.045, 0.14)),
  seviye: () => [DO, MI, SOL, DO * 2, MI * 2].forEach((f, i) => tahta(f * 2, i * 0.11, 0.08, i === 4 ? 0.7 : 0.25)),
  sandik: () => { gurultu({ sure: 0.25, f0: 600, f1: 300, duzey: 0.06, tur: 'lowpass' }); [SOL, LA, DO * 2, MI * 2, SOL * 2].forEach((f, i) => tahta(f * 2, 0.18 + i * 0.07, 0.07, 0.3)); },
  // Motif bulmacası: eşleşme (zincirde perde yükselir), özel taş, kazanma
  esles: (zincir = 0) => tahta([DO, RE, MI, SOL, LA, DO * 2][Math.min(5, zincir)] * 2, 0, 0.07, 0.22),
  ozel: () => { nota({ tur: 'triangle', f0: 660, f1: 1320, sure: 0.25, duzey: 0.05 }); tahta(SOL * 2, 0.12, 0.06); },
  kazandi: () => [DO, MI, SOL, LA, DO * 2, MI * 2].forEach((f, i) => tahta(f * 2, i * 0.09, 0.08, i === 5 ? 0.9 : 0.28)),
  kaybetti: () => [SOL, MI, RE, DO].forEach((f, i) => tahta(f, i * 0.14, 0.06, 0.35)),
  // Balık tutma: suya düşüş, ısırma, makara cırcırı, misina kopması
  atis: () => { gurultu({ sure: 0.4, f0: 700, f1: 2600, duzey: 0.04 }); },
  su: () => { gurultu({ sure: 0.3, f0: 1200, f1: 300, duzey: 0.08, tur: 'lowpass' }); nota({ tur: 'sine', f0: 240, f1: 90, sure: 0.2, duzey: 0.08, yanki: 0.3 }); },
  isirdi: () => { tahta(LA * 2, 0, 0.08, 0.12); tahta(LA * 2, 0.13, 0.08, 0.12); },
  makara: () => nota({ tur: 'square', f0: 2200, f1: 1700, sure: 0.018, duzey: 0.012, yanki: 0 }),
  kopma: () => { nota({ tur: 'triangle', f0: 1400, f1: 200, sure: 0.2, duzey: 0.06 }); gurultu({ sure: 0.12, f0: 4000, f1: 1500, duzey: 0.05 }); },
  // Çiftlik ortamı: gündüz kuş, horoz, inek; gece cırcır böceği ve baykuş
  kus: () => { const n = 2 + Math.floor(Math.random() * 3), f = 2500 + Math.random() * 1200; for (let i = 0; i < n; i++) nota({ tur: 'sine', f0: f, f1: f * (1.2 + Math.random() * 0.3), sure: 0.07, duzey: 0.014, gecikme: i * 0.11, yanki: 0.8 }); },
  horoz: () => { nota({ tur: 'triangle', f0: 520, f1: 860, sure: 0.18, duzey: 0.02 }); nota({ tur: 'triangle', f0: 860, f1: 760, sure: 0.5, duzey: 0.02, gecikme: 0.18 }); nota({ tur: 'triangle', f0: 760, f1: 420, sure: 0.3, duzey: 0.016, gecikme: 0.68 }); },
  inek: () => { nota({ tur: 'sawtooth', f0: 150, f1: 120, sure: 0.9, duzey: 0.012, yanki: 0.3 }); nota({ tur: 'triangle', f0: 300, f1: 240, sure: 0.9, duzey: 0.018 }); },
  cirit: () => { const f = 4200 + Math.random() * 500; for (let i = 0; i < 3; i++) nota({ tur: 'sine', f0: f, sure: 0.035, duzey: 0.008, gecikme: i * 0.06, yanki: 0.5 }); },
  baykus: () => { nota({ tur: 'sine', f0: 390, f1: 360, sure: 0.35, duzey: 0.025, yanki: 1 }); nota({ tur: 'sine', f0: 390, f1: 340, sure: 0.5, duzey: 0.022, gecikme: 0.5, yanki: 1 }); },
};
// Ortam sesleri: çiftlik açıkken arada bir; gündüz kuş/horoz/inek, gece cırcır böceği ve seyrek baykuş
let ortamZaman = 0, ortamGece = false;
export function ortamSesi(acik, { gece = false } = {}) {
  clearTimeout(ortamZaman); ortamZaman = 0; ortamGece = gece;
  if (!acik) return;
  const sonraki = () => {
    const gecede = ortamGece;
    ortamZaman = setTimeout(() => {
      const z = Math.random();
      ses(gecede ? (z < 0.85 ? 'cirit' : 'baykus') : (z < 0.75 ? 'kus' : z < 0.88 ? 'horoz' : 'inek'));
      sonraki();
    }, gecede ? 1500 + Math.random() * 3500 : 4000 + Math.random() * 7000);
  };
  sonraki();
}
// Uygulamada oyun efektleri telefonda dokunsal geri bildirim de verir (ses kapalı olsa bile); ortam sesleri titretmez
const TITRESIM = { tik: 'secim', para: 'orta', hasat: 'orta', seviye: 'agir', sandik: 'agir', bildirim: 'hafif', sula: 'hafif', ek: 'hafif', besle: 'hafif',
  esles: 'secim', ozel: 'orta', kazandi: 'agir', atis: 'hafif', isirdi: 'agir', makara: 'secim', kopma: 'agir' };
export function ses(tur, ...arg) {
  if (TITRESIM[tur]) titret(TITRESIM[tur]);
  if (!sesAcik || !baglam() || bag.state !== 'running') return;
  try { EFEKT[tur]?.(...arg); } catch { /* ses kartı yok */ }
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
        nota({ tur: 'triangle', f0: OLCEK[ezgi], sure: vurus * (Math.random() < 0.3 ? 2 : 0.9), duzey: 0.04, gecikme: sonraki - bag.currentTime, hedef: muzikKazanc });
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

export const sesDurumu = () => ({ ses: sesAcik, muzik: muzikAcik });
export function sesAyarla(acik) { sesAcik = !!acik; yaz('st-ses', sesAcik ? 'acik' : 'kapali'); if (sesAcik) { baglam(); bag?.resume(); ses('tik'); } }
export function muzikAyarla(acik) {
  muzikAcik = !!acik; yaz('st-muzik', muzikAcik ? 'acik' : 'kapali');
  if (muzikAcik) { baglam(); bag?.resume(); muzikBaslat(); } else muzikDurdur();
}
