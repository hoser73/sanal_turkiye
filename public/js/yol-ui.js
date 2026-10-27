// Sezon yolu arayüzü (Çiftlik → 🛤️ Yol): mevsimin ödül yolu; kademeler, ilerleme, puan kaynakları, ödül alma.
// Yalnızca HTML üretir; "yol-al" tıklaması app.js'deki eylem dağıtıcısından geçer.
import { esc, sayi, sure } from './yardimci.js';

const odulHtml = (o) => o.map((x) => `<span class="yol-odul${x.ozel ? ' ozel' : ''}"><i>${esc(x.ikon)}</i>${esc(x.metin)}</span>`).join('');

export function yolBolumu(d, { simdi }) {
  const son = d.kademeler.at(-1).esik;
  const yuzde = Math.min(100, Math.round((d.puan / son) * 100));
  const sonraki = d.sonraki ? Math.round(((d.puan - (d.sonraki.n > 1 ? d.kademeler[d.sonraki.n - 2].esik : 0)) / (d.sonraki.esik - (d.sonraki.n > 1 ? d.kademeler[d.sonraki.n - 2].esik : 0))) * 100) : 100;
  return `<div class="yol-baslik">
      <div class="yol-mevsim">${d.ikon}</div>
      <div class="yol-bilgi"><b>${esc(d.ad)}</b><small>Bitişe <span data-bitis="${d.bitis}">${sure(d.bitis - simdi())}</span> · ${d.ulasilan}/${d.kademeler.length} kademe</small>
        <div class="yol-cubuk" aria-label="Yol ilerlemesi %${yuzde}"><b style="width:${yuzde}%"></b></div></div>
      <div class="yol-puan"><b>${sayi(d.puan)}</b><small>yol puanı</small></div>
    </div>
    ${d.sonraki ? `<div class="kutu yol-siradaki"><div class="satir"><div><div class="kucuk">Sıradaki kademe ${d.sonraki.n}</div><b>${sayi(d.sonraki.eksik)} puan kaldı</b></div>
        <div class="yol-mini"><b style="width:${Math.max(0, Math.min(100, sonraki))}%"></b></div></div>
        <div class="yol-oduller">${odulHtml(d.kademeler[d.sonraki.n - 1].odul)}</div></div>` : '<div class="kutu vurgulu"><b>🏁 Yolun sonuna ulaştın!</b><p class="kucuk">Yeni mevsimde yeni yol başlar.</p></div>'}
    ${d.alinabilir ? `<button type="button" class="dugme altin genis yol-al" data-eylem="yol-al">🎁 ${d.alinabilir} ödülü al</button>` : ''}
    <ol class="yol-liste">${d.kademeler.map((k) => `<li class="${k.alindi ? 'alindi' : k.acik ? 'acik' : ''}${k.buyuk ? ' buyuk' : ''}">
        <span class="yol-no">${k.alindi ? '✓' : k.n}</span>
        <span class="yol-govde"><span class="yol-oduller">${odulHtml(k.odul)}</span><small>${sayi(k.esik)} puan</small></span>
        ${k.acik && !k.alindi ? `<button type="button" class="dugme ince altin" data-eylem="yol-al" data-kademe="${k.n}">Al</button>` : k.alindi ? '<span class="kucuk">alındı</span>' : '<span class="yol-kilit">🔒</span>'}
      </li>`).join('')}</ol>
    <details class="acilir"><summary>Yol puanı nasıl kazanılır?</summary>
      <ul class="yol-kaynak">${d.puanlar.map((p) => `<li><span>${esc(p.ad)}</span><b>+${p.puan}</b></li>`).join('')}</ul>
      <p class="kucuk">Aynı işten günde en çok ${d.gunlukTavan} kez puan sayılır. Ödüller oyun içidir; akçe nakde çevrilmez.</p></details>`;
}
