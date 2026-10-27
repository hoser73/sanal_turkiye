// Sevimli çiftlik model kiti (deneme): düşük poligonlu, dokusuz, parlak renkli yumuşak 3B tarz.
// Her şey basit şekillerden kurulur; malzemeler düz renkli Lambert (gölgeler yumuşak, ışık sıcak). Modellerin hepsi
// bizim; başka bir oyunun modeli ya da çizimi kullanılmaz. Birim metre, y yukarı.
import * as THREE from '/vendor/three/three.module.js';
import { RoundedBoxGeometry } from '/vendor/three-ek/geometries/RoundedBoxGeometry.js';

export const RENK = {
  cimen: '#8fd14f', cimenKoyu: '#7cc243', kum: '#f3c47e', kumKoyu: '#e7ad66', toprak: '#c97b4a', toprakKoyu: '#b4673c',
  tahta: '#cf8e55', tahtaKoyu: '#a96c3c', tente: '#4fc1b5', beyaz: '#f8f6ef', domates: '#ea4330', cilek: '#e63946',
  yaprak: '#7ccb3a', yaprakKoyu: '#5aac2c', misir: '#c6e46a', misirKoyu: '#a2cc4c', traktor: '#e44a3e', lastik: '#3a3e47',
  ten: '#f3b58c', sapka: '#f2c45a', tulum: '#3f82dc', agac: '#5cbf45', agacKoyu: '#3f9a3a', cam: '#2f7f55', govde: '#a8703f',
};
const malzemeler = new Map();
export const malz = (renk) => {
  if (!malzemeler.has(renk)) malzemeler.set(renk, new THREE.MeshLambertMaterial({ color: renk }));
  return malzemeler.get(renk);
};
// Rüzgâr: bitki ve ağaç malzemeleri köşe gölgelendiricisinde, nesnenin tabanından yüksekliğe göre salınır. Tüm sallanan malzemeler aynı
// zaman değerini paylaşır (RUZGAR.uZaman, çizen döngü her karede günceller). genlik: tepe noktasının metre cinsinden kayması
export const RUZGAR = { uZaman: { value: 0 } };
const ruzgarli = new Map();
export const malzRuzgar = (renk, genlik = 0.08) => {
  const k = `${renk}|${genlik}`;
  if (!ruzgarli.has(k)) {
    const m = new THREE.MeshLambertMaterial({ color: renk });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uZaman = RUZGAR.uZaman;
      // Salınım örnek ve model dönüşümünden sonra, dünya yüksekliğiyle orantılı uygulanır (sap ucu ile başak birlikte gider)
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uZaman;').replace('#include <project_vertex>', `
        vec4 p = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          p = instanceMatrix * p;
        #endif
        vec4 wp = modelMatrix * p;
        // Yükseklik nesnenin kendi tabanına göre (dünya y'si değil): haritada arazi yüksekliği yüzlerce metre olduğundan
        // dünya y'siyle salınım devasa olur ve yapraklar şerit gibi uzar
        vec4 kok = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float dalga = sin(uZaman * 1.9 + (wp.x - kok.x) * 0.3 + (wp.z - kok.z) * 0.2 + kok.x * 0.05) + 0.35 * sin(uZaman * 4.3 + (wp.x - kok.x) * 0.9);
        float h = clamp(wp.y - kok.y, 0.0, 12.0);
        wp.x += dalga * ${genlik.toFixed(3)} * h;
        wp.z += dalga * ${(genlik * 0.6).toFixed(3)} * h;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;`);
    };
    m.customProgramCacheKey = () => `ruzgar${genlik}`;
    ruzgarli.set(k, m);
  }
  return ruzgarli.get(k);
};
export const golgeli = (o) => { o.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } }); return o; };
export const yuvarlakKutu = (g, y, d, r = 0.08) => new RoundedBoxGeometry(g, y, d, 3, Math.min(r, g / 2, y / 2, d / 2));
export const parca = (geo, renk, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, malz(renk)); m.position.set(x, y, z); return m; };

// ---------- Zemin parçaları
// Yuvarlak köşeli düz levha (patika, tarla zemini): y kalınlık
export function levha(gen, der, renk, { kalinlik = 0.06, kose = 0.6 } = {}) {
  const s = new THREE.Shape(), w = gen / 2, d = der / 2, r = Math.min(kose, w, d);
  s.moveTo(-w + r, -d); s.lineTo(w - r, -d); s.quadraticCurveTo(w, -d, w, -d + r); s.lineTo(w, d - r); s.quadraticCurveTo(w, d, w - r, d);
  s.lineTo(-w + r, d); s.quadraticCurveTo(-w, d, -w, d - r); s.lineTo(-w, -d + r); s.quadraticCurveTo(-w, -d, -w + r, -d);
  const geo = new THREE.ExtrudeGeometry(s, { depth: kalinlik, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.04, bevelSegments: 2, curveSegments: 6 }).rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, malz(renk)); m.receiveShadow = true;
  return m;
}
// Sürülmüş tarla: kenarı yükseltilmiş toprak, boyuna karık sırtları, sırt üstünde toprak kesekleri ve kenarda ot tutamları
export function tarla(gen, der, { sira = Math.round(gen / 1.1), ot = 0.55 } = {}) {
  const g = new THREE.Group(), r = tohumluR(Math.round(gen * 131 + der * 17));
  g.add(levha(gen, der, RENK.toprakKoyu, { kalinlik: 0.12, kose: 0.4 }));
  const kesek = [];
  for (let i = 0; i < sira; i++) {
    const x = -gen / 2 + (i + 0.5) * (gen / sira);
    const s = new THREE.Mesh(yuvarlakKutu(gen / sira * 0.62, 0.14, der - 0.5, 0.07), malz(RENK.toprak));
    s.position.set(x, 0.2, 0); s.receiveShadow = true; s.castShadow = true;
    g.add(s);
    for (let k = 0, n = Math.round(der / 2.2); k < n; k++) kesek.push([x + (r() - 0.5) * gen / sira * 0.5, 0.29, -der / 2 + 0.5 + r() * (der - 1), r() * 6, 0.12 + r() * 0.1, 0.06]);
  }
  if (kesek.length) g.add(ornekli(kureGeo, RENK.toprakKoyu, kesek, { golge: false }));
  if (ot) g.add(otTutamlari(kenarNoktalari(gen + 0.4 + ot, der + 0.4 + ot, ot * 1.6, r), r, { boy: ot }));
  return g;
}
// Basit tohumlu rastgele (modül içi süsler aynı yerde dursun)
function tohumluR(t) { let x = (t % 2147483646) + 1; return () => { x = (x * 16807) % 2147483647; return (x - 1) / 2147483646; }; }
// Dikdörtgen kenarı boyunca noktalar (ot, çiçek dizmek için)
export function kenarNoktalari(gen, der, aralik, r = Math.random) {
  const n = [];
  for (let x = -gen / 2; x <= gen / 2; x += aralik * (0.6 + r() * 0.8)) n.push([x, -der / 2 + (r() - 0.5) * 0.4], [x, der / 2 + (r() - 0.5) * 0.4]);
  for (let z = -der / 2; z <= der / 2; z += aralik * (0.6 + r() * 0.8)) n.push([-gen / 2 + (r() - 0.5) * 0.4, z], [gen / 2 + (r() - 0.5) * 0.4, z]);
  return n;
}
// Ot tutamı: her noktada yelpaze gibi açılan 4-5 ince yaprak (rüzgârda sallanır)
const otGeo = new THREE.ConeGeometry(0.07, 1, 3).translate(0, 0.5, 0);
export function otTutamlari(noktalar, r = Math.random, { boy = 0.55, renkler = ['#6fbf3f', '#86cf4a', '#5aa834'] } = {}) {
  const kumeler = renkler.map(() => []);
  for (const [x, z] of noktalar) {
    const n = 4 + Math.floor(r() * 3), h = boy * (0.7 + r() * 0.6);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + r();
      kumeler[Math.floor(r() * renkler.length)].push([x + Math.cos(a) * 0.06, 0, z + Math.sin(a) * 0.06, a, 1, h * (0.7 + r() * 0.5), Math.sin(a) * 0.45, -Math.cos(a) * 0.45]);
    }
  }
  const g = new THREE.Group();
  kumeler.forEach((k, i) => { if (k.length) g.add(ornekli(otGeo, renkler[i], k, { golge: false, ruzgar: 0.12 })); });
  return g;
}

// ---------- Bitkiler (örnekli: çok sayıda tek çağrıda)
export function ornekli(geo, renk, yerler, { golge = true, ruzgar = 0 } = {}) {
  const m = new THREE.InstancedMesh(geo, ruzgar ? malzRuzgar(renk, ruzgar) : malz(renk), yerler.length), o = new THREE.Object3D();
  // yer: [x, y, z, dönüş, ölçek, boy ölçeği, eğim x, eğim z] (eğimler isteğe bağlı: sap ve ot doğal dursun diye)
  yerler.forEach(([x, y, z, ry = 0, s = 1, sy = s, rx = 0, rz = 0], i) => { o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.scale.set(s, sy, s); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
  m.castShadow = golge; m.receiveShadow = true;
  return m;
}
// Yaprak: ucu sivri, hafif kıvrık yassı damla
export const yaprakGeo = (() => {
  const g = new THREE.SphereGeometry(0.5, 8, 5);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = (z + 0.5);                   // 0 dip, 1 uç
    x *= 0.55 * (1 - t * 0.55); y *= 0.16; y += t * t * 0.18 - 0.05;
    p.setXYZ(i, x, y, z + 0.5);
  }
  g.computeVertexNormals();
  return g;
})();
export const kureGeo = new THREE.IcosahedronGeometry(0.5, 2);
// Çilek fidesi kümesi: yelpaze yapraklar + kırmızı çilekler. Dönüş: Group
export function cilekTarhi(noktalar, r) {
  const yap = [], yapK = [], meyve = [], sap = [];
  for (const [x, z] of noktalar) {
    const n = 6;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + r() * 0.5, s = 0.55 + r() * 0.2;
      (k % 2 ? yap : yapK).push([x, 0.18, z, a, s, s * 1.3]);
    }
    for (let k = 0; k < 3; k++) { const a = r() * 6.28, d = 0.25 + r() * 0.15; meyve.push([x + Math.cos(a) * d, 0.32 + r() * 0.08, z + Math.sin(a) * d, r() * 6, 0.17, 0.2]); }
    sap.push([x, 0.3, z, 0, 0.12]);
  }
  const g = new THREE.Group();
  g.add(ornekli(yaprakGeo, RENK.yaprak, yap, { ruzgar: 0.12 }), ornekli(yaprakGeo, RENK.yaprakKoyu, yapK, { ruzgar: 0.12 }), ornekli(kureGeo, RENK.cilek, meyve, { golge: false }));
  // Beyaz çiçekler (her fidede bir-iki)
  const cicek = noktalar.filter(() => r() < 0.45).map(([x, z]) => [x + (r() - 0.5) * 0.4, 0.42, z + (r() - 0.5) * 0.4, 0, 0.12, 0.06]);
  if (cicek.length) g.add(ornekli(kureGeo, '#ffffff', cicek, { golge: false }));
  return g;
}
// Domates tarlası: yere düşmüş iri domatesler ve alçak fideler
export function domatesTarhi(noktalar, r) {
  const meyve = [], yap = [], yesil = [];
  for (const [x, z] of noktalar) {
    meyve.push([x + (r() - 0.5) * 0.3, 0.42, z + (r() - 0.5) * 0.3, r() * 6, 0.5 + r() * 0.12, 0.42]);
    yesil.push([x, 0.66, z, r() * 6, 0.16, 0.08]);
    for (let k = 0; k < 3; k++) yap.push([x + (r() - 0.5) * 0.5, 0.2, z + (r() - 0.5) * 0.5, r() * 6.28, 0.35, 0.4]);
  }
  const g = new THREE.Group();
  g.add(ornekli(kureGeo, RENK.domates, meyve), ornekli(kureGeo, RENK.yaprakKoyu, yesil, { golge: false }), ornekli(yaprakGeo, RENK.yaprak, yap, { ruzgar: 0.1 }));
  return g;
}
// Mısır: boğumlu açık yeşil saplar ve yanlara açılan yapraklar
const sapGeo = new THREE.CylinderGeometry(0.07, 0.09, 1, 6).translate(0, 0.5, 0);
// Modül genelindeki ortak geometriler sahne temizlenirken atılmaz (her sahne yeniden kurulduğunda GPU'ya yeniden yüklenmesin)
for (const g of [otGeo, yaprakGeo, kureGeo, sapGeo]) g.userData.paylasimli = true;
export function misirTarhi(noktalar, r) {
  const sap = [], yap = [], bas = [];
  for (const [x, z] of noktalar) {
    const boy = 1.6 + r() * 0.5;
    sap.push([x, 0.15, z, 0, 1.6, boy]);
    for (let k = 0; k < 3; k++) yap.push([x, 0.5 + k * 0.4, z, r() * 6.28, 0.55 + r() * 0.15, 0.5]);
    bas.push([x, 0.15 + boy, z, 0, 0.11, 0.22]);
  }
  const g = new THREE.Group();
  g.add(ornekli(sapGeo, RENK.misir, sap, { ruzgar: 0.09 }), ornekli(yaprakGeo, RENK.misirKoyu, yap, { ruzgar: 0.09 }), ornekli(kureGeo, '#efe08a', bas, { golge: false, ruzgar: 0.09 }));
  return g;
}
// Papatya
export function papatyalar(noktalar) {
  const yaprak = [], gobek = [];
  for (const [x, z] of noktalar) {
    for (let k = 0; k < 7; k++) { const a = (k / 7) * Math.PI * 2; yaprak.push([x + Math.cos(a) * 0.11, 0.1, z + Math.sin(a) * 0.11, -a + Math.PI / 2, 0.16, 0.06]); }
    gobek.push([x, 0.12, z, 0, 0.1, 0.05]);
  }
  const g = new THREE.Group();
  g.add(ornekli(kureGeo, RENK.beyaz, yaprak, { golge: false }), ornekli(kureGeo, '#f5c542', gobek, { golge: false }));
  return g;
}

// ---------- Ağaçlar
export function yuvarlakAgac(r, olcek = 1) {
  const g = new THREE.Group();
  g.add(parca(new THREE.CylinderGeometry(0.16, 0.22, 1.2, 7), RENK.govde, 0, 0.6, 0));
  const t = new THREE.IcosahedronGeometry(1, 1);
  const tac = [[0, 1.75, 0, 1.05], [0.55, 1.45, 0.3, 0.7], [-0.5, 1.5, -0.25, 0.75], [0.1, 2.35, -0.1, 0.7]];
  tac.forEach(([x, y, z, s], i) => { const m = new THREE.Mesh(t, malzRuzgar(i % 2 ? RENK.agacKoyu : RENK.agac, 0.03)); m.position.set(x, y, z); m.scale.setScalar(s * (0.9 + r() * 0.2)); m.rotation.set(r() * 3, r() * 3, 0); g.add(m); });
  g.scale.setScalar(olcek);
  return golgeli(g);
}
export function cam(r, olcek = 1) {
  const g = new THREE.Group();
  g.add(parca(new THREE.CylinderGeometry(0.14, 0.18, 0.8, 6), RENK.govde, 0, 0.4, 0));
  [[1.1, 1.3, 0.9], [0.85, 1.1, 1.6], [0.55, 0.9, 2.2]].forEach(([rr, h, y]) => g.add(parca(new THREE.ConeGeometry(rr, h, 8), RENK.cam, 0, y, 0)));
  g.scale.setScalar(olcek * (0.9 + r() * 0.2));
  return golgeli(g);
}

// ---------- Ahşap işler
export function kasa(urun = null, r = Math.random) {
  const g = new THREE.Group();
  g.add(parca(yuvarlakKutu(0.9, 0.42, 0.62, 0.04), RENK.tahtaKoyu, 0, 0.21, 0));
  for (const z of [-0.33, 0.33]) g.add(parca(yuvarlakKutu(0.94, 0.1, 0.05, 0.02), RENK.tahta, 0, 0.36, z));
  for (const x of [-0.47, 0.47]) g.add(parca(yuvarlakKutu(0.05, 0.1, 0.7, 0.02), RENK.tahta, x, 0.36, 0));
  if (urun) {
    const renk = { domates: RENK.domates, cilek: RENK.cilek, misir: '#e9d45a', yumurta: '#fbf3e4', marul: '#9ad65a' }[urun] || urun;
    for (let i = 0; i < 6; i++) { const m = parca(kureGeo, renk, -0.28 + (i % 3) * 0.28, 0.47, i < 3 ? -0.13 : 0.13); m.scale.set(0.26, urun === 'misir' ? 0.18 : 0.22, urun === 'misir' ? 0.4 : 0.26); m.rotation.y = r(); g.add(m); }
  }
  return golgeli(g);
}
// Üst üste kasa yığını (tepede ürün)
export function kasaYigini(adet, urun, r) {
  const g = new THREE.Group();
  for (let i = 0; i < adet; i++) { const k = kasa(i === adet - 1 ? urun : null, r); k.position.y = i * 0.42; k.rotation.y = (r() - 0.5) * 0.06; g.add(k); }
  return g;
}
export function cit(uzunluk) {
  const g = new THREE.Group(), n = Math.max(2, Math.round(uzunluk / 1.2) + 1);
  for (let i = 0; i < n; i++) g.add(parca(yuvarlakKutu(0.16, 0.8, 0.16, 0.04), RENK.tahta, -uzunluk / 2 + (i * uzunluk) / (n - 1), 0.4, 0));
  for (const y of [0.3, 0.6]) g.add(parca(yuvarlakKutu(uzunluk, 0.1, 0.07, 0.03), RENK.tahtaKoyu, 0, y, 0.02));
  return golgeli(g);
}
// Pazar tezgâhı: ahşap tezgâh ve önden sarkan çizgili tente
export function tezgah() {
  const g = new THREE.Group();
  g.add(parca(yuvarlakKutu(4.2, 0.9, 1.3, 0.08), RENK.tahta, 0, 0.45, 0));
  g.add(parca(yuvarlakKutu(4.4, 0.12, 1.45, 0.05), RENK.tahtaKoyu, 0, 0.95, 0));
  const serit = 10, gen = 4.4 / serit;
  for (let i = 0; i < serit; i++) {
    const m = parca(yuvarlakKutu(gen, 0.7, 0.06, 0.02), i % 2 ? RENK.tente : RENK.beyaz, -2.2 + (i + 0.5) * gen, 0.62, 0.74);
    m.rotation.x = -0.12; g.add(m);
  }
  return golgeli(g);
}

// ---------- Karakterler (büyük kafalı, tıknaz)
export function ciftci({ tulum = RENK.tulum, gomlek = RENK.beyaz, sapka = true, sac = '#6b4026', ten = RENK.ten } = {}) {
  const g = new THREE.Group(), govde = new THREE.Group(), bacaklar = [], kollar = [];
  for (const x of [-0.13, 0.13]) {
    // Bacak kalçadan döner (yürürken salınır)
    const b = new THREE.Group(); b.position.set(x, 0.36, 0);
    b.add(parca(new THREE.CapsuleGeometry(0.09, 0.2, 3, 8), tulum, 0, -0.16, 0), parca(yuvarlakKutu(0.17, 0.1, 0.27, 0.045), '#6a4a34', 0, -0.32, 0.04));
    govde.add(b); bacaklar.push(b);
  }
  govde.add(parca(new THREE.CapsuleGeometry(0.24, 0.24, 4, 12), gomlek, 0, 0.62, 0));
  const on = parca(new THREE.CapsuleGeometry(0.245, 0.12, 4, 12), tulum, 0, 0.55, 0); on.scale.set(1, 1, 1.02); govde.add(on);
  govde.add(parca(yuvarlakKutu(0.3, 0.2, 0.1, 0.04), tulum, 0, 0.78, 0.2));                  // göğüs cebi
  for (const x of [-0.12, 0.12]) {
    const a = parca(yuvarlakKutu(0.06, 0.32, 0.04, 0.02), tulum, x, 0.84, 0.21); a.rotation.x = -0.15; govde.add(a);   // askı
    govde.add(parca(new THREE.SphereGeometry(0.035, 8, 6), '#f2c45a', x, 0.72, 0.25));                                // düğme
  }
  for (const x of [-0.32, 0.32]) {
    const k = new THREE.Group(); k.position.set(x * 0.9, 0.76, 0.02);
    const kol = parca(new THREE.CapsuleGeometry(0.075, 0.24, 3, 8), gomlek, 0, -0.14, 0);
    const el = parca(kureGeo, ten, 0, -0.33, 0.01); el.scale.setScalar(0.16);
    k.add(kol, el); k.rotation.z = x > 0 ? 0.22 : -0.22;
    govde.add(k); kollar.push(k);
  }
  const bas = new THREE.Group(); bas.position.y = 1.05;
  bas.add(parca(new THREE.SphereGeometry(0.28, 20, 14), ten));
  for (const x of [-0.1, 0.1]) {
    bas.add(parca(new THREE.SphereGeometry(0.045, 10, 8), '#2b2420', x, 0.03, 0.25));
    bas.add(parca(new THREE.SphereGeometry(0.014, 6, 4), '#ffffff', x + 0.015, 0.05, 0.29));     // göz parıltısı
    const y = parca(new THREE.SphereGeometry(0.05, 8, 6), '#f28b8b', x * 1.55, -0.06, 0.22); y.scale.set(1, 0.6, 0.4); bas.add(y);   // yanak
  }
  const burun = parca(new THREE.SphereGeometry(0.05, 10, 8), '#e9a07a', 0, -0.03, 0.28); bas.add(burun);
  const agiz = parca(new THREE.TorusGeometry(0.05, 0.012, 6, 12, Math.PI), '#8a3b2e', 0, -0.11, 0.25); agiz.rotation.z = Math.PI; bas.add(agiz);
  if (sapka) {
    bas.add(parca(new THREE.CylinderGeometry(0.46, 0.48, 0.04, 24), RENK.sapka, 0, 0.18, 0));
    bas.add(parca(new THREE.CylinderGeometry(0.21, 0.26, 0.22, 18), RENK.sapka, 0, 0.29, 0));
    bas.add(parca(new THREE.CylinderGeometry(0.262, 0.262, 0.06, 18), '#d9483b', 0, 0.22, 0));
    bas.add(parca(new THREE.SphereGeometry(0.29, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), sac, 0, 0.0, -0.03));
  } else {
    bas.add(parca(new THREE.SphereGeometry(0.3, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), sac, 0, 0.02, -0.02));
  }
  govde.add(bas);
  g.add(govde);
  Object.assign(g.userData, { govde, bacaklar, kollar, bas });
  return golgeli(g);
}

// ---------- Traktör
export function traktor(surucu = null) {
  const g = new THREE.Group();
  g.add(parca(yuvarlakKutu(1.1, 0.55, 2.0, 0.14), RENK.traktor, 0, 0.75, 0.15));
  g.add(parca(yuvarlakKutu(0.9, 0.45, 0.9, 0.12), RENK.traktor, 0, 0.95, 0.85));
  g.add(parca(yuvarlakKutu(0.6, 0.12, 0.6, 0.05), '#8a8f99', 0, 1.06, -0.35));
  g.add(parca(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8), '#5b5f69', 0.3, 1.35, 1.0));
  const teker = (r, w) => new THREE.CylinderGeometry(r, r, w, 18).rotateZ(Math.PI / 2);
  for (const x of [-0.68, 0.68]) {
    g.add(parca(teker(0.55, 0.32), RENK.lastik, x, 0.55, -0.45), parca(teker(0.28, 0.34), '#e9e4d8', x, 0.55, -0.45));
    g.add(parca(teker(0.33, 0.24), RENK.lastik, x * 0.85, 0.33, 1.05), parca(teker(0.16, 0.26), '#e9e4d8', x * 0.85, 0.33, 1.05));
  }
  for (const x of [-0.68, 0.68]) g.add(parca(yuvarlakKutu(0.36, 0.1, 0.9, 0.04), RENK.traktor, x, 1.1, -0.45));
  if (surucu) { surucu.position.set(0, 0.85, -0.3); surucu.scale.setScalar(0.95); g.add(surucu); }
  return golgeli(g);
}
// El arabası
export function elArabasi(urun) {
  const g = new THREE.Group();
  const kova = parca(yuvarlakKutu(0.8, 0.35, 1.0, 0.1), RENK.traktor, 0, 0.45, 0); g.add(kova);
  g.add(parca(new THREE.CylinderGeometry(0.2, 0.2, 0.1, 14).rotateZ(Math.PI / 2), RENK.lastik, 0, 0.2, 0.55));
  for (const x of [-0.3, 0.3]) g.add(parca(yuvarlakKutu(0.06, 0.06, 0.8, 0.02), '#6c707a', x, 0.45, -0.75));
  if (urun) for (let i = 0; i < 5; i++) { const m = parca(kureGeo, urun, -0.2 + (i % 3) * 0.2, 0.7, -0.2 + Math.floor(i / 3) * 0.3); m.scale.setScalar(0.22); g.add(m); }
  return golgeli(g);
}

// Ambar: kırmızı duvarlar, beyaz çerçeveli çapraz kapı, koyu çatı
export function ambar() {
  const g = new THREE.Group();
  g.add(parca(yuvarlakKutu(4.2, 2.6, 3.4, 0.12), '#d94a3d', 0, 1.3, 0));
  const cati = new THREE.Shape(); cati.moveTo(-2.45, 0); cati.lineTo(0, 1.6); cati.lineTo(2.45, 0); cati.lineTo(-2.45, 0);
  const catiGeo = new THREE.ExtrudeGeometry(cati, { depth: 3.8, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 2 }).translate(0, 0, -1.9);
  g.add(parca(catiGeo, '#6d4a3a', 0, 2.55, 0));
  g.add(parca(yuvarlakKutu(1.8, 1.9, 0.1, 0.04), RENK.beyaz, 0, 0.95, 1.71));
  g.add(parca(yuvarlakKutu(1.5, 1.6, 0.1, 0.03), '#c43d33', 0, 0.95, 1.74));
  for (const a of [0.85, -0.85]) { const c = parca(yuvarlakKutu(0.14, 2.1, 0.08, 0.03), RENK.beyaz, 0, 0.95, 1.8); c.rotation.z = a; g.add(c); }
  g.add(parca(yuvarlakKutu(0.9, 0.7, 0.1, 0.04), RENK.beyaz, 0, 3.0, 1.75));
  g.add(parca(yuvarlakKutu(0.7, 0.5, 0.12, 0.03), '#f1cf63', 0, 2.95, 1.78));       // samanlık ağzında saman
  // Beyaz köşe pervazları ve çatı saçak şeritleri
  for (const x of [-2.08, 2.08]) for (const z of [-1.68, 1.68]) g.add(parca(yuvarlakKutu(0.16, 2.6, 0.16, 0.05), RENK.beyaz, x, 1.3, z));
  for (const yon of [-1, 1]) { const s = parca(yuvarlakKutu(2.95, 0.14, 0.16, 0.05), RENK.beyaz, yon * 1.22, 3.36, 1.95); s.rotation.z = -yon * Math.atan2(1.6, 2.45); g.add(s); }
  for (let k = 0; k < 4; k++) for (const yon of [-1, 1]) { const s = parca(yuvarlakKutu(0.08, 0.05, 3.85, 0.02), '#5a3c2f', yon * (0.5 + k * 0.5), 2.6 + 1.6 * (1 - (0.5 + k * 0.5) / 2.45) + 0.04, 0); s.rotation.z = -yon * Math.atan2(1.6, 2.45); g.add(s); }
  for (const x of [-2.12, 2.12]) { g.add(parca(yuvarlakKutu(0.1, 0.8, 0.9, 0.03), RENK.beyaz, x, 1.5, 0)); g.add(parca(yuvarlakKutu(0.12, 0.6, 0.7, 0.03), '#6fb7d8', x, 1.5, 0)); }
  // Tahta kaplama çizgileri (ön ve yan duvarlar), mahyada havalandırma kulesi ve rüzgârgülü
  for (let k = -3; k <= 3; k++) if (Math.abs(k) > 1) g.add(parca(yuvarlakKutu(0.06, 2.3, 0.04, 0.02), '#b93a30', k * 0.29, 1.2, 1.72));
  for (const x of [-2.11, 2.11]) for (let k = -2; k <= 2; k++) if (k) g.add(parca(yuvarlakKutu(0.04, 2.3, 0.06, 0.02), '#b93a30', x, 1.2, k * 0.6));
  g.add(parca(yuvarlakKutu(0.8, 0.7, 0.8, 0.06), RENK.beyaz, 0, 4.35, 0));
  g.add(parca(new THREE.ConeGeometry(0.75, 0.6, 4).rotateY(Math.PI / 4), '#6d4a3a', 0, 5.0, 0));
  g.add(parca(yuvarlakKutu(0.04, 0.7, 0.04, 0.01), '#3a3e47', 0, 5.6, 0));
  g.add(parca(yuvarlakKutu(0.6, 0.05, 0.05, 0.01), '#3a3e47', 0, 5.75, 0));
  return golgeli(g);
}
// Saman balyası, çalı, taş
export function balya() {
  const g = new THREE.Group();
  g.add(parca(new THREE.CylinderGeometry(0.55, 0.55, 0.9, 18).rotateZ(Math.PI / 2), '#f1cf63', 0, 0.55, 0));
  for (const x of [-0.46, 0.46]) g.add(parca(new THREE.CylinderGeometry(0.5, 0.5, 0.02, 18).rotateZ(Math.PI / 2), '#e3b84a', x, 0.55, 0));
  return golgeli(g);
}
export function cali(r) {
  const g = new THREE.Group(), t = new THREE.IcosahedronGeometry(0.5, 1);
  for (let i = 0; i < 3; i++) { const m = parca(t, i ? RENK.agac : RENK.agacKoyu, (i - 1) * 0.45, 0.35 + r() * 0.1, (r() - 0.5) * 0.3); m.scale.setScalar(0.7 + r() * 0.35); g.add(m); }
  return golgeli(g);
}
export function tas(r) {
  const m = parca(new THREE.DodecahedronGeometry(0.4, 0), '#c9c4b8', 0, 0.15, 0); m.scale.set(1 + r() * 0.5, 0.55, 1); m.rotation.y = r() * 3;
  return golgeli(m);
}

// ---------- Işık ve görüntü ayarı: parlak, sıcak güneş, yumuşak mavimsi gölge
export function isikKur(sahne, renderer, { merkez = new THREE.Vector3(), alan = 18 } = {}) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;   // bulanık, yumuşak kenarlı gölge
  sahne.background = new THREE.Color(RENK.cimen);
  const gok = new THREE.HemisphereLight('#e8f1ff', '#b9d98a', 1.55);
  const gunes = new THREE.DirectionalLight('#fff3df', 1.9);
  gunes.position.set(merkez.x - 9, 16, merkez.z + 7);
  gunes.target.position.copy(merkez);
  gunes.castShadow = true;
  gunes.shadow.mapSize.set(2048, 2048);
  Object.assign(gunes.shadow.camera, { left: -alan, right: alan, top: alan, bottom: -alan, near: 1, far: 60 });
  gunes.shadow.radius = 7;
  gunes.shadow.blurSamples = 16;
  gunes.shadow.bias = -0.0004;
  sahne.add(gok, gunes, gunes.target);
  return { gok, gunes };
}
