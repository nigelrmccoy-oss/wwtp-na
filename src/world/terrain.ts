/**
 * DEM / heightfield ground mesh for plant surroundings (v0.3).
 * Real Open-Meteo DEM from geo bake when present; water polygons carve channels
 * so flat pads no longer clip imaginary waterways.
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

/** Bilinear sample of DEM relative height (m) at local x,z. */
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
  // Readable relief; lake cliffs still exaggerated less than raw metres
  return (h0 * (1 - tz) + h1 * tz) * 0.45;
}

export interface TerrainOpts {
  padW: number;
  padD: number;
  padCx?: number;
  padCz?: number;
  /** Water / basin footprints to carve below grade. */
  waterMasks?: FootprintRing[];
  /** Soften DEM inside pad without zeroing waterways. */
  flattenPad?: boolean;
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

function waterCarve(masks: FootprintRing[] | undefined, x: number, z: number): number {
  if (!masks?.length) return 0;
  for (const m of masks) {
    // Quick bbox reject
    if (Math.abs(x - m.cx) > m.width * 0.65 || Math.abs(z - m.cz) > m.depth * 0.65) continue;
    if (pointInRing(m.ring, x, z)) {
      // Carved channel / basin depression
      return m.kind === 'basin' ? -1.8 : m.kind === 'clarifier' ? -1.2 : -0.9;
    }
  }
  return 0;
}

export function buildTerrainGround(
  plantId: string,
  dem: DemData | null,
  textures: PlantTextures,
  opts: TerrainOpts,
): THREE.Group {
  const group = new THREE.Group();
  const size = 360;
  const seg = 128;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const padCx = opts.padCx ?? 0;
  const padCz = opts.padCz ?? 0;
  const padW = opts.padW;
  const padD = opts.padD;
  const flatten = opts.flattenPad !== false;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    let h = sampleDemHeight(dem, x, z, plantId);
    const carve = waterCarve(opts.waterMasks, x, z);
    if (carve < 0) {
      // Prefer real waterway elevation — do not flatten over water
      h = Math.min(h * 0.25, 0.05) + carve;
    } else if (
      flatten &&
      Math.abs(x - padCx) < padW * 0.52 &&
      Math.abs(z - padCz) < padD * 0.52
    ) {
      // Soft pad flatten — keep slight DEM so boundaries don't clip cliffs
      h *= 0.12;
    }
    pos.setY(i, h);
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, grassMat(textures));
  mesh.receiveShadow = true;
  mesh.name = 'terrain-ground';
  group.add(mesh);

  // Site pad (asphalt / gravel yard) — placed at GIS pad centre when available
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(padW, padD), asphaltMat(textures));
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(padCx, 0.08, padCz);
  pad.receiveShadow = true;
  pad.name = 'site-pad';
  group.add(pad);

  return group;
}

export function demFromGeoPack(pack: PlantGeoPack | null): DemData | null {
  if (!pack?.dem) return null;
  return pack.dem;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
