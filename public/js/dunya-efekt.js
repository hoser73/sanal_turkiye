// İşaretler ve eylem efektleri (çiftlik oyunu geri bildirimi): parselin üstünde süzülen baloncuklar (hasat hazır 🧺,
// sulama bekliyor 💧, hayvan ürünü hazır 🥚) ve eylem anında kısa parçacık efektleri (hasatta ürünler havaya fırlar,
// sulamada damlalar düşer, ekimde fideler belirir). Baloncuk ve parçacıklar kameraya dönük düzlemlerdir.
import * as THREE from '/vendor/three/three.module.js';

const dokular = new Map();
// Emoji baloncuğu (renkli kenarlı beyaz daire + kuyruk) ya da çıplak emoji
function emojiDoku(emoji, kenar = null) {
  const k = `${emoji}|${kenar}`;
  if (dokular.has(k)) return dokular.get(k);
  const c = document.createElement('canvas');
  c.width = 128; c.height = kenar ? 150 : 128;
  const g = c.getContext('2d');
  if (kenar) {
    g.fillStyle = 'rgba(40,24,8,0.25)'; g.beginPath(); g.arc(66, 66, 54, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fffaf0'; g.strokeStyle = kenar; g.lineWidth = 9;
    g.beginPath(); g.arc(64, 62, 52, 0, Math.PI * 2); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(50, 108); g.lineTo(64, 140); g.lineTo(78, 108); g.closePath(); g.fillStyle = kenar; g.fill();
  }
  g.font = `${kenar ? 62 : 96}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(emoji, 64, kenar ? 66 : 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  dokular.set(k, t);
  return t;
}
function duzlem(doku, oran = 1) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, oran), new THREE.MeshBasicMaterial({ map: doku, transparent: true, depthTest: false, depthWrite: false }));
  m.renderOrder = 10;
  return m;
}

export const ISARET = {
  hasat: { emoji: '🧺', kenar: '#e8a417' },
  su: { emoji: '💧', kenar: '#3d8fdb' },
  hayvan: { emoji: '🥚', kenar: '#7bb33a' },
};

export function efektKur(ctx) {
  const { sahne, map } = ctx;
  let isaretler = [], parcaciklar = [];
  const yon = new THREE.Euler(0, 0, 0, 'YXZ');

  // Kameraya dön: düzlemin normali kameranın bulunduğu yöne (eğim ve yön açısına göre)
  function cevir(m) {
    yon.set(-(Math.PI / 2 - (map.getPitch() * Math.PI) / 180), (-map.getBearing() * Math.PI) / 180, 0);
    m.rotation.copy(yon);
  }
  const pikselMetre = () => (156543.034 * Math.cos((map.getCenter().lat * Math.PI) / 180)) / 2 ** map.getZoom();

  return {
    kur() {},
    temizle() {
      for (const i of isaretler) sahne.remove(i.m);
      isaretler = [];
    },
    // Baloncuklar: [{ x, y, z, tur }] (bina katmanı parselleri kurarken çağırır)
    isaretler(liste) {
      for (const i of isaretler) sahne.remove(i.m);
      isaretler = liste.map((i, k) => {
        const t = ISARET[i.tur];
        const m = duzlem(emojiDoku(t.emoji, t.kenar), 150 / 128);
        sahne.add(m);
        return { ...i, m, faz: k * 0.7 };
      });
    },
    // Eylem efekti: parselin merkezinde (yerel x, z) kısa parçacık patlaması
    patlat(tur, x, y, z, ikon) {
      const adet = tur === 'sula' ? 22 : tur === 'ek' ? 8 : 10;
      const emoji = tur === 'sula' ? '💧' : ikon || '✨';
      const doku = emojiDoku(emoji);
      for (let i = 0; i < adet; i++) {
        const m = duzlem(doku);
        sahne.add(m);
        const a = Math.random() * Math.PI * 2, h = 4 + Math.random() * 9;
        parcaciklar.push(tur === 'sula'
          ? { m, x: x + (Math.random() - 0.5) * 22, y: y + 12 + Math.random() * 8, z: z + (Math.random() - 0.5) * 22, vx: 0, vy: -16 - Math.random() * 8, vz: 0, omur: 1.1, yas: Math.random() * -0.5, boy: 1.6 }
          : { m, x: x + (Math.random() - 0.5) * 6, y: y + 2, z: z + (Math.random() - 0.5) * 6, vx: Math.cos(a) * h, vy: 12 + Math.random() * 10, vz: Math.sin(a) * h, omur: 1.4, yas: -i * 0.03, boy: tur === 'ek' ? 2.6 : 3.4 });
      }
    },
    kare(dt) {
      const pm = pikselMetre();
      const zaman = ctx.ortak.zaman.value;
      for (const i of isaretler) {
        cevir(i.m);
        const s = Math.max(4, pm * 44);   // ekranda ~44 piksel
        const zipla = ctx.hareket() ? Math.abs(Math.sin(zaman * 2.2 + i.faz)) * s * 0.18 : 0;
        i.m.scale.set(s, s, s);
        i.m.position.set(i.x, i.y + s * 0.9 + 6 + zipla, i.z);
      }
      for (let k = parcaciklar.length - 1; k >= 0; k--) {
        const p = parcaciklar[k];
        p.yas += dt;
        if (p.yas < 0) { p.m.visible = false; continue; }
        p.m.visible = true;
        p.vy -= (p.vx ? 26 : 0) * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        cevir(p.m);
        const s = Math.max(p.boy, pm * 22);
        p.m.scale.set(s, s, s);
        p.m.position.set(p.x, p.y, p.z);
        p.m.material.opacity = Math.max(0, 1 - p.yas / p.omur);
        if (p.yas >= p.omur) { sahne.remove(p.m); p.m.material.dispose(); p.m.geometry.dispose(); parcaciklar.splice(k, 1); }
      }
      // Parçacık varken akıcı çizim; baloncuklar zıplarken saat hızında
      return parcaciklar.length ? 'akici' : isaretler.length > 0 && ctx.hareket();
    },
  };
}
