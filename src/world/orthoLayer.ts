/**
 * Attributed ortho / basemap ground plane (v0.3.15).
 *
 * Priority:
 *  1. Custom imagery URL (VITE_IMAGERY_URL)
 *  2. Bing Maps Aerial (no labels) via Cesium ion asset 2 when
 *     VITE_CESIUM_ION_TOKEN is set — same path as nig-drives SatelliteImagery
 *  3. Esri World Imagery XYZ tiles (attribution required)
 *
 * Imagery tiles are NOT written to the persistent map cache (HTTP / memory only).
 * Never Google / Apple / Street View. Full Cesium globe stays in cesiumLayer.ts.
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
  /**
   * Ground height sampler (scene ground datum). When given, tiles are draped onto the
   * terrain (+lift, polygonOffset) instead of a flat plane that z-fights the grade.
   */
  heightAt?: (x: number, z: number) => number;
}

export type OrthoMode = 'off' | 'esri-tiles' | 'imagery-url' | 'bing-ion';

export interface OrthoMountResult {
  group: THREE.Group;
  attribution: string;
  mode: OrthoMode;
  zoom: number | null;
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

function tileUrlEsri(x: number, y: number, z: number, custom?: string): string {
  if (custom) {
    return custom.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
  }
  // Esri World Imagery — standard XYZ; attribution required (see badge).
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
}

function quadkey(x: number, y: number, z: number): string {
  let q = '';
  for (let i = z; i > 0; i--) {
    const m = 1 << (i - 1);
    q += ((x & m ? 1 : 0) + (y & m ? 2 : 0)).toString();
  }
  return q;
}

const ION_ASSET = 2;
const BING_ZOOM = 17;
const ESRI_ZOOM = 16;
/** z17 tiles are ~223 m; cap so a 1.8 km site stays in the ~11×11 range. */
const MAX_SPAN = 11;

interface BingMeta {
  template: string;
  subdomains: string[];
  copyright: string;
  ionExtra: string;
}

let bingMetaP: Promise<BingMeta | null> | null = null;
/** After a failed ion/Bing metadata fetch, skip retries until this time. */
let bingMetaBackoffUntil = 0;
const BING_META_BACKOFF_MS = 5_000;

function ionToken(): string {
  return String(import.meta.env.VITE_CESIUM_ION_TOKEN || '').trim();
}

/** Resolve Bing Aerial (no labels) through Cesium ion. Memory only — never persisted. */
function resolveBingMeta(): Promise<BingMeta | null> {
  if (bingMetaP) return bingMetaP;
  if (performance.now() < bingMetaBackoffUntil) return Promise.resolve(null);
  const token = ionToken();
  if (token.length <= 8) return Promise.resolve(null);
  const pending = (async () => {
    try {
      const ep = await (
        await fetch(`https://api.cesium.com/v1/assets/${ION_ASSET}/endpoint?access_token=${encodeURIComponent(token)}`)
      ).json();
      const o = ep?.options;
      if (ep?.externalType !== 'BING' || !o?.key || !/^aerial$/i.test(String(o.mapStyle))) return null;
      const m = await (
        await fetch(`${o.url}/REST/v1/Imagery/Metadata/Aerial?incl=ImageryProviders&uriScheme=https&key=${encodeURIComponent(o.key)}`)
      ).json();
      const r = m?.resourceSets?.[0]?.resources?.[0];
      if (!r?.imageUrl || !Array.isArray(r.imageUrlSubdomains)) return null;
      const ion = (ep.attributions ?? [])
        .map((a: { html?: string }) => (a.html ?? '').replace(/<[^>]*>/g, '').trim())
        .filter((s: string) => s && !/upgrade for commercial/i.test(s));
      return {
        template: String(r.imageUrl).replace('{culture}', 'en-US'),
        subdomains: r.imageUrlSubdomains,
        copyright: String(m.copyright ?? '© Microsoft'),
        ionExtra: ion.join(' '),
      };
    } catch {
      return null;
    }
  })();
  bingMetaP = pending;
  void pending.then((meta) => {
    if (meta) return;
    // Do not permanently cache a failed lookup; retry on a later mount after a short backoff.
    if (bingMetaP === pending) bingMetaP = null;
    bingMetaBackoffUntil = performance.now() + BING_META_BACKOFF_MS;
  });
  return pending;
}

function bingTileUrl(meta: BingMeta, x: number, y: number, z: number): string {
  return meta.template
    .replace('{subdomain}', meta.subdomains[(x + y) % meta.subdomains.length])
    .replace('{quadkey}', quadkey(x, y, z));
}

function tileBoundsEnu(
  tx: number,
  ty: number,
  z: number,
  origin: { lat: number; lon: number },
): { xL: number; xR: number; zN: number; zS: number; w: number; d: number } {
  const n = 2 ** z;
  const { mLat, mLon } = metersPerDeg(origin.lat);
  const lon0 = (tx / n) * 360 - 180;
  const lon1 = ((tx + 1) / n) * 360 - 180;
  const lat0 = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (ty + 1)) / n))) * 180) / Math.PI;
  const lat1 = (Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) * 180) / Math.PI;
  const xL = (lon0 - origin.lon) * mLon;
  const xR = (lon1 - origin.lon) * mLon;
  const zN = -(lat1 - origin.lat) * mLat;
  const zS = -(lat0 - origin.lat) * mLat;
  return { xL, xR, zN, zS, w: Math.abs(xR - xL), d: Math.abs(zS - zN) };
}

function drapeOrFlat(
  tex: THREE.Texture,
  b: { xL: number; xR: number; zN: number; zS: number; w: number; d: number },
  opts: OrthoMountOpts,
): THREE.Mesh {
  tex.colorSpace = THREE.SRGBColorSpace;
  let mesh: THREE.Mesh;
  if (opts.heightAt) {
    const seg = 40;
    const geo = new THREE.PlaneGeometry(b.w, b.d, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const cxT = (b.xL + b.xR) / 2;
    const czT = (b.zN + b.zS) / 2;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + cxT;
      const z = pos.getZ(i) + czT;
      pos.setXYZ(i, x, opts.heightAt(x, z) + 0.3, z);
    }
    geo.computeBoundingSphere();
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'ortho-drape-tile';
    mesh.receiveShadow = false;
  } else {
    mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(b.w, b.d),
      new THREE.MeshBasicMaterial({ map: tex, depthWrite: false, transparent: true, opacity: 0.92 }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set((b.xL + b.xR) / 2, opts.y - 0.05, (b.zN + b.zS) / 2);
    mesh.renderOrder = -2;
  }
  mesh.raycast = () => {};
  return mesh;
}

function tileSpan(opts: OrthoMountOpts, z: number): { x0: number; y0: number; spanX: number; spanY: number } {
  const { mLat, mLon } = metersPerDeg(opts.origin.lat);
  const half = Math.min(opts.halfExtentM, 900);
  const northLat = opts.origin.lat - (opts.cz - half) / mLat;
  const southLat = opts.origin.lat - (opts.cz + half) / mLat;
  const westLon = opts.origin.lon + (opts.cx - half) / mLon;
  const eastLon = opts.origin.lon + (opts.cx + half) / mLon;
  const tNW = latLonToTile(northLat, westLon, z);
  const tSE = latLonToTile(southLat, eastLon, z);
  const x0 = Math.min(tNW.x, tSE.x);
  const y0 = Math.min(tNW.y, tSE.y);
  const spanX = Math.min(MAX_SPAN, Math.max(tNW.x, tSE.x) - x0 + 1);
  const spanY = Math.min(MAX_SPAN, Math.max(tNW.y, tSE.y) - y0 + 1);
  return { x0, y0, spanX, spanY };
}

async function loadMosaic(
  group: THREE.Group,
  opts: OrthoMountOpts,
  z: number,
  urlFor: (x: number, y: number, z: number) => string,
): Promise<number> {
  const { x0, y0, spanX, spanY } = tileSpan(opts, z);
  const loader = new THREE.TextureLoader();
  loader.crossOrigin = 'anonymous';
  let ok = 0;
  const jobs: Promise<void>[] = [];
  for (let ty = y0; ty < y0 + spanY; ty++) {
    for (let tx = x0; tx < x0 + spanX; tx++) {
      const url = urlFor(tx, ty, z);
      jobs.push(
        (async () => {
          try {
            const tex = await loader.loadAsync(url);
            const b = tileBoundsEnu(tx, ty, z, opts.origin);
            group.add(drapeOrFlat(tex, b, opts));
            ok++;
          } catch {
            /* skip failed tile — never persist imagery */
          }
        })(),
      );
    }
  }
  await Promise.all(jobs);
  return ok;
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

  let attribution =
    'Basemap: Esri World Imagery — Sources: Esri, Maxar, Earthstar Geographics, and the GIS User Community';
  let mode: OrthoMode = 'off';
  let zoom: number | null = null;
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
    return { group, attribution: '', mode: 'off', zoom: null, dispose };
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
      mode = 'off';
    }
  }

  if (mode !== 'imagery-url') {
    const xyzCustom = customUrl.includes('{z}') ? customUrl : undefined;
    let usedBing = false;
    if (!xyzCustom && ionToken().length > 8) {
      const meta = await resolveBingMeta();
      if (meta) {
        const n = await loadMosaic(group, opts, BING_ZOOM, (x, y, z) => bingTileUrl(meta, x, y, z));
        if (n > 0) {
          usedBing = true;
          mode = 'bing-ion';
          zoom = BING_ZOOM;
          attribution = `Imagery ${meta.copyright} · Bing Maps Aerial via Cesium ion${meta.ionExtra ? ' · ' + meta.ionExtra : ''}`;
        }
      }
    }
    if (!usedBing) {
      mode = 'esri-tiles';
      zoom = ESRI_ZOOM;
      await loadMosaic(group, opts, ESRI_ZOOM, (x, y, z) => tileUrlEsri(x, y, z, xyzCustom));
      if (!xyzCustom) {
        attribution =
          'Tiles © Esri — World Imagery (Sources: Esri, Maxar, Earthstar Geographics, and the GIS User Community). Not Google/Apple/Street View.';
      } else {
        attribution = String(import.meta.env.VITE_IMAGERY_ATTRIBUTION || 'Custom imagery (see .env.local)');
      }
    }
  }

  if (opts.host) {
    const badge = document.createElement('div');
    badge.className = 'ortho-attrib-badge';
    if (mode === 'bing-ion') {
      badge.textContent = 'ORTHO: Bing Aerial (Cesium ion)';
    } else if (mode === 'imagery-url') {
      badge.textContent = 'ORTHO: custom imagery';
    } else {
      badge.textContent = 'ORTHO: Esri World Imagery';
    }
    badge.title = attribution;
    badge.dataset.mode = mode;
    if (zoom != null) badge.dataset.zoom = String(zoom);
    opts.host.appendChild(badge);
    badges.push(badge);
  }

  return { group, attribution, mode, zoom, dispose };
}
