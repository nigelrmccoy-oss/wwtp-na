/**
 * Three.js plant site scene — v0.3: GIS footprint snap, DEM carve, photoreal basins.
 */
import * as THREE from 'three';
import type { PlantConfig } from '../sim/processModel';
import type { PlantTextures } from './textures';
import {
  concreteMat,
  weatheredConcreteMat,
  asphaltMat,
  waterMat,
  metalMat,
  paintedMetalMat,
} from './textures';
import {
  buildTerrainGround,
  demFromGeoPack,
  groundY,
  computePadGrade,
  type DemData,
  type TerrainOpts,
} from './terrain';
import { buildOsmSurroundings, type PlantGeoPack } from './osmBake';
import { buildGisLayout, type GisLayoutResult, type GisUnitSnap } from './gisLayout';

export interface UnitInfo {
  id: string;
  label: string;
  mesh: THREE.Object3D;
}

export type UnitSelectCb = (unit: UnitInfo | null) => void;
export type UnitHoverCb = (unit: UnitInfo | null, clientX: number, clientY: number) => void;

export interface PlantSceneOpts {
  textures: PlantTextures;
  geo: PlantGeoPack | null;
  onHover?: UnitHoverCb;
  onCamCycleChange?: (label: string) => void;
}

export class PlantScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly units: UnitInfo[] = [];
  attribution = '';
  demSource = '';
  gisSummary = '';
  gisUsed = false;

  private root: THREE.Group;
  private processRoot: THREE.Group;
  private keys = new Set<string>();
  private yaw = 0.6;
  private pitch = -0.42;
  private orbitTarget = new THREE.Vector3(0, 0, 0);
  private orbitDist = 55;
  private mode: 'orbit' | 'walk' = 'orbit';
  /** V-key cycle: bird's-eye → nadir → walk-through */
  private camCycle: 0 | 1 | 2 = 0;
  private walkPos = new THREE.Vector3(40, 2.2, 55);
  private focusIndex = -1;
  private onCamCycleChange: ((label: string) => void) | null = null;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private selected: UnitInfo | null = null;
  private selectionRing: THREE.Mesh;
  private onSelect: UnitSelectCb;
  private onHover: UnitHoverCb | null;
  private clock = new THREE.Clock();
  private disposed = false;
  private plant: PlantConfig;
  private animId = 0;
  private onKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private onKeyUp: ((e: KeyboardEvent) => void) | null = null;
  private onModeChange: ((mode: 'orbit' | 'walk') => void) | null = null;
  private pointerDownX = 0;
  private pointerDownY = 0;
  private pointerMoved = false;
  private textures: PlantTextures;
  private gis: GisLayoutResult | null = null;
  private dem: DemData | null = null;
  private padGrade = 0;
  private terrainOpts: TerrainOpts = { padW: 110, padD: 80 };
  private readonly eyeHeight = 1.7;
  private mats: {
    concrete: THREE.MeshStandardMaterial;
    concreteAlt: THREE.MeshStandardMaterial;
    weathered: THREE.MeshStandardMaterial;
    asphalt: THREE.MeshStandardMaterial;
    walk: THREE.MeshStandardMaterial;
    water: THREE.MeshPhysicalMaterial;
    waterDeep: THREE.MeshPhysicalMaterial;
    metal: THREE.MeshStandardMaterial;
    digester: THREE.MeshStandardMaterial;
    roof: THREE.MeshStandardMaterial;
    painted: THREE.MeshStandardMaterial;
  };

  constructor(
    canvas: HTMLCanvasElement,
    plant: PlantConfig,
    onSelect: UnitSelectCb,
    onModeChange?: (mode: 'orbit' | 'walk') => void,
    opts?: PlantSceneOpts,
  ) {
    this.plant = plant;
    this.onSelect = onSelect;
    this.onModeChange = onModeChange ?? null;
    this.onHover = opts?.onHover ?? null;
    this.onCamCycleChange = (opts as PlantSceneOpts | undefined)?.onCamCycleChange ?? null;
    this.textures = opts!.textures;

    this.mats = {
      concrete: concreteMat(this.textures, 0xffffff),
      concreteAlt: weatheredConcreteMat(this.textures, 0xe8ecef),
      weathered: weatheredConcreteMat(this.textures, 0xffffff),
      asphalt: asphaltMat(this.textures),
      walk: asphaltMat(this.textures),
      water: waterMat(this.textures, 0xffffff),
      waterDeep: waterMat(this.textures, 0x8eb8d0),
      metal: metalMat(this.textures, 0xffffff),
      digester: paintedMetalMat(this.textures, 0xd0d4d8),
      roof: paintedMetalMat(this.textures, 0x8890a0),
      painted: paintedMetalMat(this.textures, 0xffffff),
    };
    this.mats.walk.color = new THREE.Color(0xb0b4b0);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, false);
    this.renderer.setClearColor(0x7aa0c0, 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x9bb4c8, 0.0015);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.5, 1200);
    this.root = new THREE.Group();
    this.processRoot = new THREE.Group();
    this.processRoot.name = 'process-train';
    this.scene.add(this.root);
    this.root.add(this.processRoot);

    this.selectionRing = new THREE.Mesh(
      new THREE.RingGeometry(1.2, 1.55, 32),
      new THREE.MeshBasicMaterial({ color: 0xffcc33, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }),
    );
    this.selectionRing.rotation.x = -Math.PI / 2;
    this.selectionRing.visible = false;
    this.scene.add(this.selectionRing);

    this.buildEnvironment(opts?.geo ?? null);
    this.buildPlantLayout();
    this.bindInput(canvas);
    this.onResize();
    window.addEventListener('resize', this.onResize);
    this.onModeChange?.(this.mode);

    const loop = () => {
      if (this.disposed) return;
      this.animId = requestAnimationFrame(loop);
      this.update(this.clock.getDelta());
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.animId);
    window.removeEventListener('resize', this.onResize);
    if (this.onKeyDown) window.removeEventListener('keydown', this.onKeyDown);
    if (this.onKeyUp) window.removeEventListener('keyup', this.onKeyUp);
    this.onKeyDown = null;
    this.onKeyUp = null;
    this.renderer.dispose();
  }

  highlightUnit(id: string | null): void {
    const u = id ? this.units.find((x) => x.id === id) ?? null : null;
    this.setSelected(u);
  }

  getMode(): 'orbit' | 'walk' {
    return this.mode;
  }

  getCamCycleLabel(): string {
    return this.camCycle === 0 ? 'BIRD' : this.camCycle === 1 ? 'NADIR' : 'WALK';
  }

  /** Project process-train unit centres to canvas CSS pixels for the layout overlay. */
  getOverlayAnchors(canvas: HTMLCanvasElement): { id: string; label: string; x: number; y: number }[] {
    const rect = canvas.getBoundingClientRect();
    const out: { id: string; label: string; x: number; y: number }[] = [];
    const v = new THREE.Vector3();
    for (const u of this.units) {
      if (u.id.startsWith('osm_') && u.id !== 'osm_wwtp') continue;
      const box = new THREE.Box3().setFromObject(u.mesh);
      box.getCenter(v);
      v.y = box.max.y + 1.5;
      v.project(this.camera);
      const x = (v.x * 0.5 + 0.5) * rect.width;
      const y = (-v.y * 0.5 + 0.5) * rect.height;
      if (v.z < 1 && x > -40 && y > -40 && x < rect.width + 40 && y < rect.height + 40) {
        out.push({ id: u.id, label: u.label, x, y });
      }
    }
    return out;
  }

  /** Focus orbit/walk on a unit (F key / Tab cycle). */
  focusUnit(unit: UnitInfo | null): void {
    if (!unit) return;
    this.setSelected(unit);
    const box = new THREE.Box3().setFromObject(unit.mesh);
    const c = box.getCenter(new THREE.Vector3());
    this.orbitTarget.copy(c);
    this.orbitTarget.y = this.padGrade;
    this.walkPos.set(c.x + 12, this.sampleEyeY(c.x + 12, c.z + 16), c.z + 16);
    if (this.mode === 'orbit' && this.camCycle !== 1) {
      this.orbitDist = clamp(Math.max(box.getSize(new THREE.Vector3()).length() * 1.8, 28), 22, 180);
      this.pitch = -0.55;
    }
  }

  cycleUnitFocus(): UnitInfo | null {
    const playable = this.units.filter((u) => !u.id.startsWith('osm_'));
    if (!playable.length) return null;
    this.focusIndex = (this.focusIndex + 1) % playable.length;
    const u = playable[this.focusIndex];
    this.focusUnit(u);
    return u;
  }

  cycleCameraView(): string {
    this.camCycle = ((this.camCycle + 1) % 3) as 0 | 1 | 2;
    const s = this.plant.layoutScale;
    const span = this.gisUsed && this.gis?.pad ? Math.max(this.gis.pad.w, this.gis.pad.d) : 55 + 36 * s;
    if (this.camCycle === 0) {
      this.mode = 'orbit';
      this.pitch = -0.92;
      this.orbitDist = Math.min(220, span * 0.85);
      this.yaw = 0.55;
    } else if (this.camCycle === 1) {
      this.mode = 'orbit';
      this.pitch = -1.52;
      this.orbitDist = Math.min(200, span * 0.75);
    } else {
      this.mode = 'walk';
      this.pitch = -0.12;
    }
    this.onModeChange?.(this.mode);
    const label = this.getCamCycleLabel();
    this.onCamCycleChange?.(label);
    return label;
  }

  private onResize = (): void => {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  };

  private buildEnvironment(geo: PlantGeoPack | null): void {
    const hemi = new THREE.HemisphereLight(0xd8eaff, 0x3a4a28, 0.85);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2d6, 1.35);
    sun.position.set(90, 120, 55);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 420;
    sun.shadow.camera.left = -200;
    sun.shadow.camera.right = 200;
    sun.shadow.camera.top = 200;
    sun.shadow.camera.bottom = -200;
    sun.shadow.bias = -0.0002;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xb0c8e0, 0.28);
    fill.position.set(-50, 40, -30);
    this.scene.add(fill);
    // Soft ground bounce
    const bounce = new THREE.AmbientLight(0x607080, 0.18);
    this.scene.add(bounce);

    this.gis = buildGisLayout(geo, this.plant.id, {
      primary: this.plant.primaryClarifierCount,
      secondary: this.plant.secondaryClarifierCount,
      aeration: this.plant.aerationBasinCount,
      hasPrimary: this.plant.hasPrimary,
      hasOxidationDitch: this.plant.hasOxidationDitch,
      disinfection: this.plant.disinfectionType,
      uvBanks: this.plant.uvBanks,
      chlorineChannels: this.plant.chlorineContactCount,
    });
    this.gisUsed = this.gis.used;
    this.gisSummary = this.gis.summary;

    const size = this.plant.size;
    const schematicPadW =
      (size === 'xlarge' || size === 'extra-large' ? 140 : size === 'large' ? 125 : 110) *
      this.plant.layoutScale;
    const schematicPadD =
      (size === 'xlarge' || size === 'extra-large' ? 100 : size === 'large' ? 90 : 80) *
      this.plant.layoutScale;

    const padW = this.gis.pad?.w ?? schematicPadW;
    const padD = this.gis.pad?.d ?? schematicPadD;
    const padCx = this.gis.pad?.cx ?? 0;
    const padCz = this.gis.pad?.cz ?? 0;

    const dem = demFromGeoPack(geo);
    this.dem = dem;
    const padGrade = computePadGrade(dem, this.plant.id, padCx, padCz, padW, padD);
    this.padGrade = padGrade;
    this.terrainOpts = {
      padW,
      padD,
      padCx,
      padCz,
      waterMasks: this.gis.waterMasks,
      flattenPad: true,
      padSkirtM: 15,
      padGrade,
    };
    const terrain = buildTerrainGround(this.plant.id, dem, this.textures, this.terrainOpts);
    this.root.add(terrain.group);

    // Process units share the asphalt yard datum
    this.processRoot.position.y = padGrade;

    const osm = buildOsmSurroundings(geo, this.textures, this.plant.id, {
      terrain: this.terrainOpts,
    });
    this.attribution = osm.attribution;
    this.demSource = geo?.dem?.source || geo?.attribution?.dem || osm.attribution;
    this.root.add(osm.group);

    // When GIS snap is active, units are in bake ENU metres — no schematic offset.
    // Otherwise nudge schematic train toward WWTP footprint.
    if (!this.gisUsed && osm.wwtpCentroid && osm.wwtpCentroid.length() < 180) {
      const offset = osm.wwtpCentroid.clone().multiplyScalar(0.35);
      this.processRoot.position.x += offset.x;
      this.processRoot.position.z += offset.z;
      this.processRoot.rotation.y = osm.layoutYaw * 0.5;
    }

    for (const h of osm.hoverables) {
      this.units.push({ id: h.id, label: h.label, mesh: h.mesh });
    }
  }

  private buildPlantLayout(): void {
    if (this.gisUsed && this.gis) {
      this.buildGisPlantLayout(this.gis);
      return;
    }
    this.buildSchematicPlantLayout();
  }

  private buildGisPlantLayout(gis: GisLayoutResult): void {
    for (const snap of gis.snaps) {
      const group = this.meshFromGisSnap(snap);
      if (!group) continue;
      group.position.set(snap.x, 0, snap.z);
      group.rotation.y = snap.yaw;
      group.userData.unitId = snap.id;
      const label = this.makeLabel(snap.label);
      label.position.set(0, 10, 0);
      group.add(label);
      this.processRoot.add(group);
      this.units.push({ id: snap.id, label: snap.label, mesh: group });
    }

    // Process piping + outfall from GIS hints
    this.addPiping(gis.pipingHints);
    if (gis.outfallHint) {
      this.addOutfall(gis.outfallHint.x, gis.outfallHint.z, gis.outfallHint.yaw);
    }

    if (gis.pad) {
      this.orbitTarget.set(gis.pad.cx, this.padGrade, gis.pad.cz);
      const wx = gis.pad.cx + 40;
      const wz = gis.pad.cz + 55;
      this.walkPos.set(wx, this.sampleEyeY(wx, wz), wz);
      this.orbitDist = Math.min(200, Math.max(gis.pad.w, gis.pad.d) * 0.7);
      this.pitch = -0.85;
    }
  }

  private meshFromGisSnap(snap: GisUnitSnap): THREE.Group | null {
    const group = new THREE.Group();
    if (snap.kind === 'cyl' && snap.footprints.length) {
      for (const fp of snap.footprints) {
        const r = Math.sqrt(fp.area / Math.PI);
        const lx = fp.cx - snap.x;
        const lz = fp.cz - snap.z;
        // Un-rotate into group local frame
        const cos = Math.cos(-snap.yaw);
        const sin = Math.sin(-snap.yaw);
        const px = lx * cos - lz * sin;
        const pz = lx * sin + lz * cos;
        this.addWalledClarifier(group, px, pz, r, snap.id === 'digesters' ? 5.5 : 3.2, snap.id);
      }
      return group;
    }
    if (snap.kind === 'basin' && snap.footprints.length) {
      for (const fp of snap.footprints) {
        const lx = fp.cx - snap.x;
        const lz = fp.cz - snap.z;
        const cos = Math.cos(-snap.yaw);
        const sin = Math.sin(-snap.yaw);
        const px = lx * cos - lz * sin;
        const pz = lx * sin + lz * cos;
        this.addOpenBasin(group, px, pz, fp.width * 0.92, fp.depth * 0.92, 3.4, snap.id, fp.yaw - snap.yaw);
      }
      return group;
    }
    if (snap.kind === 'ditch') {
      const R = Math.max(8, (snap.widthM ?? 20) * 0.28);
      const tube = Math.max(2.5, (snap.depthM ?? 12) * 0.12);
      const ditch = new THREE.Mesh(new THREE.TorusGeometry(R, tube, 14, 48), this.mats.weathered);
      ditch.rotation.x = Math.PI / 2;
      ditch.position.y = 1.4;
      ditch.castShadow = true;
      ditch.userData.unitId = snap.id;
      group.add(ditch);
      const water = new THREE.Mesh(new THREE.TorusGeometry(R, tube * 0.82, 12, 48), this.mats.waterDeep);
      water.rotation.x = Math.PI / 2;
      water.position.y = 1.7;
      water.userData.unitId = snap.id;
      group.add(water);
      return group;
    }
    if (snap.kind === 'uv') {
      this.addUvChannel(group, snap.count, snap.id);
      return group;
    }
    if (snap.kind === 'chlorine') {
      this.addChlorineContact(group, snap.count, snap.id);
      return group;
    }
    // Buildings (headworks / solids)
    const w = snap.id === 'solids' ? 22 : 16;
    const d = snap.id === 'solids' ? 14 : 12;
    const h = snap.id === 'solids' ? 7 : 5.5;
    const building = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.mats.weathered);
    building.position.y = h / 2;
    building.castShadow = true;
    building.receiveShadow = true;
    building.userData.unitId = snap.id;
    group.add(building);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.4, d + 0.6), this.mats.roof);
    roof.position.y = h + 0.15;
    roof.userData.unitId = snap.id;
    group.add(roof);
    return group;
  }

  /** Photoreal open-walled clarifier: concrete shell + floor + reflective water + metal weir. */
  private addWalledClarifier(
    group: THREE.Group,
    px: number,
    pz: number,
    r: number,
    h: number,
    unitId: string,
  ): void {
    const wallMat = this.mats.weathered.clone();
    wallMat.side = THREE.DoubleSide;
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 48, 1, true), wallMat);
    wall.position.set(px, h / 2, pz);
    wall.castShadow = true;
    wall.receiveShadow = true;
    wall.userData.unitId = unitId;
    group.add(wall);

    const floor = new THREE.Mesh(new THREE.CircleGeometry(r * 0.99, 48), this.mats.concrete);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(px, 0.06, pz);
    floor.receiveShadow = true;
    floor.userData.unitId = unitId;
    group.add(floor);

    const waterH = h * 0.78;
    // Surface disc (reads wet from above) + volume cylinder
    const waterVol = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.94, r * 0.94, waterH, 48),
      this.mats.waterDeep,
    );
    waterVol.position.set(px, waterH / 2 + 0.08, pz);
    waterVol.userData.unitId = unitId;
    group.add(waterVol);

    const surface = new THREE.Mesh(new THREE.CircleGeometry(r * 0.93, 48), this.mats.water);
    surface.rotation.x = -Math.PI / 2;
    surface.position.set(px, waterH + 0.1, pz);
    surface.userData.unitId = unitId;
    group.add(surface);

    const rim = new THREE.Mesh(new THREE.RingGeometry(r * 0.94, r * 1.04, 48), this.mats.concrete);
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(px, h - 0.04, pz);
    rim.userData.unitId = unitId;
    group.add(rim);

    // Walkway / launder ring
    const launder = new THREE.Mesh(
      new THREE.TorusGeometry(r * 0.88, 0.18, 8, 48),
      this.mats.metal,
    );
    launder.rotation.x = Math.PI / 2;
    launder.position.set(px, h * 0.92, pz);
    launder.userData.unitId = unitId;
    group.add(launder);

    // Centre bridge
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(r * 1.7, 0.25, 1.1), this.mats.painted);
    bridge.position.set(px, h + 0.15, pz);
    bridge.castShadow = true;
    bridge.userData.unitId = unitId;
    group.add(bridge);
  }

  private addOpenBasin(
    group: THREE.Group,
    px: number,
    pz: number,
    w: number,
    d: number,
    h: number,
    unitId: string,
    yaw = 0,
  ): void {
    const g = new THREE.Group();
    g.position.set(px, 0, pz);
    g.rotation.y = yaw;

    // Floor
    const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 0.25, d), this.mats.concrete);
    floor.position.y = 0.12;
    floor.receiveShadow = true;
    floor.userData.unitId = unitId;
    g.add(floor);

    // Four walls (open top)
    const t = 0.45;
    const wallMat = this.mats.weathered;
    const walls: [number, number, number, number, number, number][] = [
      [w, h, t, 0, h / 2, d / 2],
      [w, h, t, 0, h / 2, -d / 2],
      [t, h, d, w / 2, h / 2, 0],
      [t, h, d, -w / 2, h / 2, 0],
    ];
    for (const [bw, bh, bd, x, y, z] of walls) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), wallMat);
      wall.position.set(x, y, z);
      wall.castShadow = true;
      wall.receiveShadow = true;
      wall.userData.unitId = unitId;
      g.add(wall);
    }

    const waterH = h * 0.72;
    const waterVol = new THREE.Mesh(
      new THREE.BoxGeometry(w - t * 2.2, waterH, d - t * 2.2),
      this.mats.waterDeep,
    );
    waterVol.position.y = waterH / 2 + 0.2;
    waterVol.userData.unitId = unitId;
    g.add(waterVol);

    const surface = new THREE.Mesh(
      new THREE.PlaneGeometry(w - t * 2.4, d - t * 2.4),
      this.mats.water,
    );
    surface.rotation.x = -Math.PI / 2;
    surface.position.y = waterH + 0.22;
    surface.userData.unitId = unitId;
    g.add(surface);

    // Diffuser / baffle hints
    for (let i = 0; i < 3; i++) {
      const baffle = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, h * 0.55, d * 0.7),
        this.mats.concreteAlt,
      );
      baffle.position.set(-w * 0.25 + i * (w * 0.25), h * 0.35, 0);
      baffle.userData.unitId = unitId;
      g.add(baffle);
    }

    group.add(g);
  }

  private addUvChannel(group: THREE.Group, count: number, unitId: string): void {
    const channel = new THREE.Mesh(
      new THREE.BoxGeometry(10 + count * 1.5, 2.2, 6),
      this.mats.weathered,
    );
    channel.position.y = 1.1;
    channel.castShadow = true;
    channel.userData.unitId = unitId;
    group.add(channel);
    const water = new THREE.Mesh(new THREE.BoxGeometry(9 + count * 1.4, 0.12, 5), this.mats.water);
    water.position.set(0, 1.95, 0);
    water.userData.unitId = unitId;
    group.add(water);
    for (let i = 0; i < count; i++) {
      const lamp = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.3, 5),
        new THREE.MeshStandardMaterial({
          color: 0xaaccff,
          emissive: 0x3355aa,
          emissiveIntensity: 0.45,
          map: this.textures.metal,
          metalness: 0.5,
          roughness: 0.3,
        }),
      );
      lamp.position.set(-3 + i * 2.2, 2.0, 0);
      lamp.userData.unitId = unitId;
      group.add(lamp);
    }
  }

  private addChlorineContact(group: THREE.Group, count: number, unitId: string): void {
    const n = Math.max(1, count);
    const channel = new THREE.Mesh(new THREE.BoxGeometry(10 + n * 1.2, 2.4, 8), this.mats.weathered);
    channel.position.y = 1.2;
    channel.castShadow = true;
    channel.userData.unitId = unitId;
    group.add(channel);
    for (let i = 0; i < n; i++) {
      const baffle = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.6, 6.5), this.mats.concrete);
      baffle.position.set(-3.5 + i * 2.4, 1.5, 0);
      baffle.userData.unitId = unitId;
      group.add(baffle);
    }
    const water = new THREE.Mesh(new THREE.BoxGeometry(9 + n * 1.1, 0.12, 7), this.mats.water);
    water.position.set(0, 2.15, 0);
    water.userData.unitId = unitId;
    group.add(water);
  }

  private addPiping(hints: { x0: number; z0: number; x1: number; z1: number }[]): void {
    const mat = this.mats.painted.clone();
    mat.color = new THREE.Color(0x5a6a4a);
    for (const seg of hints) {
      const dx = seg.x1 - seg.x0;
      const dz = seg.z1 - seg.z0;
      const len = Math.hypot(dx, dz);
      if (len < 2) continue;
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, len, 10), mat);
      pipe.position.set((seg.x0 + seg.x1) / 2, 1.1, (seg.z0 + seg.z1) / 2);
      pipe.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(dx, 0, dz).normalize(),
      );
      pipe.castShadow = true;
      this.processRoot.add(pipe);
      // Supports
      const mid = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.0, 0.35), this.mats.concrete);
      mid.position.set((seg.x0 + seg.x1) / 2, 0.5, (seg.z0 + seg.z1) / 2);
      this.processRoot.add(mid);
    }
  }

  private addOutfall(x: number, z: number, yaw: number): void {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = yaw;
    const channel = new THREE.Mesh(new THREE.BoxGeometry(6, 0.8, 22), this.mats.waterDeep);
    channel.position.set(0, 0.35, 8);
    g.add(channel);
    const wallL = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.4, 22), this.mats.weathered);
    wallL.position.set(-3.2, 0.7, 8);
    g.add(wallL);
    const wallR = wallL.clone();
    wallR.position.x = 3.2;
    g.add(wallR);
    const label = this.makeLabel('Outfall');
    label.position.set(0, 5, 10);
    g.add(label);
    g.userData.unitId = 'outfall';
    this.processRoot.add(g);
    this.units.push({ id: 'outfall', label: 'Outfall', mesh: g });
  }

  private buildSchematicPlantLayout(): void {
    const s = this.plant.layoutScale;
    const size = this.plant.size;
    const roadMat = this.mats.asphalt;
    const walkMat = this.mats.walk;

    const spineLen = (size === 'xlarge' || size === 'extra-large' ? 120 : size === 'large' ? 105 : 95) * s;
    const road = new THREE.Mesh(new THREE.BoxGeometry(8, 0.12, spineLen), roadMat);
    road.position.set(0, 0.14, 0);
    road.receiveShadow = true;
    this.processRoot.add(road);

    const walkZs =
      size === 'xlarge' || size === 'extra-large'
        ? [-40, -18, 5, 28, 48]
        : size === 'large'
          ? [-32, -8, 16, 36]
          : [-28, 0, 28];
    for (const z of walkZs.map((v) => v * s)) {
      const walk = new THREE.Mesh(new THREE.BoxGeometry(70 * s, 0.08, 2.2), walkMat);
      walk.position.set(8 * s, 0.12, z);
      this.processRoot.add(walk);
    }

    const trainOffsetZ = size === 'xlarge' || size === 'extra-large' ? 14 : size === 'large' ? 10 : 0;

    const units: { id: string; label: string; kind: string; x: number; z: number; count: number }[] =
      this.plant.isSeptic
        ? [
            { id: 'house', label: 'Farmhouse', kind: 'rect', x: -28, z: 10, count: 1 },
            { id: 'septic_tank', label: 'Septic Tank', kind: 'septic_tank', x: -12, z: 4, count: 1 },
            { id: 'distribution', label: 'Distribution Box', kind: 'dbox', x: 8, z: 2, count: 1 },
            { id: 'leaching_bed', label: 'Leaching Bed', kind: 'leach', x: 48, z: 28, count: 1 },
          ]
        : [
            { id: 'headworks', label: 'Headworks', kind: 'rect', x: -38, z: -8, count: 1 },
            {
              id: 'primary',
              label: this.plant.hasOxidationDitch ? 'Oxidation Ditch' : 'Primary Clarifiers',
              kind: this.plant.hasOxidationDitch ? 'ditch' : 'cyl',
              x: -18,
              z: -12,
              count: this.plant.hasOxidationDitch
                ? this.plant.aerationBasinCount
                : this.plant.primaryClarifierCount,
            },
            {
              id: 'aeration',
              label: this.plant.hasOxidationDitch ? 'Rotors / EA' : 'Aeration Basins',
              kind: 'basin',
              x: 8,
              z: -10,
              count: this.plant.hasOxidationDitch ? 0 : this.plant.aerationBasinCount,
            },
            {
              id: 'secondary',
              label: 'Secondary Clarifiers',
              kind: 'cyl',
              x: 32,
              z: -12,
              count: this.plant.secondaryClarifierCount,
            },
            this.plant.disinfectionType === 'chlorine'
              ? {
                  id: 'disinfection',
                  label: 'Chlorine Contact',
                  kind: 'chlorine',
                  x: 48,
                  z: 4,
                  count: this.plant.chlorineContactCount,
                }
              : this.plant.disinfectionType === 'uv'
                ? { id: 'disinfection', label: 'UV Disinfection', kind: 'uv', x: 48, z: 4, count: this.plant.uvBanks }
                : { id: 'disinfection', label: 'Disinfection', kind: 'uv', x: 48, z: 4, count: 0 },
            { id: 'solids', label: 'Solids Handling', kind: 'rect', x: -10, z: 22, count: 1 },
          ];

    if (!this.plant.isSeptic && this.plant.research.process.includes('tertiary_filtration')) {
      units.push({ id: 'tertiary', label: 'Tertiary Filters', kind: 'basin', x: 42, z: 18, count: size === 'small' ? 1 : 2 });
    }
    if (!this.plant.isSeptic && this.plant.research.process.includes('anaerobic_digestion')) {
      units.push({
        id: 'digesters',
        label: 'Digesters',
        kind: 'cyl',
        x: -28,
        z: 28,
        count: size === 'xlarge' || size === 'extra-large' ? 4 : size === 'large' ? 3 : 2,
      });
    }

    for (const u of units) {
      if (u.count <= 0 && u.kind !== 'rect') continue;
      const group = new THREE.Group();
      const zOff =
        !this.plant.isSeptic && trainOffsetZ && u.id !== 'solids' && u.id !== 'digesters'
          ? -trainOffsetZ * 0.15
          : 0;
      group.position.set(u.x * s, 0, (u.z + zOff) * s);
      group.userData.unitId = u.id;

      if (u.kind === 'cyl') {
        const n = Math.max(1, u.count);
        const spacing = 9 * Math.min(1.1, 3 / Math.min(n, 4));
        const rows = n > 6 ? 2 : 1;
        const perRow = Math.ceil(n / rows);
        for (let i = 0; i < n; i++) {
          const row = Math.floor(i / perRow);
          const col = i % perRow;
          const r = (u.id === 'digesters' ? 4.2 : 3.6) * Math.min(1.15, s);
          const h = u.id === 'digesters' ? 5.5 : 2.8;
          const px = (col - (perRow - 1) / 2) * spacing;
          const pz = row * spacing * 0.85;
          if (u.id === 'digesters') {
            const mesh = new THREE.Mesh(
              new THREE.CylinderGeometry(r, r * 0.85, h, 24),
              this.mats.digester,
            );
            mesh.position.set(px, h / 2, pz);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.userData.unitId = u.id;
            group.add(mesh);
          } else {
            this.addWalledClarifier(group, px, pz, r, h, u.id);
          }
        }
      } else if (u.kind === 'septic_tank') {
        const tank = new THREE.Mesh(new THREE.BoxGeometry(7.5, 2.2, 3.4), this.mats.concrete);
        tank.position.set(0, 0.55, 0);
        tank.castShadow = true;
        tank.receiveShadow = true;
        tank.userData.unitId = u.id;
        group.add(tank);
        for (const lx of [-1.8, 1.8]) {
          const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.18, 16), this.mats.concreteAlt);
          lid.position.set(lx, 1.75, 0);
          lid.userData.unitId = u.id;
          group.add(lid);
        }
        const riser = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.35, 1.2), this.mats.concreteAlt);
        riser.position.set(0, 1.85, 0);
        riser.userData.unitId = u.id;
        group.add(riser);
      } else if (u.kind === 'dbox') {
        const box = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.9, 1.8), this.mats.concrete);
        box.position.y = 0.35;
        box.castShadow = true;
        box.userData.unitId = u.id;
        group.add(box);
        const lid = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.12, 2.0), this.mats.concreteAlt);
        lid.position.y = 0.86;
        lid.userData.unitId = u.id;
        group.add(lid);
      } else if (u.kind === 'leach') {
        const pad = new THREE.Mesh(new THREE.BoxGeometry(22, 0.18, 16), this.mats.walk);
        pad.position.y = 0.12;
        pad.receiveShadow = true;
        pad.userData.unitId = u.id;
        group.add(pad);
        for (let t = 0; t < 6; t++) {
          const trench = new THREE.Mesh(new THREE.BoxGeometry(18, 0.22, 0.85), this.mats.asphalt);
          trench.position.set(0, 0.28, -6 + t * 2.4);
          trench.userData.unitId = u.id;
          group.add(trench);
          const gravel = new THREE.Mesh(new THREE.BoxGeometry(18, 0.08, 0.55), this.mats.concreteAlt);
          gravel.position.set(0, 0.4, -6 + t * 2.4);
          gravel.userData.unitId = u.id;
          group.add(gravel);
        }
      } else if (u.kind === 'ditch') {
        const ditch = new THREE.Mesh(
          new THREE.TorusGeometry(9 * Math.min(1.1, s), 3.2, 12, 32),
          this.mats.concreteAlt,
        );
        ditch.rotation.x = Math.PI / 2;
        ditch.position.y = 1.2;
        ditch.castShadow = true;
        ditch.userData.unitId = u.id;
        group.add(ditch);
        const water = new THREE.Mesh(
          new THREE.TorusGeometry(9 * Math.min(1.1, s), 2.6, 10, 32),
          this.mats.waterDeep,
        );
        water.rotation.x = Math.PI / 2;
        water.position.y = 1.55;
        group.add(water);
        for (const side of [-1, 1]) {
          const rotor = new THREE.Mesh(new THREE.BoxGeometry(5, 1.2, 1.4), this.mats.metal);
          rotor.position.set(side * 9 * Math.min(1.1, s), 2.4, 0);
          rotor.userData.unitId = u.id;
          group.add(rotor);
        }
      } else if (u.kind === 'basin') {
        const n = Math.max(1, u.count);
        const w = u.id === 'tertiary' ? 5 : 8;
        const d = u.id === 'tertiary' ? 10 : 16;
        for (let i = 0; i < n; i++) {
          this.addOpenBasin(group, (i - (n - 1) / 2) * (w + 1.8), 0, w, d, 2.8, u.id);
        }
      } else if (u.kind === 'uv') {
        this.addUvChannel(group, u.count, u.id);
      } else if (u.kind === 'chlorine') {
        this.addChlorineContact(group, u.count, u.id);
      } else {
        const building = new THREE.Mesh(
          new THREE.BoxGeometry(u.id === 'solids' ? 16 : 12, u.id === 'solids' ? 6 : 5, 10),
          this.mats.weathered,
        );
        building.position.y = u.id === 'solids' ? 3 : 2.5;
        building.castShadow = true;
        building.userData.unitId = u.id;
        group.add(building);
        const roof = new THREE.Mesh(
          new THREE.BoxGeometry(u.id === 'solids' ? 16.4 : 12.4, 0.35, 10.4),
          this.mats.roof,
        );
        roof.position.y = u.id === 'solids' ? 6.2 : 5.2;
        group.add(roof);
      }

      if (
        !this.plant.isSeptic &&
        trainOffsetZ > 0 &&
        (u.id === 'aeration' || u.id === 'secondary' || u.id === 'primary') &&
        u.count > 0 &&
        u.kind !== 'ditch'
      ) {
        const mirror = group.clone(true);
        mirror.position.z += trainOffsetZ * s;
        mirror.traverse((o) => {
          if (o.userData) o.userData.unitId = u.id;
        });
        this.processRoot.add(mirror);
      }

      const label = this.makeLabel(u.label);
      const labelY =
        u.kind === 'ditch' ? 9.5 : u.kind === 'leach' ? 4.5 : u.kind === 'septic_tank' || u.kind === 'dbox' ? 3.8 : 8.2;
      label.position.set(0, labelY, 0);
      group.add(label);

      this.processRoot.add(group);
      this.units.push({ id: u.id, label: u.label, mesh: group });
    }

    if (!this.plant.isSeptic) {
      this.addOutfall(58 * s, 8 * s, 0);
      this.addPiping([
        { x0: -38 * s, z0: -8 * s, x1: -18 * s, z1: -12 * s },
        { x0: -18 * s, z0: -12 * s, x1: 8 * s, z1: -10 * s },
        { x0: 8 * s, z0: -10 * s, x1: 32 * s, z1: -12 * s },
        { x0: 32 * s, z0: -12 * s, x1: 48 * s, z1: 4 * s },
        { x0: 48 * s, z0: 4 * s, x1: 58 * s, z1: 8 * s },
      ]);
    }

    this.orbitDist = 42 + 28 * s;
    if (this.plant.isSeptic) {
      this.orbitTarget.set(12 * s, 0, 12 * s);
      this.walkPos.set(-8 * s, this.sampleEyeY(-8 * s, 22 * s), 22 * s);
      this.orbitDist = 50 + 20 * s;
      this.pitch = -0.72;
    } else {
      this.orbitTarget.set(8 * s, 0, -4 * s);
      this.walkPos.set(28 * s, this.sampleEyeY(28 * s, 38 * s), 38 * s);
    }
  }

  private makeLabel(text: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 1024, 256);
    ctx.fillStyle = 'rgba(8,14,24,0.88)';
    ctx.roundRect(16, 40, 992, 176, 24);
    ctx.fill();
    ctx.strokeStyle = 'rgba(180,210,240,0.35)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.font = 'bold 84px system-ui, sans-serif';
    ctx.fillStyle = '#f2f7ff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 512, 128);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const spr = new THREE.Sprite(mat);
    spr.scale.set(22, 5.5, 1);
    spr.renderOrder = 10;
    return spr;
  }

  private bindInput(canvas: HTMLCanvasElement): void {
    this.onKeyDown = (e: KeyboardEvent) => {
      this.keys.add(e.code);
      if (e.code === 'KeyC') {
        this.mode = this.mode === 'orbit' ? 'walk' : 'orbit';
        if (this.mode === 'walk') this.camCycle = 2;
        else if (this.camCycle === 2) this.camCycle = 0;
        this.onModeChange?.(this.mode);
        this.onCamCycleChange?.(this.getCamCycleLabel());
      }
      if (e.code === 'KeyV') {
        this.cycleCameraView();
      }
    };
    this.onKeyUp = (e: KeyboardEvent) => {
      this.keys.delete(e.code);
    };
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const CLICK_PX = 6;

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 0) {
        dragging = true;
        this.pointerMoved = false;
        this.pointerDownX = e.clientX;
        this.pointerDownY = e.clientY;
        lastX = e.clientX;
        lastY = e.clientY;
        canvas.setPointerCapture(e.pointerId);
      }
    });
    canvas.addEventListener('pointerup', (e) => {
      if (e.button === 0) dragging = false;
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) {
        this.updateHover(e.clientX, e.clientY, canvas);
        return;
      }
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      if (
        Math.abs(e.clientX - this.pointerDownX) > CLICK_PX ||
        Math.abs(e.clientY - this.pointerDownY) > CLICK_PX
      ) {
        this.pointerMoved = true;
      }
      this.yaw -= dx * 0.005;
      this.pitch -= dy * 0.004;
      const pitchMin = this.camCycle === 1 ? -1.55 : -1.25;
      this.pitch = Math.max(pitchMin, Math.min(0.25, this.pitch));
    });
    canvas.addEventListener('pointerleave', (e) => {
      const rt = e.relatedTarget as Node | null;
      const tip = document.querySelector('.hover-tip');
      if (tip && rt && tip.contains(rt)) return;
      this.onHover?.(null, 0, 0);
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.orbitDist = clamp(this.orbitDist + e.deltaY * 0.05, 18, 280);
      },
      { passive: false },
    );

    canvas.addEventListener('click', (e) => {
      if (this.pointerMoved) return;
      const unit = this.pickUnit(e.clientX, e.clientY, canvas);
      this.setSelected(unit);
    });
  }

  private pickUnit(clientX: number, clientY: number, canvas: HTMLCanvasElement): UnitInfo | null {
    const rect = canvas.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes: THREE.Object3D[] = [];
    for (const u of this.units) u.mesh.traverse((o) => meshes.push(o));
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (!hits.length) return null;

    const resolveId = (start: THREE.Object3D | null): string | undefined => {
      let obj: THREE.Object3D | null = start;
      while (obj) {
        const id = obj.userData.unitId as string | undefined;
        if (id) return id;
        obj = obj.parent;
      }
      return undefined;
    };

    for (const hit of hits) {
      const id = resolveId(hit.object);
      if (id && !id.startsWith('osm_')) {
        return this.units.find((u) => u.id === id) ?? null;
      }
    }
    for (const hit of hits) {
      const id = resolveId(hit.object);
      if (id) return this.units.find((u) => u.id === id) ?? null;
    }
    return null;
  }

  private updateHover(clientX: number, clientY: number, canvas: HTMLCanvasElement): void {
    if (!this.onHover) return;
    const unit = this.pickUnit(clientX, clientY, canvas);
    this.onHover(unit, clientX, clientY);
  }

  private setSelected(unit: UnitInfo | null): void {
    this.selected = unit;
    if (unit) {
      const box = new THREE.Box3().setFromObject(unit.mesh);
      const c = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      this.selectionRing.visible = true;
      this.selectionRing.position.set(c.x, 0.2, c.z);
      const r = Math.max(size.x, size.z) * 0.55;
      this.selectionRing.scale.set(r, r, 1);
    } else {
      this.selectionRing.visible = false;
    }
    this.onSelect(unit);
  }

  /** Walk / orbit eye height from shared groundY datum. */
  private sampleEyeY(x: number, z: number): number {
    return groundY(x, z, this.dem, this.plant.id, this.terrainOpts) + this.eyeHeight;
  }

  private update(dt: number): void {
    const speed = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 28 : 14) * dt;
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    if (this.mode === 'walk') {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.walkPos.addScaledVector(forward, speed);
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.walkPos.addScaledVector(forward, -speed);
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.walkPos.addScaledVector(right, -speed);
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.walkPos.addScaledVector(right, speed);
      this.walkPos.y = this.sampleEyeY(this.walkPos.x, this.walkPos.z);
      this.camera.position.copy(this.walkPos);
      const look = this.walkPos.clone().add(
        new THREE.Vector3(
          -Math.sin(this.yaw) * Math.cos(this.pitch),
          Math.sin(this.pitch),
          -Math.cos(this.yaw) * Math.cos(this.pitch),
        ),
      );
      this.camera.lookAt(look);
    } else {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.orbitTarget.addScaledVector(forward, speed);
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.orbitTarget.addScaledVector(forward, -speed);
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.orbitTarget.addScaledVector(right, -speed);
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.orbitTarget.addScaledVector(right, speed);

      if (this.camCycle === 1) {
        this.camera.position.set(
          this.orbitTarget.x,
          this.orbitTarget.y + this.orbitDist,
          this.orbitTarget.z,
        );
        this.camera.up.set(0, 0, -1);
        this.camera.lookAt(this.orbitTarget);
        this.camera.up.set(0, 1, 0);
      } else {
        const cp = Math.cos(this.pitch);
        const sp = Math.sin(this.pitch);
        this.camera.position.set(
          this.orbitTarget.x - Math.sin(this.yaw) * cp * this.orbitDist,
          this.orbitTarget.y + Math.max(8, -sp * this.orbitDist + 18),
          this.orbitTarget.z - Math.cos(this.yaw) * cp * this.orbitDist,
        );
        this.camera.lookAt(this.orbitTarget);
      }
    }

    for (const u of this.units) {
      const spr = u.mesh.children.find((c) => c instanceof THREE.Sprite) as THREE.Sprite | undefined;
      if (spr) {
        const sel = this.selected?.id === u.id;
        spr.scale.set(sel ? 26 : 22, sel ? 6.5 : 5.5, 1);
      }
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
