// Ulusal sınır verisini hazırlar (bir kez çalışır; çıktılar depoya eklenir).
//   Girdi: server/veri/kaynak/geoBoundaries-TUR-ADM{0,1,2}_simplified.geojson
//          (geoBoundaries gbOpen, kaynak: OpenStreetMap katkıcıları — ODbL 1.0)
//   Çıktı: server/veri/iller.json, server/veri/ilceler.json  (sunucu: il/ilçe bulma)
//          public/veri/iller.geojson, public/veri/maske.geojson (istemci: ülke görünümü)
// Kullanım: npm run veri
const fs = require('fs');
const path = require('path');
const { geometrideMi, sinirKutusu, sadelestir, icNokta, yuvarla } = require('../harita/geo');

const KAYNAK = path.join(__dirname, 'kaynak');
const oku = (ad) => JSON.parse(fs.readFileSync(path.join(KAYNAK, `geoBoundaries-TUR-${ad}_simplified.geojson`), 'utf8'));

const slug = (s) => s.toLocaleLowerCase('tr-TR')
  .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
  .normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const adm0 = oku('ADM0').features[0].geometry;
const adm1 = oku('ADM1').features;
const adm2 = oku('ADM2').features;

// ---- İller
const iller = adm1.map((f) => {
  const plaka = f.properties.shapeISO.replace('TR-', '');
  const geo = sadelestir(f.geometry, 0.0008, 5);
  return { plaka, ad: f.properties.shapeName, kod: `TR-${plaka}`, bbox: sinirKutusu(geo).map((v) => yuvarla(v, 4)), merkez: icNokta(geo).map((v) => yuvarla(v, 4)), geo };
}).sort((a, b) => a.plaka.localeCompare(b.plaka));

// Merkez ilçe adları kaynakta tutarsız ("Adıyaman merkez", "Bilecik (merkez)", "Giresun District") → "<İl> Merkez"
function ilceAdi(ham, ilAd) {
  if (/^merkez$/i.test(ham.trim())) return `${ilAd} Merkez`;
  const m = /^(.+?)\s*\(?\s*([mM]erkez(i| [iİ]lçe)?|District)\s*\)?$/.exec(ham.trim());
  if (!m) return ham.trim();
  const kok = m[1].trim();
  return kok.toLocaleLowerCase('tr-TR') === ilAd.toLocaleLowerCase('tr-TR') || kok === 'Hakkari' ? `${ilAd} Merkez` : kok;
}

// ---- İlçeler: hangi ile ait olduğu, sınır halkasından içeri çekilmiş örnek noktaların çoğunluk oyuyla bulunur
const ilceler = adm2.map((f) => {
  const geo = sadelestir(f.geometry, 0.0004, 5);
  const merkez = icNokta(geo);
  const halka = (geo.type === 'Polygon' ? geo.coordinates : geo.coordinates[0])[0];
  const oy = new Map();
  const ornekler = [merkez];
  for (let i = 0; i < 24; i++) {
    const [x, y] = halka[Math.floor((i * halka.length) / 24)];
    ornekler.push([x + (merkez[0] - x) * 0.15, y + (merkez[1] - y) * 0.15]);
  }
  for (const [x, y] of ornekler) {
    const il = iller.find((i) => x >= i.bbox[0] && x <= i.bbox[2] && y >= i.bbox[1] && y <= i.bbox[3] && geometrideMi(x, y, i.geo));
    if (il) oy.set(il.plaka, (oy.get(il.plaka) || 0) + 1);
  }
  const plaka = [...oy.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!plaka) throw new Error(`İlçe için il bulunamadı: ${f.properties.shapeName}`);
  return { ad: ilceAdi(f.properties.shapeName, iller.find((i) => i.plaka === plaka).ad), kaynakAd: f.properties.shapeName, plaka, bbox: sinirKutusu(geo).map((v) => yuvarla(v, 4)), merkez: merkez.map((v) => yuvarla(v, 4)), geo };
  // DİKKAT: dizi sırası (idx) veritabanında ve imar önbelleğinde ilçe kimliğidir. Sıra kaynaktaki özgün ada göre
  // sabitlenir; görünen ad düzeltilse de değişmez. Sınır verisi yenilenirse taşıma (migration) gerekir.
}).sort((a, b) => a.plaka.localeCompare(b.plaka) || a.kaynakAd.localeCompare(b.kaynakAd, 'tr'));

// Kod çakışmalarını çöz (aynı ilde aynı adlı iki ilçe olmaz ama emniyet için)
const goruldu = new Set();
for (const i of ilceler) {
  let kod = `TR-${i.plaka}-${slug(i.kaynakAd)}`;
  for (let n = 2; goruldu.has(kod); n++) kod = `TR-${i.plaka}-${slug(i.kaynakAd)}-${n}`;
  goruldu.add(kod);
  i.kod = kod;
}
const ilAdi = Object.fromEntries(iller.map((i) => [i.plaka, i.ad]));

fs.writeFileSync(path.join(__dirname, 'iller.json'), JSON.stringify(iller.map(({ geo, ...r }) => ({ ...r, geo }))));
fs.writeFileSync(path.join(__dirname, 'ilceler.json'), JSON.stringify(ilceler.map(({ kaynakAd, ...i }) => ({ ...i, il: ilAdi[i.plaka] }))));

// ---- İstemci dosyaları
const PUB = path.join(__dirname, '..', '..', 'public', 'veri');
fs.mkdirSync(PUB, { recursive: true });
const ulkeGeo = sadelestir(adm0, 0.004, 4, 0.0004);
fs.writeFileSync(path.join(PUB, 'iller.geojson'), JSON.stringify({
  type: 'FeatureCollection',
  features: iller.map((i) => ({ type: 'Feature', id: Number(i.plaka), geometry: sadelestir(i.geo, 0.006, 4, 0.0004),
    properties: { plaka: i.plaka, ad: i.ad } })),
}));
fs.writeFileSync(path.join(PUB, 'il-etiketleri.geojson'), JSON.stringify({
  type: 'FeatureCollection',
  features: iller.map((i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: i.merkez }, properties: { plaka: i.plaka, ad: i.ad } })),
}));
// Maske: dünya dikdörtgeni, delikleri Türkiye'nin dış halkaları → ülke dışı soluk görünür
const disHalkalar = (ulkeGeo.type === 'Polygon' ? [ulkeGeo.coordinates] : ulkeGeo.coordinates).map((p) => p[0].slice().reverse());
fs.writeFileSync(path.join(PUB, 'maske.geojson'), JSON.stringify({
  type: 'Feature', properties: {},
  geometry: { type: 'Polygon', coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]], ...disHalkalar] },
}));
fs.writeFileSync(path.join(PUB, 'turkiye.geojson'), JSON.stringify({ type: 'Feature', properties: {}, geometry: ulkeGeo }));

const boyut = (f) => `${(fs.statSync(f).size / 1024).toFixed(0)} KB`;
console.log(`${iller.length} il, ${ilceler.length} ilçe hazırlandı.`);
for (const f of ['iller.json', 'ilceler.json']) console.log(' ', f, boyut(path.join(__dirname, f)));
for (const f of ['iller.geojson', 'il-etiketleri.geojson', 'maske.geojson', 'turkiye.geojson']) console.log('  public/veri/' + f, boyut(path.join(PUB, f)));
const ilBasina = {};
for (const i of ilceler) ilBasina[i.plaka] = (ilBasina[i.plaka] || 0) + 1;
console.log('  ilçe sayısı (örnek): Konya', ilBasina['42'], '· İstanbul', ilBasina['34'], '· Ankara', ilBasina['06'], '· Bayburt', ilBasina['69']);
