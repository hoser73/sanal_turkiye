// Açılış 3B sahnesinin ayrıntılı modelleri ve prosedürel dokuları (tanitim3d.js kullanır). Dış dosya yok: sıva, moloz taş,
// alaturka kiremit, boyalı tahta, oluklu sac, yaprak ve çimen dokuları tuvalde çizilir; yükseklikten normal haritası türetilir.
// Modeller: cumbalı Anadolu köy evi (taş zemin kat, sıvalı üst kat, kırma çatı, güneş enerjili su ısıtıcısı, çiçekli pencereler),
// kırmızı ahır, oluklu silo, kanat profilli rüzgâr türbini, yaprak kartlı ağaç taçları ve çimen öbekleri.
import * as THREE from '/vendor/three/three.module.js';

let tohum = 23;
const rnd = () => { tohum = (tohum * 16807) % 2147483647; return (tohum - 1) / 2147483646; };
const ara = (a, b) => a + rnd() * (b - a);
const hash2 = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
// Döşenebilir (kenarları birleşen) gürültü: u, v ∈ [0, 1)
function pg(x, y, p) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const h = (a, b) => hash2(((a % p) + p) % p, ((b % p) + p) % p);
  const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function pfbm(u, v, temel = 4, o = 5) { let s = 0, a = 0.5, p = temel; for (let i = 0; i < o; i++) { s += a * pg(u * p, v * p, p); p *= 2; a *= 0.5; } return s; }

function tuval(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d', { willReadFrequently: true })]; }
function doku(c, renkli = true) {
  const t = new THREE.CanvasTexture(c);
  if (renkli) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}
// Gri yükseklik tuvalinden teğet uzayı normal haritası (OpenGL yönü: yeşil yukarı)
function normalHaritasi(yc, guc = 3) {
  const w = yc.width, h = yc.height, kaynak = yc.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const [c, x] = tuval(w, h), cikti = x.createImageData(w, h);
  const Y = (i, j) => kaynak[((((j % h) + h) % h) * w + (((i % w) + w) % w)) * 4] / 255;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const dx = (Y(i - 1, j) - Y(i + 1, j)) * guc, dy = (Y(i, j + 1) - Y(i, j - 1)) * guc, l = Math.hypot(dx, dy, 1), o = (j * w + i) * 4;
    cikti.data[o] = (dx / l * 0.5 + 0.5) * 255; cikti.data[o + 1] = (dy / l * 0.5 + 0.5) * 255; cikti.data[o + 2] = (0.5 / l + 0.5) * 255; cikti.data[o + 3] = 255;
  }
  x.putImageData(cikti, 0, 0);
  return doku(c, false);
}
// Piksel piksel doku: f(u, v) → [r, g, b, yükseklik 0..1]
function pikselDoku(S, f, guc) {
  const [c, x] = tuval(S), [hc, hx] = tuval(S), img = x.createImageData(S, S), yim = hx.createImageData(S, S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const [r, g, b, y] = f(i / S, j / S), o = (j * S + i) * 4;
    img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
    yim.data[o] = yim.data[o + 1] = yim.data[o + 2] = y * 255; yim.data[o + 3] = 255;
  }
  x.putImageData(img, 0, 0); hx.putImageData(yim, 0, 0);
  return { map: doku(c), normalMap: normalHaritasi(hc, guc) };
}

// ---------- Dokular
function svaDokusu() {   // kirli beyaz sıva: hafif dalgalı yüzey, yağmur lekeleri
  return pikselDoku(256, (u, v) => {
    const n = pfbm(u, v, 6), ince = pg(u * 64, v * 64, 64), leke = Math.max(0, pfbm(u * 0.5 + 0.3, v * 3, 2, 3) - 0.55) * 1.6;
    const k = 0.9 + n * 0.14 + ince * 0.05 - leke * 0.18;
    return [236 * k, 228 * k, 212 * k, n * 0.6 + ince * 0.4];
  }, 2.2);
}
function tasDokusu() {   // moloz taş duvar: düzensiz taşlar, harç derzleri
  const S = 512, [c, x] = tuval(S), [hc, hx] = tuval(S);
  x.fillStyle = '#9a9081'; x.fillRect(0, 0, S, S); hx.fillStyle = '#202020'; hx.fillRect(0, 0, S, S);
  let y = 0;
  while (y < S) {
    const sh = ara(34, 62); let xx = -ara(0, 40);
    while (xx < S) {
      const sw = ara(46, 110), ton = ara(-22, 22), r = Math.floor(150 + ton), g = Math.floor(140 + ton * 0.95), b = Math.floor(124 + ton * 0.85);
      for (const dx of [0, -S, S]) {
        x.fillStyle = `rgb(${r},${g},${b})`; x.beginPath(); x.roundRect(xx + 3 + dx, y + 3, sw - 6, sh - 6, ara(6, 14)); x.fill();
        hx.filter = 'blur(4px)'; hx.fillStyle = `rgb(${Math.floor(ara(170, 230))},0,0)`; hx.beginPath(); hx.roundRect(xx + 5 + dx, y + 5, sw - 10, sh - 10, 12); hx.fill(); hx.filter = 'none';
      }
      xx += sw;
    }
    y += sh;
  }
  const img = x.getImageData(0, 0, S, S);   // taş yüzeyine benek
  for (let i = 0; i < img.data.length; i += 4) { const n = (rnd() - 0.5) * 18; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
  x.putImageData(img, 0, 0);
  const yd = hx.getImageData(0, 0, S, S);
  for (let i = 0; i < yd.data.length; i += 4) { yd.data[i] = Math.min(255, yd.data[i] + rnd() * 25); yd.data[i + 1] = yd.data[i + 2] = yd.data[i]; }
  hx.putImageData(yd, 0, 0);
  return { map: doku(c), normalMap: normalHaritasi(hc, 4) };
}
function kiremitDokusu() {   // alaturka kiremit: eğim boyunca kanallar, sıra bindirmeleri; dokunun 1 birimi 2 m
  const KOLON = 10, SIRA = 5;
  const renkler = Array.from({ length: KOLON * SIRA }, () => [ara(150, 190), ara(68, 92), ara(40, 58)]);
  return pikselDoku(512, (u, v) => {
    const cu = u * KOLON, cv = v * SIRA, ki = Math.floor(cu), si = Math.floor(cv + (ki % 2) * 0.5) % SIRA;
    const fu = cu - ki, fv = (cv + (ki % 2) * 0.5) % 1;
    const kavis = Math.sin(fu * Math.PI);
    const [r, g, b] = renkler[ki * SIRA + si];
    const bindirme = 1 - Math.pow(fv, 6) * 0.55, kenar = 0.55 + kavis * 0.5;
    const y = kavis * 0.75 + (1 - fv) * 0.25, k = kenar * bindirme * (0.92 + pg(u * 32, v * 32, 32) * 0.16);
    return [r * k, g * k, b * k, y];
  }, 5);
}
function tahtaDokusu(boya) {   // dikey tahta kaplama; boya (ör. ahır kırmızısı) yer yer aşınmış
  const [br, bg, bb] = boya;
  const tonlar = Array.from({ length: 6 }, () => ara(0.88, 1.08));
  return pikselDoku(256, (u, v) => {
    const t = u * 6, i = Math.floor(t), f = t - i, aralik = f < 0.04 || f > 0.96;
    const lif = Math.sin((v * 40 + pg(u * 6, v * 4, 4) * 6) * Math.PI) * 0.5 + 0.5;
    const asinma = Math.max(0, pfbm(u, v, 4, 4) - 0.6) * 2.4;
    const ahsap = [140 + lif * 30, 104 + lif * 22, 70 + lif * 14];
    const k = tonlar[i] * (aralik ? 0.45 : 1) * (0.94 + lif * 0.08);
    const c = [br * (1 - asinma) + ahsap[0] * asinma, bg * (1 - asinma) + ahsap[1] * asinma, bb * (1 - asinma) + ahsap[2] * asinma];
    return [c[0] * k, c[1] * k, c[2] * k, aralik ? 0 : 0.6 + lif * 0.1];
  }, 3);
}
function sacDokusu() {   // oluklu galvaniz sac, yağmur izleri ve hafif pas
  return pikselDoku(256, (u, v) => {
    const oluk = Math.sin(u * 16 * Math.PI * 2) * 0.5 + 0.5, pas = Math.max(0, pfbm(u * 2, v * 0.4, 3, 4) - 0.58) * 2.2;
    const k = 0.78 + oluk * 0.3, c = [168 * k, 174 * k, 178 * k];
    return [c[0] * (1 - pas) + 140 * pas, c[1] * (1 - pas) + 84 * pas, c[2] * (1 - pas) + 50 * pas, oluk];
  }, 4);
}
// Yaprak atlası 2×2: 0-1 geniş yaprak, 2 söğüt (uzun yaprak), 3 çam iğnesi. Saydam zemin.
function yaprakAtlasi() {
  const S = 1024, H = S / 2, [c, x] = tuval(S);
  const yaprak = (cx, cy, l, w, a, renk) => {
    x.save(); x.translate(cx, cy); x.rotate(a);
    const g = x.createLinearGradient(0, -w, 0, w); g.addColorStop(0, renk[0]); g.addColorStop(1, renk[1]);
    x.fillStyle = g; x.beginPath(); x.moveTo(-l / 2, 0); x.quadraticCurveTo(0, -w, l / 2, 0); x.quadraticCurveTo(0, w, -l / 2, 0); x.fill();
    x.strokeStyle = 'rgba(30,50,10,.35)'; x.lineWidth = 1; x.beginPath(); x.moveTo(-l / 2, 0); x.lineTo(l / 2, 0); x.stroke();
    x.restore();
  };
  const yesiller = [['#6a9a38', '#2f5418'], ['#5a8a2e', '#264a14'], ['#78a640', '#365f1c'], ['#4d7c2a', '#21401a']];
  for (const [ox, oy, tur] of [[0, 0, 'genis'], [H, 0, 'genis2'], [0, H, 'sogut'], [H, H, 'cam']]) {
    const cx = ox + H / 2, cy = oy + H / 2;
    if (tur === 'cam') {
      for (let i = 0; i < 26; i++) {   // dallar ve iğneler
        const a = ara(0, Math.PI * 2), r = ara(20, 190), bx = cx + Math.cos(a) * r * 0.3, by = cy + Math.sin(a) * r * 0.3;
        x.strokeStyle = '#3b2a1a'; x.lineWidth = 3; x.beginPath(); x.moveTo(bx, by); x.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); x.stroke();
        for (let k = 0; k < 40; k++) {
          const t = rnd(), px = bx + (Math.cos(a) * r * 0.7) * t, py = by + (Math.sin(a) * r * 0.7) * t, na = a + (rnd() < 0.5 ? 1 : -1) * ara(0.6, 1.2), nl = ara(14, 26);
          x.strokeStyle = ['#2f4f2a', '#3b5f30', '#264222'][k % 3]; x.lineWidth = 2; x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(na) * nl, py + Math.sin(na) * nl); x.stroke();
        }
      }
      continue;
    }
    const n = tur === 'sogut' ? 380 : 340;
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, r = Math.pow(rnd(), 0.35) * (H * 0.44), px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
      const renk = yesiller[Math.floor(rnd() * 4)];
      if (tur === 'sogut') yaprak(px, py, ara(40, 60), ara(4, 6), Math.PI / 2 + ara(-0.4, 0.4), renk);
      else yaprak(px, py, ara(tur === 'genis' ? 34 : 24, tur === 'genis' ? 52 : 36), ara(9, 15), rnd() * 6.28, renk);
    }
  }
  const t = doku(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
function cimenDokusu() {
  const S = 256, [c, x] = tuval(S);
  for (let i = 0; i < 70; i++) {
    const bx = ara(10, S - 10), h = ara(S * 0.45, S * 0.98), egim = ara(-40, 40), g = x.createLinearGradient(0, S, 0, S - h);
    g.addColorStop(0, '#3d5a1e'); g.addColorStop(1, ['#9dbb5a', '#86a845', '#b4b86a', '#a8a25a'][i % 4]);
    x.fillStyle = g; x.beginPath(); x.moveTo(bx - 3, S); x.quadraticCurveTo(bx + egim * 0.3, S - h * 0.6, bx + egim, S - h); x.quadraticCurveTo(bx + egim * 0.3 + 2, S - h * 0.6, bx + 3, S); x.fill();
  }
  const t = doku(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ---------- Geometri yardımcıları
// Kutunun her yüzüne dünya ölçeğinde UV (doku metre başına tekrarlanır)
function kutuUV(geo, metre) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i)), x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const [u, v] = ay >= ax && ay >= az ? [x, z] : ax >= az ? [z, y] : [x, y];
    uv.setXY(i, u / metre, v / metre);
  }
  return geo;
}
// Eğik yüzeylerde UV: u saçak boyunca, v eğim boyunca (kiremit kanalları aşağı akar)
function egimUV(geo, metre) {
  const p = geo.attributes.position, uv = new Float32Array(p.count * 2), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), t = new THREE.Vector3(), bt = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    n.subVectors(b, a).cross(c.clone().sub(a)).normalize();
    t.set(0, 1, 0).cross(n); if (t.lengthSq() < 1e-6) t.set(1, 0, 0); t.normalize(); bt.crossVectors(n, t);
    for (let k = 0; k < 3; k++) { const v = [a, b, c][k]; uv[(i + k) * 2] = v.dot(t) / metre; uv[(i + k) * 2 + 1] = v.dot(bt) / metre; }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}
function ucgenler(noktalar) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(noktalar.flat(), 3)); g.computeVertexNormals();
  return g;
}
// Kırma çatı (dört yana eğimli), saçak taşmalı
function kirmaCati(w, d, h, o) {
  const W = w / 2 + o, D = d / 2 + o, r = Math.max(0.01, W - D);
  const A = [-W, 0, -D], B = [W, 0, -D], Cc = [W, 0, D], Dd = [-W, 0, D], R1 = [-r, h, 0], R2 = [r, h, 0];
  return ucgenler([Dd, Cc, R2, Dd, R2, R1, B, A, R1, B, R1, R2, A, Dd, R1, Cc, B, R2]);
}
// Beşik çatı (iki yana eğimli), uzun kenar z boyunca
function besikCati(w, d, h, o) {
  const W = w / 2 + o, D = d / 2 + o;
  const A = [-W, 0, D], B = [-W, 0, -D], S1 = [0, h, D], S2 = [0, h, -D], Cc = [W, 0, D], Dd = [W, 0, -D];
  return ucgenler([A, S1, S2, A, S2, B, Cc, Dd, S2, Cc, S2, S1]);
}

// ---------- Malzemeler (sahne başına bir kez)
export function malzemeler() {
  const sva = svaDokusu(), tas = tasDokusu(), kiremit = kiremitDokusu(), kirmizi = tahtaDokusu([150, 44, 32]), tahta = tahtaDokusu([112, 78, 48]), sac = sacDokusu();
  const M = (o, metre = 1) => { const m = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...o }); m.userData.metre = metre; return m; };
  return {
    sva: M({ ...sva, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.92 }, 2.5),
    tas: M({ ...tas, roughness: 0.95 }, 2.4),
    kiremit: M({ ...kiremit, roughness: 0.72, side: THREE.DoubleSide }, 2),
    ahirTahta: M({ ...kirmizi, roughness: 0.8 }, 1.6),
    tahta: M({ ...tahta, roughness: 0.8 }, 1.2),
    sac: M({ ...sac, roughness: 0.42, metalness: 0.55, side: THREE.DoubleSide }, 1.4),
    siloSac: M({ map: sac.map.clone(), normalMap: sac.normalMap.clone(), roughness: 0.35, metalness: 0.7 }, 1),
    koyuAhsap: M({ color: '#4a3020', roughness: 0.75 }),
    beyazBoya: M({ color: '#f1ede4', roughness: 0.6 }),
    cam: M({ color: '#0f1a24', roughness: 0.04, metalness: 0.9, envMapIntensity: 1.4 }),
    beyazMetal: M({ color: '#f4f6f7', roughness: 0.32, metalness: 0.1 }),
    yaprak: yaprakAtlasi(),
    cimen: cimenDokusu(),
  };
}
function kutu(w, h, d, m, x = 0, y = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (m.map) kutuUV(g, m.userData.metre || 1);
  const k = new THREE.Mesh(g, m); k.position.set(x, y, z); k.castShadow = true; k.receiveShadow = true;
  return k;
}
function silindir(rt, rb, h, m, seg = 16) { const s = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m); s.castShadow = true; s.receiveShadow = true; return s; }
function ekle(g, mesh, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) { mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz); g.add(mesh); return mesh; }

// ---------- Cumbalı Anadolu köy evi: taş zemin kat, sıvalı üst kat öne taşar, ahşap dikmeler, kırma kiremit çatı
export function koyEvi(M, gece) {
  const g = new THREE.Group(), W = 10, D = 8, Z1 = 3.1, Z2 = 3.0, CUMBA = 0.9;
  const cam = M.cam.clone(); cam.emissive = new THREE.Color('#ffb85a'); cam.emissiveIntensity = gece * 2.4;
  g.add(kutu(W, Z1, D, M.tas, 0, Z1 / 2, 0));
  g.add(kutu(W + 0.3, 0.28, D + CUMBA + 0.3, M.koyuAhsap, 0, Z1 + 0.14, CUMBA / 2));        // kat kirişi
  g.add(kutu(W, Z2, D + CUMBA, M.sva, 0, Z1 + 0.28 + Z2 / 2, CUMBA / 2));                     // sıvalı üst kat (cumba)
  for (const x of [-W / 2 + 0.6, -1.6, 1.6, W / 2 - 0.6]) {                                    // cumba payandaları
    const p = kutu(0.18, 1.3, 0.18, M.koyuAhsap, x, Z1 - 0.45, D / 2 + 0.42); p.rotation.x = -0.75; g.add(p);
  }
  for (const x of [-W / 2 + 0.08, W / 2 - 0.08]) for (const z of [-D / 2 + 0.08, D / 2 + CUMBA - 0.08]) g.add(kutu(0.2, Z2, 0.2, M.koyuAhsap, x, Z1 + 0.28 + Z2 / 2, z));
  g.add(kutu(W + 0.1, 0.18, D + CUMBA + 0.1, M.koyuAhsap, 0, Z1 + 0.28 + Z2 - 0.05, CUMBA / 2));
  // Çatı
  const ust = Z1 + 0.28 + Z2;
  const catiGeo = egimUV(kirmaCati(W, D + CUMBA, 2.7, 1.05), 2);
  const cati = new THREE.Mesh(catiGeo, M.kiremit); cati.position.set(0, ust, CUMBA / 2); cati.castShadow = true; cati.receiveShadow = true; g.add(cati);
  const sw = W + 2.1, sd = D + CUMBA + 2.1;
  for (const [w, d, x, z] of [[sw, 0.12, 0, sd / 2], [sw, 0.12, 0, -sd / 2], [0.12, sd, sw / 2, 0], [0.12, sd, -sw / 2, 0]]) g.add(kutu(w, 0.22, d, M.koyuAhsap, x, ust - 0.08, z + CUMBA / 2));
  // Baca ve güneş enerjili su ısıtıcısı (Anadolu çatılarının vazgeçilmezi)
  g.add(kutu(0.9, 2.6, 0.9, M.tas, 2.6, ust + 1.5, -1.6), kutu(1.15, 0.12, 1.15, M.koyuAhsap, 2.6, ust + 2.85, -1.6));
  const gun = new THREE.Group(); gun.position.set(-2.3, ust + 1.35, -0.6); gun.rotation.y = Math.PI;
  const panel = kutu(2.0, 0.07, 1.25, M.cam, 0, 0.55, 0); panel.rotation.x = -0.62; gun.add(panel);
  const depo = silindir(0.32, 0.32, 2.1, M.beyazMetal, 16); depo.rotation.z = Math.PI / 2; depo.position.set(0, 1.05, -0.45); gun.add(depo);
  for (const x of [-0.85, 0.85]) gun.add(kutu(0.05, 1.1, 0.05, M.beyazMetal, x, 0.45, -0.3));
  g.add(gun);
  // Pencereler: koyu ahşap kasa, kepenk, çiçekli saksı
  const pencere = (x, y, z, ry, w = 1.1, h = 1.45, saksi = false) => {
    const p = new THREE.Group();
    p.add(kutu(w + 0.2, h + 0.2, 0.14, M.koyuAhsap), kutu(w, h, 0.08, cam, 0, 0, 0.04), kutu(0.07, h, 0.12, M.koyuAhsap, 0, 0, 0.06), kutu(w, 0.07, 0.12, M.koyuAhsap, 0, h * 0.18, 0.06));
    for (const s of [-1, 1]) { const k = kutu(w * 0.52, h + 0.1, 0.06, M.tahta, s * (w * 0.8), 0, 0.1); k.rotation.y = s * 0.35; p.add(k); }
    p.add(kutu(w + 0.35, 0.09, 0.3, M.beyazBoya, 0, -h / 2 - 0.12, 0.12));
    if (saksi) {
      p.add(kutu(w * 0.85, 0.24, 0.24, M.tahta, 0, -h / 2 + 0.06, 0.24));
      for (let i = 0; i < 5; i++) {
        const c = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), new THREE.MeshStandardMaterial({ color: i % 2 ? '#d6283a' : '#e8445a', roughness: 0.7 }));
        c.position.set(-w * 0.34 + i * w * 0.17, -h / 2 + 0.28, 0.27); p.add(c);
        const y2 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 0), new THREE.MeshStandardMaterial({ color: '#3f7a2a', roughness: 0.8 })); y2.position.set(-w * 0.34 + i * w * 0.17 + 0.06, -h / 2 + 0.2, 0.3); p.add(y2);
      }
    }
    p.position.set(x, y, z); p.rotation.y = ry; g.add(p);
  };
  const on2 = D / 2 + CUMBA + 0.02, yk2 = Z1 + 0.28 + Z2 / 2 + 0.1;
  for (const x of [-3.3, -1.1, 1.1, 3.3]) pencere(x, yk2, on2, 0, 1.05, 1.5, true);
  for (const x of [-3.2, 3.2]) pencere(x, 1.7, D / 2 + 0.02, 0, 0.85, 1.05);
  for (const z of [-2, 1.4]) { pencere(W / 2 + 0.02, yk2, z + CUMBA / 2, Math.PI / 2, 1, 1.4); pencere(-W / 2 - 0.02, yk2, z + CUMBA / 2, -Math.PI / 2, 1, 1.4); pencere(W / 2 + 0.02, 1.7, z, Math.PI / 2, 0.8, 1); }
  // Kapı ve taş basamaklar
  g.add(kutu(1.9, 2.55, 0.2, M.tas, 0, 1.28, D / 2 + 0.04), kutu(1.6, 2.35, 0.16, M.tahta, 0, 1.18, D / 2 + 0.1));
  g.add(kutu(0.06, 2.3, 0.18, M.koyuAhsap, 0, 1.18, D / 2 + 0.14));
  for (let i = 0; i < 2; i++) g.add(kutu(2.6 - i * 0.4, 0.18, 0.7 - i * 0.25, M.tas, 0, 0.09 + i * 0.18, D / 2 + 0.4 - i * 0.12));
  // Uydu çanağı
  const canak = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 8, 0, Math.PI * 2, 0, 0.9), M.beyazMetal); canak.rotation.x = -1.9; canak.position.set(W / 2 - 0.2, Z1 + 1.8, -1.5); canak.material = M.beyazMetal; g.add(canak);
  return g;
}

// ---------- Kırmızı ahşap ahır: beşik sac çatı, beyaz pervazlar, samanlık kapağı
export function ahir(M) {
  const g = new THREE.Group(), W = 13, D = 20, H = 6.5;
  g.add(kutu(W, 0.6, D, M.tas, 0, 0.3, 0), kutu(W, H - 0.6, D, M.ahirTahta, 0, 0.6 + (H - 0.6) / 2, 0));
  const uc = new THREE.Shape([new THREE.Vector2(-W / 2, 0), new THREE.Vector2(W / 2, 0), new THREE.Vector2(0, 4.6)]);
  for (const z of [D / 2 + 0.01, -D / 2 - 0.01]) {
    const geo = new THREE.ShapeGeometry(uc); const p = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 1.6, p.getY(i) / 1.6);
    const m = new THREE.Mesh(geo, M.ahirTahta); m.position.set(0, H, z); if (z < 0) m.rotation.y = Math.PI; m.castShadow = true; g.add(m);
  }
  const cati = new THREE.Mesh(egimUV(besikCati(W, D, 4.6, 0.7), 1.4), M.sac); cati.position.y = H; cati.castShadow = true; cati.receiveShadow = true; g.add(cati);
  const kapi = new THREE.Group();
  kapi.add(kutu(5.2, 4.8, 0.14, M.ahirTahta));
  for (const [w, h, x, y] of [[5.5, 0.28, 0, 2.45], [5.5, 0.28, 0, -2.45], [0.28, 5.2, 2.65, 0], [0.28, 5.2, -2.65, 0], [0.22, 4.8, 0, 0]]) kapi.add(kutu(w, h, 0.2, M.beyazBoya, x, y, 0.06));
  for (const s of [-1, 1]) for (const a of [0.85, -0.85]) { const c = kutu(0.2, 3.3, 0.18, M.beyazBoya, s * 1.3, 0, 0.1); c.rotation.z = a; kapi.add(c); }
  kapi.position.set(0, 2.5 + 0.6, D / 2 + 0.08); g.add(kapi);
  g.add(kutu(2.4, 2.2, 0.18, M.beyazBoya, 0, H + 1.5, D / 2 + 0.05), kutu(2.0, 1.8, 0.2, M.koyuAhsap, 0, H + 1.5, D / 2 + 0.07));
  for (const x of [-W / 2 - 0.02, W / 2 + 0.02]) for (const z of [-5, 0, 5]) { const p = kutu(0.12, 1.1, 1.4, M.beyazBoya, x, 3.8, z); g.add(p, kutu(0.14, 0.9, 1.2, M.cam, x, 3.8, z)); }
  return g;
}
// ---------- Oluklu galvaniz silo
export function silo(M) {
  const g = new THREE.Group();
  const govdeGeo = new THREE.CylinderGeometry(3, 3, 14, 32, 1, true), uv = govdeGeo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 13, uv.getY(i) * 6);
  const m = M.siloSac; m.map.repeat.set(1, 1); m.side = THREE.DoubleSide;
  const govde = new THREE.Mesh(govdeGeo, m); govde.position.y = 7; govde.castShadow = true; govde.receiveShadow = true; g.add(govde);
  const kapak = new THREE.Mesh(new THREE.ConeGeometry(3.25, 2.6, 32), M.beyazMetal); kapak.position.y = 15.3; kapak.castShadow = true; g.add(kapak);
  for (let i = 0; i <= 5; i++) { const h = new THREE.Mesh(new THREE.TorusGeometry(3.03, 0.07, 6, 40), M.beyazMetal); h.rotation.x = Math.PI / 2; h.position.y = 0.2 + i * 2.75; g.add(h); }
  for (const x of [-0.25, 0.25]) g.add(kutu(0.06, 15.5, 0.06, M.beyazMetal, x, 7.8, 3.15));
  for (let y = 0.6; y < 15; y += 0.45) g.add(kutu(0.5, 0.04, 0.04, M.beyazMetal, 0, y, 3.15));
  g.add(kutu(1.6, 0.5, 1.6, M.tas, 0, 0.25, 0));
  return g;
}

// ---------- Rüzgâr türbini: konik kule, oval nasel, sivri göbek, kanat profilli bükümlü kanatlar; gece kırmızı ikaz ışığı
function kanatGeo(L = 38) {
  const n = 18, prof = 10, pos = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, y = 1.4 + t * L;
    const kord = t < 0.18 ? THREE.MathUtils.lerp(1.4, 3.2, t / 0.18) : THREE.MathUtils.lerp(3.2, 0.5, Math.pow((t - 0.18) / 0.82, 0.8));
    const kalin = kord * (t < 0.1 ? 0.5 : 0.17) * (1 - t * 0.5), burgu = (1 - t) * 0.45;
    for (let k = 0; k < prof; k++) {
      const a = (k / prof) * Math.PI * 2, cx = (Math.cos(a) * 0.5 + 0.2) * kord, cz = Math.sin(a) * kalin * 0.5 * (Math.cos(a) > 0 ? 0.7 : 1);
      pos.push(cx * Math.cos(burgu) - cz * Math.sin(burgu), y, cx * Math.sin(burgu) + cz * Math.cos(burgu));
      if (i < n) { const a0 = i * prof + k, a1 = i * prof + ((k + 1) % prof); idx.push(a0, a1, a0 + prof, a1, a1 + prof, a0 + prof); }
    }
  }
  const uc = pos.length / 3; pos.push(0.1, 1.4 + L + 0.3, 0);
  for (let k = 0; k < prof; k++) idx.push(n * prof + k, n * prof + ((k + 1) % prof), uc);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
export function turbin(M, gece) {
  const g = new THREE.Group(), m = M.beyazMetal, HUB = 80;
  const kule = silindir(1.15, 2.3, HUB, m, 24); kule.position.y = HUB / 2; g.add(kule);
  g.add(kutu(3, 2.6, 2.2, m, 3.4, 1.3, 0));                                          // trafo köşkü
  const nasel = new THREE.Mesh(new THREE.CapsuleGeometry(1.5, 6, 8, 16), m); nasel.rotation.x = Math.PI / 2; nasel.position.set(0, HUB + 1.2, -0.6); nasel.castShadow = true; g.add(nasel);
  const rotor = new THREE.Group(); rotor.position.set(0, HUB + 1.2, 3.6); g.add(rotor);
  const gobek = new THREE.Mesh(new THREE.SphereGeometry(1.35, 20, 12), m); gobek.scale.z = 1.7; rotor.add(gobek);
  const kg = kanatGeo();
  for (let i = 0; i < 3; i++) { const k = new THREE.Mesh(kg, m); k.rotation.z = (i * Math.PI * 2) / 3; k.castShadow = true; rotor.add(k); }
  const isik = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff2a1a', transparent: true, opacity: gece > 0.4 ? 1 : 0.6 }));
  isik.position.set(0, HUB + 3, -2); g.add(isik);
  g.userData = { rotor, isik };
  return g;
}

// ---------- Ağaç taçları: dağınık yaprak kartları (atlas hücresi), küresel normaller → yumuşak, gerçekçi ışık
// kalip: 'kure' | 'sutun' (kavak) | 'koni' (çam) | 'sarkik' (söğüt)
export function tacGeo(kalip, sayi, hucre, boyut = 1.1) {
  const pos = [], nor = [], uv = [], col = [], idx = [];
  const q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), merkez = new THREE.Vector3();
  const [hu, hv] = [(hucre % 2) * 0.5, hucre < 2 ? 0.5 : 0];   // atlasta hücre (flipY: üst sıra v 0.5..1)
  for (let i = 0; i < sayi; i++) {
    let p;
    if (kalip === 'sutun') { const y = ara(-1, 1); const r = Math.sqrt(1 - y * y * 0.85) * Math.sqrt(rnd()) * 0.9; const a = rnd() * 6.28; p = new THREE.Vector3(Math.cos(a) * r, y * 4.2, Math.sin(a) * r); }
    else if (kalip === 'koni') { const y = Math.pow(rnd(), 0.8); const r = (1 - y) * 1.15 * Math.sqrt(rnd()) + 0.08; const a = rnd() * 6.28; p = new THREE.Vector3(Math.cos(a) * r, y * 3.4 - 1, Math.sin(a) * r); }
    else { const a = rnd() * 6.28, b = Math.acos(ara(-0.6, 1)), r = Math.pow(rnd(), 0.4); p = new THREE.Vector3(Math.sin(b) * Math.cos(a) * r, Math.cos(b) * r * (kalip === 'sarkik' ? 0.8 : 0.9), Math.sin(b) * Math.sin(a) * r); }
    const s = boyut * ara(0.75, 1.2) * (kalip === 'sutun' ? 0.75 : kalip === 'koni' ? 0.85 : 1);
    e.set(ara(-1.2, 1.2), rnd() * 6.28, ara(-0.6, 0.6)); if (kalip === 'sarkik') e.x = ara(-0.25, 0.25); q.setFromEuler(e);
    const n0 = p.clone().sub(merkez); n0.y = kalip === 'sutun' ? n0.y * 0.15 : kalip === 'koni' ? 0.4 : n0.y; n0.normalize(); if (!Number.isFinite(n0.x)) n0.set(0, 1, 0);
    const ao = 0.55 + 0.5 * Math.min(1, p.length() / (kalip === 'sutun' ? 2 : 1)) * (0.75 + 0.25 * (p.y > 0 ? 1 : 0.6));
    const taban = pos.length / 3;
    for (const [cx, cy, tu, tv] of [[-0.5, -0.5, 0, 0], [0.5, -0.5, 1, 0], [0.5, 0.5, 1, 1], [-0.5, 0.5, 0, 1]]) {
      v.set(cx * s, (kalip === 'sarkik' ? cy * 1.5 : cy) * s, 0).applyQuaternion(q).add(p);
      pos.push(v.x, v.y, v.z); nor.push(n0.x, n0.y, n0.z); uv.push(hu + tu * 0.5, hv + tv * 0.5); col.push(ao, ao, ao);
    }
    idx.push(taban, taban + 1, taban + 2, taban, taban + 2, taban + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
  return g;
}
// Çimen öbeği: üç çapraz kart
export function cimenGeo() {
  const pos = [], uv = [], idx = [], nor = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI, c = Math.cos(a) * 0.35, s = Math.sin(a) * 0.35, t = pos.length / 3;
    pos.push(-c, 0, -s, c, 0, s, c, 0.55, s, -c, 0.55, -s); uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    for (let i = 0; i < 4; i++) nor.push(0, 1, 0);
    idx.push(t, t + 1, t + 2, t, t + 2, t + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setIndex(idx);
  return g;
}

// ---------- Dallı ağaç üretici: gövde ve dallar (konik silindirler, kabuk dokulu), dal uçlarında yaprak kümeleri.
// Türler: ceviz (geniş yuvarlak taç), meyve (alçak, açık taç), kavak (sütun), cam (katlı karaçam), sogut (sarkık).
// Yaprak kartlarının normalleri taç merkezinden dışa bakar (yumuşak ışık); iç kısımlar koyu (ortam gölgesi).
const V = THREE.Vector3;
const TUR = {
  ceviz: { boy: 11, govde: [3.0, 0.34], ana: [3, 4], aci: [0.55, 0.95], yukari: 0.35, kisal: 0.7, derin: 3, cocuk: [2, 3], yaprakDerin: 2, kume: [16, 1.7], kart: 1.9, hucre: 0 },
  meyve: { boy: 4.6, govde: [1.1, 0.16], ana: [3, 4], aci: [0.8, 1.15], yukari: 0.2, kisal: 0.68, derin: 3, cocuk: [2, 3], yaprakDerin: 2, kume: [11, 0.95], kart: 1.15, hucre: 1 },
  sogut: { boy: 9, govde: [2.4, 0.36], ana: [4, 5], aci: [0.6, 0.9], yukari: 0.3, kisal: 0.72, derin: 3, cocuk: [2, 3], yaprakDerin: 2, kume: [14, 1.4], kart: 1.5, hucre: 2, sarkik: true },
};
function kabukUret() { return { pos: [], nor: [], uv: [], idx: [] }; }
function silindirParca(k, a, b, ra, rb, seg) {
  const yon = b.clone().sub(a), L = yon.length(); yon.normalize();
  const t1 = (Math.abs(yon.y) < 0.95 ? new V(0, 1, 0) : new V(1, 0, 0)).cross(yon).normalize(), t2 = yon.clone().cross(t1);
  const taban = k.pos.length / 3;
  for (let i = 0; i <= seg; i++) {
    const aa = (i / seg) * Math.PI * 2, n = t1.clone().multiplyScalar(Math.cos(aa)).addScaledVector(t2, Math.sin(aa));
    for (const [p, r, v] of [[a, ra, 0], [b, rb, L / 2.2]]) { k.pos.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r); k.nor.push(n.x, n.y, n.z); k.uv.push(i / seg * Math.max(1, Math.round(ra * 6)), v + a.y / 2.2); }
  }
  for (let i = 0; i < seg; i++) { const i0 = taban + i * 2; k.idx.push(i0, i0 + 2, i0 + 1, i0 + 1, i0 + 2, i0 + 3); }
}
function yonDondur(yon, aci, yukari) {
  const dik = new V(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).cross(yon).normalize();
  const q = new THREE.Quaternion().setFromAxisAngle(dik, aci);
  return yon.clone().applyQuaternion(q).add(new V(0, yukari, 0)).normalize();
}
export function agacUret(tur, detay = 1) {
  const k = kabukUret(), kartlar = [];   // kart: [merkez, boyut, sarkık mı]
  const kume = (p, n, r, boy, sarkik = false) => { for (let i = 0; i < n; i++) kartlar.push([p.clone().add(new V(ara(-r, r), ara(-r * 0.7, r * 0.7) - (sarkik ? r * 0.6 : 0), ara(-r, r))), boy * ara(0.75, 1.2), sarkik]); };
  const seg = detay > 0.6 ? 7 : 5;
  let ad = tur, H0;
  if (tur === 'kavak') {   // dik sütun: düz gövde, gövde boyunca yukarı bakan kısa dallar
    H0 = 17; const govdeH = 16.5;
    for (let y = 0; y < govdeH; y += 2.2) silindirParca(k, new V(0, y, 0), new V(ara(-0.05, 0.05), Math.min(govdeH, y + 2.2), ara(-0.05, 0.05)), 0.32 * (1 - y / 19), 0.32 * (1 - Math.min(govdeH, y + 2.2) / 19), seg);
    for (let y = 2.2; y < govdeH - 0.3; y += detay > 0.6 ? 0.55 : 1.1) {
      const t = y / govdeH, L = (1.2 + 1.3 * Math.sin(t * Math.PI)) * ara(0.8, 1.15), a = rnd() * 6.28;
      const yon = new V(Math.cos(a) * 0.38, 1, Math.sin(a) * 0.38).normalize(), bas = new V(0, y, 0), uc = bas.clone().addScaledVector(yon, L);
      if (detay > 0.6) silindirParca(k, bas, uc, 0.05, 0.02, 4);
      kume(bas.clone().lerp(uc, 0.55), detay > 0.6 ? 7 : 5, 0.75, 1.35); kume(uc, detay > 0.6 ? 5 : 4, 0.6, 1.2);
    }
    kume(new V(0, govdeH + 0.3, 0), 4, 0.5, 0.9);
  } else if (tur === 'cam') {   // karaçam: düz gövde, kat kat yatay dallar, yukarı doğru kısalır
    H0 = 14; const govdeH = 13.5;
    for (let y = 0; y < govdeH; y += 2.5) silindirParca(k, new V(0, y, 0), new V(0, Math.min(govdeH, y + 2.5), 0), 0.36 * (1 - y / 16), 0.36 * (1 - Math.min(govdeH, y + 2.5) / 16), seg);
    for (let y = 3.2; y < govdeH; y += detay > 0.6 ? 0.95 : 1.6) {
      const t = (y - 3.2) / (govdeH - 3.2), L = 4.2 * Math.pow(1 - t, 0.85) + 0.6, n = detay > 0.6 ? 5 : 4, a0 = rnd() * 6.28;
      for (let i = 0; i < n; i++) {
        const a = a0 + (i / n) * 6.28 + ara(-0.3, 0.3), yon = new V(Math.cos(a), ara(-0.15, 0.12), Math.sin(a)).normalize();
        const bas = new V(0, y, 0), uc = bas.clone().addScaledVector(yon, L * ara(0.8, 1.1)); uc.y -= L * 0.12;
        if (detay > 0.6) silindirParca(k, bas, uc, 0.09 * (1 - t * 0.6), 0.025, 4);
        for (let s = 0.3; s <= 1.0; s += 0.23) kume(bas.clone().lerp(uc, s), detay > 0.6 ? 3 : 2, 0.55, 1.45 * (1 - t * 0.3));
      }
    }
    kume(new V(0, govdeH + 0.4, 0), 3, 0.4, 0.9);
  } else {
    const P = TUR[tur]; H0 = P.boy;
    const tepe = new V(ara(-0.2, 0.2), P.govde[0], ara(-0.2, 0.2));
    silindirParca(k, new V(0, -0.3, 0), new V(0, P.govde[0] * 0.5, 0), P.govde[1] * 1.15, P.govde[1], seg);
    silindirParca(k, new V(0, P.govde[0] * 0.5, 0), tepe, P.govde[1], P.govde[1] * 0.8, seg);
    const derinMaks = detay > 0.6 ? P.derin : P.derin - 1;
    const dal = (bas, yon, L, r, d) => {
      const orta = bas.clone().addScaledVector(yon, L * 0.5).add(new V(ara(-0.12, 0.12), ara(-0.05, 0.1), ara(-0.12, 0.12)).multiplyScalar(L));
      const yon2 = yonDondur(yon, ara(0.05, 0.25), P.sarkik && d >= 2 ? -0.25 : 0.05), uc = orta.clone().addScaledVector(yon2, L * 0.5);
      silindirParca(k, bas, orta, r, r * 0.8, d > 1 ? 4 : seg); silindirParca(k, orta, uc, r * 0.8, r * 0.6, d > 1 ? 4 : seg);
      if (d >= P.yaprakDerin || d >= derinMaks) kume(uc, Math.round(P.kume[0] * (detay > 0.6 ? 1 : 1.4)), P.kume[1], P.kart, P.sarkik);
      if (d >= P.yaprakDerin) kume(orta, Math.round(P.kume[0] * 0.5), P.kume[1] * 0.8, P.kart * 0.9, P.sarkik);
      if (d < derinMaks) {
        const n = Math.floor(ara(P.cocuk[0], P.cocuk[1] + 0.99));
        for (let i = 0; i < n; i++) {
          const p = orta.clone().lerp(uc, ara(0.3, 1));
          dal(p, yonDondur(yon2, ara(P.aci[0], P.aci[1]) * 0.75, P.yukari * 0.6), L * P.kisal * ara(0.85, 1.1), r * 0.62, d + 1);
        }
      }
    };
    const n = Math.floor(ara(P.ana[0], P.ana[1] + 0.99)), a0 = rnd() * 6.28;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * 6.28 + ara(-0.3, 0.3), acik = ara(P.aci[0], P.aci[1]);
      const yon = new V(Math.cos(a) * Math.sin(acik), Math.cos(acik) + P.yukari, Math.sin(a) * Math.sin(acik)).normalize();
      dal(tepe.clone(), yon, (H0 - P.govde[0]) * 0.42 * ara(0.85, 1.15), P.govde[1] * 0.7, 1);
    }
    ad = tur;
  }
  // Kabuk geometrisi
  const kabuk = new THREE.BufferGeometry();
  kabuk.setAttribute('position', new THREE.Float32BufferAttribute(k.pos, 3)); kabuk.setAttribute('normal', new THREE.Float32BufferAttribute(k.nor, 3));
  kabuk.setAttribute('uv', new THREE.Float32BufferAttribute(k.uv, 2)); kabuk.setIndex(k.idx);
  // Yaprak kartları: taç merkezine göre küresel normal, içe doğru koyulaşma
  const merkez = new V(); for (const [p] of kartlar) merkez.add(p); merkez.multiplyScalar(1 / Math.max(1, kartlar.length));
  let enUzak = 0.001; for (const [p] of kartlar) enUzak = Math.max(enUzak, p.distanceTo(merkez));
  const hucre = tur === 'kavak' ? 1 : tur === 'cam' ? 3 : TUR[tur].hucre, hu = (hucre % 2) * 0.5, hv = hucre < 2 ? 0.5 : 0;
  const pos = [], nor = [], uv = [], col = [], idx = [], q = new THREE.Quaternion(), e = new THREE.Euler(), v = new V();
  for (const [p, s, sarkik] of kartlar) {
    const n0 = p.clone().sub(merkez); if (tur === 'kavak') n0.y *= 0.25; n0.y += 0.35; n0.normalize();
    const ao = 0.5 + 0.55 * Math.pow(p.distanceTo(merkez) / enUzak, 0.8) * (p.y > merkez.y ? 1 : 0.85);
    e.set(sarkik ? ara(-0.2, 0.2) : ara(-1.3, 1.3), rnd() * 6.28, sarkik ? ara(-0.15, 0.15) : ara(-0.7, 0.7)); q.setFromEuler(e);
    const taban = pos.length / 3;
    for (const [cx, cy, tu, tv] of [[-0.5, -0.5, 0, 0], [0.5, -0.5, 1, 0], [0.5, 0.5, 1, 1], [-0.5, 0.5, 0, 1]]) {
      v.set(cx * s, cy * s * (sarkik ? 1.7 : 1), 0).applyQuaternion(q).add(p);
      pos.push(v.x, v.y, v.z); nor.push(n0.x, n0.y, n0.z); uv.push(hu + tu * 0.5, hv + tv * 0.5); col.push(ao, ao, ao);
    }
    idx.push(taban, taban + 1, taban + 2, taban, taban + 2, taban + 3);
  }
  const yaprak = new THREE.BufferGeometry();
  yaprak.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); yaprak.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  yaprak.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); yaprak.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); yaprak.setIndex(idx);
  return { kabuk, yaprak, boy: H0, ad };
}
export function kabukMalzemesi() {
  const d = pikselDoku(256, (u, v) => {
    const catlak = Math.abs(pg(u * 6, v * 1.5, 6) * 2 - 1), ince = pg(u * 24, v * 6, 24);
    const k = 0.55 + Math.pow(catlak, 0.6) * 0.45 + ince * 0.12;
    return [92 * k, 80 * k, 68 * k, catlak * 0.8 + ince * 0.2];
  }, 4);
  return new THREE.MeshStandardMaterial({ ...d, roughness: 0.95 });
}

// ---------- Leylek: beyaz gövde, siyah uçuş tüyleri, uzun kırmızı gaga ve bacaklar (uçarken boyun ileri, bacaklar geri)
export function leylek({ ucuyor = true } = {}) {
  const g = new THREE.Group();
  const beyaz = new THREE.MeshStandardMaterial({ color: '#f4f2ec', roughness: 0.8 }), siyah = new THREE.MeshStandardMaterial({ color: '#16151a', roughness: 0.7 }),
    kirmizi = new THREE.MeshStandardMaterial({ color: '#d8401f', roughness: 0.55 });
  const govde = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), beyaz); govde.scale.set(1.9, 0.85, 0.85); g.add(govde);
  const boyun = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.6, 6), beyaz);
  const bas = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), beyaz), gaga = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.42, 6), kirmizi);
  const kuyruk = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 6), beyaz);
  if (ucuyor) {
    boyun.rotation.z = -Math.PI / 2 + 0.1; boyun.position.set(0.72, 0.03, 0); bas.position.set(1.02, 0.06, 0);
    gaga.rotation.z = -Math.PI / 2; gaga.position.set(1.28, 0.04, 0);
    kuyruk.rotation.z = Math.PI / 2; kuyruk.position.set(-0.6, 0, 0);
    for (const z of [-0.06, 0.06]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.9, 4), kirmizi); b.rotation.z = Math.PI / 2 - 0.08; b.position.set(-0.95, -0.05, z); g.add(b); }
    const kanatlar = [];
    for (const s of [1, -1]) {
      const kanat = new THREE.Group(); kanat.position.set(0.05, 0.05, 0.2 * s);
      const ic = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.03, 1.0).translate(0, 0, 0.5 * s), beyaz);
      const dis = new THREE.Group(); dis.position.z = 1.0 * s;
      const tuy = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.025, 0.95).translate(-0.04, 0, 0.47 * s), siyah);
      const arka = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.026, 1.0).translate(-0.33, 0, 0.5 * s), siyah);
      dis.add(tuy); kanat.add(ic, arka, dis); g.add(kanat); kanatlar.push({ kanat, dis, s });
    }
    g.userData.kanatlar = kanatlar;
  } else {   // yuvada duran leylek
    govde.rotation.z = 0.35; govde.position.y = 1.05;
    boyun.position.set(0.32, 1.38, 0); boyun.rotation.z = -0.25; bas.position.set(0.42, 1.68, 0);
    gaga.rotation.z = -Math.PI / 2 - 0.5; gaga.position.set(0.6, 1.58, 0);
    kuyruk.rotation.z = Math.PI / 2 + 0.6; kuyruk.position.set(-0.48, 0.92, 0);
    const sirt = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 6), siyah); sirt.scale.set(1.6, 0.55, 0.9); sirt.position.set(-0.12, 1.02, 0); sirt.rotation.z = 0.35; g.add(sirt);
    for (const z of [-0.08, 0.08]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.85, 4), kirmizi); b.position.set(0, 0.45, z); g.add(b); }
    g.userData.bas = { bas, gaga };
  }
  g.add(boyun, bas, gaga, kuyruk);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
export function leylekYuvasi() {
  const g = new THREE.Group(), cubuk = new THREE.MeshStandardMaterial({ color: '#6e5638', roughness: 1 });
  const yuva = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.6, 0.55, 14, 2), cubuk); yuva.castShadow = true; g.add(yuva);
  for (let i = 0; i < 40; i++) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, ara(0.6, 1.2), 3), cubuk), a = rnd() * 6.28;
    c.position.set(Math.cos(a) * 0.75, ara(-0.2, 0.25), Math.sin(a) * 0.75); c.rotation.set(ara(-1.4, 1.4), rnd() * 3, ara(-1.4, 1.4)); g.add(c);
  }
  return g;
}

// ---------- Yolcu uçağı (markasız): gövde, ok açılı kanatlar, motorlar, dikey kuyruk; arkasında iki iz bulutu
export function ucak() {
  const g = new THREE.Group(), beyaz = new THREE.MeshStandardMaterial({ color: '#f2f4f6', roughness: 0.35, metalness: 0.2, fog: false }),
    gri = new THREE.MeshStandardMaterial({ color: '#9aa3ab', roughness: 0.4, metalness: 0.4, fog: false }), kirmizi = new THREE.MeshStandardMaterial({ color: '#b81f2a', roughness: 0.4, fog: false });
  const govde = new THREE.Mesh(new THREE.CapsuleGeometry(1.9, 34, 6, 14), beyaz); govde.rotation.z = Math.PI / 2; g.add(govde);
  for (const s of [1, -1]) {
    const kanat = new THREE.Mesh(new THREE.BoxGeometry(6, 0.4, 17).translate(0, 0, 8.5 * s), beyaz); kanat.rotation.y = 0.5 * s; kanat.position.set(1, -0.6, 1.2 * s); g.add(kanat);
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.0, 4.2, 12), gri); motor.rotation.z = Math.PI / 2; motor.position.set(1.8, -1.9, 6.5 * s); g.add(motor);
    const yatay = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.25, 6.5).translate(0, 0, 3.25 * s), beyaz); yatay.rotation.y = 0.5 * s; yatay.position.set(-17.5, 0.6, 0.5 * s); g.add(yatay);
  }
  const dikey = new THREE.Mesh(new THREE.BoxGeometry(5, 7.5, 0.35), kirmizi); dikey.position.set(-18, 4.5, 0); dikey.rotation.z = -0.45; g.add(dikey);
  // İz bulutları: motorlardan uzayan, sona doğru genişleyip silinen şeritler
  const izMalz = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
    uniforms: { gece: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float gece; varying vec2 vUv; void main() { float a = smoothstep(0.0, 0.04, vUv.x) * (1.0 - vUv.x) * (1.0 - abs(vUv.y - 0.5) * 2.0); gl_FragColor = vec4(vec3(1.0) * (1.0 - gece * 0.85), a * 0.75); }' });
  for (const s of [1, -1]) {
    const iz = new THREE.Mesh(new THREE.PlaneGeometry(1400, 7, 1, 1).translate(-700 - 4, 0, 0), izMalz);
    const p = iz.geometry.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) * (1 + (-p.getX(i) / 1400) * 3));
    iz.rotation.x = Math.PI / 2; iz.position.set(0, -1.9, 6.5 * s); g.add(iz);
  }
  const isik = new THREE.Mesh(new THREE.SphereGeometry(0.9, 6, 4), new THREE.MeshBasicMaterial({ color: '#ff3030', fog: false })); isik.position.set(0, -2.2, 0); g.add(isik);
  g.userData = { izMalz, isik };
  return g;
}

// ---------- Türk bayrağı (TS 2/3 oranı): kırmızı zemin #E30A17, ay ve yıldız resmî ölçülerle; gönder, alem topu
export function bayrakDokusu() {
  const G = 800, [c, x] = tuval(1200, 800);
  x.fillStyle = '#e30a17'; x.fillRect(0, 0, 1200, G);
  x.fillStyle = '#ffffff'; x.beginPath(); x.arc(425, 400, 200, 0, Math.PI * 2); x.fill();          // ayın dış dairesi
  x.fillStyle = '#e30a17'; x.beginPath(); x.arc(475, 400, 160, 0, Math.PI * 2); x.fill();          // iç daire
  x.fillStyle = '#ffffff'; x.beginPath();                                                           // yıldız: bir ucu göndere bakar
  for (let i = 0; i < 10; i++) { const a = Math.PI + (i * Math.PI) / 5, r = i % 2 ? 38.2 : 100; x.lineTo(683.333 + Math.cos(a) * r, 400 + Math.sin(a) * r); }
  x.closePath(); x.fill();
  const img = x.getImageData(0, 0, 1200, G);   // kumaş dokusu: ince atkı-çözgü
  for (let j = 0; j < G; j++) for (let i = 0; i < 1200; i++) { const o = (j * 1200 + i) * 4, k = ((i % 4 < 2) !== (j % 4 < 2) ? 6 : -6) + (rnd() - 0.5) * 8; img.data[o] += k; img.data[o + 1] += k; img.data[o + 2] += k; }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
export function gonder(boy = 14) {
  const g = new THREE.Group(), metal = new THREE.MeshStandardMaterial({ color: '#eef0f2', roughness: 0.25, metalness: 0.6 });
  const direk = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.12, boy, 16), metal); direk.position.y = boy / 2; direk.castShadow = true; g.add(direk);
  const alem = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), new THREE.MeshStandardMaterial({ color: '#d4a62a', roughness: 0.25, metalness: 0.9 }));
  alem.position.y = boy + 0.18; alem.castShadow = true; g.add(alem);
  const kaide = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.85, 0.5, 20), new THREE.MeshStandardMaterial({ color: '#b9b2a6', roughness: 0.9 }));
  kaide.position.y = 0.25; kaide.receiveShadow = true; kaide.castShadow = true; g.add(kaide);
  return g;
}
