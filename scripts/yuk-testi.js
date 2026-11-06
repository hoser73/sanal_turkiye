#!/usr/bin/env node
// Yük testi: gerçekçi okuma karışımıyla eşzamanlı istek atar; gecikme yüzdeliklerini, istek/sn ve hata oranını raporlar.
// Kullanım: npm run yuk-testi -- --taban http://localhost:3400 --es 20 --sure 20
// Yalnızca kendi sunucunuza karşı çalıştırın. Yazma uçlarını (kayıt, alım) denemez; oran sınırlarına takılmamak için
// sunucuyu KIMLIK_HIZ_CARPANI ile değil, /api altındaki genel sınırı (dakikada 600/IP) göz önünde tutarak yorumlayın.
const arg = (ad, vars) => { const i = process.argv.indexOf(`--${ad}`); return i > 0 ? process.argv[i + 1] : vars; };
const TABAN = arg('taban', 'http://localhost:3400');
const ES = Number(arg('es', 20));
const SURE = Number(arg('sure', 20)) * 1000;

// Türkiye üzerinde rastgele küçük görünüm kutuları (harita gezinme benzetimi)
const kutu = () => { const lon = 26 + Math.random() * 18, lat = 36.5 + Math.random() * 5; return `${lon.toFixed(4)},${lat.toFixed(4)},${(lon + 0.01).toFixed(4)},${(lat + 0.007).toFixed(4)}`; };
const KARISIM = [
  [30, () => `/api/harita/parseller?bbox=${kutu()}`],
  [15, () => '/api/akis'],
  [10, () => '/api/istatistik/iller'],
  [10, () => '/api/ilanlar'],
  [8, () => '/api/borsa'],
  [8, () => '/api/hasat-yarisi'],
  [7, () => '/api/hava'],
  [6, () => `/api/konum?lon=${(26 + Math.random() * 18).toFixed(3)}&lat=${(36.5 + Math.random() * 5).toFixed(3)}`],
  [6, () => '/api/ara?q=kon'],
];
const toplamAgirlik = KARISIM.reduce((a, [w]) => a + w, 0);
const sec = () => { let r = Math.random() * toplamAgirlik; for (const [w, f] of KARISIM) { if ((r -= w) <= 0) return f(); } return KARISIM[0][1](); };

const sureler = [], durumlar = {}, uclar = {};
let bitti = false;
async function isci() {
  while (!bitti) {
    const yol = sec();
    const uc = yol.split('?')[0];
    const bas = performance.now();
    let kod = 'ağ';
    try { const r = await fetch(TABAN + yol); await r.arrayBuffer(); kod = r.status; } catch { /* bağlantı hatası */ }
    const ms = performance.now() - bas;
    sureler.push(ms);
    durumlar[kod] = (durumlar[kod] || 0) + 1;
    (uclar[uc] ||= []).push(ms);
  }
}
const yuzdelik = (d, p) => { const s = [...d].sort((a, b) => a - b); return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]) : 0; };

(async () => {
  console.log(`Yük testi: ${TABAN} · ${ES} eşzamanlı · ${SURE / 1000} sn`);
  setTimeout(() => { bitti = true; }, SURE);
  const bas = Date.now();
  await Promise.all(Array.from({ length: ES }, isci));
  const sn = (Date.now() - bas) / 1000;
  const hata = Object.entries(durumlar).filter(([k]) => !(Number(k) >= 200 && Number(k) < 400)).reduce((a, [, v]) => a + v, 0);
  const rapor = {
    istek: sureler.length, istekSn: Math.round(sureler.length / sn), hataOrani: Math.round((hata / Math.max(1, sureler.length)) * 1000) / 10 + '%', durumlar,
    gecikmeMs: { p50: yuzdelik(sureler, 50), p95: yuzdelik(sureler, 95), p99: yuzdelik(sureler, 99), en: Math.round(Math.max(...sureler)) },
    uclar: Object.fromEntries(Object.entries(uclar).map(([u, d]) => [u, { adet: d.length, p50: yuzdelik(d, 50), p95: yuzdelik(d, 95) }])),
  };
  console.log(JSON.stringify(rapor, null, 2));
  if (hata / Math.max(1, sureler.length) > 0.05) process.exitCode = 1;
})();
