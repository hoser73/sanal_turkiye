// Oyuncular arası pazar arayüzü: parsel kartındaki ilan bölümü + Pazar sekmesi.
// Yalnızca HTML üretir; tıklamalar app.js'deki data-eylem işleyicisinden geçer.
import { api, esc, sayi, akce, sure, zamanOnce, bulunma } from './yardimci.js';

const IMAR_IKON = { KONUT: '🏠', TICARET: '🏪', TARIM: '🌾', SANAYI: '🏭', TURIZM: '🏨', KARMA: '🏙️', KORUMA: '🌲', PARK: '⛲' };
const TEKLIF_DURUM = {
  ACTIVE: ['Bekliyor · tutar kilitli', 'bekliyor'], ACCEPTED: ['Kabul edildi', 'olumlu'], REJECTED: ['Reddedildi · iade edildi', 'olumsuz'],
  WITHDRAWN: ['Geri çekildi · iade edildi', 'notr'], REPLACED: ['Yükseltildi', 'notr'], CANCELLED: ['İlan kapandı · iade edildi', 'notr'],
  EXPIRED: ['Süre doldu · iade edildi', 'notr'],
};
const ILAN_DURUM = { ACTIVE: ['Satışta', 'bekliyor'], SOLD: ['Satıldı', 'olumlu'], CANCELLED: ['Kaldırıldı', 'notr'], EXPIRED: ['Süresi doldu', 'notr'] };
const durumCipi = ([metin, tur]) => `<span class="durum-cip ${tur}">${esc(metin)}</span>`;
const zamanMs = (ms) => zamanOnce(new Date(ms).toISOString().replace('T', ' ').slice(0, 19));

// ---------- Ortak: dört ayrı metrik (§8.5) ----------
function metrikler(ilan, piyasa, gelismislik, mahalle) {
  const guven = piyasa.guvenilirlikDusuk
    ? `<p class="guven-uyari">⚠️ Fiyat güvenilirliği düşük: ${esc(bulunma(mahalle))} son ${piyasa.referansGun} günde ${piyasa.mahalleIslemSayisi} gerçek işlem var.</p>`
    : `<p class="kucuk">${esc(mahalle)} son ${piyasa.referansGun} gün: ${piyasa.mahalleIslemSayisi} işlem, medyan ${akce(piyasa.mahalleMedyanM2)}/m²</p>`;
  return `<dl class="metrikler">
      <div><dt>İstenen fiyat</dt><dd>${ilan ? akce(ilan.fiyat) : '—'}</dd><small>satıcının istediği</small></div>
      <div><dt>En yüksek teklif</dt><dd>${ilan?.enYuksekTeklif != null ? akce(ilan.enYuksekTeklif) : '—'}</dd><small>${ilan ? `${ilan.teklifSayisi} aktif teklif` : 'ilan yok'}</small></div>
      <div><dt>Son gerçekleşen işlem</dt><dd>${piyasa.sonIslem ? akce(piyasa.sonIslem.fiyat) : '—'}</dd><small>${piyasa.sonIslem ? zamanMs(piyasa.sonIslem.tarih) : 'bu parselde yok'}</small></div>
      <div><dt>Gelişmişlik skoru</dt><dd>${gelismislik}/100</dd><small>fiyat değildir</small></div>
    </dl>${guven}`;
}

function devirKapsami(v) {
  const satirlar = [`${sayi(v.parsel.alan)} m² ${esc(v.parsel.mahalle)} parseli (kullanım hakkı)`];
  for (const y of v.yapilar) satirlar.push(`${esc(y.ad)}${y.durum === 'BUILDING' ? ' (inşaatta)' : ''}`);
  if (v.ekin) satirlar.push(`Tarladaki ${esc(v.ekin.ad)} ekini`);
  satirlar.push(v.borclar.length ? v.borclar.map(esc).join(', ') : 'Borç / kısıt yok');
  return `<ul class="madde">${satirlar.map((s) => `<li>${s}</li>`).join('')}</ul>`;
}

function gecmisListesi(g) {
  if (!g.length) return '';
  const satir = (x) => {
    if (x.tur === 'LISTING_CREATED') return `🏷️ İlan açıldı · ${akce(x.sonra.fiyat)}`;
    if (x.tur === 'LISTING_PRICE_CHANGED') return `✏️ Fiyat ${akce(x.once.fiyat)} → ${akce(x.sonra.fiyat)}`;
    return `💬 ${esc(x.kim)}${x.ben ? ' (sen)' : ''} · ${akce(x.tutar)} ${durumCipi(TEKLIF_DURUM[x.durum] || [x.durum, 'notr'])}`;
  };
  return `<details class="acilir"><summary>İlan geçmişi (${g.length})</summary>
    <ul class="zaman-cizgisi">${g.slice().reverse().map((x) => `<li><span>${satir(x)}</span><time>${zamanMs(x.zaman)}</time></li>`).join('')}</ul></details>`;
}

// ---------- Parsel kartı: pazar bölümü ----------
export function parselPazarBolumu(k, { ben, sunucuSimdi, kurallar }) {
  const { ilan, piyasa } = k.pazar || {};
  if (!piyasa) return '';
  const benim = k.sahip?.ben;
  const kapali = !k.imar.satilik;

  if (!ilan) {
    if (benim && !kapali) return ilanAcFormu(k, piyasa, kurallar);
    if (piyasa.sonIslem) {
      return `<h3 class="bolum">Piyasa</h3><div class="kutu">${metrikler(null, piyasa, k.gelismislikSkoru, k.mahalle)}</div>`;
    }
    return '';
  }

  const parcalar = [`<h3 class="bolum">🏷️ Satışta</h3><div class="kutu ilan-kutu">`];
  parcalar.push(metrikler(ilan, piyasa, k.gelismislikSkoru, k.mahalle));
  parcalar.push(`<p class="kucuk">Satıcı <b>${esc(ilan.satici.ad)}</b>${ilan.satici.npc ? ' (demo komşu)' : ''} ·
    Alıcı koşulu: ${esc(ilan.kosul.ad)} · Bitişe <span data-bitis="${ilan.bitis}">${sure(ilan.bitis - sunucuSimdi())}</span></p>`);
  parcalar.push(`<details class="acilir" open><summary>Devir kapsamı</summary>${devirKapsami(ilan.guncelVarliklar)}
    <p class="kucuk">Parsel; üzerindeki yapılar ve ekinle birlikte devredilir. İşlem masrafı (%${Math.round(ilan.ucretOrani * 100)}) satıcıdan kesilir.</p></details>`);

  if (ilan.satici.ben) {
    parcalar.push(saticiBolumu(ilan));
  } else if (!ben) {
    parcalar.push('<button class="dugme birincil genis" data-eylem="giris-ac">Teklif vermek için ücretsiz başla</button>');
  } else if (ilan.aliciEngeli) {
    parcalar.push(`<p class="sebep">Bu ilana teklif veremezsin: ${esc(ilan.aliciEngeli)}</p>`);
  } else {
    parcalar.push(aliciBolumu(ilan, ben));
  }
  parcalar.push(gecmisListesi(ilan.gecmis));
  parcalar.push('<p class="kucuk dolandirici-uyari">🛡️ Tüm işlemler oyun içinde akçe ile yapılır. Oyun dışı ödeme (havale, IBAN, kart) isteyen kişilere itibar etme ve bildir.</p>');
  parcalar.push('</div>');
  return parcalar.join('');
}

function aliciBolumu(ilan, ben) {
  const mevcut = ilan.benimTeklifim;
  const kullanilabilir = ben.bakiye + (mevcut?.tutar || 0);
  const yetmez = ben.bakiye < ilan.fiyat - (mevcut?.tutar || 0);
  return `<div class="alici-eylem">
    ${mevcut ? `<div class="satir aktif-teklif"><span>🔒 Aktif teklifin <b>${akce(mevcut.tutar)}</b></span>
      <button class="bag" data-eylem="teklif-geri" data-ilan="${ilan.id}">Geri çek</button></div>` : ''}
    <form class="teklif-form" data-ilan="${ilan.id}">
      <label class="kucuk" for="teklifTutar">${mevcut ? 'Teklifini yükselt' : 'Teklif ver'} (istenen fiyatın altında)</label>
      <div class="satir">
        <input id="teklifTutar" name="tutar" type="number" inputmode="numeric" min="${(mevcut?.tutar || 0) + 1}" max="${ilan.fiyat - 1}"
          value="${Math.max((mevcut?.tutar || 0) + 1, Math.min(ilan.fiyat - 1, Math.round(ilan.fiyat * 0.9)))}" required>
        <button class="dugme" type="submit">Teklif ver</button>
      </div>
      <p class="kucuk">Teklif tutarı kabul edilene ya da kapanana kadar kilitlenir; kabul edilmezse iade edilir. Kullanılabilir: ${akce(kullanilabilir)}</p>
    </form>
    <button class="dugme altin genis" data-eylem="hemen-al" data-ilan="${ilan.id}" data-fiyat="${ilan.fiyat}" ${yetmez ? 'disabled' : ''}>
      Hemen al · ${akce(ilan.fiyat)}</button>
    ${yetmez ? '<p class="sebep">Bakiye yetersiz</p>' : ''}
    ${ilan.satici.npc ? '<p class="kucuk">Demo komşu istenen fiyatın %90\'ı ve üstündeki teklifleri hemen kabul eder.</p>' : ''}
  </div>`;
}

function saticiBolumu(ilan) {
  const teklifler = ilan.teklifler || [];
  return `<div class="satici-eylem">
    <h4>Gelen teklifler</h4>
    ${teklifler.length ? `<ul class="liste">${teklifler.map((t) => `
      <li class="liste-oge"><div class="govde"><b>${akce(t.tutar)}</b><span class="kucuk">${esc(t.kim)} · ${zamanMs(t.zaman)} · eline geçecek ${akce(t.net)}</span></div>
        <button class="dugme ince birincil" data-eylem="teklif-kabul" data-teklif="${t.id}" data-tutar="${t.tutar}">Kabul et</button>
        <button class="dugme ince" data-eylem="teklif-red" data-teklif="${t.id}">Reddet</button></li>`).join('')}</ul>`
      : '<p class="kucuk">Henüz teklif yok.</p>'}
    <form class="fiyat-form satir" data-ilan="${ilan.id}" style="margin-top:12px">
      <label class="kucuk" for="yeniFiyat">İstenen fiyat</label>
      <input id="yeniFiyat" name="fiyat" type="number" min="1" value="${ilan.fiyat}" required>
      <button class="dugme ince" type="submit">Güncelle</button>
    </form>
    <p class="kucuk">Satarsan eline geçecek: ${akce(ilan.net)} (masraf ${akce(ilan.ucret)})</p>
    <button class="bag tehlike" data-eylem="ilan-iptal" data-ilan="${ilan.id}">İlanı kaldır</button>
  </div>`;
}

function ilanAcFormu(k, piyasa, kurallar) {
  const pz = kurallar.pazar;
  return `<h3 class="bolum">Pazar</h3><div class="kutu">
    ${metrikler(null, piyasa, k.gelismislikSkoru, k.mahalle)}
    <details class="acilir"><summary><b>İlana çıkar</b></summary>
    <form class="ilan-form" style="margin-top:10px">
      <label class="alan">İstenen fiyat (₳)
        <input name="fiyat" type="number" inputmode="numeric" min="1" max="${pz.maxFiyat}" required placeholder="ör. 250">
      </label>
      <div class="iki-sutun">
        <label class="alan">Süre
          <select name="gun">${pz.ilanSureleri.map((g) => `<option value="${g}" ${g === 3 ? 'selected' : ''}>${g} gün</option>`).join('')}</select>
        </label>
        <label class="alan">Alıcı koşulu
          <select name="kosul">${Object.entries(pz.aliciKosullari).map(([kod, ad]) => `<option value="${kod}">${esc(ad)}</option>`).join('')}</select>
        </label>
      </div>
      <p class="kucuk" data-net>İşlem masrafı %${Math.round(pz.ucretOrani * 100)} (en az ${akce(pz.minUcret)}) satıştan kesilir.</p>
      <button class="dugme birincil genis" type="submit">İlanı yayınla</button>
      <p class="kucuk">İlandayken parselini kullanmaya devam edebilirsin. Satılırsa yapılar ve ekin alıcıya geçer.</p>
    </form></details>
  </div>`;
}

export function netOnizleme(form, kurallar) {
  const fiyat = Number(form.fiyat.value);
  const el = form.querySelector('[data-net]');
  if (!el || !Number.isInteger(fiyat) || fiyat < 1) return;
  const ucret = Math.max(kurallar.pazar.minUcret, Math.floor(fiyat * kurallar.pazar.ucretOrani));
  el.textContent = `Satılırsa eline geçecek: ${akce(Math.max(0, fiyat - ucret))} (işlem masrafı ${akce(ucret)})`;
}

// ---------- Pazar sekmesi ----------
export async function pazarPaneli({ ben, alt, filtre, bolgeler, kurallar, envanterHTML, sunucuSimdi }) {
  const sekmeler = [['ilanlar', 'Parsel ilanları'], ['benim', 'Benim pazarım'], ['borsa', 'Ürün borsası'], ['sevkiyat', 'Sevkiyat'], ['kiralik', 'Kiralık tarla'], ['islemler', 'Son işlemler'], ['urun', 'Tüccara sat']];
  const gelen = ben?.pazar?.gelenTeklif || 0;
  const ust = `<h2 class="kart-baslik">Türkiye Pazarı</h2>
    <div class="segment" role="tablist">${sekmeler.map(([k, ad]) => `<button type="button" data-eylem="pazar-alt" data-alt="${k}" aria-selected="${alt === k}">
      ${ad}${k === 'benim' && gelen ? ` <span class="rozet">${gelen}</span>` : ''}</button>`).join('')}</div>`;
  let govde;
  if (alt === 'benim') govde = ben ? await benimPazarim(sunucuSimdi) : '<p class="kucuk">Giriş yaptığında ilanların ve tekliflerin burada görünür.</p>';
  else if (alt === 'islemler') govde = await islemler();
  else if (alt === 'urun') govde = await urunPazari(ben, envanterHTML);
  else if (alt === 'borsa') govde = await borsaPaneli(ben, sunucuSimdi);
  else if (alt === 'sevkiyat') govde = await sevkiyatPaneli(ben, bolgeler, kurallar, sunucuSimdi);
  else if (alt === 'kiralik') govde = await kiralikPaneli(ben);
  else govde = await ilanListesi(filtre, bolgeler, kurallar, sunucuSimdi);
  return ust + govde;
}

async function ilanListesi(filtre, bolgeler, kurallar, sunucuSimdi) {
  const qs = new URLSearchParams(Object.entries(filtre).filter(([, v]) => v));
  const ilanlar = await api(`/api/ilanlar?${qs}`);
  const iller = bolgeler.filter((b) => b.type === 'IL').sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  const secim = (ad, secenekler, deger) => `<select data-filtre="${ad}" aria-label="${ad}">${secenekler.map(([v, t]) => `<option value="${esc(v)}" ${String(deger || '') === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  const filtreler = `<div class="filtreler">
    ${secim('il', [['', 'Tüm Türkiye'], ...iller.map((m) => [m.id, m.name])], filtre.il)}
    ${secim('imar', [['', 'Tüm imar türleri'], ...Object.entries(kurallar.imar).filter(([, v]) => v.satilik).map(([k, v]) => [k, v.ad])], filtre.imar)}
    ${secim('sirala', [['yeni', 'En yeni'], ['ucuz', 'En düşük fiyat'], ['pahali', 'En yüksek fiyat'], ['m2', 'En düşük ₳/m²'], ['bitis', 'Bitişi yakın']], filtre.sirala)}
  </div>`;
  if (!ilanlar.length) return `${filtreler}<div class="bos-durum"><div class="buyuk-ikon">🏷️</div><h3>Bu filtrede ilan yok</h3><p>Kendi parselini kartından ilana çıkarabilirsin.</p></div>`;
  return `${filtreler}<ul class="liste">${ilanlar.map((i) => `
    <li><button type="button" class="liste-oge" data-eylem="git" data-id="${esc(i.parsel)}">
      <span class="ikon">${IMAR_IKON[i.imar] || '📍'}</span>
      <span class="govde"><b>${esc(i.mahalle)} · ${sayi(i.alan)} m²</b>
        <span class="kucuk">${esc(i.ilce)}, ${esc(i.il)}</span>
        <span class="kucuk">${esc(kurallar.imar[i.imar].ad)}${i.yapiSayisi ? ` · ${i.yapiSayisi} yapı` : ''} · ${esc(i.satici.ad)}${i.satici.npc ? ' (demo)' : ''}${i.satici.ben ? ' (sen)' : ''}</span>
        <span class="kucuk">⏳ <span data-bitis="${i.bitis}">${sure(i.bitis - sunucuSimdi())}</span></span></span>
      <span class="sag"><b>${akce(i.fiyat)}</b><span class="kucuk">${akce(i.m2Fiyat)}/m²</span>
        <span class="kucuk">${i.enYuksekTeklif != null ? `en yüksek ${akce(i.enYuksekTeklif)}` : 'teklif yok'}</span></span>
    </button></li>`).join('')}</ul>
    <p class="kucuk" style="margin-top:12px">İstenen fiyat satıcının beklentisidir; gerçekleşmiş fiyat ya da değer tahmini değildir.</p>`;
}

async function benimPazarim(sunucuSimdi) {
  const { ilanlarim, tekliflerim, islemlerim } = await api('/api/benim-pazarim');
  const aktifIlanlar = ilanlarim.filter((i) => i.durum === 'ACTIVE');
  const parca = [];
  parca.push(`<h3 class="bolum">İlanlarım</h3>${ilanlarim.length ? `<ul class="liste">${ilanlarim.map((i) => `
    <li><button type="button" class="liste-oge" data-eylem="git" data-id="${esc(i.parsel)}">
      <span class="govde"><b>${esc(i.mahalle)} · ${sayi(i.alan)} m²</b>
        <span class="kucuk">${esc(i.ilce)}, ${esc(i.il)}</span>
        <span class="kucuk">${durumCipi(ILAN_DURUM[i.durum])} ${i.durum === 'ACTIVE' ? `⏳ <span data-bitis="${i.bitis}">${sure(i.bitis - sunucuSimdi())}</span>` : ''}</span></span>
      <span class="sag"><b>${akce(i.fiyat)}</b>${i.durum === 'ACTIVE' ? `<span class="kucuk ${i.teklifSayisi ? 'vurgu' : ''}">${i.teklifSayisi} teklif${i.enYuksekTeklif != null ? ` · en yüksek ${akce(i.enYuksekTeklif)}` : ''}</span>` : ''}</span>
    </button></li>`).join('')}</ul>` : '<p class="kucuk">Henüz ilanın yok. Parsel kartından "İlana çıkar".</p>'}`);
  if (aktifIlanlar.some((i) => i.teklifSayisi)) parca.push('<p class="kucuk">Teklifleri kabul etmek ya da reddetmek için ilana dokun.</p>');

  parca.push(`<h3 class="bolum">Tekliflerim</h3>${tekliflerim.length ? `<ul class="liste">${tekliflerim.map((t) => `
    <li class="liste-oge">
      <button type="button" class="govde bag-dugme" data-eylem="git" data-id="${esc(t.parcel_id)}"><b>${esc(t.mahalle)}, ${esc(t.ilce)} · ${akce(t.amount)}</b>
        <span class="kucuk">İstenen ${akce(t.asking_price)} · ${durumCipi(TEKLIF_DURUM[t.status] || [t.status, 'notr'])}</span></button>
      ${t.status === 'ACTIVE' ? `<button class="dugme ince" data-eylem="teklif-geri" data-ilan="${t.ilan}">Geri çek</button>` : ''}
    </li>`).join('')}</ul>` : '<p class="kucuk">Henüz teklif vermedin.</p>'}`);

  parca.push(`<h3 class="bolum">İşlemlerim</h3>${islemlerim.length ? `<table class="tablo">${islemlerim.map((t) => `
    <tr><td>${t.yon === 'ALIS' ? `🟢 Alış · ${esc(t.satici)}` : `🔵 Satış · ${esc(t.alici)}`}<div class="kucuk mono">${esc(t.parcel_id)} · ${zamanMs(t.created_at)}</div></td>
    <td class="${t.yon === 'ALIS' ? 'eksi' : 'arti'}">${t.yon === 'ALIS' ? '−' : '+'}${sayi(t.yon === 'ALIS' ? t.price : t.price - t.fee)}</td></tr>`).join('')}</table>`
    : '<p class="kucuk">Henüz gerçekleşen işlemin yok.</p>'}`);
  return parca.join('');
}

async function islemler() {
  const liste = await api('/api/islemler');
  if (!liste.length) return '<div class="bos-durum"><div class="buyuk-ikon">🤝</div><h3>Henüz işlem yok</h3><p>İlk parsel devri burada görünecek.</p></div>';
  return `<table class="tablo islem-tablo">${liste.map((t) => `
    <tr><td><b>${esc(t.mahalle)}</b> · ${esc(t.ilce)}, ${esc(t.il)} · ${sayi(t.area_m2)} m² ${t.incelemede ? '<span class="durum-cip olumsuz" title="Olağandışı işlem şüphesi; referans fiyata dahil edilmez">incelemede</span>' : ''}
      <div class="kucuk">${esc(t.satici)} → ${esc(t.alici)} · ${t.via === 'BID' ? 'teklif' : 'hemen al'} · ${zamanMs(t.created_at)}</div></td>
    <td><b>${akce(t.price)}</b><div class="kucuk">${akce(t.m2Fiyat)}/m²</div></td></tr>`).join('')}</table>
    <p class="kucuk">İşaretli işlemler (aynı hesaplar arası geri dönüş, tekrarlı işlem, olağandışı fiyat) referans fiyat hesabına alınmaz.</p>`;
}

async function urunPazari(ben, envanterHTML) {
  const pazar = await api('/api/pazar');
  return `<p class="alt-yazi" style="margin-top:12px">NPC tüccar her ürün için günde sınırlı miktar alır. Talep doldukça fiyat düşer.</p>
    <ul class="liste" style="margin-top:12px">${pazar.map((u) => `
      <li class="liste-oge"><span class="ikon">${u.ikon}</span>
        <div class="govde"><b>${esc(u.ad)}</b>
          <div class="cubuk altin"><span style="width:${(u.kalanTalep / u.gunlukTalep) * 100}%"></span></div>
          <span class="kucuk">Kalan günlük talep: ${sayi(u.kalanTalep)} / ${sayi(u.gunlukTalep)}</span></div>
        <div class="sag"><b>${akce(u.fiyat)}</b><div class="kucuk">adet başı</div></div></li>`).join('')}</ul>
    ${ben ? `<h3 class="bolum">Satılabilir ürünlerin</h3>${envanterHTML()}` : ''}`;
}

// ---------- Ürün borsası: emir defteri (alış/satış emirleri, fiyat-zaman önceliği) ----------
const EMIR_DURUM = { ACIK: ['Açık', 'bekliyor'], DOLDU: ['Doldu', 'olumlu'], IPTAL: ['İptal · iade edildi', 'notr'], SURESI_DOLDU: ['Süresi doldu · iade edildi', 'notr'] };
let borsaUrun = 'BUGDAY';
export function borsaUrunSec(kod) { borsaUrun = kod; }
async function borsaPaneli(ben, sunucuSimdi) {
  const b = await api('/api/borsa');
  const u = b.urunler.find((x) => x.kod === borsaUrun) || b.urunler[0];
  const stok = ben?.envanter.find((i) => i.item_id === u.kod)?.miktar || 0;
  const satir = (x, tur) => `<tr class="${tur}"><td>${akce(x.fiyat)}</td><td>${sayi(x.miktar)}</td><td class="kucuk">${x.emir} emir</td></tr>`;
  const enIyiAlis = u.alis[0]?.fiyat, enIyiSatis = u.satis[0]?.fiyat;
  return `<p class="kucuk">Diğer oyuncularla ürün al-sat. Alış emri akçeyi, satış emri ürünü kilitler; eşleşme bekleyen emrin fiyatından olur ve kendi emrinle eşleşmez. Satıcıdan %${b.ucretOrani * 100} işlem ücreti kesilir.</p>
    <div class="segment kucuk-segment">${b.urunler.map((x) => `<button type="button" data-eylem="borsa-urun" data-urun="${x.kod}" aria-selected="${x.kod === u.kod}">${x.ikon} ${esc(x.ad)}</button>`).join('')}</div>
    <dl class="metrikler">
      <div><dt>En iyi alış</dt><dd>${enIyiAlis != null ? akce(enIyiAlis) : '—'}</dd><small>alıcıların verdiği</small></div>
      <div><dt>En iyi satış</dt><dd>${enIyiSatis != null ? akce(enIyiSatis) : '—'}</dd><small>satıcıların istediği</small></div>
      <div><dt>Son işlem</dt><dd>${u.sonIslemler[0] ? akce(u.sonIslemler[0].fiyat) : '—'}</dd><small>24 saatte ${sayi(u.hacim24)} adet</small></div>
      <div><dt>Tüccar fiyatı</dt><dd>${akce(u.npcFiyat)}</dd><small>günlük sınırlı NPC alımı</small></div>
    </dl>
    <div class="defter">
      <table aria-label="Satış emirleri"><thead><tr><th>Satış ₳</th><th>Adet</th><th></th></tr></thead><tbody>${[...u.satis].reverse().map((x) => satir(x, 'satis')).join('') || '<tr><td colspan="3" class="kucuk">Satış emri yok</td></tr>'}</tbody></table>
      <table aria-label="Alış emirleri"><thead><tr><th>Alış ₳</th><th>Adet</th><th></th></tr></thead><tbody>${u.alis.map((x) => satir(x, 'alis')).join('') || '<tr><td colspan="3" class="kucuk">Alış emri yok</td></tr>'}</tbody></table>
    </div>
    ${ben ? `<form class="form emir-form kutu">
      <input type="hidden" name="urun" value="${u.kod}">
      <div class="segment" role="radiogroup"><label class="radyo"><input type="radio" name="yon" value="AL" checked> Al</label><label class="radyo"><input type="radio" name="yon" value="SAT" ${stok ? '' : 'disabled'}> Sat <span class="kucuk">(${sayi(stok)} stok)</span></label></div>
      <div class="iki-sutun"><label>Birim fiyat (₳)<input name="fiyat" type="number" step="0.01" min="${u.bant.alt}" max="${u.bant.ust}" value="${enIyiSatis ?? u.npcFiyat}" required></label>
      <label>Adet<input name="miktar" type="number" min="1" max="10000" value="10" required></label></div>
      <label>Süre<select name="gun">${b.sureler.map((g) => `<option value="${g}" ${g === 3 ? 'selected' : ''}>${g} gün</option>`).join('')}</select></label>
      <button class="dugme birincil">Emri ver</button>
      <p class="kucuk">Fiyat bandı ₳${u.bant.alt}–₳${u.bant.ust}. En az ${akce(b.minTutar)} tutarında emir. Pazar, seçim ve borsa işlemleri doğrulanmış e-posta ister.</p>
    </form>` : '<p class="kucuk">Emir vermek için giriş yap.</p>'}
    ${b.emirlerim.length ? `<h3 class="bolum">Emirlerim</h3><ul class="liste">${b.emirlerim.map((e) => `<li class="liste-oge">
      <span class="ikon">${e.yon === 'AL' ? '🟢' : '🔴'}</span>
      <div class="govde"><b>${e.yon === 'AL' ? 'Alış' : 'Satış'} · ${esc(b.urunler.find((x) => x.kod === e.urun)?.ad || e.urun)}</b>
        <span class="kucuk">${sayi(e.miktar - e.kalan)}/${sayi(e.miktar)} doldu · ${akce(e.fiyat)}/adet${e.durum === 'ACIK' ? ` · bitişe <span data-bitis="${e.expires_at}">${sure(e.expires_at - sunucuSimdi())}</span>` : ''}</span></div>
      <div class="sag">${durumCipi(EMIR_DURUM[e.durum])}${e.durum === 'ACIK' ? `<button type="button" class="bag tehlike" data-eylem="emir-iptal" data-id="${e.id}">iptal</button>` : ''}</div></li>`).join('')}</ul>` : ''}`;
}

// ---------- İller arası sevkiyat (lojistik) ----------
async function sevkiyatPaneli(ben, bolgeler, kurallar, sunucuSimdi) {
  const l = await api('/api/lojistik');
  const iller = bolgeler.filter((b) => b.type === 'IL').sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  const env = ben?.envanter || [];
  const form = !ben ? '<p class="kucuk">Sevkiyat için giriş yap.</p>' : !l.kaynakIller.length ? '<p class="kucuk">Sevkiyat yapmak için bir ilde parselin olmalı.</p>'
    : !env.length ? '<p class="kucuk">Gönderecek ürünün yok. Önce hasat et ya da üret.</p>' : `<form class="form sevk-form kutu">
      <div class="iki-sutun"><label>Ürün<select name="urun">${env.map((i) => `<option value="${esc(i.item_id)}">${i.ikon} ${esc(i.ad)} (${sayi(i.miktar)})</option>`).join('')}</select></label>
      <label>Miktar<input name="miktar" type="number" min="1" value="20" required></label></div>
      <div class="iki-sutun"><label>Çıkış ili<select name="kaynak">${l.kaynakIller.map((x) => `<option value="${x.plaka}">${esc(x.name)}${l.limanlar.includes(x.plaka) ? ' ⚓' : ''}</option>`).join('')}</select></label>
      <label>Varış ili<select name="hedef">${iller.map((x) => `<option value="${x.plaka}" ${x.plaka === '34' ? 'selected' : ''}>${esc(x.name)}${l.limanlar.includes(x.plaka) ? ' ⚓' : ''}</option>`).join('')}</select></label></div>
      <label>Taşıma<select name="mod">${Object.entries(l.modlar).map(([k, m]) => `<option value="${k}">${esc(m.ad)}${m.limanGerekli ? ' — yalnızca ⚓ limanlar arası' : ''}</option>`).join('')}</select></label>
      <p class="kucuk sevk-onizleme" aria-live="polite">Önizleme için alanları değiştir.</p>
      <button class="dugme birincil">Yola çıkar</button>
      <p class="kucuk">Varışta ürün o ilin tüccarına satılır; il başına günlük ${sayi(l.ilGunlukTalep)} adetten sonra fiyat düşer. Yöresel ürünler uzak illerde, büyükşehirlerde her ürün daha değerlidir. Fırtına deniz yolunu geciktirir.</p>
    </form>`;
  const liste = l.sevkiyatlarim.length ? `<h3 class="bolum">Sevkiyatlarım</h3><ul class="liste">${l.sevkiyatlarim.map((s) => `<li class="liste-oge"><span class="ikon">${s.mod === 'DENIZ' ? '🚢' : '🚚'}</span>
    <div class="govde"><b>${sayi(s.miktar)} ${s.ikon} ${esc(s.urunAd)}</b><span class="kucuk">${esc(s.kaynak)} → ${esc(s.hedef)} · ${sayi(s.km)} km · nakliye ${akce(s.maliyet)}${s.notlar ? ` · ${esc(s.notlar)}` : ''}</span></div>
    <div class="sag">${s.durum === 'TESLIM' ? `<b>${akce(s.gelir)}</b><span class="kucuk">teslim</span>` : `<span class="kucuk">varışa</span><span data-bitis="${s.varis}">${sure(s.varis - sunucuSimdi())}</span>`}</div></li>`).join('')}</ul>` : '';
  return form + liste;
}
// Sevkiyat formu önizlemesi (sunucu teklifi)
export async function sevkiyatOnizle(form) {
  const v = Object.fromEntries(new FormData(form));
  const el = form.querySelector('.sevk-onizleme');
  try {
    const t = await api(`/api/lojistik/teklif?${new URLSearchParams(v)}`);
    el.textContent = `${t.kaynak} → ${t.hedef}: ${sayi(t.km)} km · nakliye ${akce(t.maliyet)} · yol ${sure(t.sureMs)} · tahmini satış ${akce(t.tahminiGelir)} (il çarpanı ×${t.ilKati})`;
  } catch (e) { el.textContent = e.message; }
}

async function kiralikPaneli(ben) {
  const k = await api('/api/kiraliklar');
  if (!k.length) return '<div class="bos-durum"><div class="buyuk-ikon">🔑</div><h3>Kiralık tarla yok</h3><p>Tarla sahipleri parsel kartından tarlalarını kiraya verebilir.</p></div>';
  return `<p class="kucuk">Kiralayınca süre boyunca ekim, sulama ve hasat sende olur; ürün senin envanterine girer. Bedel peşin ödenir.</p><ul class="liste">${k.map((x) => `
    <li><button type="button" class="liste-oge" data-eylem="git" data-id="${esc(x.parcel_id)}"><span class="ikon">🌾</span>
      <span class="govde"><b>${esc(x.mahalle)}, ${esc(x.il)}</b><span class="kucuk">${sayi(x.area_m2)} m² · ${esc(x.sahip)}</span></span>
      <span class="sag"><b>${akce(x.gunluk)}/gün</b><span class="kucuk">${x.gun} gün · ${akce(x.gunluk * x.gun)}</span></span></button></li>`).join('')}</ul>`;
}
