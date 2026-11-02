// Veritabanı: SQLite (prototip). Tablo adları plan §13.3 ile aynı tutuldu.
// Ulusal sürüm (v3): parseller z20 ızgara hücreleridir; geometri hücre koordinatından hesaplanır
// (grid_x, grid_y). İleride PostgreSQL + PostGIS'e taşınabilir.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const VERI_DIZINI = process.env.VERI_DIZINI || path.join(__dirname, '..', 'data');
fs.mkdirSync(VERI_DIZINI, { recursive: true });

// Not: v0.1–0.2'nin Meram ızgarası (data/sanalturkiye.db) ulusal ızgarayla uyumsuz olduğundan ayrı dosyada kalır.
const db = new Database(path.join(VERI_DIZINI, 'sanalturkiye-tr.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
// WAL'da NORMAL güvenli ve her işlemde diske zorla yazmayı (fsync) bekletmez: yazmalar olay döngüsünü kilitlemez
db.pragma('synchronous = NORMAL');
db.pragma('temp_store = MEMORY');
db.pragma('cache_size = -65536');   // 64 MB sayfa önbelleği

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  email         TEXT UNIQUE,
  password_hash TEXT,
  display_name  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'ACTIVE',   -- ACTIVE / SUSPENDED
  trust_level   INTEGER NOT NULL DEFAULT 0,
  is_npc        INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

-- Türkiye → İl (81) → İlçe (973) → Mahalle (gerçek yerleşim noktalarından, ihtiyaç anında)
CREATE TABLE IF NOT EXISTS regions (
  id             INTEGER PRIMARY KEY,
  parent_id      INTEGER REFERENCES regions(id),
  type           TEXT NOT NULL,                  -- ULKE / IL / ILCE / MAHALLE
  code           TEXT NOT NULL UNIQUE,           -- TR / TR-42 / TR-42-meram / TR-42-meram-<osm id>
  name           TEXT NOT NULL,
  plaka          TEXT,
  center_lon     REAL,
  center_lat     REAL,
  bbox           TEXT,                           -- [w, s, e, n]
  place_class    TEXT,                           -- mahalle: suburb / village / ...
  source_idx     INTEGER,                        -- ilçe: server/veri/ilceler.json sırası
  attractiveness REAL NOT NULL DEFAULT 1.0,
  playable       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_regions_parent ON regions(parent_id);
CREATE INDEX IF NOT EXISTS ix_regions_type ON regions(type);

-- Parsel = ulusal ızgaranın bir hücresi (Web Mercator z20). Yalnızca dokunulan hücreler kaydedilir.
CREATE TABLE IF NOT EXISTS parcels (
  id            TEXT PRIMARY KEY,                -- TR-<x7>-<y7> (değişmez)
  region_id     INTEGER NOT NULL REFERENCES regions(id),   -- mahalle
  ilce_id       INTEGER NOT NULL REFERENCES regions(id),
  il_id         INTEGER NOT NULL REFERENCES regions(id),
  district_code TEXT NOT NULL,                   -- ilçe kodu
  area_m2       INTEGER NOT NULL,                -- hücrenin gerçek yüzölçümü (≈ 800–1.000 m²)
  zoning_type   TEXT NOT NULL,                   -- edinme anında sabitlenir
  zoning_source TEXT NOT NULL,                   -- OSM veri sürümü
  centroid_lon  REAL NOT NULL,
  centroid_lat  REAL NOT NULL,
  grid_x        INTEGER NOT NULL,
  grid_y        INTEGER NOT NULL,
  owner_user_id INTEGER REFERENCES users(id),
  status        TEXT NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE / FROZEN
  geom_version  TEXT NOT NULL DEFAULT 'z20-v1',
  version       INTEGER NOT NULL DEFAULT 0,      -- optimistik kilit
  acquired_at   TEXT
);
CREATE INDEX IF NOT EXISTS ix_parcels_owner  ON parcels(owner_user_id);
CREATE INDEX IF NOT EXISTS ix_parcels_region ON parcels(region_id);
CREATE INDEX IF NOT EXISTS ix_parcels_il ON parcels(il_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_parcels_grid ON parcels(grid_x, grid_y);

-- İmar karosu önbelleği: z14 karo başına 4.096 hücrenin imar kodu ve ilçesi
CREATE TABLE IF NOT EXISTS imar_karolari (
  kx         INTEGER NOT NULL,
  ky         INTEGER NOT NULL,
  surum      INTEGER NOT NULL,
  kod        BLOB NOT NULL,
  ilce       BLOB NOT NULL,
  kaynak     TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (kx, ky)
);

-- Gazetteer: OSM yerleşim noktaları (mahalle ataması ve arama)
CREATE TABLE IF NOT EXISTS yerler (
  id       TEXT PRIMARY KEY,
  ad       TEXT NOT NULL,
  ad_norm  TEXT NOT NULL,
  sinif    TEXT NOT NULL,
  lon      REAL NOT NULL,
  lat      REAL NOT NULL,
  ilce_idx INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_yerler_konum ON yerler(ilce_idx, lon, lat);
CREATE INDEX IF NOT EXISTS ix_yerler_ad ON yerler(ad_norm);

CREATE TABLE IF NOT EXISTS parcel_ownership (
  id        INTEGER PRIMARY KEY,
  parcel_id TEXT NOT NULL REFERENCES parcels(id),
  user_id   INTEGER NOT NULL REFERENCES users(id),
  start_at  TEXT NOT NULL DEFAULT (datetime('now')),
  end_at    TEXT,
  reason    TEXT NOT NULL,                       -- PRIMARY_ALLOCATION / TRADE / ...
  price     REAL
);
-- Bir parselin aynı anda yalnızca bir açık sahiplik kaydı olabilir
CREATE UNIQUE INDEX IF NOT EXISTS ux_ownership_open ON parcel_ownership(parcel_id) WHERE end_at IS NULL;

CREATE TABLE IF NOT EXISTS structures (
  id            INTEGER PRIMARY KEY,
  parcel_id     TEXT NOT NULL REFERENCES parcels(id),
  owner_user_id INTEGER NOT NULL REFERENCES users(id),
  type          TEXT NOT NULL,
  level         INTEGER NOT NULL DEFAULT 1,
  health        INTEGER NOT NULL DEFAULT 100,
  footprint_m2  REAL NOT NULL DEFAULT 0,
  floor_area_m2 REAL NOT NULL DEFAULT 0,
  status        TEXT NOT NULL,                   -- BUILDING / ACTIVE
  started_at    INTEGER NOT NULL,                -- epoch ms
  completes_at  INTEGER NOT NULL,
  completed_at  INTEGER
);
CREATE INDEX IF NOT EXISTS ix_structures_parcel ON structures(parcel_id);

CREATE TABLE IF NOT EXISTS crops (
  id              INTEGER PRIMARY KEY,
  parcel_id       TEXT NOT NULL REFERENCES parcels(id),
  user_id         INTEGER NOT NULL REFERENCES users(id),
  crop_type       TEXT NOT NULL,
  planted_at      INTEGER NOT NULL,
  ready_at        INTEGER NOT NULL,
  waterings       INTEGER NOT NULL DEFAULT 0,
  last_watered_at INTEGER,
  status          TEXT NOT NULL DEFAULT 'GROWING', -- GROWING / HARVESTED
  harvested_qty   INTEGER
);
-- Bir tarlada aynı anda tek ekin
CREATE UNIQUE INDEX IF NOT EXISTS ux_crops_active ON crops(parcel_id) WHERE status = 'GROWING';

-- Çift kayıtlı defter: her tx_group'ta borç toplamı = alacak toplamı.
-- Hesaplar: U:<userId>, SYS:MINT (oyuna giren), SYS:SINK (oyundan çıkan), SYS:NPC (NPC pazar)
CREATE TABLE IF NOT EXISTS wallet_ledger (
  id         INTEGER PRIMARY KEY,
  account    TEXT NOT NULL,
  user_id    INTEGER REFERENCES users(id),
  unit       TEXT NOT NULL DEFAULT 'AKCE',
  debit      REAL NOT NULL DEFAULT 0,
  credit     REAL NOT NULL DEFAULT 0,
  tx_group   TEXT NOT NULL,
  reason     TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_wallet_user ON wallet_ledger(user_id);
CREATE INDEX IF NOT EXISTS ix_wallet_tx   ON wallet_ledger(tx_group);

CREATE TABLE IF NOT EXISTS inventory_ledger (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  item_id    TEXT NOT NULL,
  delta      INTEGER NOT NULL,
  reason     TEXT NOT NULL,
  tx_group   TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_inventory_user ON inventory_ledger(user_id, item_id);

-- NPC taban talebi: gün + ürün başına satılan miktar (§5.2 sınırlı talep)
-- Oyuncu başına günlük NPC satışı (kişisel taban için)
CREATE TABLE IF NOT EXISTS npc_kisisel (
  day     TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  item_id TEXT NOT NULL,
  sold    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, user_id, item_id)
);
CREATE TABLE IF NOT EXISTS npc_demand (
  day     TEXT NOT NULL,
  item_id TEXT NOT NULL,
  sold    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, item_id)
);

CREATE TABLE IF NOT EXISTS quest_progress (
  user_id      INTEGER NOT NULL REFERENCES users(id),
  quest_code   TEXT NOT NULL,
  completed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, quest_code)
);

CREATE TABLE IF NOT EXISTS visits (
  id         INTEGER PRIMARY KEY,
  visitor_id INTEGER NOT NULL REFERENCES users(id),
  parcel_id  TEXT NOT NULL REFERENCES parcels(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Olay tabanlı akış (§13.4): idempotency_key tekrar oynatmada ikinci etkiyi engeller.
-- Değişmez denetim kaydı (§14.1): UPDATE/DELETE yapılmaz.
CREATE TABLE IF NOT EXISTS audit_events (
  id              INTEGER PRIMARY KEY,
  idempotency_key TEXT UNIQUE,
  actor_id        INTEGER,
  action          TEXT NOT NULL,              -- PARCEL_ACQUIRED, STRUCTURE_STARTED, ...
  entity          TEXT,
  before_json     TEXT,
  after_json      TEXT,
  region_id       INTEGER,
  public          INTEGER NOT NULL DEFAULT 0, -- mahalle haber akışında görünsün mü
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_audit_region ON audit_events(region_id, id);
CREATE INDEX IF NOT EXISTS ix_audit_entity ON audit_events(entity, id);

-- ---------- Oyuncular arası pazar (§8) ----------
CREATE TABLE IF NOT EXISTS listings (
  id              INTEGER PRIMARY KEY,
  parcel_id       TEXT NOT NULL REFERENCES parcels(id),
  seller_id       INTEGER NOT NULL REFERENCES users(id),
  asking_price    INTEGER NOT NULL,              -- satıcının istediği fiyat; gerçekleşmiş fiyat DEĞİL
  listing_currency TEXT NOT NULL DEFAULT 'AKCE', -- yalnızca oyun birimi (gerçek para modeli hukuk kapısında)
  asset_snapshot  TEXT NOT NULL,                 -- ilan anındaki parsel/yapı/ekin/hak listesi
  fee_rate        REAL NOT NULL,
  buyer_condition TEXT NOT NULL DEFAULT 'HERKES',
  status          TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE / SOLD / CANCELLED / EXPIRED
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,
  closed_at       INTEGER,
  version         INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_listings_active ON listings(parcel_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS ix_listings_status ON listings(status, expires_at);

-- Her teklifin tutarı ESCROW:BID:<id> hesabında kilitli tutulur
CREATE TABLE IF NOT EXISTS bids (
  id         INTEGER PRIMARY KEY,
  listing_id INTEGER NOT NULL REFERENCES listings(id),
  buyer_id   INTEGER NOT NULL REFERENCES users(id),
  amount     INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'ACTIVE',     -- ACTIVE / ACCEPTED / REJECTED / WITHDRAWN / REPLACED / CANCELLED / EXPIRED
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bids_active ON bids(listing_id, buyer_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS ix_bids_buyer ON bids(buyer_id, status);

CREATE TABLE IF NOT EXISTS trades (
  id             INTEGER PRIMARY KEY,
  listing_id     INTEGER NOT NULL UNIQUE REFERENCES listings(id),   -- bir ilan en fazla bir kez satılır
  parcel_id      TEXT NOT NULL REFERENCES parcels(id),
  seller_id      INTEGER NOT NULL REFERENCES users(id),
  buyer_id       INTEGER NOT NULL REFERENCES users(id),
  price          INTEGER NOT NULL,
  fee            INTEGER NOT NULL,
  via            TEXT NOT NULL,                  -- BID / BUY_NOW
  asset_snapshot TEXT NOT NULL,                  -- devir anındaki varlıklar
  flags          TEXT NOT NULL DEFAULT '[]',     -- manipülasyon şüphesi (§8.5, §10.3)
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_trades_parcel ON trades(parcel_id, id);
CREATE INDEX IF NOT EXISTS ix_trades_pair ON trades(seller_id, buyer_id);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  text       TEXT NOT NULL,
  link       TEXT,
  read_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_notifications_user ON notifications(user_id, id);

-- ---------- Mahalle muhtarlığı seçimi (§6, §14.3) ----------
CREATE TABLE IF NOT EXISTS secimler (
  id          INTEGER PRIMARY KEY,
  region_id   INTEGER NOT NULL REFERENCES regions(id),     -- mahalle
  tur         TEXT NOT NULL DEFAULT 'MUHTAR',
  asama       TEXT NOT NULL,      -- DUYURU / ADAYLIK / KAMPANYA / OYLAMA / ITIRAZ / SONUCLANDI / IPTAL / ADAY_YOK
  duyuru_at   INTEGER NOT NULL,   -- aşama başlangıçları (epoch ms); takvim baştan bellidir
  adaylik_at  INTEGER NOT NULL,
  kampanya_at INTEGER NOT NULL,
  oylama_at   INTEGER NOT NULL,
  itiraz_at   INTEGER NOT NULL,
  bitis_at    INTEGER NOT NULL,
  sonuc_json  TEXT,               -- sayım, katılım, denetim bulguları
  ozet_hash   TEXT,               -- oy pusulalarının özeti (bağımsız yeniden sayım için)
  kazanan_aday_id INTEGER,
  iptal_sebebi TEXT,
  created_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_secim_aktif ON secimler(region_id)
  WHERE asama IN ('DUYURU','ADAYLIK','KAMPANYA','OYLAMA','ITIRAZ');
CREATE INDEX IF NOT EXISTS ix_secim_region ON secimler(region_id, id);

CREATE TABLE IF NOT EXISTS adaylar (
  id         INTEGER PRIMARY KEY,
  secim_id   INTEGER NOT NULL REFERENCES secimler(id),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  manifesto  TEXT NOT NULL,
  vaatler    TEXT NOT NULL DEFAULT '[]',
  butce      INTEGER,            -- tahmini bütçe (akçe), bilgi amaçlı
  durum      TEXT NOT NULL DEFAULT 'AKTIF',   -- AKTIF / CEKILDI / DUSTU (kütükte yer alamadı)
  created_at INTEGER NOT NULL,
  UNIQUE (secim_id, user_id)
);

-- Seçmen kütüğü: kampanya başında dondurulur (sonradan parsel alarak oy kazanılamaz)
CREATE TABLE IF NOT EXISTS secmen_kutugu (
  secim_id INTEGER NOT NULL REFERENCES secimler(id),
  user_id  INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (secim_id, user_id)
) WITHOUT ROWID;

-- GİZLİLİK (§14.3): katılım ile oy ayrı tablolardadır.
--   secim_katilim: KİM oy kullandı (tekil oy denetimi). Seçimi içermez; zaman yalnızca gün olarak tutulur.
--   secim_oylari : NE oylandı. Kullanıcı kimliği yoktur; birincil anahtar rastgele makbuz özetidir ve
--                  tablo ROWID'siz olduğundan ekleme sırası (zamanlama ile eşleştirme) saklanmaz.
CREATE TABLE IF NOT EXISTS secim_katilim (
  secim_id    INTEGER NOT NULL REFERENCES secimler(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  gun         TEXT NOT NULL,
  cihaz_ozeti TEXT NOT NULL,      -- tuzlanmış IP + tarayıcı özeti: çoklu hesap tespiti için
  PRIMARY KEY (secim_id, user_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS secim_oylari (
  makbuz_ozeti TEXT PRIMARY KEY,
  secim_id     INTEGER NOT NULL REFERENCES secimler(id),
  aday_id      INTEGER NOT NULL REFERENCES adaylar(id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ix_oylar_secim ON secim_oylari(secim_id, aday_id);
CREATE TRIGGER IF NOT EXISTS oy_degismez BEFORE UPDATE ON secim_oylari BEGIN SELECT RAISE(ABORT, 'oylar değiştirilemez'); END;
CREATE TRIGGER IF NOT EXISTS oy_silinmez BEFORE DELETE ON secim_oylari BEGIN SELECT RAISE(ABORT, 'oylar silinemez'); END;
CREATE TRIGGER IF NOT EXISTS katilim_silinmez BEFORE DELETE ON secim_katilim BEGIN SELECT RAISE(ABORT, 'katılım kaydı silinemez'); END;

CREATE TABLE IF NOT EXISTS itirazlar (
  id         INTEGER PRIMARY KEY,
  secim_id   INTEGER NOT NULL REFERENCES secimler(id),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  sebep      TEXT NOT NULL,
  durum      TEXT NOT NULL DEFAULT 'INCELEMEDE',   -- INCELEMEDE / KABUL / RED
  yanit      TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (secim_id, user_id)
);

CREATE TABLE IF NOT EXISTS muhtarlar (
  id        INTEGER PRIMARY KEY,
  region_id INTEGER NOT NULL REFERENCES regions(id),
  user_id   INTEGER NOT NULL REFERENCES users(id),
  secim_id  INTEGER NOT NULL REFERENCES secimler(id),
  aday_id   INTEGER NOT NULL REFERENCES adaylar(id),
  baslangic INTEGER NOT NULL,
  bitis     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_muhtar_region ON muhtarlar(region_id, bitis);

-- Vaat takip ekranı (§6.2): muhtarın vaatlerinin ilerleyişi
CREATE TABLE IF NOT EXISTS vaat_takip (
  id         INTEGER PRIMARY KEY,
  muhtar_id  INTEGER NOT NULL REFERENCES muhtarlar(id),
  sira       INTEGER NOT NULL,
  metin      TEXT NOT NULL,
  durum      TEXT NOT NULL DEFAULT 'BEKLIYOR',   -- BEKLIYOR / BASLADI / TAMAMLANDI / VAZGECILDI
  aciklama   TEXT,
  updated_at INTEGER NOT NULL,
  UNIQUE (muhtar_id, sira)
);

CREATE TABLE IF NOT EXISTS mahalle_duyurulari (
  id         INTEGER PRIMARY KEY,
  region_id  INTEGER NOT NULL REFERENCES regions(id),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  metin      TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_duyuru_region ON mahalle_duyurulari(region_id, id);

CREATE TABLE IF NOT EXISTS ayarlar (anahtar TEXT PRIMARY KEY, deger TEXT NOT NULL) WITHOUT ROWID;

-- ---------- İlçe belediyesi (§6.1, §6.3, §6.4) ----------
-- Seçilmiş başkan ve meclis üyeleri (başkan meclise başkanlık eder, oy kullanır)
CREATE TABLE IF NOT EXISTS belediye_uyeleri (
  id        INTEGER PRIMARY KEY,
  region_id INTEGER NOT NULL REFERENCES regions(id),   -- ilçe
  user_id   INTEGER NOT NULL REFERENCES users(id),
  makam     TEXT NOT NULL,                             -- BASKAN / MECLIS
  secim_id  INTEGER NOT NULL REFERENCES secimler(id),
  aday_id   INTEGER NOT NULL REFERENCES adaylar(id),
  baslangic INTEGER NOT NULL,
  bitis     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_bel_uye ON belediye_uyeleri(region_id, bitis);
CREATE TABLE IF NOT EXISTS gorev_vaatleri (
  id         INTEGER PRIMARY KEY,
  uye_id     INTEGER NOT NULL REFERENCES belediye_uyeleri(id),
  sira       INTEGER NOT NULL,
  metin      TEXT NOT NULL,
  durum      TEXT NOT NULL DEFAULT 'BEKLIYOR',
  aciklama   TEXT,
  updated_at INTEGER NOT NULL,
  UNIQUE (uye_id, sira)
);
-- Günlük devlet katkısı: (ilçe, oyun günü) başına bir kez
CREATE TABLE IF NOT EXISTS belediye_katki_gunleri (
  region_id INTEGER NOT NULL,
  gun       INTEGER NOT NULL,
  tutar     INTEGER NOT NULL,
  PRIMARY KEY (region_id, gun)
) WITHOUT ROWID;
-- Muhtarın belediyeye talebi (Senaryo C)
CREATE TABLE IF NOT EXISTS talepler (
  id          INTEGER PRIMARY KEY,
  mahalle_id  INTEGER NOT NULL REFERENCES regions(id),
  ilce_id     INTEGER NOT NULL REFERENCES regions(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  tur         TEXT NOT NULL,
  aciklama    TEXT NOT NULL,
  durum       TEXT NOT NULL DEFAULT 'ACIK',             -- ACIK / TEKLIFE_DONUSTU / KAPANDI
  proje_id    INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_talep_ilce ON talepler(ilce_id, durum);
-- Projeler: TEKLİF → MECLİSTE (açık oylama) → YAPIMDA (bütçe emanette) → TAMAMLANDI | REDDEDILDI
CREATE TABLE IF NOT EXISTS projeler (
  id              INTEGER PRIMARY KEY,
  region_id       INTEGER NOT NULL REFERENCES regions(id),   -- ilçe
  hedef_region_id INTEGER NOT NULL REFERENCES regions(id),   -- mahalle
  tur             TEXT NOT NULL,
  maliyet         INTEGER NOT NULL,
  gerekce         TEXT NOT NULL,
  talep_id        INTEGER,
  teklif_eden_id  INTEGER NOT NULL REFERENCES users(id),
  durum           TEXT NOT NULL,                             -- MECLISTE / YAPIMDA / TAMAMLANDI / REDDEDILDI
  nitelikli       INTEGER NOT NULL DEFAULT 0,
  nitelikli_sebep TEXT,
  oylama_bitis    INTEGER NOT NULL,
  yapim_bas       INTEGER,
  yapim_bitis     INTEGER,
  karar_json      TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_proje_ilce ON projeler(region_id, id);
CREATE INDEX IF NOT EXISTS ix_proje_hedef ON projeler(hedef_region_id, durum);
-- Meclis oyları açıktır (kamuya açık karar; vatandaş oyu gibi gizli değildir)
CREATE TABLE IF NOT EXISTS proje_oylari (
  proje_id   INTEGER NOT NULL REFERENCES projeler(id),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  oy         TEXT NOT NULL,                                  -- EVET / HAYIR / CEKIMSER
  created_at INTEGER NOT NULL,
  PRIMARY KEY (proje_id, user_id)
) WITHOUT ROWID;

CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_events
  BEGIN SELECT RAISE(ABORT, 'audit_events değiştirilemez'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_events
  BEGIN SELECT RAISE(ABORT, 'audit_events silinemez'); END;
`);

// Eklemeli taşımalar (var olan veritabanları için)
function kolonEkle(tablo, kolon, tanim) {
  if (db.prepare(`PRAGMA table_info(${tablo})`).all().some((k) => k.name === kolon)) return false;
  db.exec(`ALTER TABLE ${tablo} ADD COLUMN ${kolon} ${tanim}`);
  return true;
}
kolonEkle('adaylar', 'makam', "TEXT NOT NULL DEFAULT 'MUHTAR'");
kolonEkle('secim_oylari', 'makam', "TEXT NOT NULL DEFAULT 'MUHTAR'");

// ---------- Hesap güvenliği, KVKK ve moderasyon (v0.6) ----------
// Doğrulama alanı sonradan eklendiyse, eski hesaplar kayıt tarihiyle doğrulanmış sayılır (geriye uyum)
if (kolonEkle('users', 'email_dogrulandi_at', 'TEXT')) db.exec(`UPDATE users SET email_dogrulandi_at = created_at`);
// Parsel birleştirme (birlestirme.js): katılan parsel asıl parsele bağlanır; asıl parsel katılan hücre sayısını tutar
kolonEkle('parcels', 'birlesik_id', 'TEXT REFERENCES parcels(id)');
kolonEkle('parcels', 'uye_sayisi', 'INTEGER NOT NULL DEFAULT 0');
db.exec(`CREATE INDEX IF NOT EXISTS ix_parcels_birlesik ON parcels(birlesik_id) WHERE birlesik_id IS NOT NULL`);
kolonEkle('users', 'totp_sir', 'TEXT');                     // AES-256-GCM ile şifreli
kolonEkle('users', 'totp_aktif', 'INTEGER NOT NULL DEFAULT 0');
kolonEkle('users', 'totp_son_adim', 'INTEGER NOT NULL DEFAULT 0');   // aynı kodun yeniden kullanımını engeller
kolonEkle('users', 'kurtarma_kodlari', 'TEXT');             // sha256 özetleri (JSON)
kolonEkle('users', 'dogum_yili', 'INTEGER');
kolonEkle('users', 'rol', "TEXT NOT NULL DEFAULT 'OYUNCU'"); // OYUNCU / MODERATOR / DENETCI / ADMIN
kolonEkle('users', 'silindi_at', 'TEXT');
kolonEkle('users', 'ayarlar', "TEXT NOT NULL DEFAULT '{}'");
kolonEkle('sessions', 'ikinci_adim', 'INTEGER NOT NULL DEFAULT 1');  // 0: parola doğru, 2FA kodu bekleniyor
kolonEkle('sessions', 'deneme', 'INTEGER NOT NULL DEFAULT 0');
kolonEkle('sessions', 'tarayici', 'TEXT');
kolonEkle('sessions', 'ip_ozet', 'TEXT');
kolonEkle('sessions', 'son_gorulme', 'TEXT');
kolonEkle('mahalle_duyurulari', 'gizlendi', 'INTEGER NOT NULL DEFAULT 0');

db.exec(`
CREATE TABLE IF NOT EXISTS eposta_tokenlari (
  token_hash    TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  tur           TEXT NOT NULL,                 -- DOGRULA / SIFIRLA
  expires_at    TEXT NOT NULL,
  kullanildi_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_eposta_token_user ON eposta_tokenlari(user_id, tur);
-- Geliştirme posta kutusu (SMTP yokken) ve gönderim kaydı
CREATE TABLE IF NOT EXISTS giden_postalar (
  id INTEGER PRIMARY KEY, alici TEXT NOT NULL, konu TEXT NOT NULL, govde TEXT NOT NULL, created_at TEXT NOT NULL
);
-- KVKK açık rıza / sözleşme onay kayıtları: yalnızca eklenir, en son kayıt geçerlidir
CREATE TABLE IF NOT EXISTS yasal_onaylar (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  belge      TEXT NOT NULL,                    -- KOSULLAR / KVKK / PAZARLAMA
  surum      TEXT NOT NULL,
  onay       INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_onay_user ON yasal_onaylar(user_id, belge, id);

-- Şikâyetler (oyuncu → moderasyon)
CREATE TABLE IF NOT EXISTS sikayetler (
  id          INTEGER PRIMARY KEY,
  sikayetci_id INTEGER NOT NULL REFERENCES users(id),
  hedef_tur   TEXT NOT NULL,                   -- KULLANICI / PARSEL / DUYURU / MESAJ / ILAN / PROJE
  hedef_id    TEXT NOT NULL,
  sebep       TEXT NOT NULL,
  aciklama    TEXT,
  durum       TEXT NOT NULL DEFAULT 'ACIK',    -- ACIK / KARARA_BAGLANDI / REDDEDILDI
  karar       TEXT,
  karar_veren INTEGER REFERENCES users(id),
  on_tarama   TEXT,                            -- otomatik ön tarama notu (yapay zekâ / kural)
  created_at  INTEGER NOT NULL,
  kapandi_at  INTEGER
);
CREATE INDEX IF NOT EXISTS ix_sikayet_durum ON sikayetler(durum, id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sikayet_acik ON sikayetler(sikayetci_id, hedef_tur, hedef_id) WHERE durum = 'ACIK';

-- Ağır moderasyon işlemleri iki kişi kuralıyla yürür: biri önerir, BAŞKA bir yetkili onaylar
CREATE TABLE IF NOT EXISTS moderasyon_islemleri (
  id           INTEGER PRIMARY KEY,
  tur          TEXT NOT NULL,                  -- PARSEL_DONDUR / PARSEL_COZ / HESAP_ASKI / HESAP_AC / ICERIK_GIZLE / GOREVDEN_AL / SECIM_IPTAL
  hedef        TEXT NOT NULL,
  gerekce      TEXT NOT NULL,
  sikayet_id   INTEGER REFERENCES sikayetler(id),
  durum        TEXT NOT NULL DEFAULT 'ONAY_BEKLIYOR',   -- ONAY_BEKLIYOR / UYGULANDI / REDDEDILDI
  oneren_id    INTEGER NOT NULL REFERENCES users(id),
  onaylayan_id INTEGER REFERENCES users(id),
  created_at   INTEGER NOT NULL,
  karar_at     INTEGER
);
CREATE INDEX IF NOT EXISTS ix_mod_durum ON moderasyon_islemleri(durum, id);

-- Görevden alma (geri çağırma) dilekçesi: sakinlerin imzası eşiği geçerse makam boşalır, ara seçim açılır
CREATE TABLE IF NOT EXISTS gorevden_alma (
  id          INTEGER PRIMARY KEY,
  region_id   INTEGER NOT NULL REFERENCES regions(id),
  makam       TEXT NOT NULL,                   -- MUHTAR / BASKAN / MECLIS
  hedef_id    INTEGER NOT NULL REFERENCES users(id),
  baslatan_id INTEGER NOT NULL REFERENCES users(id),
  gerekce     TEXT NOT NULL,
  esik        INTEGER NOT NULL,
  durum       TEXT NOT NULL DEFAULT 'ACIK',    -- ACIK / BASARILI / BASARISIZ / DUSTU
  bitis       INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  kapandi_at  INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_gorevden_alma_acik ON gorevden_alma(region_id, makam, hedef_id) WHERE durum = 'ACIK';
CREATE TABLE IF NOT EXISTS gorevden_alma_imzalar (
  dilekce_id INTEGER NOT NULL REFERENCES gorevden_alma(id),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (dilekce_id, user_id)
) WITHOUT ROWID;
`);

// ---------- Ekonomi (v0.6): yapı bakımı, envanter bozulması, ürün borsası ----------
kolonEkle('structures', 'bakim_at', 'INTEGER');   // son bakım (yoksa tamamlanma zamanı)
kolonEkle('users', 'bozulma_gun', 'INTEGER');
kolonEkle('users', 'memleket_plaka', 'TEXT');        // hemşehri topluluğu (oyuncunun beyanı)
kolonEkle('users', 'memleket_at', 'INTEGER');
kolonEkle('users', 'baslangic_tarla_at', 'INTEGER');
kolonEkle('structures', 'seviye', 'INTEGER NOT NULL DEFAULT 1');   // yapı yükseltme (gelisim.js)   // başlangıç tarlası hediyesi (hesap başına bir kez)
kolonEkle('crops', 'don', 'INTEGER NOT NULL DEFAULT 0');   // gerçek havada don olayına maruz kaldı
kolonEkle('crops', 'yagmur_at', 'INTEGER');               // son yağmur sulaması
kolonEkle('crops', 'mevsim', 'TEXT');
kolonEkle('crops', 'afet_kati', 'REAL NOT NULL DEFAULT 1');   // sağanak/dolu verim çarpanı
kolonEkle('users', 'meslek', 'TEXT');
kolonEkle('structures', 'gelir_at', 'INTEGER');   // konut kira gelirinin son toplandığı an (gelisim.js)
// Oyun içi piyasa (piyasa.js): satış anındaki tahmini değer ve mahalle çarpanı; bölge endeksinin günlük kareleri
kolonEkle('trades', 'deger_ani', 'INTEGER');
kolonEkle('trades', 'carpan_ani', 'REAL');
db.exec(`CREATE TABLE IF NOT EXISTS deger_endeksi (
  tur      TEXT NOT NULL,      -- MAHALLE / ILCE / IL / TR
  bolge_id INTEGER NOT NULL,   -- TR için 0
  gun      TEXT NOT NULL,      -- YYYY-MM-DD (Türkiye saati)
  endeks   REAL NOT NULL,      -- 100 × çarpan (değer ağırlıklı)
  parsel   INTEGER NOT NULL,   -- sahipli parsel sayısı
  islem    INTEGER NOT NULL,   -- o gün gerçekleşen satış
  hacim    INTEGER NOT NULL,   -- o günkü satış tutarı (akçe)
  PRIMARY KEY (tur, bolge_id, gun)
) WITHOUT ROWID`);
// İlk giriş sihirbazı (sihirbaz.js): bitti/atlandı zamanı ve adım ödülleri. Sütun yeni eklendiyse, zaten parseli olan
// eski oyuncular sihirbazı görmez.
if (kolonEkle('users', 'sihirbaz_bitti_at', 'INTEGER')) {
  db.prepare(`UPDATE users SET sihirbaz_bitti_at = ? WHERE id IN (SELECT DISTINCT owner_user_id FROM parcels WHERE owner_user_id IS NOT NULL)`).run(Date.now());
}
db.exec(`CREATE TABLE IF NOT EXISTS sihirbaz_odulleri (
  user_id    INTEGER NOT NULL REFERENCES users(id),
  adim       TEXT NOT NULL,
  tutar      REAL NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, adim)
)`);
kolonEkle('users', 'kozmetik', "TEXT NOT NULL DEFAULT '{}'");
kolonEkle('users', 'npc_kisilik', 'TEXT');            // demo sakin kişiliği (yaşayan nüfus)
kolonEkle('users', 'npc_mahalle', 'INTEGER');          // demo sakinin yerleştiği mahalle
kolonEkle('users', 'npc_durum', 'TEXT');               // AKTIF / TASINIYOR / TASINDI
kolonEkle('users', 'npc_sonraki', 'INTEGER');          // bir sonraki eylem zamanı
kolonEkle('secimler', 'doldurma', 'INTEGER NOT NULL DEFAULT 0');   // demo sakinler kütükte mi   // seçili kozmetikler {cati, bayrak, unvan}
kolonEkle('users', 'meslek_xp', 'INTEGER NOT NULL DEFAULT 0');
kolonEkle('users', 'meslek_at', 'INTEGER');
db.exec(`
CREATE TABLE IF NOT EXISTS uretimler (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), parcel_id TEXT NOT NULL REFERENCES parcels(id),
  structure_id INTEGER NOT NULL REFERENCES structures(id), recete TEXT NOT NULL, parti INTEGER NOT NULL, cikti INTEGER NOT NULL,
  baslangic INTEGER NOT NULL, bitis INTEGER NOT NULL, durum TEXT NOT NULL DEFAULT 'URETIMDE'   -- URETIMDE / TOPLANDI
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_uretim_tesis ON uretimler(structure_id) WHERE durum = 'URETIMDE';
CREATE TABLE IF NOT EXISTS kooperatifler (
  id INTEGER PRIMARY KEY, il_id INTEGER NOT NULL REFERENCES regions(id), ad TEXT NOT NULL, aciklama TEXT,
  baskan_id INTEGER NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, durum TEXT NOT NULL DEFAULT 'AKTIF',
  UNIQUE (il_id, ad)
);
CREATE TABLE IF NOT EXISTS kooperatif_uyeleri (
  koop_id INTEGER NOT NULL REFERENCES kooperatifler(id), user_id INTEGER NOT NULL REFERENCES users(id),
  katilim INTEGER NOT NULL, PRIMARY KEY (koop_id, user_id)
) WITHOUT ROWID;
CREATE UNIQUE INDEX IF NOT EXISTS ux_koop_tek ON kooperatif_uyeleri(user_id);
CREATE TABLE IF NOT EXISTS sevkiyatlar (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), urun TEXT NOT NULL, miktar INTEGER NOT NULL,
  kaynak_plaka TEXT NOT NULL, hedef_plaka TEXT NOT NULL, mod TEXT NOT NULL, km REAL NOT NULL, maliyet REAL NOT NULL,
  cikis INTEGER NOT NULL, varis INTEGER NOT NULL, durum TEXT NOT NULL DEFAULT 'YOLDA', gelir REAL, notlar TEXT   -- YOLDA / TESLIM
);
CREATE INDEX IF NOT EXISTS ix_sevkiyat ON sevkiyatlar(durum, varis);
CREATE TABLE IF NOT EXISTS il_talep (gun TEXT NOT NULL, plaka TEXT NOT NULL, urun TEXT NOT NULL, satilan INTEGER NOT NULL, PRIMARY KEY (gun, plaka, urun)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS kiralar (
  id INTEGER PRIMARY KEY, parcel_id TEXT NOT NULL REFERENCES parcels(id), sahip_id INTEGER NOT NULL REFERENCES users(id),
  kiraci_id INTEGER REFERENCES users(id), gunluk INTEGER NOT NULL, gun INTEGER NOT NULL, durum TEXT NOT NULL DEFAULT 'TEKLIF',  -- TEKLIF / AKTIF / BITTI / IPTAL
  created_at INTEGER NOT NULL, baslangic INTEGER, bitis INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_kira_acik ON kiralar(parcel_id) WHERE durum IN ('TEKLIF', 'AKTIF');
CREATE TABLE IF NOT EXISTS ortaklar (
  id INTEGER PRIMARY KEY, parcel_id TEXT NOT NULL REFERENCES parcels(id), sahip_id INTEGER NOT NULL REFERENCES users(id),
  ortak_id INTEGER NOT NULL REFERENCES users(id), pay REAL NOT NULL, durum TEXT NOT NULL DEFAULT 'DAVET', created_at INTEGER NOT NULL  -- DAVET / AKTIF / BITTI
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ortak ON ortaklar(parcel_id, ortak_id) WHERE durum IN ('DAVET', 'AKTIF');
CREATE TABLE IF NOT EXISTS afetler (id INTEGER PRIMARY KEY, plaka TEXT NOT NULL, tur TEXT NOT NULL, olcum TEXT, etkilenen INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ix_afet ON afetler(plaka, tur, created_at);
CREATE TABLE IF NOT EXISTS referandumlar (
  id INTEGER PRIMARY KEY, region_id INTEGER NOT NULL REFERENCES regions(id), baslatan_id INTEGER NOT NULL REFERENCES users(id), soru TEXT NOT NULL,
  aciklama TEXT, durum TEXT NOT NULL DEFAULT 'IMZA',   -- IMZA / OYLAMA / SONUCLANDI / NISAP_YOK / DUSTU
  esik INTEGER NOT NULL, kutuk INTEGER, created_at INTEGER NOT NULL, oylama_bas INTEGER, oylama_bitis INTEGER, sonuc_json TEXT
);
CREATE TABLE IF NOT EXISTS referandum_imzalar (ref_id INTEGER NOT NULL REFERENCES referandumlar(id), user_id INTEGER NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, PRIMARY KEY (ref_id, user_id)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS referandum_katilim (ref_id INTEGER NOT NULL REFERENCES referandumlar(id), user_id INTEGER NOT NULL REFERENCES users(id), PRIMARY KEY (ref_id, user_id)) WITHOUT ROWID;
-- Oy içeriği kimlikten ayrıdır: yalnızca makbuz özeti ve tercih
CREATE TABLE IF NOT EXISTS referandum_oylari (makbuz_ozeti TEXT PRIMARY KEY, ref_id INTEGER NOT NULL REFERENCES referandumlar(id), oy TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS kozmetikler (
  user_id INTEGER NOT NULL REFERENCES users(id), kod TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, kod)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS koleksiyon (
  user_id INTEGER NOT NULL REFERENCES users(id), simge TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, simge)
) WITHOUT ROWID;
`);     // envanter bozulmasının işlendiği son oyun günü
db.exec(`
CREATE TABLE IF NOT EXISTS urun_emirleri (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  urun       TEXT NOT NULL,
  yon        TEXT NOT NULL,                    -- AL / SAT
  fiyat      REAL NOT NULL,                    -- birim fiyat (kuruş hassasiyeti)
  miktar     INTEGER NOT NULL,
  kalan      INTEGER NOT NULL,
  durum      TEXT NOT NULL DEFAULT 'ACIK',     -- ACIK / DOLDU / IPTAL / SURESI_DOLDU
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  closed_at  INTEGER
);
CREATE INDEX IF NOT EXISTS ix_emir_defter ON urun_emirleri(urun, yon, durum, fiyat);
CREATE INDEX IF NOT EXISTS ix_emir_user ON urun_emirleri(user_id, durum);
CREATE TABLE IF NOT EXISTS urun_islemleri (
  id         INTEGER PRIMARY KEY,
  urun       TEXT NOT NULL,
  alis_emri  INTEGER NOT NULL REFERENCES urun_emirleri(id),
  satis_emri INTEGER NOT NULL REFERENCES urun_emirleri(id),
  alici_id   INTEGER NOT NULL REFERENCES users(id),
  satici_id  INTEGER NOT NULL REFERENCES users(id),
  fiyat      REAL NOT NULL,
  miktar     INTEGER NOT NULL,
  ucret      REAL NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_urun_islem ON urun_islemleri(urun, id);
`);

// ---------- Canlılık (v0.6): sohbet ve web push ----------
db.exec(`
CREATE TABLE IF NOT EXISTS sohbet_mesajlari (
  id         INTEGER PRIMARY KEY,
  kanal      TEXT NOT NULL,                    -- mahalle:<id> / il:<id> / memleket:<plaka>
  user_id    INTEGER NOT NULL REFERENCES users(id),
  metin      TEXT NOT NULL,
  on_tarama  TEXT,                             -- otomatik ön tarama notu (şüpheli ise)
  gizlendi   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_sohbet_kanal ON sohbet_mesajlari(kanal, id);
CREATE INDEX IF NOT EXISTS ix_sohbet_user ON sohbet_mesajlari(user_id, created_at);
CREATE TABLE IF NOT EXISTS hava_durumu (
  plaka TEXT PRIMARY KEY, sicaklik REAL, yagis REAL, kod INTEGER, ruzgar REAL, gunduz INTEGER, guncellendi INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS rozetler (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), kod TEXT NOT NULL, ad TEXT NOT NULL, ikon TEXT NOT NULL,
  aciklama TEXT, created_at INTEGER NOT NULL, UNIQUE (user_id, kod)
);
CREATE TABLE IF NOT EXISTS push_abonelikleri (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS hava_gecmisi (plaka TEXT NOT NULL, gun TEXT NOT NULL, olcum INTEGER NOT NULL DEFAULT 0, yagisli INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (plaka, gun)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS hava_uyarilari (user_id INTEGER NOT NULL REFERENCES users(id), plaka TEXT NOT NULL, tur TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ix_hava_uyari ON hava_uyarilari(user_id, plaka, tur, created_at);
CREATE TABLE IF NOT EXISTS afet_etkilenen (afet_id INTEGER NOT NULL REFERENCES afetler(id), user_id INTEGER NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, PRIMARY KEY (afet_id, user_id)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ix_afet_etkilenen_user ON afet_etkilenen(user_id, created_at);
CREATE TABLE IF NOT EXISTS afet_destekleri (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), tutar REAL NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ix_afet_destek_user ON afet_destekleri(user_id, created_at);
`);
kolonEkle('hava_durumu', 'tahmin', 'TEXT');        // JSON: önümüzdeki saatler + yarın (Open-Meteo)
kolonEkle('crops', 'ortu_bitis', 'INTEGER');       // tarla örtüsü bu ana kadar korur

// Sık sorgulanan sütunlar için dizinler. Bazı tablolar başka modüllerde kurulduğundan sunucu tüm modülleri yükledikten
// sonra çağrılır (index.js); tablo yoksa o dizin atlanır.
db.indeksleriKur = () => {
  const DIZINLER = [
    'ix_structures_durum ON structures(status, completes_at)',
    'ix_ownership_user ON parcel_ownership(user_id, end_at)',
    'ix_ownership_parcel ON parcel_ownership(parcel_id, id)',
    'ix_trades_zaman ON trades(created_at)',
    'ix_structures_sahip ON structures(owner_user_id, type, status)',
    'ix_wallet_hesap ON wallet_ledger(account, credit, debit)',
    'ix_wallet_user_tutar ON wallet_ledger(user_id, credit, debit)',
    'ix_inventory_bakiye ON inventory_ledger(user_id, item_id, delta)',
    'ix_crops_user ON crops(user_id, status)',
    'ix_crops_durum ON crops(status, ready_at)',
    'ix_push_user ON push_abonelikleri(user_id)',
    'ix_adaylar_user ON adaylar(user_id)',
    'ix_muhtarlar_user ON muhtarlar(user_id)',
    'ix_bel_uye_user ON belediye_uyeleri(user_id)',
    'ix_trades_buyer ON trades(buyer_id)',
    'ix_listings_seller ON listings(seller_id, status)',
    'ix_posta_durum ON giden_postalar(durum, sonraki)',
    'ix_proje_oylama ON projeler(durum, oylama_bitis)',
    'ix_proje_yapim ON projeler(durum, yapim_bitis)',
    'ix_emir_sure ON urun_emirleri(durum, expires_at)',
    'ix_kira_bitis ON kiralar(durum, bitis)',
    'ix_kira_teklif ON kiralar(durum, created_at)',
    'ix_ref_oylama ON referandumlar(durum, oylama_bitis)',
    'ix_hayvan_hazir ON hayvan_bakim(durum, hazir_at)',
    'ix_users_npc_mahalle ON users(is_npc, npc_durum, npc_mahalle)',
    'ix_users_npc_sonraki ON users(is_npc, npc_durum, npc_sonraki)',
    'ix_regions_tur_konum ON regions(type, center_lon, center_lat)',
    'ix_regions_plaka ON regions(plaka)',
    'ix_sessions_user ON sessions(user_id)',
    'ix_urun_islem_zaman ON urun_islemleri(urun, created_at)',
  ];
  for (const d of DIZINLER) { try { db.exec(`CREATE INDEX IF NOT EXISTS ${d}`); } catch { /* tablo yok */ } }
  db.exec('PRAGMA optimize');
};

module.exports = db;
