// Fiyat alarmı: oyuncu bir mahallenin değer endeksi için hedef koyar ("120'yi geçince" ya da "90'ın altına inince");
// endeks hedefe ulaşınca bir kez bildirim gider. Endeks günlük hesaplanır (piyasa.js); bakım dakikada bir denetler.
const db = require('./db');
const L = require('./lib/ledger');
const { OyunHatasi } = L;
const { FIYAT_ALARMI: A } = require('./config/rules');

const endeks = async (bolgeId) => (await require('./piyasa').endeksSerisi('MAHALLE', bolgeId, 1)).endeks;

const kur = (userId, govde = {}) => db.tx(async () => {
  const bolgeId = Number(govde.bolgeId), hedef = Number(govde.hedef);
  const bolge = await db.get(`SELECT id, name FROM regions WHERE id = ? AND type = 'MAHALLE'`, bolgeId);
  if (!bolge) throw new OyunHatasi(404, 'Mahalle bulunamadı');
  if (!(hedef > 0 && hedef < 10_000)) throw new OyunHatasi(400, 'Geçersiz hedef');
  const simdiki = await endeks(bolgeId);
  if (simdiki == null) throw new OyunHatasi(409, 'Bu mahallenin henüz endeksi yok', 'ENDEKS_YOK');
  await db.kilit(`alarm:${userId}`);   // açık alarm sınırı eşzamanlı isteklerle aşılmasın
  if ((await db.get('SELECT COUNT(*) AS c FROM fiyat_alarmlari WHERE user_id = ? AND tetiklendi_at IS NULL', userId)).c >= A.maks) {
    throw new OyunHatasi(409, `En çok ${A.maks} açık alarm kurabilirsin`, 'SINIR');
  }
  const yon = hedef >= simdiki ? 'YUKARI' : 'ASAGI';
  const id = Number((await db.run('INSERT INTO fiyat_alarmlari (user_id, bolge_id, yon, hedef, created_at) VALUES (?, ?, ?, ?, ?)', userId, bolgeId, yon, hedef, Date.now())).lastInsertRowid);
  return { tamam: true, id, yon, simdiki, mahalle: bolge.name };
});
async function sil(userId, id) {
  if ((await db.run('DELETE FROM fiyat_alarmlari WHERE id = ? AND user_id = ?', Number(id), userId)).changes !== 1) throw new OyunHatasi(404, 'Alarm bulunamadı');
  return { tamam: true };
}
async function liste(userId) {
  // Açık alarmlar önce (tetiklenenler sona): CASE iki motorda da aynı sıralar
  const satirlar = await db.all(`SELECT a.id, a.bolge_id AS bolgeId, a.yon, a.hedef, a.tetiklendi_at AS tetiklendi, r.name AS mahalle FROM fiyat_alarmlari a
      JOIN regions r ON r.id = a.bolge_id WHERE a.user_id = ? ORDER BY CASE WHEN a.tetiklendi_at IS NULL THEN 0 ELSE 1 END, a.id DESC LIMIT 20`, userId);
  const sonuc = [];
  for (const a of satirlar) sonuc.push({ ...a, simdiki: await endeks(a.bolgeId) });
  return sonuc;
}

let sonBakim = 0;
async function alarmBakim(t = Date.now()) {
  if (t - sonBakim < 60_000) return;
  sonBakim = t;
  // Açık alarmı olan her mahallenin endeksi bir kez okunur; hedefe ulaşan alarmların hepsi (sınırsız) seçilir
  const ulasan = db.sorgu(`SELECT a.*, r.name AS mahalle FROM fiyat_alarmlari a JOIN regions r ON r.id = a.bolge_id
    WHERE a.bolge_id = ? AND a.tetiklendi_at IS NULL AND ((a.yon = 'YUKARI' AND a.hedef <= ?) OR (a.yon = 'ASAGI' AND a.hedef >= ?))`);
  for (const { bolge_id: bolge } of await db.all('SELECT DISTINCT bolge_id FROM fiyat_alarmlari WHERE tetiklendi_at IS NULL')) {
    const e = await endeks(bolge);
    if (e == null) continue;
    for (const a of await ulasan.all(bolge, e, e)) {
      // Koşullu yazma: alarm bir kez tetiklenir, bildirim bir kez gider
      await db.tx(async () => {
        if ((await db.run('UPDATE fiyat_alarmlari SET tetiklendi_at = ? WHERE id = ? AND tetiklendi_at IS NULL', t, a.id)).changes !== 1) return;
        await require('./pazar').bildir(a.user_id, `🔔 ${a.mahalle} endeksi ${Math.round(e * 10) / 10} oldu (hedefin ${a.hedef}).`, 'pazar:endeks');
      });
    }
  }
}

function rotalar(app, { h, auth }) {
  app.get('/api/alarm', auth.girisGerekli, h((req) => liste(req.kullanici.id)));
  app.post('/api/alarm', auth.girisGerekli, h((req) => kur(req.kullanici.id, req.body || {})));
  app.post('/api/alarm/:id/sil', auth.girisGerekli, h((req) => sil(req.kullanici.id, req.params.id)));
}

module.exports = { rotalar, kur, sil, liste, alarmBakim };
