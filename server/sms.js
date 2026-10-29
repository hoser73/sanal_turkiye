// SMS gönderimi (telefon doğrulama kodu). SMS_SAGLAYICI=netgsm ise Netgsm REST v2; tanımlı değilse geliştirmede ileti
// gönderilmez, giden_smsler tablosuna yazılır (üretimde sağlayıcı yoksa telefon doğrulama kapalıdır).
// Netgsm: NETGSM_KULLANICI, NETGSM_SIFRE, NETGSM_BASLIK (onaylı gönderici adı). İstek biçimi Netgsm REST v2'ye göredir
// (api.netgsm.com.tr/sms/rest/v2/send, Basic kimlik, msgheader + messages[{msg, no}], başarı kodu "00");
// canlıya almadan önce Netgsm'in güncel belgesiyle doğrulanmalıdır.
const db = require('./db');


const saglayici = () => process.env.SMS_SAGLAYICI || '';
const uretim = () => process.env.NODE_ENV === 'production';
// Telefon doğrulama sunulabilir mi: gerçek sağlayıcı ya da geliştirme kutusu
const etkin = () => saglayici() === 'netgsm' || !uretim();
const gelistirmeMi = () => saglayici() !== 'netgsm' && !uretim();
const ayar = { fetch: (...a) => fetch(...a) };

async function gonder(telefon, metin) {
  if (saglayici() === 'netgsm') {
    const { NETGSM_KULLANICI: k, NETGSM_SIFRE: s, NETGSM_BASLIK: b } = process.env;
    if (!k || !s || !b) throw new Error('Netgsm ayarları eksik (NETGSM_KULLANICI, NETGSM_SIFRE, NETGSM_BASLIK)');
    const r = await ayar.fetch('https://api.netgsm.com.tr/sms/rest/v2/send', {
      method: 'POST', signal: AbortSignal.timeout(15_000),
      headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`${k}:${s}`).toString('base64')}` },
      body: JSON.stringify({ msgheader: b, encoding: 'TR', iysfilter: '0', messages: [{ msg: metin, no: telefon.replace(/^\+/, '') }] }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || String(j.code) !== '00') throw new Error(`Netgsm yanıtı: ${r.status} ${j.code ?? ''} ${j.description ?? ''}`.trim());
    return { gonderildi: true };
  }
  if (uretim()) throw new Error('SMS sağlayıcısı tanımlı değil');
  db.prepare(`INSERT INTO giden_smsler (telefon, metin) VALUES (?, ?)`).run(telefon, metin);
  return { gonderildi: false, gelistirme: true };
}
const gelistirmeKutusu = () => db.prepare(`SELECT telefon, metin, created_at FROM giden_smsler ORDER BY id DESC LIMIT 30`).all();

module.exports = { gonder, etkin, gelistirmeMi, gelistirmeKutusu, ayar };
