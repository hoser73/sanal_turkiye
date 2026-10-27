// Gerçek tarla (kare olmayan parsel) yerleşim yardımcıları: tarla çerçevesi ve sınır çokgeninden toprak plakası.
// Tam sayfa çiftlik (ciftlik-ici.js) ve haritadaki 3B dünya (dunya-bina.js) kullanır.
import * as THREE from '/vendor/three/three.module.js';
import { S } from './model3d.js';

// Tarla çerçevesi: yerel metre koordinatlı sınırdan (merkeze göre) modelin yerleşimi. Modelin x ekseni tarlanın uzun
// kenarı boyuncadır (karıklar ve sıralar uzun kenara paralel); kare model kısa kenara sığacak biçimde ölçeklenir.
// Dönüş: { merkez:[x,z], aci (radyan, x→z), olcek, alan:[u0,v0,u1,v1], cokgen (model koordinatı) }
export function tarlaCercevesi(noktalar, yonDerece = 0) {
  const kapsam = (a) => {
    const ux = Math.cos(a), uz = Math.sin(a);
    let u0 = Infinity, u1 = -Infinity, p0 = Infinity, p1 = -Infinity;
    for (const [x, z] of noktalar) { const u = x * ux + z * uz, p = -x * uz + z * ux; u0 = Math.min(u0, u); u1 = Math.max(u1, u); p0 = Math.min(p0, p); p1 = Math.max(p1, p); }
    return { a, ux, uz, u0, u1, p0, p1 };
  };
  let k = kapsam((yonDerece * Math.PI) / 180);
  if (k.p1 - k.p0 > k.u1 - k.u0) k = kapsam(k.a + Math.PI / 2);
  const L = k.u1 - k.u0, W = Math.max(1, k.p1 - k.p0), olcek = W / S;
  const um = (k.u0 + k.u1) / 2, pm = (k.p0 + k.p1) / 2;
  const merkez = [um * k.ux - pm * k.uz, um * k.uz + pm * k.ux];
  const yari = L / W / 2;
  const cokgen = noktalar.map(([x, z]) => { const dx = x - merkez[0], dz = z - merkez[1]; return [(dx * k.ux + dz * k.uz) / olcek, (-dx * k.uz + dz * k.ux) / olcek]; });
  return { merkez, aci: k.a, olcek, alan: [0.5 - yari + 0.02, 0.04, 0.5 + yari - 0.02, 0.96], cokgen, uzun: L, kisa: W };
}

// Sınır çokgeninden toprak plakası (model koordinatı; üst yüzü y = kalinlik). Dokusu 10 m'de bir tekrar eder.
export function cokgenPlaka(cokgen, kalinlik, malzeme) {
  const sekil = new THREE.Shape(cokgen.map(([x, z]) => new THREE.Vector2(x, -z)));
  const geo = new THREE.ExtrudeGeometry(sekil, { depth: kalinlik, bevelEnabled: false }).rotateX(-Math.PI / 2);
  const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 10, uv.getY(i) / 10);
  const m = new THREE.Mesh(geo, malzeme); m.receiveShadow = true;
  return m;
}
