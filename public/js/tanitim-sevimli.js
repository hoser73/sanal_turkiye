// Açılış ekranının sevimli 3B çiftlik sahnesi (oyunun yeni görsel dili): tarlalar, pazar tezgâhı, ev, ambar, yel
// değirmeni, hayvanlar, hasat eden traktör, dalgalanan Türk bayrağı; kamera yavaşça çiftliğin çevresinde döner.
// Arayüz: sevimliTanitim(kap, { sakin }) → { hazir, gece, alaca, durdur() } (tanitim-ui.js eski sahneyle aynı biçimde kullanır).
import * as THREE from '/vendor/three/three.module.js';
import * as K from './sevimli3d.js';
import * as Y from './sevimli3d-yapi.js';
import { sevimliSonIslem, gokFonu } from './sevimli-efekt.js';
import { canliKur } from './sevimli-canli.js';

export function sevimliTanitim(kap, { sakin = false } = {}) {
  const tuval = document.createElement('canvas');
  tuval.className = 'tn-uc-tuval';
  tuval.setAttribute('aria-hidden', 'true');
  kap.appendChild(tuval);
  const renderer = new THREE.WebGLRenderer({ canvas: tuval, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  const sahne = new THREE.Scene(), ust = new THREE.Scene();
  K.isikKur(sahne, renderer, { merkez: new THREE.Vector3(0, 0, 0), alan: 34 });
  sahne.background = gokFonu();
  const kamera = new THREE.PerspectiveCamera(34, 16 / 9, 0.5, 600);
  const canli = canliKur(sahne, { ust });
  let tohum = 11;
  const r = () => { tohum = (tohum * 16807) % 2147483647; return (tohum - 1) / 2147483646; };
  const ekle = (o, x, y, z, ry = 0, s = 1) => { o.position.set(x, y, z); o.rotation.y = ry; o.scale.multiplyScalar(s); sahne.add(o); return o; };

  // Zemin, patikalar, çimen lekeleri
  const zemin = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), K.malz(K.RENK.cimen)); zemin.receiveShadow = true; sahne.add(zemin);
  for (let i = 0; i < 24; i++) ekle(K.levha(3 + r() * 6, 2 + r() * 5, K.RENK.cimenKoyu, { kalinlik: 0.005, kose: 1.4 }), (r() - 0.5) * 90, -0.04, (r() - 0.5) * 70, r() * 3);
  ekle(K.levha(3.2, 60, K.RENK.kum, { kalinlik: 0.01, kose: 1.5 }), 0.5, 0, 10);
  ekle(K.levha(60, 2.8, K.RENK.kum, { kalinlik: 0.01, kose: 1.3 }), -2, 0, 1.2);
  ekle(K.levha(9, 7, K.RENK.kum, { kalinlik: 0.012, kose: 2.6 }), 0.5, 0, 5.5);

  // Tarlalar: çilek (traktörlü), domates, mısır, buğday
  ekle(K.tarla(9, 6.5), -8, 0, -5.5);
  const cilek = []; for (let i = 0; i < 8; i++) for (let j = 0; j < 5; j++) if (!(i >= 3 && i <= 5 && j >= 1)) cilek.push([-11.8 + i * 1.1, -8.2 + j * 1.2]);
  ekle(K.cilekTarhi(cilek, r), 0, 0.12, 0);
  const surucu = K.ciftci();
  const traktor = ekle(K.traktor(surucu), -8, 0.12, -4.6, Math.PI);
  ekle(K.tarla(7, 5.5), 7, 0, -5.5);
  const domates = []; for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) domates.push([4.2 + i * 1.15, -7.6 + j * 1.25]);
  ekle(K.domatesTarhi(domates, r), 0, 0.12, 0);
  ekle(K.tarla(12, 5), -1, 0, -13.5);
  const misir = []; for (let i = 0; i < 14; i++) for (let j = 0; j < 4; j++) misir.push([-6.8 + i * 0.84, -15.3 + j * 1.05]);
  ekle(K.misirTarhi(misir, r), 0, 0.12, 0);
  const bugdayYer = []; for (let i = 0; i < 9; i++) for (let j = 0; j < 6; j++) bugdayYer.push([(-22 + i * 1.1) / 1.3, (-9 + j * 1.15) / 1.3]);
  ekle(K.tarla(11, 8), -18, 0, -6);
  ekle(Y.bugdayTarhi(bugdayYer, r, 1), 0, 0.15, 0, 0, 1.3);
  ekle(K.cit(9), -8, 0, -1.9); ekle(K.cit(7), 7, 0, -2.4);

  // Pazar tezgâhı, kasalar, satıcı ve kuyruktaki müşteriler
  ekle(K.tezgah(), 0.5, 0, 3.4);
  ekle(K.kasaYigini(2, 'misir', r), -1.0, 1.0, 3.3); ekle(K.kasaYigini(3, 'yumurta', r), 0.1, 1.0, 3.3);
  ekle(K.kasaYigini(4, 'marul', r), 1.15, 1.0, 3.3); ekle(K.kasaYigini(5, 'domates', r), 2.2, 1.0, 3.3);
  ekle(K.ciftci(), -2.4, 0, 3.6, 0.5);
  ekle(K.elArabasi(K.RENK.domates), 3.4, 0, 1.0, -0.6);
  const musteriler = [{ tulum: '#3a64c8', gomlek: '#f06b5b', sapka: false, sac: '#c8c2b8' }, { tulum: '#5b3d8a', gomlek: '#f6c74a', sapka: false, sac: '#e7a33b' },
    { tulum: '#2f8f6b', gomlek: '#ffffff', sapka: false, sac: '#3a2a20' }, { tulum: '#c0392b', gomlek: '#f3e5d0', sapka: false, sac: '#f0f0f0' }]
    .map((k, i) => ({ m: ekle(K.ciftci(k), 0.6, 0, 5.6 + i * 1.5, Math.PI), z0: 5.6 + i * 1.5, faz: r() * 6 }));

  // Ev, ambar, yel değirmeni, kümes, ağıl, bayrak
  ekle(Y.ev({ catiRenk: '#e2574c' }), 12, 0, 6, -0.5);
  ekle(K.ambar(), 14, 0, -6, -0.35, 1.2);
  const degirmen = ekle(Y.degirmen(), -16, 0, 9, 0.6, 0.9);
  const kumes = ekle(Y.kumes(r), 19, 0, 4, -0.9);
  const bayrak = ekle(Y.bayrakDiregi(), 6, 0, 9.5, -0.3, 1.6);
  for (const [x, z] of [[-10, 12], [-7, 14]]) ekle(K.balya(), x, 0, z, r() * 3);
  // Ağıl: çitli alan ve koyunlar; dışarıda otlayan inekler
  [[0, -3.5, 9, 0], [0, 3.5, 9, 0], [-4.5, 0, 7, Math.PI / 2], [4.5, 0, 7, Math.PI / 2]].forEach(([x, z, l, ry]) => ekle(K.cit(l), 24 + x, 0, -14 + z, ry));
  for (let i = 0; i < 4; i++) { const k = ekle(Y.koyun(), 24 + (r() - 0.5) * 6, 0, -14 + (r() - 0.5) * 4, r() * 6); canli.hayvanEkle(k, { merkez: new THREE.Vector3(24, 0, -14), yaricap: 2.6, tur: 'koyun' }); }
  for (const [x, z, a] of [[18, 14, true], [22, 12, false]]) { const c = ekle(Y.inek(a), x, 0, z, r() * 6); canli.hayvanEkle(c, { merkez: new THREE.Vector3(x, 0, z), yaricap: 3, tur: 'inek' }); }
  for (const t of kumes.userData.tavuklar) canli.hayvanEkle(t, { merkez: new THREE.Vector3(0, 0, 1.6), yaricap: 1.4, tur: 'tavuk' });

  // Ağaçlar, çalılar, taşlar, çiçekler
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + r() * 0.2, d = 34 + r() * 14;
    ekle(r() < 0.35 ? K.cam(r, 1.6) : K.yuvarlakAgac(r, 1.4 + r() * 0.6), Math.cos(a) * d, 0, Math.sin(a) * d, r() * 6);
  }
  [[-4, 7.5], [5, 8.5], [-13, 2.5], [8, 2.8], [-3.6, -1.5], [10, -1]].forEach(([x, z]) => ekle(K.cali(r), x, 0, z, r() * 6));
  [[-5.2, 4.2], [3.8, -0.4], [-14, -9], [9, 11]].forEach(([x, z]) => ekle(K.tas(r), x, 0, z));
  const cicek = []; for (let i = 0; i < 70; i++) { const x = (r() - 0.5) * 60, z = (r() - 0.5) * 46; if (Math.abs(x - 0.5) > 2.4 && Math.abs(z - 1.2) > 2) cicek.push([x, z]); }
  ekle(K.papatyalar(cicek), 0, 0, 0);

  let efekt = null;
  const hazir = sevimliSonIslem(renderer, sahne, kamera, ust).then((e) => { efekt = e; boyutla(); }).catch(() => {});
  function boyutla() {
    const g = kap.clientWidth || innerWidth, y = kap.clientHeight || innerHeight;
    renderer.setSize(g, y, false); kamera.aspect = g / y; kamera.fov = g < y ? 50 : 34; kamera.updateProjectionMatrix();
    efekt?.boyut(g, y);
  }
  const ro = new ResizeObserver(boyutla); ro.observe(kap); boyutla();
  let gorunur = true;
  const io = new IntersectionObserver((g) => { gorunur = g.some((x) => x.isIntersecting); }); io.observe(kap);

  let kare = 0, onceki = 0, calisiyor = true;
  function dongu(t) {
    if (!calisiyor) return;
    kare = requestAnimationFrame(dongu);
    if (!gorunur || document.hidden) return;
    const s = t / 1000, dt = Math.min(0.05, (t - onceki) / 1000 || 0.016); onceki = t;
    const a = sakin ? -0.5 : -0.5 + Math.sin(s * 0.05) * 0.45, uz = kamera.aspect < 1 ? 62 : 46;
    kamera.position.set(Math.sin(a) * uz, uz * 0.62, Math.cos(a) * uz);
    kamera.lookAt(0, 0, -1);
    K.RUZGAR.uZaman.value = s;
    const u = (Math.sin(s * 0.5) + 1) / 2;
    traktor.position.x = -10.5 + u * 5;
    surucu.userData.govde.position.y = Math.abs(Math.sin(s * 6)) * 0.03;
    degirmen.userData.kanat.rotation.z -= dt * 0.9;
    bayrak.children.at(-1).rotation.y = Math.sin(s * 2.4) * 0.12;
    for (const c of musteriler) { c.m.userData.govde.position.y = Math.abs(Math.sin(s * 4 + c.faz)) * 0.05; c.m.position.z = c.z0 + Math.sin(s * 0.6 + c.faz) * 0.12; }
    canli.kare(dt, s, 30);
    if (efekt) efekt.ciz(); else renderer.render(sahne, kamera);
  }
  kare = requestAnimationFrame(dongu);

  return {
    hazir, gece: 0, alaca: 0,
    durdur() { calisiyor = false; cancelAnimationFrame(kare); ro.disconnect(); io.disconnect(); efekt?.yokEt(); renderer.dispose(); renderer.forceContextLoss(); tuval.remove(); },
  };
}
