import plantsData from '../data/plants.json';
import { menuPlants, formatFlow, type PlantRuntime, type PlantsFile } from '../data/plantTypes';
import { audio } from '../audio/AudioEngine';

export interface MenuSelection {
  plant: PlantRuntime;
}

export type StartCb = (sel: MenuSelection) => void | Promise<void>;

export function getPlants(): PlantRuntime[] {
  return menuPlants((plantsData as unknown as PlantsFile).plants);
}

export function mountMenu(root: HTMLElement, onStart: StartCb): { show: () => void; hide: () => void } {
  const plants = getPlants();

  root.innerHTML = `
    <div class="panel menu-panel">
      <h1>WWTP-NA <span class="ver">v0.1</span></h1>
      <p class="sub">North American wastewater operator-training sim · Ontario corridor tribute</p>
      <p class="disclaimer">Training simulator — not affiliated with Region of Waterloo, City of Hamilton, City of Toronto, or OCWA. Capacities from public reports where cited; septic flows estimated from OBC/MOE guidance.</p>
      <label>Plant
        <select id="plantSize">
          ${plants
            .map((p) => {
              const cap =
                p.flowUnit === 'm3/d'
                  ? `~${(p.designCapacityMld * 1000).toFixed(1)} m³/d`
                  : `~${p.designCapacityMld} MLD`;
              return `<option value="${p.id}">${p.sizeLabel} — ${p.name} (${cap})</option>`;
            })
            .join('')}
        </select>
      </label>
      <div id="plantBlurb" class="plant-blurb"></div>
      <button id="startBtn" type="button">Enter plant</button>
      <div class="help">
        <strong>Controls</strong>
        <ul>
          <li>WASD / arrows — move · mouse drag — look · wheel — zoom</li>
          <li>C — toggle orbit / walk · click unit — select</li>
          <li>Esc — return to menu</li>
        </ul>
      </div>
    </div>
  `;

  const sel = root.querySelector('#plantSize') as HTMLSelectElement;
  const blurb = root.querySelector('#plantBlurb') as HTMLElement;
  const btn = root.querySelector('#startBtn') as HTMLButtonElement;

  function refreshBlurb(): void {
    const p = plants.find((x) => x.id === sel.value)!;
    const avgDisp = formatFlow(p.avgDayFlowMld, p);
    const desDisp =
      p.flowUnit === 'm3/d'
        ? `${(p.designCapacityMld * 1000).toFixed(1)} m³/d design`
        : `${p.designCapacityMld} MLD design`;
    blurb.innerHTML = `<strong>${p.name}</strong> · ${p.municipality}<br/>
      ${desDisp} · typical flow ~${avgDisp}<br/>
      <span class="muted">${p.notes}</span>`;
  }
  sel.addEventListener('change', () => {
    audio.uiClick();
    refreshBlurb();
  });
  refreshBlurb();

  btn.addEventListener('click', () => {
    const plant = plants.find((x) => x.id === sel.value)!;
    void onStart({ plant });
  });

  return {
    show: () => root.classList.remove('hidden'),
    hide: () => root.classList.add('hidden'),
  };
}
