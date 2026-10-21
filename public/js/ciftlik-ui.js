// Çiftlik oyunu arayüzü: barınak kontrolleri (yemle / topla), süs dükkânı, Görevler sekmesinde seviye ve ödüller,
// günlük giriş ödülü, sipariş panosu ve haftalık köy yarışması. Eylemler app.js'deki ortak data-eylem dağıtıcısından geçer.
import { esc, akce, sayi, sure } from './yardimci.js';

// Barınak satırı (parsel kartındaki yapı listesinde)
export function hayvanSatiri(y, { ben, yem = 0, simdi }) {
  const h = y.hayvan;
  if (!h) return '';
  const durum = h.durum === 'HAZIR' ? `<b class="yesil-metin">${h.urunIkon} ${h.miktar} ${esc(h.urunAd)} hazır</b>`
    : h.durum === 'BESLENDI' ? `⏳ ${esc(h.urunAd)} hazırlanıyor · <span data-bitis="${h.hazir}">${sure(h.hazir - simdi())}</span>`
      : `${h.ikon} ${h.sayi} ${esc(h.hayvan.toLowerCase())} aç · ${h.yem} yem ister`;
  const dugme = !ben ? '' : h.durum === 'HAZIR'
    ? `<button class="dugme altin ince" data-eylem="hayvan-topla" data-id="${y.id}" data-ikon="${h.urunIkon}">${h.urunIkon} Topla</button>`
    : h.durum === 'AC' ? `<button class="dugme ince" data-eylem="hayvan-besle" data-id="${y.id}" title="${yem >= h.yem ? 'Envanterdeki yem kullanılır' : 'Eksik yem satın alınır'}">🌽 Yemle${yem < h.yem ? ` (${akce((h.yem - Math.min(yem, h.yem)) * 1.2)})` : ''}</button>` : '';
  return `<div class="hayvan-satir"><span class="kucuk">${durum}</span>${dugme}</div>`;
}

// Süs dükkânı (kendi parselimde)
export function susBolumu(k) {
  if (!k.susSecenekleri) return k.susler?.length ? `<h3 class="bolum">Çiftlik süsleri</h3><p class="kucuk">${k.susler.map((s) => `${s.ikon} ${esc(s.ad)}`).join(' · ')}</p>` : '';
  const mevcut = k.susler.length ? `<ul class="sus-liste">${k.susler.map((s) => `<li>${s.ikon} ${esc(s.ad)} <button class="bag" data-eylem="sus-kaldir" data-id="${s.id}" title="Kaldır (bedeli iade edilmez)">kaldır</button></li>`).join('')}</ul>` : '';
  return `<h3 class="bolum">Çiftlik süsleri <span class="kucuk">${k.susler.length}/8</span></h3>${mevcut}
    <div class="sus-dukkan">${k.susSecenekleri.map((s) => `
      <button class="sus-oge" data-eylem="sus-ekle" data-tur="${s.kod}" ${s.acik && k.susler.length < 8 ? '' : 'disabled'} title="${s.acik ? esc(s.ad) : `Seviye ${s.minSeviye}'te açılır`}">
        <span class="sus-ikon">${s.acik ? s.ikon : '🔒'}</span><b>${esc(s.ad)}</b><span class="kucuk">${s.acik ? akce(s.fiyat) : `Sv ${s.minSeviye}`}</span></button>`).join('')}</div>`;
}

// Görevler sekmesinin çiftlik bölümü
export function ciftlikBolumu(c, { simdi }) {
  const sv = c.seviye;
  const ilerleme = sv.sonraki ? Math.min(100, ((sv.tp - sv.esik) / (sv.sonraki - sv.esik)) * 100) : 100;
  const seviye = `<div class="kutu seviye-kutu">
      <div class="satir"><span class="seviye-yildiz">⭐ ${sv.seviye}</span><div style="flex:1"><b>Seviye ${sv.seviye}</b>
        <div class="kucuk">${sayi(sv.tp)} TP${sv.sonraki ? ` · sonraki seviyeye ${sayi(sv.sonraki - sv.tp)} TP` : ' · en üst seviye'}</div></div></div>
      <div class="cubuk altin"><span style="width:${ilerleme}%"></span></div>
      ${sv.odulBekleyen.length ? `<button class="dugme altin genis" data-eylem="seviye-odul" style="margin-top:10px">🎁 Seviye ödülünü al (${akce(sv.odulTutari)})</button>` : ''}
      ${sv.acilanlar.length ? `<p class="kucuk" style="margin:8px 0 0">Seviye ${sv.seviye + 1}'te açılır: ${sv.acilanlar.map((a) => `${a.ikon} ${esc(a.ad)}`).join(', ')}</p>` : ''}
    </div>`;
  const g = c.gunluk;
  const gunluk = `<div class="kutu gunluk-kutu"><div class="satir"><span class="buyuk-ikon">${g.alinabilir ? '🎁' : '✅'}</span>
      <div style="flex:1"><b>Günlük ödül</b><div class="kucuk">${g.alinabilir ? `${g.seri}. gün: ${akce(g.akce)} + ${g.tp} TP` : `Bugünkü ödül alındı · seri ${g.seri} gün`}</div>
      <div class="gunluk-seri">${g.tablo.map((a, i) => `<span class="${i < g.seri - (g.alinabilir ? 1 : 0) ? 'alindi' : i === g.seri - 1 && g.alinabilir ? 'bugun' : ''}">${a}</span>`).join('')}</div></div>
      ${g.alinabilir ? '<button class="dugme altin ince" data-eylem="gunluk-odul">Al</button>' : ''}</div></div>`;
  const s = c.siparisler;
  const siparis = `<h3 class="bolum">📋 Sipariş panosu <span class="kucuk">${s.liste.length}/${s.maks}</span></h3>
    ${s.liste.length ? `<div class="siparis-liste">${s.liste.map((o) => `
      <div class="siparis ${o.hazir ? 'hazir' : ''}">
        <div class="satir"><b>${esc(o.musteri)}</b><span class="kucuk"><span data-bitis="${simdi() + o.kalanMs}">${sure(o.kalanMs)}</span></span></div>
        <div class="siparis-kalemler">${o.kalemler.map((k) => `<span class="${k.eldeki >= k.adet ? 'var' : 'yok'}" title="Envanterde ${k.eldeki}">${k.ikon} ${k.adet} <small>${esc(k.ad)}</small></span>`).join('')}</div>
        <div class="satir"><span class="kucuk">Ödül: <b>${akce(o.odul)}</b> + ${o.tp} TP</span>
          <span><button class="bag" data-eylem="siparis-reddet" data-id="${o.id}">reddet</button>
          <button class="dugme ${o.hazir ? 'altin' : ''} ince" data-eylem="siparis-teslim" data-id="${o.id}" ${o.hazir ? '' : 'disabled'}>Teslim et</button></span></div>
      </div>`).join('')}</div>` : '<p class="kucuk">Şu an sipariş yok.</p>'}
    ${s.sonrakiMs != null ? `<p class="kucuk">Yeni müşteri: <span data-bitis="${simdi() + s.sonrakiMs}">${sure(s.sonrakiMs)}</span></p>` : ''}`;
  const y = c.yarisma;
  const yarisma = !y ? '<h3 class="bolum">🏆 Köy yarışması</h3><p class="kucuk">Bir parsel edinince mahallenin haftalık yarışmasına katılırsın.</p>'
    : `<h3 class="bolum">🏆 Köy yarışması · ${esc(y.mahalle)}</h3>
      <p class="kucuk">Bu hafta en çok TP kazanan üç komşu ${y.odul.map((o) => akce(o)).join(' / ')} kazanır (en az ${y.minTp} TP). Bitiş: <span data-bitis="${simdi() + y.bitisMs}">${sure(y.bitisMs)}</span></p>
      ${y.liste.length ? `<ol class="yarisma-liste">${y.liste.slice(0, 10).map((r) => `<li class="${r.ben ? 'ben' : ''}"><span>${['🥇', '🥈', '🥉'][r.sira - 1] || r.sira}</span><b>${esc(r.ad)}</b>${r.demo ? ' <span class="demo-rozet">demo</span>' : ''}<span class="kucuk">${sayi(r.tp)} TP</span></li>`).join('')}</ol>` : '<p class="kucuk">Bu hafta henüz puan yok.</p>'}
      ${y.gecenHafta.length ? `<p class="kucuk">Geçen hafta: ${y.gecenHafta.map((r) => `${['🥇', '🥈', '🥉'][r.sira - 1]} ${esc(r.ad)}`).join(' · ')}</p>` : ''}`;
  return seviye + gunluk + siparis + yarisma;
}
