// Bulutlar: il ve ilçe ölçeğinde (yakınlaştırma ~9.5–14.8) gökyüzünde süzülen alçak poligonlu kümülüsler.
// Örtü oranı ve rengi en yakın ilin gerçek havasından (WMO kodu), sürüklenme rüzgârdan gelir (hızlandırılmış zaman).
// Yere yumuşak bulut gölgesi düşer. Parsel ölçeğine inerken kamera bulutların altına geçer: bulutlar söner.
import * as THREE from '/vendor/three/three.module.js';
import { tohumlu, golgeDokusu, kaldir } from './dunya-ortak.js';

const ZAMAN_HIZI = 30;   // sürüklenme görünsün diye

function bulutGeo(tohum) {
  // Yuvarlak (yumuşak normalli) küreler: ayrıntı düzeyi > 0 olan ikosahedronlar küre normali taşır
  const r = tohumlu(tohum);
  const kureler = [];
  const n = 7 + Math.floor(r() * 5);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.6, d = 0.35 + r() * 0.55;
    kureler.push({ r: 0.42 + r() * 0.45, x: Math.cos(a) * d, y: 0.05 + r() * 0.25, z: Math.sin(a) * d * 0.7 });
  }
  kureler.push({ r: 0.72, x: 0, y: 0.35, z: 0 });
  const konum = [], normal = [], renk = [];
  const alt = new THREE.Color('#c3ccd6'), ust = new THREE.Color('#ffffff'), t = new THREE.Color();
  for (const k of kureler) {
    const g = new THREE.IcosahedronGeometry(k.r, 2);
    const p = g.attributes.position, nn = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      let y = p.getY(i) + k.y;
      let ny = nn.getY(i);
      if (y < 0) { y *= 0.25; ny = Math.min(ny, -0.6); }   // düz taban
      konum.push(p.getX(i) + k.x, y, p.getZ(i) + k.z);
      normal.push(nn.getX(i), ny, nn.getZ(i));
      t.copy(alt).lerp(ust, Math.min(1, Math.max(0, (y + 0.05) / 0.8)));
      renk.push(t.r, t.g, t.b);
    }
    g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(konum, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(renk, 3));
  g.normalizeNormals();
  return g;
}

// WMO hava kodu → bulut örtüsü (0..1) ve ton
function ortu(h) {
  if (!h) return { oran: 0.35, ton: '#ffffff' };
  const k = h.kod ?? 1;
  if (k === 0) return { oran: 0.12, ton: '#ffffff' };
  if (k === 1) return { oran: 0.3, ton: '#ffffff' };
  if (k === 2) return { oran: 0.55, ton: '#f6f8fa' };
  if (k === 3) return { oran: 0.9, ton: '#dfe4ea' };
  if (k === 45 || k === 48) return { oran: 0.7, ton: '#e6e9ec' };
  if (k >= 95) return { oran: 1, ton: '#8d96a2' };
  if (k >= 51) return { oran: 1, ton: '#b3bcc6' };
  return { oran: 0.4, ton: '#ffffff' };
}

export function bulutKur(ctx) {
  const { sahne, ortak } = ctx;
  const geolar = [bulutGeo(11), bulutGeo(23), bulutGeo(37)];
  const malzeme = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0, emissive: '#a7b6c8', emissiveIntensity: 0.55 });
  const golgeMalzeme = new THREE.MeshBasicMaterial({ color: '#0a1420', alphaMap: golgeDokusu(), transparent: true, opacity: 0, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const golgeGeo = new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2);
  let meshler = [], golgeMesh = null, bulutlar = [], Rb = 0, nesneler = [], mx = 0, mz = 0;

  function temizle() { kaldir(sahne, nesneler); nesneler = []; meshler = []; golgeMesh = null; bulutlar = []; }

  function enYakinHava() {
    const [lng, lat] = ctx.cografi(0, 0);
    let en = null, d = Infinity;
    for (const h of ortak.hava || []) { const x = (h.lon - lng) ** 2 + (h.lat - lat) ** 2; if (x < d) { d = x; en = h; } }
    return d < 2 ? en : null;
  }

  function kur(alan) {
    temizle();
    if (alan.zoom < 9.3 || alan.zoom > 14.9) return;
    const ayar = ctx.ayar();
    const h = enYakinHava();
    const { oran, ton } = ortu(h);
    if (h?.ruzgar != null) ortak.ruzgar.hiz = h.ruzgar;
    // Bulut alanı: kameranın baktığı yöne kaydırılmış daire (görünmeyen arkaya bulut harcanmaz)
    Rb = Math.min(26000, Math.max(5000, alan.gorus * 0.42));
    const yon = (ctx.map.getBearing() * Math.PI) / 180, ileri = Rb * 0.45 * Math.min(1, ctx.map.getPitch() / 45);
    mx = Math.sin(yon) * ileri; mz = -Math.cos(yon) * ileri;
    const adet = Math.round((ayar.bulut || 0) * oran);
    if (!adet) return;
    const rnd = tohumlu(Math.round(ctx.cografi(0, 0)[1] * 1e3) + 7);
    const renk = new THREE.Color(ton);
    for (let i = 0; i < adet; i++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * Rb;
      const x = mx + Math.cos(a) * d, z = mz + Math.sin(a) * d;
      const boy = (Rb / 12) * (0.35 + rnd() * 0.75);
      bulutlar.push({ x, z, y: ctx.yukseklik(x, z) + 1700 + rnd() * 900, boy, v: Math.floor(rnd() * 3), don: rnd() * 6.28, yer: 0 });
    }
    for (let v = 0; v < 3; v++) {
      const liste = bulutlar.filter((b) => b.v === v);
      if (!liste.length) { meshler.push(null); continue; }
      const m = new THREE.InstancedMesh(geolar[v], malzeme, liste.length);
      m.frustumCulled = false; m.userData.paylasimli = true;
      liste.forEach((b, i) => { b.i = i; m.setColorAt(i, renk); });
      m.instanceColor.needsUpdate = true;
      sahne.add(m); nesneler.push(m); meshler.push(m);
    }
    golgeMesh = new THREE.InstancedMesh(golgeGeo, golgeMalzeme, bulutlar.length);
    golgeMesh.frustumCulled = false; golgeMesh.userData.paylasimli = true; golgeMesh.renderOrder = -2;
    sahne.add(golgeMesh); nesneler.push(golgeMesh);
    kare(0, alan.zoom);
  }

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(), yukari = new THREE.Vector3(0, 1, 0);
  function kare(dt, zoom) {
    if (!bulutlar.length) return false;
    // Yakınlaştırmaya göre görünürlük: il ölçeğinde belirir, parsel ölçeğine inerken söner
    const gor = Math.min(1, Math.max(0, (zoom - 9.4) / 0.9)) * Math.min(1, Math.max(0, (14.8 - zoom) / 1.1));
    malzeme.opacity = 0.93 * gor;
    const isik = ctx.isik();
    golgeMalzeme.opacity = 0.22 * gor * Math.min(1, (isik.gun ?? 1) * 1.3);
    for (const m of meshler) if (m) m.visible = gor > 0.01;
    golgeMesh.visible = golgeMalzeme.opacity > 0.01;
    if (gor <= 0.01) return false;
    if (!ctx.hareket()) dt = 0;   // hareketli öğeler kapalı: bulutlar yerinde durur
    const yon = ((ortak.ruzgar?.yon ?? 250) + 180) * Math.PI / 180;   // rüzgârın estiği yöne
    const hiz = ((ortak.ruzgar?.hiz ?? 12) / 3.6) * ZAMAN_HIZI;
    const vx = Math.sin(yon) * hiz, vz = -Math.cos(yon) * hiz;
    const gunesYk = Math.max(10, isik.yukseklik ?? 45) * Math.PI / 180, gunesAz = (isik.azimut ?? 200) * Math.PI / 180;
    const kayma = 1 / Math.tan(gunesYk);
    for (let j = 0; j < bulutlar.length; j++) {
      const b = bulutlar[j];
      b.x += vx * dt; b.z += vz * dt;
      // Alanın dışına çıkan bulut rüzgârın geldiği taraftan yeniden girer
      if (Math.hypot(b.x - mx, b.z - mz) > Rb * 1.05) { b.x = mx - (b.x - mx) * 0.98; b.z = mz - (b.z - mz) * 0.98; }
      const m = meshler[b.v];
      m4.compose(v3.set(b.x, b.y, b.z), q.setFromAxisAngle(yukari, b.don), s3.set(b.boy, b.boy * 0.62, b.boy));
      m.setMatrixAt(b.i, m4);
      const yer = ctx.yukseklik(b.x, b.z), yuk = b.y - yer;
      m4.compose(v3.set(b.x - Math.sin(gunesAz) * yuk * kayma, yer + 4, b.z + Math.cos(gunesAz) * yuk * kayma), q.identity(), s3.set(b.boy * 0.9, 1, b.boy * 0.75));
      golgeMesh.setMatrixAt(j, m4);
    }
    for (const m of meshler) if (m) m.instanceMatrix.needsUpdate = true;
    golgeMesh.instanceMatrix.needsUpdate = true;
    return ctx.hareket();
  }

  return { kur, temizle, kare };
}
