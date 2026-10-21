// Ulusal harita: ülke görünümü (81 il) → ilçe → mahalle → parsel hücreleri. 2B / 3B kipleri.
// Plan §2.4: ülke ölçeğinde parsel yüklenmez; imar hücreleri z14 karolarıyla, oyuncu parselleri görünür alanla gelir.
import * as maplibregl from '/vendor/maplibre/maplibre-gl.mjs';
import { stilOlustur, SIRA } from './stil.js';
import * as G from './izgara.js';
import { parselParcalari } from './modeller.js';
import { gunesKonumu, isikRengi } from './gunes.js';

const TURKIYE_KUTU = [[25.6, 35.75], [44.85, 42.15]];
const PARSEL_ZOOM = 14;          // imar hücreleri ve tıklanabilir parseller
const IZGARA_ZOOM = 16;          // hücre çizgileri
const IL_ZOOM = 8.5;             // bu ölçeğin altında il seçimi
const YAPI_ZOOM = 15;            // 3B oyun yapıları
const MAKS_HUCRE = 600;          // tek seferde istenebilecek alan (sunucu sınırıyla aynı)

const bos = () => ({ type: 'FeatureCollection', features: [] });

// Görünür harita alanı: masaüstünde sol üstte lejant, mobilde altta çekmece var
function dolgu(kap) {
  const dar = kap.clientWidth < 700;
  if (!dar) return { top: 40, bottom: 40, left: 230, right: 40 };
  const cekmece = document.getElementById('panel')?.offsetHeight || 0;
  return { top: 64, bottom: cekmece + 12, left: 12, right: 12 };
}

async function altlikVarMi() {
  try {
    const r = await fetch('https://tiles.openfreemap.org/planet', { signal: AbortSignal.timeout(4000) });
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
    const { gx, gy, z, yp, ek, kz } = f.properties;
    if (!yp && !ek && !kz) continue;
    for (const p of parselParcalari(z, yp, ek, kz)) {
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

// ---------- Kurulum ----------
export async function haritaKur(kap, { parselTik, ilTik, mahalleTik, belediyeTik, konumDegisti, kip = '2d' }) {
  const altlik = await altlikVarMi();
  const baglantidaKonumVar = /konum=/.test(location.hash);
  const map = new maplibregl.Map({
    container: kap, style: stilOlustur({ altlik }),
    bounds: TURKIYE_KUTU, fitBoundsOptions: { padding: dolgu(kap) },
    minZoom: 3.6, maxZoom: 19.5, maxPitch: 72,
    maxBounds: [[0, 0], [70, 62]],           // geniş tutuldu: mobil çekmece boşluğuyla da Türkiye ortalanabilsin
    hash: 'konum',                       // paylaşılabilir bağlantı: #konum=zoom/lat/lon/bearing/pitch
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-left');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
  map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, fitBoundsOptions: { maxZoom: 16.5 } }), 'bottom-left');

  if (!map.isStyleLoaded()) await new Promise((r) => map.once('style.load', r));
  // Kurucu seçeneği çekmece boşluğunu güvenilir uygulamıyor; bağlantıda konum yoksa burada sığdır
  if (!baglantidaKonumVar) map.fitBounds(TURKIYE_KUTU, { padding: dolgu(kap), duration: 0 });
  const once = (id) => (map.getLayer(id) ? id : undefined);

  // ---------- Kaynaklar ----------
  map.addSource('maske', { type: 'geojson', data: '/veri/maske.geojson' });
  map.addSource('iller', { type: 'geojson', data: '/veri/iller.geojson', promoteId: 'plaka' });
  map.addSource('il-etiket', { type: 'geojson', data: '/veri/il-etiketleri.geojson' });
  map.addSource('imar', { type: 'raster', tiles: [`${location.origin}/api/karo/imar/{x}/{y}.png`], tileSize: 512, minzoom: PARSEL_ZOOM, maxzoom: PARSEL_ZOOM,
    attribution: 'İmar: OSM arazi kullanımından türetilmiş oyun kuralı' });
  for (const k of ['izgara', 'imlec', 'secili', 'parseller', 'yapilar3d', 'benim', 'secimler', 'belediyeler']) map.addSource(k, { type: 'geojson', data: bos() });

  // ---------- Ülke görünümü ----------
  map.addLayer({ id: 'maske', type: 'fill', source: 'maske', paint: { 'fill-color': '#e4dccb', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.62, 9, 0.35] } }, once(SIRA.ulke));
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

  // ---------- İmar hücreleri ve ızgara ----------
  map.addLayer({ id: 'imar-karo', type: 'raster', source: 'imar', minzoom: PARSEL_ZOOM, paint: {
    'raster-resampling': 'nearest', 'raster-fade-duration': 250,
    'raster-opacity': ['interpolate', ['linear'], ['zoom'], PARSEL_ZOOM, 0, PARSEL_ZOOM + 0.4, 0.92, 18, 0.82],
  } }, once(SIRA.imar));
  map.addLayer({ id: 'izgara', type: 'line', source: 'izgara', minzoom: IZGARA_ZOOM, paint: {
    'line-color': '#fffdf6', 'line-width': ['interpolate', ['linear'], ['zoom'], IZGARA_ZOOM, 0.4, 19, 1.4],
    'line-opacity': ['interpolate', ['linear'], ['zoom'], IZGARA_ZOOM, 0, IZGARA_ZOOM + 0.5, 0.65],
  } }, once(SIRA.parsel));

  // ---------- Oyuncu parselleri ----------
  map.addLayer({ id: 'parsel-dolgu', type: 'fill', source: 'parseller', paint: {
    'fill-color': ['match', ['get', 's'], 1, '#e7b53a', 2, '#3d4548', '#ffffff'],
    'fill-opacity': ['match', ['get', 's'], 1, 0.22, 2, 0.12, 0],
  } }, once(SIRA.parsel));
  map.addLayer({ id: 'parsel-cerceve', type: 'line', source: 'parseller', filter: ['in', ['get', 's'], ['literal', [1, 2]]], paint: {
    'line-color': ['match', ['get', 's'], 1, '#d9a21b', '#3d4548'],
    'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1, 18, ['match', ['get', 's'], 1, 4, 2.2]],
  } }, once(SIRA.parsel));
  map.addLayer({ id: 'parsel-satilik', type: 'line', source: 'parseller', filter: ['==', ['get', 'l'], 1], paint: {
    'line-color': '#c8402e', 'line-dasharray': [1.4, 0.9], 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1.6, 18, 4],
  } }, once(SIRA.parsel));
  map.addLayer({ id: 'parsel-isaret', type: 'circle', source: 'parseller', maxzoom: YAPI_ZOOM + 0.6,
    filter: ['any', ['>', ['get', 'y'], 0], ['>', ['get', 'i'], 0], ['>', ['get', 'e'], 0]], paint: {
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
  map.addLayer({ id: 'benim', type: 'circle', source: 'benim', maxzoom: PARSEL_ZOOM, paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 5, 13, 8], 'circle-color': '#e7b53a', 'circle-stroke-color': '#7a5600', 'circle-stroke-width': 1.5,
  } });
  // Mahalle seçimleri ve muhtarlar: mahalle merkezinde sandık / yıldız işareti
  map.addLayer({ id: 'secim-isaret', type: 'circle', source: 'secimler', minzoom: 10, paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 7, 16, 13],
    'circle-color': ['case', ['!=', ['get', 'secim'], ''], '#0e5e50', '#e7b53a'],
    'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5,
  } });
  map.addLayer({ id: 'secim-etiket', type: 'symbol', source: 'secimler', minzoom: 11, layout: {
    'text-field': ['case', ['!=', ['get', 'secim'], ''], ['concat', 'SEÇİM · ', ['upcase', ['get', 'asama']]], ['concat', 'MUHTAR · ', ['get', 'muhtar']]],
    'text-font': ['Noto Sans Bold'], 'text-size': 10.5, 'text-offset': [0, 1.5], 'text-anchor': 'top', 'text-letter-spacing': 0.05,
  }, paint: { 'text-color': '#0e3d35', 'text-halo-color': 'rgba(255,253,248,.95)', 'text-halo-width': 1.6 } });
  // Belediyeler (ilçe merkezi) ve belediye projeleri (hedef mahalle)
  map.addLayer({ id: 'belediye-isaret', type: 'circle', source: 'belediyeler', minzoom: 8.5, paint: {
    // zoom ifadesi en dışta olmalı (MapLibre kuralı); tür ayrımı durakların içinde
    'circle-radius': ['interpolate', ['linear'], ['zoom'],
      8.5, ['match', ['get', 'tur'], 'belediye', 7, 4], 14, ['match', ['get', 'tur'], 'belediye', 12, 8], 16, ['match', ['get', 'tur'], 'belediye', 13, 10]],
    'circle-color': ['match', ['get', 'tur'], 'belediye', '#7a2e22', ['match', ['get', 'durum'], 'TAMAMLANDI', '#2f7d68', 'YAPIMDA', '#d9a21b', '#9aa3a8']],
    'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5,
  } });
  map.addLayer({ id: 'belediye-etiket', type: 'symbol', source: 'belediyeler', minzoom: 9.5, layout: {
    'text-field': ['get', 'etiket'], 'text-font': ['Noto Sans Bold'], 'text-size': ['match', ['get', 'tur'], 'belediye', 11, 9.5],
    'text-offset': [0, 1.4], 'text-anchor': 'top', 'text-letter-spacing': 0.04, 'text-max-width': 12,
  }, paint: { 'text-color': ['match', ['get', 'tur'], 'belediye', '#5a2219', '#2b3a37'], 'text-halo-color': 'rgba(255,253,248,.95)', 'text-halo-width': 1.6 } });
  map.addLayer({ id: 'il-ad', type: 'symbol', source: 'il-etiket', maxzoom: IL_ZOOM, layout: {
    'text-field': ['format', ['upcase', ['get', 'ad']], {}, '\n', {}, ['get', 'plaka'], { 'font-scale': 0.72 }],
    'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 5, 9.5, 8, 14], 'text-letter-spacing': 0.08,
    'text-allow-overlap': false, 'text-padding': 1,
  }, paint: { 'text-color': '#2b3a37', 'text-halo-color': 'rgba(247,242,231,0.9)', 'text-halo-width': 1.4,
    'text-opacity': ['interpolate', ['linear'], ['zoom'], 7.5, 1, IL_ZOOM, 0] } });

  // Simge parseller (miras alanları): ülke ölçeğinde simge, yakında ad
  map.addSource('simgeler', { type: 'geojson', data: '/api/simgeler' });
  map.addLayer({ id: 'simge-isaret', type: 'symbol', source: 'simgeler', minzoom: 6, layout: {
    'text-field': ['step', ['zoom'], ['get', 'ikon'], 9, ['format', ['get', 'ikon'], { 'font-scale': 1.3 }, '\n', {}, ['get', 'ad'], { 'font-scale': 0.8 }]],
    'text-font': ['Noto Sans Bold'], 'text-size': 14, 'text-allow-overlap': true, 'text-anchor': 'bottom',
  }, paint: { 'text-color': '#6b3a12', 'text-halo-color': 'rgba(255,248,230,.95)', 'text-halo-width': 1.6 } });

  // Gerçek hava (il merkezleri): il adının altında simge ve sıcaklık
  map.addSource('hava', { type: 'geojson', data: bos(), attribution: '<a href="https://open-meteo.com/" target="_blank" rel="noopener">Hava: Open-Meteo.com</a>' });
  map.addLayer({ id: 'il-hava', type: 'symbol', source: 'hava', maxzoom: IL_ZOOM, minzoom: 5.2, layout: {
    'text-field': ['get', 'etiket'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 2.3], 'text-anchor': 'top',
    'text-allow-overlap': false, 'text-optional': true,
  }, paint: { 'text-color': '#33504a', 'text-halo-color': 'rgba(247,242,231,0.9)', 'text-halo-width': 1.2,
    'text-opacity': ['interpolate', ['linear'], ['zoom'], 7.5, 1, IL_ZOOM, 0] } });

  // ---------- Durum ipucu (yakınlaşma / yükleniyor) ----------
  const ipucu = document.createElement('div');
  ipucu.className = 'harita-ipucu';
  ipucu.setAttribute('role', 'status');
  kap.appendChild(ipucu);
  const ilKarti = document.createElement('div');
  ilKarti.className = 'il-karti';
  ilKarti.hidden = true;
  kap.appendChild(ilKarti);
  let imarYukleniyor = false;
  const ipucuGuncelle = () => {
    const z = map.getZoom();
    let metin = '';
    if (z < IL_ZOOM) metin = '81 ilden birini seç ya da ara';
    else if (z < PARSEL_ZOOM) metin = 'Parsel ızgarası için yakınlaş';
    else if (imarYukleniyor) metin = 'İmar katmanı hazırlanıyor…';
    ipucu.textContent = metin;
    ipucu.hidden = !metin;
    ipucu.classList.toggle('yukleniyor', imarYukleniyor && z >= PARSEL_ZOOM);
  };
  map.on('sourcedataloading', (e) => { if (e.sourceId === 'imar') { imarYukleniyor = true; ipucuGuncelle(); } });
  map.on('idle', () => { imarYukleniyor = false; ipucuGuncelle(); });

  // ---------- Etkileşim ----------
  let ilUzerinde = null;
  let ilIstatistik = new Map();
  let hoverKare = 0;
  map.on('mousemove', (e) => {
    cancelAnimationFrame(hoverKare);
    hoverKare = requestAnimationFrame(() => {
      const z = map.getZoom();
      if (z >= PARSEL_ZOOM) {
        const c = G.hucre(e.lngLat.lng, e.lngLat.lat);
        map.getSource('imlec').setData({ type: 'Feature', geometry: G.poligon(c.x, c.y), properties: {} });
        map.getCanvas().style.cursor = 'pointer';
      } else map.getSource('imlec').setData(bos());

      const il = z < IL_ZOOM ? map.queryRenderedFeatures(e.point, { layers: ['il-dolgu'] })[0] : null;
      const plaka = il?.properties.plaka || null;
      if (plaka !== ilUzerinde) {
        if (ilUzerinde) map.setFeatureState({ source: 'iller', id: ilUzerinde }, { uzerinde: false });
        ilUzerinde = plaka;
        if (plaka) map.setFeatureState({ source: 'iller', id: plaka }, { uzerinde: true });
      }
      if (plaka) {
        const s = ilIstatistik.get(plaka) || {};
        ilKarti.innerHTML = `<b>${il.properties.ad}</b><span>${plaka}</span>
          <dl><div><dt>Parsel</dt><dd>${s.parsel || 0}</dd></div><div><dt>Oyuncu</dt><dd>${s.oyuncu || 0}</dd></div><div><dt>İlan</dt><dd>${s.ilan || 0}</dd></div><div><dt>Seçim</dt><dd>${s.secim || 0}</dd></div></dl>`;
        ilKarti.style.transform = `translate(${Math.min(e.point.x + 14, kap.clientWidth - 190)}px, ${Math.max(8, e.point.y - 70)}px)`;
        ilKarti.hidden = false;
        map.getCanvas().style.cursor = 'pointer';
      } else {
        ilKarti.hidden = true;
        if (z < PARSEL_ZOOM) map.getCanvas().style.cursor = '';
      }
    });
  });
  map.on('mouseout', () => { ilKarti.hidden = true; map.getSource('imlec').setData(bos()); });

  map.on('mouseenter', 'secim-isaret', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseenter', 'simge-isaret', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'simge-isaret', () => { map.getCanvas().style.cursor = ''; });
  map.on('mouseenter', 'belediye-isaret', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('click', (e) => {
    const z = map.getZoom();
    // Yalnızca stilde gerçekten var olan katmanları sorgula: bir katman eklenemezse parsel tıklaması bozulmasın
    const isaretKatmanlari = ['secim-isaret', 'belediye-isaret', 'simge-isaret'].filter((k) => map.getLayer(k));
    const isaret = z >= 6 && isaretKatmanlari.length ? map.queryRenderedFeatures(e.point, { layers: isaretKatmanlari })[0] : null;
    if (isaret?.layer.id === 'simge-isaret') {
      const id = isaret.properties.parsel;
      if (z < PARSEL_ZOOM) map.flyTo({ center: isaret.geometry.coordinates, zoom: 17.4, speed: 1.6 });
      parselTik(id);
      return;
    }
    if (isaret?.layer.id === 'secim-isaret') { mahalleTik?.(isaret.properties.id); return; }
    if (isaret?.layer.id === 'belediye-isaret') { belediyeTik?.(isaret.properties.id); return; }
    if (z >= PARSEL_ZOOM) {
      const c = G.hucre(e.lngLat.lng, e.lngLat.lat);
      parselTik(G.parselId(c.x, c.y));
      return;
    }
    if (z < IL_ZOOM) {
      const il = map.queryRenderedFeatures(e.point, { layers: ['il-dolgu'] })[0];
      if (il) { ilTik?.(il.properties.plaka); return; }
    }
    map.flyTo({ center: e.lngLat, zoom: Math.min(PARSEL_ZOOM + 2.2, z + 4), speed: 1.3 });
  });

  // ---------- Görünür alan verisi ----------
  let parselIstegi = null;
  let sonParseller = bos();
  let bekleyen = 0;
  async function gorunurAlaniYukle() {
    const z = map.getZoom();
    const b = map.getBounds();
    // Izgara çizgileri (yalnızca yakın ölçekte)
    if (z >= IZGARA_ZOOM - 0.2) {
      const a = G.hucre(b.getWest(), b.getNorth()), c = G.hucre(b.getEast(), b.getSouth());
      if (c.x - a.x < 260 && c.y - a.y < 260) {
        const cizgiler = [];
        for (let x = a.x; x <= c.x + 1; x++) cizgiler.push([[G.xLon(x), G.yLat(a.y)], [G.xLon(x), G.yLat(c.y + 1)]]);
        for (let y = a.y; y <= c.y + 1; y++) cizgiler.push([[G.xLon(a.x), G.yLat(y)], [G.xLon(c.x + 1), G.yLat(y)]]);
        map.getSource('izgara').setData({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: cizgiler }, properties: {} });
      }
    } else map.getSource('izgara').setData(bos());

    if (z >= 8.5) {
      fetch(`/api/harita/belediyeler?bbox=${[b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((v) => v.toFixed(5)).join(',')}`, { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.json() : bos())).then((fc) => map.getSource('belediyeler').setData(fc)).catch(() => {});
    }
    if (z >= 10) {
      fetch(`/api/harita/secimler?bbox=${[b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((v) => v.toFixed(5)).join(',')}`, { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.json() : bos())).then((fc) => map.getSource('secimler').setData(fc)).catch(() => {});
    }
    if (z < 12.5) return;
    const a = G.hucre(b.getWest(), b.getNorth()), c = G.hucre(b.getEast(), b.getSouth());
    if (c.x - a.x > MAKS_HUCRE || c.y - a.y > MAKS_HUCRE) return;
    parselIstegi?.abort();
    parselIstegi = new AbortController();
    try {
      const r = await fetch(`/api/harita/parseller?bbox=${[b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((v) => v.toFixed(6)).join(',')}`,
        { signal: parselIstegi.signal, credentials: 'same-origin' });
      if (!r.ok) return;
      sonParseller = await r.json();
      map.getSource('parseller').setData(sonParseller);
      map.getSource('yapilar3d').setData(yapilar3dUret(sonParseller));
    } catch (err) {
      if (err.name !== 'AbortError') console.warn('Parseller alınamadı', err);
    }
  }
  map.on('moveend', () => {
    clearTimeout(bekleyen);
    bekleyen = setTimeout(gorunurAlaniYukle, 180);
    konumDegisti?.(map.getCenter(), map.getZoom());
    ipucuGuncelle();
  });
  map.on('zoom', ipucuGuncelle);

  // ---------- 2B / 3B ----------
  function kipAyarla(yeni, { animasyon = true } = {}) {
    kip = yeni;
    const uc = yeni === '3d';
    if (uc) map.setTerrain({ source: 'yukselti-arazi', exaggeration: 1.35 });
    else map.setTerrain(null);
    if (map.getLayer('bina-3d')) map.setLayoutProperty('bina-3d', 'visibility', uc ? 'visible' : 'none');
    if (map.getLayer('bina')) map.setPaintProperty('bina', 'fill-opacity', uc ? 0 : ['interpolate', ['linear'], ['zoom'], 13.5, 0, 14.5, 1]);
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

  ipucuGuncelle();
  gorunurAlaniYukle();

  return {
    map,
    yenile: gorunurAlaniYukle,
    sec(id) {
      const c = G.idCoz(id);
      map.getSource('secili').setData(c ? { type: 'Feature', geometry: G.poligon(c.x, c.y), properties: {} } : bos());
    },
    parseleGit(id, { zoom } = {}) {
      const c = G.idCoz(id);
      if (!c) return;
      map.flyTo({ center: G.merkez(c.x, c.y), zoom: zoom ?? Math.max(map.getZoom(), 17.2), speed: 1.5, essential: true });
    },
    yereGit({ merkez, bbox, zoom }) {
      if (bbox) map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: dolgu(kap), maxZoom: zoom ?? 15, duration: 1800 });
      else map.flyTo({ center: merkez, zoom: zoom ?? 15.5, speed: 1.4, essential: true });
    },
    turkiyeyeGit() { map.fitBounds(TURKIYE_KUTU, { padding: dolgu(kap), pitch: kip === '3d' ? 35 : 0, duration: 1600 }); },
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
    havaGoster(liste) {
      map.getSource('hava')?.setData({ type: 'FeatureCollection', features: liste.map((h) => ({ type: 'Feature',
        geometry: { type: 'Point', coordinates: [h.lon, h.lat] }, properties: { etiket: `${h.ikon} ${h.sicaklik}°` } })) });
    },
    // 3B yapı ışığı: güneşin gerçek konumu (harita merkezine göre)
    gunesGuncelle(t = Date.now()) {
      const c = map.getCenter();
      const g = gunesKonumu(c.lng, c.lat, t);
      const i = isikRengi(g.yukseklik);
      map.setLight({ anchor: 'map', color: i.renk, intensity: 0.25 + i.siddet * 0.35, position: [1.4, g.azimut, Math.min(85, Math.max(15, 90 - g.yukseklik))] });
      return g;
    },
    kip: () => kip,
    kipAyarla,
    zoom: () => map.getZoom(),
    yenidenBoyutla: () => map.resize(),
  };
}
