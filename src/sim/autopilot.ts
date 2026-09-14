/**
 * SCADA Autopilot — keep plant NORMAL / meet ECA when enabled.
 */
import type { ProcessModel, SimState, Setpoints } from './processModel';

export class Autopilot {
  enabled = false;

  /** Apply gentle setpoint corrections based on latest state. Call after model.step. */
  tick(model: ProcessModel, state: SimState, dt: number): void {
    if (!this.enabled) return;
    const sp = model.setpoints;
    const p = model.plant;
    const rate = Math.min(1, dt * 0.35); // smooth moves

    if (p.isSeptic) {
      // Clear high float / keep tank mid
      let pump = sp.pumpSpeedPct;
      if (state.pumpAlarmFloat || state.tankLevelPct > 75) pump = Math.max(pump, 95);
      else if (state.tankLevelPct > 60) pump = Math.max(pump, 75);
      else if (state.tankLevelPct < 30) pump = Math.min(pump, 45);
      else pump = approach(pump, 60, rate * 25);
      this.set(model, 'pumpSpeedPct', clamp(pump, 0, 120));
      return;
    }

    // Disinfection always online under autopilot
    if (p.disinfectionType !== 'none' && !sp.disinfectionOnline) {
      this.set(model, 'disinfectionOnline', true);
    }

    // DO tracking via blower
    const doErr = sp.doTarget - state.doMgL;
    let blower = sp.blowerPct;
    if (doErr > 0.15) blower += rate * (8 + doErr * 18);
    else if (doErr < -0.35) blower -= rate * (6 + Math.abs(doErr) * 12);
    // Floor so DO doesn't starve
    if (state.doMgL < 1.4) blower = Math.max(blower, 55);
    if (state.doMgL < 1.0) blower = Math.max(blower, 70);
    this.set(model, 'blowerPct', clamp(blower, 25, 100));

    // Hold DO target near plant default if operator left it wild
    if (sp.doTarget < 1.5 || sp.doTarget > 3.2) {
      this.set(model, 'doTarget', approach(sp.doTarget, p.defaultDo || 2.0, rate * 0.4));
    }

    // Wet-well / lift pumps
    let pump = sp.pumpSpeedPct;
    if (state.wetWellLevelPct > 85) pump = Math.max(pump, 110);
    else if (state.wetWellLevelPct > 75) pump = Math.max(pump, 95);
    else if (state.wetWellLevelPct < 35) pump = Math.min(pump, 70);
    else pump = approach(pump, 100, rate * 20);
    this.set(model, 'pumpSpeedPct', clamp(pump, 40, 120));

    // Chem dose — meet ECA TP
    if (p.chemicalLabel || p.ecaTpMgL != null) {
      let chem = sp.chemicalDosePct;
      const eca = p.ecaTpMgL;
      if (eca != null) {
        if (state.effluentTpMgL > eca * 1.05) chem += rate * 12;
        else if (state.effluentTpMgL < eca * 0.55) chem -= rate * 6;
        else chem = approach(chem, 42, rate * 8);
      } else {
        chem = approach(chem, 40, rate * 8);
      }
      this.set(model, 'chemicalDosePct', clamp(chem, 15, 90));
    }
  }

  private set<K extends keyof Setpoints>(model: ProcessModel, key: K, value: Setpoints[K]): void {
    model.updateSetpoint(key, value);
  }
}

function approach(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
