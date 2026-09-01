/**
 * Game shell: dataset loading, the fixed-timestep loop, screen flow and the
 * bridge between runtime events and everything the player sees.
 */

import { browserFetcher, loadIndex, loadLevel } from "./data/levels.ts";
import type { Fetcher, LoadedLevel } from "./data/levels.ts";
import type { LevelIndexEntry } from "./data/types.ts";
import { AudioManager } from "./audio/audio-manager.ts";
import { FIXED_DT, HAZARD, MAX_FRAME_TIME } from "./engine/constants.ts";
import { LevelRuntime } from "./engine/level-runtime.ts";
import type { RuntimeEvent } from "./engine/level-runtime.ts";
import { findGrappleTarget } from "./engine/physics.ts";
import type { GrappleTarget } from "./engine/physics.ts";
import { Renderer } from "./render/renderer.ts";
import { AudioSettings } from "./ui/audio-settings.ts";
import { DebugPanel } from "./ui/debug-panel.ts";
import { Hud } from "./ui/hud.ts";
import { InputManager } from "./ui/input.ts";
import { Inspector } from "./ui/inspector.ts";
import { Modals } from "./ui/modals.ts";
import { Progress } from "./ui/progress.ts";
import { Screens } from "./ui/screens.ts";
import type { MissionFacts } from "./ui/screens.ts";

type Mode = "boot" | "select" | "playing" | "paused" | "complete";

export class Game {
  private renderer: Renderer;
  private input = new InputManager();
  private hud: Hud;
  private inspector: Inspector;
  private debug: DebugPanel;
  private screens: Screens;
  private modals: Modals;
  private progress = new Progress();
  private audio = new AudioManager();

  private entries: LevelIndexEntry[] = [];
  private cache = new Map<string, LoadedLevel>();
  private facts = new Map<string, MissionFacts>();

  private runtime: LevelRuntime | null = null;
  private loaded: LoadedLevel | null = null;
  private levelIndex = 0;

  private mode: Mode = "boot";
  private accumulator = 0;
  private last = 0;
  private time = 0;
  private deathFlash = 0;
  private completeFlash = 0;
  private fps = 60;
  private target: GrappleTarget | null = null;
  private analysis = false;
  private hintStage = 0;

  constructor(
    private readonly host: HTMLElement,
    canvas: HTMLCanvasElement,
    private readonly fetcher: Fetcher = browserFetcher(),
  ) {
    this.renderer = new Renderer(canvas);
    this.hud = new Hud(host);
    this.inspector = new Inspector(host);
    this.debug = new DebugPanel(host);
    this.screens = new Screens(host, {
      play: (id) => void this.start(id),
      resume: () => this.resume(),
      restartCheckpoint: () => {
        this.runtime?.respawnToCheckpoint();
        this.audio.resetTransient();
        this.resume();
      },
      restartLevel: () => {
        this.runtime?.restartLevel();
        this.audio.resetTransient();
        this.hintStage = 0;
        this.resume();
      },
      toSelect: () => this.showSelect(),
      next: () => void this.startIndex(this.levelIndex + 1),
    });
    // Reading the controls or the provenance notes must not cost you the run,
    // so both live in dialogs that suspend the simulation rather than pages
    // that throw it away.
    this.modals = new Modals(document);
    this.modals.watch((open) => {
      this.input.releaseAll();
      this.audio.setSuspended(open || this.mode !== "playing");
    });
    new AudioSettings(document, this.audio);
    this.audio.installUnlock(document);
    for (const button of document.querySelectorAll<HTMLElement>('[data-nav="missions"]')) {
      button.addEventListener("click", () => this.showSelect());
    }

    this.input.attach(canvas, host);
    this.hud.setVisible(false);
  }

  /**
   * A small read-only view of live state. The developer overlay and the
   * headless browser check both read this, so "is it actually playing?" has
   * one answer rather than two.
   */
  snapshot(): Record<string, unknown> {
    const runtime = this.runtime;
    if (!runtime) return { mode: this.mode, level: null };
    const p = runtime.player;
    return {
      mode: this.mode,
      level: runtime.data.level.id,
      theme: runtime.data.level.theme,
      x: p.x,
      y: p.y,
      vx: p.vx,
      vy: p.vy,
      grounded: p.grounded,
      groundId: p.groundId,
      dead: runtime.dead,
      rope: p.rope.phase,
      ropeLength: p.rope.length,
      anchorId: p.rope.anchorId,
      elapsed: runtime.elapsed,
      deaths: runtime.deaths,
      progress: runtime.progress,
      completed: runtime.completed,
      fps: this.fps,
      targetId: this.target?.solid.id ?? null,
      collapsed: runtime.platforms.filter((x) => x.crumble === "collapsed").length,
      watchdog: runtime.hazards.watchdog.active ? runtime.hazards.watchdog.x : null,
      audio: this.audio.snapshot(),
    };
  }

  async boot(): Promise<void> {
    this.screens.loading();
    try {
      const index = await loadIndex(this.fetcher);
      this.entries = index.levels;
      // Preload every level so mission select can show honest dataset facts
      // and switching missions never stalls mid-session.
      await Promise.all(
        this.entries.map(async (entry) => {
          const level = await loadLevel(this.fetcher, entry);
          this.cache.set(entry.id, level);
          this.facts.set(entry.id, {
            route: level.source.route.platform_ids.length,
            crumble: level.source.platforms.filter((p) => p.kind === "crumble").length,
            encrypted: level.source.analysis_metadata.string_encryption,
          });
        }),
      );
      if (deepLinkedFlag("analysis")) {
        this.analysis = true;
        this.debug.setVisible(true);
      }
      const requested = deepLinkedLevel();
      if (requested && this.entries.some((e) => e.id === requested)) {
        this.loop(performance.now());
        await this.start(requested);
      } else {
        this.showSelect();
        this.loop(performance.now());
      }
    } catch (error) {
      this.screens.error(
        `Could not load the level dataset. ${(error as Error).message ?? String(error)}`,
      );
    }
  }

  showSelect(): void {
    this.modals.close();
    this.audio.stopLevel();
    this.mode = "select";
    this.hud.setVisible(false);
    this.inspector.clear();
    this.input.releaseAll();
    this.screens.select(this.entries, this.progress, this.facts);
  }

  private async start(levelId: string): Promise<void> {
    const index = this.entries.findIndex((e) => e.id === levelId);
    await this.startIndex(index < 0 ? 0 : index);
  }

  private async startIndex(index: number): Promise<void> {
    if (index < 0 || index >= this.entries.length) {
      this.showSelect();
      return;
    }
    const entry = this.entries[index];
    let level = this.cache.get(entry.id);
    if (!level) {
      this.screens.loading(`Loading ${entry.name}…`);
      level = await loadLevel(this.fetcher, entry);
      this.cache.set(entry.id, level);
    }

    this.levelIndex = index;
    this.loaded = level;
    // The delivered dataset rides along so the analysis overlay can show
    // supplied coordinates beside tuned ones. The simulation never reads it.
    this.runtime = new LevelRuntime(level.tuned, { delivered: level.source });
    this.runtime.drainEvents();
    this.hintStage = 0;
    this.renderer.particles.clear();
    this.hud.reset();
    this.hud.setMission(index, this.runtime);
    this.hud.setVisible(true);
    this.host.style.setProperty("--accent", this.runtime.accent);
    this.audio.startLevel(this.runtime.data.level.id);

    const world = this.runtime.data.world;
    this.renderer.camera.setWorld(world.width, world.height);
    const view = this.renderer.viewSize();
    this.renderer.camera.viewW = view.w;
    this.renderer.camera.viewH = view.h;
    this.renderer.camera.snapTo(this.runtime.player.x, this.runtime.player.y);

    this.accumulator = 0;
    this.completeFlash = 0;
    this.deathFlash = 0;
    this.resume();
  }

  private resume(): void {
    this.mode = "playing";
    this.audio.setSuspended(this.modals.isOpen);
    this.screens.hide();
    this.input.clearActions();
    this.last = performance.now();
  }

  pause(): void {
    if (!this.runtime) return;
    this.modals.close();
    this.mode = "paused";
    this.audio.setSuspended(true);
    this.input.releaseAll();
    this.screens.pause(this.runtime.data.level.name);
  }

  // --- loop -------------------------------------------------------------

  private loop = (now: number): void => {
    requestAnimationFrame(this.loop);
    const raw = (now - this.last) / 1000;
    this.last = now;
    const dt = Math.min(MAX_FRAME_TIME, Math.max(0, raw));
    this.fps = this.fps * 0.92 + (1 / Math.max(1e-4, raw)) * 0.08;
    this.time += dt;

    if (this.input.takeAction("analysis")) {
      this.analysis = !this.analysis;
      this.debug.setVisible(this.analysis);
    }
    if (this.input.takeAction("inspect")) this.inspector.togglePin();

    if (!this.runtime) {
      this.input.clearActions();
      return;
    }

    if (this.input.takeAction("pause")) {
      if (this.mode === "playing") this.pause();
      else if (this.mode === "paused") this.resume();
    }
    if (this.mode === "playing" && this.input.takeAction("restart")) {
      this.runtime.respawnToCheckpoint();
      this.audio.resetTransient();
      this.renderer.camera.kick(0.3);
    }
    this.input.clearActions();

    this.deathFlash = Math.max(0, this.deathFlash - dt * 2.2);
    this.completeFlash = Math.max(0, this.completeFlash - dt * 1.4);

    const aim = this.resolveAim();
    if (this.mode === "playing" && !this.modals.isOpen) this.simulate(dt, aim);
    this.updateAudio(dt);

    this.renderer.particles.update(dt);
    this.updateCamera(dt, aim);
    this.updateTarget(aim);
    this.hud.update(this.runtime, dt);
    this.updateHints();
    this.debug.update(this.runtime, this.loaded?.source ?? this.runtime.data, this.fps);

    this.renderer.draw({
      runtime: this.runtime,
      target: this.target,
      aim,
      time: this.time,
      analysis: this.analysis,
      deathFlash: this.deathFlash,
      completeFlash: this.completeFlash,
    });
  };

  private resolveAim(): { x: number; y: number } {
    const runtime = this.runtime;
    if (!runtime) return { x: 0, y: 0 };
    if (!this.input.hasPointer) {
      return { x: runtime.player.x + runtime.player.facing * 380, y: runtime.player.y - 150 };
    }
    return this.renderer.camera.screenToWorld(this.input.screenAim.x, this.input.screenAim.y);
  }

  private simulate(dt: number, aim: { x: number; y: number }): void {
    const runtime = this.runtime;
    if (!runtime) return;
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < 8) {
      this.input.sync(aim);
      const edges = this.input.takeEdges();
      this.input.state.jumpPressed = edges.jump;
      this.input.state.grapplePressed = edges.grapple;
      if (edges.grapple && !runtime.dead) this.audio.play("grappleFire");
      runtime.step(this.input.state, FIXED_DT);
      this.input.state.jumpPressed = false;
      this.input.state.grapplePressed = false;
      this.accumulator -= FIXED_DT;
      steps += 1;
    }
    if (steps >= 8) this.accumulator = 0;
    this.handleEvents(runtime.drainEvents());
  }

  private handleEvents(events: RuntimeEvent[]): void {
    const runtime = this.runtime;
    if (!runtime) return;
    const fx = this.renderer.particles;
    const accent = runtime.accent;

    for (const event of events) {
      switch (event.kind) {
        case "crumble-armed":
          this.audio.play("crumbleStart");
          this.hud.toast("BLOCK UNSTABLE", "Hikari bogus control flow", "bad");
          fx.burst(
            (runtime.platformsById.get(event.platformId)?.solid.x ?? 0) + 40,
            runtime.platformsById.get(event.platformId)?.solid.y ?? 0,
            10,
            "#ff5f7a",
            160,
          );
          break;
        case "crumble-collapsed":
          this.audio.play("crumbleBreak");
          fx.shatter(event.box.x, event.box.y, event.box.w, event.box.h + 90, "#ff6f88");
          this.renderer.camera.kick(0.35);
          break;
        case "checkpoint":
          this.audio.play("confirm", 1, 0.96);
          this.hud.toast(event.label, "Respawn point set", "good");
          fx.burst(event.x, event.y, 26, accent, 220);
          break;
        case "beacon":
          this.audio.play("notification", event.beacon.softCheckpoint ? 0.78 : 0.62);
          this.hud.toast(event.beacon.label, event.beacon.detail, "info");
          break;
        case "landed":
          if (event.impact > 0.16) this.audio.play("landing", 0.28 + event.impact * 0.72);
          if (event.impact > 0.5) fx.burst(runtime.player.x, runtime.player.y + 17, 5, "#8fb6d6", 90);
          break;
        case "grappled":
          this.audio.play("grappleAttach");
          break;
        case "death":
          this.audio.play("death");
          this.audio.resetTransient();
          this.deathFlash = 1;
          this.renderer.camera.kick(0.8);
          fx.burst(event.x, event.y, 34, "#ff5f7a", 380);
          this.hud.toast(DEATH_TEXT[event.cause][0], DEATH_TEXT[event.cause][1], "bad");
          break;
        case "respawn":
          this.audio.resetTransient();
          this.audio.play("respawn");
          fx.burst(event.x, event.y, 18, accent, 180);
          break;
        case "complete":
          this.finish();
          break;
        default:
          break;
      }
    }
  }

  private finish(): void {
    const runtime = this.runtime;
    if (!runtime) return;
    this.mode = "complete";
    this.audio.complete();
    this.completeFlash = 1;
    this.renderer.camera.kick(0.5);
    this.renderer.particles.burst(runtime.player.x, runtime.player.y, 60, runtime.accent, 420);
    const record = this.progress.record(runtime.data.level.id, runtime.elapsed, runtime.deaths);
    this.input.releaseAll();
    this.screens.complete(
      runtime.data.level.name,
      runtime.elapsed,
      runtime.deaths,
      record,
      this.levelIndex + 1 < this.entries.length,
    );
  }

  private updateAudio(dt: number): void {
    const runtime = this.runtime;
    if (!runtime) return;
    const p = runtime.player;
    let scannerProximity = 0;
    for (const beam of runtime.hazards.beams) {
      if (!beam.armed) continue;
      const dx = Math.abs(p.x - beam.x);
      const dy = p.y < beam.top ? beam.top - p.y : p.y > beam.bottom ? p.y - beam.bottom : 0;
      scannerProximity = Math.max(scannerProximity, 1 - Math.hypot(dx, dy) / 1050);
    }

    const watchdog = runtime.hazards.watchdog;
    const watchdogPressure = watchdog.active
      ? 1 - Math.min(1, Math.max(0, p.x - watchdog.x) / HAZARD.watchdog.maxTrail)
      : 0;
    const rootPressure =
      runtime.data.level.id === "level08"
        ? Math.max(0, (runtime.progressFraction() - 0.64) / 0.36)
        : 0;

    this.audio.update(dt, {
      active: this.mode === "playing" && !this.modals.isOpen,
      alive: !runtime.dead && !runtime.completed,
      reeling: p.rope.phase === "attached" && p.rope.shrink > 0.01,
      scannerProximity: Math.min(1, Math.max(0, scannerProximity)),
      firewallClosed: runtime.hazards.gates.map((gate) =>
        Math.hypot(p.x - gate.x, p.y - (gate.top + gate.bottom) / 2) < 950 ? gate.lethal : null,
      ),
      watchdogPressure,
      tension: Math.max(watchdogPressure, rootPressure),
      objectiveCharging: runtime.objectiveCharging,
      objectiveProgress: runtime.objectiveHold / runtime.profile.objectiveDwell,
      objectiveDuration: runtime.profile.objectiveDwell,
    });
  }

  private updateCamera(dt: number, aim: { x: number; y: number }): void {
    const runtime = this.runtime;
    if (!runtime) return;
    const view = this.renderer.viewSize();
    const p = runtime.player;
    this.renderer.camera.update(
      dt,
      { x: p.x, y: p.y },
      { x: p.vx, y: p.vy },
      this.input.hasPointer ? aim : null,
      view.w,
      view.h,
    );
  }

  private updateTarget(aim: { x: number; y: number }): void {
    const runtime = this.runtime;
    if (!runtime) return;
    const p = runtime.player;
    this.target =
      p.rope.phase === "attached"
        ? null
        : findGrappleTarget({ x: p.x, y: p.y }, aim, runtime.solids, p.groundId);
    const anchored = p.rope.phase === "attached" ? p.rope.anchorId : this.target?.solid.id;
    this.inspector.show(anchored ? (runtime.platformsById.get(anchored) ?? null) : null, runtime);
  }

  /** Ghostline teaches through short prompts; later levels stay quiet. */
  private updateHints(): void {
    const runtime = this.runtime;
    if (!runtime) return;
    if (runtime.data.level.theme !== "tutorial_horizontal") {
      this.hud.setHints(
        this.time < 9 && runtime.elapsed < 9
          ? ["<kbd>A</kbd><kbd>D</kbd> move · <kbd>Space</kbd> jump · <kbd>Hold left click</kbd> grapple"]
          : [],
      );
      return;
    }

    const rope = runtime.player.rope;
    const collapsed = runtime.platforms.some(
      (p) => p.spec.kind === "crumble" && p.crumble !== "intact",
    );

    if (collapsed && this.hintStage < 4) this.hintStage = 4;
    else if (rope.phase === "attached" && this.hintStage < 3) this.hintStage = 3;
    else if (runtime.progress >= 2 && this.hintStage < 2) this.hintStage = 2;
    else if (runtime.progress >= 1 && this.hintStage < 1) this.hintStage = 1;

    const hints: Record<number, string[]> = {
      0: ["<kbd>A</kbd> <kbd>D</kbd> move · <kbd>Space</kbd> jump", "Walk to the edge of the entry block."],
      1: ["Aim with the mouse · <kbd>hold left click</kbd> to fire the line", "The reticle fills in when a block is in range."],
      2: ["<kbd>W</kbd> reels the line in · let go of the button to launch", "Momentum carries: release at the top of the swing."],
      3: ["Release at the top of the swing", "<kbd>Space</kbd> lets go with a kick."],
      4: [
        "That block was bogus control flow the obfuscator invented.",
        "It looks like the rest. It will not hold you.",
      ],
    };
    this.hud.setHints(runtime.progress > 6 ? [] : (hints[this.hintStage] ?? []));
  }
}

/** `?level=level03` deep-links a mission, for sharing and for capture runs. */
function deepLinkedLevel(): string | null {
  return deepLinkedParam("level");
}

function deepLinkedFlag(name: string): boolean {
  return deepLinkedParam(name) !== null;
}

function deepLinkedParam(name: string): string | null {
  try {
    return new URL(globalThis.location.href).searchParams.get(name);
  } catch {
    return null;
  }
}

const DEATH_TEXT: Record<string, [string, string]> = {
  void: ["PROCESS LOST", "Fell out of the trace"],
  firewall: ["BLOCKED", "Firewall gate was live"],
  scanner: ["DETECTED", "Caught by a sweep"],
  watchdog: ["TRACED", "The watchdog caught up"],
};
