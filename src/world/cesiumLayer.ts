/**
 * Cesium / Ion geospatial backbone scaffolding (v0.3).
 *
 * Feature-flagged: set VITE_CESIUM_ENABLED=true and provide
 * VITE_CESIUM_ION_TOKEN in .env.local (never commit tokens).
 *
 * Full globe + Ion terrain/imagery is intentionally scaffolded here —
 * Three.js remains the process-train renderer. Remaining work: npm cesium,
 * dual-canvas sync, and WGS84 ↔ local ENU alignment for each plant.
 */
export interface CesiumScaffoldStatus {
  enabled: boolean;
  tokenPresent: boolean;
  mode: 'off' | 'scaffold' | 'active';
  message: string;
}

/** Read Vite env — Ion token must stay in .env.local / agent secrets. */
export function getCesiumScaffoldStatus(): CesiumScaffoldStatus {
  const enabled = String(import.meta.env.VITE_CESIUM_ENABLED || '').toLowerCase() === 'true';
  const token = String(import.meta.env.VITE_CESIUM_ION_TOKEN || '').trim();
  const tokenPresent = token.length > 8;

  if (!enabled) {
    return {
      enabled: false,
      tokenPresent,
      mode: 'off',
      message: 'Cesium off (set VITE_CESIUM_ENABLED=true to scaffold)',
    };
  }
  if (!tokenPresent) {
    return {
      enabled: true,
      tokenPresent: false,
      mode: 'scaffold',
      message: 'Cesium scaffold — missing VITE_CESIUM_ION_TOKEN',
    };
  }
  return {
    enabled: true,
    tokenPresent: true,
    mode: 'scaffold',
    message:
      'Cesium scaffold ready (Ion token present). Full globe + terrain sync deferred — Three.js DEM/GIS active.',
  };
}

/**
 * Placeholder mount. When Cesium is fully wired, this will create a Viewer
 * under `host` with Ion world imagery + terrain at (lat, lon).
 * Currently logs status only so builds stay light (no cesium dependency yet).
 */
export function mountCesiumScaffold(
  host: HTMLElement | null,
  origin: { lat: number; lon: number },
): () => void {
  const status = getCesiumScaffoldStatus();
  if (!host || status.mode === 'off') return () => {};

  const badge = document.createElement('div');
  badge.id = 'cesiumScaffoldBadge';
  badge.className = 'cesium-scaffold-badge';
  badge.title = `Origin ${origin.lat.toFixed(5)}, ${origin.lon.toFixed(5)}`;
  badge.textContent = status.tokenPresent ? 'CESIUM: scaffold (Ion OK)' : 'CESIUM: scaffold (no token)';
  host.appendChild(badge);

  // Future: dynamic import('cesium') + Viewer with Ion.defaultAccessToken
  // and Entity sync for process units in WGS84.

  return () => {
    badge.remove();
  };
}
