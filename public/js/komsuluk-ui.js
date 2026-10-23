// Komşular (arkadaşlar, istekler, hediyeler, yardım), yöresel ürünler (üretim ve albüm) ve mevsimlik etkinlik
// (balık tutma mini oyunu: balik-ui.js). Bölümler "Çiftliğim" sekmesinin alt başlıklarıdır; eylemler app.js'deki dağıtıcıdan geçer.
import { esc, akce, sayi, sure } from './yardimci.js';

// ---------- Komşular
export function komsularBolumu(k) {
  const L = k.limitler;
  const gelen = k.gelen.length ? `<h3 class="bolum">🤝 Komşuluk istekleri</h3><ul class="liste">${k.gelen.map((g) => `
    <li class="liste-oge"><span class="ikon">🧑‍🌾</span><div class="govde"><b>${esc(g.ad)}</b><div class="kucuk">seninle komşu olmak istiyor</div></div>
      <button class="dugme altin ince" data-eylem="arkadas-kabul" data-id="${g.id}">Kabul</button>
      <button class="bag" data-eylem="arkadas-sil" data-id="${g.id}">reddet</button></li>`).join('')}</ul>` : '';
  const hediye = k.hediyeler.length ? `<h3 class="bolum">🎁 Gelen hediyeler</h3><div class="hediye-kutulari">${k.hediyeler.map((h) => `
    <button class="hediye-kutu" data-eylem="hediye-al" data-id="${h.id}" title="${esc(h.gonderen)} gönderdi"><span>🎁</span><small>${esc(h.gonderen)}</small></button>`).join('')}</div>` : '';
  const liste = k.arkadaslar.length ? `<ul class="liste">${k.arkadaslar.map((a) => `
    <li class="liste-oge komsu"><span class="avatar">${esc(a.ad.slice(0, 1).toUpperCase())}</span>
      <div class="govde"><b>${esc(a.ad)}</b>${a.demo ? ' <span class="demo-rozet">demo</span>' : ''} <span class="kucuk">⭐ ${a.seviye}</span>
        <div class="kucuk">${a.parsel ? esc(a.parsel.mahalle) : 'henüz tarlası yok'}</div></div>
      <div class="komsu-dugmeler">
        ${a.parsel ? `<button class="dugme ince" data-eylem="komsuya-git" data-parsel="${esc(a.parsel.id)}" title="Çiftliğine git">🏡</button>` : ''}
        ${a.yardimParsel ? `<button class="dugme ince" data-eylem="komsuya-yardim" data-parsel="${esc(a.yardimParsel)}" title="Tarlasına yardım et">💧</button>` : ''}
        ${L.gonderebilir ? `<button class="dugme ince ${a.hediyeGonderildi ? '' : 'altin'}" data-eylem="hediye-gonder" data-id="${a.id}" ${a.hediyeGonderildi ? 'disabled title="Bugün gönderildi"' : 'title="Hediye gönder"'}>🎁</button>
        <button class="dugme ince" data-eylem="urun-gonder-ac" data-id="${a.id}" data-ad="${esc(a.ad)}" title="Ürün gönder">📦</button>` : ''}
      </div></li>`).join('')}</ul>`
    : `<div class="bos-durum"><div class="buyuk-ikon">🤝</div><p>Henüz komşun yok.</p><p class="kucuk">Haritada bir oyuncunun parseline dokun, kartındaki <b>Komşu ol</b> düğmesine bas. Demo sakinler isteğini hemen kabul eder.</p></div>`;
  return `${gelen}${hediye}<h3 class="bolum">🏘️ Komşularım <span class="kucuk">${k.arkadaslar.length}</span></h3>
    <p class="kucuk">Bugün ${L.yardimBugun}/${L.yardim} yardım · ${L.gonderimBugun}/${L.gonderim} ürün gönderimi. Komşunun tarlasına yardım edince sulama sayılır ya da ekin daha erken olgunlaşır; ikinize de yarar.</p>
    ${L.gonderebilir ? '' : `<p class="kucuk">🎁 Hediye ve 📦 ürün gönderme seviye ${L.gonderimSeviye}'te açılır.</p>`}
    ${liste}
    ${k.giden.length ? `<p class="kucuk">Bekleyen isteklerin: ${k.giden.map((g) => esc(g.ad)).join(', ')}</p>` : ''}`;
}

// Parsel kartında başka oyuncunun parseli için komşuluk düğmeleri
export function parselKomsuDugmeleri(k) {
  const r = k.komsuluk;
  if (!r) return '';
  const iliski = r.durum === 'ARKADAS' ? '<span class="cip yesil">🤝 Komşun</span>'
    : r.durum === 'ISTEK_GIDEN' ? '<span class="cip">İstek gönderildi</span>'
      : r.durum === 'ISTEK_GELEN' ? '<button class="dugme ince altin" data-eylem="arkadas-istek">🤝 İsteği kabul et</button>'
        : '<button class="dugme ince" data-eylem="arkadas-istek">🤝 Komşu ol</button>';
  return `<div class="satir-dugmeler">${iliski}${r.yardim ? '<button class="dugme ince altin" data-eylem="yardim">💧 Tarlasına yardım et</button>' : ''}</div>`;
}

// Ürün gönderme penceresi içeriği
export function urunGonderFormu(ad, kullaniciId, envanter) {
  const secenek = envanter.filter((i) => i.miktar > 0).map((i) => `<option value="${esc(i.item_id)}">${esc(i.ikon)} ${esc(i.ad)} (${sayi(i.miktar)})</option>`).join('');
  return `<form class="urun-gonder-form" data-id="${kullaniciId}"><h3 class="bolum">📦 ${esc(ad)} adlı komşuna ürün gönder</h3>
    ${secenek ? `<div class="satir"><select name="urun" required>${secenek}</select><input name="adet" type="number" min="1" value="1" required style="width:80px">
      <button class="dugme altin ince">Gönder</button></div>` : '<p class="kucuk">Envanterinde gönderilecek ürün yok.</p>'}
    <p class="kucuk">Başka illerin yöresel ürünlerini toplamak için komşularınla takas edebilirsin.</p></form>`;
}

// ---------- Yöresel ürünler
export function yoreselBolumu(y) {
  const uretebilir = y.urunler.filter((u) => u.uretebilir);
  const uret = uretebilir.length ? `<h3 class="bolum">🏭 Yöresel üretim</h3><div class="liste">${uretebilir.map((u) => {
    const eksik = u.girdi.some((g) => g.eldeki < g.adet);
    return `<div class="liste-oge"><span class="ikon">${u.ikon}</span><div class="govde"><b>${esc(u.ad)}</b>
      <div class="kucuk">${esc(u.ilAd)} · ${u.girdi.map((g) => `${g.ikon} ${g.adet} ${esc(g.ad)}${g.eldeki < g.adet ? ` <span class="kirmizi-metin">(${g.eldeki})</span>` : ''}`).join(' + ')}${u.akce ? `${u.girdi.length ? ' + ' : ''}${akce(u.akce)}` : ''} → ${y.kural.partiCikti} adet</div></div>
      <button class="dugme ${u.bugunUretildi || eksik ? '' : 'altin'} ince" data-eylem="yoresel-uret" data-kod="${u.kod}" ${u.bugunUretildi || eksik ? 'disabled' : ''}>${u.bugunUretildi ? 'Yarın' : 'Üret'}</button></div>`;
  }).join('')}</div>` : '<div class="kutu"><b>🏭 Yöresel üretim</b><p class="kucuk">Yöresel ürünler yalnızca kendi ilinde üretilir. Bir ilde parsel edinince o ilin ürününü üretebilirsin; diğerlerini komşularınla takas et ya da borsadan al.</p></div>';
  const albumSayfalari = y.bolgeler.map((b) => `<div class="album-sayfa"><div class="satir"><b>${esc(b.ad)}</b><span class="kucuk">${b.albumde}/${b.toplam}${b.odulAlindi ? ' · ✅' : ` · tamamlayınca ${akce(y.kural.bolgeOdul)}`}</span></div>
    <div class="album-kartlar">${y.urunler.filter((u) => u.bolge === b.ad).map((u) => `
      <button class="album-kart ${u.albumde ? 'dolu' : u.eldeki ? 'hazir' : ''}" ${u.albumde || !u.eldeki ? 'disabled' : ''} data-eylem="yoresel-album" data-kod="${u.kod}"
        title="${esc(u.ad)} · ${esc(u.ilAd)}${u.albumde ? ' · albümde' : u.eldeki ? ' · albüme koy' : ' · henüz yok'}">
        <span>${u.albumde || u.eldeki ? u.ikon : '❔'}</span><small>${esc(u.ad)}</small>${u.eldeki && !u.albumde ? '<i>+</i>' : ''}</button>`).join('')}</div></div>`).join('');
  return `${uret}<h3 class="bolum">📔 Coğrafi işaret albümü <span class="kucuk">${y.albumToplam}/${y.urunler.length}</span></h3>
    <p class="kucuk">Her ürün albüme bir kez konur (${akce(y.kural.albumOdul)}). Ürünler borsada ve komşular arasında takas edilebilir.</p>${albumSayfalari}`;
}

// ---------- Etkinlik
export function etkinlikBolumu(d, { simdi }) {
  if (!d.aktif) return `<div class="bos-durum"><div class="buyuk-ikon">📅</div><p>Şu an etkinlik yok.</p>${d.sonraki ? `<p class="kucuk">Sıradaki: ${d.sonraki.ikon} <b>${esc(d.sonraki.ad)}</b> · ${new Date(d.sonraki.bas).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })}</p>` : ''}</div>`;
  const e = d.aktif, o = e.ortak;
  return `<div class="etkinlik-baslik" style="--etkinlik:${e.renk}"><span>${e.ikon}</span><div><b>${esc(e.ad)}</b><div class="kucuk">${esc(e.aciklama)}</div>
      <div class="kucuk">Bitiş: <span data-bitis="${simdi() + e.kalanMs}">${sure(e.kalanMs)}</span></div></div></div>
    ${e.gorevler.map((g) => `<div class="kutu etkinlik-gorev"><div class="satir"><b>${esc(g.ad)}</b><span class="kucuk">${g.ilerleme}/${g.hedef}</span></div>
      <div class="cubuk altin"><span style="width:${(g.ilerleme / g.hedef) * 100}%"></span></div>
      <div class="satir"><span class="kucuk">Ödül: ${akce(g.odul)}${g.tp ? ` + ${g.tp} TP` : ''}</span>
        ${g.alindi ? '<span class="cip yesil">✓ alındı</span>' : `<button class="dugme ince ${g.alinabilir ? 'altin' : ''}" data-eylem="etkinlik-odul" data-gorev="${g.sira}" ${g.alinabilir ? '' : 'disabled'}>Ödülü al</button>`}</div></div>`).join('')}
    <div class="kutu etkinlik-ortak"><div class="satir"><b>🇹🇷 Ortak hedef</b><span class="kucuk">${sayi(o.ilerleme)}/${sayi(o.hedef)}</span></div>
      <p class="kucuk" style="margin:4px 0">${esc(o.ad)} · senin katkın: ${o.katki}</p>
      <div class="cubuk"><span style="width:${Math.min(100, (o.ilerleme / o.hedef) * 100)}%"></span></div>
      <div class="satir"><span class="kucuk">Hedefe ulaşılınca katkı veren herkese ${akce(o.odul)}</span>
        ${o.alindi ? '<span class="cip yesil">✓ alındı</span>' : `<button class="dugme ince ${o.alinabilir ? 'altin' : ''}" data-eylem="etkinlik-odul" data-gorev="-1" ${o.alinabilir ? '' : 'disabled'}>Ödülü al</button>`}</div></div>
    ${e.sus ? '<p class="kucuk">Etkinliğe özel süs, kendi parselinin kartındaki süs dükkânında; etkinlik bitince çiftliğinde kalır.</p>' : ''}`;
}
// Harita üstü etkinlik şeridi
export function etkinlikSeridi(d) {
  if (!d?.aktif) return '';
  return `<button type="button" class="etkinlik-serit" data-eylem="etkinlik-ac" style="--etkinlik:${d.aktif.renk}">${d.aktif.ikon} <b>${esc(d.aktif.ad)}</b> <span>görevlere bak</span></button>`;
}

