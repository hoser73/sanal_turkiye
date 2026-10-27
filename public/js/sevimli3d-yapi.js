// Sevimli tarz yapılar, hayvanlar, süsler ve ek ekinler (sevimli3d.js kitinin devamı). Ölçüler metre; her yapı kendi
// tabanının ortasında, ön yüzü +z yönünde kurulur. Yapı kurucuları { g, baca? } değil doğrudan Group döndürür;
// bacalı yapılarda bacanın tepesi g.userData.baca'dadır (duman için).
import * as THREE from '/vendor/three/three.module.js';
import { RENK, malz, golgeli, yuvarlakKutu, parca, ornekli, yaprakGeo, kureGeo, yuvarlakAgac, cit, kasaYigini } from './sevimli3d.js';

const kutuP = (g, y, d, renk, x, yy, z, r = 0.1) => parca(yuvarlakKutu(g, y, d, r), renk, x, yy, z);
// Üçgen çatı: gen (x), der (z) boyunca, tepe yüksekliği h
function cati(gen, der, h, renk) {
  const s = new THREE.Shape(); s.moveTo(-gen / 2, 0); s.lineTo(0, h); s.lineTo(gen / 2, 0); s.lineTo(-gen / 2, 0);
  const geo = new THREE.ExtrudeGeometry(s, { depth: der, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.12, bevelSegments: 2 }).translate(0, 0, -der / 2);
  return new THREE.Mesh(geo, malz(renk));
}
function pencere(g, x, y, z, { gen = 0.9, yuk = 1.0, isik = false } = {}) {
  g.add(kutuP(gen + 0.24, yuk + 0.24, 0.12, RENK.beyaz, x, y, z, 0.05));
  g.add(kutuP(gen, yuk, 0.14, isik ? '#ffd27a' : '#6fb7d8', x, y, z + 0.01, 0.04));
  g.add(kutuP(0.08, yuk, 0.16, RENK.beyaz, x, y, z + 0.02, 0.02));
}
// Çatı kiremit sıraları: iki eğimde, saçaktan mahyaya üst üste binen yuvarlak şeritler (çatı rengi biraz koyu)
function kiremitler(g, gen, der, h, y0, renk) {
  const koyu = new THREE.Color(renk).multiplyScalar(0.82).getStyle(), egim = Math.atan2(h, gen / 2), uz = Math.hypot(gen / 2, h);
  const n = Math.max(3, Math.round(uz / 0.55));
  for (const yon of [-1, 1]) for (let k = 0; k < n; k++) {
    const d = (k + 0.5) * (uz / n), m = kutuP(0.42, 0.1, der + 0.2, k % 2 ? koyu : renk, yon * (gen / 2 - d * Math.cos(egim)), y0 + d * Math.sin(egim) + 0.1, 0, 0.05);
    m.rotation.z = -yon * egim; g.add(m);
  }
}
// Pencere önü saksısı: ahşap kutu ve renkli çiçekler
function saksi(g, x, y, z, r = Math.random) {
  g.add(kutuP(1.05, 0.22, 0.3, RENK.tahta, x, y, z, 0.05));
  ['#e2483a', '#f2c230', '#f07ab0', '#ffffff'].forEach((renk, i) => { const m = parca(kureGeo, renk, x - 0.36 + i * 0.24, y + 0.2, z + (r() - 0.5) * 0.06); m.scale.setScalar(0.2); g.add(m); });
  for (let i = 0; i < 3; i++) { const m = parca(kureGeo, RENK.yaprak, x - 0.3 + i * 0.3, y + 0.13, z + 0.06); m.scale.set(0.24, 0.14, 0.16); g.add(m); }
}
const kapi = (g, x, z, renk = '#9a5b34', gen = 1.1, yuk = 1.9) => { g.add(kutuP(gen + 0.2, yuk + 0.12, 0.12, RENK.beyaz, x, yuk / 2, z, 0.05)); g.add(kutuP(gen, yuk, 0.16, renk, x, yuk / 2, z + 0.01, 0.05)); };

// ---------- Yapılar
export function ev({ catiRenk = '#e2574c', duvar = '#fbe9cf', gece = 0 } = {}) {
  const g = new THREE.Group();
  g.add(kutuP(5.2, 3.0, 4.2, duvar, 0, 1.5, 0, 0.18));
  g.add(kutuP(5.3, 0.45, 4.3, '#d9c3a3', 0, 0.22, 0, 0.12));          // taş subasman
  const c = cati(6.0, 5.0, 2.3, catiRenk); c.position.y = 2.95; g.add(c);
  kiremitler(g, 6.0, 5.0, 2.3, 2.95, catiRenk);
  g.add(kutuP(0.7, 1.6, 0.7, '#c9b39a', 1.5, 4.6, -0.6, 0.08));      // baca
  g.add(kutuP(0.9, 0.16, 0.9, '#a8957d', 1.5, 5.45, -0.6, 0.05));
  const yuvarlak = parca(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 20).rotateX(Math.PI / 2), RENK.beyaz, 0, 3.75, 2.55); g.add(yuvarlak);
  g.add(parca(new THREE.CylinderGeometry(0.32, 0.32, 0.14, 20).rotateX(Math.PI / 2), gece > 0.5 ? '#ffd27a' : '#6fb7d8', 0, 3.75, 2.57));
  kapi(g, -0.9, 2.12, '#a3653a');
  g.add(parca(new THREE.SphereGeometry(0.07, 8, 6), '#f2c45a', -0.55, 0.95, 2.24));   // kapı tokmağı
  pencere(g, 1.2, 1.7, 2.12, { isik: gece > 0.5 });
  saksi(g, 1.2, 1.02, 2.3);
  pencere(g, -2.62, 1.7, 0, { isik: gece > 0.5 });
  g.add(kutuP(1.7, 0.18, 1.0, '#c9b39a', -0.9, 0.09, 2.6, 0.06));   // basamak
  for (const x of [-2.2, 2.2]) { const cl = parca(kureGeo, RENK.agac, x, 0.45, 2.45); cl.scale.set(0.9, 0.8, 0.8); g.add(cl); }   // kapı önü çalıları
  // Ayrıntılar: panjurlar, denizlik, köşe taşları, mahya, kapı lambası, saçak altı süs şeridi
  const panjur = '#4f9a6a';
  for (const dx of [-0.78, 0.78]) g.add(kutuP(0.42, 1.2, 0.1, panjur, 1.2 + dx, 1.7, 2.16, 0.04));
  for (const dz of [-0.78, 0.78]) g.add(kutuP(0.1, 1.2, 0.42, panjur, -2.66, 1.7, dz, 0.04));
  g.add(kutuP(1.3, 0.12, 0.3, RENK.beyaz, 1.2, 1.08, 2.2, 0.04));
  for (const x of [-2.6, 2.6]) for (const z of [-2.1, 2.1]) for (let k = 0; k < 4; k++) g.add(kutuP(0.34, 0.5, 0.34, k % 2 ? '#e8d4b4' : '#efe0c6', x, 0.75 + k * 0.62, z, 0.05));
  g.add(kutuP(0.42, 0.3, 5.3, new THREE.Color(catiRenk).multiplyScalar(0.7).getStyle(), 0, 5.3, 0, 0.12));
  g.add(kutuP(5.9, 0.16, 0.16, RENK.beyaz, 0, 2.98, 2.18, 0.05));
  g.add(kutuP(0.22, 0.32, 0.18, '#3a3e47', -1.85, 2.15, 2.2, 0.04));
  g.add(parca(new THREE.SphereGeometry(0.11, 10, 8), gece > 0.5 ? '#ffe6a0' : '#fff6d8', -1.85, 2.0, 2.26));
  g.userData.baca = new THREE.Vector3(1.5, 5.6, -0.6);
  return golgeli(g);
}
export function apartman({ catiRenk = '#5d7fb0', gece = 0 } = {}) {
  const g = new THREE.Group();
  g.add(kutuP(5.6, 9.0, 4.6, '#f3e3cc', 0, 4.5, 0, 0.25));
  g.add(kutuP(6.0, 0.5, 5.0, catiRenk, 0, 9.2, 0, 0.18));
  for (let kat = 0; kat < 3; kat++) for (const x of [-1.5, 1.5]) pencere(g, x, 1.9 + kat * 2.6, 2.32, { gen: 1.0, yuk: 1.2, isik: gece > 0.5 && (kat + x) % 2 === 0 });
  kapi(g, 0, 2.32, '#6d5440', 1.2, 2.0);
  return golgeli(g);
}
export function pansiyon({ catiRenk = '#3f8f8a', gece = 0 } = {}) {
  const g = new THREE.Group();
  g.add(kutuP(6.4, 5.2, 4.4, '#fff4e2', 0, 2.6, 0, 0.2));
  const c = cati(7.2, 5.2, 2.4, catiRenk); c.position.y = 5.15; g.add(c);
  for (const x of [-2, 0, 2]) pencere(g, x, 3.7, 2.22, { isik: gece > 0.5 });
  kapi(g, -1.2, 2.22, '#3f8f8a'); pencere(g, 1.5, 1.4, 2.22);
  g.add(kutuP(6.6, 0.15, 0.9, RENK.tahta, 0, 2.5, 2.6, 0.05));   // balkon
  for (let i = 0; i < 9; i++) g.add(kutuP(0.08, 0.6, 0.08, RENK.beyaz, -3.1 + i * 0.775, 2.85, 3.0, 0.02));
  return golgeli(g);
}
// Dükkân / restoran: çizgili tenteli cephe
export function dukkan({ tente = RENK.tente, restoran = false, gece = 0 } = {}) {
  const g = new THREE.Group();
  g.add(kutuP(5.6, 3.6, 4.2, restoran ? '#fde2c4' : '#eaf3f7', 0, 1.8, 0, 0.2));
  g.add(kutuP(6.0, 0.4, 4.6, '#8d6e5a', 0, 3.75, 0, 0.12));
  g.add(kutuP(3.4, 1.8, 0.14, gece > 0.5 ? '#ffd27a' : '#86c8e3', 0.9, 1.5, 2.12, 0.05));
  kapi(g, -1.8, 2.12, '#6d5440', 1.0, 2.0);
  const serit = 8;
  for (let i = 0; i < serit; i++) { const m = kutuP(5.8 / serit, 0.12, 1.4, i % 2 ? tente : RENK.beyaz, -2.9 + (i + 0.5) * (5.8 / serit), 3.0, 2.7, 0.03); m.rotation.x = 0.35; g.add(m); }
  if (restoran) for (const x of [-1.6, 1.8]) {
    g.add(parca(new THREE.CylinderGeometry(0.55, 0.55, 0.08, 16), RENK.beyaz, x, 0.8, 4.4), parca(new THREE.CylinderGeometry(0.06, 0.06, 0.8, 8), '#6c707a', x, 0.4, 4.4));
    g.add(parca(new THREE.ConeGeometry(1.2, 0.6, 12), x < 0 ? RENK.traktor : RENK.tente, x, 2.4, 4.4), parca(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6), '#6c707a', x, 1.6, 4.4));
  }
  return golgeli(g);
}
export function depo() {
  const g = new THREE.Group();
  g.add(kutuP(7.0, 3.8, 5.2, '#d7dde2', 0, 1.9, 0, 0.2));
  const c = cati(5.6, 7.4, 1.2, '#9aa7b1'); c.rotation.y = Math.PI / 2; c.position.y = 3.75; g.add(c);
  g.add(kutuP(3.0, 2.6, 0.14, '#7d8a95', 0, 1.3, 2.62, 0.06));
  for (let i = 0; i < 5; i++) g.add(kutuP(2.9, 0.06, 0.16, '#6c7883', 0, 0.4 + i * 0.5, 2.64, 0.02));
  return golgeli(g);
}
export function fabrika() {
  const g = depo();
  g.add(parca(new THREE.CylinderGeometry(0.55, 0.7, 7.5, 12), '#c96a4e', 2.4, 3.75, -1.5));
  for (const y of [5.4, 6.6]) g.add(parca(new THREE.CylinderGeometry(0.62, 0.62, 0.3, 12), RENK.beyaz, 2.4, y, -1.5));
  g.userData.baca = new THREE.Vector3(2.4, 7.8, -1.5);
  return golgeli(g);
}
export function firin({ gece = 0 } = {}) {
  const g = ev({ catiRenk: '#b9653a', duvar: '#fff1dc', gece });
  const kubbe = parca(new THREE.SphereGeometry(1.3, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), '#d7b08a', -3.6, 0, 0.8);
  g.add(kubbe, parca(new THREE.CircleGeometry(0.5, 12), '#3a2a20', -3.6, 0.5, 2.08));
  return golgeli(g);
}
// Yel değirmeni: konik gövde, dönen dört kanat (g.userData.kanat)
export function degirmen() {
  const g = new THREE.Group();
  g.add(parca(new THREE.CylinderGeometry(1.4, 2.2, 6.5, 14), '#fff4e2', 0, 3.25, 0));
  g.add(parca(new THREE.ConeGeometry(1.8, 1.8, 14), '#d9574a', 0, 7.4, 0));
  kapi(g, 0, 2.05, '#a3653a', 0.9, 1.7);
  const kanat = new THREE.Group(); kanat.position.set(0, 6.0, 1.9);
  for (let i = 0; i < 4; i++) { const k = kutuP(0.9, 3.8, 0.1, i % 2 ? RENK.beyaz : '#f6e3c4', 0, 2.1, 0, 0.05); const p = new THREE.Group(); p.rotation.z = (i * Math.PI) / 2; p.add(k); kanat.add(p); }
  kanat.add(parca(new THREE.SphereGeometry(0.35, 12, 8), '#8d6e5a'));
  g.add(kanat); g.userData.kanat = kanat;
  return golgeli(g);
}
// Cam sera: yarı saydam tonoz, içinde yeşil fide sıraları
export function sera(r) {
  const g = new THREE.Group();
  g.add(kutuP(6.2, 0.3, 4.2, '#bfc6cc', 0, 0.15, 0, 0.08));
  for (const x of [-2.2, 0, 2.2]) for (let k = 0; k < 6; k++) { const b = parca(kureGeo, k % 2 ? RENK.yaprak : RENK.yaprakKoyu, x, 0.55, -1.5 + k * 0.6); b.scale.set(0.7, 0.45, 0.5); g.add(b); }
  const cam = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 6.0, 18, 1, true, 0, Math.PI).rotateZ(Math.PI / 2),   // x boyunca uzanan, kemerlerin üstünü örten yarım silindir
    new THREE.MeshLambertMaterial({ color: '#d8f1f7', transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }));
  cam.scale.set(1, 1.15, 1); cam.position.y = 0.3; cam.renderOrder = 2; g.add(cam);
  for (const x of [-3, -1, 1, 3]) { const k = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.07, 6, 18, Math.PI).rotateY(Math.PI / 2), malz(RENK.beyaz)); k.position.set(x, 0.3, 0); k.scale.set(1, 1.15, 1); g.add(k); }
  // Ahşap taban kirişi, uçta kapı ve sırık domatesler (kırmızı meyve noktaları)
  for (const z of [-2.15, 2.15]) g.add(kutuP(6.4, 0.3, 0.22, RENK.tahta, 0, 0.32, z, 0.06));
  g.add(kutuP(0.12, 1.9, 1.2, RENK.beyaz, 3.06, 1.25, 0, 0.04)); g.add(kutuP(0.14, 1.7, 1.0, '#cfeff5', 3.07, 1.2, 0, 0.04));
  for (const x of [-2.2, 0, 2.2]) for (let k = 0; k < 6; k++) if (r ? r() < 0.6 : k % 2) { const m = parca(kureGeo, '#e8433a', x + 0.25, 0.8, -1.5 + k * 0.6); m.scale.setScalar(0.2); g.add(m); }
  return golgeli(g);
}
export function suKulesi() {
  const g = new THREE.Group();
  for (const [x, z] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) g.add(kutuP(0.22, 4.2, 0.22, RENK.tahtaKoyu, x, 2.1, z, 0.05));
  g.add(parca(new THREE.CylinderGeometry(1.5, 1.5, 2.0, 18), '#5fb4e0', 0, 5.1, 0));
  g.add(parca(new THREE.ConeGeometry(1.7, 0.9, 18), '#3d8fc4', 0, 6.55, 0));
  for (const y of [4.5, 5.6]) g.add(parca(new THREE.CylinderGeometry(1.53, 1.53, 0.12, 18), RENK.beyaz, 0, y, 0));
  // Çapraz destekler, merdiven ve tepedeki küçük topuz
  for (const [x, z, ry] of [[0, -0.9, 0], [0, 0.9, 0], [-0.9, 0, Math.PI / 2], [0.9, 0, Math.PI / 2]]) for (const a of [0.72, -0.72]) {
    const c = kutuP(0.1, 2.5, 0.08, RENK.tahta, x, 2.1, z, 0.03); c.rotation.set(0, ry, a); g.add(c);
  }
  for (const x of [-0.32, 0.32]) g.add(kutuP(0.08, 4.4, 0.08, '#8a8f99', x, 2.2, 1.12, 0.03));
  for (let k = 0; k < 10; k++) g.add(kutuP(0.64, 0.06, 0.06, '#8a8f99', 0, 0.35 + k * 0.42, 1.12, 0.02));
  g.add(parca(new THREE.SphereGeometry(0.18, 10, 8), '#f2c45a', 0, 7.05, 0));
  return golgeli(g);
}
export function gunesPaneli() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const p = kutuP(2.2, 0.12, 1.4, '#2f5f9e', -2.6 + i * 2.6, 1.1, 0, 0.04); p.rotation.x = -0.5; g.add(p);
    g.add(kutuP(0.12, 1.0, 0.12, '#8a8f99', -2.6 + i * 2.6, 0.5, 0.2, 0.03));
    for (let k = 0; k < 2; k++) { const c = kutuP(2.16, 0.02, 0.02, '#cfe0f2', -2.6 + i * 2.6, 1.17 + (k - 0.5) * 0.3, (k - 0.5) * 0.6 * 0.88, 0.005); c.rotation.x = -0.5; g.add(c); }
  }
  return golgeli(g);
}
// İnşaat: ahşap iskelet, tahta yığını ve kasalar
export function iskele(r) {
  const g = new THREE.Group();
  for (const [x, z] of [[-2, -1.6], [2, -1.6], [-2, 1.6], [2, 1.6]]) g.add(kutuP(0.3, 3.2, 0.3, RENK.tahta, x, 1.6, z, 0.06));
  for (const z of [-1.6, 1.6]) g.add(kutuP(4.4, 0.3, 0.3, RENK.tahtaKoyu, 0, 3.0, z, 0.06));
  for (const x of [-2, 2]) g.add(kutuP(0.3, 0.3, 3.5, RENK.tahtaKoyu, x, 3.0, 0, 0.06));
  const capraz = kutuP(4.6, 0.25, 0.25, RENK.tahta, 0, 1.6, 1.6, 0.05); capraz.rotation.z = 0.6; g.add(capraz);
  for (let i = 0; i < 4; i++) g.add(kutuP(2.6, 0.2, 0.5, RENK.tahta, 3.2, 0.1 + i * 0.22, -0.4 + (i % 2) * 0.1, 0.04));
  const k = kasaYigini(2, null, r); k.position.set(-3.1, 0, 1.0); k.scale.setScalar(1.3); g.add(k);
  g.add(parca(new THREE.CylinderGeometry(0.5, 0.6, 0.9, 12), '#5fa3d6', -0.4, 0.45, 0.2));
  return golgeli(g);
}

// ---------- Hayvanlar
// Küçük kır hayvanları (çiftliğin çevresinde dolaşan süs): tavşan, kirpi, ördek. Ön yüz +z.
export function tavsan(renk = '#f4efe6') {
  const g = new THREE.Group(), ic = '#f6b8c4';
  const govde = parca(kureGeo, renk, 0, 0.32, -0.05); govde.scale.set(0.55, 0.5, 0.68); g.add(govde);
  const bas = parca(kureGeo, renk, 0, 0.62, 0.28); bas.scale.set(0.42, 0.4, 0.42); g.add(bas);
  for (const x of [-0.09, 0.09]) {
    const k = kutuP(0.12, 0.42, 0.07, renk, x, 0.98, 0.22, 0.05); k.rotation.z = x * 1.6; k.rotation.x = -0.15; g.add(k);
    const ki = kutuP(0.06, 0.3, 0.02, ic, x, 0.97, 0.26, 0.02); ki.rotation.z = x * 1.6; ki.rotation.x = -0.15; g.add(ki);
    g.add(parca(new THREE.SphereGeometry(0.035, 8, 6), '#222', x * 1.1, 0.67, 0.47));
  }
  g.add(parca(new THREE.SphereGeometry(0.035, 8, 6), ic, 0, 0.6, 0.5));
  const kuyruk = parca(kureGeo, '#ffffff', 0, 0.36, -0.42); kuyruk.scale.setScalar(0.18); g.add(kuyruk);
  for (const x of [-0.14, 0.14]) { const a = parca(kureGeo, renk, x, 0.08, 0.18); a.scale.set(0.12, 0.08, 0.2); g.add(a); }
  return golgeli(g);
}
export function kirpi() {
  const g = new THREE.Group();
  const sirt = parca(new THREE.IcosahedronGeometry(0.5, 1), '#7a5a3e', 0, 0.2, -0.05); sirt.scale.set(0.6, 0.42, 0.7); g.add(sirt);
  const diken = [];
  for (let i = 0; i < 26; i++) { const u = (i / 26) * Math.PI * 2 * 3.3, v = 0.25 + (i % 5) * 0.14; diken.push([Math.cos(u) * 0.28 * (1 - v * 0.5), 0.2 + v * 0.22, -0.05 + Math.sin(u) * 0.3 * (1 - v * 0.4) - 0.04, 0, 1, 1, -0.5 + v * 0.3, Math.cos(u) * 0.6]); }
  g.add(ornekli(new THREE.ConeGeometry(0.045, 0.2, 4), '#5a3f2a', diken, { golge: false }));
  const yuz = parca(new THREE.ConeGeometry(0.17, 0.32, 10).rotateX(Math.PI / 2), '#e3c49a', 0, 0.16, 0.3); g.add(yuz);
  g.add(parca(new THREE.SphereGeometry(0.04, 8, 6), '#222', 0, 0.16, 0.47));
  for (const x of [-0.07, 0.07]) g.add(parca(new THREE.SphereGeometry(0.025, 8, 6), '#222', x, 0.23, 0.33));
  return golgeli(g);
}
export function ordek() {
  const g = new THREE.Group();
  const govde = parca(kureGeo, '#fbfaf4', 0, 0.2, 0); govde.scale.set(0.42, 0.32, 0.6); g.add(govde);
  const kuyruk = parca(new THREE.ConeGeometry(0.1, 0.22, 6).rotateX(-Math.PI / 2 - 0.6), '#fbfaf4', 0, 0.3, -0.32); g.add(kuyruk);
  const bas = parca(kureGeo, '#2f8f5b', 0, 0.48, 0.24); bas.scale.setScalar(0.28); g.add(bas);
  g.add(kutuP(0.12, 0.05, 0.16, '#f2a03a', 0, 0.45, 0.4, 0.02));
  for (const x of [-0.08, 0.08]) g.add(parca(new THREE.SphereGeometry(0.025, 8, 6), '#222', x, 0.52, 0.34));
  g.add(kutuP(0.44, 0.04, 0.12, '#c7c0ae', 0, 0.3, 0.05, 0.02));   // boyun halkası yerine kanat çizgisi
  return golgeli(g);
}
export function inek(alaca = true) {
  const g = new THREE.Group();
  g.add(kutuP(1.1, 0.9, 1.8, alaca ? '#ffffff' : '#9a6a44', 0, 1.0, 0, 0.35));
  if (alaca) { g.add(kutuP(1.12, 0.5, 0.6, '#3a3330', 0, 1.15, 0.2, 0.2)); g.add(kutuP(0.6, 0.4, 0.5, '#3a3330', 0.3, 1.25, -0.5, 0.15)); }
  const bas = new THREE.Group(); bas.position.set(0, 1.45, 1.0);
  bas.add(kutuP(0.8, 0.75, 0.75, alaca ? '#ffffff' : '#9a6a44', 0, 0, 0, 0.25), kutuP(0.7, 0.4, 0.3, '#f4b4b0', 0, -0.18, 0.38, 0.12));
  for (const x of [-0.5, 0.5]) bas.add(kutuP(0.3, 0.12, 0.2, '#f1d9b8', x, 0.3, -0.05, 0.05));
  for (const x of [-0.18, 0.18]) bas.add(parca(new THREE.SphereGeometry(0.06, 8, 6), '#222', x, 0.12, 0.38));
  g.add(bas); g.userData.bas = bas;
  for (const [x, z] of [[-0.35, -0.6], [0.35, -0.6], [-0.35, 0.6], [0.35, 0.6]]) g.add(kutuP(0.24, 0.6, 0.24, alaca ? '#f1f1f1' : '#8a5c3a', x, 0.3, z, 0.08));
  return golgeli(g);
}
export function koyun() {
  const g = new THREE.Group(), yun = new THREE.IcosahedronGeometry(0.42, 1);
  [[0, 0.75, 0, 1.25], [0.35, 0.8, 0.3, 0.9], [-0.35, 0.8, -0.3, 0.9], [0, 0.95, -0.4, 0.9], [0, 0.95, 0.4, 0.85]].forEach(([x, y, z, s]) => { const m = parca(yun, '#f6f2e8', x, y, z); m.scale.setScalar(s); g.add(m); });
  g.add(kutuP(0.42, 0.42, 0.5, '#3d3633', 0, 0.95, 0.75, 0.15));
  for (const [x, z] of [[-0.25, -0.3], [0.25, -0.3], [-0.25, 0.3], [0.25, 0.3]]) g.add(kutuP(0.13, 0.5, 0.13, '#3d3633', x, 0.25, z, 0.05));
  return golgeli(g);
}
export function tavuk(renk = '#ffffff') {
  const g = new THREE.Group();
  const govde = parca(new THREE.SphereGeometry(0.32, 12, 10), renk, 0, 0.42, 0); govde.scale.set(0.9, 0.85, 1.1); g.add(govde);
  g.add(parca(new THREE.SphereGeometry(0.2, 10, 8), renk, 0, 0.72, 0.22), kutuP(0.08, 0.14, 0.14, '#e33b2e', 0, 0.92, 0.22, 0.03));
  g.add(parca(new THREE.ConeGeometry(0.06, 0.14, 6).rotateX(Math.PI / 2), '#f2a93b', 0, 0.7, 0.44));
  for (const x of [-0.1, 0.1]) g.add(kutuP(0.05, 0.2, 0.05, '#f2a93b', x, 0.1, 0, 0.02));
  return golgeli(g);
}
export function kumes(r) {
  const g = new THREE.Group();
  g.add(kutuP(2.6, 1.6, 2.0, '#f2d7a4', 0, 1.1, -1.2, 0.12));
  const c = cati(3.1, 2.4, 1.0, '#d9574a'); c.position.set(0, 1.9, -1.2); g.add(c);
  for (const [x, z] of [[-0.9, -1.9], [0.9, -1.9], [-0.9, -0.5], [0.9, -0.5]]) g.add(kutuP(0.16, 0.5, 0.16, RENK.tahtaKoyu, x, 0.25, z, 0.04));
  const rampa = kutuP(0.6, 0.06, 1.1, RENK.tahta, 0, 0.3, 0.2, 0.02); rampa.rotation.x = 0.5; g.add(rampa);
  g.userData.tavuklar = [];
  for (let i = 0; i < 4; i++) { const t = tavuk(i % 3 ? '#ffffff' : '#c47a3a'); t.position.set(-1.6 + r() * 3.2, 0, 0.8 + r() * 1.6); t.rotation.y = r() * 6.28; g.add(t); g.userData.tavuklar.push(t); }
  return golgeli(g);
}

// ---------- Ek ekinler (örnekli). noktalar: [[x, z]]; b: büyüme 0..1
export function bugdayTarhi(noktalar, r, b = 1) {
  // Gür başak tarlası: her noktada eğik duran 8-9 sap, uçta uzun başak (iki ton), dipte örtü tutamı ve birkaç yaprak.
  // Olgunlaştıkça yeşilden altın sarısına döner; saplar rüzgârda dalgalanır.
  const olgun = b > 0.7, sap = [], basA = [], basB = [], dip = [], yap = [];
  const e = new THREE.Euler(), v = new THREE.Vector3();
  for (const [x, z] of noktalar) {
    dip.push([x, 0.05, z, r() * 6, 0.62 + r() * 0.2, 0.32 + b * 0.25]);
    for (let k = 0; k < 9; k++) {
      const xx = x + (r() - 0.5) * 0.95, zz = z + (r() - 0.5) * 0.95, boy = (0.55 + b * 0.85) * (0.82 + r() * 0.34);
      const rx = (r() - 0.5) * 0.3, rz = (r() - 0.5) * 0.3, ry = r() * 6.28;
      sap.push([xx, 0, zz, ry, 0.75, boy, rx, rz]);
      if (b > 0.35) {
        e.set(rx, ry, rz); v.set(0, boy + 0.02, 0).applyEuler(e);
        (r() < 0.5 ? basA : basB).push([xx + v.x, v.y, zz + v.z, ry, 0.11 + b * 0.03, 0.36 + b * 0.08, rx * 1.4, rz * 1.4]);
      }
    }
    if (r() < 0.5) yap.push([x + (r() - 0.5) * 0.6, 0.1, z + (r() - 0.5) * 0.6, r() * 6.28, 0.45, 0.3]);
  }
  const g = new THREE.Group();
  g.add(ornekli(new THREE.CylinderGeometry(0.022, 0.034, 1, 5).translate(0, 0.5, 0), olgun ? '#d6b04a' : '#94c650', sap, { golge: false, ruzgar: 0.14 }));
  g.add(ornekli(new THREE.IcosahedronGeometry(0.5, 1), olgun ? '#c9a23e' : '#7fb847', dip, { golge: true, ruzgar: 0.05 }));
  if (yap.length) g.add(ornekli(yaprakGeo, olgun ? '#b9b04a' : '#7cc243', yap, { golge: false, ruzgar: 0.1 }));
  if (basA.length) g.add(ornekli(kureGeo, olgun ? '#f0cc5c' : '#b7dc63', basA, { golge: true, ruzgar: 0.14 }));
  if (basB.length) g.add(ornekli(kureGeo, olgun ? '#e2b445' : '#a5d158', basB, { golge: true, ruzgar: 0.14 }));
  return g;
}
// Çay ya da pamuk: yuvarlak çalı sıraları; pamukta beyaz kozalar
export function caliTarhi(noktalar, r, b = 1, { pamuk = false } = {}) {
  const cali = [], koza = [];
  for (const [x, z] of noktalar) {
    const s = 0.5 + b * 0.5;
    cali.push([x, 0.35 * s, z, r() * 6, 0.95 * s, 0.75 * s]);
    if (pamuk && b > 0.5) for (let k = 0; k < 5; k++) koza.push([x + (r() - 0.5) * 0.6 * s, 0.55 * s + r() * 0.2, z + (r() - 0.5) * 0.6 * s, 0, 0.16]);
  }
  const g = new THREE.Group();
  g.add(ornekli(new THREE.IcosahedronGeometry(0.5, 1), pamuk ? '#7fb85a' : '#3f9a4a', cali, { ruzgar: 0.04 }));
  if (koza.length) g.add(ornekli(kureGeo, '#fbf8f0', koza, { golge: false }));
  return g;
}
// Bağ: tel direkleri, yeşil asma ve mor salkımlar
export function bagTarhi(siralar, uzunluk, r, b = 1) {
  const g = new THREE.Group(), yap = [], salkim = [];
  for (const z of siralar) {
    for (let x = -uzunluk / 2; x <= uzunluk / 2 + 0.01; x += uzunluk / 4) g.add(kutuP(0.1, 1.6, 0.1, RENK.tahtaKoyu, x, 0.8, z, 0.03));
    g.add(kutuP(uzunluk, 0.03, 0.03, '#8a8f99', 0, 1.4, z, 0.01));
    for (let x = -uzunluk / 2; x < uzunluk / 2; x += 0.45) {
      yap.push([x, 1.1 + r() * 0.3, z + (r() - 0.5) * 0.25, r() * 6.28, 0.45 * (0.5 + b * 0.5), 0.5]);
      if (b > 0.55 && r() < 0.45) salkim.push([x, 0.95, z + 0.15, 0, 0.18, 0.28]);
    }
  }
  g.add(ornekli(yaprakGeo, RENK.yaprak, yap, { ruzgar: 0.05 }));
  if (salkim.length) g.add(ornekli(kureGeo, '#7b3f8c', salkim, { golge: false }));
  return golgeli(g);
}
// Meyve ağacı: yuvarlak taç ve renkli meyveler
export function meyveAgaci(r, meyve, b = 1, { gumus = false } = {}) {
  const a = yuvarlakAgac(r, 0.45 + b * 0.55);
  if (gumus) a.traverse((c) => { if (c.isMesh && c.material !== malz(RENK.govde)) c.material = malz(c.material === malz(RENK.agac) ? '#9fbf86' : '#86a874'); });
  if (meyve && b > 0.5) for (let i = 0; i < 9; i++) {
    const t = r() * 6.28, y = 1.3 + r() * 1.1, d = 0.9 + r() * 0.3;
    const m = parca(kureGeo, meyve, Math.cos(t) * d, y, Math.sin(t) * d); m.scale.setScalar(0.24); m.castShadow = false; a.add(m);
  }
  return a;
}

// ---------- Süsler
export function korkuluk() {
  const g = new THREE.Group();
  g.add(kutuP(0.14, 2.2, 0.14, RENK.tahtaKoyu, 0, 1.1, 0, 0.04), kutuP(1.7, 0.12, 0.12, RENK.tahtaKoyu, 0, 1.5, 0, 0.04));
  g.add(kutuP(0.8, 0.8, 0.45, '#d9574a', 0, 1.4, 0, 0.15), parca(new THREE.SphereGeometry(0.33, 12, 10), '#f1cf63', 0, 2.05, 0));
  g.add(parca(new THREE.CylinderGeometry(0.55, 0.55, 0.05, 14), '#c9a24a', 0, 2.3, 0), parca(new THREE.CylinderGeometry(0.25, 0.3, 0.3, 12), '#c9a24a', 0, 2.45, 0));
  return golgeli(g);
}
export function kuyu() {
  const g = new THREE.Group();
  g.add(parca(new THREE.CylinderGeometry(0.9, 1.0, 0.9, 16), '#c9c4b8', 0, 0.45, 0), parca(new THREE.CircleGeometry(0.75, 16).rotateX(-Math.PI / 2), '#4f9fd1', 0, 0.85, 0));
  for (const x of [-0.85, 0.85]) g.add(kutuP(0.14, 1.6, 0.14, RENK.tahtaKoyu, x, 1.5, 0, 0.04));
  const c = cati(2.2, 1.4, 0.7, '#d9574a'); c.position.y = 2.25; g.add(c);
  return golgeli(g);
}
export function cesme() {
  const g = new THREE.Group();
  g.add(parca(new THREE.CylinderGeometry(1.4, 1.5, 0.6, 20), '#d9d4c8', 0, 0.3, 0), parca(new THREE.CircleGeometry(1.2, 20).rotateX(-Math.PI / 2), '#6cc3e8', 0, 0.58, 0));
  g.add(parca(new THREE.CylinderGeometry(0.2, 0.25, 1.2, 10), '#d9d4c8', 0, 1.0, 0), parca(new THREE.CylinderGeometry(0.6, 0.4, 0.25, 14), '#d9d4c8', 0, 1.6, 0));
  g.add(parca(new THREE.SphereGeometry(0.22, 10, 8), '#9fe0f5', 0, 1.85, 0));
  return golgeli(g);
}
export function bank() {
  const g = new THREE.Group();
  g.add(kutuP(1.8, 0.12, 0.6, RENK.tahta, 0, 0.5, 0, 0.04), kutuP(1.8, 0.5, 0.1, RENK.tahta, 0, 0.85, -0.28, 0.04));
  for (const x of [-0.75, 0.75]) g.add(kutuP(0.1, 0.5, 0.5, '#5b5f69', x, 0.25, 0, 0.03));
  return golgeli(g);
}
export function odunYigini() {
  const g = new THREE.Group();
  for (let k = 0; k < 3; k++) for (let i = 0; i < 4 - k; i++) g.add(parca(new THREE.CylinderGeometry(0.22, 0.22, 1.4, 10).rotateX(Math.PI / 2), i % 2 ? '#b07a45' : '#c98f55', -0.66 + i * 0.44 + k * 0.22, 0.22 + k * 0.38, 0));
  return golgeli(g);
}
export function bayrakDiregi() {
  const g = new THREE.Group();
  g.add(parca(new THREE.CylinderGeometry(0.06, 0.08, 5, 10), '#d5d9de', 0, 2.5, 0), parca(new THREE.SphereGeometry(0.12, 10, 8), '#f2c94c', 0, 5.05, 0));
  const c = document.createElement('canvas'); c.width = 96; c.height = 64; const x = c.getContext('2d');
  x.fillStyle = '#e30a17'; x.fillRect(0, 0, 96, 64); x.fillStyle = '#fff'; x.beginPath(); x.arc(34, 32, 16, 0, 7); x.fill();
  x.fillStyle = '#e30a17'; x.beginPath(); x.arc(38, 32, 12.8, 0, 7); x.fill(); x.fillStyle = '#fff'; x.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? 2.6 : 6.4; x.lineTo(58 + Math.cos(a) * rr, 32 + Math.sin(a) * rr); } x.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const bez = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.2, 8, 2), new THREE.MeshLambertMaterial({ map: t, side: THREE.DoubleSide }));
  const p = bez.geometry.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin((p.getX(i) + 0.9) * 3) * 0.1 * (p.getX(i) + 0.9));
  bez.geometry.computeVertexNormals(); bez.position.set(0.95, 4.3, 0); g.add(bez);
  return golgeli(g);
}
export function kardanAdam() {
  const g = new THREE.Group();
  [[0, 0.55, 0.6], [0, 1.4, 0.42], [0, 2.05, 0.3]].forEach(([x, y, s]) => g.add(parca(new THREE.SphereGeometry(s, 14, 10), '#ffffff', x, y, 0)));
  g.add(parca(new THREE.ConeGeometry(0.06, 0.35, 8).rotateX(Math.PI / 2), '#f28c28', 0, 2.05, 0.4));
  g.add(parca(new THREE.CylinderGeometry(0.25, 0.25, 0.35, 12), '#2f2f35', 0, 2.45, 0), parca(new THREE.CylinderGeometry(0.4, 0.4, 0.05, 12), '#2f2f35', 0, 2.3, 0));
  g.add(kutuP(0.9, 0.16, 0.16, '#d9574a', 0, 1.75, 0.1, 0.05));
  return golgeli(g);
}
export function cicekTarhi(r) {
  const g = new THREE.Group();
  g.add(kutuP(2.0, 0.35, 1.0, RENK.tahta, 0, 0.17, 0, 0.06), kutuP(1.8, 0.1, 0.8, RENK.toprakKoyu, 0, 0.36, 0, 0.04));
  ['#e2483a', '#f2c230', '#f07ab0', '#ffffff', '#b16ae0', '#f28c28'].forEach((renk, i) => { const m = parca(kureGeo, renk, -0.7 + i * 0.28, 0.55 + r() * 0.1, (r() - 0.5) * 0.4); m.scale.setScalar(0.32); g.add(m); });
  return golgeli(g);
}
export function hasatArabasi(r) {
  const g = new THREE.Group();
  g.add(kutuP(1.8, 0.6, 1.1, RENK.tahta, 0, 0.8, 0, 0.08));
  for (const x of [-0.95, 0.95]) g.add(parca(new THREE.CylinderGeometry(0.45, 0.45, 0.12, 14).rotateZ(Math.PI / 2), RENK.tahtaKoyu, x, 0.45, 0));
  for (let i = 0; i < 6; i++) { const m = parca(kureGeo, ['#f2a03a', '#ea4330', '#e9d45a'][i % 3], -0.5 + (i % 3) * 0.5, 1.2, i < 3 ? -0.2 : 0.2); m.scale.setScalar(0.42); g.add(m); }
  void r;
  return golgeli(g);
}
export function dilekAgaci(r) {
  const a = yuvarlakAgac(r, 1.15);
  ['#e2483a', '#f2c230', '#3d8fdb', '#f07ab0', '#ffffff'].forEach((renk, i) => { const m = kutuP(0.08, 0.5, 0.04, renk, Math.cos(i * 1.3) * 0.9, 1.0, Math.sin(i * 1.3) * 0.9, 0.02); a.add(m); });
  return a;
}
export { cit };

// ---------- Ev ve keyif (konut ve dinlence yapıları)
// Şezlong: yatık sırtlı ahşap uzanma koltuğu
function sezlong(g, x, z, ry = 0) {
  const s = new THREE.Group();
  s.add(kutuP(0.7, 0.1, 1.6, '#ffffff', 0, 0.36, 0.1, 0.04));
  const sirt = kutuP(0.7, 0.08, 0.7, '#ffffff', 0, 0.62, -0.78, 0.04); sirt.rotation.x = -0.6; s.add(sirt);
  for (const [a, b] of [[-0.28, 0.75], [0.28, 0.75], [-0.28, -0.55], [0.28, -0.55]]) s.add(kutuP(0.07, 0.34, 0.07, RENK.tahtaKoyu, a, 0.17, b, 0.02));
  s.position.set(x, 0, z); s.rotation.y = ry; g.add(s);
}
// Plaj şemsiyesi: direk ve dilimli tente
function semsiye(g, x, z, renk = '#f06b5b') {
  g.add(parca(new THREE.CylinderGeometry(0.05, 0.05, 2.3, 8), '#f3f0ea', x, 1.15, z));
  const t = new THREE.Mesh(new THREE.ConeGeometry(1.25, 0.55, 8, 1, true), new THREE.MeshLambertMaterial({ color: renk, side: THREE.DoubleSide }));
  t.position.set(x, 2.25, z); g.add(t);
  for (let i = 0; i < 8; i += 2) { const d = new THREE.Mesh(new THREE.ConeGeometry(1.26, 0.56, 8, 1, true, (i / 8) * Math.PI * 2, Math.PI / 4), malz('#ffffff')); d.material.side = THREE.DoubleSide; d.position.copy(t.position); g.add(d); }
}

// Bağ evi: taş duvarlı küçük ev, kiremit çatı, önünde asmalı çardak (yeşil yapraklar, mor üzüm salkımları), masa ve iki sandalye
export function bagEvi({ gece = 0 } = {}) {
  const g = new THREE.Group();
  g.add(kutuP(4.0, 2.4, 3.4, '#e9dcc4', 0, 1.2, -0.6, 0.16));
  for (let k = 0; k < 9; k++) { const t = kutuP(0.5 + (k % 3) * 0.15, 0.3, 0.06, '#d6c4a4', -1.6 + (k % 4) * 1.05, 0.35 + Math.floor(k / 4) * 0.7, 1.12, 0.05); g.add(t); }   // taş dokusu izleri
  const c = cati(4.6, 4.0, 1.8, '#c8553d'); c.position.set(0, 2.35, -0.6); g.add(c);
  const kiremitOnce = g.children.length;
  kiremitler(g, 4.6, 4.0, 1.8, 2.35, '#c8553d');
  g.children.slice(kiremitOnce).forEach((m) => { m.position.z -= 0.6; });   // çatı evin gövdesiyle hizalı
  kapi(g, -0.8, 1.12, '#8b5a33', 1.0, 1.8);
  pencere(g, 0.9, 1.45, 1.12, { gen: 0.8, yuk: 0.8, isik: gece > 0.5 });
  // Asmalı çardak: dört direk, üstte kirişler, yaprak örtüsü ve salkımlar
  for (const [x, z] of [[-1.8, 1.6], [1.8, 1.6], [-1.8, 3.6], [1.8, 3.6]]) g.add(kutuP(0.16, 2.4, 0.16, RENK.tahtaKoyu, x, 1.2, z, 0.04));
  for (const z of [1.6, 2.6, 3.6]) g.add(kutuP(3.9, 0.12, 0.14, RENK.tahta, 0, 2.42, z, 0.04));
  for (let i = 0; i < 16; i++) { const y = parca(kureGeo, i % 2 ? RENK.yaprak : RENK.yaprakKoyu, -1.6 + (i % 4) * 1.05, 2.6, 1.7 + Math.floor(i / 4) * 0.62); y.scale.set(1.0, 0.35, 0.8); g.add(y); }
  for (let i = 0; i < 5; i++) { const s = parca(kureGeo, '#6b3d8a', -1.3 + i * 0.65, 2.2, 2.2 + (i % 2) * 0.8); s.scale.set(0.22, 0.34, 0.22); g.add(s); }
  g.add(parca(new THREE.CylinderGeometry(0.55, 0.55, 0.08, 16), RENK.tahta, 0, 0.75, 2.6), parca(new THREE.CylinderGeometry(0.07, 0.07, 0.72, 8), RENK.tahtaKoyu, 0, 0.36, 2.6));
  for (const x of [-0.9, 0.9]) g.add(kutuP(0.42, 0.08, 0.42, RENK.tahta, x, 0.45, 2.6, 0.03), kutuP(0.42, 0.45, 0.06, RENK.tahta, x, 0.68, 2.6 + (x < 0 ? -0.2 : -0.2), 0.03));
  g.userData.baca = new THREE.Vector3(1.2, 4.2, -1.0);
  g.add(kutuP(0.5, 1.0, 0.5, '#c9b39a', 1.2, 3.6, -1.0, 0.06));
  return golgeli(g);
}

// Ahşap dağ evi (A-çatı kulübe): yere kadar inen koyu çatı, cam ön yüz, ahşap veranda ve taş baca
export function dagEvi({ gece = 0 } = {}) {
  const g = new THREE.Group();
  const s = new THREE.Shape(); s.moveTo(-2.6, 0); s.lineTo(0, 4.6); s.lineTo(2.6, 0); s.lineTo(-2.6, 0);
  const govde = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 4.4, bevelEnabled: true, bevelSize: 0.1, bevelThickness: 0.1, bevelSegments: 2 }).translate(0, 0, -2.2), malz('#a5703f'));
  g.add(govde);
  // Çatı kaplaması: iki eğimde koyu şeritler
  const egim = Math.atan2(4.6, 2.6), uz = Math.hypot(2.6, 4.6);
  for (const yon of [-1, 1]) for (let k = 0; k < 7; k++) {
    const d = (k + 0.5) * (uz / 7), m = kutuP(0.7, 0.14, 4.7, k % 2 ? '#4a3a33' : '#5a463c', yon * (2.6 - d * Math.cos(egim)) * 1.02, d * Math.sin(egim) + 0.05, 0, 0.05);
    m.rotation.z = -yon * (Math.PI / 2 - egim); g.add(m);
  }
  // Cam ön üçgen
  const c = new THREE.Shape(); c.moveTo(-1.8, 0.2); c.lineTo(0, 3.4); c.lineTo(1.8, 0.2); c.lineTo(-1.8, 0.2);
  const cam = new THREE.Mesh(new THREE.ShapeGeometry(c), new THREE.MeshLambertMaterial({ color: gece > 0.5 ? '#ffd27a' : '#8fc7e3', emissive: gece > 0.5 ? '#a86d18' : '#000000' }));
  cam.position.z = 2.33; g.add(cam);
  for (const x of [-0.6, 0.6]) g.add(kutuP(0.08, 2.4, 0.08, RENK.beyaz, x, 1.3, 2.36, 0.02));
  g.add(kutuP(3.0, 0.08, 0.08, RENK.beyaz, 0, 1.5, 2.36, 0.02));
  // Veranda, korkuluk ve basamak
  g.add(kutuP(5.4, 0.25, 1.8, RENK.tahta, 0, 0.12, 3.2, 0.06));
  for (let x = -2.5; x <= 2.5; x += 0.6) g.add(kutuP(0.08, 0.7, 0.08, RENK.tahtaKoyu, x, 0.6, 4.05, 0.02));
  g.add(kutuP(5.2, 0.08, 0.1, RENK.tahtaKoyu, 0, 0.95, 4.05, 0.03));
  g.add(kutuP(0.7, 2.4, 0.7, '#9a9590', 1.6, 3.4, -1.2, 0.08), kutuP(0.85, 0.15, 0.85, '#7d7873', 1.6, 4.65, -1.2, 0.05));
  odunCit(g);
  g.userData.baca = new THREE.Vector3(1.6, 4.8, -1.2);
  return golgeli(g);
  function odunCit(gg) { for (let i = 0; i < 3; i++) gg.add(parca(new THREE.CylinderGeometry(0.16, 0.16, 1.1, 8).rotateZ(Math.PI / 2), '#8b5a33', -2.3, 0.2 + i * 0.3, -1.5 + (i % 2) * 0.32)); }
}

// Villa: iki katlı modern ev (kaydırılmış beyaz kütleler, ahşap şeritli düz çatılar, geniş camlar), teras ve saksı ağaçları
export function villa({ gece = 0 } = {}) {
  const g = new THREE.Group(), camRenk = gece > 0.5 ? '#ffd27a' : '#7cc0de';
  g.add(kutuP(6.4, 2.6, 4.4, '#fbfaf6', 0, 1.3, 0, 0.12));
  g.add(kutuP(4.4, 2.4, 3.6, '#f2eee6', -0.9, 3.8, -0.3, 0.12));
  for (const [w, d, x, y, z] of [[6.8, 4.8, 0, 2.66, 0], [4.8, 4.0, -0.9, 5.06, -0.3]]) { g.add(kutuP(w, 0.18, d, '#3a3e47', x, y, z, 0.05)); g.add(kutuP(w - 0.1, 0.1, 0.12, '#c48a54', x, y - 0.12, z + d / 2, 0.03)); }
  // Geniş camlar (zemin katta sürgülü, üst katta bant pencere)
  g.add(kutuP(3.6, 1.9, 0.1, camRenk, 0.9, 1.15, 2.22, 0.05));
  for (const x of [-0.3, 0.9, 2.1]) g.add(kutuP(0.08, 1.9, 0.12, '#3a3e47', x, 1.15, 2.24, 0.02));
  g.add(kutuP(3.2, 1.0, 0.1, camRenk, -0.9, 3.9, 1.52, 0.05));
  kapi(g, -2.2, 2.22, '#4a3a33', 1.0, 2.0);
  // Ahşap kaplamalı yan duvar şeritleri
  for (let k = 0; k < 6; k++) g.add(kutuP(0.08, 2.4, 0.06, '#c48a54', -2.95 + k * 0.12, 3.8, 1.52, 0.02));
  // Üst kat terası ve cam korkuluk
  g.add(kutuP(1.9, 0.08, 3.6, '#d9cbb4', 2.15, 2.78, -0.3, 0.03));
  g.add(new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.8, 0.05), new THREE.MeshLambertMaterial({ color: '#cfeef7', transparent: true, opacity: 0.5 })).translateX(2.15).translateY(3.2).translateZ(1.48));
  // Ön teras döşemesi, şezlong ve saksı ağaçları
  g.add(kutuP(7.2, 0.15, 2.4, '#e7dcc8', 0, 0.08, 3.4, 0.05));
  sezlong(g, 2.2, 3.4, Math.PI);
  for (const x of [-3.2, 3.2]) { g.add(kutuP(0.6, 0.6, 0.6, '#3a3e47', x, 0.3, 4.2, 0.08)); const a = parca(kureGeo, RENK.agac, x, 1.15, 4.2); a.scale.set(0.9, 1.3, 0.9); g.add(a); }
  return golgeli(g);
}

// Yüzme havuzu: taş kenarlı yuvarlak köşeli havuz, açık mavi su, iki şezlong ve şemsiye
export function havuz() {
  const g = new THREE.Group();
  g.add(kutuP(7.0, 0.3, 4.6, '#e7dcc8', 0, 0.15, 0, 0.6));
  const su = kutuP(5.8, 0.12, 3.4, '#4fb6e3', 0, 0.28, 0, 0.5); su.material = new THREE.MeshLambertMaterial({ color: '#4fb6e3', emissive: '#0f4d6a', emissiveIntensity: 0.25 }); g.add(su);
  for (let i = 0; i < 6; i++) { const p = kutuP(0.5 + (i % 3) * 0.3, 0.02, 0.06, '#bfe9f7', -2 + i * 0.8, 0.36, -1 + (i % 3) * 0.8, 0.01); g.add(p); }   // su parıltısı
  for (const x of [2.5, 2.9]) g.add(kutuP(0.06, 0.9, 0.06, '#c9ced6', x, 0.6, -1.65, 0.02));   // merdiven
  sezlong(g, -2.2, 3.2, Math.PI); sezlong(g, -0.9, 3.2, Math.PI);
  semsiye(g, 0.6, 3.4);
  return golgeli(g);
}

// Çardak: altıgen ahşap köşk, konik çatı, içinde masa ve oturak
export function cardak() {
  const g = new THREE.Group();
  g.add(parca(new THREE.CylinderGeometry(2.0, 2.0, 0.2, 6), '#d9c3a3', 0, 0.1, 0));
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; g.add(kutuP(0.16, 2.2, 0.16, RENK.tahtaKoyu, Math.cos(a) * 1.75, 1.2, Math.sin(a) * 1.75, 0.04)); }
  g.add(parca(new THREE.ConeGeometry(2.4, 1.2, 6), '#b3542f', 0, 2.85, 0), parca(new THREE.SphereGeometry(0.15, 8, 6), '#f2c45a', 0, 3.5, 0));
  g.add(parca(new THREE.CylinderGeometry(0.6, 0.6, 0.08, 12), RENK.tahta, 0, 0.8, 0), parca(new THREE.CylinderGeometry(0.08, 0.08, 0.7, 8), RENK.tahtaKoyu, 0, 0.45, 0));
  const oturak = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.16, 6, 18, Math.PI * 1.4).rotateX(Math.PI / 2), malz(RENK.tahta)); oturak.position.y = 0.5; oturak.rotation.y = 0.6; g.add(oturak);
  for (let i = 0; i < 4; i++) { const c = parca(kureGeo, ['#e2483a', '#f2c230', '#f07ab0', '#ffffff'][i], Math.cos(i) * 2.2, 0.35, Math.sin(i * 1.7) * 2.2); c.scale.setScalar(0.35); g.add(c); }
  return golgeli(g);
}

// Oyun parkı: kaydırak (merdiven, platform, eğik kaydırak), salıncak ve kum havuzu
export function oyunParki() {
  const g = new THREE.Group();
  g.add(kutuP(7.0, 0.08, 5.0, '#e9c98f', 0, 0.04, 0, 0.8));   // kum zemin
  // Kaydırak
  for (const [x, z] of [[-2.6, -1.2], [-1.6, -1.2], [-2.6, -0.2], [-1.6, -0.2]]) g.add(kutuP(0.14, 2.0, 0.14, '#e2483a', x, 1.0, z, 0.04));
  g.add(kutuP(1.2, 0.12, 1.2, '#f2c230', -2.1, 2.0, -0.7, 0.04));
  for (let i = 0; i < 6; i++) g.add(kutuP(0.9, 0.06, 0.12, '#3f82dc', -2.1, 0.3 + i * 0.3, -1.45, 0.02));
  const kay = kutuP(0.9, 0.08, 2.8, '#3f82dc', -2.1, 1.05, 1.2, 0.04); kay.rotation.x = 0.72; g.add(kay);
  // Salıncak: A çerçeve ve iki oturak
  for (const x of [0.8, 3.0]) for (const s of [-1, 1]) { const b = kutuP(0.12, 2.6, 0.12, '#3a64c8', x, 1.2, -1.2 + s * 0.45, 0.03); b.rotation.x = s * 0.3; g.add(b); }
  g.add(kutuP(2.4, 0.12, 0.12, '#3a64c8', 1.9, 2.4, -1.2, 0.03));
  for (const x of [1.4, 2.4]) { for (const d of [-0.15, 0.15]) g.add(kutuP(0.03, 1.6, 0.03, '#c9ced6', x + d, 1.6, -1.2, 0.01)); g.add(kutuP(0.5, 0.06, 0.25, '#e2483a', x, 0.8, -1.2, 0.02)); }
  // Kum havuzu çerçevesi, kova
  g.add(kutuP(2.0, 0.25, 0.2, RENK.tahta, 1.9, 0.12, 1.2, 0.04), kutuP(2.0, 0.25, 0.2, RENK.tahta, 1.9, 0.12, 2.6, 0.04), kutuP(0.2, 0.25, 1.6, RENK.tahta, 0.9, 0.12, 1.9, 0.04), kutuP(0.2, 0.25, 1.6, RENK.tahta, 2.9, 0.12, 1.9, 0.04));
  g.add(parca(new THREE.CylinderGeometry(0.2, 0.16, 0.3, 10), '#f2c230', 1.6, 0.2, 1.9));
  return golgeli(g);
}
