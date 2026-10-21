// "Anadolu kartografyası" — Sanal Türkiye'nin kendi harita stili (OpenMapTiles şeması, OpenFreeMap karoları).
// Sıcak parşömen kara, sakin su, rölyef gölgelendirme; oyun katmanları (imar, parseller, 3B) harita.js'de eklenir.

export const RENK = {
  kara: '#efe9dc', tarla: '#e9dfbf', cayir: '#e1e3c2', orman: '#c7d6b1', kum: '#f0e4c0', sulak: '#d3e1cf',
  yerlesim: '#e8dece', sanayi: '#e2dbe2', kamu: '#eedfd6', park: '#d3e2bf',
  su: '#9cc8d8', suKoyu: '#86b9cd', suKenar: '#7fb0c4',
  bina: '#e0d2bc', binaKenar: '#cdbca2', bina3d: '#e6dac6',
  yolKenar: '#d6c9b2', yol: '#fffdf7', yolAna: '#fbe7bd', otoyol: '#f3bf7a', otoyolKenar: '#d9995a', demiryolu: '#9f978a',
  sinirUlke: '#7d6b55', sinirIl: '#a08f78', sinirIlce: '#b8aa94',
  yazi: '#25302e', yaziSoluk: '#5d6663', yaziSu: '#3c6f86', hale: '#f7f2e7',
};

const ad = ['coalesce', ['get', 'name:tr'], ['get', 'name:latin'], ['get', 'name']];
const ustel = (taban, ...duraklar) => ['interpolate', ['exponential', taban], ['zoom'], ...duraklar];
const dogrusal = (...duraklar) => ['interpolate', ['linear'], ['zoom'], ...duraklar];
const sinif = (...siniflar) => ['match', ['get', 'class'], siniflar, true, false];

// Karo kaynakları sunucu yapılandırmasından gelir (kendi karo sunucusu / PMTiles için: VEKTOR_TILEJSON, YUKSELTI_KARO, HARF_KARO)
export const KAYNAK = {
  vektor: 'https://tiles.openfreemap.org/planet',
  yukselti: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
  harfler: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
};
export function kaynaklariAyarla(k) { if (k) Object.assign(KAYNAK, Object.fromEntries(Object.entries(k).filter(([, v]) => v))); }

export function stilOlustur({ altlik = true } = {}) {
  const sources = {};
  const layers = [{ id: 'arkaplan', type: 'background', paint: { 'background-color': RENK.kara } }];

  sources.yukselti = { type: 'raster-dem', tiles: [KAYNAK.yukselti], tileSize: 256, maxzoom: 14, encoding: 'terrarium',
    attribution: '<a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">AWS Terrain Tiles</a>' };
  const { attribution: _, ...araziKaynagi } = sources.yukselti;   // atıf tek kez görünsün
  sources['yukselti-arazi'] = araziKaynagi;

  if (altlik) {
    sources.omt = { type: 'vector', url: KAYNAK.vektor,
      attribution: '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> · <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap katkıcıları</a>' };
    const v = (id, katman, ek) => ({ id, source: 'omt', 'source-layer': katman, ...ek });

    layers.push(
      v('ortu-tarla', 'landcover', { type: 'fill', filter: sinif('farmland'), minzoom: 8, paint: { 'fill-color': RENK.tarla, 'fill-opacity': dogrusal(8, 0, 11, 0.7) } }),
      v('ortu-cayir', 'landcover', { type: 'fill', filter: sinif('grass'), paint: { 'fill-color': RENK.cayir, 'fill-opacity': 0.6 } }),
      v('ortu-orman', 'landcover', { type: 'fill', filter: sinif('wood'), paint: { 'fill-color': RENK.orman, 'fill-opacity': dogrusal(5, 0.5, 10, 0.9) } }),
      v('ortu-kum', 'landcover', { type: 'fill', filter: sinif('sand'), paint: { 'fill-color': RENK.kum } }),
      v('ortu-sulak', 'landcover', { type: 'fill', filter: sinif('wetland'), paint: { 'fill-color': RENK.sulak } }),
      v('kullanim-yerlesim', 'landuse', { type: 'fill', filter: sinif('residential', 'suburb', 'quarter', 'neighbourhood'),
        paint: { 'fill-color': RENK.yerlesim, 'fill-opacity': dogrusal(6, 0.5, 12, 0.85) } }),
      v('kullanim-sanayi', 'landuse', { type: 'fill', filter: sinif('industrial', 'garages', 'railway', 'commercial', 'retail'), minzoom: 10, paint: { 'fill-color': RENK.sanayi } }),
      v('kullanim-kamu', 'landuse', { type: 'fill', filter: sinif('school', 'university', 'college', 'hospital', 'cemetery', 'stadium', 'pitch', 'military'), minzoom: 11, paint: { 'fill-color': RENK.kamu } }),
      v('park', 'park', { type: 'fill', paint: { 'fill-color': RENK.park, 'fill-opacity': 0.55 } }),
    );
  }

  // Rölyef: Anadolu platosu, Toroslar ve Karadeniz dağları her ölçekte okunsun
  layers.push({ id: 'rolyef', type: 'hillshade', source: 'yukselti', paint: {
    'hillshade-exaggeration': dogrusal(4, 0.55, 10, 0.4, 15, 0.18),
    'hillshade-shadow-color': '#5a4632', 'hillshade-highlight-color': '#fffaf0', 'hillshade-accent-color': '#6d5a46',
    'hillshade-illumination-direction': 315,
  } });

  if (altlik) {
    const v = (id, katman, ek) => ({ id, source: 'omt', 'source-layer': katman, ...ek });
    layers.push(
      v('su', 'water', { type: 'fill', filter: ['!=', ['get', 'brunnel'], 'tunnel'], paint: {
        'fill-color': dogrusal(4, RENK.suKoyu, 10, RENK.su), 'fill-outline-color': RENK.suKenar } }),
      v('akarsu', 'waterway', { type: 'line', paint: { 'line-color': RENK.su, 'line-width': ustel(1.3, 8, 0.5, 18, 6) } }),
      v('havalimani', 'aeroway', { type: 'fill', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#e7e1d4' } }),
      v('bina', 'building', { type: 'fill', minzoom: 13.5, paint: { 'fill-color': RENK.bina, 'fill-outline-color': RENK.binaKenar, 'fill-opacity': dogrusal(13.5, 0, 14.5, 1) } }),
      // Yollar: kenar çizgisi + iç dolgu
      v('yol-kenar', 'transportation', { type: 'line', filter: sinif('motorway', 'trunk', 'primary', 'secondary', 'tertiary'), minzoom: 7,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['match', ['get', 'class'], ['motorway', 'trunk'], RENK.otoyolKenar, RENK.yolKenar],
          'line-width': ustel(1.4, 7, 0.8, 12, 3, 16, 14, 19, 40) } }),
      v('yol-ara', 'transportation', { type: 'line', filter: sinif('minor', 'service'), minzoom: 12.5,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': RENK.yol, 'line-width': ustel(1.5, 12.5, 0.6, 16, 6, 19, 22), 'line-opacity': dogrusal(12.5, 0, 13.5, 1) } }),
      v('yol-ana', 'transportation', { type: 'line', filter: sinif('motorway', 'trunk', 'primary', 'secondary', 'tertiary'), minzoom: 5,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['match', ['get', 'class'], ['motorway', 'trunk'], RENK.otoyol, 'primary', RENK.yolAna, RENK.yol],
          'line-width': ustel(1.4, 5, ['match', ['get', 'class'], ['motorway', 'trunk'], 0.8, 0.3], 12, 2, 16, 11, 19, 34),
        } }),
      v('demiryolu', 'transportation', { type: 'line', filter: sinif('rail'), minzoom: 9,
        paint: { 'line-color': RENK.demiryolu, 'line-width': dogrusal(9, 0.6, 16, 2), 'line-dasharray': [3, 2] } }),
      v('sinir-ilce', 'boundary', { type: 'line', filter: ['==', ['get', 'admin_level'], 6], minzoom: 9,
        paint: { 'line-color': RENK.sinirIlce, 'line-width': dogrusal(9, 0.6, 14, 1.4), 'line-dasharray': [2, 2] } }),
      v('sinir-ulke', 'boundary', { type: 'line', filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
        paint: { 'line-color': RENK.sinirUlke, 'line-width': dogrusal(3, 0.8, 10, 2.4) } }),
      // 3B binalar (yalnızca 3B kipte görünür)
      v('bina-3d', 'building', { type: 'fill-extrusion', minzoom: 14, layout: { visibility: 'none' }, paint: {
        'fill-extrusion-color': RENK.bina3d,
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': 0.88, 'fill-extrusion-vertical-gradient': true,
      } }),
      // Etiketler
      v('etiket-su', 'water_name', { type: 'symbol', layout: { 'text-field': ad, 'text-font': ['Noto Sans Italic'], 'text-size': dogrusal(5, 11, 12, 15), 'text-letter-spacing': 0.1 },
        paint: { 'text-color': RENK.yaziSu, 'text-halo-color': 'rgba(255,255,255,0.6)', 'text-halo-width': 1.2 } }),
      v('etiket-yol', 'transportation_name', { type: 'symbol', minzoom: 14, layout: { 'symbol-placement': 'line', 'text-field': ad, 'text-font': ['Noto Sans Regular'], 'text-size': 11.5 },
        paint: { 'text-color': RENK.yaziSoluk, 'text-halo-color': RENK.hale, 'text-halo-width': 1.4 } }),
      v('etiket-mahalle', 'place', { type: 'symbol', minzoom: 12.5, filter: sinif('suburb', 'quarter', 'neighbourhood', 'hamlet', 'isolated_dwelling'),
        layout: { 'text-field': ad, 'text-font': ['Noto Sans Bold'], 'text-size': dogrusal(12.5, 10.5, 17, 14), 'text-transform': 'uppercase', 'text-letter-spacing': 0.14, 'text-max-width': 8 },
        paint: { 'text-color': '#4d5552', 'text-halo-color': RENK.hale, 'text-halo-width': 1.6 } }),
      v('etiket-koy', 'place', { type: 'symbol', minzoom: 10.5, filter: sinif('village'),
        layout: { 'text-field': ad, 'text-font': ['Noto Sans Regular'], 'text-size': dogrusal(10.5, 11, 15, 14.5) },
        paint: { 'text-color': RENK.yazi, 'text-halo-color': RENK.hale, 'text-halo-width': 1.5 } }),
      v('etiket-kasaba', 'place', { type: 'symbol', minzoom: 8, filter: sinif('town'),
        layout: { 'text-field': ad, 'text-font': ['Noto Sans Bold'], 'text-size': dogrusal(8, 11, 14, 16) },
        paint: { 'text-color': RENK.yazi, 'text-halo-color': RENK.hale, 'text-halo-width': 1.6 } }),
      v('etiket-sehir', 'place', { type: 'symbol', minzoom: 7.5, filter: sinif('city'),
        layout: { 'text-field': ad, 'text-font': ['Noto Sans Bold'], 'text-size': dogrusal(7.5, 13, 14, 20) },
        paint: { 'text-color': RENK.yazi, 'text-halo-color': RENK.hale, 'text-halo-width': 1.8 } }),
    );
  }

  return {
    version: 8,
    name: 'Sanal Türkiye — Anadolu',
    glyphs: KAYNAK.harfler,
    sources, layers,
    sky: {
      'sky-color': '#bcd7e4', 'horizon-color': '#efe4cf', 'fog-color': '#efe9dc',
      'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.7, 'fog-ground-blend': 0.85,
    },
    light: { anchor: 'viewport', color: '#fff6e8', intensity: 0.32, position: [1.3, 210, 35] },
  };
}

// Oyun katmanlarının yerleşeceği sıralama noktaları (beforeId)
export const SIRA = {
  imar: 'su',             // imar hücreleri: arazi + rölyefin üstünde, su/yol/binaların altında
  parsel: 'bina-3d',       // parsel çerçeveleri ve 3B oyun yapıları: etiketlerin altında
  ulke: 'etiket-su',       // il dolguları ve maske
};
