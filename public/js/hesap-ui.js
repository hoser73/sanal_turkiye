// Hesabım: güvenlik (parola, iki adımlı doğrulama, oturumlar), gizlilik (KVKK onayları, veri indirme, hesap silme),
// oyun süresi hatırlatıcısı, e-posta doğrulama şeridi ve şikâyet penceresi.
import { api, esc, tost, zamanOnce } from './yardimci.js';
import { pushDestekli, pushDurumu, pushAc, pushKapat } from './canli.js';

const $ = (s, k = document) => k.querySelector(s);
let ctx = { yenile: async () => {}, cikti: async () => {} };
let hesap = null, oturumlar = [], rozetler = [], kozmetikler = [], kurulum = null, kurtarma = null, bolum = 'guvenlik';

export function hesapKur(baglam) {
  ctx = { ...ctx, ...baglam };
  $('#hesapDugme').addEventListener('click', () => hesapAc());
  $('#hesapModal').addEventListener('click', hesapTik);
  $('#hesapModal').addEventListener('submit', hesapGonder);
  $('#hesapModal').addEventListener('close', () => { kurulum = null; kurtarma = null; });
  // E-posta doğrulama rozeti: tıklayınca açıklama ve yeniden gönder açılır, dışarı tıklayınca kapanır
  const dogrulamaAc = (ac) => { $('#dogrulamaAyrinti').hidden = !ac; $('#dogrulamaAc').setAttribute('aria-expanded', String(ac)); };
  $('#dogrulamaAc').addEventListener('click', () => dogrulamaAc($('#dogrulamaAyrinti').hidden));
  document.addEventListener('click', (e) => { if (!e.target.closest('#dogrulamaSerit')) dogrulamaAc(false); });
  $('#dogrulamaYeniden').addEventListener('click', async () => {
    try { const r = await api('/api/eposta/yeniden', {}); tost(r.zatenDogrulandi ? 'Adresin zaten doğrulanmış' : 'Doğrulama bağlantısı gönderildi'); ctx.yenile(); } catch (e) { tost(e.message, 'hata'); }
  });
  $('#sikayetForm').addEventListener('submit', sikayetGonder);
  $('#sikayetForm').addEventListener('click', (e) => { if (e.target.closest('[data-vazgec]')) $('#sikayetModal').close(); });
  $('#hesapModal').addEventListener('change', ayarDegisti);
  $('#molaTamam').addEventListener('click', () => $('#molaModal').close());
  $('#molaAyar').addEventListener('click', () => { $('#molaModal').close(); bolum = 'gizlilik'; hesapAc(); });
  setInterval(molaKontrol, 30_000);
}

// Üst çubuk ve şerit: /api/ben'deki hesap durumuyla
export function hesapDurumuCiz(ben) {
  const h = ben?.hesap;
  $('#dogrulamaSerit').hidden = !h || h.dogrulandi;
  $('#gelistiriciPosta').hidden = !['localhost', '127.0.0.1'].includes(location.hostname);
  $('#hesapUyari').hidden = !h || (h.dogrulandi && !h.eksikOnay.length);
  $('#yonetimLink').hidden = !h || h.rol === 'OYUNCU';
  document.body.classList.toggle('serit-acik', !!h && !h.dogrulandi);
  molaAyarla(h?.ayarlar?.sureHatirlatici || 0);
  if (h?.eksikOnay?.length && !$('#hesapModal').open && !sessionStorage.getItem('st_onay_soruldu')) {
    sessionStorage.setItem('st_onay_soruldu', '1');
    bolum = 'gizlilik';
    hesapAc();
    tost('Güncellenen sözleşme metinlerini onaylaman gerekiyor', 'hata');
  }
}

// Bağlantıyla gelen e-posta doğrulama / parola sıfırlama token'ları (adres çubuğundan hemen silinir)
export function urlTokenleri() {
  const u = new URL(location.href);
  const t = { dogrula: u.searchParams.get('dogrula'), sifirla: u.searchParams.get('sifirla') };
  if (t.dogrula || t.sifirla) {
    u.searchParams.delete('dogrula'); u.searchParams.delete('sifirla');
    history.replaceState(null, '', u.pathname + u.search + u.hash);
  }
  return t;
}
export async function epostaDogrula(token) {
  try { await api('/api/eposta/dogrula', { token }); tost('✅ E-posta adresin doğrulandı. Pazar ve seçimler artık açık.'); await ctx.yenile(); }
  catch (e) { tost(e.message, 'hata'); }
}

// ---------- Hesabım penceresi
export async function hesapAc(b) {
  if (b) bolum = b;
  try {
    [hesap, oturumlar, rozetler, kozmetikler] = await Promise.all([api('/api/hesap'), api('/api/oturumlar'), api('/api/rozetlerim').catch(() => []), api('/api/kozmetik').catch(() => [])]);
  } catch (e) { return tost(e.message, 'hata'); }
  ciz();
  if (!$('#hesapModal').open) $('#hesapModal').showModal();
}

const SEKMELER = { guvenlik: 'Güvenlik', gizlilik: 'Gizlilik ve veriler', oyun: 'Oyun ayarları' };
function ciz() {
  const h = hesap;
  $('#hesapGovde').innerHTML = `
    <div class="modal-ust">
      <div><p class="ust-baslik">Hesabım</p><h2 id="hesapBaslik">${esc(h.ad)}</h2>
        <p class="kucuk">${esc(h.email)} · ${h.dogrulandi ? '<span class="cip yesil">✓ doğrulandı</span>' : '<span class="cip turuncu">doğrulanmadı</span>'}
        ${h.rol !== 'OYUNCU' ? `<span class="cip mavi">${esc(h.rolAd)}</span>` : ''}${h.genc ? '<span class="cip">genç hesap</span>' : ''} · ${esc(zamanOnce(h.katilim))} katıldı</p></div>
      <button type="button" class="kapat" data-h="kapat" aria-label="Kapat">✕</button>
    </div>
    <nav class="form-sekme uc" role="tablist">${Object.entries(SEKMELER).map(([k, v]) => `<button type="button" role="tab" data-h="bolum" data-b="${k}" aria-selected="${bolum === k}">${v}</button>`).join('')}</nav>
    <div class="hesap-bolum">${bolum === 'guvenlik' ? guvenlik(h) : bolum === 'gizlilik' ? gizlilik(h) : oyunAyarlari(h)}</div>`;
  if (bolum === 'oyun') pushAlaniCiz();
}
async function pushAlaniCiz() {
  const el = document.getElementById('pushAlani');
  if (!el) return;
  const d = await pushDurumu().catch(() => 'desteklenmiyor');
  el.innerHTML = d === 'desteklenmiyor' ? '<p class="kucuk">Bu tarayıcı web bildirimlerini desteklemiyor. iPhone’da önce “Ana Ekrana Ekle” ile uygulamayı yükle.</p>'
    : d === 'engellendi' ? '<p class="kucuk">Bildirim izni tarayıcı ayarlarında engellenmiş.</p>'
    : d === 'acik' ? '<span class="cip yesil">✓ bu cihazda açık</span> <button type="button" class="dugme ince" data-h="push-kapat">Kapat</button>'
    : '<button type="button" class="dugme birincil ince" data-h="push-ac">Bu cihazda bildirimleri aç</button>';
}

function guvenlik(h) {
  const ikiAdim = kurtarma ? `
      <div class="kutu basari"><b>İki adımlı doğrulama açıldı.</b> Bu kurtarma kodlarını güvenli bir yere kaydet; her biri bir kez kullanılır ve bir daha gösterilmez.
        <ol class="kodlar mono">${kurtarma.map((k) => `<li>${esc(k)}</li>`).join('')}</ol>
        <button type="button" class="dugme ince" data-h="kod-kopyala">Kopyala</button> <button type="button" class="dugme ince birincil" data-h="kurtarma-tamam">Kaydettim</button></div>`
    : kurulum ? `
      <div class="kutu"><p>1. Kimlik doğrulayıcı uygulamanla (Google Authenticator, Authy, 1Password…) bu kodu tara:</p>
        <img class="qr" src="${esc(kurulum.qr)}" alt="İki adımlı doğrulama QR kodu" width="180" height="180">
        <p class="kucuk">Tarayamıyorsan anahtarı elle gir: <code class="mono secilebilir">${esc(kurulum.sir.replace(/(.{4})/g, '$1 ').trim())}</code></p>
        <form class="form satir" data-form="2fa-etkin"><label>2. Uygulamadaki 6 haneli kod<input name="kod" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></label>
        <button class="dugme birincil">Etkinleştir</button></form></div>`
    : h.ikiAdim ? `
      <p><span class="cip yesil">✓ açık</span> Girişte parolanın yanında uygulamadaki kod da istenir. Kalan kurtarma kodu: <b>${h.kurtarmaKalan}</b></p>
      <details><summary>İki adımlı doğrulamayı kapat</summary>
        <form class="form" data-form="2fa-kapat"><label>Parola<input name="sifre" type="password" autocomplete="current-password" required></label>
        <label>Kod ya da kurtarma kodu<input name="kod" autocomplete="one-time-code" required></label>
        <button class="dugme">Kapat</button></form></details>`
    : `<p>Hesabını parolan çalınsa bile korur. ${h.rol !== 'OYUNCU' ? '<b>Yetkili hesaplarda zorunludur.</b>' : 'Muhtar ve belediye görevlileri için önerilir.'}</p>
       <button type="button" class="dugme birincil" data-h="2fa-kur">İki adımlı doğrulamayı kur</button>`;
  return `
    <section><h3>İki adımlı doğrulama</h3>${ikiAdim}</section>
    <section><h3>Oturumlar</h3>
      <ul class="liste">${oturumlar.map((o) => `<li class="liste-oge"><span class="ikon">${/iOS|Android/.test(o.tarayici) ? '📱' : '💻'}</span>
        <div class="govde"><b>${esc(o.tarayici)}</b><span class="kucuk">açıldı ${esc(zamanOnce(o.acildi))} · son etkinlik ${o.sonGorulme ? esc(zamanOnce(o.sonGorulme)) : '—'}</span></div>
        <div class="sag">${o.bu ? '<span class="cip yesil">bu cihaz</span>' : `<button type="button" class="bag tehlike" data-h="oturum-kapat" data-id="${o.id}">kapat</button>`}</div></li>`).join('')}</ul>
      ${oturumlar.length > 1 ? '<button type="button" class="dugme ince" data-h="digerleri">Diğer tüm oturumları kapat</button>' : ''}
    </section>
    <section><h3>Parola</h3>
      <details><summary>Parolayı değiştir</summary>
        <form class="form" data-form="sifre"><label>Mevcut parola<input name="sifre" type="password" autocomplete="current-password" required></label>
        <label>Yeni parola (en az 8 karakter)<input name="yeni" type="password" autocomplete="new-password" minlength="8" required></label>
        ${h.ikiAdim ? '<label>İki adımlı doğrulama kodu<input name="kod" autocomplete="one-time-code" required></label>' : ''}
        <button class="dugme birincil">Değiştir</button><p class="kucuk">Diğer cihazlardaki oturumların kapatılır.</p></form></details>
    </section>
    ${h.dogrulandi ? '' : '<section><h3>E-posta doğrulama</h3><p>Gelen kutunu kontrol et. Bağlantı 48 saat geçerlidir.</p><button type="button" class="dugme" data-h="dogrula-yeniden">Bağlantıyı yeniden gönder</button></section>'}`;
}

function gizlilik(h) {
  return `
    <section><h3>Onaylar</h3>
      <ul class="liste">${Object.entries(h.onaylar).map(([k, o]) => `<li class="liste-oge"><span class="ikon">${o.guncel ? '✅' : o.zorunlu ? '⚠️' : '✉️'}</span>
        <div class="govde"><b><a href="${esc(o.yol)}" target="_blank" rel="noopener">${esc(o.ad)}</a></b>
          <span class="kucuk">${o.tarih ? `${o.onay ? 'onaylandı' : 'izin verilmedi'} · sürüm ${esc(o.surum)} · ${esc(zamanOnce(o.tarih))}` : 'kayıt yok'}${o.zorunlu ? ' · hizmet için gerekli' : ' · isteğe bağlı'}</span></div>
        <div class="sag">${o.zorunlu
          ? (o.guncel ? '' : `<button type="button" class="dugme ince birincil" data-h="onay" data-belge="${k}" data-onay="1">Güncel sürümü onayla</button>`)
          : `<button type="button" class="dugme ince" data-h="onay" data-belge="${k}" data-onay="${o.onay ? 0 : 1}">${o.onay ? 'İzni geri çek' : 'İzin ver'}</button>`}</div></li>`).join('')}</ul>
    </section>
    <section><h3>Verilerim</h3>
      <p>KVKK m.11 kapsamında hesabınla ilgili tüm kayıtları (cüzdan, parseller, ilanlar, adaylıklar, onaylar, oturumlar…) makinece okunabilir bir dosya olarak indirebilirsin. Gizli oy ilkesi gereği oy içerikleri kimseyle ilişkilendirilmez ve dosyada yer almaz.</p>
      <a class="dugme" href="/api/hesap/veri" download>⬇ Verilerimi indir (JSON)</a>
    </section>
    <section class="tehlike-bolge"><h3>Hesabı sil</h3>
      <p>Kimlik bilgilerin (e-posta, parola, doğum yılı, 2FA) kalıcı olarak silinir; parsellerin devlete döner, açık ilan ve tekliflerin kapanır, makamların boşalır.
      Ekonomi defteri ve denetim kaydı diğer oyuncuların işlem bütünlüğü için “Ayrılan oyuncu” adıyla anonim kalır. <b>Bu işlem geri alınamaz.</b></p>
      <details><summary>Hesabımı silmek istiyorum</summary>
        <form class="form" data-form="sil"><label>Parola<input name="sifre" type="password" autocomplete="current-password" required></label>
        ${h.ikiAdim ? '<label>İki adımlı doğrulama kodu<input name="kod" autocomplete="one-time-code" required></label>' : ''}
        <label>Onaylamak için <b>SİL</b> yaz<input name="onayMetni" autocomplete="off" required></label>
        <button class="dugme tehlike">Hesabımı kalıcı olarak sil</button></form></details>
    </section>`;
}

function oyunAyarlari(h) {
  const a = h.ayarlar || {};
  const iller = (ctx.iller?.() || []).slice().sort((x, y) => x.name.localeCompare(y.name, 'tr'));
  return `
    <section><h3>🧿 Memleket</h3>
      <p>Memleketin hemşehri sohbetini açar; gurbette yaptığın eylemler il liginde memleketine de yarım puan yazar. 30 günde bir değiştirilebilir.</p>
      <form class="form satir" data-form="memleket"><label>İl<select name="plaka">${!h.memleket ? '<option value="">Seç…</option>' : ''}${iller.map((il) => `<option value="${il.plaka}" ${h.memleket?.plaka === il.plaka ? 'selected' : ''}>${esc(il.name)}</option>`).join('')}</select></label>
      <button class="dugme">Kaydet</button></form>
    </section>
    <section><h3>Kozmetikler</h3>
      <p class="kucuk">Oyun avantajı vermez; parselinin 3B görünümünü ve adının yanındaki unvanı değiştirir. Akçeyle alınanlar oyundan çıkar.</p>
      ${['cati', 'bayrak', 'unvan'].map((tur) => `<div class="koz-grup"><b>${{ cati: 'Çatı rengi', bayrak: 'Flama', unvan: 'Unvan' }[tur]}</b><div class="secenekler">
        <button type="button" class="cip-dugme" data-h="koz-sec" data-tur="${tur}" data-kod="" aria-pressed="${!kozmetikler.some((k) => k.tur === tur && k.secili)}">Varsayılan</button>
        ${kozmetikler.filter((k) => k.tur === tur).map((k) => `<button type="button" class="cip-dugme" ${k.sahip ? `data-h="koz-sec" data-tur="${tur}" data-kod="${k.kod}"` : k.fiyat ? `data-h="koz-al" data-kod="${k.kod}"` : 'disabled'}
          aria-pressed="${k.secili}" title="${esc(k.kilit || '')}">${k.renk ? `<span class="koz-renk" style="background:${k.renk}"></span>` : ''}${esc(k.ad)}${k.sahip ? '' : k.fiyat ? ` · ₳${k.fiyat}` : ' 🔒'}</button>`).join('')}
      </div></div>`).join('')}
    </section>
    <section><h3>Rozetler</h3>
      ${rozetler.length ? `<ul class="rozet-liste">${rozetler.map((r) => `<li title="${esc(r.aciklama || '')}"><span>${r.ikon}</span>${esc(r.ad)}</li>`).join('')}</ul>`
        : '<p class="kucuk">Henüz rozetin yok. İl liginde ilk üçe giren illere katkı verenler, koleksiyonu tamamlayanlar rozet kazanır.</p>'}
    </section>
    <section><h3>Oyun süresi hatırlatıcısı</h3>
      <p>Belirlediğin süre dolunca nazik bir mola hatırlatması gösterilir.${h.genc ? ' Genç hesaplarda kapatılamaz.' : ''}</p>
      <div class="secenekler">${h.sureSecenekleri.map((d) => `<button type="button" class="cip-dugme" data-h="sure" data-d="${d}" aria-pressed="${(a.sureHatirlatici || 0) === d}" ${h.genc && d === 0 ? 'disabled' : ''}>${d ? `${d} dk` : 'Kapalı'}</button>`).join('')}</div>
    </section>
    <section><h3>Sohbet</h3>
      <label class="onay"><input type="checkbox" data-h="sohbet" ${a.sohbet ? 'checked' : ''}> <span>Mahalle ve il sohbetlerini göster ve yazabileyim</span></label>
      ${h.genc ? '<p class="kucuk">Genç hesaplarda sohbet varsayılan olarak kapalı başlar; özel mesaj yoktur.</p>' : ''}
    </section>
    <section><h3>Cihaz bildirimleri</h3>
      <p>Oyun kapalıyken teklif, seçim ve meclis gelişmelerini telefonuna ya da bilgisayarına bildirim olarak al.</p>
      <div id="pushAlani"><span class="kucuk">Denetleniyor…</span></div>
    </section>
    <section><h3>Bildirim sesi</h3>
      <label class="onay"><input type="checkbox" data-h="ses" ${a.bildirimSesi ? 'checked' : ''}> <span>Yeni bildirimde kısa bir ses çal</span></label>
    </section>
    <section><h3>Çiftlik hatırlatmaları</h3>
      <label class="onay"><input type="checkbox" data-h="hatirlatma" ${a.hatirlatma !== false ? 'checked' : ''}> <span>Hasat hazır olunca, hayvan ürünleri birikince ve sipariş süresi dolmak üzereyken haber ver (gece 23.00–08.00 arası gönderilmez)</span></label>
    </section>
    <section><h3>Rehber</h3>
      <p class="kucuk">Hasan Dayı'nın ilk adımlar rehberini baştan başlat.</p>
      <button type="button" class="dugme ince" data-h="rehber">🧑‍🌾 Rehberi yeniden başlat</button>
    </section>`;
}

async function islem(fn, mesaj) {
  try { const r = await fn(); if (mesaj) tost(mesaj); return r; } catch (e) { tost(e.message, 'hata'); return null; }
}

async function hesapTik(e) {
  if (e.target === $('#hesapModal')) return $('#hesapModal').close();   // arka plana tık
  const b = e.target.closest('[data-h]');
  if (!b || b.disabled) return;
  const hh = b.dataset.h;
  if (hh === 'kapat') return $('#hesapModal').close();
  if (hh === 'bolum') { bolum = b.dataset.b; return ciz(); }
  if (hh === '2fa-kur') { kurulum = await islem(() => api('/api/2fa/kur', {})); return ciz(); }
  if (hh === 'kurtarma-tamam') { kurtarma = null; return hesapAc(); }
  if (hh === 'kod-kopyala') return navigator.clipboard?.writeText(kurtarma.join('\n')).then(() => tost('Kodlar panoya kopyalandı'));
  if (hh === 'oturum-kapat') { await islem(() => api(`/api/oturum/${b.dataset.id}/kapat`, {}), 'Oturum kapatıldı'); return hesapAc(); }
  if (hh === 'digerleri') { const r = await islem(() => api('/api/oturumlar/digerleri', {})); if (r) tost(`${r.kapatilan} oturum kapatıldı`); return hesapAc(); }
  if (hh === 'dogrula-yeniden') return $('#dogrulamaYeniden').click();
  if (hh === 'onay') { await islem(() => api('/api/hesap/onay', { belge: b.dataset.belge, onay: b.dataset.onay === '1' }), 'Tercihin kaydedildi'); await ctx.yenile(); return hesapAc(); }
  if (hh === 'push-ac') { await islem(() => pushAc(api), 'Bildirimler bu cihazda açıldı'); return pushAlaniCiz(); }
  if (hh === 'push-kapat') { await islem(() => pushKapat(api), 'Bildirimler kapatıldı'); return pushAlaniCiz(); }
  if (hh === 'koz-al') {
    if (!confirm('Bu kozmetiği satın almak istiyor musun?')) return;
    await islem(() => api('/api/kozmetik/al', { kod: b.dataset.kod }), 'Kozmetik alındı'); await ctx.yenile(); return hesapAc();
  }
  if (hh === 'koz-sec') { await islem(() => api('/api/kozmetik/sec', { tur: b.dataset.tur, kod: b.dataset.kod || null }), 'Görünüm güncellendi'); await ctx.yenile(); return hesapAc(); }
  if (hh === 'rehber') { window.dispatchEvent(new CustomEvent('rehber-yeniden')); $('#hesapModal')?.close(); return; }
  if (hh === 'sure') { await islem(() => api('/api/hesap/ayarlar', { sureHatirlatici: Number(b.dataset.d) }), 'Hatırlatıcı güncellendi'); await ctx.yenile(); return hesapAc(); }
}
async function ayarDegisti(e) {
  const hh = e.target.dataset?.h;
  if (hh === 'sohbet' || hh === 'ses' || hh === 'hatirlatma') {
    const govde = { sohbet: { sohbet: e.target.checked }, ses: { bildirimSesi: e.target.checked }, hatirlatma: { hatirlatma: e.target.checked } }[hh];
    await islem(() => api('/api/hesap/ayarlar', govde), 'Ayar kaydedildi');
    await ctx.yenile();
  }
}

async function hesapGonder(e) {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  const v = Object.fromEntries(new FormData(f));
  const dugme = f.querySelector('button');
  dugme.disabled = true;
  try {
    switch (f.dataset.form) {
      case '2fa-etkin': { const r = await api('/api/2fa/etkinlestir', v); kurulum = null; kurtarma = r.kurtarmaKodlari; hesap = await api('/api/hesap'); ciz(); await ctx.yenile(); return; }
      case 'memleket': if (!v.plaka) return; await api('/api/hesap/memleket', v); tost('Memleketin kaydedildi 🧿'); break;
      case '2fa-kapat': await api('/api/2fa/kapat', v); tost('İki adımlı doğrulama kapatıldı'); break;
      case 'sifre': await api('/api/sifre/degistir', v); tost('Parolan değişti; diğer oturumlar kapatıldı'); break;
      case 'sil':
        if (!confirm('Hesabın kalıcı olarak silinecek. Emin misin?')) return;
        await api('/api/hesap/sil', v);
        $('#hesapModal').close();
        tost('Hesabın silindi. Hoşça kal 👋');
        return ctx.cikti();
    }
    await ctx.yenile();
    await hesapAc();
  } catch (err) { tost(err.message, 'hata'); } finally { dugme.disabled = false; }
}

// ---------- Mola hatırlatıcısı (oturum süresi bu sekmede sayılır)
let molaDk = 0;
function molaAyarla(dk) {
  molaDk = dk;
  try { if (!sessionStorage.getItem('st_oyun_bas')) sessionStorage.setItem('st_oyun_bas', String(Date.now())); } catch { /* gizli kip */ }
}
function molaKontrol() {
  if (!molaDk || document.hidden) return;
  let bas, son;
  try { bas = Number(sessionStorage.getItem('st_oyun_bas')); son = Number(sessionStorage.getItem('st_mola_son') || bas); } catch { return; }
  if (!bas || Date.now() - son < molaDk * 60_000 || $('#molaModal').open) return;
  try { sessionStorage.setItem('st_mola_son', String(Date.now())); } catch { /* yok say */ }
  $('#molaSure').textContent = Math.round((Date.now() - bas) / 60_000);
  $('#molaModal').showModal();
}

// ---------- Şikâyet
let tanimlar = null;
export async function sikayetAc(hedefTur, hedefId, baslik) {
  try { tanimlar ||= await api('/api/sikayet/tanimlar'); } catch (e) { return tost(e.message, 'hata'); }
  $('#sikayetForm').innerHTML = `
    <p class="ust-baslik">Şikâyet et</p><h2 id="sikayetBaslik">${esc(baslik)}</h2>
    <input type="hidden" name="hedefTur" value="${esc(hedefTur)}"><input type="hidden" name="hedefId" value="${esc(hedefId)}">
    <label>Sebep<select name="sebep" required><option value="">Seç…</option>${Object.entries(tanimlar.sebepler).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
    <label>Açıklama (isteğe bağlı)<textarea name="aciklama" maxlength="500" rows="3" placeholder="Moderatörün bilmesi gerekenler"></textarea></label>
    <p class="kucuk">Şikâyetin gizlidir; şikâyet edilen kişi kimin bildirdiğini göremez. Kötüye kullanım hesabına yansır.</p>
    <div class="satir-dugmeler"><button type="submit" class="dugme birincil" value="gonder">Gönder</button><button type="button" class="dugme" data-vazgec>Vazgeç</button></div>`;
  $('#sikayetModal').showModal();
}
async function sikayetGonder(e) {
  e.preventDefault();
  const v = Object.fromEntries(new FormData(e.target));
  if (!v.sebep) return tost('Bir sebep seç', 'hata');
  try { await api('/api/sikayet', v); $('#sikayetModal').close(); tost('Şikâyetin moderasyona iletildi. Teşekkürler.'); } catch (err) { tost(err.message, 'hata'); }
}
