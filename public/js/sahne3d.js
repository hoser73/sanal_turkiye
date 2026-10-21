// Parsel sahnesi: seçili parselin izometrik 3B maketi (three.js). 3 × 3 hücre: ortada parsel, çevresinde komşular.
// Modeller modeller.js'den gelir (haritadaki 3B katmanla aynı tanımlar). Sürükle → döndür, tekerlek/çimdik → yakınlaş.
import * as THREE from '/vendor/three/three.module.js';
import { parselParcalari, PALET } from './modeller.js';
import { gunesKonumu, isikRengi } from './gunes.js';

const S = 30;                 // bir hücre ≈ 30 m
const TOPRAK = '#a9845a', TOPRAK_KOYU = '#7b5d3d';
const ZEMIN = {
  KONUT: '#e6dccb', TICARET: '#e9d6d0', TARIM: '#b8c98a', SANAYI: '#d5d2da', TURIZM: '#cfe3df', KARMA: '#ead8c2',
  KORUMA: '#8fb07a', PARK: '#b9d6a0', SU: '#7fb6cc', YOL: '#9a958c', DIS: '#d9d2c4',
};

// Deterministik rastgele (komşu dekorları her açılışta aynı görünsün)
function tohumlu(s) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

const malzemeler = new Map();
function malzeme(renk, { saydam = false, parlak = false } = {}) {
  const k = `${renk}|${saydam}|${parlak}`;
  if (!malzemeler.has(k)) {
    malzemeler.set(k, new THREE.MeshStandardMaterial({
      color: renk, roughness: parlak ? 0.25 : 0.82, metalness: parlak ? 0.15 : 0.02,
      transparent: saydam, opacity: saydam ? 0.5 : 1, depthWrite: !saydam,
    }));
  }
  return malzemeler.get(k);
}

function tarlaDokusu(ekiliMi) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = ekiliMi ? '#9a7550' : '#b8c98a';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 16; i++) {
    g.fillStyle = ekiliMi ? (i % 2 ? '#8a6744' : '#a67f58') : (i % 2 ? '#aebf80' : '#c2d297');
    g.fillRect(0, i * 8, 128, 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

export function sahneKur() {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    return null;   // WebGL yoksa sahne gösterilmez
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.className = 'sahne3d-tuval';

  const sahne = new THREE.Scene();
  const gok = new THREE.HemisphereLight('#e3f0fb', '#c7b08a', 1.15);
  sahne.add(gok);
  const gunes = new THREE.DirectionalLight('#fff1d6', 2.1);
  gunes.position.set(40, 70, 30);
  gunes.castShadow = true;
  gunes.shadow.mapSize.set(1024, 1024);
  Object.assign(gunes.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 220 });
  gunes.shadow.bias = -0.0008;
  sahne.add(gunes);

  const kamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 600);
  const grup = new THREE.Group();
  sahne.add(grup);
  const dumanlar = [];
  let bacaUstu = { x: 0, y: 18, z: 0 };

  let aci = Math.PI / 4, egim = 0.62, olcek = 1, kendiDon = true, gorunur = false, kap = null, kare = 0, son = 0;

  function kameraGuncelle() {
    const w = kap?.clientWidth || 300, h = kap?.clientHeight || 220;
    const yari = 38 / olcek;
    kamera.left = -yari * (w / h); kamera.right = yari * (w / h); kamera.top = yari; kamera.bottom = -yari;
    kamera.updateProjectionMatrix();
    const r = 200;
    kamera.position.set(Math.cos(aci) * Math.cos(egim) * r, Math.sin(egim) * r, Math.sin(aci) * Math.cos(egim) * r);
    kamera.lookAt(0, 3, 0);
  }

  function kutu(w, h, d, renk, ops) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), malzeme(renk, ops));
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  const yerel = (ox, oz, u, v) => [ox + (u - 0.5) * S, oz + (v - 0.5) * S];

  function parcaEkle(p, ox, oz, hedef) {
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
    const cam = malzeme('#3b5566', { parlak: true });
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

  function komsuDekoru(imar, ox, oz, tohum, hedef) {
    const r = tohumlu(tohum);
    if (imar === 'KORUMA' || imar === 'PARK') {
      const adet = imar === 'KORUMA' ? 9 : 4;
      for (let i = 0; i < adet; i++) {
        const u = 0.12 + r() * 0.76, v = 0.12 + r() * 0.76, boy = 5 + r() * 6;
        parcaEkle({ tur: 'silindir', u, v, r: 0.012, taban: 0, tavan: 2, renk: PALET.govde }, ox, oz, hedef);
        parcaEkle({ tur: 'silindir', u, v, r: 0.05 + r() * 0.03, taban: 1.6, tavan: boy, renk: r() > 0.5 ? PALET.yaprak : PALET.yaprakAcik }, ox, oz, hedef);
      }
    } else if (imar === 'KONUT' || imar === 'KARMA' || imar === 'TURIZM') {
      const n = 1 + Math.floor(r() * 2);
      for (let i = 0; i < n; i++) {
        const u0 = 0.12 + i * 0.42, v0 = 0.2 + r() * 0.3;
        parcaEkle({ tur: 'kutu', alan: [u0, v0, u0 + 0.3, v0 + 0.32], taban: 0, tavan: 4 + r() * 6, renk: '#ece3d4', cati: 'kirma', catiYuksek: 2.4, catiRenk: '#b9654c' }, ox, oz, hedef);
      }
    } else if (imar === 'SANAYI' || imar === 'TICARET') {
      parcaEkle({ tur: 'kutu', alan: [0.15, 0.2, 0.85, 0.75], taban: 0, tavan: 5 + r() * 4, renk: '#cfd3d6', cati: 'duz', catiRenk: '#aab2b7' }, ox, oz, hedef);
    } else if (imar === 'TARIM') {
      for (let k = 0; k < 6; k++) parcaEkle({ tur: 'kutu', alan: [0.1, 0.12 + k * 0.13, 0.9, 0.17 + k * 0.13], taban: 0, tavan: 0.5, renk: r() > 0.5 ? '#a9c26e' : '#c9b862' }, ox, oz, hedef);
    }
  }

  function zemin(imar, ox, oz, merkezMi, ekili, hedef) {
    const renk = ZEMIN[imar] || ZEMIN.DIS;
    const kalinlik = merkezMi ? 0.6 : 0.3;
    let mat;
    if (imar === 'TARIM' && merkezMi) {
      mat = new THREE.MeshStandardMaterial({ map: tarlaDokusu(ekili), roughness: 0.95 });
    } else mat = malzeme(renk, { parlak: imar === 'SU' });
    const z = new THREE.Mesh(new THREE.BoxGeometry(S - (merkezMi ? 0.4 : 0.8), kalinlik, S - (merkezMi ? 0.4 : 0.8)), mat);
    z.position.set(ox, kalinlik / 2 - (imar === 'SU' ? 0.25 : 0), oz);
    z.receiveShadow = true;
    hedef.add(z);
    if (imar === 'YOL') {
      for (let k = -2; k <= 2; k++) {
        const s = kutu(2.4, 0.05, 0.4, '#f4efe4');
        s.position.set(ox + k * 5.5, kalinlik + 0.03, oz);
        hedef.add(s);
      }
    }
  }

  function goster(kart, hedefKap) {
    kap = hedefKap;
    if (!kap) return;
    kap.appendChild(renderer.domElement);
    renderer.setSize(kap.clientWidth, kap.clientHeight, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';

    // Önceki maketi temizle
    for (const c of [...grup.children]) {
      grup.remove(c);
      c.traverse((o) => { o.geometry?.dispose(); if (o.material?.map) { o.material.map.dispose(); o.material.dispose(); } });
    }
    dumanlar.length = 0;

    // Toprak kaidesi (maket)
    const kaide = kutu(S * 3 + 1, 5, S * 3 + 1, TOPRAK);
    kaide.position.y = -2.5;
    const alt = kutu(S * 3 + 1.4, 1.2, S * 3 + 1.4, TOPRAK_KOYU);
    alt.position.y = -5.4;
    grup.add(kaide, alt);

    const komsuImar = Object.fromEntries((kart.komsular || []).map((n) => [`${n.dx},${n.dy}`, n.imar]));
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ox = dx * S, oz = dy * S;
        if (!dx && !dy) continue;
        const imar = komsuImar[`${dx},${dy}`] || 'DIS';
        zemin(imar, ox, oz, false, false, grup);
        komsuDekoru(imar, ox, oz, `${kart.id}${dx}${dy}`, grup);
      }
    }
    const imar = kart.imar.tip;
    zemin(imar, 0, 0, true, !!kart.ekin, grup);

    // Parselin kendisi: yapılar ve ekin
    const yp = (kart.yapilar || []).map((y) => `${y.tip}:${y.durum === 'ACTIVE' ? 1 : 0}`).join(',');
    const ek = kart.ekin ? `${kart.ekin.tip}:${kart.ekin.ilerleme.toFixed(2)}` : '';
    const parsel = new THREE.Group();
    parsel.position.y = 0.6;
    const parcalar = parselParcalari(imar, yp, ek, kart.kozmetik);
    for (const p of parcalar) parcaEkle(p, 0, 0, parsel);
    grup.add(parsel);
    // Sahip çerçevesi (altın)
    if (kart.sahip?.ben) {
      const cerceve = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(S - 0.2, 0.7, S - 0.2)), new THREE.LineBasicMaterial({ color: '#e7b53a' }));
      cerceve.position.y = 0.35;
      grup.add(cerceve);
    }
    // Fabrika dumanı: bacanın tepesinden
    const baca = parcalar.find((p) => p.baca && !p.insaat);
    if (baca) {
      const [bx, bz] = yerel(0, 0, baca.u, baca.v);
      bacaUstu = { x: bx, y: baca.tavan + 1.2, z: bz };
      for (let i = 0; i < 6; i++) {
        const d = new THREE.Mesh(new THREE.IcosahedronGeometry(1.2, 0), new THREE.MeshStandardMaterial({ color: '#eceae6', transparent: true, opacity: 0.6, roughness: 1 }));
        d.userData.faz = i / 6;
        grup.add(d);
        dumanlar.push(d);
      }
    }
    kameraGuncelle();
    ciz();
  }

  function ciz() {
    renderer.render(sahne, kamera);
  }

  // Güneş: parselin gerçek konumu ve şimdiki saate göre yön, yükseklik ve renk (gece loş, alacakaranlık turuncu)
  function gunesAyarla(konum) {
    if (!konum) return;
    const g = gunesKonumu(konum.lon, konum.lat);
    const i = isikRengi(g.yukseklik);
    const az = g.azimut * Math.PI / 180, yk = Math.max(8, g.yukseklik) * Math.PI / 180;
    // Sahne: +x doğu, -z kuzey
    gunes.position.set(Math.sin(az) * Math.cos(yk) * 90, Math.sin(yk) * 90, -Math.cos(az) * Math.cos(yk) * 90);
    gunes.color.set(i.renk);
    gunes.intensity = 2.3 * i.siddet;
    gok.color.set(i.gok);
    gok.intensity = 0.55 + 0.6 * i.siddet;
    renderer.toneMappingExposure = 0.8 + 0.25 * i.siddet;
  }

  function dongu(t) {
    kare = requestAnimationFrame(dongu);
    if (!gorunur || document.hidden) return;
    const dt = Math.min(0.05, (t - son) / 1000 || 0);
    son = t;
    if (kendiDon) { aci += dt * 0.12; kameraGuncelle(); }
    for (const d of dumanlar) {
      d.userData.faz = (d.userData.faz + dt * 0.25) % 1;
      const f = d.userData.faz;
      d.position.set(bacaUstu.x + f * 3, bacaUstu.y + f * 12, bacaUstu.z - f * 2);
      d.scale.setScalar(0.6 + f * 1.8);
      d.material.opacity = 0.65 * (1 - f);
    }
    ciz();
  }
  kare = requestAnimationFrame(dongu);

  // Görünürlük: sahne ekranda değilse çizme
  const gozcu = new IntersectionObserver((g) => { gorunur = g.some((x) => x.isIntersecting); });
  const izle = () => { gozcu.disconnect(); if (kap) gozcu.observe(kap); };

  // Etkileşim: sürükle-döndür, tekerlek/çimdik yakınlaştır
  let surukle = null;
  const el = renderer.domElement;
  el.addEventListener('pointerdown', (e) => { surukle = { x: e.clientX, y: e.clientY, aci, egim }; kendiDon = false; el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointermove', (e) => {
    if (!surukle) return;
    aci = surukle.aci + (e.clientX - surukle.x) * 0.01;
    egim = Math.min(1.3, Math.max(0.28, surukle.egim + (e.clientY - surukle.y) * 0.006));
    kameraGuncelle();
  });
  el.addEventListener('pointerup', () => { surukle = null; });
  el.addEventListener('wheel', (e) => { e.preventDefault(); olcek = Math.min(2.2, Math.max(0.7, olcek * (e.deltaY < 0 ? 1.1 : 0.9))); kameraGuncelle(); }, { passive: false });
  el.addEventListener('dblclick', () => { kendiDon = true; });
  window.addEventListener('resize', () => { if (kap) { renderer.setSize(kap.clientWidth, kap.clientHeight, false); kameraGuncelle(); } });

  return {
    goster(kart, hedefKap) { gunesAyarla(kart?.konum); goster(kart, hedefKap); izle(); },
    kendiliginden(acik) { kendiDon = acik; },
    // Fotoğraf: çizimden hemen sonra tuvali oku (preserveDrawingBuffer gerekmez); 2× çözünürlük
    fotograf() {
      const eski = renderer.getPixelRatio();
      renderer.setPixelRatio(2);
      renderer.setSize(kap.clientWidth, kap.clientHeight, false);
      ciz();
      const url = renderer.domElement.toDataURL('image/png');
      renderer.setPixelRatio(eski);
      renderer.setSize(kap.clientWidth, kap.clientHeight, false);
      ciz();
      return url;
    },
    yokEt() { cancelAnimationFrame(kare); gozcu.disconnect(); renderer.dispose(); },
  };
}
