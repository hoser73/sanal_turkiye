// Görevden alma (geri çağırma) dilekçesi: sakinler imza toplar; eşik aşılınca makam boşalır ve ara seçim açılır.
import { esc, sure } from './yardimci.js';

const MAKAM_AD = { MUHTAR: 'Muhtar', BASKAN: 'Belediye başkanı', MECLIS: 'Meclis üyesi' };
const DURUM_AD = { ACIK: 'imza topluyor', BASARILI: 'eşik aşıldı · makam boşaldı', BASARISIZ: 'eşik aşılamadı', DUSTU: 'düştü' };

// hedefler: [{ makam, ad, userId }] — görevdeki ve başlatılabilecek makamlar
export function dilekceBolumu({ dilekceler = [], bolgeId, hedefler = [], sakin, girisli, sunucuSimdi }) {
  if (!dilekceler.length && !(girisli && sakin && hedefler.length)) return '';
  const p = ['<h3 class="bolum">Görevden alma dilekçeleri</h3>'];
  for (const d of dilekceler) {
    const oran = Math.min(100, Math.round((d.imza / d.esik) * 100));
    p.push(`<div class="kutu dilekce ${d.durum.toLowerCase()}">
      <div class="satir"><b>${esc(MAKAM_AD[d.makam])} ${esc(d.hedef)}</b><span class="cip">${esc(DURUM_AD[d.durum])}</span></div>
      <p>“${esc(d.gerekce)}”</p>
      <div class="ilerleme" role="progressbar" aria-valuenow="${d.imza}" aria-valuemax="${d.esik}"><span style="width:${oran}%"></span></div>
      <div class="satir kucuk"><span>${d.imza}/${d.esik} imza · başlatan ${esc(d.baslatan)}</span>
        ${d.durum === 'ACIK' ? `<span>kapanışa <span data-bitis="${d.bitis}">${sure(d.bitis - sunucuSimdi())}</span></span>` : ''}</div>
      ${d.durum === 'ACIK' && girisli ? (d.imzaladim ? '<p class="kucuk">✓ İmzaladın</p>'
        : d.imzaHakki ? `<button type="button" class="dugme ince" data-eylem="dilekce-imza" data-id="${d.id}">✍️ İmzala</button>` : '') : ''}
    </div>`);
  }
  const acikMakam = new Set(dilekceler.filter((d) => d.durum === 'ACIK').map((d) => `${d.makam}:${d.hedef}`));
  const baslatilabilir = girisli && sakin ? hedefler.filter((h) => !h.ben && !acikMakam.has(`${h.makam}:${h.ad}`)) : [];
  if (baslatilabilir.length) {
    p.push(`<details class="acilir"><summary>Dilekçe başlat</summary>
      <form class="form dilekce-form" data-bolge="${bolgeId}">
        <label>Kimin için<select name="hedef">${baslatilabilir.map((h) => `<option value="${h.makam}:${h.userId}">${esc(MAKAM_AD[h.makam])} · ${esc(h.ad)}</option>`).join('')}</select></label>
        <label>Gerekçe (en az 20 karakter, herkese açık)<textarea name="gerekce" rows="3" minlength="20" maxlength="600" required placeholder="Somut olarak neyin yapılmadığını yaz: vaatler, kasa, duyurular…"></textarea></label>
        <button class="dugme ince">Başlat ve ilk imzayı at</button>
        <p class="kucuk">Bölgedeki sakinlerin %40'ı (en az 2) 5 gün içinde imzalarsa makam boşalır, ara seçim takvimi açılır. Görevin ilk %20'sinde başlatılamaz. İmzalar gizlidir; yalnızca sayı görünür.</p>
      </form></details>`);
  }
  return p.join('');
}
