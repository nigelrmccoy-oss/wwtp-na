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
  uvOnline: boolean;
}

export interface SimState {
  timeSec: number;
  shiftElapsedSec: number;
  influentFlowMld: number;
  effluentFlowMld: number;
  doMgL: number;
  mlssMgL: number;
  blowerKw: number;
  uvStatus: 'ONLINE' | 'OFFLINE' | 'FAULT' | 'N/A';
  primaryLevelPct: number;
  aerationLevelPct: number;
  secondaryLevelPct: number;
  /** Septic tank level % */
  tankLevelPct: number;
  pumpAlarmFloat: boolean;
  capacityUtilPct: number;
  influentBodMgL: number;
  effluentBodMgL: number;
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

export class ProcessModel {
  readonly plant: PlantRuntime;
  setpoints: Setpoints;
  private t = 8 * 3600;
  private shiftStart = 8 * 3600;
  private doMgL: number;
  private mlss: number;
  private primaryLevel = 55;
  private aerationLevel = 72;
  private secondaryLevel = 48;
  private tankLevel: number;
  private influentBod: number;
  private effluentBod: number;
  private noiseSeed = Math.random() * 1000;
  private pumpAlarm = false;

  constructor(plant: PlantRuntime) {
    this.plant = plant;
    this.doMgL = plant.isSeptic ? 0 : plant.defaultDo;
    this.mlss = plant.isSeptic ? 0 : plant.defaultMlss;
    this.influentBod = plant.influentBod;
    this.effluentBod = plant.effluentBod;
    this.tankLevel = plant.research.scadaDefaults.tankLevelPct ?? 45;
    const initBlower = plant.isSeptic
      ? 0
      : clamp((plant.research.scadaDefaults.powerKw / Math.max(plant.blowerRatedKw, 1)) * 100 * 0.85, 35, 70);
    this.setpoints = {
      doTarget: plant.isSeptic ? 0 : plant.defaultDo,
      blowerPct: initBlower,
      chemicalDosePct: plant.isSeptic ? 0 : 40,
      pumpSpeedPct: plant.isSeptic ? 60 : 100,
      uvOnline: !plant.isSeptic,
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
    // Demand into tank
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
      uvStatus: 'N/A',
      primaryLevelPct: 0,
      aerationLevelPct: 0,
      secondaryLevelPct: 0,
      tankLevelPct: this.tankLevel,
      pumpAlarmFloat: this.pumpAlarm,
      capacityUtilPct,
      influentBodMgL: this.influentBod,
      effluentBodMgL: this.effluentBod,
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
    const pumpFactor = clamp(sp.pumpSpeedPct / 100, 0.4, 1.25);
    let influent = p.avgDayFlowMld * diu * pumpFactor * (1 + noise);
    influent = clamp(influent, 0.05, p.peakCapacityMld * 1.02);

    const stormPhase = (this.t % 2700) / 2700;
    if (stormPhase > 0.85 && stormPhase < 0.95) {
      influent *= 1.0 + 0.45 * Math.sin(((stormPhase - 0.85) / 0.1) * Math.PI);
    }

    const util = influent / p.designCapacityMld;
    const levelDrive = (util - 0.7) * 18 + (sp.pumpSpeedPct - 100) * 0.08;
    this.primaryLevel = clamp(this.primaryLevel + (levelDrive - (this.primaryLevel - 55) * 0.15) * dt * 0.02, 15, 98);
    this.aerationLevel = clamp(this.aerationLevel + (levelDrive * 0.7 - (this.aerationLevel - 72) * 0.12) * dt * 0.02, 25, 97);
    this.secondaryLevel = clamp(
      this.secondaryLevel + (levelDrive * 0.5 - (this.secondaryLevel - 48) * 0.1 - (sp.chemicalDosePct - 40) * 0.01) * dt * 0.02,
      20,
      95,
    );

    const otr = (sp.blowerPct / 100) * 4.8;
    const our = (this.mlss / 3000) * (influent / Math.max(p.avgDayFlowMld, 0.1)) * 3.2;
    const doError = sp.doTarget - this.doMgL;
    const autoTrim = doError * 0.35 * (sp.blowerPct / 100);
    this.doMgL = clamp(this.doMgL + (otr - our + autoTrim) * (dt / 3600) * 60, 0.2, 8);
    if (sp.blowerPct < 15) this.doMgL = clamp(this.doMgL - 0.8 * dt * 0.05, 0.2, 8);

    const growth = util * 12 - (sp.chemicalDosePct / 100) * 4;
    this.mlss = clamp(this.mlss + (growth - (this.mlss - p.defaultMlss) * 0.008) * dt * 0.015, 800, 4500);

    const bodBase = p.influentBod;
    this.influentBod = clamp(bodBase * (0.85 + 0.25 * diu) + 15 * noise, bodBase * 0.6, bodBase * 1.6);
    const removal =
      0.82 + 0.08 * clamp(this.doMgL / 2.0, 0, 1.2) + 0.04 * clamp(sp.chemicalDosePct / 50, 0, 1.2) - (sp.uvOnline ? 0 : 0.05);
    this.effluentBod = clamp(
      this.influentBod * (1 - clamp(removal, 0.5, 0.96)) * 0.35 + p.effluentBod * 0.65,
      Math.max(1, p.effluentBod * 0.4),
      80,
    );

    const blowerKw = (sp.blowerPct / 100) * p.blowerRatedKw * (0.85 + 0.15 * (this.aerationLevel / 100));
    const pumpKw = (sp.pumpSpeedPct / 100) * p.blowerRatedKw * 0.12;
    const chpCredit = p.research.energy.chpKw ? p.research.energy.chpKw * 0.15 : 0;
    const totalKw = Math.max(5, blowerKw + pumpKw - chpCredit * (sp.blowerPct / 100) * 0.2);

    const uvOk = sp.uvOnline;
    let effluent = influent * (0.97 + 0.01 * (sp.chemicalDosePct / 100));
    if (!uvOk) effluent *= 0.98;
    if (this.secondaryLevel > 92) effluent *= 1.05;

    const capacityUtilPct = (influent / p.designCapacityMld) * 100;
    const alarms: Alarm[] = [];
    if (this.doMgL < 1.0) alarms.push({ id: 'do_low', severity: 'alarm', message: `DO LOW ${this.doMgL.toFixed(1)} mg/L` });
    else if (this.doMgL < 1.5) alarms.push({ id: 'do_warn', severity: 'warn', message: `DO marginal ${this.doMgL.toFixed(1)} mg/L` });
    if (this.primaryLevel > 90 || this.aerationLevel > 92 || this.secondaryLevel > 90) {
      alarms.push({ id: 'overflow', severity: 'alarm', message: 'OVERFLOW RISK — high tank level' });
    }
    if (!uvOk && influent > 0.2) alarms.push({ id: 'uv_flow', severity: 'alarm', message: 'UV OFFLINE with flow on plant' });
    if (capacityUtilPct > 100) alarms.push({ id: 'cap_exceed', severity: 'alarm', message: `CAPACITY EXCEED ${capacityUtilPct.toFixed(0)}%` });
    else if (capacityUtilPct > 90) alarms.push({ id: 'cap_warn', severity: 'warn', message: `Near capacity ${capacityUtilPct.toFixed(0)}%` });
    if (this.mlss > 4000) alarms.push({ id: 'mlss_high', severity: 'warn', message: `MLSS high ${this.mlss.toFixed(0)} mg/L` });

    const shiftElapsed = this.t - this.shiftStart;
    return {
      timeSec: this.t,
      shiftElapsedSec: shiftElapsed,
      influentFlowMld: influent,
      effluentFlowMld: effluent,
      doMgL: this.doMgL,
      mlssMgL: this.mlss,
      blowerKw: totalKw,
      uvStatus: uvOk ? 'ONLINE' : 'OFFLINE',
      primaryLevelPct: p.hasPrimary ? this.primaryLevel : 0,
      aerationLevelPct: this.aerationLevel,
      secondaryLevelPct: this.secondaryLevel,
      tankLevelPct: 0,
      pumpAlarmFloat: false,
      capacityUtilPct,
      influentBodMgL: this.influentBod,
      effluentBodMgL: this.effluentBod,
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
