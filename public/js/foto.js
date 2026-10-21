// Fotoğraf modu ve paylaşım kartı: parselin 3B maketinden 1200×630 kart üretir; Web Share destekliyse paylaşır, yoksa indirir.
// Zaman yolculuğu: parselin geçmişini kare kare 3B sahnede oynatır.
import { api, tost } from './yardimci.js';

const yukle = (src) => new Promise((coz, red) => { const i = new Image(); i.onload = () => coz(i); i.onerror = red; i.src = src; });

export async function paylasimKarti(kart, sahneResmi) {
  const c = document.createElement('canvas');
  c.width = 1200; c.height = 630;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 1200, 630);
  gr.addColorStop(0, '#fbf4e4'); gr.addColorStop(1, '#e3efe9');
  g.fillStyle = gr; g.fillRect(0, 0, 1200, 630);
  // Sahne
  const img = await yukle(sahneResmi);
  const w = 640, h = Math.min(560, (img.height / img.width) * w);
  g.save(); g.beginPath(); g.roundRect(36, (630 - h) / 2, w, h, 28); g.clip();
  g.fillStyle = '#f3ecdc'; g.fillRect(36, (630 - h) / 2, w, h);
  g.drawImage(img, 36, (630 - h) / 2, w, h); g.restore();
  // Metin
  const x = 720;
  g.fillStyle = '#c8402e'; g.font = '700 22px Inter, system-ui, sans-serif';
  g.fillText('SANAL TÜRKİYE', x, 96);
  g.fillStyle = '#1f2a2e'; g.font = '700 56px Fraunces, Georgia, serif';
  satirla(g, kart.mahalle, x, 166, 440, 60);
  g.font = '500 26px Inter, system-ui, sans-serif'; g.fillStyle = '#4b5755';
  g.fillText(`${kart.ilce}, ${kart.il}`, x, 252);
  const satirlar = [
    `${kart.imar.ad} · ${Math.round(kart.alan)} m²`,
    kart.sahip ? `${kart.sahip.ad}${kart.sahip.unvan ? ` · ${kart.sahip.unvan}` : ''}` : 'Sahipsiz parsel',
    `${kart.yapilar.filter((y) => y.durum === 'ACTIVE').length} yapı · gelişmişlik ${kart.gelismislikSkoru}/100`,
    kart.ekin ? `${kart.ekin.ikon} ${kart.ekin.ad} ${kart.ekin.olgun ? 'hasada hazır' : 'büyüyor'}` : null,
    kart.hava ? `${kart.hava.ikon} ${kart.hava.sicaklik}° · ${kart.mevsim?.ad || ''}` : null,
  ].filter(Boolean);
  g.font = '500 24px Inter, system-ui, sans-serif'; g.fillStyle = '#1f2a2e';
  satirlar.forEach((s, i) => g.fillText(s, x, 320 + i * 40));
  g.fillStyle = '#7b8583'; g.font = '400 16px Inter, system-ui, sans-serif';
  g.fillText('Oyun içi sanal parsel; gerçek tapu değildir.', x, 584);
  return new Promise((coz) => c.toBlob(coz, 'image/png'));
}
function satirla(g, metin, x, y, max, yuk) {
  const kelimeler = String(metin).split(' ');
  let satir = '', yy = y;
  for (const k of kelimeler) {
    const dene = satir ? `${satir} ${k}` : k;
    if (g.measureText(dene).width > max && satir) { g.fillText(satir, x, yy); satir = k; yy += yuk; } else satir = dene;
  }
  g.fillText(satir, x, yy);
}

export async function paylas(kart, sahne) {
  if (!sahne) return tost('3B görünüm bu cihazda kullanılamıyor', 'hata');
  const blob = await paylasimKarti(kart, sahne.fotograf());
  const dosya = new File([blob], `sanal-turkiye-${kart.id}.png`, { type: 'image/png' });
  const link = `${location.origin}/?parsel=${encodeURIComponent(kart.id)}`;
  if (navigator.canShare?.({ files: [dosya] })) {
    try { await navigator.share({ files: [dosya], title: `${kart.mahalle} · Sanal Türkiye`, text: `${kart.mahalle}, ${kart.il} — ${link}` }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = dosya.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  try { await navigator.clipboard?.writeText(link); tost('📸 Kart indirildi; parsel bağlantısı panoya kopyalandı'); } catch { tost('📸 Kart indirildi'); }
}

// Zaman yolculuğu: kareler sahnede sırayla gösterilir; altyazı ve ilerleme çubuğu sahnenin üstünde
let oynuyor = null;
export async function zamanYolculugu(kart, sahne, yer) {
  if (!sahne) return;
  if (oynuyor) { oynuyor.dur = true; return; }
  const kareler = await api(`/api/parsel/${encodeURIComponent(kart.id)}/zaman`);
  if (!kareler.length) return tost('Bu parselin henüz bir geçmişi yok');
  const yazi = document.createElement('div');
  yazi.className = 'zaman-yazi';
  yer.appendChild(yazi);
  const durum = { dur: false };
  oynuyor = durum;
  sahne.kendiliginden(true);
  for (const [i, k] of kareler.entries()) {
    if (durum.dur || !yer.isConnected) break;
    const yapilar = k.yp ? k.yp.split(',').map((x) => { const [tip, t] = x.split(':'); return { tip, durum: t === '1' ? 'ACTIVE' : 'BUILDING' }; }) : [];
    const ekin = k.ek ? { tip: k.ek.split(':')[0], ilerleme: Number(k.ek.split(':')[1]) } : null;
    sahne.goster({ ...kart, yapilar, ekin }, yer);
    yazi.innerHTML = `<b>${new Date(k.t).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}</b> ${k.etiket}<span style="width:${((i + 1) / kareler.length) * 100}%"></span>`;
    await new Promise((r) => setTimeout(r, 1400));
  }
  yazi.remove();
  oynuyor = null;
  if (yer.isConnected) sahne.goster(kart, yer);
}
