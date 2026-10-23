// Test yardımcıları: geçici veri dizini, sahte karo kaynağı (ağ yok), HTTP istemcisi, imara göre hücre bulma.
const fs = require('fs');
const os = require('os');
const path = require('path');

function ortamKur(ad) {
  const dizin = fs.mkdtempSync(path.join(os.tmpdir(), `st-${ad}-`));
  process.env.VERI_DIZINI = dizin;
  process.env.OYUN_HIZI = '600';        // 1 dk → 100 ms
  process.env.KARO_KAYNAGI = 'sahte';   // imar deseni deterministik, sınırlar gerçek
  process.env.SESSIZ = '1';
  process.env.OTOMATIK_DOGRULA = '1';   // e-posta doğrulaması ayrı testte sınanır
  process.env.YONETICI_2FA_ZORUNLU = '1';
  process.env.KIMLIK_HIZ_CARPANI = '50';
  process.env.HAVA_KAYNAGI = 'sahte';
  process.env.GUNLUK_SESSIZ = '1';      // beklenen hata günlükleri test çıktısını kirletmesin (dosyaya yine yazılır)
  process.env.HATIRLATMA = 'kapali';     // hatırlatma zamanlayıcısı testte elle çağrılır
  process.env.YAPAY_ZEKA = 'kapali';     // testler gerçek API çağırmaz; yz testi sahte yanıt verici takar
  return dizin;
}

function istemciUret(taban) {
  return () => {
    let cerez = '';
    return async (yol, govde) => {
      const r = await fetch(taban() + yol, {
        method: govde ? 'POST' : 'GET',
        headers: { 'content-type': 'application/json', cookie: cerez },
        body: govde ? JSON.stringify(govde) : undefined,
      });
      const sc = r.headers.get('set-cookie');
      if (sc) cerez = sc.split(';')[0];
      const tur = r.headers.get('content-type') || '';
      return { durum: r.status, veri: tur.includes('json') ? await r.json() : await r.arrayBuffer(), tur };
    };
  };
}

// İstenen imardaki, daha önce verilmemiş bir hücre. Her çağrı yeni bir karodan (dolayısıyla yeni mahalleden) başlar.
const verilen = new Set();
let karoSirasi = 0;
function hucreBul(imar, merkez = [32.49, 37.87]) {
  const I = require('../server/harita/izgara');
  const { sahteImar, KOD_AD } = require('../server/harita/imar');
  const c = I.hucre(...merkez);
  const bx = c.x + (karoSirasi++ % 12) * 64, by = c.y + Math.floor(karoSirasi / 12) * 64;
  for (let r = 0; r < 64; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = bx + dx, y = by + dy;
      const id = I.parselId(x, y);
      if (KOD_AD[sahteImar(x, y)] === imar && !verilen.has(id)) { verilen.add(id); return id; }
    }
  }
  throw new Error(`${imar} hücresi bulunamadı`);
}

module.exports = { ortamKur, istemciUret, hucreBul };
