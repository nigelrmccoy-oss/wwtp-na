/**
 * Build a dense, plant-local DemData grid from runtime Terrarium + optional
 * baked NRCan HRDEM tiles. Keeps the existing groundY / pad-flatten path:
 * samples are metres relative to the origin elevation (same convention as
 * scripts/bakeGeo.mjs).
 */
import { cacheCounters } from './tileCache';
import { ElevationSampler, type HiResOptions } from './elevationSampler';
import type { DemData } from './terrain';
import type { PlantGeoPack } from './osmBake';
import { sampleDemHeight } from './terrain';

const GRID_N = 129;
const HALF_EXTENT_M = 1200;
/** Enough time to pull a ~2 km plant window of z14 + z16 tiles on first load. */
const PRELOAD_MS = 25_000;

function metersPerDeg(lat: number): { mLat: number; mLon: number } {
  const mLat = 111320;
  const mLon = 111320 * Math.cos((lat * Math.PI) / 180);
  return { mLat, mLon };
}

function baseUrl(): string {
  return (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? './';
}

export interface RuntimeDemResult {
  dem: DemData;
  source: string;
  attribution: string;
  info: {
    n: number;
    halfExtentM: number;
    baseElevationM: number;
    filled: number;
    missing: number;
    hrHits: number;
    baseHits: number;
    usedFallbackBake: boolean;
  };
}

function hiresOpts(): HiResOptions {
  const base = baseUrl();
  return {
    zoom: 16,
    maxTiles: 256,
    urlTemplate: `${base}dem/{z}/{x}/{y}.png`,
    indexUrl: `${base}dem/index.json`,
  };
}

/**
 * Preload DEM tiles around the plant and sample a dense relative-height grid.
 * Falls back to the baked Open-Meteo / procedural pack only for gaps (or the
 * whole grid if the network and bake both fail).
 */
export async function loadRuntimeDem(pack: PlantGeoPack | null, plantId: string): Promise<RuntimeDemResult | null> {
  const origin = pack?.origin;
  if (!origin || !Number.isFinite(origin.lat) || !Number.isFinite(origin.lon)) return null;

  const baked = pack.dem ?? null;
  const half = Math.max(baked?.halfExtentM ?? 0, HALF_EXTENT_M);
  const n = GRID_N;
  const { mLat, mLon } = metersPerDeg(origin.lat);

  const sampler = new ElevationSampler(14, 128, hiresOpts());
  const dLat = half / mLat;
  const dLon = half / mLon;
  const south = origin.lat - dLat;
  const north = origin.lat + dLat;
  const west = origin.lon - dLon;
  const east = origin.lon + dLon;

  try {
    await sampler.preloadArea(south, west, north, east, PRELOAD_MS);
    await sampler.ensureOrigin(origin.lat, origin.lon);
  } catch {
    sampler.dispose();
    if (!baked) return null;
    return {
      dem: baked,
      source: baked.source,
      attribution: pack.attribution?.dem || baked.source,
      info: {
        n: baked.n,
        halfExtentM: baked.halfExtentM,
        baseElevationM: baked.baseElevationM,
        filled: baked.samples.length,
        missing: 0,
        hrHits: 0,
        baseHits: 0,
        usedFallbackBake: true,
      },
    };
  }

  const finite = (n: number | null | undefined): number | null =>
    n != null && Number.isFinite(n) ? n : null;

  const absOrigin = finite(sampler.sampleAbsolute(origin.lat, origin.lon));
  const bakedBase = finite(baked?.baseElevationM);
  let baseElevationM = absOrigin ?? bakedBase;
  // Never use 0 as a stand-in datum: absolute metres would be treated as
  // relative and the ground could sit hundreds of metres off. Prefer a real
  // nearby sample; if none, leave the origin unset so cells take the baked /
  // procedural path (already relative).
  if (baseElevationM == null) {
    scan: for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -half + (2 * half * i) / (n - 1);
        const z = -half + (2 * half * j) / (n - 1);
        const probed = finite(sampler.sampleAbsolute(origin.lat - z / mLat, origin.lon + x / mLon));
        if (probed != null) {
          baseElevationM = probed;
          break scan;
        }
      }
    }
  }
  if (baseElevationM != null) sampler.setOriginElevation(baseElevationM);

  const samples: { x: number; z: number; h: number }[] = [];
  let filled = 0;
  let missing = 0;
  let usedFallbackBake = false;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -half + (2 * half * i) / (n - 1);
      const z = -half + (2 * half * j) / (n - 1);
      const lat = origin.lat - z / mLat;
      const lon = origin.lon + x / mLon;
      const rel = sampler.sampleRelative(lat, lon);
      let h: number;
      if (rel !== null && Number.isFinite(rel)) {
        h = rel;
        filled++;
      } else {
        h = sampleDemHeight(baked, x, z, plantId);
        missing++;
        usedFallbackBake = true;
      }
      samples.push({ x: +x.toFixed(2), z: +z.toFixed(2), h: +h.toFixed(3) });
    }
  }

  const infoHits = sampler.demInfo();
  const hrUsed = infoHits.hrSamples > 0;
  const terraUsed = infoHits.baseSamples > 0 || (filled > 0 && !hrUsed);
  let source: string;
  let attribution: string;
  if (hrUsed && terraUsed) {
    source = 'NRCan HRDEM 1 m (OGL-Canada) + AWS Terrarium';
    attribution =
      'Elevation: NRCan HRDEM 1 m DTM (CanElevation, Open Government Licence – Canada); gaps: AWS Terrain Tiles (Mapzen/Joerd Terrarium)';
  } else if (hrUsed) {
    source = 'NRCan HRDEM 1 m (OGL-Canada)';
    attribution = 'Elevation: NRCan HRDEM 1 m DTM (CanElevation, Open Government Licence – Canada)';
  } else if (filled > 0) {
    source = 'AWS Terrarium (Mapzen/Joerd)';
    attribution = 'Elevation: AWS Terrain Tiles (Mapzen/Joerd Terrarium encoding)';
  } else if (baked) {
    source = baked.source;
    attribution = pack.attribution?.dem || baked.source;
    usedFallbackBake = true;
  } else {
    source = 'procedural noise (seeded by plant id)';
    attribution = source;
    usedFallbackBake = true;
  }

  const dem: DemData = {
    n,
    halfExtentM: half,
    baseElevationM: baseElevationM ?? 0,
    samples,
    source,
  };

  // sampler tiles stay in IndexedDB via cachedDem; drop the in-memory bitmaps
  sampler.dispose();

  return {
    dem,
    source,
    attribution,
    info: {
      n,
      halfExtentM: half,
      baseElevationM: baseElevationM ?? 0,
      filled,
      missing,
      hrHits: infoHits.hrSamples,
      baseHits: infoHits.baseSamples,
      usedFallbackBake,
    },
  };
}

export function runtimeDemDebug() {
  return { ...cacheCounters };
}
