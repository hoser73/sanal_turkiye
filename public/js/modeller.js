// Oyun nesnelerinin 3B tanımları — hem harita (MapLibre fill-extrusion) hem parsel sahnesi (three.js) bu tabloyu kullanır.
// Yerel koordinatlar hücre içindedir: u (batı→doğu), v (kuzey→güney), 0..1. Yükseklikler metredir.

export const PALET = {
  duvarSicak: '#f1e1c6', duvarKrem: '#f6efe3', duvarAcik: '#e9dfcf', duvarKoyu: '#d8c9b1',
  kiremit: '#c4553b', kiremitKoyu: '#9e3f2c', cati: '#7d858b',
  beton: '#b7c1c7', betonAcik: '#d3dbe0', metal: '#8e9aa2', baca: '#776a63',
  tente: '#c8402e', tenteYesil: '#2e7d5b', cam: '#cfeee8', havuz: '#5fbfdc',
  ahirKirmizi: '#9c4a32', ahirCati: '#6b3424', panel: '#28456f', su: '#8fb3c4',
  govde: '#7a5a3a', yaprak: '#4f8f4a', yaprakAcik: '#6aa95c', cit: '#8d8a83', boru: '#3d8fd1',
  insaat: '#e2b23a',
};

// Ekin görünümü: büyüme (0..1) ve olgunluğa göre renk/yükseklik
export const EKIN = {
  BUGDAY: { genc: '#9cc46a', olgun: '#e3c158', boy: 1.1, tur: 'sira' },
  DOMATES: { genc: '#6aa84f', olgun: '#d9503f', boy: 0.9, tur: 'sira' },
  ELMA: { genc: '#5c9a4f', olgun: '#c7463a', boy: 4.2, tur: 'agac' },
  FINDIK: { genc: '#5f9e4c', olgun: '#8a6a3c', boy: 3.2, tur: 'agac' },
  CAY: { genc: '#5aa35a', olgun: '#2f7a3b', boy: 0.8, tur: 'sira' },
  PAMUK: { genc: '#7fb36a', olgun: '#f4f1ea', boy: 1.0, tur: 'sira' },
  ZEYTIN: { genc: '#7d9a6a', olgun: '#5d6b3a', boy: 3.6, tur: 'agac' },
  KAYISI: { genc: '#64a052', olgun: '#f0a13a', boy: 3.8, tur: 'agac' },
  UZUM: { genc: '#78a85a', olgun: '#6b3a6e', boy: 1.4, tur: 'sira' },
};

export function renkKaristir(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

// Ana yapıların yerleşim yuvaları (sırayla doldurulur) — birbirleriyle çakışmaz
const ANA_YUVALAR = [[0.2, 0.2, 0.62, 0.62], [0.66, 0.16, 0.9, 0.46], [0.66, 0.54, 0.9, 0.86], [0.16, 0.68, 0.56, 0.9]];
const TARIM_YUVALARI = { SERA: [0.56, 0.1, 0.9, 0.44], AMBAR: [0.58, 0.56, 0.9, 0.88] };

// Bir kutu (u0,v0,u1,v1) içinde göreli dikdörtgen
const ic = ([u0, v0, u1, v1], a, b, c, d) => [u0 + (u1 - u0) * a, v0 + (v1 - v0) * b, u0 + (u1 - u0) * c, v0 + (v1 - v0) * d];

// Parça: { tur: 'kutu'|'silindir', alan: [u0,v0,u1,v1] | {u,v,r}, taban, tavan, renk, cati?: 'kirma'|'duz' }
export function yapiParcalari(tip, yuva, tamam = true) {
  const p = [];
  const kutu = (alan, taban, tavan, renk, ek = {}) => p.push({ tur: 'kutu', alan, taban, tavan, renk, ...ek });
  const silindir = (u, v, r, taban, tavan, renk, ek = {}) => p.push({ tur: 'silindir', u, v, r, taban, tavan, renk, ...ek });
  switch (tip) {
    case 'EV':
      kutu(ic(yuva, 0.12, 0.18, 0.88, 0.86), 0, 6, PALET.duvarSicak, { cati: 'kirma', catiYuksek: 3, catiRenk: PALET.kiremit });
      break;
    case 'APARTMAN':
      for (let k = 0; k < 4; k++) kutu(ic(yuva, 0.08, 0.08, 0.92, 0.92), k * 3.2, k * 3.2 + 3.2, k % 2 ? PALET.duvarKoyu : PALET.duvarAcik);
      kutu(ic(yuva, 0.12, 0.12, 0.88, 0.88), 12.8, 13.6, PALET.cati);
      break;
    case 'DUKKAN':
      kutu(ic(yuva, 0.1, 0.25, 0.9, 0.9), 0, 4.5, PALET.duvarKrem, { cati: 'duz' });
      kutu(ic(yuva, 0.1, 0.12, 0.9, 0.25), 2.8, 3.2, PALET.tente);
      break;
    case 'RESTORAN':
      kutu(ic(yuva, 0.08, 0.28, 0.92, 0.92), 0, 5, '#fff3e0', { cati: 'duz' });
      kutu(ic(yuva, 0.08, 0.12, 0.92, 0.28), 3, 3.4, PALET.tenteYesil);
      break;
    case 'PANSIYON':
      kutu(ic(yuva, 0.1, 0.1, 0.9, 0.7), 0, 7.5, '#fbe9d0', { cati: 'kirma', catiYuksek: 3, catiRenk: PALET.kiremit });
      kutu(ic(yuva, 0.2, 0.78, 0.8, 0.98), 0, 0.25, PALET.havuz);
      break;
    case 'DEPO':
      kutu(ic(yuva, 0, 0.1, 1, 0.9), 0, 7, PALET.beton, { cati: 'duz', catiRenk: PALET.betonAcik });
      break;
    case 'FABRIKA':
      kutu(ic(yuva, 0, 0.08, 0.78, 0.92), 0, 9, PALET.metal, { cati: 'duz', catiRenk: PALET.beton });
      silindir(yuva[0] + (yuva[2] - yuva[0]) * 0.9, yuva[1] + (yuva[3] - yuva[1]) * 0.25, 0.035, 0, 17, PALET.baca, { baca: true });
      silindir(yuva[0] + (yuva[2] - yuva[0]) * 0.9, yuva[1] + (yuva[3] - yuva[1]) * 0.25, 0.037, 15.5, 17.2, PALET.tente);
      break;
    case 'SERA':
      kutu(yuva, 0, 3.2, PALET.cam, { cati: 'kirma', catiYuksek: 1.2, catiRenk: '#e4f6f2', saydam: true });
      break;
    case 'AMBAR':
      kutu(yuva, 0, 4.5, PALET.ahirKirmizi, { cati: 'kirma', catiYuksek: 2.5, catiRenk: PALET.ahirCati });
      break;
    case 'SU_DEPOSU':
      silindir(0.9, 0.9, 0.05, 0, 6, PALET.su);
      silindir(0.9, 0.9, 0.055, 6, 6.6, PALET.metal);
      break;
    case 'GUNES_PANELI':
      for (let k = 0; k < 3; k++) kutu([0.06, 0.06 + k * 0.07, 0.4, 0.11 + k * 0.07], 0.7, 0.95, PALET.panel, { egim: true });
      break;
    case 'PEYZAJ':
      for (const [u, v] of [[0.08, 0.92], [0.92, 0.08], [0.1, 0.5], [0.5, 0.94]]) {
        silindir(u, v, 0.012, 0, 2, PALET.govde);
        silindir(u, v, 0.055, 1.6, 6, PALET.yaprak, { yaprak: true });
      }
      break;
    case 'TEL_CIT': {
      const g = 0.008;
      kutu([0, 0, 1, g], 0, 1.3, PALET.cit); kutu([0, 1 - g, 1, 1], 0, 1.3, PALET.cit);
      kutu([0, 0, g, 1], 0, 1.3, PALET.cit); kutu([1 - g, 0, 1, 1], 0, 1.3, PALET.cit);
      break;
    }
    case 'SULAMA_HATTI':
      for (const v of [0.2, 0.5, 0.8]) kutu([0.06, v - 0.006, 0.52, v + 0.006], 0, 0.35, PALET.boru);
      break;
    default:
      kutu(ic(yuva, 0.2, 0.2, 0.8, 0.8), 0, 3, PALET.duvarAcik);
  }
  if (!tamam) {
    // İnşaat hâli: yapının alt %40'ı + iskele rengi
    return p.map((x) => ({ ...x, tavan: x.taban + (x.tavan - x.taban) * 0.4, renk: PALET.insaat, cati: null, insaat: true }));
  }
  return p;
}

export function ekinParcalari(tip, buyume) {
  const e = EKIN[tip];
  if (!e) return [];
  const olgunluk = Math.max(0, (buyume - 0.6) / 0.4);
  const renk = renkKaristir(e.genc, e.olgun, olgunluk);
  const p = [];
  if (e.tur === 'agac') {
    for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) {
      const u = 0.12 + i * 0.14, v = 0.14 + j * 0.22;
      p.push({ tur: 'silindir', u, v, r: 0.01, taban: 0, tavan: 1.2 * Math.max(0.3, buyume), renk: PALET.govde });
      p.push({ tur: 'silindir', u, v, r: 0.02 + 0.03 * buyume, taban: 1 * Math.max(0.3, buyume), tavan: e.boy * Math.max(0.25, buyume), renk, yaprak: true });
    }
  } else {
    const boy = 0.15 + e.boy * buyume;
    for (let k = 0; k < 8; k++) {
      const v = 0.1 + k * 0.105;
      p.push({ tur: 'kutu', alan: [0.08, v, 0.5, v + 0.055], taban: 0, tavan: boy, renk });
    }
  }
  return p;
}

// Bir parselin tüm parçaları: yp = "EV:1,PEYZAJ:0", ek = "DOMATES:0.42"
// kz: kozmetik kodu "cati:#hex|bayrak:#hex" — çatı rengini değiştirir, parsel köşesine flama diker
export function parselParcalari(imar, yp, ek, kz = '') {
  const p = [];
  const kozmetik = Object.fromEntries(String(kz || '').split('|').filter(Boolean).map((x) => x.split(':')));
  let anaSira = 0;
  for (const kayit of (yp || '').split(',').filter(Boolean)) {
    const [tip, tamamStr] = kayit.split(':');
    const tamam = tamamStr === '1';
    let yuva = [0, 0, 1, 1];
    if (TARIM_YUVALARI[tip]) yuva = TARIM_YUVALARI[tip];
    else if (!['TEL_CIT', 'SULAMA_HATTI', 'PEYZAJ', 'SU_DEPOSU', 'GUNES_PANELI'].includes(tip)) yuva = ANA_YUVALAR[anaSira++ % ANA_YUVALAR.length];
    const parcalar = yapiParcalari(tip, yuva, tamam);
    if (kozmetik.cati && tip !== 'SERA') for (const x of parcalar) if (x.catiRenk) x.catiRenk = kozmetik.cati;
    p.push(...parcalar);
  }
  if (kozmetik.bayrak) {
    p.push({ tur: 'silindir', u: 0.06, v: 0.06, r: 0.006, taban: 0, tavan: 7, renk: '#5b5b5b' });
    p.push({ tur: 'kutu', alan: [0.065, 0.055, 0.16, 0.065], taban: 5.6, tavan: 6.9, renk: kozmetik.bayrak });
  }
  if (ek) {
    const [tip, b] = ek.split(':');
    p.push(...ekinParcalari(tip, Number(b)));
  }
  return p;
}
