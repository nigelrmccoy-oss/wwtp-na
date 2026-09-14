# WWTP-NA v0.1

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

Menu lists **all** `plants.json` entries dynamically (new research plants appear without code changes).

See `docs/research-plants.md` and each plant’s `sources` in JSON.

## What’s in v0.1

- Menu → pick any plant from JSON (septic + municipal)
- Three.js site: procedural ground, fog/sky, labeled units, roads; septic gets tank + leaching bed
- Orbit + WASD, walk mode (`C`), click-to-select
- Windowed SCADA: municipal tags (flow MLD, DO, MLSS, blowers, UV, levels) or septic tags (tank %, float alarm, bed flow m³/d)
- Continuous mass-balance-lite model + alarms + shift status strip
- **Synthesized** Web Audio SFX (pump / water / blower / alarm / UI); optional `public/sfx/` overrides

## What’s out of v0.1

- Full ASM1 / detailed solids
- OSM/DEM bake (hooks in `plantScene.ts`)
- Packaged Sample Focus / Freesound libraries (optional later)
- Electron desktop build

## Controls

| Input | Action |
|-------|--------|
| WASD / arrows | Move |
| Mouse drag | Look / orbit |
| Wheel | Zoom |
| C | Orbit ↔ walk |
| Click unit | Select |
| Esc | Menu |
| SCADA controls | Setpoints |

## Audio / SFX

SFX are **synthesized** in `src/audio/AudioEngine.ts`. Amplitude/pitch track pump, blower, and flow setpoints; alarms latch a harsh buzzer.

Optional: drop `.ogg`/`.wav` into `public/sfx/` (see `public/sfx/SOURCES.md`). Sample Focus / Freesound are optional later (manual download; do not scrape).

## Stack

Vite 6 + TypeScript + Three.js r170 · HTML/CSS SCADA

## Layout

```
src/main.ts
src/audio/AudioEngine.ts
src/ui/menu.ts
src/ui/scada.ts
src/world/plantScene.ts
src/sim/processModel.ts
src/data/plants.json
src/data/plantTypes.ts
public/sfx/
docs/research-plants.md
```

## Affiliation

Training-sim tribute only. Do not use for real plant or septic control decisions.
