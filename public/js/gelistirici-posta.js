// Geliştirme posta kutusu: SMTP yokken giden iletileri listeler; bağlantılar tıklanabilir.
import { api, esc, zamanOnce } from './yardimci.js';

const bagla = (metin) => esc(metin).replace(/(https?:\/\/[^\s]+)/g, '<a href="$1">$1</a>');
async function yukle() {
  const el = document.getElementById('liste');
  try {
    const p = await api('/api/gelistirici/posta');
    el.innerHTML = p.length ? p.map((m) => `<div class="kart"><b>${esc(m.konu)}</b><div class="kucuk">${esc(m.alici)} · ${esc(zamanOnce(m.created_at))}</div>
      <div class="posta">${bagla(m.govde)}</div></div>`).join('') : '<p class="kucuk">Henüz ileti yok.</p>';
  } catch (e) { el.innerHTML = `<p>${esc(e.message)}</p>`; }
}
yukle();
setInterval(yukle, 5000);
