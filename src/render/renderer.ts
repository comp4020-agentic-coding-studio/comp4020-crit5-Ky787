/**
 * Canvas renderer. Draws only what the camera can see, blits pre-rendered code
 * panels, and keeps every per-frame allocation out of the hot path.
 */

import { GRAPPLE, PLAYER, WORLD } from "../engine/constants.ts";
import { clamp } from "../engine/geometry.ts";
import type { Box, Vec2 } from "../engine/geometry.ts";
import { beamBox, gateBox } from "../engine/hazards.ts";
import type { LevelRuntime, PlatformRuntime } from "../engine/level-runtime.ts";
import type { GrappleTarget } from "../engine/physics.ts";
import { grappleBox, playerBox } from "../engine/physics.ts";
import { Camera } from "./camera.ts";
import { buildPanel } from "./code-block.ts";
import type { PanelSprite } from "./code-block.ts";
import { Particles } from "./fx.ts";

export interface RenderState {
  runtime: LevelRuntime;
  target: GrappleTarget | null;
  aim: Vec2;
  time: number;
  /** F1 analysis overlay. */
  analysis: boolean;
  deathFlash: number;
  completeFlash: number;
}

function hexToRgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export class Renderer {
  readonly camera = new Camera();
  readonly particles = new Particles();
  private panels = new Map<string, PanelSprite>();
  private panelLevel = "";
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D canvas is unavailable in this browser");
    this.ctx = ctx;
  }

  resize(): void {
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const w = this.canvas.clientWidth || 1280;
    const h = this.canvas.clientHeight || 720;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.dpr = dpr;
  }

  private ensurePanels(runtime: LevelRuntime): void {
    if (this.panelLevel === runtime.data.level.id) return;
    this.panels.clear();
    for (const p of runtime.platforms) {
      this.panels.set(p.spec.id, buildPanel(p.spec, runtime.accent));
    }
    this.panelLevel = runtime.data.level.id;
  }

  viewSize(): { w: number; h: number } {
    return { w: this.canvas.clientWidth || 1280, h: this.canvas.clientHeight || 720 };
  }

  draw(state: RenderState): void {
    const { runtime } = state;
    this.ensurePanels(runtime);
    this.resize();

    const ctx = this.ctx;
    const view = this.viewSize();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);

    this.drawBackground(ctx, view, runtime, state.time);

    ctx.save();
    ctx.scale(this.camera.zoom, this.camera.zoom);
    ctx.translate(-this.camera.originX(), -this.camera.originY());

    const bounds = this.camera.visibleBounds(320);

    this.drawSanctuaries(ctx, state, bounds);
    this.drawBeams(ctx, state, bounds);
    this.drawGates(ctx, state, bounds);
    this.drawPlatforms(ctx, state, bounds);
    this.drawCheckpoints(ctx, state, bounds);
    this.drawObjective(ctx, state);
    this.drawBeacons(ctx, state, bounds);
    if (state.analysis) this.drawAnalysis(ctx, state, bounds);
    this.drawRope(ctx, state);
    this.drawPlayer(ctx, state);
    this.particles.draw(ctx);
    this.drawWatchdog(ctx, state, bounds);
    this.drawTarget(ctx, state);

    ctx.restore();

    this.drawEdgeCues(ctx, view, state);
    if (state.deathFlash > 0) this.drawDeathGlitch(ctx, view, state.deathFlash);
    if (state.completeFlash > 0) this.drawCompleteFlash(ctx, view, state);
  }

  // --- background -------------------------------------------------------

  private drawBackground(
    ctx: CanvasRenderingContext2D,
    view: { w: number; h: number },
    runtime: LevelRuntime,
    time: number,
  ): void {
    const accent = runtime.accent;
    const grad = ctx.createLinearGradient(0, 0, 0, view.h);
    grad.addColorStop(0, "#05070d");
    grad.addColorStop(0.55, "#070a12");
    grad.addColorStop(1, "#04060a");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, view.w, view.h);

    // Two parallax grids: far and near, offset by the camera.
    for (const [depth, alpha, step] of [
      [0.18, 0.045, 240],
      [0.42, 0.035, 96],
    ] as const) {
      const ox = -(this.camera.originX() * depth) % step;
      const oy = -(this.camera.originY() * depth) % step;
      ctx.strokeStyle = hexToRgba(accent, alpha);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = ox; x < view.w; x += step) {
        ctx.moveTo(Math.round(x) + 0.5, 0);
        ctx.lineTo(Math.round(x) + 0.5, view.h);
      }
      for (let y = oy; y < view.h; y += step) {
        ctx.moveTo(0, Math.round(y) + 0.5);
        ctx.lineTo(view.w, Math.round(y) + 0.5);
      }
      ctx.stroke();
    }

    // Slow horizontal scan sheen, the only "machine breathing" flourish.
    const sheen = ((time * 0.06) % 1) * (view.h + 200) - 100;
    const sg = ctx.createLinearGradient(0, sheen - 90, 0, sheen + 90);
    sg.addColorStop(0, "rgba(255,255,255,0)");
    sg.addColorStop(0.5, hexToRgba(accent, 0.022));
    sg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = sg;
    ctx.fillRect(0, sheen - 90, view.w, 180);
  }

  // --- world ------------------------------------------------------------

  private visible(box: Box, b: { x0: number; y0: number; x1: number; y1: number }): boolean {
    return box.x < b.x1 && box.x + box.w > b.x0 && box.y < b.y1 && box.y + box.h > b.y0;
  }

  /**
   * Code blocks, in two passes: every panel, then every solid slab.
   *
   * A panel hangs 130-plus units below its own slab, and in Quarantine's shaft
   * the next block up is only 235 above — so drawn block by block, a
   * neighbour's listing paints straight over the ledge you are aiming at. The
   * thing the player has to see is always the slab, so the slabs go last.
   */
  private drawPlatforms(
    ctx: CanvasRenderingContext2D,
    state: RenderState,
    bounds: { x0: number; y0: number; x1: number; y1: number },
  ): void {
    const { runtime } = state;
    const accent = runtime.accent;

    const drawn: {
      p: PlatformRuntime;
      panel: PanelSprite | undefined;
      jitterX: number;
      jitterY: number;
      alpha: number;
    }[] = [];

    for (const p of runtime.platforms) {
      const s = p.solid;
      const panel = this.panels.get(p.spec.id);
      const box: Box = {
        x: p.spec.x,
        y: p.spec.y,
        w: p.spec.width,
        h: p.spec.height + (panel?.h ?? WORLD.codePanelHeight),
      };
      if (!this.visible(box, bounds)) continue;
      if (p.crumble === "collapsed") continue;

      let jitterX = 0;
      let jitterY = 0;
      let alpha = 1;
      if (p.crumble === "armed") {
        const t = 1 - p.fuse / 0.85;
        jitterX = (Math.random() - 0.5) * 9 * t;
        jitterY = (Math.random() - 0.5) * 5 * t;
        alpha = 1 - 0.25 * t;
      } else if (p.spec.kind === "crumble") {
        // Plausible, not obviously fake: one line of the listing slips a pixel
        // now and then. Careful players notice; nobody is told.
        const flicker = Math.sin(state.time * 1.7 + s.x * 0.01);
        if (flicker > 0.985) jitterX = 1.5;
      }
      drawn.push({ p, panel, jitterX, jitterY, alpha });
    }

    for (const { p, panel, jitterX, jitterY, alpha } of drawn) {
      if (!panel) continue;
      ctx.save();
      ctx.translate(jitterX, jitterY);
      ctx.globalAlpha = alpha;
      ctx.drawImage(
        panel.canvas,
        p.spec.x + panel.dx,
        p.spec.y + p.spec.height,
        panel.w,
        panel.h,
      );
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    for (const { p, jitterX, jitterY, alpha } of drawn) {
      ctx.save();
      ctx.translate(jitterX, jitterY);
      ctx.globalAlpha = alpha;
      const slab = p.spec;

      // The solid slab reads as the code window's title bar.
      const grad = ctx.createLinearGradient(0, slab.y, 0, slab.y + slab.height);
      grad.addColorStop(0, "rgba(36,50,68,0.98)");
      grad.addColorStop(1, "rgba(18,26,38,0.98)");
      ctx.fillStyle = grad;
      ctx.fillRect(slab.x, slab.y, slab.width, slab.height);

      ctx.fillStyle = hexToRgba(accent, p.touched ? 0.85 : 0.5);
      ctx.fillRect(slab.x, slab.y, slab.width, 2);

      ctx.strokeStyle = "rgba(150,190,225,0.22)";
      ctx.lineWidth = 1;
      ctx.strokeRect(slab.x + 0.5, slab.y + 0.5, slab.width - 1, slab.height - 1);

      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillStyle = "rgba(196,220,240,0.72)";
      ctx.fillText(p.spec.display.entry_rva, slab.x + 7, slab.y + 16);

      if (p.spec.kind === "start" || p.spec.kind === "objective") {
        ctx.fillStyle = hexToRgba(accent, 0.9);
        ctx.fillText(
          p.spec.kind === "start" ? "ENTRY" : "EXIT",
          slab.x + slab.width - 42,
          slab.y + 16,
        );
      }

      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  private drawBeams(
    ctx: CanvasRenderingContext2D,
    state: RenderState,
    bounds: { x0: number; y0: number; x1: number; y1: number },
  ): void {
    for (const beam of state.runtime.hazards.beams) {
      const box = beamBox(beam);
      if (!this.visible({ ...box, w: box.w + 240, x: box.x - 120 }, bounds)) continue;

      // Sweep envelope: shows the player exactly where the beam can reach.
      ctx.fillStyle = "rgba(90,200,255,0.030)";
      ctx.fillRect(beam.centreX - beam.span, box.y, beam.span * 2, box.h);
      ctx.strokeStyle = "rgba(90,200,255,0.10)";
      ctx.setLineDash([6, 10]);
      ctx.strokeRect(beam.centreX - beam.span, box.y, beam.span * 2, box.h);
      ctx.setLineDash([]);

      const glow = ctx.createLinearGradient(box.x - 26, 0, box.x + box.w + 26, 0);
      glow.addColorStop(0, "rgba(90,200,255,0)");
      glow.addColorStop(0.5, beam.armed ? "rgba(120,220,255,0.34)" : "rgba(120,220,255,0.12)");
      glow.addColorStop(1, "rgba(90,200,255,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(box.x - 26, box.y, box.w + 52, box.h);

      ctx.fillStyle = beam.armed ? "rgba(190,245,255,0.85)" : "rgba(190,245,255,0.30)";
      ctx.fillRect(box.x, box.y, box.w, box.h);

      // Emitter head.
      ctx.fillStyle = "rgba(150,230,255,0.9)";
      ctx.fillRect(box.x - 7, box.y - 10, box.w + 14, 10);
    }
  }

  private drawGates(
    ctx: CanvasRenderingContext2D,
    state: RenderState,
    bounds: { x0: number; y0: number; x1: number; y1: number },
  ): void {
    for (const gate of state.runtime.hazards.gates) {
      const box = gateBox(gate);
      if (!this.visible(box, bounds)) continue;
      const hot = gate.charge;

      // Emitter posts stay visible even when the gate is open, so the player
      // can read the level's structure while planning.
      ctx.fillStyle = gate.identity ? "rgba(255,190,110,0.55)" : "rgba(255,140,80,0.55)";
      ctx.fillRect(box.x - 5, box.y - 14, box.w + 10, 14);
      ctx.fillRect(box.x - 5, box.y + box.h, box.w + 10, 14);

      if (hot <= 0.01) continue;
      const colour = gate.identity ? "255,205,120" : "255,110,70";
      const glow = ctx.createLinearGradient(box.x - 30, 0, box.x + box.w + 30, 0);
      glow.addColorStop(0, `rgba(${colour},0)`);
      glow.addColorStop(0.5, `rgba(${colour},${0.30 * hot})`);
      glow.addColorStop(1, `rgba(${colour},0)`);
      ctx.fillStyle = glow;
      ctx.fillRect(box.x - 30, box.y, box.w + 60, box.h);

      ctx.fillStyle = `rgba(${colour},${0.16 + 0.66 * hot})`;
      ctx.fillRect(box.x, box.y, box.w, box.h);
      // Hot core, so a live gate reads as energy rather than a brown pillar.
      ctx.fillStyle = `rgba(255,240,220,${0.55 * hot})`;
      ctx.fillRect(box.x + box.w * 0.36, box.y, box.w * 0.28, box.h);

      // Hex-mesh rungs, denser as the gate charges.
      ctx.strokeStyle = `rgba(255,235,205,${0.22 * hot})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let y = box.y; y < box.y + box.h; y += 18) {
        ctx.moveTo(box.x, y);
        ctx.lineTo(box.x + box.w, y + 9);
      }
      ctx.stroke();
    }
  }

  private drawWatchdog(
    ctx: CanvasRenderingContext2D,
    state: RenderState,
    bounds: { x0: number; y0: number; x1: number; y1: number },
  ): void {
    const wd = state.runtime.hazards.watchdog;
    if (!wd.active) return;
    if (wd.x < bounds.x0 - 200) return;
    const top = bounds.y0 - 400;
    const height = bounds.y1 - bounds.y0 + 800;

    const grad = ctx.createLinearGradient(wd.x - 620, 0, wd.x + 24, 0);
    grad.addColorStop(0, "rgba(255,40,70,0)");
    grad.addColorStop(0.7, "rgba(150,20,50,0.28)");
    grad.addColorStop(1, "rgba(255,70,90,0.6)");
    ctx.fillStyle = grad;
    ctx.fillRect(wd.x - 620, top, 644, height);

    ctx.strokeStyle = `rgba(255,${90 + wd.reliefFlash * 120},110,0.9)`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let y = top; y < top + height; y += 26) {
      const jag = (Math.sin(y * 0.11 + state.time * 9) + Math.random() * 0.7) * 9;
      ctx.lineTo(wd.x + jag, y);
    }
    ctx.stroke();

    ctx.font = "12px ui-monospace, Menlo, monospace";
    ctx.fillStyle = "rgba(255,150,160,0.85)";
    for (let y = top + 60; y < top + height; y += 190) {
      ctx.fillText("WATCHDOG", wd.x - 96, y + ((state.time * 40) % 190));
    }
  }

  /** Safe harbours: hazards cannot kill inside these. */
  private drawSanctuaries(
    ctx: CanvasRenderingContext2D,
    state: RenderState,
    bounds: { x0: number; y0: number; x1: number; y1: number },
  ): void {
    for (const zone of state.runtime.sanctuaries) {
      if (!this.visible(zone, bounds)) continue;
      const pulse = 0.5 + 0.5 * Math.sin(state.time * 1.6 + zone.x * 0.004);
      ctx.strokeStyle = `rgba(120,255,190,${0.10 + 0.06 * pulse})`;
      ctx.setLineDash([3, 9]);
      ctx.lineWidth = 1;
      ctx.strokeRect(zone.x, zone.y, zone.w, zone.h);
      ctx.setLineDash([]);
      ctx.fillStyle = `rgba(120,255,190,${0.016 + 0.010 * pulse})`;
      ctx.fillRect(zone.x, zone.y, zone.w, zone.h);
    }
  }

  private drawCheckpoints(
    ctx: CanvasRenderingContext2D,
    state: RenderState,
    bounds: { x0: number; y0: number; x1: number; y1: number },
  ): void {
    for (const c of state.runtime.checkpoints) {
      if (c.x < bounds.x0 - 200 || c.x > bounds.x1 + 200) continue;
      if (c.y < bounds.y0 - 260 || c.y > bounds.y1 + 260) continue;
      const pulse = 0.5 + 0.5 * Math.sin(state.time * 2.4 + c.sequence);
      const colour = c.claimed ? "120,255,190" : "150,190,220";
      const alpha = c.claimed ? 0.5 + 0.35 * pulse : 0.22;
      ctx.fillStyle = `rgba(${colour},${alpha * 0.25})`;
      ctx.fillRect(c.x - 3, c.y - 190, 6, 210);
      ctx.fillStyle = `rgba(${colour},${alpha})`;
      ctx.fillRect(c.x - 9, c.y - 12, 18, 4);
      ctx.font = "9.5px ui-monospace, Menlo, monospace";
      ctx.fillStyle = `rgba(${colour},${alpha})`;
      ctx.fillText(c.claimed ? "SAVED" : "SAVE", c.x - 14, c.y - 200);
    }
  }

  private drawObjective(ctx: CanvasRenderingContext2D, state: RenderState): void {
    const { runtime } = state;
    const box = runtime.objectiveBox;
    const pulse = 0.5 + 0.5 * Math.sin(state.time * 3);
    const accent = runtime.accent;

    ctx.strokeStyle = hexToRgba(accent, 0.35 + 0.4 * pulse);
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 8]);
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.setLineDash([]);

    ctx.fillStyle = hexToRgba(accent, 0.07 + 0.05 * pulse);
    ctx.fillRect(box.x, box.y, box.w, box.h);

    const hold = runtime.objectiveHold / runtime.profile.objectiveDwell;
    if (hold > 0) {
      ctx.fillStyle = hexToRgba(accent, 0.75);
      ctx.fillRect(box.x, box.y + box.h + 8, box.w * clamp(hold, 0, 1), 5);
      ctx.font = "11px ui-monospace, Menlo, monospace";
      ctx.fillText("EXECUTING…", box.x, box.y - 12);
    }
  }

  private drawBeacons(
    ctx: CanvasRenderingContext2D,
    state: RenderState,
    bounds: { x0: number; y0: number; x1: number; y1: number },
  ): void {
    for (const b of state.runtime.hazards.beacons) {
      if (b.x < bounds.x0 || b.x > bounds.x1) continue;
      if (b.y < bounds.y0 - 120 || b.y > bounds.y1 + 120) continue;
      const pulse = 0.5 + 0.5 * Math.sin(state.time * 2 + b.x * 0.01);
      const alpha = b.triggered ? 0.16 : 0.34 + 0.2 * pulse;
      ctx.strokeStyle = hexToRgba(state.runtime.accent, alpha);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(b.x, b.y - 34, 8 + pulse * 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(b.x, b.y - 26);
      ctx.lineTo(b.x, b.y - 6);
      ctx.stroke();
    }
  }

  /**
   * F1 overlay. It draws two relationship layers that the dataset keeps
   * strictly apart, and keeps them apart here too:
   *
   * - `grapple_links` — physical gameplay reachability. A link never claims a
   *   machine-CFG edge exists, and the fake-choice links deliberately do not.
   * - `machine_truth` — the control flow the binary actually has, drawn from a
   *   bogus block to whichever platform carries its real CFG neighbour.
   */
  private drawAnalysis(
    ctx: CanvasRenderingContext2D,
    state: RenderState,
    bounds: { x0: number; y0: number; x1: number; y1: number },
  ): void {
    const { runtime } = state;
    const byId = new Map(runtime.platforms.map((p) => [p.spec.id, p]));
    const top = (p: PlatformRuntime): Vec2 => ({
      x: p.solid.x + p.solid.w / 2,
      y: p.solid.y,
    });
    const onScreen = (a: Vec2, b: Vec2): boolean =>
      Math.max(a.x, b.x) >= bounds.x0 &&
      Math.min(a.x, b.x) <= bounds.x1 &&
      Math.max(a.y, b.y) >= bounds.y0 &&
      Math.min(a.y, b.y) <= bounds.y1;

    // Layer 1: physical gameplay links.
    for (const link of runtime.data.grapple_links) {
      const a = byId.get(link.from);
      const b = byId.get(link.to);
      if (!a || !b) continue;
      const pa = top(a);
      const pb = top(b);
      if (!onScreen(pa, pb)) continue;
      ctx.strokeStyle =
        link.kind === "required_progression"
          ? "rgba(90,240,170,0.55)"
          : link.kind === "optional_fake_choice"
            ? "rgba(255,90,120,0.45)"
            : "rgba(140,170,255,0.40)";
      ctx.setLineDash(link.required ? [] : [5, 6]);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "9px ui-monospace, Menlo, monospace";
      ctx.fillStyle = "rgba(190,215,235,0.55)";
      ctx.fillText(`${link.distance}u`, (pa.x + pb.x) / 2 - 12, (pa.y + pb.y) / 2 - 5);
    }

    // Layer 2: real machine CFG edges out of the bogus blocks. Amber and
    // dotted, so it can never be read as a route the player could take.
    for (const edge of runtime.machineCfgEdges) {
      const a = byId.get(edge.from);
      const b = byId.get(edge.to);
      if (!a || !b) continue;
      const pa = top(a);
      const pb = top(b);
      if (!onScreen(pa, pb)) continue;
      ctx.strokeStyle = "rgba(255,196,90,0.55)";
      ctx.setLineDash([2, 7]);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y - 14);
      ctx.quadraticCurveTo((pa.x + pb.x) / 2, Math.min(pa.y, pb.y) - 78, pb.x, pb.y - 14);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "8.5px ui-monospace, Menlo, monospace";
      ctx.fillStyle = "rgba(255,206,120,0.7)";
      ctx.fillText(
        `cfg ${edge.kind} ${edge.rawBlock}`,
        (pa.x + pb.x) / 2 - 40,
        Math.min(pa.y, pb.y) - 46,
      );
    }

    for (const p of runtime.platforms) {
      const s = grappleBox(p.solid);
      if (s.x + s.w < bounds.x0 || s.x > bounds.x1) continue;
      if (s.y + s.h < bounds.y0 || s.y > bounds.y1) continue;
      ctx.strokeStyle = p.spec.kind === "crumble" ? "rgba(255,90,120,0.85)" : "rgba(90,240,170,0.7)";
      ctx.lineWidth = 1;
      ctx.strokeRect(s.x + 0.5, s.y + 0.5, s.w - 1, s.h - 1);
      ctx.font = "9.5px ui-monospace, Menlo, monospace";
      ctx.fillStyle = "rgba(220,240,255,0.85)";
      const chronology =
        p.spec.route_index !== null
          ? ` · #${p.spec.route_index} · ${p.spec.trace_occurrences.length} occ`
          : p.spec.physical_role
            ? ` · ${p.spec.physical_role}`
            : "";
      ctx.fillText(`${p.spec.id} · ${p.spec.kind}${chronology}`, s.x, s.y - 6);
      const nodes = p.spec.logical_nodes.length > 0 ? p.spec.logical_nodes.join(",") : "—";
      ctx.fillStyle = "rgba(160,195,225,0.65)";
      ctx.fillText(`${nodes} · ${p.spec.raw_blocks.length} bb`, s.x, s.y - 18);
      const events = runtime.eventTypesOn(p.spec.id);
      if (events.length > 0) {
        ctx.fillStyle = "rgba(255,220,140,0.9)";
        ctx.fillText(events.join(","), s.x, s.y - 30);
      }
      const shift = runtime.layoutShift(p.spec.id);
      if (p.spec.provenance) {
        ctx.fillStyle = "rgba(255,120,150,0.8)";
        ctx.fillText(
          `${p.spec.provenance.source} · ${p.spec.provenance.confidence}`,
          s.x,
          s.y + s.h + 12,
        );
      }
      if (Math.abs(shift) >= 1) {
        ctx.fillStyle = "rgba(150,185,215,0.6)";
        ctx.fillText(`x ${(s.x - shift).toFixed(0)} → ${s.x.toFixed(0)} (tuned)`, s.x, s.y + s.h + 24);
      }
    }

    // Grapple range ring.
    const p = runtime.player;
    ctx.strokeStyle = "rgba(120,200,255,0.22)";
    ctx.setLineDash([4, 10]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, GRAPPLE.maxRange, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Death plane.
    ctx.strokeStyle = "rgba(255,80,80,0.35)";
    ctx.beginPath();
    ctx.moveTo(bounds.x0, runtime.deathY);
    ctx.lineTo(bounds.x1, runtime.deathY);
    ctx.stroke();
  }

  // --- player -----------------------------------------------------------

  private drawRope(ctx: CanvasRenderingContext2D, state: RenderState): void {
    const p = state.runtime.player;
    const rope = p.rope;
    if (rope.phase === "idle") return;
    const accent = state.runtime.accent;

    ctx.strokeStyle = rope.phase === "attached" ? hexToRgba(accent, 0.95) : "rgba(190,220,245,0.6)";
    ctx.lineWidth = rope.taut ? 2.4 : 1.6;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    if (rope.phase === "attached" && !rope.taut) {
      // A slack line sags, so tautness is readable at a glance.
      const mx = (p.x + rope.anchor.x) / 2;
      const my = (p.y + rope.anchor.y) / 2 + 22;
      ctx.quadraticCurveTo(mx, my, rope.anchor.x, rope.anchor.y);
    } else {
      ctx.lineTo(rope.tip.x, rope.tip.y);
    }
    ctx.stroke();

    ctx.fillStyle = hexToRgba(accent, 0.95);
    ctx.beginPath();
    ctx.arc(rope.tip.x, rope.tip.y, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, state: RenderState): void {
    const p = state.runtime.player;
    if (state.runtime.dead) return;
    const box = playerBox(p);
    const accent = state.runtime.accent;
    const lean = clamp(p.vx / 700, -0.45, 0.45);

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(lean * 0.35);

    // Shadow/afterglow when moving fast.
    const speed = Math.hypot(p.vx, p.vy);
    if (speed > 320) {
      ctx.globalAlpha = clamp((speed - 320) / 900, 0, 0.4);
      ctx.fillStyle = hexToRgba(accent, 0.5);
      ctx.fillRect(-box.w / 2 - p.vx * 0.012, -box.h / 2 - p.vy * 0.012, box.w, box.h);
      ctx.globalAlpha = 1;
    }

    // A soft halo: the player is 22x34 units in a 1900-unit-wide view, and
    // has to stay findable against a field of code blocks.
    const halo = ctx.createRadialGradient(0, 0, 4, 0, 0, 46);
    halo.addColorStop(0, hexToRgba(accent, 0.30));
    halo.addColorStop(1, hexToRgba(accent, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(-46, -46, 92, 92);

    // Body: a flat silhouette, readable at any zoom.
    ctx.fillStyle = "#0d1420";
    ctx.fillRect(-box.w / 2, -box.h / 2, box.w, box.h);
    ctx.strokeStyle = hexToRgba(accent, 0.9);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-box.w / 2, -box.h / 2, box.w, box.h);

    // Visor.
    ctx.fillStyle = hexToRgba(accent, 0.95);
    ctx.fillRect(p.facing > 0 ? 0 : -box.w / 2 + 2, -box.h / 2 + 6, box.w / 2 - 2, 4);

    // Scarf: trails opposite to travel, sells momentum cheaply.
    ctx.strokeStyle = hexToRgba(accent, 0.55);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -box.h / 2 + 10);
    const tail = clamp(-p.vx * 0.035, -26, 26);
    const tailY = clamp(-p.vy * 0.02, -12, 14);
    ctx.quadraticCurveTo(tail * 0.5, -box.h / 2 + 14 + tailY * 0.4, tail, -box.h / 2 + 12 + tailY);
    ctx.stroke();

    // Legs: a two-frame run cycle while grounded.
    ctx.strokeStyle = "#0d1420";
    ctx.lineWidth = 3.5;
    const stride = p.grounded ? Math.sin(state.time * 18) * clamp(Math.abs(p.vx) / 320, 0, 1) * 7 : 4;
    ctx.beginPath();
    ctx.moveTo(-3, box.h / 2 - 1);
    ctx.lineTo(-3 - stride, box.h / 2 + 5);
    ctx.moveTo(3, box.h / 2 - 1);
    ctx.lineTo(3 + stride, box.h / 2 + 5);
    ctx.stroke();

    ctx.restore();
  }

  private drawTarget(ctx: CanvasRenderingContext2D, state: RenderState): void {
    const accent = state.runtime.accent;
    const p = state.runtime.player;

    if (state.target && state.runtime.player.rope.phase === "idle") {
      const t = state.target;
      const s = grappleBox(t.solid);
      ctx.strokeStyle = hexToRgba(accent, 0.75);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(s.x - 3, s.y - 3, s.w + 6, s.h + 6);
      ctx.beginPath();
      ctx.arc(t.point.x, t.point.y, 6, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Reticle: solid when something is in range, hollow when nothing is.
    const inRange = state.target !== null;
    ctx.strokeStyle = inRange ? hexToRgba(accent, 0.9) : "rgba(160,185,205,0.35)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(state.aim.x, state.aim.y, inRange ? 7 : 4, 0, Math.PI * 2);
    ctx.stroke();
    if (inRange && p.rope.phase === "idle") {
      ctx.beginPath();
      ctx.moveTo(state.aim.x - 12, state.aim.y);
      ctx.lineTo(state.aim.x - 16, state.aim.y);
      ctx.moveTo(state.aim.x + 12, state.aim.y);
      ctx.lineTo(state.aim.x + 16, state.aim.y);
      ctx.stroke();
    }
  }

  // --- screen space -----------------------------------------------------

  /** Off-screen arrow to the objective, plus a watchdog warning chevron. */
  private drawEdgeCues(
    ctx: CanvasRenderingContext2D,
    view: { w: number; h: number },
    state: RenderState,
  ): void {
    const { runtime } = state;
    const zoom = this.camera.zoom;
    const goalX = runtime.objectiveBox.x + runtime.objectiveBox.w / 2;
    const goalY = runtime.objectiveBox.y;
    const sx = (goalX - this.camera.originX()) * zoom;
    const sy = (goalY - this.camera.originY()) * zoom;

    if (sx > view.w - 40) {
      const y = clamp(sy, 90, view.h - 90);
      ctx.fillStyle = hexToRgba(runtime.accent, 0.7);
      ctx.beginPath();
      ctx.moveTo(view.w - 20, y);
      ctx.lineTo(view.w - 36, y - 9);
      ctx.lineTo(view.w - 36, y + 9);
      ctx.closePath();
      ctx.fill();
      ctx.font = "10px ui-monospace, Menlo, monospace";
      ctx.fillText("EXIT", view.w - 72, y + 3);
    }

    const wd = runtime.hazards.watchdog;
    if (wd.active) {
      const wx = (wd.x - this.camera.originX()) * zoom;
      if (wx < 0) {
        const near = clamp(1 - (runtime.player.x - wd.x) / 1600, 0, 1);
        ctx.fillStyle = `rgba(255,70,90,${0.25 + 0.6 * near})`;
        ctx.fillRect(0, 0, 6 + 26 * near, view.h);
      }
    }
  }

  private drawDeathGlitch(
    ctx: CanvasRenderingContext2D,
    view: { w: number; h: number },
    amount: number,
  ): void {
    ctx.fillStyle = `rgba(255,40,60,${0.16 * amount})`;
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.fillStyle = `rgba(4,6,10,${0.5 * amount})`;
    for (let i = 0; i < 22; i += 1) {
      const y = Math.random() * view.h;
      ctx.fillRect(0, y, view.w, 1 + Math.random() * 5 * amount);
    }
  }

  private drawCompleteFlash(
    ctx: CanvasRenderingContext2D,
    view: { w: number; h: number },
    state: RenderState,
  ): void {
    ctx.fillStyle = hexToRgba(state.runtime.accent, 0.22 * state.completeFlash);
    ctx.fillRect(0, 0, view.w, view.h);
  }
}
