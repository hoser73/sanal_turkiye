// Parsel sahnesi: seçili parselin izometrik 3B maketi (three.js). 3 × 3 hücre: ortada parsel, çevresinde komşular.
// Modeller modeller.js'den gelir (haritadaki 3B katmanla aynı tanımlar). Sürükle → döndür, tekerlek/çimdik → yakınlaş.
import * as THREE from '/vendor/three/three.module.js';
import { parselParcalari, PALET } from './modeller.js';
import { S, tohumlu, malzeme, kutu, yerel, parcaEkle } from './model3d.js';
import { dokuCiz } from './ciftlik-doku.js';
import { gunesKonumu, isikRengi } from './gunes.js';
import { parselModeli, komsuModeli, kaideDokusu, gokIsigi } from './parsel3d.js';

const TOPRAK = '#a9845a', TOPRAK_KOYU = '#7b5d3d';
const ZEMIN = {
  KONUT: '#e6dccb', TICARET: '#e9d6d0', TARIM: '#b8c98a', SANAYI: '#d5d2da', TURIZM: '#cfe3df', KARMA: '#ead8c2',
  KORUMA: '#8fb07a', PARK: '#b9d6a0', SU: '#7fb6cc', YOL: '#9a958c', DIS: '#d9d2c4',
};

const dokular = new Map();
function ciftlikDokusu(ad, tekrar) {
  const k = `${ad}|${tekrar}`;
  if (!dokular.has(k)) {
    const t = new THREE.CanvasTexture(dokuCiz(ad, 2));
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(tekrar, tekrar); t.colorSpace = THREE.SRGBColorSpace;
    dokular.set(k, t);
  }
  return dokular.get(k);
}

export function sahneKur() {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch {
    return null;   // WebGL yoksa sahne gösterilmez
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;   // r180+: PCFSoftShadowMap kaldırıldı
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.className = 'sahne3d-tuval';

  const sahne = new THREE.Scene();
  gokIsigi(renderer).then((env) => { if (env) { sahne.environment = env; sahne.environmentIntensity = 0.55; ciz(); } });
  const gok = new THREE.HemisphereLight('#e3f0fb', '#c7b08a', 1.15);
  sahne.add(gok);
  const gunes = new THREE.DirectionalLight('#fff1d6', 2.1);
  gunes.position.set(40, 70, 30);
  gunes.castShadow = true;
  gunes.shadow.mapSize.set(2048, 2048);
  gunes.shadow.normalBias = 0.04;
  Object.assign(gunes.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 220 });
  gunes.shadow.bias = -0.0008;
  sahne.add(gunes);

  const kamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 600);
  const grup = new THREE.Group();
  sahne.add(grup);
  const dumanlar = [];
  const kaideD = kaideDokusu();
  let gece = 0;
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

  function komsuDekoru(imar, ox, oz, tohum, hedef) {
    const ayrintili = komsuModeli(imar, tohum, gece);
    if (ayrintili) { ayrintili.position.set(ox, imar === 'TARIM' ? 0.3 : 0.3, oz); hedef.add(ayrintili); return; }
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
    // Çiftlik dokuları: tarım parseli sürülmüş toprak, çevre çimenli; su ve yol düz renk
    let mat;
    if (imar === 'TARIM' && merkezMi) mat = new THREE.MeshStandardMaterial({ map: ciftlikDokusu(ekili ? 'doku-toprak' : 'doku-ekin', 4), roughness: 0.95 });
    else if (imar === 'SU' || imar === 'YOL') mat = malzeme(renk, { parlak: imar === 'SU' });
    else mat = new THREE.MeshStandardMaterial({ map: ciftlikDokusu(imar === 'KONUT' || imar === 'KARMA' || imar === 'TICARET' ? 'doku-avlu' : 'doku-cimen', 2), roughness: 0.95, color: merkezMi ? '#ffffff' : '#e6e6e6' });
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
      c.traverse((o) => { if (o.isInstancedMesh) o.dispose(); if (o.userData.paylasimli) return; o.geometry?.dispose(); });
    }
    dumanlar.length = 0;

    // Toprak kaidesi (maket)
    const kaideMalz = new THREE.MeshStandardMaterial({ map: kaideD, roughness: 0.95 }), kaideUst = malzeme(TOPRAK);
    const kaide = new THREE.Mesh(new THREE.BoxGeometry(S * 3 + 1, 5, S * 3 + 1), [kaideMalz, kaideMalz, kaideUst, kaideUst, kaideMalz, kaideMalz]);
    kaide.receiveShadow = true; kaide.userData.paylasimli = true;
    kaide.position.y = -2.5;
    const alt = kutu(S * 3 + 1.4, 1.2, S * 3 + 1.4, '#3a2a1c');
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
    const ss = (kart.susler || []).map((s) => `${s.tur}:${s.yuva}`).join(',');
    const parcalar = parselParcalari(imar, yp, ek, kart.kozmetik, ss);   // yalnızca baca yeri için
    parsel.add(parselModeli({ id: kart.id, imar, yp, ek, kz: kart.kozmetik, ss }, { ayrinti: 1, gece }));
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
    gece = g.yukseklik < -2 ? 1 : 0;
    const az = g.azimut * Math.PI / 180, yk = Math.max(8, g.yukseklik) * Math.PI / 180;
    // Sahne: +x doğu, -z kuzey
    gunes.position.set(Math.sin(az) * Math.cos(yk) * 90, Math.sin(yk) * 90, -Math.cos(az) * Math.cos(yk) * 90);
    gunes.color.set(i.renk);
    gunes.intensity = 0.5 + 1.9 * i.siddet;
    gok.color.set(i.siddet < 0.35 ? '#9fb3d9' : i.gok);
    gok.intensity = 1.0 + 0.3 * i.siddet;   // gece ay ışığı: maket karanlıkta da okunur
    renderer.toneMappingExposure = 0.95 + 0.15 * i.siddet;
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
