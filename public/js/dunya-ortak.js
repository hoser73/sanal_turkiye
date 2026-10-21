// 3B dünya katmanlarının ortak araçları: geometri birleştirme, kararlı rastgelelik, poligon içinde nokta, gölge dokusu.
import * as THREE from '/vendor/three/three.module.js';

// Parçaları (geometri + renk + konum/ölçek/dönüş) tek, köşe renkli, düz gölgeli geometride birleştirir
export function birlestir(parcalar) {
  const konum = [], renk = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (const p of parcalar) {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    e.set(...(p.don || [0, 0, 0]));
    m.compose(new THREE.Vector3(...(p.yer || [0, 0, 0])), q.setFromEuler(e), new THREE.Vector3(...(p.olcek || [1, 1, 1])));
    g.applyMatrix4(m);
    const pos = g.attributes.position;
    const c = new THREE.Color(p.renk);
    for (let i = 0; i < pos.count; i++) {
      konum.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      // Alttaki köşeler biraz koyu: ucuz ortam kapanması (ambient occlusion) hissi
      const k = p.altKoyu ? Math.min(1, 0.72 + 0.28 * Math.max(0, (pos.getY(i) - p.altKoyu[0]) / (p.altKoyu[1] - p.altKoyu[0]))) : 1;
      renk.push(c.r * k, c.g * k, c.b * k);
    }
    g.dispose();
  }
  const sonuc = new THREE.BufferGeometry();
  sonuc.setAttribute('position', new THREE.Float32BufferAttribute(konum, 3));
  sonuc.setAttribute('color', new THREE.Float32BufferAttribute(renk, 3));
  sonuc.computeVertexNormals();
  return sonuc;
}

// Konuma bağlı kararlı rastgele sayı (aynı yer her kurulumda aynı ağacı alır)
export function kararli(x, z, tuz = 0) {
  let h = Math.imul((Math.round(x * 10) | 0) ^ 0x9e3779b1, 0x85ebca6b) ^ Math.imul((Math.round(z * 10) | 0) + tuz * 7919, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
export function tohumlu(sayi) {
  let h = (sayi | 0) || 1;
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

// GeoJSON poligonu (lng/lat) → yerel halkalar ([x,z] dizileri) + sınır kutusu
export function poligonlar(oz, yerel) {
  const g = oz.geometry;
  if (!g) return [];
  const liste = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  return liste.map((halkalar) => {
    const yerelHalkalar = halkalar.map((h) => h.map(([lng, lat]) => yerel(lng, lat)));
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of yerelHalkalar[0]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    // Karolar aynı özellikli binaları tek MultiPolygon'da birleştirir: parçaların kimliği ortak olamaz
    return { halkalar: yerelHalkalar, kutu: [x0, z0, x1, z1], ozellik: oz.properties || {}, id: liste.length === 1 ? oz.id : undefined, karo: oz.tile };
  });
}
// Çift-tek kuralı: delikler kendiliğinden dışarıda kalır
export function icindeMi(x, z, halkalar) {
  let ic = false;
  for (const h of halkalar) {
    for (let i = 0, j = h.length - 1; i < h.length; j = i++) {
      const [xi, zi] = h[i], [xj, zj] = h[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ic = !ic;
    }
  }
  return ic;
}
export function alanHesapla(h) {
  let a = 0;
  for (let i = 0, j = h.length - 1; i < h.length; j = i++) a += (h[j][0] + h[i][0]) * (h[j][1] - h[i][1]);
  return a / 2;
}

// Yumuşak, ortası koyu daire: ağaç ve bulut gölgeleri
let golgeDoku = null;
export function golgeDokusu() {
  if (golgeDoku) return golgeDoku;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  r.addColorStop(0, 'rgba(0,0,0,1)'); r.addColorStop(0.55, 'rgba(0,0,0,0.75)'); r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  golgeDoku = new THREE.CanvasTexture(c);
  return golgeDoku;
}

// Rüzgârda salınım: köke uzaklıkla artan, konuma göre faz kaymalı hafif eğilme (örnek matrisinden okunur)
export function salinimEkle(malzeme, zaman, guc = 0.03) {
  malzeme.onBeforeCompile = (s) => {
    s.uniforms.uZaman = zaman;
    s.vertexShader = 'uniform float uZaman;\n' + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      ${salinimKodu(guc)}`);
  };
  malzeme.customProgramCacheKey = () => `salinim-${guc}-${malzeme.type}`;
  return malzeme;
}

// Örnek dizisini (instanced mesh) temizlemek için
export function kaldir(sahne, ...nesneler) {
  for (const n of nesneler.flat()) {
    if (!n) continue;
    sahne.remove(n);
    n.traverse?.((o) => { if ((o.isMesh || o.isLine) && !o.userData.paylasimli) o.geometry?.dispose(); });
    if (n.isInstancedMesh) n.dispose();
  }
}

// Yumuşak normaller: aynı konumdaki köşelerin normalleri ortalanır (köşeli yüzler yuvarlak gölgelenir)
export function yumusakNormal(geo) {
  const g = geo.clone();
  const p = g.attributes.position, n = g.attributes.normal;
  const top = new Map();
  const anahtar = (i) => `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
  for (let i = 0; i < p.count; i++) {
    const k = anahtar(i);
    const t = top.get(k) || [0, 0, 0];
    t[0] += n.getX(i); t[1] += n.getY(i); t[2] += n.getZ(i);
    top.set(k, t);
  }
  for (let i = 0; i < p.count; i++) {
    const [x, y, z] = top.get(anahtar(i));
    const L = Math.hypot(x, y, z) || 1;
    n.setXYZ(i, x / L, y / L, z / L);
  }
  return g;
}
function salinimKodu(guc) {
  return `#ifdef USE_INSTANCING
        vec3 kok = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float sal = sin(uZaman * 1.3 + kok.x * 0.07 + kok.z * 0.05) * 0.6 + sin(uZaman * 2.3 + kok.x * 0.13 - kok.z * 0.09) * 0.25;
        float boy = max(0.0, position.y - 1.2);
        transformed.x += sal * ${guc.toFixed(3)} * boy;
        transformed.z += sal * ${(guc * 0.6).toFixed(3)} * boy;
      #endif`;
}
