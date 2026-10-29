// Motif bulmacası: nar, lale, çini, başak, nazar ve fındık taşlarıyla 3'lü eşleştirme. Bölümler sırayla açılır; bölüm
// tanımı (taş çeşidi, hamle sınırı, hedefler, ot kaplı kareler) bölüm numarasından aynı biçimde türetilir. Oyun istemcide
// oynanır: sunucu bölümü başlatır, bitişte kullanılan hamlenin sınırı aşmadığını ve en kısa sürenin (minSureMs + hamle ×
// hamleMs) geçtiğini denetler. Kazanılan bölüm bir sonrakini açar; günde en çok BULMACA.gunlukOdul bölüm ödül verir
// (akçe, her 5. bölümde gübre, her 10. bölümde kalıp seti). Kaybetmenin cezası yoktur.
const db = require('./db');
const L = require('./lib/ledger');
const { OyunHatasi } = L;
const { BULMACA: B, URUNLER } = require('./config/rules');


const gunAnahtari = (t = Date.now()) => new Date(t + 3 * 3600_000).toISOString().slice(0, 10);
const TURLER = Object.keys(B.taslar);

// Bölüm numarasından tohumlu rastgele sayı (her oyuncuda aynı bölüm aynı)
function rastgele(tohum) {
  let a = tohum >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Bölüm tanımı: taş çeşidi 4 → 6'ya çıkar; 4. bölümden sonra ot kaplı kareler (12'den sonra kimi iki kat) gelir.
// Hedefler: belirli motiflerden topla ve/veya otları temizle. Hamle sınırı hedeflerin büyüklüğüne göre.
function bolum(n) {
  const r = rastgele(n * 2654435761 + 97);
  const renk = n <= 3 ? 4 : n <= 12 ? 5 : 6;
  const turler = [...TURLER].sort(() => r() - 0.5).slice(0, renk);
  const ot = [];
  if (n >= 4) {
    const adet = Math.min(20, 3 + Math.floor((n - 4) * 1.5));
    const secili = new Set();
    // Otlar tahtanın alt yarısında, ortaya simetrik
    while (secili.size < adet) {
      const s = B.satir - 1 - Math.floor(r() * Math.min(B.satir, 3 + Math.floor(n / 4)));
      const c = Math.floor(r() * Math.ceil(B.sutun / 2));
      for (const cc of new Set([c, B.sutun - 1 - c])) secili.add(`${s},${cc}`);
    }
    for (const k of secili) {
      const [s, c] = k.split(',').map(Number);
      ot.push([s, c, n >= 12 && r() < 0.35 ? 2 : 1]);
    }
  }
  const otKat = ot.reduce((t, o) => t + o[2], 0);
  const toplaSayisi = ot.length ? (n % 3 === 0 ? 1 : 0) : n < 3 ? 1 : 2;
  const hedefler = [];
  if (otKat) hedefler.push({ tur: 'OT', adet: otKat });
  for (const tur of turler.slice(0, toplaSayisi)) hedefler.push({ tur, adet: Math.min(45, 16 + 2 * n + Math.floor(r() * 4)) });
  const toplam = hedefler.reduce((t, h) => t + (h.tur === 'OT' ? 0 : h.adet), 0);
  const hamle = Math.max(14, Math.min(32, Math.round(12 + toplam * 0.22 + otKat * 0.45 - Math.floor(n / 12))));
  return { seviye: n, satir: B.satir, sutun: B.sutun, turler, ot, hedefler, hamle, tohum: (n * 7919) >>> 0 };
}

// Bölümü kazanmak için gereken en az hamle: hedeflerin toplamı (ot katları dahil) ÷ BULMACA.hamleBasinaAzami. Zincirleme ve
// özel taşlarla tek hamlede çok taş toplanabildiğinden sınır cömerttir; yalnızca "1 hamlede bitirdim" gibi açık hileyi keser.
const enAzHamle = (b) => Math.max(1, Math.ceil(b.hedefler.reduce((t, h) => t + h.adet, 0) / B.hamleBasinaAzami));

// Kalan hamle oranına göre 1–3 yıldız
const yildizHesapla = (hamle, sinir) => { const kalan = (sinir - hamle) / sinir; return kalan >= 0.3 ? 3 : kalan >= 0.12 ? 2 : 1; };
function odulYazisi(n) {
  const o = B.odul(n), p = [{ ikon: '₳', metin: `${o.akce} akçe` }];
  if (o.esya) p.push({ ikon: URUNLER[o.esya[0]]?.ikon || '📦', metin: `${o.esya[1]} ${URUNLER[o.esya[0]]?.ad || o.esya[0]}` });
  return p;
}

const q = {
  durum: db.sorgu('SELECT seviye, yildiz FROM bulmaca_durum WHERE user_id = ?'),
  durumYaz: db.sorgu(`INSERT INTO bulmaca_durum (user_id, seviye, yildiz) VALUES (?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET seviye = excluded.seviye, yildiz = bulmaca_durum.yildiz + excluded.yildiz`),
  gunluk: db.sorgu('SELECT odullu FROM bulmaca_gunluk WHERE user_id = ? AND gun = ?'),
  gunlukArt: db.sorgu(`INSERT INTO bulmaca_gunluk (user_id, gun, odullu) VALUES (?, ?, 1)
    ON CONFLICT (user_id, gun) DO UPDATE SET odullu = bulmaca_gunluk.odullu + 1 RETURNING odullu`),   // tablo adıyla: Postgres'te yalın ad belirsiz
  birak: db.sorgu(`UPDATE bulmaca_oyun SET durum = 'BIRAKTI', bitis_at = ? WHERE user_id = ? AND durum = 'OYNUYOR'`),
  ekle: db.sorgu('INSERT INTO bulmaca_oyun (user_id, seviye, basla_at) VALUES (?, ?, ?)'),
  oyun: db.sorgu('SELECT * FROM bulmaca_oyun WHERE id = ? AND user_id = ?'),
  bitir: db.sorgu(`UPDATE bulmaca_oyun SET durum = ?, bitis_at = ?, hamle = ?, yildiz = ? WHERE id = ? AND durum = 'OYNUYOR'`),
  gecmis: db.sorgu(`SELECT seviye, MAX(yildiz) AS yildiz FROM bulmaca_oyun WHERE user_id = ? AND durum = 'KAZANDI'
    GROUP BY seviye ORDER BY seviye DESC LIMIT 4`),
};
const seviyesi = async (userId) => (await q.durum.get(userId))?.seviye || 1;

async function durumu(userId, t = Date.now()) {
  const d = (await q.durum.get(userId)) || { seviye: 1, yildiz: 0 };
  const odullu = (await q.gunluk.get(userId, gunAnahtari(t)))?.odullu || 0;
  return {
    seviye: d.seviye, yildiz: d.yildiz, bolum: bolum(d.seviye), odul: odulYazisi(d.seviye),
    gunluk: { odullu, tavan: B.gunlukOdul, kalan: Math.max(0, B.gunlukOdul - odullu) },
    gecmis: (await q.gecmis.all(userId)).reverse(), taslar: B.taslar,
  };
}

// Sıradaki bölümü başlat (yarım kalan oyun bırakılmış sayılır)
const basla = (userId) => db.tx(async () => {
  await db.kilit(`bulmaca:${userId}`);
  const t = Date.now(), n = await seviyesi(userId);
  await q.birak.run(t, userId);
  const id = Number((await q.ekle.run(userId, n, t)).lastInsertRowid);
  return { oyunId: id, bolum: bolum(n), odul: odulYazisi(n), enKisa: { tabanMs: B.minSureMs, hamleMs: B.hamleMs } };
});

const bitir = (userId, govde = {}) => db.tx(async () => {
  await db.kilit(`bulmaca:${userId}`);   // seviye ilerlemesi ve günlük ödül sayacı eşzamanlı bitişlerde de tutarlı kalsın
  const t = Date.now();
  const o = await q.oyun.get(Number(govde.oyunId), userId);
  if (!o) throw new OyunHatasi(404, 'Oyun bulunamadı');
  if (o.durum !== 'OYNUYOR') throw new OyunHatasi(409, 'Bu oyun zaten bitti', 'BITTI');
  const b = bolum(o.seviye), gecen = t - o.basla_at;
  if (govde.kazandi !== true) {
    await q.bitir.run('KAYBETTI', t, null, null, o.id);
    return { kazandi: false, seviye: o.seviye };
  }
  const hamle = Number(govde.hamle);
  if (!Number.isInteger(hamle) || hamle < 1 || hamle > b.hamle) throw new OyunHatasi(400, 'Geçersiz hamle sayısı');
  if (hamle < enAzHamle(b)) throw new OyunHatasi(409, 'Bu bölüm bu kadar az hamlede bitmez', 'AZ_HAMLE');
  if (gecen > B.maksSureMs) { await q.bitir.run('KAYBETTI', t, hamle, null, o.id); throw new OyunHatasi(409, 'Bölümün süresi doldu', 'SURE'); }
  if (gecen < B.minSureMs + hamle * B.hamleMs) throw new OyunHatasi(409, 'Bölüm bu kadar kısa sürede bitmez', 'HIZLI');
  const yildiz = yildizHesapla(hamle, b.hamle);
  if ((await q.bitir.run('KAZANDI', t, hamle, yildiz, o.id)).changes !== 1) throw new OyunHatasi(409, 'Bu oyun zaten bitti', 'BITTI');
  // Yalnızca sıradaki bölüm ilerletir (eski bir oyun kimliğiyle ikinci kez ilerlenmez)
  const ilerledi = o.seviye === await seviyesi(userId);
  if (ilerledi) await q.durumYaz.run(userId, o.seviye + 1, yildiz);
  let odul = null;
  if (ilerledi && (await q.gunlukArt.get(userId, gunAnahtari(t))).odullu <= B.gunlukOdul) {
    const od = B.odul(o.seviye), akce = od.akce + (yildiz - 1) * B.yildizAkce, tx = L.yeniTx();
    await L.odul(userId, akce, `Motif bulmacası ${o.seviye}. bölüm`, tx);
    if (od.esya) await L.envanterDegis(userId, od.esya[0], od.esya[1], `Motif bulmacası ${o.seviye}. bölüm`, tx);
    odul = { akce, esya: od.esya ? { ikon: URUNLER[od.esya[0]]?.ikon, ad: URUNLER[od.esya[0]]?.ad, adet: od.esya[1] } : null };
  }
  if (ilerledi) await L.denetim({ aktor: userId, eylem: 'PUZZLE_WON', varlik: `BULMACA:${o.seviye}`, sonra: { hamle, yildiz, odul } });
  return { kazandi: true, seviye: o.seviye, yildiz, odul, sonraki: await seviyesi(userId), gunlukDoldu: ilerledi && !odul };
});

function rotalar(app, { h, auth }) {
  app.get('/api/bulmaca', auth.girisGerekli, h((req) => durumu(req.kullanici.id)));
  app.post('/api/bulmaca/basla', auth.girisGerekli, h((req) => basla(req.kullanici.id)));
  app.post('/api/bulmaca/bitir', auth.girisGerekli, h((req) => bitir(req.kullanici.id, req.body || {})));
}

module.exports = { rotalar, durumu, basla, bitir, bolum, yildizHesapla };
