// Altyapı: yapılandırılmış günlük ve hassas alan gizleme, sağlık ucu, istemci hata raporu, yedek/geri yükleme, Postgres dışa aktarımı.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ortamKur, istemciUret, hucreBul } = require('./yardimci');

const VERI = ortamKur('altyapi');
const app = require('../server/index');
const db = require('../server/db');

let sunucu, taban;
before(async () => {
  await new Promise((r) => { sunucu = app.listen(0, r); });
  taban = `http://127.0.0.1:${sunucu.address().port}`;
  await app.hazir;
});
after(() => { sunucu.close(); fs.rmSync(VERI, { recursive: true, force: true }); });
const istemci = istemciUret(() => taban);

test('günlük: hassas alanlar gizlenir, hata yığını kısaltılır', () => {
  const { temizle } = require('../server/lib/gunluk');
  const t = temizle({ sifre: 'x', email: 'a@b.c', ic: { token: 'y', yol: '/api' }, hata: new Error('patladı') });
  assert.equal(t.sifre, '[gizli]');
  assert.equal(t.email, '[gizli]');
  assert.equal(t.ic.token, '[gizli]');
  assert.equal(t.ic.yol, '/api');
  assert.equal(t.hata.ileti, 'patladı');
});

test('sağlık ucu, istek kimliği ve istemci hata raporu; hata listesi yalnızca yetkiliye', async () => {
  const r = await fetch(`${taban}/api/saglik`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('x-istek-kimligi'), /^[0-9a-f]{12}$/);
  assert.equal((await r.json()).durum, 'iyi');
  const c = istemci();
  assert.equal((await c('/api/istemci-hata', { ileti: 'TypeError: x is undefined', dosya: '/js/app.js', satir: 12 })).durum, 200);
  const satirlar = fs.readFileSync(path.join(VERI, 'gunluk', 'hatalar.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(satirlar.some((s) => s.ileti === 'istemci hatası' && s.dosya === '/js/app.js'));
  assert.equal((await c('/api/yonetim/hatalar')).durum, 401);
});

test('yedek ve geri yükleme: bütünlük denetimi, kuru çalıştırma, kenara alma', async () => {
  const c = istemci();
  await c('/api/kayit', { email: 'yedek@test.local', sifre: 'parola123', dogumYili: 1990, kosullarOnay: true, kvkkOnay: true, ad: 'Yedekçi' });
  await c(`/api/parsel/${hucreBul('TARIM')}/edin`, {});
  const { yedekAl } = require('../scripts/yedek');
  const y = await yedekAl();
  assert.ok(y.dosya.endsWith('.db.gz'));
  assert.ok(y.sayilar.users >= 1 && y.sayilar.parcels >= 1);
  // Başka bir veri dizinine geri yükle
  const hedef = fs.mkdtempSync(path.join(os.tmpdir(), 'st-geri-'));
  const { geriYukle } = require('../scripts/geri-yukle');
  const kuru = await geriYukle(y.dosya, { veri: hedef });
  assert.equal(kuru.kuru, true);
  assert.equal(fs.existsSync(path.join(hedef, 'sanalturkiye-tr.db')), false, 'kuru çalıştırma dosya yazmaz');
  fs.writeFileSync(path.join(hedef, 'sanalturkiye-tr.db'), 'eski');
  const g = await geriYukle(y.dosya, { veri: hedef, onayla: true });
  assert.ok(g.oncekiVeritabani && fs.readFileSync(g.oncekiVeritabani, 'utf8') === 'eski', 'eski veritabanı silinmez, kenara alınır');
  const Database = require('better-sqlite3');
  const kopya = new Database(path.join(hedef, 'sanalturkiye-tr.db'), { readonly: true });
  assert.equal(kopya.prepare(`SELECT COUNT(*) c FROM users WHERE email = 'yedek@test.local'`).get().c, 1);
  kopya.close();
  await assert.rejects(geriYukle(path.join(hedef, 'yok.gz'), { veri: hedef }), /bulunamadı/);
  fs.rmSync(hedef, { recursive: true, force: true });
});

test('Postgres dışa aktarımı: şema, CSV ve parsel geometrisi üretilir', () => {
  const { sema, disaAktar } = require('../scripts/postgres-aktar');
  const s = sema();
  assert.match(s, /CREATE EXTENSION IF NOT EXISTS postgis/);
  assert.match(s, /CREATE TABLE IF NOT EXISTS "users"[\s\S]*UNIQUE \("email"\)/);
  assert.match(s, /"geom" geometry\(Polygon, 4326\)/);
  assert.match(s, /CREATE TRIGGER audit_no_update/);
  const dizin = fs.mkdtempSync(path.join(os.tmpdir(), 'st-pg-'));
  const ozet = disaAktar(dizin);
  assert.equal(ozet.users, db.prepare(`SELECT COUNT(*) c FROM users`).get().c);
  const geo = fs.readFileSync(path.join(dizin, 'parcels_geom.csv'), 'utf8').trim().split('\n');
  assert.equal(geo.length, db.prepare(`SELECT COUNT(*) c FROM parcels`).get().c);
  assert.match(geo[0], /POLYGON\(\([\d. ,]+\)\)/);
  assert.match(fs.readFileSync(path.join(dizin, 'yukle.sql'), 'utf8'), /\\copy "wallet_ledger"/);
  fs.rmSync(dizin, { recursive: true, force: true });
});
