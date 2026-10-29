// Çiftlik gelişimi (tutundurma): yapı yükseltme, işçi ve günlük görevler.
//  • Yapı yükseltme: yalnızca etkisi olan yapılar (hayvan barınakları ve kira getiren evler) 5. seviyeye kadar yükseltilir;
//    bedel = yapı maliyeti × hedef seviye × 1,5. Barınak (kümes, ahır, ağıl, arı kovanı) her seviyede toplamada yarım kat
//    fazla ürün verir (hayvan sayısı artar); ev her seviyede günlük kirayı yarım kat artırır.
//  • İşçi: gün başına ücretle tutulur; süresi boyunca oyuncunun olgun ekinlerini hasat eder, susuz tarlaları sular
//    ve aç hayvanları yemler (sulama ve eksik yem bedeli oyuncudan). Sunucu döngüsünde düzenli çalışır.
//  • Günlük görevler: her gün oyuncuya özgü 3 görev (denetim kayıtlarından sayılır); hepsi bitince ödül alınır.
const db = require('./db');
const L = require('./lib/ledger');
const { sayi } = require('./lib/girdi');
const { OyunHatasi } = L;
const { YAPILAR, HAYVANLAR, TARIM, OYUN_HIZI } = require('./config/rules');
const simdi = () => Date.now();


const GELISIM = {
  maxSeviye: 5, yukseltKat: 1.5,
  isciGunluk: 60, isciMaxGun: 7, isciAralikMs: 60_000,
  gunlukOdul: 60, gunlukTp: 15,
};

// ---------- Yapı yükseltme (yalnızca etkisi olan yapılar)
const yukseltilebilir = (tip) => !!HAYVANLAR[tip] || !!YAPILAR[tip]?.gelir;
// hedef: istemcinin beklediği yeni seviye (çift tıklamada ikinci istek 409 alır)
const yukselt = (userId, structureId, hedef) => db.tx(async () => {
  const oyun = require('./oyun');
  // Satır kilidi: eşzamanlı iki yükseltme aynı seviyeyi iki kez ödemez
  const s = await db.get(`SELECT * FROM structures WHERE id = ? FOR UPDATE`, Number(structureId));
  if (!s) throw new OyunHatasi(404, 'Yapı bulunamadı');
  const p = await oyun.parselGetir(s.parcel_id);
  oyun.sahibiOlmali(p, userId);
  if (s.status !== 'ACTIVE') throw new OyunHatasi(409, 'Yapı henüz tamamlanmadı');
  if (!yukseltilebilir(s.type)) throw new OyunHatasi(409, `${YAPILAR[s.type]?.ad || 'Bu yapı'} yükseltilmez; yalnızca hayvan barınakları ve kiralık evler yükseltilir`, 'YUKSELMEZ');
  const sv = s.seviye || 1;
  if (sv >= GELISIM.maxSeviye) throw new OyunHatasi(409, 'Bu yapı en üst seviyede', 'EN_UST');
  if (hedef !== undefined && sayi(hedef) !== sv + 1) throw new OyunHatasi(409, `Yapı zaten ${sv}. seviyede`, 'SEVIYE_DEGISTI');
  const bedel = Math.round((YAPILAR[s.type]?.maliyet || 50) * (sv + 1) * GELISIM.yukseltKat);
  const tx = L.yeniTx(), ad = YAPILAR[s.type]?.ad || s.type;
  await L.harca(userId, bedel, `${ad} ${sv + 1}. seviyeye yükseltildi`, tx);
  // Kira yapısı: o ana kadar biriken kira eski seviyeden ödenir, sayaç yeni seviyeyle baştan başlar
  let kira = 0;
  if (YAPILAR[s.type]?.gelir) {
    const k = kiraDurumu(s, await db.all(`SELECT type, status FROM structures WHERE parcel_id = ?`, s.parcel_id));
    if (k && !k.bakimGerekli && k.birikmis >= 1) { kira = k.birikmis; await L.odul(userId, kira, `${ad} kira geliri`, tx); }
    await db.run(`UPDATE structures SET gelir_at = ? WHERE id = ?`, simdi(), s.id);
  }
  await db.run(`UPDATE structures SET seviye = ? WHERE id = ?`, sv + 1, s.id);
  await L.denetim({ anahtar: `STRUCTURE_UPGRADED:${tx}`, aktor: userId, eylem: 'STRUCTURE_UPGRADED', varlik: p.id, sonra: { yapi: s.type, seviye: sv + 1, bedel, kira }, bolge: p.region_id });
  return { tamam: true, seviye: sv + 1, bedel, kira };
});
const yukseltmeBedeli = (s) => (!yukseltilebilir(s.type) || (s.seviye || 1) >= GELISIM.maxSeviye ? null : Math.round((YAPILAR[s.type]?.maliyet || 50) * ((s.seviye || 1) + 1) * GELISIM.yukseltKat));
// Bir sonraki seviyenin etkisi (arayüz için): barınakta toplama miktarı, evde günlük kira
function yukseltmeEtkisi(s, yapilar, t = simdi()) {
  if (!yukseltilebilir(s.type) || s.status !== 'ACTIVE') return null;
  const sv = s.seviye || 1, sonraki = sv < GELISIM.maxSeviye ? { ...s, seviye: sv + 1 } : null;
  const h = HAYVANLAR[s.type];
  if (h) {
    const { seviyeliMiktar } = require('./ciftlik');
    return { tur: 'URUN', simdi: seviyeliMiktar(h, s), sonraki: sonraki && seviyeliMiktar(h, sonraki) };
  }
  return { tur: 'KIRA', simdi: kiraDurumu(s, yapilar, t).gunluk, sonraki: sonraki && kiraDurumu(sonraki, yapilar, t).gunluk };
}

// ---------- Konut kira geliri (Ev ve keyif): günlük kira birikir, oyuncu çiftliğinden toplar
const KIRA = { gunMs: Math.round(86_400_000 / OYUN_HIZI), birikmeGun: 3, havuzKat: 1.5, seviyeKat: 0.5 };
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
const kiraTopla = (userId, structureId) => db.tx(async () => {
  const oyun = require('./oyun');
  // Satır kilidi: eşzamanlı iki toplama aynı kirayı iki kez ödemez
  const s = await db.get(`SELECT * FROM structures WHERE id = ? FOR UPDATE`, Number(structureId));
  if (!s) throw new OyunHatasi(404, 'Yapı bulunamadı');
  const p = await oyun.parselGetir(s.parcel_id);
  oyun.sahibiOlmali(p, userId);
  const k = kiraDurumu(s, await db.all(`SELECT type, status FROM structures WHERE parcel_id = ?`, s.parcel_id));
  if (!k) throw new OyunHatasi(409, 'Bu yapı kira getirmez');
  if (k.bakimGerekli) throw new OyunHatasi(409, 'Ev bakımsız; turist gelmiyor. Önce bakım yap', 'BAKIM');
  if (k.birikmis < 1) throw new OyunHatasi(409, 'Henüz toplanacak kira yok', 'BOS');
  await db.run(`UPDATE structures SET gelir_at = ? WHERE id = ?`, simdi(), s.id);
  const tx = L.yeniTx();
  await L.odul(userId, k.birikmis, `${YAPILAR[s.type].ad} kira geliri`, tx);
  await L.denetim({ anahtar: `RENT_COLLECTED:${tx}`, aktor: userId, eylem: 'RENT_COLLECTED', varlik: p.id, sonra: { yapi: s.type, tutar: k.birikmis } });
  return { tamam: true, tutar: k.birikmis };
});

// ---------- İşçi
const isciTut = (userId, gun) => db.tx(async () => {
  gun = sayi(gun);
  if (!Number.isInteger(gun) || gun < 1 || gun > GELISIM.isciMaxGun) throw new OyunHatasi(400, `Gün sayısı 1–${GELISIM.isciMaxGun} arasında tam sayı olmalı`);
  await db.kilit(`isci:${userId}`);   // eşzamanlı iki kiralama süre tavanını aşmasın
  const t = simdi(), mevcut = await db.get(`SELECT bitis FROM isciler WHERE user_id = ?`, userId);
  const bas = Math.max(t, mevcut?.bitis || 0);
  if (bas - t + gun * 86_400_000 > GELISIM.isciMaxGun * 86_400_000) throw new OyunHatasi(409, `En fazla ${GELISIM.isciMaxGun} günlük işçi tutulabilir`);
  const bedel = GELISIM.isciGunluk * gun;
  const tx = L.yeniTx();
  await L.harca(userId, bedel, `İşçi ücreti (${gun} gün)`, tx);
  await db.run(`INSERT INTO isciler (user_id, bitis) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET bitis = excluded.bitis`, userId, bas + gun * 86_400_000);
  await L.denetim({ anahtar: `WORKER_HIRED:${tx}`, aktor: userId, eylem: 'WORKER_HIRED', varlik: `USER:${userId}`, sonra: { gun, bedel } });
  return { tamam: true, bitis: bas + gun * 86_400_000, bedel };
});
async function isciDurumu(userId) {
  const r = await db.get(`SELECT bitis FROM isciler WHERE user_id = ?`, userId);
  return { aktif: !!r && r.bitis > simdi(), bitis: r?.bitis || null, gunluk: GELISIM.isciGunluk, maxGun: GELISIM.isciMaxGun };
}
// İşçi turu: olgun ekini hasat et, susuz tarlayı sula, aç hayvanı yemle (her biri olağan oyun eylemiyle; hata işi durdurmaz)
// Her eylem kendi işleminde çalışır (işlem dışından çağrılır); biri başarısız olursa yalnızca o geri alınır.
async function isciTuru(t = simdi()) {
  const oyun = require('./oyun'), ciftlik = require('./ciftlik');
  const aktifler = await db.all(`SELECT user_id FROM isciler WHERE bitis > ? AND son_tur < ?`, t, t - GELISIM.isciAralikMs);
  let is = 0;
  for (const { user_id: uid } of aktifler) {
    // Koşullu yazma: aynı oyuncunun turunu başka bir sunucu aldıysa geç
    if ((await db.run(`UPDATE isciler SET son_tur = ? WHERE user_id = ? AND son_tur < ?`, t, uid, t - GELISIM.isciAralikMs)).changes !== 1) continue;
    for (const p of await db.all(`SELECT id FROM parcels WHERE owner_user_id = ?`, uid)) {
      const e = await db.get(`SELECT * FROM crops WHERE parcel_id = ? AND status = 'GROWING'`, p.id);
      if (e) {
        try {
          if (t >= e.ready_at) { await oyun.hasat(uid, p.id); is++; }
          else {
            const k = await oyun.parselKarti(p.id, uid, {}, { hafif: true });
            const ek = k.ekin;
            if (ek && !ek.otomatikSulama && ek.sulama < ek.gerekenSulama && !ek.sonrakiSulamaMs) { await oyun.sula(uid, p.id); is++; }
          }
        } catch { /* bakiye yetmezse ya da kural engellerse geç */ }
      }
      for (const s of await db.all(`SELECT id, type FROM structures WHERE parcel_id = ? AND status = 'ACTIVE'`, p.id)) {
        if (!HAYVANLAR[s.type]) continue;
        try {
          const d = await ciftlik.hayvanDurumu(await db.get(`SELECT * FROM structures WHERE id = ?`, s.id), t);
          if (d?.durum === 'HAZIR') { await ciftlik.topla(uid, s.id); is++; }
          else if (d?.durum === 'AC') { await ciftlik.besle(uid, s.id); is++; }
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
const sayac = db.sorgu(`SELECT COUNT(*) AS c FROM audit_events WHERE actor_id = ? AND action = ? AND created_at >= ?`);
function tohum(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; }; }
async function gunlukGorevler(userId, t = simdi()) {
  const gun = bugun(t), r = tohum(`${userId}:${gun}`);
  const havuz = SABLONLAR.slice(), secilen = [];
  while (secilen.length < 3) secilen.push(havuz.splice(Math.floor(r() * havuz.length), 1)[0]);
  const gunBas = Date.parse(`${gun}T00:00:00+03:00`);
  const bas = new Date(gunBas).toISOString().replace('T', ' ').slice(0, 19);
  const gorevler = [];
  for (const s of secilen) {
    const hedef = s.adet[Math.floor(r() * s.adet.length)];
    const yapilan = Number((await sayac.get(userId, s.eylem, bas))?.c) || 0;
    gorevler.push({ kod: s.kod, ikon: s.ikon, ad: s.ad(hedef), hedef, yapilan: Math.min(hedef, yapilan), tamam: yapilan >= hedef });
  }
  const alindi = !!await db.get(`SELECT 1 FROM gunluk_gorev_odulleri WHERE user_id = ? AND gun = ?`, userId, gun);
  return { gun, gorevler, hepsi: gorevler.every((g) => g.tamam), alindi, odul: GELISIM.gunlukOdul, tp: GELISIM.gunlukTp };
}
const gunlukOdulAl = (userId) => db.tx(async () => {
  const d = await gunlukGorevler(userId);
  if (!d.hepsi) throw new OyunHatasi(409, 'Önce bugünkü üç görevi bitir');
  if (d.alindi) throw new OyunHatasi(409, 'Bugünkü ödülü zaten aldın', 'ALINDI');
  // Birincil anahtar (oyuncu, gün): eşzamanlı ikinci istek satır yazamaz ve 409 alır
  const yaz = await db.run(`INSERT OR IGNORE INTO gunluk_gorev_odulleri (user_id, gun, odul) VALUES (?, ?, ?)`, userId, d.gun, d.odul);
  if (yaz.changes !== 1) throw new OyunHatasi(409, 'Bugünkü ödülü zaten aldın', 'ALINDI');
  const odul = Math.round(d.odul * await require('./koy-meydani').oran(userId, 'KUTUPHANE'));   // halk kütüphanesi
  await L.odul(userId, odul, 'Günlük görev ödülü');
  await require('./ciftlik').tpEkle(userId, d.tp, 'DAILY_QUESTS');
  await L.denetim({ aktor: userId, eylem: 'DAILY_QUESTS_REWARDED', varlik: `USER:${userId}`, sonra: { gun: d.gun, odul } });
  return { tamam: true, odul, tp: d.tp };
});

function rotalar(app, { h, auth }) {
  app.post('/api/yapi/:id/yukselt', auth.girisGerekli, h((req) => yukselt(req.kullanici.id, req.params.id, req.body?.hedef)));
  app.post('/api/yapi/:id/kira', auth.girisGerekli, h((req) => kiraTopla(req.kullanici.id, req.params.id)));
  app.get('/api/isci', auth.girisGerekli, h((req) => isciDurumu(req.kullanici.id)));
  app.post('/api/isci/tut', auth.girisGerekli, h((req) => isciTut(req.kullanici.id, req.body?.gun)));
  app.get('/api/gunluk-gorevler', auth.girisGerekli, h((req) => gunlukGorevler(req.kullanici.id)));
  app.post('/api/gunluk-gorevler/odul', auth.girisGerekli, h((req) => gunlukOdulAl(req.kullanici.id)));
}

// İşçi döngüsü (sunucu açılışında başlar; testte elle çağrılır)
let zaman = null;
async function baslat() {
  if (!zaman) {
    zaman = setInterval(() => {
      db.tekOrnek('isci-turu', () => isciTuru())
        .catch((e) => require('./lib/gunluk').gunluk.warn('işçi turu', { hataIletisi: e.message }));
    }, 30_000);
    zaman.unref?.();
  }
}

module.exports = { GELISIM, baslat, rotalar, yukselt, yukseltilebilir, yukseltmeBedeli, yukseltmeEtkisi, isciTut, isciDurumu, isciTuru, gunlukGorevler, gunlukOdulAl, kiraDurumu, kiraTopla, KIRA };
