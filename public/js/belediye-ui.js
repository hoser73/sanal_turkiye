// Belediye panosu (plan §6.1, §6.3, §6.4): yönetim, seçim, kasa, projeler ve meclis oylaması, talepler, faaliyet panosu.
// Yalnızca HTML üretir; eylemler app.js'deki data-eylem / form işleyicilerinden geçer.
import { api, esc, sayi, akce, sure, zamanOnce, tost } from './yardimci.js';
import { secimBolumu } from './secim-ui.js';
import { dilekceBolumu } from './dilekce-ui.js';

const PROJE_DURUM = { MECLISTE: ['Mecliste', 'bekliyor'], YAPIMDA: ['Yapımda', 'bekliyor'], TAMAMLANDI: ['Hizmette', 'olumlu'], REDDEDILDI: ['Reddedildi', 'olumsuz'] };
const OY_AD = { EVET: 'Evet', HAYIR: 'Hayır', CEKIMSER: 'Çekimser' };
const PANO_METIN = {
  PROJECT_PROPOSED: (a) => `📝 ${esc(a.aktor)} meclise teklif etti: ${esc(a.after?.ad)} (${akce(a.after?.maliyet)})${a.after?.nitelikli ? ' · nitelikli çoğunluk' : ''}`,
  COUNCIL_VOTE: (a) => `🙋 ${esc(a.aktor)} ${esc(a.after?.ad)} için “${OY_AD[a.after?.oy] || a.after?.oy}” oyu verdi`,
  PROJECT_APPROVED: (a) => `✅ Meclis onayladı: ${esc(a.after?.ad)} (${a.after?.evet} evet, ${a.after?.hayir} hayır)`,
  PROJECT_REJECTED: (a) => `✖️ Meclis reddetti: ${esc(a.after?.ad)} — ${esc(a.after?.sebep)}`,
  PROJECT_COMPLETED: (a) => `🏁 Tamamlandı: ${esc(a.after?.ad)}`,
  MUHTAR_REQUEST: (a) => `📨 Muhtar ${esc(a.aktor)} talep etti: ${esc(a.after?.ad)}`,
  REQUEST_CLOSED: (a) => `🗂️ Talep kapatıldı: ${esc(a.after?.gerekce)}`,
  ELECTION_CLOSED: (a) => (a.after?.tur === 'BELEDIYE' ? `🏅 ${esc(a.after?.kazanan)} ${a.after?.ara ? 'ara seçimle ' : ''}belediye başkanı seçildi` : `🏅 ${esc(a.after?.kazanan)} muhtar seçildi`),
  ELECTION_ANNULLED: () => '⚠️ Seçim iptal edildi',
  OFFICE_VACATED: (a) => `🪑 ${esc(MAKAM_AD[a.after?.makam] || 'Bir makam')} boşaldı${a.after?.sebep ? `: ${esc(a.after.sebep)}` : ''}`,
  RECALL_STARTED: (a) => `✍️ ${esc(MAKAM_KISI[a.after?.makam] || 'Makam sahibi')} ${esc(a.after?.hedef || '')} için görevden alma dilekçesi açıldı (${a.after?.esik} imza gerekli)`,
  RECALL_SUCCEEDED: (a) => `📜 Görevden alma dilekçesi eşiği geçti (${a.after?.imza}/${a.after?.esik} imza); ${esc((MAKAM_AD[a.after?.makam] || 'makam').toLocaleLowerCase('tr-TR'))} boşaldı`,
  RECALL_FAILED: (a) => `📜 Görevden alma dilekçesi eşiğe ulaşmadı (${a.after?.imza}/${a.after?.esik} imza)`,
  REFERENDUM_OPENED: (a) => `🗳️ Referandum oylaması açıldı: “${esc(a.after?.soru)}”`,
  REFERENDUM_CLOSED: (a) => `🗳️ Referandum sonuçlandı: “${esc(a.after?.soru)}” → ${a.after?.kazanan ? esc(REF_SONUC[a.after.kazanan] || a.after.kazanan) : 'katılım nisabı sağlanamadı'}`,
};
const MAKAM_AD = { MUHTAR: 'Muhtarlık', BASKAN: 'Belediye başkanlığı', MECLIS: 'Bir meclis üyeliği' };
const MAKAM_KISI = { MUHTAR: 'Muhtar', BASKAN: 'Başkan', MECLIS: 'Meclis üyesi' };
const REF_SONUC = { EVET: 'Evet', HAYIR: 'Hayır', ESIT: 'oylar eşit' };
const panoMetni = (a) => (PANO_METIN[a.action] ? PANO_METIN[a.action](a) : `📌 Yönetim kaydı${a.aktor ? ` · ${esc(a.aktor)}` : ''}`);
const yuzde = (x) => `%${Math.round(x * 100)}`;
const sureMetni = (ms) => (ms >= 864e5 && ms % 864e5 === 0 ? `${ms / 864e5} gün` : sure(ms));

// Referandum makbuzu doğrulama (form bu modülde üretilir; işleyici bir kez bağlanır)
if (typeof document !== 'undefined') {
  document.addEventListener('submit', (e) => {
    if (!e.target.matches?.('.ref-makbuz-form')) return;
    e.preventDefault();
    const f = e.target;
    api(`/api/referandum/${f.dataset.ref}/makbuz`, { makbuz: f.makbuz.value.trim() })
      .then((r) => tost(r.dahil ? '✓ Bu makbuzun oyu sayıma dahil' : '✗ Bu makbuz bu referandumda bulunamadı', r.dahil ? '' : 'hata'))
      .catch((x) => tost(x.message, 'hata'));
  });
}
const bas = (ad) => esc(ad.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toLocaleUpperCase('tr-TR'));

export async function belediyePaneli({ ben, belediyeId, sunucuSimdi, makbuzlar, taslak }) {
  const belediyelerim = ben ? await api('/api/belediyelerim').catch(() => []) : [];
  const id = belediyeId || belediyelerim[0]?.id;
  const secici = belediyelerim.length ? `<div class="mahalle-secici">${belediyelerim.map((m) => `
    <button type="button" data-eylem="belediye-ac" data-id="${m.id}" aria-pressed="${m.id === id}">
      ${m.makam === 'BASKAN' ? '★ ' : m.makam === 'MECLIS' ? '☆ ' : ''}${esc(m.ad)}${m.secim ? ' <span class="nokta" title="Seçim var"></span>' : ''}</button>`).join('')}</div>` : '';
  if (!id) {
    return `<div class="bos-durum"><div class="buyuk-ikon">🏛️</div><h3>Bir belediye seç</h3>
      <p>Parsel kartındaki ya da mahalle sayfasındaki belediye bağlantısını kullan. Parselin olan ilçelerde yerel seçimlere katılabilirsin.</p></div>`;
  }
  const v = await api(`/api/belediye/${id}`);
  const p = [secici];
  p.push(`<p class="ust-baslik-kucuk">İlçe belediyesi (oyun içi)</p>
    <h2 class="kart-baslik">${esc(v.ilce.ad)} Belediyesi</h2>
    <p class="alt-yazi">${esc(v.ilce.il)} <span class="plaka">${esc(v.ilce.plaka)}</span> · ${v.sakinSayisi} oyuncu sakin
      <button type="button" class="bag" data-eylem="yere-git" data-lon="${v.ilce.merkez[0]}" data-lat="${v.ilce.merkez[1]}" data-zoom="12.5">haritada göster</button></p>`);

  // Yönetim
  if (v.baskan) {
    p.push(`<div class="muhtar-karti">
      <span class="avatar altin">${bas(v.baskan.ad)}</span>
      <div><div class="kucuk">Belediye başkanı · meclis başkanı</div><b>${esc(v.baskan.ad)}${v.baskan.ben ? ' (sen)' : ''}</b>${v.baskan.demo ? ' <span class="demo-rozet" title="Oyunun canlandırdığı demo sakin">demo</span>' : ''}
        <div class="kucuk">Görev süresinin bitmesine <span data-bitis="${v.baskan.bitis}">${sure(v.baskan.bitis - sunucuSimdi())}</span></div></div></div>
      <div class="meclis-sirasi">${v.meclis.length ? v.meclis.map((m) => `<span class="meclis-uye" title="Meclis üyesi"><span class="avatar">${bas(m.ad)}</span>${esc(m.ad)}${m.ben ? ' (sen)' : ''}${m.demo ? ' <span class="demo-rozet" title="Oyunun canlandırdığı demo sakin">demo</span>' : ''}</span>`).join('')
        : '<span class="kucuk">Mecliste seçilmiş üye yok; kararları başkan tek başına alır.</span>'}</div>`);
    if (v.baskan.vaatler.length) {
      p.push(`<details class="acilir"><summary>Başkanın vaatleri (${v.baskan.vaatler.length})</summary><ul class="madde">${v.baskan.vaatler.map((x) => `<li>${esc(x.metin)}</li>`).join('')}</ul></details>`);
    }
  } else if (v.meclis.length) {
    p.push(`<div class="kutu"><b>Başkanlık boş</b><p class="kucuk" style="margin-bottom:0">Meclis görevde; başkanlık için ara seçim yapılır. Başkan seçilene dek yeni proje teklif edilemez. ${esc(v.yeniSecim || '')}</p></div>
      <div class="meclis-sirasi">${v.meclis.map((m) => `<span class="meclis-uye" title="Meclis üyesi"><span class="avatar">${bas(m.ad)}</span>${esc(m.ad)}${m.ben ? ' (sen)' : ''}${m.demo ? ' <span class="demo-rozet" title="Oyunun canlandırdığı demo sakin">demo</span>' : ''}</span>`).join('')}</div>`);
  } else {
    p.push(`<div class="kutu"><b>Geçici yönetim</b><p class="kucuk" style="margin-bottom:0">Seçilmiş başkan ve meclis yok; kasa birikir, proje yapılamaz. ${esc(v.yeniSecim || 'Seçim takvimi işliyor.')}</p></div>`);
  }

  if (v.secim) p.push(secimBolumu(v.secim, ben, sunucuSimdi, makbuzlar));

  p.push(dilekceBolumu({ dilekceler: v.dilekceler, bolgeId: v.ilce.id, sakin: !!v.ben?.sakin, girisli: !!ben, sunucuSimdi, kurallar: v.dilekceKurallari,
    hedefler: [v.baskan, ...v.meclis].filter(Boolean).map((u) => ({ makam: u.makam, ad: u.ad, userId: u.userId, ben: u.ben })) }));

  // Referandum (§6.6)
  p.push(referandumBolumu(v, ben, sunucuSimdi));

  // Kasa (§6.3)
  const k = v.kasa;
  const gelirToplam = Object.values(k.gelir).reduce((a, x) => a + x, 0) || 1;
  const RENK = { 'Devlet katkısı': '#0e5e50', 'Tahsis payı': '#d9a21b', 'Ruhsat harcı': '#c8402e', 'Pazar işlem payı': '#7a6bb0', 'Diğer': '#9aa3a8' };
  p.push(`<h3 class="bolum">Belediye kasası</h3><div class="kutu kasa">
    <div class="satir"><div><div class="kucuk">Kasadaki akçe</div><div class="fiyat">${akce(k.bakiye)}</div></div>
      <dl class="kasa-ozet"><div><dt>Meclis gündeminde</dt><dd>${akce(k.gundemde)}</dd></div><div><dt>Yapımda (emanet)</dt><dd>${akce(k.emanette)}</dd></div><div><dt>Harcanan</dt><dd>${akce(k.harcanan)}</dd></div></dl></div>
    ${Object.keys(k.gelir).length ? `<div class="gelir-cubuk">${Object.entries(k.gelir).map(([ad, x]) => `<span style="width:${(x / gelirToplam) * 100}%;background:${RENK[ad] || RENK['Diğer']}" title="${esc(ad)}: ${akce(x)}"></span>`).join('')}</div>
      <ul class="gelir-lejant">${Object.entries(k.gelir).map(([ad, x]) => `<li><span style="background:${RENK[ad] || RENK['Diğer']}"></span>${esc(ad)} <b>${akce(x)}</b></li>`).join('')}</ul>` : '<p class="kucuk">Henüz gelir yok.</p>'}
    <p class="kucuk" style="margin-bottom:0">Gelirler kuralla sabittir: tahsis bedelinin %${v.kurallar.gelir.tahsisPayi * 100}'u, ruhsatın %${v.kurallar.gelir.ruhsatPayi * 100}'u, pazar masrafının %${v.kurallar.gelir.islemPayi * 100}'si (oyuncudan ek kesinti yok) ve aktif sakin başına günlük ${akce(v.kurallar.gelir.sakinBasiGunluk)} devlet katkısı.</p>
  </div>`);

  // Proje teklifi (başkan)
  if (v.ben?.baskan) {
    const turler = Object.entries(v.projeTurleri);
    p.push(`<details class="acilir" ${taslak ? 'open' : ''}><summary><b>Meclise proje teklif et</b></summary>
      <form class="proje-form" data-belediye="${v.ilce.id}">
        <label class="alan">Proje <select name="tur">${turler.map(([kod, t]) => `<option value="${kod}" ${taslak?.tur === kod ? 'selected' : ''}>${t.ikon} ${esc(t.ad)} · ${akce(t.maliyet)} · ${sure(t.sureMs)}</option>`).join('')}</select></label>
        <label class="alan">Hedef mahalle <select name="hedefMahalleId">${v.mahalleler.map((m) => `<option value="${m.id}" ${taslak?.mahalleId === m.id ? 'selected' : ''}>${esc(m.ad)} (${m.sakin} sakin)${m.hizmetler.length ? ' · ' + m.hizmetler.map((h) => v.projeTurleri[h].ikon).join('') : ''}</option>`).join('')}</select></label>
        <label class="alan">Gerekçe <textarea name="gerekce" rows="3" minlength="20" maxlength="600" required placeholder="Meclise ve halka açıklama (20–600 karakter)">${esc(taslak?.gerekce || '')}</textarea></label>
        ${taslak?.talepId ? `<input type="hidden" name="talepId" value="${taslak.talepId}"><p class="kucuk">📨 Muhtar talebine bağlı teklif</p>` : ''}
        <p class="kucuk">Etki: <span data-proje-etki>${esc(v.projeTurleri[taslak?.tur || turler[0][0]].etki)}</span>. Kendi parselinin olduğu mahalleye ya da ${akce(v.kurallar.buyukProjeEsigi)} ve üzeri projeye nitelikli çoğunluk (2/3) gerekir; bunun için o mahallede parseli olmayan en az ${v.kurallar.nitelikliMinUye ?? 2} üye gerekir.</p>
        <button class="dugme birincil genis" type="submit">Meclis gündemine al</button>
      </form></details>`);
  }

  // Projeler
  p.push(`<h3 class="bolum">Projeler</h3>${v.projeler.length ? `<ul class="proje-liste">${v.projeler.map((x) => projeKarti(x, sunucuSimdi)).join('')}</ul>` : '<p class="kucuk">Henüz proje yok.</p>'}`);

  // Talepler
  if (v.talepler.length) {
    p.push(`<h3 class="bolum">Muhtar talepleri</h3><ul class="duyuru-liste">${v.talepler.map((t) => `
      <li><p><b>${esc(t.turAd)}</b> · ${esc(t.mahalle)} <span class="durum-cip ${t.durum === 'ACIK' ? 'bekliyor' : t.durum === 'TEKLIFE_DONUSTU' ? 'olumlu' : 'notr'}">${t.durum === 'ACIK' ? 'Açık' : t.durum === 'TEKLIFE_DONUSTU' ? 'Teklife dönüştü' : 'Kapandı'}</span></p>
        <p class="kucuk">“${esc(t.aciklama)}” — Muhtar ${esc(t.muhtar)}, ${zamanOnce(new Date(t.created_at).toISOString().replace('T', ' ').slice(0, 19))}</p>
        ${v.ben?.baskan && t.durum === 'ACIK' ? `<div class="satir" style="justify-content:flex-start;gap:12px">
          <button type="button" class="dugme ince" data-eylem="talep-teklif" data-talep="${t.id}" data-tur="${t.tur}" data-mahalle="${t.mahalle_id}">Teklife dönüştür</button>
          <button type="button" class="bag" data-eylem="talep-kapat" data-talep="${t.id}">Gerekçeyle kapat</button></div>` : ''}</li>`).join('')}</ul>`);
  }

  // Mahalle hizmetleri
  const hizmetli = v.mahalleler.filter((m) => m.hizmetler.length);
  if (hizmetli.length) {
    p.push(`<h3 class="bolum">Mahallelerdeki hizmetler</h3><ul class="liste">${hizmetli.map((m) => `
      <li><button type="button" class="liste-oge" data-eylem="mahalle-ac" data-id="${m.id}"><span class="govde"><b>${esc(m.ad)}</b>
        <span class="kucuk">${m.hizmetler.map((h) => `${v.projeTurleri[h].ikon} ${esc(v.projeTurleri[h].ad)}`).join(' · ')}</span></span></button></li>`).join('')}</ul>`);
  }

  // Faaliyet panosu (§6.4)
  p.push(`<h3 class="bolum">Faaliyet panosu</h3>${v.pano.length ? `<ul class="zaman-cizgisi">${v.pano.map((a) => `
    <li><span>${panoMetni(a)} <span class="kucuk">· ${esc(a.bolge || '')}</span></span><time>${zamanOnce(a.created_at)}</time></li>`).join('')}</ul>` : '<p class="kucuk">Henüz idari karar yok.</p>'}`);

  if (v.gecmis.length) {
    p.push(`<h3 class="bolum">Geçmiş seçimler</h3><table class="tablo">${v.gecmis.map((g) => `
      <tr><td>${g.asama === 'SONUCLANDI' ? `🏅 ${esc(g.kazanan)} başkan seçildi` : g.asama === 'IPTAL' ? '⚠️ İptal edildi' : '— Aday çıkmadı'}
        ${g.iptal_sebebi ? `<div class="kucuk">${esc(g.iptal_sebebi)}</div>` : ''}</td><td class="kucuk">${zamanOnce(new Date(g.bitis_at).toISOString().replace('T', ' ').slice(0, 19))}</td></tr>`).join('')}</table>`);
  }
  p.push(`<div class="kutu yetki"><b>Yetki sınırları</b><ul class="madde">
    <li>Başkan para basamaz, gelir oranlarını değiştiremez; gelirler kuralla sabittir.</li>
    <li>Kimsenin parselini silemez, kendi parseline özel imar ya da ayrıcalık tanıyamaz.</li>
    <li>Projeler meclis kararıyla başlar; hedef mahallede parseli olan üye oy kullanamaz, başkanın çıkarı varsa nitelikli çoğunluk gerekir.</li>
    <li>Bütçe onayla emanete ayrılır, tamamlanınca harcanır; tüm hareketler bu panoda açıktır.</li>
  </ul></div>`);
  p.push('<p class="kucuk">Oyun içi yerel yönetimdir; gerçek belediye, resmî unvan ya da kamu kurumu değildir.</p>');
  return p.join('');
}

function projeKarti(x, sunucuSimdi) {
  const [durumAd, durumTur] = PROJE_DURUM[x.durum];
  const oylar = x.oylar.length ? `<div class="oy-ciplar">${x.oylar.map((o) => `<span class="oy-cip ${o.oy.toLowerCase()}">${esc(o.ad)}: ${OY_AD[o.oy]}</span>`).join('')}</div>` : '';
  const ilerleme = x.durum === 'YAPIMDA' ? Math.min(1, (sunucuSimdi() - x.yapimBas) / (x.yapimBitis - x.yapimBas)) : 0;
  return `<li class="proje-karti ${x.durum.toLowerCase()}">
    <div class="satir"><span class="proje-ikon">${x.ikon}</span>
      <div class="govde"><b>${esc(x.ad)}</b> <span class="kucuk">· ${esc(x.mahalle)}</span>
        <div class="kucuk">${akce(x.maliyet)} · teklif: ${esc(x.teklifEden)}${x.nitelikli ? ` · <b>nitelikli çoğunluk</b> (${esc(x.nitelikliSebep)})` : ''}</div></div>
      <span class="durum-cip ${durumTur}">${durumAd}</span></div>
    <p class="manifesto">${esc(x.gerekce)}</p>
    <p class="kucuk">Etki: ${esc(x.etki)}</p>
    ${x.durum === 'MECLISTE' ? `<p class="kucuk">Oylamanın bitmesine <b data-bitis="${x.oylamaBitis}">${sure(x.oylamaBitis - sunucuSimdi())}</b></p>` : ''}
    ${oylar}
    ${x.ben.oyKullanabilir ? `<div class="meclis-oy" role="group" aria-label="Meclis oyu">${['EVET', 'HAYIR', 'CEKIMSER'].map((o) => `
      <button type="button" class="dugme ince ${x.ben.oyum === o ? 'birincil' : ''}" data-eylem="meclis-oy" data-proje="${x.id}" data-oy="${o}">${OY_AD[o]}</button>`).join('')}
      <span class="kucuk">Meclis oyu açıktır; karar süresi sonunda kayda geçer.</span></div>`
      : x.durum === 'MECLISTE' && x.ben.uye && x.ben.cikarli ? '<p class="sebep">Çıkar çatışması: bu mahallede parselin var; bu kararda oy kullanamazsın.</p>' : ''}
    ${x.durum === 'YAPIMDA' ? `<div class="cubuk"><span data-ilerleme-bas="${x.yapimBas}" data-ilerleme-son="${x.yapimBitis}" style="width:${ilerleme * 100}%"></span></div>
      <p class="kucuk">Tamamlanmasına <span data-bitis="${x.yapimBitis}">${sure(x.yapimBitis - sunucuSimdi())}</span> · bütçe emanette</p>` : ''}
    ${x.karar ? `<p class="kucuk karar">⚖️ ${esc(x.karar.sebep)}${x.karar.cekimser ? ` · ${x.karar.cekimser} çekimser` : ''} · toplantı yeter sayısı ${x.karar.yeter} (oy kullanabilen ${x.karar.uygun} üye)${x.karar.cikarli.length ? ` · çıkarı nedeniyle oy kullanamayan: ${x.karar.cikarli.map(esc).join(', ')}` : ''}</p>` : ''}
  </li>`;
}

export { sayi };

const REF_DURUM = { IMZA: 'imza topluyor', OYLAMA: 'oylamada', SONUCLANDI: 'sonuçlandı', NISAP_YOK: 'katılım nisabı sağlanamadı', DUSTU: 'düştü' };
function referandumBolumu(v, ben, sunucuSimdi) {
  const liste = v.referandumlar || [];
  const sakin = !!v.ben?.sakin;
  const rk = v.kurallar?.referandum || { imzaOrani: 0.25, sureMs: 3 * 864e5, nisapOrani: 0.3 };
  if (!liste.length && !(ben && sakin)) return '';
  const p = ['<h3 class="bolum">Referandum</h3>'];
  for (const r of liste) {
    const s = r.sonuc;
    p.push(`<div class="kutu referandum"><div class="satir"><b>“${esc(r.soru)}”</b><span class="cip">${esc(REF_DURUM[r.durum])}</span></div>
      ${r.aciklama ? `<p class="kucuk">${esc(r.aciklama)}</p>` : ''}<p class="kucuk">Öneren: ${esc(r.baslatan)}</p>
      ${r.durum === 'IMZA' ? `<p class="kucuk">${r.imza}/${r.esik} imza</p>${ben && r.ben?.imzaHakki && !r.ben.imzaladim ? `<button class="dugme ince" data-eylem="ref-imza" data-id="${r.id}">✍️ İmzala</button>` : ''}` : ''}
      ${r.durum === 'OYLAMA' ? `<p class="kucuk">Kapanışa <span data-bitis="${r.oylamaBitis}">${sure(r.oylamaBitis - sunucuSimdi())}</span> · gizli oy</p>
        ${r.ben?.oyKullandim ? '<p class="kucuk">✓ Oyunu kullandın</p>' : ben && r.ben?.kutukte ? `<div class="satir-dugmeler"><button class="dugme ince birincil" data-eylem="ref-oy" data-id="${r.id}" data-oy="EVET">Evet</button>
          <button class="dugme ince" data-eylem="ref-oy" data-id="${r.id}" data-oy="HAYIR">Hayır</button></div>`
          : ben ? '<p class="kucuk">Oylama açıldığında bu ilçenin seçmen kütüğünde değildin; oy kullanamazsın.</p>' : ''}` : ''}
      ${s ? `<div class="ref-sonuc"><span style="flex:${s.oylar.EVET || 0.001}" class="evet">Evet ${s.oylar.EVET}</span><span style="flex:${s.oylar.HAYIR || 0.001}" class="hayir">Hayır ${s.oylar.HAYIR}</span></div>
        <p class="kucuk">Katılım ${s.katilim}/${s.kutuk} · nisap ${s.nisap} · ${s.kazanan ? `sonuç: <b>${esc(REF_SONUC[s.kazanan] || s.kazanan)}</b>` : 'nisap sağlanamadı'} · danışma niteliğindedir</p>` : ''}
      ${['OYLAMA', 'SONUCLANDI', 'NISAP_YOK'].includes(r.durum) ? `<details class="acilir"><summary>Makbuzumu doğrula</summary>
        <form class="ref-makbuz-form satir" data-ref="${r.id}"><input name="makbuz" maxlength="64" placeholder="Makbuz kodu" required aria-label="Makbuz kodu">
        <button class="dugme ince" type="submit">Doğrula</button></form></details>` : ''}
    </div>`);
  }
  if (ben && sakin && !liste.some((r) => ['IMZA', 'OYLAMA'].includes(r.durum))) {
    p.push(`<details class="acilir"><summary>Referandum öner</summary><form class="form ref-form" data-ilce="${v.ilce.id}">
      <label>Soru (evet/hayır, soru işaretiyle)<input name="soru" minlength="15" maxlength="200" required placeholder="İlçeye yeni bir semt pazarı kurulmalı mı?"></label>
      <label>Kısa açıklama<textarea name="aciklama" rows="2" maxlength="600"></textarea></label>
      <button class="dugme ince">Öner</button>
      <p class="kucuk">${v.ben?.baskan ? 'Başkan olarak önerin doğrudan oylamaya açılır.' : `İmza eşiği sakinlerin ${yuzde(rk.imzaOrani)}; eşik aşılınca ${esc(sureMetni(rk.sureMs))} sürecek gizli oylama başlar.`} Katılım nisabı ${yuzde(rk.nisapOrani)}; sonuç danışma niteliğindedir.</p>
    </form></details>`);
  }
  return p.join('');
}
