# WWTP-NA v0.2

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

## What’s in v0.2

- **OSM / DEM surroundings** — cached Overpass extracts + elevation under `public/geo/{plantId}.json`; extruded buildings, asphalt roads, farm/landuse, water; process train stays playable
- **Realistic textures** — grass / concrete / asphalt / water / metal via `THREE.TextureLoader` + RepeatWrapping; hemisphere + directional shadows
- **Acronym tutorial** — first-run modal + menu **Tutorial** button (WWTP, SCADA, MLD, BOD, TSS, TP, TAN, DO, MLSS, UV, ECA, RAS/WAS, …)
- **Autopilot** — SCADA toggle; tracks DO/blowers, wet-well pumps, chem dose vs ECA TP, disinfection online, septic float clear; **AUTOPILOT** badge
- **Hover tooltips** — raycast explainers + **Open controls** highlights related SCADA setpoints
- All v0.1 P0/P1 behaviour retained (DO defaults, process-aware disinfection, pump≠influent, sim speed, TP ECA, alarm list)

## What’s in v0.1 (still)

- Menu → pick any plant from JSON (septic + municipal)
- Three.js site: labeled units, orbit + WASD, walk mode (`C`), click-to-select
- Windowed SCADA + continuous mass-balance-lite model + alarms
- Synthesized Web Audio SFX

## Attributions

| Asset | Source / licence |
|-------|------------------|
| Roads, buildings, landuse, water, WWTP footprints | © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (**ODbL**) — baked via Overpass into `public/geo/` |
| Elevation samples | [Open-Meteo Elevation API](https://open-meteo.com/) when reachable; else procedural heightfield seeded by plant id |
| Material textures | Bundled generated maps in `public/textures/` (grass, concrete, asphalt, water, metal) |
| Capacities / process trains | Public reports cited in `plants.json` / `docs/research-plants.md` |

**Not used:** Street View, Apple Maps, or scraped satellite tiles. Optional Esri World Imagery is **not** enabled in v0.2 (textured DEM is enough).

Rebake geo (network required):

```bash
node scripts/bakeGeo.mjs
```

## Controls

| Input | Action |
|-------|--------|
| WASD / arrows | Move |
| Mouse drag | Look / orbit |
| Wheel | Zoom |
| C | Orbit ↔ walk |
| Hover unit | Tooltip (what it does + acronyms) |
| Click unit | Select |
| Tooltip **Open controls** | Highlight related SCADA setpoints |
| SCADA Autopilot | ON = auto NORMAL/ECA · OFF = manual |
| Esc | Menu |
| Menu **Tutorial** | Reopen acronym glossary |

## Audio / SFX

SFX are **synthesized** in `src/audio/AudioEngine.ts`. Optional: drop `.ogg`/`.wav` into `public/sfx/` (see `public/sfx/SOURCES.md`).

## Stack

Vite 6 + TypeScript + Three.js r170 · HTML/CSS SCADA

## Layout

```
src/main.ts
src/audio/AudioEngine.ts
src/ui/menu.ts
src/ui/scada.ts
src/ui/tutorial.ts
src/ui/hoverTip.ts
src/world/plantScene.ts
src/world/textures.ts
src/world/terrain.ts
src/world/osmBake.ts
src/sim/processModel.ts
src/sim/autopilot.ts
src/data/plants.json
src/data/plantTypes.ts
public/geo/
public/textures/
public/sfx/
scripts/bakeGeo.mjs
docs/research-plants.md
```

## Affiliation

Training-sim tribute only. Do not use for real plant or septic control decisions.
