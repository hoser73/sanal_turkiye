// Herkese aynı olan uçlar için kısa süreli bellek önbelleği. Yanıt bir kez hesaplanıp JSON metni olarak saklanır;
// süre içinde gelen istekler hazır metni alır (veritabanı ve JSON.stringify tekrarlanmaz). Tarayıcıya da aynı süre
// için Cache-Control gönderilir. anahtar: aynı uçta farklı parametreler (ör. il) için ayrı kayıt.
// hesapla zaman uyumsuz olabilir (veritabanı); aynı anahtar için süren hesap varsa yeni istekler onu bekler.
function ortakYanit(ms, hesapla, anahtar = () => '') {
  if (process.env.ONBELLEK === 'kapali') ms = 0;   // testler değişikliği hemen görmeli
  const kayitlar = new Map(), suren = new Map();
  return async (req, res) => {
    const k = anahtar(req), t = Date.now();
    let kayit = kayitlar.get(k);
    if (!kayit || t - kayit.t > ms) {
      let p = ms ? suren.get(k) : null;
      if (!p) {
        p = Promise.resolve().then(() => hesapla(req)).then((v) => ({ t, govde: Buffer.from(JSON.stringify(v)) }));
        if (ms) {
          suren.set(k, p);
          p.then((y) => {
            kayitlar.set(k, y);
            if (kayitlar.size > 500) kayitlar.delete(kayitlar.keys().next().value);   // sınırsız büyümesin
          }, () => {}).finally(() => suren.delete(k));
        }
      }
      kayit = await p;
    }
    res.set('Cache-Control', `public, max-age=${Math.max(0, Math.floor(ms / 1000))}`).type('json').send(kayit.govde);
  };
}

module.exports = { ortakYanit };
