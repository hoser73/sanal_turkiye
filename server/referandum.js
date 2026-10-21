// İlçe referandumu (§6.6): sakinlerin gizli oyla yaptığı danışma oylaması. Başkan doğrudan açar; diğer sakinler önce imza toplar
// (sakinlerin %25'i). Oylama açılınca seçmen kütüğü dondurulur. Oy içeriği kimlikten ayrı saklanır (katılım ↔ makbuz özetli oy).
// Sonuç bağlayıcı değildir; belediye kararlarına yol gösterir ve herkese açık panoya yazılır. Katılım nisabı %30.
const crypto = require('crypto');
const db = require('./db');
const L = require('./lib/ledger');
const { REFERANDUM, SECIM } = require('./config/rules');
const { icerikDenetle } = require('./lib/icerik');
const { OyunHatasi } = L;

const simdi = () => Date.now();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const bildir = (userId, metin, link) => require('./pazar').bildir(userId, metin, link);
const SECENEKLER = ['EVET', 'HAYIR'];
const sakinler = (ilceId) => require('./secim').sakinler(SECIM.turler.BELEDIYE, ilceId);
const sakinMi = (ilceId, userId) => require('./secim').sakinMi(SECIM.turler.BELEDIYE, ilceId, userId);
const baskanMi = (ilceId, userId) => !!db.prepare(`SELECT 1 FROM belediye_uyeleri WHERE region_id = ? AND user_id = ? AND makam = 'BASKAN' AND baslangic <= ? AND bitis > ?`)
  .get(ilceId, userId, simdi(), simdi());

function oylamayaAc(r, t) {
  const kutuk = sakinler(r.region_id).length;
  db.prepare(`UPDATE referandumlar SET durum = 'OYLAMA', oylama_bas = ?, oylama_bitis = ?, kutuk = ? WHERE id = ? AND durum = 'IMZA'`).run(t, t + REFERANDUM.sureMs, kutuk, r.id);
  // Kütük: oylama başındaki sakinler (ayrı tablo yerine katılım kontrolünde sakinlik + açılış öncesi parsel şartı)
  db.prepare(`INSERT OR IGNORE INTO ayarlar (anahtar, deger) VALUES (?, ?)`).run(`ref_kutuk:${r.id}`, JSON.stringify(sakinler(r.region_id).map((s) => s.id)));
  L.denetim({ anahtar: `REFERENDUM_OPENED:${r.id}`, eylem: 'REFERENDUM_OPENED', varlik: `REF:${r.id}`, bolge: r.region_id, herkese: true, sonra: { soru: r.soru } });
  for (const s of sakinler(r.region_id)) bildir(s.id, `🗳️ Referandum oylaması açıldı: “${r.soru.slice(0, 80)}”`, `belediye:${r.region_id}`);
}

const baslat = db.transaction((userId, ilceId, govde = {}) => {
  const ilce = db.prepare(`SELECT id, name FROM regions WHERE id = ? AND type = 'ILCE'`).get(Number(ilceId));
  if (!ilce) throw new OyunHatasi(404, 'İlçe bulunamadı');
  if (!sakinMi(ilce.id, userId)) throw new OyunHatasi(403, 'Bu ilçede parselin olmalı');
  if (db.prepare(`SELECT 1 FROM referandumlar WHERE region_id = ? AND durum IN ('IMZA', 'OYLAMA')`).get(ilce.id)) throw new OyunHatasi(409, 'İlçede süren bir referandum var');
  const soru = typeof govde.soru === 'string' ? govde.soru.replace(/\s+/g, ' ').trim() : '';
  if (soru.length < REFERANDUM.soruMin || soru.length > REFERANDUM.soruMax || !soru.endsWith('?')) throw new OyunHatasi(400, `Soru ${REFERANDUM.soruMin}–${REFERANDUM.soruMax} karakter ve soru işaretiyle bitmeli`);
  const aciklama = typeof govde.aciklama === 'string' ? govde.aciklama.trim().slice(0, REFERANDUM.aciklamaMax) : null;
  for (const m of [soru, aciklama || '']) if (icerikDenetle(m).karar === 'ENGEL') throw new OyunHatasi(422, 'Metin kişisel veri içeriyor');
  const uygun = sakinler(ilce.id).length;
  const esik = Math.max(REFERANDUM.minImza, Math.ceil(uygun * REFERANDUM.imzaOrani));
  const t = simdi();
  const id = db.prepare(`INSERT INTO referandumlar (region_id, baslatan_id, soru, aciklama, esik, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(ilce.id, userId, soru, aciklama, esik, t).lastInsertRowid;
  db.prepare(`INSERT INTO referandum_imzalar (ref_id, user_id, created_at) VALUES (?, ?, ?)`).run(id, userId, t);
  L.denetim({ aktor: userId, eylem: 'REFERENDUM_PROPOSED', varlik: `REF:${id}`, bolge: ilce.id, herkese: true, sonra: { soru } });
  const r = db.prepare(`SELECT * FROM referandumlar WHERE id = ?`).get(id);
  if (baskanMi(ilce.id, userId)) oylamayaAc(r, t);   // başkan önerisi doğrudan oylamaya
  else for (const s of sakinler(ilce.id)) if (s.id !== userId) bildir(s.id, `İlçende referandum önerisi imza topluyor (${esik} imza gerekli).`, `belediye:${ilce.id}`);
  return { tamam: true, id, durum: db.prepare(`SELECT durum FROM referandumlar WHERE id = ?`).get(id).durum, esik };
});

const imzala = db.transaction((userId, refId) => {
  const r = db.prepare(`SELECT * FROM referandumlar WHERE id = ?`).get(Number(refId));
  if (!r || r.durum !== 'IMZA') throw new OyunHatasi(409, 'Bu öneri imzaya açık değil');
  if (!sakinMi(r.region_id, userId)) throw new OyunHatasi(403, 'Bu ilçede parselin olmalı');
  if (db.prepare(`INSERT OR IGNORE INTO referandum_imzalar (ref_id, user_id, created_at) VALUES (?, ?, ?)`).run(r.id, userId, simdi()).changes !== 1) throw new OyunHatasi(409, 'Zaten imzaladın');
  const imza = db.prepare(`SELECT COUNT(*) c FROM referandum_imzalar WHERE ref_id = ?`).get(r.id).c;
  if (imza >= r.esik) oylamayaAc(r, simdi());
  return { tamam: true, imza, esik: r.esik };
});

const oyVer = db.transaction((userId, refId, oy) => {
  const r = db.prepare(`SELECT * FROM referandumlar WHERE id = ?`).get(Number(refId));
  const t = simdi();
  if (!r || r.durum !== 'OYLAMA' || t >= r.oylama_bitis) throw new OyunHatasi(409, 'Oylama açık değil');
  if (!SECENEKLER.includes(oy)) throw new OyunHatasi(400, 'Oy EVET ya da HAYIR olmalı');
  const kutuk = JSON.parse(db.prepare(`SELECT deger FROM ayarlar WHERE anahtar = ?`).get(`ref_kutuk:${r.id}`)?.deger || '[]');
  if (!kutuk.includes(userId)) throw new OyunHatasi(403, 'Oylama açıldığında bu ilçenin sakini değildin');
  if (db.prepare(`INSERT OR IGNORE INTO referandum_katilim (ref_id, user_id) VALUES (?, ?)`).run(r.id, userId).changes !== 1) throw new OyunHatasi(409, 'Zaten oy kullandın');
  const makbuz = crypto.randomBytes(9).toString('base64url');
  db.prepare(`INSERT INTO referandum_oylari (makbuz_ozeti, ref_id, oy) VALUES (?, ?, ?)`).run(sha(`ref:${r.id}:${makbuz}`), r.id, oy);
  L.denetim({ aktor: userId, eylem: 'REFERENDUM_VOTE', varlik: `REF:${r.id}`, bolge: r.region_id });   // içerik yok, yalnızca katılım
  return { tamam: true, makbuz };
});
function makbuzDogrula(refId, makbuz) {
  return { dahil: !!db.prepare(`SELECT 1 FROM referandum_oylari WHERE makbuz_ozeti = ?`).get(sha(`ref:${Number(refId)}:${String(makbuz || '')}`)) };
}

function referandumBakim() {
  const t = simdi();
  for (const r of db.prepare(`SELECT * FROM referandumlar WHERE durum = 'OYLAMA' AND oylama_bitis <= ?`).all(t)) {
    db.transaction(() => {
      const oylar = Object.fromEntries(SECENEKLER.map((o) => [o, db.prepare(`SELECT COUNT(*) c FROM referandum_oylari WHERE ref_id = ? AND oy = ?`).get(r.id, o).c]));
      const katilim = db.prepare(`SELECT COUNT(*) c FROM referandum_katilim WHERE ref_id = ?`).get(r.id).c;
      const toplam = oylar.EVET + oylar.HAYIR;
      const nisap = Math.ceil((r.kutuk || 0) * REFERANDUM.nisapOrani);
      const butunluk = katilim === toplam;
      const durum = toplam >= Math.max(1, nisap) ? 'SONUCLANDI' : 'NISAP_YOK';
      const sonuc = { oylar, katilim, kutuk: r.kutuk, nisap, butunluk, kazanan: durum === 'SONUCLANDI' ? (oylar.EVET > oylar.HAYIR ? 'EVET' : oylar.HAYIR > oylar.EVET ? 'HAYIR' : 'ESIT') : null };
      if (db.prepare(`UPDATE referandumlar SET durum = ?, sonuc_json = ? WHERE id = ? AND durum = 'OYLAMA'`).run(durum, JSON.stringify(sonuc), r.id).changes !== 1) return;
      L.denetim({ anahtar: `REFERENDUM_CLOSED:${r.id}`, eylem: 'REFERENDUM_CLOSED', varlik: `REF:${r.id}`, bolge: r.region_id, herkese: true, sonra: { soru: r.soru, ...sonuc } });
      for (const s of sakinler(r.region_id)) bildir(s.id, `Referandum sonuçlandı: “${r.soru.slice(0, 60)}” → ${sonuc.kazanan ?? 'katılım nisabı sağlanamadı'}`, `belediye:${r.region_id}`);
    })();
  }
  db.prepare(`UPDATE referandumlar SET durum = 'DUSTU' WHERE durum = 'IMZA' AND created_at < ?`).run(t - REFERANDUM.sureMs);
}

function ilceReferandumlari(ilceId, userId) {
  return db.prepare(`SELECT r.*, u.display_name AS baslatan FROM referandumlar r JOIN users u ON u.id = r.baslatan_id WHERE r.region_id = ? ORDER BY r.id DESC LIMIT 5`).all(Number(ilceId))
    .map((r) => ({
      id: r.id, soru: r.soru, aciklama: r.aciklama, durum: r.durum, baslatan: r.baslatan, esik: r.esik, oylamaBitis: r.oylama_bitis,
      imza: db.prepare(`SELECT COUNT(*) c FROM referandum_imzalar WHERE ref_id = ?`).get(r.id).c,
      sonuc: r.sonuc_json ? JSON.parse(r.sonuc_json) : null,
      ben: userId ? {
        imzaladim: !!db.prepare(`SELECT 1 FROM referandum_imzalar WHERE ref_id = ? AND user_id = ?`).get(r.id, userId),
        oyKullandim: !!db.prepare(`SELECT 1 FROM referandum_katilim WHERE ref_id = ? AND user_id = ?`).get(r.id, userId),
        sakin: sakinMi(r.region_id, userId),
      } : null,
    }));
}

function rotalar(app, { h, auth }) {
  app.post('/api/belediye/:id/referandum', auth.dogrulanmisGerekli, h((req) => baslat(req.kullanici.id, req.params.id, req.body)));
  app.post('/api/referandum/:id/imza', auth.dogrulanmisGerekli, h((req) => imzala(req.kullanici.id, req.params.id)));
  app.post('/api/referandum/:id/oy', auth.dogrulanmisGerekli, h((req) => oyVer(req.kullanici.id, req.params.id, req.body?.oy)));
  app.post('/api/referandum/:id/makbuz', h((req) => makbuzDogrula(req.params.id, req.body?.makbuz)));
}

module.exports = { rotalar, baslat, imzala, oyVer, makbuzDogrula, referandumBakim, ilceReferandumlari };
