// Açılış 3B sahnesinin sinema son işlemesi: çok örneklemeli (MSAA) HDR çizim, güneş ve parıltılarda ışıma (bloom),
// ton eşleme, renk derecelendirme (sıcak ışık / serin gölge, doygunluk, kontrast), köşe kararması, ince film greni ve
// ön planda hafif alan derinliği (alt kenardaki buğday yumuşakça bulanıklaşır). three.js ekleri /vendor/three-ek'ten gelir.
import * as THREE from '/vendor/three/three.module.js';

const YOL = '/vendor/three-ek/postprocessing/';
const DERECELE = {
  uniforms: { tDiffuse: { value: null }, t: { value: 0 }, cozunurluk: { value: new THREE.Vector2(1, 1) }, bulanik: { value: 3.2 }, vinyet: { value: 0.28 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
uniform sampler2D tDiffuse; uniform float t; uniform vec2 cozunurluk; uniform float bulanik; uniform float vinyet;
varying vec2 vUv;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
const vec2 DISK[12] = vec2[12](vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621), vec2(0.962, -0.195), vec2(0.473, -0.480),
  vec2(0.519, 0.767), vec2(0.185, -0.893), vec2(0.507, 0.064), vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598));
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  vec3 r = c.rgb;
  float b = smoothstep(0.26, 0.0, vUv.y) * bulanik;           // ön plan alan derinliği
  if (b > 0.05) { vec3 s = r; for (int i = 0; i < 12; i++) s += texture2D(tDiffuse, vUv + DISK[i] * b / cozunurluk).rgb; r = s / 13.0; }
  float l = dot(r, vec3(0.2126, 0.7152, 0.0722));
  r = mix(vec3(l), r, 1.14);                                     // doygunluk
  r *= mix(vec3(0.97, 0.99, 1.04), vec3(1.04, 1.0, 0.94), smoothstep(0.15, 0.85, l));   // serin gölge, sıcak ışık
  r = clamp((r - 0.5) * 1.06 + 0.5, 0.0, 1.0);                  // kontrast
  vec2 k = (vUv - 0.5) * vec2(cozunurluk.x / cozunurluk.y, 1.0);
  r *= 1.0 - vinyet * smoothstep(0.45, 1.1, length(k));          // köşe kararması
  r += (h21(vUv * cozunurluk + fract(t) * 97.0) - 0.5) * 0.016; // film greni
  gl_FragColor = vec4(r, c.a);
}`,
};

export async function sonIslemKur(renderer, sahne, kamera, { mobil = false } = {}) {
  const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }, { ShaderPass }] = await Promise.all(
    ['EffectComposer', 'RenderPass', 'UnrealBloomPass', 'OutputPass', 'ShaderPass'].map((ad) => import(`${YOL}${ad}.js`)));
  const hedef = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: mobil ? 2 : 4 });
  const birlesik = new EffectComposer(renderer, hedef);
  birlesik.addPass(new RenderPass(sahne, kamera));
  const isima = new UnrealBloomPass(new THREE.Vector2(256, 256), mobil ? 0.14 : 0.18, 0.35, 2.4);   // yalnızca güneş ve parıltılar (HDR eşik)
  birlesik.addPass(isima);
  birlesik.addPass(new OutputPass());
  const derece = new ShaderPass(DERECELE);
  if (mobil) derece.uniforms.bulanik.value = 0;
  birlesik.addPass(derece);
  return {
    boyut(w, h) {
      birlesik.setPixelRatio(renderer.getPixelRatio()); birlesik.setSize(w, h);
      derece.uniforms.cozunurluk.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
    },
    ciz(dt, saat) { derece.uniforms.t.value = saat; birlesik.render(dt); },
    hafiflet() { isima.enabled = false; derece.uniforms.bulanik.value = 0; },
    yokEt() { birlesik.dispose(); hedef.dispose(); },
  };
}
