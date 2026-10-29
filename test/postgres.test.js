// PostgreSQL + PostGIS:
//  - SQLite kipinde (npm test): scripts/postgres-aktar.js çıktısı (sema.sql + CSV + yukle.sql) gerçek bir PostgreSQL 18 +
//    PostGIS 3.6 motorunda (PGlite, WASM) çalıştırılır: veri yüklenir, defter dengesi, değiştirilemez kayıtlar ve uzamsal
//    sorgular doğrulanır (var olan bir kurulumun Postgres'e taşınması).
//  - Postgres kipinde (npm run test:pg): aynı denetimler uygulamanın canlı veritabanında yapılır.
//  - Her iki kipte: depodaki db/postgres/sema.sql, SQLite şemasından üretilenle aynı olmalı.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ortamKur, istemciUret, hucreBul } = require('./yardimci');

const VERI = ortamKur('postgres');
const app = require('../server/index');
const db = require('../server/db');
const PG = db.tur === 'postgres';

let sunucu, taban, pg, dizin;
// Postgres'e karşı sorgu: SQLite kipinde aktarılan PGlite kopyası, Postgres kipinde uygulamanın kendi veritabanı
const pgSorgu = async (sql, params = []) => (PG ? { rows: await db.all(sql.replace(/\$\d+/g, '?'), ...params) } : pg.query(sql, params));
const pgCalistir = (sql) => (PG ? db.run(sql) : pg.exec(sql));

before(async () => {
  await new Promise((r) => { sunucu = app.listen(0, r); });
  taban = `http://127.0.0.1:${sunucu.address().port}`;
  await app.hazir;
  if (!PG) {
    const { PGlite } = await import('@electric-sql/pglite');
    const { postgis } = await import('@electric-sql/pglite-postgis');
    pg = await PGlite.create({ extensions: { postgis }, parsers: { 20: Number, 1700: Number } });
  }
});
after(async () => { sunucu.close(); await pg?.close(); fs.rmSync(VERI, { recursive: true, force: true }); if (dizin) fs.rmSync(dizin, { recursive: true, force: true }); });

const istemci = istemciUret(() => taban);

test('db/postgres/sema.sql güncel (npm run postgres-aktar -- --sema ile üretilen)', () => {
  const { sema, SEMA_DOSYASI } = require('../scripts/postgres-aktar');
  assert.equal(fs.readFileSync(SEMA_DOSYASI, 'utf8'), sema(), 'sema.sql eski: npm run postgres-aktar -- --sema');
});

test('örnek veri: kayıt, parsel edinme, ekim, ilan ve teklif', async () => {
  for (const ad of ['pga', 'pgb']) {
    const c = istemci();
    assert.equal((await c('/api/kayit', { email: `${ad}@test.local`, sifre: 'parola123', ad, dogumYili: 1990, kosullarOnay: true, kvkkOnay: true })).durum, 201);
    const h = hucreBul('TARIM');
    assert.equal((await c(`/api/parsel/${h}/edin`, {})).durum, 200);
    await c(`/api/parsel/${h}/ek`, { urun: 'BUGDAY' });
    if (ad === 'pga') await c(`/api/parsel/${h}/ilan`, { fiyat: 300, gun: 3 });
  }
  assert.ok((await db.get(`SELECT COUNT(*) c FROM parcels WHERE owner_user_id IS NOT NULL`)).c >= 2);
});

test('şema ve veri PostgreSQL + PostGIS üzerinde kurulur ve yüklenir (yukle.sql adım adım)', { skip: PG && 'Postgres kipinde veri zaten Postgres\'te' }, async () => {
  const { disaAktar } = require('../scripts/postgres-aktar');
  dizin = fs.mkdtempSync(path.join(os.tmpdir(), 'st-pgaktar-'));
  // Uygulamanın tutamacıyla, işlem içinde: arka plandaki bir işlemin yarım yazdıkları dışa aktarılmasın
  const ozet = await db.tx(async () => disaAktar(dizin, db.sqlite));
  await pg.exec(fs.readFileSync(path.join(dizin, 'sema.sql'), 'utf8'));
  // yukle.sql: psql meta komutları (\set, \i, \copy) PGlite'ta COPY … FROM '/dev/blob' karşılığına çevrilir
  for (const satir of fs.readFileSync(path.join(dizin, 'yukle.sql'), 'utf8').split('\n').map((x) => x.trim()).filter(Boolean)) {
    if (satir.startsWith('\\set') || satir.startsWith('\\i')) continue;
    const m = /^\\copy (\S+(?: \([^)]*\))?) FROM '([^']+)' WITH \(FORMAT csv\)$/.exec(satir);
    if (m) {
      const veri = fs.readFileSync(m[2]);
      if (!veri.length) continue;
      await pg.query(`COPY ${m[1]} FROM '/dev/blob' WITH (FORMAT csv)`, [], { blob: new Blob([veri]) });
      continue;
    }
    await pg.exec(satir);
  }
  for (const [tablo, adet] of Object.entries(ozet)) {
    const r = await pg.query(`SELECT COUNT(*)::int AS c FROM "${tablo}"`);
    assert.equal(r.rows[0].c, adet, `${tablo} satır sayısı`);
  }
  // Şema ikinci kez uygulanınca hiçbir şey bozulmaz (yükseltme yolu)
  await pg.exec(fs.readFileSync(path.join(dizin, 'sema.sql'), 'utf8'));
});

test('Postgres tarafında bütünlük: defter dengeli, denetim kaydı ve oylar değiştirilemez, benzersizlik ve yabancı anahtarlar çalışır', async () => {
  assert.equal((await pgSorgu(`SELECT COUNT(*)::int c FROM defter_dengesiz`)).rows[0].c, 0);
  await assert.rejects(pgCalistir(`UPDATE audit_events SET action = 'X' WHERE id = (SELECT MIN(id) FROM audit_events)`), /değiştirilemez/);
  await assert.rejects(pgCalistir(`DELETE FROM audit_events`), /silinemez/);
  // Oy ve katılım tablolarında satır tetikleyicileri (boş tabloda DELETE tetiklemez; varlıkları denetlenir)
  const tetik = await pgSorgu(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgrelid::regclass::text IN
    ('secim_oylari', 'secim_katilim', 'referandum_oylari', 'referandum_katilim') ORDER BY tgname`);
  assert.deepEqual(tetik.rows.map((r) => r.tgname), ['katilim_silinmez', 'oy_degismez', 'oy_silinmez', 'ref_katilim_silinmez', 'ref_oy_degismez', 'ref_oy_silinmez']);
  const u = (await pgSorgu(`SELECT email FROM users WHERE email IS NOT NULL LIMIT 1`)).rows[0];
  await assert.rejects(pgSorgu(`INSERT INTO users (email, display_name) VALUES ($1, 'kopya')`, [u.email]), /unique|benzersiz/i);
  await assert.rejects(pgCalistir(`INSERT INTO parcel_ownership (parcel_id, user_id, reason) VALUES ('YOK-1', 999999, 'X')`), /foreign key|yabancı/i);
  // Kimlik dizileri en büyük değere taşındı: yeni kullanıcı çakışmadan eklenir
  const yeni = await pgSorgu(`INSERT INTO users (email, display_name) VALUES ('yeni@pg.local', 'Yeni') RETURNING id`);
  assert.ok(yeni.rows[0].id > (await pgSorgu(`SELECT MAX(id) m FROM users WHERE email <> 'yeni@pg.local'`)).rows[0].m);
  // SQLite uyumluluk fonksiyonu
  assert.match((await pgSorgu(`SELECT datetime('now', '+1 days') AS d`)).rows[0].d, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
});

test('PostGIS: parsel geometrileri geçerli, alanlar gerçek yüzölçümüyle uyumlu, uzamsal sorgu çalışır', async () => {
  const r = await pgSorgu(`SELECT id, area_m2, ST_IsValid(geom) AS gecerli, ST_Area(geom::geography) AS alan, ST_X(merkez) AS lon, ST_Y(merkez) AS lat
                            FROM parcels WHERE owner_user_id IS NOT NULL`);
  assert.ok(r.rows.length >= 2);
  for (const p of r.rows) {
    assert.equal(p.gecerli, true);
    assert.ok(Math.abs(p.alan - p.area_m2) / p.area_m2 < 0.03, `${p.id}: PostGIS ${Math.round(p.alan)} m² ≈ oyun ${p.area_m2} m²`);
  }
  const p0 = r.rows[0];
  const yakin = await pgSorgu(`SELECT COUNT(*)::int c FROM parcels WHERE ST_DWithin(merkez::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 50000)`, [p0.lon, p0.lat]);
  assert.ok(yakin.rows[0].c >= 1);
  const il = await pgSorgu(`SELECT COUNT(*)::int c FROM regions WHERE type = 'IL' AND merkez IS NOT NULL`);
  assert.equal(il.rows[0].c, 81);
});
