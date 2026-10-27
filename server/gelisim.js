// Çiftlik gelişimi (tutundurma): yapı yükseltme, işçi ve günlük görevler.
//  • Yapı yükseltme: etkin bir yapı 3. seviyeye kadar yükseltilir; bedel = yapı maliyeti × hedef seviye × 1,5.
//    Barınaklar (kümes, ahır, ağıl, mandıra) her seviyede toplamada fazladan ürün verir (hayvan sayısı artar).
//  • İşçi: gün başına ücretle tutulur; süresi boyunca oyuncunun olgun ekinlerini hasat eder, susuz tarlaları sular
//    (sulama bedeli olağan kuraldır) ve aç hayvanları yemler. Sunucu döngüsünde düzenli çalışır.
//  • Günlük görevler: her gün oyuncuya özgü 3 görev (denetim kayıtlarından sayılır); hepsi bitince ödül alınır.
const db = require('./db');
const L = require('./lib/ledger');
const { OyunHatasi } = L;
const { YAPILAR, HAYVANLAR, TARIM, OYUN_HIZI } = require('./config/rules');
const simdi = () => Date.now();

db.exec(`
CREATE TABLE IF NOT EXISTS isciler (user_id INTEGER PRIMARY KEY REFERENCES users(id), bitis INTEGER NOT NULL, son_tur INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS gunluk_gorev_odulleri (user_id INTEGER NOT NULL REFERENCES users(id), gun TEXT NOT NULL, odul INTEGER NOT NULL, PRIMARY KEY (user_id, gun));
`);

const GELISIM = {
  maxSeviye: 3, yukseltKat: 1.5,
  isciGunluk: 60, isciMaxGun: 7, isciAralikMs: 60_000,
  gunlukOdul: 60, gunlukTp: 15,
};

// ---------- Yapı yükseltme
const yukselt = db.transaction((userId, structureId) => {
  const oyun = require('./oyun');
  const s = db.prepare(`SELECT * FROM structures WHERE id = ?`).get(Number(structureId));
  if (!s) throw new OyunHatasi(404, 'Yapı bulunamadı');
  const p = oyun.parselGetir(s.parcel_id);
  oyun.sahibiOlmali(p, userId);
  if (s.status !== 'ACTIVE') throw new OyunHatasi(409, 'Yapı henüz tamamlanmadı');
  const sv = s.seviye || 1;
  if (sv >= GELISIM.maxSeviye) throw new OyunHatasi(409, 'Bu yapı en üst seviyede', 'EN_UST');
  const bedel = Math.round((YAPILAR[s.type]?.maliyet || 50) * (sv + 1) * GELISIM.yukseltKat);
  const tx = L.yeniTx();
  L.harca(userId, bedel, `${YAPILAR[s.type]?.ad || s.type} ${sv + 1}. seviyeye yükseltildi`, tx);
  db.prepare(`UPDATE structures SET seviye = ? WHERE id = ?`).run(sv + 1, s.id);
  L.denetim({ anahtar: `STRUCTURE_UPGRADED:${tx}`, aktor: userId, eylem: 'STRUCTURE_UPGRADED', varlik: p.id, sonra: { yapi: s.type, seviye: sv + 1, bedel }, bolge: p.region_id });
  return { tamam: true, seviye: sv + 1, bedel };
});
const yukseltmeBedeli = (s) => ((s.seviye || 1) >= GELISIM.maxSeviye ? null : Math.round((YAPILAR[s.type]?.maliyet || 50) * ((s.seviye || 1) + 1) * GELISIM.yukseltKat));

// ---------- Konut kira geliri (Ev ve keyif): günlük kira birikir, oyuncu çiftliğinden toplar
const KIRA = { gunMs: Math.round(86_400_000 / OYUN_HIZI), birikmeGun: 2, havuzKat: 1.5, seviyeKat: 0.5 };
// Yapının birikmiş kirası. yapilar: aynı parseldeki yapılar (havuz bonusu için)
function kiraDurumu(s, yapilar, t = simdi()) {
  const y = YAPILAR[s.type];
  if (!y?.gelir || s.status !== 'ACTIVE') return null;
  const havuz = yapilar.some((x) => x.type === 'HAVUZ' && x.status === 'ACTIVE');
  const gunluk = Math.round(y.gelir * (1 + KIRA.seviyeKat * ((s.seviye || 1) - 1)) * (havuz ? KIRA.havuzKat : 1));
  const bas = s.gelir_at || s.completed_at || s.completes_at || t;
  const gecen = Math.min(t - bas, KIRA.birikmeGun * KIRA.gunMs);
  // Bakımsız ev turist çekmez: sağlık etkisizlik eşiğinin altındaysa kira birikmez (diğer yapı etkileri gibi)
  const bakimGerekli = require('./oyun').saglik(s, t) < require('./config/rules').BAKIM.etkisizEsik;
  const birikmis = bakimGerekli ? 0 : Math.max(0, Math.floor((gunluk * gecen) / KIRA.gunMs));
  return { gunluk, birikmis, dolu: gecen >= KIRA.birikmeGun * KIRA.gunMs, havuz, bakimGerekli };
}
const kiraTopla = db.transaction((userId, structureId) => {
  const oyun = require('./oyun');
  const s = db.prepare(`SELECT * FROM structures WHERE id = ?`).get(Number(structureId));
  if (!s) throw new OyunHatasi(404, 'Yapı bulunamadı');
  const p = oyun.parselGetir(s.parcel_id);
  oyun.sahibiOlmali(p, userId);
  const k = kiraDurumu(s, db.prepare(`SELECT type, status FROM structures WHERE parcel_id = ?`).all(s.parcel_id));
  if (!k) throw new OyunHatasi(409, 'Bu yapı kira getirmez');
  if (k.bakimGerekli) throw new OyunHatasi(409, 'Ev bakımsız; turist gelmiyor. Önce bakım yap', 'BAKIM');
  if (k.birikmis < 1) throw new OyunHatasi(409, 'Henüz toplanacak kira yok', 'BOS');
  db.prepare(`UPDATE structures SET gelir_at = ? WHERE id = ?`).run(simdi(), s.id);
  const tx = L.yeniTx();
  L.odul(userId, k.birikmis, `${YAPILAR[s.type].ad} kira geliri`, tx);
  L.denetim({ anahtar: `RENT_COLLECTED:${tx}`, aktor: userId, eylem: 'RENT_COLLECTED', varlik: p.id, sonra: { yapi: s.type, tutar: k.birikmis } });
  return { tamam: true, tutar: k.birikmis };
});

// ---------- İşçi
const isciTut = db.transaction((userId, gun) => {
  gun = Math.max(1, Math.min(GELISIM.isciMaxGun, Math.round(Number(gun) || 1)));
  const t = simdi(), mevcut = db.prepare(`SELECT bitis FROM isciler WHERE user_id = ?`).get(userId);
  const bas = Math.max(t, mevcut?.bitis || 0);
  if (bas - t + gun * 86_400_000 > GELISIM.isciMaxGun * 86_400_000) throw new OyunHatasi(409, `En fazla ${GELISIM.isciMaxGun} günlük işçi tutulabilir`);
  const bedel = GELISIM.isciGunluk * gun;
  const tx = L.yeniTx();
  L.harca(userId, bedel, `İşçi ücreti (${gun} gün)`, tx);
  db.prepare(`INSERT INTO isciler (user_id, bitis) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET bitis = excluded.bitis`).run(userId, bas + gun * 86_400_000);
  L.denetim({ anahtar: `WORKER_HIRED:${tx}`, aktor: userId, eylem: 'WORKER_HIRED', varlik: `USER:${userId}`, sonra: { gun, bedel } });
  return { tamam: true, bitis: bas + gun * 86_400_000, bedel };
});
function isciDurumu(userId) {
  const r = db.prepare(`SELECT bitis FROM isciler WHERE user_id = ?`).get(userId);
  return { aktif: !!r && r.bitis > simdi(), bitis: r?.bitis || null, gunluk: GELISIM.isciGunluk, maxGun: GELISIM.isciMaxGun };
}
// İşçi turu: olgun ekini hasat et, susuz tarlayı sula, aç hayvanı yemle (her biri olağan oyun eylemiyle; hata işi durdurmaz)
function isciTuru(t = simdi()) {
  const oyun = require('./oyun'), ciftlik = require('./ciftlik');
  const aktifler = db.prepare(`SELECT user_id FROM isciler WHERE bitis > ? AND son_tur < ?`).all(t, t - GELISIM.isciAralikMs);
  let is = 0;
  for (const { user_id: uid } of aktifler) {
    db.prepare(`UPDATE isciler SET son_tur = ? WHERE user_id = ?`).run(t, uid);
    for (const p of db.prepare(`SELECT id FROM parcels WHERE owner_user_id = ?`).all(uid)) {
      const e = db.prepare(`SELECT * FROM crops WHERE parcel_id = ? AND status = 'GROWING'`).get(p.id);
      if (e) {
        try {
          if (t >= e.ready_at) { oyun.hasat(uid, p.id); is++; }
          else {
            const k = oyun.parselKarti(p.id, uid, {}, { hafif: true });
            const ek = k.ekin;
            if (ek && !ek.otomatikSulama && ek.sulama < ek.gerekenSulama && !ek.sonrakiSulamaMs) { oyun.sula(uid, p.id); is++; }
          }
        } catch { /* bakiye yetmezse ya da kural engellerse geç */ }
      }
      for (const s of db.prepare(`SELECT id, type FROM structures WHERE parcel_id = ? AND status = 'ACTIVE'`).all(p.id)) {
        if (!HAYVANLAR[s.type]) continue;
        try {
          const d = ciftlik.hayvanDurumu(db.prepare(`SELECT * FROM structures WHERE id = ?`).get(s.id), t);
          if (d?.durum === 'HAZIR') { ciftlik.topla(uid, s.id); is++; }
          else if (d?.durum === 'AC') { ciftlik.besle(uid, s.id); is++; }
        } catch { /* geç */ }
      }
    }
  }
  return is;
}

// ---------- Günlük görevler: oyuncu ve güne göre değişen 3 görev; ilerleme bugünkü denetim kayıtlarından sayılır
const SABLONLAR = [
  { kod: 'HASAT', eylem: 'CROP_HARVESTED', ikon: '🧺', ad: (n) => `${n} kez hasat et`, adet: [1, 2, 3] },
  { kod: 'EKIM', eylem: 'CROP_PLANTED', ikon: '🌱', ad: (n) => `${n} kez ekim yap`, adet: [1, 2, 3] },
  { kod: 'SULA', eylem: 'CROP_WATERED', ikon: '💧', ad: (n) => `${n} kez sula`, adet: [1, 2, 3] },
  { kod: 'HAYVAN', eylem: 'ANIMAL_PRODUCE_COLLECTED', ikon: '🥚', ad: (n) => `${n} kez hayvan ürünü topla`, adet: [1, 2] },
  { kod: 'SATIS', eylem: 'TRADE_SETTLED', ikon: '💰', ad: (n) => `${n} kez pazara ürün sat`, adet: [1, 2] },
  { kod: 'SIPARIS', eylem: 'ORDER_DELIVERED', ikon: '📋', ad: (n) => `${n} sipariş teslim et`, adet: [1] },
];
const bugun = (t = simdi()) => new Date(t + 3 * 3_600_000).toISOString().slice(0, 10);   // Türkiye günü
function tohum(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; }; }
function gunlukGorevler(userId, t = simdi()) {
  const gun = bugun(t), r = tohum(`${userId}:${gun}`);
  const havuz = SABLONLAR.slice(), secilen = [];
  while (secilen.length < 3) secilen.push(havuz.splice(Math.floor(r() * havuz.length), 1)[0]);
  const gunBas = Date.parse(`${gun}T00:00:00+03:00`);
  const sayac = db.prepare(`SELECT COUNT(*) AS c FROM audit_events WHERE actor_id = ? AND action = ? AND created_at >= ?`);
  const bas = new Date(gunBas).toISOString().replace('T', ' ').slice(0, 19);
  const gorevler = secilen.map((s) => {
    const hedef = s.adet[Math.floor(r() * s.adet.length)];
    let yapilan = 0;
    try { yapilan = sayac.get(userId, s.eylem, bas).c; } catch { yapilan = 0; }
    return { kod: s.kod, ikon: s.ikon, ad: s.ad(hedef), hedef, yapilan: Math.min(hedef, yapilan), tamam: yapilan >= hedef };
  });
  const alindi = !!db.prepare(`SELECT 1 FROM gunluk_gorev_odulleri WHERE user_id = ? AND gun = ?`).get(userId, gun);
  return { gun, gorevler, hepsi: gorevler.every((g) => g.tamam), alindi, odul: GELISIM.gunlukOdul, tp: GELISIM.gunlukTp };
}
const gunlukOdulAl = db.transaction((userId) => {
  const d = gunlukGorevler(userId);
  if (!d.hepsi) throw new OyunHatasi(409, 'Önce bugünkü üç görevi bitir');
  if (d.alindi) throw new OyunHatasi(409, 'Bugünkü ödülü zaten aldın', 'ALINDI');
  db.prepare(`INSERT INTO gunluk_gorev_odulleri (user_id, gun, odul) VALUES (?, ?, ?)`).run(userId, d.gun, d.odul);
  const odul = Math.round(d.odul * require('./koy-meydani').oran(userId, 'KUTUPHANE'));   // halk kütüphanesi
  L.odul(userId, odul, 'Günlük görev ödülü');
  require('./ciftlik').tpEkle(userId, d.tp, 'DAILY_QUESTS');
  L.denetim({ aktor: userId, eylem: 'DAILY_QUESTS_REWARDED', varlik: `USER:${userId}`, sonra: { gun: d.gun, odul } });
  return { tamam: true, odul, tp: d.tp };
});

function rotalar(app, { h, auth }) {
  app.post('/api/yapi/:id/yukselt', auth.girisGerekli, h((req) => yukselt(req.kullanici.id, req.params.id)));
  app.post('/api/yapi/:id/kira', auth.girisGerekli, h((req) => kiraTopla(req.kullanici.id, req.params.id)));
  app.get('/api/isci', auth.girisGerekli, h((req) => isciDurumu(req.kullanici.id)));
  app.post('/api/isci/tut', auth.girisGerekli, h((req) => isciTut(req.kullanici.id, req.body?.gun)));
  app.get('/api/gunluk-gorevler', auth.girisGerekli, h((req) => gunlukGorevler(req.kullanici.id)));
  app.post('/api/gunluk-gorevler/odul', auth.girisGerekli, h((req) => gunlukOdulAl(req.kullanici.id)));
}

// İşçi döngüsü (sunucu açılışında başlar; testte elle çağrılır)
let zaman = null;
function baslat() { if (!zaman) { zaman = setInterval(() => { try { isciTuru(); } catch (e) { require('./lib/gunluk').gunluk.warn('işçi turu', { hataIletisi: e.message }); } }, 30_000); zaman.unref?.(); } }

module.exports = { GELISIM, baslat, rotalar, yukselt, yukseltmeBedeli, isciTut, isciDurumu, isciTuru, gunlukGorevler, gunlukOdulAl, kiraDurumu, kiraTopla, KIRA };
