// Giriş ve kayıt yolları: benzersiz oyuncu adı; Google ve Apple (OIDC) — sahte sağlayıcı kendi RSA anahtarıyla imzalar,
// state/nonce/tarayıcı bağı ve imza denetimi sınanır; passkey — yazılımsal kimlik doğrulayıcı (P-256, CBOR) ile kayıt ve giriş;
// telefon doğrulama (geliştirme SMS'i), tekillik ve deneme sınırı; TELEFON_ZORUNLU.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const { ortamKur } = require('./yardimci');

const VERI = ortamKur('giris');
process.env.GOOGLE_CLIENT_ID = 'test-istemci.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-sir';
const appleAnahtar = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
Object.assign(process.env, { APPLE_CLIENT_ID: 'tr.sanalturkiye.web', APPLE_TEAM_ID: 'TAKIM12345', APPLE_KEY_ID: 'ANAHTAR123',
  APPLE_PRIVATE_KEY: appleAnahtar.privateKey.export({ type: 'pkcs8', format: 'pem' }) });
const app = require('../server/index');
const db = require('../server/db');
const yollar = require('../server/giris-yollari');

let sunucu, taban;
before(async () => {
  await new Promise((r) => { sunucu = app.listen(0, r); });
  taban = `http://127.0.0.1:${sunucu.address().port}`;
  process.env.TABAN_URL = `http://localhost:${sunucu.address().port}`;   // passkey kaynağı (rpID localhost)
  await app.hazir;
});
after(() => { sunucu.close(); fs.rmSync(VERI, { recursive: true, force: true }); });

// Çerez kavanozlu istemci (birden çok çerez, yönlendirme izlenmez)
function istemci() {
  const kavanoz = new Map();
  const c = async (yol, govde, { method, form } = {}) => {
    const r = await fetch(taban + yol, {
      method: method || (govde ? 'POST' : 'GET'), redirect: 'manual',
      headers: { 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json', cookie: [...kavanoz].map(([k, v]) => `${k}=${v}`).join('; ') },
      body: govde ? (form ? new URLSearchParams(govde) : JSON.stringify(govde)) : undefined,
    });
    for (const sc of r.headers.getSetCookie()) { const [kv] = sc.split(';'); const [k, ...v] = kv.split('='); if (v.join('=')) kavanoz.set(k, v.join('=')); else kavanoz.delete(k); if (/Expires=Thu, 01 Jan 1970/i.test(sc)) kavanoz.delete(k); }
    return { durum: r.status, yer: r.headers.get('location'), veri: (r.headers.get('content-type') || '').includes('json') ? await r.json() : null };
  };
  c.kavanoz = kavanoz;
  return c;
}
const profil = (ad, ek = {}) => ({ ad, dogumYili: 1990, avatar: 't1-s2-p0-g3', kosullarOnay: true, kvkkOnay: true, ...ek });

// ---------- Sahte OIDC sağlayıcı
const saglayiciAnahtar = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const yabanciAnahtar = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'test-kid-1';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jetonImzala(claims, anahtar = saglayiciAnahtar.privateKey) {
  const govde = `${b64({ alg: 'RS256', kid: KID, typ: 'JWT' })}.${b64(claims)}`;
  return `${govde}.${crypto.sign('RSA-SHA256', Buffer.from(govde), anahtar).toString('base64url')}`;
}
let siradakiClaims = null, siradakiAnahtar = null, sonJetonIstegi = null;
const gercekFetch = yollar.ayar.fetch;
yollar.ayar.fetch = async (url, opts) => {
  if (/oauth2\/v3\/certs|auth\/keys/.test(url)) return new Response(JSON.stringify({ keys: [{ ...saglayiciAnahtar.publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' }] }), { headers: { 'content-type': 'application/json' } });
  if (/oauth2\.googleapis\.com\/token|appleid\.apple\.com\/auth\/token/.test(url)) {
    sonJetonIstegi = Object.fromEntries(new URLSearchParams(String(opts.body)));
    return new Response(JSON.stringify({ id_token: jetonImzala(siradakiClaims, siradakiAnahtar || undefined) }), { headers: { 'content-type': 'application/json' } });
  }
  return gercekFetch(url, opts);
};
// basla → sağlayıcı adresi (state, nonce) → dönüş
async function oauthAkis(c, saglayici, claims, { anahtar, nonceBoz, mod } = {}) {
  const b = await c(`/api/oauth/${saglayici}/basla${mod ? `?mod=${mod}` : ''}`);
  assert.equal(b.durum, 302);
  const u = new URL(b.yer);
  const state = u.searchParams.get('state'), nonce = u.searchParams.get('nonce');
  siradakiClaims = { iss: saglayici === 'google' ? 'https://accounts.google.com' : 'https://appleid.apple.com',
    aud: saglayici === 'google' ? process.env.GOOGLE_CLIENT_ID : process.env.APPLE_CLIENT_ID,
    exp: Math.floor(Date.now() / 1000) + 600, iat: Math.floor(Date.now() / 1000), nonce: nonceBoz ? 'baska' : nonce, ...claims };
  siradakiAnahtar = anahtar || null;
  const d = saglayici === 'apple'
    ? await c(`/api/oauth/apple/donus`, { code: 'kod-123', state, user: JSON.stringify({ name: { firstName: 'Elif', lastName: 'Kaya' } }) }, { form: true })
    : await c(`/api/oauth/google/donus?code=kod-123&state=${encodeURIComponent(state)}`);
  return { basla: u, donus: d };
}

test('oyuncu adı benzersiz (Türkçe büyük/küçük harf duyarsız); anlık uygunluk denetimi', async () => {
  const a = istemci();
  assert.equal((await a('/api/kayit', { email: 'ilker@test.local', sifre: 'parola123', ...profil('İlker Çiftçi') })).durum, 201);
  const b = istemci();
  const r = await b('/api/kayit', { email: 'baska@test.local', sifre: 'parola123', ...profil('ilker  çiftçi') });
  assert.equal(r.durum, 409); assert.equal(r.veri.kod, 'AD_ALINMIS');
  assert.deepEqual((await b('/api/oyuncu-adi/uygun?ad=İLKER%20ÇİFTÇİ')).veri, { uygun: false, sebep: 'Bu oyuncu adı alınmış' });
  assert.equal((await b('/api/oyuncu-adi/uygun?ad=Yeni%20Çiftçi')).veri.uygun, true);
  assert.equal((await b('/api/oyuncu-adi/uygun?ad=12')).veri.uygun, false, 'harf içermeli');
  assert.equal((await b('/api/kayit', { email: 'av@test.local', sifre: 'parola123', ...profil('Avatarlı', { avatar: '<x>' }) })).durum, 400);
  assert.deepEqual((await b('/api/giris/yollar')).veri, { google: true, apple: true, passkey: true, telefon: true });
});

test('Google: yeni oyuncu taslakla profil tamamlar; sonraki girişte doğrudan oturum; PKCE gönderilir', async () => {
  const c = istemci();
  const { basla, donus } = await oauthAkis(c, 'google', { sub: 'g-100', email: 'Zeynep@Gmail.com', email_verified: true, name: 'Zeynep Ak' });
  assert.equal(basla.origin, 'https://accounts.google.com');
  assert.equal(basla.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(sonJetonIstegi.code_verifier, 'PKCE doğrulayıcısı jeton isteğinde');
  assert.equal(donus.yer, '/?kayit=tamamla');
  const t = (await c('/api/kayit/taslak')).veri;
  assert.deepEqual(t, { saglayici: 'google', email: 'zeynep@gmail.com', emailDogrulandi: true, adOneri: 'Zeynep Ak' });
  const r = await c('/api/kayit/tamamla', profil('Zeynep Ak'));
  assert.equal(r.durum, 201, JSON.stringify(r.veri));
  const ben = (await c('/api/ben')).veri;
  assert.equal(ben.kullanici.ad, 'Zeynep Ak'); assert.equal(ben.hesap.dogrulandi, true); assert.equal(ben.hesap.avatar, 't1-s2-p0-g3'); assert.equal(ben.hesap.parolaVar, false);
  assert.equal((await c('/api/kayit/taslak')).durum, 404, 'taslak tek kullanımlık');
  // Parolasız hesap e-posta+parola ile girilemez
  assert.equal((await istemci()('/api/giris', { email: 'zeynep@gmail.com', sifre: 'herhangi1' })).durum, 401);
  // Yeni tarayıcıdan tekrar Google → doğrudan oturum
  const c2 = istemci();
  assert.equal((await oauthAkis(c2, 'google', { sub: 'g-100', email: 'zeynep@gmail.com', email_verified: true })).donus.yer, '/?giris=tamam');
  assert.equal((await c2('/api/ben')).veri.kullanici.ad, 'Zeynep Ak');
});

test('Google: sahte imza, yanlış nonce, tarayıcı bağı yok, yeniden kullanılan state reddedilir; doğrulanmış e-posta mevcut hesaba bağlanır', async () => {
  for (const ek of [{ anahtar: yabanciAnahtar.privateKey }, { nonceBoz: true }]) {
    const c = istemci();
    assert.equal((await oauthAkis(c, 'google', { sub: 'g-200', email: 'k@test.local', email_verified: true }, ek)).donus.yer, '/?giris_hata=dogrulama');
    assert.equal((await c('/api/ben')).veri?.kullanici, undefined);
  }
  // Başka tarayıcıya gönderilen dönüş bağlantısı (giriş CSRF'i)
  const saldirgan = istemci(), kurban = istemci();
  const b = await saldirgan('/api/oauth/google/basla');
  const state = new URL(b.yer).searchParams.get('state');
  assert.equal((await kurban(`/api/oauth/google/donus?code=x&state=${encodeURIComponent(state)}`)).yer, '/?giris_hata=oturum');
  assert.equal((await saldirgan(`/api/oauth/google/donus?code=x&state=${encodeURIComponent(state)}`)).yer, '/?giris_hata=oturum', 'state tek kullanımlık');
  assert.equal((await istemci()('/api/oauth/github/basla')).durum, 404);
  // Mevcut e-posta hesabı: doğrulanmış Google e-postasıyla otomatik bağlanır
  const e = istemci();
  await e('/api/kayit', { email: 'mevcut@test.local', sifre: 'parola123', ...profil('Mevcut Oyuncu') });
  const g = istemci();
  assert.equal((await oauthAkis(g, 'google', { sub: 'g-300', email: 'mevcut@test.local', email_verified: true })).donus.yer, '/?giris=tamam');
  assert.equal((await g('/api/ben')).veri.kullanici.ad, 'Mevcut Oyuncu');
  // Doğrulanmamış e-posta bağlanmaz: taslak açılır, ama aynı e-postayla hesap açılamaz
  const g2 = istemci();
  assert.equal((await oauthAkis(g2, 'google', { sub: 'g-301', email: 'mevcut@test.local', email_verified: false })).donus.yer, '/?kayit=tamamla');
  assert.equal((await g2('/api/kayit/tamamla', profil('Sahte Mevcut'))).durum, 409);
});

test('Apple: form_post dönüşü, ES256 istemci sırrı, ilk girişte gelen ad önerisi', async () => {
  const c = istemci();
  const { basla, donus } = await oauthAkis(c, 'apple', { sub: 'a-1', email: 'gizli@privaterelay.appleid.com', email_verified: 'true' });
  assert.equal(basla.searchParams.get('response_mode'), 'form_post');
  assert.equal(donus.durum, 303); assert.equal(donus.yer, '/?kayit=tamamla');
  // İstemci sırrı Apple anahtarıyla imzalı JWT
  const [h, p, s] = sonJetonIstegi.client_secret.split('.');
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: appleAnahtar.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
  assert.equal(JSON.parse(Buffer.from(p, 'base64url')).sub, process.env.APPLE_CLIENT_ID);
  assert.equal((await c('/api/kayit/taslak')).veri.adOneri, 'Elif Kaya');
  assert.equal((await c('/api/kayit/tamamla', profil('Elif Kaya'))).durum, 201);
});

// ---------- Yazılımsal passkey (WebAuthn) doğrulayıcısı
function cbor(v) {
  const bas = (m, n) => (n < 24 ? Buffer.from([(m << 5) | n]) : n < 256 ? Buffer.from([(m << 5) | 24, n]) : Buffer.from([(m << 5) | 25, n >> 8, n & 255]));
  if (Buffer.isBuffer(v)) return Buffer.concat([bas(2, v.length), v]);
  if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([bas(3, b.length), b]); }
  if (typeof v === 'number') return v >= 0 ? bas(0, v) : bas(1, -1 - v);
  if (v instanceof Map) return Buffer.concat([bas(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  return cbor(new Map(Object.entries(v)));
}
const sha = (b) => crypto.createHash('sha256').update(b).digest();
function cihaz() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const kimlik = crypto.randomBytes(16);
  let sayac = 0, kullanici = null;
  const origin = process.env.TABAN_URL, rpId = new URL(origin).hostname;
  return {
    kimlik: kimlik.toString('base64url'),
    olustur(secenek) {
      kullanici = secenek.user.id;
      const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
      const len = Buffer.from([kimlik.length >> 8, kimlik.length & 255]);
      const authData = Buffer.concat([sha(rpId), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), len, kimlik, cose]);
      const cd = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: secenek.challenge, origin, crossOrigin: false }));
      return { id: kimlik.toString('base64url'), rawId: kimlik.toString('base64url'), type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
        response: { clientDataJSON: cd.toString('base64url'), attestationObject: cbor({ fmt: 'none', attStmt: new Map(), authData }).toString('base64url'), transports: ['internal'] } };
    },
    imzala(secenek, { kaynak = origin } = {}) {
      sayac++;
      const authData = Buffer.concat([sha(rpId), Buffer.from([0x05]), Buffer.from([0, 0, sayac >> 8, sayac & 255])]);
      const cd = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: secenek.challenge, origin: kaynak, crossOrigin: false }));
      const imza = crypto.sign('sha256', Buffer.concat([authData, sha(cd)]), privateKey);
      return { id: kimlik.toString('base64url'), rawId: kimlik.toString('base64url'), type: 'public-key', clientExtensionResults: {},
        response: { clientDataJSON: cd.toString('base64url'), authenticatorData: authData.toString('base64url'), signature: imza.toString('base64url'), userHandle: kullanici } };
    },
  };
}

test('passkey: şifresiz yeni hesap, cihazla giriş, sayaç, tekrar kullanılan sorgu ve yanlış kaynak reddi', async () => {
  const c = istemci(), d = cihaz();
  assert.equal((await c('/api/passkey/yeni/secenekler', { email: 'mevcut@test.local' })).durum, 409, 'kayıtlı e-posta');
  const s = (await c('/api/passkey/yeni/secenekler', { email: 'anahtar@test.local' })).veri;
  assert.equal(s.secenekler.authenticatorSelection.residentKey, 'required');
  const r = await c('/api/passkey/yeni/dogrula', { sorguId: s.sorguId, yanit: d.olustur(s.secenekler) });
  assert.equal(r.durum, 200, JSON.stringify(r.veri));
  assert.equal((await c('/api/passkey/yeni/dogrula', { sorguId: s.sorguId, yanit: d.olustur(s.secenekler) })).durum, 400, 'sorgu tek kullanımlık');
  assert.equal((await c('/api/kayit/tamamla', profil('Anahtarlı Oyuncu'))).durum, 201);
  const uid = (await c('/api/ben')).veri.kullanici.id;
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM passkeyler WHERE user_id = ?`).get(uid).c, 1);
  // Yeni tarayıcıdan cihazla giriş
  const g = istemci();
  const gs = (await g('/api/passkey/giris/secenekler', {})).veri;
  const gr = await g('/api/passkey/giris/dogrula', { sorguId: gs.sorguId, yanit: d.imzala(gs.secenekler) });
  assert.equal(gr.durum, 200, JSON.stringify(gr.veri));
  assert.equal((await g('/api/ben')).veri.kullanici.id, uid);
  assert.equal(db.prepare(`SELECT sayac FROM passkeyler WHERE user_id = ?`).get(uid).sayac, 1);
  // Başka siteden gelen imza ve tanınmayan anahtar
  const h = istemci();
  const hs = (await h('/api/passkey/giris/secenekler', {})).veri;
  assert.equal((await h('/api/passkey/giris/dogrula', { sorguId: hs.sorguId, yanit: d.imzala(hs.secenekler, { kaynak: 'https://kotu.example' }) })).durum, 401);
  const ks = (await h('/api/passkey/giris/secenekler', {})).veri;
  assert.equal((await h('/api/passkey/giris/dogrula', { sorguId: ks.sorguId, yanit: cihaz().imzala(ks.secenekler) })).durum, 401);
  assert.equal((await h('/api/ben')).veri?.kullanici, undefined);
  // Tek giriş yolu silinemez; ikinci anahtar eklenince silinir
  const liste = (await g('/api/passkey')).veri;
  assert.equal((await g(`/api/passkey/${liste[0].id}/sil`, {})).durum, 409);
  const d2 = cihaz(), es = (await g('/api/passkey/ekle/secenekler', {})).veri;
  assert.equal(es.secenekler.excludeCredentials.length, 1);
  assert.equal((await g('/api/passkey/ekle/dogrula', { sorguId: es.sorguId, yanit: d2.olustur(es.secenekler), ad: 'Telefonum' })).durum, 200);
  assert.equal((await g(`/api/passkey/${liste[0].id}/sil`, {})).durum, 200);
  assert.equal((await g('/api/hesap/giris-yollari')).veri.passkey, 1);
});

test('telefon: geliştirme kodu, hatalı deneme sınırı, numara tekilliği, biçimler; TELEFON_ZORUNLU', async () => {
  const a = istemci(), b = istemci();
  await a('/api/kayit', { email: 'tel1@test.local', sifre: 'parola123', ...profil('Telefoncu Bir') });
  await b('/api/kayit', { email: 'tel2@test.local', sifre: 'parola123', ...profil('Telefoncu İki') });
  assert.equal((await a('/api/telefon/kod', { telefon: '0212 555 11 22' })).durum, 400, 'sabit hat değil cep');
  const k = (await a('/api/telefon/kod', { telefon: '0 (532) 111 22 33' })).veri;
  assert.equal(k.telefon, '+90532 *** ** 33');
  assert.match(k.gelistirmeKodu, /^\d{6}$/);
  assert.equal((await a('/api/telefon/kod', { telefon: '05321112233' })).durum, 429, 'dakikada bir kod');
  const yanlis = k.gelistirmeKodu === '000000' ? '111111' : '000000';
  for (let i = 0; i < 4; i++) assert.equal((await a('/api/telefon/dogrula', { kod: yanlis })).durum, 400);
  assert.equal((await a('/api/telefon/dogrula', { kod: k.gelistirmeKodu })).durum, 200);
  const yol = (await a('/api/hesap/giris-yollari')).veri;
  assert.equal(yol.telefon.numara, '+90532 *** ** 33');
  assert.equal((await a('/api/ben')).veri.hesap.telefonDogrulandi, true);
  assert.ok(!db.prepare(`SELECT telefon_sifreli FROM users WHERE email = 'tel1@test.local'`).get().telefon_sifreli.includes('532'), 'numara şifreli saklanır');
  assert.equal((await b('/api/telefon/kod', { telefon: '+905321112233' })).durum, 409, 'başka hesapta kayıtlı');
  // Beş hatalı denemede kod geçersizleşir
  db.prepare(`UPDATE telefon_kodlari SET created_at = created_at - 120000`).run();
  const k2 = (await b('/api/telefon/kod', { telefon: '5441234567' })).veri;
  const y2 = k2.gelistirmeKodu === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) await b('/api/telefon/dogrula', { kod: y2 });
  assert.equal((await b('/api/telefon/dogrula', { kod: k2.gelistirmeKodu })).durum, 400, 'kilitlendi');
  // TELEFON_ZORUNLU: değer aktaran işlem telefon ister
  process.env.TELEFON_ZORUNLU = '1';
  db.prepare('UPDATE users SET tp = 240').run();   // çarşı 4. seviyede açılır
  try {
    assert.equal((await b('/api/banka/vadeli', { tutar: 100 })).veri.kod, 'TELEFON_GEREKLI');
    assert.equal((await a('/api/banka/vadeli', { tutar: 100 })).durum, 200);
  } finally { delete process.env.TELEFON_ZORUNLU; }
  assert.ok(yollar.telefonNormalize('905051112233') === '+905051112233');
});

test('önceden ele geçirme: doğrulanmamış hesabı e-postanın gerçek sahibi Google ile devralır; saldırganın parolası ve anahtarı geçersiz', async () => {
  process.env.OTOMATIK_DOGRULA = '0';
  try {
    const saldirgan = istemci(), d = cihaz();
    assert.equal((await saldirgan('/api/kayit', { email: 'kurban@test.local', sifre: 'saldirgan1', ...profil('Erken Gelen') })).durum, 201);
    const es = (await saldirgan('/api/passkey/ekle/secenekler', {})).veri;
    assert.equal((await saldirgan('/api/passkey/ekle/dogrula', { sorguId: es.sorguId, yanit: d.olustur(es.secenekler) })).durum, 200);
    // Gerçek sahip Google ile gelir (e-postayı Google doğrulamış)
    const sahip = istemci();
    assert.equal((await oauthAkis(sahip, 'google', { sub: 'g-kurban', email: 'kurban@test.local', email_verified: true })).donus.yer, '/?giris=tamam');
    assert.equal((await saldirgan('/api/ben')).veri?.kullanici, undefined, 'saldırganın oturumu kapandı');
    assert.equal((await istemci()('/api/giris', { email: 'kurban@test.local', sifre: 'saldirgan1' })).durum, 401, 'parola silindi');
    const h = istemci(), s = (await h('/api/passkey/giris/secenekler', {})).veri;
    assert.equal((await h('/api/passkey/giris/dogrula', { sorguId: s.sorguId, yanit: d.imzala(s.secenekler) })).durum, 401, 'anahtar silindi');
    assert.equal((await sahip('/api/ben')).veri.hesap.dogrulandi, true);
  } finally { process.env.OTOMATIK_DOGRULA = '1'; }
});
