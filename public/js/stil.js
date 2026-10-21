// "Anadolu kartografyası" — Sanal Türkiye'nin kendi harita stili (OpenMapTiles şeması, OpenFreeMap karoları).
// Sıcak parşömen kara, sakin su, rölyef gölgelendirme; oyun katmanları (imar, parseller, 3B) harita.js'de eklenir.

export const RENK = {
  kara: '#efe8d8', tarla: '#ebdfb6', cayir: '#dfe5bd', orman: '#bdd2a2', kum: '#f1e3ba', sulak: '#cfe2cd',
  yerlesim: '#ecdfca', yerlesimKenar: '#dfcdb0', sanayi: '#e3dce3', kamu: '#f0ded2', park: '#c9e0b0',
  su: '#9cc8d8', suKoyu: '#7fb3c9', suAcik: '#cfe7ee', suKenar: '#7fb0c4',
  bina: '#e0d2bc', binaKenar: '#c9b597', bina3d: '#e6dac6',
  // Bina çeşitliliği: Anadolu kasabası tonları (krem, bal, açık kiremit, taş) ve kiremit çatılar
  binaTon: ['#ece0cb', '#e4d2b4', '#efd8c2', '#dcd3c4', '#e8cfae'],
  cati: ['#b5543b', '#a24a35', '#c0674a', '#8f6a55'], catiDuz: '#9a9a96',
  yolKenar: '#d6c9b2', yol: '#fffdf7', yolAna: '#fbe7bd', otoyol: '#f3bf7a', otoyolKenar: '#d9995a', demiryolu: '#9f978a',
  sinirUlke: '#7d6b55', sinirIl: '#a08f78', sinirIlce: '#b8aa94',
  yazi: '#25302e', yaziSoluk: '#5d6663', yaziSu: '#3c6f86', hale: '#f7f2e7',
};

const ad = ['coalesce', ['get', 'name:tr'], ['get', 'name:latin'], ['get', 'name']];
const ustel = (taban, ...duraklar) => ['interpolate', ['exponential', taban], ['zoom'], ...duraklar];
const dogrusal = (...duraklar) => ['interpolate', ['linear'], ['zoom'], ...duraklar];
const sinif = (...siniflar) => ['match', ['get', 'class'], siniflar, true, false];
// Özellik kimliğine göre kararlı renk seçimi (aynı bina her zaman aynı tonda)
const kimligeGore = (renkler) => ['match', ['%', ['to-number', ['coalesce', ['id'], 0]], renkler.length], ...renkler.slice(0, -1).flatMap((r, i) => [i, r]), renkler.at(-1)];
const binaBoyu = ['coalesce', ['get', 'render_height'], 6];

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
      v('kullanim-yerlesim-kenar', 'landuse', { type: 'line', minzoom: 12, filter: sinif('residential', 'suburb', 'quarter', 'neighbourhood'),
        paint: { 'line-color': RENK.yerlesimKenar, 'line-width': dogrusal(12, 0.4, 16, 1.2), 'line-opacity': 0.7 } }),
      v('park', 'park', { type: 'fill', paint: { 'fill-color': RENK.park, 'fill-opacity': dogrusal(6, 0.4, 13, 0.75) } }),
      // Yakın ölçekte doku: tarla sıraları, ağaç taçları, çayır benekleri (desenler harita-gorsel.js'de çizilir)
      v('desen-tarla', 'landcover', { type: 'fill', filter: sinif('farmland'), minzoom: 12.5, paint: { 'fill-pattern': 'desen-tarla', 'fill-opacity': dogrusal(12.5, 0, 14, 0.55) } }),
      v('desen-orman', 'landcover', { type: 'fill', filter: sinif('wood'), minzoom: 11.5, paint: { 'fill-pattern': 'desen-orman', 'fill-opacity': dogrusal(11.5, 0, 13, 0.8) } }),
      v('desen-cayir', 'landcover', { type: 'fill', filter: sinif('grass'), minzoom: 13, paint: { 'fill-pattern': 'desen-cayir', 'fill-opacity': dogrusal(13, 0, 14.5, 0.6) } }),
      v('desen-park', 'park', { type: 'fill', minzoom: 13, paint: { 'fill-pattern': 'desen-orman', 'fill-opacity': dogrusal(13, 0, 14.5, 0.55) } }),
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
        // zoom ifadesi en dışta (MapLibre kuralı): deniz koyu, göl ve akarsu açık
        'fill-color': dogrusal(4, ['match', ['get', 'class'], ['ocean', 'sea'], RENK.suKoyu, RENK.su], 12, ['match', ['get', 'class'], ['ocean', 'sea'], RENK.su, '#a9d1de']),
        'fill-outline-color': RENK.suKenar } }),
      // Kıyı parıltısı: sığ suyun açık tonu kıyıdan içeri doğru yumuşakça söner
      v('su-kiyi', 'water', { type: 'line', filter: ['!=', ['get', 'brunnel'], 'tunnel'], paint: {
        'line-color': RENK.suAcik, 'line-width': ustel(1.5, 4, 1.5, 10, 7, 16, 22), 'line-blur': ustel(1.5, 4, 1.5, 10, 6, 16, 18),
        'line-opacity': dogrusal(4, 0.55, 14, 0.75), 'line-offset': ustel(1.5, 4, 0.6, 10, 3, 16, 10) } }),
      v('akarsu', 'waterway', { type: 'line', paint: { 'line-color': RENK.su, 'line-width': ustel(1.3, 8, 0.5, 18, 6) } }),
      v('havalimani', 'aeroway', { type: 'fill', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#e7e1d4' } }),
      v('bina-golge', 'building', { type: 'fill', minzoom: 14, paint: { 'fill-color': '#6b5640', 'fill-opacity': dogrusal(14, 0, 15, 0.22),
        'fill-translate': dogrusal(14, ['literal', [0.6, 0.6]], 18, ['literal', [3, 3]]), 'fill-translate-anchor': 'viewport' } }),
      v('bina', 'building', { type: 'fill', minzoom: 13, paint: { 'fill-color': kimligeGore(RENK.binaTon), 'fill-outline-color': RENK.binaKenar, 'fill-opacity': dogrusal(13, 0, 14, 1) } }),
      // Yollar: kenar çizgisi + iç dolgu
      v('yol-kenar', 'transportation', { type: 'line', filter: sinif('motorway', 'trunk', 'primary', 'secondary', 'tertiary'), minzoom: 7,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['match', ['get', 'class'], ['motorway', 'trunk'], RENK.otoyolKenar, RENK.yolKenar],
          'line-width': ustel(1.4, 7, 0.8, 12, 3, 16, 14, 19, 40) } }),
      v('yol-ara-kenar', 'transportation', { type: 'line', filter: sinif('minor', 'service'), minzoom: 14,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': RENK.yolKenar, 'line-width': ustel(1.5, 14, 2, 16, 8, 19, 26), 'line-opacity': dogrusal(14, 0, 15, 0.9) } }),
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
        'fill-extrusion-color': kimligeGore(RENK.binaTon),
        'fill-extrusion-height': binaBoyu,
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': 0.94, 'fill-extrusion-vertical-gradient': true,
      } }),
      // Çatı: alçak binalarda kiremit, yüksek binalarda düz beton çatı kapağı
      v('bina-3d-cati', 'building', { type: 'fill-extrusion', minzoom: 14.5, layout: { visibility: 'none' }, paint: {
        'fill-extrusion-color': ['case', ['<=', binaBoyu, 16], kimligeGore(RENK.cati), RENK.catiDuz],
        'fill-extrusion-base': binaBoyu,
        'fill-extrusion-height': ['+', binaBoyu, ['case', ['<=', binaBoyu, 16], 1.6, 0.5]],
        'fill-extrusion-opacity': dogrusal(14.5, 0, 15.2, 0.96), 'fill-extrusion-vertical-gradient': false,
      } }),
      // Gece: yerleşimlerin sıcak ışık halesi (gündüz görünmez; atmosfer ayarı opaklığı açar)
      // Ülke ölçeğinde şehir haleleri (yakında ışığı yollar ve yerleşimler verir: harita-gorsel.js)
      v('sehir-isik', 'place', { type: 'circle', maxzoom: 10, filter: sinif('city', 'town', 'village'), paint: {
        'circle-color': '#ffcf73', 'circle-blur': 1,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, ['match', ['get', 'class'], 'city', 9, 'town', 3.5, 1.2], 9, ['match', ['get', 'class'], 'city', 46, 'town', 16, 4]],
        'circle-opacity': 0 } }),
      // Etiketler
      v('zirve', 'mountain_peak', { type: 'symbol', minzoom: 9, filter: ['has', 'ele'], layout: {
        'icon-image': 'zirve', 'icon-size': dogrusal(9, 0.55, 14, 0.8), 'text-field': ['concat', ad, '\n', ['to-string', ['get', 'ele']], ' m'],
        'text-font': ['Noto Sans Italic'], 'text-size': dogrusal(9, 9.5, 14, 11.5), 'text-offset': [0, 0.9], 'text-anchor': 'top', 'text-optional': true,
        'symbol-sort-key': ['-', 0, ['to-number', ['get', 'ele']]] },
        paint: { 'text-color': '#6b4f33', 'text-halo-color': RENK.hale, 'text-halo-width': 1.3 } }),
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
