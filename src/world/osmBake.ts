/**
 * Load cached OSM/DEM bake and extrude buildings / draw roads / water.
 * Data from public/geo/{plantId}.json — © OpenStreetMap contributors (ODbL).
 */
import * as THREE from 'three';
import type { PlantTextures } from './textures';
import { asphaltMat, concreteMat, waterMat, grassMat } from './textures';
import { groundY, type DemData, type TerrainOpts } from './terrain';
import { classifyFootprint } from './gisLayout';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Batches static, non-pickable OSM geometry per material into one mesh (v0.3.11 perf:
 * Kitchener had ~2,750 separate road/water/building meshes → ~3k draw calls).
 */
class MergeBatch {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(geo: THREE.BufferGeometry, mat: THREE.Material, matrix?: THREE.Matrix4): void {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    if (matrix) g.applyMatrix4(matrix);
    // Keep a common attribute set so every part merges.
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) {
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
    }
    g.clearGroups();
    const list = this.parts.get(mat) ?? [];
    list.push(g);
    this.parts.set(mat, list);
  }
  flush(into: THREE.Object3D, opts: { castShadow?: boolean; receiveShadow?: boolean; name?: string; pickable?: boolean; tag?: string } = {}): void {
    for (const [mat, geos] of this.parts) {
      if (!geos.length) continue;
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = !!opts.castShadow;
      mesh.receiveShadow = opts.receiveShadow ?? true;
      if (opts.name) mesh.name = opts.name;
      if (opts.tag) mesh.userData[opts.tag] = true;
      if (!opts.pickable) mesh.raycast = () => {};
      into.add(mesh);
    }
    this.parts.clear();
  }
}

export interface GeoFeatureProps {
  kind: string;
  highway?: string | null;
  building?: string | null;
  landuse?: string | null;
  name?: string | null;
  amenity?: string | null;
  man_made?: string | null;
  waterway?: string | null;
  levels?: number | null;
  synthetic?: boolean;
}

export interface GeoFeature {
  type: 'Feature';
  properties: GeoFeatureProps;
  geometry: {
    type: 'Polygon' | 'LineString';
    coordinates: number[][] | number[][][];
  };
}

export interface PlantGeoPack {
  plantId: string;
  bakedAt: string;
  radiusM: number;
  origin: { lat: number; lon: number };
  attribution: { osm: string; dem: string };
  osmFeatureCount: number;
  osmThin: boolean;
  dem: DemData;
  geojson: { type: 'FeatureCollection'; features: GeoFeature[] };
}

export interface OsmBuildResult {
  group: THREE.Group;
  hoverables: { id: string; label: string; mesh: THREE.Object3D; kind: string }[];
  wwtpCentroid: THREE.Vector3 | null;
  layoutYaw: number;
  osmThin: boolean;
  attribution: string;
}

const packCache = new Map<string, PlantGeoPack | null>();

export async function loadPlantGeo(plantId: string): Promise<PlantGeoPack | null> {
  if (packCache.has(plantId)) return packCache.get(plantId)!;
  try {
    const res = await fetch(`./geo/${plantId}.json`);
    if (!res.ok) {
      packCache.set(plantId, null);
      return null;
    }
    const pack = (await res.json()) as PlantGeoPack;
    packCache.set(plantId, pack);
    return pack;
  } catch {
    packCache.set(plantId, null);
    return null;
  }
}

function ringToShape(ring: number[][]): THREE.Shape | null {
  if (ring.length < 3) return null;
  const shape = new THREE.Shape();
  shape.moveTo(ring[0][0], ring[0][1]);
  for (let i = 1; i < ring.length; i++) shape.lineTo(ring[i][0], ring[i][1]);
  return shape;
}

function polygonArea(ring: number[][]): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(a) * 0.5;
}

function centroid(ring: number[][]): { x: number; z: number } {
  let x = 0;
  let z = 0;
  const n = Math.max(1, ring.length - 1);
  for (let i = 0; i < n; i++) {
    x += ring[i][0];
    z += ring[i][1];
  }
  return { x: x / n, z: z / n };
}

function majorAxisYaw(ring: number[][]): number {
  // PCA-lite on 2D ring
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
  const angle = 0.5 * Math.atan2(2 * xz, xx - zz);
  return angle;
}

function roadWidth(highway: string | null | undefined): number {
  if (!highway) return 4;
  if (/motorway|trunk/.test(highway)) return 10;
  if (/primary|secondary/.test(highway)) return 7;
  if (/tertiary|residential|unclassified/.test(highway)) return 5;
  if (/service|track|path|footway|cycleway/.test(highway)) return 2.8;
  return 4.5;
}


/** Illustrative barn / fields / driveway when farm-septic has no nearby OSM. */
function ensureNearSiteFarm(pack: PlantGeoPack): void {
  if (pack.plantId !== 'farm-septic') return;
  const hasNear = pack.geojson.features.some((f) => {
    if (f.properties.synthetic) return true;
    const g = f.geometry;
    let cx = 0;
    let cz = 0;
    let n = 0;
    if (g.type === 'Polygon') {
      const ring = g.coordinates[0] as number[][];
      for (let i = 0; i < ring.length - 1; i++) {
        cx += ring[i][0];
        cz += ring[i][1];
        n++;
      }
    } else if (g.type === 'LineString') {
      const coords = g.coordinates as number[][];
      for (const p of coords) {
        cx += p[0];
        cz += p[1];
        n++;
      }
    } else return false;
    if (!n) return false;
    cx /= n;
    cz /= n;
    const kind = f.properties.kind;
    return (kind === 'building' || kind === 'farm' || kind === 'road') && Math.hypot(cx, cz) < 200;
  });
  if (hasNear) return;

  const rect = (x: number, z: number, w: number, d: number): number[][] => [
    [x - w / 2, z - d / 2],
    [x + w / 2, z - d / 2],
    [x + w / 2, z + d / 2],
    [x - w / 2, z + d / 2],
    [x - w / 2, z - d / 2],
  ];
  const synth: GeoFeature[] = [
    {
      type: 'Feature',
      properties: { kind: 'farm', landuse: 'farmland', name: 'North field (illustrative)', synthetic: true },
      geometry: { type: 'Polygon', coordinates: [rect(-85, -65, 75, 55)] },
    },
    {
      type: 'Feature',
      properties: { kind: 'farm', landuse: 'farmland', name: 'East field (illustrative)', synthetic: true },
      geometry: { type: 'Polygon', coordinates: [rect(80, -45, 65, 60)] },
    },
    {
      type: 'Feature',
      properties: { kind: 'farm', landuse: 'meadow', name: 'South pasture (illustrative)', synthetic: true },
      geometry: { type: 'Polygon', coordinates: [rect(-55, 80, 85, 50)] },
    },
    {
      type: 'Feature',
      properties: {
        kind: 'farm',
        landuse: 'farmyard',
        name: 'Septic / leaching area (illustrative)',
        synthetic: true,
      },
      geometry: { type: 'Polygon', coordinates: [rect(30, -8, 28, 22)] },
    },
    {
      type: 'Feature',
      properties: { kind: 'building', building: 'barn', name: 'Barn (illustrative)', synthetic: true, levels: 1 },
      geometry: {
        type: 'Polygon',
        coordinates: [[[-46, 26], [-32, 26], [-32, 40], [-46, 40], [-46, 26]]],
      },
    },
    {
      type: 'Feature',
      properties: { kind: 'building', building: 'shed', name: 'Equipment shed (illustrative)', synthetic: true, levels: 1 },
      geometry: {
        type: 'Polygon',
        coordinates: [[[-52, 18], [-46, 18], [-46, 24], [-52, 24], [-52, 18]]],
      },
    },
    {
      type: 'Feature',
      properties: { kind: 'road', highway: 'track', name: 'Farm driveway (illustrative)', synthetic: true },
      geometry: {
        type: 'LineString',
        coordinates: [[-110, 55], [-70, 40], [-40, 22], [-22, 10], [8, -2]],
      },
    },
    {
      type: 'Feature',
      properties: { kind: 'road', highway: 'service', name: 'Yard lane (illustrative)', synthetic: true },
      geometry: {
        type: 'LineString',
        coordinates: [[-46, 33], [-22, 12], [-4, 0], [28, -6]],
      },
    },
  ];
  pack.geojson.features.push(...synth);
}

export function buildOsmSurroundings(
  pack: PlantGeoPack | null,
  textures: PlantTextures,
  plantId: string,
  opts?: {
    maxBuildings?: number;
    maxRoads?: number;
    terrain?: TerrainOpts;
    /** Asphalt / process yard — pad-relative hole + building skip (not origin ±55/±45). */
    processYard?: { cx: number; cz: number; w: number; d: number };
    /** Ortho underlay frame: flat landuse/WWTP fills inside it are grouped so the scene can hide them once imagery loads. */
    orthoFrame?: { cx: number; cz: number; half: number };
  },
): OsmBuildResult {
  const group = new THREE.Group();
  group.name = 'osm-surroundings';
  const hoverables: OsmBuildResult['hoverables'] = [];
  let wwtpCentroid: THREE.Vector3 | null = null;
  let layoutYaw = 0;
  const osmThin = pack?.osmThin ?? true;
  const attribution = pack
    ? `${pack.attribution.osm} · DEM: ${pack.attribution.dem}`
    : 'Surroundings: procedural fallback';

  if (!pack) {
    return { group, hoverables, wwtpCentroid, layoutYaw, osmThin: true, attribution };
  }

  // Class 4 farmstead: if OSM has nothing near the pad, inject illustrative surroundings
  ensureNearSiteFarm(pack);

  const dem = pack.dem;
  const terrainOpts: TerrainOpts = opts?.terrain ?? { padW: 110, padD: 80, padCx: 0, padCz: 0 };
  const gy = (x: number, z: number) => groundY(x, z, dem, plantId, terrainOpts);
  const maxB = opts?.maxBuildings ?? 320;
  const maxR = opts?.maxRoads ?? 400;
  const yard = opts?.processYard ?? {
    cx: terrainOpts.padCx ?? 0,
    cz: terrainOpts.padCz ?? 0,
    w: terrainOpts.padW,
    d: terrainOpts.padD,
  };
  const inYard = (x: number, z: number, margin = 0) =>
    Math.abs(x - yard.cx) < yard.w * 0.5 + margin && Math.abs(z - yard.cz) < yard.d * 0.5 + margin;
  let bCount = 0;
  let rCount = 0;

  const buildingMat = concreteMat(textures, 0xe8e4dc);
  const barnMat = concreteMat(textures, 0xb89060);
  const wwtpMat = concreteMat(textures, 0xc8d0d8);
  const farmMat = grassMat(textures);
  farmMat.color = new THREE.Color(0xb8c478);
  const landMat = grassMat(textures);
  landMat.color = new THREE.Color(0x7a9a68);
  const waterM = waterMat(textures, 0x6aabcc);
  const asphalt = asphaltMat(textures);
  // Opaque/cheap stand-in for OSM rivers/ponds (no transmission pass — v0.3.11 perf).
  waterM.transmission = 0;

  const roadsBatch = new MergeBatch();
  const waterBatch = new MergeBatch();
  const bldgBatch = new MergeBatch();
  const fillBatch = new MergeBatch();
  const fillOrthoBatch = new MergeBatch();
  const ortho = opts?.orthoFrame;
  /** Any part of the ring inside the imagery frame (flat fills there would cover the photo). */
  const ringTouchesOrtho = (ring: number[][]) => {
    if (!ortho) return false;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of ring) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    return maxX > ortho.cx - ortho.half && minX < ortho.cx + ortho.half && maxZ > ortho.cz - ortho.half && minZ < ortho.cz + ortho.half;
  };
  const roadsOrthoBatch = new MergeBatch();
  const waterOrthoBatch = new MergeBatch();
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);

  for (const f of pack.geojson.features) {
    const kind = f.properties.kind;
    const geom = f.geometry;

    if (kind === 'wwtp' && geom.type === 'Polygon') {
      const ring = geom.coordinates[0] as number[][];
      const c = centroid(ring);
      wwtpCentroid = new THREE.Vector3(c.x, 0, c.z);
      layoutYaw = majorAxisYaw(ring);
      const shape = ringToShape(ring);
      if (shape && polygonArea(ring) > 80) {
        // Punch a pad-relative hole over the asphalt process cluster so the
        // ~181k m² WWTP concrete slab does not cover basins / steal picks.
        // Hole is in shape/world XZ (same frame as the ring), not origin-fixed ±62×±52.
        const hw = Math.max(40, yard.w * 0.5 + 8);
        const hd = Math.max(30, yard.d * 0.5 + 8);
        const coversYard =
          Math.abs(c.x - yard.cx) < yard.w ||
          Math.abs(c.z - yard.cz) < yard.d ||
          polygonArea(ring) > 20000;
        if (coversYard) {
          const hole = new THREE.Path();
          hole.moveTo(yard.cx - hw, yard.cz - hd);
          hole.lineTo(yard.cx + hw, yard.cz - hd);
          hole.lineTo(yard.cx + hw, yard.cz + hd);
          hole.lineTo(yard.cx - hw, yard.cz + hd);
          hole.closePath();
          shape.holes.push(hole);
        }
        // Flat gravel/concrete landuse — NOT asphalt (asphalt is terrain process pad)
        const geo = new THREE.ShapeGeometry(shape);
        geo.rotateX(-Math.PI / 2);
        const h = gy(c.x, c.z);
        geo.translate(0, h + 0.03, 0);
        (ringTouchesOrtho(ring) ? fillOrthoBatch : fillBatch).add(geo, wwtpMat);
      }
      continue;
    }

    if ((kind === 'building' || kind === 'farm') && geom.type === 'Polygon') {
      if (kind === 'building' && bCount >= maxB) continue;
      const ring = geom.coordinates[0] as number[][];
      const area = polygonArea(ring);
      if (area < 12 || area > 25000) continue;
      const shape = ringToShape(ring);
      if (!shape) continue;
      const levels = f.properties.levels && f.properties.levels > 0 ? f.properties.levels : 1;
      const depth = kind === 'farm' ? 0.15 : Math.min(14, 2.6 + levels * 2.4);
      const c = centroid(ring);
      // Skip dense buildings on the asphalt process yard (pad-relative, not origin ±55/±45).
      // Synthetic farmstead props (barn/shed) are allowed near the Class 4 site.
      if (kind === 'building' && !f.properties.synthetic && inYard(c.x, c.z, 6)) continue;

      if (kind === 'farm') {
        const shape2 = ringToShape(ring);
        if (!shape2) continue;
        const geo = new THREE.ShapeGeometry(shape2);
        geo.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geo, farmMat);
        mesh.position.y = gy(c.x, c.z) + 0.06;
        mesh.receiveShadow = true;
        group.add(mesh);
        continue;
      }

      const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      const isBarn = /barn|farm|farm_auxiliary|shed/i.test(f.properties.building || '');
      if (!f.properties.name && !isBarn) {
        // Unnamed buildings are context only (never hover targets) → batched.
        geo.translate(0, gy(c.x, c.z), 0);
        bldgBatch.add(geo, buildingMat);
        bCount++;
        continue;
      }
      const mesh = new THREE.Mesh(geo, isBarn ? barnMat : buildingMat);
      mesh.position.y = gy(c.x, c.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const label = f.properties.name || (isBarn ? 'Barn' : 'Building');
      mesh.userData.osmHover = true;
      mesh.userData.unitId = `osm_b_${bCount}`;
      mesh.userData.hoverLabel = label;
      mesh.userData.hoverKind = 'building';
      group.add(mesh);
      if (f.properties.name || isBarn) {
        hoverables.push({ id: `osm_b_${bCount}`, label, mesh, kind: 'building' });
      }
      bCount++;
      continue;
    }

    if (kind === 'landuse' && geom.type === 'Polygon') {
      const ring = geom.coordinates[0] as number[][];
      if (polygonArea(ring) < 200) continue;
      const shape = ringToShape(ring);
      if (!shape) continue;
      const geo = new THREE.ShapeGeometry(shape);
      geo.rotateX(-Math.PI / 2);
      const c = centroid(ring);
      geo.translate(0, gy(c.x, c.z) + 0.04, 0);
      (ringTouchesOrtho(ring) ? fillOrthoBatch : fillBatch).add(geo, landMat);
      continue;
    }

    if ((kind === 'water' || kind === 'waterway') && geom.type === 'Polygon') {
      const ring = geom.coordinates[0] as number[][];
      // Process clarifiers/basins are owned by plantScene GIS snaps — do not
      // paint flat OSM water sheets over them (floods the yard after grade-lock).
      // Only natural waterways / ponds (classifyFootprint kind === 'other').
      const fp = classifyFootprint(ring);
      if (!fp || fp.kind !== 'other') continue;
      const c = centroid(ring);
      // Punch-out: natural water whose centroid sits on the asphalt process yard.
      if (inYard(c.x, c.z, 8)) continue;
      const shape = ringToShape(ring);
      if (!shape) continue;
      const geo = new THREE.ShapeGeometry(shape);
      geo.rotateX(-Math.PI / 2);
      // Sit slightly above carved channel bottom (groundY already subtracts carve).
      geo.translate(0, gy(c.x, c.z) + 0.12, 0);
      (ringTouchesOrtho(ring) ? waterOrthoBatch : waterBatch).add(geo, waterM);
      continue;
    }

    if (kind === 'road' && geom.type === 'LineString') {
      if (rCount >= maxR) continue;
      const coords = geom.coordinates as number[][];
      if (coords.length < 2) continue;
      const w = roadWidth(f.properties.highway);
      for (let i = 0; i < coords.length - 1; i++) {
        const [x0, z0] = coords[i];
        const [x1, z1] = coords[i + 1];
        const dx = x1 - x0;
        const dz = z1 - z0;
        const len = Math.hypot(dx, dz);
        if (len < 1.5) continue;
        // Skip roads cutting through asphalt process yard (pad-relative)
        const mx = (x0 + x1) / 2;
        const mz = (z0 + z1) / 2;
        if (inYard(mx, mz, -4)) continue;
        const h = gy(mx, mz);
        q.setFromAxisAngle(up, Math.atan2(dx, dz));
        m4.compose(new THREE.Vector3(mx, h + 0.12, mz), q, one);
        (ringTouchesOrtho([[x0, z0], [x1, z1]]) ? roadsOrthoBatch : roadsBatch).add(new THREE.BoxGeometry(w, 0.1, len), asphalt, m4);
      }
      rCount++;
      continue;
    }

    if (kind === 'waterway' && geom.type === 'LineString') {
      const coords = geom.coordinates as number[][];
      for (let i = 0; i < coords.length - 1; i++) {
        const [x0, z0] = coords[i];
        const [x1, z1] = coords[i + 1];
        const dx = x1 - x0;
        const dz = z1 - z0;
        const len = Math.hypot(dx, dz);
        if (len < 2) continue;
        const mx = (x0 + x1) / 2;
        const mz = (z0 + z1) / 2;
        // Skip waterway segments cutting through asphalt process yard
        if (inYard(mx, mz, -4)) continue;
        const h = gy(mx, mz);
        q.setFromAxisAngle(up, Math.atan2(dx, dz));
        m4.compose(new THREE.Vector3(mx, h + 0.05, mz), q, one);
        (ringTouchesOrtho([[x0, z0], [x1, z1]]) ? waterOrthoBatch : waterBatch).add(new THREE.BoxGeometry(3.5, 0.08, len), waterM, m4);
      }
    }
  }

  roadsBatch.flush(group, { name: 'osm-roads' });
  waterBatch.flush(group, { name: 'osm-water' });
  bldgBatch.flush(group, { name: 'osm-buildings', castShadow: true });
  fillBatch.flush(group, { name: 'osm-fills' });
  const fillsOrtho = new THREE.Group();
  fillsOrtho.name = 'osm-fills-ortho';
  fillOrthoBatch.flush(fillsOrtho, { name: 'osm-fills-ortho-mesh' });
  roadsOrthoBatch.flush(fillsOrtho, { name: 'osm-roads-ortho' });
  waterOrthoBatch.flush(fillsOrtho, { name: 'osm-water-ortho' });
  group.add(fillsOrtho);

  return { group, hoverables, wwtpCentroid, layoutYaw, osmThin, attribution };
}
