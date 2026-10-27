// Sevimli maketin son işlemesi: nesnelerin dibinde ve birleşim yerlerinde yumuşak gölgelenme (GTAO), maket
// fotoğrafı hissi veren tilt-shift (kadrajın üst ve alt kenarı hafifçe bulanık), hafif sıcak renk ayarı ve
// çok örneklemeli kenar yumuşatma. three.js ekleri /vendor/three-ek'ten gelir. Yüklenemezse çağıran düz çizer.
import * as THREE from '/vendor/three/three.module.js';

const YOL = '/vendor/three-ek/postprocessing/';
const MAKET = {
  uniforms: { tDiffuse: { value: null }, cozunurluk: { value: new THREE.Vector2(1, 1) }, odak: { value: 0.5 }, bulanik: { value: 2.4 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
uniform sampler2D tDiffuse; uniform vec2 cozunurluk; uniform float odak; uniform float bulanik;
varying vec2 vUv;
const vec2 DISK[12] = vec2[12](vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621), vec2(0.962, -0.195), vec2(0.473, -0.480),
  vec2(0.519, 0.767), vec2(0.185, -0.893), vec2(0.507, 0.064), vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598));
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  vec3 r = c.rgb;
  float b = smoothstep(0.22, 0.5, abs(vUv.y - odak)) * bulanik;   // ortası net, üst ve alt kenar bulanık
  if (b > 0.05) { vec3 s = r; for (int i = 0; i < 12; i++) s += texture2D(tDiffuse, vUv + DISK[i] * b / cozunurluk).rgb; r = s / 13.0; }
  float l = dot(r, vec3(0.2126, 0.7152, 0.0722));
  r = mix(vec3(l), r, 1.08);                                                             // hafif doygunluk
  r *= mix(vec3(0.98, 0.99, 1.03), vec3(1.03, 1.0, 0.96), smoothstep(0.2, 0.8, l));     // serin gölge, sıcak ışık
  vec2 k = (vUv - 0.5) * vec2(1.0, 0.85);
  r *= mix(1.0, 0.86, smoothstep(0.32, 0.78, length(k)));                                 // yumuşak köşe kararması
  gl_FragColor = vec4(r, c.a);
}`,
};

// Telefon/tablet: dokunmatik ve dar ekran. Yumuşak gölgelenme (GTAO) telefonda karenin en pahalı parçası; kapatılır.
export const MOBIL = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 900;

// ust: yumuşak gölgelenmeden etkilenmeyecek efekt sahnesi (yazılar, parıltılar) — gölgelenmeden sonra üstüne çizilir
export async function sevimliSonIslem(renderer, sahne, kamera, ust = null) {
  const [{ EffectComposer }, { RenderPass }, { GTAOPass }, { OutputPass }, { ShaderPass }] = await Promise.all(
    ['EffectComposer', 'RenderPass', 'GTAOPass', 'OutputPass', 'ShaderPass'].map((ad) => import(`${YOL}${ad}.js`)));
  const hedef = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const birlesik = new EffectComposer(renderer, hedef);
  birlesik.addPass(new RenderPass(sahne, kamera));
  if (!MOBIL) {
    const ao = new GTAOPass(sahne, kamera, 1, 1);
    ao.updateGtaoMaterial({ radius: 3.2, distanceExponent: 1.4, thickness: 2.5, scale: 1.0, samples: 16 });
    ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    ao.blendIntensity = 0.85;
    birlesik.addPass(ao);
  }
  if (ust) { const p = new RenderPass(ust, kamera); p.clear = false; p.clearDepth = true; birlesik.addPass(p); }
  birlesik.addPass(new OutputPass());
  const maket = new ShaderPass(MAKET);
  birlesik.addPass(maket);
  return {
    boyut(g, y) {
      const o = renderer.getPixelRatio();
      birlesik.setPixelRatio(o); birlesik.setSize(g, y);
      maket.uniforms.cozunurluk.value.set(g * o, y * o);
    },
    ciz() { birlesik.render(); },
    yokEt() { birlesik.dispose(); hedef.dispose(); },
  };
}

// Gökyüzü fonu: üstte açık mavi, ufka doğru krem (maket kartının arkası)
export function gokFonu(gece = 0) {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 256);
  if (gece) { g.addColorStop(0, '#2b3b66'); g.addColorStop(1, '#5d6f9c'); } else { g.addColorStop(0, '#9fd3f5'); g.addColorStop(0.6, '#d5ecf7'); g.addColorStop(1, '#f6f0dc'); }
  x.fillStyle = g; x.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
