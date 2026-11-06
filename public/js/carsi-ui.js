// Çarşı sekmesi: banka, nalbur, market, zirai bayi. Her türden tek işletme; sponsor markası (ad, logo, renkler) sunucudan gelir ve
// sponsorlu işletme "Sponsor" etiketiyle gösterilir. Eylemler app.js'deki dağıtıcıdan geçer.
import { esc, akce, sayi, sure, paraGirdisi } from './yardimci.js';

const simdi = () => Date.now();
const tarihGoster = (ms) => new Date(ms).toLocaleString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

export function markaBasligi(m, { kucuk = false } = {}) {
  const logo = m.logo ? `<img class="marka-logo" src="${esc(m.logo)}" alt="${esc(m.ad)} logosu" width="${kucuk ? 36 : 48}" height="${kucuk ? 36 : 48}">`
    : `<span class="marka-ikon">${esc(m.ikon)}</span>`;
  return `<div class="marka-baslik ${kucuk ? 'kucuk-baslik' : ''}" style="--marka:${esc(m.renk)};--marka2:${esc(m.renk2)}">${logo}
    <div class="marka-govde"><b>${esc(m.ad)}</b><span class="kucuk">${esc(m.tur)}${m.slogan ? ` · ${esc(m.slogan)}` : ''}</span></div>
    ${m.sponsor ? '<span class="sponsor-etiket" title="Bu işletme oyunun sponsorudur">Sponsor</span>' : ''}</div>`;
}

// Çarşı girişi: dört işletme
export function carsiGirisi(c) {
  return `<h2 class="kart-baslik">Çarşı</h2>
    <p class="alt-yazi">Her türden tek işletme var. Haritada şehir merkezlerinde şubelerini de görebilirsin.</p>
    <div class="carsi-liste">${c.isletmeler.map((m) => `<button type="button" class="carsi-kart" data-eylem="carsi-ac" data-kategori="${m.kategori}">
      ${markaBasligi(m)}<span class="carsi-ne kucuk">${{ BANKA: 'Vadeli hesap', NALBUR: 'Kalıp seti, bakım kiti, örtü, olta takımı', MARKET: 'Yem paketleri, ürün satışı', ZIRAI: 'Gübre, bitki koruma, hayvan aşısı' }[m.kategori]}</span></button>`).join('')}</div>
    <p class="kucuk">Oyun parası (TL) nakde çevrilemez; çarşıdaki alışverişler ve banka işlemleri yalnızca oyun içindir.</p>`;
}

// Dükkân vitrini
export function dukkanHTML(v, { girisli, bakiye, envanter = [], kurallar }) {
  const urunler = v.urunler.map((u) => {
    const sahip = u.kalici && u.eldeki > 0;
    return `<li class="dukkan-oge"><span class="dukkan-ikon">${u.ikon}</span>
      <div class="govde"><b>${esc(u.ad)}</b>${u.kalici ? ' <span class="cip-kalici">kalıcı</span>' : ''}<span class="kucuk">${esc(u.etki)}</span>
        ${girisli && u.eldeki ? `<span class="kucuk yesil-metin">Elinde: ${sayi(u.eldeki)}</span>` : ''}</div>
      ${!girisli ? `<b>${akce(u.fiyat)}</b>` : sahip ? '<span class="kucuk yesil-metin">✓ sende</span>'
        : `<form class="carsi-al-form satir" data-urun="${u.kod}">${u.kalici ? '' : `<input type="number" name="adet" min="1" max="20" value="1" aria-label="Adet">`}
          <button class="dugme ince" ${bakiye < u.fiyat ? 'disabled' : ''}>${akce(u.fiyat)}</button></form>`}</li>`;
  }).join('');
  let ek = '';
  // Ürün satışı tek yerde: Pazar → Tüccara sat (market eskiden aynı alımı ikinci kez sunuyordu)
  if (v.marka.kategori === 'MARKET' && girisli) ek = '<p class="kucuk">Ürünlerini satmak için <button type="button" class="bag" data-eylem="tuccara-git">Pazar → Tüccara sat</button>.</p>';
  if (v.marka.kategori === 'ZIRAI') ek = '<p class="kucuk">Gübre ve ilacı tarlanın kartından, aşıyı barınağın satırından uygularsın.</p>';
  return `<button type="button" class="bag geri-dugme" data-eylem="carsi-geri">← Çarşı</button>
    ${markaBasligi(v.marka)}${v.marka.web ? `<p class="kucuk"><a href="${esc(v.marka.web)}" target="_blank" rel="noopener sponsored">${esc(new URL(v.marka.web).host)}</a></p>` : ''}
    <ul class="dukkan-liste">${urunler}</ul>${ek}`;
}

// Banka
export function bankaHTML(b) {
  const B = b.kurallar;
  const vadeliler = b.vadeliler.length ? `<ul class="liste">${b.vadeliler.map((v) => `<li class="liste-oge"><span class="ikon">${v.durum === 'ACIK' ? '🔒' : v.durum === 'KAPANDI' ? '✅' : '↩️'}</span>
      <div class="govde"><b>${akce(v.tutar)}</b><span class="kucuk">${v.durum === 'ACIK' ? (v.vadeDoldu ? 'Vadesi doldu' : `Vade: <span data-bitis="${v.vade}">${sure(v.vade - simdi())}</span>`) : v.durum === 'KAPANDI' ? `Getiri ${akce(v.getiri)} alındı` : 'Vadesinden önce bozduruldu'}
        · getiri %${sayi(v.faiz * 100)} (${akce(v.getiri)})</span></div>
      ${v.durum === 'ACIK' ? `<button class="dugme ince ${v.vadeDoldu ? 'altin' : ''}" data-eylem="vadeli-kapat" data-id="${v.id}">${v.vadeDoldu ? 'Getiriyi al' : 'Boz (getirisiz)'}</button>` : ''}</li>`).join('')}</ul>`
    : '<p class="kucuk">Vadeli hesabın yok.</p>';
  return `<button type="button" class="bag geri-dugme" data-eylem="carsi-geri">← Çarşı</button>
    ${markaBasligi(b.marka)}
    <div class="banka-ozet"><div><span class="kucuk">Vadesiz (cüzdan)</span><b>${akce(b.bakiye)}</b></div><div><span class="kucuk">Vadeli</span><b>${akce(b.acikVadeli)}</b></div></div>
    <h3 class="bolum">Vadeli hesap</h3>
    <p class="kucuk">${B.vadeliGun} gün kilitli kalır, vadesinde %${sayi(B.vadeliFaiz * 100)} getiri. Vadeden önce bozarsan getiri yok. Toplam en çok ${akce(B.vadeliMaks)}.</p>
    <form class="vadeli-form satir">${paraGirdisi({ name: 'tutar', min: B.vadeliMin, max: Math.max(B.vadeliMin, Math.min(b.bakiye, B.vadeliMaks - b.acikVadeli)), deger: Math.max(B.vadeliMin, Math.min(100, Math.floor(b.bakiye))), ek: 'aria-label="Vadeli tutar (TL)"' })}
      <button class="dugme ince" ${b.bakiye < B.vadeliMin ? 'disabled' : ''}>Vadeli hesap aç</button></form>
    ${vadeliler}
    <p class="kucuk banka-uyari">ℹ️ ${esc(b.uyari)}</p>`;
}
