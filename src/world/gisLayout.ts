/**
 * GIS footprint snap — place process units on real OSM water / basin polygons
 * from public/geo bakes (© OpenStreetMap contributors, ODbL).
 *
 * Prioritises Waterloo + Kitchener where schematic trains previously sat on
 * pavement beside the real clarifier / aeration footprints.
 * v0.3.10: asphalt = process yard only; siteBounds = full WWTP; true OSM basins.
 */
import type { GeoFeature, PlantGeoPack } from './osmBake';

export interface FootprintRing {
  ring: number[][];
  cx: number;
  cz: number;
  area: number;
  /** Axis-aligned bbox (legacy; prefer obb* / ring for meshing). */
  width: number;
  depth: number;
  /** Oriented bbox along yaw — closer to true footprint than AABB for rotated basins. */
  obbWidth: number;
  obbDepth: number;
  circularity: number;
  yaw: number;
  kind: 'clarifier' | 'basin' | 'other';
}

export interface GisUnitSnap {
  id: string;
  label: string;
  kind: 'cyl' | 'basin' | 'rect' | 'uv' | 'chlorine' | 'ditch';
  /** World X (local metres, same frame as geo bake). */
  x: number;
  z: number;
  yaw: number;
  /** Per-tank / basin count placed at this snap. */
  count: number;
  /**
   * True when the unit is NOT on a mapped OSM process footprint (placeholder / invented geometry).
   * The scene suffixes the label with "(est.)" and HoverTip shows estimateNote.
   */
  estimated?: boolean;
  estimateNote?: string;
  /** Real footprint size hints (metres). */
  radiusM?: number;
  widthM?: number;
  depthM?: number;
  footprints: FootprintRing[];
}

export interface GisLayoutResult {
  used: boolean;
  snaps: GisUnitSnap[];
  /**
   * Asphalt process yard only — process footprint AABB ∪ headworks/UV/solids + ~50 m margin.
   * Not the full WWTP landuse polygon (that is siteBounds).
   */
  pad: { cx: number; cz: number; w: number; d: number; yaw: number } | null;
  /** Full WWTP amenity footprint (grass/gravel/landuse context; camera/minimap). */
  siteBounds: { cx: number; cz: number; w: number; d: number } | null;
  /** Natural waterway/pond rings for terrain carve (excludes process basins/clarifiers). */
  waterMasks: FootprintRing[];
  outfallHint: { x: number; z: number; yaw: number } | null;
  pipingHints: { x0: number; z0: number; x1: number; z1: number }[];
  summary: string;
}

function polygonArea(ring: number[][]): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(a) * 0.5;
}

/** Area-weighted polygon centroid (vertex mean is biased by uneven OSM node spacing). */
function centroid(ring: number[][]): { x: number; z: number } {
  let a = 0;
  let x = 0;
  let z = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const c = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    a += c;
    x += (ring[i][0] + ring[i + 1][0]) * c;
    z += (ring[i][1] + ring[i + 1][1]) * c;
  }
  if (Math.abs(a) > 1e-6) return { x: x / (3 * a), z: z / (3 * a) };
  // Degenerate ring: vertex mean
  x = 0;
  z = 0;
  const n = Math.max(1, ring.length - 1);
  for (let i = 0; i < n; i++) {
    x += ring[i][0];
    z += ring[i][1];
  }
  return { x: x / n, z: z / n };
}

function perimeter(ring: number[][]): number {
  let p = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const dx = ring[i + 1][0] - ring[i][0];
    const dz = ring[i + 1][1] - ring[i][1];
    p += Math.hypot(dx, dz);
  }
  return p;
}

function bbox(ring: number[][]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of ring) {
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minZ = Math.min(minZ, p[1]);
    maxZ = Math.max(maxZ, p[1]);
  }
  return { minX, maxX, minZ, maxZ };
}

function majorAxisYaw(ring: number[][]): number {
  const c = centroid(ring);
  let xx = 0;
  let xz = 0;
  let zz = 0;
  const n = Math.max(1, ring.length - 1);
  for (let i = 0; i < n; i++) {
    const dx = ring[i][0] - c.x;
    const dz = ring[i][1] - c.z;
    xx += dx * dx;
    xz += dx * dz;
    zz += dz * dz;
  }
  return 0.5 * Math.atan2(2 * xz, xx - zz);
}

/** Project ring onto yaw axes → oriented width (along yaw) / depth (perp). */
function orientedExtents(ring: number[][], yaw: number, cx: number, cz: number): { w: number; d: number } {
  const cos = Math.cos(-yaw);
  const sin = Math.sin(-yaw);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  const n = Math.max(1, ring.length - 1);
  for (let i = 0; i < n; i++) {
    const dx = ring[i][0] - cx;
    const dz = ring[i][1] - cz;
    const u = dx * cos - dz * sin;
    const v = dx * sin + dz * cos;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  return { w: Math.max(1, maxU - minU), d: Math.max(1, maxV - minV) };
}

export function classifyFootprint(ring: number[][]): FootprintRing | null {
  if (ring.length < 3) return null;
  const area = polygonArea(ring);
  if (area < 80 || area > 80000) return null;
  const per = perimeter(ring);
  if (per < 20) return null;
  const circ = (4 * Math.PI * area) / (per * per);
  const b = bbox(ring);
  const width = b.maxX - b.minX;
  const depth = b.maxZ - b.minZ;
  const c = centroid(ring);
  let kind: FootprintRing['kind'] = 'other';
  // High circularity → clarifier tanks; elongated / large rectangles → aeration basins
  if (circ >= 0.82 && Math.abs(width - depth) / Math.max(width, depth) < 0.35) {
    kind = 'clarifier';
  } else if (area >= 800 && (width > 25 || depth > 25)) {
    kind = 'basin';
  } else if (circ >= 0.7 && area >= 200) {
    kind = 'clarifier';
  }
  const yaw = majorAxisYaw(ring);
  const obb = orientedExtents(ring, yaw, c.x, c.z);
  return {
    ring,
    cx: c.x,
    cz: c.z,
    area,
    width,
    depth,
    obbWidth: obb.w,
    obbDepth: obb.d,
    circularity: circ,
    yaw,
    kind,
  };
}

function wwtpBounds(pack: PlantGeoPack): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
  for (const f of pack.geojson.features) {
    if (f.properties.kind !== 'wwtp' || f.geometry.type !== 'Polygon') continue;
    const ring = f.geometry.coordinates[0] as number[][];
    return bbox(ring);
  }
  return null;
}

function wwtpRing(pack: PlantGeoPack): number[][] | null {
  for (const f of pack.geojson.features) {
    if (f.properties.kind === 'wwtp' && f.geometry.type === 'Polygon') return f.geometry.coordinates[0] as number[][];
  }
  return null;
}

function inside(b: { minX: number; maxX: number; minZ: number; maxZ: number }, x: number, z: number, pad = 40): boolean {
  return x >= b.minX - pad && x <= b.maxX + pad && z >= b.minZ - pad && z <= b.maxZ + pad;
}

function clusterByX(items: FootprintRing[], gap = 80): FootprintRing[][] {
  const sorted = [...items].sort((a, b) => a.cx - b.cx);
  const groups: FootprintRing[][] = [];
  for (const it of sorted) {
    const last = groups[groups.length - 1];
    if (!last || Math.abs(it.cx - last[last.length - 1].cx) > gap) groups.push([it]);
    else last.push(it);
  }
  return groups;
}

function meanYaw(items: FootprintRing[]): number {
  if (!items.length) return 0;
  return items.reduce((s, f) => s + f.yaw, 0) / items.length;
}

function connectChain(points: { x: number; z: number }[]): GisLayoutResult['pipingHints'] {
  const out: GisLayoutResult['pipingHints'] = [];
  for (let i = 0; i < points.length - 1; i++) {
    out.push({ x0: points[i].x, z0: points[i].z, x1: points[i + 1].x, z1: points[i + 1].z });
  }
  return out;
}

/** Known-bad OSM water polys that flood / mis-snap process units (centroid ≈). */
const WATER_DENYLIST: Record<string, { cx: number; cz: number; tol?: number }[]> = {
  // Kitchener: NE pond/oxbow mis-typed as a giant clarifier (~3701 m², circ~0.85)
  kitchener: [{ cx: 323.5, cz: 165.1, tol: 12 }],
};

function isDenied(plantId: string, cx: number, cz: number): boolean {
  const list = WATER_DENYLIST[plantId];
  if (!list) return false;
  return list.some((d) => Math.hypot(cx - d.cx, cz - d.cz) <= (d.tol ?? 15));
}

function aabbOfRing(fp: FootprintRing, margin = 0): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const b = bbox(fp.ring);
  return {
    minX: b.minX - margin,
    maxX: b.maxX + margin,
    minZ: b.minZ - margin,
    maxZ: b.maxZ + margin,
  };
}

function aabbOverlap(
  a: { minX: number; maxX: number; minZ: number; maxZ: number },
  b: { minX: number; maxX: number; minZ: number; maxZ: number },
): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
}

function makeRectBasin(cx: number, cz: number, hw: number, hd: number, yaw: number): FootprintRing {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const local = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
    [-hw, -hd],
  ];
  const ring = local.map(([u0, v0]) => [cx + cos * u0 - sin * v0, cz + sin * u0 + cos * v0]);
  return {
    ring,
    cx,
    cz,
    area: hw * 2 * hd * 2,
    width: hw * 2,
    depth: hd * 2,
    obbWidth: hw * 2,
    obbDepth: hd * 2,
    circularity: 0.35,
    yaw,
    kind: 'basin',
  };
}

/** OSM carriageway width (m) by highway class — shared with osmBake road meshes. */
export function roadWidth(highway: string | null | undefined): number {
  if (!highway) return 4;
  if (/motorway|trunk/.test(highway)) return 10;
  if (/primary|secondary/.test(highway)) return 7;
  if (/tertiary|residential|unclassified/.test(highway)) return 5;
  if (/service|track|path|footway|cycleway/.test(highway)) return 2.8;
  return 4.5;
}

function pointInRing(x: number, z: number, ring: number[][]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

function segsCross(a: number[], b: number[], c: number[], d: number[]): boolean {
  const o = (p: number[], q: number[], r: number[]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a);
  const d2 = o(c, d, b);
  const d3 = o(a, b, c);
  const d4 = o(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Do two simple polygons (closed rings) overlap — vertex containment or edge crossing. */
function ringsOverlap(a: number[][], b: number[][]): boolean {
  for (const p of a) if (pointInRing(p[0], p[1], b)) return true;
  for (const p of b) if (pointInRing(p[0], p[1], a)) return true;
  for (let i = 0; i < a.length - 1; i++)
    for (let j = 0; j < b.length - 1; j++) if (segsCross(a[i], a[i + 1], b[j], b[j + 1])) return true;
  return false;
}

function rectRing(cx: number, cz: number, hw: number, hd: number, yaw: number): number[][] {
  return makeRectBasin(cx, cz, hw, hd, yaw).ring;
}

type Box = { minX: number; maxX: number; minZ: number; maxZ: number };

/**
 * Real-world obstacles for estimated (non-OSM) unit placement: mapped buildings, roads/paths
 * (by carriageway width), mapped process footprints / already-placed units, and the WWTP
 * fence (the man_made=wastewater_plant polygon). Fences, rail and gates are not in the bake,
 * so the plant polygon edge stands in for the fence line.
 */
class SiteObstacles {
  readonly polys: { ring: number[][]; box: Box }[] = [];
  readonly roads: { a: number[]; b: number[]; hw: number; box: Box }[] = [];
  constructor(
    pack: PlantGeoPack,
    readonly fence: number[][] | null,
    near: Box,
  ) {
    const touches = (b: Box) => b.maxX > near.minX && b.minX < near.maxX && b.maxZ > near.minZ && b.minZ < near.maxZ;
    for (const f of pack.geojson.features as GeoFeature[]) {
      const k = f.properties.kind;
      if (k === 'building' && f.geometry.type === 'Polygon') {
        const ring = f.geometry.coordinates[0] as number[][];
        const box = bbox(ring);
        if (touches(box)) this.polys.push({ ring, box });
      } else if (k === 'road' && f.geometry.type === 'LineString') {
        const c = f.geometry.coordinates as number[][];
        const hw = roadWidth(f.properties.highway) / 2;
        for (let i = 0; i < c.length - 1; i++) {
          const box = {
            minX: Math.min(c[i][0], c[i + 1][0]),
            maxX: Math.max(c[i][0], c[i + 1][0]),
            minZ: Math.min(c[i][1], c[i + 1][1]),
            maxZ: Math.max(c[i][1], c[i + 1][1]),
          };
          if (touches(box)) this.roads.push({ a: c[i], b: c[i + 1], hw, box });
        }
      }
    }
  }
  /** 40 m spatial hash over polys/roads so rectClear only tests local obstacles. */
  private static readonly CELL = 40;
  private grid: Map<string, { polys: number[]; roads: number[] }> | null = null;
  private keyRange(b: Box): string[] {
    const C = SiteObstacles.CELL;
    const out: string[] = [];
    for (let i = Math.floor(b.minX / C); i <= Math.floor(b.maxX / C); i++)
      for (let j = Math.floor(b.minZ / C); j <= Math.floor(b.maxZ / C); j++) out.push(`${i},${j}`);
    return out;
  }
  private index(): Map<string, { polys: number[]; roads: number[] }> {
    if (this.grid) return this.grid;
    const g = new Map<string, { polys: number[]; roads: number[] }>();
    const cell = (k: string) => {
      let c = g.get(k);
      if (!c) g.set(k, (c = { polys: [], roads: [] }));
      return c;
    };
    this.polys.forEach((p, i) => this.keyRange(p.box).forEach((k) => cell(k).polys.push(i)));
    this.roads.forEach((r, i) => {
      const m = r.hw + 8;
      this.keyRange({ minX: r.box.minX - m, maxX: r.box.maxX + m, minZ: r.box.minZ - m, maxZ: r.box.maxZ + m }).forEach((k) => cell(k).roads.push(i));
    });
    return (this.grid = g);
  }
  addRing(ring: number[][]): void {
    this.polys.push({ ring, box: bbox(ring) });
    this.grid = null;
  }
  addRect(cx: number, cz: number, hw: number, hd: number, yaw = 0): void {
    this.addRing(rectRing(cx, cz, hw, hd, yaw));
  }
  /** Rectangle (centre, half sizes, yaw) is on clear ground inside the fence. */
  rectClear(cx: number, cz: number, hw: number, hd: number, yaw: number, margin = 6, fenceMargin = 10, roadMargin = 4): boolean {
    const r = rectRing(cx, cz, hw + margin, hd + margin, yaw);
    const rb = bbox(r);
    const g = this.index();
    const pi = new Set<number>();
    const ri = new Set<number>();
    for (const k of this.keyRange(rb)) {
      const c = g.get(k);
      if (!c) continue;
      c.polys.forEach((i) => pi.add(i));
      c.roads.forEach((i) => ri.add(i));
    }
    for (const i of pi) {
      const p = this.polys[i];
      if (p.box.maxX < rb.minX || p.box.minX > rb.maxX || p.box.maxZ < rb.minZ || p.box.minZ > rb.maxZ) continue;
      if (ringsOverlap(r, p.ring)) return false;
    }
    for (const i of ri) {
      const rd = this.roads[i];
      const m = rd.hw + roadMargin - margin;
      const rr = m > 0 ? rectRing(cx, cz, hw + margin + m, hd + margin + m, yaw) : r;
      const b = m > 0 ? bbox(rr) : rb;
      if (rd.box.maxX < b.minX || rd.box.minX > b.maxX || rd.box.maxZ < b.minZ || rd.box.minZ > b.maxZ) continue;
      if (pointInRing(rd.a[0], rd.a[1], rr) || pointInRing(rd.b[0], rd.b[1], rr)) return false;
      for (let i = 0; i < rr.length - 1; i++) if (segsCross(rr[i], rr[i + 1], rd.a, rd.b)) return false;
    }
    if (this.fence) {
      const fr = rectRing(cx, cz, hw + fenceMargin, hd + fenceMargin, yaw);
      for (const p of fr) if (!pointInRing(p[0], p[1], this.fence)) return false;
      for (let i = 0; i < fr.length - 1; i++)
        for (let j = 0; j < this.fence.length - 1; j++) if (segsCross(fr[i], fr[i + 1], this.fence[j], this.fence[j + 1])) return false;
    }
    return true;
  }
}

/** Ring-search clear ground for a w×d building near an anchor (nearest clear spot wins). */
function placeClearBox(
  obs: SiteObstacles,
  anchor: { x: number; z: number },
  hw: number,
  hd: number,
  rMin: number,
  rMax: number,
  prefer: number | null = null,
): { x: number; z: number } | null {
  const base = prefer ?? 0;
  for (let r = rMin; r <= rMax; r += 4) {
    const n = Math.max(12, Math.round((2 * Math.PI * r) / 6));
    for (let k = 0; k < n; k++) {
      const off = Math.ceil(k / 2) * ((2 * Math.PI) / n) * (k % 2 ? 1 : -1);
      const a = base + off;
      const x = anchor.x + Math.cos(a) * r;
      const z = anchor.z + Math.sin(a) * r;
      if (obs.rectClear(x, z, hw, hd, 0, 5, 8)) return { x, z };
    }
  }
  return null;
}

/**
 * Hand rectangular primary clarifiers for Kitchener (OSM only maps circular tanks).
 * v0.3.12: search clear ground INSIDE the plant fence near the aeration train, collision-checked
 * against mapped buildings, roads/paths, OSM process footprints and the fence line (v0.3.11
 * pushed the bank west until it cleared aeration, which left it straddling the SW fence/road).
 */
function kitchenerRectPrimaries(
  site: { cx: number; cz: number },
  aerationFs: FootprintRing[],
  obs: SiteObstacles,
  count = 4,
): FootprintRing[] {
  const hw = 22.5;
  const hd = 9;
  const spacing = 22;
  // Keep well inside the fence: the plant polygon edge is tree-lined in the imagery (35 m is
  // the most the SE yard allows; no other open ground on site fits a 4-tank bank).
  const FENCE_M = 35;
  const yaw0 = aerationFs.length ? meanYaw(aerationFs) : 0;
  const aerBoxes = aerationFs.map((f) => aabbOfRing(f));
  const aerC = aerationFs.length ? centroidOf(aerationFs) : { x: site.cx, z: site.cz };
  const bankAt = (bx: number, bz: number, yaw: number): FootprintRing[] => {
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    return Array.from({ length: count }, (_, i) => {
      const along = (i - (count - 1) / 2) * spacing;
      return makeRectBasin(bx - sin * along, bz + cos * along, hw, hd, yaw);
    });
  };
  const distToAer = (x: number, z: number): number =>
    aerBoxes.length
      ? Math.min(
          ...aerBoxes.map((b) => Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minZ - z, 0, z - b.maxZ))),
        )
      : Math.hypot(x - site.cx, z - site.cz);
  const fence = obs.fence;
  const fenceDist = (x: number, z: number): number => {
    if (!fence) return 1e9;
    let m = Infinity;
    for (let i = 0; i < fence.length - 1; i++) {
      const [ax, az] = fence[i];
      const [bx, bz] = fence[i + 1];
      const vx = bx - ax;
      const vz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / Math.max(vx * vx + vz * vz, 1e-9)));
      m = Math.min(m, Math.hypot(x - (ax + vx * t), z - (az + vz * t)));
    }
    return m;
  };
  // Aeration-aligned first, then every 15° (lets the bank run along a yard edge).
  const yaws = [yaw0, yaw0 + Math.PI / 2, ...Array.from({ length: 12 }, (_, k) => (k * Math.PI) / 12)];
  // Score every candidate cheaply, then collision-test best-first: the first clear one wins.
  const cands: { bx: number; bz: number; yaw: number; score: number }[] = [];
  for (let dx = -260; dx <= 260; dx += 6) {
    for (let dz = -260; dz <= 260; dz += 6) {
      const bx = aerC.x + dx;
      const bz = aerC.z + dz;
      const d = distToAer(bx, bz);
      if (d > 160) continue;
      if (fence && !pointInRing(bx, bz, fence)) continue;
      // Upstream of aeration (flow runs headworks → primaries → aeration → secondaries, W→E)
      // and away from the fence line (the yard edge is tree-lined in the imagery).
      const base = d + Math.max(0, bx - aerC.x) * 0.6 + Math.max(0, 70 - fenceDist(bx, bz)) * 1.2;
      yaws.forEach((yaw, k) => cands.push({ bx, bz, yaw, score: base + (k < 2 ? 0 : 0.5) }));
    }
  }
  cands.sort((a, b) => a.score - b.score);
  let best: { fs: FootprintRing[] } | null = null;
  // Any bank orientation covers its central ±9 m square, so a blocked centre rules out all yaws.
  const coreOk = new Map<string, boolean>();
  for (const c of cands) {
    const key = `${c.bx},${c.bz}`;
    let ok = coreOk.get(key);
    if (ok === undefined) coreOk.set(key, (ok = obs.rectClear(c.bx, c.bz, 9, 9, 0, 6, FENCE_M, 4)));
    if (!ok) continue;
    const fs = bankAt(c.bx, c.bz, c.yaw);
    if (fs.every((f) => obs.rectClear(f.cx, f.cz, hw, hd, c.yaw, 6, FENCE_M, 4))) {
      best = { fs };
      break;
    }
  }
  if (best) return best.fs;
  // Last resort (no clear ground found): legacy west-of-aeration bank, still (est.).
  const westEdge = aerBoxes.length ? Math.min(...aerBoxes.map((b) => b.minX)) : site.cx - 160;
  return bankAt(westEdge - 28 - hw, aerC.z, yaw0);
}

/**
 * Build GIS-snapped unit placements for a plant. Returns used=false when the
 * bake lacks enough on-site water footprints (caller falls back to schematic).
 */
export function buildGisLayout(
  pack: PlantGeoPack | null,
  plantId: string,
  counts: {
    primary: number;
    secondary: number;
    aeration: number;
    hasPrimary: boolean;
    hasOxidationDitch: boolean;
    disinfection: 'uv' | 'chlorine' | 'none';
    uvBanks: number;
    chlorineChannels: number;
    /** research.process includes anaerobic_digestion → snap OSM storage tanks as digesters. */
    hasDigestion?: boolean;
  },
): GisLayoutResult {
  const empty: GisLayoutResult = {
    used: false,
    snaps: [],
    pad: null,
    siteBounds: null,
    waterMasks: [],
    outfallHint: null,
    pipingHints: [],
    summary: 'schematic (no GIS footprints)',
  };
  if (!pack || plantId === 'farm-septic') return empty;

  const bounds = wwtpBounds(pack);
  if (!bounds) return empty;

  const footprints: FootprintRing[] = [];
  const waterMasks: FootprintRing[] = [];
  const waterwayTips: { x: number; z: number }[] = [];

  for (const f of pack.geojson.features as GeoFeature[]) {
    const kind = f.properties.kind;
    if ((kind === 'water' || kind === 'waterway') && f.geometry.type === 'Polygon') {
      const ring = f.geometry.coordinates[0] as number[][];
      const fp = classifyFootprint(ring);
      if (!fp) continue;
      if (isDenied(plantId, fp.cx, fp.cz)) continue;
      // Carve masks: natural waterways / ponds only. Process clarifiers & basins
      // already have mesh floors — carving them leaves floating water sheets.
      if (fp.kind === 'other') waterMasks.push(fp);
      if (!inside(bounds, fp.cx, fp.cz, 60)) continue;
      if (fp.kind === 'clarifier' || fp.kind === 'basin') footprints.push(fp);
    }
    if (kind === 'waterway' && f.geometry.type === 'LineString') {
      const coords = f.geometry.coordinates as number[][];
      if (coords.length < 2) continue;
      const tip = coords[coords.length - 1];
      if (inside(bounds, tip[0], tip[1], 120)) waterwayTips.push({ x: tip[0], z: tip[1] });
    }
  }

  let clarifiers = footprints
    .filter((f) => f.kind === 'clarifier')
    .sort((a, b) => a.area - b.area);
  let basins = footprints
    .filter((f) => f.kind === 'basin')
    .sort((a, b) => b.area - a.area);

  // Basin-only plants (e.g. Woodward / Ashbridges bakes): promote smaller basins
  // to clarifier slots so we still place circular-ish tanks at real footprints.
  if (clarifiers.length === 0 && basins.length >= 3) {
    const byArea = [...basins].sort((a, b) => a.area - b.area);
    const promoteN = Math.min(
      (counts.primary + counts.secondary) || 4,
      Math.max(2, Math.floor(byArea.length * 0.55)),
    );
    clarifiers = byArea.slice(0, promoteN).map((f) => ({ ...f, kind: 'clarifier' as const }));
    const promoted = new Set(clarifiers.map((f) => `${f.cx.toFixed(1)},${f.cz.toFixed(1)}`));
    basins = basins.filter((f) => !promoted.has(`${f.cx.toFixed(1)},${f.cz.toFixed(1)}`));
  }

  // Need a meaningful set — Waterloo/Kitchener have 4+ circular + basins
  if (clarifiers.length + basins.length < 2) {
    return { ...empty, waterMasks, summary: 'schematic (sparse water footprints)' };
  }

  const snaps: GisUnitSnap[] = [];

  // Split clarifiers into primary (smaller) vs secondary (larger) when both exist.
  // Kitchener: research primaries are rectangular — do not promote circular OSM tanks.
  let primaryFs: FootprintRing[] = [];
  let secondaryFs: FootprintRing[] = [];
  const kitRectPrimary = plantId === 'kitchener' && counts.hasPrimary;
  if (kitRectPrimary) {
    secondaryFs = [...clarifiers]
      .sort((a, b) => b.area - a.area)
      .slice(0, counts.secondary || clarifiers.length);
  } else if (counts.hasPrimary && clarifiers.length >= 2) {
    const mid = Math.ceil(clarifiers.length / 2);
    // Prefer smaller half as primary when size contrast is clear
    const sorted = [...clarifiers].sort((a, b) => a.area - b.area);
    const small = sorted.slice(0, Math.min(counts.primary || mid, sorted.length));
    const large = sorted.slice(small.length);
    // If areas are similar, split by X clusters (west primary, east secondary — common NA layout)
    const areasSimilar =
      large.length && small.length
        ? large[0].area / Math.max(small[small.length - 1].area, 1) < 1.35
        : true;
    if (areasSimilar && clarifiers.length >= 4) {
      const clusters = clusterByX(clarifiers, 90);
      if (clusters.length >= 2) {
        primaryFs = clusters[0].slice(0, counts.primary || clusters[0].length);
        secondaryFs = clusters
          .slice(1)
          .flat()
          .slice(0, counts.secondary || 99);
      } else {
        primaryFs = small.slice(0, counts.primary);
        secondaryFs = large.slice(0, counts.secondary);
      }
    } else {
      primaryFs = small.slice(0, counts.primary);
      secondaryFs = (large.length ? large : sorted.slice(small.length)).slice(0, counts.secondary);
    }
  } else {
    secondaryFs = clarifiers.slice(0, counts.secondary || clarifiers.length);
  }

  // Use real OSM basins — do NOT invent splits to force schematic aeration counts.
  // Exception: Waterloo (and similar non-KIT) may merge twin tanks into one poly.
  let aerationFs = basins.slice(0, Math.max(1, basins.length));
  if (counts.aeration > 0) {
    aerationFs = basins.slice(0, Math.max(1, Math.min(counts.aeration, basins.length)));
  }
  // v0.3.11: no forced 1→N rectangle split (it drew OBB slices ~1.9× the real L-shaped
  // Waterloo footprint). Twin tanks that OSM merged into one polygon stay one true-ring basin.

  const siteCx = (bounds.minX + bounds.maxX) / 2;
  const siteCz = (bounds.minZ + bounds.maxZ) / 2;
  const fence = wwtpRing(pack);
  const obs = new SiteObstacles(pack, fence, {
    minX: bounds.minX - 60,
    maxX: bounds.maxX + 60,
    minZ: bounds.minZ - 60,
    maxZ: bounds.maxZ + 60,
  });
  // Every mapped process footprint is an obstacle for estimated units.
  for (const f of footprints) obs.addRing(f.ring);

  // Anaerobic digesters: OSM man_made=storage_tank rings inside the plant fence (Waterloo
  // ways 799495393/799495394). Footprint-backed → true ring, real size, not estimated.
  const digesterFs: FootprintRing[] = [];
  if (counts.hasDigestion && fence) {
    for (const f of pack.geojson.features as GeoFeature[]) {
      if (f.properties.kind !== 'building' || f.geometry.type !== 'Polygon') continue;
      if (f.properties.man_made !== 'storage_tank' && f.properties.building !== 'storage_tank') continue;
      const ring = f.geometry.coordinates[0] as number[][];
      const fp = classifyFootprint(ring);
      if (!fp || fp.circularity < 0.85 || fp.area < 300 || fp.area > 3000) continue;
      if (!pointInRing(fp.cx, fp.cz, fence)) continue;
      digesterFs.push({ ...fp, kind: 'clarifier' });
    }
  }

  if (kitRectPrimary) {
    primaryFs = kitchenerRectPrimaries({ cx: siteCx, cz: siteCz }, aerationFs.length ? aerationFs : basins, obs);
  }
  for (const f of primaryFs) if (f.circularity < 0.7) obs.addRing(f.ring);

  if (primaryFs.length && counts.hasPrimary) {
    const c = centroidOf(primaryFs);
    const rectPrimary = primaryFs.every((f) => f.circularity < 0.7);
    snaps.push({
      id: 'primary',
      label: 'Primary Clarifiers',
      kind: rectPrimary ? 'basin' : 'cyl',
      x: c.x,
      z: c.z,
      yaw: meanYaw(primaryFs),
      count: primaryFs.length,
      radiusM: rectPrimary ? undefined : avgRadius(primaryFs),
      widthM: rectPrimary ? Math.max(...primaryFs.map((f) => f.obbWidth)) : undefined,
      depthM: rectPrimary ? Math.max(...primaryFs.map((f) => f.obbDepth)) : undefined,
      footprints: primaryFs,
      ...(kitRectPrimary
        ? {
            estimated: true,
            estimateNote:
              'Estimated placement, not from OSM — rectangular primaries are not mapped in OpenStreetMap; 45×18 m tanks set on clear ground inside the plant fence beside aeration (collision-checked against mapped buildings, roads and tanks).',
          }
        : {}),
    });
  }

  if (aerationFs.length && !counts.hasOxidationDitch) {
    const c = centroidOf(aerationFs);
    snaps.push({
      id: 'aeration',
      label: 'Aeration Basins',
      kind: 'basin',
      x: c.x,
      z: c.z,
      yaw: meanYaw(aerationFs),
      count: aerationFs.length,
      widthM: Math.max(...aerationFs.map((f) => f.obbWidth)),
      depthM: Math.max(...aerationFs.map((f) => f.obbDepth)),
      footprints: aerationFs,
    });
  } else if (counts.hasOxidationDitch && basins[0]) {
    snaps.push({
      id: 'primary',
      label: 'Oxidation Ditch',
      kind: 'ditch',
      x: basins[0].cx,
      z: basins[0].cz,
      yaw: basins[0].yaw,
      count: 1,
      widthM: basins[0].width,
      depthM: basins[0].depth,
      footprints: [basins[0]],
    });
  }

  if (secondaryFs.length) {
    const c = centroidOf(secondaryFs);
    snaps.push({
      id: 'secondary',
      label: 'Secondary Clarifiers',
      kind: 'cyl',
      x: c.x,
      z: c.z,
      yaw: meanYaw(secondaryFs),
      count: secondaryFs.length,
      radiusM: avgRadius(secondaryFs),
      footprints: secondaryFs,
    });
  }

  if (digesterFs.length) {
    const c = centroidOf(digesterFs);
    snaps.push({
      id: 'digesters',
      label: 'Anaerobic Digesters',
      kind: 'cyl',
      x: c.x,
      z: c.z,
      yaw: 0,
      count: digesterFs.length,
      radiusM: avgRadius(digesterFs),
      footprints: digesterFs,
    });
  }

  // Unused / standby clarifiers (e.g. KIT south ~885 m² tanks) — keep visible + labelled.
  const usedClarKeys = new Set(
    [...primaryFs, ...secondaryFs]
      .filter((f) => f.circularity >= 0.7)
      .map((f) => `${f.cx.toFixed(1)},${f.cz.toFixed(1)}`),
  );
  const unusedClar = clarifiers.filter((f) => !usedClarKeys.has(`${f.cx.toFixed(1)},${f.cz.toFixed(1)}`));
  if (unusedClar.length) {
    const c = centroidOf(unusedClar);
    snaps.push({
      id: 'clarifiers-standby',
      label: `Clarifiers (standby · ${unusedClar.length})`,
      kind: 'cyl',
      x: c.x,
      z: c.z,
      yaw: meanYaw(unusedClar),
      count: unusedClar.length,
      radiusM: avgRadius(unusedClar),
      footprints: unusedClar,
    });
  }

  // Full WWTP amenity bounds — grass/gravel/landuse context (NOT asphalt).
  const siteBounds = {
    cx: siteCx,
    cz: siteCz,
    w: Math.max(80, (bounds.maxX - bounds.minX) * 0.98),
    d: Math.max(60, (bounds.maxZ - bounds.minZ) * 0.98),
  };

  // Headworks / UV / solids: park beside the process cluster (not full WWTP corners).
  const processPts = snaps.filter((s) => s.id !== 'digesters').flatMap((s) =>
    s.footprints.length
      ? s.footprints.map((f) => ({ x: f.cx, z: f.cz }))
      : [{ x: s.x, z: s.z }],
  );
  if (processPts.length) {
    const xs = processPts.map((p) => p.x);
    const zs = processPts.map((p) => p.z);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    const midZ = (minZ + maxZ) / 2;
    let headX = minX - 36;
    let headZ = midZ;
    // Headworks box is 16×12 m; keep it off mapped buildings/roads/tanks and inside the fence.
    if (!obs.rectClear(headX, headZ, 8, 6, 0, 5, 8)) {
      // Upstream of the primaries (away from aeration), else of the westernmost unit.
      const pri = snaps.find((s) => s.id === 'primary');
      const aerS = snaps.find((s) => s.id === 'aeration');
      const anchor = pri ? { x: pri.x, z: pri.z } : { x: minX, z: midZ };
      const away = pri && aerS ? Math.atan2(pri.z - aerS.z, pri.x - aerS.x) : Math.PI;
      const hp = placeClearBox(obs, anchor, 8, 6, 20, 160, away);
      if (hp) {
        headX = hp.x;
        headZ = hp.z;
      }
    }
    obs.addRect(headX, headZ, 8, 6);
    snaps.unshift({
      id: 'headworks',
      label: 'Headworks',
      kind: 'rect',
      x: headX,
      z: headZ,
      yaw: 0,
      count: 1,
      footprints: [],
      estimated: true,
      estimateNote: 'Estimated placement, not from OSM — schematic headworks building placed upstream of the process train.',
    });

    const sec = snaps.find((s) => s.id === 'secondary');
    const blockers = snaps.flatMap((s) => s.footprints);
    const aer = snaps.find((s) => s.id === 'aeration');
    const dis = placeDisinfection(pack, bounds, blockers, sec, aer ? { x: aer.x, z: aer.z } : null, { x: maxX, z: midZ }, [
      { x: headX, z: headZ, half: 12 },
    ]);
    obs.addRect(dis.x, dis.z, 10, 6);
    if (counts.disinfection === 'uv' && counts.uvBanks > 0) {
      snaps.push({
        id: 'disinfection',
        label: 'UV Disinfection',
        kind: 'uv',
        x: dis.x,
        z: dis.z,
        yaw: 0,
        count: counts.uvBanks,
        footprints: [],
        estimated: true,
        estimateNote: dis.note,
      });
    } else if (counts.disinfection === 'chlorine' && counts.chlorineChannels > 0) {
      snaps.push({
        id: 'disinfection',
        label: 'Chlorine Contact',
        kind: 'chlorine',
        x: dis.x,
        z: dis.z,
        yaw: 0,
        count: counts.chlorineChannels,
        footprints: [],
        estimated: true,
        estimateNote: dis.note,
      });
    }

    // Solids building (22×14 m): beside the mapped digesters when present, else south of the train.
    let solids = { x: (minX + maxX) / 2, z: maxZ + 32 };
    let solidsNote = 'Estimated placement, not from OSM — schematic solids building.';
    if (digesterFs.length) {
      const dc = centroidOf(digesterFs);
      const dr = Math.max(...digesterFs.map((f) => Math.hypot(f.cx - dc.x, f.cz - dc.z) + Math.sqrt(f.area / Math.PI)));
      // Prefer the side facing the process train.
      const toTrain = Math.atan2((minZ + maxZ) / 2 - dc.z, (minX + maxX) / 2 - dc.x);
      const sp = placeClearBox(obs, dc, 11, 7, 10, dr + 120, toTrain);
      if (sp) {
        solids = sp;
        solidsNote =
          'Estimated placement, not from OSM — schematic solids building set on clear ground beside the mapped anaerobic digesters (OSM does not tag a solids/dewatering building).';
      }
    } else if (!obs.rectClear(solids.x, solids.z, 11, 7, 0, 5, 8)) {
      const sp = placeClearBox(obs, { x: (minX + maxX) / 2, z: maxZ }, 11, 7, 24, 160, Math.PI / 2);
      if (sp) solids = sp;
    }
    obs.addRect(solids.x, solids.z, 11, 7);
    snaps.push({
      id: 'solids',
      label: 'Solids Handling',
      kind: 'rect',
      x: solids.x,
      z: solids.z,
      yaw: 0,
      count: 1,
      footprints: [],
      estimated: true,
      estimateNote: solidsNote,
    });
  }

  // Asphalt = process footprint AABB ∪ headworks/UV/solids + ~50 m margin.
  const asphaltPts: { x: number; z: number }[] = [];
  for (const s of snaps) {
    if (s.footprints.length) {
      for (const f of s.footprints) {
        const b = bbox(f.ring);
        asphaltPts.push({ x: b.minX, z: b.minZ }, { x: b.maxX, z: b.maxZ });
      }
    } else {
      // Rect / UV / solids footprints are schematic ~20–30 m boxes
      const half = s.kind === 'uv' || s.kind === 'chlorine' ? 12 : 18;
      asphaltPts.push(
        { x: s.x - half, z: s.z - half },
        { x: s.x + half, z: s.z + half },
      );
    }
  }
  const MARGIN = 50;
  let pad: GisLayoutResult['pad'] = null;
  if (asphaltPts.length) {
    const minX = Math.min(...asphaltPts.map((p) => p.x)) - MARGIN;
    const maxX = Math.max(...asphaltPts.map((p) => p.x)) + MARGIN;
    const minZ = Math.min(...asphaltPts.map((p) => p.z)) - MARGIN;
    const maxZ = Math.max(...asphaltPts.map((p) => p.z)) + MARGIN;
    pad = {
      cx: (minX + maxX) / 2,
      cz: (minZ + maxZ) / 2,
      w: Math.max(60, maxX - minX),
      d: Math.max(50, maxZ - minZ),
      yaw: 0,
    };
  } else {
    pad = { cx: siteBounds.cx, cz: siteBounds.cz, w: Math.min(140, siteBounds.w * 0.35), d: Math.min(100, siteBounds.d * 0.35), yaw: 0 };
  }

  // Outfall: prefer waterway tip near site, else east of disinfection
  let outfallHint: GisLayoutResult['outfallHint'] = null;
  if (waterwayTips.length) {
    const tip = waterwayTips.sort(
      (a, b) =>
        Math.hypot(a.x - siteBounds.cx, a.z - siteBounds.cz) -
        Math.hypot(b.x - siteBounds.cx, b.z - siteBounds.cz),
    )[0];
    outfallHint = { x: tip.x, z: tip.z, yaw: Math.atan2(tip.z - siteBounds.cz, tip.x - siteBounds.cx) };
  } else {
    const dis = snaps.find((s) => s.id === 'disinfection');
    if (dis) outfallHint = { x: dis.x + 40, z: dis.z, yaw: 0 };
  }

  const chain = ['headworks', 'primary', 'aeration', 'secondary', 'disinfection']
    .map((id) => snaps.find((s) => s.id === id))
    .filter(Boolean)
    .map((s) => ({ x: s!.x, z: s!.z }));
  if (outfallHint) chain.push({ x: outfallHint.x, z: outfallHint.z });
  const pipingHints = connectChain(chain);

  const summary = `GIS snap · ${clarifiers.length} clarifier (${unusedClar.length} standby) · ${aerationFs.length}/${basins.length} basin · asphalt ${pad.w.toFixed(0)}×${pad.d.toFixed(0)} m`;
  return {
    used: snaps.some((s) => s.footprints.length > 0),
    snaps,
    pad,
    siteBounds,
    waterMasks,
    outfallHint,
    pipingHints,
    summary,
  };
}

function centroidOf(fs: FootprintRing[]): { x: number; z: number } {
  const x = fs.reduce((s, f) => s + f.cx, 0) / fs.length;
  const z = fs.reduce((s, f) => s + f.cz, 0) / fs.length;
  return { x, z };
}

function avgRadius(fs: FootprintRing[]): number {
  const rs = fs.map((f) => Math.sqrt(f.area / Math.PI));
  return rs.reduce((a, b) => a + b, 0) / rs.length;
}

/** Candidate clear spot for disinfection — never on top of a mapped clarifier/basin. */
function placeDisinfection(
  pack: PlantGeoPack,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  blockers: FootprintRing[],
  sec: GisUnitSnap | undefined,
  upstream: { x: number; z: number } | null,
  fallback: { x: number; z: number },
  extra: { x: number; z: number; half: number }[],
): { x: number; z: number; note: string } {
  // UV channel mesh is ~16×6 m; keep 6 m clear of any process footprint.
  const HALF_W = 10;
  const HALF_D = 6;
  const clear = (x: number, z: number, margin = 6): boolean => {
    const box = { minX: x - HALF_W, maxX: x + HALF_W, minZ: z - HALF_D, maxZ: z + HALF_D };
    if (blockers.some((b) => aabbOverlap(box, aabbOfRing(b, margin)))) return false;
    if (extra.some((e) => aabbOverlap(box, { minX: e.x - e.half - margin, maxX: e.x + e.half + margin, minZ: e.z - e.half - margin, maxZ: e.z + e.half + margin }))) return false;
    return x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ;
  };
  const anchor = sec ? { x: sec.x, z: sec.z } : fallback;
  const secR = sec?.footprints.length
    ? Math.max(...sec.footprints.map((f) => Math.hypot(f.cx - anchor.x, f.cz - anchor.z) + Math.sqrt(f.area / Math.PI)))
    : 30;

  // 1) A real OSM building inside the WWTP that is big enough and clear of process tanks.
  let best: { x: number; z: number; d: number } | null = null;
  for (const f of pack.geojson.features as GeoFeature[]) {
    if (f.properties.kind !== 'building' || f.geometry.type !== 'Polygon') continue;
    const ring = f.geometry.coordinates[0] as number[][];
    if (ring.length < 4) continue;
    const area = polygonArea(ring);
    if (area < 150 || area > 4000) continue;
    const b = bbox(ring);
    if (b.maxX - b.minX < 2 * HALF_W * 0.8 && b.maxZ - b.minZ < 2 * HALF_W * 0.8) continue;
    const c = centroid(ring);
    if (!inside(bounds, c.x, c.z, 0)) continue;
    if (!clear(c.x, c.z, 4)) continue;
    const d = Math.hypot(c.x - anchor.x, c.z - anchor.z);
    // Must sit close to the secondaries (disinfection follows final clarification).
    if (d > secR + 25) continue;
    if (!best || d < best.d) best = { x: c.x, z: c.z, d };
  }
  if (best) {
    return {
      x: best.x,
      z: best.z,
      note: 'Estimated placement — set on the nearest mapped OSM building clear of the clarifiers; OSM does not tag this building as the UV/disinfection facility.',
    };
  }
  // 2) Collision-checked clear ground ringing the secondary clarifiers.
  // Try angles nearest the downstream direction (away from aeration) first.
  const downA = upstream ? Math.atan2(anchor.z - upstream.z, anchor.x - upstream.x) : 0;
  const angles = Array.from({ length: 24 }, (_, k) => {
    const off = Math.ceil(k / 2) * (Math.PI / 12) * (k % 2 ? 1 : -1);
    return downA + off;
  });
  for (let r = secR + 14; r < secR + 160; r += 6) {
    for (const a of angles) {
      const x = anchor.x + Math.cos(a) * r;
      const z = anchor.z + Math.sin(a) * r;
      if (clear(x, z)) {
        return { x, z, note: 'Estimated placement, not from OSM — set on clear ground downstream of the secondary clarifiers.' };
      }
    }
  }
  return { x: fallback.x + 40, z: fallback.z, note: 'Estimated placement, not from OSM.' };
}
