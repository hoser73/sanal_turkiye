// Gerçek tarla sınırlarından oyun tarlaları (saf işlevler: ağ ve veritabanı yok, test edilebilir).
// Kaynak: Fields of the World (CC-BY-4.0) — Sentinel-2 görüntülerinden 10 m çözünürlükte çıkarılmış tarla sınırları,
// z13 vektör karoları hâlinde. Tapu/kadastro parseli değildir; uydudan görünen tarladır.
// Birim: z20 hücresi (Web Mercator; 1 birim ≈ 30 m, y güneye artar). Bir z13 karosu 128 × 128 hücredir.
//   1) Karo sınırında bölünen tarla parçaları birleştirilir (karolar sınırdan taşan tampon bölge içerir);
//   2) her hücre, merkezini içeren tarlaya atanır (hücre merkezi hiçbir tarlada değilse kare parsel kalır);
//   3) sınır 10 m piksel basamaklarından arındırılır (Douglas–Peucker) ve köşeleri hafifçe yumuşatılır (Chaikin).
const KARO_HUCRE = 128;

const isaretliAlan = (r) => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return s / 2; };
const halkaAlani = (r) => Math.abs(isaretliAlan(r));
function agirlikMerkezi(r) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const f = r[j][0] * r[i][1] - r[i][0] * r[j][1]; a += f; cx += (r[j][0] + r[i][0]) * f; cy += (r[j][1] + r[i][1]) * f; }
  if (Math.abs(a) < 1e-12) return r[0];
  return [cx / (3 * a), cy / (3 * a)];
}
function noktaIcinde(r, x, y) {
  let ic = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ic = !ic;
  }
  return ic;
}
const kutusu = (r) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of r) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return [x0, y0, x1, y1]; };

// ---------- Sınır yumuşatma
function dogruUzakligi([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  if (!l) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l));
  return Math.hypot(ax + t * dx - px, ay + t * dy - py);
}
function dpCizgi(p, tol) {
  if (p.length < 3) return p.slice();
  const tut = new Uint8Array(p.length); tut[0] = tut[p.length - 1] = 1;
  const yigin = [[0, p.length - 1]];
  while (yigin.length) {
    const [a, b] = yigin.pop();
    let en = -1, ed = tol;
    for (let i = a + 1; i < b; i++) { const d = dogruUzakligi(p[i], p[a], p[b]); if (d > ed) { ed = d; en = i; } }
    if (en >= 0) { tut[en] = 1; yigin.push([a, en], [en, b]); }
  }
  return p.filter((_, i) => tut[i]);
}
// Kapalı halka: ilk noktaya en uzak noktadan ikiye bölünüp iki çizgi ayrı sadeleştirilir
function sadelestir(r, tol) {
  if (r.length < 5) return r.slice();
  let uzak = 0, ud = -1;
  r.forEach((p, i) => { const d = (p[0] - r[0][0]) ** 2 + (p[1] - r[0][1]) ** 2; if (d > ud) { ud = d; uzak = i; } });
  const a = dpCizgi(r.slice(0, uzak + 1), tol), b = dpCizgi([...r.slice(uzak), r[0]], tol);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}
// Chaikin köşe kırpma: her kenarın iki ucundan kenarın `oran`ı kadar, en çok `enCok` hücre içeriden yeni köşe
// (uzun kenarlı büyük tarlalarda köşe yalnızca birkaç metre yuvarlanır)
function chaikin(r, oran = 0.2, enCok = Infinity) {
  const c = [];
  for (let i = 0; i < r.length; i++) {
    const p = r[i], q = r[(i + 1) % r.length], l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1, t = Math.min(oran, enCok / l);
    c.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t], [p[0] + (q[0] - p[0]) * (1 - t), p[1] + (q[1] - p[1]) * (1 - t)]);
  }
  return c;
}
// tol 0,25 hücre ≈ 7,5 m: 10 m'lik çapraz piksel basamaklarının köşeleri kirişten ≈ 7 m sapar, basamaklar düz kenara döner.
// Köşeler en çok 0,2 hücre (≈ 6 m) yuvarlanır.
function yumusat(r, { tol = 0.25, oran = 0.2, enCok = 0.2 } = {}) {
  let s = sadelestir(r, tol);
  if (s.length < 3) return r.slice();
  s = chaikin(s, oran, enCok);
  return sadelestir(s, 0.01);
}

// En küçük alanlı dikdörtgenin uzun kenar yönü (derece; x doğu, y güney): 3B model tarlaya bu yönde oturur
function zarf(noktalar) {
  const p = noktalar.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), alt = [], ust = [];
  const capraz = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  for (const n of p) { while (alt.length >= 2 && capraz(alt.at(-2), alt.at(-1), n) <= 0) alt.pop(); alt.push(n); }
  for (const n of p.reverse()) { while (ust.length >= 2 && capraz(ust.at(-2), ust.at(-1), n) <= 0) ust.pop(); ust.push(n); }
  return alt.slice(0, -1).concat(ust.slice(0, -1));
}
function yonu(r) {
  const z = zarf(r);
  let enIyi = { alan: Infinity, aci: 0 };
  for (let i = 0; i < z.length; i++) {
    const [ax, ay] = z[i], [bx, by] = z[(i + 1) % z.length], a = Math.atan2(by - ay, bx - ax), c = Math.cos(a), s = Math.sin(a);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, y] of z) { const u = x * c + y * s, v = -x * s + y * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const alan = (u1 - u0) * (v1 - v0);
    if (alan < enIyi.alan) enIyi = { alan, aci: u1 - u0 >= v1 - v0 ? a : a + Math.PI / 2 };
  }
  let d = (enIyi.aci * 180) / Math.PI;
  while (d > 90) d -= 180;
  while (d <= -90) d += 180;
  return Math.round(d * 10) / 10;
}

// ---------- Maske sınır izleme: dolu piksellerin dış sınırı (piksel köşe koordinatları; en büyük döngü)
function sinirIzle(maske, gen, yuk) {
  const dolu = (i, j) => i >= 0 && j >= 0 && i < gen && j < yuk && maske[j * gen + i];
  const kenarlar = new Map();   // başlangıç köşesi → bitiş köşeleri (dolu taraf solda kalacak yönde)
  const ekle = (a, b) => { const k = a[1] * (gen + 1) + a[0]; (kenarlar.get(k) || kenarlar.set(k, []).get(k)).push(b); };
  for (let j = 0; j < yuk; j++) for (let i = 0; i < gen; i++) {
    if (!dolu(i, j)) continue;
    if (!dolu(i, j - 1)) ekle([i + 1, j], [i, j]);
    if (!dolu(i - 1, j)) ekle([i, j], [i, j + 1]);
    if (!dolu(i, j + 1)) ekle([i, j + 1], [i + 1, j + 1]);
    if (!dolu(i + 1, j)) ekle([i + 1, j + 1], [i + 1, j]);
  }
  let enIyi = null, enAlan = 0;
  for (const [k0, liste] of kenarlar) {
    while (liste.length) {
      const bas = [k0 % (gen + 1), Math.floor(k0 / (gen + 1))], halka = [bas];
      let simdi = liste.pop();
      for (let adim = 0; adim < 4 * gen * yuk + 8; adim++) {
        if (simdi[0] === bas[0] && simdi[1] === bas[1]) break;
        halka.push(simdi);
        const sonraki = kenarlar.get(simdi[1] * (gen + 1) + simdi[0]);
        if (!sonraki?.length) break;
        simdi = sonraki.pop();
      }
      const a = halkaAlani(halka);
      if (a > enAlan) { enAlan = a; enIyi = halka; }
    }
  }
  if (!enIyi) return null;
  // Eş doğrultulu ara köşeleri at
  return enIyi.filter((p, i) => {
    const o = enIyi[(i + enIyi.length - 1) % enIyi.length], s = enIyi[(i + 1) % enIyi.length];
    return (p[0] - o[0]) * (s[1] - p[1]) - (p[1] - o[1]) * (s[0] - p[0]) !== 0;
  });
}

// ---------- Tarlaları kur
// karolar: [{ tx, ty, parcalar: [{ halka: [[x, y], …] (hücre birimi, mutlak), alanM2 }] }] (z13)
// uygun(x, y): hücre tarlaya katılabilir mi (ör. sahipli kare parsel değil)
// Dönüş: [{ capa: [x, y], uyeler: [[x, y], …], halka (yumuşatılmış, hücre birimi), alanHucre, merkez: [x, y], yon }]
function tarlalariKur({ karolar, uygun = () => true, enKucukM2 = 400, enBuyukM2 = 500000, cozunurluk = 0.25 }) {
  const parcalar = [], karoParca = new Map();
  for (const k of karolar) {
    const liste = [];
    for (const p of k.parcalar) {
      if (!(p.alanM2 >= enKucukM2 && p.alanM2 <= enBuyukM2) || p.halka.length < 3) continue;
      const parca = { no: parcalar.length, tx: k.tx, ty: k.ty, halka: p.halka, kutu: kutusu(p.halka), alan: halkaAlani(p.halka) };
      parcalar.push(parca); liste.push(parca);
    }
    // Karo içi kova dizini (8 × 8 hücre)
    const kova = new Map();
    for (const p of liste) {
      const [x0, y0, x1, y1] = p.kutu;
      for (let by = Math.floor(y0 / 8); by <= Math.floor(y1 / 8); by++) for (let bx = Math.floor(x0 / 8); bx <= Math.floor(x1 / 8); bx++) {
        const a = `${bx}:${by}`; (kova.get(a) || kova.set(a, []).get(a)).push(p);
      }
    }
    karoParca.set(`${k.tx}:${k.ty}`, kova);
  }
  // Noktayı içeren parça: yalnızca noktanın kendi karosundaki parçalar (tampon bölgeler karışmasın). Delikler okunmadığından
  // bir tarla başka bir tarlanın içinde (deliğinde) kalabilir: en küçük içeren parça seçilir.
  const parcaBul = (x, y) => {
    const kova = karoParca.get(`${Math.floor(x / KARO_HUCRE)}:${Math.floor(y / KARO_HUCRE)}`);
    let en = null;
    for (const p of kova?.get(`${Math.floor(x / 8)}:${Math.floor(y / 8)}`) || []) {
      const [x0, y0, x1, y1] = p.kutu;
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1 && (!en || p.alan < en.alan) && noktaIcinde(p.halka, x, y)) en = p;
    }
    return en;
  };
  const ata = parcalar.map((_, i) => i);
  const kok = (i) => { while (ata[i] !== i) { ata[i] = ata[ata[i]]; i = ata[i]; } return i; };
  const birlestir = (a, b) => { a = kok(a); b = kok(b); if (a !== b) ata[Math.max(a, b)] = Math.min(a, b); };

  // 1) Karo sınırından taşan parçalar komşu karodaki karşılığıyla birleşir
  for (const p of parcalar) {
    const kx0 = p.tx * KARO_HUCRE, ky0 = p.ty * KARO_HUCRE, kx1 = kx0 + KARO_HUCRE, ky1 = ky0 + KARO_HUCRE;
    const [x0, y0, x1, y1] = p.kutu;
    if (x0 >= kx0 && y0 >= ky0 && x1 <= kx1 && y1 <= ky1) continue;
    for (let y = Math.floor(y0 * 2) / 2 + 0.25; y <= y1; y += 0.5) for (let x = Math.floor(x0 * 2) / 2 + 0.25; x <= x1; x += 0.5) {
      const disarida = x < kx0 || x >= kx1 || y < ky0 || y >= ky1;
      if (!disarida || x < kx0 - 2 || x >= kx1 + 2 || y < ky0 - 2 || y >= ky1 + 2) continue;
      if (!noktaIcinde(p.halka, x, y)) continue;
      const q = parcaBul(x, y);
      if (q) birlestir(p.no, q.no);
    }
  }
  // 2) Hücre ataması: merkezi kendi karosunda içeren (en küçük) parçanın tarlası
  const atama = new Map();
  for (const p of parcalar) {
    const kx0 = p.tx * KARO_HUCRE, ky0 = p.ty * KARO_HUCRE;
    const [x0, y0, x1, y1] = p.kutu;
    for (let y = Math.max(ky0, Math.floor(y0)); y < Math.min(ky0 + KARO_HUCRE, Math.ceil(y1)); y++) {
      for (let x = Math.max(kx0, Math.floor(x0)); x < Math.min(kx0 + KARO_HUCRE, Math.ceil(x1)); x++) {
        const k = `${x}:${y}`, onceki = atama.get(k);
        if (onceki && onceki.alan <= p.alan) continue;
        if (!noktaIcinde(p.halka, x + 0.5, y + 0.5) || !uygun(x, y)) continue;
        atama.set(k, { p, x, y, alan: p.alan });
      }
    }
  }
  const uyeler = new Map();
  for (const { p, x, y } of atama.values()) { const r = kok(p.no); (uyeler.get(r) || uyeler.set(r, []).get(r)).push([x, y]); }
  // 3) Sınır: tek karoda kalan tarla parçanın kendisi; karo aşan tarla birleşik maskeden yeniden izlenir
  const gruplar = new Map();
  for (const p of parcalar) { const r = kok(p.no); (gruplar.get(r) || gruplar.set(r, []).get(r)).push(p); }
  const tarlalar = [];
  for (const [r, hucreler] of uyeler) {
    const grup = gruplar.get(r);
    const ic = (p) => { const [x0, y0, x1, y1] = p.kutu, kx0 = p.tx * KARO_HUCRE, ky0 = p.ty * KARO_HUCRE; return x0 >= kx0 && y0 >= ky0 && x1 <= kx0 + KARO_HUCRE && y1 <= ky0 + KARO_HUCRE; };
    let ham;
    if (grup.length === 1 && ic(grup[0])) ham = grup[0].halka;
    else {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of grup) {
        const kx0 = p.tx * KARO_HUCRE, ky0 = p.ty * KARO_HUCRE;
        x0 = Math.min(x0, Math.max(p.kutu[0], kx0)); y0 = Math.min(y0, Math.max(p.kutu[1], ky0));
        x1 = Math.max(x1, Math.min(p.kutu[2], kx0 + KARO_HUCRE)); y1 = Math.max(y1, Math.min(p.kutu[3], ky0 + KARO_HUCRE));
      }
      x0 = Math.floor(x0); y0 = Math.floor(y0);
      const gen = Math.ceil((x1 - x0) / cozunurluk) + 1, yuk = Math.ceil((y1 - y0) / cozunurluk) + 1;
      const maske = new Uint8Array(gen * yuk);
      for (let j = 0; j < yuk; j++) for (let i = 0; i < gen; i++) {
        const q = parcaBul(x0 + (i + 0.5) * cozunurluk, y0 + (j + 0.5) * cozunurluk);
        if (q && kok(q.no) === r) maske[j * gen + i] = 1;
      }
      const iz = sinirIzle(maske, gen, yuk);
      if (!iz) continue;
      ham = iz.map(([i, j]) => [x0 + i * cozunurluk, y0 + j * cozunurluk]);
    }
    const halka = yumusat(ham);
    if (halka.length < 3) continue;
    const merkez = agirlikMerkezi(halka);
    let capa = hucreler[0], cd = Infinity;
    for (const h of hucreler) { const d = (h[0] + 0.5 - merkez[0]) ** 2 + (h[1] + 0.5 - merkez[1]) ** 2; if (d < cd) { cd = d; capa = h; } }
    tarlalar.push({ capa, uyeler: hucreler, halka, alanHucre: halkaAlani(halka), merkez, yon: yonu(halka) });
  }
  return tarlalar;
}

// Vektör karo (z13, extent 4096) halkası → mutlak hücre birimi
const karoNoktasi = (tx, ty, extent = 4096) => (p) => [tx * KARO_HUCRE + (p.x / extent) * KARO_HUCRE, ty * KARO_HUCRE + (p.y / extent) * KARO_HUCRE];
// Vektör karo özelliğinin dış halkaları (MVT'de dış halka ekran koordinatında saat yönünde: işaretli alan > 0)
function disHalkalar(ozellik, tx, ty) {
  const donustur = karoNoktasi(tx, ty, ozellik.extent);
  const sonuc = [];
  for (const halka of ozellik.loadGeometry()) {
    const r = halka.map(donustur);
    if (r.length > 3 && r[0][0] === r.at(-1)[0] && r[0][1] === r.at(-1)[1]) r.pop();
    if (r.length >= 3 && isaretliAlan(r) > 0) sonuc.push(r);
  }
  return sonuc;
}

module.exports = { KARO_HUCRE, tarlalariKur, disHalkalar, yumusat, sinirIzle, yonu, halkaAlani, noktaIcinde, agirlikMerkezi };
