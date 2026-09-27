/**
 * Attributed ortho / basemap ground plane (v0.3.10 tiles-lite).
 *
 * Priority:
 *  1. Cesium Ion / custom imagery URL when VITE_IMAGERY_URL or Ion token + enabled
 *  2. Esri World Imagery XYZ tiles (attribution required) — no Google/Apple/SV scrape
 *
 * Full Cesium globe sync remains scaffolded in cesiumLayer.ts.
 */
import * as THREE from 'three';

export interface OrthoMountOpts {
  /** Plant WGS84 origin from geo bake. */
  origin: { lat: number; lon: number };
  /** Local ENU centre of the underlay (usually siteBounds). */
  cx: number;
  cz: number;
  /** Half-extent coverage in metres (underlay size ≈ 2*half). */
  halfExtentM: number;
  /** Shared yard datum Y. */
  y: number;
  /** Optional host for attribution badge. */
  host?: HTMLElement | null;
}

export interface OrthoMountResult {
  group: THREE.Group;
  attribution: string;
  mode: 'off' | 'esri-tiles' | 'imagery-url' | 'ion-scaffold';
  dispose: () => void;
}

function metersPerDeg(lat: number): { mLat: number; mLon: number } {
  const mLat = 111320;
  const mLon = 111320 * Math.cos((lat * Math.PI) / 180);
  return { mLat, mLon };
}

/** Web Mercator tile x/y/z for lon/lat. */
function latLonToTile(lat: number, lon: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x, y };
}

function tileUrl(x: number, y: number, z: number, custom?: string): string {
  if (custom) {
    return custom.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
  }
  // Esri World Imagery — standard XYZ; attribution required (see badge).
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
}

/**
 * Build a lightweight stitched ortho plane under/around the site.
 * Uses a small tile mosaic (no Street View / Google / Apple scrape).
 */
export async function mountOrthoUnderlay(opts: OrthoMountOpts): Promise<OrthoMountResult> {
  const group = new THREE.Group();
  group.name = 'ortho-underlay';
  const enabled = String(import.meta.env.VITE_ORTHO_ENABLED ?? 'true').toLowerCase() !== 'false';
  const customUrl = String(import.meta.env.VITE_IMAGERY_URL || '').trim();
  const ionOn = String(import.meta.env.VITE_CESIUM_ENABLED || '').toLowerCase() === 'true';
  const ionTok = String(import.meta.env.VITE_CESIUM_ION_TOKEN || '').trim();

  let attribution =
    'Basemap: Esri World Imagery — Sources: Esri, Maxar, Earthstar Geographics, and the GIS User Community';
  let mode: OrthoMountResult['mode'] = 'off';
  const badges: HTMLElement[] = [];

  const dispose = () => {
    for (const b of badges) b.remove();
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
  };

  if (!enabled) {
    return { group, attribution: '', mode: 'off', dispose };
  }

  if (ionOn && ionTok.length > 8 && !customUrl) {
    mode = 'ion-scaffold';
    attribution =
      'Cesium Ion token present — full Ion imagery/terrain sync deferred; Esri tiles-lite underlay active.';
  }

  if (customUrl && !customUrl.includes('{z}')) {
    // Single image URL draped as one plane
    mode = 'imagery-url';
    attribution = String(import.meta.env.VITE_IMAGERY_ATTRIBUTION || 'Custom imagery (see .env.local)');
    try {
      const loader = new THREE.TextureLoader();
      const tex = await loader.loadAsync(customUrl);
      tex.colorSpace = THREE.SRGBColorSpace;
      const size = opts.halfExtentM * 2;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size),
        new THREE.MeshBasicMaterial({ map: tex, depthWrite: false }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(opts.cx, opts.y - 0.04, opts.cz);
      mesh.renderOrder = -2;
      group.add(mesh);
    } catch {
      /* fall through to Esri tiles */
      mode = 'esri-tiles';
    }
  }

  if (mode !== 'imagery-url') {
    mode = mode === 'ion-scaffold' ? 'ion-scaffold' : 'esri-tiles';
    const z = 16; // ~2.4 m/px at mid-lat — enough for GTA yard context
    const { mLat, mLon } = metersPerDeg(opts.origin.lat);
    // Corner lat/lon of underlay in ENU
    const half = Math.min(opts.halfExtentM, 900);
    // Bake ENU: z = -(lat - originLat)*mLat → +z is south. lat = originLat - z/mLat
    const northLat = opts.origin.lat - (opts.cz - half) / mLat;
    const southLat = opts.origin.lat - (opts.cz + half) / mLat;
    const westLon = opts.origin.lon + (opts.cx - half) / mLon;
    const eastLon = opts.origin.lon + (opts.cx + half) / mLon;

    const tNW = latLonToTile(northLat, westLon, z);
    const tSE = latLonToTile(southLat, eastLon, z);
    const x0 = Math.min(tNW.x, tSE.x);
    const x1 = Math.max(tNW.x, tSE.x);
    const y0 = Math.min(tNW.y, tSE.y);
    const y1 = Math.max(tNW.y, tSE.y);
    // Cap mosaic so we stay tiles-lite
    const maxTiles = 8;
    const spanX = Math.min(maxTiles, x1 - x0 + 1);
    const spanY = Math.min(maxTiles, y1 - y0 + 1);

    const n = 2 ** z;
    const loader = new THREE.TextureLoader();
    loader.crossOrigin = 'anonymous';

    for (let ty = y0; ty < y0 + spanY; ty++) {
      for (let tx = x0; tx < x0 + spanX; tx++) {
        const url = tileUrl(tx, ty, z, customUrl.includes('{z}') ? customUrl : undefined);
        try {
          const tex = await loader.loadAsync(url);
          tex.colorSpace = THREE.SRGBColorSpace;
          // Tile bounds in lon/lat
          const lon0 = (tx / n) * 360 - 180;
          const lon1 = ((tx + 1) / n) * 360 - 180;
          const lat0 = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (ty + 1)) / n))) * 180) / Math.PI;
          const lat1 = (Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) * 180) / Math.PI;
          const xL = (lon0 - opts.origin.lon) * mLon;
          const xR = (lon1 - opts.origin.lon) * mLon;
          const zN = -(lat1 - opts.origin.lat) * mLat;
          const zS = -(lat0 - opts.origin.lat) * mLat;
          const w = Math.abs(xR - xL);
          const d = Math.abs(zS - zN);
          const mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(w, d),
            new THREE.MeshBasicMaterial({ map: tex, depthWrite: false, transparent: true, opacity: 0.92 }),
          );
          mesh.rotation.x = -Math.PI / 2;
          mesh.position.set((xL + xR) / 2, opts.y - 0.05, (zN + zS) / 2);
          mesh.renderOrder = -2;
          group.add(mesh);
        } catch {
          // skip failed tile
        }
      }
    }
    if (!customUrl) {
      attribution =
        'Tiles © Esri — World Imagery (Sources: Esri, Maxar, Earthstar Geographics, and the GIS User Community). Not Google/Apple/Street View.';
    }
  }

  if (opts.host) {
    const badge = document.createElement('div');
    badge.className = 'ortho-attrib-badge';
    badge.textContent =
      mode === 'ion-scaffold' ? 'ORTHO: Esri tiles-lite (Ion scaffold)' : 'ORTHO: Esri World Imagery';
    badge.title = attribution;
    opts.host.appendChild(badge);
    badges.push(badge);
  }

  return { group, attribution, mode, dispose };
}
