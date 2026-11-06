// Görünüm teması:
//   "ciftlik" — My Free Farm tadında elle boyanmış çiftlik dünyası: çiçekli çimen, sürülmüş tarlalar, toprak patikalar,
//               arnavut kaldırımı, kumsallı boyanmış su; 3B'de yumuşak ışıklı ağaçlar, kiremit çatılı evler (varsayılan)
//   "harita"  — Anadolu kartografyası (parşömen), 3B dünya kapalı
// Tema yalnızca katman görünürlüğünü ve boyalarını değiştirir; stil yeniden kurulmaz, oyun katmanları yerinde kalır.
import { gokTemasi } from './harita-gorsel.js';

const z = (...d) => ['interpolate', ['linear'], ['zoom'], ...d];
const kimligeGore = (renkler) => ['match', ['%', ['to-number', ['coalesce', ['id'], 0]], renkler.length], ...renkler.slice(0, -1).flatMap((r, i) => [i, r]), renkler.at(-1)];

// Çiftlik etiketi: krem yazı, koyu ahşap kahvesi kontur
const ETIKET_CIFTLIK = { 'text-color': '#fff6dc', 'text-halo-color': '#5a3511', 'text-halo-width': 2.1, 'text-halo-blur': 0.3 };

const TEMALAR = {
  harita: { gizle: [], goster: [], boya: {}, kure: false, dunya: null },
  // Çiftlik (varsayılan): My Free Farm tadında elle boyanmış çiftlik dünyası
  ciftlik: {
    gizle: ['bina-golge', 'desen-cayir', 'desen-park', 'desen-tarla', 'desen-orman'],
    goster: ['yukseklik-renk', 'ciftlik-zemin', 'ciftlik-tarla', 'ciftlik-orman', 'ciftlik-avlu', 'ciftlik-su', 'ciftlik-patika', 'ciftlik-yol'],
    kure: true, dunya: 'ciftlik',
    boya: {
      arkaplan: { 'background-color': '#8cbf55' },
      // Yükseklik: kıyı yeşili → bozkır sarısı → dağ kahvesi → karlı zirve (sıcak, boyanmış tonlar)
      'yukseklik-renk': { 'color-relief-color': ['interpolate', ['linear'], ['elevation'],
        -50, '#8fc35a', 0, '#97c75c', 500, '#aac862', 900, '#c2c46c', 1250, '#d1bb74', 1650, '#c9a56c', 2200, '#ad8a62', 2800, '#a39484', 3200, '#e8e4dc', 3600, '#ffffff'] },
      'ortu-tarla': { 'fill-color': kimligeGore(['#cdb45c', '#a9c25a', '#a8774a', '#d9c06c', '#b6c866']), 'fill-opacity': z(7, 0, 9, 0.9) },
      'ortu-cayir': { 'fill-color': '#93c45a', 'fill-opacity': z(5, 0.4, 11.5, 0.6, 12.5, 0) },
      'ortu-orman': { 'fill-color': '#4b8a34', 'fill-opacity': z(5, 0.8, 9, 1) },
      'ortu-kum': { 'fill-color': '#ecd9a0' },
      'kullanim-yerlesim': { 'fill-color': '#d6c196', 'fill-opacity': z(6, 0.6, 12, 0.9) },
      'kullanim-yerlesim-kenar': { 'line-color': '#a88a5c' },
      park: { 'fill-color': '#8cc455', 'fill-opacity': 0.15 },
      su: { 'fill-color': '#3d97cf', 'fill-outline-color': '#2f7fb4' },
      // Kıyılar kumsal: suyun kenarında sıcak kum şeridi
      'su-kiyi': { 'line-color': '#e9d6a0', 'line-opacity': z(6, 0.5, 12, 0.95), 'line-width': z(6, 1, 12, 4, 16, 12, 19, 28), 'line-blur': z(6, 0.5, 16, 2), 'line-offset': z(6, -0.5, 16, -5) },
      akarsu: { 'line-color': '#4aa3d8', 'line-width': z(8, 0.8, 18, 9) },
      bina: { 'fill-color': '#e6d2ab', 'fill-outline-color': '#a07a4a' },
      'yol-kenar': { 'line-color': '#8a6a44', 'line-opacity': z(5, 1, 13.8, 1, 14.6, 0) },
      'yol-ana': { 'line-color': ['match', ['get', 'class'], ['motorway', 'trunk'], '#f0d79a', '#efe0bc'], 'line-opacity': z(5, 1, 13.8, 1, 14.6, 0) },
      'yol-ara-kenar': { 'line-color': '#a68a5e', 'line-opacity': z(14, 0.9, 14.6, 0) },
      'yol-ara': { 'line-color': '#e6d4a8', 'line-opacity': z(12.5, 0, 13.5, 1, 14, 1, 14.6, 0) },
      demiryolu: { 'line-color': '#6e5a46' },
      'sinir-ilce': { 'line-color': '#fff3d0', 'line-opacity': 0.6 },
      'sinir-ulke': { 'line-color': '#ffe7a6', 'line-width': z(3, 1.2, 10, 3) },
      maske: { 'fill-color': '#4f9fd2', 'fill-opacity': z(5, 1, 7.5, 1, 9.5, 0) },   // Türkiye denizle çevrili bir ada gibi görünür
      'il-dolgu': { 'fill-color': ['interpolate', ['linear'], ['coalesce', ['feature-state', 'yogunluk'], 0], 0, '#fff0b8', 0.35, '#cfe79a', 1, '#5fae4a'],
        'fill-opacity': z(5, ['case', ['boolean', ['feature-state', 'uzerinde'], false], 0.5, 0.14], 8.5, 0.06, 10, 0) },
      'il-sinir': { 'line-color': '#fff6dc', 'line-opacity': z(4, 0.85, 9, 0.9, 11, 0), 'line-width': z(5, 1.2, 9, 2.4) },
      'il-vurgu': { 'line-color': '#ffcf4a' },
      'il-ad': { ...ETIKET_CIFTLIK, 'text-halo-width': 2.4 },
      rolyef: { 'hillshade-exaggeration': z(3, 0.55, 10, 0.45, 13, 0.3, 15, 0.12), 'hillshade-shadow-color': '#5e4a2a', 'hillshade-highlight-color': '#fffbe6',
        'hillshade-accent-color': '#5a4a2c' },
      izgara: { 'line-color': '#fff6dc', 'line-opacity': z(16, 0, 16.5, 0.3, 18, 0.42) },
      zirve: { 'text-color': '#fff6dc', 'text-halo-color': '#5a3511' },
      'etiket-su': { 'text-color': '#ffffff', 'text-halo-color': '#235f86', 'text-halo-width': 1.8 },
      'etiket-yol': { 'text-color': '#5a3511', 'text-halo-color': '#f6ead0', 'text-halo-width': 1.6 },
      'etiket-mahalle': ETIKET_CIFTLIK, 'etiket-koy': ETIKET_CIFTLIK, 'etiket-kasaba': ETIKET_CIFTLIK, 'etiket-sehir': { ...ETIKET_CIFTLIK, 'text-halo-width': 2.6 },
      'simge-isaret': ETIKET_CIFTLIK, 'il-hava': ETIKET_CIFTLIK,
    },
  },
};
export const TEMA_ADLARI = Object.keys(TEMALAR);
export const dunyaStili = (tema) => TEMALAR[tema]?.dunya || null;

const asil = new Map();   // "katman|boya" → özgün değer (başka temaya geçişte geri yüklenir)
const gizlenenler = new Set(Object.values(TEMALAR).flatMap((t) => t.gizle));
const temayaOzel = new Set(Object.values(TEMALAR).flatMap((t) => t.goster));
let aktif = null;

export function temaUygula(map, tema) {
  const t = TEMALAR[tema] || TEMALAR.ciftlik;
  aktif = TEMALAR[tema] ? tema : 'ciftlik';
  gokTemasi(aktif);
  const gor = (id, acik) => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', acik ? 'visible' : 'none'); };
  for (const id of temayaOzel) gor(id, t.goster.includes(id));
  for (const id of gizlenenler) gor(id, !t.gizle.includes(id));
  // Önce başka temaların değiştirdiği boyaları özgün hâline döndür, sonra bu temanınkileri uygula
  for (const [k, deger] of asil) {
    const [id, ozellik] = k.split('|');
    if (!t.boya[id]?.[ozellik] && map.getLayer(id)) map.setPaintProperty(id, ozellik, deger);
  }
  for (const [id, boyalar] of Object.entries(t.boya)) {
    if (!map.getLayer(id)) continue;
    for (const [ozellik, deger] of Object.entries(boyalar)) {
      const k = `${id}|${ozellik}`;
      if (!asil.has(k)) asil.set(k, map.getPaintProperty(id, ozellik));
      map.setPaintProperty(id, ozellik, deger);
    }
  }
  // Uzaydan küre: yakınlaştıkça düz (Mercator) haritaya yumuşak geçiş. Parsel ölçeğinde her zaman düz.
  try {
    map.setProjection({ type: t.kure ? ['interpolate', ['linear'], ['zoom'], 4.4, 'vertical-perspective', 5.8, 'mercator'] : 'mercator' });
  } catch { /* küre desteklenmiyorsa düz kalır */ }
  const kap = map.getContainer();
  for (const ad of TEMA_ADLARI) kap.classList.toggle(`tema-${ad}`, ad === aktif);
}
export const temaNe = () => aktif;
