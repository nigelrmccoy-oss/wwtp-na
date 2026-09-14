/**
 * Load cached OSM/DEM bake and extrude buildings / draw roads / water.
 * Data from public/geo/{plantId}.json — © OpenStreetMap contributors (ODbL).
 */
import * as THREE from 'three';
import type { PlantTextures } from './textures';
import { asphaltMat, concreteMat, waterMat, grassMat } from './textures';
import { sampleDemHeight, type DemData } from './terrain';

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

export function buildOsmSurroundings(
  pack: PlantGeoPack | null,
  textures: PlantTextures,
  plantId: string,
  opts?: { maxBuildings?: number; maxRoads?: number },
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

  const dem = pack.dem;
  const maxB = opts?.maxBuildings ?? 180;
  const maxR = opts?.maxRoads ?? 220;
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
        const geo = new THREE.ExtrudeGeometry(shape, { depth: 1.2, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geo, wwtpMat);
        const h = sampleDemHeight(dem, c.x, c.z, plantId);
        mesh.position.y = h + 0.05;
        mesh.receiveShadow = true;
        mesh.userData.osmHover = true;
        mesh.userData.unitId = 'osm_wwtp';
        mesh.userData.hoverLabel = f.properties.name || 'Wastewater plant (OSM)';
        mesh.userData.hoverKind = 'wwtp';
        group.add(mesh);
        hoverables.push({
          id: 'osm_wwtp',
          label: f.properties.name || 'Wastewater plant (OSM)',
          mesh,
          kind: 'wwtp',
        });
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
      // Skip dense buildings on the process pad (keep playable train clear)
      if (Math.abs(c.x) < 55 && Math.abs(c.z) < 45 && kind === 'building') continue;

      if (kind === 'farm') {
        const shape2 = ringToShape(ring);
        if (!shape2) continue;
        const geo = new THREE.ShapeGeometry(shape2);
        geo.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geo, farmMat);
        mesh.position.y = sampleDemHeight(dem, c.x, c.z, plantId) + 0.06;
        mesh.receiveShadow = true;
        group.add(mesh);
        continue;
      }

      const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      const isBarn = /barn|farm|farm_auxiliary|shed/i.test(f.properties.building || '');
      const mesh = new THREE.Mesh(geo, isBarn ? barnMat : buildingMat);
      mesh.position.y = sampleDemHeight(dem, c.x, c.z, plantId);
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
      const mesh = new THREE.Mesh(geo, landMat);
      mesh.position.y = sampleDemHeight(dem, c.x, c.z, plantId) + 0.04;
      mesh.receiveShadow = true;
      group.add(mesh);
      continue;
    }

    if ((kind === 'water' || kind === 'waterway') && geom.type === 'Polygon') {
      const ring = geom.coordinates[0] as number[][];
      const shape = ringToShape(ring);
      if (!shape) continue;
      const geo = new THREE.ShapeGeometry(shape);
      geo.rotateX(-Math.PI / 2);
      const c = centroid(ring);
      const mesh = new THREE.Mesh(geo, waterM);
      mesh.position.y = sampleDemHeight(dem, c.x, c.z, plantId) + 0.08;
      mesh.receiveShadow = true;
      group.add(mesh);
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
        // Skip roads cutting through process pad center
        const mx = (x0 + x1) / 2;
        const mz = (z0 + z1) / 2;
        if (Math.abs(mx) < 35 && Math.abs(mz) < 28) continue;
        const h = sampleDemHeight(dem, mx, mz, plantId);
        const seg = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, len), asphalt);
        seg.position.set(mx, h + 0.12, mz);
        seg.rotation.y = Math.atan2(dx, dz);
        seg.receiveShadow = true;
        group.add(seg);
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
        const h = sampleDemHeight(dem, mx, mz, plantId);
        const seg = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.08, len), waterM);
        seg.position.set(mx, h + 0.05, mz);
        seg.rotation.y = Math.atan2(dx, dz);
        group.add(seg);
      }
    }
  }

  return { group, hoverables, wwtpCentroid, layoutYaw, osmThin, attribution };
}
