// İlk giriş sihirbazı: oyunu hiç bilmeyen yeni oyuncuyu adım adım yönlendirir. Önce bir arsa seçip sahibi olur
// (baslangic.js: yer seç → 3 aday → hediye), sonra çiftliğinde ilk işleri yapar: ek → sula → hasat → pazarda sat →
// ilk yapı → günlük görevler. Her adımın tamamlanması denetim kayıtlarından (audit_events) okunur; adım ödülü bir kez
// verilir. İlk ekin sihirbaz sürerken 1 dakikada olgunlaşır (oyun.js ek). Oyuncu her an "Atla" diyebilir.
const db = require('./db');
const { metin } = require('./lib/girdi');
const L = require('./lib/ledger');
const { OyunHatasi } = L;

const SIHIRBAZ = {
  ilkEkinMs: 60_000,   // sihirbazdaki ilk ekin bu sürede olgunlaşır
  adimlar: [
    { kod: 'ARSA', eylem: 'PARCEL_ACQUIRED', odul: 0 },
    { kod: 'EKIM', eylem: 'CROP_PLANTED', odul: 20 },
    { kod: 'SULAMA', eylem: 'CROP_WATERED', odul: 10, istege: true },   // yağmur/komşu da sular, sulamadan hasat da olur
    { kod: 'HASAT', eylem: 'CROP_HARVESTED', odul: 25 },
    { kod: 'SATIS', eylem: 'TRADE_SETTLED', odul: 20 },
    { kod: 'YAPI', eylem: 'STRUCTURE_STARTED', odul: 30 },
    { kod: 'GUNLUK', eylem: null, odul: 50 },   // günlük görevleri görmek (istemci bildirir); son adım
  ],
};

const q = {
  kullanici: db.prepare(`SELECT id, is_npc, sihirbaz_bitti_at FROM users WHERE id = ?`),
  eylemVar: db.prepare(`SELECT 1 FROM audit_events WHERE actor_id = ? AND action = ? LIMIT 1`),
  parselVar: db.prepare(`SELECT 1 FROM parcels WHERE owner_user_id = ? LIMIT 1`),
  sulandi: db.prepare(`SELECT 1 FROM crops WHERE user_id = ? AND waterings > 0 LIMIT 1`),
  oduller: db.prepare(`SELECT adim FROM sihirbaz_odulleri WHERE user_id = ?`),
  odulYaz: db.prepare(`INSERT OR IGNORE INTO sihirbaz_odulleri (user_id, adim, tutar, created_at) VALUES (?, ?, ?, ?)`),
  bitir: db.prepare(`UPDATE users SET sihirbaz_bitti_at = ? WHERE id = ? AND sihirbaz_bitti_at IS NULL`),
};

const aktifMi = (userId) => { const u = q.kullanici.get(userId); return !!u && !u.is_npc && !u.sihirbaz_bitti_at; };
// Sihirbaz sürerken oyuncunun ilk ekimi mi (oyun.js ek: ilk ekin hızlı büyür)
const hizliIlkEkin = (userId) => aktifMi(userId) && !q.eylemVar.get(userId, 'CROP_PLANTED');

function adimTamam(userId, adim) {
  if (adim.kod === 'ARSA') return !!q.parselVar.get(userId);
  if (adim.kod === 'SULAMA' && q.sulandi.get(userId)) return true;
  return adim.eylem ? !!q.eylemVar.get(userId, adim.eylem) : false;
}

function durum(userId) {
  const u = q.kullanici.get(userId);
  if (!u) throw new OyunHatasi(404, 'Kullanıcı yok');
  const alinan = new Set(q.oduller.all(userId).map((r) => r.adim));
  const adimlar = SIHIRBAZ.adimlar.map((a) => ({ kod: a.kod, odul: a.odul, tamam: alinan.has(a.kod) || adimTamam(userId, a), alindi: alinan.has(a.kod) }));
  return { aktif: !u.is_npc && !u.sihirbaz_bitti_at, bitti: !!u.sihirbaz_bitti_at, ilkEkinMs: SIHIRBAZ.ilkEkinMs, adimlar };
}

const ADIM_ADI = { ARSA: 'arsa', EKIM: 'ilk ekim', SULAMA: 'ilk sulama', HASAT: 'ilk hasat', SATIS: 'ilk satış', YAPI: 'ilk yapı', GUNLUK: 'günlük görevler' };
// Adım ödülü: adım gerçekten yapıldıysa bir kez. GUNLUK son adımdır: ödülle birlikte sihirbaz biter.
const odulAl = db.transaction((userId, kod) => {
  const adim = SIHIRBAZ.adimlar.find((a) => a.kod === kod);
  if (!adim) throw new OyunHatasi(400, 'Bilinmeyen adım');
  if (!aktifMi(userId)) throw new OyunHatasi(409, 'Sihirbaz bitti', 'BITTI');
  if (adim.eylem && !adimTamam(userId, adim)) throw new OyunHatasi(409, 'Bu adım henüz yapılmadı', 'YAPILMADI');
  if (kod === 'GUNLUK' && SIHIRBAZ.adimlar.some((a) => a.eylem && !a.istege && !adimTamam(userId, a))) throw new OyunHatasi(409, 'Önceki adımlar bitmedi', 'YAPILMADI');
  // Silinmiş bir hesabın kimliğiyle açılan hesap adımları yapar ama akçe ödülü almaz
  const tutar = require('./auth').tekrarHesapMi(userId) ? 0 : adim.odul;
  if (q.odulYaz.run(userId, kod, tutar, Date.now()).changes !== 1) return { tamam: true, odul: 0, tekrar: true };
  if (tutar > 0) L.odul(userId, tutar, `Tanıtım ödülü: ${ADIM_ADI[kod] || kod}`);
  if (kod === 'GUNLUK') q.bitir.run(Date.now(), userId);
  return { tamam: true, odul: tutar, bitti: kod === 'GUNLUK' };
});

function bitir(userId) {
  q.bitir.run(Date.now(), userId);
  return { tamam: true };
}

function rotalar(app, { h, auth }) {
  app.get('/api/sihirbaz', auth.girisGerekli, h((req) => durum(req.kullanici.id)));
  app.post('/api/sihirbaz/odul', auth.girisGerekli, h((req) => odulAl(req.kullanici.id, metin(req.body?.adim))));
  app.post('/api/sihirbaz/bitir', auth.girisGerekli, h((req) => bitir(req.kullanici.id)));
}

module.exports = { rotalar, SIHIRBAZ, aktifMi, hizliIlkEkin, durum, odulAl, bitir };
