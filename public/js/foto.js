// Tapu kartı: tam sayfa çiftliğin anlık görüntüsüyle oyun içi tapu belgesi biçiminde 1080×1350 kart üretir (gerçek tapu
// değildir). Kart oyunun içinde, kapatılabilen bir pencerede gösterilir; paylaşım destekleniyorsa "Paylaş", masaüstünde
// "İndir". (Eskiden doğrudan resim dosyasına gidiliyordu: telefon uygulamasında geri dönülecek yer kalmıyordu.)
import { tost, esc, TL_KAT } from './yardimci.js';

const yukle = (src) => new Promise((coz, red) => { const i = new Image(); i.onload = () => coz(i); i.onerror = red; i.src = src; });
const AY = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const tarihYaz = (ms) => { const d = new Date(ms); return `${d.getDate()} ${AY[d.getMonth()]} ${d.getFullYear()}`; };
const sayiYaz = (n) => Math.round(n).toLocaleString('tr-TR');
const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = '"Baloo 2", system-ui, sans-serif';

// Kartın satırları (kartta da pencerede de aynı bilgiler)
function satirlar(kart) {
  const edinme = kart.sahip && kart.piyasa?.fiyatGecmisi?.at(-1)?.tarih;
  return [
    ['İl / İlçe', `${kart.il} / ${kart.ilce}`],
    ['Mahalle / Köy', kart.mahalle],
    kart.adaParsel && ['Ada / Parsel', `${kart.adaParsel.ada} / ${kart.adaParsel.parsel}`],
    ['Yüzölçümü', `${sayiYaz(kart.alan)} m²`],
    ['Niteliği', kart.imar?.ad || '—'],
    ['Malik', kart.sahip ? kart.sahip.ad : 'Sahipsiz'],
    kart.deger && ['Tahmini değer', `₺${sayiYaz(Math.round(kart.deger.toplam * TL_KAT))}`],
    edinme && ['Edinme tarihi', tarihYaz(edinme)],
  ].filter(Boolean);
}

export async function paylasimKarti(kart, sahneResmi) {
  await document.fonts?.ready;
  const W = 1080, H = 1350;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  // Zemin: çayır yeşili; üstünde parşömen tapu kâğıdı (çift çerçeve)
  const zemin = g.createLinearGradient(0, 0, 0, H);
  zemin.addColorStop(0, '#6cc35a'); zemin.addColorStop(1, '#2f8f3e');
  g.fillStyle = zemin; g.fillRect(0, 0, W, H);
  const kx = 44, ky = 44, kw = W - 88, kh = H - 88;
  g.save(); g.shadowColor = 'rgba(10, 40, 10, .35)'; g.shadowBlur = 40; g.shadowOffsetY = 14;
  const kagit = g.createLinearGradient(0, ky, 0, ky + kh);
  kagit.addColorStop(0, '#fcf5df'); kagit.addColorStop(1, '#f1e1b8');
  g.fillStyle = kagit; g.beginPath(); g.roundRect(kx, ky, kw, kh, 34); g.fill(); g.restore();
  g.strokeStyle = '#b8955a'; g.lineWidth = 4; g.beginPath(); g.roundRect(kx + 18, ky + 18, kw - 36, kh - 36, 24); g.stroke();
  g.lineWidth = 1.5; g.beginPath(); g.roundRect(kx + 28, ky + 28, kw - 56, kh - 56, 18); g.stroke();

  // Çiftliğin fotoğrafı: beyaz paspartulu, yuvarlak köşe
  const img = await yukle(sahneResmi);
  const fx = 104, fy = 104, fw = W - 208, fh = 520;
  g.fillStyle = '#fff'; g.beginPath(); g.roundRect(fx - 10, fy - 10, fw + 20, fh + 20, 26); g.fill();
  g.save(); g.beginPath(); g.roundRect(fx, fy, fw, fh, 18); g.clip();
  const oran = Math.max(fw / img.width, fh / img.height), iw = img.width * oran, ih = img.height * oran;
  g.drawImage(img, fx + (fw - iw) / 2, fy + (fh - ih) / 2, iw, ih); g.restore();

  // Başlık
  g.textAlign = 'center'; g.fillStyle = '#8a6a2a';
  g.font = `700 24px ${SANS}`; g.letterSpacing = '8px';
  g.fillText('SANAL TÜRKİYE', W / 2, 690);
  g.letterSpacing = '0px';
  g.fillStyle = '#3d2a12'; g.font = `700 68px ${SERIF}`;
  g.fillText('Tapu Belgesi', W / 2, 766);
  g.fillStyle = '#8a6a2a'; g.font = `600 22px ${SANS}`;
  g.fillText('oyun içi · gerçek tapu değildir', W / 2, 804);
  g.strokeStyle = '#c9a96a'; g.lineWidth = 2; g.beginPath(); g.moveTo(140, 830); g.lineTo(W - 140, 830); g.stroke();

  // Satırlar: sol etiket, sağ değer
  g.textAlign = 'left';
  const s = satirlar(kart), adim = Math.min(52, 330 / s.length);
  s.forEach(([ad, deger], i) => {
    const y = 884 + i * adim;
    g.fillStyle = '#7a5a2a'; g.font = `500 26px ${SERIF}`; g.fillText(ad, 150, y);
    g.fillStyle = '#2c1d0b'; g.font = `700 32px ${SERIF}`;
    let d = String(deger);
    while (g.measureText(d).width > 420 && d.length > 4) d = `${d.slice(0, -2)}…`;
    g.fillText(d, 420, y);
  });

  // Mühür: yuvarlak, kırmızı, eğik
  g.save(); g.translate(W - 230, 1050); g.rotate(-0.24); g.globalAlpha = 0.82;
  g.strokeStyle = '#c8402e'; g.fillStyle = '#c8402e';
  g.lineWidth = 6; g.beginPath(); g.arc(0, 0, 92, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 2; g.beginPath(); g.arc(0, 0, 78, 0, Math.PI * 2); g.stroke();
  g.textAlign = 'center'; g.font = `800 22px ${SANS}`; g.fillText('SANAL TÜRKİYE', 0, -26);
  g.font = `800 40px ${SANS}`; g.fillText('ONAYLI', 0, 16);
  g.font = `700 18px ${SANS}`; g.fillText(tarihYaz(Date.now()), 0, 46);
  g.restore();

  // Alt satır: parsel kimliği
  g.textAlign = 'center'; g.fillStyle = '#8a6a2a'; g.font = `600 22px ${SANS}`;
  g.fillText(kart.id, W / 2, H - 92);
  return new Promise((coz) => c.toBlob(coz, 'image/png'));
}

// Tapu kartı penceresi: kart oyunun içinde açılır; ✕, "Kapat", arka plana dokunma ve Esc ile kapanır
let acikPencere = null;
function pencereKapat() {
  if (!acikPencere) return;
  URL.revokeObjectURL(acikPencere.url);
  acikPencere.el.remove();
  document.removeEventListener('keydown', acikPencere.tus);
  acikPencere = null;
}

// kaynak: { fotograf() → resim adresi } (tam sayfa çiftliğin anlık görüntüsü)
export async function paylas(kart, kaynak) {
  if (!kaynak) return tost('3B görünüm bu cihazda kullanılamıyor', 'hata');
  if (acikPencere) return;
  // Pencere hemen açılır (kart birkaç saniyede çizilir); fotoğraf pencere ekrana geldikten sonra alınır
  const el = document.createElement('div');
  el.className = 'tapu-perde';
  el.innerHTML = `<div class="tapu-kutu"><div class="tapu-ust"><span class="tapu-ikon">📜</span><div><b>Tapu kartın</b><small>${esc(kart.mahalle)} · ${esc(kart.il)}</small></div>
    <button type="button" class="tapu-kapat" data-tapu="kapat" aria-label="Kapat">✕</button></div>
    <div class="tapu-hazirlaniyor"><i></i><i></i><i></i><b>Hazırlanıyor…</b></div></div>`;
  document.body.appendChild(el);
  const tus = (e) => { if (e.key === 'Escape') pencereKapat(); };
  document.addEventListener('keydown', tus);
  acikPencere = { el, url: '', tus };
  // Arka plana ya da ✕ / Kapat'a dokununca kapanır (kart hazırlanırken de)
  el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-tapu="kapat"]')) pencereKapat(); });
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  let blob;
  try { blob = await paylasimKarti(kart, kaynak.fotograf()); } catch { pencereKapat(); return tost('Tapu kartı hazırlanamadı', 'hata'); }
  if (acikPencere?.el !== el) return;   // bu arada kapatıldı
  const dosya = new File([blob], `sanal-turkiye-${kart.id}.png`, { type: 'image/png' });
  const link = `${location.origin}/?parsel=${encodeURIComponent(kart.id)}`;
  const url = URL.createObjectURL(blob);
  acikPencere.url = url;
  const paylasilir = !!navigator.canShare?.({ files: [dosya] });
  const uygulamada = !!window.StMobil;   // iOS kabuğu: dosya indirme yok
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Tapu kartı');
  el.innerHTML = `<div class="tapu-kutu">
      <div class="tapu-ust"><span class="tapu-ikon">📜</span><div><b>Tapu kartın</b><small>${esc(kart.mahalle)} · ${esc(kart.il)}</small></div>
        <button type="button" class="tapu-kapat" data-tapu="kapat" aria-label="Kapat">✕</button></div>
      <div class="tapu-resim"><img src="${url}" alt="${esc(kart.mahalle)} tapu kartı"></div>
      <div class="tapu-dugmeler">
        ${paylasilir ? '<button type="button" class="tapu-b ana" data-tapu="paylas">📤 Paylaş</button>' : ''}
        ${!paylasilir && !uygulamada ? '<button type="button" class="tapu-b ana" data-tapu="indir">⬇️ İndir</button>' : ''}
        <button type="button" class="tapu-b" data-tapu="bag">🔗 Bağlantı</button>
      </div>
      ${!paylasilir && uygulamada ? '<p class="tapu-not">Kaydetmek için ekran görüntüsü alabilirsin.</p>' : ''}
      <button type="button" class="tapu-b genis" data-tapu="kapat">Kapat</button>
    </div>`;
  el.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-tapu]')?.dataset.tapu;
    if (t === 'paylas') {
      try { await navigator.share({ files: [dosya], title: `${kart.mahalle} · Sanal Türkiye`, text: `${kart.mahalle}, ${kart.il} — ${link}` }); }
      catch (err) { if (err.name !== 'AbortError') tost('Paylaşılamadı', 'hata'); }
    } else if (t === 'indir') {
      const a = document.createElement('a');
      a.href = url; a.download = dosya.name; a.click();
      tost('📸 Tapu kartı indirildi');
    } else if (t === 'bag') {
      try { await navigator.clipboard.writeText(link); tost('🔗 Parsel bağlantısı kopyalandı'); }
      catch { tost(`Bağlantı: ${link}`); }
    }
  });
}
