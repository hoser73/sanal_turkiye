// Komşular (arkadaşlar, istekler, hediyeler, yardım), yöresel ürünler (üretim ve albüm) ve mevsimlik etkinlik
// (balık tutma mini oyunu: balik-ui.js). Bölümler "Çiftliğim" sekmesinin alt başlıklarıdır; eylemler app.js'deki dağıtıcıdan geçer.
import { esc, akce, sayi, sure, sayiBulunma } from './yardimci.js';

// ---------- İmece: komşunla haftalık ortak hedef (imece.js)
export function imeceKarti(m) {
  const ust = (alt) => `<div class="yaris-ust"><span class="yaris-ikon imece-ikon">🤝</span><div><b>İmece</b><small>${alt}</small></div></div>`;
  const a = m.aktif;
  if (a) {
    const son = a.kademeler.at(-1).esik;
    return `<div class="yaris-kart imece-kart">${ust(`${esc(a.ortak.ad)}${a.ortak.demo ? ' (demo)' : ''} ile bu hafta · bitişe ${sure(m.kalanMs)}`)}
      <div class="yaris-yol"><div class="yaris-cubuk"><b style="width:${Math.min(100, (a.toplam / son) * 100)}%"></b></div>
        ${a.kademeler.map((k) => `<span class="yaris-sandik${k.gecildi ? ' acik' : ''}" style="left:${(k.esik / son) * 100}%" title="${k.esik} puan: ${akce(k.akce)}${k.esya ? ` + ${k.esya.adet} ${esc(k.esya.ad)}` : ''}">${k.alindi ? '✅' : k.gecildi ? '🎁' : '📦'}<small>${k.esik}</small></span>`).join('')}</div>
      <p class="kucuk yaris-not">Ortak puan <b>${sayi(a.toplam)}</b> · sen ${sayi(a.katkim)}${a.katkim < m.minKatki ? ` (ödül için en az ${m.minKatki})` : ' ✓'} · ${esc(a.ortak.ad)} ${sayi(a.ortakKatki)}</p>
      <p class="kucuk">Ödüller: ${a.kademeler.map((k) => `${akce(k.akce)}${k.esya ? ` + ${k.esya.ikon} ${k.esya.adet}` : ''}`).join(' · ')}. Hasat, sipariş, üretim, yardım ve bulmaca puan getirir.</p>
      <button type="button" class="bag" data-eylem="imece-birak">Ortaklığı bırak</button></div>`;
  }
  const gelen = m.gelen.map((d) => `<li class="liste-oge"><span class="ikon">🤝</span><div class="govde"><b>${esc(d.ad)}</b><div class="kucuk">seni bu haftanın imecesine çağırıyor</div></div>
    <button class="dugme altin ince" data-eylem="imece-kabul" data-id="${d.id}">Kabul</button><button class="bag" data-eylem="imece-reddet" data-id="${d.id}">reddet</button></li>`).join('');
  return `<div class="yaris-kart imece-kart">${ust(`Komşunla haftalık ortak hedef · bitişe ${sure(m.kalanMs)}`)}
    <p class="kucuk yaris-not">Bir komşunu çağır: ikinizin işleri ortak puana yazar; ${m.kademeler.join(' / ')} puanda ödül sandıkları açılır (en az ${m.minKatki} puan katana).</p>
    ${gelen ? `<ul class="liste">${gelen}</ul>` : ''}
    ${m.giden ? `<p class="kucuk">⏳ ${esc(m.giden.ad)} davetini bekliyor.</p>`
      : !m.kalanOrtaklik ? '<p class="kucuk">Bu hafta imece hakkın doldu.</p>'
      : m.adaylar.length ? `<div class="imece-adaylar">${m.adaylar.slice(0, 8).map((x) => `<button type="button" class="cip" data-eylem="imece-davet" data-id="${x.id}">＋ ${esc(x.ad)}${x.demo ? ' · demo' : ''}</button>`).join('')}</div>`
      : '<p class="kucuk">Önce bir komşu edin.</p>'}</div>`;
}

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
    ${L.gonderebilir ? '' : `<p class="kucuk">🎁 Hediye ve 📦 ürün gönderme seviye ${sayiBulunma(L.gonderimSeviye)} açılır.</p>`}
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
// Koleksiyon haritası: albüme ürünü konan iller altın, elinde olan yeşil, diğer ürünlü iller soluk; il sınırları bir kez
// yüklenip SVG yola çevrilir (eşdikdörtgen izdüşüm, enlem düzeltmeli)
let ilYollari = null;
async function ilYollariHazirla() {
  if (ilYollari) return ilYollari;
  const g = await fetch('/veri/iller.geojson').then((r) => r.json());
  const k = Math.cos((39 * Math.PI) / 180), X = (lon) => (lon - 25.6) * k * 26, Y = (lat) => (42.2 - lat) * 26;
  ilYollari = g.features.map((f) => {
    const halkalar = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const d = halkalar.map((p) => p.map((h) => h.filter((_, i) => i % 3 === 0).map(([a, b], i) => `${i ? 'L' : 'M'}${X(a).toFixed(1)} ${Y(b).toFixed(1)}`).join('') + 'Z').join('')).join('');
    return { plaka: f.properties.plaka, ad: f.properties.ad, d };
  });
  return ilYollari;
}
function koleksiyonHaritasi(y) {
  const durum = new Map();
  for (const u of y.urunler) { const o = durum.get(u.il) || 0; durum.set(u.il, Math.max(o, u.albumde ? 3 : u.eldeki ? 2 : 1)); }
  const kimlik = `kh-${Math.random().toString(36).slice(2, 8)}`;
  ilYollariHazirla().then((yollar) => {
    const el = document.getElementById(kimlik);
    if (!el) return;
    el.innerHTML = `<svg viewBox="0 0 410 175" role="img" aria-label="Yöresel ürün koleksiyon haritası">${yollar.map((p) => {
      const d = durum.get(p.plaka) || 0;
      return `<path d="${p.d}" class="kh-il kh-${d}"><title>${esc(p.ad)}${d === 3 ? ' · albümde' : d === 2 ? ' · elinde' : d === 1 ? ' · yöresel ürünü var' : ''}</title></path>`;
    }).join('')}</svg>`;
  }).catch(() => {});
  return `<div class="koleksiyon-harita" id="${kimlik}"></div>
    <div class="kh-lejant"><span><i class="kh-3"></i>Albümde</span><span><i class="kh-2"></i>Elinde</span><span><i class="kh-1"></i>Toplanacak</span></div>`;
}

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
    ${koleksiyonHaritasi(y)}
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

