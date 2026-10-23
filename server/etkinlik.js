// Mevsimlik etkinlikler: her yıl aynı tarihlerde açılan, sınırlı süreli görevler, Türkiye geneli ortak hedef ve etkinlik süsü.
// İlerleme ayrı tutulmaz: oyuncunun etkinlik süresindeki denetim kayıtları (eylemler) sayılır. Ödüller bir kez alınır.
const db = require('./db');
const L = require('./lib/ledger');
const { ETKINLIKLER } = require('./config/rules');
const { OyunHatasi } = L;

// İlerleme sorguları denetim kaydını eylem ve zamana göre tarar: dizinler
db.exec(`CREATE INDEX IF NOT EXISTS ix_audit_eylem_zaman ON audit_events(action, created_at);
         CREATE INDEX IF NOT EXISTS ix_audit_aktor_eylem ON audit_events(actor_id, action, created_at);`);

db.exec(`CREATE TABLE IF NOT EXISTS etkinlik_odulleri (
  user_id  INTEGER NOT NULL REFERENCES users(id),
  etkinlik TEXT NOT NULL,
  yil      INTEGER NOT NULL,
  gorev    INTEGER NOT NULL,          -- görev sırası; -1 ortak hedef
  odul     REAL NOT NULL,
  at       INTEGER NOT NULL,
  PRIMARY KEY (user_id, etkinlik, yil, gorev)
)`);

// Türkiye saatiyle (UTC+3) tarih
const trTarih = (t) => new Date(t + 3 * 3600_000);
const aaGg = (t) => trTarih(t).toISOString().slice(5, 10);
const sqlZaman = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

// Etkinliğin bu dönemdeki başlangıç ve bitişi (yıl dönümünü aşan etkinlikler: 12-26 → 01-02)
function aralik(e, t) {
  const y = trTarih(t).getUTCFullYear();
  const an = (yil, ag, bitis = false) => Date.UTC(yil, Number(ag.slice(0, 2)) - 1, Number(ag.slice(3)) + (bitis ? 1 : 0)) - 3 * 3600_000;
  const asar = e.bit < e.bas;
  const bugun = aaGg(t);
  const basYil = asar && bugun <= e.bit ? y - 1 : y;
  return { bas: an(basYil, e.bas), bit: an(asar ? basYil + 1 : basYil, e.bit, true), yil: basYil };
}
function aktifEtkinlik(t = Date.now()) {
  for (const [kod, e] of Object.entries(ETKINLIKLER)) {
    const a = aralik(e, t);
    if (t >= a.bas && t < a.bit) return { kod, ...e, ...a };
  }
  return null;
}
const etkinlikAktifMi = (kod, t = Date.now()) => aktifEtkinlik(t)?.kod === kod;

// Türkiye geneli sayaç herkese açık uçtan sorgulanır: 60 sn önbellek
const ortakOnbellek = new Map();
function sayac(eylem, bas, bit, userId = null) {
  if (!userId) {
    const k = `${eylem}|${bas}`, o = ortakOnbellek.get(k);
    if (o && Date.now() - o.at < 60_000) return o.c;
    const c = sayacHam(eylem, bas, bit, null);
    ortakOnbellek.set(k, { c, at: Date.now() });
    return c;
  }
  return sayacHam(eylem, bas, bit, userId);
}
function sayacHam(eylem, bas, bit, userId) {
  return userId
    ? db.prepare(`SELECT COUNT(*) c FROM audit_events WHERE actor_id = ? AND action = ? AND created_at >= ? AND created_at < ?`).get(userId, eylem, sqlZaman(bas), sqlZaman(bit)).c
    : db.prepare(`SELECT COUNT(*) c FROM audit_events a JOIN users u ON u.id = a.actor_id WHERE u.is_npc = 0 AND a.action = ? AND a.created_at >= ? AND a.created_at < ?`)
      .get(eylem, sqlZaman(bas), sqlZaman(bit)).c;
}

function durum(userId = null, t = Date.now()) {
  const e = aktifEtkinlik(t);
  if (!e) {
    // Sıradaki etkinlik (bilgi için)
    const sonraki = Object.entries(ETKINLIKLER).map(([kod, x]) => {
      let a = aralik(x, t);
      if (a.bas <= t) a = aralik(x, a.bit + 86400_000 * 300);   // gelecek yılki
      return { kod, ad: x.ad, ikon: x.ikon, bas: a.bas };
    }).filter((x) => x.bas > t).sort((a, b) => a.bas - b.bas)[0];
    return { aktif: null, sonraki };
  }
  const alinan = new Set(userId ? db.prepare(`SELECT gorev FROM etkinlik_odulleri WHERE user_id = ? AND etkinlik = ? AND yil = ?`).all(userId, e.kod, e.yil).map((r) => r.gorev) : []);
  const gorevler = e.gorevler.map((g, i) => {
    const ilerleme = userId ? Math.min(g.hedef, sayac(g.eylem, e.bas, e.bit, userId)) : 0;
    return { sira: i, ad: g.ad, hedef: g.hedef, ilerleme, odul: g.odul, tp: g.tp, alindi: alinan.has(i), alinabilir: !!userId && ilerleme >= g.hedef && !alinan.has(i) };
  });
  const ortakToplam = sayac(e.ortak.eylem, e.bas, e.bit);
  const katki = userId ? sayac(e.ortak.eylem, e.bas, e.bit, userId) : 0;
  return {
    aktif: { kod: e.kod, ad: e.ad, ikon: e.ikon, renk: e.renk, aciklama: e.aciklama, bas: e.bas, bit: e.bit, kalanMs: e.bit - t, sus: e.sus || null, gorevler,
      ortak: { ad: e.ortak.ad, hedef: e.ortak.hedef, ilerleme: Math.min(e.ortak.hedef, ortakToplam), odul: e.ortak.odul, katki,
        alindi: alinan.has(-1), alinabilir: !!userId && ortakToplam >= e.ortak.hedef && katki > 0 && !alinan.has(-1) } },
  };
}

const odulAl = db.transaction((userId, gorev) => {
  const d = durum(userId);
  if (!d.aktif) throw new OyunHatasi(409, 'Şu an etkinlik yok');
  const g = Number(gorev);
  const hedef = g === -1 ? d.aktif.ortak : d.aktif.gorevler[g];
  if (!hedef) throw new OyunHatasi(404, 'Görev bulunamadı');
  if (hedef.alindi) throw new OyunHatasi(409, 'Bu ödülü zaten aldın');
  if (!hedef.alinabilir) throw new OyunHatasi(409, g === -1 ? 'Ortak hedefe henüz ulaşılmadı ya da katkın yok' : 'Görev henüz tamamlanmadı');
  const yil = aktifEtkinlik().yil;
  db.prepare(`INSERT INTO etkinlik_odulleri (user_id, etkinlik, yil, gorev, odul, at) VALUES (?, ?, ?, ?, ?, ?)`).run(userId, d.aktif.kod, yil, g, hedef.odul, Date.now());
  L.odul(userId, hedef.odul, `${d.aktif.ad} ödülü: ${hedef.ad}`);
  L.denetim({ aktor: userId, eylem: 'EVENT_REWARD_CLAIMED', sonra: { etkinlik: d.aktif.kod, gorev: g, odul: hedef.odul } });
  if (hedef.tp) require('./ciftlik').tpEkle(userId, hedef.tp, 'EVENT_REWARD_CLAIMED');
  return { tamam: true, odul: hedef.odul, tp: hedef.tp || 0 };
});

function rotalar(app, { h, auth }) {
  app.get('/api/etkinlik', h((req) => durum(req.kullanici?.id ?? null)));
  app.post('/api/etkinlik/odul', auth.girisGerekli, h((req) => odulAl(req.kullanici.id, req.body?.gorev)));
}

module.exports = { rotalar, durum, aktifEtkinlik, etkinlikAktifMi, odulAl, aralik };
