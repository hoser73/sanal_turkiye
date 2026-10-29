// SQLite motoru (yerel geliştirme ve testler için varsayılan): tek dosya, WAL, better-sqlite3.
// better-sqlite3 senkrondur; zaman uyumsuz arayüz işlem kilidiyle (TekBaglanti) sağlanır: açık işlem sürerken işlem dışı
// sorgular bekler, böylece bir isteğin işlemi başka bir isteğin sorgusuyla karışmaz.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { semaKur } = require('./sema-sqlite');
const { sqliteCevir } = require('./cevir');
const { TekBaglanti } = require('./tek-baglanti');

const VERI_DIZINI = process.env.VERI_DIZINI || path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(VERI_DIZINI, { recursive: true });

// Not: v0.1–0.2'nin Meram ızgarası (data/sanalturkiye.db) ulusal ızgarayla uyumsuz olduğundan ayrı dosyada kalır.
const vt = new Database(path.join(VERI_DIZINI, 'sanalturkiye-tr.db'));
vt.pragma('journal_mode = WAL');
vt.pragma('foreign_keys = ON');
vt.pragma('busy_timeout = 5000');
// WAL'da NORMAL güvenli ve her işlemde diske zorla yazmayı (fsync) bekletmez: yazmalar olay döngüsünü kilitlemez
vt.pragma('synchronous = NORMAL');
vt.pragma('temp_store = MEMORY');
vt.pragma('cache_size = -65536');   // 64 MB sayfa önbelleği
semaKur(vt);

const tek = new TekBaglanti();
const ceviriler = new Map();
const hazirlananlar = new Map();
function cevir(sql) {
  let c = ceviriler.get(sql);
  if (c === undefined) { c = sqliteCevir(sql); ceviriler.set(sql, c); }
  return c;
}
function hazirla(sql) {
  let s = hazirlananlar.get(sql);
  if (!s) { s = vt.prepare(sql); hazirlananlar.set(sql, s); }
  return s;
}

function calistir(sql, params, kip) {
  const s = hazirla(sql);
  if (!s.reader) {
    const r = s.run(...params);
    return { rows: [], changes: r.changes, lastInsertRowid: Number(r.lastInsertRowid) };
  }
  if (kip === 'get') {
    const satir = s.get(...params);
    return { rows: satir ? [satir] : [], changes: 0 };
  }
  const rows = s.all(...params);   // RETURNING'li yazma da buraya düşer
  return { rows, changes: kip === 'run' ? rows.length : 0, lastInsertRowid: rows[0]?.id };
}

// baglanti: açık işlemin tutamacı (işlem içi sorgu kilidi beklemez) ya da null
async function sorgu(baglanti, sql, params, kip) {
  if (baglanti) return calistir(sql, params, kip);
  return tek.bosken(() => calistir(sql, params, kip));
}

async function islemAc() {
  const birak = await tek.al();
  try { vt.exec('BEGIN IMMEDIATE'); } catch (e) { birak(); throw e; }
  return { birak };
}
async function islemKapat(b, basarili) {
  try {
    if (basarili) vt.exec('COMMIT');
    else if (vt.inTransaction) vt.exec('ROLLBACK');
  } catch (e) {
    if (vt.inTransaction) vt.exec('ROLLBACK');
    throw e;
  } finally {
    b.birak();
  }
}

// Tek süreç, tek yazıcı: kilitler ve tek örnek koruması gerekmez
const kilit = async () => {};
const tekOrnek = (_ad, fn) => fn();

// Olay yolu süreç içidir
let dinleyici = null;
const dinle = (fn) => { dinleyici = fn; };
const yayinla = (m) => { if (dinleyici) dinleyici(m); };

module.exports = {
  tur: 'sqlite', vt, cevir, sorgu, islemAc, islemKapat, kilit, tekOrnek, dinle, yayinla,
  baslat: async () => {},
  exec: async (sql) => tek.bosken(() => vt.exec(sql)),
  yenidenDenenir: () => false,
  kapat: async () => { vt.close(); },
};
