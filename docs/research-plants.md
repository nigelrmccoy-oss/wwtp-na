# WWTP Research Pack — Highway 401 / Waterloo Region Corridor

**Project:** wwtp-na (Three.js operator-training sim)  
**Focus:** St. Jacobs / Woolwich (small), Waterloo (medium), Kitchener (large); Cambridge (Galt) and Guelph noted for context  
**Date compiled:** 2026-09-14  
**Method:** Public Region of Waterloo reports, WWTMP tech memos, ECAs cited therein, GRCA WWOP, OSM Overpass/Nominatim. No Street View / Apple Maps scraping.

**Owner / operator (all Region plants):** Regional Municipality of Waterloo (owner); Ontario Clean Water Agency — OCWA (contract operator).

---

## Summary table

| Plant | Size tier | Rated ADF | Peak / hydraulic | 2023 ADF (WWWMR) | Process (high level) |
|-------|-----------|-----------|------------------|------------------|----------------------|
| St. Jacobs WWTP | **small** | 1.45 MLD | ~5.18 MLD firm PS / UV ~3.63 MLD peak design | 0.905 MLD | Oxidation ditch EA + tertiary + UV |
| Waterloo WWTP | **medium** | 57.5 MLD | 72.73 MLD hydraulic | 42.74 MLD | CAS + UV (+ CHP); expansion path to 72.73 |
| Kitchener WWTP | **large** | 122.745 MLD | 306.862 MLD peak | 73.585 MLD | CAS + tertiary filters + UV (+ CHP) |
| Galt WWTP (Cambridge) | medium† | 56.8 MLD Stage 1 | 171.1 MLD peak | 26.436 MLD | CAS + tertiary + UV (+ CHP) |
| Guelph WWTP | large (outside Region) | — | — | — | City of Guelph (see OSM); not detailed here |

†Galt is included as a relevant Cambridge / 401-corridor plant; primary sim tiers are small/medium/large = St. Jacobs / Waterloo / Kitchener.

---

## 1. St. Jacobs Wastewater Treatment Plant (small)

### Identity & location
- **Official name:** St. Jacobs Wastewater Treatment Plant (SJWWTP)
- **Address:** 61 Water Street, St. Jacobs, ON (Woolwich Township)
- **Approx. lat/lon:** **43.5356, −80.5485** (OSM `man_made=wastewater_plant` way 816956510); address geocode ~43.5365, −80.5516
- **Receiver:** Conestogo River
- **Service:** Village of St. Jacobs

### Capacity
| Metric | Value | Source |
|--------|-------|--------|
| Rated ADF | **1,450 m³/d (1.45 MLD)** | ECA / 2018 WWTMP TM2; 2024 WWWMR |
| Historic ADF (2012–2014) | 920 m³/d (~65% rated) | TM2 Table 55 |
| 2023 ADF | **905 m³/d** | 2024 WWWMR |
| 5-yr average projected flow | 914 m³/d | 2024 WWWMR |
| Peak day (historic) | 2,600 m³/d (PF 2.8) | TM2 |
| Peak hour (assessed) | 3,100 m³/d (PF 3.3) | TM2 |
| Firm raw PS | 60 L/s ≈ **5,180 m³/d** | TM2 Table 58 |
| UV peak design | 3,625–3,630 m³/d | TM2 |
| Equivalent ADF limited by tertiary/UV | ~1,080 m³/d (wet-weather I/I) | TM2 Table 59 |

### Process train
1. **Preliminary:** Raw sewage pumping → grinder/auger screening → vortex grit  
2. **Secondary:** **Oxidation ditch** extended aeration (1 ditch, 904 m³) with mechanical rotors; 2 secondary clarifiers  
3. **Tertiary:** Deep-bed filters (3 units)  
4. **Disinfection:** UV (1 channel)  
5. **Chemicals:** Alum (dual point, u/s and d/s of secondary clarifiers) for TP  
6. **Solids:** Aerated sludge holding; WAS hauled to Waterloo WWTP  

**No primary clarifiers** (extended aeration / oxidation ditch).

### Influent / effluent quality (published)
**Influent (2012–2014 avg, TM2 Table 56):** CBOD₅ ~120 mg/L; TSS ~220; TP ~5.0; TKN ~35 (diluted by I/I).  

**Effluent (2012–2014 avg, TM2 Table 57):** CBOD₅ ~1.7; TSS ~1.6; TP ~0.07; TAN summer ~0.14 / winter ~0.42 mg/L.  

**ECA objectives (ECA 1047-94FHWA, 2013):** CBOD₅ 5 / TSS 5 / TP 0.2 / TAN 0.7 (May–Oct) & 1.0 (Nov–Apr) mg/L; *E. coli* 100 cfu/100 mL.

### Energy / equipment
- No plant-specific kWh/ML published in reviewed Region docs.  
- **Ontario WWTP median intensity ~1.01 eMWh/ML (= 1010 kWh/ML)** (Save on Energy / IESO training deck).  
- At ~0.9 MLD → order-of **~35–50 kW** continuous electrical draw (estimated; small plants often higher intensity).  
- Major equipment (TM2): 3 raw pumps; 2 screens; 1 vortex grit; oxidation ditch + 2 rotors; 2 clarifiers; 3 tertiary filters; UV; aerated sludge tank.

### Sources
- [WWTMP TM2 — Status & Capacity (May 2017)](https://www.regionofwaterloo.ca/media/tt5lt0qf/ws2018v2-tech_memo_2-wwtmp-current_status_and_capacity_assessment-may2017.pdf)  
- [2024 Water and Wastewater Monitoring Report](https://media-003-ca.cdn.govstack.com/regionofwaterloo-018-ca/media/sm1dzkby/2024-water-and-wastewater-monitoring-report-final-s-access.pdf)  
- [St. Jacobs WWTP Expansion Class EA notice](https://www.regionofwaterloo.ca/media/d0pdkjll/st-jacobs_wwtp_expansion_schedule_c_ea_-_notice_of_study_commencementpdf.pdf)  
- [Project page](https://www.regionofwaterloo.ca/programs-and-services/water-and-wastewater/projects/st-jacobs-wastewater-treatment-plant-expansion/)  
- [St. Jacobs & Elmira WWTMP 2013](https://media-003-ca.cdn.govstack.com/regionofwaterloo-018-ca/media/t0ulq1fg/stjacobselmirawastewatertreatmentmasterplan2013final-aoda.pdf)  
- OSM Overpass: `man_made=wastewater_plant` near St. Jacobs

---

## 2. Waterloo Wastewater Treatment Plant (medium)

### Identity & location
- **Official name:** Waterloo Wastewater Treatment Plant (WWWTP)
- **Address:** 340 University Avenue East, Waterloo, ON  
- **Approx. lat/lon:** **43.4875, −80.5075** (OSM way 398629823)  
- **Receiver:** Grand River  
- **ECA (cited in TM2):** 9354-8J4PUE (2012)

### Capacity
| Metric | Value | Source |
|--------|-------|--------|
| Rated ADF treatment | **57,500 m³/d (57.5 MLD)** | ECA / TM2 / 2024 WWWMR |
| Hydraulic capacity | **72,730 m³/d** | ECA / WWWMR |
| Historic ADF (2012–2014) | 46,640 m³/d (~80%) | TM2 |
| 2023 ADF | **42,740 m³/d** | 2024 WWWMR |
| Peak day historic | 116,580 m³/d (PF 2.5) | TM2 |
| UV peak design | 200,000 m³/d | TM2 Table 12 |

### Process train
1. **Preliminary:** Raw sewage PS → mechanical perforated-plate screens → vortex grit  
2. **Primary:** 4 circular primary clarifiers  
3. **Secondary:** Conventional activated sludge (CAS) aeration tanks + secondary clarifiers; year-round nitrification after Contract 4 upgrades  
4. **Chemicals:** Ferric chloride for phosphorus removal  
5. **Disinfection:** UV (4 channels)  
6. **Solids:** Rotary drum thickening of WAS; anaerobic digestion; on-site centrifuge dewatering; centrate return  
7. **Energy:** Digester-gas **CHP (~600 kW** planned/installed per WWTMP TM7)

### Influent / effluent quality (published)
**Influent (design / historic, TM2):** CBOD₅ ~200 mg/L; TSS high (~230–320); TP ~5–6; TKN ~40–50.  

**Effluent (2012–2014 avg, pre-full nitrification):** CBOD₅ ~6.7; TSS ~6.2; TP ~0.3; TAN historically high (~23.8) before Contract 4 — plant now nitrifying (GRCA notes upgrades completed ~2019).  

**ECA objectives (≤54,600 m³/d era):** CBOD₅ 10; TSS 10; TP 0.4; TAN 1.5 mg/L; *E. coli* 100.

### Energy / equipment
- Region **Corporate Energy Plan (2024–2033):** three WWTPs (Kitchener, Waterloo, Galt) CHP systems serve **~60% of site electricity**.  
- CIMA+: combined ~237 ML/d at the three plants; up to ~22,000 m³/d biogas.  
- TM7: Waterloo **600 kW** CHP.  
- Estimated plant electrical intensity: Ontario median **~1010 kWh/ML** → at 42.7 MLD ≈ **~1,800 kW** continuous (estimated grid+CHP load before CHP offset).  
- Major equipment (TM2 Table 12): 5 raw pumps; 3 screens; 2 grit tanks; 4 primaries; aeration (2 tanks, 21,345 m³); 7 blowers; 4 secondary clarifiers; UV; digesters ~13,000 + 6,500 m³.

### Sources
- [WWTMP TM2](https://www.regionofwaterloo.ca/media/tt5lt0qf/ws2018v2-tech_memo_2-wwtmp-current_status_and_capacity_assessment-may2017.pdf)  
- [WWTMP TM7 — Solids / CHP](https://www.regionofwaterloo.ca/media/p4gperzv/ws2018v3-tech_memo_7-solids_treatment_alternatives-may_2018.pdf)  
- [2018 WWTMP Final Report](https://www.regionofwaterloo.ca/media/j45krx0g/ws2018wastewater_treatment_master_plan_wwtmp_final_report.pdf)  
- [2024 WWWMR](https://media-003-ca.cdn.govstack.com/regionofwaterloo-018-ca/media/sm1dzkby/2024-water-and-wastewater-monitoring-report-final-s-access.pdf)  
- [2024–2033 Corporate Energy Plan](https://www.regionofwaterloo.ca/media/fhlhzrzb/2024-2033-corporate-energy-plan.pdf)  
- [CIMA+ CHP project](https://www.cima.ca/en/project/installation-of-cogeneration-facilities-at-three-region-of-waterloo-wastewater-treatment-plants/)

---

## 3. Kitchener Wastewater Treatment Plant (large)

### Identity & location
- **Official name:** Kitchener Wastewater Treatment Plant (KWWTP)
- **Address:** 368 Mill Park Drive, Kitchener, ON (Pioneer Park / Grand River corridor)  
- **Approx. lat/lon:** **43.3982, −80.4209** (OSM way 154430088)  
- **Related:** Manitou Drive Biosolids Dewatering Facility (off-site centrifuges)  
- **Receiver:** Grand River  
- **ECA (cited in TM2):** 0102-9RDM5C (2015)

### Capacity
| Metric | Value | Source |
|--------|-------|--------|
| Rated ADF | **122,745 m³/d (~122.7 MLD)** | ECA / TM2 (WWWMR rounds to 122,700) |
| Peak flow capacity | **306,862 m³/d** | ECA / TM2 |
| Historic ADF (2012–2014) | 70,970 m³/d (~60%) | TM2 |
| 2023 ADF | **73,585 m³/d** | 2024 WWWMR |
| UV peak design | 400,000 m³/d | TM2 |

### Process train
1. **Preliminary:** Headworks — perforated screens + vortex grit (Phase 3 new headworks)  
2. **Primary:** Rectangular primary clarifiers; chemical P removal (ferric / ferrous chloride)  
3. **Secondary:** Multi-train **CAS** (Plant 2 retained; Plants 3 & 4 replaced Plant 1) with year-round nitrification  
4. **Tertiary:** Disk / tertiary filtration (Phase 3 Contract 4)  
5. **Disinfection:** UV + effluent pumping  
6. **Solids:** Anaerobic digestion on site; digested sludge to **Manitou Drive** dewatering; agricultural / beneficial reuse; centrate return  
7. **Energy:** Digester-gas **CHP (~800 kW** per TM7)

### Influent / effluent quality (published)
**Influent (2012–2014, TM2 Table 3):** CBOD₅ ~180; TSS ~240; TP ~6; TKN ~40 mg/L (medium strength).  

**Effluent (2012–2014 avg):** CBOD₅ ~6.2; TSS ~8.5; TP ~0.62; TAN improved after Plant 2 upgrades (~6.4 mg/L 2013–14 vs ~19.7 in 2012). Post-2019 full nitrification + tertiary: GRCA watershed reports show large reductions in watershed TAN/TP from Kitchener/Waterloo upgrades.  

**Future ECA objectives (post tertiary):** CBOD₅ 10; TSS 10; TP 0.2; seasonal TAN limits; *E. coli* 100.

### Energy / equipment
- CHP **~800 kW** (TM7); Region CEP: ~60% of electricity at the three CHP plants; Kitchener often cited as higher self-supply share in industry write-ups.  
- Estimated intensity @ Ontario median 1010 kWh/ML × 73.6 MLD ≈ **~3,100 kW** continuous plant load (estimated).  
- Major equipment (TM2 Table 5, Phase 3): 4 screens; 2 grit tanks; 4 primaries; Plant 2 + Plants 3/4 aeration; 7+ blowers; secondary clarifiers; 4 tertiary disk filters; 3 UV channels; 2 primary digesters (~16,490 m³).

### Sources
- [WWTMP TM2](https://www.regionofwaterloo.ca/media/tt5lt0qf/ws2018v2-tech_memo_2-wwtmp-current_status_and_capacity_assessment-may2017.pdf)  
- [WWTMP TM7](https://www.regionofwaterloo.ca/media/p4gperzv/ws2018v3-tech_memo_7-solids_treatment_alternatives-may_2018.pdf)  
- [Kitchener WWTP upgrades project page](https://www.regionofwaterloo.ca/programs-and-services/water-and-wastewater/projects/kitchener-wastewater-treatment-plant-upgrades/)  
- [EngageWR — Kitchener WWTP](https://www.engagewr.ca/kitchener-wastewater-treatment-plant)  
- [2024 WWWMR](https://media-003-ca.cdn.govstack.com/regionofwaterloo-018-ca/media/sm1dzkby/2024-water-and-wastewater-monitoring-report-final-s-access.pdf)  
- [GRCA 2023 WWTP Performance Overview](https://www.grandriver.ca/media/rjzjqnfr/2023-wwtp-summary-report.pdf)

---

## 4. Galt WWTP (Cambridge) — optional corridor plant

- **Name:** Galt Wastewater Treatment Plant (GWWTP), City of Cambridge  
- **Approx. lat/lon:** **43.4230, −80.3293** (OSM `man_made=wastewater_plant` way 337944783)  
- **Rated ADF Stage 1:** 56,800 m³/d; peak 171,100 m³/d; Stage 2 path 76,000 m³/d  
- **2023 ADF:** 26,436 m³/d  
- **Process:** CAS + tertiary filtration + UV; alum; anaerobic digestion + centrifuges; CHP (with Kitchener/Waterloo)  
- **Sources:** TM2 §3.3; 2024 WWWMR §3.2.3  

## 5. Guelph WWTP — context only

- **Owner:** City of Guelph (not Region of Waterloo)  
- **OSM:** way 773030535 ~43.5236, −80.2646  
- Include only if expanding the sim corridor east along Highway 7 / 401 approaches; pull City of Guelph annual reports / ECA separately.

---

## Influent / effluent quick reference (sim defaults)

Values are **published historic averages** (TM2, mostly 2012–2014 OCWA data) unless noted. Post-upgrade effluent TAN/TP for Kitchener & Waterloo are better than 2012–2014 TAN figures.

| Plant | Influent BOD | Influent TSS | Influent TP | Influent NH₃/TKN | Effluent BOD | Effluent TSS | Effluent TP | Effluent NH₃/TAN |
|-------|--------------|--------------|-------------|------------------|--------------|--------------|-------------|------------------|
| St. Jacobs | 120 | 220 | 5.0 | TKN 35 | 1.7 | 1.6 | 0.07 | 0.14–0.42 |
| Waterloo | 200 | 230–320 | 5–6 | TKN 40–50 | 6.7 | 6.2 | 0.3 | high pre-upgrade; target ~1.5 |
| Kitchener | 180 | 240 | 6 | TKN 40 | 6.2 | 8.5 | 0.62 | ~6.4 post-Plant2; lower post-2019 |

Units: mg/L.

---

## Energy intensity notes

| Source | Figure |
|--------|--------|
| Save on Energy — Operating for Energy Efficiency (Ontario WWTPs) | Median **1.01 eMWh/ML** (1010 kWh/ML); IQR ~0.55–1.87 |
| Region CEP 2024–2033 | CHP at Kitchener, Waterloo, Galt ≈ **60%** of those sites’ electricity |
| WWTMP TM7 | Kitchener CHP **800 kW**; Waterloo CHP **600 kW** |
| CIMA+ project page | Three plants ~237 ML/d combined; ~22,000 m³/d biogas potential |

Plant-specific audited kWh/ML not found in public PDFs reviewed; sim `powerKw` fields are **estimated** from median intensity × recent ADF.

---

## OSM query hints (footprints, roads, buildings)

### Overpass / tag filters
```
// Plant footprints
["man_made"="wastewater_plant"]
["landuse"="industrial"]["name"~"Wastewater|Sewage|WWTP",i]

// Nearby structure
["building"]
["building"="industrial"]
["building"="yes"]

// Access / corridor roads
["highway"~"^(primary|secondary|tertiary|residential|service)$"]
["highway"="service"]["service"="driveway"]

// Water receivers
["waterway"~"^(river|stream)$"]
["natural"="water"]
```

### Suggested bbox centers (±~0.03–0.05° ≈ 2–5 km)
| Plant | Center | Example Overpass bbox (S,W,N,E) |
|-------|--------|----------------------------------|
| St. Jacobs | 43.536, −80.549 | `(43.50,-80.59,43.57,-80.51)` |
| Waterloo | 43.488, −80.507 | `(43.45,-80.55,43.52,-80.46)` |
| Kitchener | 43.398, −80.421 | `(43.36,-80.46,43.43,-80.38)` |
| Galt | 43.423, −80.329 | `(43.39,-80.37,43.45,-80.29)` |

### Nominatim / name search
- `"Kitchener Wastewater Treatment Plant"`
- `"Waterloo Wastewater Treatment Plant"`
- `"61 Water Street St Jacobs"` + `man_made=wastewater_plant` nearby

Known OSM IDs (as of research date):  
- Kitchener: way **154430088**  
- Waterloo: way **398629823**  
- St. Jacobs: way **816956510**  
- Galt (unnamed fence footprint): way **337944783**

---

## DEM tiles (~2–5 km around each plant)

| Option | Resolution | Coverage | License / terms | Notes |
|--------|------------|----------|-----------------|-------|
| **SRTM GL1** (via OpenTopography, USGS, or AWS) | ~30 m | Global | Public domain (US Gov) / check distributor ToS | Fine for regional terrain; river valleys soft |
| **CDEM / HRDEM** (NRCan) | ~20 m CDEM; HRDEM LiDAR where available | Canada | **Open Government Licence – Canada** | Preferred for Ontario; HRDEM if tile exists for Waterloo Region |
| **Ontario / GRCA LiDAR** (if open) | 1–2 m | Patchy | Check each portal licence | Best for plant-pad grading; may need attribution |

**Practical approach for wwtp-na:**  
1. Download CDEM or SRTM GeoTIFF clipped to each plant bbox (~5×5 km).  
2. Convert to heightmap / Three.js `THREE.Terrain` or custom displacement.  
3. Credit: *“Elevation data © His Majesty the King in Right of Canada / NRCan (CDEM/HRDEM) under Open Government Licence – Canada”* or *“SRTM courtesy NASA/JPL / USGS”*.

OpenTopography: https://opentopography.org/ — check dataset-specific licences before bundling in a public GitHub game.

---

## Satellite / basemap options (public GitHub game)

| Source | Usable in public game? | Attribution required | Notes |
|--------|------------------------|----------------------|-------|
| **Esri World Imagery** (ArcGIS Online tile service) | Yes, for non-commercial / many educational uses — **verify current Esri ToS** | Yes — e.g. *“Esri, Maxar, Earthstar Geographics, and the GIS User Community”* | Common in Cesium/Three.js demos; do **not** scrape proprietary offline mosaics |
| **OpenStreetMap** raster (e.g. standard / Carto Positron) | Yes (ODbL) | Yes — © OpenStreetMap contributors | Best for roads/labels; not true satellite |
| **USGS / public-domain imagery** | Yes where PD | Per dataset | Limited Ontario coverage |
| **Sentinel-2** (ESA Copernicus) | Yes with attribution | Copernicus / ESA terms | DIY ortho tiles; good free satellite look |
| Google / Apple / Bing imagery | **No** for redistribution in a public game without a commercial licence | N/A | Do not scrape or hotlink against ToS |

**Recommendation:** Runtime tiles from **Esri World Imagery** (with attribution overlay) **or** pre-process **Sentinel-2** L2A true-colour for offline GitHub Pages builds; use **OSM vector/raster** for roads and plant outlines.

---

## Master source index

| Document | URL |
|----------|-----|
| Region reports & plans hub | https://www.regionofwaterloo.ca/programs-and-services/water-and-wastewater/reports-and-plans/ |
| 2018 WWTMP Final | https://www.regionofwaterloo.ca/media/j45krx0g/ws2018wastewater_treatment_master_plan_wwtmp_final_report.pdf |
| WWTMP TM2 Capacity | https://www.regionofwaterloo.ca/media/tt5lt0qf/ws2018v2-tech_memo_2-wwtmp-current_status_and_capacity_assessment-may2017.pdf |
| WWTMP TM7 Solids/CHP | https://www.regionofwaterloo.ca/media/p4gperzv/ws2018v3-tech_memo_7-solids_treatment_alternatives-may_2018.pdf |
| 2024 WWWMR | https://media-003-ca.cdn.govstack.com/regionofwaterloo-018-ca/media/sm1dzkby/2024-water-and-wastewater-monitoring-report-final-s-access.pdf |
| 2025 WWWMR | https://media-003-ca.cdn.govstack.com/regionofwaterloo-018-ca/media/dkdmkxvo/2025-water-and-wastewater-monitoring-report-final-s_access.pdf |
| GRCA 2023 WWTP summary | https://www.grandriver.ca/media/rjzjqnfr/2023-wwtp-summary-report.pdf |
| Corporate Energy Plan 2024–2033 | https://www.regionofwaterloo.ca/media/fhlhzrzb/2024-2033-corporate-energy-plan.pdf |
| St. Jacobs EA commencement | https://www.regionofwaterloo.ca/media/d0pdkjll/st-jacobs_wwtp_expansion_schedule_c_ea_-_notice_of_study_commencementpdf.pdf |

---

*Figures marked estimated in `plants.json` use Ontario median energy intensity or design-peak hydraulic values where ECA peak ADF is not separately published.*
