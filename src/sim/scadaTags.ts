/**
 * v0.3.16 SCADA tag database: ISA-5.1-style instrument tags per process area, with
 * engineering units, instrument ranges, alarm limits (LL/L/H/HH) and setpoints.
 *
 * Limits mirror the alarms ProcessModel actually raises (so the tag table and the alarm list
 * never disagree). Values not tied to a plant document are marked ESTIMATE and follow typical
 * Ontario CAS practice (MECP Design Guidelines for Sewage Works, 2008).
 */
import type { PlantRuntime } from '../data/plantTypes';
import type { SimState, Setpoints } from './processModel';

export const MECP_DESIGN_GUIDELINES = 'https://www.ontario.ca/document/design-guidelines-sewage-works-0';

export type TagBasis = 'MODEL' | 'ECA' | 'ESTIMATE';
export type TagState = 'LL' | 'L' | 'NORM' | 'H' | 'HH' | 'OFF';

export interface TagDef {
  tag: string;
  /** Process-area unit id (matches plantScene unit ids for hover lookups). */
  unitId: string;
  desc: string;
  eu: string;
  range: [number, number];
  ll?: number;
  l?: number;
  h?: number;
  hh?: number;
  digits: number;
  basis: TagBasis;
  note?: string;
  pv: (s: SimState) => number | null;
  sp?: (sp: Setpoints) => number | null;
}

const PLANT_CODE: Record<string, string> = {
  'farm-septic': 'FARM',
  'st-jacobs': 'STJ',
  waterloo: 'WAT',
  kitchener: 'KIT',
  galt: 'GLT',
  'hamilton-woodward': 'WWD',
  'toronto-ashbridges-bay': 'ABTP',
};

export function plantCode(p: PlantRuntime): string {
  return PLANT_CODE[p.id] ?? p.id.slice(0, 4).toUpperCase();
}

/** Human names for plants.json process steps (train order = the plant's public description). */
const STEP_NAMES: Record<string, string> = {
  septic_tank: 'Septic tank',
  effluent_filter: 'Effluent filter',
  leaching_bed: 'Leaching bed',
  screening: 'Screening',
  grit: 'Grit removal',
  primary: 'Primary clarifiers',
  activated_sludge: 'Activated sludge',
  oxidation_ditch: 'Oxidation ditch',
  clarifier: 'Secondary clarifiers',
  tertiary_filtration: 'Tertiary filters',
  chemical_p_removal: 'Chemical P removal',
  uv: 'UV disinfection',
  chlorine_disinfection: 'Chlorination / dechlor',
  was_thickening: 'WAS thickening',
  anaerobic_digestion: 'Anaerobic digestion',
  aerated_sludge_holding: 'Aerated sludge holding',
  centrifuge_dewatering: 'Centrifuge dewatering',
  offsite_dewatering: 'Off-site dewatering',
  chp: 'CHP (biogas)',
  rng_upgrading: 'RNG upgrading',
  pelletization: 'Biosolids pelletizing',
};
const SOLIDS_STEPS = new Set([
  'was_thickening',
  'anaerobic_digestion',
  'aerated_sludge_holding',
  'centrifuge_dewatering',
  'offsite_dewatering',
  'chp',
  'rng_upgrading',
  'pelletization',
]);

/** Liquid and solids trains in the order the plant's public description lists them. */
export function processTrain(p: PlantRuntime): { liquid: string[]; solids: string[] } {
  const steps = p.research.process ?? [];
  const liquid = steps.filter((s) => !SOLIDS_STEPS.has(s)).map((s) => STEP_NAMES[s] ?? s);
  const solids = steps.filter((s) => SOLIDS_STEPS.has(s)).map((s) => STEP_NAMES[s] ?? s);
  return { liquid, solids };
}

/** Nominal UV dose (mJ/cm²) at average-day flow, from plants.json scadaDefaults (often ESTIMATE). */
function nominalUvDose(p: PlantRuntime): number {
  const d = (p.research as unknown as { scadaDefaults?: { uvDose?: number } }).scadaDefaults?.uvDose;
  return d && d > 0 ? d : 35;
}

export function tagsForPlant(p: PlantRuntime): TagDef[] {
  const c = plantCode(p);
  const peak = p.peakCapacityMld || p.designCapacityMld * 2.5;
  if (p.isSeptic) {
    return [
      { tag: `${c}-LIT-101`, unitId: 'septic_tank', desc: 'Septic tank level', eu: '%', range: [0, 100], h: 80, hh: 88, digits: 0, basis: 'MODEL', pv: (s) => s.tankLevelPct },
      { tag: `${c}-LSHH-102`, unitId: 'septic_tank', desc: 'High-level float switch', eu: '0/1', range: [0, 1], hh: 1, digits: 0, basis: 'MODEL', pv: (s) => (s.pumpAlarmFloat ? 1 : 0) },
      { tag: `${c}-FQ-201`, unitId: 'leaching_bed', desc: 'Flow to leaching bed', eu: 'm³/d', range: [0, p.peakCapacityMld * 1000 * 1.5], h: p.designCapacityMld * 1000, digits: 2, basis: 'MODEL', pv: (s) => s.effluentFlowMld * 1000 },
    ];
  }
  const ditch = p.hasOxidationDitch;
  const bioUnit = ditch ? 'primary' : 'aeration';
  const tags: TagDef[] = [
    { tag: `${c}-FIT-101`, unitId: 'headworks', desc: 'Raw influent flow', eu: 'MLD', range: [0, Math.ceil(peak * 1.2)], h: p.designCapacityMld, hh: peak, digits: 1, basis: 'ECA', note: 'H = rated ADF, HH = peak capacity (plants.json / ECA).', pv: (s) => s.influentFlowMld },
    { tag: `${c}-LIT-102`, unitId: 'headworks', desc: 'Influent wet-well level', eu: '%', range: [0, 100], l: 15, h: 82, hh: 90, digits: 0, basis: 'MODEL', pv: (s) => s.wetWellLevelPct, sp: (sp) => sp.pumpSpeedPct },
  ];
  if (p.hasPrimary) {
    tags.push({ tag: `${c}-LIT-201`, unitId: 'primary', desc: 'Primary clarifier level', eu: '%', range: [0, 100], hh: 90, digits: 0, basis: 'MODEL', pv: (s) => s.primaryLevelPct });
  }
  tags.push(
    { tag: `${c}-AIT-301`, unitId: bioUnit, desc: ditch ? 'Ditch dissolved oxygen' : 'Aeration DO (control zone)', eu: 'mg/L', range: [0, 8], ll: 1.0, l: 1.5, h: 4.5, digits: 2, basis: 'MODEL', note: 'L/LL per model alarms; H 4.5 mg/L = over-aeration (ESTIMATE).', pv: (s) => s.doMgL, sp: (sp) => sp.doTarget },
    { tag: `${c}-AIT-302`, unitId: bioUnit, desc: 'Mixed liquor suspended solids', eu: 'mg/L', range: [0, 8000], l: 1500, h: 4000, digits: 0, basis: 'MODEL', note: 'L 1,500 mg/L ESTIMATE (washout risk).', pv: (s) => s.mlssMgL },
    { tag: `${c}-JIT-303`, unitId: bioUnit, desc: ditch ? 'Rotor / aerator power' : 'Blower power', eu: 'kW', range: [0, Math.ceil(p.blowerRatedKw * 1.1)], h: p.blowerRatedKw * 0.95, digits: 0, basis: 'ESTIMATE', note: 'H = 95% of rated blower kW (plants.json, often ESTIMATE).', pv: (s) => s.blowerKw, sp: (sp) => sp.blowerPct },
    { tag: `${c}-LIT-304`, unitId: bioUnit, desc: ditch ? 'Ditch level' : 'Aeration tank level', eu: '%', range: [0, 100], hh: 92, digits: 0, basis: 'MODEL', pv: (s) => s.aerationLevelPct },
    { tag: `${c}-LIT-401`, unitId: 'secondary', desc: 'Secondary clarifier level', eu: '%', range: [0, 100], hh: 90, digits: 0, basis: 'MODEL', pv: (s) => s.secondaryLevelPct },
    { tag: `${c}-FIT-402`, unitId: 'secondary', desc: 'RAS flow (75% of Q)', eu: 'MLD', range: [0, Math.ceil(peak)], digits: 1, basis: 'ESTIMATE', note: 'Derived: RAS ratio 0.75 (typical 0.5–1.0 Q).', pv: (s) => s.influentFlowMld * 0.75 },
  );
  if (p.disinfectionType === 'uv') {
    const dose = nominalUvDose(p);
    tags.push({
      tag: `${c}-AIT-601`,
      unitId: 'disinfection',
      desc: 'UV delivered dose',
      eu: 'mJ/cm²',
      range: [0, Math.ceil(dose * 2)],
      ll: 20,
      l: 30,
      digits: 0,
      basis: 'ESTIMATE',
      note: 'Derived: nominal dose × ADF / Q (dose falls as flow rises); 0 when banks are off. Limits ESTIMATE (E. coli ≤ 200 cfu/100 mL design).',
      pv: (s) => (s.disinfectionStatus === 'ONLINE' ? dose * Math.min(1.6, p.avgDayFlowMld / Math.max(0.05, s.effluentFlowMld)) : 0),
    });
  } else if (p.disinfectionType === 'chlorine') {
    tags.push(
      { tag: `${c}-AIT-601`, unitId: 'disinfection', desc: 'Chlorine residual (contact tank)', eu: 'mg/L', range: [0, 3], ll: 0.2, l: 0.5, h: 2.0, digits: 2, basis: 'ESTIMATE', note: 'Seasonal (May–Oct) NaOCl; limits ESTIMATE.', pv: (s) => (s.disinfectionStatus === 'ONLINE' ? Math.min(1.6, p.avgDayFlowMld / Math.max(0.05, s.effluentFlowMld)) : 0) },
      { tag: `${c}-AIT-602`, unitId: 'disinfection', desc: 'Total residual chlorine after SBS dechlor', eu: 'mg/L', range: [0, 0.1], h: 0.02, digits: 3, basis: 'ESTIMATE', note: 'H 0.02 mg/L TRC (typical Ontario ECA effluent limit).', pv: (s) => (s.disinfectionStatus === 'ONLINE' ? 0.008 : 0) },
    );
  }
  tags.push({ tag: `${c}-FIT-901`, unitId: 'outfall', desc: 'Final effluent flow', eu: 'MLD', range: [0, Math.ceil(peak * 1.2)], digits: 1, basis: 'MODEL', pv: (s) => s.effluentFlowMld });
  if (p.ecaTpMgL != null) {
    tags.push({ tag: `${c}-AIT-902`, unitId: 'outfall', desc: 'Effluent total phosphorus', eu: 'mg/L', range: [0, Math.max(2, p.ecaTpMgL * 4)], h: p.ecaTpMgL, hh: p.ecaTpMgL * 1.15, digits: 2, basis: 'ECA', note: 'H = ECA objective, HH = model alarm (ECA × 1.15).', pv: (s) => s.effluentTpMgL, sp: (sp) => sp.chemicalDosePct });
  }
  tags.push({ tag: `${c}-AI-903`, unitId: 'outfall', desc: 'Effluent cBOD5 (lab composite)', eu: 'mg/L', range: [0, 50], h: 25, digits: 1, basis: 'ESTIMATE', note: 'H 25 mg/L = federal WSER cBOD5 limit.', pv: (s) => s.effluentBodMgL });
  return tags;
}

export function tagState(t: TagDef, pv: number | null): TagState {
  if (pv == null) return 'OFF';
  if (t.ll != null && pv < t.ll) return 'LL';
  if (t.l != null && pv < t.l) return 'L';
  if (t.hh != null && pv >= t.hh) return 'HH';
  if (t.h != null && pv > t.h) return 'H';
  return 'NORM';
}

export function fmtLimit(v: number | undefined, digits: number): string {
  return v == null ? '—' : v.toFixed(Math.min(digits, 2));
}
