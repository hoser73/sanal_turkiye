// Açılış sayfası kahramanı: gerçek zamanlı 3B Anadolu çiftliği (three.js, dış doku/model yok; her şey burada üretilir).
// Rüzgârda dalgalanan buğday, salınan ağaçlar, akan dere, otlayan inek ve koyunlar, yolda giden traktör, dönen rüzgâr
// türbinleri, bacadan duman, kuş sürüsü, uzakta köy ve cami, karlı dağlar. Güneş Konya'nın gerçek güneş konumundan,
// bulut/yağmur/rüzgâr Konya'nın gerçek havasından gelir; gece pencereler yanar. Kamera drone gibi yavaşça süzülür.
import * as THREE from '/vendor/three/three.module.js';
import { gunesKonumu } from './gunes.js';
import { malzemeler, koyEvi, ahir, silo, turbin, agacUret, kabukMalzemesi, leylek, leylekYuvasi, ucak } from './tanitim3d-model.js';
import { sonIslemKur } from './tanitim3d-efekt.js';

const MOBIL = matchMedia('(max-width: 900px)').matches || /Mobi|Android|iPhone|iPad/.test(navigator.userAgent);
const K = MOBIL
  ? { piksel: 1.4, golge: 1024, doku: 1024, bugday: 11000, arazi: [150, 105], cam: 260, kure: [7, 5] }
  : { piksel: 1.75, golge: 2048, doku: 2048, bugday: 42000, arazi: [250, 175], cam: 700, kure: [9, 7] };

// ---------- Gürültü ve yardımcılar (sahne her açılışta aynı görünür: tohumlu rastgele)
const hash2 = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
function gurultu(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function fbm(x, y, o = 4) { let s = 0, a = 0.5; for (let i = 0; i < o; i++) { s += a * gurultu(x, y); x *= 2.03; y *= 2.03; a *= 0.5; } return s; }
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
let tohum = 11;
const rnd = () => { tohum = (tohum * 16807) % 2147483647; return (tohum - 1) / 2147483646; };
const ara = (a, b) => a + rnd() * (b - a);
const C = (h) => new THREE.Color(h);

// ---------- Arazi: düz çiftlik ovası, ortasından dere geçer, arkada tepeler yükselir
const nehirZ = (x) => -112 + 22 * Math.sin(x * 0.009) + 8 * Math.sin(x * 0.023 + 1.3);
const yolZ = (x) => 8 + 3 * Math.sin(x * 0.018);
function H(x, z) {
  let tepe = (fbm(x * 0.0026 + 11, z * 0.0026 + 5) - 0.45) * 70 + (fbm(x * 0.011, z * 0.011 + 9, 3) - 0.5) * 8;
  tepe += ss(-130, -700, z) * 55 + ss(650, 1000, Math.abs(x)) * 50;
  const dx = Math.max(0, Math.abs(x) - 170) / 160;
  const dz = z > 70 ? (z - 70) / 120 : z < -95 ? (-95 - z) / 120 : 0;
  const w = 1 - ss(0, 1, Math.hypot(dx, dz));
  let h = tepe * (1 - w) + (gurultu(x * 0.02, z * 0.02) - 0.5) * 1.6 * w;
  const s = ss(6, 26, Math.abs(z - nehirZ(x)));
  return Math.min(h, -2.8 * (1 - s) + h * s);
}
const AX0 = -1000, AZ0 = -1100, AG = 2000, AD = 1400;   // arazi kapsamı (m)

// ---------- Gölgelendirici yamaları: rüzgâr, bulut gölgesi, yakın ayrıntı
const U = { uT: { value: 0 }, uRuzgar: { value: 1 }, uBulut: { value: 0.5 }, uDetay: { value: null } };
const GLSL = `
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
float gfbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * gn(p); p *= 2.03; a *= 0.5; } return s; }`;
const KOK = `vec4 kok = vec4(0.0, 0.0, 0.0, 1.0);
#ifdef USE_INSTANCING
  kok = instanceMatrix * kok;
#endif
  kok = modelMatrix * kok;`;
const KOSE = {
  get yaprak() { return this.agac; },
  bugday: `{ ${KOK}
    float dalga = sin(dot(kok.xz, vec2(0.16, 0.07)) - uT * 2.1) * 0.5 + 0.5; dalga *= dalga;
    float firtina = gn(kok.xz * 0.045 + vec2(uT * 0.35, uT * 0.05));
    float r = (0.12 + dalga * 0.6 + firtina * 0.35) * uRuzgar;
    float k = clamp(position.y / 1.1, 0.0, 1.0); k *= k;
    transformed.x += k * r * 0.42 + sin(uT * 6.0 + kok.x * 3.1 + kok.z * 2.3) * 0.025 * k;
    transformed.z -= k * r * 0.18;
    transformed.y -= k * r * r * 0.12;
    vDalga = dalga * 0.7 + firtina * 0.3; }`,
  agac: `{ ${KOK}
    float k = max(position.y + 1.0, 0.0) * 0.05;
    transformed.x += (sin(uT * 1.3 + kok.x * 0.2) * 0.6 + sin(uT * 2.9 + kok.z * 0.37) * 0.25) * k * uRuzgar;
    transformed.z += cos(uT * 1.1 + kok.z * 0.2) * k * uRuzgar * 0.3;
    transformed += normal * sin(uT * 7.0 + position.x * 4.0 + position.y * 3.0 + kok.x) * 0.012 * uRuzgar; }`,
};
const PARCA = {
  yaprak: `#ifdef USE_MAP
    vec2 dd = vec2(length(dFdx(vMapUv * 1024.0)), length(dFdy(vMapUv * 1024.0)));
    diffuseColor.a *= 1.0 + max(0.0, log2(max(dd.x, dd.y))) * 0.3;
  #endif`,
  bugday: 'diffuseColor.rgb *= 0.8 + vDalga * 0.4;',
  zemin: `float ay = gn(vDunya.xz * 0.9) * 0.55 + gn(vDunya.xz * 3.3) * 0.45; diffuseColor.rgb *= 0.86 + ay * 0.26;
    float yakin = 1.0 - smoothstep(40.0, 260.0, length(vDunya - cameraPosition));
    vec3 dty = texture2D(uDetay, vDunya.xz / 6.5).rgb; float dl = dot(dty, vec3(0.333)) / 0.36;
    diffuseColor.rgb *= mix(1.0, clamp(dl, 0.5, 1.55), 0.6 * yakin);`,
  dag: 'float kat = gn(vec2(vDunya.x * 0.004, vDunya.y * 0.09)) * 0.6 + gn(vDunya.xz * 0.05) * 0.4; diffuseColor.rgb *= 0.84 + kat * 0.3;',
};
function yamala(mat, tur) {
  mat.customProgramCacheKey = () => `tn-${tur}`;
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, U);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\n${GLSL}\nuniform float uT; uniform float uRuzgar; varying vec3 vDunya; varying float vDalga;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvDalga = 0.0;\n${KOSE[tur] || ''}
{ vec4 dp = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  dp = instanceMatrix * dp;
#endif
  vDunya = (modelMatrix * dp).xyz; }`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL}\nuniform float uT; uniform float uBulut; uniform sampler2D uDetay; varying vec3 vDunya; varying float vDalga;`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${PARCA[tur] || ''}
diffuseColor.rgb *= 1.0 - smoothstep(0.5, 0.72, gfbm(vDunya.xz * 0.0032 + uT * vec2(0.010, 0.004))) * uBulut * 0.45;`);
  };
  return mat;
}
const malz = (renk, o = {}) => new THREE.MeshStandardMaterial({ color: renk, roughness: 0.85, metalness: 0, ...o });

// ---------- Gökyüzü
const GOK_VS = 'varying vec3 vYon; void main() { vYon = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const GOK_FS = `
uniform vec3 gokUst; uniform vec3 gokUfuk; uniform vec3 gunesYon; uniform vec3 gunesRenk; uniform float gece; uniform float bulut; uniform float t; uniform vec3 bulutRenk;
varying vec3 vYon;
${GLSL}
float bulutYog(vec2 p) { float n = gfbm(p) * 0.68 + gfbm(p * 2.4 + 7.3) * 0.32; return smoothstep(1.02 - bulut * 0.92, 1.1 - bulut * 0.4, n + 0.1); }
void main() {
  vec3 d = normalize(vYon);
  float y = max(d.y, 0.0);
  // Ufuk rengi yalnızca ufka yakın bantta kalır (gün batımında mavi ile turuncu karışıp grileşmesin)
  float hy = 1.0 - exp(-y * 7.0);
  vec3 renk = mix(gokUfuk, gokUst, hy);
  renk = mix(renk, mix(gokUfuk, vec3(1.0, 0.96, 0.86), 0.55), exp(-abs(y - 0.06) * 18.0) * 0.25 * (1.0 - gece));
  float s = max(dot(d, gunesYon), 0.0);
  renk += gunesRenk * (pow(s, 1400.0) * 40.0 * (1.0 - gece) + pow(s, 12.0) * 0.4 + pow(s, 4.0) * 0.04) * (1.0 - y * 0.6);
  if (gece > 0.0) { vec2 c = floor(d.xz / max(d.y, 0.05) * 160.0); float h = h21(c); renk += vec3(0.9, 0.95, 1.0) * step(0.9965, h) * gece * (1.0 - bulut) * smoothstep(0.04, 0.3, d.y) * (0.6 + 0.4 * sin(t * 3.0 + h * 50.0)); }
  if (d.y > 0.0) {
    // Kümülüs: yoğunluk + güneşe doğru üç örnekle ışık geçirgenliği (koyu taban, parlak tepe, ince kenarda gümüş ışık)
    vec2 p = d.xz / (d.y + 0.07) * 0.85 + vec2(t * 0.0045, t * 0.0018);
    float yog = bulutYog(p);
    float ufuk = smoothstep(0.0, 0.1, d.y);
    if (yog > 0.002) {
      vec2 gy = normalize(gunesYon.xz + vec2(1e-4)) * 0.11;
      float golge = bulutYog(p + gy) + bulutYog(p + gy * 2.0) * 0.8 + bulutYog(p + gy * 3.2) * 0.6;
      float gecis = exp(-golge * 1.25);
      vec3 bc = mix(bulutRenk * vec3(0.58, 0.62, 0.7), bulutRenk * 1.06, gecis);
      bc = mix(bc, mix(gokUfuk, bulutRenk, 0.5), 0.25 * (1.0 - ufuk));
      bc += gunesRenk * (pow(s, 7.0) * (1.0 - yog) * 2.2 + pow(s, 40.0) * 0.8) * (1.0 - gece);
      renk = mix(renk, bc, yog * ufuk * 0.97);
    }
    // Yüksek sirrus tülleri
    vec2 q = d.xz / (d.y + 0.2) * 0.5 + vec2(t * 0.002, 0.0);
    float sirrus = smoothstep(0.58, 0.82, gfbm(vec2(q.x * 0.6, q.y * 2.8) + 11.0));
    renk = mix(renk, bulutRenk * 1.02, sirrus * 0.22 * (1.0 - yog) * ufuk);
  }
  gl_FragColor = vec4(renk, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ---------- Akarsu: akıntı normalleri, gökyüzü yansıması, güneş parıltısı
const SU_VS = `varying vec3 vP; varying float vKenar; attribute float kenar;
void main() { vKenar = kenar; vec4 p = modelMatrix * vec4(position, 1.0); vP = p.xyz; gl_Position = projectionMatrix * viewMatrix * p; }`;
const SU_FS = `
uniform float t; uniform vec3 gokUst; uniform vec3 gokUfuk; uniform vec3 gunesYon; uniform vec3 gunesRenk; uniform vec3 sisRenk; uniform float sisYog; uniform float gece;
varying vec3 vP; varying float vKenar;
${GLSL}
float dalga(vec2 q) { return gn(q * 0.45 + vec2(t * 0.55, 0.0)) + 0.5 * gn(q * 1.3 + vec2(t * 1.2, t * 0.15)) + 0.25 * gn(q * 3.1 + vec2(t * 2.0, -t * 0.3)); }
void main() {
  vec2 p = vP.xz; float e = 0.12;
  vec3 N = normalize(vec3((dalga(p - vec2(e, 0.0)) - dalga(p + vec2(e, 0.0))) * 1.6, 1.0, (dalga(p - vec2(0.0, e)) - dalga(p + vec2(0.0, e))) * 1.6));
  vec3 V = normalize(cameraPosition - vP);
  float fres = 0.03 + 0.97 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 R = reflect(-V, N);
  vec3 gok = mix(gokUfuk, gokUst, clamp(R.y * 1.4, 0.0, 1.0));
  vec3 derin = mix(vec3(0.07, 0.17, 0.16), vec3(0.32, 0.30, 0.2), vKenar * vKenar) * (1.0 - gece * 0.85);
  vec3 c = mix(derin, gok, fres * 0.85);
  c += gunesRenk * pow(max(dot(R, gunesYon), 0.0), 260.0) * 4.0 * (1.0 - gece);
  c += vec3(0.9) * smoothstep(0.82, 0.95, vKenar) * 0.25 * gn(p * 2.0 + t);
  float d = length(cameraPosition - vP); c = mix(c, sisRenk, 1.0 - exp(-sisYog * sisYog * d * d));
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ---------- Geometri yardımcıları
function birlestir(gs) {
  let n = 0; for (const g of gs) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3).fill(1), idx = [];
  let o = 0;
  for (const g of gs) {
    const p = g.attributes.position;
    pos.set(p.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.color) col.set(g.attributes.color.array, o * 3);
    if (g.index) for (const i of g.index.array) idx.push(i + o); else for (let i = 0; i < p.count; i++) idx.push(i + o);
    o += p.count;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  m.setAttribute('color', new THREE.BufferAttribute(col, 3));
  m.setIndex(idx);
  return m;
}
// Buğday öbeği: 7 sap; başaklar kalın ve açık renk
function basakGeo() {
  const pos = [], col = [], idx = [];
  let v = 0;
  for (let s = 0; s < 7; s++) {
    const ox = (rnd() - 0.5) * 0.55, oz = (rnd() - 0.5) * 0.55, h = 0.8 + rnd() * 0.32, egim = (rnd() - 0.5) * 0.3, yon = rnd() * Math.PI;
    const dx = Math.cos(yon), dz = Math.sin(yon);
    for (let i = 0; i <= 5; i++) {
      const t = i / 5, y = t * h, x = ox + egim * t * t;
      const w = i === 5 ? 0.004 : t > 0.68 ? 0.034 : 0.011;
      pos.push(x - dx * w, y, oz - dz * w, x + dx * w, y, oz + dz * w);
      const c = t > 0.68 ? [0.92, 0.66, 0.24] : [0.58 + 0.28 * t, 0.47 + 0.2 * t, 0.17 + 0.05 * t];
      col.push(...c, ...c);
      if (i < 5) idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      v += 2;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function kutu(w, h, d, m, x = 0, y = 0, z = 0, ry = 0) {
  const k = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  k.position.set(x, y, z); k.rotation.y = ry; k.castShadow = true; k.receiveShadow = true;
  return k;
}
function silindir(rt, rb, h, m, seg = 12) { const s = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m); s.castShadow = true; s.receiveShadow = true; return s; }
function yumusakDoku(ic = 'rgba(255,255,255,1)') {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, ic); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- Zemin dokusu: çayır/bozkır tabanı, tarla yamaları (sürülmüş, anız, yonca…), yol, dere kıyısı, avlu
function zeminDokusu() {
  const S = K.doku, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  // Taban: düşük çözünürlükte piksel piksel, sonra büyütülür
  const B = S / 4, taban = document.createElement('canvas'); taban.width = taban.height = B;
  const tc = taban.getContext('2d'), img = tc.createImageData(B, B);
  for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) {
    const x = AX0 + (i / B) * AG, z = AZ0 + (j / B) * AD, h = H(x, z);
    const n = fbm(x * 0.012, z * 0.012, 3), n2 = gurultu(x * 0.06, z * 0.06);
    const kuru = Math.min(1, Math.max(0, ss(3, 42, h) * 0.85 + (n - 0.5) * 0.9 + 0.18));
    const v = 0.86 + 0.28 * n2, o = (j * B + i) * 4;
    img.data[o] = (98 + (176 - 98) * kuru) * v; img.data[o + 1] = (132 + (156 - 132) * kuru) * v; img.data[o + 2] = (56 + (98 - 56) * kuru) * v; img.data[o + 3] = 255;
  }
  tc.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true; ctx.drawImage(taban, 0, 0, S, S);
  ctx.setTransform(S / AG, 0, 0, S / AD, -AX0 * S / AG, -AZ0 * S / AD);   // artık dünya metresiyle çizilir

  const desenler = {
    anız: ['#c9a95a', '#b08f42'], surum: ['#8d6844', '#6c4c2f'], yonca: ['#6e9a36', '#5a862a'], bugday: ['#d7b354', '#c39b3b'],
    aycicegi: ['#6f6b2e', '#8a7c2c'], nadas: ['#a99a6c', '#978a5f'], sebze: ['#5f8a3a', '#7a5a3a'],
  };
  const desen = (tur, aci) => {
    const [a, b] = desenler[tur], c = document.createElement('canvas'); c.width = c.height = 32;
    const x = c.getContext('2d'); x.fillStyle = a; x.fillRect(0, 0, 32, 32); x.fillStyle = b;
    for (let i = 0; i < 32; i += 4) x.fillRect(0, i, 32, tur === 'nadas' ? 1 : 2);
    for (let i = 0; i < 80; i++) { x.fillStyle = `rgba(${rnd() < 0.5 ? '40,30,10' : '255,250,220'},${0.04 + rnd() * 0.06})`; x.fillRect(rnd() * 32, rnd() * 32, 1 + rnd() * 3, 1); }
    const p = ctx.createPattern(c, 'repeat'); p.setTransform(new DOMMatrix().rotateSelf(aci).scaleSelf(0.75));
    return p;
  };
  const turler = ['anız', 'anız', 'surum', 'surum', 'yonca', 'bugday', 'aycicegi', 'nadas', 'sebze'];
  const tarla = (pts, tur, aci) => {
    ctx.beginPath(); pts.forEach(([x, z], i) => (i ? ctx.lineTo(x, z) : ctx.moveTo(x, z))); ctx.closePath();
    ctx.fillStyle = desen(tur, aci); ctx.fill();
    ctx.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,230'},${0.05 + rnd() * 0.1})`; ctx.fill();
    ctx.strokeStyle = 'rgba(70,90,40,.55)'; ctx.lineWidth = 1.4; ctx.stroke();
  };
  // Tarla ızgarası (hafif dönük), dere ve çiftlik dışında
  const ac = (-7 * Math.PI) / 180, ca = Math.cos(ac), sa = Math.sin(ac);
  const don = (u, v) => [u * ca - v * sa, u * sa + v * ca];
  for (let v = -1080; v < 300;) {
    const dv = ara(55, 110);
    for (let u = -1000; u < 1000;) {
      const du = ara(65, 140), [cx, cz] = don(u + du / 2, v + dv / 2);
      const ciftlik = Math.abs(cx) < 150 && cz > -100 && cz < 70, nehir = Math.abs(cz - nehirZ(cx)) < 32;
      if (!ciftlik && !nehir && rnd() > 0.2 && H(cx, cz) < 70) {
        const k = 1.2, pts = [[u + k, v + k], [u + du - k, v + k], [u + du - k, v + dv - k], [u + k, v + dv - k]].map(([a, b]) => don(a + ara(-3, 3), b + ara(-3, 3)));
        tarla(pts, turler[Math.floor(rnd() * turler.length)], -7 + (rnd() < 0.5 ? 0 : 90));
      }
      u += du;
    }
    v += dv;
  }
  // Ön plandaki buğday tarlası, otlak, avlu
  tarla([[-118, 15], [118, 15], [120, 60], [-120, 60]], 'bugday', 0);
  ctx.fillStyle = 'rgba(126,160,70,.55)'; ctx.fillRect(38, -80, 86, 64);
  for (let i = 0; i < 40; i++) { ctx.fillStyle = `rgba(150,130,80,${0.15 + rnd() * 0.2})`; ctx.beginPath(); ctx.ellipse(ara(42, 120), ara(-76, -22), ara(1, 4), ara(0.6, 2), rnd() * 3, 0, 7); ctx.fill(); }
  ctx.fillStyle = 'rgba(160,138,100,.9)';
  ctx.beginPath(); ctx.ellipse(-12, -32, 34, 20, 0.1, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.ellipse(14, -44, 22, 26, 0, 0, 7); ctx.fill();
  tarla([[-150, -78], [-62, -78], [-62, -14], [-150, -14]], 'yonca', 90);   // meyve bahçesi altı
  // Dere kıyısı ve yol
  const cizgi = (f, w, renk, dz = 0) => { ctx.beginPath(); for (let x = -1010; x <= 1010; x += 8) { const z = f(x) + dz; x === -1010 ? ctx.moveTo(x, z) : ctx.lineTo(x, z); } ctx.lineWidth = w; ctx.strokeStyle = renk; ctx.stroke(); };
  cizgi(nehirZ, 40, 'rgba(84,120,52,.85)'); cizgi(nehirZ, 27, '#a99d7e'); cizgi(nehirZ, 21, '#7d7458');
  cizgi(yolZ, 6.5, 'rgba(120,110,80,.5)'); cizgi(yolZ, 5, '#bba57f'); cizgi(yolZ, 0.7, '#98825c', -1.2); cizgi(yolZ, 0.7, '#98825c', 1.2);
  ctx.lineWidth = 3.5; ctx.strokeStyle = '#b39d78';
  ctx.beginPath(); ctx.moveTo(-14, yolZ(-14)); ctx.quadraticCurveTo(-18, -8, -14, -22); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(18, yolZ(18)); ctx.quadraticCurveTo(22, -14, 16, -30); ctx.stroke();

  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- Modeller
function traktor() {
  const g = new THREE.Group(), kirmizi = malz('#b8281c', { roughness: 0.45, metalness: 0.2 }), siyah = malz('#1e1e1e', { roughness: 0.9 }), sari = malz('#e0b52a', { roughness: 0.5 });
  const cam = malz('#9fc6d8', { roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.35 });
  g.add(kutu(2.6, 1.1, 1.2, kirmizi, 0.9, 1.35, 0), kutu(1.4, 0.4, 1.5, kirmizi, -0.6, 1.0, 0), kutu(1.3, 1.5, 1.3, cam, -0.65, 2.25, 0), kutu(1.5, 0.12, 1.5, kirmizi, -0.65, 3.05, 0));
  const egzoz = silindir(0.06, 0.06, 1.2, siyah, 6); egzoz.position.set(1.6, 2.3, 0.35); g.add(egzoz);
  const tekerler = [];
  for (const [x, r, w] of [[-0.75, 0.85, 0.5], [1.55, 0.45, 0.3]]) for (const z of [0.85, -0.85]) {
    const t = new THREE.Group(), lastik = silindir(r, r, w, siyah, 16), jant = silindir(r * 0.5, r * 0.5, w + 0.02, sari, 12);
    lastik.rotation.x = jant.rotation.x = Math.PI / 2; t.add(lastik, jant); t.position.set(x, r, z); t.userData.r = r; g.add(t); tekerler.push(t);
  }
  const romork = new THREE.Group(), tahta = malz('#8a6a44');
  romork.add(kutu(3.6, 0.25, 2.2, tahta, 0, 1.0, 0), kutu(3.6, 0.6, 0.1, tahta, 0, 1.4, 1.05), kutu(3.6, 0.6, 0.1, tahta, 0, 1.4, -1.05));
  const saman = malz('#d6b05a', { roughness: 1 });
  for (const [x, z] of [[-1, 0.5], [-1, -0.5], [0.2, 0.5], [0.2, -0.5], [1.3, 0.5], [1.3, -0.5], [-0.4, 0], [0.8, 0]]) romork.add(kutu(1.1, 0.5, 0.48, saman, x, z === 0 ? 1.95 : 1.4, z));
  for (const z of [1.1, -1.1]) { const t = silindir(0.45, 0.45, 0.3, siyah, 14); t.rotation.x = Math.PI / 2; t.position.set(0, 0.45, z); romork.add(t); }
  romork.position.x = -4.2; g.add(romork);
  g.userData.tekerler = tekerler;
  return g;
}
function inek(tur) {
  const g = new THREE.Group();
  const govdeGeo = new THREE.CapsuleGeometry(0.6, 1.3, 4, 10).rotateZ(Math.PI / 2);
  const p = govdeGeo.attributes.position, renk = [], ofs = rnd() * 50;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const c = tur === 'alaca' ? (gurultu(x * 1.6 + ofs, y * 1.6 + z * 1.3) > 0.55 ? [0.08, 0.07, 0.07] : [0.93, 0.91, 0.87]) : tur === 'kahve' ? [0.42, 0.25, 0.14] : [0.16, 0.13, 0.11];
    renk.push(...c);
  }
  govdeGeo.setAttribute('color', new THREE.Float32BufferAttribute(renk, 3));
  const govde = new THREE.Mesh(govdeGeo, malz('#ffffff', { vertexColors: true, roughness: 0.75 }));
  govde.position.y = 1.25; govde.scale.set(1, 1, 0.82); govde.castShadow = true; g.add(govde);
  const kafaRenk = tur === 'alaca' ? '#efebe4' : tur === 'kahve' ? '#5c3820' : '#241d18';
  const bas = new THREE.Group(); bas.position.set(1.15, 1.55, 0); g.add(bas);
  const kafa = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), malz(kafaRenk)); kafa.scale.set(1.5, 0.95, 0.85); kafa.position.set(0.38, -0.12, 0); kafa.castShadow = true; bas.add(kafa);
  const burun = new THREE.Mesh(new THREE.SphereGeometry(0.19, 8, 6), malz('#d9a39a')); burun.position.set(0.78, -0.24, 0); bas.add(burun);
  for (const z of [0.25, -0.25]) {
    const kulak = kutu(0.08, 0.14, 0.26, malz(kafaRenk), 0.2, 0.05, z * 1.3); bas.add(kulak);
    const boynuz = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.22, 6), malz('#e8dcc4')); boynuz.position.set(0.25, 0.2, z * 0.8); boynuz.rotation.x = z > 0 ? 0.6 : -0.6; bas.add(boynuz);
  }
  const bacaklar = [];
  for (const [x, z] of [[0.75, 0.3], [0.75, -0.3], [-0.75, 0.3], [-0.75, -0.3]]) {
    const b = new THREE.Group(), l = silindir(0.1, 0.09, 0.95, malz(tur === 'alaca' ? '#e9e5dd' : kafaRenk), 6); l.position.y = -0.47; b.add(l);
    b.position.set(x, 0.95, z); g.add(b); bacaklar.push(b);
  }
  const kuyruk = new THREE.Group(), kl = silindir(0.03, 0.03, 0.9, malz('#2a2420'), 4); kl.position.y = -0.45; kuyruk.add(kl); kuyruk.position.set(-1.25, 1.6, 0); g.add(kuyruk);
  g.userData = { bas, bacaklar, kuyruk };
  return g;
}
function koyun() {
  const g = new THREE.Group(), yun = malz('#ece5d4', { roughness: 1 }), siyah = malz('#2a2522');
  const geo = new THREE.SphereGeometry(0.5, 10, 8), p = geo.attributes.position, o = rnd() * 9;
  for (let i = 0; i < p.count; i++) { const k = 1 + (gurultu(p.getX(i) * 6 + o, p.getY(i) * 6 + p.getZ(i) * 4) - 0.5) * 0.25; p.setXYZ(i, p.getX(i) * k * 1.35, p.getY(i) * k, p.getZ(i) * k); }
  geo.computeVertexNormals();
  const govde = new THREE.Mesh(geo, yun); govde.position.y = 0.85; govde.castShadow = true; g.add(govde);
  const bas = new THREE.Group(); bas.position.set(0.62, 1.0, 0); g.add(bas);
  const kafa = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), siyah); kafa.scale.set(1.45, 0.9, 0.85); kafa.position.x = 0.18; bas.add(kafa);
  const bacaklar = [];
  for (const [x, z] of [[0.38, 0.2], [0.38, -0.2], [-0.38, 0.2], [-0.38, -0.2]]) {
    const b = new THREE.Group(), l = silindir(0.05, 0.05, 0.6, siyah, 5); l.position.y = -0.3; b.add(l); b.position.set(x, 0.6, z); g.add(b); bacaklar.push(b);
  }
  g.userData = { bas, bacaklar };
  return g;
}
// =====================================================================================
export function ciftlik3d(kap, { hava = null, kaydirmaKok = null, olcek = () => 0, sakin = false } = {}) {
  const tuval = document.createElement('canvas');
  tuval.className = 'tn-uc-tuval';
  tuval.setAttribute('aria-hidden', 'true');
  kap.appendChild(tuval);
  const renderer = new THREE.WebGLRenderer({ canvas: tuval, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(K.piksel, window.devicePixelRatio || 1));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const sahne = new THREE.Scene();
  const kamera = new THREE.PerspectiveCamera(44, 16 / 9, 0.5, 12000);

  // Güneş (Konya), hava (Konya)
  // Yerel geliştirmede ?tn_saat=17.5 ile günün saati denenebilir
  const denemeSaat = ['localhost', '127.0.0.1'].includes(location.hostname) ? Number(new URLSearchParams(location.search).get('tn_saat')) : NaN;
  const g0 = gunesKonumu(32.49, 37.87, Number.isFinite(denemeSaat) && denemeSaat > 0 ? new Date().setUTCHours(Math.floor(denemeSaat) - 3, (denemeSaat % 1) * 60, 0, 0) : Date.now());
  const yuk = g0.yukseklik, gece = THREE.MathUtils.clamp((1 - yuk) / 9, 0, 1), alaca = THREE.MathUtils.clamp(1 - Math.abs(yuk - 5) / 14, 0, 1) * (1 - gece);
  const kod = hava?.kod ?? 1;
  const bulut = kod >= 95 ? 0.95 : kod >= 51 ? 0.82 : kod === 3 ? 0.78 : kod === 2 ? 0.55 : kod === 1 ? 0.38 : 0.22;
  const yagmur = (kod >= 51 && kod <= 67) || (kod >= 80 && kod <= 82) || kod >= 95;
  const sisli = kod === 45 || kod === 48;
  U.uRuzgar.value = THREE.MathUtils.clamp((hava?.ruzgar ?? 10) / 18, 0.45, 1.7);
  U.uBulut.value = bulut;
  const az = THREE.MathUtils.degToRad(g0.azimut), el = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(yuk, 6, 62));
  // Sahne kuzeye bakar; güneş yandan ve biraz arkadan vurur: renkler canlı, gölgeler sahnenin içine düşer
  const gunesYon = gece > 0.5 ? new THREE.Vector3(-0.5, 0.62, 0.2).normalize() : new THREE.Vector3((Math.sin(az) >= 0 ? 1 : -1) * (0.55 + Math.abs(Math.sin(az)) * 0.4), Math.sin(el), 0.38).normalize();
  const L = (a, b, t) => C(a).lerp(C(b), t);
  const kapali = Math.min(0.35, Math.max(0, bulut - 0.6) * 2.2);   // açılış ekranı kapalı havada da renkli kalsın
  const gokUst = L('#2a7de0', '#7d93a6', kapali).lerp(C('#3a68b8'), alaca * 0.7).lerp(C('#040a1c'), gece);
  const gokUfuk = L('#a9dcf7', '#c8d1d8', kapali).lerp(C('#ffbe86'), alaca * 0.85).lerp(C('#1b2846'), gece);
  const gunesRenk = C('#fff0d4').lerp(C('#ff9a4e'), alaca).lerp(C('#a9bde6'), gece);
  const sisRenk = gokUfuk.clone().lerp(C('#cfd5da'), sisli ? 0.6 : 0.05);
  sahne.fog = new THREE.FogExp2(sisRenk, sisli ? 0.0025 : 0.00022 + kapali * 0.0002);
  sahne.background = sisRenk;
  renderer.toneMappingExposure = 1.18 - gece * 0.25;

  const gok = new THREE.Mesh(new THREE.SphereGeometry(5000, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, vertexShader: GOK_VS, fragmentShader: GOK_FS,
    uniforms: { gokUst: { value: gokUst }, gokUfuk: { value: gokUfuk }, gunesYon: { value: gunesYon }, gunesRenk: { value: gunesRenk }, gece: { value: gece },
      bulut: { value: Math.max(bulut, 0.4) }, t: { value: 0 }, bulutRenk: { value: C('#ffffff').lerp(C('#8d99a4'), kapali * 0.7).lerp(C('#ffc9a6'), alaca * 0.6).lerp(C('#1d2840'), gece * 0.9) } },
  }));
  sahne.add(gok);
  // Ortam yansıması: gökyüzü küp haritaya çekilir; camlar, metal ve tüm yüzeyler gerçek gökyüzünü yansıtır
  const pmrem = new THREE.PMREMGenerator(renderer), gokSahne = new THREE.Scene();
  gokSahne.add(new THREE.Mesh(gok.geometry, gok.material));
  sahne.environment = pmrem.fromScene(gokSahne, 0.02, 1, 12000).texture;
  sahne.environmentIntensity = 0.55 + (1 - gece) * 0.25;
  pmrem.dispose();
  const M = malzemeler();
  const notr = new THREE.DataTexture(new Uint8Array([92, 92, 92, 255]), 1, 1); notr.needsUpdate = true; U.uDetay.value = notr;

  const gunes = new THREE.DirectionalLight(gunesRenk, (1 - gece) * (3.3 - bulut * 1.1) + gece * 0.35);
  gunes.castShadow = true;
  gunes.shadow.mapSize.set(K.golge, K.golge);
  Object.assign(gunes.shadow.camera, { left: -170, right: 170, top: 170, bottom: -170, near: 10, far: 900 });
  gunes.shadow.bias = -0.0004; gunes.shadow.normalBias = 0.5;
  gunes.target.position.set(0, 0, -30);
  gunes.position.copy(gunes.target.position).addScaledVector(gunesYon, 420);
  sahne.add(gunes, gunes.target);
  sahne.add(new THREE.HemisphereLight(gokUst.clone().lerp(C('#ffffff'), 0.35), C('#4a5a30').lerp(C('#0c1018'), gece), 0.35 + (1 - gece) * 0.3));

  // Arazi
  const zg = new THREE.PlaneGeometry(AG, AD, K.arazi[0], K.arazi[1]).rotateX(-Math.PI / 2).translate(AX0 + AG / 2, 0, AZ0 + AD / 2);
  const zp = zg.attributes.position;
  for (let i = 0; i < zp.count; i++) zp.setY(i, H(zp.getX(i), zp.getZ(i)));
  zg.computeVertexNormals();
  const doku = zeminDokusu();
  doku.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const zemin = new THREE.Mesh(zg, yamala(new THREE.MeshStandardMaterial({ map: doku, roughness: 0.97 }), 'zemin'));
  zemin.receiveShadow = true;
  sahne.add(zemin);

  // Uzak dağlar: sırtlı (ridged) gürültü; renk eğime ve yüksekliğe göre: alçakta bozkır ve orman, dikte kaya, zirvede kar
  const dg = new THREE.PlaneGeometry(6000, 2400, MOBIL ? 160 : 320, MOBIL ? 64 : 120).rotateX(-Math.PI / 2).translate(0, 0, -2150);
  const dp = dg.attributes.position, yuks = [];
  for (let i = 0; i < dp.count; i++) {
    const x = dp.getX(i), z = dp.getZ(i);
    const sirt = 1 - Math.abs(2 * fbm(x * 0.0011 + 3, z * 0.0011, 6) - 1), sirt2 = 1 - Math.abs(2 * fbm(x * 0.0035 + 9, z * 0.0035, 4) - 1);
    const h = ss(-1000, -1600, z) * (60 + 330 * sirt * sirt + 90 * sirt2 * sirt2 + 40 * fbm(x * 0.012, z * 0.012, 3)) * (0.6 + ss(-1300, -3000, z) * 0.95) + ss(2000, 3000, Math.abs(x)) * 160;
    dp.setY(i, h - 6); yuks.push(h);
  }
  dg.computeVertexNormals();
  const dn = dg.attributes.normal, drenk = [], tmp = new THREE.Color();
  for (let i = 0; i < dp.count; i++) {
    const x = dp.getX(i), z = dp.getZ(i), h = yuks[i], egim = 1 - dn.getY(i), n = gurultu(x * 0.03, z * 0.03);
    const orman = ss(40, 90, h) * (1 - ss(210, 260, h)) * (1 - ss(0.25, 0.45, egim)) * ss(0.45, 0.6, gurultu(x * 0.006, z * 0.006));
    const kaya = Math.max(ss(0.26, 0.46, egim), ss(260, 380, h) * 0.85);
    const kar = ss(390, 450, h + (n - 0.5) * 80) * (1 - ss(0.5, 0.7, egim));
    tmp.set('#8a8358').lerp(C('#6f7a48'), n * 0.6).lerp(C('#2f4428'), orman * 0.9).lerp(C(n > 0.5 ? '#857b6c' : '#766d62'), kaya).lerp(C('#f4f6f8'), kar);
    drenk.push(tmp.r, tmp.g, tmp.b);
  }
  dg.setAttribute('color', new THREE.Float32BufferAttribute(drenk, 3));
  sahne.add(new THREE.Mesh(dg, yamala(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), 'dag')));

  // Dere
  const su = { pos: [], kenar: [], idx: [] };
  for (let i = 0, n = 0; i <= 500; i++) {
    const x = AX0 + (i / 500) * AG, z = nehirZ(x), w = 8.5 + 2.5 * Math.sin(x * 0.03);
    su.pos.push(x, -1.15, z - w, x, -1.15, z, x, -1.15, z + w); su.kenar.push(1, 0, 1);
    if (i < 500) su.idx.push(n, n + 3, n + 1, n + 1, n + 3, n + 4, n + 1, n + 4, n + 2, n + 2, n + 4, n + 5);
    n += 3;
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(su.pos, 3)); sg.setAttribute('kenar', new THREE.Float32BufferAttribute(su.kenar, 1)); sg.setIndex(su.idx);
  const suMalz = new THREE.ShaderMaterial({ vertexShader: SU_VS, fragmentShader: SU_FS, uniforms: {
    t: { value: 0 }, gokUst: { value: gokUst }, gokUfuk: { value: gokUfuk }, gunesYon: { value: gunesYon }, gunesRenk: { value: gunesRenk },
    sisRenk: { value: sisRenk }, sisYog: { value: sahne.fog.density }, gece: { value: gece } } });
  sahne.add(new THREE.Mesh(sg, suMalz));

  // Ağaçlar
  const AGAC = {
    ceviz: { renk: ['#ffffff', '#f2f8e4', '#f8f0c8', '#ffe9a8'], liste: [] },
    kavak: { renk: ['#fff4b0', '#ffe27a', '#f6ffd8', '#ffd860'], liste: [] },    // ekimde sararan kavaklar
    meyve: { renk: ['#ffffff', '#f6f6dc', '#ffd9a0'], liste: [] },
    sogut: { renk: ['#f6ffd8', '#ffffff'], liste: [] },
    cam: { renk: ['#ffffff', '#e8f0e0'], liste: [] },
  };
  const ekle = (tur, x, z, boy, r) => AGAC[tur].liste.push([x, H(x, z), z, boy, r]);
  for (let x = -330; x < -60; x += ara(5.5, 7.5)) ekle('kavak', x, yolZ(x) - 6.5, ara(13, 19), ara(1.4, 1.9));
  for (let x = 140; x < 380; x += ara(5.5, 7.5)) ekle('kavak', x, yolZ(x) - 6.5, ara(13, 19), ara(1.4, 1.9));
  for (let k = 0; k < 9; k++) {   // uzak tarlalar arasında kavak dizileri
    let x = ara(-800, 800), z = ara(-900, -170); const a = ara(0, Math.PI), n = Math.floor(ara(8, 22));
    for (let i = 0; i < n; i++) { x += Math.cos(a) * 7; z += Math.sin(a) * 7; if (Math.abs(z - nehirZ(x)) > 14) ekle('kavak', x, z, ara(13, 18), ara(1.3, 1.8)); }
  }
  for (let x = -146; x <= -66; x += 7.2) for (let z = -72; z <= -20; z += 7.2) ekle('meyve', x + ara(-0.6, 0.6), z + ara(-0.6, 0.6), ara(3.6, 4.6), ara(1.8, 2.3));
  for (const [x, z] of [[-52, -14], [-40, -52], [30, -12], [-6, -66], [64, -86], [132, -40], [150, -6]]) ekle('ceviz', x, z, ara(10, 13), ara(4.2, 5.6));
  for (let i = 0; i < 90; i++) { const x = ara(-950, 950), s = rnd() < 0.5 ? -1 : 1; ekle('sogut', x, nehirZ(x) + s * ara(13, 22), ara(7, 9.5), ara(3.4, 4.6)); }
  for (let i = 0; i < 260; i++) {   // dağınık ağaçlar ve korular
    const x = ara(-980, 980), z = ara(-1050, 250);
    if ((Math.abs(x) < 160 && z > -100 && z < 75) || Math.abs(z - nehirZ(x)) < 18) continue;
    ekle('ceviz', x, z, ara(8, 12), ara(3.4, 5));
  }
  for (let k = 0; k < 14; k++) {   // tepelerde karaçam ormanı
    const cx = ara(-950, 950), cz = ara(-1080, -420), r = ara(50, 140);
    for (let i = 0; i < K.cam / 14; i++) { const a = rnd() * 6.28, d = Math.sqrt(rnd()) * r; ekle('cam', cx + Math.cos(a) * d, cz + Math.sin(a) * d, ara(11, 17), ara(2.2, 3.2)); }
  }
  // Ağaçlar: her tür için üç ayrıntılı ve bir uzak (sade) çeşit; yakındakiler ayrıntılı, uzaktakiler sade çizilir
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), sc = new THREE.Vector3(), yukari = new THREE.Vector3(0, 1, 0);
  const yaprakMalz = yamala(new THREE.MeshStandardMaterial({ map: M.yaprak, vertexColors: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8 }), 'yaprak');
  const yaprakDerinlik = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: M.yaprak, alphaTest: 0.4 });
  const kabukMalz = yamala(kabukMalzemesi(), 'agac');
  const KAMERA_YERI = new THREE.Vector3(-30, 10, 66);
  for (const [tur, a] of Object.entries(AGAC)) {
    const cesitler = [agacUret(tur, 1), agacUret(tur, 1), agacUret(tur, 1), agacUret(tur, 0.45)];
    const kovalar = cesitler.map(() => []);
    for (const t of a.liste) { const uzak = KAMERA_YERI.distanceTo(v3.set(t[0], t[1], t[2])) > (MOBIL ? 220 : 320); kovalar[uzak ? 3 : Math.floor(rnd() * 3)].push(t); }
    cesitler.forEach((c, ci) => {
      const liste = kovalar[ci]; if (!liste.length) return;
      const yap = new THREE.InstancedMesh(c.yaprak, yaprakMalz, liste.length), kab = new THREE.InstancedMesh(c.kabuk, kabukMalz, liste.length);
      yap.customDepthMaterial = yaprakDerinlik;
      liste.forEach(([x, y, z, boy], i) => {
        const s0 = boy / c.boy;
        m4.compose(v3.set(x, y - 0.15, z), q.setFromAxisAngle(yukari, rnd() * 6.28), sc.set(s0 * ara(0.9, 1.1), s0, s0 * ara(0.9, 1.1)));
        yap.setMatrixAt(i, m4); kab.setMatrixAt(i, m4);
        yap.setColorAt(i, C(a.renk[Math.floor(rnd() * a.renk.length)]).multiplyScalar(ara(0.88, 1.08)));
      });
      for (const im of [yap, kab]) { im.castShadow = true; im.receiveShadow = true; sahne.add(im); }
    });
  }

  // Buğday tarlası (ön plan)
  const bm = yamala(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.75 }), 'bugday');
  const bugday = new THREE.InstancedMesh(basakGeo(), bm, K.bugday);
  for (let i = 0; i < K.bugday; i++) {
    const x = MOBIL ? ara(-72, 72) : ara(-116, 116), z = MOBIL ? ara(17, 58) : ara(16, 59), s = ara(0.85, 1.18);
    m4.compose(v3.set(x, H(x, z) - 0.05, z), q.setFromAxisAngle(yukari, ara(-0.3, 0.3)), sc.set(s, s * ara(0.9, 1.1), s));
    bugday.setMatrixAt(i, m4);
    bugday.setColorAt(i, C('#ffffff').multiplyScalar(ara(0.82, 1.08)));
  }
  bugday.receiveShadow = true;
  sahne.add(bugday);

  // Ön plan: buğday arasında gelincik ve peygamber çiçekleri (Anadolu tarlasının imzası)
  const cicekGeo = (() => {
    const sap = new THREE.CylinderGeometry(0.008, 0.012, 0.75, 4).translate(0, 0.375, 0);
    const tac = new THREE.SphereGeometry(0.12, 8, 4).scale(1, 0.45, 1).translate(0, 0.79, 0);
    const ic = new THREE.SphereGeometry(0.035, 6, 4).translate(0, 0.83, 0);
    const boya = (g, c) => { g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: g.attributes.position.count }, () => c).flat(), 3)); return g; };
    const parca = [boya(sap, [0.25, 0.42, 0.14]), boya(tac, [1, 1, 1]), boya(ic, [0.06, 0.05, 0.05])].map((g) => g.toNonIndexed());
    const pos = [], nor = [], col = [];
    for (const g of parca) { pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); col.push(...g.attributes.color.array); }
    const m = new THREE.BufferGeometry(); m.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); m.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); m.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return m;
  })();
  for (const [renk, sayi] of [['#e8231c', MOBIL ? 700 : 2200], ['#4f6fe0', MOBIL ? 200 : 600]]) {
    const im = new THREE.InstancedMesh(cicekGeo, yamala(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), 'bugday'), sayi);
    for (let i = 0; i < sayi; i++) {
      const kenar = rnd() < 0.45, x = MOBIL ? ara(-60, 60) : ara(-110, 110), z = kenar ? ara(52, 60) : ara(20, 60), s2 = ara(0.85, 1.25);
      m4.compose(v3.set(x, H(x, z) - 0.02, z), q.setFromAxisAngle(yukari, rnd() * 6.28), sc.set(s2, s2 * ara(0.9, 1.25), s2));
      im.setMatrixAt(i, m4); im.setColorAt(i, C(renk).multiplyScalar(ara(0.85, 1.1)));
    }
    sahne.add(im);
  }
  // Kelebekler (beyaz ve sarı), buğdayın üstünde
  const kelebekler = Array.from({ length: MOBIL ? 5 : 9 }, (_, i) => {
    const g = new THREE.Group(), kanatM = new THREE.MeshStandardMaterial({ color: i % 3 ? '#f4f1e6' : '#f2cf3a', side: THREE.DoubleSide, roughness: 0.6 });
    const kg = new THREE.PlaneGeometry(0.07, 0.06).translate(0.035, 0, 0), sol = new THREE.Mesh(kg, kanatM), sag = new THREE.Mesh(kg, kanatM);
    sol.rotation.x = sag.rotation.x = -Math.PI / 2; sag.scale.x = -1;
    const kanatS = new THREE.Group(), kanatD = new THREE.Group(); kanatS.add(sol); kanatD.add(sag); g.add(kanatS, kanatD);
    g.userData = { kanatS, kanatD, merkez: new THREE.Vector3(ara(-30, 20), 0, ara(40, 56)), faz: rnd() * 9, hiz: ara(0.25, 0.45) };
    sahne.add(g); return g;
  });

  // Çiftlik
  const yere = (o, x, z, ry = 0) => { o.position.set(x, H(x, z), z); o.rotation.y = ry; sahne.add(o); return o; };
  const ev = yere(koyEvi(M, gece), -14, -30, 0.08);
  yere(ahir(M), 16, -48, -0.05);
  yere(silo(M), 32, -40);
  const saman = malz('#d4ad57', { roughness: 1 });
  for (const [x, z, y] of [[2, -24, 0], [4.2, -24.4, 0], [6.4, -24.2, 0], [3.1, -24.2, 1.4], [5.3, -24.3, 1.4], [-34, -10, 0], [-31.6, -11, 0]]) {
    const b = silindir(0.78, 0.78, 1.3, saman, 16); b.rotation.z = Math.PI / 2; b.position.set(x, H(x, z) + 0.78 + y * 1.0, z); sahne.add(b);
  }
  // Otlak çiti
  const cit = [];
  const KOSELER = [[40, -20], [122, -20], [122, -80], [40, -80], [40, -20]];
  for (let k = 0; k < 4; k++) {
    const [ax, az2] = KOSELER[k], [bx, bz] = KOSELER[k + 1], n = Math.ceil(Math.hypot(bx - ax, bz - az2) / 3);
    for (let i = 0; i < n; i++) { const x = ax + ((bx - ax) * i) / n, z = az2 + ((bz - az2) * i) / n; cit.push([x, z, Math.atan2(bz - az2, bx - ax)]); }
  }
  const direk = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 1.5, 0.16).translate(0, 0.75, 0), malz('#7a5c3c'), cit.length);
  const tel = new THREE.InstancedMesh(new THREE.BoxGeometry(3.05, 0.1, 0.06).translate(1.5, 0, 0), malz('#8a6a48'), cit.length * 2);
  cit.forEach(([x, z, a], i) => {
    const y = H(x, z);
    m4.compose(v3.set(x, y, z), q.identity(), sc.set(1, 1, 1)); direk.setMatrixAt(i, m4);
    q.setFromAxisAngle(yukari, -a);
    m4.compose(v3.set(x, y + 0.6, z), q, sc.set(1, 1, 1)); tel.setMatrixAt(i * 2, m4);
    m4.compose(v3.set(x, y + 1.15, z), q, sc.set(1, 1, 1)); tel.setMatrixAt(i * 2 + 1, m4);
  });
  direk.castShadow = tel.castShadow = true; sahne.add(direk, tel);
  // Elektrik direkleri ve teller
  const direkler = [];
  for (let x = -460; x <= 460; x += 46) { const z = yolZ(x) + 6.5, d = new THREE.Group(); d.add(silindir(0.13, 0.17, 9, malz('#5b4a3a'), 6)); d.children[0].position.y = 4.5; d.add(kutu(2.2, 0.15, 0.15, malz('#5b4a3a'), 0, 8.4, 0)); yere(d, x, z); direkler.push([x, H(x, z) + 8.5, z]); }
  const telMalz = new THREE.LineBasicMaterial({ color: gece > 0.5 ? '#0a0d12' : '#2c2c2c', transparent: true, opacity: 0.7 });
  for (const ofs of [-0.95, 0, 0.95]) for (let i = 0; i < direkler.length - 1; i++) {
    const [ax, ay, az2] = direkler[i], [bx, by, bz] = direkler[i + 1], noktalar = [];
    for (let k = 0; k <= 12; k++) { const t = k / 12; noktalar.push(new THREE.Vector3(ax + (bx - ax) * t + ofs * 0.05, ay + (by - ay) * t - Math.sin(t * Math.PI) * 1.1, az2 + (bz - az2) * t + ofs)); }
    sahne.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(noktalar), telMalz));
  }
  // Telde oturan serçeler
  const oturanlar = [];
  {
    const i0 = direkler.findIndex(([x]) => x > -60), [ax, ay, az2] = direkler[i0], [bx, by, bz] = direkler[i0 + 1];
    const kusM = new THREE.MeshStandardMaterial({ color: gece > 0.5 ? '#0d1016' : '#3a2f26', roughness: 0.8 });
    for (const t of [0.22, 0.27, 0.31, 0.58, 0.63, 0.81]) {
      const k = new THREE.Group(), g2 = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 6), kusM); g2.scale.set(1.35, 1, 0.9); k.add(g2);
      const bas = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), kusM); bas.position.set(0.1, 0.07, 0); k.add(bas);
      const kuyruk = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.015, 0.05), kusM); kuyruk.position.set(-0.14, -0.02, 0); kuyruk.rotation.z = 0.5; k.add(kuyruk);
      k.position.set(ax + (bx - ax) * t, ay + (by - ay) * t - Math.sin(t * Math.PI) * 1.1 + 0.08, az2 + (bz - az2) * t);
      k.rotation.y = rnd() < 0.5 ? 0.2 : Math.PI - 0.2; k.userData = { bas, faz: rnd() * 9 };
      sahne.add(k); oturanlar.push(k);
    }
  }
  // Uzak köy ve cami
  const koyX = -420, koyZ = -560, evler = [];
  for (let i = 0; i < 34; i++) { const a = rnd() * 6.28, d = Math.sqrt(rnd()) * 70, x = koyX + Math.cos(a) * d, z = koyZ + Math.sin(a) * d * 0.7; evler.push([x, H(x, z), z, ara(5, 9), ara(5, 8), rnd() * 0.6]); }
  const evDuvar = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), malz('#ffffff'), evler.length);
  const evCati = new THREE.InstancedMesh(new THREE.ConeGeometry(0.75, 0.5, 4).rotateY(Math.PI / 4).translate(0, 0.25, 0), malz('#a9512e', { flatShading: true }), evler.length);
  evler.forEach(([x, y, z, w, d, a], i) => {
    const h = ara(4, 6.5); q.setFromAxisAngle(yukari, a);
    m4.compose(v3.set(x, y - 0.5, z), q, sc.set(w, h, d)); evDuvar.setMatrixAt(i, m4); evDuvar.setColorAt(i, C(['#eee6d8', '#e8dcc6', '#f2ede4', '#e3d3b8'][i % 4]));
    m4.compose(v3.set(x, y - 0.5 + h, z), q, sc.set(w * 1.08, 4.4, d * 1.08)); evCati.setMatrixAt(i, m4);
  });
  evDuvar.castShadow = evCati.castShadow = true; sahne.add(evDuvar, evCati);
  const cami = new THREE.Group(), cb = malz('#f1ede6'), kursun = malz('#8d969d', { metalness: 0.5, roughness: 0.4 });
  cami.add(kutu(14, 9, 14, cb, 0, 4.5, 0));
  const kubbe = new THREE.Mesh(new THREE.SphereGeometry(6.2, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), kursun); kubbe.position.y = 9; cami.add(kubbe);
  const minare = silindir(0.95, 1.1, 30, cb, 12); minare.position.set(9, 15, 5); cami.add(minare);
  const serefe = silindir(1.5, 1.5, 0.6, cb, 12); serefe.position.set(9, 24, 5); cami.add(serefe);
  const kulah = new THREE.Mesh(new THREE.ConeGeometry(1.05, 5, 12), kursun); kulah.position.set(9, 32.5, 5); cami.add(kulah);
  yere(cami, koyX + 10, koyZ - 5, 0.4);
  // Rüzgâr türbinleri (sırtta)
  const turbinler = [];
  for (let i = 0; i < 7; i++) {
    const x = -330 + i * 108 + ara(-15, 15), z = -760 - 40 * Math.sin(i * 1.3);
    const t = yere(turbin(M, gece), x, z, 0.15); t.userData.faz = rnd() * 6; turbinler.push(t);
  }

  // Hayvanlar
  const sur = [];
  for (let i = 0; i < 7; i++) {
    const c = inek(['alaca', 'alaca', 'kahve', 'kara'][i % 4]), x = ara(52, 112), z = ara(-70, -30);
    yere(c, x, z, rnd() * 6.28); c.userData = { ...c.userData, bolge: [44, 118, -76, -24], hiz: 0.6, faz: rnd() * 9, hedef: null, bekle: ara(2, 9) }; sur.push(c);
  }
  for (let i = 0; i < 16; i++) {
    const k = koyun(), x = ara(-55, 10), z = ara(-96, -76);
    yere(k, x, z, rnd() * 6.28); k.userData = { ...k.userData, bolge: [-62, 16, -98, -74], hiz: 0.45, faz: rnd() * 9, hedef: null, bekle: ara(1, 6) }; sur.push(k);
  }
  // Traktör
  const tr = traktor(); sahne.add(tr);
  // Kuşlar
  const kuslar = [], kusMalz = new THREE.MeshBasicMaterial({ color: gece > 0.5 ? '#0b0f18' : '#2d2a28', side: THREE.DoubleSide, fog: true });
  const kanatGeo = new THREE.BufferGeometry(); kanatGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.25, 0, 0, 0.25, 1.1, 0.05, 0.05], 3)); kanatGeo.computeVertexNormals();
  for (let i = 0; i < 11; i++) {
    const b = new THREE.Group(), s = new THREE.Mesh(kanatGeo, kusMalz), sg2 = new THREE.Mesh(kanatGeo, kusMalz); sg2.scale.x = -1;
    b.add(s, sg2, new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.7), kusMalz));
    b.userData = { s, sg: sg2, ofs: new THREE.Vector3(ara(-12, 12), ara(-4, 4), ara(-12, 12)), faz: rnd() * 6 };
    sahne.add(b); kuslar.push(b);
  }
  // Leylekler: termikte daire çizerek süzülen küçük sürü
  const leylekler = Array.from({ length: 5 }, (_, i) => {
    const l = leylek(); l.scale.setScalar(1.7); l.rotation.order = 'YXZ';
    l.userData = { ...l.userData, faz: i * 1.37, ofs: new THREE.Vector3(ara(-22, 22), ara(-5, 5), ara(-22, 22)), hiz: ara(0.045, 0.06) };
    sahne.add(l); return l;
  });
  // Elektrik direğinde leylek yuvası ve yuvada duran leylek
  const yuvaDirek = direkler.find(([x]) => x >= 0) || direkler[0];
  const yuva = leylekYuvasi(); yuva.position.set(yuvaDirek[0], yuvaDirek[1] + 0.9, yuvaDirek[2]); sahne.add(yuva);
  const yuvadaki = leylek({ ucuyor: false }); yuvadaki.position.set(yuvaDirek[0], yuvaDirek[1] + 1.05, yuvaDirek[2]); yuvadaki.rotation.y = 2.6; sahne.add(yuvadaki);
  // Yolcu uçağı: arada bir yüksekten geçer, iz bulutu bırakır
  const tayyare = ucak(); tayyare.visible = false; sahne.add(tayyare);
  tayyare.userData.izMalz.uniforms.gece.value = gece;
  const ucus = { sonraki: 3, x: 0, yon: 1, z: -2600 };
  // Duman ve toz
  const dumanDoku = yumusakDoku();
  const dumanlar = Array.from({ length: 22 }, (_, i) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dumanDoku, color: gece > 0.5 ? '#6c7280' : '#e9ecef', transparent: true, depthWrite: false, opacity: 0 }));
    s.userData.yas = i / 22; sahne.add(s); return s;
  });
  const bacaUcu = new THREE.Vector3(2.6, 10.3, -1.6).applyMatrix4(ev.matrixWorld.compose(ev.position, ev.quaternion, ev.scale));
  const tozlar = Array.from({ length: 26 }, () => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dumanDoku, color: '#c8b48c', transparent: true, depthWrite: false, opacity: 0 })); s.userData.yas = 1; sahne.add(s); return s; });
  // Gece: kapı lambası
  if (gece > 0.4) {
    const lamba = new THREE.PointLight('#ffb35c', 40 * gece, 40, 1.8); lamba.position.copy(new THREE.Vector3(0, 2.9, 5.2).applyMatrix4(ev.matrixWorld)); sahne.add(lamba);
  }
  // Yağmur
  let yagmurCizgi = null;
  if (yagmur) {
    const n = MOBIL ? 1500 : 4000, p = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) { const x = ara(-60, 60), y = ara(0, 50), z = ara(-20, 80); p.set([x, y, z, x + 0.05, y - 0.9, z], i * 6); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    yagmurCizgi = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#c7d3de', transparent: true, opacity: 0.35 }));
    sahne.add(yagmurCizgi);
  }

  // Fotoğraf gerçekliğinde dokular (Poly Haven, CC0) ve gündüz HDRI ortam ışığı: yüklenince yerine geçer
  const maksAni = renderer.capabilities.getMaxAnisotropy();
  const yukle = (ad, renkli) => new Promise((coz) => new THREE.TextureLoader().load(`/img/doku/${ad}.jpg`, (t) => {
    if (renkli) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = maksAni; coz(t);
  }, undefined, () => coz(null)));
  const fotoDoku = async (m, ad, { metal = false, renk = null, tekrar = 1, donme = 0 } = {}) => {
    const [r1, n1, a1] = await Promise.all([yukle(`${ad}_renk`, true), yukle(`${ad}_normal`), yukle(`${ad}_arm`)]);
    if (!r1 || !calisiyor) return;
    for (const t of [r1, n1, a1]) if (t) { t.repeat.set(tekrar, tekrar); t.rotation = donme; t.center.set(0.5, 0.5); }
    m.map = r1; m.normalMap = n1; m.normalScale = new THREE.Vector2(1, 1);
    if (a1) { m.aoMap = a1; m.roughnessMap = a1; m.roughness = 1; if (metal) { m.metalnessMap = a1; m.metalness = 1; } }
    if (renk) m.color.set(renk);
    m.needsUpdate = true;
  };
  Promise.all([
    fotoDoku(M.sva, 'sva'), fotoDoku(M.tas, 'tas'), fotoDoku(M.kiremit, 'kiremit', { tekrar: 0.6 }), fotoDoku(M.ahirTahta, 'tahta', { renk: '#ff6650' }),
    fotoDoku(M.sac, 'sac', { metal: true }), fotoDoku(M.siloSac, 'sac', { metal: true, donme: Math.PI / 2 }),
    yukle('zemin_renk', true).then((t) => { if (t) U.uDetay.value = t; }),
  ]).catch(() => {});
  if (gece < 0.5) import('/vendor/three-ek/loaders/HDRLoader.js').then(({ HDRLoader }) => new HDRLoader().load('/img/doku/gokyuzu_1k.hdr', (hdr) => {
    if (!calisiyor) return;
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    const p2 = new THREE.PMREMGenerator(renderer);
    sahne.environment = p2.fromEquirectangular(hdr).texture; sahne.environmentIntensity = 0.5; hdr.dispose(); p2.dispose();
  })).catch(() => {});

  // ---------- Döngü
  let genis = 1, yuksek = 1;
  function boyut() {
    const r = kap.getBoundingClientRect(); genis = Math.max(1, r.width); yuksek = Math.max(1, r.height);
    renderer.setSize(genis, yuksek, false);
    kamera.aspect = genis / yuksek; kamera.fov = kamera.aspect < 0.9 ? 62 : 44; kamera.updateProjectionMatrix();
    efekt?.boyut(genis, yuksek);
  }
  let efekt = null;
  boyut();
  const ro = new ResizeObserver(boyut); ro.observe(kap);
  sonIslemKur(renderer, sahne, kamera, { mobil: MOBIL }).then((e) => { if (!calisiyor) return e.yokEt(); efekt = e; boyut(); }).catch(() => {});
  let fx = 0, fy = 0, hfx = 0, hfy = 0;
  const fare = (e) => { if (e.pointerType !== 'mouse') return; hfx = e.clientX / innerWidth - 0.5; hfy = e.clientY / innerHeight - 0.5; };
  kap.parentElement.addEventListener('pointermove', fare);

  let gorunur = true, calisiyor = true, kare = 0, onceki = performance.now(), saat = 0, olcum = [], ilk = true;
  const io = new IntersectionObserver((g) => { gorunur = g[0].isIntersecting; }, { root: kaydirmaKok, threshold: 0 });
  io.observe(kap);
  const trDurum = { x: -200, yon: 1, aci: 0, mesafe: 0, tozSira: 0 };
  const hedef = new THREE.Vector3();
  let hazirCoz; const hazir = new Promise((r) => { hazirCoz = r; });

  function adim(simdi) {
    if (!calisiyor) return;
    kare = requestAnimationFrame(adim);
    if (!gorunur || document.hidden) { onceki = simdi; return; }
    const dt = Math.min(0.05, (simdi - onceki) / 1000); onceki = simdi; saat += dt;
    U.uT.value = saat; gok.material.uniforms.t.value = saat; suMalz.uniforms.t.value = saat;
    // Kamera: yavaş drone süzülüşü (gidip gelir), fare ve kaydırmayla hafif kayar
    // Hareket azaltma tercihinde kamera sabit durur (fare, süzülme ve kaydırma kapalı); sahnedeki hafif yaşam sürer
    if (!sakin) { fx += (hfx - fx) * 0.04; fy += (hfy - fy) * 0.04; }
    const ks = sakin ? 0 : saat, u = sakin ? 0.55 : 0.5 - 0.5 * Math.cos((ks * Math.PI * 2) / 90), dikey = kamera.aspect < 0.9;
    const kx = (dikey ? THREE.MathUtils.lerp(-24, 24, u) : THREE.MathUtils.lerp(-50, -16, u)) + fx * 8, ky = (dikey ? 12 : 9.5) + Math.sin(ks * 0.13) * 1.2 - fy * 2 + (sakin ? 0 : olcek() * 10), kz = (dikey ? 78 : 66) + Math.sin(ks * 0.09) * 3;
    kamera.position.set(kx, ky, kz);
    hedef.set((dikey ? kx * 0.15 : kx + 3) + fx * 10, (dikey ? 9 : 11) - fy * 3 + (sakin ? 0 : olcek() * 4), -40);
    kamera.lookAt(hedef);
    // Türbinler
    for (const t of turbinler) { t.userData.rotor.rotation.z = -saat * 0.75 * U.uRuzgar.value - t.userData.faz; t.userData.isik.visible = Math.sin(saat * 2.2 + t.userData.faz) > 0; }
    // Kuşlar: tarlanın üstünde geniş daire
    kuslar.forEach((b, i) => {
      const a = saat * 0.09 + i * 0.03, mx = Math.cos(a) * 140, mz = -80 + Math.sin(a) * 70;
      b.position.set(mx + b.userData.ofs.x, 42 + b.userData.ofs.y + Math.sin(saat + i) * 1.5, mz + b.userData.ofs.z);
      b.rotation.y = -a; const k = Math.sin(saat * 9 + b.userData.faz) * 0.55; b.userData.s.rotation.z = k; b.userData.sg.rotation.z = -k;
    });
    for (const k of kelebekler) {
      const d = k.userData, a = saat * d.hiz + d.faz;
      k.position.set(d.merkez.x + Math.sin(a) * 6 + Math.sin(a * 2.3) * 1.5, H(d.merkez.x, d.merkez.z) + 1.3 + Math.sin(a * 3.1) * 0.5, d.merkez.z + Math.cos(a * 0.8) * 4);
      k.rotation.y = -a; const c2 = Math.sin(saat * 22 + d.faz) * 1.1; d.kanatS.rotation.x = c2; d.kanatD.rotation.x = -c2;
    }
    leylekler.forEach((l) => {
      const d = l.userData, th = saat * d.hiz + d.faz * 0.12, R = 70;
      l.position.set(-25 + Math.cos(th) * R + d.ofs.x, 34 + d.ofs.y + Math.sin(saat * 0.3 + d.faz) * 3, -95 + Math.sin(th) * R * 0.6 + d.ofs.z);
      l.rotation.set(-0.28, Math.atan2(-Math.cos(th), -Math.sin(th) / 0.6), 0);
      const dongu = (saat + d.faz * 2) % 7, cirp = dongu < 1.6 ? Math.sin(dongu * Math.PI * 2 / 0.8) * 0.5 : 0.08;   // kanat çırp, sonra süzül
      for (const { kanat, dis, s: y } of d.kanatlar) { kanat.rotation.x = -y * cirp; dis.rotation.x = -y * cirp * 0.7; }
    });
    { const b = yuvadaki.userData.bas, tak = (saat % 11) < 1.4; b.bas.position.y = tak ? 1.78 : 1.68; b.gaga.rotation.z = tak ? -0.4 + Math.sin(saat * 30) * 0.15 : -Math.PI / 2 - 0.5; }
    ucus.sonraki -= dt;
    if (ucus.sonraki <= 0 && !tayyare.visible) { ucus.yon = rnd() < 0.5 ? 1 : -1; ucus.x = -4200 * ucus.yon; ucus.z = ara(-3000, -2200); ucus.y = ara(620, 760); tayyare.visible = true; tayyare.rotation.y = ucus.yon > 0 ? 0.05 : Math.PI + 0.05; }
    if (tayyare.visible) {
      ucus.x += ucus.yon * 230 * dt; tayyare.position.set(ucus.x, ucus.y, ucus.z);
      tayyare.userData.isik.visible = Math.sin(saat * 8) > 0.6;
      if (Math.abs(ucus.x) > 4300 && Math.sign(ucus.x) === ucus.yon) { tayyare.visible = false; ucus.sonraki = ara(45, 75); }
    }
    for (const k of oturanlar) k.userData.bas.rotation.y = Math.sin(saat * 0.9 + k.userData.faz) > 0.7 ? 0.8 : 0;
    // Hayvanlar: otla, bazen birkaç adım yürü
    for (const h of sur) {
      const d = h.userData; d.bekle -= dt;
      if (d.hedef) {
        const dx = d.hedef[0] - h.position.x, dz = d.hedef[1] - h.position.z, m = Math.hypot(dx, dz);
        const ist = Math.atan2(-dz, dx); let fark = ist - h.rotation.y; fark = Math.atan2(Math.sin(fark), Math.cos(fark)); h.rotation.y += fark * Math.min(1, dt * 2);
        const v = d.hiz * dt; h.position.x += Math.cos(h.rotation.y) * v; h.position.z -= Math.sin(h.rotation.y) * v; h.position.y = H(h.position.x, h.position.z);
        d.bacaklar.forEach((b, j) => { b.rotation.z = Math.sin(saat * 6 + (j % 2 ? 0 : Math.PI) + (j > 1 ? Math.PI : 0)) * 0.35; });
        d.bas.rotation.z = THREE.MathUtils.lerp(d.bas.rotation.z, 0, dt * 3);
        if (m < 0.5 || d.bekle < -12) { d.hedef = null; d.bekle = ara(4, 14); }
      } else {
        d.bacaklar.forEach((b) => { b.rotation.z *= 0.9; });
        d.bas.rotation.z = THREE.MathUtils.lerp(d.bas.rotation.z, -0.75 + Math.sin(saat * 2.2 + d.faz) * 0.12, dt * 2);
        if (d.bekle < 0) { const [a, b, c, e] = d.bolge; d.hedef = [ara(a, b), ara(c, e)]; d.bekle = 0; }
      }
      if (d.kuyruk) d.kuyruk.rotation.x = Math.sin(saat * 2.4 + d.faz) * 0.35;
    }
    // Traktör: yolda gidip gelir, römork ve toz
    const TR_HIZ = 4.2;
    trDurum.x += trDurum.yon * TR_HIZ * dt; trDurum.mesafe += TR_HIZ * dt;
    if (trDurum.x > 300) trDurum.yon = -1; if (trDurum.x < -300) trDurum.yon = 1;
    const tx = trDurum.x, tz = yolZ(tx) + (trDurum.yon > 0 ? 1.3 : -1.3);
    const istenen = Math.atan2(-(yolZ(tx + trDurum.yon) - yolZ(tx)), trDurum.yon);   // model +x yönüne bakar
    trDurum.aci += Math.atan2(Math.sin(istenen - trDurum.aci), Math.cos(istenen - trDurum.aci)) * Math.min(1, dt * 1.2);
    tr.position.set(tx, H(tx, tz), tz); tr.rotation.y = trDurum.aci;
    for (const t of tr.userData.tekerler) t.rotation.z = -trDurum.mesafe / t.userData.r;
    trDurum.tozSira += dt;
    if (trDurum.tozSira > 0.12) {
      trDurum.tozSira = 0;
      const s = tozlar.find((x) => x.userData.yas >= 1);
      if (s) { s.userData.yas = 0; s.position.set(tx - Math.cos(trDurum.aci) * 5.5, tr.position.y + 0.6, tz + Math.sin(trDurum.aci) * 5.5); }
    }
    for (const s of tozlar) {
      if (s.userData.yas >= 1) { s.material.opacity = 0; continue; }
      s.userData.yas += dt / 2.6; const y = s.userData.yas;
      s.position.y += dt * 0.6; s.scale.setScalar(1 + y * 5); s.material.opacity = (1 - y) * 0.32 * (1 - gece * 0.7);
    }
    for (const s of dumanlar) {
      s.userData.yas = (s.userData.yas + dt / 7) % 1; const y = s.userData.yas;
      s.position.set(bacaUcu.x + y * 7 * U.uRuzgar.value + Math.sin(saat + y * 9) * 0.4, bacaUcu.y + y * 14, bacaUcu.z - y * 2);
      s.scale.setScalar(0.8 + y * 6); s.material.opacity = Math.sin(y * Math.PI) * 0.42;
    }
    if (yagmurCizgi) { yagmurCizgi.position.y = -((saat * 22) % 50); yagmurCizgi.position.x = kx * 0.5; }

    if (efekt) efekt.ciz(dt, saat); else renderer.render(sahne, kamera);
    if (ilk) { ilk = false; hazirCoz(); }
    // Yavaş cihaz: ilk iki saniyede kareler ağırsa çözünürlüğü ve buğdayı düşür
    if (olcum.length < 120) { olcum.push(dt); if (olcum.length === 120) { const ort = olcum.slice(20).reduce((a, b) => a + b, 0) / 100; if (ort > 0.034) { efekt?.hafiflet(); renderer.setPixelRatio(1); bugday.count = Math.floor(K.bugday * 0.5); gunes.shadow.mapSize.set(1024, 1024); gunes.shadow.map?.dispose(); gunes.shadow.map = null; boyut(); } } }
  }
  kare = requestAnimationFrame(adim);

  return {
    hazir,
    gece, alaca,
    durdur() {
      calisiyor = false; cancelAnimationFrame(kare); ro.disconnect(); io.disconnect();
      kap.parentElement.removeEventListener('pointermove', fare);
      efekt?.yokEt(); renderer.dispose(); tuval.remove();
    },
  };
}
