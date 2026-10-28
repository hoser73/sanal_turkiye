// Hesap güvenliği, KVKK ve moderasyon: e-posta doğrulama, parola sıfırlama, 2FA, oturumlar, yaş, veri dışa aktarma,
// hesap silme, şikâyet, iki kişi kuralı ve görevden alma dilekçesi.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { ortamKur } = require('./yardimci');

const VERI = ortamKur('hesap');
process.env.OTOMATIK_DOGRULA = '0';   // bu dosyada doğrulama gerçekten sınanır
const app = require('../server/index');
const db = require('../server/db');
const I = require('../server/harita/izgara');
const totp = require('../server/lib/totp');
const { coz } = require('../server/lib/sifreleme');
const { sahteImar, KOD_AD } = require('../server/harita/imar');

let sunucu, taban;
before(async () => {
  await new Promise((r) => { sunucu = app.listen(0, r); });
  taban = `http://127.0.0.1:${sunucu.address().port}`;
  await app.hazir;
});
after(() => { sunucu.close(); fs.rmSync(VERI, { recursive: true, force: true }); });

function istemci(cihaz = 'A') {
  let cerez = '';
  const c = async (yol, govde) => {
    const r = await fetch(taban + yol, {
      method: govde ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', cookie: cerez, 'user-agent': `Mozilla/5.0 (Macintosh; Mac OS X) Chrome/130 Test/${cihaz}` },
      body: govde ? JSON.stringify(govde) : undefined,
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cerez = sc.split(';')[0];
    const tur = r.headers.get('content-type') || '';
    return { durum: r.status, veri: tur.includes('json') ? await r.json() : await r.text(), basliklar: r.headers };
  };
  c.cerez = () => cerez;
  return c;
}
const kayitGovdesi = (ad, ek = {}) => ({ email: `${ad.toLowerCase()}@test.local`, sifre: 'parola123', ad, dogumYili: 1990, kosullarOnay: true, kvkkOnay: true, ...ek });
const sonPosta = (alici) => db.prepare(`SELECT * FROM giden_postalar WHERE alici = ? ORDER BY id DESC LIMIT 1`).get(alici);
const baglantiTokeni = (posta, param) => posta.govde.match(new RegExp(`[?&]${param}=([A-Za-z0-9_-]+)`))[1];
async function dogrulanmisOyuncu(ad, cihaz) {
  const c = istemci(cihaz);
  assert.equal((await c('/api/kayit', kayitGovdesi(ad))).durum, 201);
  const t = baglantiTokeni(sonPosta(`${ad.toLowerCase()}@test.local`), 'dogrula');
  assert.equal((await c('/api/eposta/dogrula', { token: t })).durum, 200);
  return c;
}
function tarimHucreleri([lon, lat]) {
  const c = I.hucre(lon, lat);
  const kx = c.x >> 6, ky = c.y >> 6;
  const liste = [];
  for (let dy = -14; dy <= 14; dy++) for (let dx = -14; dx <= 14; dx++) {
    const x = kx * 64 + 32 + dx, y = ky * 64 + 32 + dy;
    if (KOD_AD[sahteImar(x, y)] === 'TARIM') liste.push(I.parselId(x, y));
  }
  return liste;
}

test('kayıt: yaş beyanı ve zorunlu onaylar; 13 yaş altı reddedilir, 13–17 genç hesaptır', async () => {
  const c = istemci();
  assert.equal((await c('/api/kayit', kayitGovdesi('Onaysiz', { kvkkOnay: false }))).durum, 400);
  assert.equal((await c('/api/kayit', kayitGovdesi('Yassiz', { dogumYili: undefined }))).durum, 400);
  const kucuk = await c('/api/kayit', kayitGovdesi('Kucuk', { dogumYili: new Date().getUTCFullYear() - 10 }));
  assert.equal(kucuk.durum, 403);
  assert.equal(kucuk.veri.kod, 'YAS_SINIRI');

  const g = istemci('genc');
  assert.equal((await g('/api/kayit', kayitGovdesi('Genc', { dogumYili: new Date().getUTCFullYear() - 15 }))).durum, 201);
  const ben = (await g('/api/ben')).veri;
  assert.equal(ben.hesap.genc, true);
  assert.equal(ben.hesap.ayarlar.sohbet, false);
  assert.equal(ben.hesap.ayarlar.sureHatirlatici, 60);
  assert.equal((await g('/api/hesap/ayarlar', { sureHatirlatici: 0 })).durum, 400, 'genç hesapta hatırlatıcı kapatılamaz');
  const onaylar = db.prepare(`SELECT belge, onay FROM yasal_onaylar WHERE user_id = ? ORDER BY id`).all(ben.kullanici.id);
  assert.deepEqual(onaylar.map((o) => `${o.belge}:${o.onay}`), ['KOSULLAR:1', 'KVKK:1', 'PAZARLAMA:0']);
});

test('e-posta doğrulanmadan pazar ve seçim işlemleri kapalı; bağlantı tek kullanımlık', async () => {
  const c = istemci();
  const k = await c('/api/kayit', kayitGovdesi('Dogrulamasiz'));
  assert.equal(k.veri.dogrulamaGerekli, true);
  const r = await c('/api/ilan/1/teklif', { tutar: 10 });
  assert.equal(r.durum, 403);
  assert.equal(r.veri.kod, 'DOGRULAMA_GEREKLI');
  assert.equal((await c('/api/eposta/yeniden', {})).durum, 429, 'bir dakika içinde yeniden gönderim sınırlı');

  const posta = sonPosta('dogrulamasiz@test.local');
  assert.match(posta.konu, /doğrula/);
  const token = baglantiTokeni(posta, 'dogrula');
  assert.equal((await c('/api/eposta/dogrula', { token })).durum, 200);
  assert.equal((await c('/api/eposta/dogrula', { token })).durum, 400, 'ikinci kullanım reddedilir');
  assert.equal((await c('/api/ben')).veri.hesap.dogrulandi, true);
  assert.equal((await c('/api/ilan/999999/teklif', { tutar: 10 })).durum, 404, 'artık kapıdan geçer, ilan yok');
  // Token düz metin saklanmaz
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM eposta_tokenlari WHERE token_hash = ?`).get(token).c, 0);
});

test('parola sıfırlama: hesap varlığını sızdırmaz, tüm oturumları kapatır', async () => {
  const c = await dogrulanmisOyuncu('Sifirci', 'S1');
  const diger = istemci('S2');
  assert.equal((await diger('/api/giris', { email: 'sifirci@test.local', sifre: 'parola123' })).durum, 200);

  const yok = await istemci()('/api/sifre/unuttum', { email: 'olmayan@test.local' });
  const var_ = await istemci()('/api/sifre/unuttum', { email: 'sifirci@test.local' });
  assert.equal(yok.durum, 200);
  assert.deepEqual(yok.veri, var_.veri, 'aynı yanıt');
  assert.equal(sonPosta('olmayan@test.local'), undefined);

  const token = baglantiTokeni(sonPosta('sifirci@test.local'), 'sifirla');
  assert.equal((await istemci()('/api/sifre/sifirla', { token, sifre: 'kisa' })).durum, 400);
  assert.equal((await istemci()('/api/sifre/sifirla', { token, sifre: 'yeniparola456' })).durum, 200);
  assert.equal((await c('/api/ben')).veri, null, 'eski oturum kapandı');
  assert.equal((await diger('/api/ben')).veri, null);
  assert.equal((await istemci()('/api/giris', { email: 'sifirci@test.local', sifre: 'parola123' })).durum, 401);
  assert.equal((await istemci()('/api/giris', { email: 'sifirci@test.local', sifre: 'yeniparola456' })).durum, 200);
  assert.equal((await istemci()('/api/sifre/sifirla', { token, sifre: 'baskaparola789' })).durum, 400, 'bağlantı tek kullanımlık');
});

test('iki adımlı doğrulama: kurulum, girişte kod, tekrar kullanım engeli, kurtarma kodu, deneme sınırı', async () => {
  const c = await dogrulanmisOyuncu('Ikiadim', 'T1');
  const kur = (await c('/api/2fa/kur', {})).veri;
  assert.match(kur.uri, /^otpauth:\/\/totp\//);
  assert.match(kur.qr, /^data:image\/png;base64,/);
  const u0 = db.prepare(`SELECT totp_sir FROM users WHERE email = 'ikiadim@test.local'`).get();
  assert.ok(u0.totp_sir.startsWith('v1:') && !u0.totp_sir.includes(kur.sir), 'sır şifreli saklanır');
  assert.equal((await c('/api/2fa/etkinlestir', { kod: '000000' })).durum, 400);
  const kod0 = totp.kodUret(kur.sir, Date.now() - 30_000);
  const et = await c('/api/2fa/etkinlestir', { kod: kod0 });
  assert.equal(et.durum, 200);
  assert.equal(et.veri.kurtarmaKodlari.length, 10);

  // Girişte parola yetmez
  const g = istemci('T2');
  const gr = await g('/api/giris', { email: 'ikiadim@test.local', sifre: 'parola123' });
  assert.equal(gr.veri.ikinciAdim, true);
  assert.deepEqual((await g('/api/ben')).veri, { ikinciAdimBekleniyor: true });
  assert.equal((await g('/api/cuzdan')).durum, 401, 'yarım oturum yetki vermez');
  assert.equal((await g('/api/giris/2fa', { kod: kod0 })).durum, 401, 'aynı zaman adımı ikinci kez kullanılamaz');
  const yarim = g.cerez();
  assert.equal((await g('/api/giris/2fa', { kod: totp.kodUret(kur.sir) })).durum, 200);
  assert.notEqual(g.cerez(), yarim, 'başarılı 2FA yeni oturum anahtarı verir');
  assert.equal((await g('/api/ben')).veri.hesap.ikiAdim, true);

  // Kurtarma kodu tek kullanımlık
  const k = istemci('T3');
  await k('/api/giris', { email: 'ikiadim@test.local', sifre: 'parola123' });
  assert.equal((await k('/api/giris/2fa', { kod: et.veri.kurtarmaKodlari[0].toLowerCase() })).durum, 200);
  const k2 = istemci('T4');
  await k2('/api/giris', { email: 'ikiadim@test.local', sifre: 'parola123' });
  assert.equal((await k2('/api/giris/2fa', { kod: et.veri.kurtarmaKodlari[0] })).durum, 401);
  // Beşinci hatada yarım oturum silinir
  for (let i = 0; i < 3; i++) await k2('/api/giris/2fa', { kod: '123456' });
  const son = await k2('/api/giris/2fa', { kod: '123456' });
  assert.equal(son.veri.kod, 'IKI_ADIM_KILIT');
  assert.equal((await k2('/api/giris/2fa', { kod: totp.kodUret(kur.sir) })).durum, 401);

  // Kapatmak parola + kod ister
  assert.equal((await g('/api/2fa/kapat', { sifre: 'parola123', kod: '111111' })).durum, 401);
  assert.equal((await g('/api/2fa/kapat', { sifre: 'parola123', kod: et.veri.kurtarmaKodlari[1] })).durum, 200);
  assert.equal(db.prepare(`SELECT totp_aktif FROM users WHERE email = 'ikiadim@test.local'`).get().totp_aktif, 0);
});

test('oturum yönetimi: liste, tekini kapat, diğerlerini kapat', async () => {
  const a = await dogrulanmisOyuncu('Oturumcu', 'O1');
  const b = istemci('O2');
  await b('/api/giris', { email: 'oturumcu@test.local', sifre: 'parola123' });
  const c = istemci('O3');
  await c('/api/giris', { email: 'oturumcu@test.local', sifre: 'parola123' });
  const liste = (await a('/api/oturumlar')).veri;
  assert.equal(liste.length, 3);
  assert.equal(liste.filter((s) => s.bu).length, 1);
  assert.match(liste[0].tarayici, /Chrome · macOS/);
  const bOturum = (await b('/api/oturumlar')).veri.find((s) => s.bu);
  assert.equal((await a(`/api/oturum/${bOturum.id}/kapat`, {})).durum, 200);
  assert.equal((await b('/api/ben')).veri, null);
  assert.equal((await a('/api/oturumlar/digerleri', {})).veri.kapatilan, 1);
  assert.equal((await c('/api/ben')).veri, null);
  assert.ok((await a('/api/ben')).veri.kullanici);
});

test('KVKK: veri dışa aktarma kimliği ve geçmişi verir, oy içeriği ve parola özeti içermez', async () => {
  const c = await dogrulanmisOyuncu('Aktarici', 'K1');
  await c('/api/hesap/onay', { belge: 'PAZARLAMA', onay: true });
  assert.equal((await c('/api/hesap/onay', { belge: 'KVKK', onay: false })).durum, 400, 'zorunlu onay geri çekilemez (yolu hesap silme)');
  const r = await c('/api/hesap/veri');
  assert.equal(r.durum, 200);
  assert.match(r.basliklar.get('content-disposition'), /attachment; filename="sanalturkiye-verilerim-/);
  const veri = r.veri;
  assert.equal(veri.hesap.email, 'aktarici@test.local');
  assert.ok(veri.cuzdan.some((x) => x.aciklama === 'Hoş geldin hibesi'));
  assert.deepEqual(veri.onaylar.map((o) => o.belge), ['KOSULLAR', 'KVKK', 'PAZARLAMA', 'PAZARLAMA']);
  const metin = JSON.stringify(veri);
  assert.ok(!metin.includes('password_hash') && !metin.includes('$2a$') && !metin.includes('totp_sir'));
  const h = (await c('/api/hesap')).veri;
  assert.equal(h.onaylar.PAZARLAMA.onay, true);
});

test('hesap silme: parola ve SİL onayı ister, parseller devlete döner, kimlik verisi silinir, defter korunur', async () => {
  const c = await dogrulanmisOyuncu('Silinen', 'D1');
  const hucre = tarimHucreleri([30.52, 39.78])[0];
  assert.equal((await c(`/api/parsel/${hucre}/edin`, {})).durum, 200);
  const id = (await c('/api/ben')).veri.kullanici.id;
  assert.equal((await c('/api/hesap/sil', { sifre: 'parola123', onayMetni: 'evet' })).durum, 400);
  assert.equal((await c('/api/hesap/sil', { sifre: 'yanlis', onayMetni: 'SİL' })).durum, 401);
  assert.equal((await c('/api/hesap/sil', { sifre: 'parola123', onayMetni: 'sil' })).durum, 200, 'Türkçe büyük harfe çevrilerek karşılaştırılır');
  const u = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
  assert.equal(u.email, null);
  assert.equal(u.password_hash, null);
  assert.equal(u.status, 'DELETED');
  assert.match(u.display_name, /^Ayrılan oyuncu #/);
  assert.equal(db.prepare(`SELECT owner_user_id FROM parcels WHERE id = ?`).get(hucre).owner_user_id, null);
  assert.ok(db.prepare(`SELECT COUNT(*) c FROM wallet_ledger WHERE user_id = ?`).get(id).c > 0, 'ekonomi defteri anonim olarak kalır');
  assert.equal((await c('/api/ben')).veri, null);
  assert.equal((await istemci()('/api/giris', { email: 'silinen@test.local', sifre: 'parola123' })).durum, 401);
  // Aynı e-postayla yeniden kayıt mümkündür; ama hoş geldin hibesi tekrar verilmez (akçe basma döngüsüne karşı)
  assert.equal((await istemci()('/api/kayit', kayitGovdesi('Silinen', { email: 'SILINEN@test.local' }))).durum, 201);
  const yeni = db.prepare(`SELECT id, tekrar_hesap FROM users WHERE email = 'silinen@test.local'`).get();
  assert.equal(yeni.tekrar_hesap, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM wallet_ledger WHERE user_id = ? AND reason = 'Hoş geldin hibesi'`).get(yeni.id).c, 0);
  assert.ok(!db.prepare(`SELECT 1 FROM silinen_kimlikler WHERE ozet LIKE '%silinen%'`).get(), 'yalnızca özet saklanır');
  // Başka bir adresle açılan hesap hibeyi alır
  assert.equal((await istemci()('/api/kayit', kayitGovdesi('Yepyeni'))).durum, 201);
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM wallet_ledger w JOIN users u ON u.id = w.user_id WHERE u.email = 'yepyeni@test.local' AND w.reason = 'Hoş geldin hibesi'`).get().c, 1);
});

test('hesap silme: açık vadeli hesap bozdurulur, anapara bankada kalmaz', async () => {
  const c = await dogrulanmisOyuncu('Vadelici', 'V1');
  const id = (await c('/api/ben')).veri.kullanici.id;
  // Çarşı seviye kilidi testte atlanır: vadeli hesap doğrudan açılır
  const L = require('../server/lib/ledger');
  db.transaction(() => {
    L.aktar({ kaynak: L.hesap(id), hedef: `BANKA:VADELI:${id}`, tutar: 100, sebep: 'test vadeli' });
    db.prepare(`INSERT INTO banka_vadeli (user_id, tutar, faiz, bas, vade) VALUES (?, 100, 0.025, ?, ?)`).run(id, Date.now(), Date.now() + 7 * 864e5);
  })();
  assert.equal(Math.round(L.hesapBakiye(`BANKA:VADELI:${id}`)), 100);
  assert.equal((await c('/api/hesap/sil', { sifre: 'parola123', onayMetni: 'SİL' })).durum, 200);
  assert.equal(Math.round(L.hesapBakiye(`BANKA:VADELI:${id}`)), 0);
  assert.equal(db.prepare(`SELECT durum FROM banka_vadeli WHERE user_id = ?`).get(id).durum, 'BOZULDU');
});

test('parolasız hesap: hesap silme taze oturumla parola sormadan olur; eski oturumda yeniden giriş istenir', async () => {
  const c = await dogrulanmisOyuncu('Parolasiz', 'P1');
  const id = (await c('/api/ben')).veri.kullanici.id;
  db.prepare(`UPDATE users SET password_hash = NULL WHERE id = ?`).run(id);
  assert.equal((await c('/api/hesap')).veri.parolaVar, false);
  db.prepare(`UPDATE sessions SET created_at = datetime('now', '-1 hour') WHERE user_id = ?`).run(id);
  assert.equal((await c('/api/hesap/sil', { onayMetni: 'SİL' })).veri.kod, 'YENIDEN_GIRIS');
  db.prepare(`UPDATE sessions SET created_at = datetime('now') WHERE user_id = ?`).run(id);
  assert.equal((await c('/api/hesap/sil', { onayMetni: 'SİL' })).durum, 200);
});

test('iki adımlı doğrulama: hesap başına 10 hatalı kod 15 dakikalık kilit getirir (yeni girişle sıfırlanmaz)', async () => {
  const c = await dogrulanmisOyuncu('Kilitli', 'L1');
  const kur = (await c('/api/2fa/kur', {})).veri;
  assert.equal((await c('/api/2fa/etkinlestir', { kod: totp.kodUret(kur.sir, Date.now() - 30_000) })).durum, 200);
  let hata = 0, son;
  while (hata < 10) {
    const g = istemci('L2');
    await g('/api/giris', { email: 'kilitli@test.local', sifre: 'parola123' });
    for (let i = 0; i < 4 && hata < 10; i++, hata++) son = await g('/api/giris/2fa', { kod: '000000' });
  }
  assert.equal(son.durum, 401);
  const g = istemci('L3');
  await g('/api/giris', { email: 'kilitli@test.local', sifre: 'parola123' });
  const r = await g('/api/giris/2fa', { kod: totp.kodUret(kur.sir) });
  assert.equal(r.durum, 429, 'kilitliyken doğru kod da kabul edilmez');
  assert.equal(r.veri.kod, 'IKI_ADIM_BEKLE');
  db.prepare(`UPDATE users SET ikiadim_kilit = ? WHERE email = 'kilitli@test.local'`).run(Date.now() - 1);
  assert.equal((await g('/api/giris/2fa', { kod: totp.kodUret(kur.sir) })).durum, 200, 'süre dolunca açılır');
});

test('moderasyon: şikâyet, yetkili paneli 2FA ister, iki kişi kuralı, parsel dondurma', async () => {
  const sahip = await dogrulanmisOyuncu('Sahip', 'M0');
  const hucre = tarimHucreleri([31.1, 39.9])[0];
  assert.equal((await sahip(`/api/parsel/${hucre}/edin`, {})).durum, 200);
  const sikayetci = await dogrulanmisOyuncu('Sikayetci', 'M1');
  const s = await sikayetci('/api/sikayet', { hedefTur: 'PARSEL', hedefId: hucre, sebep: 'DOLANDIRICILIK', aciklama: 'Fiyat manipülasyonu şüphesi' });
  assert.equal(s.durum, 200);
  assert.equal((await sikayetci('/api/sikayet', { hedefTur: 'PARSEL', hedefId: hucre, sebep: 'SPAM' })).durum, 409, 'aynı hedefe ikinci açık şikâyet olmaz');
  assert.equal((await sikayetci('/api/yonetim/panel')).durum, 403);

  // İki yetkili: rol verilir; 2FA olmadan panel kapalı
  const yetkiliKur = async (ad, rol, cihaz) => {
    const c = await dogrulanmisOyuncu(ad, cihaz);
    db.prepare(`UPDATE users SET rol = ? WHERE email = ?`).run(rol, `${ad.toLowerCase()}@test.local`);
    const r = await c('/api/yonetim/panel');
    assert.equal(r.veri.kod, 'IKI_ADIM_GEREKLI');
    const kur = (await c('/api/2fa/kur', {})).veri;
    await c('/api/2fa/etkinlestir', { kod: totp.kodUret(kur.sir) });
    return c;
  };
  const mod1 = await yetkiliKur('Moderator1', 'MODERATOR', 'Y1');
  const mod2 = await yetkiliKur('Denetci1', 'DENETCI', 'Y2');
  const panel = (await mod1('/api/yonetim/panel')).veri;
  assert.equal(panel.ozet.acikSikayet, 1);
  assert.equal(panel.sikayetler[0].hedef.durum, 'ACTIVE');

  const oneri = await mod1('/api/yonetim/islem', { tur: 'PARSEL_DONDUR', hedef: hucre, gerekce: 'İnceleme süresince dondurulur', sikayetId: s.veri.id });
  assert.equal(oneri.veri.uygulandi, false);
  assert.equal((await mod1(`/api/yonetim/islem/${oneri.veri.id}`, { onay: true })).durum, 403, 'öneren onaylayamaz');
  assert.equal(db.prepare(`SELECT status FROM parcels WHERE id = ?`).get(hucre).status, 'ACTIVE');
  assert.equal((await mod2(`/api/yonetim/islem/${oneri.veri.id}`, { onay: true })).durum, 200);
  assert.equal(db.prepare(`SELECT status FROM parcels WHERE id = ?`).get(hucre).status, 'FROZEN');
  const ek = await sahip(`/api/parsel/${hucre}/ek`, { urun: 'BUGDAY' });
  assert.equal(ek.durum, 423, 'dondurulmuş parselde işlem yapılamaz');

  assert.equal((await mod1(`/api/yonetim/sikayet/${s.veri.id}`, { karar: 'KARARA_BAGLANDI', not: 'Parsel donduruldu, inceleme sürüyor' })).durum, 200);
  assert.equal(db.prepare(`SELECT durum FROM sikayetler WHERE id = ?`).get(s.veri.id).durum, 'KARARA_BAGLANDI');
  assert.equal((await mod1('/api/yonetim/rol', { userId: 1, rol: 'ADMIN' })).durum, 403, 'rol yalnızca yönetici verir');
});

test('içerik ön taraması: kimlik/telefon numarası içeren metin engellenir', () => {
  const { icerikDenetle } = require('../server/lib/icerik');
  assert.equal(icerikDenetle('Toplantı cuma 19.00 kahvede').karar, 'TEMIZ');
  assert.equal(icerikDenetle('Beni 0532 123 45 67 numaradan arayın').karar, 'ENGEL');
  assert.equal(icerikDenetle('TC: 12345678901').karar, 'ENGEL');
  assert.equal(icerikDenetle('sen tam bir s4lak mısın').karar, 'SUPHELI');
  // Ayırıcı, tam genişlikli rakam ve tek tek yazılan rakamlarla atlatma denemeleri
  for (const m of ['0532.123.45.67', '０５３２１２３４５６７', '1 2 3 4 5 6 7 8 9 0 1', '+90 (532) 123 45 67', '0532\u200B1234567', 'TR12 0006 1005 1978 6457 8413 26']) {
    assert.equal(icerikDenetle(m).karar, 'ENGEL', m);
  }
  // Kısa sayılar ve binlik ayırıcılı fiyatlar geçer
  for (const m of ['2024 yılında 3 kez', 'Fiyat 1.250.000 akçe, 2.500 de olur', '12.05.2024 saat 14.30', '100 200 300 400 500']) {
    assert.equal(icerikDenetle(m).karar, 'TEMIZ', m);
  }
});

test('görevden alma: sakinlerin dilekçesi eşiği geçince muhtarlık boşalır', async () => {
  const hucreler = tarimHucreleri([33.2, 40.1]);
  const [muhtar, b, c] = [await dogrulanmisOyuncu('Muhtarx', 'G1'), await dogrulanmisOyuncu('Sakinb', 'G2'), await dogrulanmisOyuncu('Sakinc', 'G3')];
  for (const [i, x] of [muhtar, b, c].entries()) assert.equal((await x(`/api/parsel/${hucreler[i]}/edin`, {})).durum, 200);
  const mahalleId = db.prepare(`SELECT region_id FROM parcels WHERE id = ?`).get(hucreler[0]).region_id;
  const muhtarId = (await muhtar('/api/ben')).veri.kullanici.id;
  // İmza kütüğüne yalnızca yeterince eski hesaplar girer (SECIM.secmenMinHesapYasiMs)
  for (const ad of ['muhtarx', 'sakinb', 'sakinc']) db.prepare(`UPDATE users SET created_at = datetime('now', '-2 days') WHERE email = ?`).run(`${ad}@test.local`);
  // Görevde bir muhtar kur (seçim akışı secim.test.js'te sınanır)
  const t = Date.now();
  const secimId = db.prepare(`INSERT INTO secimler (region_id, tur, asama, duyuru_at, adaylik_at, kampanya_at, oylama_at, itiraz_at, bitis_at, created_at)
                              VALUES (?, 'MUHTAR', 'SONUCLANDI', ?, ?, ?, ?, ?, ?, ?)`).run(mahalleId, t - 9e6, t - 8e6, t - 7e6, t - 6e6, t - 5e6, t - 4e6, t - 9e6).lastInsertRowid;
  const adayId = db.prepare(`INSERT INTO adaylar (secim_id, user_id, manifesto, vaatler, butce, durum, created_at) VALUES (?, ?, 'Mahallemiz için', '["Park"]', '{}', 'AKTIF', ?)`)
    .run(secimId, muhtarId, t).lastInsertRowid;
  const gun = 24 * 3600e3;
  db.prepare(`INSERT INTO muhtarlar (region_id, user_id, secim_id, aday_id, baslangic, bitis) VALUES (?, ?, ?, ?, ?, ?)`).run(mahalleId, muhtarId, secimId, adayId, t - 20 * gun, t + 10 * gun);

  const kisa = await b('/api/gorevden-alma', { bolgeId: mahalleId, makam: 'MUHTAR', gerekce: 'kısa' });
  assert.equal(kisa.durum, 400);
  assert.equal((await muhtar('/api/gorevden-alma', { bolgeId: mahalleId, makam: 'MUHTAR', gerekce: 'Kendi kendimi görevden almak istiyorum, deneme' })).durum, 403);
  const d = await b('/api/gorevden-alma', { bolgeId: mahalleId, makam: 'MUHTAR', gerekce: 'Vaatlerin hiçbiri başlamadı, duyuru da yapılmıyor.' });
  assert.equal(d.durum, 200);
  assert.equal(d.veri.esik, 2);
  const bilgi = (await c(`/api/mahalle/${mahalleId}`)).veri;
  assert.equal(bilgi.dilekceler[0].imza, 1);
  assert.equal(bilgi.dilekceler[0].imzaHakki, true);
  assert.equal((await muhtar(`/api/gorevden-alma/${d.veri.id}/imza`, {})).durum, 403, 'hedef imzalayamaz');
  assert.equal((await b(`/api/gorevden-alma/${d.veri.id}/imza`, {})).durum, 409, 'iki kez imza yok');
  const im = await c(`/api/gorevden-alma/${d.veri.id}/imza`, {});
  assert.equal(im.veri.durum, 'BASARILI');
  assert.equal((await c(`/api/mahalle/${mahalleId}`)).veri.muhtar, null, 'makam boşaldı');
  assert.ok(db.prepare(`SELECT 1 FROM audit_events WHERE action = 'RECALL_SUCCEEDED' AND public = 1`).get());
});
