// Ortak yardımcılar: API, biçimlendirme, tost bildirimleri

export class ApiHatasi extends Error {
  constructor(status, mesaj, kod) { super(mesaj); this.status = status; this.kod = kod; }
}

export async function api(yol, govde) {
  const r = await fetch(yol, {
    method: govde ? 'POST' : 'GET',
    headers: govde ? { 'content-type': 'application/json' } : {},
    body: govde ? JSON.stringify(govde) : undefined,
    credentials: 'same-origin',
  });
  let veri = null;
  try { veri = await r.json(); } catch { /* boş yanıt */ }
  if (!r.ok) throw new ApiHatasi(r.status, veri?.hata || 'Bağlantı hatası', veri?.kod);
  return veri;
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const sayiBicim = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });
export const sayi = (n) => sayiBicim.format(n ?? 0);
export const akce = (n) => `₳ ${sayi(n)}`;

export function sure(ms) {
  if (ms <= 0) return 'hazır';
  const sn = Math.ceil(ms / 1000);
  const d = Math.floor(sn / 60), s = sn % 60;
  if (d >= 24 * 60) return `${Math.floor(d / 1440)} gün ${Math.floor((d % 1440) / 60)} sa`;
  if (d >= 60) return `${Math.floor(d / 60)} sa ${d % 60} dk`;
  return d ? `${d} dk ${String(s).padStart(2, '0')} sn` : `${s} sn`;
}

// SQLite datetime('now') UTC döner: "2026-10-20 12:30:00"; epoch ms sayıları da kabul edilir
export function zamanOnce(sqlTarih) {
  const t = typeof sqlTarih === 'number' ? sqlTarih : new Date(String(sqlTarih).replace(' ', 'T') + 'Z').getTime();
  const fark = Math.max(0, (Date.now() - t) / 1000);
  if (fark < 60) return 'az önce';
  if (fark < 3600) return `${Math.floor(fark / 60)} dk önce`;
  if (fark < 86400) return `${Math.floor(fark / 3600)} sa önce`;
  return `${Math.floor(fark / 86400)} gün önce`;
}

export function tost(mesaj, tur = '') {
  const kap = document.getElementById('tostlar');
  const el = document.createElement('div');
  el.className = `tost ${tur}`;
  el.textContent = mesaj;
  kap.appendChild(el);
  setTimeout(() => { el.classList.add('kapaniyor'); setTimeout(() => el.remove(), 350); }, tur === 'hata' ? 4200 : 3200);
}

// Türkçe ünlü uyumuna göre özel ad ekleri: bulunma (Havzan'da, Kozağaç'ta) ve tamlayan (Hasan'ın, Emine'nin)
const UNLULER = 'aıoueiöüAIOUEİÖÜ';
const sonUnlu = (s) => { for (let i = s.length - 1; i >= 0; i--) if (UNLULER.includes(s[i])) return s[i].toLocaleLowerCase('tr-TR'); return 'e'; };
export function bulunma(ad) {
  const kalin = 'aıou'.includes(sonUnlu(ad));
  const sert = 'çfhkpsştÇFHKPSŞT'.includes(ad.at(-1));
  return `${ad}'${sert ? 't' : 'd'}${kalin ? 'a' : 'e'}`;
}
export function tamlayan(ad) {
  const u = sonUnlu(ad);
  const ek = { a: 'ın', ı: 'ın', e: 'in', i: 'in', o: 'un', u: 'un', ö: 'ün', ü: 'ün' }[u];
  return `${ad}'${UNLULER.includes(ad.at(-1)) ? 'n' : ''}${ek}`;
}
