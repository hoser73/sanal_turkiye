// Gerçek hava arayüzü: hava penceresi (iller, riskler, tehdit altındaki tarlalar, örtü) ve parsel kartındaki tahmin
// satırı. Kurallar sunucuda; burası yalnızca gösterir.
import { esc, akce, sure } from './yardimci.js';

const riskYazisi = (r) => `${r.ikon} ${esc(r.ad)}${r.deger ? ` <span class="kucuk">(${esc(r.deger)})</span>` : ''}`;
const yarinYazisi = (y) => (y ? `${y.ikon} ${Math.round(y.min)}° / ${Math.round(y.max)}°${y.yagis >= 0.5 ? ` · ${y.yagis} mm` : ''}` : '');

// Hava penceresi: tarlası olan her il
export function havaPenceresi(b) {
  if (!b.iller.length) {
    return `<h2 class="pencere-baslik">🌦️ Çiftliğinin havası</h2><p>Henüz tarlan yok. Bir tarım parseli edinip ekim yapınca o ilin gerçek havası, uyarıları ve önlemleri burada görünür.</p>`;
  }
  const d = b.afetDestegi;
  return `<h2 class="pencere-baslik">🌦️ Çiftliğinin havası</h2>
    <p class="kucuk" style="margin-top:0">Hava gerçek: her ilin merkezi için ${esc(b.kaynak)}. Önümüzdeki ${b.iller[0].tahminSaat} saatte don, dolu ya da sağanak beklenirse sana haber veririz.</p>
    ${b.iller.map(ilKarti).join('')}
    <div class="kutu hava-kurallar"><b>Hava ne yapar?</b><ul>
      <li>🌧️ Yağmur açık tarlayı bedavaya sular.</li>
      <li>☀️ Açık ve ılık (12–32°) gündüzde ekilen açık tarla %15 hızlı büyür.</li>
      <li>🌬️ Rüzgâr 20 km/s'yi geçince değirmen %25 hızlı öğütür.</li>
      <li>❄️ Don dona hassas ekinin (domates, çay) verimini düşürür; 🧊 dolu ve 🌊 sağanak açık tarlaya zarar verir.</li>
      <li>⛺ Tarla örtüsü 12 saat dona, doluya ve sağanağa karşı korur; sera her zaman korur.</li>
      <li>🏜️ Son 7 günde neredeyse hiç yağış almayan ilde elle sulama %30 ucuzdur.</li>
      <li>🤝 7 günde ikinci kez afetten etkilenen doğrulanmış (en az 7 günlük) hesaba ${akce(d.tutar)} afet desteği yatar (haftada bir).
        ${d.etkilenme ? `Son ${d.gun} günde ${d.etkilenme} kez etkilendin.` : ''}</li>
    </ul></div>`;
}

function ilKarti(il) {
  const h = il.hava;
  const rozetler = [
    il.gunesli ? '<span class="rozet-hava">☀️ güneşli: ekim %15 hızlı</span>' : '',
    il.ruzgar?.degirmenHizli ? `<span class="rozet-hava">🌬️ ${il.ruzgar.kmh} km/s: değirmen hızlı</span>` : '',
    il.kuraklik?.kurak ? `<span class="rozet-hava kurak">🏜️ kurak: sulama %${Math.round(il.kuraklik.indirim * 100)} ucuz</span>` : '',
  ].join('');
  const tarlalar = il.tarlalar.map((t) => {
    const koruma = t.sera ? '🏠 sera korur' : t.ortuBitis ? `⛺ örtülü · <span data-bitis="${t.ortuBitis}">${sure(t.ortuBitis - Date.now())}</span>` : '';
    const tehdit = t.tehdit.map((k) => il.riskler.find((r) => r.tur === k)?.ikon).join(' ');
    return `<li class="hava-tarla ${t.tehdit.length ? 'tehdit' : ''}">
      <span class="ikon">${t.ikon}</span>
      <span class="govde"><b>${esc(t.urun)}</b> <span class="kucuk">${esc(t.mahalle)}${t.olgun ? ' · hasada hazır' : ''}</span>
        <span class="kucuk">${t.tehdit.length ? `<b class="kirmizi-metin">${tehdit} risk altında</b>${t.olgun ? ' · hasat et ya da örtü ser' : ''}` : koruma || 'risk yok'}</span></span>
      <span class="sag">
        ${t.tehdit.length && !t.sera && !t.ortuBitis ? `<button type="button" class="dugme ince altin" data-eylem="ortu" data-id="${esc(t.parselId)}">⛺ Örtü</button>` : ''}
        <button type="button" class="dugme ince" data-eylem="git" data-id="${esc(t.parselId)}">Git</button></span></li>`;
  }).join('');
  return `<div class="kutu hava-il">
    <div class="hava-il-ust"><span class="hava-buyuk">${h?.ikon || '🌡️'}</span>
      <div><b>${esc(il.il)}</b> ${h ? `${h.sicaklik}° · ${esc(h.durum)}` : 'ölçüm bekleniyor'}
        <div class="kucuk">${il.yarin ? `Yarın ${yarinYazisi(il.yarin)}` : ''}</div></div></div>
    ${il.riskler.length ? `<p class="hava-risk">⚠️ Önümüzdeki ${il.tahminSaat} saat: ${il.riskler.map(riskYazisi).join(' · ')}</p>` : `<p class="kucuk">Önümüzdeki ${il.tahminSaat} saatte afet beklenmiyor.</p>`}
    ${rozetler ? `<div class="hava-rozetler">${rozetler}</div>` : ''}
    ${tarlalar ? `<ul class="liste">${tarlalar}</ul>` : '<p class="kucuk">Bu ilde ekili tarlan yok.</p>'}
  </div>`;
}

// Parsel kartı: tahmin, riskler ve hava etkileri (ilin şu anki havası satırının altında)
export function iklimSatiri(k) {
  const i = k.iklim;
  if (!i) return '';
  const parca = [];
  if (i.riskler.length) parca.push(`<span class="hava-risk">⚠️ ${i.tahminSaat} sa: ${i.riskler.map(riskYazisi).join(' · ')}</span>`);
  if (i.yarin) parca.push(`<span>Yarın ${yarinYazisi(i.yarin)}</span>`);
  if (i.gunesli) parca.push('<span class="rozet-hava">☀️ ekim %15 hızlı</span>');
  if (i.kuraklik?.kurak) parca.push(`<span class="rozet-hava kurak">🏜️ sulama %${Math.round(i.kuraklik.indirim * 100)} ucuz</span>`);
  return parca.length ? `<div class="iklim-satiri">${parca.join('')}</div>` : '';
}

// Tarla bölümünde örtü: aktifse süresi, değilse düğme (sera varken gerekmez)
export function ortuSatiri(k, e, maliyet) {
  if (e.ortuBitis) return `<p class="kucuk">⛺ Tarla örtülü: dona, doluya ve sağanağa karşı korunuyor · <span data-bitis="${e.ortuBitis}">${sure(e.ortuBitis - Date.now())}</span></p>`;
  if (!k.kullanimHakkim || k.yapilar?.some((y) => y.tip === 'SERA' && y.durum === 'ACTIVE' && !y.etkisiz)) return '';
  const tehdit = (k.iklim?.riskler || []).filter((r) => ['DOLU', 'SAGANAK'].includes(r.tur) || (r.tur === 'DON' && e.donHassas));
  return `<div class="ortu-satiri ${tehdit.length ? 'tehdit' : ''}">
    ${tehdit.length ? `<span class="kucuk"><b>${tehdit.map((r) => r.ikon).join(' ')} ${esc(tehdit.map((r) => r.ad).join(', '))} bekleniyor.</b> Hasat et ya da örtü ser.</span>` : `<span class="kucuk">${k.iklim.ortu.ikon} Örtü 12 saat dona, doluya ve sağanağa karşı korur.</span>`}
    <button type="button" class="dugme ince ${tehdit.length ? 'altin' : ''}" data-eylem="ortu">⛺ Örtü ser (${akce(maliyet)})</button></div>`;
}
