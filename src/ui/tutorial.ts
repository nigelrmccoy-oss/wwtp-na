/**
 * First-run / reopenable acronym tutorial (Ontario ops flavoured).
 */
import { audio } from '../audio/AudioEngine';

const STORAGE_KEY = 'wwtp-na-tutorial-seen-v1';

export interface AcronymEntry {
  acronym: string;
  expansion: string;
  blurb: string;
}

export const ACRONYMS: AcronymEntry[] = [
  { acronym: 'WWTP', expansion: 'Wastewater Treatment Plant', blurb: 'The municipal plant that treats sewage before discharge to a river or lake.' },
  { acronym: 'SCADA', expansion: 'Supervisory Control and Data Acquisition', blurb: 'The operator HMI — tags, setpoints, and alarms you drive in this sim.' },
  { acronym: 'MLD', expansion: 'Megalitres per Day', blurb: 'Flow unit: 1 MLD = 1,000 m³/d. Common on Ontario municipal ECAs.' },
  { acronym: 'ADF', expansion: 'Average Day Flow', blurb: 'Rated / typical daily flow the plant is designed around.' },
  { acronym: 'ECA', expansion: 'Environmental Compliance Approval', blurb: 'MECP approval that sets effluent objectives/limits (BOD, TSS, TP, TAN, etc.).' },
  { acronym: 'BOD', expansion: 'Biochemical Oxygen Demand', blurb: 'How much oxygen bugs need to eat the organics — high BOD = “hungry” sewage.' },
  { acronym: 'TSS', expansion: 'Total Suspended Solids', blurb: 'Particles that settle or cloud the water — clarifiers and filters knock this down.' },
  { acronym: 'TP', expansion: 'Total Phosphorus', blurb: 'Nutrient that drives algae growth; Ontario plants often dose alum or ferric.' },
  { acronym: 'TAN / NH₃', expansion: 'Total Ammonia Nitrogen / Ammonia', blurb: 'Nitrogen form toxic to fish; nitrification in aeration (with enough DO) converts it.' },
  { acronym: 'DO', expansion: 'Dissolved Oxygen', blurb: 'Oxygen in the aeration tank. Too low → bugs slow down / odours; too high wastes blower kWh.' },
  { acronym: 'MLSS', expansion: 'Mixed Liquor Suspended Solids', blurb: 'Bugs + solids concentration in aeration — the “inventory” of your activated sludge.' },
  { acronym: 'CAS', expansion: 'Conventional Activated Sludge', blurb: 'Classic aeration + secondary clarifier train (vs oxidation ditch or MBR).' },
  { acronym: 'MBR', expansion: 'Membrane Bioreactor', blurb: 'Activated sludge with membranes instead of clarifiers for solids separation.' },
  { acronym: 'RAS / WAS', expansion: 'Return / Waste Activated sludge', blurb: 'RAS recycles bugs to aeration; WAS wastes excess solids to digestion / thickening.' },
  { acronym: 'UV', expansion: 'Ultraviolet disinfection', blurb: 'Lamps knock down pathogens in the final effluent — no chlorine residual.' },
  { acronym: 'OTR / OUR', expansion: 'Oxygen Transfer / Uptake Rate', blurb: 'OTR is what blowers deliver; OUR is what the bugs consume. Balance them for stable DO.' },
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
        Skippable anytime; reopen from the menu <strong>Tutorial</strong> button.
      </p>
      <div class="tutorial-list">
        ${ACRONYMS.map(
          (a) => `
          <div class="tutorial-row">
            <div class="tutorial-acro">${a.acronym}</div>
            <div class="tutorial-body">
              <div class="tutorial-exp">${a.expansion}</div>
              <div class="tutorial-blurb">${a.blurb}</div>
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
