// 3B dünya katmanı: haritanın kendi WebGL bağlamında çizilen three.js sahnesi (MapLibre özel katmanı).
// Ağaçlar, binalar (çatı, pencere, gölge), oyuncu yapıları, araçlar, kuşlar, sürüler ve bulutlar burada yaşar.
// Sahne, harita merkezindeki bir kökene göre metre cinsinden kurulur (x doğu, y yukarı, z güney); harita kayınca
// görünür alan yeniden okunur. İçerik OpenStreetMap vektör karolarından gelir (querySourceFeatures), ağ isteği yoktur.
import * as THREE from '/vendor/three/three.module.js';
import { isikDurumu } from './harita-gorsel.js';
import { pencereMalzemesi } from './model3d.js';
import { poligonlar } from './dunya-ortak.js';
import { bitkiKur } from './dunya-bitki.js';
import { binaKur } from './dunya-bina.js';
import { hayatKur } from './dunya-hayat.js';
import { bulutKur } from './dunya-bulut.js';
import { efektKur } from './dunya-efekt.js';

// Grafik düzeyleri: sayılar üst sınırdır, görünür alana göre azalır
export const GRAFIK = {
  ultra: { ad: 'Ultra', agac: 30000, bina: 5000, yaricap: 1800, araba: 90, kus: 3, koyun: 50, bulut: 60, golge: true, piksel: 1.5, animasyon: true },
  yuksek: { ad: 'Yüksek', agac: 14000, bina: 2500, yaricap: 1200, araba: 45, kus: 2, koyun: 25, bulut: 40, golge: true, piksel: 1.25, animasyon: true },
  dengeli: { ad: 'Dengeli', agac: 6000, bina: 1200, yaricap: 750, araba: 18, kus: 1, koyun: 10, bulut: 20, golge: false, piksel: 1, animasyon: true },
  hafif: { ad: 'Hafif', kapali: true, piksel: 1 },
};
export function varsayilanGrafik() {
  const dar = Math.min(screen.width, screen.height) < 700;
  const zayif = (navigator.hardwareConcurrency || 4) <= 4 || (navigator.deviceMemory || 8) <= 4;
  return dar ? (zayif ? 'hafif' : 'dengeli') : zayif ? 'dengeli' : 'yuksek';
}

const DUNYA_R = 6371008.8;   // MapLibre'nin ortalama Dünya yarıçapı (WGS84 ekvator yarıçapı yükseklikleri ~%0,1 gömerdi)
const mx = (lng) => (lng + 180) / 360;
const my = (lat) => { const r = (lat * Math.PI) / 180; return (1 - Math.log(Math.tan(Math.PI / 4 + r / 2)) / Math.PI) / 2; };
const lngOf = (x) => x * 360 - 180;
const latOf = (y) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;

export function dunyaKur(map, { grafik = 'yuksek' } = {}) {
  let ayar = GRAFIK[grafik] || GRAFIK.yuksek;
  let etkin = !ayar.kapali;
  let renderer = null;
  const sahne = new THREE.Scene();
  const kamera = new THREE.Camera();
  const gok = new THREE.HemisphereLight('#dceefc', '#8a7a5c', 1.1);
  const gunes = new THREE.DirectionalLight('#fff1d6', 2.0);
  sahne.add(gok, gunes, gunes.target);

  // Köken: sahnenin (0,0,0) noktası; metre → Mercator dönüşümü
  const koken = { x: 0, y: 0, s: 1, lng: 0, lat: 0, ayarli: false };
  const kokenMatrisi = new THREE.Matrix4();
  const yerel = (lng, lat) => [(mx(lng) - koken.x) / koken.s, (my(lat) - koken.y) / koken.s];
  const cografi = (x, z) => [lngOf(koken.x + x * koken.s), latOf(koken.y + z * koken.s)];
  const araziVar = () => !!map.getTerrain?.();
  const abartma = () => map.getTerrain?.()?.exaggeration || 1;
  // Yükseklik: 12 m'lik ızgarada önbelleklenir, arası çift doğrusal (binlerce ağaç ve araç için hızlı)
  const YIZ = 12;
  let yOnbellek = new Map();
  function ham(ix, iz) {
    const k = ix * 1000003 + iz;
    let v = yOnbellek.get(k);
    if (v === undefined) {
      const [lng, lat] = cografi(ix * YIZ, iz * YIZ);
      v = map.queryTerrainElevation([lng, lat]) ?? 0;
      yOnbellek.set(k, v);
    }
    return v;
  }
  function yukseklik(x, z) {
    if (!araziVar()) return 0;
    const fx = x / YIZ, fz = z / YIZ, ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    const a = ham(ix, iz), b = ham(ix + 1, iz), c = ham(ix, iz + 1), d = ham(ix + 1, iz + 1);
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }
  // Çizim kökeni: sahnenin ekrana yansıtıldığı köken. Yeni kurulum bitene dek eskisi kalır.
  const cizim = { x: 0, y: 0, s: 1 };
  function kokenAyarla() {
    const c = map.getCenter();
    koken.lng = c.lng; koken.lat = c.lat;
    koken.x = mx(c.lng); koken.y = my(c.lat);
    koken.s = 1 / (2 * Math.PI * DUNYA_R * Math.cos((c.lat * Math.PI) / 180));   // 1 m kaç Mercator birimi
  }
  function cizimKokeni() {
    Object.assign(cizim, { x: koken.x, y: koken.y, s: koken.s });
    // three.js (y yukarı, z güney) → Mercator (x doğu, y güney, z yukarı)
    kokenMatrisi.makeTranslation(cizim.x, cizim.y, 0)
      .multiply(new THREE.Matrix4().makeScale(cizim.s, cizim.s, cizim.s))
      .multiply(new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1));
    for (const k of katmanlar) k.grup.position.set(0, 0, 0);
    koken.ayarli = true;
  }

  // Ortak zaman ve rüzgâr (ağaç salınımı, bulut sürüklenmesi)
  const ortak = { zaman: { value: 0 }, ruzgar: { yon: 250, hiz: 12 }, hava: [] };
  // Hareketli öğeler (araç, hayvan, kuş, bulut sürüklenmesi): kapatılabilir; tercih tarayıcıda saklanır
  let hareket = true;
  try { hareket = localStorage.getItem('st-hareket') !== 'kapali'; } catch { /* özel pencere */ }
  const ctx = { THREE, sahne, map, yerel, cografi, yukseklik, araziVar, abartma, ayar: () => ayar, isik: isikDurumu, ortak, hareket: () => hareket };
  // Her katman kendi grubunda: yeniden kurulum adım adım yapılırken henüz kurulmamış katmanlar eski kökende kalabilir
  const katmanlar = [bitkiKur, binaKur, hayatKur, bulutKur, efektKur].map((kur) => {
    const grup = new THREE.Group();
    sahne.add(grup);
    return { grup, p: kur({ ...ctx, sahne: grup }) };
  });
  const parcalar = katmanlar.map((k) => k.p);
  const efekt = katmanlar[4].p;
  ortak.isaretler = (liste) => efekt.isaretler(liste);   // bina katmanı parsel baloncuklarını buraya verir

  // ---------- Görünür alanın okunması ----------
  function alanOku() {
    const z = map.getZoom();
    const mpp = (156543.034 * Math.cos((koken.lat * Math.PI) / 180)) / 2 ** z;
    const c = map.getCanvas();
    const kosegen = Math.hypot(c.clientWidth, c.clientHeight);
    const egim = map.getPitch();
    const gorus = mpp * kosegen * (0.55 + Math.min(1.6, egim / 40));
    return { zoom: z, mpp, gorus, yaricap: Math.min(ayar.yaricap || 1000, Math.max(350, gorus)) };
  }
  function kaynakOku(katman, filtre) {
    if (!map.getSource('omt')) return [];
    try { return map.querySourceFeatures('omt', { sourceLayer: katman, filter: filtre }); } catch { return []; }
  }

  let yenileZamanlayici = 0, sonKurulum = null, kurulumNo = 0;
  const sureler = [0, 0, 0, 0];   // son kurulumda katman başına ms (ağaç, bina, hayat, bulut)
  const birKare = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  async function yenile({ zorla = false } = {}) {
    if (!etkin || !renderer) return;
    const z = map.getZoom();
    if (z < 9.3) { kurulumNo++; for (const p of parcalar) p.temizle?.(); sonKurulum = null; map.triggerRepaint(); return; }
    const c = map.getCenter();
    if (!zorla && sonKurulum) {
      const [dx, dz] = yerel(c.lng, c.lat);
      const kayma = Math.hypot(dx, dz);
      if (kayma < sonKurulum.yaricap * 0.3 && Math.abs(z - sonKurulum.zoom) < 0.6) return;
    }
    const no = ++kurulumNo;
    const ilk = !koken.ayarli;
    kokenAyarla();
    yOnbellek = new Map();
    const alan = alanOku();
    const onbellek = new Map();
    const anahtar = (k, f) => k + JSON.stringify(f ?? null);
    alan.oku = (k, f) => { const a = anahtar(k, f); if (!onbellek.has(a)) onbellek.set(a, kaynakOku(k, f)); return onbellek.get(a); };
    alan.poligonlar = (k, f) => {
      const a = 'p' + anahtar(k, f);
      if (!onbellek.has(a)) onbellek.set(a, alan.oku(k, f).flatMap((o) => poligonlar(o, yerel)));
      return onbellek.get(a);
    };
    if (ilk) cizimKokeni();
    // Katmanlar ayrı karelerde kurulur (tek uzun duraklama yerine kısa adımlar); yeni kurulan katman, çizim kökenine
    // göre kaydırılmış grubunda hemen doğru yerde görünür
    for (const k of katmanlar) {
      await birKare();
      if (no !== kurulumNo) return;   // bu arada yeni bir kurulum başladı
      const t0 = performance.now();
      try { k.p.kur(alan); } catch (e) { console.warn('3B dünya katmanı', e); }
      sureler[katmanlar.indexOf(k)] = Math.round(performance.now() - t0);
      k.grup.position.set((koken.x - cizim.x) / cizim.s, 0, (koken.y - cizim.y) / cizim.s);
      map.triggerRepaint();
    }
    cizimKokeni();
    sonKurulum = alan;
    map.triggerRepaint();
  }
  // OSM ve yükselti karoları gelince kur. "idle" olayı beklenmez: canlandırma sürerken (ya da imar karoları
  // hazırlanırken) hiç gelmeyebilir. En çok 2,5 sn beklenir; arazi geç gelirse bir kez daha kurulur.
  const kaynakHazir = (id) => { try { return !map.getSource(id) || map.isSourceLoaded(id); } catch { return true; } };
  function yenilePlanla(gecikme = 220) {
    clearTimeout(yenileZamanlayici);
    const bas = performance.now();
    const dene = () => {
      const hazir = kaynakHazir('omt') && (!araziVar() || kaynakHazir('yukselti-arazi'));
      if (hazir || performance.now() - bas > 2500) {
        yenile();
        if (!hazir) { sonKurulum = null; yenileZamanlayici = setTimeout(() => { if (kaynakHazir('omt')) yenile(); }, 2500); }
      } else yenileZamanlayici = setTimeout(dene, 150);
    };
    yenileZamanlayici = setTimeout(dene, gecikme);
  }
  map.on('moveend', () => yenilePlanla());
  map.on('terrain', () => { sonKurulum = null; yenilePlanla(600); });

  // ---------- Işık: güneşin gerçek konumu (harita-gorsel.js atmosfer durumu) ----------
  function isikGuncelle() {
    const d = isikDurumu();
    const az = ((d.azimut ?? 200) * Math.PI) / 180, yk = (Math.max(6, d.yukseklik ?? 45) * Math.PI) / 180;
    gunes.position.set(Math.sin(az) * Math.cos(yk) * 1000, Math.sin(yk) * 1000, -Math.cos(az) * Math.cos(yk) * 1000);
    const gun = d.gun ?? 1, aksam = d.aksam ?? 0;
    // Gece: ay ışığı (soğuk mavi) ve gökyüzü yansıması; binalar karanlıkta da okunur, pencereler yanar
    gunes.color.set(gun < 0.35 ? '#a9bde6' : aksam > 0.3 ? '#ffc58f' : '#fff3df');
    gunes.intensity = 0.55 + 1.85 * gun;
    gok.intensity = 0.95 + 0.25 * gun;
    gok.color.set(gun < 0.4 ? '#7d93c4' : '#dceefc');
    gok.groundColor.set(gun < 0.4 ? '#2c3550' : '#8a7a5c');
    if (renderer) {
      // Çiftlik: renkleri canlı tutan nötr ton eşleme, sıcak ve biraz parlak
      renderer.toneMapping = THREE.NeutralToneMapping;
      renderer.toneMappingExposure = 1.08 + (1 - gun) * 0.25;
    }
    pencereMalzemesi.emissiveIntensity = (d.gece ?? 0) * 1.4;
    ortak.gece = d.gece ?? 0;
    ortak.gunesYonu = gunes.position.clone().normalize();
  }

  // ---------- MapLibre özel katmanı ----------
  let son = 0;
  const katman = {
    id: 'dunya-3d', type: 'custom', renderingMode: '3d',
    onAdd(_m, gl) {
      renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl });
      renderer.autoClear = false;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      yenilePlanla(50);
    },
    render(gl, args) {
      if (!etkin || !koken.ayarli || map.getZoom() < 9.3) return;
      const simdi = performance.now() / 1000;
      const dt = Math.min(0.1, son ? simdi - son : 0);
      son = simdi;
      ortak.zaman.value = simdi;
      isikGuncelle();
      const z = map.getZoom();
      let canli = false, akici = false;
      for (const p of parcalar) { const r = p.kare?.(dt, z); if (r === 'akici') akici = true; else if (r) canli = true; }
      kamera.projectionMatrix.fromArray(args.defaultProjectionData.mainMatrix).multiply(kokenMatrisi);
      kamera.projectionMatrixInverse.copy(kamera.projectionMatrix).invert();
      renderer.resetState();
      renderer.setViewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      renderer.render(sahne, kamera);
      if (akici) map.triggerRepaint();   // kısa eylem efekti: akıcı
      else if (canli && hareket && ayar.animasyon) tikPlanla();
    },
  };
  const hareketAz = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Canlandırma saati: hareketli öğeler varken haritayı saniyede ~20 kez yeniden çizdirir (her karede değil).
  // Harita sürüklenir ya da yakınlaşırken zaten çizildiğinden ek istek gönderilmez.
  let tik = 0;
  function tikPlanla() {
    if (tik) return;
    tik = setTimeout(() => {
      tik = 0;
      if (!document.hidden && !hareketAz() && !map.isMoving() && etkin) map.triggerRepaint();
    }, 50);
  }

  function ekle() {
    if (map.getLayer('dunya-3d')) return;
    // Etiketlerin altında, oyun yapılarının üstünde
    const once = ['secili-isik', 'imlec', 'il-ad'].find((id) => map.getLayer(id));
    map.addLayer(katman, once);
  }
  if (etkin) ekle();

  return {
    ctx,
    // MapLibre oyun yapıları (fill-extrusion) bu katman açıkken gizlenir: aynı yapılar burada ayrıntılı çizilir
    aktifMi: () => etkin && map.getZoom() >= 14,
    grafikAyarla(ad) {
      ayar = GRAFIK[ad] || GRAFIK.yuksek;
      etkin = !ayar.kapali;
      if (etkin) { ekle(); sonKurulum = null; yenilePlanla(30); }
      else { for (const p of parcalar) p.temizle?.(); if (map.getLayer('dunya-3d')) map.removeLayer('dunya-3d'); renderer = null; }
      map.triggerRepaint();
    },
    etkinlestir(acik) {
      const onceki = etkin;
      etkin = acik && !ayar.kapali;
      if (etkin && !onceki) { ekle(); sonKurulum = null; yenilePlanla(30); }
      if (!etkin) for (const p of parcalar) p.temizle?.();
      map.triggerRepaint();
    },
    parseller(fc) { parcalar[1].parseller?.(fc); if (koken.ayarli && etkin) { parcalar[1].parselleriKur?.(); map.triggerRepaint(); } },
    hava(liste) { ortak.hava = liste || []; },
    // Eylem efekti (hasat, sulama, ekim, toplama): parsel merkezinde kısa parçacık patlaması
    efekt(tur, lng, lat, ikon) {
      if (!etkin || !koken.ayarli || hareketAz()) return;
      const [x, z] = yerel(lng, lat);
      if (Math.hypot(x, z) > 6000) return;
      efekt.patlat(tur, x, yukseklik(x, z), z, ikon);
      map.triggerRepaint();
    },
    sureler: () => [...sureler],
    hareketli: () => hareket,
    hareketAyarla(acik) {
      hareket = !!acik;
      try { localStorage.setItem('st-hareket', hareket ? 'acik' : 'kapali'); } catch { /* yok say */ }
      katmanlar[2].p.temizle?.();
      sonKurulum = null; yenilePlanla(30);
    },
    yenile: () => { sonKurulum = null; yenilePlanla(30); },
  };
}
