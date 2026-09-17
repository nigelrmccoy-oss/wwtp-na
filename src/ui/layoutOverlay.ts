/**
 * Toggleable transparent whole-layout overlay with unit labels + live sim tags.
 */
import type { SimState } from '../sim/processModel';
import { formatFlow } from '../data/plantTypes';
import type { PlantRuntime } from '../data/plantTypes';
import { audio } from '../audio/AudioEngine';

export interface OverlayAnchor {
  id: string;
  label: string;
  x: number;
  y: number;
}

export class LayoutOverlay {
  readonly el: HTMLElement;
  private enabled = false;
  private tip: HTMLElement;
  private plant: PlantRuntime;
  private lastState: SimState | null = null;
  private onToggle: ((on: boolean) => void) | null;

  constructor(
    host: HTMLElement,
    plant: PlantRuntime,
    opts?: { onToggle?: (on: boolean) => void },
  ) {
    this.plant = plant;
    this.onToggle = opts?.onToggle ?? null;
    this.el = document.createElement('div');
    this.el.id = 'layoutOverlay';
    this.el.className = 'layout-overlay hidden';
    this.el.setAttribute('aria-hidden', 'true');
    host.appendChild(this.el);

    this.tip = document.createElement('div');
    this.tip.className = 'layout-overlay-tip hidden';
    host.appendChild(this.tip);
  }

  destroy(): void {
    this.el.remove();
    this.tip.remove();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.el.classList.toggle('hidden', !on);
    this.el.setAttribute('aria-hidden', on ? 'false' : 'true');
    if (!on) this.tip.classList.add('hidden');
    this.onToggle?.(on);
  }

  toggle(): boolean {
    this.setEnabled(!this.enabled);
    audio.uiClick();
    return this.enabled;
  }

  update(state: SimState, anchors: OverlayAnchor[]): void {
    this.lastState = state;
    if (!this.enabled) return;

    const byId = new Map(anchors.map((a) => [a.id, a]));
    const existing = new Map<string, HTMLButtonElement>();
    this.el.querySelectorAll<HTMLButtonElement>('.lo-chip').forEach((n) => {
      existing.set(n.dataset.unitId || '', n);
    });

    const keep = new Set<string>();
    for (const a of anchors) {
      // Skip dense OSM clutter in overlay
      if (a.id.startsWith('osm_') && a.id !== 'osm_wwtp') continue;
      keep.add(a.id);
      let chip = existing.get(a.id);
      if (!chip) {
        chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'lo-chip';
        chip.dataset.unitId = a.id;
        chip.addEventListener('mouseenter', () => this.showTip(a.id, a.label, chip!));
        chip.addEventListener('mouseleave', () => this.tip.classList.add('hidden'));
        chip.addEventListener('focus', () => this.showTip(a.id, a.label, chip!));
        chip.addEventListener('blur', () => this.tip.classList.add('hidden'));
        this.el.appendChild(chip);
      }
      chip.style.left = `${a.x}px`;
      chip.style.top = `${a.y}px`;
      const live = this.liveTag(a.id, state);
      chip.innerHTML = `<span class="lo-name">${escapeHtml(a.label)}</span>${
        live ? `<span class="lo-live">${escapeHtml(live)}</span>` : ''
      }`;
    }

    for (const [id, node] of existing) {
      if (!keep.has(id) || !byId.has(id)) node.remove();
    }
  }

  private showTip(id: string, label: string, chip: HTMLElement): void {
    const state = this.lastState;
    const body = state ? this.tipBody(id, state) : 'No live data yet.';
    this.tip.innerHTML = `<div class="lo-tip-title">${escapeHtml(label)}</div><div class="lo-tip-body">${body}</div>`;
    this.tip.classList.remove('hidden');
    const r = chip.getBoundingClientRect();
    const host = this.tip.parentElement!.getBoundingClientRect();
    let left = r.right - host.left + 8;
    let top = r.top - host.top;
    if (left + 220 > host.width) left = r.left - host.left - 228;
    if (top + 120 > host.height) top = host.height - 128;
    this.tip.style.left = `${Math.max(8, left)}px`;
    this.tip.style.top = `${Math.max(8, top)}px`;
  }

  private liveTag(id: string, state: SimState): string {
    const p = this.plant;
    if (id === 'aeration' || id === 'primary') {
      if (p.hasOxidationDitch && id === 'primary') return `DO ${state.doMgL.toFixed(1)}`;
      if (id === 'aeration') return `DO ${state.doMgL.toFixed(1)}`;
    }
    if (id === 'secondary') return `MLSS ${state.mlssMgL.toFixed(0)}`;
    if (id === 'headworks') return `WW ${state.wetWellLevelPct.toFixed(0)}%`;
    if (id === 'disinfection') return state.disinfectionStatus;
    if (id === 'septic_tank') return `Lvl ${state.tankLevelPct.toFixed(0)}%`;
    if (id === 'leaching_bed') {
      const f = formatFlow(state.effluentFlowMld, p, 1);
      return f;
    }
    if (id === 'distribution') return state.pumpAlarmFloat ? 'FLOAT!' : 'OK';
    return '';
  }

  private tipBody(id: string, state: SimState): string {
    const p = this.plant;
    const lines: string[] = [];
    if (p.isSeptic) {
      if (id === 'septic_tank' || id === 'house' || id === 'distribution' || id === 'leaching_bed') {
        lines.push(`Tank ${state.tankLevelPct.toFixed(0)}% · to bed ${formatFlow(state.effluentFlowMld, p, 2)}`);
        lines.push(`Float ${state.pumpAlarmFloat ? 'ALARM' : 'OK'} · ${state.statusLine}`);
      }
    } else {
      lines.push(`Q in ${formatFlow(state.influentFlowMld, p, 1)} · out ${formatFlow(state.effluentFlowMld, p, 1)}`);
      if (id === 'aeration' || (id === 'primary' && p.hasOxidationDitch)) {
        lines.push(`DO ${state.doMgL.toFixed(2)} mg/L · blower tag live`);
      }
      if (id === 'secondary') lines.push(`MLSS ${state.mlssMgL.toFixed(0)} mg/L`);
      if (id === 'headworks') lines.push(`Wet-well ${state.wetWellLevelPct.toFixed(0)}%`);
      if (id === 'disinfection') lines.push(`Status ${state.disinfectionStatus}`);
      lines.push(state.statusLine);
    }
    return lines.map((l) => `<div>${escapeHtml(l)}</div>`).join('');
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
