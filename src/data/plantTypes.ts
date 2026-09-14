/** Types matching src/data/plants.json (research pack — source of truth). */

export type DisinfectionType = 'uv' | 'chlorine' | 'none';

export interface ResearchPlant {
  id: string;
  name: string;
  size: string;
  owner: string;
  operator: string;
  address: string;
  receiver: string;
  location: { lat: number; lon: number };
  capacity: {
    avgMld: number;
    peakMld: number;
    avgM3d?: number;
    peakM3d?: number;
    unit: string;
    notes: string;
  };
  capacityEstimated?: Record<string, boolean>;
  process: string[];
  waterQuality: {
    influent: { bodMgL: number; tssMgL: number; tpMgL: number; nh3OrTknMgL: number; nh3Label?: string; period?: string };
    effluent: { bodMgL: number; tssMgL: number; tpMgL: number; nh3MgL: number; nh3Notes?: string; period?: string; estimated?: Record<string, boolean> };
    ecaObjectivesMgL: Record<string, number | string | undefined>;
  };
  energy: {
    intensityKwhPerMl: number;
    intensityEstimated?: boolean;
    intensitySource?: string;
    chpKw: number | null;
    chpSource?: string;
    chpNotes?: string;
    majorEquipment: string[];
  };
  scadaDefaults: {
    influentFlowMld: number;
    aerationDoMgL: number;
    mlssMgL: number;
    powerKw: number;
    uvDose: number;
    tankLevelPct?: number;
    pumpAlarmFloat?: boolean;
    estimated?: Record<string, boolean>;
  };
  scadaProfile?: 'municipal' | 'septic' | string;
  sources: { title: string; url: string }[];
}

export interface PlantsFile {
  plants: ResearchPlant[];
  notes?: string;
}

export interface PlantRuntime {
  research: ResearchPlant;
  id: string;
  size: string;
  sizeLabel: string;
  name: string;
  nameShort: string;
  municipality: string;
  approxLat: number;
  approxLon: number;
  designCapacityMld: number;
  peakCapacityMld: number;
  avgDayFlowMld: number;
  peakFactor: number;
  flowUnit: 'MLD' | 'm3/d';
  flowDisplayScale: number; // multiply MLD → display units
  aerationVolumeM3: number;
  primaryClarifierCount: number;
  secondaryClarifierCount: number;
  aerationBasinCount: number;
  /** UV bank count when disinfectionType === 'uv'; otherwise 0 */
  uvBanks: number;
  /** Chlorine contact channels when disinfectionType === 'chlorine' */
  chlorineContactCount: number;
  disinfectionType: DisinfectionType;
  blowerRatedKw: number;
  layoutScale: number;
  notes: string;
  hasPrimary: boolean;
  hasOxidationDitch: boolean;
  isSeptic: boolean;
  /** Coagulant name for P-removal dose slider, or null if none. */
  chemicalLabel: string | null;
  /** ECA / objective TP (mg/L) when present in research data. */
  ecaTpMgL: number | null;
  defaultDo: number;
  defaultMlss: number;
  influentBod: number;
  effluentBod: number;
  influentTpMgL: number;
  effluentTpMgL: number;
}

const SIZE_LABEL: Record<string, string> = {
  micro: 'Micro (septic)',
  septic: 'Micro (septic)',
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  xlarge: 'Extra-large',
  'extra-large': 'Extra-large',
};

const SIZE_RANK: Record<string, number> = {
  micro: 0,
  septic: 0,
  small: 1,
  medium: 2,
  large: 3,
  xlarge: 4,
  'extra-large': 4,
};

const SHORT_NAMES: Record<string, string> = {
  'farm-septic': 'Farm septic',
  'st-jacobs': 'St. Jacobs',
  waterloo: 'Waterloo',
  kitchener: 'Kitchener',
  galt: 'Galt',
  woodward: 'Hamilton Woodward',
  'hamilton-woodward': 'Hamilton Woodward',
  'ashbridges-bay': 'Ashbridges Bay',
  'toronto-ashbridges-bay': 'Ashbridges Bay',
  ashbridges: 'Ashbridges Bay',
};

const MUNI: Record<string, string> = {
  'farm-septic': 'Rural Ontario (private)',
  'st-jacobs': 'Woolwich Township',
  waterloo: 'City of Waterloo',
  kitchener: 'City of Kitchener',
  galt: 'Cambridge (Galt)',
  woodward: 'Hamilton',
  'hamilton-woodward': 'City of Hamilton',
  'ashbridges-bay': 'Toronto',
  'toronto-ashbridges-bay': 'City of Toronto',
  ashbridges: 'Toronto',
};

/** Prefer chlorine when listed (e.g. ABTP NaOCl primary); UV only when no chlorine. */
export function resolveDisinfectionType(process: string[]): DisinfectionType {
  const hasChlorine = process.some((p) =>
    /chlorine|chlorination|naocl|hypochlorite/i.test(p),
  );
  const hasUv = process.some((p) => p === 'uv' || /uv_disinfection/i.test(p));
  if (hasChlorine) return 'chlorine';
  if (hasUv) return 'uv';
  return 'none';
}


/** Research-pack coagulant label for chemical_p_removal plants. */
export function resolveChemicalLabel(p: ResearchPlant): string | null {
  if (p.scadaProfile === 'septic' || !p.process.includes('chemical_p_removal')) return null;
  const id = p.id.toLowerCase();
  const name = p.name.toLowerCase();
  // Sourced from docs/research-plants.md (Region TM2 / Toronto annual report).
  if (id === 'st-jacobs' || id === 'galt') return 'Alum';
  if (id === 'waterloo' || id === 'kitchener') return 'Ferric';
  if (id.includes('ashbridges') || /ashbridges/.test(name)) return 'Ferric';
  if (id.includes('woodward') || /woodward/.test(name)) return 'Ferric';
  return 'Coagulant';
}

export function resolveEcaTp(p: ResearchPlant): number | null {
  const eca = p.waterQuality?.ecaObjectivesMgL ?? {};
  const keys = ['tp', 'tpMonthly', 'secondaryObjectiveTpMonthly', 'TP'];
  for (const k of keys) {
    const v = eca[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

export function toRuntime(p: ResearchPlant): PlantRuntime {
  const avg = p.capacity.avgMld;
  const peak = Math.max(p.capacity.peakMld, avg * 1.2);
  const size = p.size.toLowerCase();
  const isSeptic = p.scadaProfile === 'septic' || size === 'micro' || size === 'septic' || p.id === 'farm-septic';
  const hasPrimary = p.process.includes('primary');
  const hasOxidationDitch = p.process.includes('oxidation_ditch');
  const hasTertiary = p.process.includes('tertiary_filtration');
  const disinfectionType = isSeptic ? 'none' : resolveDisinfectionType(p.process);

  let layoutScale =
    size === 'micro' || size === 'septic' ? 0.28 :
    size === 'small' ? 0.5 :
    size === 'large' ? 1.45 :
    size === 'xlarge' || size === 'extra-large' ? 1.85 :
    1.0;

  // Known layout overrides; unknown plants get size-based defaults (Woodward / Ashbridges etc.)
  let primaryClarifierCount = hasPrimary ? (SIZE_RANK[size] ?? 2) + 1 : 0;
  let secondaryClarifierCount = size === 'small' || isSeptic ? 2 : size === 'large' ? 6 : size === 'xlarge' || size === 'extra-large' ? 8 : 4;
  let aerationBasinCount = hasOxidationDitch ? 1 : isSeptic ? 0 : size === 'large' ? 4 : size === 'xlarge' || size === 'extra-large' ? 6 : 2;
  let uvBanks = 0;
  let chlorineContactCount = 0;
  let aerationVolumeM3 = isSeptic ? (p.capacity.avgM3d ?? avg * 1000) * 1.5 : avg * 400;

  const sizeUvBanks =
    size === 'small' ? 1 : size === 'large' ? 3 : size === 'xlarge' || size === 'extra-large' ? 6 : 2;
  const sizeClChannels =
    size === 'small' ? 1 : size === 'large' ? 3 : size === 'xlarge' || size === 'extra-large' ? 4 : 2;

  if (p.id === 'farm-septic') {
    layoutScale = 0.28;
    primaryClarifierCount = 0;
    secondaryClarifierCount = 0;
    aerationBasinCount = 0;
    aerationVolumeM3 = 4;
  } else if (p.id === 'st-jacobs') {
    primaryClarifierCount = 0;
    secondaryClarifierCount = 2;
    aerationBasinCount = 1;
    aerationVolumeM3 = 904;
  } else if (p.id === 'waterloo') {
    primaryClarifierCount = 4;
    secondaryClarifierCount = 4;
    aerationBasinCount = 2;
    aerationVolumeM3 = 21345;
  } else if (p.id === 'kitchener') {
    primaryClarifierCount = 4;
    secondaryClarifierCount = 6;
    aerationBasinCount = 4;
    aerationVolumeM3 = 45000;
  } else if (p.id === 'galt') {
    primaryClarifierCount = 3;
    secondaryClarifierCount = 4;
    aerationBasinCount = 2;
    aerationVolumeM3 = 18000;
  } else if (p.id === 'woodward' || p.id === 'hamilton-woodward' || /woodward/i.test(p.name)) {
    layoutScale = 1.9;
    primaryClarifierCount = 6;
    secondaryClarifierCount = 8;
    aerationBasinCount = 6;
  } else if (p.id.includes('ashbridges') || /ashbridges/i.test(p.name)) {
    layoutScale = 2.1;
    primaryClarifierCount = 8;
    secondaryClarifierCount = 10;
    aerationBasinCount = 8;
  }

  if (disinfectionType === 'uv') {
    if (p.id === 'st-jacobs') uvBanks = 1;
    else if (p.id === 'waterloo') uvBanks = 4;
    else if (p.id === 'kitchener') uvBanks = 3;
    else if (p.id === 'galt') uvBanks = 2;
    else uvBanks = sizeUvBanks;
  } else if (disinfectionType === 'chlorine') {
    if (p.id === 'woodward' || p.id === 'hamilton-woodward' || /woodward/i.test(p.name)) chlorineContactCount = 4;
    else if (p.id.includes('ashbridges') || /ashbridges/i.test(p.name)) chlorineContactCount = 4;
    else chlorineContactCount = sizeClChannels;
  }

  const flowUnit: 'MLD' | 'm3/d' = isSeptic || p.capacity.unit === 'm3/d' ? 'm3/d' : 'MLD';
  const flowDisplayScale = flowUnit === 'm3/d' ? 1000 : 1;

  return {
    research: p,
    id: p.id,
    size,
    sizeLabel: SIZE_LABEL[size] ?? p.size,
    name: p.name,
    nameShort: SHORT_NAMES[p.id] ?? p.name.replace(/ Wastewater Treatment Plant/i, '').replace(/ WWTP/i, ''),
    municipality: MUNI[p.id] ?? (p.address.split(',').slice(-2).join(',').trim() || p.address),
    approxLat: p.location.lat,
    approxLon: p.location.lon,
    designCapacityMld: avg,
    peakCapacityMld: peak,
    avgDayFlowMld: p.scadaDefaults.influentFlowMld,
    peakFactor: peak / Math.max(avg, 1e-9),
    flowUnit,
    flowDisplayScale,
    aerationVolumeM3,
    primaryClarifierCount,
    secondaryClarifierCount,
    aerationBasinCount,
    uvBanks,
    chlorineContactCount,
    disinfectionType,
    blowerRatedKw: Math.max(isSeptic ? 0.5 : 30, p.scadaDefaults.powerKw),
    layoutScale,
    notes: p.capacity.notes + (hasTertiary ? ' · tertiary' : ''),
    hasPrimary,
    hasOxidationDitch,
    isSeptic,
    chemicalLabel: isSeptic ? null : resolveChemicalLabel(p),
    ecaTpMgL: isSeptic ? null : resolveEcaTp(p),
    defaultDo: p.scadaDefaults.aerationDoMgL,
    defaultMlss: p.scadaDefaults.mlssMgL,
    influentBod: p.waterQuality.influent.bodMgL,
    effluentBod: p.waterQuality.effluent.bodMgL,
    influentTpMgL: p.waterQuality.influent.tpMgL,
    effluentTpMgL: p.waterQuality.effluent.tpMgL,
  };
}

/** Load every plant from JSON, sorted micro→xlarge then name. */
export function menuPlants(all: ResearchPlant[]): PlantRuntime[] {
  return [...all]
    .map(toRuntime)
    .sort((a, b) => {
      const ra = SIZE_RANK[a.size] ?? 50;
      const rb = SIZE_RANK[b.size] ?? 50;
      if (ra !== rb) return ra - rb;
      return a.designCapacityMld - b.designCapacityMld;
    });
}

export function formatFlow(mld: number, plant: PlantRuntime, digits = 2): string {
  const v = mld * plant.flowDisplayScale;
  if (plant.flowUnit === 'm3/d') return `${v.toFixed(digits === 2 ? 2 : digits)} m³/d`;
  return `${v.toFixed(digits)} MLD`;
}
