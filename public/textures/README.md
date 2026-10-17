# Textures

Tileable PBR-style material maps for wwtp-na (regenerate with `node scripts/genTextures.mjs`):

| File | Use |
|------|-----|
| `terrain-grass.png` | DEM / surroundings ground |
| `mat-concrete.png` | Fresh concrete basins / floors |
| `mat-concrete-weathered.png` | Weathered basin walls |
| `mat-asphalt.png` | Site pad / roads |
| `mat-water.png` | Basin water albedo |
| `mat-water-normal.png` | Water ripple normals |
| `mat-metal.png` | Brushed industrial metal |
| `mat-metal-painted.png` | Painted pipe / digester metal |

Loaded via `THREE.TextureLoader` with `RepeatWrapping` in `src/world/textures.ts`.
