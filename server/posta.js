// E-posta gönderimi. SMTP_URL tanımlıysa gerçek gönderim (nodemailer); değilse geliştirme posta kutusuna yazılır
// (giden_postalar tablosu, /gelistirici/posta.html). Her ileti hem düz metin hem HTML gider. Gönderilemeyen ileti kuyrukta kalır
// ve artan aralıklarla yeniden denenir (1 dk, 5 dk, 30 dk, 2 sa); dördüncü denemeden sonra HATA olarak bırakılır.
const db = require('./db');

function kolonEkle(kolon, tanim) {
  if (!db.prepare(`PRAGMA table_info(giden_postalar)`).all().some((k) => k.name === kolon)) db.exec(`ALTER TABLE giden_postalar ADD COLUMN ${kolon} ${tanim}`);
}
kolonEkle('html', 'TEXT');
kolonEkle('durum', "TEXT NOT NULL DEFAULT 'GELISTIRME'");   // GELISTIRME / BEKLIYOR / GONDERILDI / HATA
kolonEkle('deneme', 'INTEGER NOT NULL DEFAULT 0');
kolonEkle('sonraki', 'INTEGER');
kolonEkle('hata', 'TEXT');

const GONDEREN = () => process.env.POSTA_GONDEREN || 'Sanal Türkiye <bildirim@sanalturkiye.test>';
const BEKLEMELER = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000];
let tasiyici = null, tasiyiciUrl = null;
function smtp() {
  const url = process.env.SMTP_URL;
  if (!url) return null;
  if (!tasiyici || tasiyiciUrl !== url) {
    tasiyici = require('nodemailer').createTransport(url, { connectionTimeout: 15_000, greetingTimeout: 10_000, socketTimeout: 20_000 });
    tasiyiciUrl = url;
  }
  return tasiyici;
}

const kacis = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Basit, e-posta istemcileriyle uyumlu şablon (tablo düzeni, satır içi stiller, koyu düğme)
function htmlSablon({ baslik, paragraflar = [], dugme = null, not = null }) {
  const p = paragraflar.map((x) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#1f2a2e">${kacis(x)}</p>`).join('');
  const d = dugme ? `<p style="margin:22px 0"><a href="${kacis(dugme.url)}" style="background:#0e5e50;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px;display:inline-block">${kacis(dugme.metin)}</a></p>
    <p style="margin:0 0 14px;font-size:12px;color:#66706f">Düğme çalışmazsa bu bağlantıyı tarayıcına yapıştır:<br><a href="${kacis(dugme.url)}" style="color:#0e5e50;word-break:break-all">${kacis(dugme.url)}</a></p>` : '';
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${kacis(baslik)}</title></head>
<body style="margin:0;background:#f6f3ec;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f3ec;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#fffdf8;border:1px solid #e3ddcf;border-radius:16px">
<tr><td style="padding:22px 28px 6px;font-size:13px;letter-spacing:.08em;color:#c8402e;font-weight:700">SANAL TÜRKİYE</td></tr>
<tr><td style="padding:4px 28px 0"><h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:22px;color:#1f2a2e">${kacis(baslik)}</h1>${p}${d}
${not ? `<p style="margin:18px 0 0;font-size:12px;color:#66706f">${kacis(not)}</p>` : ''}</td></tr>
<tr><td style="padding:18px 28px 22px;font-size:11px;color:#8a918f;border-top:1px solid #efe9dc">Bu ileti Sanal Türkiye hesabınla ilgili olduğu için gönderildi. Sanal parseller gerçek tapu değildir; oyun parası (TL) gerçek para değildir, nakde çevrilemez.</td></tr>
</table></td></tr></table></body></html>`;
}

async function teslimEt(id) {
  const m = db.prepare(`SELECT * FROM giden_postalar WHERE id = ?`).get(id);
  const t = smtp();
  if (!m || !t) return false;
  try {
    await t.sendMail({ from: GONDEREN(), to: m.alici, subject: m.konu, text: m.govde, html: m.html || undefined });
    db.prepare(`UPDATE giden_postalar SET durum = 'GONDERILDI', deneme = deneme + 1, hata = NULL, sonraki = NULL WHERE id = ?`).run(id);
    return true;
  } catch (e) {
    const deneme = m.deneme + 1;
    const son = deneme >= BEKLEMELER.length;
    db.prepare(`UPDATE giden_postalar SET durum = ?, deneme = ?, hata = ?, sonraki = ? WHERE id = ?`)
      .run(son ? 'HATA' : 'BEKLIYOR', deneme, String(e.message).slice(0, 300), son ? null : Date.now() + BEKLEMELER[deneme - 1], id);
    require('./lib/gunluk').gunluk.warn('e-posta gönderilemedi', { id, deneme, hataIletisi: e.message });
    return false;
  }
}

// ileti: düz metin; secenek: { baslik, paragraflar, dugme: { metin, url }, not } → HTML sürümü
async function gonder(alici, konu, metin, secenek = null) {
  const html = secenek ? htmlSablon({ baslik: secenek.baslik || konu, ...secenek }) : null;
  const t = smtp();
  const id = db.prepare(`INSERT INTO giden_postalar (alici, konu, govde, html, durum, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`)
    .run(alici, konu, metin, html, t ? 'BEKLIYOR' : 'GELISTIRME').lastInsertRowid;
  if (!t) {
    if (process.env.NODE_ENV === 'production') require('./lib/gunluk').gunluk.error('SMTP_URL tanımlı değil; e-posta gönderilemedi', { id });
    else if (!process.env.SESSIZ) console.log(`✉️  [geliştirme posta kutusu] ${alici} — ${konu}`);
    return { id, gonderildi: false };
  }
  return { id, gonderildi: await teslimEt(id) };
}

// Kuyruk: vakti gelen başarısız iletileri yeniden dener (bakım ara katmanından ve zamanlayıcıdan çağrılır)
let calisiyor = false;
async function postaBakim() {
  if (calisiyor || !smtp()) return 0;
  calisiyor = true;
  let n = 0;
  try {
    for (const m of db.prepare(`SELECT id FROM giden_postalar WHERE durum = 'BEKLIYOR' AND sonraki IS NOT NULL AND sonraki <= ? LIMIT 20`).all(Date.now())) {
      if (await teslimEt(m.id)) n++;
    }
  } finally { calisiyor = false; }
  return n;
}

// Saklama süresi: iletilerde e-posta adresi ve (süresi dolmuş) bağlantılar var; gönderilmiş, vazgeçilmiş ve geliştirme
// iletileri 30 gün sonra silinir. Kuyrukta bekleyenlere dokunulmaz.
function eskiPostalariTemizle(gun = 30) {
  return db.prepare(`DELETE FROM giden_postalar WHERE durum <> 'BEKLIYOR' AND created_at < datetime('now', ?)`).run(`-${gun} days`).changes;
}

function gelistirmeKutusu(limit = 30) {
  return db.prepare(`SELECT id, alici, konu, govde, durum, created_at FROM giden_postalar ORDER BY id DESC LIMIT ?`).all(limit);
}
const kuyrukDurumu = () => Object.fromEntries(db.prepare(`SELECT durum, COUNT(*) c FROM giden_postalar GROUP BY durum`).all().map((r) => [r.durum, r.c]));

module.exports = { gonder, postaBakim, eskiPostalariTemizle, gelistirmeKutusu, kuyrukDurumu, htmlSablon };
