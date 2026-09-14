import type { ProcessModel, SimState, Setpoints } from '../sim/processModel';
import { formatFlow } from '../data/plantTypes';
import { audio } from '../audio/AudioEngine';

export type SimSpeed = 1 | 4 | 12;

export class ScadaOverlay {
  readonly el: HTMLElement;
  private model: ProcessModel;
  private selectedUnitLabel = '—';
  private septic: boolean;
  private simSpeed: SimSpeed;
  private onSimSpeedChange: (s: SimSpeed) => void;

  constructor(
    host: HTMLElement,
    model: ProcessModel,
    opts?: { simSpeed?: SimSpeed; onSimSpeedChange?: (s: SimSpeed) => void },
  ) {
    this.model = model;
    this.septic = model.plant.isSeptic;
    this.simSpeed = opts?.simSpeed ?? 4;
    this.onSimSpeedChange = opts?.onSimSpeedChange ?? (() => {});
    this.el = document.createElement('div');
    this.el.id = 'scada';
    this.el.className = 'scada-window';
    host.appendChild(this.el);
    this.renderShell();
    this.bindControls();
  }

  destroy(): void {
    this.el.remove();
  }

  setSelectedUnit(label: string | null): void {
    this.selectedUnitLabel = label ?? '—';
    const el = this.el.querySelector('#scadaUnit');
    if (el) el.textContent = this.selectedUnitLabel;
  }

  getSimSpeed(): SimSpeed {
    return this.simSpeed;
  }

  update(state: SimState): void {
    const set = (id: string, v: string) => {
      const n = this.el.querySelector(`#${id}`);
      if (n) n.textContent = v;
    };
    const p = this.model.plant;
    set('tagInfluent', formatFlow(state.influentFlowMld, p, p.isSeptic ? 2 : 2).replace(/ .*/, ''));
    set('tagEffluent', formatFlow(state.effluentFlowMld, p, p.isSeptic ? 2 : 2).replace(/ .*/, ''));
    set('tagFlowUnit', p.flowUnit === 'm3/d' ? 'm³/d' : 'MLD');
    set('tagFlowUnit2', p.flowUnit === 'm3/d' ? 'm³/d' : 'MLD');
    set('tagKw', state.blowerKw.toFixed(p.isSeptic ? 2 : 0));
    set('tagUtil', state.capacityUtilPct.toFixed(0));
    set('tagClock', formatSimClock(state.timeSec));
    set('statusStrip', `${state.statusLine} · ${this.simSpeed}×`);
    set('scadaUnit', this.selectedUnitLabel);

    if (this.septic) {
      set('tagTank', state.tankLevelPct.toFixed(0));
      set('tagFloat', state.pumpAlarmFloat ? 'ALARM' : 'OK');
      set('tagBed', state.effluentFlowMld > 0 ? 'RECEIVING' : 'IDLE');
      const floatEl = this.el.querySelector('#tagFloat') as HTMLElement | null;
      if (floatEl) {
        floatEl.classList.toggle('tag-ok', !state.pumpAlarmFloat);
        floatEl.classList.toggle('tag-bad', state.pumpAlarmFloat);
      }
    } else {
      set('tagDO', state.doMgL.toFixed(2));
      set('tagMLSS', state.mlssMgL.toFixed(0));
      set('tagDisinfect', state.disinfectionStatus);
      set('tagWetWell', state.wetWellLevelPct.toFixed(0));
      set('tagPrim', state.primaryLevelPct.toFixed(0));
      set('tagAer', state.aerationLevelPct.toFixed(0));
      set('tagSec', state.secondaryLevelPct.toFixed(0));
      set('tagBodIn', state.influentBodMgL.toFixed(0));
      set('tagBodOut', state.effluentBodMgL.toFixed(1));
      set('tagTpOut', state.effluentTpMgL.toFixed(2));
      const ecaTp = this.model.plant.ecaTpMgL;
      set('tagTpEca', ecaTp != null ? ecaTp.toFixed(2) : '—');
      const disEl = this.el.querySelector('#tagDisinfect') as HTMLElement | null;
      if (disEl) {
        const na = state.disinfectionStatus === 'N/A';
        disEl.classList.toggle('tag-ok', state.disinfectionStatus === 'ONLINE');
        disEl.classList.toggle('tag-bad', !na && state.disinfectionStatus !== 'ONLINE');
      }
      const tpEl = this.el.querySelector('#tagTpOut') as HTMLElement | null;
      if (tpEl && ecaTp != null) {
        tpEl.classList.toggle('tag-bad', state.effluentTpMgL > ecaTp * 1.15);
        tpEl.classList.toggle('tag-ok', state.effluentTpMgL <= ecaTp);
      }
    }

    const alarmBox = this.el.querySelector('#alarmList') as HTMLElement;
    if (alarmBox) {
      const MAX_VISIBLE = 3;
      if (!state.alarms.length) {
        alarmBox.innerHTML = `<div class="alarm-ok">No active alarms</div>`;
      } else {
        const shown = state.alarms.slice(0, MAX_VISIBLE);
        const more = state.alarms.length - shown.length;
        alarmBox.innerHTML =
          shown.map((a) => `<div class="alarm-row ${a.severity}">${a.message}</div>`).join('') +
          (more > 0 ? `<div class="alarm-more">+${more} more</div>` : '');
      }
    }

    this.syncReadout('doTarget', this.model.setpoints.doTarget.toFixed(1));
    this.syncReadout('blowerPct', `${this.model.setpoints.blowerPct.toFixed(0)}%`);
    this.syncReadout('chemPct', `${this.model.setpoints.chemicalDosePct.toFixed(0)}%`);
    this.syncReadout('pumpPct', `${this.model.setpoints.pumpSpeedPct.toFixed(0)}%`);
  }

  private syncReadout(key: string, text: string): void {
    const el = this.el.querySelector(`[data-readout="${key}"]`);
    if (el) el.textContent = text;
  }

  private disinfectionLabel(): { tag: string; checkbox: string } {
    const t = this.model.plant.disinfectionType;
    if (t === 'chlorine') return { tag: 'Chlorine status', checkbox: 'Chlorine feed online' };
    if (t === 'uv') return { tag: 'UV status', checkbox: 'UV banks online' };
    return { tag: 'Disinfection', checkbox: 'Disinfection online' };
  }

  private renderShell(): void {
    const sp = this.model.setpoints;
    const title = this.septic ? `SCADA · ${this.model.plant.nameShort}` : `SCADA · ${this.model.plant.nameShort} WWTP`;
    const dis = this.disinfectionLabel();
    const showDisinfect = !this.septic && this.model.plant.disinfectionType !== 'none';

    const pPlant = this.model.plant;
    const chemLabel = pPlant.chemicalLabel;
    const showTp = !this.septic && (pPlant.ecaTpMgL != null || chemLabel != null);
    const levelTags = this.septic
      ? ''
      : pPlant.hasOxidationDitch
        ? `<div class="tag"><span class="k">Ditch lvl</span><span class="v"><span id="tagAer">0</span> <small>%</small></span></div>
          <div class="tag"><span class="k">Secondary lvl</span><span class="v"><span id="tagSec">0</span> <small>%</small></span></div>`
        : `${pPlant.hasPrimary ? `<div class="tag"><span class="k">Primary lvl</span><span class="v"><span id="tagPrim">0</span> <small>%</small></span></div>` : ''}
          <div class="tag"><span class="k">Aeration lvl</span><span class="v"><span id="tagAer">0</span> <small>%</small></span></div>
          <div class="tag"><span class="k">Secondary lvl</span><span class="v"><span id="tagSec">0</span> <small>%</small></span></div>`;

    const tags = this.septic
      ? `
          <div class="tag"><span class="k">Influent</span><span class="v"><span id="tagInfluent">0</span> <small id="tagFlowUnit">m³/d</small></span></div>
          <div class="tag"><span class="k">To leaching bed</span><span class="v"><span id="tagEffluent">0</span> <small id="tagFlowUnit2">m³/d</small></span></div>
          <div class="tag"><span class="k">Tank level</span><span class="v"><span id="tagTank">0</span> <small>%</small></span></div>
          <div class="tag"><span class="k">High-level float</span><span class="v"><span id="tagFloat">OK</span></span></div>
          <div class="tag"><span class="k">Bed status</span><span class="v"><span id="tagBed">—</span></span></div>
          <div class="tag"><span class="k">Pump power</span><span class="v"><span id="tagKw">0</span> <small>kW</small></span></div>
          <div class="tag"><span class="k">Design util</span><span class="v"><span id="tagUtil">0</span> <small>%</small></span></div>
          <div class="tag"><span class="k">Selected unit</span><span class="v" id="scadaUnit">—</span></div>`
      : `
          <div class="tag"><span class="k">Influent</span><span class="v"><span id="tagInfluent">0</span> <small id="tagFlowUnit">MLD</small></span></div>
          <div class="tag"><span class="k">Effluent</span><span class="v"><span id="tagEffluent">0</span> <small id="tagFlowUnit2">MLD</small></span></div>
          <div class="tag"><span class="k">Aeration DO</span><span class="v"><span id="tagDO">0</span> <small>mg/L</small></span></div>
          <div class="tag"><span class="k">MLSS</span><span class="v"><span id="tagMLSS">0</span> <small>mg/L</small></span></div>
          <div class="tag"><span class="k">Blower/Power</span><span class="v"><span id="tagKw">0</span> <small>kW</small></span></div>
          ${showDisinfect ? `<div class="tag"><span class="k">${dis.tag}</span><span class="v"><span id="tagDisinfect">—</span></span></div>` : ''}
          <div class="tag"><span class="k">Wet-well lvl</span><span class="v"><span id="tagWetWell">0</span> <small>%</small></span></div>
          ${levelTags}
          <div class="tag"><span class="k">Capacity util</span><span class="v"><span id="tagUtil">0</span> <small>%</small></span></div>
          <div class="tag"><span class="k">BOD in / out</span><span class="v"><span id="tagBodIn">0</span>/<span id="tagBodOut">0</span> <small>mg/L</small></span></div>
          ${showTp ? `<div class="tag"><span class="k">TP out / ECA</span><span class="v"><span id="tagTpOut">0</span>/<span id="tagTpEca">—</span> <small>mg/L</small></span></div>` : ''}
          <div class="tag"><span class="k">Selected unit</span><span class="v" id="scadaUnit">—</span></div>`;

    const disinfectCtrl = showDisinfect
      ? `<label class="check">
            <input type="checkbox" id="spDisinfect" ${sp.disinfectionOnline ? 'checked' : ''} /> ${dis.checkbox}
          </label>`
      : '';

    const controls = this.septic
      ? `
          <div class="ctrl-head">Operator setpoints</div>
          <label>Effluent pump <span data-readout="pumpPct">${sp.pumpSpeedPct}%</span>
            <input type="range" id="spPump" min="0" max="120" step="1" value="${sp.pumpSpeedPct}" />
          </label>
          <p class="scada-hint">Tank + leaching bed · gravity / pump to bed. Lower pump → level rises → float alarm.</p>`
      : `
          <div class="ctrl-head">Operator setpoints</div>
          <label>DO target <span data-readout="doTarget">${sp.doTarget.toFixed(1)}</span> mg/L
            <input type="range" id="spDo" min="0.5" max="4.0" step="0.1" value="${sp.doTarget}" />
          </label>
          <label>Blower <span data-readout="blowerPct">${sp.blowerPct.toFixed(0)}%</span>
            <input type="range" id="spBlower" min="0" max="100" step="1" value="${sp.blowerPct}" />
          </label>
          <label>${chemLabel ? `${chemLabel} dose` : 'Chemical dose'} <span data-readout="chemPct">${sp.chemicalDosePct}%</span>
            <input type="range" id="spChem" min="0" max="100" step="1" value="${sp.chemicalDosePct}" />
          </label>
          <label>Lift pumps <span data-readout="pumpPct">${sp.pumpSpeedPct}%</span>
            <input type="range" id="spPump" min="40" max="120" step="1" value="${sp.pumpSpeedPct}" />
          </label>
          <p class="scada-hint">Influent is diurnal/wet-weather. Pumps move wet-well inventory — low pump → high level / overflow risk.</p>
          ${disinfectCtrl}`;

    const speedBtns = ([1, 4, 12] as SimSpeed[])
      .map(
        (s) =>
          `<button type="button" class="speed-btn${s === this.simSpeed ? ' active' : ''}" data-speed="${s}">${s}×</button>`,
      )
      .join('');

    this.el.innerHTML = `
      <div class="scada-titlebar">
        <span class="scada-title">${title}</span>
        <span class="scada-clock" id="tagClock">08:00</span>
      </div>
      <div class="scada-body">
        <div class="scada-col tags"><div class="tag-grid">${tags}</div></div>
        <div class="scada-col controls">
          ${controls}
          <div class="ctrl-head" style="margin-top:.65rem">Sim speed</div>
          <div class="speed-row" id="simSpeedRow">${speedBtns}</div>
        </div>
        <div class="scada-col alarms">
          <div class="ctrl-head">Alarms</div>
          <div id="alarmList" class="alarm-list"></div>
        </div>
      </div>
      <div class="status-strip" id="statusStrip">Shift 0:00 · NORMAL</div>
    `;
  }

  private bindControls(): void {
    const bindRange = (id: string, key: keyof Setpoints, parse: (v: string) => number) => {
      const el = this.el.querySelector(`#${id}`) as HTMLInputElement | null;
      if (!el) return;
      el.addEventListener('input', () => {
        this.model.updateSetpoint(key, parse(el.value) as never);
        audio.scadaTick();
      });
    };
    bindRange('spDo', 'doTarget', parseFloat);
    bindRange('spBlower', 'blowerPct', Number);
    bindRange('spChem', 'chemicalDosePct', Number);
    bindRange('spPump', 'pumpSpeedPct', Number);
    const dis = this.el.querySelector('#spDisinfect') as HTMLInputElement | null;
    dis?.addEventListener('change', () => {
      this.model.updateSetpoint('disinfectionOnline', dis.checked);
      audio.uiClick();
    });

    this.el.querySelectorAll('.speed-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const s = Number((btn as HTMLElement).dataset.speed) as SimSpeed;
        if (s !== 1 && s !== 4 && s !== 12) return;
        this.simSpeed = s;
        this.el.querySelectorAll('.speed-btn').forEach((b) => {
          b.classList.toggle('active', Number((b as HTMLElement).dataset.speed) === s);
        });
        this.onSimSpeedChange(s);
        audio.uiClick();
      });
    });
  }
}

function formatSimClock(tSec: number): string {
  const h = Math.floor(tSec / 3600) % 24;
  const m = Math.floor((tSec % 3600) / 60);
  const s = Math.floor(tSec % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
