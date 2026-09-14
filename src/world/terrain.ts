/**
 * DEM / heightfield ground mesh for plant surroundings.
 */
import * as THREE from 'three';
import { grassMat, asphaltMat, type PlantTextures } from './textures';
import type { PlantGeoPack } from './osmBake';

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
  // Scale DEM relief for readable scene (real metres can be steep near lake cliffs)
  return (h0 * (1 - tz) + h1 * tz) * 0.35;
}

export function buildTerrainGround(
  plantId: string,
  dem: DemData | null,
  textures: PlantTextures,
  padW: number,
  padD: number,
): THREE.Group {
  const group = new THREE.Group();
  const size = 280;
  const seg = 96;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    let h = sampleDemHeight(dem, x, z, plantId);
    // Flatten plant pad area
    if (Math.abs(x) < padW * 0.55 && Math.abs(z) < padD * 0.55) {
      h *= 0.08;
    }
    pos.setY(i, h);
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, grassMat(textures));
  mesh.receiveShadow = true;
  mesh.name = 'terrain-ground';
  group.add(mesh);

  // Site pad (asphalt / gravel yard)
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(padW, padD), asphaltMat(textures));
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 0.1;
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
