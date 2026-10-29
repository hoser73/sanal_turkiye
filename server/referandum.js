// İlçe referandumu (§6.6): sakinlerin gizli oyla yaptığı danışma oylaması. Başkan doğrudan açar; diğer sakinler önce imza toplar
// (sakinlerin %25'i). Oylama açılınca seçmen kütüğü dondurulur. Oy içeriği kimlikten ayrı saklanır (katılım ↔ makbuz özetli oy).
// Sonuç bağlayıcı değildir; belediye kararlarına yol gösterir ve herkese açık panoya yazılır. Katılım nisabı %30.
// Oylama kapanınca (sayımla aynı işlemde) oy sandığı karıştırılır (db.sandigiKaristir; yalnızca Postgres'te iş yapar).
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
const sqlMs = (s) => new Date(String(s).replace(' ', 'T') + 'Z').getTime();
// İmza ve kütük hakkı: ilçede parseli olan ve hesabı seçmen kütüğündeki gibi yeterince eski sakinler (çoklu hesap önlemi)
const uygunSakinler = async (ilceId, t = simdi()) => (await sakinler(ilceId)).filter((s) => sqlMs(s.created_at) <= t - SECIM.secmenMinHesapYasiMs);
const uygunMu = async (ilceId, userId) => (await uygunSakinler(ilceId)).some((s) => s.id === userId);
const UYGUN_DEGIL = `Bu ilçede parselin ve en az ${Math.max(1, Math.round(SECIM.secmenMinHesapYasiMs / SECIM.gunMs))} günlük hesabın olmalı`;
const kutukGetir = async (refId) => JSON.parse((await db.get(`SELECT deger FROM ayarlar WHERE anahtar = ?`, `ref_kutuk:${refId}`))?.deger || '[]');
const baskanMi = async (ilceId, userId) => !!await db.get(`SELECT 1 FROM belediye_uyeleri WHERE region_id = ? AND user_id = ? AND makam = 'BASKAN' AND baslangic <= ? AND bitis > ?`,
  ilceId, userId, simdi(), simdi());

// İşlem içinde çağrılır (baslat / imzala); geçiş koşulludur (durum = 'IMZA')
async function oylamayaAc(r, t) {
  const kutuk = await uygunSakinler(r.region_id, t);
  if ((await db.run(`UPDATE referandumlar SET durum = 'OYLAMA', oylama_bas = ?, oylama_bitis = ?, kutuk = ? WHERE id = ? AND durum = 'IMZA'`,
    t, t + REFERANDUM.sureMs, kutuk.length, r.id)).changes !== 1) return;
  // Kütük: oylama başında ilçede parseli olan ve hesabı yeterince eski sakinler (ayarlar tablosunda dondurulur)
  await db.run(`INSERT OR IGNORE INTO ayarlar (anahtar, deger) VALUES (?, ?)`, `ref_kutuk:${r.id}`, JSON.stringify(kutuk.map((s) => s.id)));
  await L.denetim({ anahtar: `REFERENDUM_OPENED:${r.id}`, eylem: 'REFERENDUM_OPENED', varlik: `REF:${r.id}`, bolge: r.region_id, herkese: true, sonra: { soru: r.soru } });
  for (const s of kutuk) await bildir(s.id, `🗳️ Referandum oylaması açıldı: “${r.soru.slice(0, 80)}”`, `belediye:${r.region_id}`);
}

const baslat = (userId, ilceId, govde = {}) => db.tx(async () => {
  const ilce = await db.get(`SELECT id, name FROM regions WHERE id = ? AND type = 'ILCE'`, Number(ilceId));
  if (!ilce) throw new OyunHatasi(404, 'İlçe bulunamadı');
  if (!await uygunMu(ilce.id, userId)) throw new OyunHatasi(403, UYGUN_DEGIL);
  // İlçede aynı anda tek referandum: denetim ile ekleme arasına başka öneri girmesin
  await db.kilit(`referandum:ilce:${ilce.id}`);
  if (await db.get(`SELECT 1 FROM referandumlar WHERE region_id = ? AND durum IN ('IMZA', 'OYLAMA')`, ilce.id)) throw new OyunHatasi(409, 'İlçede süren bir referandum var');
  const soru = typeof govde.soru === 'string' ? govde.soru.replace(/\s+/g, ' ').trim() : '';
  if (soru.length < REFERANDUM.soruMin || soru.length > REFERANDUM.soruMax || !soru.endsWith('?')) throw new OyunHatasi(400, `Soru ${REFERANDUM.soruMin}–${REFERANDUM.soruMax} karakter ve soru işaretiyle bitmeli`);
  const aciklama = typeof govde.aciklama === 'string' ? govde.aciklama.trim().slice(0, REFERANDUM.aciklamaMax) : null;
  for (const m of [soru, aciklama || '']) if (icerikDenetle(m).karar === 'ENGEL') throw new OyunHatasi(422, 'Metin kişisel veri içeriyor');
  const uygun = (await uygunSakinler(ilce.id, simdi())).length;
  const esik = Math.max(REFERANDUM.minImza, Math.ceil(uygun * REFERANDUM.imzaOrani));
  const t = simdi();
  const id = (await db.run(`INSERT INTO referandumlar (region_id, baslatan_id, soru, aciklama, esik, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ilce.id, userId, soru, aciklama, esik, t)).lastInsertRowid;
  await db.run(`INSERT INTO referandum_imzalar (ref_id, user_id, created_at) VALUES (?, ?, ?)`, id, userId, t);
  await L.denetim({ aktor: userId, eylem: 'REFERENDUM_PROPOSED', varlik: `REF:${id}`, bolge: ilce.id, herkese: true, sonra: { soru } });
  const r = await db.get(`SELECT * FROM referandumlar WHERE id = ?`, id);
  if (await baskanMi(ilce.id, userId)) await oylamayaAc(r, t);   // başkan önerisi doğrudan oylamaya
  else for (const s of await sakinler(ilce.id)) if (s.id !== userId) await bildir(s.id, `İlçende referandum önerisi imza topluyor (${esik} imza gerekli).`, `belediye:${ilce.id}`);
  return { tamam: true, id, durum: (await db.get(`SELECT durum FROM referandumlar WHERE id = ?`, id)).durum, esik };
});

const imzala = (userId, refId) => db.tx(async () => {
  // Satır kilitlenir: eşik sayımı ve oylamaya açılış eşzamanlı imzalarla yarışmasın
  const no = Number(refId);
  const r = Number.isFinite(no) ? await db.get(`SELECT * FROM referandumlar WHERE id = ? FOR UPDATE`, no) : null;
  if (!r || r.durum !== 'IMZA') throw new OyunHatasi(409, 'Bu öneri imzaya açık değil');
  if (!await uygunMu(r.region_id, userId)) throw new OyunHatasi(403, UYGUN_DEGIL);
  if ((await db.run(`INSERT OR IGNORE INTO referandum_imzalar (ref_id, user_id, created_at) VALUES (?, ?, ?)`, r.id, userId, simdi())).changes !== 1) throw new OyunHatasi(409, 'Zaten imzaladın');
  const imza = (await db.get(`SELECT COUNT(*) c FROM referandum_imzalar WHERE ref_id = ?`, r.id)).c;
  if (imza >= r.esik) await oylamayaAc(r, simdi());
  return { tamam: true, imza, esik: r.esik };
});

const oyVer = (userId, refId, oy) => db.tx(async () => {
  // Paylaşımlı kilit: oylama kapanışı (referandumBakim, FOR UPDATE) süren oyların bitmesini bekler
  const no = Number(refId);
  const r = Number.isFinite(no) ? await db.get(`SELECT * FROM referandumlar WHERE id = ? FOR SHARE`, no) : null;
  const t = simdi();
  if (!r || r.durum !== 'OYLAMA' || t >= r.oylama_bitis) throw new OyunHatasi(409, 'Oylama açık değil');
  if (!SECENEKLER.includes(oy)) throw new OyunHatasi(400, 'Oy EVET ya da HAYIR olmalı');
  if (!(await kutukGetir(r.id)).includes(userId)) throw new OyunHatasi(403, 'Oylama açıldığında bu ilçenin seçmen kütüğünde değildin');
  if ((await db.run(`INSERT OR IGNORE INTO referandum_katilim (ref_id, user_id) VALUES (?, ?)`, r.id, userId)).changes !== 1) throw new OyunHatasi(409, 'Zaten oy kullandın');
  const makbuz = crypto.randomBytes(9).toString('base64url');
  await db.run(`INSERT INTO referandum_oylari (makbuz_ozeti, ref_id, oy) VALUES (?, ?, ?)`, sha(`ref:${r.id}:${makbuz}`), r.id, oy);
  await L.denetim({ aktor: userId, eylem: 'REFERENDUM_VOTE', varlik: `REF:${r.id}`, bolge: r.region_id });   // içerik yok, yalnızca katılım
  return { tamam: true, makbuz };
});
async function makbuzDogrula(refId, makbuz) {
  return { dahil: !!await db.get(`SELECT 1 FROM referandum_oylari WHERE makbuz_ozeti = ?`, sha(`ref:${Number(refId)}:${String(makbuz || '')}`)) };
}

async function referandumBakim() {
  const t = simdi();
  for (const { id } of await db.all(`SELECT id FROM referandumlar WHERE durum = 'OYLAMA' AND oylama_bitis <= ?`, t)) {
    await db.tx(async () => {
      // Satır kilitlenir (oy verme paylaşımlı kilitle bekler); geçiş ayrıca koşullu yazılır
      const r = await db.get(`SELECT * FROM referandumlar WHERE id = ? FOR UPDATE`, id);
      if (!r || r.durum !== 'OYLAMA') return;
      const oylar = {};
      for (const o of SECENEKLER) oylar[o] = (await db.get(`SELECT COUNT(*) c FROM referandum_oylari WHERE ref_id = ? AND oy = ?`, r.id, o)).c;
      const katilim = (await db.get(`SELECT COUNT(*) c FROM referandum_katilim WHERE ref_id = ?`, r.id)).c;
      const toplam = oylar.EVET + oylar.HAYIR;
      const nisap = Math.ceil((r.kutuk || 0) * REFERANDUM.nisapOrani);
      const butunluk = katilim === toplam;
      const durum = toplam >= Math.max(1, nisap) ? 'SONUCLANDI' : 'NISAP_YOK';
      const sonuc = { oylar, katilim, kutuk: r.kutuk, nisap, butunluk, kazanan: durum === 'SONUCLANDI' ? (oylar.EVET > oylar.HAYIR ? 'EVET' : oylar.HAYIR > oylar.EVET ? 'HAYIR' : 'ESIT') : null };
      if ((await db.run(`UPDATE referandumlar SET durum = ?, sonuc_json = ? WHERE id = ? AND durum = 'OYLAMA'`, durum, JSON.stringify(sonuc), r.id)).changes !== 1) return;
      // Oylama kapandı: sayımla aynı işlemde sandık karıştırılır (gizli oy)
      await db.sandigiKaristir('referandum_oylari', 'ref_id', r.id);
      await L.denetim({ anahtar: `REFERENDUM_CLOSED:${r.id}`, eylem: 'REFERENDUM_CLOSED', varlik: `REF:${r.id}`, bolge: r.region_id, herkese: true, sonra: { soru: r.soru, ...sonuc } });
      for (const s of await sakinler(r.region_id)) await bildir(s.id, `Referandum sonuçlandı: “${r.soru.slice(0, 60)}” → ${sonuc.kazanan ?? 'katılım nisabı sağlanamadı'}`, `belediye:${r.region_id}`);
    });
  }
  await db.run(`UPDATE referandumlar SET durum = 'DUSTU' WHERE durum = 'IMZA' AND created_at < ?`, t - REFERANDUM.sureMs);
}

async function ilceReferandumlari(ilceId, userId) {
  const no = Number(ilceId);
  if (!Number.isFinite(no)) return [];
  const liste = [];
  for (const r of await db.all(`SELECT r.*, u.display_name AS baslatan FROM referandumlar r JOIN users u ON u.id = r.baslatan_id WHERE r.region_id = ? ORDER BY r.id DESC LIMIT 5`, no)) {
    liste.push({
      id: r.id, soru: r.soru, aciklama: r.aciklama, durum: r.durum, baslatan: r.baslatan, esik: r.esik, oylamaBitis: r.oylama_bitis,
      imza: (await db.get(`SELECT COUNT(*) c FROM referandum_imzalar WHERE ref_id = ?`, r.id)).c,
      sonuc: r.sonuc_json ? JSON.parse(r.sonuc_json) : null,
      ben: userId ? {
        imzaladim: !!await db.get(`SELECT 1 FROM referandum_imzalar WHERE ref_id = ? AND user_id = ?`, r.id, userId),
        oyKullandim: !!await db.get(`SELECT 1 FROM referandum_katilim WHERE ref_id = ? AND user_id = ?`, r.id, userId),
        imzaHakki: r.durum === 'IMZA' && await uygunMu(r.region_id, userId),
        kutukte: r.durum !== 'IMZA' && (await kutukGetir(r.id)).includes(userId),   // oy hakkı dondurulmuş kütükten
      } : null,
    });
  }
  return liste;
}

async function rotalar(app, { h, auth }) {
  app.post('/api/belediye/:id/referandum', auth.dogrulanmisGerekli, h((req) => baslat(req.kullanici.id, req.params.id, req.body)));
  app.post('/api/referandum/:id/imza', auth.dogrulanmisGerekli, h((req) => imzala(req.kullanici.id, req.params.id)));
  app.post('/api/referandum/:id/oy', auth.dogrulanmisGerekli, h((req) => oyVer(req.kullanici.id, req.params.id, req.body?.oy)));
  app.post('/api/referandum/:id/makbuz', h((req) => makbuzDogrula(req.params.id, req.body?.makbuz)));
}

module.exports = { rotalar, baslat, imzala, oyVer, makbuzDogrula, referandumBakim, ilceReferandumlari };
