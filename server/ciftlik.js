// Çiftlik oyunu katmanı: hayvancılık (yemle, topla), oyuncu seviyesi ve tecrübe puanı (TP), seviye ödülleri, günlük giriş ödülü,
// sipariş panosu (köylülerin istekleri), haftalık köy yarışması ve çiftlik süsleri. Kurallar config/rules.js'de.
// Bakiye yalnızca oyuncunun bir düğmeye basmasıyla değişir (ödül al, teslim et); yarışma ödülü hafta bitince bir kez dağıtılır.
const db = require('./db');
const L = require('./lib/ledger');
const { yol } = require('./lib/olaylar');
const { URUNLER, YAPILAR, RECETELER, HAYVANLAR, YEM_FIYATI, SEVIYE, GUNLUK_ODUL, SIPARIS, YARISMA, SUSLER, SUS_MAKS, BAKIM, LIG } = require('./config/rules');
const { OyunHatasi } = L;

const simdi = () => Date.now();
const bul = (tablo, kod) => (typeof kod === 'string' && Object.hasOwn(tablo, kod) ? tablo[kod] : null);

db.exec(`
CREATE TABLE IF NOT EXISTS hayvan_bakim (
  structure_id INTEGER PRIMARY KEY REFERENCES structures(id),
  user_id      INTEGER NOT NULL REFERENCES users(id),
  durum        TEXT NOT NULL DEFAULT 'AC',        -- AC (yem bekliyor) / BESLENDI
  beslendi_at  INTEGER,
  hazir_at     INTEGER
);
CREATE TABLE IF NOT EXISTS tp_kayitlari (
  id        INTEGER PRIMARY KEY,
  user_id   INTEGER NOT NULL REFERENCES users(id),
  tp        INTEGER NOT NULL,
  eylem     TEXT NOT NULL,
  region_id INTEGER REFERENCES regions(id),
  at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_tp_bolge_at ON tp_kayitlari(region_id, at);
CREATE INDEX IF NOT EXISTS ix_tp_user ON tp_kayitlari(user_id);
CREATE TABLE IF NOT EXISTS siparisler (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  musteri    TEXT NOT NULL,
  kalemler   TEXT NOT NULL,                      -- {"URUN": adet}
  odul       REAL NOT NULL,
  tp         INTEGER NOT NULL,
  olusturma  INTEGER NOT NULL,
  son        INTEGER NOT NULL,
  durum      TEXT NOT NULL DEFAULT 'ACIK',      -- ACIK / TESLIM / REDDEDILDI / SURESI_DOLDU
  bitis      INTEGER
);
CREATE INDEX IF NOT EXISTS ix_siparis_user ON siparisler(user_id, durum);
CREATE TABLE IF NOT EXISTS yarisma_odulleri (
  hafta     INTEGER NOT NULL,
  region_id INTEGER NOT NULL REFERENCES regions(id),
  sira      INTEGER NOT NULL,
  user_id   INTEGER NOT NULL REFERENCES users(id),
  tp        INTEGER NOT NULL,
  odul      REAL NOT NULL,
  PRIMARY KEY (hafta, region_id, sira)
);
CREATE TABLE IF NOT EXISTS parsel_susleri (
  id        INTEGER PRIMARY KEY,
  parcel_id TEXT NOT NULL REFERENCES parcels(id),
  user_id   INTEGER NOT NULL REFERENCES users(id),
  tur       TEXT NOT NULL,
  yuva      INTEGER NOT NULL,
  at        INTEGER NOT NULL,
  UNIQUE (parcel_id, yuva)
);
`);
function kolonEkle(tablo, kolon, tanim) {
  if (!db.prepare(`PRAGMA table_info(${tablo})`).all().some((k) => k.name === kolon)) db.exec(`ALTER TABLE ${tablo} ADD COLUMN ${kolon} ${tanim}`);
}
kolonEkle('users', 'tp', 'INTEGER NOT NULL DEFAULT 0');
kolonEkle('users', 'odul_seviye', 'INTEGER NOT NULL DEFAULT 1');      // ödülü alınmış son seviye
kolonEkle('users', 'gunluk_gun', 'TEXT');                              // son günlük ödül (İstanbul tarihi)
kolonEkle('users', 'gunluk_seri', 'INTEGER NOT NULL DEFAULT 0');
kolonEkle('users', 'siparis_sonraki', 'INTEGER');

// ---------- Seviye ve TP
// Seviye n için toplam TP = katsayı × n × (n − 1)  ⇒  n = ⌊(1 + √(1 + 4·TP/katsayı)) / 2⌋
const seviyeHesap = (tp) => Math.min(SEVIYE.maks, Math.floor((1 + Math.sqrt(1 + (4 * Math.max(0, tp)) / SEVIYE.katsayi)) / 2));
const seviyeEsigi = (n) => SEVIYE.katsayi * n * (n - 1);
function oyuncuSeviyesi(userId) {
  const u = db.prepare(`SELECT tp FROM users WHERE id = ?`).get(userId);
  return seviyeHesap(u?.tp || 0);
}
function anaBolge(userId) {
  return db.prepare(`SELECT region_id FROM parcels WHERE owner_user_id = ? ORDER BY acquired_at LIMIT 1`).get(userId)?.region_id ?? null;
}
function tpEkle(userId, tp, eylem, bolge = null) {
  if (!userId || !(tp > 0)) return;
  const once = oyuncuSeviyesi(userId);
  db.prepare(`INSERT INTO tp_kayitlari (user_id, tp, eylem, region_id, at) VALUES (?, ?, ?, ?, ?)`).run(userId, tp, eylem, bolge ?? anaBolge(userId), simdi());
  db.prepare(`UPDATE users SET tp = tp + ? WHERE id = ?`).run(tp, userId);
  const sonra = oyuncuSeviyesi(userId);
  if (sonra > once) {
    require('./pazar').bildir(userId, `⭐ Seviye ${sonra} oldun! Seviye ödülün seni bekliyor.`, 'gorevler');
    require('./lib/olaylar').yay('bildirim', { userId });
  }
}
// Oyun eylemleri TP kazandırır (işlem bittikten sonra, olay yolu üzerinden)
yol.on('eylem', ({ eylem, aktor, bolge }) => {
  const tp = SEVIYE.tp[eylem];
  if (!tp || !aktor) return;
  try { tpEkle(aktor, tp, eylem, bolge); } catch { /* kullanıcı silinmiş olabilir */ }
});
function seviyeBilgisi(userId) {
  const u = db.prepare(`SELECT tp, odul_seviye FROM users WHERE id = ?`).get(userId);
  const n = seviyeHesap(u.tp);
  const bekleyen = [];
  for (let s = Math.max(2, u.odul_seviye + 1); s <= n; s++) bekleyen.push(s);
  return {
    tp: u.tp, seviye: n, esik: seviyeEsigi(n), sonraki: n < SEVIYE.maks ? seviyeEsigi(n + 1) : null,
    odulBekleyen: bekleyen, odulTutari: bekleyen.reduce((a, s) => a + SEVIYE.seviyeOdulu(s), 0),
    acilanlar: acilanlar(n + 1),
  };
}
// Bir sonraki seviyede açılacak içerik (yapı, süs)
function acilanlar(n) {
  return [
    ...Object.entries(YAPILAR).filter(([, y]) => y.minSeviye === n).map(([kod, y]) => ({ kod, ad: y.ad, ikon: y.ikon })),
    ...Object.entries(SUSLER).filter(([, s]) => s.minSeviye === n).map(([kod, s]) => ({ kod, ad: s.ad, ikon: s.ikon })),
  ];
}
const seviyeOdulAl = db.transaction((userId) => {
  const b = seviyeBilgisi(userId);
  if (!b.odulBekleyen.length) throw new OyunHatasi(409, 'Alınacak seviye ödülü yok');
  L.odul(userId, b.odulTutari, `Seviye ödülü (${b.odulBekleyen.join(', ')})`);
  db.prepare(`UPDATE users SET odul_seviye = ? WHERE id = ?`).run(b.seviye, userId);
  L.denetim({ aktor: userId, eylem: 'LEVEL_REWARD_CLAIMED', sonra: { seviyeler: b.odulBekleyen, tutar: b.odulTutari } });
  return { tamam: true, tutar: b.odulTutari, seviye: b.seviye };
});
function seviyeKontrol(userId, minSeviye, ad) {
  if (!minSeviye || minSeviye <= 1) return;
  const npc = db.prepare(`SELECT is_npc FROM users WHERE id = ?`).get(userId)?.is_npc;
  if (npc) return;
  if (oyuncuSeviyesi(userId) < minSeviye) throw new OyunHatasi(403, `${ad} seviye ${minSeviye}'te açılır`, 'SEVIYE');
}

// ---------- Günlük giriş ödülü (İstanbul tarihine göre)
const gunAnahtari = (t) => new Date(t + 3 * 3600_000).toISOString().slice(0, 10);
function gunlukDurum(userId, t = simdi()) {
  const u = db.prepare(`SELECT gunluk_gun, gunluk_seri FROM users WHERE id = ?`).get(userId);
  const bugun = gunAnahtari(t), dun = gunAnahtari(t - 86400_000);
  const seri = u.gunluk_gun === dun ? u.gunluk_seri + 1 : u.gunluk_gun === bugun ? u.gunluk_seri : 1;
  return { alinabilir: u.gunluk_gun !== bugun, seri, akce: GUNLUK_ODUL.akce[Math.min(seri, GUNLUK_ODUL.akce.length) - 1], tp: GUNLUK_ODUL.tp, tablo: GUNLUK_ODUL.akce };
}
const gunlukAl = db.transaction((userId) => {
  const d = gunlukDurum(userId);
  if (!d.alinabilir) throw new OyunHatasi(409, 'Bugünün ödülünü aldın; yarın yine gel');
  L.odul(userId, d.akce, `Günlük ödül (${d.seri}. gün)`);
  db.prepare(`UPDATE users SET gunluk_gun = ?, gunluk_seri = ? WHERE id = ?`).run(gunAnahtari(simdi()), d.seri, userId);
  L.denetim({ aktor: userId, eylem: 'DAILY_REWARD_CLAIMED', sonra: { seri: d.seri, akce: d.akce } });
  tpEkle(userId, d.tp, 'DAILY_REWARD_CLAIMED');
  return { tamam: true, akce: d.akce, seri: d.seri, tp: d.tp };
});

// ---------- Hayvancılık
const bakimSatiri = (sid) => db.prepare(`SELECT * FROM hayvan_bakim WHERE structure_id = ?`).get(sid);
function hayvanDurumu(s, t = simdi()) {
  const h = HAYVANLAR[s.type];
  if (!h || s.status !== 'ACTIVE') return null;
  const b = bakimSatiri(s.id);
  const beslendi = b?.durum === 'BESLENDI';
  return {
    hayvan: h.hayvan, ikon: h.ikon, sayi: h.sayi, urun: h.urun, urunAd: URUNLER[h.urun].ad, urunIkon: URUNLER[h.urun].ikon, miktar: h.miktar, yem: h.yem,
    asiBitis: s.asi_bitis && s.asi_bitis > t ? s.asi_bitis : null,
    durum: !beslendi ? 'AC' : t >= b.hazir_at ? 'HAZIR' : 'BESLENDI', hazir: beslendi ? b.hazir_at : null, kalanMs: beslendi ? Math.max(0, b.hazir_at - t) : 0,
  };
}
function barinakGetir(userId, structureId) {
  const oyun = require('./oyun');
  const s = db.prepare(`SELECT * FROM structures WHERE id = ?`).get(Number(structureId));
  if (!s || !HAYVANLAR[s.type]) throw new OyunHatasi(404, 'Barınak bulunamadı');
  const p = oyun.parselGetir(s.parcel_id);
  oyun.sahibiOlmali(p, userId);
  if (s.status !== 'ACTIVE') throw new OyunHatasi(409, 'Barınak henüz yapımda');
  if (oyun.saglik(s) < BAKIM.etkisizEsik) throw new OyunHatasi(409, 'Barınak bakımsız; önce bakım yap');
  return { s, p, h: HAYVANLAR[s.type] };
}
const besle = db.transaction((userId, structureId) => {
  const { s, p, h } = barinakGetir(userId, structureId);
  const b = bakimSatiri(s.id);
  if (b?.durum === 'BESLENDI') throw new OyunHatasi(409, simdi() >= b.hazir_at ? 'Önce ürünleri topla' : 'Hayvanlar tok; ürün hazırlanıyor');
  const tx = L.yeniTx();
  const eldeki = Math.min(h.yem, L.envanterMiktar(userId, 'YEM'));
  if (eldeki > 0) L.envanterDegis(userId, 'YEM', -eldeki, `Yem: ${YAPILAR[s.type].ad}`, tx);
  const alinan = h.yem - eldeki;
  if (alinan > 0) L.harca(userId, L.yuvarla(alinan * YEM_FIYATI), `Yem satın alındı (${alinan})`, tx);
  const t = simdi();
  db.prepare(`INSERT INTO hayvan_bakim (structure_id, user_id, durum, beslendi_at, hazir_at) VALUES (?, ?, 'BESLENDI', ?, ?)
              ON CONFLICT(structure_id) DO UPDATE SET user_id = excluded.user_id, durum = 'BESLENDI', beslendi_at = excluded.beslendi_at, hazir_at = excluded.hazir_at`)
    .run(s.id, userId, t, t + h.sureMs);
  L.denetim({ aktor: userId, eylem: 'ANIMALS_FED', varlik: p.id, sonra: { yapi: s.type, yem: h.yem, satinAlinan: alinan }, bolge: p.region_id });
  return { tamam: true, hazir: t + h.sureMs, yemEnvanter: eldeki, yemSatin: alinan, odenen: L.yuvarla(alinan * YEM_FIYATI) };
});
const topla = db.transaction((userId, structureId) => {
  const { s, p, h } = barinakGetir(userId, structureId);
  const b = bakimSatiri(s.id);
  if (b?.durum !== 'BESLENDI') throw new OyunHatasi(409, 'Önce hayvanları yemle');
  if (simdi() < b.hazir_at) throw new OyunHatasi(409, 'Ürün henüz hazır değil');
  // Zirai bayiden aşı yapılmış barınak her toplamada fazladan ürün verir
  const miktar = h.miktar + (s.asi_bitis && s.asi_bitis > simdi() ? require('./config/rules').CARSI.etki.asiEk : 0);
  L.envanterDegis(userId, h.urun, miktar, `${h.hayvan} ürünü: ${URUNLER[h.urun].ad}`);
  db.prepare(`UPDATE hayvan_bakim SET durum = 'AC', hazir_at = NULL WHERE structure_id = ?`).run(s.id);
  L.denetim({ aktor: userId, eylem: 'ANIMAL_PRODUCE_COLLECTED', varlik: p.id, sonra: { urun: h.urun, miktar }, bolge: p.region_id });
  return { tamam: true, urun: h.urun, miktar, asili: miktar > h.miktar };
});
// Harita için: parselde toplanmayı bekleyen hayvan ürünü var mı
function parselHayvanHazir(parcelId, t = simdi()) {
  return !!db.prepare(`SELECT 1 FROM hayvan_bakim b JOIN structures s ON s.id = b.structure_id
                       WHERE s.parcel_id = ? AND b.durum = 'BESLENDI' AND b.hazir_at <= ? LIMIT 1`).get(parcelId, t);
}

// ---------- Sipariş panosu
function urunHavuzu(userId) {
  const havuz = new Set(['BUGDAY', 'DOMATES', 'ELMA']);
  const parseller = db.prepare(`SELECT p.id, r.code FROM parcels p JOIN regions r ON r.id = p.il_id WHERE p.owner_user_id = ?`).all(userId);
  const plakalar = new Set(parseller.map((p) => p.code.slice(3)));
  for (const [kod, u] of Object.entries(URUNLER)) if (!u.mamul && u.bolgeler?.some((b) => plakalar.has(b))) havuz.add(kod);
  const yapilar = new Set(db.prepare(`SELECT DISTINCT s.type FROM structures s JOIN parcels p ON p.id = s.parcel_id
                                      WHERE p.owner_user_id = ? AND s.status = 'ACTIVE'`).all(userId).map((r) => r.type));
  for (const [tip, h] of Object.entries(HAYVANLAR)) if (yapilar.has(tip)) havuz.add(h.urun);
  for (const [kod, r] of Object.entries(RECETELER)) if (yapilar.has(r.tesis) && kod !== 'YEM') havuz.add(kod);
  return [...havuz];
}
function siparisUret(userId, t) {
  const sv = oyuncuSeviyesi(userId);
  const havuz = urunHavuzu(userId);
  const n = Math.min(havuz.length, SIPARIS.kalemMin + Math.floor(Math.random() * (SIPARIS.kalemMaks - SIPARIS.kalemMin + 1)));
  const secilen = havuz.sort(() => Math.random() - 0.5).slice(0, n);
  const kalemler = {};
  let deger = 0, adetToplam = 0;
  for (const kod of secilen) {
    const u = URUNLER[kod];
    const taban = u.hayvansal ? 3 : u.mamul ? 1 : 6;
    const adet = taban + Math.floor(Math.random() * (taban * (1 + sv * 0.25)));
    kalemler[kod] = adet;
    deger += u.tabanFiyat * adet;
    adetToplam += adet;
  }
  const odul = L.yuvarla(Math.max(5, deger * SIPARIS.primOrani));
  const tp = Math.round(5 + adetToplam * SIPARIS.tpCarpani * 0.5);
  const musteri = SIPARIS.musteriler[Math.floor(Math.random() * SIPARIS.musteriler.length)];
  db.prepare(`INSERT INTO siparisler (user_id, musteri, kalemler, odul, tp, olusturma, son) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(userId, musteri, JSON.stringify(kalemler), odul, tp, t, t + SIPARIS.sureMs);
}
function siparisBakim(userId, t = simdi()) {
  db.prepare(`UPDATE siparisler SET durum = 'SURESI_DOLDU', bitis = son WHERE user_id = ? AND durum = 'ACIK' AND son <= ?`).run(userId, t);
  const u = db.prepare(`SELECT siparis_sonraki FROM users WHERE id = ?`).get(userId);
  let acik = db.prepare(`SELECT COUNT(*) c FROM siparisler WHERE user_id = ? AND durum = 'ACIK'`).get(userId).c;
  if (u.siparis_sonraki == null) {
    // İlk ziyaret: pano dolu başlar
    for (; acik < SIPARIS.acikMaks - 1; acik++) siparisUret(userId, t);
    db.prepare(`UPDATE users SET siparis_sonraki = ? WHERE id = ?`).run(t + SIPARIS.yenilemeMs, userId);
    return;
  }
  let sonraki = u.siparis_sonraki;
  while (acik < SIPARIS.acikMaks && sonraki <= t) { siparisUret(userId, sonraki); acik++; sonraki += SIPARIS.yenilemeMs; }
  if (acik >= SIPARIS.acikMaks && sonraki <= t) sonraki = t + SIPARIS.yenilemeMs;
  if (sonraki !== u.siparis_sonraki) db.prepare(`UPDATE users SET siparis_sonraki = ? WHERE id = ?`).run(sonraki, userId);
}
function siparisler(userId) {
  const t = simdi();
  siparisBakim(userId, t);
  const envanter = Object.fromEntries(L.envanter(userId).map((i) => [i.item_id, i.miktar]));
  const liste = db.prepare(`SELECT * FROM siparisler WHERE user_id = ? AND durum = 'ACIK' ORDER BY id`).all(userId).map((s) => {
    const kalemler = Object.entries(JSON.parse(s.kalemler)).map(([kod, adet]) => ({ kod, ad: URUNLER[kod]?.ad || kod, ikon: URUNLER[kod]?.ikon || '📦', adet, eldeki: envanter[kod] || 0 }));
    return { id: s.id, musteri: s.musteri, kalemler, odul: s.odul, tp: s.tp, son: s.son, kalanMs: s.son - t, hazir: kalemler.every((k) => k.eldeki >= k.adet) };
  });
  const u = db.prepare(`SELECT siparis_sonraki FROM users WHERE id = ?`).get(userId);
  return { liste, sonrakiMs: liste.length < SIPARIS.acikMaks ? Math.max(0, (u.siparis_sonraki || t) - t) : null, maks: SIPARIS.acikMaks };
}
const siparisTeslim = db.transaction((userId, siparisId) => {
  require('./ekonomi').envanterBozulmasi(userId);
  const s = db.prepare(`SELECT * FROM siparisler WHERE id = ? AND user_id = ?`).get(Number(siparisId), userId);
  if (!s) throw new OyunHatasi(404, 'Sipariş bulunamadı');
  if (s.durum !== 'ACIK' || s.son <= simdi()) throw new OyunHatasi(409, 'Sipariş artık açık değil');
  const tx = L.yeniTx();
  for (const [kod, adet] of Object.entries(JSON.parse(s.kalemler))) L.envanterDegis(userId, kod, -adet, `Sipariş teslimi: ${s.musteri}`, tx);
  L.odul(userId, s.odul, `Sipariş ödemesi: ${s.musteri}`, tx);
  db.prepare(`UPDATE siparisler SET durum = 'TESLIM', bitis = ? WHERE id = ?`).run(simdi(), s.id);
  L.denetim({ aktor: userId, eylem: 'ORDER_DELIVERED', varlik: String(s.id), sonra: { musteri: s.musteri, odul: s.odul } });
  tpEkle(userId, s.tp, 'ORDER_DELIVERED');
  return { tamam: true, odul: s.odul, tp: s.tp, musteri: s.musteri };
});
const siparisReddet = db.transaction((userId, siparisId) => {
  const s = db.prepare(`SELECT * FROM siparisler WHERE id = ? AND user_id = ? AND durum = 'ACIK'`).get(Number(siparisId), userId);
  if (!s) throw new OyunHatasi(404, 'Açık sipariş bulunamadı');
  db.prepare(`UPDATE siparisler SET durum = 'REDDEDILDI', bitis = ? WHERE id = ?`).run(simdi(), s.id);
  // Yerine yenisi biraz sonra gelir
  const u = db.prepare(`SELECT siparis_sonraki FROM users WHERE id = ?`).get(userId);
  db.prepare(`UPDATE users SET siparis_sonraki = ? WHERE id = ?`).run(Math.max(u.siparis_sonraki || 0, simdi() + SIPARIS.reddetBeklemeMs), userId);
  return { tamam: true };
});

// ---------- Haftalık köy yarışması (mahalle)
const HAFTA = 7 * 86400_000;
const haftaNo = (t) => Math.floor((t - LIG.baslangic) / HAFTA);
const haftaAraligi = (h) => [LIG.baslangic + h * HAFTA, LIG.baslangic + (h + 1) * HAFTA];
// Sıralamaya yalnızca mahallede parseli olan oyuncular girer; başka mahallelerde komşu yardımıyla kazanılan TP sayılmaz
const YARISMA_DISI = ['NEIGHBOR_HELPED', 'GIFT_SENT', 'DAILY_REWARD_CLAIMED', 'EVENT_REWARD_CLAIMED'];
function siralama(regionId, h) {
  const [a, b] = haftaAraligi(h);
  return db.prepare(`SELECT k.user_id, u.display_name AS ad, u.is_npc AS npc, SUM(k.tp) AS tp FROM tp_kayitlari k JOIN users u ON u.id = k.user_id
                     WHERE k.region_id = ? AND k.at >= ? AND k.at < ? AND k.eylem NOT IN (${YARISMA_DISI.map(() => '?').join(',')})
                       AND EXISTS (SELECT 1 FROM parcels p WHERE p.owner_user_id = k.user_id AND p.region_id = k.region_id)
                     GROUP BY k.user_id ORDER BY tp DESC, MIN(k.at) LIMIT 20`).all(regionId, a, b, ...YARISMA_DISI);
}
// Geçen haftanın ödülleri bir kez dağıtılır (birincil anahtar ikinci dağıtımı engeller). Demo sakinler ödül almaz; en az
// YARISMA.minKatilimci gerçek oyuncu yarışmamışsa ödül verilmez (tek kişilik mahallede kendi kendine kazanılmasın).
const odulDagit = db.transaction((regionId, h) => {
  if (h < 0 || db.prepare(`SELECT 1 FROM yarisma_odulleri WHERE hafta = ? AND region_id = ?`).get(h, regionId)) return;
  const gercek = siralama(regionId, h).filter((r) => !r.npc);
  const katilimci = gercek.filter((r) => r.tp >= YARISMA.minTp);
  const kazananlar = katilimci.length >= YARISMA.minKatilimci ? katilimci.slice(0, YARISMA.odul.length) : [];
  kazananlar.forEach((r, i) => {
    db.prepare(`INSERT INTO yarisma_odulleri (hafta, region_id, sira, user_id, tp, odul) VALUES (?, ?, ?, ?, ?, ?)`).run(h, regionId, i + 1, r.user_id, r.tp, YARISMA.odul[i]);
    L.odul(r.user_id, YARISMA.odul[i], `Köy yarışması ${i + 1}.lik ödülü`);
    require('./pazar').bildir(r.user_id, `🏆 Köy yarışmasında ${i + 1}. oldun: ${YARISMA.odul[i]} akçe`, 'gorevler');
  });
  if (!kazananlar.length) db.prepare(`INSERT INTO yarisma_odulleri (hafta, region_id, sira, user_id, tp, odul) VALUES (?, ?, 0, (SELECT MIN(id) FROM users), 0, 0)`).run(h, regionId);
});
function yarisma(regionId, userId = null) {
  if (!regionId) return null;
  if (!db.prepare(`SELECT 1 FROM regions WHERE id = ? AND type = 'MAHALLE'`).get(Number(regionId))) throw new OyunHatasi(404, 'Mahalle bulunamadı');
  const t = simdi(), h = haftaNo(t);
  odulDagit(regionId, h - 1);
  const liste = siralama(regionId, h).map((r, i) => ({ sira: i + 1, ad: r.ad, demo: !!r.npc, tp: r.tp, ben: r.user_id === userId }));
  const gecen = db.prepare(`SELECT y.sira, y.odul, y.tp, u.display_name AS ad FROM yarisma_odulleri y JOIN users u ON u.id = y.user_id
                            WHERE y.hafta = ? AND y.region_id = ? AND y.sira > 0 ORDER BY y.sira`).all(h - 1, regionId);
  const bolge = db.prepare(`SELECT name FROM regions WHERE id = ?`).get(regionId);
  return { mahalle: bolge?.name, mahalleId: regionId, liste, gecenHafta: gecen, odul: YARISMA.odul, bitisMs: haftaAraligi(h)[1] - t, minTp: YARISMA.minTp, minKatilimci: YARISMA.minKatilimci };
}

// ---------- Çiftlik süsleri
function parselSusleri(parcelId) {
  return db.prepare(`SELECT id, tur, yuva FROM parsel_susleri WHERE parcel_id = ? ORDER BY yuva`).all(parcelId)
    .map((s) => ({ ...s, ad: SUSLER[s.tur]?.ad, ikon: SUSLER[s.tur]?.ikon }));
}
const susKodu = (parcelId) => parselSusleri(parcelId).map((s) => `${s.tur}:${s.yuva}`).join(',');
const susEkle = db.transaction((userId, parcelId, tur) => {
  const oyun = require('./oyun');
  const p = oyun.parselGetir(parcelId);
  oyun.sahibiOlmali(p, userId);
  const s = bul(SUSLER, tur);
  if (!s) throw new OyunHatasi(400, 'Geçersiz süs');
  seviyeKontrol(userId, s.minSeviye, s.ad);
  if (s.etkinlik && !require('./etkinlik').etkinlikAktifMi(s.etkinlik)) throw new OyunHatasi(409, `${s.ad} yalnızca etkinlik süresince alınabilir`);
  const dolu = new Set(db.prepare(`SELECT yuva FROM parsel_susleri WHERE parcel_id = ?`).all(p.id).map((r) => r.yuva));
  if (dolu.size >= SUS_MAKS) throw new OyunHatasi(409, `Bir parselde en çok ${SUS_MAKS} süs olabilir`);
  let yuva = 0;
  while (dolu.has(yuva)) yuva++;
  L.harca(userId, s.fiyat, `Süs: ${s.ad}`);
  const id = db.prepare(`INSERT INTO parsel_susleri (parcel_id, user_id, tur, yuva, at) VALUES (?, ?, ?, ?, ?)`).run(p.id, userId, tur, yuva, simdi()).lastInsertRowid;
  L.denetim({ aktor: userId, eylem: 'DECORATION_PLACED', varlik: p.id, sonra: { tur, yuva }, bolge: p.region_id });
  return { tamam: true, id, yuva };
});
const susKaldir = db.transaction((userId, susId) => {
  const oyun = require('./oyun');
  const s = db.prepare(`SELECT * FROM parsel_susleri WHERE id = ?`).get(Number(susId));
  if (!s) throw new OyunHatasi(404, 'Süs bulunamadı');
  oyun.sahibiOlmali(oyun.parselGetir(s.parcel_id), userId);
  db.prepare(`DELETE FROM parsel_susleri WHERE id = ?`).run(s.id);
  return { tamam: true };
});
const susSecenekleri = (userId) => {
  const sv = oyuncuSeviyesi(userId);
  const etkinlik = require('./etkinlik').aktifEtkinlik()?.kod;
  // Etkinlik süsleri yalnızca kendi etkinliği sürerken listelenir
  return Object.entries(SUSLER).filter(([, s]) => !s.etkinlik || s.etkinlik === etkinlik)
    .map(([kod, s]) => ({ kod, ad: s.ad, ikon: s.ikon, fiyat: s.fiyat, minSeviye: s.minSeviye, acik: sv >= s.minSeviye, etkinlik: !!s.etkinlik }));
};

// Görevler sekmesi için tek özet
function ozet(userId) {
  return { seviye: seviyeBilgisi(userId), gunluk: gunlukDurum(userId), siparisler: siparisler(userId), yarisma: yarisma(anaBolge(userId), userId) };
}

module.exports = {
  seviyeHesap, seviyeEsigi, oyuncuSeviyesi, seviyeBilgisi, seviyeOdulAl, seviyeKontrol, tpEkle,
  gunlukDurum, gunlukAl,
  hayvanDurumu, besle, topla, parselHayvanHazir,
  siparisler, siparisTeslim, siparisReddet,
  yarisma, haftaNo,
  parselSusleri, susKodu, susEkle, susKaldir, susSecenekleri,
  ozet,
};
