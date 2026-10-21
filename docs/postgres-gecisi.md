# PostgreSQL + PostGIS geçişi

Prototip tek dosya SQLite (WAL) üzerinde çalışır ve tek sunucu için yeterlidir. Çok sunuculu ölçek, uzamsal sorgular
(ör. "bu çokgenin içindeki parseller") ve eşzamanlı yazma için PostgreSQL + PostGIS hedeflenir.

## Hazır olanlar

- `npm run postgres-aktar -- --sema` → `db/postgres/sema.sql`: SQLite şemasından üretilen DDL (tablolar, birincil/benzersiz
  anahtarlar, yabancı anahtarlar `NOT VALID`, kısmi indeksler), `parcels.geom` (hücre poligonu) ve `merkez` noktaları için
  GIST indeksleri, denetim kaydının değiştirilemezliğini sağlayan tetikleyici ve `defter_dengesiz` denetim görünümü.
- `npm run postgres-aktar -- --disa-aktar data/postgres-aktarim` → her tablo için CSV, parsel geometrileri (WKT) ve
  `yukle.sql`. Yükleme: `psql "$DATABASE_URL" -f data/postgres-aktarim/yukle.sql`.

**Uyarı:** Bu betikler bu ortamda bir PostgreSQL sunucusuna karşı çalıştırılmadı; ilk denemeyi bir hazırlık veritabanında
yapın ve `SELECT * FROM defter_dengesiz` ile defterin dengeli geldiğini doğrulayın.

## Kalan iş (uygulama katmanı)

Uygulama `better-sqlite3`'ün senkron API'sini ve `db.transaction(fn)` sarmalayıcısını kullanır. Postgres'e geçişte:

1. Veri erişimini `pg` havuzuna taşıyın; her modüldeki `db.prepare(...).get/all/run` çağrıları `await client.query(...)` olur.
   İşlemler `BEGIN … COMMIT` ile ve `SELECT … FOR UPDATE` kilitleriyle yazılmalı (şu an SQLite tek yazıcı olduğu için
   optimistik sürüm kolonları ve koşullu `UPDATE … WHERE durum = …` desenleri kullanılıyor; bunlar Postgres'te de geçerlidir).
2. `?` yer tutucuları `$1, $2…` olur; `datetime('now')` yerine `now()`, `INSERT OR IGNORE` yerine `ON CONFLICT DO NOTHING`.
3. Tembel bakım işleri (seçim, pazar, belediye, hava…) çok sunucuda yarışmamak için `pg_try_advisory_lock` ile tek
   örnekte çalıştırılmalı ya da ayrı bir zamanlayıcı sürecine taşınmalı.
4. WebSocket yayını tek süreç içi olay yolundadır (`server/lib/olaylar.js`); birden fazla sunucuda Postgres
   `LISTEN/NOTIFY` ya da Redis yayın/abone ile köprülenmelidir.
