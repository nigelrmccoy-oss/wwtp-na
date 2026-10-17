/**
 * Corner minimap with pad outline, unit dots, camera frustum wedge, click-pan.
 * Distinct from LayoutOverlay (whole-layout chip overlay).
 */
import type { PlantScene } from '../world/plantScene';

export class Minimap {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private scene: PlantScene;

  constructor(host: HTMLElement, scene: PlantScene) {
    this.scene = scene;
    this.el = document.createElement('div');
    this.el.className = 'minimap';
    this.el.title = 'Minimap — click to pan';
    this.canvas = document.createElement('canvas');
    this.canvas.width = 168;
    this.canvas.height = 128;
    this.el.appendChild(this.canvas);
    const label = document.createElement('div');
    label.className = 'minimap-label';
    label.textContent = 'MAP';
    this.el.appendChild(label);
    host.appendChild(this.el);
    this.ctx = this.canvas.getContext('2d')!;

    this.canvas.addEventListener('click', (e) => {
      const st = this.scene.getMinimapState();
      const r = this.canvas.getBoundingClientRect();
      const u = (e.clientX - r.left) / r.width;
      const v = (e.clientY - r.top) / r.height;
      const { worldX, worldZ } = this.uvToWorld(u, v, st.pad);
      this.scene.panToWorld(worldX, worldZ);
    });
  }

  destroy(): void {
    this.el.remove();
  }

  update(): void {
    const st = this.scene.getMinimapState();
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = 'rgba(8,14,22,0.92)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(80,120,160,0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

    const pad = st.pad;
    const p0 = this.worldToUv(pad.cx - pad.w / 2, pad.cz - pad.d / 2, pad);
    const p1 = this.worldToUv(pad.cx + pad.w / 2, pad.cz + pad.d / 2, pad);
    ctx.fillStyle = 'rgba(40,52,64,0.85)';
    ctx.fillRect(p0.u * w, p0.v * h, (p1.u - p0.u) * w, (p1.v - p0.v) * h);
    ctx.strokeStyle = 'rgba(140,170,200,0.5)';
    ctx.strokeRect(p0.u * w, p0.v * h, (p1.u - p0.u) * w, (p1.v - p0.v) * h);

    for (const u of st.units) {
      const pt = this.worldToUv(u.x, u.z, pad);
      ctx.fillStyle = u.id === 'headworks' || u.id === 'solids' ? '#c0a060' : '#6ec8ff';
      ctx.beginPath();
      ctx.arc(pt.u * w, pt.v * h, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }

    const tgt = this.worldToUv(st.target.x, st.target.z, pad);
    ctx.strokeStyle = '#ffcc33';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(tgt.u * w - 5, tgt.v * h);
    ctx.lineTo(tgt.u * w + 5, tgt.v * h);
    ctx.moveTo(tgt.u * w, tgt.v * h - 5);
    ctx.lineTo(tgt.u * w, tgt.v * h + 5);
    ctx.stroke();

    // Frustum wedge: camera → target with lateral spread
    const cam = this.worldToUv(st.cam.x, st.cam.z, pad);
    const tipX = cam.u * w;
    const tipY = cam.v * h;
    const tx = tgt.u * w - tipX;
    const ty = tgt.v * h - tipY;
    const tlen = Math.hypot(tx, ty) || 0.001;
    const nx = -ty / tlen;
    const ny = tx / tlen;
    const reachPx = Math.max(18, Math.min(52, tlen * 1.15));
    const endX = tipX + (tx / tlen) * reachPx;
    const endY = tipY + (ty / tlen) * reachPx;
    const spread = reachPx * 0.42;
    ctx.fillStyle = 'rgba(255, 200, 80, 0.22)';
    ctx.strokeStyle = 'rgba(255, 210, 100, 0.7)';
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(endX + nx * spread, endY + ny * spread);
    ctx.lineTo(endX - nx * spread, endY - ny * spread);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ff8866';
    ctx.beginPath();
    ctx.arc(tipX, tipY, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  private worldToUv(
    x: number,
    z: number,
    pad: { cx: number; cz: number; w: number; d: number },
  ): { u: number; v: number } {
    const margin = 0.08;
    const span = Math.max(pad.w, pad.d) * 1.08;
    const u = 0.5 + ((x - pad.cx) / span) * (1 - 2 * margin);
    const v = 0.5 + ((z - pad.cz) / span) * (1 - 2 * margin);
    return { u: Math.min(0.98, Math.max(0.02, u)), v: Math.min(0.98, Math.max(0.02, v)) };
  }

  private uvToWorld(
    u: number,
    v: number,
    pad: { cx: number; cz: number; w: number; d: number },
  ): { worldX: number; worldZ: number } {
    const margin = 0.08;
    const span = Math.max(pad.w, pad.d) * 1.08;
    const uu = (u - 0.5) / (1 - 2 * margin);
    const vv = (v - 0.5) / (1 - 2 * margin);
    return { worldX: pad.cx + uu * span, worldZ: pad.cz + vv * span };
  }
}
