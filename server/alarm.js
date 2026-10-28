// Fiyat alarmı: oyuncu bir mahallenin değer endeksi için hedef koyar ("120'yi geçince" ya da "90'ın altına inince");
// endeks hedefe ulaşınca bir kez bildirim gider. Endeks günlük hesaplanır (piyasa.js); bakım dakikada bir denetler.
const db = require('./db');
const L = require('./lib/ledger');
const { OyunHatasi } = L;
const { FIYAT_ALARMI: A } = require('./config/rules');

db.exec(`CREATE TABLE IF NOT EXISTS fiyat_alarmlari (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), bolge_id INTEGER NOT NULL REFERENCES regions(id),
  yon TEXT NOT NULL, hedef REAL NOT NULL, created_at INTEGER NOT NULL, tetiklendi_at INTEGER
);
CREATE INDEX IF NOT EXISTS ix_alarm_acik ON fiyat_alarmlari(tetiklendi_at, user_id);
CREATE INDEX IF NOT EXISTS ix_alarm_bolge ON fiyat_alarmlari(bolge_id, tetiklendi_at)`);
const endeks = (bolgeId) => require('./piyasa').endeksSerisi('MAHALLE', bolgeId, 1).endeks;

const kur = db.transaction((userId, govde = {}) => {
  const bolgeId = Number(govde.bolgeId), hedef = Number(govde.hedef);
  const bolge = db.prepare(`SELECT id, name FROM regions WHERE id = ? AND type = 'MAHALLE'`).get(bolgeId);
  if (!bolge) throw new OyunHatasi(404, 'Mahalle bulunamadı');
  if (!(hedef > 0 && hedef < 10_000)) throw new OyunHatasi(400, 'Geçersiz hedef');
  const simdiki = endeks(bolgeId);
  if (simdiki == null) throw new OyunHatasi(409, 'Bu mahallenin henüz endeksi yok', 'ENDEKS_YOK');
  if (db.prepare('SELECT COUNT(*) AS c FROM fiyat_alarmlari WHERE user_id = ? AND tetiklendi_at IS NULL').get(userId).c >= A.maks) {
    throw new OyunHatasi(409, `En çok ${A.maks} açık alarm kurabilirsin`, 'SINIR');
  }
  const yon = hedef >= simdiki ? 'YUKARI' : 'ASAGI';
  const id = Number(db.prepare('INSERT INTO fiyat_alarmlari (user_id, bolge_id, yon, hedef, created_at) VALUES (?, ?, ?, ?, ?)').run(userId, bolgeId, yon, hedef, Date.now()).lastInsertRowid);
  return { tamam: true, id, yon, simdiki, mahalle: bolge.name };
});
function sil(userId, id) {
  if (db.prepare('DELETE FROM fiyat_alarmlari WHERE id = ? AND user_id = ?').run(Number(id), userId).changes !== 1) throw new OyunHatasi(404, 'Alarm bulunamadı');
  return { tamam: true };
}
function liste(userId) {
  return db.prepare(`SELECT a.id, a.bolge_id AS bolgeId, a.yon, a.hedef, a.tetiklendi_at AS tetiklendi, r.name AS mahalle FROM fiyat_alarmlari a
      JOIN regions r ON r.id = a.bolge_id WHERE a.user_id = ? ORDER BY a.tetiklendi_at IS NOT NULL, a.id DESC LIMIT 20`).all(userId)
    .map((a) => ({ ...a, simdiki: endeks(a.bolgeId) }));
}

let sonBakim = 0;
function alarmBakim(t = Date.now()) {
  if (t - sonBakim < 60_000) return;
  sonBakim = t;
  // Açık alarmı olan her mahallenin endeksi bir kez okunur; hedefe ulaşan alarmların hepsi (sınırsız) seçilir
  const ulasan = db.prepare(`SELECT a.*, r.name AS mahalle FROM fiyat_alarmlari a JOIN regions r ON r.id = a.bolge_id
    WHERE a.bolge_id = ? AND a.tetiklendi_at IS NULL AND ((a.yon = 'YUKARI' AND a.hedef <= ?) OR (a.yon = 'ASAGI' AND a.hedef >= ?))`);
  for (const { bolge_id: bolge } of db.prepare('SELECT DISTINCT bolge_id FROM fiyat_alarmlari WHERE tetiklendi_at IS NULL').all()) {
    const e = endeks(bolge);
    if (e == null) continue;
    for (const a of ulasan.all(bolge, e, e)) {
      if (db.prepare('UPDATE fiyat_alarmlari SET tetiklendi_at = ? WHERE id = ? AND tetiklendi_at IS NULL').run(t, a.id).changes !== 1) continue;
      require('./pazar').bildir(a.user_id, `🔔 ${a.mahalle} endeksi ${Math.round(e * 10) / 10} oldu (hedefin ${a.hedef}).`, 'pazar:endeks');
    }
  }
}

function rotalar(app, { h, auth }) {
  app.get('/api/alarm', auth.girisGerekli, h((req) => liste(req.kullanici.id)));
  app.post('/api/alarm', auth.girisGerekli, h((req) => kur(req.kullanici.id, req.body || {})));
  app.post('/api/alarm/:id/sil', auth.girisGerekli, h((req) => sil(req.kullanici.id, req.params.id)));
}

module.exports = { rotalar, kur, sil, liste, alarmBakim };
