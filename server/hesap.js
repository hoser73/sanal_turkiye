// Hesap ve KVKK: profil/ayarlar, açık rıza kayıtları, kişisel veri dışa aktarma (taşınabilirlik), hesap silme.
// Silmede kimlik verileri kalıcı olarak silinir; değiştirilemez ekonomi defteri ve denetim kaydı anonim kimlikle kalır
// (yasal saklama yükümlülüğü ve diğer oyuncuların işlem bütünlüğü için).
const db = require('./db');
const { metin } = require('./lib/girdi');
const L = require('./lib/ledger');
const auth = require('./auth');
const { HESAP, YASAL, ROLLER } = require('./config/rules');
const { OyunHatasi } = L;

const SURE_SECENEKLERI = [0, 30, 60, 90, 120];

function hesapBilgisi(userId) {
  const u = db.prepare(`SELECT id, email, display_name, dogum_yili, created_at, email_dogrulandi_at, totp_aktif, rol, ayarlar FROM users WHERE id = ?`).get(userId);
  const onaylar = Object.fromEntries(Object.entries(YASAL).map(([k, b]) => {
    const son = db.prepare(`SELECT surum, onay, created_at FROM yasal_onaylar WHERE user_id = ? AND belge = ? ORDER BY id DESC LIMIT 1`).get(userId, k);
    return [k, { ad: b.ad, yol: b.yol, zorunlu: b.zorunlu, guncelSurum: b.surum, onay: !!son?.onay, surum: son?.surum || null, tarih: son?.created_at || null,
      guncel: !!son?.onay && son.surum === b.surum }];
  }));
  return {
    id: u.id, email: u.email, ad: u.display_name, dogumYili: u.dogum_yili, katilim: u.created_at,
    ...auth.hesapDurumu(userId), roller: ROLLER, onaylar, sureSecenekleri: SURE_SECENEKLERI,
  };
}

function ayarlarDegistir(userId, govde = {}) {
  const u = db.prepare(`SELECT dogum_yili, ayarlar FROM users WHERE id = ?`).get(userId);
  const a = JSON.parse(u.ayarlar || '{}');
  const genc = auth.gencMi(u.dogum_yili);
  if (govde.sureHatirlatici !== undefined) {
    const d = Number(govde.sureHatirlatici);
    if (!SURE_SECENEKLERI.includes(d)) throw new OyunHatasi(400, 'Geçersiz hatırlatma süresi');
    if (genc && d === 0) throw new OyunHatasi(400, 'Genç hesaplarda süre hatırlatıcısı kapatılamaz');
    a.sureHatirlatici = d;
  }
  if (govde.sohbet !== undefined) a.sohbet = govde.sohbet === true;
  if (govde.bildirimSesi !== undefined) a.bildirimSesi = govde.bildirimSesi === true;
  if (govde.hatirlatma !== undefined) a.hatirlatma = govde.hatirlatma === true;
  db.prepare(`UPDATE users SET ayarlar = ? WHERE id = ?`).run(JSON.stringify(a), userId);
  return { tamam: true, ayarlar: a };
}

// Onay kaydı yalnızca eklenir. Zorunlu belgelerin onayı geri çekilemez (hizmet sözleşmesidir): bunun yolu hesap silmedir.
function onayVer(userId, { belge, onay } = {}) {
  const b = typeof belge === 'string' && Object.hasOwn(YASAL, belge) ? YASAL[belge] : null;
  if (!b) throw new OyunHatasi(400, 'Geçersiz belge');
  if (typeof onay !== 'boolean') throw new OyunHatasi(400, 'onay true/false olmalı');
  if (b.zorunlu && !onay) throw new OyunHatasi(400, `${b.ad} onayı hizmetin koşuludur; geri çekmek için hesabını silebilirsin`);
  db.prepare(`INSERT INTO yasal_onaylar (user_id, belge, surum, onay) VALUES (?, ?, ?, ?)`).run(userId, belge, b.surum, onay ? 1 : 0);
  L.denetim({ aktor: userId, eylem: 'CONSENT_RECORDED', varlik: belge, sonra: { surum: b.surum, onay }, herkese: false });
  return { tamam: true };
}

// KVKK m.11 / taşınabilirlik: oyuncunun kendisiyle ilgili tüm kayıtları makinece okunur biçimde.
// Gizli oy ilkesi gereği oy İÇERİĞİ hiçbir yerde kişiyle ilişkili değildir; yalnızca katılım bilgisi verilir.
function veriDisaAktar(userId) {
  const tum = (sql, ...p) => db.prepare(sql).all(...p);
  const u = db.prepare(`SELECT id, email, display_name, dogum_yili, status, rol, created_at, email_dogrulandi_at, totp_aktif, ayarlar FROM users WHERE id = ?`).get(userId);
  return {
    aciklama: 'Sanal Türkiye kişisel veri dışa aktarımı (KVKK m.11). Oy içerikleri gizli oy ilkesi gereği kimseyle ilişkilendirilmeden saklanır ve bu dosyada yer almaz.',
    olusturma: new Date().toISOString(),
    hesap: { ...u, ayarlar: JSON.parse(u.ayarlar || '{}'), totp_aktif: !!u.totp_aktif },
    oturumlar: tum(`SELECT tarayici, created_at, son_gorulme, expires_at FROM sessions WHERE user_id = ? AND ikinci_adim = 1`, userId),
    onaylar: tum(`SELECT belge, surum, onay, created_at FROM yasal_onaylar WHERE user_id = ? ORDER BY id`, userId),
    cuzdan: tum(`SELECT debit AS borc, credit AS alacak, reason AS aciklama, tx_group AS islem, created_at FROM wallet_ledger WHERE user_id = ? ORDER BY id`, userId),
    envanter: tum(`SELECT item_id AS urun, delta AS degisim, reason AS aciklama, created_at FROM inventory_ledger WHERE user_id = ? ORDER BY id`, userId),
    parseller: tum(`SELECT id, zoning_type AS imar, area_m2, centroid_lon AS lon, centroid_lat AS lat, acquired_at FROM parcels WHERE owner_user_id = ?`, userId),
    sahiplikGecmisi: tum(`SELECT parcel_id, start_at, end_at, reason, price FROM parcel_ownership WHERE user_id = ? ORDER BY id`, userId),
    yapilar: tum(`SELECT parcel_id, type, status, started_at, completed_at FROM structures WHERE owner_user_id = ?`, userId),
    ekinler: tum(`SELECT parcel_id, crop_type, planted_at, status, harvested_qty FROM crops WHERE user_id = ?`, userId),
    ilanlar: tum(`SELECT id, parcel_id, asking_price, status, created_at, closed_at FROM listings WHERE seller_id = ?`, userId),
    teklifler: tum(`SELECT id, listing_id, amount, status, created_at FROM bids WHERE buyer_id = ?`, userId),
    islemler: tum(`SELECT id, parcel_id, price, CASE WHEN seller_id = ? THEN 'SATIS' ELSE 'ALIS' END AS yon, created_at FROM trades WHERE seller_id = ? OR buyer_id = ?`, userId, userId, userId),
    bildirimler: tum(`SELECT text, link, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY id`, userId),
    gorevler: tum(`SELECT * FROM quest_progress WHERE user_id = ?`, userId),
    adayliklar: tum(`SELECT a.secim_id, a.makam, a.durum, a.manifesto, a.vaatler, a.created_at FROM adaylar a WHERE a.user_id = ?`, userId),
    secimKatilimlari: tum(`SELECT secim_id, gun FROM secim_katilim WHERE user_id = ?`, userId),
    itirazlar: tum(`SELECT secim_id, sebep, durum, yanit, created_at FROM itirazlar WHERE user_id = ?`, userId),
    duyurular: tum(`SELECT region_id, metin, created_at FROM mahalle_duyurulari WHERE user_id = ?`, userId),
    belediyeGorevleri: tum(`SELECT region_id, makam, baslangic, bitis FROM belediye_uyeleri WHERE user_id = ?`, userId),
    muhtarlikGorevleri: tum(`SELECT region_id, baslangic, bitis FROM muhtarlar WHERE user_id = ?`, userId),
    projeTeklifleri: tum(`SELECT id, region_id, tur, maliyet, durum, created_at FROM projeler WHERE teklif_eden_id = ?`, userId),
    meclisOylari: tum(`SELECT proje_id, oy, created_at FROM proje_oylari WHERE user_id = ?`, userId),
    talepler: tum(`SELECT * FROM talepler WHERE user_id = ?`, userId),
    meslek: db.prepare(`SELECT meslek, meslek_xp, memleket_plaka FROM users WHERE id = ?`).get(userId),
    uretimler: tum(`SELECT parcel_id, recete, parti, cikti, baslangic, bitis, durum FROM uretimler WHERE user_id = ? ORDER BY id`, userId),
    kooperatif: tum(`SELECT k.ad, u.katilim FROM kooperatif_uyeleri u JOIN kooperatifler k ON k.id = u.koop_id WHERE u.user_id = ?`, userId),
    sevkiyatlar: tum(`SELECT urun, miktar, kaynak_plaka, hedef_plaka, mod, maliyet, gelir, durum, cikis, varis FROM sevkiyatlar WHERE user_id = ?`, userId),
    kiralar: tum(`SELECT parcel_id, CASE WHEN sahip_id = ? THEN 'KIRAYA_VEREN' ELSE 'KIRACI' END AS rol, gunluk, gun, durum, baslangic, bitis FROM kiralar WHERE sahip_id = ? OR kiraci_id = ?`, userId, userId, userId),
    ortakliklar: tum(`SELECT parcel_id, pay, durum FROM ortaklar WHERE sahip_id = ? OR ortak_id = ?`, userId, userId),
    referandumKatilimlari: tum(`SELECT ref_id FROM referandum_katilim WHERE user_id = ?`, userId),
    koleksiyon: tum(`SELECT simge, created_at FROM koleksiyon WHERE user_id = ?`, userId),
    rozetler: tum(`SELECT kod, ad, created_at FROM rozetler WHERE user_id = ?`, userId),
    sohbetMesajlari: tum(`SELECT kanal, metin, gizlendi, created_at FROM sohbet_mesajlari WHERE user_id = ? ORDER BY id`, userId),
    borsaEmirleri: tum(`SELECT urun, yon, fiyat, miktar, kalan, durum, created_at FROM urun_emirleri WHERE user_id = ? ORDER BY id`, userId),
    pushAbonelikSayisi: db.prepare(`SELECT COUNT(*) c FROM push_abonelikleri WHERE user_id = ?`).get(userId).c,
    sikayetler: tum(`SELECT hedef_tur, hedef_id, sebep, aciklama, durum, created_at FROM sikayetler WHERE sikayetci_id = ?`, userId),
    olayKaydi: tum(`SELECT action, entity, after_json, created_at FROM audit_events WHERE actor_id = ? ORDER BY id`, userId),
    // Giriş yolları, banka, balık, kozmetik ve imzalar (KVKK m.11: işlenen bütün kişisel veriler)
    telefon: (() => {
      const t = db.prepare(`SELECT telefon_sifreli, telefon_dogrulandi_at FROM users WHERE id = ?`).get(userId);
      if (!t?.telefon_sifreli) return null;
      try { return { numara: require('./lib/sifreleme').coz(t.telefon_sifreli), dogrulandi: t.telefon_dogrulandi_at }; } catch { return { numara: null, dogrulandi: t.telefon_dogrulandi_at }; }
    })(),
    bagliHesaplar: tum(`SELECT saglayici, email, created_at FROM kimlik_baglantilari WHERE user_id = ?`, userId),
    passkeyler: tum(`SELECT ad, tasima, created_at, son_kullanim FROM passkeyler WHERE user_id = ?`, userId),
    bankaVadeli: tum(`SELECT tutar, faiz, bas, vade, durum, kapandi_at FROM banka_vadeli WHERE user_id = ? ORDER BY id`, userId),
    balikAtislari: tum(`SELECT * FROM balik_atislari WHERE user_id = ? ORDER BY id`, userId),
    kozmetikler: tum(`SELECT kod, created_at FROM kozmetikler WHERE user_id = ?`, userId),
    referandumImzalari: tum(`SELECT ref_id, created_at FROM referandum_imzalar WHERE user_id = ?`, userId),
    gorevdenAlmaImzalari: tum(`SELECT dilekce_id, created_at FROM gorevden_alma_imzalar WHERE user_id = ?`, userId),
  };
}

// Hesap silme: parola (parolasız hesapta son 15 dakikada açılmış oturum) + (açıksa) 2FA + "SİL" onayı. Açık ilan/teklif/
// ihale teklifi/adaylık kapatılır, vadeli hesaplar bozdurulur, makamlar boşalır, parseller devlete döner (üzerindeki
// yapılar kaldırılır), kimlik verileri silinir.
function hesapSil(req, res) {
  const userId = req.kullanici.id;
  if (metin(req.body?.onayMetni).toLocaleUpperCase('tr-TR') !== 'SİL') throw new OyunHatasi(400, 'Onaylamak için SİL yaz');
  auth.yenidenKimlik(userId, req.body, { taze: auth.tazeOturumMu(req) });
  const pazar = require('./pazar');
  const yonetim = require('./moderasyon');
  db.transaction(() => {
    for (const i of db.prepare(`SELECT id FROM listings WHERE seller_id = ? AND status = 'ACTIVE'`).all(userId)) pazar.ilanIptal(userId, i.id);
    for (const b of db.prepare(`SELECT listing_id FROM bids WHERE buyer_id = ? AND status = 'ACTIVE'`).all(userId)) pazar.teklifGeriCek(userId, b.listing_id);
    require('./ihale').tekliflerIade(userId);
    // Açık vadeli hesaplar bozdurulur: anapara cüzdana döner (silinen hesap bir daha kapatamazdı)
    for (const v of db.prepare(`SELECT id FROM banka_vadeli WHERE user_id = ? AND durum = 'ACIK'`).all(userId)) require('./carsi').vadeliKapat(userId, v.id);
    db.prepare(`UPDATE adaylar SET durum = 'CEKILDI' WHERE user_id = ? AND durum = 'AKTIF'
      AND secim_id NOT IN (SELECT id FROM secimler WHERE asama IN ('OYLAMA', 'ITIRAZ'))`).run(userId);
    if (db.prepare(`SELECT 1 FROM kooperatif_uyeleri WHERE user_id = ?`).get(userId)) require('./kooperatif').ayril(userId);
    db.prepare(`UPDATE uretimler SET durum = 'TOPLANDI' WHERE user_id = ? AND durum = 'URETIMDE'`).run(userId);
    db.prepare(`UPDATE kiralar SET durum = 'IPTAL' WHERE (sahip_id = ? OR kiraci_id = ?) AND durum = 'TEKLIF'`).run(userId, userId);
    // Kirada olan tarlanın sahibi hesabını silerse kiracıya kalan günlerin peşin kirası iade edilir (sahibin bakiyesinden)
    for (const k of db.prepare(`SELECT * FROM kiralar WHERE sahip_id = ? AND durum = 'AKTIF' AND bitis > ?`).all(userId, Date.now())) {
      const iade = Math.min(L.bakiye(userId), k.gunluk * Math.ceil((k.bitis - Date.now()) / require('./config/rules').BOZULMA.gunMs));
      if (iade > 0 && k.kiraci_id) L.aktar({ kaynak: L.hesap(userId), hedef: L.hesap(k.kiraci_id), tutar: iade, sebep: `Kira iadesi ${k.parcel_id} (sahip hesabını sildi)` });
    }
    db.prepare(`UPDATE kiralar SET durum = 'BITTI', bitis = ? WHERE (sahip_id = ? OR kiraci_id = ?) AND durum = 'AKTIF'`).run(Date.now(), userId, userId);
    // Kiracıysa başkasının tarlasındaki ekini kapanır (tarla sahibine boş döner)
    db.prepare(`UPDATE crops SET status = 'HARVESTED', harvested_qty = 0 WHERE user_id = ? AND status = 'GROWING'`).run(userId);
    db.prepare(`UPDATE ortaklar SET durum = 'BITTI' WHERE (sahip_id = ? OR ortak_id = ?) AND durum IN ('DAVET', 'AKTIF')`).run(userId, userId);
    yonetim.tumMakamlariBosalt(userId, 'Hesap sahibi hesabını sildi');
    db.prepare(`UPDATE gorevden_alma SET durum = 'DUSTU', kapandi_at = ? WHERE hedef_id = ? AND durum = 'ACIK'`).run(Date.now(), userId);
    const parseller = db.prepare(`SELECT id FROM parcels WHERE owner_user_id = ?`).all(userId);
    for (const p of parseller) require('./oyun').parseliBosalt(p.id);
    const { email: eposta, telefon_ozet: telefonOzet } = db.prepare(`SELECT email, telefon_ozet FROM users WHERE id = ?`).get(userId);
    // Aynı e-posta/telefonla yeniden kayıtta başlangıç hediyeleri tekrar verilmesin (yalnızca tuzlu özet saklanır)
    auth.silinenKimlikKaydet({ email: eposta, telefonOzet });
    db.prepare(`DELETE FROM giden_postalar WHERE alici = ?`).run(eposta);
    db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId);
    db.prepare(`DELETE FROM eposta_tokenlari WHERE user_id = ?`).run(userId);
    db.prepare(`DELETE FROM notifications WHERE user_id = ?`).run(userId);
    db.prepare(`DELETE FROM push_abonelikleri WHERE user_id = ?`).run(userId);
    db.prepare(`DELETE FROM sohbet_mesajlari WHERE user_id = ?`).run(userId);
    for (const e of db.prepare(`SELECT * FROM urun_emirleri WHERE user_id = ? AND durum = 'ACIK'`).all(userId)) require('./ekonomi').emirIptal(userId, e.id);
    db.prepare(`UPDATE users SET email = NULL, password_hash = NULL, display_name = ?, ad_anahtar = NULL, avatar = NULL, dogum_yili = NULL, totp_sir = NULL, totp_aktif = 0,
                kurtarma_kodlari = NULL, ayarlar = '{}', status = 'DELETED', rol = 'OYUNCU', silindi_at = datetime('now') WHERE id = ?`)
      .run(`Ayrılan oyuncu #${userId}`, userId);
    require('./giris-yollari').hesapSilindi(userId);   // Google/Apple bağlantıları, passkey'ler, telefon
    L.denetim({ aktor: userId, eylem: 'ACCOUNT_DELETED', sonra: { parselIadesi: parseller.length }, herkese: false });
  })();
  res.clearCookie(auth.CEREZ, { path: '/' });
  res.json({ tamam: true });
}

function rotalar(app, { h }) {
  app.get('/api/hesap', auth.girisGerekli, h((req) => hesapBilgisi(req.kullanici.id)));
  app.post('/api/hesap/ayarlar', auth.girisGerekli, h((req) => ayarlarDegistir(req.kullanici.id, req.body)));
  app.post('/api/hesap/onay', auth.girisGerekli, h((req) => onayVer(req.kullanici.id, req.body)));
  app.get('/api/hesap/veri', auth.girisGerekli, h((req, res) => {
    L.denetim({ aktor: req.kullanici.id, eylem: 'DATA_EXPORTED', herkese: false });
    res.set('content-disposition', `attachment; filename="sanalturkiye-verilerim-${new Date().toISOString().slice(0, 10)}.json"`);
    res.type('application/json').send(JSON.stringify(veriDisaAktar(req.kullanici.id), null, 2));
  }));
  app.post('/api/hesap/sil', auth.girisGerekli, h(hesapSil));
}

module.exports = { rotalar, hesapBilgisi, ayarlarDegistir, onayVer, veriDisaAktar, hesapSil, SURE_SECENEKLERI };
