// Gerçek SMTP yolu: yerel SMTP sunucusuna doğrulama e-postası (düz metin + HTML), hata durumunda kuyruk ve yeniden deneme,
// üretim yapılandırma denetimi.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { SMTPServer } = require('smtp-server');
const { ortamKur } = require('./yardimci');

const VERI = ortamKur('posta');
process.env.OTOMATIK_DOGRULA = '0';
process.env.TABAN_URL = 'https://sanalturkiye.example';
process.env.POSTA_GONDEREN = 'Sanal Türkiye <bildirim@sanalturkiye.example>';
const app = require('../server/index');
const db = require('../server/db');
const posta = require('../server/posta');

const gelenler = [];
let smtp, smtpPort, sunucu, taban;
function smtpBaslat(port = 0) {
  return new Promise((coz) => {
    smtp = new SMTPServer({ authOptional: true, disabledCommands: ['STARTTLS'], logger: false,
      onData(akis, oturum, bitti) { let ham = ''; akis.on('data', (d) => { ham += d; }); akis.on('end', () => { gelenler.push({ ham, alici: oturum.envelope.rcptTo.map((r) => r.address) }); bitti(); }); } });
    smtp.listen(port, '127.0.0.1', () => { smtpPort = smtp.server.address().port; process.env.SMTP_URL = `smtp://127.0.0.1:${smtpPort}`; coz(); });
  });
}
before(async () => {
  await smtpBaslat();
  await new Promise((r) => { sunucu = app.listen(0, r); });
  taban = `http://127.0.0.1:${sunucu.address().port}`;
  await app.hazir;
});
after(() => { sunucu.close(); smtp.close(); fs.rmSync(VERI, { recursive: true, force: true }); });

test('kayıtta doğrulama e-postası SMTP ile gider: düz metin + HTML, doğru gönderen ve bağlantı', async () => {
  const r = await fetch(`${taban}/api/kayit`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'smtp@test.local', sifre: 'parola123', ad: 'Smtpci', dogumYili: 1990, kosullarOnay: true, kvkkOnay: true }) });
  assert.equal(r.status, 201);
  for (let i = 0; i < 40 && !gelenler.length; i++) await new Promise((x) => setTimeout(x, 50));
  assert.equal(gelenler.length, 1);
  const { ham, alici } = gelenler[0];
  assert.deepEqual(alici, ['smtp@test.local']);
  assert.match(ham, /From: =\?UTF-8\?Q\?Sanal_T=C3=BCrkiye\?= <bildirim@sanalturkiye\.example>|From: Sanal T.*<bildirim@sanalturkiye\.example>/);
  assert.match(ham, /Content-Type: text\/plain/);
  assert.match(ham, /Content-Type: text\/html/);
  assert.match(ham.replace(/=\r?\n/g, ''), /https:\/\/sanalturkiye\.example\/\?dogrula=/);
  assert.equal((await db.get(`SELECT durum FROM giden_postalar ORDER BY id DESC LIMIT 1`)).durum, 'GONDERILDI');
});

test('SMTP kapalıyken ileti kuyrukta kalır, sunucu dönünce yeniden denenir', async () => {
  await new Promise((r) => smtp.close(r));
  const g = await posta.gonder('kuyruk@test.local', 'Deneme', 'metin', { baslik: 'Deneme', paragraflar: ['merhaba'] });
  assert.equal(g.gonderildi, false);
  let m = await db.get(`SELECT * FROM giden_postalar WHERE id = ?`, g.id);
  assert.equal(m.durum, 'BEKLIYOR');
  assert.equal(m.deneme, 1);
  assert.ok(m.hata && m.sonraki > Date.now());
  await smtpBaslat(smtpPort);
  assert.equal(await posta.postaBakim(), 0, 'vakti gelmeden denenmez');
  await db.run(`UPDATE giden_postalar SET sonraki = ? WHERE id = ?`, Date.now() - 1, g.id);
  assert.equal(await posta.postaBakim(), 1);
  m = await db.get(`SELECT * FROM giden_postalar WHERE id = ?`, g.id);
  assert.equal(m.durum, 'GONDERILDI');
  assert.ok(gelenler.some((x) => x.alici.includes('kuyruk@test.local')));
});

test('HTML şablon kullanıcı metnini kaçırır', () => {
  const h = posta.htmlSablon({ baslik: '<b>x</b>', paragraflar: ['<script>alert(1)</script>'], dugme: { metin: 'Aç', url: 'https://a.example/?x="y"' } });
  assert.ok(!h.includes('<script>alert'));
  assert.ok(h.includes('&lt;script&gt;'));
  assert.ok(h.includes('&quot;y&quot;'));
});

test('üretim denetimi: eksik/güvensiz ayarlar hata, isteğe bağlılar uyarı', () => {
  const { uretimDenetimi } = require('../server/yapilandirma');
  const kotu = uretimDenetimi({ NODE_ENV: 'production', TABAN_URL: 'http://x', OTOMATIK_DOGRULA: '1' });
  assert.ok(kotu.hatalar.some((h) => h.includes('TABAN_URL')));
  assert.ok(kotu.hatalar.some((h) => h.includes('SIFRELEME_ANAHTARI')));
  assert.ok(kotu.hatalar.some((h) => h.includes('SMTP_URL')));
  assert.ok(kotu.hatalar.some((h) => h.includes('OTOMATIK_DOGRULA')));
  const iyi = uretimDenetimi({ NODE_ENV: 'production', TABAN_URL: 'https://sanalturkiye.example', SIFRELEME_ANAHTARI: 'a'.repeat(64), SMTP_URL: 'smtps://u:p@smtp.example:465' });
  assert.deepEqual(iyi.hatalar, []);
  assert.ok(iyi.uyarilar.length > 0);
  assert.deepEqual(uretimDenetimi({ NODE_ENV: 'development' }).hatalar, []);
});
