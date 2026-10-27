// Oyun içi Ada / Parsel numarası (gerçek tapu kaydı değildir). Izgara hücreleri 16 × 16'lık bloklara (≈ 480 m) ayrılır:
// her blok bir "ada", bloktaki hücrenin sırası "parsel" numarasıdır (1–256). Ada numarası blok koordinatından kararlı
// bir karışımla 100–999 arasında üretilir; aynı parsel her yerde ve her zaman aynı numarayı alır. Gerçek tarlalar
// (FTW) merkez hücrelerinin numarasını taşır.
const BLOK = 16;

function adaParsel(gridX, gridY) {
  if (!Number.isFinite(gridX) || !Number.isFinite(gridY)) return null;
  const bx = Math.floor(gridX / BLOK), by = Math.floor(gridY / BLOK);
  const k = (Math.imul(bx, 73856093) ^ Math.imul(by, 19349663)) >>> 0;
  const ada = 100 + (k % 900);
  const lx = ((gridX % BLOK) + BLOK) % BLOK, ly = ((gridY % BLOK) + BLOK) % BLOK;
  return { ada, parsel: ly * BLOK + lx + 1 };
}

module.exports = { adaParsel, BLOK };
