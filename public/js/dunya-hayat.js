// Hayat: OSM yollarında sağdan akan araçlar (gece farları yanar), gökte süzülen kuş sürüleri (kıyıda martı),
// çayırlarda otlayan koyun ve inek sürüleri. Hepsi görünür alana göre kurulur, kare kare canlandırılır.
import * as THREE from '/vendor/three/three.module.js';
import { birlestir, tohumlu, icindeMi, kaldir } from './dunya-ortak.js';

const ARABA_RENK = ['#f4f4f2', '#f4f4f2', '#d8dadc', '#1f2326', '#9a1f1f', '#2b4c7e', '#8a8f94', '#f2c230', '#5a6b3c', '#c65b26'];
const HIZ = { motorway: 27, trunk: 24, primary: 18, secondary: 15, tertiary: 13, minor: 10, service: 7 };

function arabaGeo() {
  const kutu = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  return birlestir([
    { geo: kutu(1.8, 0.75, 4.3), renk: '#ffffff', yer: [0, 0.62, 0] },
    { geo: kutu(1.62, 0.6, 2.2), renk: '#d9d9d9', yer: [0, 1.25, 0.25] },
    { geo: kutu(1.64, 0.48, 2.0), renk: '#3a4652', yer: [0, 1.22, 0.25] },   // camlar
    ...[[-0.8, 1.35], [0.8, 1.35], [-0.8, -1.35], [0.8, -1.35]].map(([x, z]) => ({ geo: new THREE.CylinderGeometry(0.33, 0.33, 0.24, 8).rotateZ(Math.PI / 2), renk: '#1b1b1b', yer: [x, 0.33, z] })),
  ]);
}
function farGeo() {
  // Ön farlar (sarımsı beyaz) ve stop lambaları (kırmızı): gece ışık saçan küçük kutular
  return birlestir([
    { geo: new THREE.BoxGeometry(0.4, 0.2, 0.08), renk: '#fff2c4', yer: [-0.6, 0.72, -2.17] },
    { geo: new THREE.BoxGeometry(0.4, 0.2, 0.08), renk: '#fff2c4', yer: [0.6, 0.72, -2.17] },
    { geo: new THREE.BoxGeometry(0.35, 0.16, 0.08), renk: '#ff2a1a', yer: [-0.62, 0.78, 2.17] },
    { geo: new THREE.BoxGeometry(0.35, 0.16, 0.08), renk: '#ff2a1a', yer: [0.62, 0.78, 2.17] },
    // yola düşen far ışığı
    { geo: new THREE.CircleGeometry(2.4, 10).rotateX(-Math.PI / 2), renk: '#5b4a22', yer: [0, 0.08, -5.2], olcek: [1, 1, 1.8] },
  ]);
}
function kusGeo() {
  const g = new THREE.BufferGeometry();
  // Kanatlar: iki ince üçgen; y ölçeği kanat çırpmayı verir
  const p = [0, 0, -0.4, -1.1, 0.35, 0.15, 0, 0, 0.35, 0, 0, -0.4, 0, 0, 0.35, 1.1, 0.35, 0.15];
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(18).fill(1), 3));
  g.computeVertexNormals();
  return g;
}
function hayvanGeo() {
  const ico = (r) => new THREE.IcosahedronGeometry(r, 1);
  const bacak = (x, z) => ({ geo: new THREE.BoxGeometry(0.14, 0.55, 0.14), renk: '#2b2622', yer: [x, 0.28, z] });
  return birlestir([
    { geo: ico(0.62), renk: '#ffffff', yer: [0, 0.92, 0], olcek: [0.85, 0.72, 1.25] },
    { geo: new THREE.BoxGeometry(0.34, 0.38, 0.5), renk: '#3a332d', yer: [0, 1.12, -0.9] },
    bacak(-0.28, -0.45), bacak(0.28, -0.45), bacak(-0.28, 0.45), bacak(0.28, 0.45),
  ]);
}

// Çoklu çizgi yolu: yükseklikli noktalar ve kümülatif uzunluk
function yolHazirla(noktalar, ctx) {
  const yol = [];
  for (let i = 0; i < noktalar.length; i++) {
    const [x, z] = noktalar[i];
    if (i > 0) {
      const [px, pz] = noktalar[i - 1];
      const L = Math.hypot(x - px, z - pz), n = Math.floor(L / 18);
      for (let k = 1; k <= n; k++) { const t = k / (n + 1); yol.push([px + (x - px) * t, pz + (z - pz) * t]); }
    }
    yol.push([x, z]);
  }
  let s = 0;
  return yol.map(([x, z], i) => {
    if (i) s += Math.hypot(x - yol[i - 1][0], z - yol[i - 1][1]);
    return { x, z, y: ctx.yukseklik(x, z), s };
  });
}

export function hayatKur(ctx) {
  const { sahne, ortak } = ctx;
  const govdeMalz = new THREE.MeshLambertMaterial({ vertexColors: true });
  const hayvanMalz = new THREE.MeshLambertMaterial({ vertexColors: true });
  const farMalz = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const kusMalz = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const geo = { araba: arabaGeo(), far: farGeo(), kus: kusGeo(), hayvan: hayvanGeo() };
  let nesneler = [], arabalar = [], suruler = [], hayvanlar = [], kuslar = [];
  let arabaMesh = null, farMesh = null, kusMesh = null, hayvanMesh = null;

  function temizle() { kaldir(sahne, nesneler); nesneler = []; arabalar = []; suruler = []; hayvanlar = []; kuslar = []; arabaMesh = farMesh = kusMesh = hayvanMesh = null; }
  const ekle = (m) => { m.frustumCulled = false; m.userData.paylasimli = true; sahne.add(m); nesneler.push(m); return m; };

  function kur(alan) {
    temizle();
    if (alan.zoom < 14.3 || !ctx.hareket()) return;   // hareketli öğeler kapalıysa hiç kurulmaz
    const ayar = ctx.ayar();
    const R = Math.min(alan.yaricap, 1600);
    const rnd = tohumlu(Math.round(ctx.cografi(0, 0)[0] * 1e4));

    // ---- Araçlar
    const yollar = [];
    for (const f of alan.oku('transportation', ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service'], true, false])) {
      if (f.properties.brunnel === 'tunnel') continue;
      const cizgiler = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [];
      for (const c of cizgiler) {
        const n = c.map(([lng, lat]) => ctx.yerel(lng, lat)).filter(([x, z]) => Math.hypot(x, z) < R);
        if (n.length < 2) continue;
        const y = yolHazirla(n, ctx);
        const uz = y.at(-1).s;
        if (uz < 40) continue;
        yollar.push({ n: y, uz, hiz: HIZ[f.properties.class] || 10, sinif: f.properties.class, tekYon: f.properties.oneway === 1 });
      }
    }
    const toplamUz = yollar.reduce((t, y) => t + y.uz * (y.sinif === 'service' ? 0.3 : 1), 0);
    const adet = Math.min(ayar.araba, Math.round(toplamUz / 140));
    if (adet > 0) {
      for (let i = 0; i < adet; i++) {
        // Uzun ve büyük yollar daha çok araç alır
        let hedef = rnd() * toplamUz, yol = yollar[0];
        for (const y of yollar) { hedef -= y.uz * (y.sinif === 'service' ? 0.3 : 1); if (hedef <= 0) { yol = y; break; } }
        arabalar.push({ yol, s: rnd() * yol.uz, yon: yol.tekYon ? 1 : (rnd() < 0.5 ? 1 : -1), hiz: yol.hiz * (0.8 + rnd() * 0.4), i: 0 });
      }
      arabaMesh = ekle(new THREE.InstancedMesh(geo.araba, govdeMalz, adet));
      arabalar.forEach((a, i) => arabaMesh.setColorAt(i, new THREE.Color(ARABA_RENK[Math.floor(rnd() * ARABA_RENK.length)])));
      arabaMesh.instanceColor.needsUpdate = true;
      farMesh = ekle(new THREE.InstancedMesh(geo.far, farMalz, adet));
      farMesh.instanceMatrix = arabaMesh.instanceMatrix;   // farlar govdeyle aynı konumda
    }

    // ---- Kuşlar: kıyıda beyaz martı, içeride koyu sığırcık / karga sürüsü
    const suVar = alan.oku('water').length > 0;
    const surular = ayar.kus || 0;
    if (surular) {
      const toplam = surular * 14;
      kusMesh = ekle(new THREE.InstancedMesh(geo.kus, kusMalz, toplam));
      for (let k = 0; k < surular; k++) {
        const merkezX = (rnd() - 0.5) * R * 0.9, merkezZ = (rnd() - 0.5) * R * 0.9;
        const taban = ctx.yukseklik(merkezX, merkezZ);
        const suru = { x: merkezX, z: merkezZ, y: taban + 60 + rnd() * 70, r: 70 + rnd() * 110, hiz: (0.12 + rnd() * 0.1) * (rnd() < 0.5 ? 1 : -1), faz: rnd() * 6.28 };
        for (let i = 0; i < 14; i++) {
          kuslar.push({ suru, dx: (rnd() - 0.5) * 34, dy: (rnd() - 0.5) * 12, dz: (rnd() - 0.5) * 34, kanat: rnd() * 6.28, kanatHiz: 9 + rnd() * 5, olcek: suVar ? 1.25 : 0.8 });
          kusMesh.setColorAt(k * 14 + i, new THREE.Color(suVar ? '#f4f5f6' : '#2a2a2e'));
        }
      }
      kusMesh.instanceColor.needsUpdate = true;
    }

    // ---- Sürüler: çayır ve otlaklarda
    const otlak = alan.poligonlar('landcover', ['match', ['get', 'class'], ['grass'], true, false])
      .concat(alan.poligonlar('landuse', ['match', ['get', 'class'], ['farmland', 'meadow'], true, false]));
    const hedefHayvan = ayar.koyun || 0;
    if (otlak.length && hedefHayvan) {
      const adaylar = otlak.filter((p) => { const [x0, z0, x1, z1] = p.kutu; return Math.hypot((x0 + x1) / 2, (z0 + z1) / 2) < R * 0.8 && (x1 - x0) * (z1 - z0) > 2500; });
      for (let deneme = 0; deneme < 40 && hayvanlar.length < hedefHayvan && adaylar.length; deneme++) {
        const p = adaylar[Math.floor(rnd() * adaylar.length)];
        const [x0, z0, x1, z1] = p.kutu;
        const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0);
        if (!icindeMi(x, z, p.halkalar)) continue;
        const inek = rnd() < 0.3;
        const suru = { x, z, poligon: p, inek };
        suruler.push(suru);
        const n = inek ? 4 + Math.floor(rnd() * 5) : 8 + Math.floor(rnd() * 10);
        for (let i = 0; i < n && hayvanlar.length < hedefHayvan; i++) {
          const ax = x + (rnd() - 0.5) * 22, az = z + (rnd() - 0.5) * 22;
          hayvanlar.push({ suru, x: ax, z: az, aci: rnd() * 6.28, hedefAci: rnd() * 6.28, hiz: 0, bekle: rnd() * 6, olcek: inek ? 2.1 : 1,
            renk: inek ? ['#5a3b26', '#2b2522', '#e8e2d8', '#8a5a36'][Math.floor(rnd() * 4)] : ['#f3efe6', '#ece6da', '#e2dccf', '#3a3530'][rnd() < 0.08 ? 3 : Math.floor(rnd() * 3)] });
        }
      }
      if (hayvanlar.length) {
        hayvanMesh = ekle(new THREE.InstancedMesh(geo.hayvan, hayvanMalz, hayvanlar.length));
        hayvanlar.forEach((h, i) => hayvanMesh.setColorAt(i, new THREE.Color(h.renk)));
        hayvanMesh.instanceColor.needsUpdate = true;
      }
    }
    kare(0, alan.zoom);
  }

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), yukari = new THREE.Vector3(0, 1, 0), e = new THREE.Euler();
  function konum(a) {
    const n = a.yol.n;
    // Bulunduğu parçayı ilerlet / gerilet
    while (a.i < n.length - 2 && n[a.i + 1].s < a.s) a.i++;
    while (a.i > 0 && n[a.i].s > a.s) a.i--;
    const p0 = n[a.i], p1 = n[a.i + 1];
    const t = Math.min(1, Math.max(0, (a.s - p0.s) / ((p1.s - p0.s) || 1)));
    let dx = (p1.x - p0.x) * a.yon, dz = (p1.z - p0.z) * a.yon;
    const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    // Sağ şerit: gidiş yönünün sağı
    const serit = a.yol.sinif === 'motorway' || a.yol.sinif === 'trunk' ? 3.2 : 1.7;
    return { x: p0.x + (p1.x - p0.x) * t - dz * serit, y: p0.y + (p1.y - p0.y) * t, z: p0.z + (p1.z - p0.z) * t + dx * serit, aci: Math.atan2(-dx, -dz) };
  }

  function kare(dt, zoom) {
    if (!nesneler.length) return false;
    const zaman = ortak.zaman.value;
    if (arabaMesh) {
      for (let i = 0; i < arabalar.length; i++) {
        const a = arabalar[i];
        a.s += a.hiz * dt * a.yon;
        if (a.s > a.yol.uz || a.s < 0) {
          if (a.yol.tekYon) a.s = a.s > a.yol.uz ? 0 : a.yol.uz;
          else { a.yon *= -1; a.s = Math.min(a.yol.uz, Math.max(0, a.s)); }
        }
        const k = konum(a);
        m4.compose(v.set(k.x, k.y + 0.05, k.z), q.setFromAxisAngle(yukari, k.aci), s.set(1, 1, 1));
        arabaMesh.setMatrixAt(i, m4);
      }
      arabaMesh.instanceMatrix.needsUpdate = true;
      farMalz.opacity = Math.min(1, (ortak.gece ?? 0) * 1.6);
      farMesh.visible = farMalz.opacity > 0.05;
    }
    if (kusMesh) {
      kuslar.forEach((k, i) => {
        const su = k.suru, a = su.faz + zaman * su.hiz;
        const x = su.x + Math.cos(a) * su.r + k.dx + Math.sin(zaman * 0.7 + k.dz) * 4;
        const z = su.z + Math.sin(a) * su.r + k.dz + Math.cos(zaman * 0.6 + k.dx) * 4;
        const cirp = Math.sin(zaman * k.kanatHiz + k.kanat);
        const yon = Math.sign(su.hiz);   // uçuş yönü: çemberin teğeti (−sin a, cos a); model −z'ye bakar
        e.set(0, Math.atan2(Math.sin(a) * yon, -Math.cos(a) * yon), 0);
        m4.compose(v.set(x, su.y + k.dy + Math.sin(zaman + k.kanat) * 2, z), q.setFromEuler(e), s.set(k.olcek, k.olcek * cirp, k.olcek));
        kusMesh.setMatrixAt(i, m4);
      });
      kusMesh.instanceMatrix.needsUpdate = true;
    }
    if (hayvanMesh) {
      hayvanlar.forEach((h, i) => {
        h.bekle -= dt;
        if (h.bekle <= 0) {
          // Otla ya da birkaç adım yürü; sürüden uzaklaşma
          const uzak = Math.hypot(h.x - h.suru.x, h.z - h.suru.z) > 18;
          h.hedefAci = uzak ? Math.atan2(h.suru.x - h.x, h.suru.z - h.z) : h.aci + (Math.random() - 0.5) * 2;
          h.hiz = Math.random() < 0.45 ? 0.5 + Math.random() * 0.5 : 0;
          h.bekle = 2 + Math.random() * 6;
        }
        h.aci += Math.sin(h.hedefAci - h.aci) * Math.min(1, dt * 2);
        if (h.hiz) {
          const nx = h.x + Math.sin(h.aci) * h.hiz * dt * h.olcek, nz = h.z + Math.cos(h.aci) * h.hiz * dt * h.olcek;
          if (icindeMi(nx, nz, h.suru.poligon.halkalar)) { h.x = nx; h.z = nz; } else h.hedefAci += Math.PI;
        }
        const zip = h.hiz ? Math.abs(Math.sin(zaman * 8 + i)) * 0.06 : 0;
        // model −z yönüne bakar; açı +z'ye göre
        m4.compose(v.set(h.x, ctx.yukseklik(h.x, h.z) + zip, h.z), q.setFromAxisAngle(yukari, h.aci + Math.PI), s.setScalar(h.olcek));
        hayvanMesh.setMatrixAt(i, m4);
      });
      hayvanMesh.instanceMatrix.needsUpdate = true;
    }
    return zoom >= 14.3;
  }

  return { kur, temizle, kare };
}
