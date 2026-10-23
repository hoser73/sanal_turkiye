// Harita görsel katmanı: tuvalde çizilen desenler ve renkli emoji simgeleri, gerçek saate bağlı gökyüzü / gece / şehir ışıkları,
// sahip olunan ve seçili parsellerin ışıması, gerçek havaya göre yağmur ve kar efekti. Hepsi isteğe bağlı süslemedir;
// canlandırmalar oyunun kendi ayarına bağlıdır (sistemin hareketi azalt tercihi dünyayı dondurmaz).
import { gunesKonumu } from './gunes.js';
import { CIFTLIK_DOKULARI, dokuCiz } from './ciftlik-doku.js';

const ORAN = Math.min(2, window.devicePixelRatio || 1);

function tuval(w, h) {
  const c = document.createElement('canvas');
  c.width = w * ORAN; c.height = h * ORAN;
  const g = c.getContext('2d');
  g.scale(ORAN, ORAN);
  return [c, g];
}
const resimVerisi = (c) => c.getContext('2d').getImageData(0, 0, c.width, c.height);

// ---------- Desenler (fill-pattern) ve simgeler
const DESEN = {
  'desen-tarla': () => {
    const [c, g] = tuval(24, 24);
    g.strokeStyle = 'rgba(150, 120, 60, 0.35)'; g.lineWidth = 1.4;
    for (let y = 3; y < 24; y += 6) { g.beginPath(); g.moveTo(0, y); g.lineTo(24, y); g.stroke(); }
    return c;
  },
  'desen-orman': () => {
    // Üstten bakılan ağaç taçları: iki tonlu yuvarlaklar, hafif gölgeli
    const [c, g] = tuval(32, 32);
    const tac = (x, y, r) => {
      g.fillStyle = 'rgba(52, 82, 40, 0.28)'; g.beginPath(); g.arc(x + 1.2, y + 1.4, r, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(86, 128, 66, 0.55)'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(150, 190, 110, 0.45)'; g.beginPath(); g.arc(x - r * 0.3, y - r * 0.3, r * 0.45, 0, Math.PI * 2); g.fill();
    };
    tac(7, 8, 4.5); tac(22, 6, 3.6); tac(15, 20, 5); tac(28, 24, 3.4); tac(4, 26, 3.2);
    return c;
  },
  'desen-cayir': () => {
    const [c, g] = tuval(16, 16);
    g.fillStyle = 'rgba(110, 150, 80, 0.4)';
    for (const [x, y] of [[3, 4], [11, 2], [7, 10], [14, 13], [2, 14]]) g.fillRect(x, y, 1.4, 1.4);
    return c;
  },
  zirve: () => {
    const [c, g] = tuval(18, 14);
    g.fillStyle = '#7a5a3a'; g.beginPath(); g.moveTo(9, 1); g.lineTo(17, 13); g.lineTo(1, 13); g.closePath(); g.fill();
    g.fillStyle = '#fbf6ea'; g.beginPath(); g.moveTo(9, 1); g.lineTo(11.8, 5.2); g.lineTo(9.6, 4.6); g.lineTo(8, 5.6); g.lineTo(6.4, 4.8); g.closePath(); g.fill();
    return c;
  },
};

// Renkli emoji: harita yazı tipleri emojiyi tek renk çizer; tarayıcının emoji yazı tipiyle resme dönüştürülür
function emojiResmi(emoji, boyut = 26, rozet = true) {
  const [c, g] = tuval(boyut + 8, boyut + 8);
  const m = (boyut + 8) / 2;
  if (rozet) {
    g.fillStyle = 'rgba(255, 252, 244, 0.92)'; g.strokeStyle = 'rgba(80, 60, 40, 0.18)'; g.lineWidth = 1;
    g.beginPath(); g.arc(m, m, m - 1.5, 0, Math.PI * 2); g.fill(); g.stroke();
  }
  g.font = `${boyut * 0.78}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(emoji, m, m + boyut * 0.05);
  return c;
}

// Eksik simge ve desenler istendiği anda çizilir (MapLibre 6: çözücü; uyarı üretmez). Eski sürümlerde olaya düşülür.
export function simgeleriBagla(map) {
  const coz = (id) => {
    if (map.hasImage(id)) return;
    let c = null;
    if (DESEN[id]) c = DESEN[id]();
    else if (CIFTLIK_DOKULARI.includes(id)) c = dokuCiz(id, ORAN);
    else if (id.startsWith('e:')) c = emojiResmi(id.slice(2), 24, true);
    else if (id.startsWith('ec:')) c = emojiResmi(id.slice(3), 30, false);
    if (c) map.addImage(id, resimVerisi(c), { pixelRatio: ORAN });
  };
  if (typeof map.setMissingStyleImageResolver === 'function') map.setMissingStyleImageResolver(coz);
  else map.on('styleimagemissing', (e) => coz(e.id));
}

// ---------- Gökyüzü, gece ve şehir ışıkları
const karistir = (a, b, t) => {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
};
// Güneş yüksekliğine göre gündüz (1) → gece (0) geçişi; alacakaranlık −8°…+8°
const gunduzlukOrani = (yk) => Math.min(1, Math.max(0, (yk + 8) / 16));
const GOK = {
  harita: {
    gunduz: { gok: '#9ccbe6', ufuk: '#efe4cf', sis: '#efe9dc' },
    aksam: { gok: '#f2a76b', ufuk: '#f6d7a8', sis: '#f1dcc0' },
    gece: { gok: '#0f1c33', ufuk: '#2d3b5c', sis: '#1d2740' },
  },
  // Çiftlik: berrak yaz göğü, sıcak ufuk
  ciftlik: {
    gunduz: { gok: '#5aaee8', ufuk: '#dff0fb', sis: '#eef3e2' },
    aksam: { gok: '#f59a5e', ufuk: '#ffd9a6', sis: '#f6dcbc' },
    gece: { gok: '#0d1b38', ufuk: '#283f70', sis: '#1b2a4c' },
  },
};

let ayar = 'gercek';   // gercek | gunduz
let tema = 'ciftlik';
let sonGece = -1, sonDurum = { gece: 0, aksam: 0, gun: 1 };
export function isikAyari(yeni) { if (yeni) ayar = yeni; return ayar; }
export function gokTemasi(yeni) { if (yeni) { tema = yeni; sonGece = -1; } return tema; }
// 3B dünya katmanı (dunya3d.js) ışığını bu durumdan okur
export const isikDurumu = () => sonDurum;

export function atmosferGuncelle(map, t = Date.now()) {
  const c = map.getCenter();
  const g = gunesKonumu(c.lng, c.lat, t);
  const gun = ayar === 'gunduz' ? 1 : gunduzlukOrani(g.yukseklik);
  const aksam = ayar === 'gunduz' ? 0 : Math.max(0, 1 - Math.abs(g.yukseklik - 2) / 10);   // gün doğumu/batımı turuncusu
  const P = GOK[tema] || GOK.harita;
  const renk = (k) => {
    const temel = karistir(P.gece[k], P.gunduz[k], gun);
    return karistir(temel, P.aksam[k], aksam * 0.75);
  };
  try {
    map.setSky({ 'sky-color': renk('gok'), 'horizon-color': renk('ufuk'), 'fog-color': renk('sis'),
      'sky-horizon-blend': 0.55, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.8, 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 10, 1, 12, 0] });
  } catch { /* eski sürümlerde gökyüzü yok */ }
  const gece = 1 - gun;
  sonDurum = { gece, aksam, gun, yukseklik: g.yukseklik, azimut: g.azimut, gok: renk('gok'), sis: renk('sis') };
  if (map.getLayer('gece')) map.setPaintProperty('gece', 'fill-opacity', gece * 0.55);
  if (map.getLayer('sehir-isik')) map.setPaintProperty('sehir-isik', 'circle-opacity', gece * 0.6);
  if (map.getLayer('gece-yol')) map.setPaintProperty('gece-yol', 'line-opacity', gece * 0.85);
  if (map.getLayer('gece-yerlesim')) map.setPaintProperty('gece-yerlesim', 'fill-opacity', gece * 0.08);
  // 3B binalar gece serin ve koyu, pencereler yerine çatı kenarı sıcak; gündüz kendi tonları
  if (map.getLayer('bina-3d')) map.setPaintProperty('bina-3d', 'fill-extrusion-opacity', 0.94 - gece * 0.08);
  document.documentElement.style.setProperty('--harita-gece', gece.toFixed(2));
  // Arazi (3B) kipi zemini dokuya işleyip önbellekler; boya değişince dokuyu yenilemek için araziyi yeniden kur
  // (yalnızca gece oranı belirgin değiştiğinde: alacakaranlıkta birkaç kez, gün içinde hiç)
  if (Math.abs(gece - sonGece) > 0.03) {
    sonGece = gece;
    const arazi = map.getTerrain?.();
    if (arazi) map.setTerrain({ ...arazi });
  }
  map.triggerRepaint();
  return { ...g, gun, aksam };
}
export function geceKatmani(map, beforeId) {
  if (map.getLayer('gece')) return;
  // Dünyayı kaplayan örtü: altındaki katmanları karartır, üstündekiler (3B, etiketler) etkilenmez. Arazi (3B) kipinde
  // zemine işlemesi için ilk fill-extrusion katmanından ÖNCE olmalı; "background" türü arazi kipinde çizilmez.
  map.addSource('gece', { type: 'geojson', data: { type: 'Feature', properties: {},
    geometry: { type: 'Polygon', coordinates: [[[-179, -84], [-179, 84], [179, 84], [179, -84], [-179, -84]]] } } });
  map.addLayer({ id: 'gece', type: 'fill', source: 'gece', paint: { 'fill-color': '#14213d', 'fill-opacity': 0 } }, beforeId);
  if (!map.getSource('omt')) return;
  // Gece ışıkları örtünün üstünde: yerleşimlerde sıcak bir pus, yollarda sodyum lamba parıltısı
  map.addLayer({ id: 'gece-yerlesim', type: 'fill', source: 'omt', 'source-layer': 'landuse', minzoom: 8,
    filter: ['match', ['get', 'class'], ['residential', 'suburb', 'quarter', 'neighbourhood', 'commercial', 'retail'], true, false],
    paint: { 'fill-color': '#ffb85c', 'fill-opacity': 0 } }, beforeId);
  map.addLayer({ id: 'gece-yol', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 8,
    filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor'], true, false],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['match', ['get', 'class'], ['motorway', 'trunk'], '#ffd08a', '#ffbe6b'],
      'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 8, ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], 1.2, 0.3], 14, ['match', ['get', 'class'], 'minor', 2.5, 5], 18, ['match', ['get', 'class'], 'minor', 10, 18]],
      'line-blur': ['interpolate', ['linear'], ['zoom'], 8, 1, 16, 6], 'line-opacity': 0 } }, beforeId);
}

// ---------- Parsel ışıması
// Işıma durağandır: boya özelliğini canlandırmak geçiş başlatır ve haritayı her karede baştan çizdirir (takılma)
export function isimaBaslat() {}

// ---------- Yağış efekti (yağmur / kar), ilin gerçek havasına göre
let yagis = null;
export function yagisKur(kap) {
  if (yagis) return yagis;
  const c = document.createElement('canvas');
  c.className = 'yagis-katmani';
  c.setAttribute('aria-hidden', 'true');
  kap.appendChild(c);
  const g = c.getContext('2d');
  let parcaciklar = [], tur = null, siddet = 0, kare = 0;
  const boyutla = () => { c.width = kap.clientWidth * ORAN; c.height = kap.clientHeight * ORAN; };
  boyutla();
  new ResizeObserver(boyutla).observe(kap);
  const yeni = () => ({ x: Math.random() * c.width, y: Math.random() * c.height, h: 0.6 + Math.random() * 0.8, s: Math.random() });
  function ciz() {
    kare = requestAnimationFrame(ciz);
    if (document.hidden) return;
    g.clearRect(0, 0, c.width, c.height);
    if (!tur) return;
    // Yağışlı havanın tonu: yağmurda gri-mavi kasvet, karda soğuk beyazlık
    g.fillStyle = tur === 'yagmur' ? 'rgba(70, 95, 120, 0.12)' : 'rgba(225, 235, 248, 0.16)';
    g.fillRect(0, 0, c.width, c.height);
    const egik = tur === 'yagmur' ? 2.2 * ORAN : 0;
    g.strokeStyle = tur === 'yagmur' ? 'rgba(215, 232, 245, 0.75)' : 'rgba(110, 135, 165, 0.45)';
    g.fillStyle = 'rgba(255, 255, 255, 0.95)'; g.lineWidth = (tur === 'yagmur' ? 1.3 : 0.8) * ORAN;
    for (const p of parcaciklar) {
      if (tur === 'yagmur') {
        g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - egik * 3, p.y + 14 * ORAN * p.h); g.stroke();
        p.y += 16 * ORAN * p.h; p.x -= egik;
      } else {
        g.beginPath(); g.arc(p.x, p.y, (1.2 + p.s * 1.8) * ORAN, 0, Math.PI * 2); g.fill(); g.stroke();
        p.y += (0.8 + p.h) * ORAN; p.x += Math.sin((p.y + p.s * 100) / (40 * ORAN)) * 0.6 * ORAN;
      }
      if (p.y > c.height || p.x < 0) { p.x = Math.random() * c.width * 1.1; p.y = -10; }
    }
  }
  yagis = {
    ayarla(yeniTur, yeniSiddet = 0.5) {
      tur = yeniTur; siddet = yeniSiddet;
      const adet = tur ? Math.round((tur === 'yagmur' ? 320 : 300) * Math.min(1.6, 0.4 + siddet) * (c.width * c.height) / (1440 * 900 * ORAN * ORAN)) : 0;
      parcaciklar = Array.from({ length: adet }, yeni);
      c.classList.toggle('acik', !!tur);
      if (tur && !kare) ciz();
      if (!tur) { cancelAnimationFrame(kare); kare = 0; g.clearRect(0, 0, c.width, c.height); }
    },
  };
  return yagis;
}
// WMO hava kodundan yağış türü
export function yagisTuru(h) {
  if (!h) return null;
  const kod = h.kod ?? null;
  const kar = (kod >= 71 && kod <= 77) || kod === 85 || kod === 86;
  if (kar) return 'kar';
  if ((kod >= 51 && kod <= 67) || (kod >= 80 && kod <= 82) || kod >= 95 || h.yagis > 0.1) return h.sicaklik <= 0 ? 'kar' : 'yagmur';
  return null;
}
