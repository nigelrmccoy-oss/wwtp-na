/**
 * GIS footprint snap — place process units on real OSM water / basin polygons
 * from public/geo bakes (© OpenStreetMap contributors, ODbL).
 *
 * Prioritises Waterloo + Kitchener where schematic trains previously sat on
 * pavement beside the real clarifier / aeration footprints.
 */
import type { GeoFeature, PlantGeoPack } from './osmBake';

export interface FootprintRing {
  ring: number[][];
  cx: number;
  cz: number;
  area: number;
  width: number;
  depth: number;
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
  /** Real footprint size hints (metres). */
  radiusM?: number;
  widthM?: number;
  depthM?: number;
  footprints: FootprintRing[];
}

export interface GisLayoutResult {
  used: boolean;
  snaps: GisUnitSnap[];
  pad: { cx: number; cz: number; w: number; d: number; yaw: number } | null;
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
  return {
    ring,
    cx: c.x,
    cz: c.z,
    area,
    width,
    depth,
    circularity: circ,
    yaw: majorAxisYaw(ring),
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
  },
): GisLayoutResult {
  const empty: GisLayoutResult = {
    used: false,
    snaps: [],
    pad: null,
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

  // Split clarifiers into primary (smaller) vs secondary (larger) when both exist
  let primaryFs: FootprintRing[] = [];
  let secondaryFs: FootprintRing[] = [];
  if (counts.hasPrimary && clarifiers.length >= 2) {
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

  if (primaryFs.length && counts.hasPrimary) {
    const c = centroidOf(primaryFs);
    snaps.push({
      id: 'primary',
      label: 'Primary Clarifiers',
      kind: 'cyl',
      x: c.x,
      z: c.z,
      yaw: meanYaw(primaryFs),
      count: primaryFs.length,
      radiusM: avgRadius(primaryFs),
      footprints: primaryFs,
    });
  }

  const aerationFs = basins.slice(0, Math.max(1, counts.aeration || basins.length));
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
      widthM: Math.max(...aerationFs.map((f) => f.width)),
      depthM: Math.max(...aerationFs.map((f) => f.depth)),
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

  // Headworks: upstream of first process unit (typically west / lower X for these plants)
  const processPts = snaps.map((s) => ({ x: s.x, z: s.z }));
  if (processPts.length) {
    const xs = processPts.map((p) => p.x);
    const zs = processPts.map((p) => p.z);
    const minX = Math.min(...xs);
    const midZ = zs.reduce((a, b) => a + b, 0) / zs.length;
    snaps.unshift({
      id: 'headworks',
      label: 'Headworks',
      kind: 'rect',
      x: minX - 45,
      z: midZ,
      yaw: 0,
      count: 1,
      footprints: [],
    });

    // Disinfection downstream of secondary
    const maxX = Math.max(...xs);
    const sec = snaps.find((s) => s.id === 'secondary');
    const dx = sec ? sec.x : maxX;
    const dz = sec ? sec.z : midZ;
    if (counts.disinfection === 'uv' && counts.uvBanks > 0) {
      snaps.push({
        id: 'disinfection',
        label: 'UV Disinfection',
        kind: 'uv',
        x: dx + 55,
        z: dz,
        yaw: 0,
        count: counts.uvBanks,
        footprints: [],
      });
    } else if (counts.disinfection === 'chlorine' && counts.chlorineChannels > 0) {
      snaps.push({
        id: 'disinfection',
        label: 'Chlorine Contact',
        kind: 'chlorine',
        x: dx + 55,
        z: dz,
        yaw: 0,
        count: counts.chlorineChannels,
        footprints: [],
      });
    }

    snaps.push({
      id: 'solids',
      label: 'Solids Handling',
      kind: 'rect',
      x: (minX + maxX) / 2,
      z: Math.max(...zs) + 55,
      yaw: 0,
      count: 1,
      footprints: [],
    });
  }

  // Pad from WWTP footprint
  const padW = bounds.maxX - bounds.minX;
  const padD = bounds.maxZ - bounds.minZ;
  const pad = {
    cx: (bounds.minX + bounds.maxX) / 2,
    cz: (bounds.minZ + bounds.maxZ) / 2,
    w: Math.min(420, Math.max(80, padW * 0.92)),
    d: Math.min(320, Math.max(60, padD * 0.92)),
    yaw: 0,
  };

  // Outfall: prefer waterway tip near site, else east of disinfection
  let outfallHint: GisLayoutResult['outfallHint'] = null;
  if (waterwayTips.length) {
    const tip = waterwayTips.sort(
      (a, b) => Math.hypot(a.x - pad.cx, a.z - pad.cz) - Math.hypot(b.x - pad.cx, b.z - pad.cz),
    )[0];
    outfallHint = { x: tip.x, z: tip.z, yaw: Math.atan2(tip.z - pad.cz, tip.x - pad.cx) };
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

  const summary = `GIS snap · ${clarifiers.length} clarifier · ${basins.length} basin footprints`;
  return {
    used: snaps.some((s) => s.footprints.length > 0),
    snaps,
    pad,
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
