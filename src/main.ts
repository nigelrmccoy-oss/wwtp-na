import './style.css';
import { mountMenu } from './ui/menu';
import { ScadaOverlay, type SimSpeed } from './ui/scada';
import { PlantScene } from './world/plantScene';
import { ProcessModel } from './sim/processModel';
import { audio } from './audio/AudioEngine';
import { loadPlantTextures } from './world/textures';
import { loadPlantGeo } from './world/osmBake';
import { Autopilot } from './sim/autopilot';
import { HoverTip } from './ui/hoverTip';
import { maybeShowFirstRunTutorial } from './ui/tutorial';
import { LayoutOverlay } from './ui/layoutOverlay';
import { getCesiumScaffoldStatus, mountCesiumScaffold } from './world/cesiumLayer';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const menuHost = document.getElementById('menu')!;
const hudHost = document.getElementById('hud')!;
const hintEl = document.getElementById('camHint')!;

let scene: PlantScene | null = null;
let model: ProcessModel | null = null;
let scada: ScadaOverlay | null = null;
let hoverTip: HoverTip | null = null;
let layoutOverlay: LayoutOverlay | null = null;
let autopilot: Autopilot | null = null;
let raf = 0;
let last = performance.now();
let simAccum = 0;
let onSite = false;
/** Default slower for readable training; operator can raise to 4× / 12×. */
let simSpeed: SimSpeed = 4;
let texturesReady = loadPlantTextures();
let lastAlarmIds: string[] = [];

const menu = mountMenu(menuHost, async ({ plant }) => {
  await audio.unlock();
  audio.uiClick();
  teardownRun();
  menu.hide();
  hudHost.classList.remove('hidden');
  hintEl.classList.remove('hidden');
  document.getElementById('modeBadge')?.classList.remove('hidden');
  onSite = true;
  simSpeed = 4;

  model = new ProcessModel(plant);
  model.resetShift();
  autopilot = new Autopilot();

  layoutOverlay = new LayoutOverlay(hudHost, plant);

  scada = new ScadaOverlay(hudHost, model, {
    simSpeed,
    onSimSpeedChange: (s) => {
      simSpeed = s;
    },
    autopilot,
    onAutopilotChange: (on) => {
      const badge = document.getElementById('apHudBadge');
      if (badge) {
        badge.classList.toggle('hidden', !on);
        badge.textContent = on ? 'AUTOPILOT ON · NORMAL/ECA' : 'AUTOPILOT';
      }
    },
    onOverlayToggle: (on) => {
      layoutOverlay?.setEnabled(on);
      const ob = document.getElementById('overlayHudBadge');
      ob?.classList.toggle('hidden', !on);
    },
  });

  hoverTip = new HoverTip(hudHost, (ids) => scada?.focusControls(ids));

  const modeBadge = document.getElementById('modeBadge');
  const setModeBadge = (mode: 'orbit' | 'walk') => {
    if (!modeBadge) return;
    modeBadge.textContent = mode === 'walk' ? 'WALK' : 'ORBIT';
    modeBadge.dataset.mode = mode;
  };
  const setCamCycleBadge = (label: string) => {
    let el = document.getElementById('camCycleBadge');
    if (!el) {
      el = document.createElement('div');
      el.id = 'camCycleBadge';
      el.className = 'cam-cycle-badge';
      document.getElementById('app')!.appendChild(el);
    }
    el.textContent = `CAM ${label}`;
    el.classList.remove('hidden');
  };

  const [textures, geo] = await Promise.all([texturesReady, loadPlantGeo(plant.id)]);

  scene = new PlantScene(
    canvas,
    plant,
    (unit) => {
      scada?.setSelectedUnit(unit?.label ?? null);
      if (unit) audio.uiClick();
    },
    setModeBadge,
    {
      textures,
      geo,
      onHover: (unit, x, y) => {
        if (!hoverTip) return;
        if (!unit) hoverTip.hide();
        else hoverTip.show(unit.id, unit.label, x, y);
      },
      onCamCycleChange: setCamCycleBadge,
    },
  );
  setModeBadge('orbit');
  setCamCycleBadge(scene.getCamCycleLabel());

  // Attribution footer (OSM only — DEM has its own HUD badge)
  let attr = document.getElementById('geoAttr');
  if (!attr) {
    attr = document.createElement('div');
    attr.id = 'geoAttr';
    attr.className = 'geo-attr';
    document.getElementById('app')!.appendChild(attr);
  }
  const osmOnly = (scene.attribution || '© OpenStreetMap contributors').split('·')[0].trim();
  attr.textContent = osmOnly || '© OpenStreetMap contributors';
  attr.classList.remove('hidden');

  // DEM source HUD badge (procedural vs Open-Meteo)
  let demHud = document.getElementById('demHudBadge');
  if (!demHud) {
    demHud = document.createElement('div');
    demHud.id = 'demHudBadge';
    demHud.className = 'dem-hud-badge';
    document.getElementById('app')!.appendChild(demHud);
  }
  const demSrc = scene.demSource || '';
  const procedural = /procedural|noise/i.test(demSrc);
  demHud.textContent = procedural ? 'DEM: procedural' : 'DEM: Open-Meteo';
  demHud.dataset.source = procedural ? 'procedural' : 'open-meteo';
  demHud.classList.remove('hidden');
  demHud.title = demSrc || demHud.textContent;

  // Autopilot HUD badge — meaning: ON = keep NORMAL / meet ECA
  let apHud = document.getElementById('apHudBadge');
  if (!apHud) {
    apHud = document.createElement('div');
    apHud.id = 'apHudBadge';
    apHud.className = 'ap-hud-badge hidden';
    apHud.title = 'SCADA Autopilot ON = auto keep NORMAL / meet ECA; OFF = manual';
    document.getElementById('app')!.appendChild(apHud);
  }
  apHud.textContent = 'AUTOPILOT ON · NORMAL/ECA';
  apHud.classList.add('hidden');

  // GIS snap HUD
  let gisHud = document.getElementById('gisHudBadge');
  if (!gisHud) {
    gisHud = document.createElement('div');
    gisHud.id = 'gisHudBadge';
    gisHud.className = 'gis-hud-badge';
    document.getElementById('app')!.appendChild(gisHud);
  }
  gisHud.textContent = scene.gisUsed ? 'GIS: footprint snap' : 'GIS: schematic';
  gisHud.dataset.mode = scene.gisUsed ? 'snap' : 'schematic';
  gisHud.title = scene.gisSummary || gisHud.textContent;
  gisHud.classList.remove('hidden');

  // Cesium scaffold (feature-flagged; Ion token from .env.local — never committed)
  document.getElementById('cesiumScaffoldBadge')?.remove();
  const cesiumHost = document.getElementById('app');
  const unmountCesium = mountCesiumScaffold(cesiumHost, {
    lat: plant.approxLat,
    lon: plant.approxLon,
  });
  (window as unknown as { __wwtpUnmountCesium?: () => void }).__wwtpUnmountCesium = unmountCesium;
  const cesiumStatus = getCesiumScaffoldStatus();
  void cesiumStatus;

  let ovHud = document.getElementById('overlayHudBadge');
  if (!ovHud) {
    ovHud = document.createElement('div');
    ovHud.id = 'overlayHudBadge';
    ovHud.className = 'overlay-hud-badge hidden';
    ovHud.textContent = 'OVERLAY';
    document.getElementById('app')!.appendChild(ovHud);
  }
  ovHud.classList.add('hidden');

  audio.startAmbience();

  last = performance.now();
  simAccum = 0;
  let lastState: import('./sim/processModel').SimState | null = null;
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    const dtWall = Math.min(0.05, (now - last) / 1000);
    last = now;
    const simDt = dtWall * simSpeed;
    simAccum += simDt;
    if (model && scada && simAccum > 0) {
      const stepped = simAccum;
      simAccum = 0;
      // Autopilot adjusts setpoints from prior state, then step applies them
      if (lastState) autopilot?.tick(model, lastState, stepped);
      const state = model.step(stepped);
      lastState = state;
      scada.update(state);
      lastAlarmIds = state.alarms.map((a) => a.id);
      if (layoutOverlay && scene) {
        layoutOverlay.update(state, scene.getOverlayAnchors(canvas));
      }
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
  hoverTip?.destroy();
  hoverTip = null;
  layoutOverlay?.destroy();
  layoutOverlay = null;
  autopilot = null;
  model = null;
  lastAlarmIds = [];
  hudHost.querySelectorAll('.scada-window').forEach((n) => n.remove());
  document.getElementById('geoAttr')?.classList.add('hidden');
  document.getElementById('demHudBadge')?.classList.add('hidden');
  document.getElementById('apHudBadge')?.classList.add('hidden');
  document.getElementById('overlayHudBadge')?.classList.add('hidden');
  document.getElementById('camCycleBadge')?.classList.add('hidden');
  document.getElementById('gisHudBadge')?.classList.add('hidden');
  document.getElementById('cesiumScaffoldBadge')?.remove();
  const u = (window as unknown as { __wwtpUnmountCesium?: () => void }).__wwtpUnmountCesium;
  u?.();
}

function showMenu(): void {
  teardownRun();
  hudHost.classList.add('hidden');
  hintEl.classList.add('hidden');
  document.getElementById('modeBadge')?.classList.add('hidden');
  document.getElementById('camCycleBadge')?.classList.add('hidden');
  menu.show();
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    showMenu();
    return;
  }
  if (!onSite) return;
  // Ignore when typing in inputs
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
    return;
  }
  if (e.code === 'KeyO') {
    const on = layoutOverlay?.toggle() ?? false;
    scada?.setOverlayChecked(on);
    document.getElementById('overlayHudBadge')?.classList.toggle('hidden', !on);
  }
  if (e.code === 'BracketRight') {
    scada?.cycleSimSpeed(1);
    audio.uiClick();
  }
  if (e.code === 'BracketLeft') {
    scada?.cycleSimSpeed(-1);
    audio.uiClick();
  }
  if (e.code === 'KeyA') {
    if (model && lastAlarmIds.length) {
      model.acknowledgeAlarms(lastAlarmIds);
      audio.uiClick();
    }
  }
  if (e.code === 'KeyF') {
    // Focus selected / first playable unit
    const playable = scene?.units.filter((u) => !u.id.startsWith('osm_')) ?? [];
    const selLabel = document.querySelector('#scadaUnit')?.textContent;
    const match = playable.find((u) => u.label === selLabel) ?? playable[0] ?? null;
    if (match) {
      scene?.focusUnit(match);
      audio.uiClick();
    }
  }
  if (e.code === 'Tab') {
    e.preventDefault();
    const u = scene?.cycleUnitFocus() ?? null;
    if (u) {
      scada?.setSelectedUnit(u.label);
      audio.uiClick();
    }
  }
  if (e.code === 'KeyZ') {
    const on = scada?.toggleAutopilot() ?? false;
    const badge = document.getElementById('apHudBadge');
    if (badge) {
      badge.classList.toggle('hidden', !on);
      badge.textContent = on ? 'AUTOPILOT ON · NORMAL/ECA' : 'AUTOPILOT';
    }
    audio.uiClick();
  }
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
document.getElementById('modeBadge')?.classList.add('hidden');

// First-run acronym tutorial (skippable)
maybeShowFirstRunTutorial();
