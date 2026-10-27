// Emoji yedeği: oyun arayüzünde simge olarak çok sayıda emoji kullanır. Cihaz emoji yazı tipini çizemiyorsa (iOS
// Simülatörü, bazı eski Android/Windows sürümleri) emojiler "?" kutusu olur. Açılışta küçük bir tuval testiyle bu
// anlaşılır; çizilemiyorsa sayfadaki emojiler /emoji/ altındaki Twemoji SVG görselleriyle (CC-BY 4.0) değiştirilir ve
// sonradan eklenen içerik de MutationObserver ile izlenir. Çizebilen cihazlarda hiçbir şey değişmez.
// Elle denemek için: localStorage 'st-emoji-yedek' = '1'.

// Emoji yazı tipi gerektiren diziler: bayraklar, varsayılan emoji görünümlüler, FE0F ile emojiye çevrilenler ve
// ⏩–⏺ oynatma düğmeleri (FE0F olmadan da normal yazı tiplerinde karşılıkları yok)
const RE = /\p{RI}\p{RI}|(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}️|[⏩-⏺])\p{EMod}?(?:‍\p{Extended_Pictographic}️?\p{EMod}?)*/gu;
const ATLA = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'NOSCRIPT', 'CANVAS', 'svg', 'CODE']);

// Twemoji dosya adı: kod noktaları onaltılık, '-' ile; birleştiricisiz dizide FE0F atılır
const dosyaAdi = (e) => {
  const cp = [...e].map((c) => c.codePointAt(0)), zwj = cp.includes(0x200d);
  return cp.filter((c) => zwj || c !== 0xfe0f).map((c) => c.toString(16)).join('-');
};

function cizebiliyor() {
  try {
    const c = document.createElement('canvas'); c.width = c.height = 24;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.textBaseline = 'top'; x.font = '20px sans-serif'; x.fillText('🌾', 0, 0);
    const d = x.getImageData(0, 0, 24, 24).data;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 100 && (Math.abs(d[i] - d[i + 1]) > 30 || Math.abs(d[i + 1] - d[i + 2]) > 30)) return true;   // renkli piksel var
    return false;
  } catch { return true; }
}

let etkin = false;
export const emojiYedekte = () => etkin;

function metniIsle(dugum) {
  const metin = dugum.nodeValue;
  RE.lastIndex = 0;
  if (!RE.test(metin)) return;
  const ust = dugum.parentNode;
  if (!ust) return;
  // <option> görsel taşıyamaz: emoji atılır (yoksa "?" kalır)
  if (ust.nodeName === 'OPTION') { dugum.nodeValue = metin.replace(RE, '').replace(/^\s+/, ''); return; }
  const parca = document.createDocumentFragment();
  let son = 0;
  RE.lastIndex = 0;
  for (const m of metin.matchAll(RE)) {
    if (m.index > son) parca.append(metin.slice(son, m.index));
    const img = document.createElement('img');
    img.className = 'emo'; img.alt = m[0]; img.draggable = false; img.decoding = 'async';
    img.src = `/emoji/${dosyaAdi(m[0])}.svg`;
    img.onerror = () => img.replaceWith(m[0]);   // görseli olmayan emoji metin olarak kalır
    parca.append(img);
    son = m.index + m[0].length;
  }
  if (son < metin.length) parca.append(metin.slice(son));
  ust.replaceChild(parca, dugum);
}
function agaciIsle(kok) {
  if (kok.nodeType === 3) { if (!ATLA.has(kok.parentNode?.nodeName) && !kok.parentNode?.isContentEditable) metniIsle(kok); return; }
  if (kok.nodeType !== 1 || ATLA.has(kok.nodeName) || kok.isContentEditable) return;
  const gezgin = document.createTreeWalker(kok, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (ATLA.has(n.parentNode.nodeName) || n.parentNode.closest?.('[contenteditable="true"]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const liste = [];
  for (let n = gezgin.nextNode(); n; n = gezgin.nextNode()) liste.push(n);
  liste.forEach(metniIsle);
}

export function emojiYedeginiKur() {
  let zorla = false;
  try { zorla = localStorage.getItem('st-emoji-yedek') === '1'; } catch { /* özel pencere */ }
  if (!zorla && cizebiliyor()) return;
  etkin = true;
  document.documentElement.classList.add('emoji-yedek');
  agaciIsle(document.body);
  new MutationObserver((kayitlar) => {
    for (const k of kayitlar) {
      if (k.type === 'characterData') { if (k.target.parentNode) agaciIsle(k.target); continue; }
      for (const n of k.addedNodes) agaciIsle(n);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
}

// ---------- Tuvale çizilen emojiler (harita simgeleri, 3B tabelalar, balık oyunu)
const gorseller = new Map();
// Emojinin yüklenmiş görseli ya da null; yüklenmemişse yüklenince hazir() bir kez çağrılır
export function emojiGorseli(e, hazir) {
  let k = gorseller.get(e);
  if (!k) {
    const img = new Image();
    k = { img, yuklendi: false, hata: false, bekleyen: [] };
    img.onload = () => { k.yuklendi = true; k.bekleyen.splice(0).forEach((f) => f()); };
    img.onerror = () => { k.hata = true; k.bekleyen.length = 0; };
    img.src = `/emoji/${dosyaAdi(e)}.svg`;
    gorseller.set(e, k);
  }
  if (k.yuklendi) return k.img;
  if (hazir && !k.hata) k.bekleyen.push(hazir);
  return null;
}
// Tuvalde (x, y) merkezli emoji: yedek etkinse SVG görsel (boyut piksel kare), değilse çağıranın yazı tipiyle fillText
export function emojiCiz(g, emoji, x, y, boyut, hazir) {
  if (!etkin) { g.fillText(emoji, x, y); return; }
  const img = emojiGorseli(emoji, hazir);
  const yy = g.textBaseline === 'middle' ? y : y - boyut * 0.38;   // yazı taban çizgisine göre verilen y → görsel merkezi
  if (img) g.drawImage(img, x - boyut / 2, yy - boyut / 2, boyut, boyut);
}
