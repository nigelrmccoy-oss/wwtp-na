/**
 * Mass-balance-lite continuous process model for WWTP operator training.
 * Supports municipal CAS trains and micro septic (farm) profile.
 */
import type { PlantRuntime } from '../data/plantTypes';

export type PlantConfig = PlantRuntime;

export interface Setpoints {
  doTarget: number;
  blowerPct: number;
  chemicalDosePct: number;
  pumpSpeedPct: number;
  /** Disinfection online (UV banks or chlorine feed / contact, per plant). */
  disinfectionOnline: boolean;
}

export interface SimState {
  timeSec: number;
  shiftElapsedSec: number;
  influentFlowMld: number;
  effluentFlowMld: number;
  doMgL: number;
  mlssMgL: number;
  blowerKw: number;
  disinfectionStatus: 'ONLINE' | 'OFFLINE' | 'FAULT' | 'N/A';
  primaryLevelPct: number;
  aerationLevelPct: number;
  secondaryLevelPct: number;
  /** Headworks / wet-well level % (municipal) */
  wetWellLevelPct: number;
  /** Septic tank level % */
  tankLevelPct: number;
  pumpAlarmFloat: boolean;
  capacityUtilPct: number;
  influentBodMgL: number;
  effluentBodMgL: number;
  influentTpMgL: number;
  effluentTpMgL: number;
  alarms: Alarm[];
  statusLine: string;
  profile: 'municipal' | 'septic';
}

export interface Alarm {
  id: string;
  severity: 'warn' | 'alarm';
  message: string;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function diurnalFactor(tSec: number): number {
  const h = (tSec / 3600) % 24;
  const morning = Math.exp(-0.5 * ((h - 8) / 2.2) ** 2);
  const evening = Math.exp(-0.5 * ((h - 19) / 2.5) ** 2);
  const night = 0.55 + 0.15 * Math.sin((h / 24) * Math.PI * 2);
  return clamp(night + 0.55 * morning + 0.45 * evening, 0.45, 1.55);
}

/** OTR coefficient: kg-equivalent DO transfer per hour at 100% blower (tuned for training). */
const OTR_AT_100 = 6.2;
/** OUR base at MLSS=3000 mg/L and util=1.0 */
const OUR_BASE = 2.15;

export class ProcessModel {
  readonly plant: PlantRuntime;
  setpoints: Setpoints;
  private t = 8 * 3600;
  private shiftStart = 8 * 3600;
  private doMgL: number;
  private mlss: number;
  private wetWellLevel = 52;
  private primaryLevel = 55;
  private aerationLevel = 72;
  private secondaryLevel = 48;
  private tankLevel: number;
  private influentBod: number;
  private effluentBod: number;
  private influentTp: number;
  private effluentTp: number;
  private noiseSeed = Math.random() * 1000;
  private pumpAlarm = false;

  constructor(plant: PlantRuntime) {
    this.plant = plant;
    this.doMgL = plant.isSeptic ? 0 : plant.defaultDo;
    this.mlss = plant.isSeptic ? 0 : plant.defaultMlss;
    this.influentBod = plant.influentBod;
    this.effluentBod = plant.effluentBod;
    this.influentTp = plant.influentTpMgL;
    this.effluentTp = plant.effluentTpMgL;
    this.tankLevel = plant.research.scadaDefaults.tankLevelPct ?? 45;

    // Init blower so OTR ≈ OUR at avg-day util + default MLSS (healthy start).
    const mlssRatio = plant.isSeptic ? 0 : this.mlss / 3000;
    // Size blowers for ~1.25× avg-day (morning peak) so defaults stay healthy at shift start (08:00).
    const ourAtPeakish = mlssRatio * 1.25 * OUR_BASE;
    const blowerForBalance = plant.isSeptic ? 0 : clamp((ourAtPeakish / OTR_AT_100) * 100 * 1.12, 48, 72);

    this.setpoints = {
      doTarget: plant.isSeptic ? 0 : plant.defaultDo,
      blowerPct: blowerForBalance,
      chemicalDosePct: plant.isSeptic ? 0 : 40,
      pumpSpeedPct: plant.isSeptic ? 60 : 100,
      disinfectionOnline: !plant.isSeptic && plant.disinfectionType !== 'none',
    };
  }

  updateSetpoint<K extends keyof Setpoints>(key: K, value: Setpoints[K]): void {
    this.setpoints[key] = value;
  }

  resetShift(): void {
    this.shiftStart = this.t;
  }

  step(dt: number): SimState {
    return this.plant.isSeptic ? this.stepSeptic(dt) : this.stepMunicipal(dt);
  }

  private stepSeptic(dt: number): SimState {
    const p = this.plant;
    const sp = this.setpoints;
    this.t += dt;

    const diu = diurnalFactor(this.t);
    const noise = 0.05 * Math.sin(this.t * 0.11 + this.noiseSeed);
    const pumpFactor = clamp(sp.pumpSpeedPct / 100, 0.2, 1.2);
    // Demand into tank — independent of pump
    let influent = p.avgDayFlowMld * diu * (1 + noise);
    influent = clamp(influent, p.avgDayFlowMld * 0.3, p.peakCapacityMld);

    // Tank level: fill from influent, drain via effluent pump / gravity to bed
    const fillRate = (influent / Math.max(p.designCapacityMld, 1e-6)) * 8;
    const drainRate = pumpFactor * 10 * (this.tankLevel > 20 ? 1 : 0.15);
    this.tankLevel = clamp(this.tankLevel + (fillRate - drainRate) * dt * 0.025, 5, 99);

    this.pumpAlarm = this.tankLevel > 88 || (sp.pumpSpeedPct < 25 && this.tankLevel > 70);
    const effluent = influent * clamp(0.5 + pumpFactor * 0.5, 0.3, 1.05) * (this.tankLevel > 25 ? 1 : 0.4);

    this.influentBod = clamp(p.influentBod * (0.9 + 0.15 * diu), 150, 400);
    this.effluentBod = clamp(p.effluentBod * (0.95 + (this.tankLevel > 85 ? 0.2 : 0)), 80, 200);

    const powerKw = sp.pumpSpeedPct > 5 ? (sp.pumpSpeedPct / 100) * p.blowerRatedKw : 0.02;
    const capacityUtilPct = (influent / p.designCapacityMld) * 100;

    const alarms: Alarm[] = [];
    if (this.pumpAlarm) {
      alarms.push({ id: 'float_alarm', severity: 'alarm', message: 'HIGH LEVEL FLOAT — septic tank' });
    }
    if (this.tankLevel > 80) {
      alarms.push({ id: 'tank_high', severity: 'warn', message: `Tank level high ${this.tankLevel.toFixed(0)}%` });
    }
    if (capacityUtilPct > 100) {
      alarms.push({ id: 'cap_exceed', severity: 'alarm', message: `Flow exceed design ${capacityUtilPct.toFixed(0)}%` });
    }

    const shiftElapsed = this.t - this.shiftStart;
    return {
      timeSec: this.t,
      shiftElapsedSec: shiftElapsed,
      influentFlowMld: influent,
      effluentFlowMld: effluent,
      doMgL: 0,
      mlssMgL: 0,
      blowerKw: powerKw,
      disinfectionStatus: 'N/A',
      primaryLevelPct: 0,
      aerationLevelPct: 0,
      secondaryLevelPct: 0,
      wetWellLevelPct: 0,
      tankLevelPct: this.tankLevel,
      pumpAlarmFloat: this.pumpAlarm,
      capacityUtilPct,
      influentBodMgL: this.influentBod,
      effluentBodMgL: this.effluentBod,
      influentTpMgL: this.influentTp,
      effluentTpMgL: this.effluentTp,
      alarms,
      statusLine: this.buildStatusLine(alarms, capacityUtilPct, shiftElapsed),
      profile: 'septic',
    };
  }

  private stepMunicipal(dt: number): SimState {
    const p = this.plant;
    const sp = this.setpoints;
    this.t += dt;

    const diu = diurnalFactor(this.t);
    const noise = 0.04 * Math.sin(this.t * 0.07 + this.noiseSeed) + 0.02 * Math.sin(this.t * 0.31);

    // Influent is independent of plant pumps (collection / diurnal / wet weather).
    let influent = p.avgDayFlowMld * diu * (1 + noise);
    influent = clamp(influent, 0.05, p.peakCapacityMld * 1.02);

    const stormPhase = (this.t % 2700) / 2700;
    if (stormPhase > 0.85 && stormPhase < 0.95) {
      influent *= 1.0 + 0.45 * Math.sin(((stormPhase - 0.85) / 0.1) * Math.PI);
    }

    const util = influent / p.designCapacityMld;
    const pumpFactor = clamp(sp.pumpSpeedPct / 100, 0.35, 1.25);

    // Wet-well / headworks: fill from influent, drain by lift pumps (not inventing flow).
    const fillDrive = (influent / Math.max(p.avgDayFlowMld, 0.1)) * 14;
    const drainDrive = pumpFactor * 14;
    this.wetWellLevel = clamp(
      this.wetWellLevel + (fillDrive - drainDrive - (this.wetWellLevel - 52) * 0.08) * dt * 0.02,
      8,
      99,
    );

    // Throughput to process train limited by pump + wet-well inventory
    const throughputFactor = clamp(pumpFactor * (0.55 + 0.45 * (this.wetWellLevel / 100)), 0.35, 1.15);
    const processFlow = influent * throughputFactor;

    const levelDrive = (util - 0.7) * 14 + (this.wetWellLevel - 55) * 0.12 + (100 - sp.pumpSpeedPct) * 0.06;
    this.primaryLevel = clamp(this.primaryLevel + (levelDrive - (this.primaryLevel - 55) * 0.15) * dt * 0.02, 15, 98);
    this.aerationLevel = clamp(this.aerationLevel + (levelDrive * 0.7 - (this.aerationLevel - 72) * 0.12) * dt * 0.02, 25, 97);
    this.secondaryLevel = clamp(
      this.secondaryLevel + (levelDrive * 0.5 - (this.secondaryLevel - 48) * 0.1 - (sp.chemicalDosePct - 40) * 0.01) * dt * 0.02,
      20,
      95,
    );

    // DO mass balance — OTR vs OUR; autoTrim holds toward doTarget when blower is adequate.
    const flowRatio = processFlow / Math.max(p.avgDayFlowMld, 0.1);
    const otr = (sp.blowerPct / 100) * OTR_AT_100;
    // Soften flow spikes so diurnal alone does not crash DO at healthy blower %.
    const ourLoad = clamp(0.75 + 0.35 * flowRatio, 0.75, 1.35);
    const our = (this.mlss / 3000) * ourLoad * OUR_BASE;
    const doError = sp.doTarget - this.doMgL;
    // Stronger trim when blowers are on; weak when starved (<20%).
    const trimGain = 1.35 * clamp(sp.blowerPct / 50, 0.12, 1.4);
    const autoTrim = doError * trimGain;
    // Dynamics tuned so defaults hold ~1.8–2.5 mg/L; mismanagement still alarms.
    this.doMgL = clamp(this.doMgL + (otr - our + autoTrim) * (dt / 60) * 0.55, 0.2, 8);
    if (sp.blowerPct < 15) this.doMgL = clamp(this.doMgL - 0.55 * dt * 0.04, 0.2, 8);

    const growth = (processFlow / Math.max(p.designCapacityMld, 0.1)) * 12 - (sp.chemicalDosePct / 100) * 4;
    this.mlss = clamp(this.mlss + (growth - (this.mlss - p.defaultMlss) * 0.008) * dt * 0.015, 800, 4500);

    const bodBase = p.influentBod;
    this.influentBod = clamp(bodBase * (0.85 + 0.25 * diu) + 15 * noise, bodBase * 0.6, bodBase * 1.6);
    // BOD removal from aeration/chemicals only — disinfection is not a BOD unit.
    const removal =
      0.82 + 0.08 * clamp(this.doMgL / 2.0, 0, 1.2) + 0.04 * clamp(sp.chemicalDosePct / 50, 0, 1.2);
    this.effluentBod = clamp(
      this.influentBod * (1 - clamp(removal, 0.5, 0.96)) * 0.35 + p.effluentBod * 0.65,
      Math.max(1, p.effluentBod * 0.4),
      80,
    );

    // TP proxy — chemical dose drives toward plant effluent / ECA
    this.influentTp = clamp(p.influentTpMgL * (0.9 + 0.12 * diu), p.influentTpMgL * 0.7, p.influentTpMgL * 1.4);
    const chemFrac = clamp(sp.chemicalDosePct / 100, 0, 1);
    const tpTarget = p.effluentTpMgL;
    const tpFloor = p.ecaTpMgL != null ? Math.min(tpTarget, p.ecaTpMgL * 0.85) : tpTarget * 0.7;
    const tpPoor = this.influentTp * (0.55 - 0.25 * chemFrac); // low dose → higher effluent TP
    this.effluentTp = clamp(
      tpPoor * (1 - chemFrac) + tpTarget * chemFrac * 0.55 + tpFloor * chemFrac * 0.45,
      Math.max(0.02, tpFloor * 0.5),
      Math.max(1.5, this.influentTp * 0.6),
    );

    const blowerKw = (sp.blowerPct / 100) * p.blowerRatedKw * (0.85 + 0.15 * (this.aerationLevel / 100));
    const pumpKw = (sp.pumpSpeedPct / 100) * p.blowerRatedKw * 0.12;
    const chpCredit = p.research.energy.chpKw ? p.research.energy.chpKw * 0.15 : 0;
    const totalKw = Math.max(5, blowerKw + pumpKw - chpCredit * (sp.blowerPct / 100) * 0.2);

    const disOk = p.disinfectionType === 'none' ? true : sp.disinfectionOnline;
    let effluent = processFlow * (0.97 + 0.01 * (sp.chemicalDosePct / 100));
    if (this.secondaryLevel > 92) effluent *= 1.05;
    if (this.wetWellLevel > 92) effluent *= 1.02;

    const capacityUtilPct = (influent / p.designCapacityMld) * 100;
    const alarms: Alarm[] = [];
    if (this.doMgL < 1.0) alarms.push({ id: 'do_low', severity: 'alarm', message: `DO LOW ${this.doMgL.toFixed(1)} mg/L` });
    else if (this.doMgL < 1.5) alarms.push({ id: 'do_warn', severity: 'warn', message: `DO marginal ${this.doMgL.toFixed(1)} mg/L` });
    if (this.wetWellLevel > 90 || this.primaryLevel > 90 || this.aerationLevel > 92 || this.secondaryLevel > 90) {
      alarms.push({ id: 'overflow', severity: 'alarm', message: 'OVERFLOW RISK — high tank level' });
    } else if (this.wetWellLevel > 82 && sp.pumpSpeedPct < 70) {
      alarms.push({ id: 'wetwell_high', severity: 'warn', message: `Wet-well high ${this.wetWellLevel.toFixed(0)}% — raise pumps` });
    }
    if (p.disinfectionType !== 'none' && !disOk && influent > 0.2) {
      const label = p.disinfectionType === 'chlorine' ? 'CHLORINE FEED OFFLINE' : 'UV OFFLINE';
      alarms.push({
        id: 'disinfect_flow',
        severity: 'alarm',
        message: `${label} with flow on plant`,
      });
    }
    if (capacityUtilPct > 100) alarms.push({ id: 'cap_exceed', severity: 'alarm', message: `CAPACITY EXCEED ${capacityUtilPct.toFixed(0)}%` });
    else if (capacityUtilPct > 90) alarms.push({ id: 'cap_warn', severity: 'warn', message: `Near capacity ${capacityUtilPct.toFixed(0)}%` });
    if (this.mlss > 4000) alarms.push({ id: 'mlss_high', severity: 'warn', message: `MLSS high ${this.mlss.toFixed(0)} mg/L` });
    if (p.ecaTpMgL != null && this.effluentTp > p.ecaTpMgL * 1.15) {
      alarms.push({
        id: 'tp_high',
        severity: 'warn',
        message: `Effluent TP ${this.effluentTp.toFixed(2)} > ECA ${p.ecaTpMgL} mg/L`,
      });
    }

    let disinfectionStatus: SimState['disinfectionStatus'] = 'N/A';
    if (p.disinfectionType !== 'none') {
      disinfectionStatus = disOk ? 'ONLINE' : 'OFFLINE';
    }

    const shiftElapsed = this.t - this.shiftStart;
    return {
      timeSec: this.t,
      shiftElapsedSec: shiftElapsed,
      influentFlowMld: influent,
      effluentFlowMld: effluent,
      doMgL: this.doMgL,
      mlssMgL: this.mlss,
      blowerKw: totalKw,
      disinfectionStatus,
      // Oxidation ditch: expose ditch inventory via primaryLevelPct (SCADA relabels); hide false 0%.
      primaryLevelPct: p.hasPrimary || p.hasOxidationDitch ? this.primaryLevel : 0,
      aerationLevelPct: p.hasOxidationDitch ? this.primaryLevel : this.aerationLevel,
      secondaryLevelPct: this.secondaryLevel,
      wetWellLevelPct: this.wetWellLevel,
      tankLevelPct: 0,
      pumpAlarmFloat: false,
      capacityUtilPct,
      influentBodMgL: this.influentBod,
      effluentBodMgL: this.effluentBod,
      influentTpMgL: this.influentTp,
      effluentTpMgL: this.effluentTp,
      alarms,
      statusLine: this.buildStatusLine(alarms, capacityUtilPct, shiftElapsed),
      profile: 'municipal',
    };
  }

  private buildStatusLine(alarms: Alarm[], util: number, shiftSec: number): string {
    const hh = Math.floor(shiftSec / 3600);
    const mm = Math.floor((shiftSec % 3600) / 60);
    const alarmBit = alarms.some((a) => a.severity === 'alarm') ? 'ALARM' : alarms.length ? 'WARN' : 'NORMAL';
    return `Shift ${hh}:${String(mm).padStart(2, '0')} · ${alarmBit} · Util ${util.toFixed(0)}% · ${this.plant.nameShort}`;
  }
}
