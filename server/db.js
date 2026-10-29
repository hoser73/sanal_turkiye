// Veri katmanı: tek, zaman uyumsuz arayüz; altında iki motor.
//   VERITABANI=sqlite (varsayılan)  → server/vt/sqlite.js   (tek dosya; yerel geliştirme, testler, tek sunucu)
//   VERITABANI=postgres             → server/vt/postgres.js (DATABASE_URL; PostgreSQL + PostGIS, çok sunucu)
//
// Kullanım:
//   await db.get(sql, ...params)   → ilk satır ya da undefined
//   await db.all(sql, ...params)   → satırlar
//   await db.run(sql, ...params)   → { changes, lastInsertRowid }
//   await db.tx(async () => { … }) → atomik işlem (BEGIN … COMMIT). İç içe çağrı kayıt noktası (SAVEPOINT) açar.
//                                     İşlem içindeki bütün sorgular, hangi modülden gelirse gelsin, aynı bağlantıyı kullanır
//                                     (AsyncLocalStorage); bu yüzden defter fonksiyonları ayrıca bağlantı taşımaz.
//   await db.kilit(anahtar)        → işlem sonuna kadar süren kilit (Postgres: pg_advisory_xact_lock; SQLite: gerek yok)
//   db.sonra(fn)                   → işlem başarıyla kaydedilince çalışır (geri alınırsa hiç çalışmaz)
//   db.tekOrnek(ad, fn)            → bakım işi: süreç içinde tek kopya, çok sunucuda tek örnek (pg_try_advisory_lock)
//   db.sorgu(sql)                  → { get, all, run } — modül başında tanımlanan sorgular için
// SQL iki motorda da çalışan alt kümeyle yazılır (bkz. server/vt/cevir.js): "?" yer tutucu, GREATEST/LEAST, FOR UPDATE.
const { AsyncLocalStorage } = require('async_hooks');

const TUR = String(process.env.VERITABANI || 'sqlite').toLowerCase();
if (!['sqlite', 'postgres'].includes(TUR)) throw new Error(`Bilinmeyen VERITABANI: ${TUR} (sqlite | postgres)`);
const motor = TUR === 'postgres' ? require('./vt/postgres') : require('./vt/sqlite');

const baglam = new AsyncLocalStorage();
let hazir = null, hazirMi = false;
const baslat = () => (hazir ??= motor.baslat().then(() => { hazirMi = true; }));

// İşlem bitince bağlam kapanır: işlem içinde başlatılıp beklenmeyen bir iş sonradan sorgu yaparsa işlem dışı sayılır
function aktifIslem() {
  const s = baglam.getStore();
  return s && s.acik ? s : null;
}

async function calistir(sql, params, kip) {
  if (!hazirMi) await baslat();
  const i = aktifIslem();
  return motor.sorgu(i ? i.baglanti : null, motor.cevir(sql), params, kip);
}

const get = async (sql, ...params) => (await calistir(sql, params, 'get')).rows[0];
const all = async (sql, ...params) => (await calistir(sql, params, 'all')).rows;
async function run(sql, ...params) {
  const r = await calistir(sql, params, 'run');
  return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
}
const sorgu = (sql) => ({
  get: (...p) => get(sql, ...p),
  all: (...p) => all(sql, ...p),
  run: (...p) => run(sql, ...p),
});

const ham = (baglanti, sql) => motor.sorgu(baglanti, sql, [], 'run');

async function tx(fn) {
  if (!hazirMi) await baslat();
  const ust = aktifIslem();
  if (ust) {
    // İç içe işlem: kayıt noktası. İç işlem hata verirse yalnızca onun yazdıkları geri alınır.
    const nokta = `sp${++ust.kok.sayac}`;
    await ham(ust.baglanti, `SAVEPOINT ${nokta}`);
    const ic = { baglanti: ust.baglanti, acik: true, kok: ust.kok, sonra: [] };
    try {
      const r = await baglam.run(ic, fn);
      ic.acik = false;
      await ham(ust.baglanti, `RELEASE SAVEPOINT ${nokta}`);
      ust.sonra.push(...ic.sonra);
      return r;
    } catch (e) {
      ic.acik = false;
      await ham(ust.baglanti, `ROLLBACK TO SAVEPOINT ${nokta}`);
      await ham(ust.baglanti, `RELEASE SAVEPOINT ${nokta}`);
      throw e;
    }
  }
  for (let deneme = 1; ; deneme++) {
    const baglanti = await motor.islemAc();
    const s = { baglanti, acik: true, sayac: 0, sonra: [] };
    s.kok = s;
    let r;
    try {
      r = await baglam.run(s, fn);
    } catch (e) {
      s.acik = false;
      await motor.islemKapat(baglanti, false);
      if (deneme < 5 && motor.yenidenDenenir(e)) continue;   // kilitlenme / seri hale getirme: baştan dene
      throw e;
    }
    s.acik = false;
    try {
      await motor.islemKapat(baglanti, true);
    } catch (e) {
      if (deneme < 5 && motor.yenidenDenenir(e)) continue;
      throw e;
    }
    for (const f of s.sonra) setImmediate(f);
    return r;
  }
}

async function kilit(...anahtarlar) {
  const i = aktifIslem();
  if (!i) throw new Error('db.kilit yalnızca işlem (db.tx) içinde kullanılabilir');
  // Sabit sıra: iki işlem aynı anahtarları farklı sırayla isteyip kilitlenmesin
  for (const a of [...new Set(anahtarlar.map(String))].sort()) await motor.kilit(i.baglanti, a);
}

function sonra(fn) {
  const i = aktifIslem();
  if (i) i.sonra.push(fn);
  else setImmediate(fn);
}

// Gizli oy (yalnızca Postgres): kapanan sandığın oyları tek işlemde rastgele sırayla yeniden yazılır; satırlar artık
// katılım kaydıyla aynı işlem kimliğini (xmin) ve yazılış sırasını taşımaz. Sayımdan sonra, aynı işlem içinde çağrılır.
async function sandigiKaristir(tablo, kolon, kimlik) {
  if (motor.tur === 'postgres') await get(`SELECT oy_sandigini_karistir(?, ?, CAST(? AS BIGINT)) AS adet`, tablo, kolon, kimlik);
}

let kapanis = null;
const calisanlar = new Map();
function tekOrnek(ad, fn) {
  if (calisanlar.has(ad)) return calisanlar.get(ad);
  // İsteğin işlem bağlamından bağımsız çalışır
  const p = baglam.exit(() => motor.tekOrnek(ad, fn)).finally(() => calisanlar.delete(ad));
  calisanlar.set(ad, p);
  return p;
}

module.exports = {
  tur: motor.tur,
  get, all, run, sorgu, tx, kilit, sonra, tekOrnek, baslat, sandigiKaristir,
  islemde: () => !!aktifIslem(),
  exec: async (sql) => { if (!hazirMi) await baslat(); return motor.exec(sql); },
  // Olay yolu köprüsü (server/lib/olaylar.js): Postgres'te LISTEN/NOTIFY, SQLite'ta süreç içi
  dinle: (fn) => motor.dinle(fn),
  yayinla: (m) => motor.yayinla(m),
  kapat: () => (kapanis ??= motor.kapat()),
  // Yalnızca SQLite: yedekleme ve aktarma betikleri için ham better-sqlite3 tutamacı
  sqlite: motor.vt || null,
  gomuluMu: !!motor.gomuluMu,
};
