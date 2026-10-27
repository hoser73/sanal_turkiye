#!/usr/bin/env node
// Oyuncu yük testi: gerçek oyuncu gibi kaydolup oyunu açan ve döngüde gezinen/oynayan N sanal oyuncu.
// Kullanım: npm run yuk-oyuncu -- http://localhost:3401 500 20   (taban, oyuncu sayısı, saniye)
// Yalnızca kendi test sunucunuza karşı çalıştırın (veritabanı kopyası; API_HIZ_SINIRI, AGIR_HIZ_SINIRI ve
// KIMLIK_HIZ_CARPANI yükseltilmiş). Gerçek veritabanına test hesabı yazar.
import http from 'node:http';
// Tarayıcı gibi: bağlantılar yeniden kullanılır (her oyuncu için yeni TCP bağlantısı açılmaz)
const ajan = new http.Agent({ keepAlive: true, maxSockets: Number(process.env.SOKET || 400) });
function iste(url, { method, headers, body }) {
  return new Promise((coz, red) => {
    if (body) headers = { ...headers, 'content-length': Buffer.byteLength(body) };
    const r = http.request(url, { method, headers, agent: ajan }, (y) => { const p = []; y.on('data', (d) => p.push(d)); y.on('end', () => coz({ status: y.statusCode, cerez: y.headers['set-cookie'] || [], govde: Buffer.concat(p).toString() })); });
    r.on('error', red); if (body) r.write(body); r.end();
  });
}
// Gerçekçi oyuncu yükü: N oyuncu kaydolur, başlangıç tarlası alır; sonra her biri oyunu açar (açılış istekleri) ve
// döngüde gezinir/oynar. Gecikme yüzdelikleri, istek/sn, hata oranı ve uç başına p95 raporlanır.
const [TABAN = 'http://localhost:3401', N = '100', SURE = '20'] = process.argv.slice(2);
const n = Number(N), sure = Number(SURE) * 1000;
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const sonuc = { ms: [], kod: {}, uc: {} };
async function istek(c, yol, govde) {
  const t = performance.now(); let kod = 'ag';
  try {
    const r = await iste(TABAN + yol, { method: govde ? 'POST' : 'GET', headers: { cookie: c.cerez || '', 'content-type': 'application/json' }, body: govde ? JSON.stringify(govde) : undefined });
    if (r.cerez.length) c.cerez = r.cerez.map((x) => x.split(';')[0]).join('; ');
    kod = r.status; try { c.son = JSON.parse(r.govde); } catch { c.son = null; }
  } catch { /* ağ */ }
  const ms = performance.now() - t, uc = yol.split('?')[0].replace(/TR-\d+-\d+|\/\d+/g, '/:id');
  if (c.olc) { sonuc.ms.push(ms); sonuc.kod[kod] = (sonuc.kod[kod] || 0) + 1; (sonuc.uc[uc] ||= []).push(ms); }
  return c.son;
}
const kutu = () => { const lon = 32.20 + Math.random() * 0.25, lat = 37.55 + Math.random() * 0.3; return `${lon.toFixed(4)},${lat.toFixed(4)},${(lon + 0.012).toFixed(4)},${(lat + 0.008).toFixed(4)}`; };
async function hazirla(i) {
  const c = { olc: false };
  const ek = Date.now().toString(36);
  await istek(c, '/api/kayit', { email: `yuk${ek}${i}@test.local`, sifre: 'parola123', ad: `Yuk${ek}${i}`, dogumYili: 1990, kosullarOnay: true, kvkkOnay: true });
  const t = await istek(c, '/api/baslangic/tarla', {});
  c.parsel = t?.parsel;
  return c;
}
async function oyna(c) {
  // Oyunu açış
  await Promise.all(['/api/kurallar', '/api/bolgeler', '/api/ben', '/api/hava/benim', '/api/etkinlik', '/api/carsi/subeler', '/api/carsi', '/api/istatistik/iller', '/api/simgeler', '/api/hava', '/api/sihirbaz'].map((y) => istek(c, y)));
  const son = Date.now() + sure;
  while (Date.now() < son) {
    const r = Math.random();
    if (r < 0.25) await istek(c, `/api/harita/parseller?bbox=${kutu()}`);
    else if (r < 0.45 && c.parsel) await istek(c, `/api/parsel/${c.parsel}`);
    else if (r < 0.6) await istek(c, '/api/ben');
    else if (r < 0.68) await istek(c, '/api/akis');
    else if (r < 0.74) await istek(c, '/api/gunluk-gorevler');
    else if (r < 0.8) await istek(c, '/api/ilanlar');
    else if (r < 0.85) await istek(c, `/api/konum?lon=${(32.2 + Math.random() * 0.3).toFixed(3)}&lat=${(37.6 + Math.random() * 0.3).toFixed(3)}`);
    else if (r < 0.9 && c.parsel) await istek(c, `/api/parsel/${c.parsel}/ek`, { urun: 'BUGDAY' });
    else if (r < 0.95 && c.parsel) await istek(c, `/api/parsel/${c.parsel}/sula`, {});
    else if (c.parsel) await istek(c, `/api/parsel/${c.parsel}/hasat`, {});
    await bekle(200 + Math.random() * 600);   // insan düşünme süresi
  }
}
const yuzde = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0; };
console.time('hazırlık');
const oyuncular = [];
for (let i = 0; i < n; i += 20) oyuncular.push(...await Promise.all(Array.from({ length: Math.min(20, n - i) }, (_, k) => hazirla(i + k))));
console.timeEnd('hazırlık');
console.log('tarlalı oyuncu', oyuncular.filter((c) => c.parsel).length, '/', n);
for (const c of oyuncular) c.olc = true;
const t0 = Date.now();
await Promise.all(oyuncular.map(oyna));
const sn = (Date.now() - t0) / 1000;
console.log(`istek ${sonuc.ms.length} · ${Math.round(sonuc.ms.length / sn)} istek/sn · p50 ${yuzde(sonuc.ms, 0.5).toFixed(0)} ms · p95 ${yuzde(sonuc.ms, 0.95).toFixed(0)} ms · p99 ${yuzde(sonuc.ms, 0.99).toFixed(0)} ms`);
console.log('kodlar', JSON.stringify(sonuc.kod));
console.log(Object.entries(sonuc.uc).map(([u, a]) => [u, a.length, Math.round(yuzde(a, 0.95))]).sort((a, b) => b[2] - a[2]).slice(0, 14).map((x) => `${x[0]} n=${x[1]} p95=${x[2]}ms`).join('\n'));
