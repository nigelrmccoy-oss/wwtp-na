/**
 * DEM / heightfield ground mesh for plant surroundings (v0.3.10 real-yard).
 * One shared groundY datum so grass, asphalt pad, process units, OSM, water,
 * and walk camera agree. Soft pad skirt; natural-waterway carve only.
 */
import * as THREE from 'three';
import { grassMat, asphaltMat, type PlantTextures } from './textures';
import type { PlantGeoPack } from './osmBake';
import type { FootprintRing } from './gisLayout';

export interface DemData {
  n: number;
  halfExtentM: number;
  baseElevationM: number;
  samples: { x: number; z: number; h: number }[];
  source: string;
}

/** Options shared by terrain mesh, OSM bake, and walk camera. */
export interface TerrainOpts {
  padW: number;
  padD: number;
  padCx?: number;
  padCz?: number;
  /**
   * Natural waterway / pond footprints only (rivers, lakes).
   * Process clarifiers / basins must NOT be included — they have mesh floors.
   */
  waterMasks?: FootprintRing[];
  /** Soft-lerp DEM → padGrade inside pad (default true). */
  flattenPad?: boolean;
  /** Soft skirt width outside pad edge (metres). Default 15. */
  padSkirtM?: number;
  /** Precomputed pad grade; computed from DEM mean under pad if omitted. */
  padGrade?: number;
  /** Ground plane extent in metres (default 1800 — covers full WWTP site). */
  terrainSizeM?: number;
}

export interface TerrainBuildResult {
  group: THREE.Group;
  padGrade: number;
}

function hashSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function noiseH(x: number, z: number, seed: number): number {
  const s = seed * 0.0001;
  return (
    Math.sin(x * 0.0021 + s) * Math.cos(z * 0.0019 + s * 1.3) * 4.5 +
    Math.sin(x * 0.0007 + z * 0.0009 + s) * 8 +
    Math.sin((x + z) * 0.00035 + s * 2) * 3
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0 + 1e-12), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Bilinear sample of DEM relative height (m) at local x,z — 1:1 near plant.
 * No global *0.45 fudge; callers that want far mild exaggerate use groundY.
 */
export function sampleDemHeight(dem: DemData | null, x: number, z: number, plantId: string): number {
  if (!dem || !dem.samples.length) {
    return noiseH(x, z, hashSeed(plantId)) * 0.15;
  }
  const n = dem.n;
  const half = dem.halfExtentM;
  const u = (x + half) / (2 * half);
  const v = (z + half) / (2 * half);
  const fx = clamp(u * (n - 1), 0, n - 1.001);
  const fz = clamp(v * (n - 1), 0, n - 1.001);
  const i0 = Math.floor(fx);
  const j0 = Math.floor(fz);
  const i1 = Math.min(i0 + 1, n - 1);
  const j1 = Math.min(j0 + 1, n - 1);
  const tx = fx - i0;
  const tz = fz - j0;
  const h00 = dem.samples[j0 * n + i0]?.h ?? 0;
  const h10 = dem.samples[j0 * n + i1]?.h ?? 0;
  const h01 = dem.samples[j1 * n + i0]?.h ?? 0;
  const h11 = dem.samples[j1 * n + i1]?.h ?? 0;
  const h0 = h00 * (1 - tx) + h10 * tx;
  const h1 = h01 * (1 - tx) + h11 * tx;
  return h0 * (1 - tz) + h1 * tz;
}

/**
 * Mean DEM height under the asphalt pad footprint (the shared yard datum).
 * Falls back to center sample when dem is missing.
 */
export function computePadGrade(
  dem: DemData | null,
  plantId: string,
  padCx: number,
  padCz: number,
  padW: number,
  padD: number,
): number {
  const samples: number[] = [];
  const nx = 7;
  const nz = 7;
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const u = (ix + 0.5) / nx;
      const v = (iz + 0.5) / nz;
      const x = padCx + (u - 0.5) * padW * 0.9;
      const z = padCz + (v - 0.5) * padD * 0.9;
      samples.push(sampleDemHeight(dem, x, z, plantId));
    }
  }
  if (!samples.length) return sampleDemHeight(dem, padCx, padCz, plantId);
  return samples.reduce((a, b) => a + b, 0) / samples.length;
}

function pointInRing(ring: number[][], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const zi = ring[i][1];
    const xj = ring[j][0];
    const zj = ring[j][1];
    const intersect = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Natural-waterway carve depth (positive metres). Skips clarifier/basin masks
 * that already have process mesh floors.
 */
function naturalWaterCarveDepth(masks: FootprintRing[] | undefined, x: number, z: number): number {
  if (!masks?.length) return 0;
  for (const m of masks) {
    if (m.kind === 'clarifier' || m.kind === 'basin') continue;
    if (Math.abs(x - m.cx) > m.width * 0.65 || Math.abs(z - m.cz) > m.depth * 0.65) continue;
    if (pointInRing(m.ring, x, z)) {
      // Rivers / ponds — fixed channel depth below local grade
      return 0.9;
    }
  }
  return 0;
}

/**
 * Soft pad blend weight: 1 inside pad, 0 outside skirt (~10–20 m).
 * Uses distance-outside rounded rectangle + smoothstep.
 */
function padBlendWeight(
  x: number,
  z: number,
  padCx: number,
  padCz: number,
  padW: number,
  padD: number,
  skirtM: number,
): number {
  const ox = Math.max(0, Math.abs(x - padCx) - padW * 0.5);
  const oz = Math.max(0, Math.abs(z - padCz) - padD * 0.5);
  const distOutside = Math.hypot(ox, oz);
  return 1 - smoothstep(0, skirtM, distOutside);
}

/**
 * Shared ground height (metres, local Y) for every consumer:
 * terrain vertices, asphalt pad, process units, OSM, water, walk camera.
 *
 * - DEM sampled 1:1 near plant; mild relief exaggerate only far from pad.
 * - Soft-lerp DEM → padGrade inside pad with smoothstep skirt (not hard *0.12).
 * - Natural waterway carve = local height − fixed depth (no process basins).
 */
export function groundY(
  x: number,
  z: number,
  dem: DemData | null,
  plantId: string,
  opts: TerrainOpts,
): number {
  const padCx = opts.padCx ?? 0;
  const padCz = opts.padCz ?? 0;
  const padW = opts.padW;
  const padD = opts.padD;
  const skirt = opts.padSkirtM ?? 15;
  const flatten = opts.flattenPad !== false;
  const padGrade =
    opts.padGrade ?? computePadGrade(dem, plantId, padCx, padCz, padW, padD);

  let raw = sampleDemHeight(dem, x, z, plantId);

  // Mild exaggerate only far from pad (1:1 on / near yard)
  const far = Math.hypot(x - padCx, z - padCz);
  const farT = smoothstep(Math.max(padW, padD) * 0.6, Math.max(padW, padD) * 2.2 + 80, far);
  const reliefScale = 1 + farT * 0.2; // up to 1.2× far away
  raw *= reliefScale;

  let h = raw;
  if (flatten) {
    const w = padBlendWeight(x, z, padCx, padCz, padW, padD, skirt);
    h = raw * (1 - w) + padGrade * w;
  }

  const carve = naturalWaterCarveDepth(opts.waterMasks, x, z);
  if (carve > 0) {
    h = h - carve;
  }
  return h;
}

export function buildTerrainGround(
  plantId: string,
  dem: DemData | null,
  textures: PlantTextures,
  opts: TerrainOpts,
): TerrainBuildResult {
  const group = new THREE.Group();
  const size = opts.terrainSizeM ?? 1800;
  const seg = size > 800 ? 160 : 128;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const padCx = opts.padCx ?? 0;
  const padCz = opts.padCz ?? 0;
  const padW = opts.padW;
  const padD = opts.padD;
  const padGrade =
    opts.padGrade ?? computePadGrade(dem, plantId, padCx, padCz, padW, padD);
  const groundOpts: TerrainOpts = { ...opts, padGrade };

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, groundY(x, z, dem, plantId, groundOpts));
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, grassMat(textures));
  mesh.receiveShadow = true;
  mesh.name = 'terrain-ground';
  group.add(mesh);

  // Site pad (asphalt / gravel yard) — shared datum + slight lift so Z-fight-free
  const padLift = 0.06;
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(padW, padD), asphaltMat(textures));
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(padCx, padGrade + padLift, padCz);
  pad.receiveShadow = true;
  pad.name = 'site-pad';
  group.userData.padGrade = padGrade;
  group.add(pad);

  return { group, padGrade };
}

export function demFromGeoPack(pack: PlantGeoPack | null): DemData | null {
  if (!pack?.dem) return null;
  return pack.dem;
}
