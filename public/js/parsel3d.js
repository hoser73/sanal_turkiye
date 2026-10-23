// Parselin ayrıntılı 3B modeli: paneldeki dönen maket (sahne3d.js) ve haritadaki 3B dünya (dunya-bina.js) aynı kurucuyu
// kullanır. Hücre 30 m (S); yerel koordinat: x = (u − 0,5)·S doğu, z = (v − 0,5)·S güney, y yukarı (metre).
// Ekinler gerçek bitki modelleriyle (sıra sıra buğday, kazıklı domates, çay çitleri, pamuk, bağ telleri, meyve ağaçları)
// büyüme oranına göre boy atar ve olgunlaştıkça renk değiştirir. Yapılar açılış sahnesinin dokulu modelleridir
// (köy evi, ahır, silo); sera, güneş paneli, tel çit, sulama, kümes ve ağıl burada çizilir. Ayrıntılı modeli olmayan
// yapılar ve süsler eski parça tanımlarıyla (modeller.js) çizilir.
import * as THREE from '/vendor/three/three.module.js';
import { EKIN, renkKaristir, yerlesim, yapiParcalari, susParcalari } from './modeller.js';
import { S, parcaEkle } from './model3d.js';
import { malzemeler, koyEvi, ahir, silo, agacUret, kabukMalzemesi, basakGeo, inek, koyun, tacGeo, pikselDoku, pg, fotoDokulariYukle } from './tanitim3d-model.js';

const ux = (u) => (u - 0.5) * S, vz = (v) => (v - 0.5) * S;
const TARLA = [0.06, 0.08, 0.53, 0.92];   // ekin alanı (modeller.js ile aynı: parselin batı yarısı)

// Tohumlu rastgele: aynı parsel her çizimde aynı görünür
function tohumlu(s) {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

// ---------- Paylaşılan malzeme ve geometriler (bir kez kurulur; her iki çizici de kullanır)
let O = null;
function ortak() {
  if (O) return O;
  const M = malzemeler();
  fotoDokulariYukle(M);
  const toprak = pikselDoku(512, (u, v) => {   // sürülmüş toprak: x boyunca sırtlar ve karıklar, kesekler
    const sirt = Math.sin(v * Math.PI * 2 * 16) * 0.5 + 0.5, kesek = pg(u * 40, v * 40, 40), ince = pg(u * 120, v * 120, 120);
    const y = sirt * 0.7 + kesek * 0.2 + ince * 0.1, k = 0.62 + sirt * 0.35 + (kesek - 0.5) * 0.25 + (ince - 0.5) * 0.12;
    return [118 * k, 84 * k, 56 * k, y];
  }, 6);
  toprak.map.repeat.set(3, 6); toprak.normalMap.repeat.set(3, 6);
  const yaprak = new THREE.MeshStandardMaterial({ map: M.yaprak, vertexColors: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8 });
  const isaretle = (m) => { m.userData.paylasimli = true; return m; };
  // Buğday: renk örnekten (genç yeşil → olgun altın) gelsin diye köşe renkleri griye çevrilir
  const basak = basakGeo(), bc = basak.attributes.color;
  for (let i = 0; i < bc.count; i++) { const l = (bc.getX(i) + bc.getY(i) + bc.getZ(i)) / 3; const k = 0.55 + l * 0.75; bc.setXYZ(i, k, k, k); }
  const panelTuval = document.createElement('canvas'); panelTuval.width = 256; panelTuval.height = 384;
  { const x = panelTuval.getContext('2d'); x.fillStyle = '#122244'; x.fillRect(0, 0, 256, 384); x.strokeStyle = '#8fa3bd'; x.lineWidth = 3;
    for (let i = 0; i <= 6; i++) { x.beginPath(); x.moveTo(i * 256 / 6, 0); x.lineTo(i * 256 / 6, 384); x.stroke(); }
    for (let j = 0; j <= 10; j++) { x.beginPath(); x.moveTo(0, j * 38.4); x.lineTo(256, j * 38.4); x.stroke(); }
    x.strokeStyle = '#c9d3dc'; x.lineWidth = 10; x.strokeRect(0, 0, 256, 384); }
  const panelDoku = new THREE.CanvasTexture(panelTuval); panelDoku.colorSpace = THREE.SRGBColorSpace; panelDoku.anisotropy = 8;
  O = {
    M, isaretle,
    toprak: new THREE.MeshStandardMaterial({ ...toprak, roughness: 0.97 }),
    yaprak, yaprakDerinlik: new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: M.yaprak, alphaTest: 0.4 }),
    kabuk: kabukMalzemesi(),
    bitki: new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.75 }),
    meyve: new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0 }),
    ahsap: new THREE.MeshStandardMaterial({ color: '#7a5634', roughness: 0.9 }),
    metal: new THREE.MeshStandardMaterial({ color: '#c9ced3', roughness: 0.3, metalness: 0.85 }),
    boru: new THREE.MeshStandardMaterial({ color: '#1d1f22', roughness: 0.55 }),
    cam: new THREE.MeshPhysicalMaterial({ color: '#eaf7f4', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.6 }),
    panel: new THREE.MeshStandardMaterial({ map: panelDoku, roughness: 0.18, metalness: 0.55 }),
    tel: new THREE.LineBasicMaterial({ color: '#9aa0a4', transparent: true, opacity: 0.85 }),
    geo: {
      basak,
      cali: tacGeo('kure', 26, 1, 0.75),      // domates, pamuk: küçük çalı
      cayCit: tacGeo('kure', 40, 0, 0.8),     // çay: sık, düz kesilmiş çit
      asma: tacGeo('kure', 22, 0, 0.8),       // bağ: asma yaprakları
      sera: tacGeo('kure', 14, 1, 0.6),
      kazik: new THREE.CylinderGeometry(0.02, 0.025, 1.4, 5).translate(0, 0.7, 0),
      direk: new THREE.CylinderGeometry(0.05, 0.06, 1.9, 6).translate(0, 0.95, 0),
      meyve: new THREE.SphereGeometry(0.06, 8, 6),
      salkim: new THREE.ConeGeometry(0.07, 0.2, 7).rotateX(Math.PI).translate(0, -0.1, 0),
      kozak: new THREE.SphereGeometry(0.045, 6, 4),
      citDirek: new THREE.CylinderGeometry(0.06, 0.07, 1.4, 6).translate(0, 0.7, 0),
    },
    agac: null,   // meyve ağacı çeşitleri (ilk kullanımda)
  };
  return O;
}
function agaclar(ayrinti) {
  const o = ortak();
  o.agac ??= {};
  const k = ayrinti > 0.6 ? 'yakin' : 'uzak';
  o.agac[k] ??= [0, 1, 2].map(() => agacUret('meyve', ayrinti > 0.6 ? 1 : 0.45));
  return o.agac[k];
}
// Ağaç tacındaki yaprak kartlarının merkezlerinden meyve yerleri
function meyveYerleri(geo, n, r) {
  const p = geo.attributes.position, kartlar = p.count / 4, yer = [];
  for (let i = 0; i < n; i++) {
    const c = Math.floor(r() * kartlar) * 4, v = new THREE.Vector3();
    for (let k = 0; k < 4; k++) v.add(new THREE.Vector3().fromBufferAttribute(p, c + k));
    yer.push(v.multiplyScalar(0.25));
  }
  return yer;
}

// ---------- Yardımcılar
const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), sc = new THREE.Vector3(), YUKARI = new THREE.Vector3(0, 1, 0), RENK = new THREE.Color();
function ornekle(geo, malz, yerler, { renk = null, golge = true, derinlik = null } = {}) {
  if (!yerler.length) return null;
  const im = new THREE.InstancedMesh(geo, malz, yerler.length);
  yerler.forEach(([x, y, z, ry, sx, sy, sz, c], i) => {
    m4.compose(v3.set(x, y, z), q.setFromAxisAngle(YUKARI, ry), sc.set(sx, sy ?? sx, sz ?? sx)); im.setMatrixAt(i, m4);
    if (renk || c) im.setColorAt(i, RENK.set(c || renk));
  });
  im.castShadow = golge; im.receiveShadow = true; im.userData.paylasimli = true;
  if (derinlik) im.customDepthMaterial = derinlik;
  return im;
}
// Bir modeli yuvaya (u0,v0,u1,v1) oranını bozmadan sığdırır ve tabanını zemine oturtur
function yuvayaSigdir(obj, [u0, v0, u1, v1], dolum = 0.92) {
  const kutu = new THREE.Box3().setFromObject(obj), boyut = kutu.getSize(new THREE.Vector3());
  const s = Math.min(((u1 - u0) * S * dolum) / boyut.x, ((v1 - v0) * S * dolum) / boyut.z);
  obj.scale.multiplyScalar(s);
  const k2 = new THREE.Box3().setFromObject(obj), m = k2.getCenter(new THREE.Vector3());
  obj.position.x += ux((u0 + u1) / 2) - m.x; obj.position.z += vz((v0 + v1) / 2) - m.z; obj.position.y -= k2.min.y;
  return obj;
}
function golgeli(obj) { obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); return obj; }

// ---------- Ekinler
function ekinEkle(g, tip, buyume, ayrinti, r) {
  const e = EKIN[tip];
  if (!e) return;
  const o = ortak(), b = Math.max(0.12, Math.min(1, buyume)), olgun = Math.max(0, (buyume - 0.6) / 0.4), renk = renkKaristir(e.genc, e.olgun, olgun);
  const [u0, v0, u1, v1] = TARLA, x0 = ux(u0) + 0.6, x1 = ux(u1) - 0.6, z0 = vz(v0) + 0.6, z1 = vz(v1) - 0.6;
  const yakin = ayrinti > 0.6;
  if (tip === 'BUGDAY') {
    const n = yakin ? 2600 : 520, yer = [];
    for (let i = 0; i < n; i++) { const s = (yakin ? 0.9 : 1.6) * (0.85 + r() * 0.3); yer.push([x0 + r() * (x1 - x0), 0, z0 + r() * (z1 - z0), r() * 6.28, s, s * (0.25 + 0.85 * b), s, renkKaristir(renk, '#ffffff', r() * 0.12)]); }
    g.add(ornekle(o.geo.basak, o.bitki, yer, { golge: yakin }));
  } else if (e.tur === 'agac') {
    const cesit = agaclar(ayrinti), kovalar = cesit.map(() => []), meyveler = [];
    const meyveRengi = { ELMA: ['#7fae3a', '#c8352c'], KAYISI: ['#9cbf4a', '#f29a2e'], FINDIK: ['#8faa4a', '#8a5a2c'], ZEYTIN: ['#7d8f4a', '#3b2f3a'] }[tip] || ['#8a9a4a', e.olgun];
    const yaprakRengi = tip === 'ZEYTIN' ? '#c9d6b6' : tip === 'FINDIK' ? '#e6f2c8' : '#ffffff';
    for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) {
      const x = ux(0.12 + i * 0.14), z = vz(0.14 + j * 0.22), ci = Math.floor(r() * 3), s = (e.boy / cesit[ci].boy) * 1.15 * (0.3 + 0.7 * b), ry = r() * 6.28;
      kovalar[ci].push([x, 0, z, ry, s]);
      if (olgun > 0.05 || b > 0.7) {
        const yerler = meyveYerleri(cesit[ci].yaprak, yakin ? 26 : 10, r), cos = Math.cos(ry), sin = Math.sin(ry);
        for (const p of yerler) meyveler.push([x + (p.x * cos + p.z * sin) * s, p.y * s, z + (-p.x * sin + p.z * cos) * s, 0, (tip === 'ZEYTIN' || tip === 'FINDIK' ? 0.65 : 1) * (0.6 + 0.4 * olgun), null, null, renkKaristir(meyveRengi[0], meyveRengi[1], olgun)]);
      }
    }
    cesit.forEach((c, ci) => {
      if (!kovalar[ci].length) return;
      g.add(ornekle(c.kabuk, o.kabuk, kovalar[ci]));
      g.add(ornekle(c.yaprak, o.yaprak, kovalar[ci].map((t) => [...t.slice(0, 5), null, null, renkKaristir(yaprakRengi, '#ffffff', r() * 0.2)]), { derinlik: o.yaprakDerinlik }));
    });
    if (meyveler.length) g.add(ornekle(o.geo.meyve, o.meyve, meyveler, { golge: false }));
  } else {
    // Sıra bitkileri: x boyunca sıralar (karıklarla aynı yön)
    const satir = tip === 'CAY' ? 1.6 : tip === 'UZUM' ? 2.6 : 1.2, aralik = tip === 'CAY' ? 0.85 : tip === 'UZUM' ? 1.1 : yakin ? 0.6 : 1.0;
    const bitki = [], kazik = [], meyve = [], direk = [], teller = [];
    for (let z = z0 + 0.4; z < z1; z += satir) {
      for (let x = x0 + 0.3; x < x1; x += aralik) {
        const jx = x + (r() - 0.5) * 0.12, jz = z + (r() - 0.5) * 0.1, ry = r() * 6.28;
        if (tip === 'CAY') bitki.push([jx, 0.45 * b, jz, ry, 0.75, 0.42 * (0.4 + 0.6 * b), 0.62, renkKaristir('#e4f4cf', '#c4e2a6', r())]);
        else if (tip === 'UZUM') {
          bitki.push([jx, 1.25 * (0.5 + 0.5 * b), jz, ry, 0.75 * (0.4 + 0.6 * b), 0.55, 0.5, renkKaristir('#f4fadf', '#dcedbd', r())]);
          if (olgun > 0.05 || b > 0.6) for (let k = 0; k < (yakin ? 3 : 1); k++) meyve.push([jx + (r() - 0.5) * 0.6, 1.05, jz + (r() - 0.5) * 0.3, 0, 1, 1, 1, renkKaristir('#9cbf5a', '#4b1f4e', olgun)]);
        } else {
          const boy = 0.25 + e.boy * b;
          bitki.push([jx, boy * 0.55, jz, ry, 0.42 * (0.4 + 0.6 * b), boy * 0.62, 0.42 * (0.4 + 0.6 * b), renkKaristir(tip === 'PAMUK' ? e.genc : renkKaristir(e.genc, '#7a8a3a', olgun * 0.4), '#ffffff', 0.62 + r() * 0.1)]);
          if (tip === 'DOMATES') { kazik.push([jx + 0.08, 0, jz, 0, 1, 0.6 + 0.6 * b, 1]); if (b > 0.35) for (let k = 0; k < (yakin ? 6 : 2); k++) meyve.push([jx + (r() - 0.5) * 0.4, boy * (0.25 + r() * 0.6), jz + (r() - 0.5) * 0.4, 0, 0.8 + r() * 0.4, null, null, renkKaristir('#6f9e3a', '#d8321f', olgun)]); }
          if (tip === 'PAMUK' && olgun > 0.15) for (let k = 0; k < (yakin ? 7 : 2); k++) meyve.push([jx + (r() - 0.5) * 0.4, boy * (0.4 + r() * 0.55), jz + (r() - 0.5) * 0.4, 0, 0.7 + olgun * 0.6, null, null, '#fbf8f0']);
        }
      }
      if (tip === 'UZUM') {
        for (let x = x0; x <= x1 + 0.01; x += (x1 - x0) / 4) direk.push([x, 0, z, 0, 1]);
        for (const y of [0.7, 1.2, 1.65]) teller.push(new THREE.Vector3(x0, y, z), new THREE.Vector3(x1, y, z));
      }
    }
    const geo = tip === 'CAY' ? o.geo.cayCit : tip === 'UZUM' ? o.geo.asma : o.geo.cali;
    g.add(ornekle(geo, o.yaprak, bitki, { derinlik: o.yaprakDerinlik }));
    if (kazik.length && yakin) g.add(ornekle(o.geo.kazik, o.ahsap, kazik, { golge: false }));
    if (meyve.length) g.add(ornekle(tip === 'UZUM' ? o.geo.salkim : tip === 'PAMUK' ? o.geo.kozak : o.geo.meyve, o.meyve, meyve, { golge: false }));
    if (direk.length) g.add(ornekle(o.geo.direk, o.ahsap, direk));
    if (teller.length) { const t = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(teller), o.tel); g.add(t); }
  }
}

// ---------- Yapılar
function sera([u0, v0, u1, v1], r) {
  const o = ortak(), g = new THREE.Group(), w = (u1 - u0) * S * 0.92, d = (v1 - v0) * S * 0.92, H = 3, T = 1.5;
  const cerceve = (gw, gh, gd, x, y, z, rz = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(gw, gh, gd), o.metal); m.position.set(x, y, z); m.rotation.z = rz; m.castShadow = true; g.add(m); };
  for (let x = -w / 2; x <= w / 2 + 0.01; x += w / Math.max(2, Math.round(w / 2.2))) {
    cerceve(0.08, H, 0.08, x, H / 2, -d / 2); cerceve(0.08, H, 0.08, x, H / 2, d / 2);
  }
  for (let z = -d / 2; z <= d / 2 + 0.01; z += d / Math.max(2, Math.round(d / 2.2))) {
    cerceve(0.08, H, 0.08, -w / 2, H / 2, z); cerceve(0.08, H, 0.08, w / 2, H / 2, z);
    const egim = Math.atan2(T, w / 2), L = Math.hypot(T, w / 2);
    for (const s of [1, -1]) { const m = new THREE.Mesh(new THREE.BoxGeometry(L, 0.07, 0.07), o.metal); m.position.set(s * w / 4, H + T / 2, z); m.rotation.z = -s * egim; g.add(m); }
  }
  for (const y of [0.05, H]) for (const z of [-d / 2, d / 2]) cerceve(w, 0.07, 0.07, 0, y, z);
  cerceve(0.09, 0.09, d, 0, H + T, 0);
  const camKutu = new THREE.Mesh(new THREE.BoxGeometry(w, H, d), o.cam); camKutu.position.y = H / 2; camKutu.renderOrder = 3; g.add(camKutu);
  const cati = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, T)]);
  const catiGeo = new THREE.ExtrudeGeometry(cati, { depth: d, bevelEnabled: false }); catiGeo.translate(0, 0, -d / 2);
  const catiCam = new THREE.Mesh(catiGeo, o.cam); catiCam.position.y = H; catiCam.renderOrder = 3; g.add(catiCam);
  // İçeride domates sıraları
  const ic = [];
  for (let z = -d / 2 + 0.8; z < d / 2 - 0.5; z += 1.3) for (let x = -w / 2 + 0.6; x < w / 2 - 0.4; x += 0.7) ic.push([x, 0.55, z, r() * 6, 0.5, 0.75, 0.5, renkKaristir('#e2f2cc', '#f2f9e6', r())]);
  g.add(ornekle(o.geo.sera, o.yaprak, ic, { golge: false }));
  const toprakIc = new THREE.Mesh(new THREE.BoxGeometry(w - 0.2, 0.06, d - 0.2), o.toprak); toprakIc.position.y = 0.03; g.add(toprakIc);
  g.position.set(ux((u0 + u1) / 2), 0, vz((v0 + v1) / 2));
  return g;
}
function gunesPaneli() {
  const o = ortak(), g = new THREE.Group();
  for (let sira = 0; sira < 3; sira++) for (let k = 0; k < 5; k++) {
    const p = new THREE.Group(), panel = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.045, 1.65), [o.metal, o.metal, o.panel, o.metal, o.metal, o.metal]);
    panel.rotation.x = -0.55; panel.position.y = 1.05; panel.castShadow = true; p.add(panel);
    for (const [dz, h] of [[-0.55, 0.65], [0.55, 1.45]]) { const a = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, h, 6), o.metal); a.position.set(0, h / 2, dz); p.add(a); }
    p.position.set(ux(0.08) + k * 1.08 + 0.5, 0, vz(0.08) + sira * 2.3 + 0.9); p.rotation.y = Math.PI;
    g.add(p);
  }
  return g;
}
function telCit() {
  const o = ortak(), g = new THREE.Group(), a = S / 2 - 0.3, yer = [], teller = [];
  for (let t = -a; t <= a + 0.01; t += 2.5) yer.push([t, 0, -a, 0, 1], [t, 0, a, 0, 1], [-a, 0, t, 0, 1], [a, 0, t, 0, 1]);
  g.add(ornekle(o.geo.citDirek, o.ahsap, yer));
  for (const y of [0.4, 0.85, 1.25]) {
    const k = [[-a, -a], [a, -a], [a, a], [-a, a], [-a, -a]];
    for (let i = 0; i < 4; i++) teller.push(new THREE.Vector3(k[i][0], y, k[i][1]), new THREE.Vector3(k[i + 1][0], y, k[i + 1][1]));
  }
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(teller), o.tel));
  return g;
}
function sulama() {
  const o = ortak(), g = new THREE.Group(), [u0, v0, u1, v1] = TARLA;
  for (let z = vz(v0) + 1; z < vz(v1); z += 1.2) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, (u1 - u0) * S - 1, 6), o.boru); b.rotation.z = Math.PI / 2; b.position.set(ux((u0 + u1) / 2), 0.06, z + 0.25); g.add(b); }
  const ana = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, (v1 - v0) * S - 1, 8), new THREE.MeshStandardMaterial({ color: '#2f6fb3', roughness: 0.4 }));
  ana.rotation.x = Math.PI / 2; ana.position.set(ux(u1) - 0.3, 0.1, vz((v0 + v1) / 2)); g.add(ana);
  const pompa = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.8, 0.7), new THREE.MeshStandardMaterial({ color: '#2f6fb3', roughness: 0.35, metalness: 0.4 })); pompa.position.set(ux(u1) - 0.3, 0.4, vz(v1) - 0.8); pompa.castShadow = true; g.add(pompa);
  return g;
}
function tavuk(r) {
  const g = new THREE.Group(), renk = r() < 0.6 ? '#f5f1e8' : '#a5622c';
  const govde = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshStandardMaterial({ color: renk, roughness: 0.9 })); govde.scale.set(1.3, 1, 0.95); govde.position.y = 0.3; g.add(govde);
  const bas = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), govde.material); bas.position.set(0.17, 0.46, 0); g.add(bas);
  const ibik = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.02), new THREE.MeshStandardMaterial({ color: '#d42a23' })); ibik.position.set(0.18, 0.54, 0); g.add(ibik);
  const gaga = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.06, 5), new THREE.MeshStandardMaterial({ color: '#e8a52a' })); gaga.rotation.z = -Math.PI / 2; gaga.position.set(0.26, 0.45, 0); g.add(gaga);
  const kuyruk = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 6), govde.material); kuyruk.rotation.z = 0.9; kuyruk.position.set(-0.2, 0.42, 0); g.add(kuyruk);
  for (const z of [-0.05, 0.05]) { const a = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 4), gaga.material); a.position.set(0, 0.1, z); g.add(a); }
  return golgeli(g);
}
function kumes(yuva, r) {
  const o = ortak(), g = new THREE.Group();
  const ev = new THREE.Group(), w = 2.6, d = 1.9;
  for (const [x, z] of [[-1.1, -0.8], [1.1, -0.8], [-1.1, 0.8], [1.1, 0.8]]) { const a = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.6, 0.12), o.ahsap); a.position.set(x, 0.3, z); ev.add(a); }
  const govde = new THREE.Mesh(new THREE.BoxGeometry(w, 1.5, d), o.M.tahta); govde.position.y = 1.35; ev.add(govde);
  const cati = new THREE.Mesh(new THREE.ConeGeometry(1.0, 0.9, 4).rotateY(Math.PI / 4), o.M.kiremit); cati.scale.set(w * 0.78, 1, d * 0.78); cati.position.y = 2.55; ev.add(cati);
  const rampa = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 1.3), o.ahsap); rampa.rotation.x = 0.55; rampa.position.set(0.4, 0.35, 1.45); ev.add(rampa);
  golgeli(ev); g.add(ev);
  for (let i = 0; i < 7; i++) { const t = tavuk(r); t.position.set((r() - 0.5) * 5, 0, 2.2 + r() * 2.5); t.rotation.y = r() * 6.28; g.add(t); }
  return yuvayaSigdir(g, yuva, 0.95);
}
function agil(yuva, r) {
  const o = ortak(), g = new THREE.Group(), [u0, v0, u1, v1] = yuva, w = (u1 - u0) * S * 0.92, d = (v1 - v0) * S * 0.92, yer = [], teller = [];
  for (let t = -w / 2; t <= w / 2 + 0.01; t += 1.6) yer.push([t, 0, -d / 2, 0, 1], [t, 0, d / 2, 0, 1]);
  for (let t = -d / 2; t <= d / 2 + 0.01; t += 1.6) yer.push([-w / 2, 0, t, 0, 1], [w / 2, 0, t, 0, 1]);
  g.add(ornekle(o.geo.citDirek, o.ahsap, yer));
  for (const y of [0.5, 1.05]) for (const [a, b] of [[[-w / 2, -d / 2], [w / 2, -d / 2]], [[w / 2, -d / 2], [w / 2, d / 2]], [[w / 2, d / 2], [-w / 2, d / 2]], [[-w / 2, d / 2], [-w / 2, -d / 2]]]) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), m = new THREE.Mesh(new THREE.BoxGeometry(L, 0.1, 0.06), o.ahsap);
    m.position.set((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2); m.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]); m.castShadow = true; g.add(m);
  }
  const barinak = new THREE.Group(), bw = w * 0.4, bd = d * 0.35;
  const duvar = new THREE.Mesh(new THREE.BoxGeometry(bw, 2.2, bd), o.M.tahta); duvar.position.y = 1.1; barinak.add(duvar);
  const cati = new THREE.Mesh(new THREE.BoxGeometry(bw + 0.6, 0.12, bd + 0.6), o.M.sac); cati.position.y = 2.35; cati.rotation.x = 0.12; barinak.add(cati);
  golgeli(barinak); barinak.position.set(-w / 2 + bw / 2 + 0.3, 0, -d / 2 + bd / 2 + 0.3); g.add(barinak);
  for (let i = 0; i < 6; i++) { const k = koyun(); k.position.set((r() - 0.3) * w * 0.7, 0, (r() - 0.2) * d * 0.6); k.rotation.y = r() * 6.28; k.userData.bas.rotation.z = -0.6 * r(); g.add(golgeli(k)); }
  g.position.set(ux((u0 + u1) / 2), 0, vz((v0 + v1) / 2));
  return g;
}
function yapiEkle(g, { tip, tamam, yuva }, ayrinti, gece, r) {
  const o = ortak();
  if (!tamam) { for (const p of yapiParcalari(tip, yuva, false)) parcaEkle(p, 0, 0, g); return; }
  switch (tip) {
    case 'EV': return g.add(yuvayaSigdir(golgeli(koyEvi(o.M, gece)), yuva, 0.95));
    case 'AMBAR': return g.add(yuvayaSigdir(golgeli(ahir(o.M)), yuva, 0.95));
    case 'INEK_AHIRI': {
      const [u0, v0, u1, v1] = yuva;
      g.add(yuvayaSigdir(golgeli(ahir(o.M)), [u0, v0, u0 + (u1 - u0) * 0.75, v0 + (v1 - v0) * 0.62], 0.95));
      [['alaca', 0.3, 0.82], ['kahve', 0.72, 0.8]].forEach(([t, a, b]) => { const c = golgeli(inek(t)); c.position.set(ux(u0 + (u1 - u0) * a), 0, vz(v0 + (v1 - v0) * b)); c.rotation.y = r() * 6.28; c.userData.bas.rotation.z = -0.7; g.add(c); });
      return;
    }
    case 'SERA': return g.add(sera(yuva, r));
    case 'SU_DEPOSU': { const s = golgeli(silo(o.M)); s.scale.setScalar(0.42); s.position.set(ux(0.9), 0, vz(0.9)); return g.add(s); }
    case 'GUNES_PANELI': return g.add(gunesPaneli());
    case 'TEL_CIT': return g.add(telCit());
    case 'SULAMA_HATTI': return g.add(sulama());
    case 'KUMES': return g.add(kumes(yuva, r));
    case 'AGIL': return g.add(agil(yuva, r));
    case 'PEYZAJ': {
      const cesit = agaclar(ayrinti), yer = [[0.08, 0.92], [0.92, 0.08], [0.1, 0.5], [0.5, 0.94]].map(([u, v]) => [ux(u), 0, vz(v), r() * 6.28, (5.5 / cesit[0].boy) * 1.3]);
      g.add(ornekle(cesit[0].kabuk, o.kabuk, yer)); g.add(ornekle(cesit[0].yaprak, o.yaprak, yer.map((t) => [...t, null, null, '#ffffff']), { derinlik: o.yaprakDerinlik }));
      return;
    }
    default: for (const p of yapiParcalari(tip, yuva, true)) parcaEkle(p, 0, 0, g);
  }
}

// ---------- Kurucu
// veri: { id, imar, yp: "EV:1,SERA:0", ek: "DOMATES:0.42", kz: "cati:#hex|bayrak:#hex", ss: "KUYU:3" }
// secenek: { ayrinti: 1 (maket) | 0.45 (harita), gece: 0..1, zemin: true → tarla toprağı serilir }
export function parselModeli(veri, { ayrinti = 1, gece = 0, zemin = true, zeminY = 0 } = {}) {
  const g = new THREE.Group(), r = tohumlu(veri.id || `${veri.imar}${veri.yp}${veri.ek}`), o = ortak();
  const [ekTip, ekB] = String(veri.ek || '').split(':');
  if (zemin && (veri.imar === 'TARIM' || ekTip)) {
    const [u0, v0, u1, v1] = TARLA, w = (u1 - u0) * S, d = (v1 - v0) * S;
    const t = new THREE.Mesh(new THREE.BoxGeometry(w, 0.14, d), o.toprak); t.position.set(ux((u0 + u1) / 2), 0.02 + zeminY, vz((v0 + v1) / 2)); t.receiveShadow = true;
    const uv = t.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 10, uv.getY(i) * d / 10);
    g.add(t);
  }
  const ust = new THREE.Group(); ust.position.y = (zemin ? 0.09 : 0) + zeminY; g.add(ust);
  if (ekTip) ekinEkle(ust, ekTip, Number(ekB) || 0, ayrinti, r);
  for (const y of yerlesim(veri.yp)) yapiEkle(ust, y, ayrinti, gece, r);
  for (const kayit of String(veri.ss || '').split(',').filter(Boolean)) { const [tur, yuva] = kayit.split(':'); for (const p of susParcalari(tur, Number(yuva) || 0)) parcaEkle(p, 0, 0, ust); }
  const kz = Object.fromEntries(String(veri.kz || '').split('|').filter(Boolean).map((x) => x.split(':')));
  if (kz.bayrak) {
    const direk = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 7, 10), o.metal); direk.position.set(ux(0.06), 3.5, vz(0.06));
    const bez = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.2, 8, 4), new THREE.MeshStandardMaterial({ color: kz.bayrak, side: THREE.DoubleSide, roughness: 0.6 }));
    const p = bez.geometry.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin((p.getX(i) + 0.9) * 2.6) * 0.12 * (p.getX(i) + 0.9));
    bez.geometry.computeVertexNormals(); bez.position.set(ux(0.06) + 0.95, 6.2, vz(0.06)); direk.castShadow = bez.castShadow = true;
    ust.add(direk, bez);
  }
  return g;
}
export function parselMalzemeleriHazirla() { return ortak(); }

// Komşu hücrelerin süsü (maket): tarım komşuları rastgele ekinli tarla, orman ve park ağaçlı, konut köy evli
export function komsuModeli(imar, tohum, gece = 0) {
  const r = tohumlu(tohum), o = ortak(), g = new THREE.Group();
  if (imar === 'TARIM') {
    const tur = ['BUGDAY', 'BUGDAY', 'PAMUK', 'CAY', 'UZUM', 'DOMATES', 'ELMA', 'ZEYTIN'][Math.floor(r() * 8)];
    return parselModeli({ id: tohum, imar, ek: `${tur}:${(0.45 + r() * 0.55).toFixed(2)}` }, { ayrinti: 0.45, gece });
  }
  if (imar === 'KORUMA' || imar === 'PARK') {
    const cesit = agaclar(0.45), n = imar === 'KORUMA' ? 10 : 5, yer = [];
    for (let i = 0; i < n; i++) yer.push([ux(0.12 + r() * 0.76), 0, vz(0.12 + r() * 0.76), r() * 6.28, (7 + r() * 5) / cesit[0].boy * 1.4]);
    g.add(ornekle(cesit[0].kabuk, o.kabuk, yer)); g.add(ornekle(cesit[0].yaprak, o.yaprak, yer.map((t) => [...t, null, null, renkKaristir('#ffffff', '#cfe0a8', r())]), { derinlik: o.yaprakDerinlik }));
    return g;
  }
  if (imar === 'KONUT' || imar === 'KARMA' || imar === 'TURIZM') {
    const n = 1 + Math.floor(r() * 2);
    for (let i = 0; i < n; i++) { const u0 = 0.1 + i * 0.45, v0 = 0.15 + r() * 0.3; g.add(yuvayaSigdir(golgeli(koyEvi(o.M, gece)), [u0, v0, u0 + 0.38, v0 + 0.38], 0.9)); }
    return g;
  }
  return null;
}
// Maket kaidesinin yan yüzleri: katmanlı toprak kesiti (çimen, kara toprak, kahverengi alt toprak, taşlar)
export function kaideDokusu() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const x = c.getContext('2d'), r = tohumlu('kaide');
  const kat = (y0, y1, a, b) => { const g = x.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, a); g.addColorStop(1, b); x.fillStyle = g; x.fillRect(0, y0, 512, y1 - y0); };
  kat(0, 20, '#5f9a3a', '#4c7f2c'); kat(20, 90, '#4a3423', '#5c4029'); kat(90, 256, '#8a6440', '#6e4f33');
  for (let i = 0; i < 900; i++) { x.fillStyle = `rgba(${r() < 0.5 ? '30,20,10' : '200,170,120'},${0.08 + r() * 0.12})`; x.fillRect(r() * 512, 20 + r() * 236, 1 + r() * 3, 1 + r() * 2); }
  for (let i = 0; i < 70; i++) { const y = 95 + r() * 150, rr = 3 + r() * 9; x.fillStyle = ['#9c958a', '#8a837a', '#b0a898'][i % 3]; x.beginPath(); x.ellipse(r() * 512, y, rr * 1.3, rr, r() * 3, 0, 7); x.fill(); x.fillStyle = 'rgba(0,0,0,.25)'; x.beginPath(); x.ellipse(0, 0, 0, 0, 0, 0, 7); x.fill(); }
  for (let i = 0; i < 40; i++) { x.strokeStyle = 'rgba(60,40,20,.5)'; x.lineWidth = 1; x.beginPath(); const sx = r() * 512; x.moveTo(sx, 20); x.bezierCurveTo(sx + 6, 40, sx - 6, 60, sx + r() * 10, 70 + r() * 30); x.stroke(); }   // kökler
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}
// Gerçek gökyüzü ışığı (HDRI): bir kez yüklenir, isteyen sahneye ortam haritası olarak verilir
const hdrSozleri = new WeakMap();
export function gokIsigi(renderer) {
  if (!hdrSozleri.has(renderer)) {
    hdrSozleri.set(renderer, import('/vendor/three-ek/loaders/HDRLoader.js').then(({ HDRLoader }) => new Promise((coz) => new HDRLoader().load('/img/doku/gokyuzu_1k.hdr', (hdr) => {
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      const p = new THREE.PMREMGenerator(renderer), env = p.fromEquirectangular(hdr).texture; hdr.dispose(); p.dispose(); coz(env);
    }, undefined, () => coz(null)))).catch(() => null));
  }
  return hdrSozleri.get(renderer);
}
