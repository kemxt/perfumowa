/**
 * Etykieta: patch MeshStandardMaterial przez onBeforeCompile.
 *
 * Współrzędna obwodowa c ∈ [0, 1) mówi, w którym miejscu obwodu flakonu leży fragment:
 *   lin = (uv.x − 0.5) · uArc + 0.5 · span + uOffset,   c = fract(lin)
 * gdzie uArc = ARC/360 (jaką część obwodu widać), span = 1 − uGap (długość etykiety).
 * Przy uOffset = 0 środek widoku pokazuje środek etykiety. Fragmenty z c > span leżą
 * w przerwie między końcami etykiety → discard (widać zdjęcie flakonu pod spodem).
 *
 * Próbkujemy textureGrad z pochodnymi liczonymi z `lin` (ciągłe), a nie z fract(lin),
 * bo skok fract na szwie wymusiłby najmniejszy mipmap i dał widoczną linię.
 */
export const LABEL_UNIFORMS_GLSL = /* glsl */ `
uniform float uOffset;
uniform float uGap;
uniform float uArc;
`;

export const LABEL_MAP_FRAGMENT = /* glsl */ `
#ifdef USE_MAP
  float span = max(1.0 - uGap, 1e-4);
  float lin = (vMapUv.x - 0.5) * uArc + 0.5 * span + uOffset;
  float c = fract(lin);

  float edge = 1.0;
  if (uGap > 0.0005) {
    if (c > span) discard;
    // Miękka krawędź o szerokości ~1 px na obu końcach etykiety (antyaliasing zamiast schodków).
    float fw = max(fwidth(lin), 1e-5);
    edge = smoothstep(0.0, fw, c) * (1.0 - smoothstep(span - fw, span, c));
  }

  vec2 labelUv = vec2(clamp(c / span, 0.0, 1.0), vMapUv.y);
  vec2 gradX = vec2(dFdx(lin) / span, dFdx(vMapUv.y));
  vec2 gradY = vec2(dFdy(lin) / span, dFdy(vMapUv.y));
  vec4 sampledDiffuseColor = textureGrad(map, labelUv, gradX, gradY);
  diffuseColor *= sampledDiffuseColor;
  diffuseColor.a *= edge;
#endif
`;

/**
 * Odblask na szkle: wąski pionowy pas (gauss) + cieńszy pas wtórny.
 * Przesuwa się w przeciwną stronę niż etykieta (+uOffset · uSpeed), blending addytywny.
 */
export const GLINT_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const GLINT_FRAGMENT = /* glsl */ `
uniform float uOffset;
uniform float uArc;
uniform float uIntensity;
uniform float uWidth;
uniform float uSpeed;
uniform float uPos;
uniform float uPad;
varying vec2 vUv;

float band(float d, float w) {
  return exp(-(d * d) / (w * w));
}

void main() {
  // Pozycja na obwodzie względem środka widoku (−arc/2 … arc/2).
  float a = (vUv.x - 0.5) * uArc;
  float d = a - (uPos + uOffset * uSpeed);
  d -= floor(d + 0.5); // zawinięcie do (−0.5, 0.5]

  float g = band(d, uWidth) + 0.45 * band(d - uWidth * 2.8, uWidth * 0.22);

  // Wygaszenie przy górnej/dolnej krawędzi i na sylwetce (tam szkło odbija inaczej).
  float vFade = smoothstep(0.0, uPad + 0.08, vUv.y) * smoothstep(1.0, 1.0 - uPad - 0.08, vUv.y);
  float hFade = smoothstep(0.0, 0.1, vUv.x) * smoothstep(1.0, 0.9, vUv.x);
  float alpha = clamp(g * vFade * hFade * uIntensity, 0.0, 1.0);
  if (alpha < 0.002) discard;
  gl_FragColor = vec4(1.0, 0.99, 0.96, alpha);
}
`;
