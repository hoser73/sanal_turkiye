// Ortak yardımcılar: API, biçimlendirme, tost bildirimleri

export class ApiHatasi extends Error {
  constructor(status, mesaj, kod) { super(mesaj); this.status = status; this.kod = kod; }
}

export async function api(yol, govde) {
  let r;
  try {
    r = await fetch(yol, {
      method: govde ? 'POST' : 'GET',
      headers: govde ? { 'content-type': 'application/json' } : {},
      body: govde ? JSON.stringify(govde) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    // Ağ yok / sunucuya ulaşılamadı: tarayıcının İngilizce "Failed to fetch" iletisi oyuncuya gitmesin
    throw new ApiHatasi(0, 'Bağlantı kurulamadı; internetini kontrol edip tekrar dene', 'AG_YOK');
  }
  let veri = null;
  try { veri = await r.json(); } catch { /* boş yanıt */ }
  // JSON olmayan hata yanıtı (vekil, hız sınırı…): durum koduna göre anlamlı ileti
  if (!r.ok) throw new ApiHatasi(r.status, veri?.hata || (r.status === 429 ? 'Çok fazla istek; biraz sonra tekrar dene'
    : r.status >= 500 ? 'Sunucuda geçici bir sorun var; biraz sonra tekrar dene' : 'İstek işlenemedi'), veri?.kod);
  return veri;
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const sayiBicim = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });
export const sayi = (n) => sayiBicim.format(n ?? 0);
// Oyun parası TL görünümünde: tutarlar sunucuda oyun birimindedir, ekranda TL_KAT ile çarpılır (sunucu config/rules.js
// BIRIM.kat ve lib/para.js ile aynı katsayı). Para girilen alanlar data-para ile işaretlenir; formdan okunurken
// tlGirdi oyun birimine geri çevirir. Oyun TL'si gerçek para değildir.
export const TL_KAT = 300;
const tamTL = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
export const tlDegeri = (n) => Math.round((Number(n) || 0) * TL_KAT);
// Eksi tutar "−₺1.500" biçiminde ("₺-1.500" değil)
export const akce = (n) => { const t = tlDegeri(n); return `${t < 0 ? '−' : ''}₺${tamTL.format(Math.abs(t))}`; };
// Para girdisi: değer ve sınırlar TL; ondalik oyun biriminin basamağı (borsa birim fiyatı 2). Adım serbest: girilen TL
// gönderilirken en yakın oyun birimine yuvarlanır
export function paraGirdisi({ name, deger, min, max, ondalik = 0, ek = '' }) {
  return `<input name="${name}" type="number" inputmode="numeric" data-para="${ondalik}" step="any"${min != null ? ` min="${tlDegeri(min)}"` : ''}${max != null ? ` max="${tlDegeri(max)}"` : ''}${deger != null ? ` value="${tlDegeri(deger)}"` : ''} ${ek}>`;
}
// TL girdisini oyun birimine çevirir (ondalik basamağa yuvarlar)
export const tlGirdi = (tlTutar, ondalik = 0) => Math.round((Number(tlTutar) / TL_KAT) * 10 ** ondalik) / 10 ** ondalik;
// Form verisi: data-para alanları oyun birimine çevrilmiş olarak
export function formVerisi(form) {
  const v = Object.fromEntries(new FormData(form));
  for (const el of form.querySelectorAll('[data-para]')) if (el.name && v[el.name] !== '' && v[el.name] != null) v[el.name] = String(tlGirdi(v[el.name], Number(el.dataset.para) || 0));
  return v;
}

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
  // Aynı anda en çok 3 bildirim: art arda gelenler eylem düğmelerinin üstüne yığılmasın
  while (kap.children.length >= 3) kap.firstElementChild.remove();
  kap.appendChild(el);
  setTimeout(() => { el.classList.add('kapaniyor'); setTimeout(() => el.remove(), 350); }, tur === 'hata' ? 4200 : 3200);
}

// Sayılara bulunma eki: 2'de, 3'te, 6'da, 40'ta (sunucuda server/lib/turkce.js ile aynı kural)
const BIRLER = { 1: 'de', 2: 'de', 3: 'te', 4: 'te', 5: 'te', 6: 'da', 7: 'de', 8: 'de', 9: 'da' };
const ONLAR = { 1: 'da', 2: 'de', 3: 'da', 4: 'ta', 5: 'de', 6: 'ta', 7: 'te', 8: 'de', 9: 'da' };
export function sayiBulunma(n) {
  n = Math.abs(Math.trunc(Number(n) || 0));
  const ek = n === 0 ? 'da' : n % 10 ? BIRLER[n % 10] : n % 100 ? ONLAR[(n / 10) % 10] : 'de';
  return `${n}'${ek}`;
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

// Arsa konum değeri dökümü (sunucu harita/konum.js): değeri artıran/azaltan etkenler çip olarak. kd = kart.konumDegeri
const uzaklik = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${sayiBicim.format(Math.round(m / 100) / 10)} km`);
const carpan = (v) => `×${sayiBicim.format(Math.round(v * 100) / 100)}`;
export function konumCipleri(kd) {
  if (!kd) return '';
  const c = [];
  const bolge = kd.il * kd.ilce;
  c.push(`<span class="konum-cip ${bolge >= 1 ? 'arti' : 'eksi'}" title="İl fiyat seviyesi ${carpan(kd.il)} · ilçe ${carpan(kd.ilce)}">📍 Bölge ${carpan(bolge)}</span>`);
  const k = kd.kiyi;
  if (k.kat > 1.02) c.push(`<span class="konum-cip arti">${k.denizM != null && (k.golM == null || k.denizM <= k.golM) ? `🌊 Denize ${uzaklik(k.denizM)}` : `🏞️ Göle ${uzaklik(k.golM)}`} ${carpan(k.kat)}</span>`);
  const m = kd.merkez, yakin = m.kasaba || m.sehir;
  if (yakin) c.push(`<span class="konum-cip ${m.kat >= 1 ? 'arti' : 'eksi'}">🏙️ ${yakin.ad ? `${esc(yakin.ad)} merkezine` : 'Merkeze'} ${uzaklik(yakin.m)} ${carpan(m.kat)}</span>`);
  const a = kd.arazi;
  if (a.kat < 0.97) c.push(`<span class="konum-cip eksi" title="Eğim %${sayiBicim.format(a.egim)} · çevresinden ${a.cevreFarki} m yüksek${a.yukselti != null ? ` · ${a.yukselti} m rakım` : ''}">⛰️ ${a.cevreFarki > 250 ? 'Dağlık' : 'Yamaç'} ${carpan(a.kat)}</span>`);
  else c.push(`<span class="konum-cip arti">🌾 Düz arazi</span>`);
  if (kd.yol > 1) c.push(`<span class="konum-cip arti">🛣️ Yola yakın ${carpan(kd.yol)}</span>`);
  return `<div class="konum-ciplari"><b class="konum-kat" title="Arsa taban bedeli = alan × imar m² fiyatı × konum çarpanı">Konum ${carpan(kd.kat)}</b>${c.join('')}</div>`;
}
