// PostgreSQL + PostGIS aktarımı: scripts/postgres-aktar.js çıktısı (sema.sql + CSV + yukle.sql) gerçek bir PostgreSQL 18 +
// PostGIS 3.6 motorunda (PGlite, WASM) çalıştırılır: tablo/indeks/kısıt/tetikleyici kurulur, veri yüklenir, defter dengesi,
// değiştirilemez denetim kaydı ve uzamsal sorgular doğrulanır.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ortamKur, istemciUret, hucreBul } = require('./yardimci');

const VERI = ortamKur('postgres');
const app = require('../server/index');
const db = require('../server/db');

let sunucu, taban, pg, dizin;
before(async () => {
  await new Promise((r) => { sunucu = app.listen(0, r); });
  taban = `http://127.0.0.1:${sunucu.address().port}`;
  await app.hazir;
  const { PGlite } = await import('@electric-sql/pglite');
  const { postgis } = await import('@electric-sql/pglite-postgis');
  pg = await PGlite.create({ extensions: { postgis } });
});
after(async () => { sunucu.close(); await pg?.close(); fs.rmSync(VERI, { recursive: true, force: true }); if (dizin) fs.rmSync(dizin, { recursive: true, force: true }); });

const istemci = istemciUret(() => taban);

test('örnek veri: kayıt, parsel edinme, ekim, ilan ve teklif', async () => {
  for (const ad of ['pga', 'pgb']) {
    const c = istemci();
    assert.equal((await c('/api/kayit', { email: `${ad}@test.local`, sifre: 'parola123', ad, dogumYili: 1990, kosullarOnay: true, kvkkOnay: true })).durum, 201);
    const h = hucreBul('TARIM');
    assert.equal((await c(`/api/parsel/${h}/edin`, {})).durum, 200);
    await c(`/api/parsel/${h}/ek`, { urun: 'BUGDAY' });
    if (ad === 'pga') await c(`/api/parsel/${h}/ilan`, { fiyat: 300, gun: 3 });
  }
  assert.ok(db.prepare(`SELECT COUNT(*) c FROM parcels WHERE owner_user_id IS NOT NULL`).get().c >= 2);
});

test('şema ve veri PostgreSQL + PostGIS üzerinde kurulur ve yüklenir (yukle.sql adım adım)', async () => {
  const { disaAktar } = require('../scripts/postgres-aktar');
  dizin = fs.mkdtempSync(path.join(os.tmpdir(), 'st-pgaktar-'));
  const ozet = disaAktar(dizin);
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
});

test('Postgres tarafında bütünlük: defter dengeli, denetim kaydı değiştirilemez, benzersizlik ve yabancı anahtarlar çalışır', async () => {
  assert.equal((await pg.query(`SELECT COUNT(*)::int c FROM defter_dengesiz`)).rows[0].c, 0);
  await assert.rejects(pg.exec(`UPDATE audit_events SET action = 'X' WHERE id = (SELECT MIN(id) FROM audit_events)`), /değiştirilemez/);
  await assert.rejects(pg.exec(`DELETE FROM audit_events`), /değiştirilemez/);
  const u = (await pg.query(`SELECT email FROM users WHERE email IS NOT NULL LIMIT 1`)).rows[0];
  await assert.rejects(pg.query(`INSERT INTO users (email, display_name) VALUES ($1, 'kopya')`, [u.email]), /unique|benzersiz/i);
  await assert.rejects(pg.exec(`INSERT INTO parcel_ownership (parcel_id, user_id, reason) VALUES ('YOK-1', 999999, 'X')`), /foreign key|yabancı/i);
  // Kimlik dizileri en büyük değere taşındı: yeni kullanıcı çakışmadan eklenir
  const yeni = await pg.query(`INSERT INTO users (email, display_name) VALUES ('yeni@pg.local', 'Yeni') RETURNING id`);
  assert.ok(yeni.rows[0].id > (await pg.query(`SELECT MAX(id) m FROM users WHERE email <> 'yeni@pg.local'`)).rows[0].m);
});

test('PostGIS: parsel geometrileri geçerli, alanlar gerçek yüzölçümüyle uyumlu, uzamsal sorgu çalışır', async () => {
  const r = await pg.query(`SELECT id, area_m2, ST_IsValid(geom) AS gecerli, ST_Area(geom::geography) AS alan, ST_X(merkez) AS lon, ST_Y(merkez) AS lat
                            FROM parcels WHERE owner_user_id IS NOT NULL`);
  assert.ok(r.rows.length >= 2);
  for (const p of r.rows) {
    assert.equal(p.gecerli, true);
    assert.ok(Math.abs(p.alan - p.area_m2) / p.area_m2 < 0.03, `${p.id}: PostGIS ${Math.round(p.alan)} m² ≈ oyun ${p.area_m2} m²`);
  }
  const p0 = r.rows[0];
  const yakin = await pg.query(`SELECT COUNT(*)::int c FROM parcels WHERE ST_DWithin(merkez::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 50000)`, [p0.lon, p0.lat]);
  assert.ok(yakin.rows[0].c >= 1);
  const il = await pg.query(`SELECT COUNT(*)::int c FROM regions WHERE type = 'IL' AND merkez IS NOT NULL`);
  assert.equal(il.rows[0].c, 81);
});
