// Oyun nesnelerinin three.js karşılığı: modeller.js parçalarını (kutu, silindir, çatı) ağ nesnelerine çevirir.
// Haritadaki 3B dünya katmanı (dunya-bina.js) bu kurucuyu kullanır.
import * as THREE from '/vendor/three/three.module.js';
import { PALET } from './modeller.js';

export const S = 30;                 // bir hücre ≈ 30 m

// Deterministik rastgele (komşu dekorları her açılışta aynı görünsün)
export function tohumlu(s) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

const malzemeler = new Map();
export function malzeme(renk, { saydam = false, parlak = false } = {}) {
  const k = `${renk}|${saydam}|${parlak}`;
  if (!malzemeler.has(k)) {
    malzemeler.set(k, new THREE.MeshStandardMaterial({
      color: renk, roughness: parlak ? 0.25 : 0.82, metalness: parlak ? 0.15 : 0.02,
      transparent: saydam, opacity: saydam ? 0.5 : 1, depthWrite: !saydam,
    }));
  }
  return malzemeler.get(k);
}

export function kutu(w, h, d, renk, ops) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), malzeme(renk, ops));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
export const yerel = (ox, oz, u, v) => [ox + (u - 0.5) * S, oz + (v - 0.5) * S];

export function parcaEkle(p, ox, oz, hedef) {
  if (p.tur === 'silindir') {
    const [x, z] = yerel(ox, oz, p.u, p.v);
    const boy = p.tavan - p.taban;
    // Ağaç tepeleri yumuşak alçak poligonlu küre; diğerleri silindir (gövde, depo, baca)
    const geo = p.yaprak ? new THREE.IcosahedronGeometry(p.r * S * 1.15, 0) : new THREE.CylinderGeometry(p.r * S, p.r * S * 1.04, boy, p.r > 0.04 ? 12 : 7);
    const m = new THREE.Mesh(geo, malzeme(p.renk));
    if (p.yaprak) m.scale.y = boy / (p.r * S * 2.1);
    m.position.set(x, p.taban + boy / 2, z);
    m.castShadow = true; m.receiveShadow = true;
    hedef.add(m);
    return;
  }
  const [u0, v0, u1, v1] = p.alan;
  const [x0, z0] = yerel(ox, oz, u0, v0), [x1, z1] = yerel(ox, oz, u1, v1);
  const w = Math.max(0.15, x1 - x0), d = Math.max(0.15, z1 - z0), h = Math.max(0.05, p.tavan - p.taban);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const m = kutu(w, h, d, p.renk, { saydam: !!p.saydam, parlak: !!p.saydam || p.renk === PALET.panel || p.renk === PALET.havuz });
  m.position.set(cx, p.taban + h / 2, cz);
  if (p.egim) m.rotation.x = -0.32;
  hedef.add(m);
  if (p.insaat) {
    // İskele: yapının bitmiş hacmini gösteren tel kafes
    const kenar = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h * 2.4, d)), new THREE.LineBasicMaterial({ color: '#7a5c12' }));
    kenar.position.set(cx, p.taban + h * 1.2, cz);
    hedef.add(kenar);
  }
  if (p.cati === 'kirma') {
    // Kırma çatı: 4 kenarlı koni 45° döndürülüp birim kareye oturtulur, kapsayıcı ölçekle dikdörtgene uyar
    const koni = new THREE.Mesh(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1), malzeme(p.catiRenk, { saydam: !!p.saydam }));
    koni.rotation.y = Math.PI / 4;
    koni.castShadow = true;
    const kapsayici = new THREE.Group();
    kapsayici.position.set(cx, p.tavan + p.catiYuksek / 2, cz);
    kapsayici.scale.set(w * 1.08, p.catiYuksek, d * 1.08);
    kapsayici.add(koni);
    hedef.add(kapsayici);
  } else if (p.cati === 'duz') {
    const cap = kutu(w * 0.94, 0.5, d * 0.94, p.catiRenk || '#9aa3a8');
    cap.position.set(cx, p.tavan + 0.25, cz);
    hedef.add(cap);
  }
  if (!p.insaat && [PALET.duvarSicak, PALET.duvarAcik, '#fbe9d0'].includes(p.renk)) pencereler(hedef, x0, z0, x1, z1, p.taban, p.tavan);
}

// Cephelere küçük pencereler (yalnızca güney ve doğu cephesi; ucuz ama canlı görünür)
function pencereler(hedef, x0, z0, x1, z1, taban, tavan) {
  const cam = pencereMalzemesi;
  for (let y = taban + 1.6; y < tavan - 0.8; y += 3.2) {
    for (let x = x0 + 1.5; x < x1 - 1; x += 2.6) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.3, 0.1), cam);
      p.position.set(x + 0.5, y, z1 + 0.02);
      hedef.add(p);
    }
    for (let z = z0 + 1.5; z < z1 - 1; z += 2.6) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.3, 1.1), cam);
      p.position.set(x1 + 0.02, y, z + 0.5);
      hedef.add(p);
    }
  }
}

// Pencere camı: gündüz koyu mavi-gri, gece içeriden sıcak ışık (dünya katmanı yoğunluğu ayarlar)
export const pencereMalzemesi = new THREE.MeshStandardMaterial({ color: '#3b5566', roughness: 0.25, metalness: 0.15, emissive: '#ffc46b', emissiveIntensity: 0 });
