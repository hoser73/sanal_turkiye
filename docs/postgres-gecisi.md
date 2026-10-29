# PostgreSQL + PostGIS

Uygulama iki veritabanı motoruyla çalışır; seçim ortam değişkeniyle yapılır, kod aynıdır:

| | `VERITABANI=sqlite` (varsayılan) | `VERITABANI=postgres` |
|---|---|---|
| Ne için | Yerel geliştirme, testler, tek sunucu | Üretim, birden çok uygulama örneği, uzamsal sorgular |
| Bağlantı | `VERI_DIZINI/sanalturkiye-tr.db` (WAL) | `DATABASE_URL=postgres://…` (`pg` havuzu, `PG_HAVUZ`, varsayılan 10) |
| Şema | `server/vt/sema-sqlite.js` (açılışta kurulur, eksik kolonları ekler) | `db/postgres/sema.sql` (açılışta kurulur; yalnızca değiştiyse uygulanır) |
| Eşzamanlılık | Tek yazıcı: işlemler sırayla | Gerçek paralel işlemler: satır kilitleri (`FOR UPDATE`), danışma kilitleri, koşullu yazma |
| Canlı olaylar | Süreç içi | `LISTEN/NOTIFY` (bütün örneklere) |
| Bakım işleri | Süreç içinde tek kopya | `pg_try_advisory_lock` ile aynı anda tek örnekte |

Sunucusuz Postgres denemesi için gömülü PGlite (WASM, PostgreSQL 18 + PostGIS 3.6) de kullanılabilir:
`VERITABANI=postgres DATABASE_URL=pglite://bellek npm start` (bellek içi) ya da `DATABASE_URL=pglite:data/pglite` (dizinde
kalıcı). PGlite tek bağlantılıdır; üretim için değildir (`server/yapilandirma.js` üretimde reddeder).

## Veri katmanı

Bütün modüller `server/db.js` üzerinden zaman uyumsuz çalışır:

```js
const u = await db.get(`SELECT * FROM users WHERE id = ?`, id);
await db.tx(async () => {                       // BEGIN … COMMIT; hata → ROLLBACK
  const p = await db.get(`SELECT * FROM parcels WHERE id = ? FOR UPDATE`, parselId);   // SQLite'ta FOR UPDATE düşer
  await L.harca(u.id, bedel, 'Parsel');        // defter de aynı işlemde (AsyncLocalStorage ile aynı bağlantı)
  await db.run(`UPDATE parcels SET owner_user_id = ? WHERE id = ? AND owner_user_id IS NULL`, u.id, p.id);
});
```

- İç içe `db.tx` kayıt noktası (SAVEPOINT) açar: içteki hata yalnızca kendi yazdıklarını geri alır.
- Postgres'te kilitlenme (`40P01`) ya da seri hale getirme hatası (`40001`) olursa işlem baştan, en çok 5 kez denenir.
  İşlem sonrası olaylar (`db.sonra`, `olaylar.yay`) yalnızca kayıttan sonra yayılır; yeniden denemede çift olay çıkmaz.
- Para defteri (`server/lib/ledger.js`): harcama yapılan hesap (`U:<id>`, `ESCROW:…`) ve envanter düşümünde oyuncu + ürün,
  bakiye denetiminden önce işlem sonuna kadar kilitlenir (`pg_advisory_xact_lock`). Böylece aynı hesaptan eşzamanlı iki
  harcama bakiyeyi aşamaz (`test/eszamanlilik.test.js`). Defter fonksiyonları işlem dışında çağrılırsa hata verir.
- Durum geçişleri (ilan, teklif, seçim evresi, sipariş, kira, ödül talebi …) koşullu `UPDATE … WHERE durum = …` ya da
  `SELECT … FOR UPDATE` ile yazılır; aynı anda gelen ikinci istek 409 alır.
- SQL iki motorda da çalışan alt kümeyle yazılır; küçük farkları `server/vt/cevir.js` kapatır (`?` → `$n`,
  `INSERT OR IGNORE` → `ON CONFLICT DO NOTHING`, camelCase takma adlar, `RETURNING id`, SQLite'ta `FOR UPDATE` ve
  `GREATEST/LEAST`). Postgres'te `datetime('now'[, '+N days'])` SQL fonksiyonu tanımlıdır (tarihler UTC metin olarak saklanır).

## Çok sunucu

- **Olaylar:** `server/lib/olaylar.js` iki yol sunar. `yayin` her örnekte tetiklenir (Postgres `NOTIFY sanalturkiye_olay`)
  ve canlı bağlantılara iletilir (`server/canli.js`). `yol` yalnızca olayı doğuran örnekte tetiklenir: TP, meslek puanı,
  web push ve demo sakin yanıtı gibi yan etkili dinleyiciler bir kez çalışır.
- **Bakım işleri:** istek başına tembel bakım turu (inşaat tamamlama, pazar, seçim/belediye evreleri, borsa, sezon, hava,
  lojistik, kira, referandum), posta kuyruğu, oturum temizliği ve demo nüfus döngüsü `db.tekOrnek(ad, fn)` ile çalışır:
  süreç içinde tek kopya, Postgres'te `pg_try_advisory_lock` ile aynı anda tek örnek (kilidi başka örnek tutuyorsa tur
  atlanır). Posta kuyruğundaki ileti göndermeden önce koşullu yazmayla sahiplenilir (`BEKLIYOR` → `GONDERILIYOR`); SMTP
  işlem dışında yapılır, yarıda kalan ileti bir dakika sonra kuyruğa döner.
- **Şema:** açılışta danışma kilidiyle sıraya girilir; aynı anda açılan örnekler şemayı bir kez kurar.
- `PG_SEMA=ad`: tablolar bu Postgres şemasında tutulur (`search_path = ad, public`); olay kanalı ve kilit anahtarları da
  şema adını içerir. Aynı veritabanını paylaşan ayrı kurulumlar (ör. testler) birbirine karışmaz.

## Bütünlük güvenceleri (iki motorda da)

- `audit_events` değiştirilemez ve silinemez (tetikleyici).
- Gizli oy: `secim_oylari` / `referandum_oylari` yalnızca makbuz özeti ve tercihi tutar (kimlik, zaman, sıra kolonu yok),
  değiştirilemez ve silinemez; `secim_katilim` / `referandum_katilim` silinemez.
  **Postgres'e özgü not:** her satır, onu yazan işlemin kimliğini (`xmin`) ve fiziksel konumunu (`ctid`) taşır. Oy ve
  katılım satırı aynı işlemde yazıldığından, veritabanını doğrudan okuyabilen biri oylama sürerken ikisini eşleyebilir.
  Bu yüzden oylama kapanınca uygulama `oy_sandigini_karistir(tablo, kolon, kimlik)` fonksiyonunu çağırır: o seçimin
  oyları tek işlemde rastgele sırayla yeniden yazılır (hepsi aynı `xmin`'i alır, sıra kaybolur; içerik özetle denetlenir).
  Oylama sürerken veritabanına doğrudan okuma yetkisi yalnızca işletmecide olmalı; analiz rolleri oy tablolarını okumamalı.
  Ölü satırlar `VACUUM` ile temizlenir (otomatik vakum yeterli; hassas seçimlerden sonra `VACUUM secim_oylari` önerilir).
- Para tutarları `NUMERIC(14,2)`; `defter_dengesiz` görünümü dengesiz işlem gruplarını listeler (boş olmalı).
- Parsel geometrisi (`parcels.geom`, `merkez`) ve il/ilçe merkezleri (`regions.merkez`) tetikleyicilerle ızgaradan türetilir
  (`ST_TileEnvelope(20, x, y)`), GIST indekslidir. Örnek: `SELECT id FROM parcels WHERE ST_DWithin(merkez::geography,
  ST_SetSRID(ST_MakePoint(32.49, 37.87), 4326)::geography, 500)`.

## Var olan SQLite kurulumunu taşıma

1. **Postgres + PostGIS hazırla** (docker-compose ile gelir; elle kurulumda `CREATE EXTENSION postgis` yetkisi gerekir).
   Veritabanını `C.UTF-8` yereliyle açın (`initdb --locale=C.UTF-8`); metin sıralaması SQLite'takiyle aynı olur.
2. **Sunucuyu durdur** (yazma olmasın) ve SQLite'tan dışa aktar:
   ```bash
   VERI_DIZINI=/veri npm run postgres-aktar -- --disa-aktar /veri/postgres-aktarim
   ```
   Her tablo için CSV, `sema.sql` ve `yukle.sql` yazılır. Önce SQLite dosyasının yedeğini alın (`npm run yedek`).
3. **Yükle** (boş veritabanına; tek işlemde, yabancı anahtarlar COMMIT'te denetlenir):
   ```bash
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /veri/postgres-aktarim/yukle.sql
   ```
   Yükleme parsel geometrilerini üretir ve ızgara hesabıyla karşılaştırır, kimlik dizilerini en büyük değere taşır,
   `ANALYZE` çalıştırır. Docker'da: `docker compose cp` ile dizini `postgres` kabına kopyalayıp
   `docker compose exec postgres psql -U sanalturkiye -d sanalturkiye -f …` kullanın.
4. **Denetle:**
   ```sql
   SELECT COUNT(*) FROM defter_dengesiz;        -- 0 olmalı
   SELECT COUNT(*) FROM users; SELECT COUNT(*) FROM wallet_ledger;   -- dışa aktarım çıktısındaki sayılarla aynı
   ```
5. **Geç:** `.env`'de `VERITABANI=postgres` ve `DATABASE_URL`'i ayarlayıp sunucuyu başlatın (docker-compose bunu zaten
   yapar). SQLite dosyasını bir süre silmeyin; geri dönüş için `VERITABANI=sqlite` yeterlidir (arada yazılan veri hariç).

## Şema değişikliği

Tek kaynak SQLite şemasıdır (`server/vt/sema-sqlite.js`). Tablo/kolon/indeks/tetikleyici ekledikten sonra:

```bash
npm run postgres-aktar -- --sema     # db/postgres/sema.sql yeniden üretilir
```

`test/postgres.test.js` depodaki `sema.sql`'in güncel olduğunu denetler. Üretilen şemanın her adımı tekrar
çalıştırılabilir (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, adlı kısıtlar, `CREATE OR REPLACE`): yeni
sürüm eski veritabanına açılışta uygulanınca yalnızca eksikler eklenir. Kolon silme / tür değiştirme gibi yıkıcı
değişiklikler elle taşıma ister.

## Testler

```bash
npm test                                     # SQLite
npm run test:pg                              # PostgreSQL 18 + PostGIS (gömülü PGlite; sunucu gerekmez)
VERITABANI=postgres DATABASE_URL=postgres://kullanici:parola@127.0.0.1:5432/sanalturkiye_test npm test
                                             # gerçek sunucu: her test dosyası kendi şemasında (PG_SEMA=test_…)
```

PGlite tek bağlantılı olduğundan işlemleri sıraya koyar; gerçek paralel kilit davranışı (`test/eszamanlilik.test.js`)
yalnızca gerçek bir Postgres sunucusunda sınanır. Yayından önce test takımını bir kez gerçek sunucuya karşı çalıştırın
(docker-compose'daki `postgres` hizmeti ya da ayrı bir test veritabanı). Test şemaları silinmez:
`SELECT 'DROP SCHEMA ' || nspname || ' CASCADE;' FROM pg_namespace WHERE nspname LIKE 'test\_%'`.
