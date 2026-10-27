// Canlı bağlantı istemcisi: WebSocket (/canli) ile bildirim, oyun olayı ve sohbet mesajı alır; kopunca artan beklemeyle
// yeniden bağlanır. Ayrıca servis çalışanını (PWA) kaydeder ve isteğe bağlı web push aboneliğini yönetir.
const dinleyiciler = { bildirim: [], olay: [], sohbet: [], cevrimici: [], durum: [] };
let ws = null, bekleme = 1000, kanallar = [], baglanti = 'kapali';

export const canliDinle = (tur, fn) => dinleyiciler[tur].push(fn);
const yay = (tur, v) => dinleyiciler[tur].forEach((fn) => { try { fn(v); } catch (e) { console.error(e); } });
export const baglantiDurumu = () => baglanti;

export function canliBaslat() {
  if (ws && ws.readyState <= 1) return;
  const bu = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/canli`);
  ws = bu;
  ws.addEventListener('open', () => { bekleme = 1000; baglanti = 'acik'; yay('durum', baglanti); if (kanallar.length) gonder({ tip: 'abone', kanallar }); });
  ws.addEventListener('message', (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (dinleyiciler[m.tip]) yay(m.tip, m);
  });
  ws.addEventListener('close', () => {
    if (ws !== bu) return;   // yenilenmiş (eski) bağlantının kapanışı yenisini "çevrimdışı" göstermesin
    baglanti = 'kapali'; yay('durum', baglanti);
    setTimeout(canliBaslat, bekleme + Math.random() * 500);
    bekleme = Math.min(bekleme * 2, 30_000);
  });
}
// Giriş/çıkışta kimlik değişir: bağlantıyı yenile
export function canliYenile() { const eski = ws; ws = null; if (eski) { try { eski.close(); } catch { /* yok */ } } canliBaslat(); }
function gonder(v) { if (ws?.readyState === 1) ws.send(JSON.stringify(v)); }
export function kanallaraAbone(liste) {
  kanallar = [...new Set(liste.filter(Boolean))];
  gonder({ tip: 'abone', kanallar });
}

// ---------- PWA ve web push
export async function servisCalisaniKaydet(gitFn) {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const ilkKontrol = !!navigator.serviceWorker.controller;
    const kayit = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
    navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.tip === 'git' && e.data.link) gitFn(e.data.link); });
    // Yeni sürüm yayımlanınca açık sekmeler eski kodla kalmasın: yeni servis çalışanı devralınca sayfa bir kez yenilenir
    // (ilk kurulumda değil). Uzun süre açık kalan sekmeler için yarım saatte bir sürüm denetlenir.
    let yenilendi = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!ilkKontrol || yenilendi) return;
      yenilendi = true;
      location.reload();
    });
    setInterval(() => { if (!document.hidden) kayit.update().catch(() => {}); }, 30 * 60_000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) kayit.update().catch(() => {}); });
    return kayit;
  } catch (e) { console.warn('Servis çalışanı kaydedilemedi', e); return null; }
}
const b64 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };
export const pushDestekli = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export async function pushDurumu() {
  if (!pushDestekli()) return 'desteklenmiyor';
  if (Notification.permission === 'denied') return 'engellendi';
  const kayit = await navigator.serviceWorker.getRegistration();
  return (await kayit?.pushManager.getSubscription()) ? 'acik' : 'kapali';
}
export async function pushAc(api) {
  const izin = await Notification.requestPermission();
  if (izin !== 'granted') throw new Error('Bildirim izni verilmedi');
  const kayit = await navigator.serviceWorker.ready;
  const { publicKey } = await api('/api/push/anahtar');
  const ab = await kayit.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(publicKey) });
  await api('/api/push/abone', { abonelik: ab.toJSON() });
}
export async function pushKapat(api) {
  const kayit = await navigator.serviceWorker.getRegistration();
  const ab = await kayit?.pushManager.getSubscription();
  if (ab) { await api('/api/push/iptal', { endpoint: ab.endpoint }).catch(() => {}); await ab.unsubscribe(); }
}
