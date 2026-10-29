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
const kullanici = (id) => db.get(`SELECT id, display_name AS ad, is_npc AS npc, status FROM users WHERE id = ?`, id);
const bildir = (...a) => require('./pazar').bildir(...a);
async function iliski(a, b) {
  return (await db.get(`SELECT * FROM arkadasliklar WHERE (isteyen = ? AND hedef = ?) OR (isteyen = ? AND hedef = ?)`, a, b, b, a)) || null;
}
// Silinmiş hesapla arkadaşlık sayılmaz (satırı kalır ama hediye, ürün ve yardım gitmez; arkadaş sınırını da doldurmaz)
const silinmis = async (id) => (await kullanici(id))?.status === 'DELETED';
const arkadasMi = async (a, b) => (await iliski(a, b))?.durum === 'KABUL' && !await silinmis(a) && !await silinmis(b);
async function arkadasIdleri(userId) {
  return (await db.all(`SELECT x.id FROM (SELECT CASE WHEN isteyen = ? THEN hedef ELSE isteyen END AS id FROM arkadasliklar
                     WHERE (isteyen = ? OR hedef = ?) AND durum = 'KABUL') x JOIN users u ON u.id = x.id
                     WHERE COALESCE(u.status, '') <> 'DELETED'`, userId, userId, userId)).map((r) => r.id);
}
async function arkadasSiniri(userId, ben) {
  if ((await arkadasIdleri(userId)).length < KOMSULUK.maxArkadas) return;
  throw new OyunHatasi(409, ben ? `En çok ${KOMSULUK.maxArkadas} arkadaşın olabilir` : `${(await kullanici(userId)).ad} arkadaş sınırına (${KOMSULUK.maxArkadas}) ulaşmış`, 'ARKADAS_SINIRI');
}
// Eşzamanlı isteklerde sınırlar (arkadaş sayısı, günlük hak) aşılmasın: ilgili oyuncular işlem sonuna kadar kilitlenir
const oyuncuKilidi = (...idler) => db.kilit(...idler.map((id) => `komsuluk:${id}`));

// ---------- Arkadaşlık
const istekGonder = (userId, { parselId, kullaniciId } = {}) => db.tx(async () => {
  let hedef = Number(kullaniciId) || null;
  if (!hedef && parselId) hedef = (await db.get(`SELECT owner_user_id FROM parcels WHERE id = ?`, String(parselId)))?.owner_user_id || null;
  const k = hedef && await kullanici(hedef);
  if (!k || k.status === 'DELETED') throw new OyunHatasi(404, 'Oyuncu bulunamadı');
  if (k.id === userId) throw new OyunHatasi(409, 'Kendine arkadaşlık isteği gönderemezsin');
  if (k.id === await require('./piyasa').hazineId(false)) throw new OyunHatasi(409, 'Hazine ile komşu olunmaz');
  await oyuncuKilidi(userId, k.id);
  const var_ = await iliski(userId, k.id);
  if (var_?.durum === 'KABUL') throw new OyunHatasi(409, 'Zaten arkadaşsınız');
  await arkadasSiniri(userId, true);
  // Karşı taraf zaten istek göndermişse kabul sayılır
  if (var_ && var_.isteyen === k.id) return istekKabul(userId, k.id);
  if (var_) throw new OyunHatasi(409, 'İsteğin zaten bekliyor');
  if (!k.npc) await arkadasSiniri(k.id);
  const t = Date.now();
  if ((await db.get(`SELECT COUNT(*) c FROM arkadas_istek_gecmisi WHERE isteyen = ? AND at > ?`, userId, t - 86400_000)).c >= KOMSULUK.istekGunluk) {
    throw new OyunHatasi(429, `Günde en çok ${KOMSULUK.istekGunluk} komşuluk isteği gönderebilirsin`);
  }
  if (!k.npc && await db.get(`SELECT 1 FROM arkadas_istek_gecmisi WHERE isteyen = ? AND hedef = ? AND at > ?`, userId, k.id, t - KOMSULUK.istekTekrarMs)) {
    throw new OyunHatasi(429, 'Bu oyuncuya kısa süre önce istek gönderdin; bir hafta sonra yeniden deneyebilirsin');
  }
  await db.run(`INSERT INTO arkadas_istek_gecmisi (isteyen, hedef, at) VALUES (?, ?, ?)`, userId, k.id, t);
  if (k.npc) {
    await db.run(`INSERT INTO arkadasliklar (isteyen, hedef, durum, at, kabul_at) VALUES (?, ?, 'KABUL', ?, ?)`, userId, k.id, t, t);
    return { tamam: true, kabul: true, ad: k.ad };
  }
  await db.run(`INSERT INTO arkadasliklar (isteyen, hedef, at) VALUES (?, ?, ?)`, userId, k.id, t);
  await bildir(k.id, `🤝 ${(await kullanici(userId)).ad} seninle komşu olmak istiyor`, 'komsuluk');
  return { tamam: true, kabul: false, ad: k.ad };
});
// İşlem içinde çağrılır (istekGonder ya da kabul rotası)
async function istekKabul(userId, digerId) {
  await oyuncuKilidi(userId, Number(digerId));
  const r = await db.get(`SELECT * FROM arkadasliklar WHERE isteyen = ? AND hedef = ? AND durum = 'ISTEK'`, Number(digerId), userId);
  if (!r) throw new OyunHatasi(404, 'Bekleyen istek yok');
  await arkadasSiniri(userId, true);
  await arkadasSiniri(r.isteyen);
  const u = await db.run(`UPDATE arkadasliklar SET durum = 'KABUL', kabul_at = ? WHERE isteyen = ? AND hedef = ? AND durum = 'ISTEK'`, Date.now(), r.isteyen, userId);
  if (u.changes !== 1) throw new OyunHatasi(409, 'Bekleyen istek yok');
  await bildir(r.isteyen, `🤝 ${(await kullanici(userId)).ad} komşuluk isteğini kabul etti`, 'komsuluk');
  return { tamam: true, kabul: true, ad: (await kullanici(r.isteyen)).ad };
}
async function iliskiSil(userId, digerId) {
  const n = (await db.run(`DELETE FROM arkadasliklar WHERE (isteyen = ? AND hedef = ?) OR (isteyen = ? AND hedef = ?)`, userId, Number(digerId), Number(digerId), userId)).changes;
  if (!n) throw new OyunHatasi(404, 'Arkadaşlık bulunamadı');
  return { tamam: true };
}

// ---------- Tarla yardımı
const yardimEt = (userId, parselId) => db.tx(async () => {
  const p = await db.get(`SELECT id, owner_user_id, region_id FROM parcels WHERE id = ?`, String(parselId));
  if (!p?.owner_user_id) throw new OyunHatasi(404, 'Sahipli bir parsel değil');
  if (p.owner_user_id === userId) throw new OyunHatasi(409, 'Kendi tarlana yardım edemezsin');
  if (!await arkadasMi(userId, p.owner_user_id)) throw new OyunHatasi(403, 'Yalnızca komşularının tarlasına yardım edebilirsin');
  await db.kilit(`yardim:${userId}`, `yardim-parsel:${p.id}`);
  const g = gun();
  if ((await db.get(`SELECT COUNT(*) c FROM yardimlar WHERE yardimci = ? AND gun = ?`, userId, g)).c >= KOMSULUK.yardimGunluk) {
    throw new OyunHatasi(429, `Bugün ${KOMSULUK.yardimGunluk} yardım hakkını kullandın`);
  }
  if (await db.get(`SELECT 1 FROM yardimlar WHERE yardimci = ? AND parcel_id = ? AND gun = ?`, userId, p.id, g)) throw new OyunHatasi(409, 'Bu tarlaya bugün zaten yardım ettin');
  if ((await db.get(`SELECT COUNT(*) c FROM yardimlar WHERE parcel_id = ? AND gun = ?`, p.id, g)).c >= KOMSULUK.parselYardimGunluk) {
    throw new OyunHatasi(429, 'Bu tarla bugün yeterince yardım aldı');
  }
  const e = await db.get(`SELECT * FROM crops WHERE parcel_id = ? AND status = 'GROWING' FOR UPDATE`, p.id);
  const t = Date.now();
  if (!e) throw new OyunHatasi(409, 'Tarlada büyüyen ekin yok');
  if (e.user_id === userId) throw new OyunHatasi(409, 'Kendi ekinine yardım edemezsin');   // kiracı
  if (e.ready_at <= t) throw new OyunHatasi(409, 'Ekin zaten hasada hazır');
  const gereken = URUNLER[e.crop_type]?.sulama || 0;
  const hat = await db.get(`SELECT 1 FROM structures WHERE parcel_id = ? AND type = 'SULAMA_HATTI' AND status = 'ACTIVE'`, p.id);
  let etki;
  if (!hat && e.waterings < gereken) {
    await db.run(`UPDATE crops SET waterings = waterings + 1, last_watered_at = ? WHERE id = ?`, t, e.id);
    etki = 'SULADI';
  } else {
    const kisalma = Math.round((e.ready_at - e.planted_at) * KOMSULUK.yardimKisaltma);
    await db.run(`UPDATE crops SET ready_at = GREATEST(?, ready_at - ?) WHERE id = ?`, t + 1000, kisalma, e.id);
    etki = 'BAKIM';
  }
  await db.run(`INSERT INTO yardimlar (yardimci, parcel_id, sahip, gun, etki, at) VALUES (?, ?, ?, ?, ?, ?)`, userId, p.id, p.owner_user_id, g, etki, t);
  await L.odul(userId, KOMSULUK.yardimOdul, 'Komşu yardımı');
  const ad = (await kullanici(userId)).ad;
  await L.denetim({ aktor: userId, eylem: 'NEIGHBOR_HELPED', varlik: p.id, sonra: { sahip: (await kullanici(p.owner_user_id)).ad, etki }, bolge: p.region_id, herkese: true });
  await bildir(p.owner_user_id, etki === 'SULADI' ? `💧 ${ad} tarlanı suladı` : `🌱 ${ad} tarlanın bakımını yaptı; ekin daha erken olgunlaşacak`, `parsel:${p.id}`);
  return { tamam: true, etki, odul: KOMSULUK.yardimOdul };
});

// ---------- Hediye
function hediyeSec() { return KOMSULUK.hediyeler[Math.floor(Math.random() * KOMSULUK.hediyeler.length)]; }
// Değer aktaran işlemler için seviye eşiği: yeni açılan yan hesaplar ana hesaba hediye ve ürün akıtamasın
async function gondericiSeviyesi(userId, is) {
  if (await require('./ciftlik').oyuncuSeviyesi(userId) < KOMSULUK.gonderimMinSeviye) throw new OyunHatasi(403, `${is} seviye ${require('./lib/turkce').sayiBulunma(KOMSULUK.gonderimMinSeviye)} açılır`, 'SEVIYE');
}
const hediyeGonder = (userId, aliciId) => db.tx(async () => {
  const a = Number(aliciId);
  if (!await arkadasMi(userId, a)) throw new OyunHatasi(403, 'Yalnızca arkadaşlarına hediye gönderebilirsin');
  await gondericiSeviyesi(userId, 'Hediye göndermek');
  const r = await iliski(userId, a), yas = Date.now() - (r.kabul_at ?? r.at);
  if (yas < HEDIYE_ARKADASLIK_MS) throw new OyunHatasi(409, `Yeni komşuna ${Math.ceil((HEDIYE_ARKADASLIK_MS - yas) / 3600_000)} saat sonra hediye gönderebilirsin`, 'YENI_ARKADAS');
  const g = gun();
  if (await db.get(`SELECT 1 FROM hediyeler WHERE gonderen = ? AND alici = ? AND gun = ?`, userId, a, g)) throw new OyunHatasi(409, 'Bu arkadaşına bugün hediye gönderdin');
  // Aynı anda gelen ikinci istek UNIQUE (gonderen, alici, gun) ile düşer
  const yeni = await db.run(`INSERT OR IGNORE INTO hediyeler (gonderen, alici, gun, icerik, at) VALUES (?, ?, ?, ?, ?)`, userId, a, g, JSON.stringify(hediyeSec()), Date.now());
  if (yeni.changes !== 1) throw new OyunHatasi(409, 'Bu arkadaşına bugün hediye gönderdin');
  await L.denetim({ aktor: userId, eylem: 'GIFT_SENT', sonra: { alici: a } });
  if (!(await kullanici(a)).npc) await bildir(a, `🎁 ${(await kullanici(userId)).ad} sana hediye gönderdi`, 'komsuluk');
  return { tamam: true };
});
const hediyeAl = (userId, hediyeId) => db.tx(async () => {
  const hd = await db.get(`SELECT * FROM hediyeler WHERE id = ? AND alici = ?`, Number(hediyeId), userId);
  if (!hd) throw new OyunHatasi(404, 'Hediye bulunamadı');
  if (hd.durum !== 'BEKLIYOR') throw new OyunHatasi(409, 'Bu hediyeyi zaten aldın');
  await oyuncuKilidi(userId);
  const bugun = (await db.get(`SELECT COUNT(*) c FROM hediyeler WHERE alici = ? AND durum = 'ALINDI' AND alindi_gun = ?`, userId, gun())).c;
  if (bugun >= KOMSULUK.hediyeGunlukAlim) throw new OyunHatasi(429, `Günde en çok ${KOMSULUK.hediyeGunlukAlim} hediye açılır; kalanlar yarın`);
  // Koşullu yazma: aynı hediye iki kez açılamaz
  const u = await db.run(`UPDATE hediyeler SET durum = 'ALINDI', alindi_gun = ? WHERE id = ? AND durum = 'BEKLIYOR'`, gun(), hd.id);
  if (u.changes !== 1) throw new OyunHatasi(409, 'Bu hediyeyi zaten aldın');
  const ic = JSON.parse(hd.icerik);
  const kimden = `Hediye: ${(await kullanici(hd.gonderen))?.ad || 'komşu'}`;
  if (ic.akce) await L.odul(userId, ic.akce, kimden);
  else await L.envanterDegis(userId, ic.urun, ic.adet, kimden);
  return { tamam: true, ...ic, ad: ic.urun ? URUNLER[ic.urun].ad : null };
});

// ---------- Arkadaşa ürün gönderme (takas)
const urunGonder = (userId, { kullaniciId, urun, adet } = {}) => db.tx(async () => {
  const a = Number(kullaniciId), n = Number(adet);
  if (!await arkadasMi(userId, a)) throw new OyunHatasi(403, 'Yalnızca arkadaşlarına ürün gönderebilirsin');
  await gondericiSeviyesi(userId, 'Ürün göndermek');
  if (!Object.hasOwn(URUNLER, String(urun))) throw new OyunHatasi(400, 'Bilinmeyen ürün');
  if (!Number.isInteger(n) || n < 1) throw new OyunHatasi(400, 'Geçersiz adet');
  await oyuncuKilidi(userId);
  const g = gun();
  const bugun = (await db.get(`SELECT COALESCE(SUM(adet), 0) s FROM urun_gonderimleri WHERE gonderen = ? AND gun = ?`, userId, g)).s;
  if (bugun + n > KOMSULUK.gonderimGunlukAdet) throw new OyunHatasi(429, `Günde en çok ${KOMSULUK.gonderimGunlukAdet} ürün gönderebilirsin (bugün ${bugun})`);
  await require('./ekonomi').envanterBozulmasi(userId);
  const tx = L.yeniTx();
  const aliciAd = (await kullanici(a)).ad, gonderenAd = (await kullanici(userId)).ad;
  await L.envanterDegis(userId, urun, -n, `Gönderildi: ${aliciAd}`, tx);
  await L.envanterDegis(a, urun, n, `Hediye ürün: ${gonderenAd}`, tx);
  await db.run(`INSERT INTO urun_gonderimleri (gonderen, alici, urun, adet, gun, at) VALUES (?, ?, ?, ?, ?, ?)`, userId, a, urun, n, g, Date.now());
  await L.denetim({ aktor: userId, eylem: 'ITEMS_SENT', sonra: { alici: a, urun, adet: n } });
  if (!(await kullanici(a)).npc) await bildir(a, `📦 ${gonderenAd} sana ${n} ${URUNLER[urun].ad} gönderdi`, 'arazilerim');
  return { tamam: true };
});

// Demo sakin arkadaşlar günde bir kez hediye yollar (oyuncu komşuluk sayfasını açtığında)
async function demoHediyeleri(userId) {
  const g = gun();
  let n = (await db.get(`SELECT COUNT(*) c FROM hediyeler h JOIN users u ON u.id = h.gonderen WHERE h.alici = ? AND h.gun = ? AND u.is_npc = 1`, userId, g)).c;
  for (const id of await arkadasIdleri(userId)) {
    if (n >= DEMO_HEDIYE_GUNLUK) break;
    if (!(await kullanici(id))?.npc || Math.random() < 0.4) continue;
    n++;
    await db.run(`INSERT OR IGNORE INTO hediyeler (gonderen, alici, gun, icerik, at) VALUES (?, ?, ?, ?, ?)`, id, userId, g, JSON.stringify(hediyeSec()), Date.now());
  }
}

// ---------- Özet
async function ozet(userId) {
  await demoHediyeleri(userId);
  const g = gun();
  const t = Date.now();
  const arkadaslar = [];
  for (const id of await arkadasIdleri(userId)) {
    const k = await kullanici(id);
    const p = await db.get(`SELECT p.id, p.centroid_lon AS lon, p.centroid_lat AS lat, r.name AS mahalle FROM parcels p JOIN regions r ON r.id = p.region_id
                          WHERE p.owner_user_id = ? ORDER BY p.acquired_at LIMIT 1`, id);
    // Yardım bekleyen tarlası (büyüyen ekin) var mı
    const yardim = await db.get(`SELECT c.parcel_id FROM crops c WHERE c.user_id = ? AND c.status = 'GROWING' AND c.ready_at > ?
                                 AND NOT EXISTS (SELECT 1 FROM yardimlar y WHERE y.yardimci = ? AND y.parcel_id = c.parcel_id AND y.gun = ?) LIMIT 1`, id, t, userId, g);
    arkadaslar.push({ id, ad: k.ad, demo: !!k.npc, seviye: await require('./ciftlik').oyuncuSeviyesi(id), parsel: p || null,
      yardimParsel: yardim?.parcel_id || null, hediyeGonderildi: !!await db.get(`SELECT 1 FROM hediyeler WHERE gonderen = ? AND alici = ? AND gun = ?`, userId, id, g) });
  }
  const gelen = await db.all(`SELECT a.isteyen AS id, u.display_name AS ad FROM arkadasliklar a JOIN users u ON u.id = a.isteyen WHERE a.hedef = ? AND a.durum = 'ISTEK'`, userId);
  const giden = await db.all(`SELECT a.hedef AS id, u.display_name AS ad FROM arkadasliklar a JOIN users u ON u.id = a.hedef WHERE a.isteyen = ? AND a.durum = 'ISTEK'`, userId);
  const hediyeler = (await db.all(`SELECT h.id, h.icerik, u.display_name AS gonderen FROM hediyeler h JOIN users u ON u.id = h.gonderen WHERE h.alici = ? AND h.durum = 'BEKLIYOR' ORDER BY h.id`, userId))
    .map((h) => { const ic = JSON.parse(h.icerik); return { id: h.id, gonderen: h.gonderen, ...ic, ad: ic.urun ? URUNLER[ic.urun].ad : null, ikon: ic.urun ? URUNLER[ic.urun].ikon : '🪙' }; });
  const yardimBugun = (await db.get(`SELECT COUNT(*) c FROM yardimlar WHERE yardimci = ? AND gun = ?`, userId, g)).c;
  const gonderimBugun = (await db.get(`SELECT COALESCE(SUM(adet), 0) s FROM urun_gonderimleri WHERE gonderen = ? AND gun = ?`, userId, g)).s;
  const gonderebilir = await require('./ciftlik').oyuncuSeviyesi(userId) >= KOMSULUK.gonderimMinSeviye;
  return { arkadaslar, gelen, giden, hediyeler, limitler: { yardim: KOMSULUK.yardimGunluk, yardimBugun, gonderim: KOMSULUK.gonderimGunlukAdet, gonderimBugun,
    gonderebilir, gonderimSeviye: KOMSULUK.gonderimMinSeviye } };
}
// Parsel kartı için: bu parselin sahibiyle ilişki ve yardım edilebilirlik
async function parselIliskisi(userId, parcelId) {
  if (!userId) return null;
  const p = await db.get(`SELECT owner_user_id FROM parcels WHERE id = ?`, parcelId);
  if (!p?.owner_user_id || p.owner_user_id === userId) return null;
  const r = await iliski(userId, p.owner_user_id);
  const e = await db.get(`SELECT ready_at, user_id FROM crops WHERE parcel_id = ? AND status = 'GROWING' AND user_id <> ?`, parcelId, userId);
  return {
    durum: r ? (r.durum === 'KABUL' ? 'ARKADAS' : r.isteyen === userId ? 'ISTEK_GIDEN' : 'ISTEK_GELEN') : 'YOK',
    yardim: r?.durum === 'KABUL' && !!e && e.ready_at > Date.now() && !await db.get(`SELECT 1 FROM yardimlar WHERE yardimci = ? AND parcel_id = ? AND gun = ?`, userId, parcelId, gun()),
  };
}

function rotalar(app, { h, auth }) {
  app.get('/api/komsuluk', auth.girisGerekli, h((req) => ozet(req.kullanici.id)));
  // Değer aktaran ya da başkasına bildirim gönderen işlemler doğrulanmış e-posta ister (pazar ve borsa gibi)
  app.post('/api/arkadas/istek', auth.dogrulanmisGerekli, h((req) => istekGonder(req.kullanici.id, req.body || {})));
  app.post('/api/arkadas/:id/kabul', auth.girisGerekli, h((req) => db.tx(() => istekKabul(req.kullanici.id, req.params.id))));
  app.post('/api/arkadas/:id/sil', auth.girisGerekli, h((req) => iliskiSil(req.kullanici.id, req.params.id)));
  app.post('/api/parsel/:id/yardim', auth.dogrulanmisGerekli, h((req) => yardimEt(req.kullanici.id, req.params.id)));
  app.post('/api/hediye/gonder', auth.dogrulanmisGerekli, h((req) => hediyeGonder(req.kullanici.id, req.body?.kullaniciId)));
  app.post('/api/hediye/:id/al', auth.girisGerekli, h((req) => hediyeAl(req.kullanici.id, req.params.id)));
  app.post('/api/urun/gonder', auth.dogrulanmisGerekli, h((req) => urunGonder(req.kullanici.id, req.body || {})));
}

module.exports = { rotalar, ozet, istekGonder, yardimEt, hediyeGonder, hediyeAl, urunGonder, parselIliskisi, arkadasMi, gondericiSeviyesi };
