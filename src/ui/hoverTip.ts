/**
 * Floating hover tooltip for process units (+ OSM buildings) with SCADA shortcuts
 * and live SimState tags (v0.3.9).
 */
import { audio } from '../audio/AudioEngine';
import type { SimState } from '../sim/processModel';
import type { PlantRuntime } from '../data/plantTypes';
import { formatFlow } from '../data/plantTypes';

export interface UnitExplainer {
  name: string;
  blurb: string;
  /** SCADA control element ids to highlight / scroll into view */
  scadaControls: string[];
}

/** Process-unit explainers keyed by unit id from plantScene. */
export const UNIT_EXPLAINERS: Record<string, UnitExplainer> = {
  headworks: {
    name: 'Headworks',
    blurb: 'Screens and grit removal — first stop for rags, gravel, and junk before the process train.',
    scadaControls: ['spPump'],
  },
  primary: {
    name: 'Primary clarifiers / Oxidation ditch',
    blurb: 'Settles settleable solids (primaries) or loops mixed liquor with rotors (oxidation ditch) for BOD/TAN removal.',
    scadaControls: ['spBlower', 'spDo'],
  },
  aeration: {
    name: 'Aeration basins',
    blurb: 'Where activated-sludge bugs get Dissolved Oxygen (DO) from blowers — BOD oxidation and nitrification live here.',
    scadaControls: ['spBlower', 'spDo'],
  },
  secondary: {
    name: 'Secondary clarifiers',
    blurb: 'Settle Mixed Liquor Suspended Solids (MLSS); clear supernatant goes downstream, sludge returns or wastes.',
    scadaControls: ['spChem'],
  },
  disinfection: {
    name: 'Disinfection (UV / chlorine)',
    blurb: 'Final pathogen kill — UV lamps or chlorine/NaOCl contact before the outfall. Required for ECA compliance.',
    scadaControls: ['spDisinfect'],
  },
  solids: {
    name: 'Solids handling',
    blurb: 'Thickening, digestion, dewatering — where Waste Activated Sludge (WAS) becomes biosolids.',
    scadaControls: [],
  },
  tertiary: {
    name: 'Tertiary filters',
    blurb: 'Polishing filters (disk, deep-bed, cloth) that knock down residual TSS and help meet tight TP/TSS objectives.',
    scadaControls: ['spChem'],
  },
  digesters: {
    name: 'Anaerobic digesters',
    blurb: 'Stabilize sludge without oxygen; often make biogas for CHP / heating.',
    scadaControls: [],
  },
  outfall: {
    name: 'Outfall',
    blurb: 'Treated effluent discharge to the receiver. Watch ECA limits and disinfection status upstream.',
    scadaControls: ['spDisinfect'],
  },
  house: {
    name: 'Farmhouse',
    blurb: 'Source of domestic sewage to the Class 4 septic tank (Ontario Building Code Part 8).',
    scadaControls: ['spPump'],
  },
  septic_tank: {
    name: 'Septic tank',
    blurb: 'Outdoor Class 4 tank (not under a roof) — settles solids and anaerobic pretreatment before the leaching bed. Watch tank level and float alarm.',
    scadaControls: ['spPump'],
  },
  distribution: {
    name: 'Distribution box',
    blurb: 'Splits gravity (or optional pumped) effluent into leaching-bed laterals. Most Class 4 systems have no pump house — outlet openness in SCADA is the bed feed.',
    scadaControls: ['spPump'],
  },
  leaching_bed: {
    name: 'Leaching bed',
    blurb: 'Absorption trenches out in the open yard (not under a building) — final soil treatment to groundwater. No surface outfall on Class 4.',
    scadaControls: ['spPump'],
  },
  osm_wwtp: {
    name: 'WWTP footprint (OSM)',
    blurb: 'OpenStreetMap wastewater_plant footprint near this site — process units in the sim are a playable schematic aligned to it.',
    scadaControls: [],
  },
};

export function explainerFor(unitId: string, label?: string): UnitExplainer {
  if (UNIT_EXPLAINERS[unitId]) return UNIT_EXPLAINERS[unitId];
  if (unitId.startsWith('osm_')) {
    return {
      name: label || 'Nearby building (OSM)',
      blurb: 'Mapped building from OpenStreetMap surroundings — context only, not a process control point.',
      scadaControls: [],
    };
  }
  return {
    name: label || unitId,
    blurb: 'Process unit on the training site.',
    scadaControls: [],
  };
}

export type FocusScadaFn = (controlIds: string[]) => void;

export class HoverTip {
  readonly el: HTMLElement;
  private onFocusScada: FocusScadaFn;
  private currentIds: string[] = [];
  private currentUnitId: string | null = null;
  private currentLabel = '';
  private lastState: SimState | null = null;
  private plant: PlantRuntime | null = null;
  private lastClientX = 0;
  private lastClientY = 0;

  constructor(host: HTMLElement, onFocusScada: FocusScadaFn, plant?: PlantRuntime) {
    this.onFocusScada = onFocusScada;
    this.plant = plant ?? null;
    this.el = document.createElement('div');
    this.el.className = 'hover-tip hidden';
    this.el.setAttribute('role', 'tooltip');
    host.appendChild(this.el);
    this.el.addEventListener('pointerleave', (e) => {
      const rt = e.relatedTarget as Node | null;
      const canvas = document.getElementById('c');
      if (canvas && rt && (rt === canvas || canvas.contains(rt))) return;
      this.hide();
    });
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement | null;
      if (!t || t.id !== 'hoverOpenCtrl') return;
      e.stopPropagation();
      e.preventDefault();
      audio.uiClick();
      this.onFocusScada(this.currentIds);
    });
  }

  destroy(): void {
    this.el.remove();
  }

  /** Feed live sim tags so the tip stays current while hovered. */
  setState(state: SimState): void {
    this.lastState = state;
    if (this.currentUnitId && !this.el.classList.contains('hidden')) {
      this.renderBody(this.currentUnitId, this.currentLabel);
      this.position(this.lastClientX, this.lastClientY);
    }
  }

  hide(): void {
    this.el.classList.add('hidden');
    this.el.innerHTML = '';
    this.currentUnitId = null;
    this.currentIds = [];
  }

  show(unitId: string, label: string, clientX: number, clientY: number): void {
    this.lastClientX = clientX;
    this.lastClientY = clientY;
    const switched = unitId !== this.currentUnitId;
    if (switched) {
      const ex = explainerFor(unitId, label);
      this.currentUnitId = unitId;
      this.currentLabel = label;
      this.currentIds = ex.scadaControls;
      this.renderBody(unitId, label);
    } else if (this.lastState) {
      this.renderBody(unitId, label);
    }
    this.el.classList.remove('hidden');
    this.position(clientX, clientY);
  }

  position(clientX: number, clientY: number): void {
    const pad = 14;
    const rect = this.el.getBoundingClientRect();
    let left = clientX + pad;
    let top = clientY + pad;
    if (left + rect.width > window.innerWidth - 8) left = clientX - rect.width - pad;
    if (top + rect.height > window.innerHeight - 8) top = clientY - rect.height - pad;
    this.el.style.left = `${Math.max(8, left)}px`;
    this.el.style.top = `${Math.max(8, top)}px`;
  }

  private renderBody(unitId: string, label: string): void {
    const ex = explainerFor(unitId, label);
    const live = this.liveLines(unitId);
    const btn =
      ex.scadaControls.length > 0
        ? `<button type="button" class="hover-open" id="hoverOpenCtrl">Open controls</button>`
        : '';
    const liveHtml = live
      ? `<div class="hover-live">${live.map((l) => `<div>${escapeHtml(l)}</div>`).join('')}</div>`
      : '';
    this.el.innerHTML = `
      <div class="hover-title">${escapeHtml(ex.name)}</div>
      <div class="hover-blurb">${escapeHtml(ex.blurb)}</div>
      ${liveHtml}
      ${btn}
    `;
  }

  private liveLines(unitId: string): string[] {
    const state = this.lastState;
    const p = this.plant;
    if (!state || !p) return [];
    const lines: string[] = [];
    if (p.isSeptic) {
      if (unitId === 'septic_tank' || unitId === 'house' || unitId === 'distribution' || unitId === 'leaching_bed') {
        lines.push(`Tank ${state.tankLevelPct.toFixed(0)}% · to bed ${formatFlow(state.effluentFlowMld, p, 2)}`);
        lines.push(`Float ${state.pumpAlarmFloat ? 'ALARM' : 'OK'} · ${state.statusLine}`);
      }
      return lines;
    }
    lines.push(`Q in ${formatFlow(state.influentFlowMld, p, 1)} · out ${formatFlow(state.effluentFlowMld, p, 1)}`);
    if (unitId === 'aeration' || (unitId === 'primary' && p.hasOxidationDitch)) {
      lines.push(`DO ${state.doMgL.toFixed(2)} mg/L`);
    }
    if (unitId === 'secondary') lines.push(`MLSS ${state.mlssMgL.toFixed(0)} mg/L`);
    if (unitId === 'headworks') lines.push(`Wet-well ${state.wetWellLevelPct.toFixed(0)}%`);
    if (unitId === 'disinfection' || unitId === 'outfall') lines.push(`Disinfect ${state.disinfectionStatus}`);
    if (unitId === 'primary' && !p.hasOxidationDitch) lines.push(`Primary settle · ${state.statusLine}`);
    else lines.push(state.statusLine);
    return lines;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
