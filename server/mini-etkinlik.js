// Mini etkinlikler: her hafta sonu (Türkiye saatiyle cuma–pazar) şablonlardan sırayla biri etkindir (hafta numarasına göre
// döner). Etkiler oyunun ilgili yerlerinde okunur: tpKat (ciftlik.tpEkle), tuccarKat (oyun.npcSat), buyumeKat (oyun.ek),
// balikEk (balik.js günlük olta hakkı). Bayram etkinlikleri (etkinlik.js) ayrıdır ve bunlarla birlikte sürebilir.
const { MINI_ETKINLIK: M, LIG } = require('./config/rules');

const TR = 3 * 3600_000, GUN = 86_400_000, HAFTA = 7 * GUN;
// Türkiye saatiyle haftanın günü (0 pazar) ve o günün başlangıcı
const trGun = (t) => new Date(t + TR).getUTCDay();
const gunBasi = (t) => Math.floor((t + TR) / GUN) * GUN - TR;

function aktif(t = Date.now()) {
  if (process.env.MINI_ETKINLIK === 'kapali' || !M.gunler.includes(trGun(t))) return null;   // testler gününden bağımsız olsun
  const s = M.sablonlar[Math.floor((t - LIG.baslangic) / HAFTA) % M.sablonlar.length];
  // Pazartesi 00:00'a kadar
  const kalanGun = (8 - trGun(t)) % 7 || 7;
  return { ...s, bitis: gunBasi(t) + kalanGun * GUN };
}
// Etkin değilse sıradaki (hafta içinde "bu hafta sonu: …" göstermek için)
function sonraki(t = Date.now()) {
  if (aktif(t)) return null;
  const cumaya = (5 - trGun(t) + 7) % 7;
  const bas = gunBasi(t) + cumaya * GUN;
  return { ...aktif(bas + 3600_000), baslangic: bas };
}
const kat = (alan, varsayilan = 1) => (t = Date.now()) => aktif(t)?.[alan] ?? varsayilan;

module.exports = { aktif, sonraki, tpKat: kat('tpKat'), tuccarKat: kat('tuccarKat'), buyumeKat: kat('buyumeKat'), balikEk: kat('balikEk', 0) };
