/**
 * Three.js plant site scene.
 * v0.1: procedural ground + fog + sky.
 * HOOK: later swap groundMesh geometry for OSM/DEM bake (see buildGround comments).
 */
import * as THREE from 'three';
import type { PlantConfig } from '../sim/processModel';

export interface UnitInfo {
  id: string;
  label: string;
  mesh: THREE.Object3D;
}

export type UnitSelectCb = (unit: UnitInfo | null) => void;

export class PlantScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly units: UnitInfo[] = [];

  private root: THREE.Group;
  private keys = new Set<string>();
  private yaw = 0.6;
  private pitch = -0.42;
  private orbitTarget = new THREE.Vector3(0, 0, 0);
  private orbitDist = 55;
  private mode: 'orbit' | 'walk' = 'orbit';
  private walkPos = new THREE.Vector3(40, 2.2, 55);
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private selected: UnitInfo | null = null;
  private selectionRing: THREE.Mesh;
  private onSelect: UnitSelectCb;
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

  constructor(
    canvas: HTMLCanvasElement,
    plant: PlantConfig,
    onSelect: UnitSelectCb,
    onModeChange?: (mode: 'orbit' | 'walk') => void,
  ) {
    this.plant = plant;
    this.onSelect = onSelect;
    this.onModeChange = onModeChange ?? null;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, false);
    this.renderer.setClearColor(0x7aa0c0, 1);
    this.renderer.shadowMap.enabled = true;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x9bb4c8, 0.0022);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.5, 800);
    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.selectionRing = new THREE.Mesh(
      new THREE.RingGeometry(1.2, 1.55, 32),
      new THREE.MeshBasicMaterial({ color: 0xffcc33, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }),
    );
    this.selectionRing.rotation.x = -Math.PI / 2;
    this.selectionRing.visible = false;
    this.scene.add(this.selectionRing);

    this.buildEnvironment();
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

  private onResize = (): void => {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  };

  private buildEnvironment(): void {
    // Sky hemisphere
    const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x3a4a28, 0.85);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2d6, 1.05);
    sun.position.set(60, 90, 40);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 250;
    sun.shadow.camera.left = -100;
    sun.shadow.camera.right = 100;
    sun.shadow.camera.top = 100;
    sun.shadow.camera.bottom = -100;
    this.scene.add(sun);

    // HOOK (future OSM/DEM): replace buildGround() output with geotiff/DEM mesh + OSM footprints.
    // Do not scrape Street View / Apple Maps. Prefer open DEM (e.g. Contours/SRTM) baked offline.
    this.root.add(this.buildGround());

    // Soft distant hills
    const hillMat = new THREE.MeshStandardMaterial({ color: 0x4d6a3e, roughness: 0.9, metalness: 0.0 });
    for (const [x, z, sx, sz, h] of [
      [-90, -70, 40, 30, 8],
      [100, -50, 35, 40, 6],
      [-70, 90, 50, 25, 5],
    ] as const) {
      const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), hillMat);
      hill.position.set(x, -0.5, z);
      hill.scale.set(sx, h, sz);
      hill.receiveShadow = true;
      this.root.add(hill);
    }
  }

  private buildGround(): THREE.Object3D {
    const group = new THREE.Group();
    const size = 220;
    const seg = 64;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      // Subtle procedural height — stand-in until DEM bake
      const h =
        Math.sin(x * 0.035) * Math.cos(z * 0.028) * 0.55 +
        Math.sin(x * 0.01 + z * 0.012) * 1.1 -
        0.15;
      pos.setY(i, h);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x5a7048,
      roughness: 0.95,
      metalness: 0.0,
      flatShading: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    group.add(mesh);

    // Site pad (gravel / asphalt yard)
    const padW = (this.plant.size === 'xlarge' || this.plant.size === 'extra-large' ? 140 : this.plant.size === 'large' ? 125 : 110) * this.plant.layoutScale;
    const padD = (this.plant.size === 'xlarge' || this.plant.size === 'extra-large' ? 100 : this.plant.size === 'large' ? 90 : 80) * this.plant.layoutScale;
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(padW, padD),
      new THREE.MeshStandardMaterial({ color: 0x5a5e58, roughness: 0.9 }),
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.08;
    pad.receiveShadow = true;
    group.add(pad);

    return group;
  }

  private buildPlantLayout(): void {
    const s = this.plant.layoutScale;
    const size = this.plant.size;
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x3a3c3e, roughness: 0.85 });
    const walkMat = new THREE.MeshStandardMaterial({ color: 0x6e716c, roughness: 0.9 });

    // Main road spine — longer for large/xlarge footprints
    const spineLen = (size === 'xlarge' || size === 'extra-large' ? 120 : size === 'large' ? 105 : 95) * s;
    const road = new THREE.Mesh(new THREE.BoxGeometry(8, 0.12, spineLen), roadMat);
    road.position.set(0, 0.12, 0);
    road.receiveShadow = true;
    this.root.add(road);

    // Cross walkways — denser on larger sites
    const walkZs =
      size === 'xlarge' || size === 'extra-large'
        ? [-40, -18, 5, 28, 48]
        : size === 'large'
          ? [-32, -8, 16, 36]
          : [-28, 0, 28];
    for (const z of walkZs.map((v) => v * s)) {
      const walk = new THREE.Mesh(new THREE.BoxGeometry(70 * s, 0.08, 2.2), walkMat);
      walk.position.set(8 * s, 0.1, z);
      this.root.add(walk);
    }

    // Dual-train offset for large+ municipal plants (silhouette hint vs single Lego row)
    const trainOffsetZ = size === 'xlarge' || size === 'extra-large' ? 14 : size === 'large' ? 10 : 0;

    // Process train — septic micro site vs municipal WWTP
    const units: { id: string; label: string; kind: string; x: number; z: number; count: number }[] =
      this.plant.isSeptic
        ? [
            { id: 'house', label: 'Farmhouse', kind: 'rect', x: -22, z: 8, count: 1 },
            { id: 'septic_tank', label: 'Septic Tank', kind: 'basin', x: -4, z: -2, count: 1 },
            { id: 'pump', label: 'Effluent Pump', kind: 'rect', x: 10, z: -2, count: 1 },
            { id: 'leaching_bed', label: 'Leaching Bed', kind: 'basin', x: 28, z: -6, count: 1 },
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

    // Optional tertiary / digester silhouette markers from process[]
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
      const zOff = !this.plant.isSeptic && trainOffsetZ && u.id !== 'solids' && u.id !== 'digesters' ? -trainOffsetZ * 0.15 : 0;
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
          const h = u.id === 'digesters' ? 5.5 : 2.4;
          const mesh = new THREE.Mesh(
            new THREE.CylinderGeometry(r, r * (u.id === 'digesters' ? 0.85 : 1), h, 24),
            new THREE.MeshStandardMaterial({
              color: u.id === 'digesters' ? 0x8a9098 : 0xb8c0c8,
              roughness: 0.55,
              metalness: 0.15,
            }),
          );
          mesh.position.set((col - (perRow - 1) / 2) * spacing, h / 2, row * spacing * 0.85);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.userData.unitId = u.id;
          group.add(mesh);
          if (u.id !== 'digesters') {
            const water = new THREE.Mesh(
              new THREE.CircleGeometry(r * 0.92, 24),
              new THREE.MeshStandardMaterial({ color: 0x3a7ca5, roughness: 0.25, metalness: 0.3 }),
            );
            water.rotation.x = -Math.PI / 2;
            water.position.set(mesh.position.x, h - 0.25, mesh.position.z);
            group.add(water);
          }
        }
      } else if (u.kind === 'ditch') {
        // Oval oxidation-ditch silhouette (not a rectangular aeration bank)
        const ditch = new THREE.Mesh(
          new THREE.TorusGeometry(9 * Math.min(1.1, s), 3.2, 12, 32),
          new THREE.MeshStandardMaterial({ color: 0x7a8a90, roughness: 0.7 }),
        );
        ditch.rotation.x = Math.PI / 2;
        ditch.position.y = 1.2;
        ditch.castShadow = true;
        ditch.userData.unitId = u.id;
        group.add(ditch);
        const water = new THREE.Mesh(
          new THREE.TorusGeometry(9 * Math.min(1.1, s), 2.6, 10, 32),
          new THREE.MeshStandardMaterial({ color: 0x2f6f8f, roughness: 0.3 }),
        );
        water.rotation.x = Math.PI / 2;
        water.position.y = 1.55;
        group.add(water);
        for (const side of [-1, 1]) {
          const rotor = new THREE.Mesh(
            new THREE.BoxGeometry(5, 1.2, 1.4),
            new THREE.MeshStandardMaterial({ color: 0x556070, metalness: 0.35, roughness: 0.45 }),
          );
          rotor.position.set(side * 9 * Math.min(1.1, s), 2.4, 0);
          rotor.userData.unitId = u.id;
          group.add(rotor);
        }
      } else if (u.kind === 'basin') {
        const n = Math.max(1, u.count);
        const w = u.id === 'tertiary' ? 5 : 6.5;
        const d = u.id === 'tertiary' ? 10 : 14;
        for (let i = 0; i < n; i++) {
          const basin = new THREE.Mesh(
            new THREE.BoxGeometry(w, 2.8, d),
            new THREE.MeshStandardMaterial({ color: u.id === 'tertiary' ? 0x6a7a88 : 0x8a9aa0, roughness: 0.7 }),
          );
          basin.position.set((i - (n - 1) / 2) * (w + 1.2), 1.4, 0);
          basin.castShadow = true;
          basin.userData.unitId = u.id;
          group.add(basin);
          const water = new THREE.Mesh(
            new THREE.BoxGeometry(w * 0.9, 0.15, d * 0.9),
            new THREE.MeshStandardMaterial({ color: 0x2f6f8f, roughness: 0.3 }),
          );
          water.position.set(basin.position.x, 2.5, 0);
          group.add(water);
        }
      } else if (u.kind === 'uv') {
        const channel = new THREE.Mesh(
          new THREE.BoxGeometry(10 + u.count * 1.5, 2.2, 6),
          new THREE.MeshStandardMaterial({ color: 0x6a7a88, roughness: 0.6 }),
        );
        channel.position.y = 1.1;
        channel.castShadow = true;
        channel.userData.unitId = u.id;
        group.add(channel);
        for (let i = 0; i < u.count; i++) {
          const lamp = new THREE.Mesh(
            new THREE.BoxGeometry(0.4, 0.3, 5),
            new THREE.MeshStandardMaterial({ color: 0xaaccff, emissive: 0x3355aa, emissiveIntensity: 0.4 }),
          );
          lamp.position.set(-3 + i * 2.2, 2.0, 0);
          lamp.userData.unitId = u.id;
          group.add(lamp);
        }
      } else if (u.kind === 'chlorine') {
        const n = Math.max(1, u.count);
        const channel = new THREE.Mesh(
          new THREE.BoxGeometry(10 + n * 1.2, 2.4, 8),
          new THREE.MeshStandardMaterial({ color: 0x5a6e78, roughness: 0.65 }),
        );
        channel.position.y = 1.2;
        channel.castShadow = true;
        channel.userData.unitId = u.id;
        group.add(channel);
        for (let i = 0; i < n; i++) {
          const baffle = new THREE.Mesh(
            new THREE.BoxGeometry(0.35, 1.6, 6.5),
            new THREE.MeshStandardMaterial({ color: 0x8a9aa4, roughness: 0.7 }),
          );
          baffle.position.set(-3.5 + i * 2.4, 1.5, 0);
          baffle.userData.unitId = u.id;
          group.add(baffle);
        }
        const water = new THREE.Mesh(
          new THREE.BoxGeometry(9 + n * 1.1, 0.12, 7),
          new THREE.MeshStandardMaterial({ color: 0x3a8a9a, roughness: 0.25, metalness: 0.2 }),
        );
        water.position.set(0, 2.15, 0);
        group.add(water);
      } else {
        const building = new THREE.Mesh(
          new THREE.BoxGeometry(u.id === 'solids' ? 16 : 12, u.id === 'solids' ? 6 : 5, 10),
          new THREE.MeshStandardMaterial({
            color: u.id === 'headworks' ? 0x7a8490 : 0x6e7568,
            roughness: 0.75,
          }),
        );
        building.position.y = u.id === 'solids' ? 3 : 2.5;
        building.castShadow = true;
        building.userData.unitId = u.id;
        group.add(building);
        const roof = new THREE.Mesh(
          new THREE.BoxGeometry(u.id === 'solids' ? 16.4 : 12.4, 0.35, 10.4),
          new THREE.MeshStandardMaterial({ color: 0x3d4550, roughness: 0.8 }),
        );
        roof.position.y = u.id === 'solids' ? 6.2 : 5.2;
        group.add(roof);
      }

      // Large plants: mirror a second train row for aeration/secondary silhouette
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
        this.root.add(mirror);
      }

      const label = this.makeLabel(u.label);
      label.position.set(0, u.kind === 'ditch' ? 9.5 : 8.2, 0);
      group.add(label);

      this.root.add(group);
      this.units.push({ id: u.id, label: u.label, mesh: group });
    }

    // Effluent channel stub — skip misleading outfall on septic (no surface outfall)
    if (!this.plant.isSeptic) {
      const outfall = new THREE.Mesh(
        new THREE.BoxGeometry(4, 0.6, 18 * s),
        new THREE.MeshStandardMaterial({ color: 0x4a90b8, roughness: 0.4 }),
      );
      outfall.position.set(58 * s, 0.4, 8 * s);
      this.root.add(outfall);
    }

    // Closer default orbit so labels/units are readable on enter
    this.orbitDist = 42 + 28 * s;
    this.orbitTarget.set(8 * s, 0, -4 * s);
    this.walkPos.set(28 * s, 2.2, 38 * s);
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
        this.onModeChange?.(this.mode);
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
      if (!dragging) return;
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
      this.pitch = Math.max(-1.2, Math.min(0.2, this.pitch));
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.orbitDist = clamp(this.orbitDist + e.deltaY * 0.05, 18, 220);
    }, { passive: false });

    canvas.addEventListener('click', (e) => {
      // Ignore click-select after a drag look
      if (this.pointerMoved) return;
      const rect = canvas.getBoundingClientRect();
      this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const meshes: THREE.Object3D[] = [];
      for (const u of this.units) u.mesh.traverse((o) => meshes.push(o));
      const hits = this.raycaster.intersectObjects(meshes, false);
      if (hits.length) {
        let obj: THREE.Object3D | null = hits[0].object;
        let id: string | undefined;
        while (obj) {
          id = obj.userData.unitId as string | undefined;
          if (id) break;
          obj = obj.parent;
        }
        const unit = this.units.find((u) => u.id === id) ?? null;
        this.setSelected(unit);
      } else {
        this.setSelected(null);
      }
    });
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

  private update(dt: number): void {
    const speed = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 28 : 14) * dt;
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    if (this.mode === 'walk') {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.walkPos.addScaledVector(forward, speed);
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.walkPos.addScaledVector(forward, -speed);
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.walkPos.addScaledVector(right, -speed);
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.walkPos.addScaledVector(right, speed);
      this.walkPos.y = 2.2;
      this.camera.position.copy(this.walkPos);
      const look = this.walkPos.clone().add(new THREE.Vector3(
        -Math.sin(this.yaw) * Math.cos(this.pitch),
        Math.sin(this.pitch),
        -Math.cos(this.yaw) * Math.cos(this.pitch),
      ));
      this.camera.lookAt(look);
    } else {
      // Orbit WASD pans target
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.orbitTarget.addScaledVector(forward, speed);
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.orbitTarget.addScaledVector(forward, -speed);
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.orbitTarget.addScaledVector(right, -speed);
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.orbitTarget.addScaledVector(right, speed);

      const cp = Math.cos(this.pitch);
      const sp = Math.sin(this.pitch);
      this.camera.position.set(
        this.orbitTarget.x - Math.sin(this.yaw) * cp * this.orbitDist,
        this.orbitTarget.y + Math.max(8, -sp * this.orbitDist + 18),
        this.orbitTarget.z - Math.cos(this.yaw) * cp * this.orbitDist,
      );
      this.camera.lookAt(this.orbitTarget);
    }

    // Soft label billboard pulse on selection
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
