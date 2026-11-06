// Ulusal harita: ülke görünümü (81 il) → ilçe → mahalle → parsel hücreleri. 2B / 3B kipleri.
// Plan §2.4: ülke ölçeğinde parsel yüklenmez; imar hücreleri z14 karolarıyla, oyuncu parselleri görünür alanla gelir.
import * as maplibregl from '/vendor/maplibre/maplibre-gl.mjs';
import { stilOlustur, SIRA, KAYNAK } from './stil.js';
import { esc } from './yardimci.js';
import * as G from './izgara.js';
import { parselParcalari } from './modeller.js';
import { gunesKonumu, isikRengi } from './gunes.js';
import { simgeleriBagla, atmosferGuncelle, geceKatmani, isimaBaslat, yagisKur, yagisTuru, isikAyari } from './harita-gorsel.js';
import { temaUygula, dunyaStili } from './tema.js';
import { dunyaKur, GRAFIK } from './dunya3d.js';
import { turBaslat } from './sinematik.js';

const TURKIYE_KUTU = [[25.65, 35.8], [44.82, 42.12]];
const PARSEL_ZOOM = 14;          // imar hücreleri ve tıklanabilir parseller
const IZGARA_ZOOM = 16;          // hücre çizgileri
const IL_ZOOM = 8.5;             // bu ölçeğin altında il seçimi
// Canlı dünya baloncukları: herkese açık eylem → simge ve kısa yazı. Aynı anda en çok 6.
const CANLI_BALON = {
  PARCEL_ACQUIRED: ['🏡', 'Yeni çiftçi'], PARCEL_TRADED: ['🤝', 'Parsel el değiştirdi'], CROP_PLANTED: ['🌱', 'Ekim'], CROP_HARVESTED: ['🌾', 'Hasat'],
  STRUCTURE_COMPLETED: ['🏗️', 'Yeni yapı'], PRODUCTION_COLLECTED: ['📦', 'Üretim'], NEIGHBOR_HELPED: ['💧', 'Komşu yardımı'], GI_PRODUCED: ['⭐', 'Yöresel ürün'],
};
const CANLI_BALON_MAKS = 6;
let canliBalonSayisi = 0;
const YAPI_ZOOM = 15;            // 3B oyun yapıları
const MAKS_HUCRE = 600;          // tek seferde istenebilecek alan (sunucu sınırıyla aynı)

const bos = () => ({ type: 'FeatureCollection', features: [] });

// Masaüstünde açık sağ panel haritanın üstünde durur: sığdırırken o kadar pay bırakılır
function panelPayi() {
  if (window.matchMedia('(max-width: 820px)').matches || document.querySelector('.sahne')?.classList.contains('panel-kapali')) return 0;
  return document.getElementById('panel')?.offsetWidth || 0;
}
// Görünür harita alanı: mobilde altta çekmece var
function dolgu(kap) {
  const dar = kap.clientWidth < 700;
  if (!dar) return { top: 40, bottom: 40, left: 40, right: 40 + panelPayi() };
  const cekmece = document.getElementById('panel')?.offsetHeight || 0;
  // Üstte haritanın üstüne binen görev şeridi ve görünüm seçici kadar boşluk (ölçülür; gizliyse yok sayılır)
  const ust = Math.max(64, ...['.rehber', '#kipSecici'].map((s) => {
    const r = document.querySelector(s)?.getBoundingClientRect();
    return r && r.height ? r.bottom - kap.getBoundingClientRect().top + 8 : 0;
  }));
  return { top: Math.min(ust, Math.max(64, kap.clientHeight - cekmece - 120)), bottom: cekmece + 12, left: 12, right: 12 };
}

// Türkiye görünümü: ülke harita alanını kenardan kenara doldurur (yalnızca üstteki düğmeler ve alttaki şerit için pay)
function ulkeDolgu(kap) {
  const dar = kap.clientWidth < 700;
  if (!dar) return { top: 84, bottom: 70, left: 18, right: 18 + panelPayi() };
  const cekmece = document.getElementById('panel')?.offsetHeight || 0;
  return { top: 64, bottom: cekmece + 12, left: 6, right: 6 };
}

async function altlikVarMi() {
  try {
    // Yapılandırılan vektör karo kaynağı (kendi karo sunucusu da olabilir; sabit adres CSP'ye takılıp altlığı kapatıyordu)
    const r = await fetch(KAYNAK.vektor, { signal: AbortSignal.timeout(4000) });
    return r.ok;
  } catch { return false; }
}

// ---------- 3B oyun yapıları: model parçalarını harita poligonlarına çevir ----------
function parcaPoligonu(gx, gy, p) {
  if (p.tur === 'silindir') {
    const halka = [];
    for (let k = 0; k <= 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
      halka.push(G.yerel(gx, gy, p.u + Math.cos(a) * p.r, p.v + Math.sin(a) * p.r));
    }
    return [halka];
  }
  const [u0, v0, u1, v1] = p.alan;
  return [[G.yerel(gx, gy, u0, v0), G.yerel(gx, gy, u1, v0), G.yerel(gx, gy, u1, v1), G.yerel(gx, gy, u0, v1), G.yerel(gx, gy, u0, v0)]];
}

function koyulastir(hex, oran = 0.82) {
  const c = [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * oran));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

export function yapilar3dUret(parseller) {
  const ozellikler = [];
  const ekle = (gx, gy, p, b, h, renk, insaat) => ozellikler.push({
    type: 'Feature', geometry: { type: 'Polygon', coordinates: parcaPoligonu(gx, gy, p) },
    properties: { b, h, renk, insaat: insaat ? 1 : 0 },
  });
  for (const f of parseller.features) {
    const { gx, gy, z, yp, ek, kz, ss } = f.properties;
    if (!yp && !ek && !kz && !ss) continue;
    for (const p of parselParcalari(z, yp, ek, kz, ss)) {
      ekle(gx, gy, p, p.taban, p.tavan, p.renk, p.insaat);
      if (p.cati === 'kirma') {
        // Kırma çatı: içe doğru daralan üç kademe (alçak poligonlu, sıcak görünüm)
        const [u0, v0, u1, v1] = p.alan;
        for (let k = 0; k < 3; k++) {
          const ic = (k * 0.16) + 0.02, du = (u1 - u0) * ic, dv = (v1 - v0) * ic;
          const kat = p.catiYuksek / 3;
          ekle(gx, gy, { tur: 'kutu', alan: [u0 + du, v0 + dv, u1 - du, v1 - dv] }, p.tavan + k * kat, p.tavan + (k + 1) * kat,
            k === 2 ? koyulastir(p.catiRenk, 0.9) : p.catiRenk);
        }
      } else if (p.cati === 'duz') {
        const [u0, v0, u1, v1] = p.alan;
        const du = (u1 - u0) * 0.04, dv = (v1 - v0) * 0.04;
        ekle(gx, gy, { tur: 'kutu', alan: [u0 + du, v0 + dv, u1 - du, v1 - dv] }, p.tavan, p.tavan + 0.5, p.catiRenk || koyulastir(p.renk));
      }
    }
  }
  return { type: 'FeatureCollection', features: ozellikler };
}

const KOY_EN_UZAK = 11;   // köy görünümünde en fazla bu kadar uzaklaşılır (il/ülke görünümü kapalı)

// ---------- Kurulum ----------
// koy: { merkez: [lon, lat], zoom } — harita ülke görünümü yerine oyuncunun köyünde açılır ve köy ölçeğinin altına
// uzaklaşmaz (Türkiye haritası ana ekrandan kaldırıldı; ileride ayrı bir bölüm olacak)
export async function haritaKur(kap, { parselTik, ilTik, ilceTik, mahalleAlanTik, carsiTik, konumDegisti, kip = '2d', tema = 'ciftlik', grafik = 'yuksek', koy = null }) {
  const altlik = await altlikVarMi();
  // Ülke ölçeğinde kalmış eski bir #konum (ör. 4.18/…) açılışı bozmasın: yalnızca yakın plan bağlantılar korunur
  const baglantidaKonumVar = Number((/konum=([\d.]+)/.exec(location.hash) || [])[1] || 0) >= 6.5;
  const map = new maplibregl.Map({
    container: kap, style: stilOlustur({ altlik }),
    ...(koy ? { center: koy.merkez, zoom: koy.zoom } : { bounds: TURKIYE_KUTU, fitBoundsOptions: { padding: ulkeDolgu(kap) } }),
    minZoom: koy ? KOY_EN_UZAK : 3.2, maxZoom: 19.5, maxPitch: 78,
    maxBounds: [[2, 14], [68, 62]],       // oyun yalnızca Türkiye: harita dünyaya kaydırılamaz (dar ekranda da Türkiye sığsın diye geniş)
    hash: 'konum',                       // paylaşılabilir bağlantı: #konum=zoom/lat/lon/bearing/pitch
    attributionControl: { compact: true },
    // Grafik düzeyi: kenar yumuşatma ve piksel yoğunluğu (3B dünya katmanı aynı bağlamda çizilir)
    canvasContextAttributes: { antialias: grafik === 'ultra' || grafik === 'yuksek' },
    pixelRatio: Math.min(window.devicePixelRatio || 1, GRAFIK[grafik]?.piksel || 1),
  });
  simgeleriBagla(map);   // desenler ve renkli emoji simgeleri ilk çizimden önce hazır olsun
  if (['localhost', '127.0.0.1'].includes(location.hostname)) window.__stHarita = map;   // yalnızca yerel geliştirmede hata ayıklama
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-left');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
  map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, fitBoundsOptions: { maxZoom: 16.5 } }), 'bottom-left');

  if (!map.isStyleLoaded()) await new Promise((r) => map.once('style.load', r));
  // Kurucu seçeneği çekmece boşluğunu güvenilir uygulamıyor; bağlantıda konum yoksa burada sığdır
  if (!baglantidaKonumVar && !koy) map.fitBounds(TURKIYE_KUTU, { padding: ulkeDolgu(kap), duration: 0 });
  // Ülke ve il ölçeği sınıfı (harita üstü arayüz buna göre gizlenir)
  const olcekSinifi = () => document.body.classList.toggle('ulke-olcegi', map.getZoom() < 11);
  map.on('zoom', olcekSinifi); olcekSinifi();
  // Pencere boyutu değişince ülke görünümündeysek Türkiye yeniden ekrana sığdırılır
  map.on('resize', () => { if (map.getZoom() < 6 && !map.isMoving()) map.fitBounds(TURKIYE_KUTU, { padding: ulkeDolgu(kap), pitch: map.getPitch(), duration: 0 }); });
  const once = (id) => (map.getLayer(id) ? id : undefined);

  // ---------- Kaynaklar ----------
  // Ülke ölçeği verileri (Türkiye maskesi, il sınırları ve adları) yalnızca ülke görünümünde gerekir; köy görünümünde
  // (koy) harita o ölçeğe uzaklaşamadığından indirilmez (~350 KB)
  map.addSource('maske', { type: 'geojson', data: koy ? bos() : '/veri/maske.geojson' });
  map.addSource('iller', { type: 'geojson', data: koy ? bos() : '/veri/iller.geojson', promoteId: 'plaka' });
  map.addSource('il-etiket', { type: 'geojson', data: koy ? bos() : '/veri/il-etiketleri.geojson' });
  // Tarla sınırları: Fields of the World (uydudan çıkarılmış gerçek tarlalar, CC-BY-4.0)
  map.addSource('tarlalar', { type: 'geojson', data: bos(), attribution: 'Tarla sınırları: <a href="https://fieldsofthe.world" target="_blank" rel="noopener">Fields of the World</a> (CC-BY-4.0)' });
  for (const k of ['izgara', 'imlec', 'secili', 'parseller', 'yapilar3d', 'benim']) map.addSource(k, { type: 'geojson', data: bos() });

  // ---------- Ülke görünümü ----------
  // Türkiye dışı (komşu ülkeler, denizler ve adları) ülke ölçeğinde tamamen örtülür; yakına inince yavaşça açılır
  map.addLayer({ id: 'maske', type: 'fill', source: 'maske', paint: { 'fill-color': '#cfe3ec', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 5, 1, 7.5, 1, 9.5, 0] } });
  map.addLayer({ id: 'il-dolgu', type: 'fill', source: 'iller', maxzoom: 10, paint: {
    'fill-color': ['interpolate', ['linear'], ['coalesce', ['feature-state', 'yogunluk'], 0], 0, '#f4ead3', 0.35, '#cfe0c9', 1, '#2f7d68'],
    'fill-opacity': ['interpolate', ['linear'], ['zoom'], 5, ['case', ['boolean', ['feature-state', 'uzerinde'], false], 0.75, 0.5], 8.5, 0.2, 10, 0],
  } }, once(SIRA.ulke));
  map.addLayer({ id: 'il-sinir', type: 'line', source: 'iller', maxzoom: 11, paint: {
    'line-color': '#fffaf0', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.8, 9, 1.8], 'line-opacity': ['interpolate', ['linear'], ['zoom'], 9, 1, 11, 0],
  } }, once(SIRA.ulke));
  map.addLayer({ id: 'il-vurgu', type: 'line', source: 'iller', maxzoom: 10, paint: {
    'line-color': '#0e5e50', 'line-width': 2.6, 'line-opacity': ['case', ['boolean', ['feature-state', 'uzerinde'], false], 1, 0],
  } }, once(SIRA.ulke));

  // ---------- İl → ilçe → mahalle gezintisi ----------
  // İl tıklanınca ilçeleri, ilçe tıklanınca mahalle alanları (oyun kuralıyla: en yakın yerleşim noktası) görünür.
  // Dolgular ve sınırlar ilk 3B katmandan önce (arazi kipinde zemine işlesin), adlar en üstte.
  map.addSource('ilceler', { type: 'geojson', data: bos(), promoteId: 'id' });
  map.addSource('ilce-adlari', { type: 'geojson', data: bos() });
  map.addSource('mahalleler', { type: 'geojson', data: bos() });
  const zeminOnce = once('bina-3d') || once('etiket-su');
  const ILCE_RENK = ['#f2c14e', '#9ed36a', '#f29e6c', '#7fcfc2', '#c6a8e6', '#f5a9c0', '#8fc8ee', '#e3d27a'];
  const MAHALLE_RENK = ['#ffe08a', '#c8eea0', '#ffc9a3', '#b5e8de', '#e2cdf4', '#ffd1dd', '#c3e3f7', '#efe3a6'];
  const paletle = (renkler) => ['match', ['get', 'renk'], ...renkler.slice(0, -1).flatMap((r, i) => [i, r]), renkler.at(-1)];
  const uzerinde = ['boolean', ['feature-state', 'uzerinde'], false];
  map.addLayer({ id: 'ilce-dolgu', type: 'fill', source: 'ilceler', paint: { 'fill-color': paletle(ILCE_RENK),
    'fill-opacity': ['interpolate', ['linear'], ['zoom'], 6, ['case', uzerinde, 0.5, 0.26], 11, ['case', uzerinde, 0.32, 0.12], 13, 0] } }, zeminOnce);
  map.addLayer({ id: 'ilce-sinir-golge', type: 'line', source: 'ilceler', paint: { 'line-color': '#5a3511', 'line-opacity': 0.45,
    'line-width': ['interpolate', ['linear'], ['zoom'], 6, 2.6, 12, 5], 'line-blur': 1 } }, zeminOnce);
  map.addLayer({ id: 'ilce-sinir', type: 'line', source: 'ilceler', paint: { 'line-color': '#fff7e0',
    'line-width': ['interpolate', ['linear'], ['zoom'], 6, ['case', uzerinde, 2.6, 1.4], 12, ['case', uzerinde, 4, 2.6]] } }, zeminOnce);
  map.addLayer({ id: 'mahalle-dolgu', type: 'fill', source: 'mahalleler', filter: ['==', ['get', 'tur'], 'alan'], paint: { 'fill-color': paletle(MAHALLE_RENK),
    'fill-opacity': ['interpolate', ['linear'], ['zoom'], 9, ['case', uzerinde, 0.55, 0.34], 13, ['case', uzerinde, 0.4, 0.2], 14.5, 0] } }, zeminOnce);
  map.addLayer({ id: 'mahalle-sinir', type: 'line', source: 'mahalleler', filter: ['==', ['get', 'tur'], 'sinir'], paint: { 'line-color': '#ffffff',
    'line-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.85, 15, 0.5, 16.5, 0], 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.8, 14, 2] } }, zeminOnce);

  // ---------- Parsel ızgarası (renkli imar haritası kaldırıldı; imar türü parsel kartında yazar) ----------
  map.addLayer({ id: 'izgara', type: 'line', source: 'izgara', minzoom: IZGARA_ZOOM, paint: {
    'line-color': '#fffdf6', 'line-width': ['interpolate', ['linear'], ['zoom'], IZGARA_ZOOM, 0.4, 19, 1.4],
    'line-opacity': ['interpolate', ['linear'], ['zoom'], IZGARA_ZOOM, 0, IZGARA_ZOOM + 0.5, 0.65],
  } }, once(SIRA.parsel));

  // ---------- Tarlalar (deneme ilçeleri) ----------
  // Tarım imarlı alanlar gerçek tarla dokusundaki gibi yola dik şeritlere bölünür; her tarla kendi tonunda (ekili, anız, sürülmüş, nadas)
  map.addLayer({ id: 'tarla-dolgu', type: 'fill', source: 'tarlalar', minzoom: PARSEL_ZOOM, paint: {
    'fill-color': ['match', ['get', 'ton'], 0, '#e0b84a', 1, '#86b043', 2, '#a8723f', '#e6d48c'],
    'fill-opacity': ['interpolate', ['linear'], ['zoom'], PARSEL_ZOOM, 0, PARSEL_ZOOM + 0.5, 0.8, 17, 0.7, 19, 0.5],
  } }, once(SIRA.parsel));
  map.addLayer({ id: 'tarla-sinir', type: 'line', source: 'tarlalar', minzoom: PARSEL_ZOOM, paint: {
    'line-color': '#fff6dc', 'line-width': ['interpolate', ['linear'], ['zoom'], PARSEL_ZOOM, 0.4, 16, 1.1, 19, 2.6],
    'line-opacity': ['interpolate', ['linear'], ['zoom'], PARSEL_ZOOM, 0, PARSEL_ZOOM + 0.6, 0.85],
  } }, once(SIRA.parsel));

  // ---------- Oyuncu parselleri ----------
  // Birleşik parselin parçaları (`uye`) yalnızca 3B için gelir: 2B'de asıl özellik bütün sınırı çizer
  const asil = ['!', ['has', 'uye']];
  map.addLayer({ id: 'parsel-dolgu', type: 'fill', source: 'parseller', filter: asil, paint: {
    'fill-color': ['match', ['get', 's'], 1, '#e7b53a', 2, '#3d4548', '#ffffff'],
    'fill-opacity': ['match', ['get', 's'], 1, 0.22, 2, 0.12, 0],
  } }, once(SIRA.parsel));
  map.addLayer({ id: 'parsel-cerceve', type: 'line', source: 'parseller', filter: ['all', asil, ['in', ['get', 's'], ['literal', [1, 2]]]], paint: {
    'line-color': ['match', ['get', 's'], 1, '#d9a21b', '#3d4548'],
    'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1, 18, ['match', ['get', 's'], 1, 4, 2.2]],
  } }, once(SIRA.parsel));
  map.addLayer({ id: 'benim-isik', type: 'line', source: 'parseller', filter: ['all', asil, ['==', ['get', 's'], 1]], minzoom: 13, paint: {
    'line-color': '#ffd166', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 4, 18, 14], 'line-blur': ['interpolate', ['linear'], ['zoom'], 13, 3, 18, 9], 'line-opacity': 0.5,
  } }, once(SIRA.parsel));
  map.addLayer({ id: 'parsel-satilik', type: 'line', source: 'parseller', filter: ['all', asil, ['==', ['get', 'l'], 1]], paint: {
    'line-color': '#c8402e', 'line-dasharray': [1.4, 0.9], 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1.6, 18, 4],
  } }, once(SIRA.parsel));
  map.addLayer({ id: 'parsel-isaret', type: 'circle', source: 'parseller', maxzoom: YAPI_ZOOM + 0.6,
    filter: ['all', asil, ['any', ['>', ['get', 'y'], 0], ['>', ['get', 'i'], 0], ['>', ['get', 'e'], 0]]], paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2.5, 15.5, 6],
      'circle-color': ['case', ['==', ['get', 'e'], 2], '#e8730c', ['==', ['get', 'e'], 1], '#2e8b57', ['>', ['get', 'i'], 0], '#e2b23a', '#33505c'],
      'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5,
      'circle-opacity': ['interpolate', ['linear'], ['zoom'], YAPI_ZOOM, 1, YAPI_ZOOM + 0.6, 0],
      'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], YAPI_ZOOM, 1, YAPI_ZOOM + 0.6, 0],
    } }, once(SIRA.parsel));
  map.addLayer({ id: 'yapi-3d', type: 'fill-extrusion', source: 'yapilar3d', minzoom: YAPI_ZOOM - 0.5, filter: ['==', ['get', 'insaat'], 0], paint: {
    'fill-extrusion-color': ['get', 'renk'], 'fill-extrusion-base': ['get', 'b'], 'fill-extrusion-height': ['get', 'h'],
    'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], YAPI_ZOOM - 0.5, 0, YAPI_ZOOM, 0.96], 'fill-extrusion-vertical-gradient': true,
  } }, once(SIRA.parsel));
  map.addLayer({ id: 'yapi-3d-insaat', type: 'fill-extrusion', source: 'yapilar3d', minzoom: YAPI_ZOOM - 0.5, filter: ['==', ['get', 'insaat'], 1], paint: {
    'fill-extrusion-color': ['get', 'renk'], 'fill-extrusion-base': ['get', 'b'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 0.6,
  } }, once(SIRA.parsel));
  map.addLayer({ id: 'imlec', type: 'line', source: 'imlec', minzoom: PARSEL_ZOOM, paint: { 'line-color': '#ffffff', 'line-width': 2.2 } });
  map.addLayer({ id: 'secili-isik', type: 'line', source: 'secili', paint: { 'line-color': '#f2c14e', 'line-width': 9, 'line-opacity': 0.45, 'line-blur': 3 } });
  map.addLayer({ id: 'secili', type: 'line', source: 'secili', paint: { 'line-color': '#1f2a2e', 'line-width': 2.6 } });

  // Arazilerim: ülke ölçeğinde de görünen işaretler
  map.addLayer({ id: 'benim-hale', type: 'circle', source: 'benim', maxzoom: PARSEL_ZOOM, paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 12, 13, 20], 'circle-color': '#ffd166', 'circle-blur': 1, 'circle-opacity': 0.55 } });
  map.addLayer({ id: 'benim', type: 'circle', source: 'benim', maxzoom: PARSEL_ZOOM, paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 5, 13, 8], 'circle-color': '#e7b53a', 'circle-stroke-color': '#7a5600', 'circle-stroke-width': 1.5,
  } });
  map.addLayer({ id: 'il-ad', type: 'symbol', source: 'il-etiket', maxzoom: IL_ZOOM, layout: {
    'text-field': ['format', ['upcase', ['get', 'ad']], {}, '\n', {}, ['get', 'plaka'], { 'font-scale': 0.72 }],
    'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 5, 9.5, 8, 14], 'text-letter-spacing': 0.08,
    'text-allow-overlap': false, 'text-padding': 1,
  }, paint: { 'text-color': '#2b3a37', 'text-halo-color': 'rgba(247,242,231,0.9)', 'text-halo-width': 1.4,
    'text-opacity': ['interpolate', ['linear'], ['zoom'], 7.5, 1, IL_ZOOM, 0] } });

  map.addLayer({ id: 'ilce-ad', type: 'symbol', source: 'ilce-adlari', maxzoom: 12.5, layout: {
    'text-field': ['upcase', ['get', 'ad']], 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 6.5, 10, 11, 15],
    'text-letter-spacing': 0.06, 'text-max-width': 8 },
    paint: { 'text-color': '#ffffff', 'text-halo-color': '#5a3511', 'text-halo-width': 2, 'text-opacity': ['interpolate', ['linear'], ['zoom'], 11.5, 1, 12.5, 0] } });
  map.addLayer({ id: 'mahalle-ad', type: 'symbol', source: 'mahalleler', filter: ['==', ['get', 'tur'], 'ad'], minzoom: 9.5, maxzoom: 15, layout: {
    'text-field': ['get', 'ad'], 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 9.5, 10, 13, 13.5],
    'text-max-width': 7, 'text-padding': 2 },
    paint: { 'text-color': '#3b2410', 'text-halo-color': '#fff8e6', 'text-halo-width': 1.8, 'text-opacity': ['interpolate', ['linear'], ['zoom'], 14, 1, 15, 0] } });

  // Simge parseller (miras alanları): ülke ölçeğinde simge, yakında ad
  map.addSource('simgeler', { type: 'geojson', data: '/api/simgeler' });
  map.addLayer({ id: 'simge-isaret', type: 'symbol', source: 'simgeler', minzoom: 6, layout: {
    'icon-image': ['concat', 'e:', ['get', 'ikon']], 'icon-size': ['interpolate', ['linear'], ['zoom'], 6, 0.75, 12, 1.05], 'icon-allow-overlap': true,
    'text-field': ['step', ['zoom'], '', 9, ['get', 'ad']], 'text-font': ['Noto Sans Bold'], 'text-size': 11.5,
    'text-offset': [0, 1.5], 'text-anchor': 'top', 'text-optional': true, 'symbol-sort-key': 1,
  }, paint: { 'text-color': '#6b3a12', 'text-halo-color': 'rgba(255,248,230,.95)', 'text-halo-width': 1.6 } });

  // Çarşı şubeleri (banka, nalbur, market, zirai bayi): şehir ölçeğinde işletme simgesi, yakında marka adı; veri carsiGoster ile gelir
  map.addSource('carsi', { type: 'geojson', data: bos() });
  map.addLayer({ id: 'carsi-sube', type: 'symbol', source: 'carsi', minzoom: 9.5, layout: {
    'icon-image': ['concat', 'e:', ['get', 'ikon']], 'icon-size': ['interpolate', ['linear'], ['zoom'], 9.5, 0.6, 14, 0.95], 'icon-allow-overlap': true,
    'text-field': ['step', ['zoom'], '', 12.5, ['get', 'marka']], 'text-font': ['Noto Sans Bold'], 'text-size': 11,
    'text-offset': [0, 1.4], 'text-anchor': 'top', 'text-optional': true, 'symbol-sort-key': 2,
  }, paint: { 'text-color': ['get', 'renk'], 'text-halo-color': 'rgba(255,255,255,.95)', 'text-halo-width': 1.6 } });

  // Gerçek hava (il merkezleri): il adının altında simge ve sıcaklık
  map.addSource('hava', { type: 'geojson', data: bos(), attribution: '<a href="https://open-meteo.com/" target="_blank" rel="noopener">Hava: Open-Meteo.com</a>' });
  map.addLayer({ id: 'il-hava', type: 'symbol', source: 'hava', maxzoom: IL_ZOOM, minzoom: 5.8, layout: {
    'icon-image': ['concat', 'ec:', ['get', 'ikon']], 'icon-size': ['interpolate', ['linear'], ['zoom'], 5.2, 0.6, 8, 0.8],
    'icon-offset': [-10, 0], 'icon-anchor': 'top', 'text-field': ['concat', ['to-string', ['get', 'sicaklik']], '°'],
    'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 5.2, 10, 8, 12], 'text-anchor': 'top', 'text-offset': [1.05, 0.55],
    'symbol-placement': 'point', 'icon-padding': 0, 'text-padding': 0, 'icon-allow-overlap': false, 'text-optional': false,
  }, paint: { 'text-color': ['case', ['<=', ['get', 'sicaklik'], 0], '#2a5d9b', ['>=', ['get', 'sicaklik'], 30], '#b5402a', '#3a4a45'],
    'text-halo-color': 'rgba(247,242,231,0.95)', 'text-halo-width': 1.4,
    'icon-opacity': ['interpolate', ['linear'], ['zoom'], 7.5, 1, IL_ZOOM, 0], 'text-opacity': ['interpolate', ['linear'], ['zoom'], 7.5, 1, IL_ZOOM, 0] } }, once('il-ad'));   // il adları yerleşimde öncelikli
  // il-hava, il adının altında dursun: il etiketlerinin konumundan biraz güneye kaydırılmış noktalar havaGoster'de üretilir
  // Erken uyarı: önümüzdeki saatlerde don/dolu/sağanak/fırtına/aşırı sıcak beklenen ilde sıcaklığın sağında risk simgesi
  map.addLayer({ id: 'il-uyari', type: 'symbol', source: 'hava', maxzoom: IL_ZOOM, minzoom: 5.8, filter: ['!=', ['get', 'uyari'], ''], layout: {
    'icon-image': ['concat', 'ec:', ['get', 'uyari']], 'icon-size': ['interpolate', ['linear'], ['zoom'], 5.2, 0.5, 8, 0.7],
    'icon-anchor': 'top', 'icon-offset': [62, 4], 'icon-allow-overlap': true, 'icon-ignore-placement': true,
  }, paint: { 'icon-opacity': ['interpolate', ['linear'], ['zoom'], 7.5, 1, IL_ZOOM, 0] } }, once('il-ad'));
  // Yöresel (coğrafi işaretli) ürün: il adının üstünde ürün simgesi (Malatya 🍑, Rize 🍃…); veri yoreselGoster ile gelir
  map.addSource('yoresel', { type: 'geojson', data: bos() });
  map.addLayer({ id: 'il-yoresel', type: 'symbol', source: 'yoresel', maxzoom: IL_ZOOM, minzoom: 5, layout: {
    'icon-image': ['concat', 'ec:', ['get', 'ikon']], 'icon-size': ['interpolate', ['linear'], ['zoom'], 5, 0.62, 8, 0.85],
    'icon-anchor': 'bottom', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
  }, paint: { 'icon-opacity': ['interpolate', ['linear'], ['zoom'], 7.5, 1, IL_ZOOM, 0] } }, once('il-ad'));
  let yoreselIl = new Map();   // plaka → [{ ad, ikon }]

  // Gece örtüsü: zemini ve oyun dolgularını karartır; etiketler ve 3B yapılar üstte kalır
  geceKatmani(map, once('yapi-3d'));   // ilk 3B katmandan önce: arazi kipinde de zemine işlesin
  const yagisCizici = yagisKur(kap);
  isimaBaslat(map);

  // ---------- Görünüm teması ve 3B dünya (ağaçlar, binalar, hayat, bulutlar) ----------
  temaUygula(map, tema);
  const dunya = dunyaKur(map, { grafik });
  if (['localhost', '127.0.0.1'].includes(location.hostname)) window.__stDunya = dunya;   // yalnızca yerel hata ayıklama
  if (!dunyaStili(tema)) dunya.etkinlestir(false);
  // Aynı yapılar 3B dünya katmanında ayrıntılı çizilirken MapLibre karşılıkları gizlenir (çift çizim olmasın)
  function katmanGorunurlugu() {
    const dunyada = !!dunyaStili(tema) && dunya.aktifMi();
    const gor = (id, acik) => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', acik ? 'visible' : 'none'); };
    gor('yapi-3d', !dunyada); gor('yapi-3d-insaat', !dunyada);
    const osm3b = kip === '3d' && !(dunyada && map.getZoom() >= 13.8);
    gor('bina-3d', osm3b); gor('bina-3d-cati', osm3b);
    if (tema === 'harita') {
      // Harita temasında 2B binalar gölgeli dolgu, 3B'de yerini hacimli binalara bırakır
      gor('bina-golge', kip !== '3d');
      if (map.getLayer('bina')) map.setPaintProperty('bina', 'fill-opacity', kip === '3d' ? 0 : ['interpolate', ['linear'], ['zoom'], 13.5, 0, 14.5, 1]);
    }
  }
  map.on('zoomend', katmanGorunurlugu);
  katmanGorunurlugu();

  // ---------- Durum ipucu (yakınlaşma / yükleniyor) ----------
  const ipucu = document.createElement('div');
  ipucu.className = 'harita-ipucu';
  ipucu.setAttribute('role', 'status');
  kap.appendChild(ipucu);
  const ilKarti = document.createElement('div');
  ilKarti.className = 'il-karti';
  ilKarti.hidden = true;
  kap.appendChild(ilKarti);
  const ipucuGuncelle = () => {
    const z = map.getZoom();
    let metin = '';
    if (z < IL_ZOOM) metin = '81 ilden birini seç ya da ara';
    else if (z < PARSEL_ZOOM) metin = 'Parsel ızgarası için yakınlaş';
    ipucu.textContent = metin;
    ipucu.hidden = !metin;
  };
  map.on('idle', ipucuGuncelle);

  // ---------- Etkileşim ----------
  let ilUzerinde = null;
  let ilIstatistik = new Map();
  let hoverKare = 0;
  map.on('mousemove', (e) => {
    cancelAnimationFrame(hoverKare);
    hoverKare = requestAnimationFrame(() => {
      const z = map.getZoom();
      if (z >= PARSEL_ZOOM) {
        const t = tarlaNoktada(e.point);
        const c = G.hucre(e.lngLat.lng, e.lngLat.lat);
        map.getSource('imlec').setData({ type: 'Feature', geometry: t ? t.geometri : G.poligon(c.x, c.y), properties: {} });
        map.getCanvas().style.cursor = 'pointer';
      } else map.getSource('imlec').setData(bos());

      // İlçe ve mahalle vurgusu
      const mh = z >= 9.5 && z < PARSEL_ZOOM ? map.queryRenderedFeatures(e.point, { layers: ['mahalle-dolgu'] })[0] : null;
      const ilceF = !mh && z < 13 ? map.queryRenderedFeatures(e.point, { layers: ['ilce-dolgu'] })[0] : null;
      vurgula('mahalleler', mh?.id ?? null, 'mahalle');
      vurgula('ilceler', ilceF?.id ?? null, 'ilce');
      const il = z < IL_ZOOM && !ilceF ? map.queryRenderedFeatures(e.point, { layers: ['il-dolgu'] })[0] : null;
      const plaka = il?.properties.plaka || null;
      if (plaka !== ilUzerinde) {
        if (ilUzerinde) map.setFeatureState({ source: 'iller', id: ilUzerinde }, { uzerinde: false });
        ilUzerinde = plaka;
        if (plaka) map.setFeatureState({ source: 'iller', id: plaka }, { uzerinde: true });
      }
      if (plaka) {
        const s = ilIstatistik.get(plaka) || {};
        const yer = yoreselIl.get(plaka) || [], h = sonHava.find((x) => x.plaka === plaka);
        ilKarti.innerHTML = `<b>${esc(il.properties.ad)}</b><span>${plaka}</span>
          ${yer.length || h ? `<p class="il-karti-alt">${yer.map((y) => `${y.ikon} ${y.ad}`).join(' · ')}${yer.length && h ? '<br>' : ''}${h ? `${h.ikon} ${h.sicaklik}° · ${h.durum}` : ''}</p>` : ''}
          <dl><div><dt>Parsel</dt><dd>${s.parsel || 0}</dd></div><div><dt>Oyuncu</dt><dd>${s.oyuncu || 0}</dd></div><div><dt>İlan</dt><dd>${s.ilan || 0}</dd></div></dl>`;
        ilKarti.style.transform = `translate(${Math.min(e.point.x + 14, kap.clientWidth - 190)}px, ${Math.max(8, e.point.y - 70)}px)`;
        ilKarti.hidden = false;
        map.getCanvas().style.cursor = 'pointer';
      } else if (ilceF || mh) {
        const ad = (mh || ilceF).properties.ad;
        ilKarti.innerHTML = `<b>${esc(ad)}</b><span>${mh ? 'mahalle' : 'ilçe'}</span><small>${mh ? 'Tıkla: mahalleyi aç' : 'Tıkla: mahalleleri göster'}</small>`;
        ilKarti.style.transform = `translate(${Math.min(e.point.x + 14, kap.clientWidth - 190)}px, ${Math.max(8, e.point.y - 50)}px)`;
        ilKarti.hidden = false;
        map.getCanvas().style.cursor = 'pointer';
      } else {
        ilKarti.hidden = true;
        if (z < PARSEL_ZOOM) map.getCanvas().style.cursor = '';
      }
    });
  });
  const vurgulu = { ilce: null, mahalle: null };
  function vurgula(kaynak, id, anahtar) {
    if (vurgulu[anahtar] === id) return;
    if (vurgulu[anahtar] != null) map.setFeatureState({ source: kaynak, id: vurgulu[anahtar] }, { uzerinde: false });
    vurgulu[anahtar] = id;
    if (id != null) map.setFeatureState({ source: kaynak, id }, { uzerinde: true });
  }
  let aktifIl = null, aktifIlce = null;
  let oltaCb = null;
  function oltaModu(cb) {
    oltaCb = cb;
    kap.classList.toggle('olta-modu', !!cb);
  }
  map.on('mouseout', () => { ilKarti.hidden = true; map.getSource('imlec').setData(bos()); });

  map.on('mouseenter', 'simge-isaret', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'simge-isaret', () => { map.getCanvas().style.cursor = ''; });
  map.on('click', (e) => {
    const z = map.getZoom();
    // Yalnızca stilde gerçekten var olan katmanları sorgula: bir katman eklenemezse parsel tıklaması bozulmasın
    const isaretKatmanlari = ['carsi-sube', 'simge-isaret'].filter((k) => map.getLayer(k));
    const isaret = z >= 6 && isaretKatmanlari.length ? map.queryRenderedFeatures(e.point, { layers: isaretKatmanlari })[0] : null;
    if (isaret?.layer.id === 'simge-isaret') {
      const id = isaret.properties.parsel;
      if (z < PARSEL_ZOOM) map.flyTo({ center: isaret.geometry.coordinates, zoom: 17.4, speed: 1.6 });
      parselTik(id);
      return;
    }
    if (isaret?.layer.id === 'carsi-sube') { carsiTik?.(isaret.properties.kategori); return; }
    if (z >= PARSEL_ZOOM) {
      const t = tarlaNoktada(e.point);
      const c = G.hucre(e.lngLat.lng, e.lngLat.lat);
      parselTik(t ? t.id : G.parselId(c.x, c.y));
      return;
    }
    // Olta modu: sıradaki tıklama balık tutma noktasıdır
    if (oltaCb) { const cb = oltaCb; oltaModu(null); cb(e.lngLat); return; }
    // Seçili ilçenin mahalle alanı → mahalle; seçili ilin ilçesi → ilçe; değilse il
    const mh = z >= 9.5 ? map.queryRenderedFeatures(e.point, { layers: ['mahalle-dolgu'] })[0] : null;
    if (mh) { mahalleAlanTik?.(aktifIlce, mh.properties.yerId, e.lngLat); return; }
    const ilce = z < 13 ? map.queryRenderedFeatures(e.point, { layers: ['ilce-dolgu'] })[0] : null;
    if (ilce) { ilceTik?.(ilce.properties.id); return; }
    if (z < IL_ZOOM) {
      const il = map.queryRenderedFeatures(e.point, { layers: ['il-dolgu'] })[0];
      if (il) { ilTik?.(il.properties.plaka); return; }
    }
    map.flyTo({ center: e.lngLat, zoom: Math.min(PARSEL_ZOOM + 2.2, z + 4), speed: 1.3 });
  });

  // ---------- Tarla verisi ----------
  // Tarlanın tam sınırı istemcide tutulur (queryRenderedFeatures karo kenarında kırpılmış geometri döndürür)
  const tarlaGeo = new Map();
  const tarlaMaske = new Map();   // "kx:ky" → 64 × 64 bit; tarla hücrelerinde ızgara çizilmez
  function tarlaNoktada(nokta) {
    if (!map.getLayer('tarla-dolgu')) return null;
    const f = map.queryRenderedFeatures(nokta, { layers: ['tarla-dolgu'] })[0];
    if (!f) return null;
    return { id: f.properties.id, geometri: tarlaGeo.get(f.properties.id) || f.geometry };
  }
  function tarlaHucresi(x, y) {
    const m = tarlaMaske.get(`${x >> 6}:${y >> 6}`);
    if (!m) return false;
    const n = (y & 63) * 64 + (x & 63);
    return (m[n >> 3] >> (n & 7)) & 1;
  }
  // Tarla karoları (z14, 64 × 64 hücre) bir kez indirilir ve bellekte tutulur; görünür karoların tarlaları kaynağa yazılır
  const tarlaKarolari = new Map();   // "kx:ky" → { features } | Promise
  let tarlaKumesi = '', tarlaSayac = 0;
  function tarlaKarosuCoz(kx, ky, v) {
    const x0 = kx * 64, y0 = ky * 64, features = [];
    for (const [i, j, alan, ton, ...k] of v.t) {
      const halka = [];
      for (let n = 0; n < k.length; n += 2) halka.push([G.xLon(x0 + k[n] / 100), G.yLat(y0 + k[n + 1] / 100)]);
      halka.push(halka[0]);
      const id = G.parselId(x0 + i, y0 + j), geometri = { type: 'Polygon', coordinates: [halka] };
      tarlaGeo.set(id, geometri);
      features.push({ type: 'Feature', geometry: geometri, properties: { id, alan, ton } });
    }
    if (v.m) tarlaMaske.set(`${kx}:${ky}`, Uint8Array.from(atob(v.m), (ch) => ch.charCodeAt(0)));
    return { features };
  }
  async function tarlalariYukle(b, z) {
    if (z < PARSEL_ZOOM) return;
    const a = G.hucre(b.getWest(), b.getNorth()), c = G.hucre(b.getEast(), b.getSouth());
    const karolar = [];
    for (let kx = a.x >> 6; kx <= c.x >> 6; kx++) for (let ky = a.y >> 6; ky <= c.y >> 6; ky++) karolar.push([kx, ky]);
    if (karolar.length > 20) return;
    const anahtar = karolar.map((k) => k.join(':')).join(','), no = ++tarlaSayac;
    const sonuc = await Promise.all(karolar.map(([kx, ky]) => {
      const k = `${kx}:${ky}`;
      if (!tarlaKarolari.has(k)) {
        tarlaKarolari.set(k, fetch(`/api/harita/tarla/${kx}/${ky}?t=6`, { credentials: 'same-origin' })
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
          .then((v) => { const coz = tarlaKarosuCoz(kx, ky, v); tarlaKarolari.set(k, coz); return coz; })
          .catch((err) => { tarlaKarolari.delete(k); console.warn('Tarlalar alınamadı', err); return { features: [] }; }));
      }
      return tarlaKarolari.get(k);
    }));
    if (no !== tarlaSayac || anahtar === tarlaKumesi) return;   // daha yeni bir istek var ya da görünür karolar aynı
    tarlaKumesi = anahtar;
    // Birden çok karoya yayılan tarla her karoda gelir: bir kez çizilir
    const goruldu = new Set();
    map.getSource('tarlalar').setData({ type: 'FeatureCollection', features: sonuc.flatMap((r) => r.features).filter((f) => !goruldu.has(f.properties.id) && goruldu.add(f.properties.id)) });
    if (sonuc.some((r) => r.features.length)) izgaraCiz();
  }
  // Hücre ızgarası: tarlaya ait hücrelerin kenarları çizilmez (tarlanın kendi sınırı görünür)
  function izgaraCiz() {
    const z = map.getZoom(), b = map.getBounds();
    if (z < IZGARA_ZOOM - 0.2) return map.getSource('izgara').setData(bos());
    const a = G.hucre(b.getWest(), b.getNorth()), c = G.hucre(b.getEast(), b.getSouth());
    if (c.x - a.x >= 260 || c.y - a.y >= 260) return;
    const cizgiler = [];
    const kosu = (gizli, n0, n1, nokta) => {
      let bas = null;
      for (let n = n0; n <= n1 + 1; n++) {
        const acik = n <= n1 && !gizli(n);
        if (acik && bas === null) bas = n;
        else if (!acik && bas !== null) { cizgiler.push([nokta(bas), nokta(n)]); bas = null; }
      }
    };
    for (let x = a.x; x <= c.x + 1; x++) kosu((y) => tarlaHucresi(x - 1, y) || tarlaHucresi(x, y), a.y, c.y, (y) => [G.xLon(x), G.yLat(y)]);
    for (let y = a.y; y <= c.y + 1; y++) kosu((x) => tarlaHucresi(x, y - 1) || tarlaHucresi(x, y), a.x, c.x, (x) => [G.xLon(x), G.yLat(y)]);
    map.getSource('izgara').setData({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: cizgiler }, properties: {} });
  }

  // ---------- Görünür alan verisi ----------
  let parselIstegi = null;
  let sonParseller = bos();
  let bekleyen = 0;
  // Görünen alanın verisi. Ekranın her yanından %50 taşan bir kutu istenir; küçük kaydırmalarda (yeni görünüm hâlâ
  // o kutunun içindeyse) ağdan yeniden alınmaz. Yanıt öncekiyle aynıysa harita ve 3B modeller yeniden kurulmaz.
  // Çiftlik açıkken (harita duraklatılmış) hiç yüklenmez; çiftlikten çıkınca bir kez yüklenir.
  let sonKutu = null, sonKutuZoom = 0, sonParselMetni = '', bekleyenYukleme = false;
  const tasanKutu = (b, oran) => {
    const w = b.getWest(), e = b.getEast(), s = b.getSouth(), n = b.getNorth(), dx = (e - w) * oran, dy = (n - s) * oran;
    return new maplibregl.LngLatBounds([w - dx, s - dy], [e + dx, n + dy]);
  };
  async function gorunurAlaniYukle({ zorla = false } = {}) {
    if (kap.style.visibility === 'hidden') { bekleyenYukleme = true; return; }
    const z = map.getZoom();
    const gorunen = map.getBounds();
    if (!zorla && sonKutu && Math.abs(z - sonKutuZoom) < 0.75 && sonKutu.contains(gorunen.getNorthWest()) && sonKutu.contains(gorunen.getSouthEast())) {
      izgaraCiz();
      return;
    }
    const b = tasanKutu(gorunen, 0.5);
    sonKutu = b; sonKutuZoom = z;
    // Izgara çizgileri (yalnızca yakın ölçekte) ve tarlalar
    izgaraCiz();
    tarlalariYukle(b, z);

    if (z < 12.5) return;
    const a = G.hucre(b.getWest(), b.getNorth()), c = G.hucre(b.getEast(), b.getSouth());
    if (c.x - a.x > MAKS_HUCRE || c.y - a.y > MAKS_HUCRE) { sonKutu = null; return; }
    parselIstegi?.abort();
    parselIstegi = new AbortController();
    try {
      const r = await fetch(`/api/harita/parseller?bbox=${[b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((v) => v.toFixed(6)).join(',')}`,
        { signal: parselIstegi.signal, credentials: 'same-origin' });
      if (!r.ok) return;
      const metin = await r.text();
      if (metin === sonParselMetni) return;   // değişiklik yok: yeniden kurma
      sonParselMetni = metin;
      sonParseller = JSON.parse(metin);
      map.getSource('parseller').setData(sonParseller);
      map.getSource('yapilar3d').setData(yapilar3dUret(sonParseller));
      dunya.parseller(sonParseller);
    } catch (err) {
      if (err.name !== 'AbortError') console.warn('Parseller alınamadı', err);
    }
  }
  map.on('moveend', () => {
    clearTimeout(bekleyen);
    bekleyen = setTimeout(() => gorunurAlaniYukle(), 180);
    konumDegisti?.(map.getCenter(), map.getZoom());
    ipucuGuncelle();
  });
  map.on('zoom', ipucuGuncelle);

  // ---------- 2B / 3B ----------
  function kipAyarla(yeni, { animasyon = true } = {}) {
    kip = yeni;
    const uc = yeni === '3d';
    if (uc) map.setTerrain({ source: 'yukselti-arazi', exaggeration: tema === 'harita' ? 1.35 : 1.5 });
    else map.setTerrain(null);
    katmanGorunurlugu();
    // Ülke ölçeğinde hafif eğim; mahalle ölçeğinde belirgin 3B
    const egim = map.getZoom() < 9 ? 35 : 58;
    const hedef = uc ? { pitch: Math.max(map.getPitch(), egim), bearing: map.getBearing() || -18 } : { pitch: 0, bearing: 0 };
    if (animasyon) map.easeTo({ ...hedef, duration: 1100 });
    else map.jumpTo(hedef);
  }
  if (kip === '3d') kipAyarla('3d', { animasyon: false });
  map.on('pitchend', () => {
    // Kullanıcı sağ tıkla / iki parmakla eğerse 3B kipine geç
    if (map.getPitch() > 15 && kip !== '3d') { kipAyarla('3d', { animasyon: false }); kap.dispatchEvent(new CustomEvent('kip', { detail: '3d' })); }
  });

  // Yağış: haritanın ortasındaki ilin gerçek havası (il ölçeğinde ve yakınında)
  let sonHava = [];
  function yagisGuncelle() {
    const z = map.getZoom();
    if (z < 8.5 || !sonHava.length) return yagisCizici.ayarla(null);
    const c = map.getCenter();
    let en = null, enD = Infinity;
    for (const h of sonHava) { const d = (h.lon - c.lng) ** 2 + (h.lat - c.lat) ** 2; if (d < enD) { enD = d; en = h; } }
    const tur = enD < 1.2 ? yagisTuru(en) : null;
    yagisCizici.ayarla(tur, Math.min(1.5, (en?.yagis || 0.5) / 2));
  }
  map.on('moveend', yagisGuncelle);

  ipucuGuncelle();
  gorunurAlaniYukle();

  return {
    map,
    yenile: () => gorunurAlaniYukle({ zorla: true }),
    // geometri: tarla seçildiyse sınırı (kartın `geometri` alanı); yoksa tarla katmanından ya da hücre karesinden
    sec(id, geometri) {
      const c = G.idCoz(id);
      const g = geometri || (id && tarlaGeo.get(id)) || (c && G.poligon(c.x, c.y));
      map.getSource('secili').setData(g ? { type: 'Feature', geometry: g, properties: {} } : bos());
    },
    parseleGit(id, { zoom, anlik = false } = {}) {
      const c = G.idCoz(id);
      if (!c) return;
      const hedef = { center: G.merkez(c.x, c.y), zoom: zoom ?? Math.max(map.getZoom(), 17.2), padding: dolgu(kap) };   // hedef panelin altında kalmasın
      if (anlik) map.easeTo({ ...hedef, duration: 0 }); else map.flyTo({ ...hedef, speed: 1.5, essential: true });
    },
    // Parsel şu an ekranda görünen alanda mı (canlı olaylar yalnızca o zaman haritayı tazeler)
    gorunurMu(id) {
      const c = G.idCoz(id);
      return !!c && kap.style.visibility !== 'hidden' && map.getBounds().contains(G.merkez(c.x, c.y));
    },
    // Tam sayfa çiftlik açıkken harita arkada çizilmez
    duraklat(d) {
      dunya.duraklat(d); kap.style.visibility = d ? 'hidden' : '';
      if (!d) { map.triggerRepaint(); if (bekleyenYukleme) { bekleyenYukleme = false; gorunurAlaniYukle({ zorla: true }); } }
    },
    yereGit({ merkez, bbox, zoom }) {
      if (bbox) map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: dolgu(kap), maxZoom: zoom ?? 15, duration: 1800 });
      else map.flyTo({ center: merkez, zoom: zoom ?? 15.5, padding: dolgu(kap), speed: 1.4, essential: true });
    },
    // İl seçilince ilçeleri, ilçe seçilince mahalle alanlarını göster
    async ilceleriGoster(plaka) {
      if (aktifIl === plaka) return;
      aktifIl = plaka; aktifIlce = null;
      map.getSource('mahalleler').setData(bos());
      const fc = await fetch(`/api/il/${encodeURIComponent(plaka)}/ilceler`).then((r) => (r.ok ? r.json() : bos())).catch(() => bos());
      if (aktifIl !== plaka) return;
      map.getSource('ilceler').setData(fc);
      map.getSource('ilce-adlari').setData({ type: 'FeatureCollection', features: fc.features.map((f) => ({ type: 'Feature',
        geometry: { type: 'Point', coordinates: typeof f.properties.merkez === 'string' ? JSON.parse(f.properties.merkez) : f.properties.merkez }, properties: { ad: f.properties.ad } })) });
    },
    async mahalleleriGoster(ilceId) {
      if (aktifIlce === ilceId) return;
      aktifIlce = ilceId;
      ipucu.textContent = 'Mahalleler yükleniyor…'; ipucu.classList.add('yukleniyor'); ipucu.hidden = false;
      const fc = await fetch(`/api/ilce/${ilceId}/mahalleler`).then((r) => (r.ok ? r.json() : bos())).catch(() => bos());
      ipucu.classList.remove('yukleniyor'); ipucuGuncelle();
      if (aktifIlce !== ilceId) return;
      fc.features.forEach((f, i) => { f.id = i + 1; });   // vurgulama için kimlik
      map.getSource('mahalleler').setData(fc);
      return fc.ilce;
    },
    // Panel açılıp kapanınca ülke görünümündeysek Türkiye görünür alana yeniden sığar
    paneleGoreSigdir() { if (map.getZoom() < 6.5 && !map.isMoving()) map.fitBounds(TURKIYE_KUTU, { padding: ulkeDolgu(kap), pitch: map.getPitch(), bearing: map.getBearing(), duration: 600 }); },
    turkiyeyeGit({ anlik = false } = {}) { map.fitBounds(TURKIYE_KUTU, { padding: ulkeDolgu(kap), pitch: kip === '3d' ? 35 : 0, bearing: 0, duration: anlik ? 0 : 1600 }); },
    ilIstatistikleri(liste) {
      ilIstatistik = new Map(liste.map((s) => [s.plaka, s]));
      const enCok = Math.max(1, ...liste.map((s) => s.parsel + s.ilan * 2));
      for (const s of liste) {
        map.setFeatureState({ source: 'iller', id: s.plaka }, { yogunluk: Math.log1p(s.parsel + s.ilan * 2) / Math.log1p(enCok) });
      }
    },
    benimParsellerim(portfoy) {
      map.getSource('benim').setData({ type: 'FeatureCollection', features: portfoy.map((p) => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { id: p.id } })) });
    },
    // Zaman yolculuğu (ülke): edinilen parseller zaman sırasıyla yanıp söner; süre ~12 sn
    zamanOynat(noktalar, { sure = 12000, ilerleme } = {}) {
      if (!map.getSource('zaman')) {
        map.addSource('zaman', { type: 'geojson', data: bos() });
        map.addLayer({ id: 'zaman-nokta', type: 'circle', source: 'zaman', paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, ['+', 2, ['*', 6, ['get', 'taze']]], 10, 6],
          'circle-color': ['match', ['get', 'z'], 'TARIM', '#4f9a3a', 'KONUT', '#d98a3a', 'TICARET', '#c8402e', 'SANAYI', '#6f5aa8', '#2b6f8f'],
          'circle-opacity': ['+', 0.45, ['*', 0.55, ['get', 'taze']]], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } });
      }
      if (!noktalar.length) return Promise.resolve();
      const t0 = noktalar[0].t, t1 = noktalar.at(-1).t || t0 + 1;
      const bas = performance.now();
      return new Promise((coz) => {
        const kare = (an) => {
          const oran = Math.min(1, (an - bas) / sure), simdi = t0 + (t1 - t0) * oran;
          const pencere = (t1 - t0) * 0.08 || 1;
          map.getSource('zaman').setData({ type: 'FeatureCollection', features: noktalar.filter((n) => n.t <= simdi).map((n) => ({ type: 'Feature',
            geometry: { type: 'Point', coordinates: [n.lon, n.lat] }, properties: { z: n.z, taze: Math.max(0, 1 - (simdi - n.t) / pencere) } })) });
          ilerleme?.(oran, simdi);
          if (oran < 1) requestAnimationFrame(kare); else coz();
        };
        requestAnimationFrame(kare);
      });
    },
    zamanTemizle() { map.getSource('zaman')?.setData(bos()); },
    isikAyari(yeni) { const r = isikAyari(yeni); this.gunesGuncelle(); return r; },
    yagisGuncelle: () => yagisGuncelle(),
    // Çarşı şubeleri: [{ kategori, ad, lon, lat, ikon }] + markalar (renk ve kısa ad için)
    carsiGoster(subeler, markalar = []) {
      const m = new Map(markalar.map((x) => [x.kategori, x]));
      map.getSource('carsi')?.setData({ type: 'FeatureCollection', features: subeler.map((s) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
        properties: { kategori: s.kategori, ikon: s.ikon, marka: m.get(s.kategori)?.ad || '', renk: m.get(s.kategori)?.renk || '#333333' } })) });
    },
    // Yöresel ürünler (kurallardan): il etiketi noktasının biraz kuzeyinde simge
    async yoreselGoster(yoresel) {
      yoreselIl = new Map();
      for (const y of Object.values(yoresel || {})) yoreselIl.set(y.il, [...(yoreselIl.get(y.il) || []), { ad: y.ad, ikon: y.ikon }]);
      try {
        const etiketler = await fetch('/veri/il-etiketleri.geojson').then((r) => r.json());
        map.getSource('yoresel')?.setData({ type: 'FeatureCollection', features: etiketler.features.filter((f) => yoreselIl.has(f.properties.plaka))
          .map((f) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [f.geometry.coordinates[0], f.geometry.coordinates[1] + 0.11] },
            properties: { plaka: f.properties.plaka, ikon: yoreselIl.get(f.properties.plaka)[0].ikon } })) });
      } catch { /* süs: etiketler gelmezse simge yok */ }
    },
    // Canlı dünya: başka bir oyuncunun eylemi görünür alandaysa o parselde 3 sn'lik baloncuk (DOM işaretçisi: haritayı yeniden çizdirmez)
    canliBaloncuk(eylem, parselId) {
      const b = CANLI_BALON[eylem], c = G.idCoz(parselId);
      if (!b || !c || canliBalonSayisi >= CANLI_BALON_MAKS || document.hidden || map.getZoom() < 4) return false;
      const yer = G.merkez(c.x, c.y);
      if (!map.getBounds().contains(yer)) return false;
      const el = document.createElement('div');
      el.className = 'canli-balon';
      const ikon = document.createElement('span'); ikon.textContent = b[0];
      el.append(ikon, b[1]);
      const m = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(yer).addTo(map);
      canliBalonSayisi++;
      setTimeout(() => { m.remove(); canliBalonSayisi--; }, 3200);
      return true;
    },
    havaGoster(liste) {
      sonHava = liste;
      dunya.hava(liste);
      // İl adının altına: il etiketi noktasından biraz güneye
      map.getSource('hava')?.setData({ type: 'FeatureCollection', features: liste.map((h) => ({ type: 'Feature',
        geometry: { type: 'Point', coordinates: [h.lon, h.lat - 0.16] }, properties: { ikon: h.ikon, sicaklik: h.sicaklik, uyari: h.uyari || '' } })) });
      yagisGuncelle();
    },
    // 3B yapı ışığı: güneşin gerçek konumu (harita merkezine göre)
    gunesGuncelle(t = Date.now()) {
      // Stil yüklenirken (ilk açılış, tema değişimi, pencere boyutu değişirken gelen moveend) setLight hata fırlatır:
      // stil hazır olunca bir kez daha dene
      if (!map.isStyleLoaded()) { map.once('idle', () => this.gunesGuncelle(t)); return null; }
      const c = map.getCenter();
      const g = gunesKonumu(c.lng, c.lat, t);
      const i = isikRengi(g.yukseklik);
      const gece = isikAyari() === 'gunduz' ? { renk: '#fff3dc', siddet: 1 } : i;
      map.setLight({ anchor: 'map', color: gece.renk, intensity: 0.25 + gece.siddet * 0.35, position: [1.4, g.azimut, Math.min(85, Math.max(15, 90 - g.yukseklik))] });
      atmosferGuncelle(map, t);
      return g;
    },
    kip: () => kip,
    kipAyarla,
    tema: () => tema,
    temaAyarla(yeni) {
      tema = yeni;
      temaUygula(map, yeni);
      dunya.etkinlestir(!!dunyaStili(yeni));
      if (kip === '3d') map.setTerrain({ source: 'yukselti-arazi', exaggeration: yeni === 'harita' ? 1.35 : 1.5 });
      katmanGorunurlugu();
      this.gunesGuncelle();
    },
    hareketli: () => dunya.hareketli(),
    oltaModu,
    merkez: () => map.getCenter(),
    efekt: (tur, konum, ikon) => { if (konum) dunya.efekt(tur, konum.lon, konum.lat, ikon); },
    hareketAyarla: (acik) => dunya.hareketAyarla(acik),
    grafikAyarla(ad) {
      dunya.grafikAyarla(ad);
      try { map.setPixelRatio(Math.min(window.devicePixelRatio || 1, GRAFIK[ad]?.piksel || 1)); } catch { /* eski sürüm */ }
      if (dunyaStili(tema)) dunya.etkinlestir(true);
      katmanGorunurlugu();
    },
    turBaslat(bitince) {
      return turBaslat(map, kap, { kipAyarla: (k) => { kipAyarla(k, { animasyon: false }); kap.dispatchEvent(new CustomEvent('kip', { detail: k })); }, bitince });
    },
    zoom: () => map.getZoom(),
    yenidenBoyutla: () => map.resize(),
  };
}
