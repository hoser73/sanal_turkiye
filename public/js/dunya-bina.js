// Binalar (çiftlik görünümü): OSM bina tabanları sıvalı, ahşap panjurlu ve saksılı cephelere, dikdörtgene yakın olanlarda
// kiremit dokulu kırma çatıya, diğerlerinde düz çatıya (kimisinde güneş enerjili su ısıtıcısı) dönüşür. Gece pencerelerin bir kısmı yanar; güneşe göre
// yere uzun gölge düşer. Oyuncu parselleri parsel kartıyla aynı modellerle (model3d.js) çizilir; fabrika bacası tüter.
import * as THREE from '/vendor/three/three.module.js';
import { kararli, alanHesapla, kaldir, birlestir } from './dunya-ortak.js';
import { kiremitTuvali, dokuCiz } from './ciftlik-doku.js';
import { parselParcalari } from './modeller.js';
import { S } from './model3d.js';
import { parselModeli } from './parsel3d.js';
import * as G from './izgara.js';

// Sıcak sıva tonları, köyde taş; kiremit (dokuyla çarpılır), düz çatılar
const DUVAR_SEHIR = ['#f6ecd6', '#f2e2c2', '#efe6d2', '#ead7b4', '#f7f0e2', '#eedfc6', '#f3e6cc'];
const DUVAR_KOY = ['#e1cfac', '#d6c19c', '#e8d9bb', '#d9c7a4'];
const KIREMIT = ['#d0623a', '#c4552f', '#d97446', '#b94c2c', '#cc6a40', '#c25a34'];
const BETON = ['#bdb19c', '#c8bda9', '#b4a891'];
const KAT = 3.0, BOLME = 3.2, DOKU_HUCRE = 4;   // dokuda 4 × 4 pencere

// Çiftlik cephesi: lekeli sıva, ahşap çerçeveli pencereler, yeşil ya da kahverengi panjurlar, yer yer çiçek saksısı.
// Işık dokusu aynı düzende: gece pencerelerin bir kısmı yanar.
function dokular() {
  const boy = 512, h = boy / DOKU_HUCRE;
  const yap = () => { const c = document.createElement('canvas'); c.width = c.height = boy; return [c, c.getContext('2d')]; };
  const [c, g] = yap(), [ci, gi] = yap();
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, boy, boy);
  for (let i = 0; i < 160; i++) {
    const x = Math.random() * boy, y = Math.random() * boy, r = 6 + Math.random() * 22;
    const d = g.createRadialGradient(x, y, 0, x, y, r);
    d.addColorStop(0, `rgba(${Math.random() < 0.5 ? '150,120,80' : '255,250,235'},0.12)`); d.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = d; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  gi.fillStyle = '#000'; gi.fillRect(0, 0, boy, boy);
  for (let r = 0; r < DOKU_HUCRE; r++) {
    g.fillStyle = 'rgba(120,90,50,0.16)'; g.fillRect(0, r * h + h - 7, boy, 5);
    for (let k = 0; k < DOKU_HUCRE; k++) {
      const x = k * h, y = r * h;
      const panjur = ['#4d7a3a', '#6b4a2a', '#3f6e5a'][(r * 3 + k) % 3];
      // panjurlar
      g.fillStyle = panjur; g.fillRect(x + 22, y + 24, 16, h - 50); g.fillRect(x + h - 38, y + 24, 16, h - 50);
      g.fillStyle = 'rgba(0,0,0,0.25)'; for (let t = y + 28; t < y + h - 30; t += 6) { g.fillRect(x + 24, t, 12, 1.5); g.fillRect(x + h - 36, t, 12, 1.5); }
      // ahşap çerçeve ve cam
      g.fillStyle = '#7a4e2a'; g.fillRect(x + 38, y + 22, h - 76, h - 46);
      const cam = g.createLinearGradient(0, y + 26, 0, y + h - 28);
      cam.addColorStop(0, '#9fc3d4'); cam.addColorStop(1, '#3e5f72');
      g.fillStyle = cam; g.fillRect(x + 42, y + 26, h - 84, h - 54);
      g.fillStyle = '#7a4e2a'; g.fillRect(x + h / 2 - 2, y + 26, 4, h - 54); g.fillRect(x + 42, y + h / 2 - 4, h - 84, 4);
      g.fillStyle = 'rgba(255,255,255,0.3)'; g.fillRect(x + 45, y + 29, 5, h - 62);
      // denizlik ve saksı
      g.fillStyle = '#d8c7a6'; g.fillRect(x + 34, y + h - 26, h - 68, 5);
      if ((r + k) % 2 === 0) {
        g.fillStyle = '#9b4a24'; g.fillRect(x + 40, y + h - 32, h - 80, 7);
        for (let s = x + 44; s < x + h - 42; s += 7) { g.fillStyle = ['#e2483a', '#f2c230', '#f07ab0'][Math.floor(Math.random() * 3)]; g.beginPath(); g.arc(s, y + h - 34, 3.2, 0, Math.PI * 2); g.fill(); g.fillStyle = '#4c8a2e'; g.fillRect(s - 1, y + h - 33, 2, 3); }
      }
      if (Math.random() < 0.45) { gi.fillStyle = ['#ffd38a', '#ffc46b', '#fff0c8'][Math.floor(Math.random() * 3)]; gi.fillRect(x + 42, y + 26, h - 84, h - 54); }
    }
  }
  const t = (cv) => { const d = new THREE.CanvasTexture(cv); d.wrapS = d.wrapT = THREE.RepeatWrapping; d.anisotropy = 4; d.colorSpace = THREE.SRGBColorSpace; return d; };
  return { cephe: t(c), isik: t(ci) };
}

// En küçük alanlı yönlü dikdörtgen (kenar yönlerinden): kırma çatı için
function yonluKutu(h) {
  let en = null;
  for (let i = 0; i < h.length - 1; i++) {
    const dx = h[i + 1][0] - h[i][0], dz = h[i + 1][1] - h[i][1], L = Math.hypot(dx, dz);
    if (L < 0.5) continue;
    const ux = dx / L, uz = dz / L;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [x, z] of h) { const a = x * ux + z * uz, b = -x * uz + z * ux; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
    const alan = (a1 - a0) * (b1 - b0);
    if (!en || alan < en.alan) en = { alan, ux, uz, a0, a1, b0, b1 };
  }
  if (!en) return null;
  let { ux, uz, a0, a1, b0, b1 } = en;
  const ca = (a0 + a1) / 2, cb = (b0 + b1) / 2;
  let A = (a1 - a0) / 2, B = (b1 - b0) / 2;
  if (B > A) { [A, B] = [B, A]; [ux, uz] = [-uz, ux]; }   // u uzun kenar
  const cx = ca * en.ux - cb * en.uz, cz = ca * en.uz + cb * en.ux;
  return { alan: en.alan, cx, cz, ux, uz, A, B };
}

// Dışbükey zarf (gölge izdüşümü)
function zarf(noktalar) {
  const p = noktalar.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cap = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const alt = [], ust = [];
  for (const q of p) { while (alt.length >= 2 && cap(alt.at(-2), alt.at(-1), q) <= 0) alt.pop(); alt.push(q); }
  for (const q of p.reverse()) { while (ust.length >= 2 && cap(ust.at(-2), ust.at(-1), q) <= 0) ust.pop(); ust.push(q); }
  return alt.slice(0, -1).concat(ust.slice(0, -1));
}

class Diziler {
  constructor(uv = false) { this.p = []; this.n = []; this.c = []; this.uv = uv ? [] : null; }
  // tabanRenk: verilirse en alçak köşeler bu renge çekilir (duvar dibi gölgesi)
  ucgen(a, b, c, renk, uva, uvb, uvc, tabanRenk = null) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
    this.p.push(...a, ...b, ...c);
    const altY = tabanRenk ? Math.min(a[1], b[1], c[1]) : null;
    for (const v of [a, b, c]) {
      this.n.push(nx, ny, nz);
      const k = tabanRenk && v[1] === altY ? tabanRenk : renk;
      this.c.push(k.r, k.g, k.b);
    }
    if (this.uv) this.uv.push(...(uva || [0, 0]), ...(uvb || [0, 0]), ...(uvc || [0, 0]));
  }
  // Yukarı bakan üçgen (çatı, gölge): sarım yönünü düzelt
  ustUcgen(a, b, c, renk, uva, uvb, uvc) {
    const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    if (ny < 0) this.ucgen(a, c, b, renk, uva, uvc, uvb); else this.ucgen(a, b, c, renk, uva, uvb, uvc);
  }
  geo(m = null) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    if (this.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (m) g.applyMatrix4(m);
    return g;
  }
  geoEkle(geo, matris, renk) {
    const g = (geo.index ? geo.toNonIndexed() : geo).applyMatrix4(matris);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i += 3) {
      this.ucgen([p.getX(i), p.getY(i), p.getZ(i)], [p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)], [p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)], renk);
    }
  }
}

export function binaKur(ctx) {
  const { sahne, ortak } = ctx;
  const doku = dokular();
  const duvarMalzeme = new THREE.MeshLambertMaterial({ map: doku.cephe, emissiveMap: doku.isik, emissive: '#ffffff', emissiveIntensity: 0, vertexColors: true });
  const kiremit = new THREE.CanvasTexture(kiremitTuvali());
  kiremit.wrapS = kiremit.wrapT = THREE.RepeatWrapping; kiremit.anisotropy = 4; kiremit.colorSpace = THREE.SRGBColorSpace;
  const catiMalzeme = new THREE.MeshLambertMaterial({ map: kiremit, vertexColors: true, side: THREE.DoubleSide });
  const golgeMalzeme = new THREE.MeshBasicMaterial({ color: '#0d1410', transparent: true, opacity: 0.3, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  // Oyuncu parselleri: zemin plakası (tarım: sürülmüş toprak, diğer: çimenli avlu) ve ahşap çit. Hücre 30 × 30 birim.
  const zeminDoku = (ad, tekrar) => { const t = new THREE.CanvasTexture(dokuCiz(ad, 2)); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(tekrar, tekrar); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  const plakaMalz = { toprak: new THREE.MeshLambertMaterial({ map: zeminDoku('doku-toprak', 6) }), cimen: new THREE.MeshLambertMaterial({ map: zeminDoku('doku-cimen', 3) }) };
  // Kalın plaka: arazi ağı örneklenen yükseklikten biraz farklı olabilir, plaka toprağa gömülü otursun
  const plakaGeo = new THREE.BoxGeometry(S - 0.6, 1.4, S - 0.6);
  const citGeo = (() => {
    const p = [], yari = S / 2 - 0.5;
    const direk = (x, z) => p.push({ geo: new THREE.BoxGeometry(0.22, 1.25, 0.22), renk: '#ffffff', yer: [x, 0.62, z] });
    for (let t = -yari; t <= yari + 0.01; t += 3) { direk(t, -yari); direk(t, yari); if (Math.abs(t) < yari) { direk(-yari, t); direk(yari, t); } }
    for (const yy of [0.5, 1.0]) {
      p.push({ geo: new THREE.BoxGeometry(S - 1, 0.12, 0.09), renk: '#e8e8e8', yer: [0, yy, -yari] }, { geo: new THREE.BoxGeometry(S - 1, 0.12, 0.09), renk: '#e8e8e8', yer: [0, yy, yari] });
      p.push({ geo: new THREE.BoxGeometry(0.09, 0.12, S - 1), renk: '#e8e8e8', yer: [-yari, yy, 0] }, { geo: new THREE.BoxGeometry(0.09, 0.12, S - 1), renk: '#e8e8e8', yer: [yari, yy, 0] });
    }
    return birlestir(p);
  })();
  // Tarla örtüsü: tarlayı boydan boya kaplayan yarım silindir plastik tünel ve kemerleri (y ölçeklenmez: 2,4 m yüksek)
  const ortuGeo = new THREE.CylinderGeometry(1, 1, S - 2.4, 18, 1, true, 0, Math.PI).rotateZ(Math.PI / 2).scale(1, 2.4, S / 2 - 1.6);
  const ortuMalz = new THREE.MeshLambertMaterial({ color: '#f4fbff', transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false });
  const kemerGeo = (() => {
    const p = [];
    for (let i = 0; i < 6; i++) {
      const x = -(S / 2 - 1.4) + (i * (S - 2.8)) / 5;
      p.push({ geo: new THREE.TorusGeometry(1, 0.025, 4, 16, Math.PI).rotateY(Math.PI / 2).scale(1, 2.4, S / 2 - 1.6), renk: '#9aa7ad', yer: [x, 0, 0] });
    }
    return birlestir(p);
  })();
  const kemerMalz = new THREE.MeshLambertMaterial({ vertexColors: true });
  const citMalz = { benim: new THREE.MeshLambertMaterial({ vertexColors: true, color: '#d9a640' }), diger: new THREE.MeshLambertMaterial({ vertexColors: true, color: '#8a5a32' }) };
  const panelGeo = new THREE.BoxGeometry(1.9, 0.08, 1.05), depoGeo = new THREE.CylinderGeometry(0.32, 0.32, 1.7, 8).rotateZ(Math.PI / 2);
  let binalar = [], parselGrup = null, sonFc = null;
  const dumanlar = [];
  let bacalar = [];

  function temizle() { kaldir(sahne, binalar); binalar = []; parselTemizle(); }
  function parselTemizle() { if (parselGrup) { kaldir(sahne, parselGrup); parselGrup = null; } for (const d of dumanlar) sahne.remove(d); dumanlar.length = 0; bacalar = []; ortak.isaretler?.([]); }

  function kur(alan) {
    kaldir(sahne, binalar); binalar = [];
    if (alan.zoom >= 13.8) binalariKur(alan);
    parselleriKur();
  }

  function binalariKur(alan) {
    const ayar = ctx.ayar();
    const R = alan.yaricap * 1.15;
    // Tekilleştir: aynı bina komşu karolarda kırpılmış parçalar hâlinde gelebilir → en büyük parça
    const tekil = new Map();
    for (const b of alan.poligonlar('building')) {
      const dis = b.halkalar[0];
      if (dis.length < 4) continue;
      const [x0, z0, x1, z1] = b.kutu;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, d = Math.hypot(cx, cz);
      if (d > R || b.ozellik.hide_3d) continue;
      const alanM2 = Math.abs(alanHesapla(dis));
      if (alanM2 < 12) continue;
      const k = b.id ? `i${b.id}` : `c${Math.round(cx / 2)},${Math.round(cz / 2)}`;
      const onceki = tekil.get(k);
      if (!onceki || onceki.alanM2 < alanM2) tekil.set(k, { ...b, alanM2, d, cx, cz });
    }
    const liste = [...tekil.values()].sort((a, b) => a.d - b.d).slice(0, ayar.bina);
    if (!liste.length) return;

    const duvar = new Diziler(true), cati = new Diziler(true), golge = new Diziler();
    const isik = ctx.isik();
    const gunesYk = Math.max(6, isik.yukseklik ?? 40) * Math.PI / 180, gunesAz = (isik.azimut ?? 200) * Math.PI / 180;
    const gy = [-Math.sin(gunesAz), Math.cos(gunesAz)], golgeOran = Math.min(3, 1 / Math.tan(gunesYk));
    const golgeVar = ayar.golge && (isik.gun ?? 1) > 0.15;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3();

    for (const b of liste) {
      let h = b.halkalar[0].slice();
      if (Math.hypot(h[0][0] - h.at(-1)[0], h[0][1] - h.at(-1)[1]) > 0.01) h.push(h[0]);
      if (alanHesapla(h) < 0) h.reverse();   // dış halka saat yönü tersine (dış normal = (dz, −dx))
      const r = (n) => kararli(b.cx, b.cz, n);
      const oz = b.ozellik;
      // Yükseklik: OSM'de varsa onu kullan; yoksa tabana göre makul kat sayısı
      let yuk = Number(oz.render_height) || 0;
      const taban0 = Number(oz.render_min_height) || 0;
      const bilinmiyor = !oz.render_height || yuk <= 6;
      if (bilinmiyor) {
        const kat = b.alanM2 < 70 ? 1 + Math.floor(r(1) * 2) : b.alanM2 < 280 ? 2 + Math.floor(r(1) * 3) : b.alanM2 < 1500 ? 3 + Math.floor(r(1) * 4) : 1 + Math.floor(r(1) * 2);
        yuk = kat * KAT + 0.6;
      }
      const sanayi = b.alanM2 > 1500 && yuk < 14;
      // Taban yüksekliği: köşelerin en alçağı (eğimde bina gömülü otursun)
      let e = Infinity;
      const adim = Math.max(1, Math.floor(h.length / 6));
      for (let i = 0; i < h.length; i += adim) e = Math.min(e, ctx.yukseklik(h[i][0], h[i][1]));
      e = Math.min(e, ctx.yukseklik(b.cx, b.cz));
      const alt = e - 1.5 + taban0, ust = e + yuk;
      const koy = !bilinmiyor ? false : b.alanM2 < 160 && yuk < 7;
      const duvarPalet = koy ? DUVAR_KOY : DUVAR_SEHIR;
      const duvarRenk = new THREE.Color(sanayi ? '#d9cfbd' : duvarPalet[Math.floor(r(2) * duvarPalet.length)]);
      const tabanRenk = duvarRenk.clone().multiplyScalar(0.7);   // zemine yakın koyu kuşak: bina toprağa otursun
      const uo = Math.floor(r(3) * DOKU_HUCRE) / DOKU_HUCRE, vo = Math.floor(r(4) * DOKU_HUCRE) / DOKU_HUCRE;
      const bolme = sanayi ? BOLME * 3 : BOLME, katY = sanayi ? KAT * 2 : KAT;
      // Duvarlar
      let s = 0;
      for (let i = 0; i < h.length - 1; i++) {
        const [ax, az] = h[i], [bx, bz] = h[i + 1];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 0.05) continue;
        const u0 = s / (bolme * DOKU_HUCRE) + uo, u1 = (s + L) / (bolme * DOKU_HUCRE) + uo;
        const v0 = (alt - e) / (katY * DOKU_HUCRE) + vo, v1 = (ust - e) / (katY * DOKU_HUCRE) + vo;
        const A0 = [ax, alt, az], B0 = [bx, alt, bz], A1 = [ax, ust, az], B1 = [bx, ust, bz];
        duvar.ucgen(A0, B1, B0, duvarRenk, [u0, v0], [u1, v1], [u1, v0], tabanRenk);
        duvar.ucgen(A0, A1, B1, duvarRenk, [u0, v0], [u0, v1], [u1, v1], tabanRenk);
        s += L;
      }
      // Çatı
      const ok = yonluKutu(h);
      const dikdortgen = ok && b.alanM2 / ok.alan > 0.78 && b.alanM2 < 1800 && yuk < 32 && !sanayi;
      if (dikdortgen && r(5) < 0.86) {
        const { cx, cz, ux, uz, A, B } = ok;
        const sac = 0.4, rh = Math.min(3.4, B * 0.5);
        const wx = -uz, wz = ux;
        const P = (a, bb, y) => [cx + ux * a + wx * bb, y, cz + uz * a + wz * bb];
        const E1 = P(A + sac, B + sac, ust), E2 = P(-A - sac, B + sac, ust), E3 = P(-A - sac, -B - sac, ust), E4 = P(A + sac, -B - sac, ust);
        const sirt = Math.max(0, A - B);
        const R1 = P(sirt, 0, ust + rh), R2 = P(-sirt, 0, ust + rh);
        const renk = new THREE.Color(KIREMIT[Math.floor(r(6) * KIREMIT.length)]).offsetHSL(0, 0, (r(7) - 0.5) * 0.06);
        const yan = renk.clone().multiplyScalar(0.88);
        // Kiremit dokusu: u saçak boyunca (0,25 m'de bir kiremit), v yükseklikle (sıralar saçağa paralel)
        const uv = (p, dx, dz) => [(p[0] * dx + p[2] * dz) / 4, (p[1] - ust) / 3.2];
        const yuz = (a, bb, c, rk, dx, dz) => cati.ustUcgen(a, bb, c, rk, uv(a, dx, dz), uv(bb, dx, dz), uv(c, dx, dz));
        yuz(E1, E2, R2, renk, ux, uz); yuz(E1, R2, R1, renk, ux, uz);
        const golgeli = renk.clone().multiplyScalar(0.93);
        yuz(E3, E4, R1, golgeli, ux, uz); yuz(E3, R1, R2, golgeli, ux, uz);
        yuz(E2, E3, R2, yan, wx, wz); yuz(E4, E1, R1, yan, wx, wz);
        // saçak altı (alttan bakınca boşluk görünmesin)
        const alti = new THREE.Color('#2a2420');   // saçak altı: dokunun koyu köşesi değil, düz koyu ton
        cati.ustUcgen(E1, E3, E2, alti); cati.ustUcgen(E1, E4, E3, alti);
      } else {
        // Düz çatı: dokunun açık kiremit ortasından renk alır (uv sabit), ton köşe renginden
        const renk = new THREE.Color(sanayi ? ['#9aa39a', '#a9a08e', '#8f9a8c'][Math.floor(r(6) * 3)] : BETON[Math.floor(r(6) * BETON.length)]);
        const kontur = h.slice(0, -1).map(([x, z]) => new THREE.Vector2(x, z));
        const delikler = b.halkalar.slice(1).map((hh) => hh.map(([x, z]) => new THREE.Vector2(x, z)));
        const tum = kontur.concat(...delikler);
        let ucgenler = [];
        try { ucgenler = THREE.ShapeUtils.triangulateShape(kontur, delikler); } catch { /* bozuk geometri */ }
        for (const [i, j, k] of ucgenler) cati.ustUcgen([tum[i].x, ust, tum[i].y], [tum[j].x, ust, tum[j].y], [tum[k].x, ust, tum[k].y], renk);
        // Güneş enerjili su ısıtıcısı: Anadolu çatılarının simgesi
        if (!sanayi && b.alanM2 > 60 && b.alanM2 < 900 && r(8) < 0.42) {
          const adet = 1 + Math.floor(r(9) * Math.min(4, b.alanM2 / 150));
          for (let k = 0; k < adet; k++) {
            const px = b.cx + (r(10 + k) - 0.5) * Math.sqrt(b.alanM2) * 0.4, pz = b.cz + (r(20 + k) - 0.5) * Math.sqrt(b.alanM2) * 0.4;
            m4.compose(v3.set(px, ust + 0.75, pz + 0.2), q.setFromEuler(new THREE.Euler(-0.6, 0, 0)), s3.set(1, 1, 1));
            cati.geoEkle(panelGeo, m4, new THREE.Color('#25344f'));
            m4.compose(v3.set(px, ust + 1.25, pz - 0.35), q.identity(), s3.set(1, 1, 1));
            cati.geoEkle(depoGeo, m4, new THREE.Color('#e9e9e6'));
          }
        }
      }
      // Gölge: taban + güneşin tersine kaydırılmış taban → dışbükey zarf
      if (golgeVar) {
        const L = Math.min(yuk * golgeOran, 90);
        const nok = [];
        for (const [x, z] of h) { nok.push([x, z], [x + gy[0] * L, z + gy[1] * L]); }
        const z = zarf(nok), y = e + 0.3, renk = new THREE.Color(0, 0, 0);
        for (let i = 1; i + 1 < z.length; i++) golge.ustUcgen([z[0][0], y, z[0][1]], [z[i][0], y, z[i][1]], [z[i + 1][0], y, z[i + 1][1]], renk);
      }
    }
    const duvarMesh = new THREE.Mesh(duvar.geo(), duvarMalzeme);
    const catiMesh = new THREE.Mesh(cati.geo(), catiMalzeme);
    for (const m of [duvarMesh, catiMesh]) { m.frustumCulled = false; sahne.add(m); binalar.push(m); }
    if (golge.p.length) {
      golgeMalzeme.opacity = 0.2 * Math.min(1, (isik.gun ?? 1) * 1.2);
      const g = new THREE.Mesh(golge.geo(), golgeMalzeme);
      g.frustumCulled = false; g.renderOrder = -1;
      sahne.add(g); binalar.push(g);
    }
  }

  // ---------- Oyuncu parselleri ----------
  function parselleriKur() {
    parselTemizle();
    if (!sonFc || map().getZoom() < 14) return;
    parselGrup = new THREE.Group();
    const isaretListesi = [];
    const hucreM = (40075016.686 * Math.cos((ctx.cografi(0, 0)[1] * Math.PI) / 180)) / G.N;
    for (const f of sonFc.features) {
      const { gx, gy, z, yp, ek, kz, ss, s: sahip, e: ekinDurum, su, hh, or: ortu } = f.properties;
      if (!yp && !ek && !kz && !ss && !sahip) continue;
      const [lng, lat] = G.merkez(gx, gy);
      const [x, zz] = ctx.yerel(lng, lat);
      if (Math.hypot(x, zz) > 4000) continue;
      const g = new THREE.Group();
      const parcalar = parselParcalari(z, yp, ek, kz, ss);   // yalnızca baca yeri için
      g.add(parselModeli({ id: `${gx},${gy}`, imar: z, yp, ek, kz, ss }, { ayrinti: 0.45, gece: ortak.gece ?? 0, zeminY: sahip ? 0.1 : 0 }));
      if (sahip) {
        // Sahipli parsel: çiftlik oyunundaki gibi çitle çevrili tarla ya da avlu
        const plaka = new THREE.Mesh(plakaGeo, z === 'TARIM' ? plakaMalz.toprak : plakaMalz.cimen);
        plaka.position.y = -0.6;   // üst yüzü grubun 0,1 m üstünde
        const cit = new THREE.Mesh(citGeo, sahip === 1 ? citMalz.benim : citMalz.diger);
        plaka.userData.paylasimli = cit.userData.paylasimli = true;
        g.add(plaka, cit);
        if (ortu) {
          const tunel = new THREE.Mesh(ortuGeo, ortuMalz), kemer = new THREE.Mesh(kemerGeo, kemerMalz);
          tunel.position.y = kemer.position.y = 0.1;
          tunel.renderOrder = 2;
          tunel.userData.paylasimli = kemer.userData.paylasimli = true;
          g.add(tunel, kemer);
        }
      }
      g.position.set(x, ctx.yukseklik(x, zz) + (sahip ? 0.25 : 0.05), zz);   // sahipli: hafif yükseltilmiş tarla yatağı
      // Kendi parselimde baloncuk: hasat hazır, sulama bekliyor, hayvan ürünü hazır
      if (sahip === 1) {
        const tur = ekinDurum === 2 ? 'hasat' : hh ? 'hayvan' : su ? 'su' : null;
        if (tur) isaretListesi.push({ x, y: g.position.y, z: zz, tur });
      }
      g.scale.set(hucreM / S, 1, hucreM / S);
      parselGrup.add(g);
      const baca = parcalar.find((p) => p.baca && !p.insaat);
      if (baca) bacalar.push({ x: x + (baca.u - 0.5) * hucreM, y: g.position.y + baca.tavan + 1.2, z: zz + (baca.v - 0.5) * hucreM });
    }
    sahne.add(parselGrup);
    ortak.isaretler?.(isaretListesi);
    const dumanMalzeme = () => new THREE.MeshLambertMaterial({ color: '#efedea', transparent: true, opacity: 0.6, depthWrite: false });
    for (const b of bacalar) {
      for (let i = 0; i < 7; i++) {
        const d = new THREE.Mesh(new THREE.IcosahedronGeometry(1.3, 0), dumanMalzeme());
        d.userData = { faz: i / 7, b };
        sahne.add(d);
        dumanlar.push(d);
      }
    }
  }
  const map = () => ctx.map;

  return {
    kur, temizle,
    parseller(fc) { sonFc = fc; },
    parselleriKur,
    kare(dt) {
      duvarMalzeme.emissiveIntensity = (ortak.gece ?? 0) * 1.9;
      for (const d of dumanlar) {
        d.userData.faz = (d.userData.faz + dt * 0.22) % 1;
        const f = d.userData.faz, b = d.userData.b;
        const ruz = (ortak.ruzgar?.yon ?? 250) * Math.PI / 180;
        d.position.set(b.x - Math.sin(ruz) * f * 8, b.y + f * 14, b.z + Math.cos(ruz) * f * 8);
        d.scale.setScalar(0.6 + f * 2.2);
        d.material.opacity = 0.62 * (1 - f);
      }
      return dumanlar.length > 0;
    },
  };
}
