import { BufferGeometry, Float32BufferAttribute } from 'three';

export interface CurvedPlaneOptions {
  /** Promień w osi X (połowa widocznej szerokości przy ARC = 180°). */
  radius: number;
  height: number;
  /** Łuk w radianach, wyśrodkowany na osi +Z (do kamery). */
  arc: number;
  /** Głębokość: promień w osi Z = radius · curv (0 = płasko). */
  curv: number;
  segmentsX?: number;
  segmentsY?: number;
}

/**
 * Zakrzywiona płaszczyzna – wycinek (eliptycznego) walca zwrócony do kamery.
 * UV.x biegnie wzdłuż łuku (0 → 1 od lewej), UV.y od dołu do góry.
 * Normalne liczone analitycznie, żeby cieniowanie było gładkie także przy niskim curv.
 */
export function buildCurvedPlane({ radius, height, arc, curv, segmentsX = 96, segmentsY = 4 }: CurvedPlaneOptions): BufferGeometry {
  const depth = radius * curv;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let iy = 0; iy <= segmentsY; iy++) {
    const v = iy / segmentsY;
    const y = (v - 0.5) * height;
    for (let ix = 0; ix <= segmentsX; ix++) {
      const u = ix / segmentsX;
      const theta = (u - 0.5) * arc;
      const s = Math.sin(theta);
      const c = Math.cos(theta);
      positions.push(radius * s, y, depth * c);
      // P(θ) = (R sinθ, D cosθ) → normalna ∝ (D sinθ, R cosθ)
      const nx = depth * s;
      const nz = radius * c;
      const len = Math.hypot(nx, nz) || 1;
      normals.push(nx / len, 0, nz / len);
      uvs.push(u, v);
    }
  }

  const row = segmentsX + 1;
  for (let iy = 0; iy < segmentsY; iy++) {
    for (let ix = 0; ix < segmentsX; ix++) {
      const a = iy * row + ix;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      indices.push(a, b, d, a, d, c);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}
