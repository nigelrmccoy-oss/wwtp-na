/**
 * Floating hover tooltip for process units (+ OSM buildings) with SCADA shortcuts.
 */
import { audio } from '../audio/AudioEngine';

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
  house: {
    name: 'Farmhouse',
    blurb: 'Source of domestic sewage to the Class 4 septic tank (Ontario Building Code Part 8).',
    scadaControls: ['spPump'],
  },
  septic_tank: {
    name: 'Septic tank',
    blurb: 'Settles solids and provides anaerobic pretreatment before the leaching bed. Watch tank level and float alarm.',
    scadaControls: ['spPump'],
  },
  pump: {
    name: 'Effluent pump',
    blurb: 'Moves clarified effluent to the leaching bed when gravity isn’t enough — raise speed to clear a high float.',
    scadaControls: ['spPump'],
  },
  leaching_bed: {
    name: 'Leaching bed',
    blurb: 'Soil absorption trenches / filter bed — final treatment to groundwater. No surface outfall on Class 4.',
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

  constructor(host: HTMLElement, onFocusScada: FocusScadaFn) {
    this.onFocusScada = onFocusScada;
    this.el = document.createElement('div');
    this.el.className = 'hover-tip hidden';
    this.el.setAttribute('role', 'tooltip');
    host.appendChild(this.el);
    // Leaving the tip card clears it (canvas leave is ignored when entering tip)
    this.el.addEventListener('pointerleave', (e) => {
      const rt = e.relatedTarget as Node | null;
      const canvas = document.getElementById('c');
      if (canvas && rt && (rt === canvas || canvas.contains(rt))) return;
      this.hide();
    });
  }

  destroy(): void {
    this.el.remove();
  }

  hide(): void {
    this.el.classList.add('hidden');
    this.el.innerHTML = '';
    this.currentUnitId = null;
    this.currentIds = [];
  }

  show(unitId: string, label: string, clientX: number, clientY: number): void {
    if (unitId !== this.currentUnitId) {
      const ex = explainerFor(unitId, label);
      this.currentUnitId = unitId;
      this.currentIds = ex.scadaControls;
      const btn =
        ex.scadaControls.length > 0
          ? `<button type="button" class="hover-open" id="hoverOpenCtrl">Open controls</button>`
          : '';
      this.el.innerHTML = `
      <div class="hover-title">${ex.name}</div>
      <div class="hover-blurb">${ex.blurb}</div>
      ${btn}
    `;
      const b = this.el.querySelector('#hoverOpenCtrl');
      b?.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        audio.uiClick();
        this.onFocusScada(this.currentIds);
      });
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
}
