// Mahalle sekmesi: muhtar, muhtarlık seçimi (adaylık → kampanya → gizli oy → itiraz → sonuç), duyurular, vaat takibi.
// Yalnızca HTML üretir; eylemler app.js'deki data-eylem / form işleyicilerinden geçer.
import { api, esc, sayi, akce, sure, zamanOnce } from './yardimci.js';
import { dilekceBolumu } from './dilekce-ui.js';

const ASAMA_SIRA = ['DUYURU', 'ADAYLIK', 'KAMPANYA', 'OYLAMA', 'ITIRAZ', 'SONUC'];
const VAAT_DURUM = { BEKLIYOR: ['Bekliyor', 'notr'], BASLADI: ['Başladı', 'bekliyor'], TAMAMLANDI: ['Tamamlandı', 'olumlu'], VAZGECILDI: ['Vazgeçildi', 'olumsuz'] };
const SECIM_CIP = { DUYURU: 'bekliyor', ADAYLIK: 'bekliyor', KAMPANYA: 'bekliyor', OYLAMA: 'olumlu', ITIRAZ: 'bekliyor', SONUCLANDI: 'olumlu', IPTAL: 'olumsuz', ADAY_YOK: 'notr' };
const bas = (ad) => esc(ad.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toLocaleUpperCase('tr-TR'));
const zamanMs = (ms) => zamanOnce(new Date(ms).toISOString().replace('T', ' ').slice(0, 19));
const kisaHash = (h) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : '—');

export async function mahallePaneli({ ben, mahalleId, sunucuSimdi, makbuzlar }) {
  const mahallelerim = ben ? await api('/api/mahallelerim').catch(() => []) : [];
  const id = mahalleId || mahallelerim[0]?.id;
  const secici = mahallelerim.length ? `<div class="mahalle-secici">${mahallelerim.map((m) => `
    <button type="button" data-eylem="mahalle-ac" data-id="${m.id}" aria-pressed="${m.id === id}">
      ${m.muhtarim ? '★ ' : ''}${esc(m.ad)}${m.secim ? ' <span class="nokta" title="Seçim var"></span>' : ''}</button>`).join('')}</div>` : '';
  if (!id) {
    return `<h2 class="kart-baslik">Mahalle</h2>
      <div class="bos-durum"><div class="buyuk-ikon">🗳️</div><h3>Bir mahalle seç</h3>
      <p>Bir parsel kartından "Mahalle sayfası"na git ya da haritadaki seçim işaretlerine dokun. Parselin olan mahallelerde seçimlere katılabilirsin.</p></div>`;
  }
  const v = await api(`/api/mahalle/${id}`);
  const p = [secici];
  p.push(`<p class="ust-baslik-kucuk">Mahalle</p>
    <h2 class="kart-baslik">${esc(v.mahalle.ad)}</h2>
    <p class="alt-yazi">${esc(v.mahalle.ilce)} · ${esc(v.mahalle.il)} · ${v.sakinSayisi} oyuncu sakin${v.demoSakin ? ` + ${v.demoSakin} demo sakin` : ''}
      <button type="button" class="bag" data-eylem="yere-git" data-lon="${v.mahalle.merkez[0]}" data-lat="${v.mahalle.merkez[1]}">haritada göster</button></p>`);

  if (v.doldurma && v.demoSakin) {
    p.push(`<p class="kucuk doldurma-notu">🧑‍🌾 Bu mahallede gerçek oyuncu az; oyunun canlandırdığı <b>demo sakinler</b> seçimlere aday ve seçmen olarak katılıyor. Mahallede ${v.minSecmen} gerçek oyuncu olunca yalnızca gerçek oyuncular oy kullanır; demo sakinler de zamanla taşınır.</p>`);
  }

  // Muhtar
  if (v.muhtar) {
    p.push(`<div class="muhtar-karti">
      <span class="avatar altin">${bas(v.muhtar.ad)}</span>
      <div><div class="kucuk">Mahalle muhtarı (oyun içi)</div><b>${esc(v.muhtar.ad)}${v.muhtar.ben ? ' (sen)' : ''}</b>${v.muhtar.demo ? ' <span class="demo-rozet" title="Oyunun canlandırdığı demo sakin">demo</span>' : ''}
        <div class="kucuk">Görev süresinin bitmesine <span data-bitis="${v.muhtar.bitis}">${sure(v.muhtar.bitis - sunucuSimdi())}</span></div></div>
    </div>`);
  } else {
    p.push(`<div class="kutu"><b>Geçici yönetim</b><p class="kucuk" style="margin-bottom:0">Bu mahallenin seçilmiş muhtarı yok. ${esc(v.yeniSecim || 'Seçim takvimi işliyor.')}</p></div>`);
  }

  // Belediye hizmetleri ve muhtarın talebi (Senaryo C)
  p.push(`<div class="satir hizmet-satiri"><span class="kucuk">${v.hizmetler?.length ? `Belediye hizmetleri: ${v.hizmetler.map((h) => `<span title="${esc(h.etki)}">${h.ikon} ${esc(h.ad)}</span>`).join(' · ')}` : 'Henüz belediye hizmeti yok.'}</span>
    <button type="button" class="bag" data-eylem="belediye-ac" data-id="${v.mahalle.ilceId}">🏛️ ${esc(v.mahalle.ilce)} Belediyesi</button></div>`);
  if (v.muhtar?.ben && v.hizmetTurleri) {
    p.push(`<details class="acilir"><summary><b>Belediyeye talep gönder</b> <span class="kucuk">(muhtar)</span></summary>
      <form class="talep-form" data-mahalle="${v.mahalle.id}">
        <select name="tur" aria-label="Hizmet">${Object.entries(v.hizmetTurleri).map(([k, h]) => `<option value="${k}">${h.ikon} ${esc(h.ad)} — ${esc(h.etki)}</option>`).join('')}</select>
        <textarea name="aciklama" rows="2" minlength="10" maxlength="400" required placeholder="Mahallenin ihtiyacını anlat (10–400 karakter)"></textarea>
        <button class="dugme ince" type="submit">Talebi belediyeye ilet</button></form></details>`);
  }
  if (v.secim) p.push(secimBolumu(v.secim, ben, sunucuSimdi, makbuzlar));

  // Duyurular
  if (v.muhtar?.ben || v.duyurular.length) {
    p.push(`<h3 class="bolum">Muhtardan duyurular</h3>`);
    if (v.muhtar?.ben) {
      p.push(`<form class="duyuru-form" data-mahalle="${v.mahalle.id}">
        <textarea name="metin" rows="2" maxlength="400" placeholder="Mahalleye duyurun (en az 5 karakter)" required></textarea>
        <button class="dugme ince birincil" type="submit">Duyur</button></form>`);
    }
    p.push(v.duyurular.length ? `<ul class="duyuru-liste">${v.duyurular.map((d) => `<li><p>${esc(d.metin)}</p><span class="kucuk">${esc(d.ad)} · ${zamanOnce(d.created_at)}${ben ? ` · <button type="button" class="bag sessiz" data-eylem="sikayet" data-tur="DUYURU" data-id="${d.id}" data-baslik="Muhtar duyurusu">bildir</button>` : ''}</span></li>`).join('')}</ul>`
      : '<p class="kucuk">Henüz duyuru yok.</p>');
  }

  p.push(dilekceBolumu({ dilekceler: v.dilekceler, bolgeId: v.mahalle.id, sakin: v.benSakinim, girisli: !!ben, sunucuSimdi,
    hedefler: v.muhtar ? [{ makam: 'MUHTAR', ad: v.muhtar.ad, userId: v.muhtar.userId, ben: v.muhtar.ben }] : [] }));

  p.push(`<div class="kutu gazete"><div class="satir"><b>📰 ${esc(v.mahalle.ad)} Gazetesi</b><button type="button" class="dugme ince" data-eylem="gazete" data-id="${v.mahalle.id}">Bu haftanın sayısı</button></div></div>`);

  // Vaat takibi (§6.2)
  if (v.muhtar?.vaatler.length) {
    p.push(`<h3 class="bolum">Vaat takibi</h3><ul class="liste">${v.muhtar.vaatler.map((x) => `
      <li class="liste-oge vaat"><span class="vaat-no">${x.sira}</span>
        <div class="govde"><b>${esc(x.metin)}</b>${x.aciklama ? `<span class="kucuk">${esc(x.aciklama)}</span>` : ''}</div>
        ${v.muhtar.ben ? `<select data-vaat="${x.id}" aria-label="Vaat durumu">${Object.entries(VAAT_DURUM).map(([k, [ad]]) => `<option value="${k}" ${k === x.durum ? 'selected' : ''}>${ad}</option>`).join('')}</select>`
          : `<span class="durum-cip ${VAAT_DURUM[x.durum][1]}">${VAAT_DURUM[x.durum][0]}</span>`}
      </li>`).join('')}</ul>`);
  }

  if (v.gecmis.length) {
    p.push(`<h3 class="bolum">Geçmiş seçimler</h3><table class="tablo">${v.gecmis.map((g) => `
      <tr><td>${g.asama === 'SONUCLANDI' ? `🏅 ${esc(g.kazanan)} seçildi` : g.asama === 'IPTAL' ? '⚠️ İptal edildi' : '— Aday çıkmadı'}
        ${g.iptal_sebebi ? `<div class="kucuk">${esc(g.iptal_sebebi)}</div>` : ''}</td><td class="kucuk">${zamanMs(g.bitis_at)}</td></tr>`).join('')}</table>`);
  }
  p.push('<p class="kucuk" style="margin-top:18px">Oyun içi seçimdir; gerçek kamu seçimi ya da resmî muhtarlık değildir. Oylar gizlidir: kimin oy kullandığı ile oyların içeriği ayrı tutulur.</p>');
  return p.join('');
}

function adimlar(s, sunucuSimdi) {
  const simdiki = ['SONUCLANDI', 'IPTAL', 'ADAY_YOK'].includes(s.asama) ? 'SONUC' : s.asama;
  const i = ASAMA_SIRA.indexOf(simdiki);
  const sonraki = s.takvim[i + 1];
  return `<ol class="adimlar">${s.takvim.map((a, k) => `<li class="${k < i ? 'gecti' : k === i ? 'simdi' : ''}"><span></span>${esc(a.ad)}</li>`).join('')}</ol>
    ${sonraki && i < 5 ? `<p class="kucuk adim-sure">${esc(s.takvim[i].ad)} aşaması · ${esc(sonraki.ad.toLocaleLowerCase('tr-TR'))} aşamasına <b data-bitis="${sonraki.bas}">${sure(sonraki.bas - sunucuSimdi())}</b></p>` : ''}`;
}

function adayKarti(a, { secilebilir = false, kazanan = false, toplam = 0, grup = 'adayId' } = {}) {
  const yuzde = toplam ? Math.round((a.oy / toplam) * 100) : 0;
  return `<li class="aday-karti ${kazanan ? 'kazanan' : ''} ${a.durum !== 'AKTIF' ? 'pasif' : ''}">
    ${secilebilir ? `<input type="radio" name="${grup}" value="${a.id}" id="aday${a.id}" required>` : ''}
    <label ${secilebilir ? `for="aday${a.id}"` : ''}>
      <span class="avatar">${bas(a.ad)}</span>
      <span class="aday-govde">
        <b>${esc(a.ad)}${a.ben ? ' (sen)' : ''}${kazanan ? ' 🏅' : ''}${a.demo ? ' <span class="demo-rozet" title="Oyunun canlandırdığı demo sakin">demo</span>' : ''}</b>
        <span class="kucuk">İtibar ${a.itibar}${a.butce != null ? ` · tahmini bütçe ${akce(a.butce)}` : ''}${a.durum === 'CEKILDI' ? ' · çekildi' : a.durum === 'DUSTU' ? ' · kütükte yer almadığı için düştü' : ''}</span>
        <span class="manifesto">${esc(a.manifesto)}</span>
        ${a.vaatler.length ? `<ul class="vaatler">${a.vaatler.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${a.oy != null ? `<span class="oy-cubuk"><span style="width:${yuzde}%"></span></span><span class="kucuk"><b>${a.oy}</b> oy · %${yuzde}${kazanan ? ' · koltuk' : ''}</span>` : ''}
      </span>
    </label></li>`;
}

function uygunlukKutusu(u, baslik) {
  return `<div class="kutu uyari"><b>${esc(baslik)}</b><ul class="madde">${u.sebepler.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    <p class="kucuk" style="margin:0">İtibarın ${u.itibar}: görev ${u.itibarParcalari.gorev}×5, parsel ${u.itibarParcalari.parsel}×4, yapı ${u.itibarParcalari.yapi}×3, hasat ${u.itibarParcalari.hasat}×2, işlem ${u.itibarParcalari.islem}×3, hesap günü ${u.itibarParcalari.hesapGunu}×1 · son 30 gün eylem: ${u.etkinlik}</p></div>`;
}

// Muhtarlık (tek makam) ve belediye (başkan + meclis) seçimleri için ortak bölüm
export function secimBolumu(s, ben, sunucuSimdi, makbuzlar) {
  const b = s.ben;
  const makamlar = Object.entries(s.makamlar || { MUHTAR: { ad: 'Muhtar', koltuk: 1 } });
  const cokMakam = makamlar.length > 1;
  const bolgeAd = s.tur === 'BELEDIYE' ? 'İlçede' : 'Mahallede';
  const aktifAdaylar = s.adaylar.filter((a) => a.durum === 'AKTIF');
  const kazananlar = new Set(Object.values(s.sonuc?.kazananlar || {}).flat().concat(s.sonuc?.kazananAdayId ? [s.sonuc.kazananAdayId] : []));
  const p = [`<h3 class="bolum">${esc(s.turAd || 'Muhtarlık')} seçimi <span class="durum-cip ${SECIM_CIP[s.asama]}">${esc(s.asamaAd)}</span></h3><div class="kutu secim-kutu">`];
  p.push(adimlar(s, sunucuSimdi));

  if (s.asama === 'DUYURU') {
    p.push(`<p>Seçim duyuruldu. Adaylık başvuruları yakında açılacak. ${bolgeAd} parseli olan, hesabı ve oyun içi itibarı yeterli her oyuncu ücretsiz aday olabilir${cokMakam ? ` (${makamlar.map(([, m]) => `${m.ad.toLocaleLowerCase('tr-TR')} ${m.koltuk} koltuk`).join(', ')}; bir seçimde tek makama)` : ''}.</p>`);
  }
  if (s.asama === 'ADAYLIK' && ben && b) {
    const uyg = b.makamUygunlugu || (b.adayUygunlugu ? { MUHTAR: b.adayUygunlugu } : {});
    const uygunMakamlar = makamlar.filter(([k]) => uyg[k]?.uygun);
    if (b.aday) p.push(`<p class="olumlu-not">✓ Adaylığın kaydedildi. <button type="button" class="bag tehlike" data-eylem="adaylik-geri" data-secim="${s.id}">Adaylıktan çekil</button></p>`);
    else if (uygunMakamlar.length) {
      p.push(`<details class="acilir" open><summary><b>Aday ol</b> <span class="kucuk">(ücretsiz)</span></summary>
        <form class="aday-form" data-secim="${s.id}">
          ${cokMakam ? `<fieldset class="makam-sec"><legend>Makam</legend>${makamlar.map(([k, m]) => `
            <label class="${uyg[k]?.uygun ? '' : 'pasif'}"><input type="radio" name="makam" value="${k}" ${uyg[k]?.uygun ? '' : 'disabled'} ${k === uygunMakamlar[0][0] ? 'checked' : ''}>
              ${esc(m.ad)} <span class="kucuk">(${m.koltuk} koltuk${uyg[k]?.uygun ? '' : ` · ${esc(uyg[k]?.sebepler[0] || '')}`})</span></label>`).join('')}</fieldset>` : ''}
          <label class="alan">Manifesto <span class="kucuk" data-sayac="manifesto">0/600</span>
            <textarea name="manifesto" rows="4" minlength="20" maxlength="600" required placeholder="${s.tur === 'BELEDIYE' ? 'İlçe' : 'Mahalle'} için ne yapacaksın? (20–600 karakter)"></textarea></label>
          <fieldset class="vaat-alanlari"><legend>Vaatler (en fazla 5; seçilirsen vaat takip ekranında izlenir)</legend>
            ${[1, 2, 3, 4, 5].map((n) => `<input name="vaat" maxlength="120" placeholder="${n}. vaat">`).join('')}</fieldset>
          <label class="alan">Tahmini bütçe (akçe, bilgi amaçlı) <input name="butce" type="number" min="0" max="100000" inputmode="numeric"></label>
          <button class="dugme birincil genis" type="submit">Adaylığımı açıkla</button>
        </form></details>`);
    } else {
      for (const [k, m] of makamlar) if (uyg[k]) p.push(uygunlukKutusu(uyg[k], cokMakam ? `${m.ad} adayı olamazsın` : 'Şu an aday olamazsın'));
    }
  }
  if (['KAMPANYA', 'OYLAMA'].includes(s.asama)) {
    p.push(`<p class="kucuk">Seçmen kütüğü kampanya başında donduruldu: <b>${s.kutukSayisi}</b> seçmen. ${b ? (b.kutukte ? 'Sen kütüktesin.' : 'Sen bu seçimin kütüğünde değilsin.') : ''}</p>`);
  }

  // Oy pusulası: her makam için ayrı bölüm, tek makbuz
  const makamAdaylari = (k) => s.adaylar.filter((a) => a.makam === k);
  if (s.asama === 'OYLAMA' && b?.kutukte && !b.oyKullandi) {
    p.push(`<form class="oy-pusulasi" data-secim="${s.id}" data-makamlar="${makamlar.filter(([k]) => aktifAdaylar.some((a) => a.makam === k)).map(([k]) => k).join(',')}">
      <p class="pusula-baslik">🗳️ Oy pusulası <span class="kucuk">— adaylar sana özel rastgele sırada</span></p>
      ${makamlar.filter(([k]) => aktifAdaylar.some((a) => a.makam === k)).map(([k, m]) => `
        ${cokMakam ? `<p class="pusula-bolum">${esc(m.ad)} <span class="kucuk">· ${m.koltuk} koltuk · bir aday seç</span></p>` : ''}
        <ul class="aday-liste">${aktifAdaylar.filter((a) => a.makam === k).map((a) => adayKarti(a, { secilebilir: true, grup: `oy-${k}` })).join('')}</ul>`).join('')}
      <button class="dugme birincil genis" type="submit">Oyumu gizli olarak kullan</button>
      <p class="kucuk">Oyun hesabınla eşleştirilmeden saklanır. Sana verilecek makbuz yalnızca oyunun sayıma girdiğini kanıtlar, kime verdiğini değil.</p>
    </form>`);
  } else {
    if (s.asama === 'OYLAMA' && b?.oyKullandi) p.push('<p class="olumlu-not">✓ Oyunu kullandın. Oylama bitince sonuçlar açıklanacak.</p>');
    if (s.adaylar.length) {
      for (const [k, m] of makamlar) {
        const liste = makamAdaylari(k);
        if (!liste.length) continue;
        const toplam = s.sonuc?.makamToplam?.[k] ?? s.sonuc?.toplam ?? 0;
        if (cokMakam) p.push(`<p class="pusula-bolum">${esc(m.ad)} <span class="kucuk">· ${m.koltuk} koltuk</span></p>`);
        p.push(`<ul class="aday-liste">${liste.map((a) => adayKarti(a, { kazanan: s.asama === 'SONUCLANDI' && kazananlar.has(a.id), toplam })).join('')}</ul>`);
      }
    } else if (['ADAYLIK', 'KAMPANYA'].includes(s.asama)) p.push('<p class="kucuk">Henüz aday yok.</p>');
  }
  if (b?.aday && s.asama === 'KAMPANYA') p.push(`<button type="button" class="bag tehlike" data-eylem="adaylik-geri" data-secim="${s.id}">Adaylıktan çekil</button>`);

  // Makbuz
  const makbuz = makbuzlar[s.id];
  if (makbuz) {
    p.push(`<div class="makbuz"><span class="kucuk">Oy makbuzun (yalnızca şimdi gösterilir, sakla):</span>
      <code>${esc(makbuz)}</code><button type="button" class="dugme ince" data-eylem="makbuz-kopyala" data-makbuz="${esc(makbuz)}">Kopyala</button></div>`);
  }
  if (s.katilimSayisi != null) {
    p.push(`<p class="kucuk">Katılım: <b>${s.katilimSayisi}</b> / ${s.kutukSayisi} seçmen${s.kutukSayisi ? ` (%${Math.round((s.katilimSayisi / s.kutukSayisi) * 100)})` : ''}</p>`);
  }

  // Sonuç, denetim, itiraz
  if (s.sonuc) {
    const d = s.sonuc.denetim;
    p.push(`<div class="denetim">
      <p class="kucuk"><b>Sayım özeti:</b> <code title="${esc(s.sonuc.ozetHash)}">${kisaHash(s.sonuc.ozetHash)}</code>
        · belirleyici fark ${s.sonuc.marj} oy${s.sonuc.kura ? ' · eşitlik açık kurayla çözüldü' : ''}
        <button type="button" class="bag" data-eylem="yeniden-say" data-secim="${s.id}">Bağımsız yeniden say</button></p>
      ${d.bulgular.length ? `<div class="kutu uyari"><b>Denetim bulguları</b><ul class="madde">${d.bulgular.map((x) => `<li>${esc(x.metin)}</li>`).join('')}</ul>
        <p class="kucuk" style="margin:0">Şüpheli katılım: ${d.supheli}. Oylar gizli olduğundan tek tek ayıklanamaz; şüpheli sayısı belirleyici farkı (${s.sonuc.marj}) değiştirebilecek düzeydeyse seçim yenilenir.</p></div>`
        : '<p class="kucuk">Denetim: olağandışı katılım bulunmadı.</p>'}
      <div class="yeniden-sayim" data-secim="${s.id}"></div>
    </div>`);
  }
  if (s.asama === 'IPTAL') p.push(`<div class="kutu uyari"><b>Seçim iptal edildi</b><p class="kucuk" style="margin:0">${esc(s.iptalSebebi)}</p></div>`);
  if (s.asama === 'ADAY_YOK') p.push(`<p>${cokMakam ? 'Başkan adayı' : 'Aday'} çıkmadı; geçici yönetim sürüyor. Birkaç gün sonra yeni seçim açılır.</p>`);

  if (s.asama === 'ITIRAZ' && b && (b.kutukte || b.aday) && !b.itirazim) {
    p.push(`<details class="acilir"><summary><b>Sonuca itiraz et</b></summary>
      <form class="itiraz-form" data-secim="${s.id}">
        <textarea name="sebep" rows="3" minlength="10" maxlength="500" required placeholder="Gerekçeni yaz (10–500 karakter). İtiraz süresi sonunda yeniden sayım ve denetim bulgularıyla değerlendirilir."></textarea>
        <button class="dugme ince" type="submit">İtirazı gönder</button></form></details>`);
  }
  if (s.itirazlar.length) {
    p.push(`<p class="kucuk"><b>İtirazlar (${s.itirazlar.length})</b></p><ul class="duyuru-liste">${s.itirazlar.map((x) => `
      <li><p>${esc(x.sebep)}</p><span class="kucuk"><span class="durum-cip ${x.durum === 'KABUL' ? 'olumlu' : x.durum === 'RED' ? 'olumsuz' : 'bekliyor'}">${x.durum === 'INCELEMEDE' ? 'İncelemede' : x.durum === 'KABUL' ? 'Kabul' : 'Ret'}</span>
        ${x.yanit ? esc(x.yanit) : ''}</span></li>`).join('')}</ul>`);
  }
  if (['OYLAMA', 'ITIRAZ', 'SONUCLANDI', 'IPTAL'].includes(s.asama)) {
    p.push(`<details class="acilir"><summary>Makbuzumu doğrula</summary>
      <form class="makbuz-form satir" data-secim="${s.id}"><input name="makbuz" maxlength="64" placeholder="Makbuz kodu" required aria-label="Makbuz kodu">
      <button class="dugme ince" type="submit">Doğrula</button></form></details>`);
  }
  p.push('</div>');
  return p.join('');
}

export function yenidenSayimHTML(r) {
  return r.uyumlu
    ? `<p class="olumlu-not">✓ Yeniden sayım ilk sayımla birebir uyumlu (${r.toplam} pusula, özet ${kisaHash(r.yenidenOzet)}).</p>`
    : `<p class="sebep">✗ Yeniden sayım uyuşmadı! Kayıtlı ${kisaHash(r.kayitliOzet)} · yeniden ${kisaHash(r.yenidenOzet)}</p>`;
}

export { sayi };
