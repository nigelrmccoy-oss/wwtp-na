# WWTP-NA v0.3.10

**North American wastewater / onsite sewage operator-training simulator** (browser-first).

Ontario corridor tribute (farm septic → municipal plants). **Not affiliated with** Region of Waterloo, City of Hamilton, City of Toronto, OCWA, or any operating authority. Educational use only.

Spirit: honest numbers + keyboard/mouse site walk, like [ion-LRT](https://github.com/nigelrmccoy-oss/ion-LRT).

## Quick start

```bash
npm install
npm run dev
```

```bash
npm run build
npm run preview
```

Optional Cesium scaffold (never commit tokens):

```bash
# .env.local (gitignored)
VITE_CESIUM_ION_TOKEN=your_ion_token
VITE_CESIUM_ENABLED=true
```

## Plants

The menu loads **every** entry in `src/data/plants.json` dynamically (sorted micro → large). Current pack includes:

| Tier | Plant | Capacity (public / estimated) |
|------|-------|-------------------------------|
| Micro | Ontario farm septic (Class 4) | ~2.0 m³/d design (OBC; ~0.002 MLD) |
| Small | St. Jacobs WWTP | 1.45 MLD ADF |
| Medium | Waterloo WWTP | 57.5 MLD |
| Medium | Galt WWTP (Cambridge) | 56.8 MLD Stage 1 |
| Large | Kitchener WWTP | 122.745 MLD |
| Extra-large | Hamilton Woodward WWTP | ~409 MLD |
| Extra-large | Toronto Ashbridges Bay WWTP | ~818 MLD |

See `docs/research-plants.md` and each plant’s `sources` in JSON.

## What’s in v0.3.10

- **Asphalt ≠ WWTP bounds** — asphalt pad = process footprint AABB ∪ headworks/UV/solids + ~50 m margin; full WWTP amenity polygon is grass/gravel/landuse (`siteBounds` for camera/minimap).
- **True-ring basin walls** — OSM perimeter edge tubes; OBB box wall frames removed (fixes nested white frames on KIT aeration).
- **KIT real basins** — no `splitBasinAlongMajor` to force aeration count=4; hand rectangular primaries collision-checked vs aeration; unused south clarifiers meshed/labelled as standby.
- **Pad-relative OSM** — WWTP slab hole + building/road skip use asphalt process yard (not origin ±62/±55 schematic).
- **Terrain** — ground plane enlarged ~1500–2000 m to cover site.
- **Ortho tiles-lite** — attributed Esri World Imagery underlay (optional `VITE_IMAGERY_URL`); Cesium Ion remains scaffold when token present. Never Google/Apple/Street View.
- **Denser bake caps** — buildings/roads raised for GTA-like context.

## What’s in v0.3.9

- **Zoom / bird’s-eye** — orbit distance max raised to 600 so Waterloo/Kitchener GIS pads fit in the V-key bird’s-eye / nadir cycle.
- **True footprint basins** — extrude OSM rings (not AABB×0.92 boxes) so aeration meshes match area; Kitchener rectangular primaries; Waterloo twin aeration split when OSM merges tanks.
- **Uncapped GIS pad** — asphalt yard tracks real WWTP footprint (e.g. Kitchener ~746×485); headworks/UV/solids park on pad margins instead of hardcoded ±45/55 m.
- **Corner minimap** — pad + units + frustum wedge + click-pan (separate from layout overlay).
- **HoverTip live tags** — feeds SimState (DO/MLSS/flows); soft-pick for more prevalent tips; pipe flow chevrons.
- **Bake** — denser per-kind caps, Kitchener bad-water denylist; DEM rebake prefers Open-Meteo (falls back if rate-limited).

## What’s in v0.3.0 (still)

- **Z — Autopilot on/off** — toggles SCADA Autopilot; synced with SCADA checkbox + HUD badge (ignored while typing in inputs).
- **GIS footprint snap (P0)** — Waterloo + Kitchener (and any plant with enough on-site OSM water polygons) place clarifiers / aeration basins on real bake footprints at plausible metres-scale, not schematic toys on pavement.
- **DEM / terrain** — Open-Meteo DEM from `public/geo/*.json`; water polygons carve channels so flat pads no longer clip imaginary waterways.
- **Cesium scaffolding** — feature-flagged (`VITE_CESIUM_ENABLED`); Ion token via `VITE_CESIUM_ION_TOKEN` / `.env.local` (**never committed**). Full globe + Ion imagery/terrain sync is **deferred** — Three.js DEM + GIS is the active path.
- **Piping + outfalls** — process interconnect pipes + outfall channel from GIS chain / nearby OSM waterways where available.
- **Photoreal materials** — regenerated tileable PBR-ish maps (concrete, weathered concrete, asphalt, grass, water + normals, metal, painted metal); open-walled wet basins with reflective water surfaces.
- Includes **v0.2.1** UX / geometry fixes (camera cycle, septic realism, walled clarifiers, layout overlay, controls clarity).

## What’s in v0.2.1 (still)

- Controls / Autopilot clarity, `V` camera cycle, `O` overlay, `[` `]` sim speed, `A` alarm ACK, `Tab` / `F` unit focus
- Septic realism, walled clarifiers, layout overlay, acronym tutorial bands

## What’s in v0.2 (still)

- OSM / DEM surroundings under `public/geo/{plantId}.json`
- Autopilot DO/blowers / wet-well / chem / disinfection
- Hover tooltips + Open controls

## Deferred / follow-ups

- **Full Cesium globe** — `npm` Cesium dependency, dual-canvas WGS84 ↔ ENU sync, Ion world imagery as ground context (scaffold + Esri tiles-lite in 0.3.10).
- Richer GIS snap for Galt / Woodward / Ashbridges when bake water footprints are sparse.
- Kitchener Open-Meteo DEM when API is not rate-limited (bake may still be procedural — see `public/geo/_bake-summary.json`).
- Finer OSM process tagging (named tanks) when available — still no Street View / Apple Maps scrape.

## Attributions

| Asset | Source / licence |
|-------|------------------|
| Roads, buildings, landuse, water, WWTP footprints | © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (**ODbL**) — baked via Overpass into `public/geo/` |
| Elevation samples | [Open-Meteo Elevation API](https://open-meteo.com/) when reachable; else procedural heightfield seeded by plant id |
| Material textures | Generated maps in `public/textures/` (`node scripts/genTextures.mjs`) |
| Capacities / process trains | Public reports cited in `plants.json` / `docs/research-plants.md` |

**Not used:** Street View, Apple Maps, or scraped satellite tiles.

Rebake geo (network required):

```bash
node scripts/bakeGeo.mjs
```

Regenerate textures:

```bash
node scripts/genTextures.mjs
```

## Controls

| Input | Action |
|-------|--------|
| WASD / arrows | Move |
| Mouse drag | Look / orbit |
| Wheel | Zoom |
| C | Orbit ↔ walk |
| V | Camera cycle: bird’s-eye → nadir → walk |
| **Z** | **Autopilot on/off** |
| O | Toggle layout overlay |
| [ / ] | Sim speed down / up (1× · 4× · 12×) |
| A | Acknowledge (silence) active alarms |
| Tab | Cycle unit focus |
| F | Focus camera on selected / first unit |
| Esc | Menu |
