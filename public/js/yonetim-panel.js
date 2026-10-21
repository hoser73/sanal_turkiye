// Moderasyon ve denetim paneli: şikâyetler, iki kişi kuralıyla işlemler, seçim ve meclis denetimi, dilekçeler,
// ekonomi gözlemi. Yalnızca yetkili roller (2FA zorunlu) erişir; tüm kararlar denetim kaydına yazılır.
import { api, esc, zamanOnce } from './yardimci.js';

const $ = (s) => document.querySelector(s);
let veri = null, sekme = 'sikayet', ekonomi = null;
const SEKMELER = { sikayet: 'Şikâyetler', sohbet: 'İşaretli mesajlar', islem: 'İşlemler', secim: 'Seçim denetimi', meclis: 'Meclis kararları', dilekce: 'Dilekçeler', ekonomi: 'Ekonomi', sistem: 'Sistem' };
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
  $('#sekmeler').innerHTML = Object.entries(SEKMELER).map(([k, v]) => `<button role="tab" data-sekme="${k}" aria-selected="${k === sekme}">${v}</button>`).join('');
  $('#icerik').innerHTML = ({ sikayet, sohbet, islem, secim, meclis, dilekce, ekonomi: ekonomiCiz, sistem: sistemCiz })[sekme]();
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
      <label>Hedef<input name="hedef" required placeholder="parsel: TR-… · hesap: kullanıcı no · içerik: DUYURU:12 · görev: MUHTAR:bölge:kullanıcı · seçim: no"></label>
      <label>Gerekçe (herkese açık kayda geçer)<textarea name="gerekce" rows="2" minlength="10" required></textarea></label>
      <button class="d b">Öner</button></form></div>
    <div class="kart"><table><thead><tr><th>#</th><th>İşlem</th><th>Durum</th><th>Öneren</th><th>Onaylayan</th><th>Zaman</th><th></th></tr></thead><tbody>${satir || '<tr><td colspan="7" class="kucuk">Kayıt yok.</td></tr>'}</tbody></table></div>`;
}

function secim() {
  return `<div class="kart"><p class="kucuk">Bağımsız yeniden sayım, kayıtlı pusula özetinden sonucu yeniden hesaplar ve ilk sayımın özet değeriyle karşılaştırır. Oylar gizli olduğundan kimin kime oy verdiği hiçbir yerde görünmez.</p>
    <table><thead><tr><th>#</th><th>Bölge</th><th>Tür</th><th>Aşama</th><th>Katılım</th><th>İtiraz</th><th>Özet</th><th></th></tr></thead><tbody>
    ${veri.secimler.map((s) => `<tr><td>${s.id}</td><td>${esc(s.bolge)}</td><td>${esc(s.tur)}</td><td>${cip(s.asama)}${s.iptal_sebebi ? `<div class="kucuk">${esc(s.iptal_sebebi)}</div>` : ''}</td>
      <td>${s.katilim}</td><td>${s.itiraz}</td><td class="mono">${esc((s.ozet_hash || '—').slice(0, 12))}</td>
      <td><button class="d" data-k="yeniden-say" data-id="${s.id}">Yeniden say</button>
        ${s.asama !== 'IPTAL' ? `<button class="d t" data-k="oner" data-tur="SECIM_IPTAL" data-hedef="${s.id}">İptal öner</button>` : ''}<div class="kucuk" id="sayim-${s.id}"></div></td></tr>`).join('')
      || '<tr><td colspan="8" class="kucuk">Seçim yok.</td></tr>'}</tbody></table></div>`;
}

function meclis() {
  return `<div class="kart"><table><thead><tr><th>#</th><th>İlçe</th><th>Proje</th><th>Durum</th><th>Teklif eden</th><th>Karar</th></tr></thead><tbody>
    ${veri.kararlar.map((p) => `<tr><td>${p.id}</td><td>${esc(p.ilce)}</td><td>${esc(p.tur)} · ₳${p.maliyet}${p.nitelikli ? ' <span class="cip">nitelikli</span>' : ''}</td>
      <td>${cip(p.durum)}</td><td>${esc(p.teklif_eden)}</td><td class="kucuk">${p.karar ? esc(p.karar.sebep) : '—'}</td></tr>`).join('')
      || '<tr><td colspan="6" class="kucuk">Karar yok.</td></tr>'}</tbody></table></div>`;
}

function dilekce() {
  return `<div class="kart"><table><thead><tr><th>#</th><th>Bölge</th><th>Makam</th><th>Hedef</th><th>İmza</th><th>Durum</th><th></th></tr></thead><tbody>
    ${veri.dilekceler.map((d) => `<tr><td>${d.id}</td><td>${esc(d.bolge)}</td><td>${esc(d.makam)}</td><td>${esc(d.hedef)}</td><td>${d.imza}/${d.esik}</td><td>${cip(d.durum)}</td><td class="kucuk">${ms(d.bitis)}</td></tr>`).join('')
      || '<tr><td colspan="7" class="kucuk">Dilekçe yok.</td></tr>'}</tbody></table></div>`;
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

function ekonomiCiz() {
  if (!ekonomi) { api('/api/yonetim/ekonomi').then((e) => { ekonomi = e; ciz(); }).catch((e) => { ekonomi = { hata: e.message }; ciz(); }); return '<p class="kucuk">Yükleniyor…</p>'; }
  if (ekonomi.hata) return `<div class="kart"><p class="kucuk">${esc(ekonomi.hata)}</p></div>`;
  return ekonomiHTML(ekonomi);
}
// Ekonomi gözlemi (para arzı, giriş/çıkış dengesi, ürün fiyatları) — ayrıntısı sunucudaki /api/yonetim/ekonomi'de
function ekonomiHTML(e) {
  const k = e.ozet;
  return `<div class="karolar">${[['Dolaşımdaki akçe', k.arz], ['Basılan (7 gün)', k.basilan7], ['Yakılan (7 gün)', k.yakilan7], ['Net akış (7 gün)', k.net7, k.net7 > k.arz * 0.1],
      ['Kişi başı akçe', k.kisiBasi], ['Gini (servet)', k.gini, k.gini > 0.6]].map(([a, b, d]) => `<div class="karo ${d ? 'dikkat' : ''}"><b>${esc(b)}</b><span>${a}</span></div>`).join('')}</div>
    <div class="kart"><h2 style="margin-top:0">Günlük akçe akışı</h2><table><thead><tr><th>Gün</th><th>Basılan</th><th>Yakılan</th><th>Net</th><th>İşlem</th></tr></thead><tbody>
      ${e.gunluk.map((g) => `<tr><td>${esc(g.gun)}</td><td>${g.basilan}</td><td>${g.yakilan}</td><td>${g.basilan - g.yakilan}</td><td>${g.islem}</td></tr>`).join('')}</tbody></table></div>
    <div class="kart"><h2 style="margin-top:0">Akış kaynakları (7 gün)</h2><table><thead><tr><th>Sebep</th><th>Yön</th><th>Tutar</th></tr></thead><tbody>
      ${e.kaynaklar.map((x) => `<tr><td>${esc(x.sebep)}</td><td>${x.yon === 'BASIM' ? '⬆ basım' : '⬇ yakım'}</td><td>${x.tutar}</td></tr>`).join('')}</tbody></table></div>
    ${e.urunler ? `<div class="kart"><h2 style="margin-top:0">Ürün piyasası</h2><table><thead><tr><th>Ürün</th><th>NPC fiyatı</th><th>Son işlem</th><th>Alış emri</th><th>Satış emri</th></tr></thead><tbody>
      ${e.urunler.map((u) => `<tr><td>${esc(u.ad)}</td><td>${u.npc}</td><td>${u.son ?? '—'}</td><td>${u.alis ?? '—'}</td><td>${u.satis ?? '—'}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
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
      case 'yeniden-say': {
        const r = await api(`/api/secim/${b.dataset.id}/yeniden-say`);
        document.getElementById(`sayim-${b.dataset.id}`).textContent = r.uyumlu ? `✓ ilk sayımla uyumlu (${r.toplam} pusula)` : '✖ UYUŞMUYOR — incele';
        break;
      }
    }
  } catch (err) { tost(err.message, 'hata'); } finally { b.disabled = false; }
});
document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'islemForm') return;
  e.preventDefault();
  const v = Object.fromEntries(new FormData(e.target));
  try { const r = await api('/api/yonetim/islem', v); tost(r.uygulandi ? 'Uygulandı' : r.mesaj); await yukle(); } catch (err) { tost(err.message, 'hata'); }
});

yukle();
setInterval(() => { if (!document.hidden) yukle(); }, 60_000);
