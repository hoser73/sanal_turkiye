// Sevimli maketin canlılığı: yürüyüp iş yapan çiftçi, dolaşan ve otlayan hayvanlar, uçuşan kelebekler, gökte süzülen
// bulutların yumuşak gölgeleri ve dokununca tepkiler (zıplama, "+N", uçuşan ürünler, parıltı). Tepkiler yalnızca
// görseldir; oyun eylemleri paneldeki düğmelerden yapılır.
import * as THREE from '/vendor/three/three.module.js';
import { malz, kureGeo } from './sevimli3d.js';

const yumusak = (t) => t * t * (3 - 2 * t);

// Yazı ve yıldız dokuları (bir kez çizilir)
const dokular = new Map();
function yaziDokusu(metin, renk = '#ffffff', kenar = '#5b2a7a') {
  const k = `${metin}|${renk}`;
  if (!dokular.has(k)) {
    const c = document.createElement('canvas'); c.width = 160; c.height = 80; const x = c.getContext('2d');
    x.font = '800 54px "Baloo 2", "Lilita One", system-ui'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineWidth = 12; x.lineJoin = 'round'; x.strokeStyle = kenar; x.strokeText(metin, 80, 42); x.fillStyle = renk; x.fillText(metin, 80, 42);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; dokular.set(k, t);
  }
  return dokular.get(k);
}
function yildizDokusu() {
  if (!dokular.has('yildiz')) {
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,236,150,.9)'); g.addColorStop(1, 'rgba(255,220,100,0)');
    x.fillStyle = g; x.beginPath();
    for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4, r = i % 2 ? 9 : 32; x.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); }
    x.fill();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; dokular.set('yildiz', t);
  }
  return dokular.get('yildiz');
}

// ---------- Kelebek: iki kanat çırpar, yumuşak eğrilerde uçar
function kelebek(renk) {
  const g = new THREE.Group(), kanatlar = [];
  const geo = new THREE.CircleGeometry(0.32, 10).scale(1, 0.75, 1).translate(0.3, 0, 0).rotateX(-Math.PI / 2);
  for (const y of [1, -1]) {
    const k = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: renk, side: THREE.DoubleSide }));
    k.scale.x = y; g.add(k); kanatlar.push(k);
  }
  const govde = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.3, 2, 6).rotateX(Math.PI / 2), malz('#3a2a20'));
  g.add(govde);
  g.userData.kanatlar = kanatlar;
  return g;
}
// ---------- Bulut: gölgesi zemine düşer, kendisi görünmez (kamera üstten bakar, bulut kadraj dışında kalır)
function bulut() {
  const g = new THREE.Group(), m = new THREE.MeshLambertMaterial({ color: '#ffffff', colorWrite: false, depthWrite: false });
  [[0, 0, 0, 7], [6, -0.5, 1.5, 5], [-5.5, -0.8, -1, 5.5], [2, 0.8, -3, 4.5]].forEach(([x, y, z, r]) => {
    const p = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), m); p.position.set(x, y, z); p.scale.y = 0.45; p.castShadow = true; g.add(p);
  });
  return g;
}

// sahne: animasyonlu nesnelerin ekleneceği grup; kok: tepki hedeflerini içeren parsel grubu
export function canliKur(sahne, { sesCal = null, ust = sahne } = {}) {
  const efektler = [], yuruyenler = [], hayvanlar = [], ziplayanlar = [];
  if (ust !== sahne) ust.add(new THREE.HemisphereLight('#ffffff', '#d8c8a8', 2.4));   // efekt sahnesinin kendi ışığı
  const kelebekler = ['#f6c344', '#f28cb1', '#8fd3f4'].map((renk, i) => { const k = kelebek(renk); k.userData.faz = i * 2.1; sahne.add(k); return k; });
  const bulutlar = [0, 1].map((i) => { const b = bulut(); b.position.set(-60 + i * 70, 34, -20 + i * 30); sahne.add(b); return b; });

  // Yürüyen karakter: hedef noktalar arasında gider, varınca bir süre iş yapar (eğilip kalkar)
  function yuruyenEkle(kisi, noktalar, olcek) {
    if (!kisi || noktalar.length < 2) return;
    yuruyenler.push({ kisi, noktalar, olcek, hedef: 1, bekle: 1 + Math.random() * 2, hiz: 1.6 * olcek });
  }
  // Komut: ilk yürüyen (çiftçi) verilen noktaya gider, varınca iş yapar; sonra gezinmeye döner
  function git(nokta, bekle = 2.2) {
    const y = yuruyenler[0];
    if (!y) return;
    y.ozel = nokta.clone(); y.bekle = 0; y.isSuresi = bekle;
  }
  // Hayvan: merkez çevresinde dolaşır, durup otlar ya da gagalar. Tavşan sekerek koşar, kirpi ağır ağır, ördek süzülür
  const HIZ = { tavuk: 1.8, tavsan: 2.6, kirpi: 0.45, ordek: 0.7 };
  const SEKME = { tavuk: [14, 0.25], tavsan: [9, 0.6], kirpi: [12, 0.02], ordek: [2, 0.04] };
  function hayvanEkle(o, { merkez, yaricap, tur }) {
    hayvanlar.push({ o, merkez: merkez.clone(), yaricap, tur, hedef: o.position.clone(), bekle: Math.random() * 3, hiz: (HIZ[tur] ?? 0.9) * (o.scale.x || 1), faz: Math.random() * 6 });
  }

  function temizle() {
    yuruyenler.length = 0; hayvanlar.length = 0; ziplayanlar.length = 0;
    for (const e of efektler) ust.remove(e.o);
    efektler.length = 0;
  }

  // ---------- Dokunma tepkisi
  // hedef: tepki verecek nesne (userData.tepki = { tur, renk, adet })
  function tepki(hedef, nokta) {
    const t = hedef.userData.tepki || {};
    if (!ziplayanlar.some((z) => z.o === hedef)) ziplayanlar.push({ o: hedef, t: 0, taban: hedef.scale.clone(), y0: hedef.position.y, tur: t.tur });
    const p = nokta.clone();
    if (t.tur === 'ekin') {
      sesCal?.('hasat');
      yaziEfekti(`+${t.adet || 2}`, p, '#ffffff');
      for (let i = 0; i < 5; i++) urunEfekti(p, t.renk || '#e63946');
    } else if (t.tur === 'hayvan') {
      sesCal?.('besle');
      yaziEfekti('❤', p, '#ff6b8a', '#9b1f42');
    } else if (t.tur === 'ciftci') {
      sesCal?.('tik');
      yaziEfekti('Merhaba!', p, '#ffffff', '#2f6b2f');
    } else {
      sesCal?.('para');
      yaziEfekti('+₺', p, '#ffe08a', '#8a5a12');
    }
    for (let i = 0; i < 9; i++) parilti(p);
  }
  function yaziEfekti(metin, p, renk, kenar) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: yaziDokusu(metin, renk, kenar), transparent: true, depthTest: false }));
    s.renderOrder = 10; s.scale.set(7.5, 3.75, 1); s.position.copy(p).add(new THREE.Vector3(0, 3, 0)); ust.add(s);
    efektler.push({ o: s, t: 0, sure: 1.3, tur: 'yazi', y0: s.position.y });
  }
  function urunEfekti(p, renk) {
    const m = new THREE.Mesh(kureGeo, malz(renk)); m.scale.setScalar(1.1); m.position.copy(p).add(new THREE.Vector3(0, 1, 0)); ust.add(m);
    const a = Math.random() * Math.PI * 2, h = 4 + Math.random() * 3;
    efektler.push({ o: m, t: 0, sure: 1.1, tur: 'urun', hiz: new THREE.Vector3(Math.cos(a) * 5, 12 + Math.random() * 4, Math.sin(a) * 5), y0: p.y + 1, h });
  }
  function parilti(p) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: yildizDokusu(), transparent: true, depthTest: false, blending: THREE.AdditiveBlending }));
    s.renderOrder = 11; s.position.copy(p).add(new THREE.Vector3(0, 1.5, 0)); s.scale.setScalar(1.6); ust.add(s);
    const a = Math.random() * Math.PI * 2, e = Math.random() * 0.9 + 0.3;
    efektler.push({ o: s, t: 0, sure: 0.8, tur: 'parilti', hiz: new THREE.Vector3(Math.cos(a) * 7 * e, 6 + Math.random() * 6, Math.sin(a) * 7 * e) });
  }

  const v = new THREE.Vector3();
  function kare(dt, t, sinir = 40) {
    // Kelebekler: Lissajous yollarında, kanat çırparak
    for (const k of kelebekler) {
      const f = t * 0.35 + k.userData.faz, x = Math.sin(f * 1.3) * sinir * 0.38, z = Math.sin(f * 0.9 + 1.2) * sinir * 0.32, y = 3.2 + Math.sin(f * 3.1) * 0.8;
      k.lookAt(x, y, z); k.position.set(x, y, z); k.rotateY(Math.PI / 2);
      const c = Math.sin(t * 22 + k.userData.faz) * 1.1;
      k.userData.kanatlar[0].rotation.z = c; k.userData.kanatlar[1].rotation.z = -c;
      k.scale.setScalar(1.6);
    }
    for (const b of bulutlar) { b.position.x += dt * 2.2; if (b.position.x > 80) b.position.x = -80; }
    // Yürüyenler
    for (const y of yuruyenler) {
      const k = y.kisi, ud = k.userData;
      if (y.bekle > 0) {
        y.bekle -= dt;
        const e = Math.max(0, Math.sin(t * 3.2)) * 0.5;      // iş yapar: eğilip kalkar
        ud.govde.rotation.x = e; ud.kollar.forEach((kl, i) => { kl.rotation.x = -0.6 - e * 1.2 + (i ? 0.2 : 0); });
        ud.bacaklar.forEach((b) => { b.rotation.x = 0; });
        if (y.bekle <= 0) { y.hedef = (y.hedef + 1 + Math.floor(Math.random() * (y.noktalar.length - 1))) % y.noktalar.length; ud.govde.rotation.x = 0; }
        continue;
      }
      const h = y.ozel || y.noktalar[y.hedef];
      v.set(h.x - k.position.x, 0, h.z - k.position.z);
      const d = v.length();
      if (d < 0.3) { y.bekle = y.ozel ? y.isSuresi : 1.5 + Math.random() * 2.5; y.ozel = null; continue; }
      v.normalize();
      k.position.x += v.x * Math.min(d, y.hiz * dt); k.position.z += v.z * Math.min(d, y.hiz * dt);
      const aci = Math.atan2(v.x, v.z);
      k.rotation.y += Math.atan2(Math.sin(aci - k.rotation.y), Math.cos(aci - k.rotation.y)) * Math.min(1, dt * 8);
      const adim = t * 9;
      ud.bacaklar[0].rotation.x = Math.sin(adim) * 0.6; ud.bacaklar[1].rotation.x = -Math.sin(adim) * 0.6;
      ud.kollar[0].rotation.x = -Math.sin(adim) * 0.5; ud.kollar[1].rotation.x = Math.sin(adim) * 0.5;
      ud.govde.position.y = Math.abs(Math.sin(adim)) * 0.06;
    }
    // Hayvanlar
    for (const a of hayvanlar) {
      if (a.bekle > 0) {
        a.bekle -= dt;
        if (a.tur === 'tavuk') a.o.rotation.x = Math.max(0, Math.sin(t * 9 + a.faz)) * 0.5;      // gagalama
        else if (a.o.userData.bas) a.o.userData.bas.rotation.x = 0.35 + Math.sin(t * 2 + a.faz) * 0.1;   // otlama
        if (a.bekle <= 0) {
          const u = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * a.yaricap;
          a.hedef.set(a.merkez.x + Math.cos(u) * r, a.o.position.y, a.merkez.z + Math.sin(u) * r);
          a.o.rotation.x = 0; if (a.o.userData.bas) a.o.userData.bas.rotation.x = 0;
        }
        continue;
      }
      v.set(a.hedef.x - a.o.position.x, 0, a.hedef.z - a.o.position.z);
      const d = v.length();
      if (d < 0.2) { a.bekle = 2 + Math.random() * 4; continue; }
      v.normalize();
      a.o.position.x += v.x * Math.min(d, a.hiz * dt); a.o.position.z += v.z * Math.min(d, a.hiz * dt);
      const aci = Math.atan2(v.x, v.z);
      a.o.rotation.y += Math.atan2(Math.sin(aci - a.o.rotation.y), Math.cos(aci - a.o.rotation.y)) * Math.min(1, dt * 4);
      const [fr, gn] = SEKME[a.tur] || [6, 0.12];
      a.o.position.y = (a.y0 ??= a.o.position.y) + Math.abs(Math.sin(t * fr + a.faz)) * gn;
    }
    // Zıplayanlar: ezilip uzayan yay hareketi
    for (let i = ziplayanlar.length - 1; i >= 0; i--) {
      const z = ziplayanlar[i]; z.t += dt;
      const f = z.t / 0.55;
      if (f >= 1) { z.o.scale.copy(z.taban); z.o.position.y = z.y0; ziplayanlar.splice(i, 1); continue; }
      const sq = Math.sin(f * Math.PI * 3) * (1 - f) * 0.16;
      z.o.scale.set(z.taban.x * (1 + sq), z.taban.y * (1 - sq), z.taban.z * (1 + sq));
      z.o.position.y = z.y0 + Math.sin(Math.min(1, f * 1.6) * Math.PI) * (z.tur === 'ekin' ? 0.4 : 1.2) * (1 - f);
    }
    // Efektler
    for (let i = efektler.length - 1; i >= 0; i--) {
      const e = efektler[i]; e.t += dt;
      const f = e.t / e.sure;
      if (f >= 1) { ust.remove(e.o); if (e.o.isSprite) e.o.material.dispose(); efektler.splice(i, 1); continue; }
      if (e.tur === 'yazi') { e.o.position.y = e.y0 + yumusak(Math.min(1, f * 1.4)) * 4; e.o.material.opacity = 1 - Math.max(0, f - 0.6) / 0.4; const s = 1 + Math.sin(Math.min(1, f * 3) * Math.PI) * 0.25; e.o.scale.set(7.5 * s, 3.75 * s, 1); }
      else if (e.tur === 'urun') { e.hiz.y -= 30 * dt; e.o.position.addScaledVector(e.hiz, dt); e.o.rotation.y += dt * 6; e.o.scale.setScalar(1.1 * (1 - Math.max(0, f - 0.7) / 0.3)); }
      else { e.hiz.y -= 14 * dt; e.o.position.addScaledVector(e.hiz, dt); e.o.material.opacity = 1 - f; e.o.scale.setScalar(1.6 * (1 - f * 0.6)); }
    }
    return efektler.length > 0 || ziplayanlar.length > 0;
  }

  return { yuruyenEkle, hayvanEkle, tepki, kare, temizle, git };
}
