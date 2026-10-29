// PostgreSQL + PostGIS motoru (VERITABANI=postgres). DATABASE_URL:
//   postgres://kullanici:parola@sunucu:5432/veritabani  → pg bağlantı havuzu (üretim, çok sunucu)
//   pglite://bellek  ya da  pglite:<dizin>              → gömülü PGlite (WASM; testler ve sunucusuz geliştirme)
// Şema açılışta db/postgres/sema.sql'den kurulur (her adımı tekrar çalıştırılabilir; birden çok sunucu aynı anda açılırsa
// danışma kilidiyle sıraya girer). Olaylar LISTEN/NOTIFY ile bütün sunuculara yayılır.
// PG_SEMA: tablolar bu Postgres şemasında tutulur (search_path = PG_SEMA, public). Aynı veritabanını paylaşan kurulumlar
// (ör. testler) birbirinden ayrılır; olay kanalı ve danışma kilitleri de şema adını içerir.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { postgresCevir } = require('./cevir');
const { TekBaglanti } = require('./tek-baglanti');

const SEMA = path.join(__dirname, '..', '..', 'db', 'postgres', 'sema.sql');
const ADRES = process.env.DATABASE_URL || '';
const SEMA_ADI = process.env.PG_SEMA || '';
if (SEMA_ADI && !/^[a-z_][a-z0-9_]{0,40}$/.test(SEMA_ADI)) throw new Error('PG_SEMA yalnızca küçük harf, rakam ve _ içerebilir');
const KANAL = `sanalturkiye_olay${SEMA_ADI ? `_${SEMA_ADI}` : ''}`;
const anahtar = (a) => (SEMA_ADI ? `${SEMA_ADI}:${a}` : a);
const baglantiAyari = () => ({ connectionString: ADRES, ...(SEMA_ADI ? { options: `-c search_path=${SEMA_ADI},public` } : {}) });
const GOMULU = ADRES.startsWith('pglite:');

let havuz = null;          // pg.Pool
let gomulu = null;         // PGlite
let dinleyiciIstemci = null;
let kapaniyor = false;
const tek = new TekBaglanti();   // yalnızca gömülü (tek bağlantı) kipte
const idTablolari = new Set();
let dinleyici = null;

const ceviriler = new Map();
function cevir(sql) {
  let c = ceviriler.get(sql);
  if (c === undefined) { c = postgresCevir(sql, idTablolari); ceviriler.set(sql, c); }
  return c;
}
// Havuzda her bağlantı aynı cümleyi bir kez hazırlar (adlı hazır cümle)
const ad = (sql) => `s${crypto.createHash('sha1').update(sql).digest('hex').slice(0, 20)}`;

function sonuc(r) {
  const rows = r.rows || [];
  return { rows, changes: r.rowCount ?? r.affectedRows ?? 0, lastInsertRowid: rows[0]?.id };
}

// SQLite NaN/Infinity'yi NULL bağlar (ör. Number('abc') ile gelen kimlik "bulunamadı" olur); Postgres reddeder → aynı davranış
const deger = (v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v);

// baglanti: işlem istemcisi (havuz kipi) / { gomulu: true } (gömülü kip) / null (işlem dışı)
async function sorgu(baglanti, sql, params) {
  if (params.some((v) => typeof v === 'number' && !Number.isFinite(v))) params = params.map(deger);
  if (GOMULU) {
    if (baglanti) return sonuc(await gomulu.query(sql, params));
    const birak = await tek.al();
    try { return sonuc(await gomulu.query(sql, params)); } finally { birak(); }
  }
  const hedef = baglanti || havuz;
  return sonuc(await hedef.query(params.length ? { name: ad(sql), text: sql, values: params } : sql));
}

async function islemAc() {
  if (GOMULU) {
    const birak = await tek.al();
    try { await gomulu.query('BEGIN'); } catch (e) { birak(); throw e; }
    return { gomulu: true, birak };
  }
  const istemci = await havuz.connect();
  try { await istemci.query('BEGIN'); } catch (e) { istemci.release(e); throw e; }
  return istemci;
}
async function islemKapat(b, basarili) {
  if (GOMULU) {
    try { await gomulu.query(basarili ? 'COMMIT' : 'ROLLBACK'); } finally { b.birak(); }
    return;
  }
  let hata = null;
  try { await b.query(basarili ? 'COMMIT' : 'ROLLBACK'); } catch (e) { hata = e; }
  b.release(hata && !basarili ? hata : undefined);   // ROLLBACK bile başarısızsa bağlantı atılır
  if (hata && basarili) throw hata;
}

// İşlem sonuna kadar süren danışma kilidi (para hesabı, envanter, parsel …): aynı anahtarı isteyen işlemler sıraya girer
async function kilit(baglanti, ad) {
  await sorgu(baglanti, 'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [anahtar(ad)]);
}

// Çok sunuculu kurulumda bakım işi (seçim evreleri, posta kuyruğu, haftalık ödül …) aynı anda tek örnekte çalışır.
// Kilidi başka sunucu tutuyorsa iş bu tur atlanır (o sunucu yapıyor).
async function tekOrnek(isim, fn) {
  if (GOMULU) return fn();
  const istemci = await havuz.connect();
  try {
    const k = anahtar(`bakim:${isim}`);
    const { rows } = await istemci.query('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS tamam', [k]);
    if (!rows[0].tamam) return undefined;
    try { return await fn(); } finally { await istemci.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [k]); }
  } finally {
    istemci.release();
  }
}

function bildirimGeldi(yuk) {
  if (!dinleyici) return;
  let m;
  try { m = JSON.parse(yuk); } catch { return; }
  dinleyici(m);
}
const dinle = (fn) => { dinleyici = fn; };
// NOTIFY yükü 8000 baytla sınırlıdır; olaylar yalnızca "yenile" ipucu taşır
function yayinla(m) {
  const yuk = JSON.stringify(m);
  if (Buffer.byteLength(yuk) > 7900) { console.warn(`Olay çok büyük, yalnızca bu sunucuda yayıldı: ${m.tur}`); bildirimGeldi(yuk); return; }
  sorgu(null, 'SELECT pg_notify($1, $2)', [KANAL, yuk]).catch((e) => { if (!kapaniyor) console.warn('Olay yayılamadı:', e.message); });
}

async function dinleyiciKur() {
  if (GOMULU) { await gomulu.listen(KANAL, bildirimGeldi); return; }
  const { Client } = require('pg');
  const yeniden = () => { if (!kapaniyor) setTimeout(() => dinleyiciKur().catch((e) => console.warn('LISTEN yeniden kurulamadı:', e.message)), 1000).unref(); };
  const c = new Client(baglantiAyari());
  c.on('notification', (n) => { if (n.channel === KANAL) bildirimGeldi(n.payload); });
  c.on('error', (e) => { console.warn('LISTEN bağlantısı koptu:', e.message); });
  c.on('end', () => { if (dinleyiciIstemci === c) { dinleyiciIstemci = null; yeniden(); } });
  await c.connect();
  c.connection?.stream?.unref?.();   // dinleme bağlantısı süreci tek başına açık tutmaz (HTTP sunucusu zaten tutar)
  await c.query(`LISTEN ${KANAL}`);
  dinleyiciIstemci = c;
}

// Şema yalnızca değiştiyse uygulanır (özeti sema_surumu tablosunda tutulur)
async function semaKur() {
  const sema = fs.readFileSync(SEMA, 'utf8');
  const ozet = crypto.createHash('sha256').update(sema).digest('hex');
  const uygula = async (sorgula) => {
    await sorgula(`CREATE TABLE IF NOT EXISTS sema_surumu (ozet TEXT PRIMARY KEY, uygulandi TIMESTAMPTZ NOT NULL DEFAULT now())`);
    if ((await sorgula(`SELECT 1 FROM sema_surumu WHERE ozet = '${ozet}'`)).rows.length) return;
    await sorgula(sema);
    await sorgula(`INSERT INTO sema_surumu (ozet) VALUES ('${ozet}') ON CONFLICT DO NOTHING`);
  };
  if (GOMULU) await uygula(async (sql) => (await gomulu.exec(sql)).at(-1));
  else {
    const c = await havuz.connect();
    try {
      // Aynı anda açılan sunucular sıraya girer
      await c.query(`SELECT pg_advisory_lock(hashtextextended($1, 0))`, [anahtar('sema')]);
      try {
        if (SEMA_ADI) await c.query(`CREATE SCHEMA IF NOT EXISTS ${SEMA_ADI}`);
        await uygula((sql) => c.query(sql));
      } finally { await c.query(`SELECT pg_advisory_unlock(hashtextextended($1, 0))`, [anahtar('sema')]); }
    } finally { c.release(); }
  }
  const { rows } = await sorgu(null, `SELECT table_name AS t FROM information_schema.columns
    WHERE table_schema = current_schema() AND column_name = 'id'`, []);
  for (const r of rows) idTablolari.add(r.t);
}

async function baslat() {
  if (!ADRES) throw new Error('VERITABANI=postgres için DATABASE_URL tanımlı olmalı (ör. postgres://… ya da pglite://bellek)');
  if (GOMULU) {
    const { PGlite } = await import('@electric-sql/pglite');
    const { postgis } = await import('@electric-sql/pglite-postgis');
    const yer = ADRES.replace(/^pglite:(\/\/)?/, '');
    const dizin = !yer || yer === 'bellek' ? undefined : path.resolve(yer);
    gomulu = await PGlite.create(dizin, { extensions: { postgis }, parsers: { 20: Number, 1700: Number } });
  } else {
    const pg = require('pg');
    // BIGINT ve NUMERIC JavaScript sayısı olarak okunur (kimlikler 2^53'ün, para tutarları kuruş hassasiyetinin altında)
    pg.types.setTypeParser(20, Number);
    pg.types.setTypeParser(1700, Number);
    havuz = new pg.Pool({ ...baglantiAyari(), max: Number(process.env.PG_HAVUZ || 10), allowExitOnIdle: true });
    havuz.on('error', (e) => console.warn('Postgres havuz hatası:', e.message));
  }
  await semaKur();
  await dinleyiciKur();
}

async function exec(sql) {
  if (GOMULU) { const birak = await tek.al(); try { await gomulu.exec(sql); } finally { birak(); } return; }
  await havuz.query(sql);
}

async function kapat() {
  kapaniyor = true;
  if (dinleyiciIstemci) { const c = dinleyiciIstemci; dinleyiciIstemci = null; await c.end().catch(() => {}); }
  if (havuz) await havuz.end();
  if (gomulu) await gomulu.close();
}

// Seri hale getirme hatası ve kilitlenme: işlem baştan yeniden denenebilir
const yenidenDenenir = (e) => e && (e.code === '40001' || e.code === '40P01');

module.exports = { tur: 'postgres', gomuluMu: GOMULU, cevir, sorgu, islemAc, islemKapat, kilit, tekOrnek, dinle, yayinla, baslat, exec, kapat, yenidenDenenir };
