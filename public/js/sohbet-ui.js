// Sohbet çekmecesi: mahalle, il meydanı ve memleket (hemşehri) kanalları. Mesajlar canlı bağlantıyla anında gelir.
// Özel mesaj yoktur; her mesaj bildirilebilir. Kişisel veri içeren mesaj sunucuda reddedilir.
import { api, esc, tost, zamanOnce } from './yardimci.js';
import { canliDinle, kanallaraAbone, baglantiDurumu } from './canli.js';

const $ = (s) => document.querySelector(s);
let ctx = null, acik = false, aktif = null, veri = {}, cevrimici = {}, okunmamis = 0;

// kanallarFn: () => [{ kanal, ad, ikon }] — oyuncunun bağlamına göre (görüntülenen mahalle, haritadaki il, memleket)
export function sohbetKur(baglam) {
  ctx = baglam;
  $('#sohbetDugme').addEventListener('click', () => (acik ? kapat() : ac()));
  $('#sohbetCekmece').addEventListener('click', tik);
  $('#sohbetCekmece').addEventListener('submit', gonder);
  canliDinle('sohbet', (m) => {
    const v = veri[m.kanal];
    if (v && !v.mesajlar.some((x) => x.id === m.mesaj.id)) {
      v.mesajlar.push(m.mesaj);
      if (v.mesajlar.length > 120) v.mesajlar.shift();
    }
    if (acik && aktif === m.kanal) ciz(true);
    else if (!m.mesaj.ben) { okunmamis++; rozet(); }
  });
  canliDinle('cevrimici', (m) => { cevrimici[m.kanal] = m.sayi; if (acik) ustCiz(); });
  canliDinle('durum', () => acik && ustCiz());
}

export function sohbetKanallariniYenile() {
  const k = ctx.kanallarFn();
  kanallaraAbone(k.map((x) => x.kanal));
  if (aktif && !k.some((x) => x.kanal === aktif)) aktif = null;
  if (acik) yukle();
}

function rozet() { $('#sohbetRozet').hidden = !okunmamis; $('#sohbetRozet').textContent = okunmamis > 9 ? '9+' : okunmamis; }

async function ac() {
  acik = true; okunmamis = 0; rozet();
  $('#sohbetCekmece').hidden = false;
  $('#sohbetDugme').setAttribute('aria-expanded', 'true');
  await yukle();
}
function kapat() {
  acik = false;
  $('#sohbetCekmece').hidden = true;
  $('#sohbetDugme').setAttribute('aria-expanded', 'false');
}

async function yukle() {
  const kanallar = ctx.kanallarFn();
  if (!kanallar.length) { $('#sohbetCekmece').innerHTML = cerceve('<p class="kucuk bos">Sohbet için haritada bir ile yaklaş ya da bir mahalle aç.</p>'); return; }
  aktif ||= kanallar[0].kanal;
  try { veri[aktif] = await api(`/api/sohbet/${encodeURIComponent(aktif)}`); } catch (e) { tost(e.message, 'hata'); }
  ciz(true);
}

function cerceve(icerik) {
  return `<div class="sohbet-ust"><b>💬 Sohbet</b><button type="button" class="kapat" data-s="kapat" aria-label="Sohbeti kapat">✕</button></div>${icerik}`;
}
function ustCiz() {
  const el = $('#sohbetCekmece .sohbet-sekme');
  if (el) el.outerHTML = sekmeler();
}
function sekmeler() {
  return `<nav class="sohbet-sekme" role="tablist">${ctx.kanallarFn().map((k) => `<button type="button" role="tab" data-s="kanal" data-kanal="${esc(k.kanal)}" aria-selected="${k.kanal === aktif}">
    ${k.ikon} ${esc(k.ad)}${cevrimici[k.kanal] ? ` <span class="cevrimici">● ${cevrimici[k.kanal]}</span>` : ''}</button>`).join('')}</nav>`;
}
function ciz(asagi) {
  const v = veri[aktif];
  if (!v) return;
  const liste = v.mesajlar.length ? v.mesajlar.map((m) => `<li class="${m.ben ? 'ben' : ''}">
      <div class="balon"><b>${esc(m.ad)}${m.demo ? ' <span class="demo-rozet" title="Oyunun canlandırdığı demo sakin">demo</span>' : ''}</b> ${esc(m.metin)}</div>
      <span class="kucuk">${esc(zamanOnce(m.zaman))}${m.ben ? '' : ` · <button type="button" class="bag sessiz" data-s="bildir" data-id="${m.id}" data-ad="${esc(m.ad)}">bildir</button>`}</span></li>`).join('')
    : '<li class="bos kucuk">Henüz mesaj yok. İlk merhabayı sen de!</li>';
  $('#sohbetCekmece').innerHTML = cerceve(`${sekmeler()}
    <ol class="sohbet-liste" aria-live="polite">${liste}</ol>
    ${v.yazabilir ? `<form class="sohbet-form"><input name="metin" maxlength="${v.maxUzunluk}" placeholder="${esc(v.ad)} için yaz…" autocomplete="off" aria-label="Mesaj">
      <button class="dugme ince birincil">Gönder</button></form>`
      : `<p class="kucuk sohbet-engel">${esc(v.engel || '')}${/ayarın kapalı/.test(v.engel || '') ? ' · <button type="button" class="bag" data-s="ayar">Aç</button>' : ''}${/giriş/.test(v.engel || '') ? ' · <button type="button" class="bag" data-s="giris">Giriş yap</button>' : ''}</p>`}
    <p class="kucuk sohbet-not">Herkese açık kanal. Kişisel bilgilerini (telefon, adres, kimlik no) paylaşma.</p>`);
  const ol = $('#sohbetCekmece .sohbet-liste');
  if (asagi && ol) ol.scrollTop = ol.scrollHeight;
}

async function tik(e) {
  const b = e.target.closest('[data-s]');
  if (!b) return;
  if (b.dataset.s === 'kapat') return kapat();
  if (b.dataset.s === 'kanal') { aktif = b.dataset.kanal; return yukle(); }
  if (b.dataset.s === 'bildir') return ctx.sikayetAc('MESAJ', b.dataset.id, `${b.dataset.ad} adlı oyuncunun mesajı`);
  if (b.dataset.s === 'ayar') { await api('/api/hesap/ayarlar', { sohbet: true }).catch((err) => tost(err.message, 'hata')); return yukle(); }
  if (b.dataset.s === 'giris') return ctx.girisAc();
}
async function gonder(e) {
  e.preventDefault();
  const f = e.target;
  const metin = f.metin.value.trim();
  if (!metin) return;
  f.querySelector('button').disabled = true;
  try {
    const r = await api(`/api/sohbet/${encodeURIComponent(aktif)}`, { metin });
    f.metin.value = '';
    if (baglantiDurumu() !== 'acik') await yukle();
    if (r.isaretlendi) tost('Mesajın yayımlandı; otomatik tarama moderasyona işaretledi.');
  } catch (err) { tost(err.message, 'hata'); } finally { f.querySelector('button').disabled = false; f.metin.focus(); }
}
