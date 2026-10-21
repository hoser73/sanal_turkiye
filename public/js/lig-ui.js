// İl ligi ve sezonlar: illerin oyuncu etkinliğiyle yarıştığı tablo, oyuncunun katkısı, memleket ve önceki sezonun kürsüsü.
import { api, esc, sayi, sure } from './yardimci.js';

export async function ligPaneli({ ben, sunucuSimdi }) {
  const l = await api('/api/lig');
  const memleket = l.memleket ? await api(`/api/memleket/${l.memleket}`).catch(() => null) : null;
  const satir = (x) => `<tr class="${x.plaka === l.memleket ? 'memleket' : ''}"><td>${x.sira}</td><td><b>${esc(x.il)}</b> <span class="kucuk">${x.plaka}</span>${x.plaka === l.memleket ? ' 🧿' : ''}</td>
    <td>${sayi(x.ligPuani)}</td><td class="kucuk">${sayi(x.puan)} · ${x.oyuncu} oyuncu</td></tr>`;
  const podyum = l.oncekiSezon.length ? `<div class="kutu"><b>${l.sezon - 1}. sezonun kürsüsü</b>
    <ol class="kursu">${l.oncekiSezon.map((x, i) => `<li><span>${['🥇', '🥈', '🥉'][i]}</span>${esc(x.il)}<small>${sayi(x.lig_puani)}</small></li>`).join('')}</ol></div>` : '';
  return `<div class="sezon-baslik"><div><p class="ust-baslik-kucuk">${l.mevsim.ikon} ${esc(l.mevsim.ad)} · ${l.sezon}. sezon</p>
      <b>İl ligi</b></div><div class="kucuk">bitişe <span data-bitis="${l.bitis}">${sure(l.bitis - sunucuSimdi())}</span></div></div>
    ${memleket ? `<div class="kutu memleket-kart"><b>🧿 Memleketin: ${esc(memleket.il)}</b>
      <p class="kucuk" style="margin:4px 0 0">${memleket.hemsehri} hemşehri · ${memleket.gurbette} gurbette · lig sırası ${memleket.ligSirasi ?? '—'}${memleket.hava ? ` · ${memleket.hava.ikon} ${memleket.hava.sicaklik}°` : ''}</p></div>`
      : ben ? '<p class="kucuk">Memleketini seçersen gurbetteki eylemlerin memleketine de yarım puan yazar. <button type="button" class="bag" data-eylem="hesap-ac" data-bolum="oyun">Memleket seç</button></p>' : ''}
    ${l.benimKatkim.length ? `<p class="kucuk">Bu sezon katkın: ${l.benimKatkim.map((k) => `<b>${esc(k.il)}</b> ${sayi(k.puan)}`).join(' · ')}</p>` : ''}
    ${l.tablo.length ? `<table class="lig-tablo"><thead><tr><th>#</th><th>İl</th><th>Lig puanı</th><th></th></tr></thead><tbody>${l.tablo.slice(0, 25).map(satir).join('')}</tbody></table>`
      : '<p class="kucuk">Bu sezon henüz puan yok. Parsel edin, hasat et, yapı kur: ilin tabloya girsin!</p>'}
    ${podyum}
    <details class="acilir"><summary>Puanlar nasıl hesaplanıyor?</summary><p class="kucuk">${esc(l.formul)}</p>
      <ul class="madde kucuk">${Object.entries(l.puanlar).map(([k, v]) => `<li>${esc(EYLEM_AD[k] || k)}: ${v}</li>`).join('')}</ul>
      <p class="kucuk">İlk üç ilde en az 10 puan katkı veren oyunculara sezon rozeti verilir.</p></details>`;
}
const EYLEM_AD = { PARCEL_ACQUIRED: 'Parsel edinme', STRUCTURE_COMPLETED: 'Yapı tamamlama', CROP_HARVESTED: 'Hasat', PARCEL_TRADED: 'Parsel satışı',
  PARCEL_VISITED: 'Komşu ziyareti', MUHTAR_ANNOUNCEMENT: 'Muhtar duyurusu', ELECTION_CLOSED: 'Sonuçlanan seçim', PROJECT_COMPLETED: 'Tamamlanan belediye projesi',
  STRUCTURES_MAINTAINED: 'Yapı bakımı', COMMODITY_TRADE: 'Borsa işlemi' };
