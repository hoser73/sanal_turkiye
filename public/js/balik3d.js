// Balık tutma 3B sahnesi (three.js): iskeleden göl ya da deniz. Su ve gökyüzü kendi gölgelendiricilerimizle çizilir
// (dış doku yok): dalga normalleri, gökyüzü yansıması (Fresnel), güneş parıltısı, olay halkaları; gökyüzü gerçek güneş
// konumuna göre gündüz / alacakaranlık / gece, bulut örtüsü ve sis gerçek havadan. Oyun mantığı balik-ui.js'dedir;
// burası yalnızca çizer ve olay animasyonlarını (atış, ısırma, mücadele, çıkış) oynatır.
import * as THREE from '/vendor/three/three.module.js';

const SU_Y = 0;
const DALGA = [   // yön (x, z), dalga boyu (m), genlik (m), hız katsayısı — büyük salınım (şamandıra yüksekliği de bundan)
  [1, 0.3, 14, 0.07, 1], [0.6, 0.8, 9, 0.05, 1.2], [-0.4, 1, 5.5, 0.025, 1.5],
];
const RENK_TUR = {
  SAZAN: { sirt: '#3f3a22', yan: '#b38a3a', karin: '#ead7a0', h: 0.34, w: 0.16, desen: 'pul' },
  ALABALIK: { sirt: '#4f5d34', yan: '#c9b8a8', karin: '#f3eee6', h: 0.24, w: 0.12, desen: 'benek', bant: '#d9858a' },
  LEVREK: { sirt: '#3f4f5b', yan: '#c7d0d6', karin: '#f1f3f4', h: 0.25, w: 0.11, desen: 'cizgi' },
  LUFER: { sirt: '#2f5a63', yan: '#bcc9cc', karin: '#eef2f2', h: 0.26, w: 0.11, desen: 'duz' },
  CIPURA: { sirt: '#6f7a82', yan: '#c3c9cd', karin: '#eceeee', h: 0.42, w: 0.12, desen: 'altinBant' },
  HAMSI: { sirt: '#1f3d5e', yan: '#b9c8d2', karin: '#f2f5f7', h: 0.16, w: 0.08, desen: 'serit' },
  INCI_KEFALI: { sirt: '#56646f', yan: '#c5cfd6', karin: '#eef2f4', h: 0.2, w: 0.09, desen: 'duz' },
  ALTIN_BALIK: { sirt: '#c46a08', yan: '#f2a422', karin: '#ffd56a', h: 0.38, w: 0.16, desen: 'pul', parlak: true },
  SILUET: { sirt: '#2c3a40', yan: '#7d8a90', karin: '#c2cacd', h: 0.27, w: 0.12, desen: 'duz' },
};

// Büyük salınım yüksekliği (gölgelendiricideki ile aynı)
function suYuksekligi(x, z, t, guc) {
  let y = 0;
  for (const [dx, dz, L, A, h] of DALGA) {
    const n = Math.hypot(dx, dz), k = (2 * Math.PI) / L;
    y += A * guc * Math.sin(k * ((dx / n) * x + (dz / n) * z) + t * h * Math.sqrt(9.8 * k));
  }
  return y;
}

// ---------- Gölgelendiriciler
const SU_VS = `
uniform float t; uniform float dalgaGuc;
varying vec3 vDunya;
void main() {
  vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
  ${DALGA.map(([dx, dz, L, A, h]) => {
    const n = Math.hypot(dx, dz), k = (2 * Math.PI) / L;
    return `p.y += ${A.toFixed(4)} * dalgaGuc * sin(${k.toFixed(5)} * (${(dx / n).toFixed(4)} * p.x + ${(dz / n).toFixed(4)} * p.z) + t * ${(h * Math.sqrt(9.8 * k)).toFixed(5)});`;
  }).join('\n  ')}
  vDunya = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const SU_FS = `
uniform float t; uniform float dalgaGuc; uniform vec3 gunesYon; uniform vec3 gunesRenk; uniform float gunesGuc;
uniform vec3 gokUst; uniform vec3 gokUfuk; uniform vec3 suDerin; uniform vec3 suSig; uniform vec3 sisRenk; uniform float sisMesafe;
uniform vec4 halka[8]; uniform float yagmur;
varying vec3 vDunya;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gurultu(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
// Dalga eğimi: yönlü sinüsler + küçük kırışıklık gürültüsü
vec2 egim(vec2 p) {
  vec2 e = vec2(0.0);
  vec4 d[6]; // yön.xy, dalga sayısı, genlik
  d[0] = vec4(0.96, 0.28, 0.45, 0.06); d[1] = vec4(0.6, 0.8, 0.7, 0.04); d[2] = vec4(-0.37, 0.93, 1.1, 0.028);
  d[3] = vec4(0.2, -0.98, 1.9, 0.016); d[4] = vec4(-0.8, -0.6, 2.7, 0.011); d[5] = vec4(0.9, -0.45, 4.1, 0.007);
  for (int i = 0; i < 6; i++) {
    float k = d[i].z, a = d[i].w * dalgaGuc, w = sqrt(9.8 * k);
    float f = k * dot(d[i].xy, p) + t * w;
    e += d[i].xy * (a * k * cos(f));
  }
  vec2 q = p * 1.7 + vec2(t * 0.35, t * 0.22);
  float g0 = gurultu(q), gx = gurultu(q + vec2(0.07, 0.0)), gz = gurultu(q + vec2(0.0, 0.07));
  e += vec2(gx - g0, gz - g0) * (0.9 + yagmur * 1.6) * dalgaGuc;
  if (yagmur > 0.0) { vec2 c = floor(p * 3.0); float h = hash(c + floor(t * 4.0)); vec2 r = fract(p * 3.0) - 0.5; float dd = length(r);
    e += r / max(dd, 0.01) * sin(dd * 40.0 - fract(t * 4.0) * 12.0) * step(0.82, h) * 0.08 * yagmur * (1.0 - smoothstep(0.1, 0.45, dd)); }
  // Olay halkaları (şamandıra, balık çırpınması): xz merkez, z = başlangıç zamanı, w = güç
  for (int i = 0; i < 8; i++) {
    vec4 h = halka[i]; float yas = t - h.z;
    if (h.w <= 0.0 || yas < 0.0 || yas > 3.5) continue;
    vec2 r = p - h.xy; float dd = length(r) + 1e-3; float on = yas * 1.6;
    float zarf = exp(-pow((dd - on) * 2.2, 2.0)) * exp(-yas * 1.2) * h.w;
    e += r / dd * cos((dd - on) * 9.0) * zarf * 0.35;
  }
  return e;
}
void main() {
  vec3 v = cameraPosition - vDunya; float mesafe = length(v); v /= mesafe;
  vec2 e = egim(vDunya.xz);
  float azalt = 1.0 / (1.0 + mesafe * 0.012);   // uzakta kırışıklık yumuşar (titreme olmasın)
  vec3 n = normalize(vec3(-e.x * azalt, 1.0, -e.y * azalt));
  float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 r = reflect(-v, n);
  vec3 gok = mix(gokUfuk, gokUst, clamp(r.y * 2.2, 0.0, 1.0));
  float derin = clamp(1.0 - dot(n, v), 0.0, 1.0);
  vec3 govde = mix(suSig, suDerin, 0.55 + derin * 0.45);
  vec3 renk = mix(govde, gok, fresnel);
  float s = max(dot(r, gunesYon), 0.0);
  renk += gunesRenk * (pow(s, 600.0) * 6.0 + pow(s, 60.0) * 0.25) * gunesGuc;
  // köpük: halkaların tepesinde ve dalga sırtında hafif beyazlık
  renk += vec3(0.6) * smoothstep(0.32, 0.5, length(e)) * 0.25;
  float sis = 1.0 - exp(-pow(mesafe / sisMesafe, 1.6));
  renk = mix(renk, sisRenk, clamp(sis, 0.0, 1.0));
  gl_FragColor = vec4(renk, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const GOK_VS = `varying vec3 vYon; void main() { vYon = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const GOK_FS = `
uniform vec3 gokUst; uniform vec3 gokUfuk; uniform vec3 gunesYon; uniform vec3 gunesRenk; uniform float gece; uniform float bulut; uniform float t; uniform vec3 bulutRenk;
varying vec3 vYon;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gurultu(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * gurultu(p); p *= 2.03; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vYon);
  float y = max(d.y, 0.0);
  vec3 renk = mix(gokUfuk, gokUst, pow(y, 0.55));
  float s = max(dot(d, gunesYon), 0.0);
  renk += gunesRenk * (pow(s, 900.0) * 30.0 * (1.0 - gece) + pow(s, 12.0) * 0.35);
  if (gece > 0.0) { vec2 c = floor(d.xz / max(d.y, 0.05) * 140.0); float h = hash(c); renk += vec3(1.0) * step(0.997, h) * gece * (1.0 - bulut) * smoothstep(0.05, 0.3, d.y); }
  if (d.y > 0.0) {
    vec2 p = d.xz / (d.y + 0.08) * 1.2 + vec2(t * 0.004, t * 0.002);
    float b = smoothstep(1.0 - bulut, 1.25 - bulut * 0.6, fbm(p));
    vec3 br = mix(bulutRenk, gunesRenk, pow(s, 6.0) * 0.4);
    renk = mix(renk, br, b * smoothstep(0.0, 0.12, d.y) * 0.92);
  }
  gl_FragColor = vec4(renk, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ---------- Balık modeli: bükülmüş küre gövde (tepe noktası renkleriyle desen), çatal kuyruk, yüzgeçler, göz
export function balikModeli(tur) {
  const r = RENK_TUR[tur] || RENK_TUR.SILUET;
  const g = new THREE.Group();
  const geo = new THREE.SphereGeometry(0.5, 56, 28);
  const pos = geo.attributes.position, renkler = [];
  const sirt = new THREE.Color(r.sirt), yan = new THREE.Color(r.yan), karin = new THREE.Color(r.karin), bant = r.bant ? new THREE.Color(r.bant) : null;
  const c = new THREE.Color();
  const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const u = x + 0.5;                                       // 0 kuyruk … 1 baş
    const prof = Math.pow(Math.sin(Math.PI * (0.08 + 0.86 * u)), 0.8);
    const yy = y * r.h * prof - (y < 0 ? 0.01 * prof : 0), zz = z * r.w * prof;   // y, z ∈ ±0,5: toplam yükseklik h, kalınlık w
    pos.setXYZ(i, x, yy, zz);
    const yn = y * 2;                                        // -1 karın … 1 sırt
    c.copy(karin).lerp(yan, THREE.MathUtils.smoothstep(yn, -0.7, -0.05)).lerp(sirt, THREE.MathUtils.smoothstep(yn, 0.15, 0.85));
    if (bant) c.lerp(bant, Math.exp(-((yn - 0.02) ** 2) / 0.02) * 0.65 * (u > 0.15 && u < 0.85 ? 1 : 0));
    if (r.desen === 'benek' && yn > -0.15 && hash(Math.round(x * 60), Math.round(y * 60 + z * 40)) > 0.86) c.multiplyScalar(0.25);
    if (r.desen === 'pul') c.multiplyScalar(0.92 + 0.12 * Math.abs(Math.sin(x * 90) * Math.sin((y + z) * 90)));
    if (r.desen === 'cizgi' && Math.abs(yn - 0.05) < 0.035) c.multiplyScalar(0.55);
    if (r.desen === 'serit' && Math.abs(yn - 0.05) < 0.09) c.lerp(new THREE.Color('#e9f2f8'), 0.7);
    if (r.desen === 'altinBant' && u > 0.78 && u < 0.86 && yn > 0.3) c.lerp(new THREE.Color('#e7b53c'), 0.8);
    if (u > 0.74 && u < 0.79 && Math.abs(yn) < 0.6) c.multiplyScalar(0.8);   // solungaç kapağı
    renkler.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(renkler, 3));
  geo.computeVertexNormals();
  const malz = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: r.parlak ? 0.35 : 0.08,
    emissive: r.parlak ? new THREE.Color('#5a3200') : new THREE.Color(0), envMapIntensity: 1 });
  const govde = new THREE.Mesh(geo, malz);
  g.add(govde);
  const yuzgecMalz = new THREE.MeshStandardMaterial({ color: new THREE.Color(r.yan).lerp(new THREE.Color(r.sirt), 0.5), roughness: 0.6, side: THREE.DoubleSide, transparent: true, opacity: 0.88 });
  const kuyrukSekil = new THREE.Shape();
  kuyrukSekil.moveTo(0, 0); kuyrukSekil.quadraticCurveTo(-0.1, 0.06, -0.24, 0.2 * (r.h / 0.28)); kuyrukSekil.quadraticCurveTo(-0.17, 0.02, -0.15, 0);
  kuyrukSekil.quadraticCurveTo(-0.17, -0.02, -0.24, -0.2 * (r.h / 0.28)); kuyrukSekil.quadraticCurveTo(-0.1, -0.06, 0, 0);
  const kuyruk = new THREE.Mesh(new THREE.ShapeGeometry(kuyrukSekil), yuzgecMalz);
  kuyruk.position.x = -0.44;
  g.add(kuyruk);
  // Sırt yüzgeci: dikenli, öne doğru yükselen, arkaya inen
  const k = Math.min(1.3, r.h / 0.26), sirtSekil = new THREE.Shape();
  sirtSekil.moveTo(-0.2, 0); sirtSekil.lineTo(-0.15, 0.05 * k); sirtSekil.lineTo(-0.1, 0.075 * k); sirtSekil.lineTo(-0.04, 0.1 * k);
  sirtSekil.lineTo(0.02, 0.115 * k); sirtSekil.lineTo(0.07, 0.09 * k); sirtSekil.lineTo(0.12, 0); sirtSekil.lineTo(-0.2, 0);
  const sirtMalz = new THREE.MeshStandardMaterial({ color: new THREE.Color(r.sirt).lerp(new THREE.Color(r.yan), 0.25), roughness: 0.55, side: THREE.DoubleSide, transparent: true, opacity: 0.92 });
  const sirtY = new THREE.Mesh(new THREE.ShapeGeometry(sirtSekil), sirtMalz);
  sirtY.position.set(0, r.h * 0.4, 0);
  g.add(sirtY);
  for (const s of [-1, 1]) {
    const yan = new THREE.Mesh(new THREE.CircleGeometry(0.07, 10, 0, Math.PI), yuzgecMalz);
    yan.position.set(0.2, -r.h * 0.15, s * r.w * 0.45); yan.rotation.set(Math.PI / 2 * s, 0.4, -0.6); yan.scale.setScalar(0.8);
    g.add(yan);
    const goz = new THREE.Mesh(new THREE.SphereGeometry(0.014, 12, 10), new THREE.MeshStandardMaterial({ color: '#050505', roughness: 0.05, metalness: 0.1 }));
    const ak = new THREE.Mesh(new THREE.SphereGeometry(0.021, 12, 10), new THREE.MeshStandardMaterial({ color: '#cdb878', roughness: 0.3 }));
    const gx = 0.37, gProf = Math.pow(Math.sin(Math.PI * (0.08 + 0.86 * (gx + 0.5))), 0.8);
    ak.position.set(gx, r.h * 0.1, s * r.w * gProf * 0.42); goz.position.set(gx + 0.004, r.h * 0.1, s * r.w * gProf * 0.47);
    g.add(ak, goz);
  }
  g.userData = { kuyruk, govde };
  return g;
}

// ---------- Sahne
export function balikSahnesi(tuval, { tip = 'ic', gunes = { yukseklik: 40, azimut: 160 }, hava = null } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas: tuval, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const sahne = new THREE.Scene();
  const kamera = new THREE.PerspectiveCamera(52, 16 / 9, 0.1, 2000);
  const KAMERA = new THREE.Vector3(0, 2.45, 9.2);
  kamera.position.copy(KAMERA);
  const bakis = new THREE.Vector3(0, 0.9, -12);
  kamera.lookAt(bakis);

  // Güneş ve atmosfer
  const yuk = gunes.yukseklik, gece = THREE.MathUtils.clamp((2 - yuk) / 10, 0, 1), alaca = THREE.MathUtils.clamp(1 - Math.abs(yuk - 3) / 12, 0, 1);
  const az = THREE.MathUtils.degToRad(gunes.azimut ?? 180), el = THREE.MathUtils.degToRad(Math.max(yuk, -6));
  // Sahnede -z kuzey değil; güneş her zaman izleyicinin önünde-yanında dursun diye azimut yumuşatılır
  const gunesYon = new THREE.Vector3(Math.sin(az) * 0.7, Math.sin(Math.max(el, 0.03)), -Math.abs(Math.cos(az)) - 0.4).normalize();
  const kod = hava?.kod ?? 1;
  const bulutOrt = kod >= 95 ? 0.95 : kod >= 51 ? 0.85 : kod === 3 ? 0.8 : kod === 2 ? 0.55 : kod === 1 ? 0.35 : 0.18;
  const sisli = kod === 45 || kod === 48;
  const yagmur = (kod >= 51 && kod <= 67) || (kod >= 80 && kod <= 82) || kod >= 95 ? (kod >= 63 || kod >= 81 ? 1 : 0.6) : 0;
  const karli = (kod >= 71 && kod <= 77) || kod === 85 || kod === 86;
  const ruzgar = THREE.MathUtils.clamp((hava?.ruzgar ?? 8) / 25, 0.35, 1.6);
  const L = (h) => new THREE.Color(h);
  const gunduzUst = L(bulutOrt > 0.7 ? '#7f98ad' : '#3d7fcf'), gunduzUfuk = L(bulutOrt > 0.7 ? '#c6d1d9' : '#bfe0f5');
  const aksamUst = L('#4b5f9e'), aksamUfuk = L('#f3a35f');
  const geceUst = L('#050b1c'), geceUfuk = L('#1c2b4a');
  const gokUst = gunduzUst.clone().lerp(aksamUst, alaca * 0.85).lerp(geceUst, gece);
  const gokUfuk = gunduzUfuk.clone().lerp(aksamUfuk, alaca * 0.9).lerp(geceUfuk, gece);
  const gunesRenk = L('#fff1d6').lerp(L('#ff9a4a'), alaca).lerp(L('#9fb6e0'), gece);
  const sisRenk = gokUfuk.clone().lerp(L('#c9ced2'), sisli ? 0.7 : 0);
  sahne.background = gokUfuk.clone();
  sahne.fog = new THREE.Fog(sisRenk, sisli ? 25 : 120, sisli ? 160 : 900);

  const gok = new THREE.Mesh(new THREE.SphereGeometry(1200, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, vertexShader: GOK_VS, fragmentShader: GOK_FS,
    uniforms: { gokUst: { value: gokUst }, gokUfuk: { value: gokUfuk }, gunesYon: { value: gunesYon }, gunesRenk: { value: gunesRenk }, gece: { value: gece },
      bulut: { value: bulutOrt }, t: { value: 0 }, bulutRenk: { value: L('#ffffff').lerp(L('#8a97a3'), Math.max(0, bulutOrt - 0.5) * 1.4).lerp(L('#1a2338'), gece * 0.9) } },
  }));
  sahne.add(gok);

  const isik = new THREE.DirectionalLight(gunesRenk, (1 - gece) * (2.6 - bulutOrt * 1.2) + 0.25);
  isik.position.copy(gunesYon).multiplyScalar(60);
  isik.castShadow = true; isik.shadow.mapSize.set(1024, 1024);
  Object.assign(isik.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 140 });
  sahne.add(isik);
  // Dolgu ışığı: kameranın arkasından; güneş karşıdayken yakındaki iskele ve balık kararmasın
  const dolgu = new THREE.DirectionalLight(L('#fff6e8').lerp(L('#9fb6e0'), gece), 0.55 + (1 - gece) * 0.6);
  dolgu.position.set(1.5, 4, 14); dolgu.target.position.set(0, 1, 0); sahne.add(dolgu, dolgu.target);
  sahne.add(new THREE.HemisphereLight(gokUst.clone().lerp(L('#ffffff'), 0.3), L(tip === 'deniz' ? '#2a5a72' : '#3d5a3a'), 0.55 + (1 - gece) * 0.5));
  if (gece > 0.4) {   // iskele feneri
    const fener = new THREE.PointLight('#ffb15a', 6, 14, 1.6); fener.position.set(-1.3, 2.3, 6.2); sahne.add(fener);
    const ampul = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffd38a' })); ampul.position.copy(fener.position); sahne.add(ampul);
  }

  // Su
  const halkalar = Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, -99, 0));
  let halkaSira = 0;
  const suMalz = new THREE.ShaderMaterial({ vertexShader: SU_VS, fragmentShader: SU_FS, uniforms: {
    t: { value: 0 }, dalgaGuc: { value: ruzgar }, gunesYon: { value: gunesYon }, gunesRenk: { value: gunesRenk }, gunesGuc: { value: (1 - gece) * (1 - bulutOrt * 0.7) + gece * 0.25 },
    gokUst: { value: gokUst }, gokUfuk: { value: gokUfuk },
    suDerin: { value: (tip === 'deniz' ? L('#0b3550') : L('#173f34')).lerp(L('#03070f'), gece * 0.8) },
    suSig: { value: (tip === 'deniz' ? L('#1f6f88') : L('#2f6b55')).lerp(L('#06101c'), gece * 0.8) },
    sisRenk: { value: sisRenk }, sisMesafe: { value: sisli ? 120 : 650 }, halka: { value: halkalar }, yagmur: { value: yagmur },
  } });
  const su = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600, 220, 220).rotateX(-Math.PI / 2), suMalz);
  su.position.set(0, SU_Y, -500);
  sahne.add(su);

  // Kıyı: göl → tepeler, orman, sazlık; deniz → uzak ada, yelkenli
  const cevre = new THREE.Group(); sahne.add(cevre);
  const dogal = (renk, opts = {}) => new THREE.MeshStandardMaterial({ color: renk, roughness: 0.95, flatShading: true, ...opts });
  if (tip === 'deniz') {
    for (const [x, z, s, h] of [[-260, -520, 120, 34], [180, -700, 160, 48], [420, -480, 70, 18]]) {
      const ada = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), dogal(L('#6f7f5a').lerp(L('#26303a'), gece)));
      ada.scale.set(s, h, s * 0.5); ada.position.set(x, -2, z); cevre.add(ada);
    }
    const yelken = new THREE.Group();
    const tekne = new THREE.Mesh(new THREE.BoxGeometry(4, 0.8, 1.4), dogal('#e9e4da')); tekne.position.y = 0.4;
    const yel = new THREE.Mesh(new THREE.ConeGeometry(1.6, 6, 3), dogal('#f6f3ec')); yel.position.set(0.4, 3.6, 0); yel.scale.z = 0.12;
    yelken.add(tekne, yel); yelken.position.set(-60, 0, -220); cevre.add(yelken);
    cevre.userData.yelken = yelken;
  } else {
    const tepeMalz = dogal(L('#5f7f3c').lerp(L('#0f1a14'), gece * 0.8));
    for (let i = 0; i < 9; i++) {
      const a = -1.25 + i * 0.31, d = 260 + (i % 3) * 70;
      const tepe = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), tepeMalz);
      tepe.scale.set(90 + (i * 37) % 60, 30 + (i * 13) % 35, 70); tepe.position.set(Math.sin(a) * d, -3, -Math.cos(a) * d); cevre.add(tepe);
    }
    // Orman şeridi (örneklenmiş koniler) ve kıyı bandı
    const agac = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 3, 6), dogal(L('#2f5a2b').lerp(L('#0b140e'), gece * 0.8)), 260);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3(), p3 = new THREE.Vector3();
    for (let i = 0; i < 260; i++) {
      const a = -1.35 + Math.random() * 2.7, d = 175 + Math.random() * 70, s = 3 + Math.random() * 4;
      m.compose(p3.set(Math.sin(a) * d, s * 1.2 - 1, -Math.cos(a) * d), q, s3.set(s, s * 1.5, s)); agac.setMatrixAt(i, m);
    }
    cevre.add(agac);
    const kiyi = new THREE.Mesh(new THREE.RingGeometry(170, 260, 64, 1, -Math.PI * 0.95, Math.PI * 0.9).rotateX(-Math.PI / 2), dogal(L('#7a7a4e').lerp(L('#151a12'), gece * 0.8)));
    kiyi.rotation.y = Math.PI / 2 + 0.05; kiyi.position.y = 0.35; cevre.add(kiyi);
  }
  // Sazlık (iki yanda, iskeleye yakın)
  const saz = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.012, 0.02, 1.8, 4).translate(0, 0.9, 0), dogal(L('#6d8a3a').lerp(L('#111a0e'), gece * 0.8)), 340);
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3(1, 1, 1), p3 = new THREE.Vector3(), e = new THREE.Euler();
    for (let i = 0; i < 340; i++) {
      const sol = i % 2 ? 1 : -1, x = sol * (5 + Math.random() * 9), z = 2 + Math.random() * 10;
      e.set((Math.random() - 0.5) * 0.25, 0, (Math.random() - 0.5) * 0.25); q.setFromEuler(e);
      m.compose(p3.set(x, -0.3, z), q, s3.set(1, 0.7 + Math.random() * 0.8, 1)); saz.setMatrixAt(i, m);
    }
  }
  if (tip !== 'deniz') sahne.add(saz);

  // İskele
  const tahta = new THREE.MeshStandardMaterial({ color: L('#8a5a32').lerp(L('#2a1a10'), gece * 0.5), roughness: 0.85 });
  const iskele = new THREE.Group();
  for (let i = 0; i < 12; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.08, 0.3), tahta); b.position.set(0, 1, 3.4 + i * 0.36); b.rotation.y = (Math.random() - 0.5) * 0.02; b.receiveShadow = true; iskele.add(b); }
  for (const [x, z] of [[-1.5, 3.5], [1.5, 3.5], [-1.5, 7.5], [1.5, 7.5]]) { const d = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 2.6, 8), tahta); d.position.set(x, -0.2, z); iskele.add(d); }
  const kova = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.36, 18), new THREE.MeshStandardMaterial({ color: '#9fb0ba', metalness: 0.15, roughness: 0.45 }));
  kova.position.set(-1.0, 1.22, 5.6); kova.castShadow = true; iskele.add(kova);
  sahne.add(iskele);

  // Olta: sap (mantar kabza + makara) ve eğilebilen kamış (tüp, gerektiğinde yeniden kurulur)
  const sapUcu = new THREE.Vector3(0.78, 1.62, 8.35);
  const oltaGrup = new THREE.Group(); sahne.add(oltaGrup);
  const kabza = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.5, 10), new THREE.MeshStandardMaterial({ color: '#a0784a', roughness: 0.9 }));
  const makara = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.07, 18), new THREE.MeshStandardMaterial({ color: '#2b2f33', metalness: 0.7, roughness: 0.3 }));
  const kol = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.09), new THREE.MeshStandardMaterial({ color: '#c9c9c9', metalness: 0.8, roughness: 0.25 }));
  oltaGrup.add(kabza, makara, kol);
  const kamisMalz = new THREE.MeshStandardMaterial({ color: '#2a2a2e', roughness: 0.35, metalness: 0.3 });
  let kamis = null, sonEgilme = -1;
  const oltaUcu = new THREE.Vector3();
  const oltaYonu = new THREE.Vector3(0.1, 0.4, -0.91).normalize();
  function oltaKur(egilme, hedef, salinim) {
    // Uç, misinanın çektiği yöne doğru eğilir
    const L0 = 3.3;
    const uc = sapUcu.clone().addScaledVector(oltaYonu, L0);
    if (hedef) {
      const cek = hedef.clone().sub(uc).normalize();
      uc.addScaledVector(cek, egilme * 1.1).y -= egilme * 0.9;
    }
    uc.x += salinim; uc.y += salinim * 0.4;
    const orta = sapUcu.clone().addScaledVector(oltaYonu, L0 * 0.5); orta.y += 0.05 - egilme * 0.15;
    oltaUcu.copy(uc);
    const anahtar = Math.round(egilme * 40) + Math.round(salinim * 400) * 1000 + (hedef ? Math.round(hedef.x) * 7 : 0);
    if (anahtar !== sonEgilme) {
      sonEgilme = anahtar;
      if (kamis) { oltaGrup.remove(kamis); kamis.geometry.dispose(); }
      const egri = new THREE.QuadraticBezierCurve3(sapUcu.clone(), orta, uc);
      kamis = new THREE.Mesh(new THREE.TubeGeometry(egri, 28, 0.014, 8, false), kamisMalz);
      kamis.castShadow = true;
      oltaGrup.add(kamis);
    }
    const geri = oltaYonu.clone().multiplyScalar(-0.28);
    kabza.position.copy(sapUcu).add(geri.clone().multiplyScalar(0.6)); kabza.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), oltaYonu);
    makara.position.copy(sapUcu).add(new THREE.Vector3(0.0, -0.09, -0.05)); makara.rotation.set(0, 0, Math.PI / 2);
    kol.position.copy(makara.position).add(new THREE.Vector3(0.05, 0, 0));
  }

  // Misina
  const MISINA_N = 40;
  const misinaGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(MISINA_N * 3), 3));
  const misinaMalz = new THREE.LineBasicMaterial({ color: '#f2f2ee', transparent: true, opacity: 0.85 });
  const misina = new THREE.Line(misinaGeo, misinaMalz); misina.frustumCulled = false; sahne.add(misina);
  function misinaCiz(a, b, sarkma) {
    const p = misinaGeo.attributes.position;
    for (let i = 0; i < MISINA_N; i++) {
      const u = i / (MISINA_N - 1);
      p.setXYZ(i, a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u - Math.sin(u * Math.PI) * sarkma, a.z + (b.z - a.z) * u);
    }
    p.needsUpdate = true;
  }

  // Şamandıra
  const samandira = new THREE.Group();
  const ust = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#e0261c', roughness: 0.35, emissive: '#3a0500' }));
  const alt = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.4 }));
  const anten = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.22, 6), new THREE.MeshStandardMaterial({ color: '#ffd23a', emissive: '#6a5200' }));
  anten.position.y = 0.2;
  samandira.add(ust, alt, anten); samandira.scale.setScalar(2.8); sahne.add(samandira);

  // Su altındaki balık gölgesi (yüzeyin hemen altında, saydam)
  const golge = new THREE.Mesh(new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#05141c', transparent: true, opacity: 0, depthWrite: false }));
  golge.scale.set(0.5, 1, 0.16); golge.position.y = -0.05; golge.renderOrder = 1; sahne.add(golge);

  // Parçacıklar (sıçrama damlaları) ve yağmur
  const DAMLA_N = 320;
  const damlaGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(DAMLA_N * 3).fill(-999), 3));
  const damlaDoku = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d');
    const g = x.createRadialGradient(16, 16, 0, 16, 16, 15); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(225,242,255,.8)'); g.addColorStop(1, 'rgba(225,242,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); })();
  const damlaMalz = new THREE.PointsMaterial({ color: '#e9f6ff', size: 0.09, map: damlaDoku, transparent: true, opacity: 0.95, depthWrite: false });
  const damlalar = new THREE.Points(damlaGeo, damlaMalz); damlalar.frustumCulled = false; sahne.add(damlalar);
  const damla = Array.from({ length: DAMLA_N }, () => ({ omur: 0, x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0 }));
  let damlaSira = 0;
  function sicrat(x, z, adet, guc = 1, y = 0.05) {
    for (let i = 0; i < adet; i++) {
      const d = damla[damlaSira++ % DAMLA_N], a = Math.random() * Math.PI * 2, h = (0.6 + Math.random() * 1.8) * guc;
      Object.assign(d, { x, y, z, vx: Math.cos(a) * h, vz: Math.sin(a) * h, vy: (2 + Math.random() * 3.5) * guc, omur: 0.6 + Math.random() * 0.8 });
    }
  }
  let yagmurCizgi = null;
  if (yagmur || karli) {
    const N = karli ? 900 : 1400, dizi = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) { const x = (Math.random() - 0.5) * 40, y = Math.random() * 14, z = -Math.random() * 40 + 8; dizi.set([x, y, z, x, y - (karli ? 0.05 : 0.45), z], i * 6); }
    const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(dizi, 3));
    yagmurCizgi = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: karli ? '#ffffff' : '#c3d3e0', transparent: true, opacity: karli ? 0.9 : 0.45 }));
    yagmurCizgi.frustumCulled = false; yagmurCizgi.userData = { N, hiz: karli ? 1.6 : 16 }; sahne.add(yagmurCizgi);
  }

  // Sahnede gösterilen balık (sıçrama ve çıkış)
  let gosterilen = null;
  function balikGoster(tur) {
    if (gosterilen) { sahne.remove(gosterilen); gosterilen.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); }); }
    gosterilen = tur ? balikModeli(tur) : null;
    if (gosterilen) { gosterilen.traverse((o) => { if (o.isMesh) o.castShadow = true; }); sahne.add(gosterilen); }
    return gosterilen;
  }
  function halka(x, z, guc = 1) { halkalar[halkaSira++ % 8].set(x, z, saat, guc); }

  // Boyut
  function boyutla() {
    const w = tuval.clientWidth || 640, h = tuval.clientHeight || 360;
    renderer.setSize(w, h, false); kamera.aspect = w / h; kamera.updateProjectionMatrix();
  }
  const gozlem = new ResizeObserver(boyutla); gozlem.observe(tuval); boyutla();

  let saat = 0, sarsinti = 0;
  const hedefV = new THREE.Vector3(), tmp = new THREE.Vector3();
  // hal: { durum, samandira: {x,z,ek, havada, y}, balik: {x,z,derinlik,goster}, gerginlik, egilme, cikis: {...}, makaraHiz }
  function ciz(hal, dt) {
    saat += dt;
    suMalz.uniforms.t.value = saat; gok.material.uniforms.t.value = saat;
    if (cevre.userData.yelken) { cevre.userData.yelken.position.x = -60 + saat * 0.6; cevre.userData.yelken.rotation.z = Math.sin(saat * 0.9) * 0.05; }
    // Kamera: hafif nefes ve sarsıntı
    const nefes = Math.sin(saat * 0.8) * 0.015;
    sarsinti = Math.max(0, sarsinti - dt * 4);
    kamera.position.set(KAMERA.x + (Math.random() - 0.5) * sarsinti * 0.06, KAMERA.y + nefes + (Math.random() - 0.5) * sarsinti * 0.04, KAMERA.z);
    kamera.lookAt(bakis);

    // Hedef nokta: şamandıra ya da balığın misinaya girdiği yer
    const g = suMalz.uniforms.dalgaGuc.value;
    let uc = null;
    if (hal.balik?.goster) {
      const b = hal.balik;
      hedefV.set(b.x, suYuksekligi(b.x, b.z, saat, g) - 0.05, b.z);
      golge.material.opacity = THREE.MathUtils.clamp(0.42 - b.derinlik * 0.12, 0, 0.42);
      golge.position.set(b.x - Math.cos(b.yon) * 0.4, suYuksekligi(b.x, b.z, saat, g) - 0.08, b.z - Math.sin(b.yon) * 0.4);
      golge.rotation.y = -b.yon; golge.scale.set(0.35 + b.boy * 0.45, 1, 0.12 + b.boy * 0.12);
      uc = hedefV;
    } else golge.material.opacity = 0;
    const sm = hal.samandira;
    if (sm) {
      const y = sm.havada ? sm.y : suYuksekligi(sm.x, sm.z, saat, g) + (sm.ek || 0);
      samandira.visible = true; samandira.position.set(sm.x, y, sm.z);
      samandira.rotation.z = Math.sin(saat * 1.7 + sm.x) * 0.08; samandira.rotation.x = Math.cos(saat * 1.3) * 0.06;
      if (!uc) uc = tmp.set(sm.x, y + 0.36, sm.z);
    } else samandira.visible = false;
    oltaKur(hal.egilme || 0, uc && hal.durum === 'mucadele' ? uc : null, hal.salinim || 0);
    if (uc && hal.misina !== false) {
      const mesafe = oltaUcu.distanceTo(uc);
      misinaCiz(oltaUcu, uc, (1 - Math.min(1, hal.gerginlik ?? 0.2)) * mesafe * 0.08 + 0.02);
      misinaMalz.color.set((hal.gerginlik ?? 0) > (hal.kirmiziEsik ?? 2) ? '#ff6b5e' : '#f2f2ee');
      misina.visible = true;
    } else if (hal.cikis && gosterilen) {
      misinaCiz(oltaUcu, gosterilen.position.clone().add(new THREE.Vector3(0.3 * gosterilen.scale.x, 0.02, 0)), 0.02);
      misina.visible = true;
    } else misina.visible = false;
    kol.rotation.x = (kol.rotation.x + (hal.makaraHiz || 0) * dt) % (Math.PI * 2);

    // Sahnedeki balık (sıçrama / çıkış)
    if (gosterilen) {
      const c = hal.cikis;
      if (c) {
        gosterilen.position.set(c.x, c.y, c.z);
        gosterilen.rotation.set(c.rx || 0, c.ry || 0, c.rz || 0);
        gosterilen.scale.setScalar(c.olcek || 1);
        gosterilen.userData.kuyruk.rotation.y = Math.sin(saat * (c.cirpinma || 10)) * 0.5;
        gosterilen.visible = true;
      } else gosterilen.visible = false;
    }

    // Damlalar
    const dp = damlaGeo.attributes.position;
    for (let i = 0; i < DAMLA_N; i++) {
      const d = damla[i];
      if (d.omur > 0) { d.omur -= dt; d.vy -= 9.8 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt; if (d.y < -0.1) d.omur = 0; }
      dp.setXYZ(i, d.x, d.omur > 0 ? d.y : -999, d.z);
    }
    dp.needsUpdate = true;
    if (yagmurCizgi) {
      const p = yagmurCizgi.geometry.attributes.position, { N, hiz } = yagmurCizgi.userData;
      for (let i = 0; i < N; i++) {
        let y = p.getY(i * 2) - hiz * dt;
        if (y < 0) y += 14;
        p.setY(i * 2, y); p.setY(i * 2 + 1, y - (hiz > 2 ? 0.45 : 0.05));
        if (hiz < 2) { p.setX(i * 2, p.getX(i * 2) + Math.sin(saat + i) * dt * 0.3); p.setX(i * 2 + 1, p.getX(i * 2)); }
      }
      p.needsUpdate = true;
    }
    renderer.render(sahne, kamera);
  }

  return {
    ciz, sicrat, halka, balikGoster, suYuksekligi: (x, z) => suYuksekligi(x, z, saat, suMalz.uniforms.dalgaGuc.value),
    sars(g = 1) { sarsinti = Math.max(sarsinti, g); },
    oltaUcu: () => oltaUcu.clone(),
    ortam: { gece, yagmur, sisli, karli, bulutOrt },
    kapat() {
      gozlem.disconnect();
      sahne.traverse((o) => { o.geometry?.dispose(); if (o.material) [].concat(o.material).forEach((m) => m.dispose()); });
      renderer.dispose();
    },
  };
}
