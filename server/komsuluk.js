// Komşuluk: arkadaşlık (istek → kabul), komşunun tarlasına yardım (sulama sayılır ya da olgunlaşma kısalır),
// günlük hediye (arkadaş başına bir; alıcı kutusundan alır) ve arkadaşa ürün gönderme (bölgeler arası takasın kısa yolu).
// Demo sakinler arkadaşlık isteklerini hemen kabul eder ve arada hediye yollar; oyunun ilk günlerinde de yalnız kalınmasın.
const db = require('./db');
const L = require('./lib/ledger');
const { KOMSULUK, URUNLER, TARIM } = require('./config/rules');
const { OyunHatasi } = L;


const gun = (t = Date.now()) => new Date(t + 3 * 3600_000).toISOString().slice(0, 10);   // Türkiye tarihi
const DEMO_HEDIYE_GUNLUK = 3;   // demo sakin komşulardan günde en çok bu kadar hediye gelir
const HEDIYE_ARKADASLIK_MS = KOMSULUK.hediyeArkadaslikMs;
const kullanici = (id) => db.prepare(`SELECT id, display_name AS ad, is_npc AS npc, status FROM users WHERE id = ?`).get(id);
const bildir = (...a) => require('./pazar').bildir(...a);
function iliski(a, b) {
  return db.prepare(`SELECT * FROM arkadasliklar WHERE (isteyen = ? AND hedef = ?) OR (isteyen = ? AND hedef = ?)`).get(a, b, b, a) || null;
}
// Silinmiş hesapla arkadaşlık sayılmaz (satırı kalır ama hediye, ürün ve yardım gitmez; arkadaş sınırını da doldurmaz)
const silinmis = (id) => kullanici(id)?.status === 'DELETED';
const arkadasMi = (a, b) => iliski(a, b)?.durum === 'KABUL' && !silinmis(a) && !silinmis(b);
function arkadasIdleri(userId) {
  return db.prepare(`SELECT x.id FROM (SELECT CASE WHEN isteyen = ? THEN hedef ELSE isteyen END AS id FROM arkadasliklar
                     WHERE (isteyen = ? OR hedef = ?) AND durum = 'KABUL') x JOIN users u ON u.id = x.id
                     WHERE u.status IS NOT 'DELETED'`).all(userId, userId, userId).map((r) => r.id);
}
function arkadasSiniri(userId, ben) {
  if (arkadasIdleri(userId).length < KOMSULUK.maxArkadas) return;
  throw new OyunHatasi(409, ben ? `En çok ${KOMSULUK.maxArkadas} arkadaşın olabilir` : `${kullanici(userId).ad} arkadaş sınırına (${KOMSULUK.maxArkadas}) ulaşmış`, 'ARKADAS_SINIRI');
}

// ---------- Arkadaşlık
const istekGonder = db.transaction((userId, { parselId, kullaniciId } = {}) => {
  let hedef = Number(kullaniciId) || null;
  if (!hedef && parselId) hedef = db.prepare(`SELECT owner_user_id FROM parcels WHERE id = ?`).get(String(parselId))?.owner_user_id || null;
  const k = hedef && kullanici(hedef);
  if (!k || k.status === 'DELETED') throw new OyunHatasi(404, 'Oyuncu bulunamadı');
  if (k.id === userId) throw new OyunHatasi(409, 'Kendine arkadaşlık isteği gönderemezsin');
  if (k.id === require('./piyasa').hazineId(false)) throw new OyunHatasi(409, 'Hazine ile komşu olunmaz');
  const var_ = iliski(userId, k.id);
  if (var_?.durum === 'KABUL') throw new OyunHatasi(409, 'Zaten arkadaşsınız');
  arkadasSiniri(userId, true);
  // Karşı taraf zaten istek göndermişse kabul sayılır
  if (var_ && var_.isteyen === k.id) return istekKabul(userId, k.id);
  if (var_) throw new OyunHatasi(409, 'İsteğin zaten bekliyor');
  if (!k.npc) arkadasSiniri(k.id);
  const t = Date.now();
  if (db.prepare(`SELECT COUNT(*) c FROM arkadas_istek_gecmisi WHERE isteyen = ? AND at > ?`).get(userId, t - 86400_000).c >= KOMSULUK.istekGunluk) {
    throw new OyunHatasi(429, `Günde en çok ${KOMSULUK.istekGunluk} komşuluk isteği gönderebilirsin`);
  }
  if (!k.npc && db.prepare(`SELECT 1 FROM arkadas_istek_gecmisi WHERE isteyen = ? AND hedef = ? AND at > ?`).get(userId, k.id, t - KOMSULUK.istekTekrarMs)) {
    throw new OyunHatasi(429, 'Bu oyuncuya kısa süre önce istek gönderdin; bir hafta sonra yeniden deneyebilirsin');
  }
  db.prepare(`INSERT INTO arkadas_istek_gecmisi (isteyen, hedef, at) VALUES (?, ?, ?)`).run(userId, k.id, t);
  if (k.npc) {
    db.prepare(`INSERT INTO arkadasliklar (isteyen, hedef, durum, at, kabul_at) VALUES (?, ?, 'KABUL', ?, ?)`).run(userId, k.id, t, t);
    return { tamam: true, kabul: true, ad: k.ad };
  }
  db.prepare(`INSERT INTO arkadasliklar (isteyen, hedef, at) VALUES (?, ?, ?)`).run(userId, k.id, t);
  bildir(k.id, `🤝 ${kullanici(userId).ad} seninle komşu olmak istiyor`, 'komsuluk');
  return { tamam: true, kabul: false, ad: k.ad };
});
function istekKabul(userId, digerId) {
  const r = db.prepare(`SELECT * FROM arkadasliklar WHERE isteyen = ? AND hedef = ? AND durum = 'ISTEK'`).get(Number(digerId), userId);
  if (!r) throw new OyunHatasi(404, 'Bekleyen istek yok');
  arkadasSiniri(userId, true);
  arkadasSiniri(r.isteyen);
  db.prepare(`UPDATE arkadasliklar SET durum = 'KABUL', kabul_at = ? WHERE isteyen = ? AND hedef = ?`).run(Date.now(), r.isteyen, userId);
  bildir(r.isteyen, `🤝 ${kullanici(userId).ad} komşuluk isteğini kabul etti`, 'komsuluk');
  return { tamam: true, kabul: true, ad: kullanici(r.isteyen).ad };
}
function iliskiSil(userId, digerId) {
  const n = db.prepare(`DELETE FROM arkadasliklar WHERE (isteyen = ? AND hedef = ?) OR (isteyen = ? AND hedef = ?)`).run(userId, Number(digerId), Number(digerId), userId).changes;
  if (!n) throw new OyunHatasi(404, 'Arkadaşlık bulunamadı');
  return { tamam: true };
}

// ---------- Tarla yardımı
const yardimEt = db.transaction((userId, parselId) => {
  const p = db.prepare(`SELECT id, owner_user_id, region_id FROM parcels WHERE id = ?`).get(String(parselId));
  if (!p?.owner_user_id) throw new OyunHatasi(404, 'Sahipli bir parsel değil');
  if (p.owner_user_id === userId) throw new OyunHatasi(409, 'Kendi tarlana yardım edemezsin');
  if (!arkadasMi(userId, p.owner_user_id)) throw new OyunHatasi(403, 'Yalnızca komşularının tarlasına yardım edebilirsin');
  const g = gun();
  if (db.prepare(`SELECT COUNT(*) c FROM yardimlar WHERE yardimci = ? AND gun = ?`).get(userId, g).c >= KOMSULUK.yardimGunluk) {
    throw new OyunHatasi(429, `Bugün ${KOMSULUK.yardimGunluk} yardım hakkını kullandın`);
  }
  if (db.prepare(`SELECT 1 FROM yardimlar WHERE yardimci = ? AND parcel_id = ? AND gun = ?`).get(userId, p.id, g)) throw new OyunHatasi(409, 'Bu tarlaya bugün zaten yardım ettin');
  if (db.prepare(`SELECT COUNT(*) c FROM yardimlar WHERE parcel_id = ? AND gun = ?`).get(p.id, g).c >= KOMSULUK.parselYardimGunluk) {
    throw new OyunHatasi(429, 'Bu tarla bugün yeterince yardım aldı');
  }
  const e = db.prepare(`SELECT * FROM crops WHERE parcel_id = ? AND status = 'GROWING'`).get(p.id);
  const t = Date.now();
  if (!e) throw new OyunHatasi(409, 'Tarlada büyüyen ekin yok');
  if (e.user_id === userId) throw new OyunHatasi(409, 'Kendi ekinine yardım edemezsin');   // kiracı
  if (e.ready_at <= t) throw new OyunHatasi(409, 'Ekin zaten hasada hazır');
  const gereken = URUNLER[e.crop_type]?.sulama || 0;
  const hat = db.prepare(`SELECT 1 FROM structures WHERE parcel_id = ? AND type = 'SULAMA_HATTI' AND status = 'ACTIVE'`).get(p.id);
  let etki;
  if (!hat && e.waterings < gereken) {
    db.prepare(`UPDATE crops SET waterings = waterings + 1, last_watered_at = ? WHERE id = ?`).run(t, e.id);
    etki = 'SULADI';
  } else {
    const kisalma = Math.round((e.ready_at - e.planted_at) * KOMSULUK.yardimKisaltma);
    db.prepare(`UPDATE crops SET ready_at = MAX(?, ready_at - ?) WHERE id = ?`).run(t + 1000, kisalma, e.id);
    etki = 'BAKIM';
  }
  db.prepare(`INSERT INTO yardimlar (yardimci, parcel_id, sahip, gun, etki, at) VALUES (?, ?, ?, ?, ?, ?)`).run(userId, p.id, p.owner_user_id, g, etki, t);
  L.odul(userId, KOMSULUK.yardimOdul, 'Komşu yardımı');
  const ad = kullanici(userId).ad;
  L.denetim({ aktor: userId, eylem: 'NEIGHBOR_HELPED', varlik: p.id, sonra: { sahip: kullanici(p.owner_user_id).ad, etki }, bolge: p.region_id, herkese: true });
  bildir(p.owner_user_id, etki === 'SULADI' ? `💧 ${ad} tarlanı suladı` : `🌱 ${ad} tarlanın bakımını yaptı; ekin daha erken olgunlaşacak`, `parsel:${p.id}`);
  return { tamam: true, etki, odul: KOMSULUK.yardimOdul };
});

// ---------- Hediye
function hediyeSec() { return KOMSULUK.hediyeler[Math.floor(Math.random() * KOMSULUK.hediyeler.length)]; }
// Değer aktaran işlemler için seviye eşiği: yeni açılan yan hesaplar ana hesaba hediye ve ürün akıtamasın
function gondericiSeviyesi(userId, is) {
  if (require('./ciftlik').oyuncuSeviyesi(userId) < KOMSULUK.gonderimMinSeviye) throw new OyunHatasi(403, `${is} seviye ${require('./lib/turkce').sayiBulunma(KOMSULUK.gonderimMinSeviye)} açılır`, 'SEVIYE');
}
const hediyeGonder = db.transaction((userId, aliciId) => {
  const a = Number(aliciId);
  if (!arkadasMi(userId, a)) throw new OyunHatasi(403, 'Yalnızca arkadaşlarına hediye gönderebilirsin');
  gondericiSeviyesi(userId, 'Hediye göndermek');
  const r = iliski(userId, a), yas = Date.now() - (r.kabul_at ?? r.at);
  if (yas < HEDIYE_ARKADASLIK_MS) throw new OyunHatasi(409, `Yeni komşuna ${Math.ceil((HEDIYE_ARKADASLIK_MS - yas) / 3600_000)} saat sonra hediye gönderebilirsin`, 'YENI_ARKADAS');
  const g = gun();
  if (db.prepare(`SELECT 1 FROM hediyeler WHERE gonderen = ? AND alici = ? AND gun = ?`).get(userId, a, g)) throw new OyunHatasi(409, 'Bu arkadaşına bugün hediye gönderdin');
  db.prepare(`INSERT INTO hediyeler (gonderen, alici, gun, icerik, at) VALUES (?, ?, ?, ?, ?)`).run(userId, a, g, JSON.stringify(hediyeSec()), Date.now());
  L.denetim({ aktor: userId, eylem: 'GIFT_SENT', sonra: { alici: a } });
  if (!kullanici(a).npc) bildir(a, `🎁 ${kullanici(userId).ad} sana hediye gönderdi`, 'komsuluk');
  return { tamam: true };
});
const hediyeAl = db.transaction((userId, hediyeId) => {
  const hd = db.prepare(`SELECT * FROM hediyeler WHERE id = ? AND alici = ?`).get(Number(hediyeId), userId);
  if (!hd) throw new OyunHatasi(404, 'Hediye bulunamadı');
  if (hd.durum !== 'BEKLIYOR') throw new OyunHatasi(409, 'Bu hediyeyi zaten aldın');
  const bugun = db.prepare(`SELECT COUNT(*) c FROM hediyeler WHERE alici = ? AND durum = 'ALINDI' AND alindi_gun = ?`).get(userId, gun()).c;
  if (bugun >= KOMSULUK.hediyeGunlukAlim) throw new OyunHatasi(429, `Günde en çok ${KOMSULUK.hediyeGunlukAlim} hediye açılır; kalanlar yarın`);
  const ic = JSON.parse(hd.icerik);
  if (ic.akce) L.odul(userId, ic.akce, `Hediye: ${kullanici(hd.gonderen)?.ad || 'komşu'}`);
  else L.envanterDegis(userId, ic.urun, ic.adet, `Hediye: ${kullanici(hd.gonderen)?.ad || 'komşu'}`);
  db.prepare(`UPDATE hediyeler SET durum = 'ALINDI', alindi_gun = ? WHERE id = ?`).run(gun(), hd.id);
  return { tamam: true, ...ic, ad: ic.urun ? URUNLER[ic.urun].ad : null };
});

// ---------- Arkadaşa ürün gönderme (takas)
const urunGonder = db.transaction((userId, { kullaniciId, urun, adet } = {}) => {
  const a = Number(kullaniciId), n = Number(adet);
  if (!arkadasMi(userId, a)) throw new OyunHatasi(403, 'Yalnızca arkadaşlarına ürün gönderebilirsin');
  gondericiSeviyesi(userId, 'Ürün göndermek');
  if (!Object.hasOwn(URUNLER, String(urun))) throw new OyunHatasi(400, 'Bilinmeyen ürün');
  if (!Number.isInteger(n) || n < 1) throw new OyunHatasi(400, 'Geçersiz adet');
  const g = gun();
  const bugun = db.prepare(`SELECT COALESCE(SUM(adet), 0) s FROM urun_gonderimleri WHERE gonderen = ? AND gun = ?`).get(userId, g).s;
  if (bugun + n > KOMSULUK.gonderimGunlukAdet) throw new OyunHatasi(429, `Günde en çok ${KOMSULUK.gonderimGunlukAdet} ürün gönderebilirsin (bugün ${bugun})`);
  require('./ekonomi').envanterBozulmasi(userId);
  const tx = L.yeniTx();
  L.envanterDegis(userId, urun, -n, `Gönderildi: ${kullanici(a).ad}`, tx);
  L.envanterDegis(a, urun, n, `Hediye ürün: ${kullanici(userId).ad}`, tx);
  db.prepare(`INSERT INTO urun_gonderimleri (gonderen, alici, urun, adet, gun, at) VALUES (?, ?, ?, ?, ?, ?)`).run(userId, a, urun, n, g, Date.now());
  L.denetim({ aktor: userId, eylem: 'ITEMS_SENT', sonra: { alici: a, urun, adet: n } });
  if (!kullanici(a).npc) bildir(a, `📦 ${kullanici(userId).ad} sana ${n} ${URUNLER[urun].ad} gönderdi`, 'arazilerim');
  return { tamam: true };
});

// Demo sakin arkadaşlar günde bir kez hediye yollar (oyuncu komşuluk sayfasını açtığında)
function demoHediyeleri(userId) {
  const g = gun();
  let n = db.prepare(`SELECT COUNT(*) c FROM hediyeler h JOIN users u ON u.id = h.gonderen WHERE h.alici = ? AND h.gun = ? AND u.is_npc = 1`).get(userId, g).c;
  for (const id of arkadasIdleri(userId)) {
    if (n >= DEMO_HEDIYE_GUNLUK) break;
    if (!kullanici(id)?.npc || Math.random() < 0.4) continue;
    n++;
    db.prepare(`INSERT OR IGNORE INTO hediyeler (gonderen, alici, gun, icerik, at) VALUES (?, ?, ?, ?, ?)`).run(id, userId, g, JSON.stringify(hediyeSec()), Date.now());
  }
}

// ---------- Özet
function ozet(userId) {
  demoHediyeleri(userId);
  const g = gun();
  const t = Date.now();
  const arkadaslar = arkadasIdleri(userId).map((id) => {
    const k = kullanici(id);
    const p = db.prepare(`SELECT p.id, p.centroid_lon AS lon, p.centroid_lat AS lat, r.name AS mahalle FROM parcels p JOIN regions r ON r.id = p.region_id
                          WHERE p.owner_user_id = ? ORDER BY p.acquired_at LIMIT 1`).get(id);
    // Yardım bekleyen tarlası (büyüyen ekin) var mı
    const yardim = db.prepare(`SELECT c.parcel_id FROM crops c WHERE c.user_id = ? AND c.status = 'GROWING' AND c.ready_at > ?
                                 AND NOT EXISTS (SELECT 1 FROM yardimlar y WHERE y.yardimci = ? AND y.parcel_id = c.parcel_id AND y.gun = ?) LIMIT 1`).get(id, t, userId, g);
    return { id, ad: k.ad, demo: !!k.npc, seviye: require('./ciftlik').oyuncuSeviyesi(id), parsel: p || null,
      yardimParsel: yardim?.parcel_id || null, hediyeGonderildi: !!db.prepare(`SELECT 1 FROM hediyeler WHERE gonderen = ? AND alici = ? AND gun = ?`).get(userId, id, g) };
  });
  const gelen = db.prepare(`SELECT a.isteyen AS id, u.display_name AS ad FROM arkadasliklar a JOIN users u ON u.id = a.isteyen WHERE a.hedef = ? AND a.durum = 'ISTEK'`).all(userId);
  const giden = db.prepare(`SELECT a.hedef AS id, u.display_name AS ad FROM arkadasliklar a JOIN users u ON u.id = a.hedef WHERE a.isteyen = ? AND a.durum = 'ISTEK'`).all(userId);
  const hediyeler = db.prepare(`SELECT h.id, h.icerik, u.display_name AS gonderen FROM hediyeler h JOIN users u ON u.id = h.gonderen WHERE h.alici = ? AND h.durum = 'BEKLIYOR' ORDER BY h.id`).all(userId)
    .map((h) => { const ic = JSON.parse(h.icerik); return { id: h.id, gonderen: h.gonderen, ...ic, ad: ic.urun ? URUNLER[ic.urun].ad : null, ikon: ic.urun ? URUNLER[ic.urun].ikon : '🪙' }; });
  const yardimBugun = db.prepare(`SELECT COUNT(*) c FROM yardimlar WHERE yardimci = ? AND gun = ?`).get(userId, g).c;
  const gonderimBugun = db.prepare(`SELECT COALESCE(SUM(adet), 0) s FROM urun_gonderimleri WHERE gonderen = ? AND gun = ?`).get(userId, g).s;
  const gonderebilir = require('./ciftlik').oyuncuSeviyesi(userId) >= KOMSULUK.gonderimMinSeviye;
  return { arkadaslar, gelen, giden, hediyeler, limitler: { yardim: KOMSULUK.yardimGunluk, yardimBugun, gonderim: KOMSULUK.gonderimGunlukAdet, gonderimBugun,
    gonderebilir, gonderimSeviye: KOMSULUK.gonderimMinSeviye } };
}
// Parsel kartı için: bu parselin sahibiyle ilişki ve yardım edilebilirlik
function parselIliskisi(userId, parcelId) {
  if (!userId) return null;
  const p = db.prepare(`SELECT owner_user_id FROM parcels WHERE id = ?`).get(parcelId);
  if (!p?.owner_user_id || p.owner_user_id === userId) return null;
  const r = iliski(userId, p.owner_user_id);
  const e = db.prepare(`SELECT ready_at, user_id FROM crops WHERE parcel_id = ? AND status = 'GROWING' AND user_id <> ?`).get(parcelId, userId);
  return {
    durum: r ? (r.durum === 'KABUL' ? 'ARKADAS' : r.isteyen === userId ? 'ISTEK_GIDEN' : 'ISTEK_GELEN') : 'YOK',
    yardim: r?.durum === 'KABUL' && !!e && e.ready_at > Date.now() && !db.prepare(`SELECT 1 FROM yardimlar WHERE yardimci = ? AND parcel_id = ? AND gun = ?`).get(userId, parcelId, gun()),
  };
}

function rotalar(app, { h, auth }) {
  app.get('/api/komsuluk', auth.girisGerekli, h((req) => ozet(req.kullanici.id)));
  // Değer aktaran ya da başkasına bildirim gönderen işlemler doğrulanmış e-posta ister (pazar ve borsa gibi)
  app.post('/api/arkadas/istek', auth.dogrulanmisGerekli, h((req) => istekGonder(req.kullanici.id, req.body || {})));
  app.post('/api/arkadas/:id/kabul', auth.girisGerekli, h((req) => db.transaction(() => istekKabul(req.kullanici.id, req.params.id))()));
  app.post('/api/arkadas/:id/sil', auth.girisGerekli, h((req) => iliskiSil(req.kullanici.id, req.params.id)));
  app.post('/api/parsel/:id/yardim', auth.dogrulanmisGerekli, h((req) => yardimEt(req.kullanici.id, req.params.id)));
  app.post('/api/hediye/gonder', auth.dogrulanmisGerekli, h((req) => hediyeGonder(req.kullanici.id, req.body?.kullaniciId)));
  app.post('/api/hediye/:id/al', auth.girisGerekli, h((req) => hediyeAl(req.kullanici.id, req.params.id)));
  app.post('/api/urun/gonder', auth.dogrulanmisGerekli, h((req) => urunGonder(req.kullanici.id, req.body || {})));
}

module.exports = { rotalar, ozet, istekGonder, yardimEt, hediyeGonder, hediyeAl, urunGonder, parselIliskisi, arkadasMi, gondericiSeviyesi };
