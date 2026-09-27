/**
 * First-run / reopenable acronym tutorial (Ontario ops flavoured).
 */
import { audio } from '../audio/AudioEngine';

const STORAGE_KEY = 'wwtp-na-tutorial-seen-v1';

export interface AcronymEntry {
  acronym: string;
  expansion: string;
  blurb: string;
  /** Typical training band (units in blurb / bandUnit). */
  min?: number;
  max?: number;
  target?: number;
  bandUnit?: string;
  /** How changing this tag moves plant operation. */
  opsEffect?: string;
  /** Colour band: ok / warn / alarm / info */
  band?: 'ok' | 'warn' | 'alarm' | 'info';
}

export const ACRONYMS: AcronymEntry[] = [
  {
    acronym: 'WWTP',
    expansion: 'Wastewater Treatment Plant',
    blurb: 'The municipal plant that treats sewage before discharge to a river or lake.',
    band: 'info',
    opsEffect: 'Site selection in the menu picks capacity, train, and ECA objectives for the shift.',
  },
  {
    acronym: 'SCADA',
    expansion: 'Supervisory Control and Data Acquisition',
    blurb: 'The operator HMI — tags, setpoints, and alarms you drive in this sim.',
    band: 'info',
    opsEffect: 'Autopilot ON auto-trims setpoints to keep NORMAL / meet ECA; OFF is full manual.',
  },
  {
    acronym: 'MLD',
    expansion: 'Megalitres per Day',
    blurb: 'Flow unit: 1 MLD = 1,000 m³/d. Common on Ontario municipal ECAs.',
    band: 'info',
    opsEffect: 'Higher influent MLD raises wet-well level and capacity util — pumps must keep up.',
  },
  {
    acronym: 'ADF',
    expansion: 'Average Day Flow',
    blurb: 'Rated / typical daily flow the plant is designed around.',
    band: 'info',
  },
  {
    acronym: 'ECA',
    expansion: 'Environmental Compliance Approval',
    blurb: 'MECP approval that sets effluent objectives/limits (BOD, TSS, TP, TAN, etc.).',
    band: 'info',
    opsEffect: 'Autopilot and chem dose chase ECA TP; exceeding shows as TP-out alarms.',
  },
  {
    acronym: 'BOD',
    expansion: 'Biochemical Oxygen Demand',
    blurb: 'How much oxygen bugs need to eat the organics — high BOD = “hungry” sewage.',
    min: 5,
    max: 25,
    target: 15,
    bandUnit: 'mg/L effluent (typical obj.)',
    band: 'ok',
    opsEffect: 'Low DO or short aeration raises effluent BOD; healthy blower/DO keeps BOD down.',
  },
  {
    acronym: 'TSS',
    expansion: 'Total Suspended Solids',
    blurb: 'Particles that settle or cloud the water — clarifiers and filters knock this down.',
    min: 5,
    max: 25,
    target: 15,
    bandUnit: 'mg/L effluent (typical obj.)',
    band: 'ok',
    opsEffect: 'Clarifier overload or high MLSS carryover spikes TSS; tertiary filters polish further.',
  },
  {
    acronym: 'TP',
    expansion: 'Total Phosphorus',
    blurb: 'Nutrient that drives algae growth; Ontario plants often dose alum or ferric.',
    min: 0.1,
    max: 1.0,
    target: 0.5,
    bandUnit: 'mg/L (site ECA varies)',
    band: 'warn',
    opsEffect: 'Raise chem dose when TP-out > ECA; Autopilot trims dose to the ECA band.',
  },
  {
    acronym: 'TAN / NH₃',
    expansion: 'Total Ammonia Nitrogen / Ammonia',
    blurb: 'Nitrogen form toxic to fish; nitrification in aeration (with enough DO) converts it.',
    min: 0.5,
    max: 5,
    target: 2,
    bandUnit: 'mg/L (illustrative)',
    band: 'warn',
    opsEffect: 'Keep DO ≥ ~1.5–2.0 mg/L so nitrifiers work; chronic low DO → TAN breakthrough.',
  },
  {
    acronym: 'DO',
    expansion: 'Dissolved Oxygen',
    blurb: 'Oxygen in the aeration tank. Too low → bugs slow down / odours; too high wastes blower kWh.',
    min: 1.5,
    max: 3.0,
    target: 2.0,
    bandUnit: 'mg/L',
    band: 'ok',
    opsEffect: 'Blower % tracks DO target. <1.0 mg/L alarms; Autopilot lifts blowers to hold target.',
  },
  {
    acronym: 'MLSS',
    expansion: 'Mixed Liquor Suspended Solids',
    blurb: 'Bugs + solids concentration in aeration — the “inventory” of your activated sludge.',
    min: 2000,
    max: 4000,
    target: 3000,
    bandUnit: 'mg/L',
    band: 'ok',
    opsEffect: 'High MLSS raises OUR (more air demand) and clarifier solids load; WAS lowers inventory.',
  },
  {
    acronym: 'CAS',
    expansion: 'Conventional Activated Sludge',
    blurb: 'Classic aeration + secondary clarifier train (vs oxidation ditch or MBR).',
    band: 'info',
  },
  {
    acronym: 'MBR',
    expansion: 'Membrane Bioreactor',
    blurb: 'Activated sludge with membranes instead of clarifiers for solids separation.',
    band: 'info',
  },
  {
    acronym: 'RAS / WAS',
    expansion: 'Return / Waste Activated sludge',
    blurb: 'RAS recycles bugs to aeration; WAS wastes excess solids to digestion / thickening.',
    band: 'info',
    opsEffect: 'More WAS → lower MLSS over time; RAS keeps clarifier sludge blanket under control.',
  },
  {
    acronym: 'UV',
    expansion: 'Ultraviolet disinfection',
    blurb: 'Lamps knock down pathogens in the final effluent — no chlorine residual.',
    band: 'ok',
    opsEffect: 'Banks must stay ONLINE for ECA; Autopilot forces disinfection on when enabled.',
  },
  {
    acronym: 'OTR / OUR',
    expansion: 'Oxygen Transfer / Uptake Rate',
    blurb: 'OTR is what blowers deliver; OUR is what the bugs consume. Balance them for stable DO.',
    band: 'info',
    opsEffect: 'If OUR > OTR, DO falls — raise blower % or cut load; Autopilot balances this loop.',
  },
];

export function hasSeenTutorial(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markTutorialSeen(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    /* ignore */
  }
}

function bandHtml(a: AcronymEntry): string {
  if (a.min == null && a.max == null && a.target == null) return '';
  const unit = a.bandUnit ? ` ${a.bandUnit}` : '';
  const parts: string[] = [];
  if (a.min != null) parts.push(`min ${a.min}`);
  if (a.target != null) parts.push(`target ${a.target}`);
  if (a.max != null) parts.push(`max ${a.max}`);
  return `<div class="tutorial-band band-${a.band || 'info'}"><span class="tutorial-band-label">Band</span> ${parts.join(' · ')}${unit}</div>`;
}

export function openTutorial(opts?: { onClose?: () => void; firstRun?: boolean }): HTMLElement {
  const existing = document.getElementById('tutorialModal');
  existing?.remove();

  const modal = document.createElement('div');
  modal.id = 'tutorialModal';
  modal.className = 'tutorial-modal';
  modal.innerHTML = `
    <div class="tutorial-panel" role="dialog" aria-labelledby="tutorialTitle">
      <div class="tutorial-head">
        <h2 id="tutorialTitle">Operator acronyms <span class="ver">tutorial</span></h2>
        <button type="button" class="tutorial-x" id="tutorialClose" aria-label="Close">×</button>
      </div>
      <p class="tutorial-lead">
        ${opts?.firstRun ? 'Quick first-run briefing — ' : ''}
        Plain-language Ontario ops glossary for tags you’ll see in SCADA and on the site.
        Colour bands show typical training ranges; <em>ops effect</em> says how the tag moves the plant.
        Skippable anytime; reopen from the menu <strong>Tutorial</strong> button.
      </p>
      <div class="tutorial-list">
        ${ACRONYMS.map(
          (a) => `
          <div class="tutorial-row band-${a.band || 'info'}">
            <div class="tutorial-acro">${a.acronym}</div>
            <div class="tutorial-body">
              <div class="tutorial-exp">${a.expansion}</div>
              <div class="tutorial-blurb">${a.blurb}</div>
              ${bandHtml(a)}
              ${a.opsEffect ? `<div class="tutorial-ops"><strong>Ops:</strong> ${a.opsEffect}</div>` : ''}
            </div>
          </div>`,
        ).join('')}
      </div>
      <div class="tutorial-actions">
        <button type="button" id="tutorialGotIt" class="tutorial-primary">Got it — run the plant</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => {
    markTutorialSeen();
    audio.uiClick();
    modal.remove();
    opts?.onClose?.();
  };
  modal.querySelector('#tutorialClose')?.addEventListener('click', close);
  modal.querySelector('#tutorialGotIt')?.addEventListener('click', close);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });

  return modal;
}

/** Show first-run tutorial once; returns true if shown. */
export function maybeShowFirstRunTutorial(): boolean {
  if (hasSeenTutorial()) return false;
  openTutorial({ firstRun: true });
  return true;
}
