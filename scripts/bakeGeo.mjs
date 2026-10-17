/**
 * Bake OSM Overpass GeoJSON + elevation samples for each plant.
 * Usage: node scripts/bakeGeo.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const outDir = path.join(root, 'public', 'geo');
fs.mkdirSync(outDir, { recursive: true });

const UA = 'wwtp-na-bake/0.3.10 (training sim; https://github.com/nigelrmccoy-oss/wwtp-na)';
const plants = JSON.parse(fs.readFileSync(path.join(root, 'src/data/plants.json'), 'utf8')).plants;
const RADIUS_M = 1200;

function overpassQuery(lat, lon, r) {
  return `
[out:json][timeout:90];
(
  way["highway"](around:${r},${lat},${lon});
  way["building"](around:${r},${lat},${lon});
  way["landuse"](around:${r},${lat},${lon});
  way["waterway"](around:${r},${lat},${lon});
  way["natural"="water"](around:${r},${lat},${lon});
  way["amenity"="wastewater_plant"](around:${r},${lat},${lon});
  way["man_made"="wastewater_plant"](around:${r},${lat},${lon});
  relation["amenity"="wastewater_plant"](around:${r},${lat},${lon});
  relation["man_made"="wastewater_plant"](around:${r},${lat},${lon});
);
out body;
>;
out skel qt;
`.trim();
}

function metersPerDeg(lat) {
  const mLat = 111320;
  const mLon = 111320 * Math.cos((lat * Math.PI) / 180);
  return { mLat, mLon };
}

function toLocal(lat, lon, originLat, originLon) {
  const { mLat, mLon } = metersPerDeg(originLat);
  return { x: (lon - originLon) * mLon, z: -(lat - originLat) * mLat };
}

function osmToGeoJSON(osm, originLat, originLon) {
  const nodes = new Map();
  for (const el of osm.elements || []) {
    if (el.type === 'node') nodes.set(el.id, el);
  }
  const features = [];
  for (const el of osm.elements || []) {
    if (el.type !== 'way' || !el.nodes) continue;
    const coords = [];
    for (const nid of el.nodes) {
      const n = nodes.get(nid);
      if (!n) continue;
      const loc = toLocal(n.lat, n.lon, originLat, originLon);
      coords.push([+loc.x.toFixed(2), +loc.z.toFixed(2)]);
    }
    if (coords.length < 2) continue;
    const tags = el.tags || {};
    let kind = 'other';
    if (tags.amenity === 'wastewater_plant' || tags.man_made === 'wastewater_plant') kind = 'wwtp';
    else if (tags.highway) kind = 'road';
    else if (tags.building) kind = 'building';
    else if (tags.natural === 'water' || tags.waterway === 'riverbank' || tags.water) kind = 'water';
    else if (tags.waterway) kind = 'waterway';
    else if (tags.landuse === 'farmland' || tags.landuse === 'meadow' || tags.landuse === 'orchard' || tags.landuse === 'farmyard') kind = 'farm';
    else if (tags.landuse) kind = 'landuse';
    else continue;

    const closed =
      coords.length > 2 &&
      Math.abs(coords[0][0] - coords[coords.length - 1][0]) < 0.01 &&
      Math.abs(coords[0][1] - coords[coords.length - 1][1]) < 0.01;

    let geometry;
    const wantPoly =
      kind === 'building' || kind === 'wwtp' || kind === 'water' || kind === 'farm' || kind === 'landuse';
    if (wantPoly) {
      const ring = closed ? coords : [...coords, coords[0]];
      if (ring.length < 4) continue;
      // simplify very dense rings
      const simp = ring.length > 80 ? ring.filter((_, i) => i % 2 === 0 || i === 0 || i === ring.length - 1) : ring;
      if (simp[0][0] !== simp[simp.length - 1][0] || simp[0][1] !== simp[simp.length - 1][1]) simp.push(simp[0]);
      geometry = { type: 'Polygon', coordinates: [simp] };
    } else {
      // roads / waterways — subsample long ways
      const line = coords.length > 60 ? coords.filter((_, i) => i % 2 === 0 || i === coords.length - 1) : coords;
      geometry = { type: 'LineString', coordinates: line };
    }
    features.push({
      type: 'Feature',
      properties: {
        kind,
        highway: tags.highway || null,
        building: tags.building || null,
        landuse: tags.landuse || null,
        name: tags.name || null,
        amenity: tags.amenity || null,
        man_made: tags.man_made || null,
        waterway: tags.waterway || null,
        levels: tags['building:levels'] ? Number(tags['building:levels']) : null,
      },
      geometry,
    });
  }
  // Cap features to keep files reasonable — prioritize wwtp, water, buildings, roads, farm
  // v0.3.9: bake density caps (roads must not crowd out buildings / process water)
  // v0.3.10: denser GTA-like surroundings (still capped for file size)
  const caps = { wwtp: 8, building: 320, water: 48, waterway: 40, farm: 60, landuse: 48, road: 400, other: 20 };
  const byKind = {};
  for (const f of features) {
    const k = f.properties.kind;
    (byKind[k] ||= []).push(f);
  }
  // Prefer water/buildings nearer origin when over cap
  const dist2 = (f) => {
    const g = f.geometry;
    let cx = 0, cz = 0, n = 0;
    const coords = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates;
    for (const p of coords) { cx += p[0]; cz += p[1]; n++; }
    if (!n) return 1e12;
    cx /= n; cz /= n;
    return cx * cx + cz * cz;
  };
  const out = [];
  for (const [k, arr] of Object.entries(byKind)) {
    const cap = caps[k] ?? 20;
    const sorted = [...arr].sort((a, b) => dist2(a) - dist2(b));
    out.push(...sorted.slice(0, cap));
  }
  return { type: 'FeatureCollection', features: out };
}

/** Known-bad KIT (and peer) water polys — drop before write. Centroid in bake metres. */
const WATER_DENYLIST = {
  kitchener: [{ cx: 323.5, cz: 165.1, tol: 12 }],
};

function applyWaterDenylist(plantId, geojson) {
  const list = WATER_DENYLIST[plantId];
  if (!list) return geojson;
  geojson.features = geojson.features.filter((f) => {
    if (f.properties.kind !== 'water' && f.properties.kind !== 'waterway') return true;
    if (f.geometry.type !== 'Polygon') return true;
    const ring = f.geometry.coordinates[0];
    let cx = 0, cz = 0, n = Math.max(1, ring.length - 1);
    for (let i = 0; i < n; i++) { cx += ring[i][0]; cz += ring[i][1]; }
    cx /= n; cz /= n;
    return !list.some((d) => Math.hypot(cx - d.cx, cz - d.cz) <= (d.tol ?? 15));
  });
  return geojson;
}

async function fetchOsm(lat, lon) {
  const q = overpassQuery(lat, lon, RADIUS_M);
  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];
  let lastErr;
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': UA,
          Accept: 'application/json',
        },
        body: 'data=' + encodeURIComponent(q),
      });
      if (!res.ok) throw new Error(`${url} ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      console.warn('Overpass fail', e.message);
    }
  }
  throw lastErr;
}

function sampleGrid(lat, lon, halfKm = 1.2, n = 13) {
  const pts = [];
  const { mLat, mLon } = metersPerDeg(lat);
  const halfM = halfKm * 1000;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -halfM + (2 * halfM * i) / (n - 1);
      const z = -halfM + (2 * halfM * j) / (n - 1);
      pts.push({ lat: lat - z / mLat, lon: lon + x / mLon, x, z });
    }
  }
  return { pts, n, halfM };
}

async function fetchElevationBatched(points) {
  const BATCH = 40;
  const elev = new Array(points.length);
  for (let i = 0; i < points.length; i += BATCH) {
    const batch = points.slice(i, i + BATCH);
    const lats = batch.map((p) => p.lat.toFixed(5)).join(',');
    const lons = batch.map((p) => p.lon.toFixed(5)).join(',');
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`elevation ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.elevation)) throw new Error('bad elev');
    for (let j = 0; j < batch.length; j++) elev[i + j] = data.elevation[j];
    await new Promise((r) => setTimeout(r, 200));
  }
  return elev;
}

function hashSeed(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function noiseHeight(x, z, seed) {
  const s = seed * 0.0001;
  return (
    Math.sin(x * 0.0021 + s) * Math.cos(z * 0.0019 + s * 1.3) * 4.5 +
    Math.sin(x * 0.0007 + z * 0.0009 + s) * 8 +
    Math.sin((x + z) * 0.00035 + s * 2) * 3
  );
}

/** Illustrative surroundings when OSM is thin (esp. farm-septic). */
function syntheticFallback(plantId, isSeptic) {
  const features = [];
  if (isSeptic) {
    // Farm fields around site
    for (const [x, z, w, d] of [
      [-80, -60, 70, 50],
      [70, -40, 60, 55],
      [-50, 70, 80, 45],
      [90, 50, 50, 40],
    ]) {
      features.push({
        type: 'Feature',
        properties: { kind: 'farm', landuse: 'farmland', name: 'Farm field (illustrative)', synthetic: true },
        geometry: {
          type: 'Polygon',
          coordinates: [[[x - w / 2, z - d / 2], [x + w / 2, z - d / 2], [x + w / 2, z + d / 2], [x - w / 2, z + d / 2], [x - w / 2, z - d / 2]]],
        },
      });
    }
    features.push({
      type: 'Feature',
      properties: { kind: 'farm', landuse: 'farmyard', name: 'Septic / leaching area (illustrative)', synthetic: true },
      geometry: {
        type: 'Polygon',
        coordinates: [[[16, -19], [44, -19], [44, 3], [16, 3], [16, -19]]],
      },
    });
    features.push({
      type: 'Feature',
      properties: { kind: 'building', building: 'barn', name: 'Barn (illustrative)', synthetic: true },
      geometry: {
        type: 'Polygon',
        coordinates: [[[-46, 26], [-32, 26], [-32, 40], [-46, 40], [-46, 26]]],
      },
    });
    features.push({
      type: 'Feature',
      properties: { kind: 'building', building: 'shed', name: 'Equipment shed (illustrative)', synthetic: true },
      geometry: {
        type: 'Polygon',
        coordinates: [[[-52, 18], [-46, 18], [-46, 24], [-52, 24], [-52, 18]]],
      },
    });
    features.push({
      type: 'Feature',
      properties: { kind: 'road', highway: 'track', name: 'Farm driveway (illustrative)', synthetic: true },
      geometry: { type: 'LineString', coordinates: [[-110, 55], [-70, 40], [-40, 22], [-22, 10], [8, -2]] },
    });
  } else {
    // Generic industrial-adjacent roads if OSM empty
    features.push({
      type: 'Feature',
      properties: { kind: 'road', highway: 'secondary', name: 'Access road (illustrative)', synthetic: true },
      geometry: { type: 'LineString', coordinates: [[-120, 0], [120, 0]] },
    });
    features.push({
      type: 'Feature',
      properties: { kind: 'road', highway: 'service', synthetic: true },
      geometry: { type: 'LineString', coordinates: [[0, -100], [0, 100]] },
    });
  }
  return features;
}

async function bakeOne(plant) {
  const lat = plant.location.lat;
  const lon = plant.location.lon;
  const isSeptic = plant.scadaProfile === 'septic' || plant.id === 'farm-septic';
  console.log('Baking', plant.id, lat, lon);

  let osmFeatures = { type: 'FeatureCollection', features: [] };
  let osmSource = 'fallback';
  try {
    const osm = await fetchOsm(lat, lon);
    osmFeatures = osmToGeoJSON(osm, lat, lon);
    osmSource = 'OpenStreetMap Overpass';
    console.log('  OSM features:', osmFeatures.features.length);
  } catch (e) {
    console.warn('  OSM failed', e.message);
  }

  let osmThin = osmFeatures.features.length < 12;
  // Farm-septic often has distant village OSM but an empty pad — inject near-site farmstead
  const nearSite = osmFeatures.features.some((f) => {
    const g = f.geometry;
    let cx = 0, cz = 0, n = 0;
    if (g.type === 'Polygon') {
      const ring = g.coordinates[0];
      for (let i = 0; i < ring.length - 1; i++) { cx += ring[i][0]; cz += ring[i][1]; n++; }
    } else if (g.type === 'LineString') {
      for (const p of g.coordinates) { cx += p[0]; cz += p[1]; n++; }
    } else return false;
    if (!n) return false;
    cx /= n; cz /= n;
    const kind = f.properties.kind;
    return (kind === 'building' || kind === 'farm' || kind === 'road') && Math.hypot(cx, cz) < 200;
  });
  if (osmThin || (isSeptic && !nearSite)) {
    const synth = syntheticFallback(plant.id, isSeptic);
    osmFeatures.features.push(...synth);
    if (!nearSite && isSeptic) osmThin = true;
    console.log('  + synthetic fallback', synth.length, 'features', isSeptic && !nearSite ? '(empty near-site)' : '');
  }

  osmFeatures = applyWaterDenylist(plant.id, osmFeatures);

  const { pts, n, halfM } = sampleGrid(lat, lon, 1.2, 13);
  let elev = null;
  let demSource = 'procedural noise (seeded by plant id)';
  // Kitchener previously fell back to procedural — prefer real DEM (retry once)
  const demAttempts = plant.id === 'kitchener' ? 2 : 1;
  for (let attempt = 0; attempt < demAttempts; attempt++) {
    try {
      elev = await fetchElevationBatched(pts);
      demSource = 'Open-Meteo elevation API';
      console.log('  DEM', elev.length, 'min/max', Math.min(...elev).toFixed(1), Math.max(...elev).toFixed(1));
      break;
    } catch (e) {
      console.warn('  DEM fail', e.message, attempt + 1, '/', demAttempts);
      if (attempt + 1 < demAttempts) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  if (!elev) {
    const seed = hashSeed(plant.id);
    elev = pts.map((p) => 280 + noiseHeight(p.x, p.z, seed));
    demSource = 'procedural noise (seeded by plant id)';
  }
  const mid = elev[Math.floor(elev.length / 2)];
  const dem = {
    originLat: lat,
    originLon: lon,
    n,
    halfExtentM: halfM,
    baseElevationM: mid,
    samples: elev.map((e, i) => ({ x: +pts[i].x.toFixed(1), z: +pts[i].z.toFixed(1), h: +(e - mid).toFixed(2) })),
    source: demSource,
  };

  const out = {
    plantId: plant.id,
    bakedAt: new Date().toISOString(),
    radiusM: RADIUS_M,
    origin: { lat, lon },
    attribution: {
      osm: '© OpenStreetMap contributors (ODbL)',
      dem: demSource,
    },
    osmFeatureCount: osmFeatures.features.filter((f) => !f.properties.synthetic).length,
    osmThin,
    dem,
    geojson: osmFeatures,
  };
  const fp = path.join(outDir, `${plant.id}.json`);
  fs.writeFileSync(fp, JSON.stringify(out));
  console.log('  wrote', fp, `${(fs.statSync(fp).size / 1024).toFixed(1)} KB thin=${osmThin}`);
  return out;
}

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const todo = only.length ? plants.filter((p) => only.includes(p.id)) : plants;
if (only.length && !todo.length) {
  console.error('No matching plant ids', only);
  process.exit(1);
}

const summaryPath = path.join(outDir, '_bake-summary.json');
let summary = [];
try { summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')); } catch { /* fresh */ }
if (!Array.isArray(summary)) summary = [];

for (const p of todo) {
  const o = await bakeOne(p);
  const kinds = {};
  for (const f of o.geojson.features) {
    const k = f.properties.kind || 'other';
    kinds[k] = (kinds[k] || 0) + 1;
  }
  const row = {
    id: p.id,
    osmReal: o.osmFeatureCount,
    thin: o.osmThin,
    totalFeatures: o.geojson.features.length,
    dem: o.dem.source,
    kinds,
  };
  const ix = summary.findIndex((s) => s.id === p.id);
  if (ix >= 0) summary[ix] = row;
  else summary.push(row);
  await new Promise((r) => setTimeout(r, 2500));
}
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
