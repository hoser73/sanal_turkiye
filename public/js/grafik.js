// Küçük SVG grafikler (kütüphanesiz): endeks çizgisi ve fiyat noktaları. Yalnızca HTML/SVG metni üretir.
import { esc } from './yardimci.js';

const AY = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
export const kisaTarih = (d) => { const t = typeof d === 'string' ? new Date(`${d}T12:00:00`) : new Date(d); return `${t.getDate()} ${AY[t.getMonth()]}`; };
const say = (v) => v.toLocaleString('tr-TR', { maximumFractionDigits: 1 });

// Endeks çizgisi: 100 (tahsis seviyesi) kesik çizgiyle; son değer noktası; yükselişte yeşil, düşüşte kırmızı
export function endeksGrafigi(seri, { yukseklik = 120, etiket = true } = {}) {
  const G = 320, Y = yukseklik, sol = 6, sag = 40, ust = 10, alt = etiket ? 20 : 8;
  if (!seri?.length) return '<p class="kucuk grafik-bos">Endeks geçmişi oluşuyor; ilk kareler gün sonunda eklenir.</p>';
  const d = seri.map((x) => x.endeks);
  const enAz = Math.min(100, ...d), enCok = Math.max(100, ...d);
  const pay = Math.max(4, (enCok - enAz) * 0.15);
  const a = enAz - pay, b = enCok + pay;
  const x = (i) => sol + (seri.length === 1 ? (G - sol - sag) / 2 : (i / (seri.length - 1)) * (G - sol - sag));
  const y = (v) => ust + (1 - (v - a) / (b - a)) * (Y - ust - alt);
  const yol = d.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const artis = d.at(-1) >= d[0];
  const renk = artis ? 'var(--grafik-art, #2f9e44)' : 'var(--grafik-dus, #d9480f)';
  const alan = `${yol}L${x(d.length - 1).toFixed(1)},${Y - alt}L${x(0).toFixed(1)},${Y - alt}Z`;
  const kimlik = `g${Math.random().toString(36).slice(2, 8)}`;
  return `<svg class="endeks-grafik" viewBox="0 0 ${G} ${Y}" role="img" aria-label="Endeks ${say(d[0])} → ${say(d.at(-1))}">
    <defs><linearGradient id="${kimlik}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${renk}" stop-opacity=".28"/><stop offset="1" stop-color="${renk}" stop-opacity="0"/></linearGradient></defs>
    <line x1="${sol}" x2="${G - sag}" y1="${y(100).toFixed(1)}" y2="${y(100).toFixed(1)}" class="eg-baz"/>
    <text x="${G - sag + 4}" y="${(y(100) + 4).toFixed(1)}" class="eg-yazi">100</text>
    <path d="${alan}" fill="url(#${kimlik})"/>
    <path d="${yol}" fill="none" stroke="${renk}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(d.length - 1).toFixed(1)}" cy="${y(d.at(-1)).toFixed(1)}" r="4" fill="${renk}" stroke="#fff" stroke-width="2"/>
    <text x="${G - sag + 4}" y="${(y(d.at(-1)) + 4).toFixed(1)}" class="eg-yazi kalin">${say(d.at(-1))}</text>
    ${etiket ? `<text x="${sol}" y="${Y - 5}" class="eg-yazi">${esc(kisaTarih(seri[0].gun))}</text>
      <text x="${G - sag}" y="${Y - 5}" class="eg-yazi" text-anchor="end">${esc(kisaTarih(seri.at(-1).gun))}</text>` : ''}
  </svg>`;
}

// Satır içi küçük çizgi (listelerde)
export function minikCizgi(degerler, { genislik = 64, yukseklik = 22 } = {}) {
  if (!degerler?.length || degerler.length < 2) return '';
  const a = Math.min(...degerler), b = Math.max(...degerler), ar = b - a || 1;
  const yol = degerler.map((v, i) => `${i ? 'L' : 'M'}${((i / (degerler.length - 1)) * (genislik - 2) + 1).toFixed(1)},${(yukseklik - 2 - ((v - a) / ar) * (yukseklik - 4)).toFixed(1)}`).join('');
  const renk = degerler.at(-1) >= degerler[0] ? '#2f9e44' : '#d9480f';
  return `<svg class="minik-cizgi" viewBox="0 0 ${genislik} ${yukseklik}" width="${genislik}" height="${yukseklik}" aria-hidden="true"><path d="${yol}" fill="none" stroke="${renk}" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
}

// Yüzde değişim çipi: +%3,2 yeşil / −%1,1 kırmızı
export function degisimCipi(yuzde, sonek = '') {
  if (yuzde == null) return '<span class="degisim notr">yeni</span>';
  const s = yuzde > 0 ? 'art' : yuzde < 0 ? 'dus' : 'notr';
  return `<span class="degisim ${s}">${yuzde > 0 ? '▲ +' : yuzde < 0 ? '▼ −' : ''}%${say(Math.abs(yuzde))}${sonek}</span>`;
}
