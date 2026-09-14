/**
 * Solid procedural Web Audio SFX for WWTP-NA.
 * Optional override: drop files in public/sfx/ (pumpHum, waterFlow, blower, alarm, uiClick, scadaTick .ogg|.wav).
 */

type LoopId = 'pumpHum' | 'waterFlow' | 'blower' | 'alarm';
type OneShotId = 'uiClick' | 'scadaTick';

const LOOP_FILES: Record<LoopId, string[]> = {
  pumpHum: ['sfx/pumpHum.ogg', 'sfx/pumpHum.wav'],
  waterFlow: ['sfx/waterFlow.ogg', 'sfx/waterFlow.wav'],
  blower: ['sfx/blower.ogg', 'sfx/blower.wav'],
  alarm: ['sfx/alarm.ogg', 'sfx/alarm.wav'],
};

const ONESHOT_FILES: Record<OneShotId, string[]> = {
  uiClick: ['sfx/uiClick.ogg', 'sfx/uiClick.wav'],
  scadaTick: ['sfx/scadaTick.ogg', 'sfx/scadaTick.wav'],
};

interface LoopVoice {
  gain: GainNode;
  source: AudioBufferSourceNode | OscillatorNode | null;
  extras: AudioNode[];
  procedural: boolean;
  buffer: AudioBuffer | null;
  started: boolean;
  baseFreq?: number;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled = false;
  private loops = new Map<LoopId, LoopVoice>();
  private oneshots = new Map<OneShotId, AudioBuffer | null>();
  private alarmActive = false;
  private lastTick = 0;

  async unlock(): Promise<void> {
    const ctx = this.ensureCtx();
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch { /* ignore */ }
    }
    if (!this.enabled) {
      await this.prepare();
      // Enable once context is running (or after resume attempt)
      if (ctx.state === 'running' || ctx.state === 'suspended') {
        this.enabled = ctx.state === 'running';
        if (!this.enabled) {
          try {
            await ctx.resume();
            this.enabled = ctx.state === 'running';
          } catch { /* ignore */ }
        }
      }
    } else if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch { /* ignore */ }
    }
  }

  async prepare(): Promise<void> {
    const ctx = this.ensureCtx();
    for (const id of Object.keys(LOOP_FILES) as LoopId[]) {
      if (this.loops.has(id)) continue;
      const buf = await this.tryLoad(LOOP_FILES[id]);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(this.master!);
      this.loops.set(id, { gain, source: null, extras: [], procedural: !buf, buffer: buf, started: false });
    }
    for (const id of Object.keys(ONESHOT_FILES) as OneShotId[]) {
      if (!this.oneshots.has(id)) this.oneshots.set(id, await this.tryLoad(ONESHOT_FILES[id]));
    }
  }

  startAmbience(): void {
    if (!this.enabled) return;
    this.ensureLoop('pumpHum');
    this.ensureLoop('waterFlow');
    this.ensureLoop('blower');
    this.fade('pumpHum', 0.14, 1.0);
    this.fade('waterFlow', 0.11, 1.0);
    this.fade('blower', 0.06, 1.0);
  }

  stopAll(): void {
    for (const id of this.loops.keys()) this.fade(id, 0, 0.35);
    this.alarmActive = false;
  }

  setPlantLevels(opts: {
    pumpSpeedPct: number;
    blowerPct: number;
    influentFlowNorm: number;
    hasAlarm: boolean;
    septic?: boolean;
  }): void {
    // Resume AudioContext if browser suspended it — required for audible alarm buzzers
    if (opts.hasAlarm) {
      void this.unlock();
    }
    if (!this.enabled || !this.ctx) return;
    const pump = clamp((opts.pumpSpeedPct - 20) / 100, 0, 1);
    const blow = opts.septic ? 0 : clamp(opts.blowerPct / 100, 0, 1);
    const flow = clamp(opts.influentFlowNorm, 0.1, 1.4);

    this.fade('pumpHum', 0.05 + pump * 0.28, 0.2);
    this.fade('waterFlow', 0.04 + flow * 0.2, 0.3);
    this.fade('blower', opts.septic ? 0 : 0.02 + blow * 0.32, 0.18);

    this.modulateProcedural('pumpHum', 48 + pump * 28, 180 + pump * 80);
    this.modulateProcedural('blower', 95 + blow * 160, 350 + blow * 400);
    this.modulateProcedural('waterFlow', 0, 500 + flow * 400);

    if (opts.hasAlarm && !this.alarmActive) {
      this.alarmActive = true;
      this.ensureLoop('alarm');
      // Louder than ambience so operators hear the buzzer in playtest / training
      this.fade('alarm', 0.55, 0.03);
    } else if (opts.hasAlarm && this.alarmActive) {
      // Keep gain up if unlock completed after first fire
      this.fade('alarm', 0.55, 0.08);
    } else if (!opts.hasAlarm && this.alarmActive) {
      this.alarmActive = false;
      this.fade('alarm', 0, 0.25);
    }
  }

  uiClick(): void {
    void this.unlock().then(() => this.playOneShot('uiClick', 0.28));
  }

  scadaTick(): void {
    const now = performance.now();
    if (now - this.lastTick < 40) return;
    this.lastTick = now;
    this.playOneShot('scadaTick', 0.1);
  }

  private modulateProcedural(id: LoopId, freq: number, filterFreq: number): void {
    const voice = this.loops.get(id);
    if (!voice?.procedural || !this.ctx) return;
    const t = this.ctx.currentTime;
    if (voice.source && 'frequency' in voice.source && freq > 0) {
      (voice.source as OscillatorNode).frequency.setTargetAtTime(freq, t, 0.12);
    }
    for (const n of voice.extras) {
      if (n instanceof BiquadFilterNode && filterFreq > 0) {
        n.frequency.setTargetAtTime(filterFreq, t, 0.15);
      }
    }
  }

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.65;
      this.master.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  private async tryLoad(paths: string[]): Promise<AudioBuffer | null> {
    const ctx = this.ensureCtx();
    for (const path of paths) {
      try {
        const url = import.meta.env.BASE_URL + path.replace(/^\//, '');
        const res = await fetch(url);
        if (!res.ok) continue;
        const ab = await res.arrayBuffer();
        return await ctx.decodeAudioData(ab.slice(0));
      } catch { /* next */ }
    }
    return null;
  }

  private ensureLoop(id: LoopId): void {
    const voice = this.loops.get(id);
    const ctx = this.ctx;
    if (!voice || !ctx || voice.started) return;
    if (voice.buffer) {
      const src = ctx.createBufferSource();
      src.buffer = voice.buffer;
      src.loop = true;
      src.connect(voice.gain);
      src.start();
      voice.source = src;
    } else {
      this.startProcedural(id, voice);
    }
    voice.started = true;
  }

  private startProcedural(id: LoopId, voice: LoopVoice): void {
    const ctx = this.ctx!;
    if (id === 'pumpHum') {
      // Deep motor rumble: detuned saws + slow AM
      const o1 = ctx.createOscillator();
      o1.type = 'sawtooth';
      o1.frequency.value = 55;
      const o2 = ctx.createOscillator();
      o2.type = 'sawtooth';
      o2.frequency.value = 57.5;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 200;
      lp.Q.value = 0.8;
      const am = ctx.createGain();
      am.gain.value = 0.7;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 2.1;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 0.25;
      lfo.connect(lfoG);
      lfoG.connect(am.gain);
      const mix = ctx.createGain();
      mix.gain.value = 0.45;
      o1.connect(mix);
      o2.connect(mix);
      mix.connect(lp);
      lp.connect(am);
      am.connect(voice.gain);
      o1.start(); o2.start(); lfo.start();
      voice.source = o1;
      voice.extras = [o2, lp, am, lfo, lfoG, mix];
    } else if (id === 'blower') {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 110;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 380;
      bp.Q.value = 0.6;
      const noise = ctx.createBufferSource();
      noise.buffer = this.makeNoiseBuffer(2.5);
      noise.loop = true;
      const nHp = ctx.createBiquadFilter();
      nHp.type = 'highpass';
      nHp.frequency.value = 700;
      const nG = ctx.createGain();
      nG.gain.value = 0.4;
      noise.connect(nHp); nHp.connect(nG); nG.connect(voice.gain);
      osc.connect(bp); bp.connect(voice.gain);
      osc.start(); noise.start();
      voice.source = osc;
      voice.extras = [bp, noise, nHp, nG];
    } else if (id === 'waterFlow') {
      const noise = ctx.createBufferSource();
      noise.buffer = this.makeNoiseBuffer(3.5);
      noise.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 620;
      bp.Q.value = 0.45;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.28;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 220;
      lfo.connect(lfoG); lfoG.connect(bp.frequency);
      const g = ctx.createGain();
      g.gain.value = 0.55;
      noise.connect(bp); bp.connect(g); g.connect(voice.gain);
      noise.start(); lfo.start();
      voice.source = null;
      voice.extras = [noise, bp, lfo, lfoG, g];
    } else if (id === 'alarm') {
      // Dual-tone industrial buzzer (audible over plant ambience)
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 880;
      const osc2 = ctx.createOscillator();
      osc2.type = 'square';
      osc2.frequency.value = 660;
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 3.5;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 320;
      lfo.connect(lfoG); lfoG.connect(osc.frequency);
      const g = ctx.createGain();
      g.gain.value = 0.85;
      const g2 = ctx.createGain();
      g2.gain.value = 0.45;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 350;
      osc.connect(hp); hp.connect(g); g.connect(voice.gain);
      osc2.connect(g2); g2.connect(voice.gain);
      osc.start(); osc2.start(); lfo.start();
      voice.source = osc;
      voice.extras = [osc2, lfo, lfoG, g, g2, hp];
    }
  }

  private makeNoiseBuffer(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      // Slightly brown-ish noise for less harsh loops
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    return buf;
  }

  private fade(id: LoopId, level: number, tau: number): void {
    const voice = this.loops.get(id);
    if (!voice || !this.ctx) return;
    this.ensureLoop(id);
    voice.gain.gain.setTargetAtTime(level, this.ctx.currentTime, Math.max(0.02, tau / 3));
  }

  private playOneShot(id: OneShotId, gain: number): void {
    if (!this.enabled || !this.ctx || !this.master) return;
    const buf = this.oneshots.get(id) ?? null;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    g.connect(this.master);
    if (buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(g);
      src.start();
      return;
    }
    const osc = this.ctx.createOscillator();
    const eg = this.ctx.createGain();
    const t = this.ctx.currentTime;
    if (id === 'uiClick') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(720, t);
      osc.frequency.exponentialRampToValueAtTime(280, t + 0.05);
      eg.gain.setValueAtTime(0.5, t);
      eg.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      osc.start(t); osc.stop(t + 0.08);
    } else {
      osc.type = 'sine';
      osc.frequency.value = 1400;
      eg.gain.setValueAtTime(0.22, t);
      eg.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
      osc.start(t); osc.stop(t + 0.04);
    }
    osc.connect(eg); eg.connect(g);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export const audio = new AudioEngine();
