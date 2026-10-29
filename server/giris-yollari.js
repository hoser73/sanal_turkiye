// Ek giriş ve kayıt yolları (e-posta + parolanın yanında):
// - Google ve Apple ile giriş (OpenID Connect, yetki kodu akışı): state + nonce sunucuda tek kullanımlık, tarayıcıya bağlı
//   (st_oauth çerezi), Google'da PKCE; kimlik jetonu sağlayıcının JWKS anahtarıyla doğrulanır. Sağlayıcı anahtarları
//   (GOOGLE_CLIENT_ID/SECRET, APPLE_CLIENT_ID/TEAM_ID/KEY_ID/PRIVATE_KEY) yoksa o yol kapalıdır.
// - Şifresiz giriş (passkey / WebAuthn): kayıt ve giriş; sorgular tek kullanımlık ve 5 dakika geçerli.
// - Telefon doğrulama (SMS kodu): numara şifreli saklanır, tekilliği özetle denetlenir; kodlar özetlenir, 5 dk / 5 deneme.
// İlk kez gelen Google/Apple/passkey kullanıcısı için "kayıt taslağı" açılır; profil (ad, doğum yılı, avatar, onaylar)
// tamamlanınca hesap e-posta kaydıyla aynı yoldan oluşturulur (auth.hesapOlustur).
const crypto = require('crypto');
const db = require('./db');
const { metin } = require('./lib/girdi');
const L = require('./lib/ledger');
const auth = require('./auth');
const sms = require('./sms');
const { sifrele, coz } = require('./lib/sifreleme');
const { OyunHatasi } = L;
const { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } = require('@simplewebauthn/server');

const simdi = () => Date.now();
const ozet = (t) => crypto.createHash('sha256').update(t).digest('hex');
const rastgele = (n = 32) => crypto.randomBytes(n).toString('base64url');
const env = process.env;
const ayar = { fetch: (...a) => fetch(...a) };   // testlerde sahte sağlayıcı
const TASLAK_CEREZ = 'st_taslak', OAUTH_CEREZ = 'st_oauth';
const uretim = () => env.NODE_ENV === 'production';

const cerezSecenek = (ek = {}) => ({ httpOnly: true, sameSite: 'lax', secure: uretim(), path: '/', ...ek });
async function eskileriTemizle(t = simdi()) {
  await db.run(`DELETE FROM oauth_durumlari WHERE expires_at < ?`, t);
  await db.run(`DELETE FROM kayit_taslaklari WHERE expires_at < ?`, t);
  await db.run(`DELETE FROM webauthn_sorgulari WHERE expires_at < ?`, t);
  await db.run(`DELETE FROM telefon_kodlari WHERE expires_at < ?`, t - 2 * 864e5);   // sayım için 1 gün tutulur
}

// Girişte ortak: askı/silinme denetimi, 2FA açıksa yarım oturum
async function girisYap(req, res, u, yol) {
  if (!u || u.silindi_at || u.is_npc) throw new OyunHatasi(401, 'Hesap bulunamadı');
  if (u.status !== 'ACTIVE') throw new OyunHatasi(403, 'Hesap askıya alınmış', 'ASKIDA');
  if (u.totp_aktif && yol !== 'PASSKEY') { await auth.oturumAc(req, res, u.id, { ikinciAdim: false }); return { ikinciAdim: true }; }
  await auth.oturumAc(req, res, u.id);
  await L.denetim({ aktor: u.id, eylem: 'USER_LOGIN', herkese: false, sonra: { yol } });
  return { ikinciAdim: false };
}
const kullanici = (id) => db.get(`SELECT * FROM users WHERE id = ?`, id);
const epostaIle = (e) => db.get(`SELECT * FROM users WHERE email = ? AND is_npc = 0 AND silindi_at IS NULL`, e);

// ---------- Kayıt taslağı
async function taslakAc(res, t) {
  const token = rastgele();
  await db.run(`INSERT INTO kayit_taslaklari (token_ozet, saglayici, konu, email, email_dogrulandi, ad_oneri, passkey, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ozet(token), t.saglayici, t.konu || null, t.email, t.emailDogrulandi ? 1 : 0, t.adOneri || null, t.passkey ? JSON.stringify(t.passkey) : null, simdi() + 30 * 60_000);
  res.cookie(TASLAK_CEREZ, token, cerezSecenek({ maxAge: 30 * 60_000 }));
}
async function taslakOku(req) {
  const token = req.cookies?.[TASLAK_CEREZ];
  if (typeof token !== 'string' || token.length > 100) return null;
  return (await db.get(`SELECT * FROM kayit_taslaklari WHERE token_ozet = ? AND expires_at > ?`, ozet(token), simdi())) || null;
}
async function taslakBilgisi(req) {
  const t = await taslakOku(req);
  if (!t) throw new OyunHatasi(404, 'Kayıt oturumu bulunamadı ya da süresi doldu');
  return { saglayici: t.saglayici, email: t.email, emailDogrulandi: !!t.email_dogrulandi, adOneri: t.ad_oneri };
}
async function kayitTamamla(req, res) {
  const t = await taslakOku(req);
  if (!t) throw new OyunHatasi(404, 'Kayıt oturumunun süresi doldu; baştan başla');
  const p = await auth.profilDenetle(req.body || {});
  const userId = await db.tx(async () => {
    // Taslak tek kullanımlık: eşzamanlı ikinci tamamlama isteği hesap açamaz
    if ((await db.run(`DELETE FROM kayit_taslaklari WHERE token_ozet = ?`, t.token_ozet)).changes !== 1) throw new OyunHatasi(404, 'Kayıt oturumunun süresi doldu; baştan başla');
    const id = await auth.hesapOlustur({ email: t.email, hash: null, ...p, pazarlamaOnay: req.body?.pazarlamaOnay, dogrulandi: !!t.email_dogrulandi, yol: t.saglayici.toUpperCase() });
    if (t.konu) await db.run(`INSERT INTO kimlik_baglantilari (saglayici, konu, user_id, email, created_at) VALUES (?, ?, ?, ?, ?)`, t.saglayici, t.konu, id, t.email, simdi());
    if (t.passkey) {
      const k = JSON.parse(t.passkey);
      await db.run(`UPDATE users SET webauthn_kimlik = ? WHERE id = ?`, k.kullaniciKimligi, id);
      await passkeyKaydet(id, k);
    }
    return id;
  });
  res.clearCookie(TASLAK_CEREZ, { path: '/' });
  if (!t.email_dogrulandi) await auth.dogrulamaPostasi(await kullanici(userId));
  await auth.oturumAc(req, res, userId);
  res.status(201).json({ tamam: true, dogrulamaGerekli: !t.email_dogrulandi && process.env.OTOMATIK_DOGRULA !== '1' });
}

// ---------- Google / Apple (OpenID Connect)
const SAGLAYICI = {
  google: {
    ad: 'Google', yetki: 'https://accounts.google.com/o/oauth2/v2/auth', jeton: 'https://oauth2.googleapis.com/token',
    anahtarlar: 'https://www.googleapis.com/oauth2/v3/certs', yayinci: ['https://accounts.google.com', 'accounts.google.com'],
    kapsam: 'openid email profile', pkce: true, etkin: () => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    istemci: () => env.GOOGLE_CLIENT_ID, gizli: () => env.GOOGLE_CLIENT_SECRET, ek: { prompt: 'select_account' },
  },
  apple: {
    ad: 'Apple', yetki: 'https://appleid.apple.com/auth/authorize', jeton: 'https://appleid.apple.com/auth/token',
    anahtarlar: 'https://appleid.apple.com/auth/keys', yayinci: ['https://appleid.apple.com'],
    kapsam: 'name email', pkce: false, formPost: true,
    etkin: () => !!(env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY),
    istemci: () => env.APPLE_CLIENT_ID, gizli: () => appleIstemciSirri(), ek: { response_mode: 'form_post' },
  },
};
const donusAdresi = (s) => `${auth.TABAN_URL()}/api/oauth/${s}/donus`;
// Apple istemci sırrı: .p8 anahtarıyla ES256 imzalı kısa ömürlü JWT
function appleIstemciSirri() {
  const t = Math.floor(simdi() / 1000);
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const govde = `${b({ alg: 'ES256', kid: env.APPLE_KEY_ID })}.${b({ iss: env.APPLE_TEAM_ID, iat: t, exp: t + 3600, aud: 'https://appleid.apple.com', sub: env.APPLE_CLIENT_ID })}`;
  const anahtar = crypto.createPrivateKey(env.APPLE_PRIVATE_KEY.replace(/\\n/g, '\n'));
  return `${govde}.${crypto.sign('sha256', Buffer.from(govde), { key: anahtar, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}
async function oauthBasla(req, res) {
  const s = String(req.params.saglayici);
  const p = Object.hasOwn(SAGLAYICI, s) ? SAGLAYICI[s] : null;
  if (!p?.etkin()) throw new OyunHatasi(404, 'Bu giriş yolu açık değil');
  const mod = req.query.mod === 'bagla' ? 'bagla' : 'giris';
  if (mod === 'bagla' && !req.kullanici) throw new OyunHatasi(401, 'Bağlamak için önce giriş yap');
  if (mod === 'bagla' && !await auth.tazeOturumMu(req)) throw new OyunHatasi(403, 'Güvenliğin için çıkış yapıp yeniden giriş yap, sonra tekrar bağla', 'YENIDEN_GIRIS');
  await eskileriTemizle();
  const state = rastgele(), nonce = rastgele(), dogrulayici = p.pkce ? rastgele(48) : null, tarayici = rastgele();
  await db.run(`INSERT INTO oauth_durumlari (state_ozet, saglayici, nonce, dogrulayici, tarayici_ozet, mod, user_id, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ozet(state), s, nonce, dogrulayici, ozet(tarayici), mod, mod === 'bagla' ? req.kullanici.id : null, simdi() + 10 * 60_000);
  // Apple dönüşü siteler arası POST olduğundan çerez SameSite=None (yalnızca https'te) olmalı
  res.cookie(OAUTH_CEREZ, tarayici, cerezSecenek(p.formPost ? { sameSite: 'none', secure: true, maxAge: 10 * 60_000 } : { maxAge: 10 * 60_000 }));
  const q = new URLSearchParams({ client_id: p.istemci(), redirect_uri: donusAdresi(s), response_type: 'code', scope: p.kapsam, state, nonce, ...p.ek });
  if (p.pkce) { q.set('code_challenge', crypto.createHash('sha256').update(dogrulayici).digest('base64url')); q.set('code_challenge_method', 'S256'); }
  res.redirect(302, `${p.yetki}?${q}`);
}
// JWKS (sağlayıcı başına 1 saat önbellek; bilinmeyen kid gelirse bir kez yenilenir)
const jwksOnbellek = new Map();
async function anahtarBul(s, kid) {
  for (let i = 0; i < 2; i++) {
    let o = jwksOnbellek.get(s);
    if (!o || simdi() - o.t > 3600_000 || i === 1) {
      const r = await ayar.fetch(SAGLAYICI[s].anahtarlar, { signal: AbortSignal.timeout(10_000) });
      o = { t: simdi(), keys: (await r.json()).keys || [] };
      jwksOnbellek.set(s, o);
    }
    const k = o.keys.find((x) => x.kid === kid);
    if (k) return k;
  }
  throw new Error('İmza anahtarı bulunamadı');
}
async function jetonDogrula(s, idToken, nonce) {
  const parca = String(idToken || '').split('.');
  if (parca.length !== 3) throw new Error('Kimlik jetonu bozuk');
  const baslik = JSON.parse(Buffer.from(parca[0], 'base64url'));
  if (baslik.alg !== 'RS256') throw new Error('Desteklenmeyen imza');
  const jwk = await anahtarBul(s, baslik.kid);
  const dogru = crypto.verify('RSA-SHA256', Buffer.from(`${parca[0]}.${parca[1]}`), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parca[2], 'base64url'));
  if (!dogru) throw new Error('İmza geçersiz');
  const c = JSON.parse(Buffer.from(parca[1], 'base64url'));
  const p = SAGLAYICI[s], t = simdi() / 1000;
  if (!p.yayinci.includes(c.iss)) throw new Error('Yayıncı hatalı');
  if (!(Array.isArray(c.aud) ? c.aud.includes(p.istemci()) : c.aud === p.istemci())) throw new Error('Hedef hatalı');
  if (!(c.exp > t - 60) || (c.iat && c.iat > t + 300)) throw new Error('Jeton süresi geçersiz');
  if (c.nonce !== nonce) throw new Error('nonce uyuşmuyor');
  if (!c.sub) throw new Error('Kimlik yok');
  return c;
}
async function oauthDonus(req, res) {
  const s = String(req.params.saglayici);
  const p = Object.hasOwn(SAGLAYICI, s) ? SAGLAYICI[s] : null;
  const g = { ...(req.query || {}), ...(req.body || {}) };
  const yonlendir = (yer) => res.redirect(303, yer);
  if (!p?.etkin()) return yonlendir('/?giris_hata=kapali');
  if (g.error) return yonlendir('/?giris_hata=iptal');
  const d = typeof g.state === 'string' ? await db.get(`DELETE FROM oauth_durumlari WHERE state_ozet = ? RETURNING *`, ozet(g.state)) : null;
  const tarayici = req.cookies?.[OAUTH_CEREZ];
  res.clearCookie(OAUTH_CEREZ, { path: '/' });
  if (!d || d.saglayici !== s || d.expires_at < simdi() || typeof tarayici !== 'string' || ozet(tarayici) !== d.tarayici_ozet || typeof g.code !== 'string') {
    return yonlendir('/?giris_hata=oturum');
  }
  let c;
  try {
    const govde = new URLSearchParams({ client_id: p.istemci(), client_secret: p.gizli(), code: g.code, grant_type: 'authorization_code', redirect_uri: donusAdresi(s) });
    if (d.dogrulayici) govde.set('code_verifier', d.dogrulayici);
    const r = await ayar.fetch(p.jeton, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: govde, signal: AbortSignal.timeout(15_000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.id_token) throw new Error(`Jeton alınamadı (${r.status})`);
    c = await jetonDogrula(s, j.id_token, d.nonce);
  } catch (e) {
    if (!env.SESSIZ) console.warn(`${p.ad} girişi başarısız:`, e.message);
    return yonlendir('/?giris_hata=dogrulama');
  }
  const email = typeof c.email === 'string' ? c.email.trim().toLowerCase() : null;
  const emailDogru = c.email_verified === true || c.email_verified === 'true';
  let adOneri = typeof c.name === 'string' ? c.name : null;
  if (!adOneri && typeof g.user === 'string') { try { const u = JSON.parse(g.user); adOneri = [u?.name?.firstName, u?.name?.lastName].filter(Boolean).join(' ') || null; } catch { /* yok */ } }
  try {
    const bag = await db.get(`SELECT * FROM kimlik_baglantilari WHERE saglayici = ? AND konu = ?`, s, String(c.sub));
    if (d.mod === 'bagla') {
      if (bag && bag.user_id !== d.user_id) return yonlendir('/?giris_hata=baska_hesap');
      await db.tx(async () => {
        // Eşzamanlı iki bağlama aynı kaydı yazmaya çalışırsa ikincisi yok sayılır
        if (!bag) await db.run(`INSERT OR IGNORE INTO kimlik_baglantilari (saglayici, konu, user_id, email, created_at) VALUES (?, ?, ?, ?, ?)`, s, String(c.sub), d.user_id, email, simdi());
        await L.denetim({ aktor: d.user_id, eylem: 'LOGIN_METHOD_LINKED', herkese: false, sonra: { saglayici: s } });
      });
      return yonlendir(`/?baglandi=${s}`);
    }
    if (bag) return yonlendir((await girisYap(req, res, await kullanici(bag.user_id), s.toUpperCase())).ikinciAdim ? '/?ikiAdim=1' : '/?giris=tamam');
    // Sağlayıcının doğruladığı e-posta mevcut bir hesaba aitse: o hesaba bağla (adresin sahibi kanıtlanmıştır)
    const mevcut = email && emailDogru ? await epostaIle(email) : null;
    if (mevcut) {
      await db.tx(async () => {
        // Hesabın e-postası doğrulanmamışsa onu başkası açmış olabilir: adresin kanıtlı sahibi devralır, önceki giriş yolları silinir
        if (!mevcut.email_dogrulandi_at) await epostaSahibiDevralir(mevcut.id);
        await db.run(`INSERT INTO kimlik_baglantilari (saglayici, konu, user_id, email, created_at) VALUES (?, ?, ?, ?, ?)`, s, String(c.sub), mevcut.id, email, simdi());
        await db.run(`UPDATE users SET email_dogrulandi_at = COALESCE(email_dogrulandi_at, datetime('now')) WHERE id = ?`, mevcut.id);
        await L.denetim({ aktor: mevcut.id, eylem: 'LOGIN_METHOD_LINKED', herkese: false, sonra: { saglayici: s, otomatik: true, devralma: !mevcut.email_dogrulandi_at } });
      });
      return yonlendir((await girisYap(req, res, await kullanici(mevcut.id), s.toUpperCase())).ikinciAdim ? '/?ikiAdim=1' : '/?giris=tamam');
    }
    if (!email) return yonlendir('/?giris_hata=eposta');
    await taslakAc(res, { saglayici: s, konu: String(c.sub), email, emailDogrulandi: emailDogru, adOneri });
    return yonlendir('/?kayit=tamamla');
  } catch (e) {
    if (e instanceof OyunHatasi && e.status === 403) return yonlendir('/?giris_hata=askida');
    throw e;
  }
}

// ---------- Passkey (WebAuthn)
function rp() {
  const u = new URL(auth.TABAN_URL());
  return { rpID: u.hostname, origin: u.origin, rpName: 'Sanal Türkiye' };
}
async function sorguAc(tur, challenge, ek = {}) {
  await eskileriTemizle();
  const id = rastgele(18);
  await db.run(`INSERT INTO webauthn_sorgulari (id, tur, challenge, user_id, email, kullanici_kimligi, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id, tur, challenge, ek.userId ?? null, ek.email ?? null, ek.kullaniciKimligi ?? null, simdi() + 5 * 60_000);
  return id;
}
async function sorguTuket(id, tur) {
  const s = typeof id === 'string' && id.length < 64 ? await db.get(`DELETE FROM webauthn_sorgulari WHERE id = ? AND tur = ? RETURNING *`, id, tur) : null;
  if (!s || s.expires_at < simdi()) throw new OyunHatasi(400, 'Doğrulama isteğinin süresi doldu; yeniden dene');
  return s;
}
// İşlem içinde çağrılır: oyuncunun anahtarları kilitlenir (eşzamanlı eklemeler 10 sınırını aşamaz)
async function passkeyKaydet(userId, k) {
  await db.kilit(`passkey:${userId}`);
  if ((await db.get(`SELECT COUNT(*) c FROM passkeyler WHERE user_id = ?`, userId)).c >= 10) throw new OyunHatasi(409, 'En çok 10 anahtar ekleyebilirsin');
  // Aynı anahtar eşzamanlı iki kez kaydedilmeye çalışılırsa ikincisi 409 alır (UNIQUE hatası işlemi bozmasın)
  const r = await db.run(`INSERT OR IGNORE INTO passkeyler (id, user_id, acik_anahtar, sayac, tasima, ad, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    k.id, userId, Buffer.from(k.acikAnahtar, 'base64url'), k.sayac || 0, JSON.stringify(k.tasima || []), (k.ad || 'Passkey').slice(0, 40), simdi());
  if (r.changes !== 1) throw new OyunHatasi(409, 'Bu anahtar zaten kayıtlı');
}
async function kayitDogrula(s, yanit) {
  const { rpID, origin } = rp();
  let v;
  try { v = await verifyRegistrationResponse({ response: yanit, expectedChallenge: s.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false }); }
  catch { throw new OyunHatasi(400, 'Anahtar doğrulanamadı'); }
  if (!v.verified) throw new OyunHatasi(400, 'Anahtar doğrulanamadı');
  const c = v.registrationInfo.credential;
  if (await db.get(`SELECT 1 FROM passkeyler WHERE id = ?`, c.id)) throw new OyunHatasi(409, 'Bu anahtar zaten kayıtlı');
  return { id: c.id, acikAnahtar: Buffer.from(c.publicKey).toString('base64url'), sayac: c.counter, tasima: c.transports || yanit?.response?.transports || [] };
}
// Kayıtlı oyuncu yeni anahtar ekler
async function passkeyEkleSecenek(req) {
  const u = await kullanici(req.kullanici.id);
  let kk = u.webauthn_kimlik;
  if (!kk) {
    // Koşullu: eşzamanlı iki istekte ilk yazılan kimlik kalır
    await db.run(`UPDATE users SET webauthn_kimlik = ? WHERE id = ? AND webauthn_kimlik IS NULL`, rastgele(16), u.id);
    kk = (await db.get(`SELECT webauthn_kimlik FROM users WHERE id = ?`, u.id)).webauthn_kimlik;
  }
  const mevcut = await db.all(`SELECT id, tasima FROM passkeyler WHERE user_id = ?`, u.id);
  const { rpID, rpName } = rp();
  const sec = await generateRegistrationOptions({ rpName, rpID, userName: u.email || u.display_name, userDisplayName: u.display_name, userID: Buffer.from(kk, 'base64url'),
    attestationType: 'none', excludeCredentials: mevcut.map((m) => ({ id: m.id, transports: JSON.parse(m.tasima || '[]') })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' } });
  return { sorguId: await sorguAc('EKLE', sec.challenge, { userId: u.id }), secenekler: sec };
}
async function passkeyEkle(req) {
  const s = await sorguTuket(req.body?.sorguId, 'EKLE');
  if (s.user_id !== req.kullanici.id) throw new OyunHatasi(403, 'Bu istek sana ait değil');
  const k = await kayitDogrula(s, req.body?.yanit);
  await db.tx(async () => {
    await passkeyKaydet(req.kullanici.id, { ...k, ad: typeof req.body?.ad === 'string' ? req.body.ad.trim() : null });
    await L.denetim({ aktor: req.kullanici.id, eylem: 'PASSKEY_ADDED', herkese: false });
  });
  return { tamam: true };
}
// Şifresiz yeni hesap: e-posta + anahtar → kayıt taslağı
async function yeniHesapSecenek(req) {
  const email = auth.epostaDenetle(req.body?.email);
  if (await db.get(`SELECT 1 FROM users WHERE email = ?`, email)) throw new OyunHatasi(409, 'Bu e-posta ile kayıtlı hesap var; giriş yap', 'EPOSTA_KAYITLI');
  const kk = rastgele(16), { rpID, rpName } = rp();
  const sec = await generateRegistrationOptions({ rpName, rpID, userName: email, userDisplayName: email, userID: Buffer.from(kk, 'base64url'),
    attestationType: 'none', authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' } });
  return { sorguId: await sorguAc('YENI', sec.challenge, { email, kullaniciKimligi: kk }), secenekler: sec };
}
async function yeniHesapDogrula(req, res) {
  const s = await sorguTuket(req.body?.sorguId, 'YENI');
  const k = await kayitDogrula(s, req.body?.yanit);
  await taslakAc(res, { saglayici: 'passkey', email: s.email, emailDogrulandi: false, passkey: { ...k, kullaniciKimligi: s.kullanici_kimligi, ad: 'İlk anahtar' } });
  return { tamam: true, sonraki: 'profil' };
}
// Giriş (kullanıcı adı sormadan: cihazdaki anahtar seçilir)
async function girisSecenek() {
  const sec = await generateAuthenticationOptions({ rpID: rp().rpID, userVerification: 'preferred' });
  return { sorguId: await sorguAc('GIRIS', sec.challenge), secenekler: sec };
}
async function girisDogrula(req, res) {
  const s = await sorguTuket(req.body?.sorguId, 'GIRIS');
  const yanit = req.body?.yanit;
  const k = typeof yanit?.id === 'string' ? await db.get(`SELECT * FROM passkeyler WHERE id = ?`, yanit.id) : null;
  if (!k) throw new OyunHatasi(401, 'Bu anahtar tanınmıyor; önce hesabına ekle ya da e-postayla giriş yap');
  const { rpID, origin } = rp();
  let v;
  try {
    v = await verifyAuthenticationResponse({ response: yanit, expectedChallenge: s.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false,
      credential: { id: k.id, publicKey: new Uint8Array(k.acik_anahtar), counter: k.sayac, transports: JSON.parse(k.tasima || '[]') } });
  } catch { throw new OyunHatasi(401, 'Anahtar doğrulanamadı'); }
  if (!v.verified) throw new OyunHatasi(401, 'Anahtar doğrulanamadı');
  await db.run(`UPDATE passkeyler SET sayac = ?, son_kullanim = ? WHERE id = ?`, v.authenticationInfo.newCounter, simdi(), k.id);
  await girisYap(req, res, await kullanici(k.user_id), 'PASSKEY');
  return { tamam: true };
}
async function passkeyListe(req) {
  return (await db.all(`SELECT id, ad, created_at, son_kullanim FROM passkeyler WHERE user_id = ? ORDER BY created_at`, req.kullanici.id))
    .map((p) => ({ id: p.id.slice(0, 12), ad: p.ad, eklendi: p.created_at, sonKullanim: p.son_kullanim }));
}
async function passkeySil(req) {
  const kisa = String(req.params.id || '');
  if (!/^[A-Za-z0-9_-]{6,12}$/.test(kisa)) throw new OyunHatasi(400, 'Geçersiz anahtar');
  return db.tx(async () => {
    // Eşzamanlı iki silme son giriş yolunu birlikte kaldıramasın
    await db.kilit(`passkey:${req.kullanici.id}`);
    const u = await kullanici(req.kullanici.id);
    const k = await db.get(`SELECT id FROM passkeyler WHERE user_id = ? AND substr(id, 1, 12) = ?`, u.id, kisa);
    if (!k) throw new OyunHatasi(404, 'Anahtar bulunamadı');
    // Son giriş yolu silinmesin (parolasız, bağlı hesapsız tek anahtar)
    const digerYol = !!u.password_hash || !!(await db.get(`SELECT 1 FROM kimlik_baglantilari WHERE user_id = ?`, u.id))
      || (await db.get(`SELECT COUNT(*) c FROM passkeyler WHERE user_id = ?`, u.id)).c > 1;
    if (!digerYol) throw new OyunHatasi(409, 'Bu senin tek giriş yolun; önce parola belirle ya da başka bir anahtar ekle');
    await db.run(`DELETE FROM passkeyler WHERE id = ?`, k.id);
    await L.denetim({ aktor: u.id, eylem: 'PASSKEY_REMOVED', herkese: false });
    return { tamam: true };
  });
}

// ---------- Telefon doğrulama
const telOzet = (e164) => ozet(`st-tel:${e164}`);
function telefonNormalize(v) {
  const r = String(v ?? '').replace(/[\s()-]/g, '');
  const m = /^(?:\+?90|0)?(5\d{9})$/.exec(r);
  if (!m) throw new OyunHatasi(400, 'Geçerli bir cep telefonu numarası gir (5xx xxx xx xx)');
  return `+90${m[1]}`;
}
const maskele = (e164) => `${e164.slice(0, 6)} *** ** ${e164.slice(-2)}`;
async function telefonKod(req) {
  if (!sms.etkin()) throw new OyunHatasi(503, 'Telefon doğrulama şu an kapalı');
  const userId = req.kullanici.id, t = simdi();
  const tel = telefonNormalize(req.body?.telefon), oz = telOzet(tel);
  const sahibi = await db.get(`SELECT id FROM users WHERE telefon_ozet = ?`, oz);
  if (sahibi && sahibi.id !== userId) throw new OyunHatasi(409, 'Bu numara başka bir hesapta kayıtlı');
  if (sahibi?.id === userId) return { tamam: true, zatenDogrulandi: true };
  const kod = String(crypto.randomInt(100000, 1000000)), tuz = rastgele(12);
  await db.tx(async () => {
    // Oyuncu ve numara başına sıra: eşzamanlı istekler dakika ve gün sınırlarını aşamasın
    await db.kilit(`telefon-kod:U:${userId}`, `telefon-kod:T:${oz}`);
    const son = await db.get(`SELECT created_at FROM telefon_kodlari WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`, userId);
    if (son && t - son.created_at < 60_000) throw new OyunHatasi(429, 'Yeni kod için bir dakika bekle');
    if ((await db.get(`SELECT COUNT(*) c FROM telefon_kodlari WHERE user_id = ? AND created_at > ?`, userId, t - 864e5)).c >= 5
      || (await db.get(`SELECT COUNT(*) c FROM telefon_kodlari WHERE telefon_ozet = ? AND created_at > ?`, oz, t - 864e5)).c >= 5) {
      throw new OyunHatasi(429, 'Bugün çok fazla kod istendi; yarın tekrar dene');
    }
    await db.run(`UPDATE telefon_kodlari SET expires_at = ? WHERE user_id = ? AND expires_at > ?`, t - 1, userId, t);   // önceki kodlar geçersiz
    await db.run(`INSERT INTO telefon_kodlari (user_id, telefon_ozet, telefon_sifreli, kod_ozet, tuz, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      userId, oz, sifrele(tel), ozet(`${tuz}:${kod}`), tuz, t, t + 5 * 60_000);
  });
  // SMS işlem dışında gönderilir
  try { await sms.gonder(tel, `Sanal Türkiye doğrulama kodun: ${kod}. 5 dakika geçerli; kimseyle paylaşma.`); }
  catch (e) { if (!env.SESSIZ) console.warn('SMS gönderilemedi:', e.message); throw new OyunHatasi(502, 'SMS gönderilemedi; biraz sonra tekrar dene'); }
  return { tamam: true, telefon: maskele(tel), ...(sms.gelistirmeMi() ? { gelistirmeKodu: kod } : {}) };
}
async function telefonDogrula(req) {
  const userId = req.kullanici.id, t = simdi();
  const r = await db.get(`SELECT * FROM telefon_kodlari WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1`, userId, t);
  if (!r) throw new OyunHatasi(400, 'Kodun süresi doldu; yeni kod iste');
  const kod = metin(req.body?.kod).replace(/\s/g, '');
  const dogru = /^\d{6}$/.test(kod) && crypto.timingSafeEqual(Buffer.from(ozet(`${r.tuz}:${kod}`)), Buffer.from(r.kod_ozet));
  if (!dogru) {
    const d = (await db.get(`UPDATE telefon_kodlari SET deneme = deneme + 1 WHERE id = ? RETURNING deneme`, r.id))?.deneme ?? 5;
    if (d >= 5) await db.run(`UPDATE telefon_kodlari SET expires_at = ? WHERE id = ?`, t - 1, r.id);
    throw new OyunHatasi(400, d >= 5 ? 'Çok fazla hatalı deneme; yeni kod iste' : `Kod hatalı (${5 - d} hakkın kaldı)`);
  }
  try {
    await db.tx(async () => {
      await db.run(`UPDATE users SET telefon_sifreli = ?, telefon_ozet = ?, telefon_dogrulandi_at = datetime('now') WHERE id = ?`, r.telefon_sifreli, r.telefon_ozet, userId);
      await db.run(`DELETE FROM telefon_kodlari WHERE user_id = ?`, userId);
      // Silinmiş bir hesabın numarası: bundan sonraki başlangıç hediyeleri ve sihirbaz ödülleri verilmez
      if (await auth.silinenKimlikMi({ telefonOzet: r.telefon_ozet })) await auth.tekrarIsaretle(userId);
    });
  } catch (e) {
    // Benzersizlik ihlali: SQLite "UNIQUE constraint failed", Postgres 23505 "violates unique constraint" (işlem geri alındı)
    if (e.code === '23505' || /UNIQUE/i.test(e.message)) throw new OyunHatasi(409, 'Bu numara başka bir hesapta kayıtlı');
    throw e;
  }
  await L.denetim({ aktor: userId, eylem: 'PHONE_VERIFIED', herkese: false });
  return { tamam: true, telefon: maskele(coz(r.telefon_sifreli)) };
}

// ---------- Hesap bilgisi ve temizlik
async function girisYollari(userId) {
  const u = await kullanici(userId);
  return {
    parola: !!u.password_hash,
    bagli: await db.all(`SELECT saglayici, email, created_at FROM kimlik_baglantilari WHERE user_id = ?`, userId),
    passkey: (await db.get(`SELECT COUNT(*) c FROM passkeyler WHERE user_id = ?`, userId)).c,
    telefon: u.telefon_dogrulandi_at ? { numara: maskele(coz(u.telefon_sifreli)), dogrulandi: u.telefon_dogrulandi_at } : null,
    acik: acikYollar(),
  };
}
const acikYollar = () => ({ google: SAGLAYICI.google.etkin(), apple: SAGLAYICI.apple.etkin(), passkey: true, telefon: sms.etkin() });
// Önceden ele geçirmeye karşı: doğrulanmamış hesabın e-postasının sahibi kanıtlanınca (Google/Apple, parola sıfırlama)
// başkasının eklemiş olabileceği tüm giriş yolları ve oturumlar kaldırılır
// Çağıranın işlemi içinde çalışır (birlikte geri alınır)
async function epostaSahibiDevralir(userId) {
  await db.run(`DELETE FROM kimlik_baglantilari WHERE user_id = ?`, userId);
  await db.run(`DELETE FROM passkeyler WHERE user_id = ?`, userId);
  await db.run(`UPDATE users SET password_hash = NULL, totp_aktif = 0, totp_sir = NULL, kurtarma_kodlari = NULL WHERE id = ?`, userId);
  await db.run(`DELETE FROM sessions WHERE user_id = ?`, userId);
}
async function hesapSilindi(userId) {
  await db.run(`DELETE FROM kimlik_baglantilari WHERE user_id = ?`, userId);
  await db.run(`DELETE FROM passkeyler WHERE user_id = ?`, userId);
  await db.run(`DELETE FROM telefon_kodlari WHERE user_id = ?`, userId);
  await db.run(`UPDATE users SET webauthn_kimlik = NULL, telefon_sifreli = NULL, telefon_ozet = NULL, telefon_dogrulandi_at = NULL WHERE id = ?`, userId);
}

async function rotalar(app, { h }) {
  const hAsync = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (e) { next(e); } };
  app.get('/api/giris/yollar', h(() => acikYollar()));
  app.get('/api/oyuncu-adi/uygun', h((req) => auth.adUygun(metin(req.query.ad))));
  app.get('/api/kayit/taslak', h((req) => taslakBilgisi(req)));
  app.post('/api/kayit/tamamla', hAsync(kayitTamamla));
  app.get('/api/oauth/:saglayici/basla', hAsync(oauthBasla));
  app.get('/api/oauth/:saglayici/donus', hAsync(oauthDonus));
  app.post('/api/oauth/:saglayici/donus', require('express').urlencoded({ extended: false, limit: '20kb' }), hAsync(oauthDonus));
  app.post('/api/passkey/giris/secenekler', h(() => girisSecenek()));
  app.post('/api/passkey/giris/dogrula', h((req, res) => girisDogrula(req, res)));
  app.post('/api/passkey/yeni/secenekler', h((req) => yeniHesapSecenek(req)));
  app.post('/api/passkey/yeni/dogrula', h((req, res) => yeniHesapDogrula(req, res)));
  app.post('/api/passkey/ekle/secenekler', auth.girisGerekli, auth.tazeOturumGerekli, h((req) => passkeyEkleSecenek(req)));
  app.post('/api/passkey/ekle/dogrula', auth.girisGerekli, auth.tazeOturumGerekli, h((req) => passkeyEkle(req)));
  app.get('/api/passkey', auth.girisGerekli, h((req) => passkeyListe(req)));
  app.post('/api/passkey/:id/sil', auth.girisGerekli, h((req) => passkeySil(req)));
  app.post('/api/telefon/kod', auth.girisGerekli, h((req) => telefonKod(req)));
  app.post('/api/telefon/dogrula', auth.girisGerekli, h((req) => telefonDogrula(req)));
  app.get('/api/hesap/giris-yollari', auth.girisGerekli, h((req) => girisYollari(req.kullanici.id)));
  app.post('/api/hesap/avatar', auth.girisGerekli, h(async (req) => {
    const a = req.body?.avatar;
    if (typeof a !== 'string' || !auth.AVATAR_RE.test(a)) throw new OyunHatasi(400, 'Geçersiz avatar');
    await db.run(`UPDATE users SET avatar = ? WHERE id = ?`, a, req.kullanici.id);
    return { tamam: true, avatar: a };
  }));
  if (!uretim()) app.get('/api/gelistirici/sms', h(() => sms.gelistirmeKutusu()));
}

module.exports = { rotalar, ayar, SAGLAYICI, girisYollari, acikYollar, hesapSilindi, epostaSahibiDevralir, telefonNormalize, jetonDogrula };
