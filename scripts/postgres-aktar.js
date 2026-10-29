#!/usr/bin/env node
// PostgreSQL + PostGIS geçişi (plan §13.3).
//   npm run postgres-aktar -- --sema               → db/postgres/sema.sql (SQLite şemasından üretilir; uygulama açılışta kurar)
//   npm run postgres-aktar -- --disa-aktar <dizin>  → SQLite verisi: <dizin>/*.csv + sema.sql + yukle.sql
//                                                    (psql "$DATABASE_URL" -f <dizin>/yukle.sql)
// Şema her adımı tekrar çalıştırılabilir biçimde yazılır (IF NOT EXISTS, adlı kısıtlar, CREATE OR REPLACE): yeni sürümün
// şeması eski bir veritabanına uygulanınca yalnızca eksik tablo/kolon/indeks/kısıt eklenir.
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { semaKur } = require('../server/vt/sema-sqlite');
const I = require('../server/harita/izgara');

const kimlik = (ad) => `"${ad}"`;
const tablolar = (vt) => vt.prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all();
const kolonlar = (vt, tablo) => vt.prepare(`PRAGMA table_info(${kimlik(tablo)})`).all();

// Para tutarları Postgres'te kayan nokta değil kesin ondalık (NUMERIC) tutulur
const PARA = new Set(['wallet_ledger.debit', 'wallet_ledger.credit', 'parcel_ownership.price', 'trades.price', 'trades.fee',
  'urun_emirleri.fiyat', 'urun_islemleri.fiyat', 'urun_islemleri.ucret', 'sevkiyatlar.maliyet', 'sevkiyatlar.gelir']);
function tip(sqliteTip, tablo, kolon) {
  if (PARA.has(`${tablo}.${kolon}`)) return 'NUMERIC(14,2)';
  const t = String(sqliteTip || '').toUpperCase();
  if (t.includes('BLOB')) return 'BYTEA';
  if (t.includes('INT')) return 'BIGINT';
  if (t.includes('REAL') || t.includes('FLOA') || t.includes('DOUB')) return 'DOUBLE PRECISION';
  return 'TEXT';
}
function varsayilan(v) {
  if (v == null) return '';
  if (/datetime\('now'\)/i.test(v)) return ` DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')`;
  return ` DEFAULT ${v.replace(/^\((.*)\)$/, '$1')}`;
}
// Postgres ad sınırı 63 bayt
const kisaAd = (ad) => (ad.length <= 63 ? ad : `${ad.slice(0, 54)}_${require('crypto').createHash('sha1').update(ad).digest('hex').slice(0, 8)}`);

// Postgres'e özgü ekler: yardımcı fonksiyonlar (şemadan önce) ve tetikleyiciler, PostGIS, görünümler (şemadan sonra)
const ON_EK = `-- SQLite uyumluluğu: datetime('now'[, '+30 days']) → 'YYYY-MM-DD HH:MM:SS' (UTC metin; uygulama tarihleri bu biçimde saklar)
CREATE OR REPLACE FUNCTION datetime(zaman TEXT, kaydir TEXT DEFAULT NULL) RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT to_char((CASE WHEN zaman = 'now' THEN now() AT TIME ZONE 'UTC' ELSE zaman::timestamp END)
                 + COALESCE(kaydir, '0 seconds')::interval, 'YYYY-MM-DD HH24:MI:SS')
$$;
-- Değiştirilemez kayıtlar (denetim kaydı, oylar): tetikleyici iletiyi argüman olarak alır
CREATE OR REPLACE FUNCTION degistirilemez() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Seçim kapanınca oy sandığı karıştırılır (oy_sandigini_karistir): yalnızca o işlemde, aynı oylar yeniden yazılırken silmeye izin
  IF TG_OP = 'DELETE' AND current_setting('sanalturkiye.sandik_karistir', true) = TG_TABLE_NAME THEN RETURN OLD; END IF;
  RAISE EXCEPTION '%', TG_ARGV[0];
END $$;`;

const SON_EK = `CREATE INDEX IF NOT EXISTS ix_parcels_geom ON parcels USING GIST (geom);
CREATE INDEX IF NOT EXISTS ix_parcels_merkez ON parcels USING GIST (merkez);
CREATE INDEX IF NOT EXISTS ix_regions_merkez ON regions USING GIST (merkez);
-- Parsel geometrisi ızgara hücresinden (Web Mercator z20 karo) türetilir; uygulama yazmaz, tetikleyici doldurur
CREATE OR REPLACE FUNCTION parsel_geometrisi() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.grid_x IS DISTINCT FROM OLD.grid_x OR NEW.grid_y IS DISTINCT FROM OLD.grid_y OR NEW.geom IS NULL THEN
    NEW.geom := ST_Transform(ST_TileEnvelope(20, NEW.grid_x::int, NEW.grid_y::int), 4326);
    NEW.merkez := ST_SetSRID(ST_MakePoint(NEW.centroid_lon, NEW.centroid_lat), 4326);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS parsel_geometrisi ON parcels;
CREATE TRIGGER parsel_geometrisi BEFORE INSERT OR UPDATE ON parcels FOR EACH ROW EXECUTE FUNCTION parsel_geometrisi();
CREATE OR REPLACE FUNCTION bolge_merkezi() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.merkez := CASE WHEN NEW.center_lon IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint(NEW.center_lon, NEW.center_lat), 4326) END;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bolge_merkezi ON regions;
CREATE TRIGGER bolge_merkezi BEFORE INSERT OR UPDATE OF center_lon, center_lat ON regions FOR EACH ROW EXECUTE FUNCTION bolge_merkezi();
-- Gizli oy: Postgres her satıra yazan işlemin kimliğini (xmin) ve fiziksel sırasını (ctid) iliştirir; oy satırı katılım
-- satırıyla aynı işlemde yazıldığından, veritabanını doğrudan okuyabilen biri oylama sürerken ikisini eşleyebilir.
-- Oylama kapanınca uygulama bu fonksiyonla sandığı karıştırır: o seçimin oyları tek işlemde rastgele sırayla yeniden
-- yazılır (hepsi aynı xmin'i alır, sıra kaybolur). İçerik (makbuz, aday, makam) birebir korunur; denetlenir.
CREATE OR REPLACE FUNCTION oy_sandigini_karistir(tablo TEXT, kolon TEXT, kimlik BIGINT) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE once TEXT; sonra TEXT; adet BIGINT;
BEGIN
  IF tablo NOT IN ('secim_oylari', 'referandum_oylari') OR kolon NOT IN ('secim_id', 'ref_id') THEN RAISE EXCEPTION 'geçersiz sandık'; END IF;
  EXECUTE format('CREATE TEMP TABLE sandik ON COMMIT DROP AS SELECT * FROM %I WHERE %I = $1 ORDER BY random()', tablo, kolon) USING kimlik;
  EXECUTE format('SELECT md5(COALESCE(string_agg(t::text, %L ORDER BY t::text), %L)), COUNT(*) FROM %I t WHERE %I = $1', ',', '', tablo, kolon)
    INTO once, adet USING kimlik;
  PERFORM set_config('sanalturkiye.sandik_karistir', tablo, true);
  EXECUTE format('DELETE FROM %I WHERE %I = $1', tablo, kolon) USING kimlik;
  PERFORM set_config('sanalturkiye.sandik_karistir', '', true);
  EXECUTE format('INSERT INTO %I SELECT * FROM sandik', tablo);
  EXECUTE format('SELECT md5(COALESCE(string_agg(t::text, %L ORDER BY t::text), %L)) FROM %I t WHERE %I = $1', ',', '', tablo, kolon)
    INTO sonra USING kimlik;
  IF once IS DISTINCT FROM sonra THEN RAISE EXCEPTION 'sandık karıştırma tutarsız'; END IF;
  DROP TABLE sandik;
  RETURN adet;
END $$;
-- Defter bütünlüğü: her işlem grubu dengeli olmalı (raporlama görünümü)
CREATE OR REPLACE VIEW defter_dengesiz AS SELECT tx_group, round((sum(debit) - sum(credit))::numeric, 2) AS fark FROM wallet_ledger
  GROUP BY tx_group HAVING round((sum(debit) - sum(credit))::numeric, 2) <> 0;`;

// SQLite tetikleyicisi "BEFORE UPDATE|DELETE ON t BEGIN SELECT RAISE(ABORT, 'ileti'); END" → Postgres karşılığı
function tetikleyiciler(vt) {
  const sonuc = [];
  for (const { name, sql } of vt.prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name`).all()) {
    const m = /BEFORE\s+(UPDATE|DELETE|INSERT)\s+ON\s+"?(\w+)"?\s+BEGIN\s+SELECT\s+RAISE\(ABORT,\s*'([^']*)'\);\s*END/i.exec(sql);
    if (!m) throw new Error(`Postgres'e çevrilemeyen tetikleyici: ${name}`);
    sonuc.push(`DROP TRIGGER IF EXISTS ${name} ON ${kimlik(m[2])};`,
      `CREATE TRIGGER ${name} BEFORE ${m[1].toUpperCase()} ON ${kimlik(m[2])} FOR EACH ROW EXECUTE FUNCTION degistirilemez('${m[3]}');`);
  }
  return sonuc;
}

function semaUret(vt) {
  const satirlar = ['-- Sanal Türkiye — PostgreSQL + PostGIS şeması. ELLE DÜZENLEMEYİN: npm run postgres-aktar -- --sema',
    '-- (server/vt/sema-sqlite.js\'den üretilir; uygulama VERITABANI=postgres ile açılırken kurar, her adım tekrar çalıştırılabilir)',
    'SET client_min_messages = warning;', 'CREATE EXTENSION IF NOT EXISTS postgis SCHEMA public;', 'BEGIN;', ON_EK];
  const sonraki = [];
  for (const { name } of tablolar(vt)) {
    const kol = kolonlar(vt, name);
    const pk = kol.filter((k) => k.pk).sort((a, b) => a.pk - b.pk);
    const tekIntPk = pk.length === 1 && /INT/i.test(pk[0].type);
    const tanim = (k) => {
      const kimlikKolonu = tekIntPk && k.pk ? ' GENERATED BY DEFAULT AS IDENTITY' : '';
      return `${kimlik(k.name)} ${tip(k.type, name, k.name)}${kimlikKolonu}${k.notnull && !k.pk ? ' NOT NULL' : ''}${kimlikKolonu ? '' : varsayilan(k.dflt_value)}`;
    };
    const tanimlar = kol.map((k) => `  ${tanim(k)}`);
    if (pk.length) tanimlar.push(`  PRIMARY KEY (${pk.map((k) => kimlik(k.name)).join(', ')})`);
    // UNIQUE kısıtları (kolon düzeyi ve tablo düzeyi): SQLite bunları origin='u' otomatik indeks olarak tutar
    for (const ix of vt.prepare(`PRAGMA index_list(${kimlik(name)})`).all().filter((x) => x.origin === 'u')) {
      const ik = vt.prepare(`PRAGMA index_info(${kimlik(ix.name)})`).all().sort((a, b) => a.seqno - b.seqno).map((c) => kimlik(c.name));
      tanimlar.push(`  UNIQUE (${ik.join(', ')})`);
    }
    if (name === 'parcels') tanimlar.push('  "geom" geometry(Polygon, 4326)', '  "merkez" geometry(Point, 4326)');
    if (name === 'regions') tanimlar.push('  "merkez" geometry(Point, 4326)');
    satirlar.push(`CREATE TABLE IF NOT EXISTS ${kimlik(name)} (\n${tanimlar.join(',\n')}\n);`);
    // Sonradan eklenen kolonlar (eski veritabanını yükseltmek için); birincil anahtar zaten tabloyla gelir
    for (const k of kol.filter((x) => !x.pk)) sonraki.push(`ALTER TABLE ${kimlik(name)} ADD COLUMN IF NOT EXISTS ${tanim(k)};`);
    // Yabancı anahtarlar ertelenmiş (DEFERRABLE INITIALLY DEFERRED): yükleme sırasından bağımsız, COMMIT'te denetlenir
    for (const f of vt.prepare(`PRAGMA foreign_key_list(${kimlik(name)})`).all()) {
      const ad = kisaAd(`fk_${name}_${f.from}`);
      sonraki.push(`DO $$ BEGIN ALTER TABLE ${kimlik(name)} ADD CONSTRAINT ${kimlik(ad)} FOREIGN KEY (${kimlik(f.from)}) REFERENCES ${kimlik(f.table)}(${kimlik(f.to)})${f.on_delete !== 'NO ACTION' ? ` ON DELETE ${f.on_delete}` : ''} DEFERRABLE INITIALLY DEFERRED; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    }
  }
  // İndeksler (kısmi indeksler dahil; SQLite sözdizimi uyumludur)
  for (const { sql } of vt.prepare(`SELECT sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name`).all()) {
    sonraki.push(sql.replace(/^CREATE\s+(UNIQUE\s+)?INDEX\s+(?!IF NOT EXISTS)/i, (t, u) => `CREATE ${u || ''}INDEX IF NOT EXISTS `).replace(/\s+/g, ' ') + ';');
  }
  sonraki.push(...tetikleyiciler(vt), SON_EK);
  return [...satirlar, ...sonraki, 'COMMIT;'].join('\n') + '\n';
}

// Uygulamanın şeması (boş bellek içi SQLite'a kurulur): veri dosyasından bağımsız, her zaman eksiksiz
function sema() {
  const vt = new Database(':memory:');
  semaKur(vt);
  const s = semaUret(vt);
  vt.close();
  return s;
}

// CSV: RFC 4180 (tırnak içinde, çift tırnak kaçışlı); NULL boş alan. İkili değerler Postgres BYTEA hex biçiminde (\x…)
const csvAlan = (v) => (v == null ? '' : Buffer.isBuffer(v) ? `\\x${v.toString('hex')}` : `"${String(v).replace(/"/g, '""')}"`);
// Var olan SQLite verisini dışa aktarır. vt verilmezse VERI_DIZINI'ndeki dosya açılır (önce eksik kolonlar eklenir).
function disaAktar(dizin, vt) {
  if (!vt) {
    const VERI = process.env.VERI_DIZINI || path.join(__dirname, '..', 'data');
    vt = new Database(path.join(VERI, 'sanalturkiye-tr.db'), { fileMustExist: true });
    semaKur(vt);
  }
  fs.mkdirSync(dizin, { recursive: true });
  const yukle = ['\\set ON_ERROR_STOP on', `\\i ${path.resolve(dizin, 'sema.sql')}`, 'BEGIN;'];
  fs.writeFileSync(path.join(dizin, 'sema.sql'), sema());
  const ozet = {};
  for (const { name } of tablolar(vt)) {
    const ad = kolonlar(vt, name).map((k) => k.name);
    const dosya = path.join(dizin, `${name}.csv`);
    const akis = fs.openSync(dosya, 'w');
    let n = 0;
    for (const s of vt.prepare(`SELECT * FROM ${kimlik(name)}`).iterate()) {
      fs.writeSync(akis, ad.map((k) => csvAlan(s[k])).join(',') + '\n');
      n++;
    }
    fs.closeSync(akis);
    ozet[name] = n;
    yukle.push(`\\copy ${kimlik(name)} (${ad.map(kimlik).join(', ')}) FROM '${path.resolve(dosya)}' WITH (FORMAT csv)`);
  }
  // Parsel geometrileri yüklemede tetikleyiciyle (ST_TileEnvelope) üretilir; ayrıca ızgara hücresinin poligonu WKT olarak
  // yazılır ve yükleme sonunda karşılaştırılır (iki hesap aynı hücreyi vermeli)
  const geo = fs.openSync(path.join(dizin, 'parcels_geom.csv'), 'w');
  for (const p of vt.prepare(`SELECT id, grid_x, grid_y FROM parcels`).iterate()) {
    const halka = I.hucrePoligonu(p.grid_x, p.grid_y).coordinates[0].map(([x, y]) => `${x} ${y}`).join(', ');
    fs.writeSync(geo, `${csvAlan(p.id)},${csvAlan(`POLYGON((${halka}))`)}\n`);
  }
  fs.closeSync(geo);
  const tekIntPk = tablolar(vt).map(({ name }) => [name, kolonlar(vt, name).filter((k) => k.pk)])
    .filter(([, pk]) => pk.length === 1 && /INT/i.test(pk[0].type));
  yukle.push(
    'CREATE TEMP TABLE parsel_geo (id TEXT, poligon TEXT);',
    `\\copy parsel_geo FROM '${path.resolve(dizin, 'parcels_geom.csv')}' WITH (FORMAT csv)`,
    `DO $$ BEGIN IF EXISTS (SELECT 1 FROM parsel_geo g JOIN parcels p ON p.id = g.id
       WHERE ST_HausdorffDistance(p.geom, ST_GeomFromText(g.poligon, 4326)) > 1e-6)
       THEN RAISE EXCEPTION 'parsel geometrisi ızgarayla uyuşmuyor'; END IF; END $$;`.replace(/\n\s+/g, ' '),
    // Kimlik dizilerini en büyük değere taşı
    ...tekIntPk.map(([name, [k]]) => `SELECT setval(pg_get_serial_sequence('${kimlik(name)}', '${k.name}'), COALESCE((SELECT MAX(${kimlik(k.name)}) FROM ${kimlik(name)}), 0) + 1, false);`),
    'COMMIT;',
    'ANALYZE;',
  );
  fs.writeFileSync(path.join(dizin, 'yukle.sql'), yukle.join('\n') + '\n');
  return ozet;
}

const SEMA_DOSYASI = path.join(__dirname, '..', 'db', 'postgres', 'sema.sql');
if (require.main === module) {
  if (process.argv.includes('--sema')) {
    fs.mkdirSync(path.dirname(SEMA_DOSYASI), { recursive: true });
    fs.writeFileSync(SEMA_DOSYASI, sema());
    console.log(`Şema yazıldı: ${SEMA_DOSYASI}`);
  } else {
    const i = process.argv.indexOf('--disa-aktar');
    if (i < 0) { console.error('Kullanım: --sema | --disa-aktar <dizin>'); process.exit(1); }
    const ozet = disaAktar(path.resolve(process.argv[i + 1] || 'data/postgres-aktarim'));
    console.log(JSON.stringify({ tamam: true, satirlar: ozet }, null, 1));
  }
}
module.exports = { sema, disaAktar, SEMA_DOSYASI };
