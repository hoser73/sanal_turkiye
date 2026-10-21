// Ağaçlar: OSM orman, park, mezarlık, meyve bahçesi, bağ, yerleşim ve çayır alanlarına yöreye uygun türlerle dikilir.
// Karadeniz ve yüksek dağ: çam; Ege–Akdeniz kıyısı: kızılçam ve zeytin; iç Anadolu: meşe, kavak, selvi.
// Çiftlik oyunu tadında gür, yuvarlak taçlar (yumuşak gölgeli); yaprak rengi gerçek tarihe göre değişir. Rüzgârda salınır.
import * as THREE from '/vendor/three/three.module.js';
import { birlestir, kararli, salinimEkle, golgeDokusu, kaldir, yumusakNormal } from './dunya-ortak.js';

const GOVDE = '#5a4632', TAC = '#ececec';
function modeller() {
  const ico = (r, d = 1) => new THREE.IcosahedronGeometry(r, d);
  const sil = (r0, r1, h, n = 6) => new THREE.CylinderGeometry(r0, r1, h, n);
  const koni = (r, h, n = 7) => new THREE.ConeGeometry(r, h, n);
  const govde = (r, h) => ({ geo: sil(r * 0.7, r, h), renk: GOVDE, yer: [0, h / 2, 0] });
  const tac = (geo, yer, olcek, renk = TAC) => ({ geo, renk, yer, olcek, altKoyu: [yer[1] - 2, yer[1] + 2] });
  return {
    yuvarlak: { boy: 7.6, r: 2.9, geo: birlestir([govde(0.3, 3.4), tac(ico(2.4, 2), [0, 4.8, 0]), tac(ico(1.7, 2), [1.4, 4.2, 0.6]), tac(ico(1.6, 2), [-1.2, 4.4, -0.8]),
      tac(ico(1.5, 2), [0.3, 6.0, 0.3]), tac(ico(1.3, 2), [-0.6, 4.1, 1.3]), tac(ico(1.2, 2), [0.9, 5.4, -1.0])]) },
    cam: { boy: 10, r: 2.4, geo: birlestir([govde(0.24, 2.6), tac(koni(2.5, 4.2), [0, 4.2, 0]), tac(koni(2.0, 3.8), [0, 6.2, 0]), tac(koni(1.35, 3.2), [0, 8.3, 0])]) },
    kavak: { boy: 13, r: 1.5, geo: birlestir([govde(0.22, 2.4), tac(ico(1.35, 1), [0, 7.4, 0], [1, 4.0, 1]), tac(ico(0.9, 0), [0.4, 5.2, 0.3], [1, 2.2, 1])]) },
    selvi: { boy: 10, r: 1.0, geo: birlestir([govde(0.18, 1.4), tac(ico(0.95, 1), [0, 5.4, 0], [1, 4.4, 1])]) },
    zeytin: { boy: 4.4, r: 2.3, geo: birlestir([{ geo: sil(0.22, 0.34, 1.9), renk: '#6e5f4c', yer: [0, 0.95, 0], don: [0.08, 0, 0.1] },
      tac(ico(2.1, 1), [0, 2.9, 0], [1, 0.62, 1]), tac(ico(1.3, 0), [1.2, 2.6, -0.4], [1, 0.7, 1])]) },
    cali: { boy: 1.1, r: 0.8, geo: birlestir([tac(ico(0.75, 0), [0, 0.55, 0], [1.2, 0.8, 1])]) },
  };
}

// Gür çiftlik yeşilleri; mevsime göre: ilkbahar çiçekli, sonbahar altın-turuncu karışık, kış çıplak dallar
function ciftlikRengi(tur, r, e) {
  const ay = new Date().getMonth();   // 0 ocak
  const yesil = { yuvarlak: ['#4e9a2f', '#5fae37', '#469030', '#6cb83e'], cam: ['#2f6e30', '#3a7d36', '#2a6630'], kavak: ['#6fae3a', '#7cbb42'],
    selvi: ['#2c5e2e', '#356a34'], zeytin: ['#93a865', '#869e5c'], cali: ['#5fa835', '#6fb83d'] }[tur];
  let renk = yesil[Math.floor(r * yesil.length) % yesil.length];
  const yaprakDoken = tur === 'yuvarlak' || tur === 'kavak' || tur === 'cali';
  if (yaprakDoken) {
    const k = (r * 997) % 1;
    if (ay >= 2 && ay <= 4 && tur === 'yuvarlak' && k < 0.18) renk = ['#f7c6dc', '#fbe6ef'][Math.floor(k * 11) % 2];   // ilkbahar çiçeği
    else if (ay === 9 || ay === 10) renk = tur === 'kavak' ? (k < 0.7 ? '#e0b43a' : '#a9b445') : k < 0.6 ? renk : k < 0.85 ? '#d8aa3a' : '#d27a2e';
    else if (ay === 11 || ay <= 1) renk = ['#9a8466', '#8c785c'][Math.floor(r * 2)];
  }
  const c = new THREE.Color(renk);
  if ((ay >= 11 || ay <= 2) && e > 1500) c.lerp(new THREE.Color('#f2f5f8'), 0.45);   // karlı yükseklerde
  return c.offsetHSL((r - 0.5) * 0.02, 0, (r - 0.5) * 0.07);
}

// Ekim düzeni: aralık (m), doluluk, satır düzeni (bahçe/bağ), titreşim
const DUZEN = {
  orman: { ara: 6.5, dolu: 0.9, titre: 0.85 },
  park: { ara: 11, dolu: 0.6, titre: 0.9 },
  mezarlik: { ara: 7, dolu: 0.55, titre: 0.4 },
  bahce: { ara: 7, dolu: 0.97, titre: 0.06, olcek: 0.62 },
  bag: { ara: 3, dolu: 0.95, titre: 0.05, olcek: 1 },
  yerlesim: { ara: 15, dolu: 0.3, titre: 0.9, binaDisi: true },
  cayir: { ara: 42, dolu: 0.32, titre: 0.95 },
};

export function bitkiKur(ctx) {
  const { sahne, ortak } = ctx;
  const M = modeller();
  // Taçlar yumuşak normalli: köşeli alçak poligon yerine yuvarlak, boyanmış gibi gölgelenir
  for (const m of Object.values(M)) m.geo = yumusakNormal(m.geo);
  const malzeme = salinimEkle(new THREE.MeshLambertMaterial({ vertexColors: true }), ortak.zaman, 0.028);
  const golgeMalzeme = new THREE.MeshBasicMaterial({ color: '#0b1408', alphaMap: golgeDokusu(), transparent: true, opacity: 0.32, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const golgeGeo = new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2);
  let nesneler = [];

  function temizle() { kaldir(sahne, nesneler); nesneler = []; }

  function kategoriler(alan) {
    const sinif = (...s) => ['match', ['get', 'class'], s, true, false];
    const alt = (...s) => ['match', ['get', 'subclass'], s, true, false];
    return {
      orman: alan.poligonlar('landcover', sinif('wood', 'forest')),
      bahce: alan.poligonlar('landcover', ['all', sinif('farmland'), alt('orchard', 'plant_nursery')]),
      bag: alan.zoom >= 15.5 ? alan.poligonlar('landcover', ['all', sinif('farmland'), alt('vineyard')]) : [],
      // OSM "park" katmanı koruma alanlarıdır (denizi de kapsar); kent parkları arazi örtüsünde park/bahçe alt sınıfıdır
      cayir: alan.poligonlar('landcover', ['all', sinif('grass'), ['!', alt('park', 'garden')]]),
      park: alan.poligonlar('landcover', ['all', sinif('grass'), alt('park', 'garden')]),
      mezarlik: alan.poligonlar('landuse', sinif('cemetery')),
      yerlesim: alan.poligonlar('landuse', sinif('residential', 'suburb', 'quarter', 'neighbourhood')),
    };
  }

  // Tarama çizgisiyle poligon doldurma: her satırda kenar kesişimlerinden aralıklar → ızgara noktaları
  function tara(pol, ara, R, ziyaret) {
    const [x0, z0, x1, z1] = pol.kutu;
    const za = Math.max(z0, -R), zb = Math.min(z1, R);
    if (za > zb || x0 > R || x1 < -R) return;
    for (let gz = Math.floor(za / ara); gz <= Math.ceil(zb / ara); gz++) {
      const z = (gz + 0.5) * ara;
      const kes = [];
      for (const h of pol.halkalar) {
        for (let i = 0, j = h.length - 1; i < h.length; j = i++) {
          const [xi, zi] = h[i], [xj, zj] = h[j];
          if ((zi > z) !== (zj > z)) kes.push(((xj - xi) * (z - zi)) / (zj - zi) + xi);
        }
      }
      if (kes.length < 2) continue;
      kes.sort((a, b) => a - b);
      const genis = Math.sqrt(Math.max(0, R * R - z * z));
      for (let k = 0; k + 1 < kes.length; k += 2) {
        const xa = Math.max(kes[k], -genis), xb = Math.min(kes[k + 1], genis);
        for (let gx = Math.ceil(xa / ara - 0.5); (gx + 0.5) * ara <= xb; gx++) ziyaret(gx, gz);
      }
    }
  }

  function kur(alan) {
    temizle();
    if (alan.zoom < 13.4) return;
    const ayar = ctx.ayar();
    const R = alan.yaricap;
    const kat = kategoriler(alan);
    // Binalar (yerleşim ağaçları binaların üstüne düşmesin): 10 m'lik ızgarada dolu hücreler
    const dolu = new Set();
    for (const b of alan.poligonlar('building')) {
      const [x0, z0, x1, z1] = b.kutu;
      if (x1 < -R || x0 > R || z1 < -R || z0 > R || (x1 - x0) > 400) continue;
      for (let x = Math.floor((x0 - 3) / 10); x <= Math.floor((x1 + 3) / 10); x++) for (let z = Math.floor((z0 - 3) / 10); z <= Math.floor((z1 + 3) / 10); z++) dolu.add(x * 100003 + z);
    }
    // Su maskesi: kıyıda ve gölde ağaç bitmez (10 m'lik hücreler)
    const su = new Set();
    for (const p of alan.poligonlar('water')) tara(p, 10, R, (gx, gz) => su.add(gx * 100003 + gz));
    alan.suMaskesi = su;
    // 1) Sayım: bütçeyi aşarsa aralık büyütülür
    let toplam = 0;
    for (const [ad, liste] of Object.entries(kat)) {
      const d = DUZEN[ad];
      for (const p of liste) tara(p, d.ara, R, () => { toplam += d.dolu; });
    }
    const carpan = Math.max(1, Math.sqrt(toplam / ayar.agac));
    // 2) Dikim
    const lng = ctx.cografi(0, 0)[0], lat = ctx.cografi(0, 0)[1];
    const karadeniz = lat > 40.7 && lng > 30.5;
    const kiyiBati = lng < 29.6 || lat < 37.25;
    const agaclar = { yuvarlak: [], cam: [], kavak: [], selvi: [], zeytin: [], cali: [] };
    const gorulen = new Set();
    for (const [ad, liste] of Object.entries(kat)) {
      const d = DUZEN[ad];
      const ara = d.ara * (ad === 'bag' || ad === 'bahce' ? Math.min(carpan, 2.5) : carpan);
      for (const p of liste) {
        tara(p, ara, R, (gx, gz) => {
          const anahtar = `${ad}${gx},${gz}`;
          if (gorulen.has(anahtar)) return;
          gorulen.add(anahtar);
          const r1 = kararli(gx, gz, 1), r2 = kararli(gx, gz, 2), r3 = kararli(gx, gz, 3);
          if (r3 > d.dolu) return;
          const x = (gx + 0.5 + (r1 - 0.5) * d.titre) * ara, z = (gz + 0.5 + (r2 - 0.5) * d.titre) * ara;
          if (d.binaDisi && dolu.has(Math.floor(x / 10) * 100003 + Math.floor(z / 10))) return;
          if (su.has(Math.floor(x / 10) * 100003 + Math.floor(z / 10))) return;
          const e = ctx.yukseklik(x, z);
          const yukseklikDeniz = e / ctx.abartma();   // tür seçimi gerçek rakımla
          let tur;
          const r = kararli(gx, gz, 4);
          if (ad === 'mezarlik') tur = r < 0.85 ? 'selvi' : 'yuvarlak';
          else if (ad === 'bahce') tur = kiyiBati && yukseklikDeniz < 500 ? 'zeytin' : 'yuvarlak';
          else if (ad === 'bag') tur = 'cali';
          else if (ad === 'orman') tur = (karadeniz || yukseklikDeniz > 1100) ? (r < 0.75 ? 'cam' : 'yuvarlak') : kiyiBati ? (r < 0.82 ? 'cam' : 'zeytin') : (r < 0.55 ? 'yuvarlak' : 'cam');
          else if (ad === 'yerlesim') tur = r < 0.32 ? 'kavak' : r < 0.5 ? 'selvi' : (kiyiBati && r < 0.62) ? 'zeytin' : 'yuvarlak';
          else if (ad === 'park') tur = r < 0.18 ? 'kavak' : r < 0.32 ? 'cam' : 'yuvarlak';
          else tur = r < 0.6 ? 'yuvarlak' : 'kavak';
          // Çiftlik ölçeği: ağaçlar biraz iri ve tombul
          const olcek = (d.olcek || 1) * (0.78 + kararli(gx, gz, 5) * 0.55) * 1.15;
          agaclar[tur].push({ x, y: e, z, olcek, don: kararli(gx, gz, 6) * Math.PI * 2, renk: ciftlikRengi(tur, kararli(gx, gz, 7), yukseklikDeniz) });
        });
      }
    }
    // 3) Örnek ağları
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), yukari = new THREE.Vector3(0, 1, 0);
    const isik = ctx.isik();
    const gunesYk = Math.max(8, isik.yukseklik ?? 40) * Math.PI / 180, gunesAz = (isik.azimut ?? 200) * Math.PI / 180;
    const golgeYon = [-Math.sin(gunesAz), Math.cos(gunesAz)];   // güneşin tersine (x doğu, z güney)
    const golgeBoyu = Math.min(3.5, 1 / Math.tan(gunesYk));
    const golgeler = [];
    for (const [tur, liste] of Object.entries(agaclar)) {
      if (!liste.length) continue;
      const mesh = new THREE.InstancedMesh(M[tur].geo, malzeme, liste.length);
      mesh.frustumCulled = false;
      mesh.userData.paylasimli = true;
      liste.forEach((a, i) => {
        m.compose(v.set(a.x, a.y - 0.15, a.z), q.setFromAxisAngle(yukari, a.don), s.set(a.olcek, a.olcek * (0.9 + (a.olcek % 0.2)), a.olcek));
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, a.renk);
        if (ayar.golge && tur !== 'cali') golgeler.push({ ...a, r: M[tur].r * a.olcek, h: M[tur].boy * a.olcek });
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      sahne.add(mesh);
      nesneler.push(mesh);
    }
    if (golgeler.length && (isik.gun ?? 1) > 0.15) {
      const g = new THREE.InstancedMesh(golgeGeo, golgeMalzeme, golgeler.length);
      g.frustumCulled = false;
      g.userData.paylasimli = true;
      g.renderOrder = -1;
      const aci = Math.atan2(golgeYon[0], golgeYon[1]);
      golgeler.forEach((a, i) => {
        const boy = a.h * golgeBoyu * 0.5;
        m.compose(v.set(a.x + golgeYon[0] * boy * 0.8, a.y + 0.25, a.z + golgeYon[1] * boy * 0.8), q.setFromAxisAngle(yukari, aci),
          s.set(a.r * 1.05, 1, a.r + boy * 0.75));
        g.setMatrixAt(i, m);
      });
      golgeMalzeme.opacity = 0.34 * Math.min(1, isik.gun ?? 1);
      sahne.add(g);
      nesneler.push(g);
    }
  }

  return {
    kur, temizle,
    kare() { return false; },   // salınım yalnızca harita zaten çizilirken işler; ağaçlar sürekli çizim istemez
  };
}
