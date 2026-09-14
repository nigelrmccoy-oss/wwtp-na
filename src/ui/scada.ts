import type { ProcessModel, SimState, Setpoints } from '../sim/processModel';
import { formatFlow } from '../data/plantTypes';
import { audio } from '../audio/AudioEngine';

export class ScadaOverlay {
  readonly el: HTMLElement;
  private model: ProcessModel;
  private selectedUnitLabel = '—';
  private septic: boolean;

  constructor(host: HTMLElement, model: ProcessModel) {
    this.model = model;
    this.septic = model.plant.isSeptic;
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
    set('statusStrip', state.statusLine);
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
      set('tagUV', state.uvStatus);
      set('tagPrim', state.primaryLevelPct.toFixed(0));
      set('tagAer', state.aerationLevelPct.toFixed(0));
      set('tagSec', state.secondaryLevelPct.toFixed(0));
      set('tagBodIn', state.influentBodMgL.toFixed(0));
      set('tagBodOut', state.effluentBodMgL.toFixed(1));
      const uvEl = this.el.querySelector('#tagUV') as HTMLElement | null;
      if (uvEl) {
        uvEl.classList.toggle('tag-ok', state.uvStatus === 'ONLINE');
        uvEl.classList.toggle('tag-bad', state.uvStatus !== 'ONLINE');
      }
    }

    const alarmBox = this.el.querySelector('#alarmList') as HTMLElement;
    if (alarmBox) {
      alarmBox.innerHTML = state.alarms.length
        ? state.alarms.map((a) => `<div class="alarm-row ${a.severity}">${a.message}</div>`).join('')
        : `<div class="alarm-ok">No active alarms</div>`;
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

  private renderShell(): void {
    const sp = this.model.setpoints;
    const title = this.septic ? `SCADA · ${this.model.plant.nameShort}` : `SCADA · ${this.model.plant.nameShort} WWTP`;
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
          <div class="tag"><span class="k">UV status</span><span class="v"><span id="tagUV">—</span></span></div>
          <div class="tag"><span class="k">Primary lvl</span><span class="v"><span id="tagPrim">0</span> <small>%</small></span></div>
          <div class="tag"><span class="k">Aeration lvl</span><span class="v"><span id="tagAer">0</span> <small>%</small></span></div>
          <div class="tag"><span class="k">Secondary lvl</span><span class="v"><span id="tagSec">0</span> <small>%</small></span></div>
          <div class="tag"><span class="k">Capacity util</span><span class="v"><span id="tagUtil">0</span> <small>%</small></span></div>
          <div class="tag"><span class="k">BOD in / out</span><span class="v"><span id="tagBodIn">0</span>/<span id="tagBodOut">0</span> <small>mg/L</small></span></div>
          <div class="tag"><span class="k">Selected unit</span><span class="v" id="scadaUnit">—</span></div>`;

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
          <label>Blower <span data-readout="blowerPct">${sp.blowerPct}%</span>
            <input type="range" id="spBlower" min="0" max="100" step="1" value="${sp.blowerPct}" />
          </label>
          <label>Chemical dose <span data-readout="chemPct">${sp.chemicalDosePct}%</span>
            <input type="range" id="spChem" min="0" max="100" step="1" value="${sp.chemicalDosePct}" />
          </label>
          <label>Pump speed <span data-readout="pumpPct">${sp.pumpSpeedPct}%</span>
            <input type="range" id="spPump" min="40" max="120" step="1" value="${sp.pumpSpeedPct}" />
          </label>
          <label class="check">
            <input type="checkbox" id="spUv" ${sp.uvOnline ? 'checked' : ''} /> UV banks online
          </label>`;

    this.el.innerHTML = `
      <div class="scada-titlebar">
        <span class="scada-title">${title}</span>
        <span class="scada-clock" id="tagClock">08:00</span>
      </div>
      <div class="scada-body">
        <div class="scada-col tags"><div class="tag-grid">${tags}</div></div>
        <div class="scada-col controls">${controls}</div>
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
    const uv = this.el.querySelector('#spUv') as HTMLInputElement | null;
    uv?.addEventListener('change', () => {
      this.model.updateSetpoint('uvOnline', uv.checked);
      audio.uiClick();
    });
  }
}

function formatSimClock(tSec: number): string {
  const h = Math.floor(tSec / 3600) % 24;
  const m = Math.floor((tSec % 3600) / 60);
  const s = Math.floor(tSec % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
