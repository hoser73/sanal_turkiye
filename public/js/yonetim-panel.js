// Moderasyon ve denetim paneli: şikâyetler, işaretli mesajlar, iki kişi kuralıyla işlemler, ekonomi gözlemi,
// sistem ve sponsorlar. Yalnızca yetkili roller (2FA zorunlu) erişir; tüm kararlar denetim kaydına yazılır.
import { api, esc, zamanOnce, akce } from './yardimci.js';

const $ = (s) => document.querySelector(s);
let veri = null, sekme = 'sikayet', ekonomi = null;
const SEKMELER = { sikayet: 'Şikâyetler', sohbet: 'İşaretli mesajlar', islem: 'İşlemler', ekonomi: 'Ekonomi', sistem: 'Sistem', sponsor: 'Sponsorlar' };
const ms = (t) => (t ? zamanOnce(t) : '—');
const cip = (d) => `<span class="cip ${esc(String(d).toLowerCase())}">${esc(d)}</span>`;
function tost(m, tur = '') {
  const el = Object.assign(document.createElement('div'), { className: `tost ${tur}`, textContent: m });
  document.body.appendChild(el); setTimeout(() => el.remove(), 3500);
}

async function yukle() {
  try { veri = await api('/api/yonetim/panel'); } catch (e) {
    $('#icerik').innerHTML = `<div class="kart"><b>${esc(e.message)}</b><p class="kucuk">${e.kod === 'IKI_ADIM_GEREKLI' ? 'Ana sayfada Hesabım → Güvenlik bölümünden iki adımlı doğrulamayı aç.' : 'Bu sayfa yalnızca moderatör, denetçi ve yöneticilere açıktır.'}</p><a href="/">← Haritaya dön</a></div>`;
    return;
  }
  ciz();
}

function ciz() {
  const o = veri.ozet;
  $('#ben').textContent = veri.ben.rolAd;
  $('#ozet').innerHTML = [
    ['Oyuncu', o.oyuncu], ['Son 24 saatte aktif', o.aktif24], ['Açık şikâyet', o.acikSikayet, o.acikSikayet > 0], ['Onay bekleyen', o.onayBekleyen, o.onayBekleyen > 0],
    ['İşaretli işlem (7 gün)', o.supheliIslem, o.supheliIslem > 0], ['Askıda hesap', o.askida], ['Dondurulmuş parsel', o.donmusParsel],
  ].map(([a, b, d]) => `<div class="karo ${d ? 'dikkat' : ''}"><b>${b}</b><span>${a}</span></div>`).join('');
  const gorunur = Object.entries(SEKMELER).filter(([k]) => k !== 'sponsor' || veri.ben.rol === 'ADMIN');
  $('#sekmeler').innerHTML = gorunur.map(([k, v]) => `<button role="tab" data-sekme="${k}" aria-selected="${k === sekme}">${v}</button>`).join('');
  $('#icerik').innerHTML = ({ sikayet, sohbet, islem, ekonomi: ekonomiCiz, sistem: sistemCiz, sponsor: sponsorCiz })[sekme]();
}

function sikayet() {
  if (!veri.sikayetler.length) return '<div class="kart"><p class="kucuk">Şikâyet yok.</p></div>';
  return `<div class="kart"><table><thead><tr><th>#</th><th>Hedef</th><th>Sebep</th><th>Durum</th><th>Şikâyetçi</th><th>Zaman</th><th></th></tr></thead><tbody>
    ${veri.sikayetler.map((s) => `<tr><td>${s.id}</td>
      <td><b>${esc(s.hedef_tur)}</b> ${esc(s.hedef?.baslik || s.hedef_id)}${s.hedef?.durum ? ` ${cip(s.hedef.durum)}` : ''}
        ${s.aciklama ? `<div class="kucuk">“${esc(s.aciklama)}”</div>` : ''}${s.on_tarama ? `<div class="on-tarama">⚑ Ön tarama: ${esc(s.on_tarama)}</div>` : ''}
        ${s.karar ? `<div class="kucuk">Karar: ${esc(s.karar)}</div>` : ''}</td>
      <td>${esc(s.sebepAd)}</td><td>${cip(s.durum)}</td><td>${esc(s.sikayetci)}</td><td class="kucuk">${ms(s.created_at)}</td>
      <td>${s.durum === 'ACIK' ? `<button class="d" data-k="sikayet-karar" data-id="${s.id}" data-karar="REDDEDILDI">İhlal yok</button>
        <button class="d b" data-k="sikayet-karar" data-id="${s.id}" data-karar="KARARA_BAGLANDI">İşlem yapıldı</button>
        ${oneriDugmeleri(s)}` : ''}</td></tr>`).join('')}</tbody></table></div>`;
}
// Şikâyet hedefine uygun işlem kısayolları (gerekçe sorulur; ağır işlemler ikinci onaya düşer)
function oneriDugmeleri(s) {
  const t = { DUYURU: [['ICERIK_GIZLE', `DUYURU:${s.hedef_id}`]], MESAJ: [['ICERIK_GIZLE', `MESAJ:${s.hedef_id}`]], PARSEL: [['PARSEL_DONDUR', s.hedef_id]], KULLANICI: [['HESAP_ASKI', s.hedef_id]] }[s.hedef_tur] || [];
  return t.map(([tur, hedef]) => `<button class="d t" data-k="oner" data-tur="${tur}" data-hedef="${esc(hedef)}" data-sikayet="${s.id}">${esc(veri.tanimlar.islemler[tur].ad)}</button>`).join(' ');
}

function sohbet() {
  if (!veri.isaretliMesajlar.length) return '<div class="kart"><p class="kucuk">Ön taramada işaretlenen mesaj yok.</p></div>';
  return `<div class="kart"><p class="kucuk">Kural tabanlı ön tarama (ve etkinse yapay zekâ) şüpheli bulduğu mesajları yayımlar ama buraya düşürür. Kişisel veri içerenler zaten yayımlanmaz.</p>
    <table><thead><tr><th>#</th><th>Kanal</th><th>Mesaj</th><th>Ön tarama</th><th>Zaman</th><th></th></tr></thead><tbody>
    ${veri.isaretliMesajlar.map((m) => `<tr><td>${m.id}</td><td class="mono">${esc(m.kanal)}</td><td><b>${esc(m.ad)}:</b> ${esc(m.metin)}</td>
      <td class="on-tarama">${esc(m.on_tarama)}</td><td class="kucuk">${ms(m.created_at)}</td>
      <td><button class="d t" data-k="oner" data-tur="ICERIK_GIZLE" data-hedef="MESAJ:${m.id}">Gizle</button></td></tr>`).join('')}</tbody></table></div>`;
}

function islem() {
  const satir = veri.islemler.map((m) => `<tr><td>${m.id}</td><td><b>${esc(m.ad)}</b><div class="mono">${esc(m.hedef)}</div><div class="kucuk">${esc(m.gerekce)}</div></td>
    <td>${cip(m.durum)}</td><td>${esc(m.oneren)}</td><td>${esc(m.onaylayan || '—')}</td><td class="kucuk">${ms(m.created_at)}</td>
    <td>${m.durum === 'ONAY_BEKLIYOR' ? (m.benOnerdim ? '<span class="kucuk">ikinci onay bekleniyor</span>'
      : `<button class="d b" data-k="islem-karar" data-id="${m.id}" data-onay="1">Onayla</button> <button class="d t" data-k="islem-karar" data-id="${m.id}" data-onay="0">Reddet</button>`) : ''}</td></tr>`).join('');
  return `<div class="kart"><h2 style="margin-top:0">Yeni işlem öner</h2>
    <form class="islem-form" id="islemForm">
      <label>İşlem<select name="tur">${Object.entries(veri.tanimlar.islemler).map(([k, v]) => `<option value="${k}">${esc(v.ad)}${v.ikiKisi ? ' · iki kişi' : ''}${v.denetciGerekli ? ' · denetçi' : ''}</option>`).join('')}</select></label>
      <label>Hedef<input name="hedef" required placeholder="parsel: TR-… · hesap: kullanıcı no · içerik: DUYURU:12"></label>
      <label>Gerekçe (herkese açık kayda geçer)<textarea name="gerekce" rows="2" minlength="10" required></textarea></label>
      <button class="d b">Öner</button></form></div>
    <div class="kart"><table><thead><tr><th>#</th><th>İşlem</th><th>Durum</th><th>Öneren</th><th>Onaylayan</th><th>Zaman</th><th></th></tr></thead><tbody>${satir || '<tr><td colspan="7" class="kucuk">Kayıt yok.</td></tr>'}</tbody></table></div>`;
}

let sistem = null;
function sistemCiz() {
  if (!sistem) {
    Promise.all([api('/api/saglik'), api('/api/yonetim/hatalar').catch(() => []), api('/api/yonetim/yz').catch(() => null)])
      .then(([saglik, hatalar, yz]) => { sistem = { saglik, hatalar, yz }; ciz(); }).catch((e) => { sistem = { hata: e.message }; ciz(); });
    return '<p class="kucuk">Yükleniyor…</p>';
  }
  if (sistem.hata) return `<div class="kart">${esc(sistem.hata)}</div>`;
  const { saglik, hatalar, yz } = sistem;
  return `<div class="karolar"><div class="karo"><b>${esc(saglik.surum)}</b><span>Sürüm</span></div><div class="karo"><b>${Math.round(saglik.calisma / 60)} dk</b><span>Çalışma süresi</span></div>
      <div class="karo"><b>${saglik.bellekMb} MB</b><span>Bellek</span></div><div class="karo"><b>${saglik.canliBaglanti}</b><span>Canlı bağlantı</span></div>
      <div class="karo ${yz?.etkin ? '' : 'dikkat'}"><b>${yz?.etkin ? esc(yz.model) : 'kapalı'}</b><span>Yapay zekâ</span></div></div>
    ${yz?.kullanim24?.length ? `<div class="kart"><h2 style="margin-top:0">Yapay zekâ kullanımı (24 saat)</h2><table><thead><tr><th>İşlev</th><th>Kaynak</th><th>Çağrı</th><th>Girdi token</th><th>Çıktı token</th></tr></thead><tbody>
      ${yz.kullanim24.map((k) => `<tr><td>${esc(k.islev)}</td><td>${esc(k.kaynak)}</td><td>${k.c}</td><td>${k.girdi}</td><td>${k.cikti}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <div class="kart"><h2 style="margin-top:0">Son hatalar</h2>${hatalar.length ? `<table><thead><tr><th>Zaman</th><th>İleti</th><th>Ayrıntı</th></tr></thead><tbody>
      ${hatalar.map((h) => `<tr><td class="kucuk">${esc(h.t || '')}</td><td>${esc(h.ileti)}${h.kaynak ? ` <span class="cip">${esc(h.kaynak)}</span>` : ''}</td>
        <td class="mono">${esc([h.yol, h.hataIletisi || h.hata?.ileti || h.yigin?.split('\n')[0] || ''].filter(Boolean).join(' · ')).slice(0, 200)}</td></tr>`).join('')}</tbody></table>` : '<p class="kucuk">Kayıtlı hata yok. 🎉</p>'}</div>`;
}

// ---------- Sponsorlar (yalnızca yönetici): her işletme türünden tek marka; sözleşme bitince varsayılana döner
let sponsorlar = null;
const tarihStr = (ms) => (ms ? new Date(ms + 3 * 3600e3).toISOString().slice(0, 10) : '');
function sponsorCiz() {
  if (!sponsorlar) {
    api('/api/yonetim/isletmeler').then((x) => { sponsorlar = x; ciz(); }).catch((e) => { sponsorlar = { hata: e.message }; ciz(); });
    return '<p class="kucuk">Yükleniyor…</p>';
  }
  if (sponsorlar.hata) return `<div class="kart"><p class="kucuk">${esc(sponsorlar.hata)}</p></div>`;
  return `<div class="kart"><p class="kucuk" style="margin:0">Oyunda her türden <b>tek işletme</b> vardır. Sponsorluk sözleşmesi imzalanınca markanın adını, logosunu ve renklerini buraya gir;
      "Sponsor" işaretliyken oyunda <b>Sponsor</b> etiketiyle gösterilir (ticari reklam açıkça belirtilir). Sözleşme bitiş tarihi geçince işletme kendiliğinden varsayılan adına döner.
      Logo: PNG, JPEG ya da WebP, en çok 150 KB (SVG kabul edilmez).</p></div>
    ${sponsorlar.map((x) => {
      const k = x.kayit || {}, g = x.gorunen;
      return `<div class="kart sponsor-kart"><div class="sponsor-onizleme" style="background:${esc(g.renk2)};border-color:${esc(g.renk)}">
          ${g.logo ? `<img src="${esc(g.logo)}" alt="" width="40" height="40">` : `<span style="font-size:32px">${esc(g.ikon)}</span>`}
          <div><b style="color:${esc(g.renk)}">${esc(g.ad)}</b> ${g.sponsor ? '<span class="cip">SPONSOR</span>' : ''}<div class="kucuk">${esc(x.tur)} · ${esc(g.slogan || '')}</div></div></div>
        <form class="form sponsor-form" data-kategori="${x.kategori}">
          <label>Marka adı<input name="ad" required minlength="2" maxlength="40" value="${esc(k.ad || '')}" placeholder="${esc(x.varsayilan.ad)}"></label>
          <label>Simge (emoji)<input name="ikon" maxlength="4" value="${esc(k.ikon || '')}" placeholder="${esc(x.varsayilan.ikon)}"></label>
          <label>Ana renk<input name="renk" type="color" value="${esc(k.renk || x.varsayilan.renk)}"></label>
          <label>Zemin rengi<input name="renk2" type="color" value="${esc(k.renk2 || x.varsayilan.renk2)}"></label>
          <label>Slogan<input name="slogan" maxlength="80" value="${esc(k.slogan ?? '')}" placeholder="${esc(x.varsayilan.slogan)}"></label>
          <label>Web adresi (https)<input name="web" type="url" pattern="https://.*" value="${esc(k.web || '')}"></label>
          <label>Sözleşme başlangıcı<input name="sozlesmeBas" type="date" value="${tarihStr(k.sozlesme_bas)}"></label>
          <label>Sözleşme bitişi<input name="sozlesmeBit" type="date" value="${tarihStr(k.sozlesme_bit)}"></label>
          <label>Logo<input name="logoDosya" type="file" accept="image/png,image/jpeg,image/webp"></label>
          <label class="satir"><input type="checkbox" name="logoKaldir"> Logoyu kaldır</label>
          <label class="satir"><input type="checkbox" name="sponsor" ${k.sponsor ? 'checked' : ''}> Sponsor (oyunda "Sponsor" etiketi)</label>
          <div class="satir"><button class="d b">Kaydet</button><button type="button" class="d" data-k="sponsor-sifirla" data-kategori="${x.kategori}">Varsayılana döndür</button></div>
        </form>
        <details><summary>Şubeler (${x.gercekSube ? `${x.gercekSube} gerçek şube` : 'her il merkezinde bir şube'})</summary>
          <form class="form sube-form" data-kategori="${x.kategori}"><label>Her satıra bir şube: <code>ad;enlem;boylam</code> (boş gönderirsen il merkezlerine döner)
            <textarea name="liste" rows="5" placeholder="Kadıköy Şubesi;40.990;29.030"></textarea></label><button class="d b">Şubeleri yükle</button></form></details></div>`;
    }).join('')}`;
}
async function put(yol, govde) {
  const r = await fetch(yol, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(govde), credentials: 'same-origin' });
  const v = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(v.hata || `Hata ${r.status}`);
  return v;
}
const dosyaOku = (f) => new Promise((coz, red) => { const o = new FileReader(); o.onload = () => coz(o.result); o.onerror = red; o.readAsDataURL(f); });

function ekonomiCiz() {
  if (!ekonomi) { api('/api/yonetim/ekonomi').then((e) => { ekonomi = e; ciz(); }).catch((e) => { ekonomi = { hata: e.message }; ciz(); }); return '<p class="kucuk">Yükleniyor…</p>'; }
  if (ekonomi.hata) return `<div class="kart"><p class="kucuk">${esc(ekonomi.hata)}</p></div>`;
  return ekonomiHTML(ekonomi);
}
// Ekonomi gözlemi (para arzı, giriş/çıkış dengesi, ürün fiyatları) — ayrıntısı sunucudaki /api/yonetim/ekonomi'de
function ekonomiHTML(e) {
  const k = e.ozet;
  // Tutarlar sunucuda oyun birimindedir; oyundaki gibi TL gösterilir (akce)
  const tl = (x) => (x == null ? '—' : akce(x));
  return `<div class="karolar">${[['Dolaşımdaki para', tl(k.arz)], ['Basılan (7 gün)', tl(k.basilan7)], ['Yakılan (7 gün)', tl(k.yakilan7)], ['Net akış (7 gün)', tl(k.net7), k.net7 > k.arz * 0.1],
      ['Kişi başı', tl(k.kisiBasi)], ['Gini (servet)', k.gini, k.gini > 0.6]].map(([a, b, d]) => `<div class="karo ${d ? 'dikkat' : ''}"><b>${esc(b)}</b><span>${a}</span></div>`).join('')}</div>
    <div class="kart"><h2 style="margin-top:0">Günlük para akışı</h2><table><thead><tr><th>Gün</th><th>Basılan</th><th>Yakılan</th><th>Net</th><th>İşlem</th></tr></thead><tbody>
      ${e.gunluk.map((g) => `<tr><td>${esc(g.gun)}</td><td>${tl(g.basilan)}</td><td>${tl(g.yakilan)}</td><td>${tl(g.basilan - g.yakilan)}</td><td>${g.islem}</td></tr>`).join('')}</tbody></table></div>
    <div class="kart"><h2 style="margin-top:0">Akış kaynakları (7 gün)</h2><table><thead><tr><th>Sebep</th><th>Yön</th><th>Tutar</th></tr></thead><tbody>
      ${e.kaynaklar.map((x) => `<tr><td>${esc(x.sebep)}</td><td>${x.yon === 'BASIM' ? '⬆️ basım' : '⬇️ yakım'}</td><td>${tl(x.tutar)}</td></tr>`).join('')}</tbody></table></div>
    ${e.urunler ? `<div class="kart"><h2 style="margin-top:0">Ürün piyasası (birim fiyat)</h2><table><thead><tr><th>Ürün</th><th>NPC fiyatı</th><th>Son işlem</th><th>Alış emri</th><th>Satış emri</th></tr></thead><tbody>
      ${e.urunler.map((u) => `<tr><td>${esc(u.ad)}</td><td>${tl(u.npc)}</td><td>${tl(u.son)}</td><td>${tl(u.alis)}</td><td>${tl(u.satis)}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
}

document.addEventListener('click', async (e) => {
  const s = e.target.closest('[data-sekme]');
  if (s) { sekme = s.dataset.sekme; return ciz(); }
  const b = e.target.closest('[data-k]');
  if (!b) return;
  b.disabled = true;
  try {
    switch (b.dataset.k) {
      case 'sikayet-karar': {
        const not = prompt('Karar notu (şikâyetçiye iletilir):', b.dataset.karar === 'REDDEDILDI' ? 'İncelendi, kural ihlali bulunmadı.' : 'İncelendi, gerekli işlem yapıldı.');
        if (!not) break;
        await api(`/api/yonetim/sikayet/${b.dataset.id}`, { karar: b.dataset.karar, not });
        tost('Şikâyet sonuçlandı'); await yukle(); break;
      }
      case 'oner': {
        const gerekce = prompt(`${veri.tanimlar.islemler[b.dataset.tur].ad} — gerekçe (herkese açık kayda geçer):`);
        if (!gerekce) break;
        const r = await api('/api/yonetim/islem', { tur: b.dataset.tur, hedef: b.dataset.hedef, gerekce, sikayetId: b.dataset.sikayet || null });
        tost(r.uygulandi ? 'Uygulandı' : r.mesaj); await yukle(); break;
      }
      case 'islem-karar':
        await api(`/api/yonetim/islem/${b.dataset.id}`, { onay: b.dataset.onay === '1' });
        tost(b.dataset.onay === '1' ? 'Onaylandı ve uygulandı' : 'Reddedildi'); await yukle(); break;
      case 'sponsor-sifirla':
        if (!confirm('Bu işletme varsayılan adına dönsün mü?')) break;
        await put(`/api/yonetim/isletme/${b.dataset.kategori}`, { sifirla: true });
        sponsorlar = null; tost('Varsayılana döndü'); ciz(); break;
    }
  } catch (err) { tost(err.message, 'hata'); } finally { b.disabled = false; }
});
document.addEventListener('submit', async (e) => {
  if (e.target.matches('.sponsor-form, .sube-form')) {
    e.preventDefault();
    const f = e.target, k = f.dataset.kategori, v = Object.fromEntries(new FormData(f));
    try {
      if (f.matches('.sube-form')) {
        const subeler = String(v.liste || '').split('\n').map((s) => s.trim()).filter(Boolean).map((s) => { const [ad, lat, lon] = s.split(';').map((x) => x.trim()); return { ad, lat: Number(lat), lon: Number(lon) }; });
        const r = await put(`/api/yonetim/isletme/${k}/subeler`, { subeler });
        tost(r.adet ? `${r.adet} şube yüklendi` : 'Şubeler il merkezlerine döndü');
      } else {
        const dosya = f.querySelector('[name=logoDosya]').files[0];
        if (dosya && dosya.size > 150_000) throw new Error('Logo en çok 150 KB olabilir');
        const eski = sponsorlar.find((x) => x.kategori === k)?.kayit?.logo || null;
        const logo = v.logoKaldir ? null : dosya ? await dosyaOku(dosya) : eski;
        await put(`/api/yonetim/isletme/${k}`, { ad: v.ad, ikon: v.ikon, renk: v.renk, renk2: v.renk2, slogan: v.slogan, web: v.web || null,
          sozlesmeBas: v.sozlesmeBas || null, sozlesmeBit: v.sozlesmeBit || null, sponsor: !!v.sponsor, logo });
        tost('Marka kaydedildi');
      }
      sponsorlar = null; ciz();
    } catch (err) { tost(err.message, 'hata'); }
    return;
  }
  if (e.target.id !== 'islemForm') return;
  e.preventDefault();
  const v = Object.fromEntries(new FormData(e.target));
  try { const r = await api('/api/yonetim/islem', v); tost(r.uygulandi ? 'Uygulandı' : r.mesaj); await yukle(); } catch (err) { tost(err.message, 'hata'); }
});

yukle();
setInterval(() => { if (!document.hidden) yukle(); }, 60_000);
