import './style.css';
import { mountMenu } from './ui/menu';
import { ScadaOverlay } from './ui/scada';
import { PlantScene } from './world/plantScene';
import { ProcessModel } from './sim/processModel';
import { audio } from './audio/AudioEngine';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const menuHost = document.getElementById('menu')!;
const hudHost = document.getElementById('hud')!;
const hintEl = document.getElementById('camHint')!;

let scene: PlantScene | null = null;
let model: ProcessModel | null = null;
let scada: ScadaOverlay | null = null;
let raf = 0;
let last = performance.now();
let simAccum = 0;
let onSite = false;

const menu = mountMenu(menuHost, async ({ plant }) => {
  await audio.unlock();
  audio.uiClick();
  teardownRun();
  menu.hide();
  hudHost.classList.remove('hidden');
  hintEl.classList.remove('hidden');
  onSite = true;

  model = new ProcessModel(plant);
  model.resetShift();
  scada = new ScadaOverlay(hudHost, model);

  scene = new PlantScene(canvas, plant, (unit) => {
    scada?.setSelectedUnit(unit?.label ?? null);
    if (unit) audio.uiClick();
  });

  audio.startAmbience();

  last = performance.now();
  simAccum = 0;
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    const dtWall = Math.min(0.05, (now - last) / 1000);
    last = now;
    const simDt = dtWall * 12;
    simAccum += simDt;
    if (model && scada && simAccum > 0) {
      const state = model.step(simAccum);
      simAccum = 0;
      scada.update(state);
      if (onSite) {
        audio.setPlantLevels({
          pumpSpeedPct: model.setpoints.pumpSpeedPct,
          blowerPct: model.setpoints.blowerPct,
          influentFlowNorm: state.influentFlowMld / Math.max(model.plant.avgDayFlowMld, 1e-6),
          hasAlarm: state.alarms.some((a) => a.severity === 'alarm'),
          septic: model.plant.isSeptic,
        });
      }
    }
  };
  raf = requestAnimationFrame(tick);
});

function teardownRun(): void {
  cancelAnimationFrame(raf);
  onSite = false;
  audio.stopAll();
  scene?.dispose();
  scene = null;
  scada?.destroy();
  scada = null;
  model = null;
  hudHost.querySelectorAll('.scada-window').forEach((n) => n.remove());
}

function showMenu(): void {
  teardownRun();
  hudHost.classList.add('hidden');
  hintEl.classList.add('hidden');
  menu.show();
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') showMenu();
});

const unlockOnce = () => {
  void audio.unlock();
  window.removeEventListener('pointerdown', unlockOnce);
  window.removeEventListener('keydown', unlockOnce);
};
window.addEventListener('pointerdown', unlockOnce);
window.addEventListener('keydown', unlockOnce);

menu.show();
hudHost.classList.add('hidden');
hintEl.classList.add('hidden');
