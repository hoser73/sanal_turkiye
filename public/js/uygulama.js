// iOS uygulaması (Flutter kabuğu) içinde çalışırken: kabuk sayfaya `StMobil` kanalını ekler. Uygulamada
// <html class="uygulama"> olur (uzun basınca metin seçimi ve büyüteç kapanır, sayfa yakınlaştırılamaz) ve
// oyun olaylarında telefon titreşimle geri bildirim verir. Tarayıcıda hiçbir şey değişmez.
export const uygulamada = typeof window !== 'undefined' && !!window.StMobil;

if (uygulamada) {
  document.documentElement.classList.add('uygulama');
  const v = document.querySelector('meta[name="viewport"]');
  if (v) v.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
}

// guc: hafif | orta | agir | secim
export function titret(guc = 'hafif') {
  if (!uygulamada) return;
  try { window.StMobil.postMessage(JSON.stringify({ tur: 'titresim', guc })); } catch { /* kabuk kapandı */ }
}
