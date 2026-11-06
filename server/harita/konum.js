// Parselin konum değeri çarpanı (arsa bedeli = alan × imar m² fiyatı × konum çarpanı; oyun.birincilBedel):
//   il fiyat seviyesi × ilçe farkı × denize/göle yakınlık × şehir/kasaba merkezine yakınlık × arazi (eğim, dağlık) × yol.
// Coğrafi etkenler gerçek veriden: kıyı şeridi ve yerleşim merkezleri OpenStreetMap vektör karolarından (z10, ≈ 30 km;
// 3 × 3 karo okunur), eğim ve çevresine göre yükseklik AWS arazi karolarından (yukselti.js). Kurallar config/konum-fiyat.js.
// Sonuç parselde saklanır (parcels.konum_kati, konum_json); formül sürümü değişince yeniden hesaplanır.
const { vektorKaro, SAHTE } = require('./karolar');
const { araziOzeti } = require('./yukselti');
const { normalize } = require('./imar');
const IL_MERKEZI = require('./il-merkezleri');
const { ilceBul } = require('./sinirlar');
const { IL_FIYAT, ILCE_FIYAT, KONUM } = require('../config/konum-fiyat');

const Z = 10, EXTENT = 4096;
const dunyaX = (lon) => ((lon + 180) / 360) * 2 ** Z * EXTENT;
const dunyaY = (lat) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** Z * EXTENT; };

const latDunya = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / (2 ** Z * EXTENT)))) * 180) / Math.PI;

const ilceFiyatlari = new Map(Object.entries(ILCE_FIYAT).flatMap(([plaka, t]) => Object.entries(t).map(([ad, v]) => [`${plaka}:${normalize(ad)}`, v])));

// z10 karosunun özeti (dünya koordinatında): deniz ve göl kıyı parçaları, şehir/kasaba noktaları. Karo kırpma
// kenarındaki yapay kenarlar atılır (komşu karo gerçek kıyıyı zaten içerir).
const ozetler = new Map();
const OZET_MAKS = 300;
function karoOzeti(kx, ky) {
  const anahtar = `${kx}:${ky}`;
  if (ozetler.has(anahtar)) return ozetler.get(anahtar);
  const is = vektorKaro(Z, kx, ky).then((karo) => {
    const ozet = { deniz: [], gol: [], yerler: [] };
    if (!karo) return ozet;
    const x0 = kx * EXTENT, y0 = ky * EXTENT;
    const kenarda = (a, b) => (a.x <= 0 && b.x <= 0) || (a.x >= EXTENT && b.x >= EXTENT) || (a.y <= 0 && b.y <= 0) || (a.y >= EXTENT && b.y >= EXTENT);
    const su = karo.layers.water;
    for (let i = 0; su && i < su.length; i++) {
      const f = su.feature(i), sinif = f.properties.class;
      const hedef = sinif === 'ocean' ? ozet.deniz : sinif === 'lake' ? ozet.gol : null;
      if (!hedef || f.type !== 3) continue;
      for (const halka of f.loadGeometry()) {
        for (let j = 1; j < halka.length; j++) {
          const a = halka[j - 1], b = halka[j];
          if (!kenarda(a, b)) hedef.push(x0 + a.x, y0 + a.y, x0 + b.x, y0 + b.y);
        }
      }
    }
    const yer = karo.layers.place;
    for (let i = 0; yer && i < yer.length; i++) {
      const f = yer.feature(i), p = f.properties;
      if (p.class !== 'city' && p.class !== 'town') continue;
      const n = f.loadGeometry()[0]?.[0];
      // Yalnızca Türkiye'deki yerleşimler (kıyıdaki Yunan adaları ve komşu ülke şehirleri merkez sayılmaz)
      if (n && ilceBul((x0 + n.x) / (2 ** Z * EXTENT) * 360 - 180, latDunya(y0 + n.y))) ozet.yerler.push({ ad: p['name:tr'] || p['name:latin'] || p.name, sinif: p.class, x: x0 + n.x, y: y0 + n.y });
    }
    return ozet;
  });
  ozetler.set(anahtar, is);
  is.catch(() => ozetler.delete(anahtar));
  if (ozetler.size > OZET_MAKS) ozetler.delete(ozetler.keys().next().value);
  return is;
}

function parcaUzakligi(px, py, s) {
  let en = Infinity;
  for (let i = 0; i < s.length; i += 4) {
    const ax = s[i], ay = s[i + 1], dx = s[i + 2] - ax, dy = s[i + 3] - ay, l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
    const d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
    if (d < en) en = d;
  }
  return Math.sqrt(en);
}

// Çevre: en yakın deniz ve göl kıyısı, şehir ve kasaba merkezi (metre; 3 × 3 karoda yoksa Infinity)
async function cevre(lon, lat, plaka) {
  const birimM = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (2 ** Z * EXTENT);
  const px = dunyaX(lon), py = dunyaY(lat), kx = Math.floor(px / EXTENT), ky = Math.floor(py / EXTENT);
  const sonuc = { denizM: Infinity, golM: Infinity, sehir: null, kasaba: null };
  if (!SAHTE) {
    const karolar = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) karolar.push(karoOzeti(kx + dx, ky + dy));
    for (const o of await Promise.all(karolar)) {
      sonuc.denizM = Math.min(sonuc.denizM, parcaUzakligi(px, py, o.deniz) * birimM);
      sonuc.golM = Math.min(sonuc.golM, parcaUzakligi(px, py, o.gol) * birimM);
      for (const y of o.yerler) {
        const m = Math.hypot(y.x - px, y.y - py) * birimM, tur = y.sinif === 'city' ? 'sehir' : 'kasaba';
        if (!sonuc[tur] || m < sonuc[tur].m) sonuc[tur] = { ad: y.ad, m };
      }
    }
  }
  // İl merkezi her zaman şehir sayılır (vektör karosunda şehir sınıfı olmayan il merkezleri ve sahte kaynak için)
  const im = IL_MERKEZI[plaka];
  if (im) {
    const m = Math.hypot(dunyaX(im[0]) - px, dunyaY(im[1]) - py) * birimM;
    if (!sonuc.sehir || m < sonuc.sehir.m) sonuc.sehir = { ad: null, m };
  }
  if (sonuc.sehir && (!sonuc.kasaba || sonuc.sehir.m < sonuc.kasaba.m)) sonuc.kasaba = sonuc.sehir;   // şehir merkezi kasabadan da yakın
  return sonuc;
}

const yuvarla = (v, b = 2) => Math.round(v * 10 ** b) / 10 ** b;
const egri = (m, { prim, olcek }) => (Number.isFinite(m) ? 1 + prim * Math.exp(-m / olcek) : 1);

// Saf hesap (testler doğrudan sınar): çevre (uzaklıklar) ve arazi özetinden çarpan ve döküm
function carpanHesapla({ plaka, ilce, c, a, yol = false }) {
  const il = IL_FIYAT[plaka] ?? 0.5;
  const ilceKat = ilceFiyatlari.get(`${plaka}:${normalize(ilce || '')}`) ?? 1;
  const deniz = egri(c.denizM, KONUM.deniz), gol = egri(c.golM, KONUM.gol), kiyi = Math.max(deniz, gol);
  let merkez = egri(c.sehir?.m, KONUM.sehir) + egri(c.kasaba?.m, KONUM.kasaba) - 1;
  const kasabaM = c.kasaba?.m ?? Infinity;
  if (kasabaM > KONUM.uzak.esik) merkez *= Math.max(KONUM.uzak.taban, 1 - (Math.min(kasabaM, 1e6) - KONUM.uzak.esik) / KONUM.uzak.adim);
  const egim = Math.max(KONUM.egim.taban, 1 - KONUM.egim.oran * Math.max(0, a.egim - KONUM.egim.esik));
  const dag = Math.max(KONUM.dag.taban, 1 - KONUM.dag.oran * Math.max(0, a.cevreFarki - KONUM.dag.esik));
  const yolKat = yol ? KONUM.yol : 1;
  const kat = yuvarla(Math.min(KONUM.ust, Math.max(KONUM.alt, il * ilceKat * kiyi * merkez * egim * dag * yolKat)));
  const m = (v) => (Number.isFinite(v) ? Math.round(v) : null);
  return {
    kat,
    ayrinti: {
      surum: KONUM.surum, il: yuvarla(il), ilce: yuvarla(ilceKat),
      kiyi: { kat: yuvarla(kiyi), denizM: m(c.denizM), golM: m(c.golM) },
      merkez: { kat: yuvarla(merkez), sehir: c.sehir && { ad: c.sehir.ad, m: m(c.sehir.m) }, kasaba: c.kasaba && { ad: c.kasaba.ad, m: m(c.kasaba.m) } },
      arazi: { kat: yuvarla(egim * dag), yukselti: a.yukselti, egim: a.egim, cevreFarki: a.cevreFarki },
      yol: yolKat,
    },
  };
}

// Konum çarpanı ve dökümü. yol: parsel ana yola yakın mı (harita/parsel.js imar karosundan bakar)
async function konumDegeri({ lon, lat, plaka, ilce, yol = false }) {
  const [c, a] = await Promise.all([cevre(lon, lat, plaka), araziOzeti(lon, lat)]);
  return carpanHesapla({ plaka, ilce, c, a, yol });
}

module.exports = { konumDegeri, carpanHesapla, cevre };
