// Sevimli tarz parsel modeli (tam sayfa çiftlik ve haritadaki 3B dünya): parselin verisini (imar, yapılar, ekin, süsler,
// kozmetik, tarla sınırı) sevimli kitin düşük poligonlu modelleriyle çizer. Hücre S = 30 m; yerel koordinat
// x = (u − 0,5)·S doğu, z = (v − 0,5)·S güney. Kit modelleri büyütülerek yerleştirilir (çizgi film oranı).
import * as THREE from '/vendor/three/three.module.js';
import { yerlesim, SUS_YUVALARI } from './modeller.js';
import { S } from './model3d.js';
import * as K from './sevimli3d.js';
import * as Y from './sevimli3d-yapi.js';

const ux = (u) => (u - 0.5) * S, vz = (v) => (v - 0.5) * S;
const TARLA = [0.06, 0.08, 0.53, 0.92];   // ekin alanı (yapılar varsa parselin batı yarısı)
const YAPI_OLCEK = 2.1, BITKI_OLCEK = 2.2, SUS_OLCEK = 1.8;

function tohumlu(s) {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}
function noktaIcinde(c, x, z) {
  let ic = false;
  for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
    const [xi, zi] = c[i], [xj, zj] = c[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ic = !ic;
  }
  return ic;
}
// Yuvaya sığdır: modelin taban kutusu yuvanın %90'ını aşmasın, en çok `enCok` kat büyüsün
function yuvayaKoy(g, o, [u0, v0, u1, v1], enCok = YAPI_OLCEK) {
  const kutu = new THREE.Box3().setFromObject(o), boy = kutu.getSize(new THREE.Vector3());
  const s = Math.min(enCok, (0.9 * (u1 - u0) * S) / Math.max(0.1, boy.x), (0.9 * (v1 - v0) * S) / Math.max(0.1, boy.z));
  o.scale.multiplyScalar(s);
  o.position.set(ux((u0 + u1) / 2), 0, vz((v0 + v1) / 2));
  o.userData.tepki ??= { tur: 'yapi' };
  g.add(o);
  return s;
}

// Ekin: tarla alanına uygun sıklıkta bitkiler (büyüme b ile boy atar)
function ekinEkle(g, tip, b, alan, ic, r) {
  const [u0, v0, u1, v1] = alan, x0 = ux(u0) + 1, x1 = ux(u1) - 1, z0 = vz(v0) + 1, z1 = vz(v1) - 1;
  const izgara = (adimX, adimZ) => {
    const n = [];
    for (let x = x0 + adimX / 2; x < x1; x += adimX) for (let z = z0 + adimZ / 2; z < z1; z += adimZ) {
      const px = x + (r() - 0.5) * adimX * 0.2, pz = z + (r() - 0.5) * adimZ * 0.2;
      if (ic(px, pz)) n.push([px / BITKI_OLCEK, pz / BITKI_OLCEK]);
    }
    return n;
  };
  const olcekli = (o, s = BITKI_OLCEK) => { o.scale.setScalar(s); g.add(o); return o; };
  const boy = 0.35 + 0.65 * Math.max(0.12, Math.min(1, b));
  switch (tip) {
    case 'BUGDAY': return olcekli(Y.bugdayTarhi(izgara(2.1, 2.1), r, b));
    case 'DOMATES': { const t = olcekli(K.domatesTarhi(izgara(2.8, 2.6), r)); t.scale.y *= boy; return t; }
    case 'CAY': return olcekli(Y.caliTarhi(izgara(3.0, 2.8), r, b));
    case 'PAMUK': return olcekli(Y.caliTarhi(izgara(2.8, 2.6), r, b, { pamuk: true }));
    case 'UZUM': {
      const siralar = []; for (let z = z0 + 1.5; z < z1; z += 3.2) siralar.push(z / BITKI_OLCEK);
      const t = olcekli(Y.bagTarhi(siralar, (x1 - x0) / BITKI_OLCEK, r, b)); t.position.x = (x0 + x1) / 2; return t;
    }
    case 'ELMA': case 'KAYISI': case 'FINDIK': case 'ZEYTIN': {
      const meyve = { ELMA: '#e2483a', KAYISI: '#f2a03a', FINDIK: '#9a6a3c', ZEYTIN: '#4b5a2e' }[tip];
      for (let x = x0 + 2.4; x < x1 - 1; x += 4.6) for (let z = z0 + 2.6; z < z1 - 1; z += 5.2) {
        if (!ic(x, z)) continue;
        const a = Y.meyveAgaci(r, b > 0.6 ? meyve : null, b, { gumus: tip === 'ZEYTIN' });
        a.position.set(x, 0, z); a.scale.multiplyScalar(BITKI_OLCEK); a.rotation.y = r() * 6.28; g.add(a);
      }
      return null;
    }
    default: { const t = olcekli(K.cilekTarhi(izgara(2.6, 2.4), r)); t.scale.y *= boy; return t; }
  }
}

function yapiEkle(g, { tip, tamam, yuva }, { gece, catiRenk }, r, sonuc) {
  if (!tamam) { yuvayaKoy(g, Y.iskele(r), yuva); return; }
  const [u0, v0, u1, v1] = yuva;
  switch (tip) {
    case 'EV': { const o = Y.ev({ gece, ...(catiRenk ? { catiRenk } : {}) }); const s = yuvayaKoy(g, o, yuva); sonuc.baca = sonuc.baca || { o, s }; return; }
    case 'APARTMAN': return yuvayaKoy(g, Y.apartman({ gece, ...(catiRenk ? { catiRenk } : {}) }), yuva);
    case 'PANSIYON': return yuvayaKoy(g, Y.pansiyon({ gece, ...(catiRenk ? { catiRenk } : {}) }), yuva);
    case 'DUKKAN': return yuvayaKoy(g, Y.dukkan({ gece }), yuva);
    case 'RESTORAN': return yuvayaKoy(g, Y.dukkan({ gece, restoran: true, tente: '#e2574c' }), yuva);
    case 'DEPO': return yuvayaKoy(g, Y.depo(), yuva);
    case 'FABRIKA': { const o = Y.fabrika(); const s = yuvayaKoy(g, o, yuva); sonuc.baca = { o, s }; return; }
    case 'FIRIN': { const o = Y.firin({ gece }); const s = yuvayaKoy(g, o, yuva); sonuc.baca = { o, s }; return; }
    case 'DEGIRMEN': { const o = Y.degirmen(); yuvayaKoy(g, o, yuva); sonuc.kanatlar.push(o.userData.kanat); return; }
    case 'AMBAR': return yuvayaKoy(g, K.ambar(), yuva);
    case 'BAG_EVI': { const o = Y.bagEvi({ gece }); const s = yuvayaKoy(g, o, yuva); sonuc.baca = sonuc.baca || { o, s }; return; }
    case 'DAG_EVI': { const o = Y.dagEvi({ gece }); const s = yuvayaKoy(g, o, yuva); sonuc.baca = sonuc.baca || { o, s }; return; }
    case 'VILLA': return yuvayaKoy(g, Y.villa({ gece }), yuva);
    case 'HAVUZ': return yuvayaKoy(g, Y.havuz(), yuva);
    case 'CARDAK': return yuvayaKoy(g, Y.cardak(), yuva);
    case 'OYUN_PARKI': return yuvayaKoy(g, Y.oyunParki(), yuva);
    case 'KUMES': { const o = Y.kumes(r); yuvayaKoy(g, o, yuva); for (const t of o.userData.tavuklar) t.userData.tepki = { tur: 'hayvan' }; for (const t of o.userData.tavuklar) sonuc.hayvanlar.push({ o: t, merkez: new THREE.Vector3(0, 0, 1.6), yaricap: 1.4, tur: 'tavuk' }); return; }
    case 'ARI_KOVANI': return yuvayaKoy(g, Y.kovanlar(r), yuva);
    case 'ZEYTIN_SIKMA': return yuvayaKoy(g, Y.sikmaEvi({ gece }), yuva);
    case 'CAY_ATOLYESI': return yuvayaKoy(g, Y.cayAtolyesi({ gece }), yuva);
    case 'MANDIRA': { yuvayaKoy(g, K.ambar(), [u0, v0, u0 + (u1 - u0) * 0.7, v1]); const k = Y.suKulesi(); yuvayaKoy(g, k, [u0 + (u1 - u0) * 0.72, v0, u1, v0 + (v1 - v0) * 0.5], 1.4); return; }
    case 'INEK_AHIRI': {
      yuvayaKoy(g, K.ambar(), [u0, v0, u0 + (u1 - u0) * 0.7, v0 + (v1 - v0) * 0.6]);
      [[0.3, 0.82, true], [0.75, 0.8, false]].forEach(([a, b, alaca]) => {
        const c = Y.inek(alaca); c.scale.setScalar(YAPI_OLCEK); c.position.set(ux(u0 + (u1 - u0) * a), 0, vz(v0 + (v1 - v0) * b)); c.rotation.y = r() * 6.28;
        c.userData.tepki = { tur: 'hayvan' }; g.add(c);
        sonuc.hayvanlar.push({ o: c, merkez: c.position.clone(), yaricap: Math.min(u1 - u0, v1 - v0) * S * 0.2, tur: 'inek' });
      });
      return;
    }
    case 'AGIL': {
      const w = (u1 - u0) * S, d = (v1 - v0) * S, cx = ux((u0 + u1) / 2), cz = vz((v0 + v1) / 2);
      [[0, -d / 2, w, 0], [0, d / 2, w, 0], [-w / 2, 0, d, Math.PI / 2], [w / 2, 0, d, Math.PI / 2]].forEach(([x, z, l, ry]) => { const c = K.cit(l / 1.4); c.scale.setScalar(1.4); c.position.set(cx + x, 0, cz + z); c.rotation.y = ry; g.add(c); });
      for (let i = 0; i < 5; i++) {
        const k = Y.koyun(); k.scale.setScalar(YAPI_OLCEK * 0.9); k.position.set(cx + (r() - 0.5) * w * 0.7, 0, cz + (r() - 0.5) * d * 0.7); k.rotation.y = r() * 6.28;
        k.userData.tepki = { tur: 'hayvan' }; g.add(k);
        sonuc.hayvanlar.push({ o: k, merkez: new THREE.Vector3(cx, 0, cz), yaricap: Math.min(w, d) * 0.32, tur: 'koyun' });
      }
      return;
    }
    case 'SERA': return yuvayaKoy(g, Y.sera(r), yuva);
    case 'SU_DEPOSU': { const o = Y.suKulesi(); o.scale.setScalar(1.6); o.position.set(ux(0.9), 0, vz(0.9)); g.add(o); return; }
    case 'GUNES_PANELI': { const o = Y.gunesPaneli(); o.scale.setScalar(1.6); o.position.set(ux(0.78), 0, vz(0.08)); g.add(o); return; }
    case 'TEL_CIT': {
      const a = S / 2 - 0.6;
      [[0, -a, 0], [0, a, 0], [-a, 0, Math.PI / 2], [a, 0, Math.PI / 2]].forEach(([x, z, ry]) => { const c = K.cit((2 * a) / 1.3); c.scale.setScalar(1.3); c.position.set(x, 0, z); c.rotation.y = ry; g.add(c); });
      return;
    }
    case 'SULAMA_HATTI': {
      const [a0, b0, a1, b1] = TARLA;
      for (let z = vz(b0) + 1.5; z < vz(b1); z += 2.4) g.add(K.parca(new THREE.CylinderGeometry(0.08, 0.08, (a1 - a0) * S - 2, 8).rotateZ(Math.PI / 2), '#3d8fc4', ux((a0 + a1) / 2), 0.25, z));
      const p = K.parca(K.yuvarlakKutu(1.4, 1.2, 1.0, 0.2), '#3d8fc4', ux(a1) - 0.4, 0.6, vz(b1) - 1.2); p.castShadow = true; g.add(p);
      return;
    }
    case 'PEYZAJ': [[0.08, 0.92], [0.92, 0.08], [0.1, 0.5], [0.5, 0.94]].forEach(([u, v]) => { const a = K.yuvarlakAgac(r, 1.6); a.position.set(ux(u), 0, vz(v)); g.add(a); }); return;
    default: yuvayaKoy(g, Y.depo(), yuva);
  }
}

const SUSLER = {
  CICEK_TARHI: (r) => Y.cicekTarhi(r), KORKULUK: () => Y.korkuluk(), BANK: () => Y.bank(), KUYU: () => Y.kuyu(), ODUN_YIGINI: () => Y.odunYigini(),
  YEL_DEGIRMENI: () => { const d = Y.degirmen(); d.scale.setScalar(0.45); return d; }, CESME: () => Y.cesme(), BAYRAK_DIREGI: () => Y.bayrakDiregi(),
  DILEK_AGACI: (r) => Y.dilekAgaci(r), HASAT_ARABASI: (r) => Y.hasatArabasi(r), KARDAN_ADAM: () => Y.kardanAdam(),
  TAS_YOL: (r) => { const g = new THREE.Group(); for (let i = 0; i < 5; i++) { const t = K.tas(r); t.position.set(0, -0.05, -1.6 + i * 0.8); g.add(t); } return g; },
};

// Yükseltme rozeti: altın zeminde yıldızlar (seviye 2 → ★★, 3 → ★★★)
const rozetDokulari = new Map();
function yildizRozeti(seviye) {
  if (!rozetDokulari.has(seviye)) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 64; const x = c.getContext('2d');
    x.fillStyle = '#f5b93a'; x.strokeStyle = '#fff'; x.lineWidth = 6;
    x.beginPath(); x.roundRect(4, 4, 120, 56, 28); x.fill(); x.stroke();
    x.fillStyle = '#fff'; x.font = '800 34px system-ui'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('★'.repeat(seviye), 64, 35);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; rozetDokulari.set(seviye, t);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: rozetDokulari.get(seviye), transparent: true }));
  s.scale.set(4.4, 2.2, 1);
  return s;
}

// veri: { id, imar, yp, ek, kz, ss }; secenek: { gece, tarla (tarlaCercevesi sonucu), sahipli }
// Dönüş: Group; userData.baca (yerel Vector3 | null), userData.kanatlar (dönen yel değirmeni kanatları)
export function sevimliParselModeli(veri, { gece = 0, tarla = null, sahipli = false } = {}) {
  const g = new THREE.Group(), r = tohumlu(veri.id || `${veri.imar}${veri.yp}${veri.ek}`);
  const [ekTip, ekB] = String(veri.ek || '').split(':');
  const yapilar = yerlesim(veri.yp, { tarim: veri.imar === 'TARIM' });
  const kozmetik = Object.fromEntries(String(veri.kz || '').split('|').filter(Boolean).map((x) => x.split(':')));
  const sonuc = { baca: null, kanatlar: [], hayvanlar: [] };

  // Zemin: tarım parseli sürülmüş toprak (tarla ise kendi sınırıyla), diğerleri çimen üstünde kum avlu
  let alan = TARLA, ic = () => true;
  const topraklar = [];   // tarla toprağı: dokununca ekin tepki verir
  if (tarla) {
    const [a0, b0, a1, b1] = tarla.alan;
    alan = [a0, b0, yapilar.length ? Math.min(a1, TARLA[2]) : a1, b1];
    ic = (x, z) => noktaIcinde(tarla.cokgen, x, z);
    const sekil = new THREE.Shape(tarla.cokgen.map(([x, z]) => new THREE.Vector2(x, -z)));
    const plaka = new THREE.Mesh(new THREE.ExtrudeGeometry(sekil, { depth: 0.3, bevelEnabled: true, bevelSize: 0.3, bevelThickness: 0.15, bevelSegments: 2 }).rotateX(-Math.PI / 2), K.malz(K.RENK.toprak));
    plaka.receiveShadow = true; g.add(plaka); topraklar.push(plaka);
    // Karık sırtları: tarlanın uzun kenarı (model x ekseni) boyunca, sınırın içinde kalan parçalar
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of tarla.cokgen) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const sirt = K.malz(K.RENK.toprakKoyu);
    for (let z = z0 + 1.1; z < z1 - 0.6; z += 2.2) {
      let bas = null;
      for (let x = x0; x <= x1 + 0.5; x += 0.5) {
        const icinde = x <= x1 && ic(x, z - 0.45) && ic(x, z + 0.45);
        if (icinde && bas === null) bas = x;
        else if (!icinde && bas !== null) {
          if (x - bas > 1.5) { const m = new THREE.Mesh(K.yuvarlakKutu(x - bas - 0.5, 0.22, 0.9, 0.1), sirt); m.position.set((bas + x - 0.5) / 2, 0.5, z); m.receiveShadow = true; g.add(m); topraklar.push(m); }
          bas = null;
        }
      }
    }
  } else if (veri.imar === 'TARIM' || ekTip) {
    const [a0, b0, a1, b1] = yapilar.length ? TARLA : [0.06, 0.08, 0.94, 0.92];
    alan = [a0, b0, a1, b1];
    const t = K.tarla((a1 - a0) * S, (b1 - b0) * S, { sira: Math.round(((a1 - a0) * S) / 2.2), ot: 1.1 });
    t.position.set(ux((a0 + a1) / 2), 0, vz((b0 + b1) / 2)); g.add(t); topraklar.push(t);
    if (yapilar.length) { const avlu = K.levha(S * 0.42, S * 0.84, K.RENK.kum, { kalinlik: 0.05, kose: 3 }); avlu.position.set(ux(0.76), 0, 0); g.add(avlu); }
  } else if (yapilar.length) {
    const avlu = K.levha(S * 0.86, S * 0.86, K.RENK.kum, { kalinlik: 0.05, kose: 4 }); g.add(avlu);
  }
  if (ekTip) {
    const e = new THREE.Group(); e.position.y = tarla ? 0.42 : 0.18; ekinEkle(e, ekTip, Number(ekB) || 0, alan, ic, r); g.add(e);
    const renk = { BUGDAY: '#e9c75a', DOMATES: '#ea4330', ELMA: '#e2483a', KAYISI: '#f2a03a', FINDIK: '#9a6a3c', ZEYTIN: '#4b5a2e', CAY: '#3f9a4a', PAMUK: '#fbf8f0', UZUM: '#7b3f8c' }[ekTip];
    e.userData.tepki = { tur: 'ekin', renk, adet: 1 + Math.round((Number(ekB) || 0) * 3) };
    for (const t of topraklar) t.userData.tepkiHedef = e;
  } else for (const t of topraklar) t.userData.tepki = { tur: 'toprak' };   // boş tarla: dokununca ne ekileceği sorulur
  // Her yapının parçaları (ve barınağın hayvanları) yapının sırasıyla işaretlenir: dokununca hangi yapı olduğu bilinsin
  // yp kaydının 3. alanı yapının seviyesidir (TIP:tamam:seviye); yükseltilmiş yapının üstünde yıldız rozeti durur
  const seviyeler = String(veri.yp || '').split(',').filter(Boolean).map((k) => Number(k.split(':')[2]) || 1);
  yapilar.forEach((y, sira) => {
    const once = g.children.length, hOnce = sonuc.hayvanlar.length;
    yapiEkle(g, y, { gece, catiRenk: kozmetik.cati }, r, sonuc);
    const yeni = g.children.slice(once);
    if (seviyeler[sira] > 1 && yeni.length) {
      const kutu = new THREE.Box3(); for (const o of yeni) kutu.expandByObject(o);
      const rozet = yildizRozeti(seviyeler[sira]); rozet.position.set((kutu.min.x + kutu.max.x) / 2, kutu.max.y + 2.2, (kutu.min.z + kutu.max.z) / 2);
      g.add(rozet);
    }
    for (const o of yeni) o.userData.tepki = { ...(o.userData.tepki || { tur: 'yapi' }), sira, tip: y.tip };
    for (const h of sonuc.hayvanlar.slice(hOnce)) h.o.userData.tepki = { ...(h.o.userData.tepki || { tur: 'hayvan' }), sira, tip: y.tip };
  });
  for (const kayit of String(veri.ss || '').split(',').filter(Boolean)) {
    const [tur, yuva] = kayit.split(':'), kur = SUSLER[tur];
    if (!kur) continue;
    const [u, v] = SUS_YUVALARI[(Number(yuva) || 0) % SUS_YUVALARI.length], o = kur(r);
    o.scale.multiplyScalar(SUS_OLCEK); o.position.set(ux(u), 0, vz(v)); o.rotation.y = r() * 6.28; o.userData.tepki = { tur: 'yapi' }; g.add(o);
    if (o.userData.kanat) sonuc.kanatlar.push(o.userData.kanat);
  }
  if (kozmetik.bayrak) { const b = Y.bayrakDiregi(); b.scale.setScalar(1.6); b.position.set(ux(0.04), 0, vz(0.04)); g.add(b); }
  // Sahipli parselde çiftçi kapı önünde ya da tarla kenarında bekler
  // Sahipli parselde çiftçi tarla kenarı ile avlu arasında gidip gelir, durduğu yerde iş yapar
  if (sahipli) {
    const c = K.ciftci(); c.scale.setScalar(YAPI_OLCEK * 1.15); c.position.set(ux(0.6), 0, vz(0.62)); c.rotation.y = -0.4;
    c.userData.tepki = { tur: 'ciftci' }; g.add(c); g.userData.ciftci = c;
    const [a0, b0, a1, b1] = alan;
    const yol = tarla
      ? [[0.5, 0.5], [0.42, 0.35], [0.58, 0.68], [0.5, 0.5]].map(([u, v]) => [ux(a0 + (a1 - a0) * u), vz(b0 + (b1 - b0) * v)]).filter(([x, z]) => ic(x, z))
      : [[a1 + 0.02, 0.3], [a1 + 0.02, 0.7], [0.62, 0.62], [0.8, 0.5], [(a0 + a1) / 2, b1 + 0.02]].map(([u, v]) => [ux(Math.min(0.94, u)), vz(Math.min(0.94, v))]);
    g.userData.yuruyus = yol.map(([x, z]) => new THREE.Vector3(x, 0, z));
  }
  g.userData.hayvanlar = sonuc.hayvanlar;

  if (sonuc.baca) { sonuc.baca.o.updateMatrixWorld(true); g.userData.baca = sonuc.baca.o.localToWorld(sonuc.baca.o.userData.baca.clone()); }
  g.userData.kanatlar = sonuc.kanatlar;
  return g;
}

// Komşu hücre süsü: tarım küçük ekili tarla, orman/park ağaçlı, konut sevimli ev, ticaret/sanayi dükkân ya da depo, su göl
export function sevimliKomsu(imar, tohum, gece = 0) {
  const r = tohumlu(tohum), g = new THREE.Group();
  const yer = (o, u, v, s) => { o.scale.multiplyScalar(s); o.position.set(ux(u), 0, vz(v)); o.rotation.y = (r() - 0.5) * 0.6; g.add(o); };
  if (imar === 'TARIM') {
    const t = K.tarla(S * 0.8, S * 0.8, { sira: 11, ot: 1.1 }); g.add(t);
    const tur = ['BUGDAY', 'DOMATES', 'CILEK', 'CAY', 'MISIR'][Math.floor(r() * 5)];
    if (tur === 'MISIR') { const n = []; for (let x = -10; x <= 10; x += 2.2) for (let z = -10; z <= 10; z += 2.4) n.push([x / BITKI_OLCEK, z / BITKI_OLCEK]); const m = K.misirTarhi(n, r); m.scale.setScalar(BITKI_OLCEK); m.position.y = 0.2; g.add(m); }
    else { const e = new THREE.Group(); e.position.y = 0.18; ekinEkle(e, tur, 0.6 + r() * 0.4, [0.12, 0.12, 0.88, 0.88], () => true, r); g.add(e); }
  } else if (imar === 'KORUMA' || imar === 'PARK') {
    const n = imar === 'KORUMA' ? 7 : 4;
    for (let i = 0; i < n; i++) yer(r() < 0.5 && imar === 'KORUMA' ? K.cam(r, 1) : K.yuvarlakAgac(r, 1), 0.15 + r() * 0.7, 0.15 + r() * 0.7, 2.2);
    if (imar === 'PARK') yer(Y.bank(), 0.5, 0.5, 2);
  } else if (imar === 'KONUT' || imar === 'KARMA' || imar === 'TURIZM') {
    g.add(K.levha(S * 0.7, S * 0.7, K.RENK.kum, { kalinlik: 0.04, kose: 4 }));
    yer(imar === 'TURIZM' ? Y.pansiyon({ gece }) : Y.ev({ gece, catiRenk: ['#e2574c', '#3f8f8a', '#d98a3a', '#5d7fb0'][Math.floor(r() * 4)] }), 0.45, 0.42, 2.1);
    yer(K.yuvarlakAgac(r, 1), 0.82, 0.8, 1.8);
  } else if (imar === 'TICARET' || imar === 'SANAYI') {
    g.add(K.levha(S * 0.8, S * 0.8, '#d8d2c6', { kalinlik: 0.04, kose: 3 }));
    yer(imar === 'TICARET' ? Y.dukkan({ gece }) : Y.depo(), 0.5, 0.45, 2.1);
  } else if (imar === 'SU') {
    // Gölet: kumlu kıyı, iki tonlu su, nilüfer yaprakları ve kıyıda sazlar
    g.add(K.levha(S * 0.98, S * 0.98, '#e7cf98', { kalinlik: 0.02, kose: 7 }));
    const su = K.levha(S * 0.9, S * 0.9, '#5fb4e0', { kalinlik: 0.04, kose: 6 }); su.position.y = 0.02; g.add(su);
    const derin = K.levha(S * 0.6, S * 0.55, '#4c9fd0', { kalinlik: 0.04, kose: 6 }); derin.position.set((r() - 0.5) * 3, 0.03, (r() - 0.5) * 3); g.add(derin);
    const nil = []; for (let i = 0; i < 9; i++) nil.push([(r() - 0.5) * S * 0.7, 0.12, (r() - 0.5) * S * 0.7, r() * 6, 0.9 + r() * 0.5, 0.05]);
    g.add(K.ornekli(K.kureGeo, '#5aa834', nil, { golge: false }));
    const pembe = nil.filter(() => r() < 0.4).map(([x, , z]) => [x + 0.3, 0.2, z, 0, 0.32, 0.22]);
    if (pembe.length) g.add(K.ornekli(K.kureGeo, '#f4a6c6', pembe, { golge: false }));
    const saz = K.kenarNoktalari(S * 0.88, S * 0.88, 1.6, r).filter(() => r() < 0.55);
    g.add(K.otTutamlari(saz, r, { boy: 1.8, renkler: ['#6a9a3a', '#7fae45'] }));
  } else if (imar === 'YOL') {
    g.add(K.levha(S, S * 0.45, '#cfc6b6', { kalinlik: 0.04, kose: 1 }));
  } else {
    for (let i = 0; i < 2; i++) yer(K.cali(r), 0.2 + r() * 0.6, 0.2 + r() * 0.6, 2.2);
  }
  return g;
}
