# Cached OSM / DEM bakes

Per-plant GeoJSON + elevation samples used by `src/world/osmBake.ts` and `src/world/terrain.ts`.

- **OSM**: Overpass API extract (~1.2 km) — roads, buildings, landuse, waterways, `amenity/man_made=wastewater_plant`.
  © OpenStreetMap contributors ([ODbL](https://www.openstreetmap.org/copyright)).
- **DEM**: Open-Meteo elevation API samples when available; otherwise gentle heightfield noise seeded by plant id.
- Rebake: `node scripts/bakeGeo.mjs` (requires network; sets a descriptive User-Agent).

Do **not** scrape Street View or Apple Maps. Satellite imagery is not bundled.
