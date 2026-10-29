// Kimlik: e-posta + parola (bcrypt), oturum çerezi, e-posta doğrulama, parola sıfırlama, iki adımlı doğrulama (TOTP),
// oturum yönetimi, yaş beyanı ve roller. DB'de token'ların yalnızca sha256 özeti tutulur.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const db = require('./db');
const { metin } = require('./lib/girdi');
const { HESAP, YASAL, ROLLER } = require('./config/rules');
const L = require('./lib/ledger');
const totp = require('./lib/totp');
const { sifrele, coz } = require('./lib/sifreleme');
const posta = require('./posta');
const { OyunHatasi } = L;

const CEREZ = 'st_oturum';
const OTURUM_GUN = 30;
const DUMMY_HASH = bcrypt.hashSync('sabit-zamanli-karsilastirma', 10);
const ozet = (t) => crypto.createHash('sha256').update(t).digest('hex');
const EPOSTA_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const TABAN_URL = () => (process.env.TABAN_URL || `http://localhost:${process.env.PORT || 3400}`).replace(/\/$/, '');
const otomatikDogrula = () => process.env.OTOMATIK_DOGRULA === '1';
const yoneticiIkiAdimZorunlu = () => process.env.YONETICI_2FA_ZORUNLU !== '0';
const buYil = () => new Date().getUTCFullYear();

const metinMi = (v, min, max) => typeof v === 'string' && v.length >= min && v.length <= max;
const yas = (dogumYili) => (dogumYili ? buYil() - dogumYili : null);
const gencMi = (dogumYili) => dogumYili != null && yas(dogumYili) < HESAP.yetiskinYas;

// Oturum listesinde gösterilecek kaba tarayıcı özeti (tam User-Agent saklanmaz)
function tarayiciOzeti(ua = '') {
  const t = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Tarayıcı';
  const s = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS'
    : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'bilinmeyen sistem';
  return `${t} · ${s}`;
}
const ipOzeti = (ip) => ozet(`st-ip:${ip || ''}`).slice(0, 16);

const SILINEN_TUZ = () => process.env.SILINEN_KIMLIK_TUZU || 'st-silinen-kimlik-v1';
const silinenOzeti = (tur, deger) => ozet(`${SILINEN_TUZ()}:${tur}:${String(deger).trim().toLowerCase()}`);
// telefonOzet: users.telefon_ozet (normalize numaranın özeti)
async function silinenKimlikKaydet({ email, telefonOzet } = {}) {
  const ekle = `INSERT OR IGNORE INTO silinen_kimlikler (ozet, created_at) VALUES (?, ?)`;
  if (email) await db.run(ekle, silinenOzeti('EPOSTA', email), Date.now());
  if (telefonOzet) await db.run(ekle, silinenOzeti('TELEFON', telefonOzet), Date.now());
}
async function silinenKimlikMi({ email, telefonOzet } = {}) {
  const bul = async (o) => !!(await db.get(`SELECT 1 FROM silinen_kimlikler WHERE ozet = ?`, o));
  return (!!email && await bul(silinenOzeti('EPOSTA', email))) || (!!telefonOzet && await bul(silinenOzeti('TELEFON', telefonOzet)));
}
const tekrarHesapMi = async (userId) => !!(await db.get(`SELECT tekrar_hesap FROM users WHERE id = ?`, userId))?.tekrar_hesap;
// Para geri alımı içerdiğinden işlem içinde çalışır (çağıran işlem açtıysa onun içinde, kayıt noktasıyla)
async function tekrarIsaretle(userId) {
  return db.tx(async () => {
    if (!(await db.run(`UPDATE users SET tekrar_hesap = 1 WHERE id = ? AND COALESCE(tekrar_hesap, 0) = 0`, userId)).changes) return;
    await L.denetim({ aktor: userId, eylem: 'REPEAT_IDENTITY', herkese: false });
    // Kayıttan sonra ortaya çıktıysa (telefon doğrulaması) verilmiş hoş geldin hibesi geri alınır; harcanmış kısmı hariç
    const hibe = (await db.get(`SELECT GREATEST(debit, credit) AS t FROM wallet_ledger WHERE account = ? AND reason = 'Hoş geldin hibesi'`, L.hesap(userId)))?.t || 0;
    const geri = L.yuvarla(Math.min(hibe, await L.bakiye(userId)));
    if (geri > 0) {
      await L.harca(userId, geri, 'Hoş geldin hibesi geri alındı (silinmiş hesabın kimliği)');
      await require('./pazar').bildir(userId, `Bu telefon numarası daha önce silinmiş bir hesaba ait; hoş geldin hibesi (₳${geri}) geri alındı.`, 'arazilerim');
    }
  });
}
const q = {
  oturumBul: db.sorgu(`
    SELECT s.token_hash, s.ikinci_adim, s.deneme, s.son_gorulme, u.id, u.display_name, u.status, u.rol, u.email,
           u.email_dogrulandi_at, u.totp_aktif, u.dogum_yili, u.silindi_at, u.telefon_dogrulandi_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > datetime('now')`),
  gorulme: db.sorgu(`UPDATE sessions SET son_gorulme = datetime('now') WHERE token_hash = ?`),
  kullanici: db.sorgu(`SELECT * FROM users WHERE id = ?`),
  epostaIle: db.sorgu(`SELECT * FROM users WHERE email = ? AND is_npc = 0 AND silindi_at IS NULL`),
  onayEkle: db.sorgu(`INSERT INTO yasal_onaylar (user_id, belge, surum, onay) VALUES (?, ?, ?, ?)`),
};

function cerezYaz(res, token, gun = OTURUM_GUN) {
  res.cookie(CEREZ, token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production',
    maxAge: gun * 24 * 3600 * 1000, path: '/',
  });
}

// ikinciAdim=false → yalnızca 2FA kodunu bekleyen kısa ömürlü yarım oturum
async function oturumAc(req, res, userId, { ikinciAdim = true } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const sure = ikinciAdim ? `+${OTURUM_GUN} days` : `+${HESAP.ikinciAdimDakika} minutes`;
  await db.run(`INSERT INTO sessions (token_hash, user_id, expires_at, ikinci_adim, tarayici, ip_ozet, son_gorulme)
              VALUES (?, ?, datetime('now', ?), ?, ?, ?, datetime('now'))`,
  ozet(token), userId, sure, ikinciAdim ? 1 : 0, tarayiciOzeti(req.get?.('user-agent')), ipOzeti(req.ip));
  cerezYaz(res, token);
}

async function oturumSatiri(req) {
  const token = req.cookies?.[CEREZ];
  if (typeof token !== 'string' || token.length > 100) return null;
  return (await q.oturumBul.get(ozet(token))) || null;
}

// WebSocket yükseltmesi gibi Express dışı yollarda: Cookie başlığından tam (2FA tamamlanmış) oturumu çöz
async function cereztenKullanici(cerezBasligi = '') {
  const m = /(?:^|;\s*)st_oturum=([^;]+)/.exec(cerezBasligi);
  if (!m) return null;
  // Bozuk yüzde kodlaması (ör. "%") URIError fırlatır; Express dışında yakalanmayan istisna süreci kapatırdı
  let token;
  try { token = decodeURIComponent(m[1]); } catch { return null; }
  const s = await oturumSatiri({ cookies: { [CEREZ]: token } });
  return s && s.ikinci_adim && !s.silindi_at && s.status === 'ACTIVE' ? { id: s.id, display_name: s.display_name } : null;
}

// İsteğe kullanıcıyı ekler (varsa). 2FA bekleyen oturum kullanıcı sayılmaz. Express ara katmanı: hata next(e)'ye gider.
async function kimlik(req, _res, next) {
  req.kullanici = null;
  req.ikinciAdimBekleyen = null;
  try {
    const s = await oturumSatiri(req);
    if (s && !s.silindi_at) {
      if (s.ikinci_adim) {
        req.kullanici = { id: s.id, display_name: s.display_name, status: s.status, rol: s.rol,
          dogrulandi: !!s.email_dogrulandi_at, totp: !!s.totp_aktif, genc: gencMi(s.dogum_yili), oturum: s.token_hash, telefon: !!s.telefon_dogrulandi_at };
        // Son görülme 5 dakikada bir güncellenir (her istekte yazmamak için)
        if (!s.son_gorulme || Date.now() - Date.parse(s.son_gorulme + 'Z') > 5 * 60_000) await q.gorulme.run(s.token_hash);
      } else req.ikinciAdimBekleyen = s;
    }
  } catch (e) { return next(e); }
  next();
}
function girisGerekli(req, _res, next) {
  if (!req.kullanici) return next(new OyunHatasi(401, 'Giriş yapmalısınız'));
  if (req.kullanici.status !== 'ACTIVE') return next(new OyunHatasi(403, 'Hesap askıya alınmış', 'ASKIDA'));
  next();
}
// Pazar, seçim ve belediye işlemleri doğrulanmış e-posta ister (çoklu hesap ve kötüye kullanıma karşı)
function dogrulanmisGerekli(req, res, next) {
  girisGerekli(req, res, (e) => {
    if (e) return next(e);
    if (!req.kullanici.dogrulandi) return next(new OyunHatasi(403, 'Bu işlem için e-posta adresini doğrulamalısın', 'DOGRULAMA_GEREKLI'));
    // TELEFON_ZORUNLU=1: değer aktaran işlemler doğrulanmış telefon da ister (çoklu hesaba karşı)
    if (process.env.TELEFON_ZORUNLU === '1' && !req.kullanici.telefon) return next(new OyunHatasi(403, 'Bu işlem için telefon numaranı doğrulamalısın', 'TELEFON_GEREKLI'));
    next();
  });
}
// Yetkili rolleri; yöneticilerde iki adımlı doğrulama zorunludur (YONETICI_2FA_ZORUNLU=0 yalnızca geliştirmede)
function rolGerekli(...roller) {
  return (req, res, next) => girisGerekli(req, res, (e) => {
    if (e) return next(e);
    if (!roller.includes(req.kullanici.rol)) return next(new OyunHatasi(403, 'Bu alan için yetkin yok'));
    if (yoneticiIkiAdimZorunlu() && !req.kullanici.totp) return next(new OyunHatasi(403, 'Yetkili hesaplarda iki adımlı doğrulama zorunludur', 'IKI_ADIM_GEREKLI'));
    next();
  });
}

// ---------- E-posta token'ları
async function tokenUret(userId, tur, dakika) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.tx(async () => {
    await db.run(`UPDATE eposta_tokenlari SET kullanildi_at = datetime('now') WHERE user_id = ? AND tur = ? AND kullanildi_at IS NULL`, userId, tur);
    await db.run(`INSERT INTO eposta_tokenlari (token_hash, user_id, tur, expires_at) VALUES (?, ?, ?, datetime('now', ?))`,
      ozet(token), userId, tur, `+${dakika} minutes`);
  });
  return token;
}
// Token'ı tek seferlik tüketir (koşullu UPDATE: eşzamanlı iki istekten yalnızca biri alır); geçersizse hata
async function tokenTuket(token, tur) {
  if (!metinMi(token, 20, 100)) throw new OyunHatasi(400, 'Bağlantı geçersiz');
  const r = await db.get(`UPDATE eposta_tokenlari SET kullanildi_at = datetime('now')
                        WHERE token_hash = ? AND tur = ? AND kullanildi_at IS NULL AND expires_at > datetime('now')
                        RETURNING user_id`, ozet(token), tur);
  if (!r) throw new OyunHatasi(400, 'Bağlantının süresi dolmuş ya da daha önce kullanılmış');
  return r.user_id;
}

// İleti kuyruğa yazılınca döner; SMTP gönderimi arkadan yapılır (istek beklemez)
async function dogrulamaPostasi(u) {
  const token = await tokenUret(u.id, 'DOGRULA', HESAP.dogrulamaSaat * 60);
  return posta.gonder(u.email, 'Sanal Türkiye — e-posta adresini doğrula',
    `Merhaba ${u.display_name},\n\nHesabını doğrulamak için bağlantıya tıkla (${HESAP.dogrulamaSaat} saat geçerli):\n` +
    `${TABAN_URL()}/?dogrula=${token}\n\nBu hesabı sen açmadıysan bu iletiyi yok sayabilirsin.`,
    { baslik: 'E-posta adresini doğrula', paragraflar: [`Merhaba ${u.display_name},`, `Sanal Türkiye hesabını etkinleştirmek için aşağıdaki düğmeye tıkla. Bağlantı ${HESAP.dogrulamaSaat} saat geçerlidir.`],
      dugme: { metin: 'Adresimi doğrula', url: `${TABAN_URL()}/?dogrula=${token}` }, not: 'Bu hesabı sen açmadıysan bu iletiyi yok sayabilirsin.' },
    { arkaPlan: true }).catch(() => {});
}

// ---------- Kayıt / giriş
// Oyuncu adı benzersizdir (Türkçe büyük/küçük harf duyarsız; boşluklar sadeleşir)
const adAnahtari = (ad) => String(ad).trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr-TR');
// Eski hesapların ad anahtarı açılışta bir kez doldurulur (arka planda; aynı değeri yazdığından çok sunucuda da zararsız)
(async () => {
  for (const u of await db.all(`SELECT id, display_name FROM users WHERE ad_anahtar IS NULL`)) await db.run(`UPDATE users SET ad_anahtar = ? WHERE id = ?`, adAnahtari(u.display_name), u.id);
})().catch((e) => console.warn('Ad anahtarları doldurulamadı:', e.message));
const AVATAR_RE = /^t[0-4]-s[0-5]-p[0-5]-g[0-7]$/;   // ten, saç, şapka, giysi (istemci avatar.js)
async function adUygun(ad) {
  if (!metinMi(ad, 2, 32) || !/^[\p{L}\p{N} ._-]+$/u.test(ad) || !/\p{L}/u.test(ad)) return { uygun: false, sebep: 'Oyuncu adı 2–32 karakter (harf, rakam, boşluk)' };
  if (await db.get(`SELECT 1 FROM users WHERE ad_anahtar = ?`, adAnahtari(ad))) return { uygun: false, sebep: 'Bu oyuncu adı alınmış' };
  return { uygun: true };
}
// Kayıt formunun profil kısmı (her kayıt yolunda aynı): ad, doğum yılı, avatar, zorunlu onaylar
async function profilDenetle({ ad, dogumYili, avatar, kosullarOnay, kvkkOnay } = {}) {
  const u = await adUygun(ad);
  if (!u.uygun) throw new OyunHatasi(u.sebep.includes('alınmış') ? 409 : 400, u.sebep, u.sebep.includes('alınmış') ? 'AD_ALINMIS' : undefined);
  const dy = Number(dogumYili);
  if (!Number.isInteger(dy) || dy < 1900 || dy > buYil()) throw new OyunHatasi(400, 'Doğum yılını gir');
  if (yas(dy) < HESAP.minYas) throw new OyunHatasi(403, `Sanal Türkiye'ye ${HESAP.minYas} yaşından itibaren katılabilirsin`, 'YAS_SINIRI');
  if (avatar != null && avatar !== '' && !AVATAR_RE.test(avatar)) throw new OyunHatasi(400, 'Geçersiz avatar');
  if (kosullarOnay !== true || kvkkOnay !== true) throw new OyunHatasi(400, 'Kullanım koşullarını ve KVKK aydınlatma metnini onaylamalısın');
  return { ad: String(ad).trim().replace(/\s+/g, ' '), dy, avatar: avatar || null };
}
// Hesap oluşturma (e-posta+parola, Google/Apple, passkey ortak): onaylar, hoş geldin hibesi, denetim kaydı
async function hesapOlustur({ email, hash = null, ad, dy, avatar = null, pazarlamaOnay = false, dogrulandi = false, yol = 'EPOSTA' }) {
  const genc = gencMi(dy);
  const ayarlar = { sureHatirlatici: genc ? HESAP.gencSureHatirlatici : 0, sohbet: !genc };
  return db.tx(async () => {
    // Aynı e-posta / ad ile eşzamanlı kayıtlar sıraya girer: ikincisi birincinin kaydını görür ve 409 alır
    await db.kilit(`kayit:eposta:${email}`, `kayit:ad:${adAnahtari(ad)}`);
    if (await db.get('SELECT 1 FROM users WHERE email = ?', email)) throw new OyunHatasi(409, 'Bu e-posta ile kayıtlı hesap var; giriş yap', 'EPOSTA_KAYITLI');
    if (await db.get(`SELECT 1 FROM users WHERE ad_anahtar = ?`, adAnahtari(ad))) throw new OyunHatasi(409, 'Bu oyuncu adı alınmış', 'AD_ALINMIS');
    const tekrar = await silinenKimlikMi({ email });
    const id = (await db.run(`INSERT INTO users (email, password_hash, display_name, ad_anahtar, avatar, dogum_yili, ayarlar, tekrar_hesap, email_dogrulandi_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${dogrulandi || otomatikDogrula() ? "datetime('now')" : 'NULL'})`,
    email, hash, ad, adAnahtari(ad), avatar, dy, JSON.stringify(ayarlar), tekrar ? 1 : 0)).lastInsertRowid;
    await q.onayEkle.run(id, 'KOSULLAR', YASAL.KOSULLAR.surum, 1);
    await q.onayEkle.run(id, 'KVKK', YASAL.KVKK.surum, 1);
    await q.onayEkle.run(id, 'PAZARLAMA', YASAL.PAZARLAMA.surum, pazarlamaOnay === true ? 1 : 0);
    if (!tekrar) await L.odul(id, HESAP.baslangicBakiye, 'Hoş geldin hibesi');
    await L.denetim({ aktor: id, eylem: 'USER_REGISTERED', herkese: false, sonra: { genc, yol, ...(tekrar ? { tekrar: true } : {}) } });
    return id;
  });
}
function epostaDenetle(email) {
  if (!metinMi(email, 5, 254) || !EPOSTA_RE.test(email)) throw new OyunHatasi(400, 'Geçerli bir e-posta girin');
  return email.trim().toLowerCase();
}
// Parola özeti eşzamansız: bcryptjs işi parçalara bölüp olay döngüsünü kilitlemez (girişlerde diğer istekler beklemez)
async function kayit(req, res) {
  const { email, sifre, pazarlamaOnay } = req.body || {};
  const e = epostaDenetle(email);
  if (!metinMi(sifre, 8, 128)) throw new OyunHatasi(400, 'Parola 8–128 karakter olmalı');
  const p = await profilDenetle(req.body || {});
  const userId = await hesapOlustur({ email: e, hash: await bcrypt.hash(sifre, 10), ...p, pazarlamaOnay });
  if (!otomatikDogrula()) await dogrulamaPostasi(await q.kullanici.get(userId));
  await oturumAc(req, res, userId);
  res.status(201).json({ tamam: true, dogrulamaGerekli: !otomatikDogrula() });
}

async function giris(req, res) {
  const { email, sifre } = req.body || {};
  if (!metinMi(email, 3, 254) || !metinMi(sifre, 1, 128)) throw new OyunHatasi(400, 'E-posta ve parola gerekli');
  const u = await q.epostaIle.get(email.trim().toLowerCase());
  const dogru = await bcrypt.compare(sifre, u?.password_hash || DUMMY_HASH);
  if (!u || !dogru) throw new OyunHatasi(401, 'E-posta veya parola hatalı');
  if (u.status !== 'ACTIVE') throw new OyunHatasi(403, 'Hesap askıya alınmış', 'ASKIDA');
  if (u.totp_aktif) {
    await oturumAc(req, res, u.id, { ikinciAdim: false });
    return res.json({ tamam: true, ikinciAdim: true });
  }
  await oturumAc(req, res, u.id);
  await L.denetim({ aktor: u.id, eylem: 'USER_LOGIN', herkese: false });
  res.json({ tamam: true });
}

// 2FA kodu (veya kurtarma kodu) ile yarım oturumu tamamlar. Başarıda yeni token verilir (oturum sabitlemeye karşı).
async function ikinciAdim(req, res) {
  const s = req.ikinciAdimBekleyen;
  if (!s) throw new OyunHatasi(401, 'Önce e-posta ve parolanla giriş yap');
  const u = await q.kullanici.get(s.id);
  if (!await kodDogrulaSinirli(u, req.body?.kod)) {
    const d = (await db.get(`UPDATE sessions SET deneme = deneme + 1 WHERE token_hash = ? RETURNING deneme`, s.token_hash))?.deneme ?? HESAP.ikinciAdimDeneme;
    if (d >= HESAP.ikinciAdimDeneme) {
      await db.run(`DELETE FROM sessions WHERE token_hash = ?`, s.token_hash);
      res.clearCookie(CEREZ, { path: '/' });
      throw new OyunHatasi(401, 'Çok fazla hatalı deneme; baştan giriş yap', 'IKI_ADIM_KILIT');
    }
    throw new OyunHatasi(401, `Kod hatalı (${HESAP.ikinciAdimDeneme - d} hakkın kaldı)`);
  }
  // Yarım oturum koşullu silinir: aynı yarım oturumla eşzamanlı iki başarılı istekten yalnızca biri tam oturum açar
  if (!(await db.run(`DELETE FROM sessions WHERE token_hash = ?`, s.token_hash)).changes) throw new OyunHatasi(401, 'Önce e-posta ve parolanla giriş yap');
  await oturumAc(req, res, u.id);
  await L.denetim({ aktor: u.id, eylem: 'USER_LOGIN', sonra: { ikiAdim: true }, herkese: false });
  res.json({ tamam: true });
}

// TOTP kodu ya da tek kullanımlık kurtarma kodu. Aynı TOTP adımı ikinci kez kabul edilmez.
// Koşullu UPDATE: aynı kodu eşzamanlı iki istek gönderirse yalnızca biri kabul edilir.
async function kodDogrula(u, kod) {
  if (!u?.totp_aktif || typeof kod !== 'string') return false;
  const temiz = kod.replace(/[\s-]/g, '').toUpperCase();
  if (/^\d{6}$/.test(temiz)) {
    const adim = totp.eslesenAdim(coz(u.totp_sir), temiz);
    if (adim < 0 || adim <= u.totp_son_adim) return false;
    return (await db.run(`UPDATE users SET totp_son_adim = ? WHERE id = ? AND totp_son_adim < ?`, adim, u.id, adim)).changes === 1;
  }
  const kodlar = JSON.parse(u.kurtarma_kodlari || '[]');
  const i = kodlar.indexOf(ozet(`st-kurtarma:${temiz}`));
  if (i < 0) return false;
  kodlar.splice(i, 1);
  if ((await db.run(`UPDATE users SET kurtarma_kodlari = ? WHERE id = ? AND kurtarma_kodlari = ?`, JSON.stringify(kodlar), u.id, u.kurtarma_kodlari)).changes !== 1) return false;
  await L.denetim({ aktor: u.id, eylem: 'RECOVERY_CODE_USED', sonra: { kalan: kodlar.length }, herkese: false });
  return true;
}

// Hesap başına hatalı 2FA sınırı (yarım oturum sayacından bağımsız; yeni girişle sıfırlanmaz): kilitliyken doğru kod da
// kabul edilmez. Başarılı doğrulama sayacı sıfırlar.
const IKI_ADIM_HATA_SINIRI = 10, IKI_ADIM_KILIT_MS = 15 * 60_000;
async function kodDogrulaSinirli(u, kod) {
  const t = Date.now();
  if (u?.ikiadim_kilit && u.ikiadim_kilit > t) {
    throw new OyunHatasi(429, `Çok fazla hatalı kod denendi; ${Math.ceil((u.ikiadim_kilit - t) / 60_000)} dakika sonra tekrar dene`, 'IKI_ADIM_BEKLE');
  }
  if (await kodDogrula(u, kod)) {
    if (u.ikiadim_hata) await db.run(`UPDATE users SET ikiadim_hata = 0, ikiadim_kilit = NULL WHERE id = ?`, u.id);
    return true;
  }
  if (u?.totp_aktif) {
    const h = (await db.get(`UPDATE users SET ikiadim_hata = COALESCE(ikiadim_hata, 0) + 1 WHERE id = ? RETURNING ikiadim_hata`, u.id)).ikiadim_hata;
    if (h >= IKI_ADIM_HATA_SINIRI) {
      await db.run(`UPDATE users SET ikiadim_hata = 0, ikiadim_kilit = ? WHERE id = ?`, t + IKI_ADIM_KILIT_MS, u.id);
      await L.denetim({ aktor: u.id, eylem: 'TOTP_LOCKED', herkese: false });
    }
  }
  return false;
}

// Kritik işlemler (parola değiştirme, 2FA kapatma, hesap silme): parola + (açıksa) 2FA kodu
// Hassas hesap işlemleri için oturum son 15 dakikada açılmış olmalı (çalınmış eski bir oturum çerezi kalıcı erişime
// dönüşmesin: passkey ekleme, Google/Apple bağlama, 2FA kurma; parolasız hesapta parolanın yerini tutar)
const TAZE_OTURUM_MS = 15 * 60_000;
async function tazeOturumMu(req) {
  const s = req.kullanici?.oturum && await db.get('SELECT created_at FROM sessions WHERE token_hash = ?', req.kullanici.oturum);
  return !!s && Date.now() - Date.parse(`${s.created_at.replace(' ', 'T')}Z`) < TAZE_OTURUM_MS;
}
// Express ara katmanı: hata next(e)'ye gider
async function tazeOturumGerekli(req, _res, next) {
  let taze;
  try { taze = await tazeOturumMu(req); } catch (e) { return next(e); }
  if (!taze) return next(new OyunHatasi(403, 'Güvenliğin için çıkış yapıp yeniden giriş yap, sonra tekrar dene', 'YENIDEN_GIRIS'));
  next();
}
// Parolayla yeniden kimlik. Parolası olmayan (Google, Apple, passkey) hesapta taze oturum yeterlidir.
async function yenidenKimlik(userId, { sifre, kod } = {}, { taze = false } = {}) {
  const u = await q.kullanici.get(userId);
  if (!u.password_hash && taze) { if (u.totp_aktif && !await kodDogrulaSinirli(u, kod)) throw new OyunHatasi(401, 'İki adımlı doğrulama kodu hatalı'); return u; }
  if (!u.password_hash) throw new OyunHatasi(403, 'Güvenliğin için çıkış yapıp yeniden giriş yap, sonra tekrar dene', 'YENIDEN_GIRIS');
  if (!metinMi(sifre, 1, 128) || !await bcrypt.compare(sifre, u.password_hash || DUMMY_HASH)) throw new OyunHatasi(401, 'Parola hatalı');
  if (u.totp_aktif && !await kodDogrulaSinirli(u, kod)) throw new OyunHatasi(401, 'İki adımlı doğrulama kodu hatalı');
  return u;
}

async function cikis(req, res) {
  const token = req.cookies?.[CEREZ];
  if (typeof token === 'string') await db.run('DELETE FROM sessions WHERE token_hash = ?', ozet(token));
  res.clearCookie(CEREZ, { path: '/' });
  res.json({ tamam: true });
}

// ---------- E-posta doğrulama
async function epostaDogrula(req) {
  await db.tx(async () => {
    const userId = await tokenTuket(req.body?.token, 'DOGRULA');
    await db.run(`UPDATE users SET email_dogrulandi_at = COALESCE(email_dogrulandi_at, datetime('now')) WHERE id = ?`, userId);
    await L.denetim({ aktor: userId, eylem: 'EMAIL_VERIFIED', herkese: false });
  });
  return { tamam: true };
}
async function dogrulamaYenidenGonder(req) {
  const u = await q.kullanici.get(req.kullanici.id);
  if (u.email_dogrulandi_at) return { tamam: true, zatenDogrulandi: true };
  const son = await db.get(`SELECT created_at FROM eposta_tokenlari WHERE user_id = ? AND tur = 'DOGRULA' ORDER BY created_at DESC LIMIT 1`, u.id);
  if (son && Date.now() - Date.parse(son.created_at + 'Z') < 60_000) throw new OyunHatasi(429, 'Yeni bağlantı için bir dakika bekle');
  await dogrulamaPostasi(u);
  return { tamam: true };
}

// ---------- Parola sıfırlama (hesap varlığını sızdırmaz: her durumda aynı yanıt)
async function sifreUnuttum(req) {
  const email = req.body?.email;
  if (!metinMi(email, 3, 254)) throw new OyunHatasi(400, 'E-posta gerekli');
  const u = await q.epostaIle.get(email.trim().toLowerCase());
  if (u) {
    const token = await tokenUret(u.id, 'SIFIRLA', HESAP.sifirlamaDakika);
    await posta.gonder(u.email, 'Sanal Türkiye — parola sıfırlama',
      `Merhaba ${u.display_name},\n\nParolanı sıfırlamak için (${HESAP.sifirlamaDakika} dakika geçerli):\n${TABAN_URL()}/?sifirla=${token}\n\n` +
      'Bu isteği sen yapmadıysan parolan değişmedi; bu iletiyi yok sayabilirsin.',
      { baslik: 'Parolanı sıfırla', paragraflar: [`Merhaba ${u.display_name},`, `Parola sıfırlama isteği aldık. Yeni parolanı belirlemek için düğmeye tıkla. Bağlantı ${HESAP.sifirlamaDakika} dakika geçerlidir ve bir kez kullanılabilir.`],
        dugme: { metin: 'Yeni parola belirle', url: `${TABAN_URL()}/?sifirla=${token}` }, not: 'Bu isteği sen yapmadıysan parolan değişmedi; bu iletiyi yok sayabilirsin.' },
      { arkaPlan: true }).catch(() => {});
    await L.denetim({ aktor: u.id, eylem: 'PASSWORD_RESET_REQUESTED', herkese: false });
  }
  return { tamam: true, mesaj: 'Bu adrese kayıtlı bir hesap varsa sıfırlama bağlantısı gönderildi.' };
}
async function sifreSifirla(req) {
  const { token, sifre } = req.body || {};
  if (!metinMi(sifre, 8, 128)) throw new OyunHatasi(400, 'Parola 8–128 karakter olmalı');
  const hash = await bcrypt.hash(sifre, 10);   // işlem açılmadan (bağlantı tutulmasın)
  const userId = await db.tx(async () => {
    const id = await tokenTuket(token, 'SIFIRLA');
    const onceDogrulanmis = !!(await db.get(`SELECT email_dogrulandi_at FROM users WHERE id = ? FOR UPDATE`, id)).email_dogrulandi_at;
    // E-postası doğrulanmamış hesap: adresin sahibi devralır; başkasının eklemiş olabileceği passkey/bağlı hesap/2FA silinir
    if (!onceDogrulanmis) await require('./giris-yollari').epostaSahibiDevralir(id);
    // Bağlantıya erişebilen kişi e-postanın sahibidir: adres de doğrulanmış sayılır
    await db.run(`UPDATE users SET password_hash = ?, email_dogrulandi_at = COALESCE(email_dogrulandi_at, datetime('now')) WHERE id = ?`, hash, id);
    await db.run(`DELETE FROM sessions WHERE user_id = ?`, id);
    await L.denetim({ aktor: id, eylem: 'PASSWORD_RESET', herkese: false });
    return id;
  });
  const u = await q.kullanici.get(userId);
  await posta.gonder(u.email, 'Sanal Türkiye — parolan değişti', 'Parolan az önce sıfırlandı ve tüm oturumların kapatıldı. Bunu sen yapmadıysan hemen bizimle iletişime geç.',
    { baslik: 'Parolan değişti', paragraflar: ['Parolan az önce sıfırlandı ve tüm cihazlardaki oturumların kapatıldı.', 'Bunu sen yapmadıysan hemen destek ekibimizle iletişime geç.'] },
    { arkaPlan: true }).catch(() => {});
  return { tamam: true };
}
async function sifreDegistir(req) {
  const { yeni } = req.body || {};
  if (!metinMi(yeni, 8, 128)) throw new OyunHatasi(400, 'Yeni parola 8–128 karakter olmalı');
  const u = await yenidenKimlik(req.kullanici.id, req.body);
  const hash = await bcrypt.hash(yeni, 10);
  await db.tx(async () => {
    await db.run(`UPDATE users SET password_hash = ? WHERE id = ?`, hash, u.id);
    await db.run(`DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?`, u.id, req.kullanici.oturum);
    await L.denetim({ aktor: u.id, eylem: 'PASSWORD_CHANGED', herkese: false });
  });
  return { tamam: true };
}

// ---------- İki adımlı doğrulama kurulumu
async function ikiAdimKur(req) {
  const u = await q.kullanici.get(req.kullanici.id);
  if (u.totp_aktif) throw new OyunHatasi(409, 'İki adımlı doğrulama zaten açık');
  const sir = totp.yeniSir();
  await db.run(`UPDATE users SET totp_sir = ? WHERE id = ? AND totp_aktif = 0`, sifrele(sir), u.id);
  const uri = totp.otpauthUri(sir, u.email);
  return { sir, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220, color: { dark: '#2b2118', light: '#fffaf0' } }) };
}
async function ikiAdimEtkinlestir(req) {
  const u = await q.kullanici.get(req.kullanici.id);
  if (u.totp_aktif) throw new OyunHatasi(409, 'İki adımlı doğrulama zaten açık');
  if (!u.totp_sir) throw new OyunHatasi(400, 'Önce kurulumu başlat');
  const adim = totp.eslesenAdim(coz(u.totp_sir), metin(req.body?.kod));
  if (adim < 0) throw new OyunHatasi(400, 'Kod hatalı; uygulamadaki güncel kodu gir');
  // 10 tek kullanımlık kurtarma kodu: yalnızca bu yanıtta düz metin gösterilir
  const kodlar = Array.from({ length: 10 }, () => totp.base32Kodla(crypto.randomBytes(5)).slice(0, 8).replace(/(.{4})/, '$1-'));
  await db.tx(async () => {
    // Koşullu: eşzamanlı iki etkinleştirmeden yalnızca biri kurtarma kodlarını yazar
    const r = await db.run(`UPDATE users SET totp_aktif = 1, totp_son_adim = ?, kurtarma_kodlari = ? WHERE id = ? AND totp_aktif = 0 AND totp_sir = ?`,
      adim, JSON.stringify(kodlar.map((k) => ozet(`st-kurtarma:${k.replace('-', '')}`))), u.id, u.totp_sir);
    if (r.changes !== 1) throw new OyunHatasi(409, 'İki adımlı doğrulama zaten açık');
    await db.run(`DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?`, u.id, req.kullanici.oturum);
    await L.denetim({ aktor: u.id, eylem: 'TOTP_ENABLED', herkese: false });
  });
  return { tamam: true, kurtarmaKodlari: kodlar };
}
async function ikiAdimKapat(req) {
  const u = await yenidenKimlik(req.kullanici.id, req.body, { taze: await tazeOturumMu(req) });
  if (!u.totp_aktif) return { tamam: true };
  if (['MODERATOR', 'DENETCI', 'ADMIN'].includes(u.rol) && yoneticiIkiAdimZorunlu()) throw new OyunHatasi(403, 'Yetkili hesaplarda iki adımlı doğrulama kapatılamaz');
  await db.tx(async () => {
    await db.run(`UPDATE users SET totp_aktif = 0, totp_sir = NULL, kurtarma_kodlari = NULL WHERE id = ?`, u.id);
    await L.denetim({ aktor: u.id, eylem: 'TOTP_DISABLED', herkese: false });
  });
  return { tamam: true };
}

// ---------- Oturumlar
const oturumKimligi = (tokenHash) => tokenHash.slice(0, 16);
async function oturumlar(req) {
  return (await db.all(`SELECT token_hash, tarayici, created_at, son_gorulme FROM sessions
                     WHERE user_id = ? AND ikinci_adim = 1 AND expires_at > datetime('now') ORDER BY son_gorulme DESC`, req.kullanici.id))
    .map((s) => ({ id: oturumKimligi(s.token_hash), tarayici: s.tarayici || 'Bilinmeyen cihaz', acildi: s.created_at, sonGorulme: s.son_gorulme, bu: s.token_hash === req.kullanici.oturum }));
}
async function oturumKapat(req) {
  const id = String(req.params.id || '');
  if (!/^[0-9a-f]{16}$/.test(id)) throw new OyunHatasi(400, 'Geçersiz oturum');
  const r = await db.run(`DELETE FROM sessions WHERE user_id = ? AND substr(token_hash, 1, 16) = ?`, req.kullanici.id, id);
  if (!r.changes) throw new OyunHatasi(404, 'Oturum bulunamadı');
  return { tamam: true };
}
async function digerOturumlariKapat(req) {
  const r = await db.run(`DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?`, req.kullanici.id, req.kullanici.oturum);
  return { tamam: true, kapatilan: r.changes };
}

// /api/ben için hesap durumu
async function hesapDurumu(userId) {
  const u = await q.kullanici.get(userId);
  const ayar = JSON.parse(u.ayarlar || '{}');
  const eksikOnay = [];
  for (const [k, b] of Object.entries(YASAL)) {
    if (b.zorunlu && !await db.get(`SELECT 1 FROM yasal_onaylar WHERE user_id = ? AND belge = ? AND surum = ? AND onay = 1`, userId, k, b.surum)) eksikOnay.push(k);
  }
  const memleketAd = u.memleket_plaka ? (await db.get(`SELECT name FROM regions WHERE type = 'IL' AND plaka = ?`, u.memleket_plaka))?.name : undefined;
  return { dogrulandi: !!u.email_dogrulandi_at, ikiAdim: !!u.totp_aktif, rol: u.rol, rolAd: ROLLER[u.rol] || u.rol,
    avatar: u.avatar || null, telefonDogrulandi: !!u.telefon_dogrulandi_at, parolaVar: !!u.password_hash,
    genc: gencMi(u.dogum_yili), ayarlar: ayar, eksikOnay,
    memleket: u.memleket_plaka ? { plaka: u.memleket_plaka, ad: memleketAd } : null,
    kurtarmaKalan: u.totp_aktif ? JSON.parse(u.kurtarma_kodlari || '[]').length : null };
}

// Zamanlayıcıdan çağrılır: hata yutulur (uyarı yazılır), yakalanmamış söz bırakmaz. Silmeler tekrarlanabilir; çok sunucuda zararsız.
async function eskiOturumlariTemizle() {
  try {
    await db.run(`DELETE FROM sessions WHERE expires_at <= datetime('now')`);
    await db.run(`DELETE FROM eposta_tokenlari WHERE expires_at <= datetime('now', '-7 days')`);
  } catch (e) { console.warn('Oturum temizliği başarısız:', e.message); }
}

module.exports = {
  CEREZ, kimlik, cereztenKullanici, girisGerekli, dogrulanmisGerekli, rolGerekli, kayit, giris, ikinciAdim, cikis, yenidenKimlik, kodDogrula, tazeOturumMu, tazeOturumGerekli,
  oturumAc, hesapOlustur, profilDenetle, silinenKimlikKaydet, silinenKimlikMi, tekrarHesapMi, tekrarIsaretle, adUygun, adAnahtari, epostaDenetle, dogrulamaPostasi, TABAN_URL, AVATAR_RE,
  epostaDogrula, dogrulamaYenidenGonder, sifreUnuttum, sifreSifirla, sifreDegistir, ikiAdimKur, ikiAdimEtkinlestir, ikiAdimKapat,
  oturumlar, oturumKapat, digerOturumlariKapat, hesapDurumu, eskiOturumlariTemizle, gencMi, yas,
};
