/**
 * The playable world for one level: platforms, crumble state, checkpoints,
 * hazards, death and completion. It knows nothing about rendering or the DOM,
 * so the traversal tests drive exactly the same object the browser does.
 */

import type { LevelData, PlatformSpec, SemanticEventType } from "../data/types.ts";
import { CRUMBLE, FIXED_DT, HAZARD, THEME_PROFILES, WORLD } from "./constants.ts";
import type { ThemeProfile } from "./constants.ts";
import type { Box } from "./geometry.ts";
import { boxesOverlap } from "./geometry.ts";
import type { Beacon, HazardSet } from "./hazards.ts";
import {
  beamBox,
  buildHazards,
  gateBox,
  relieveWatchdog,
  stepBeam,
  stepGate,
  stepWatchdog,
} from "./hazards.ts";
import type { InputState, PlayerState, Solid } from "./physics.ts";
import { createPlayer, playerBox, releaseRope, stepPlayer } from "./physics.ts";

export type CrumbleState = "intact" | "armed" | "collapsed";

export interface PlatformRuntime {
  spec: PlatformSpec;
  solid: Solid;
  /** Only ever non-"intact" for dataset-classified crumble objects. */
  crumble: CrumbleState;
  fuse: number;
  debris: number;
  /** Set once the player has stood on or grappled this block. */
  touched: boolean;
}

export interface CheckpointRuntime {
  id: string;
  label: string;
  /** Route platform this checkpoint sits on. */
  platformId: string;
  sequence: number;
  x: number;
  y: number;
  /** Region the player must enter to claim it. */
  box: Box;
  claimed: boolean;
  /** Soft checkpoints come from `transfer` call sites, not the checkpoint list. */
  soft: boolean;
}

export type RuntimeEvent =
  | { kind: "checkpoint"; id: string; label: string; x: number; y: number }
  | { kind: "death"; cause: DeathCause; x: number; y: number }
  | { kind: "respawn"; x: number; y: number }
  | { kind: "crumble-armed"; platformId: string }
  | { kind: "crumble-collapsed"; platformId: string; box: Box }
  | { kind: "beacon"; beacon: Beacon }
  | { kind: "landed"; platformId: string; impact: number }
  | { kind: "grappled"; platformId: string }
  | { kind: "complete" };

export type DeathCause = "void" | "firewall" | "scanner" | "watchdog";

export interface RuntimeOptions {
  /** Strip crumble objects entirely. Used to prove the route never needs one. */
  withoutCrumble?: boolean;
  /** Disable hazards, for geometry-only reachability tests. */
  withoutHazards?: boolean;
}

export class LevelRuntime {
  readonly data: LevelData;
  readonly profile: ThemeProfile;
  readonly platforms: PlatformRuntime[] = [];
  readonly platformsById = new Map<string, PlatformRuntime>();
  readonly solids: Solid[] = [];
  readonly checkpoints: CheckpointRuntime[] = [];
  readonly hazards: HazardSet;
  readonly objectiveBox: Box;
  /**
   * Safe harbours. A checkpoint is "a temporary safe location" in the
   * dataset's own words, and the spawn has to be safe or a level could be
   * unstartable, so no hazard is lethal inside these boxes.
   */
  readonly sanctuaries: Box[] = [];
  readonly deathY: number;

  player: PlayerState;
  elapsed = 0;
  deaths = 0;
  /** Furthest `route_index` the player has actually stood on. */
  progress = 0;
  objectiveHold = 0;
  completed = false;
  dead = false;
  deathTimer = 0;
  lastDeathCause: DeathCause | null = null;
  respawnGrace = 0;
  events: RuntimeEvent[] = [];

  private spawn: { x: number; y: number };
  private activeCheckpoint: CheckpointRuntime | null = null;
  private readonly options: RuntimeOptions;

  constructor(data: LevelData, options: RuntimeOptions = {}) {
    this.data = data;
    this.options = options;
    this.profile = THEME_PROFILES[data.level.theme] ?? THEME_PROFILES.tutorial;
    this.deathY = data.world.death_y + WORLD.deathMargin;

    for (const spec of data.platforms) {
      if (options.withoutCrumble && spec.kind === "crumble") continue;
      const runtime: PlatformRuntime = {
        spec,
        solid: {
          id: spec.id,
          x: spec.x,
          y: spec.y,
          w: spec.width,
          h: spec.height,
          oneWay: true,
          enabled: true,
          grappleable: true,
        },
        crumble: "intact",
        fuse: 0,
        debris: 0,
        touched: false,
      };
      this.platforms.push(runtime);
      this.platformsById.set(spec.id, runtime);
      this.solids.push(runtime.solid);
    }

    const specsById = new Map(data.platforms.map((p) => [p.id, p]));

    // Midpoint of the gap that follows each route platform. Hazards guard the
    // crossing, not the landing.
    const gapCentre = new Map<string, number>();
    const routeSpecs = data.route.platform_ids
      .map((id) => specsById.get(id))
      .filter((p): p is PlatformSpec => p !== undefined);
    for (let i = 0; i < routeSpecs.length; i += 1) {
      const here = routeSpecs[i];
      const next = routeSpecs[i + 1];
      const rightEdge = here.x + here.width;
      gapCentre.set(here.id, next ? (rightEdge + next.x) / 2 : rightEdge + 120);
    }
    const anchorX = (id: string): number => {
      const known = gapCentre.get(id);
      if (known !== undefined) return known;
      const spec = specsById.get(id);
      return spec ? spec.x + spec.width / 2 : 0;
    };

    this.hazards = options.withoutHazards
      ? buildHazards({
          events: [],
          platformsById: specsById,
          profile: { scanner: 0, firewall: 0, watchdog: 0, authGates: false },
          anchorX,
        })
      : buildHazards({
          events: data.events,
          platformsById: specsById,
          profile: this.profile,
          anchorX,
        });

    for (const c of data.checkpoints) {
      const platform = specsById.get(c.platform);
      if (!platform) continue;
      this.checkpoints.push({
        id: c.id,
        label: `CHECKPOINT ${c.sequence}`,
        platformId: platform.id,
        sequence: c.sequence,
        x: c.respawn.x,
        y: c.respawn.y,
        box: {
          x: platform.x - 20,
          y: platform.y - 110,
          w: platform.width + 40,
          h: 130,
        },
        claimed: false,
        soft: false,
      });
    }

    // `transfer` call sites are mission milestones, so they double as
    // checkpoints. That is a behaviour of the event type, not of a level.
    for (const beacon of this.hazards.beacons) {
      if (!beacon.softCheckpoint) continue;
      const platform = specsById.get(
        data.events.find((e) => e.id === beacon.eventId)?.platform ?? "",
      );
      if (!platform) continue;
      this.checkpoints.push({
        id: beacon.id,
        label: beacon.label,
        platformId: platform.id,
        sequence: 100 + this.checkpoints.length,
        x: platform.x + 24,
        y: platform.y - 48,
        box: { x: platform.x - 20, y: platform.y - 110, w: platform.width + 40, h: 130 },
        claimed: false,
        soft: true,
      });
    }
    this.addReliefCheckpoints(routeSpecs);
    this.checkpoints.sort((a, b) => a.x - b.x);
    // Number the plain checkpoints in the order the player will meet them;
    // milestone checkpoints keep the event's own label.
    let ordinal = 0;
    for (const c of this.checkpoints) {
      if (!c.label.startsWith("CHECKPOINT")) continue;
      ordinal += 1;
      c.label = `CHECKPOINT ${ordinal}`;
    }

    this.sanctuaries = [
      {
        x: data.player.spawn.x - 120,
        y: data.player.spawn.y - 130,
        w: 240,
        h: 220,
      },
      ...this.checkpoints.map((c) => ({
        x: c.box.x - 40,
        y: c.box.y - 40,
        w: c.box.w + 80,
        h: c.box.h + 90,
      })),
    ];

    this.objectiveBox = {
      x: data.objective.region.x,
      y: data.objective.region.y,
      w: data.objective.region.width,
      h: data.objective.region.height,
    };

    this.spawn = { x: data.player.spawn.x, y: data.player.spawn.y };
    this.player = createPlayer(this.spawn.x, this.spawn.y);
    this.respawnGrace = HAZARD.scanner.armDelay;
  }

  /**
   * Fills in checkpoints where the delivered ones leave too long a run. Every
   * one lands on a real route platform, so a save point is still a place the
   * program actually executed; only how often you get one is a game decision.
   */
  private addReliefCheckpoints(route: readonly PlatformSpec[]): void {
    const spacing = this.profile.checkpointSpacing;
    if (spacing <= 0 || route.length < spacing * 2) return;
    const indexOf = new Map(route.map((p, i) => [p.id, i]));
    const taken = new Set<number>([0]);
    for (const c of this.checkpoints) {
      const at = indexOf.get(c.platformId);
      if (at !== undefined) taken.add(at);
    }
    // Never put one on the exit block: the objective is not a rest stop.
    const last = route.length - 2;
    const anchors = [...taken, route.length - 1].sort((a, b) => a - b);

    let added = 0;
    for (let i = 1; i < anchors.length; i += 1) {
      let at = anchors[i - 1] + spacing;
      while (at < anchors[i] - 1 && at <= last) {
        if (!taken.has(at)) {
          const platform = route[at];
          taken.add(at);
          added += 1;
          this.checkpoints.push({
            id: `checkpoint_relief_${platform.id}`,
            label: `CHECKPOINT ${this.checkpoints.length + 1}`,
            platformId: platform.id,
            sequence: 200 + added,
            x: platform.x + 24,
            y: platform.y - 48,
            box: { x: platform.x - 20, y: platform.y - 110, w: platform.width + 40, h: 130 },
            claimed: false,
            soft: true,
          });
        }
        at += spacing;
      }
    }
  }

  get accent(): string {
    return this.profile.accent;
  }

  /** Route platforms only, in chronological order. */
  routePlatforms(): PlatformRuntime[] {
    return this.data.route.platform_ids
      .map((id) => this.platformsById.get(id))
      .filter((p): p is PlatformRuntime => p !== undefined);
  }

  respawnPoint(): { x: number; y: number } {
    return this.activeCheckpoint ? { x: this.activeCheckpoint.x, y: this.activeCheckpoint.y } : this.spawn;
  }

  checkpointLabel(): string {
    return this.activeCheckpoint ? this.activeCheckpoint.label : "SPAWN";
  }

  /** Full reset to level start. */
  restartLevel(): void {
    this.activeCheckpoint = null;
    for (const c of this.checkpoints) c.claimed = false;
    for (const b of this.hazards.beacons) b.triggered = false;
    for (const t of this.hazards.watchdogTriggers) t.fired = false;
    this.hazards.watchdog.active = false;
    this.hazards.watchdog.activations = 0;
    this.hazards.watchdog.x = -HAZARD.watchdog.leadIn;
    this.elapsed = 0;
    this.deaths = 0;
    this.progress = 0;
    this.completed = false;
    this.respawnToCheckpoint();
  }

  /** Death reset: player, crumble blocks and transient hazard state. */
  respawnToCheckpoint(): void {
    const point = this.respawnPoint();
    this.player = createPlayer(point.x, point.y);
    this.dead = false;
    this.deathTimer = 0;
    this.objectiveHold = 0;
    this.respawnGrace = HAZARD.scanner.armDelay;

    if (CRUMBLE.respawnOnCheckpoint) {
      for (const p of this.platforms) {
        if (p.spec.kind !== "crumble") continue;
        p.crumble = "intact";
        p.fuse = 0;
        p.debris = 0;
        p.solid.enabled = true;
        p.solid.grappleable = true;
      }
    }

    const wd = this.hazards.watchdog;
    if (wd.active) {
      const setback = point.x - HAZARD.watchdog.respawnSetback;
      if (wd.x > setback) {
        wd.x = setback;
        wd.reliefFlash = 1;
      }
    }

    this.events.push({ kind: "respawn", x: point.x, y: point.y });
  }

  private kill(cause: DeathCause): void {
    if (this.dead || this.completed) return;
    this.dead = true;
    this.deaths += 1;
    this.deathTimer = WORLD.deathFreeze;
    this.lastDeathCause = cause;
    releaseRope(this.player, false);
    this.events.push({ kind: "death", cause, x: this.player.x, y: this.player.y });
  }

  /** Advances the world by one fixed step. */
  step(input: InputState, dt: number = FIXED_DT): void {
    if (this.completed) return;

    if (this.dead) {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) this.respawnToCheckpoint();
      return;
    }

    this.elapsed += dt;
    this.respawnGrace = Math.max(0, this.respawnGrace - dt);

    const before = this.player.rope.phase;
    stepPlayer(this.player, input, this.solids, dt);
    if (before !== "attached" && this.player.rope.phase === "attached") {
      const id = this.player.rope.anchorId;
      if (id) {
        this.events.push({ kind: "grappled", platformId: id });
        this.touch(id);
      }
    }

    if (this.player.justLanded && this.player.groundId) {
      this.events.push({
        kind: "landed",
        platformId: this.player.groundId,
        impact: Math.min(1, this.player.vy / 900),
      });
    }
    if (this.player.groundId) this.touch(this.player.groundId);

    this.stepCrumble(dt);
    this.stepHazards(dt);
    this.stepCheckpoints();
    this.stepObjective(dt);

    if (this.player.y - 0 > this.deathY) this.kill("void");
  }

  private touch(platformId: string): void {
    const p = this.platformsById.get(platformId);
    if (!p) return;
    if (!p.touched) {
      p.touched = true;
      if (p.spec.route_index !== null && p.spec.route_index > this.progress) {
        this.progress = p.spec.route_index;
      }
    } else if (p.spec.route_index !== null && p.spec.route_index > this.progress) {
      this.progress = p.spec.route_index;
    }
    // Only dataset-classified Hikari bogus blocks can ever crumble.
    if (p.spec.kind === "crumble" && p.crumble === "intact") {
      p.crumble = "armed";
      p.fuse = CRUMBLE.fuse;
      this.events.push({ kind: "crumble-armed", platformId: p.spec.id });
    }
  }

  private stepCrumble(dt: number): void {
    for (const p of this.platforms) {
      if (p.crumble === "armed") {
        p.fuse -= dt;
        if (p.fuse <= 0) {
          p.crumble = "collapsed";
          p.debris = CRUMBLE.debris;
          p.solid.enabled = false;
          p.solid.grappleable = false;
          if (this.player.rope.anchorId === p.spec.id) releaseRope(this.player, false);
          this.events.push({
            kind: "crumble-collapsed",
            platformId: p.spec.id,
            box: { x: p.solid.x, y: p.solid.y, w: p.solid.w, h: p.solid.h },
          });
        }
      } else if (p.crumble === "collapsed" && p.debris > 0) {
        p.debris = Math.max(0, p.debris - dt);
      }
    }
  }

  /** True while the player is standing in a spawn or checkpoint safe harbour. */
  inSanctuary(box: Box): boolean {
    return this.sanctuaries.some((s) => boxesOverlap(box, s));
  }

  private stepHazards(dt: number): void {
    const box = playerBox(this.player);
    const armed = this.respawnGrace <= 0 && !this.inSanctuary(box);

    for (const gate of this.hazards.gates) {
      stepGate(gate, dt);
      if (armed && gate.lethal && boxesOverlap(box, gateBox(gate))) this.kill("firewall");
    }

    for (const beam of this.hazards.beams) {
      stepBeam(beam, this.elapsed);
      beam.armed = armed;
      if (armed && boxesOverlap(box, beamBox(beam))) this.kill("scanner");
    }

    stepWatchdog(this.hazards.watchdog, this.hazards.watchdogTriggers, this.player.x, dt);
    if (this.hazards.watchdog.active && armed && this.player.x < this.hazards.watchdog.x) {
      this.kill("watchdog");
    }

    for (const beacon of this.hazards.beacons) {
      if (beacon.triggered) continue;
      const dx = Math.abs(this.player.x - beacon.x);
      const dy = Math.abs(this.player.y - beacon.y);
      if (dx < 150 && dy < 190) {
        beacon.triggered = true;
        this.events.push({ kind: "beacon", beacon });
      }
    }
  }

  private stepCheckpoints(): void {
    const box = playerBox(this.player);
    for (const c of this.checkpoints) {
      if (c.claimed) continue;
      if (!boxesOverlap(box, c.box)) continue;
      c.claimed = true;
      if (!this.activeCheckpoint || c.x >= this.activeCheckpoint.x) this.activeCheckpoint = c;
      relieveWatchdog(this.hazards.watchdog, HAZARD.watchdog.checkpointRelief);
      this.events.push({ kind: "checkpoint", id: c.id, label: c.label, x: c.x, y: c.y });
    }
  }

  private stepObjective(dt: number): void {
    const box = playerBox(this.player);
    if (boxesOverlap(box, this.objectiveBox)) {
      this.objectiveHold += dt;
      if (this.objectiveHold >= this.profile.objectiveDwell) {
        this.completed = true;
        this.events.push({ kind: "complete" });
      }
    } else if (this.objectiveHold > 0) {
      this.objectiveHold = Math.max(0, this.objectiveHold - dt * 1.6);
    }
  }

  drainEvents(): RuntimeEvent[] {
    if (this.events.length === 0) return [];
    const out = this.events;
    this.events = [];
    return out;
  }

  /** Fraction of the chronological trace the player has covered. */
  progressFraction(): number {
    const total = Math.max(1, this.data.route.platform_ids.length - 1);
    return Math.min(1, this.progress / total);
  }

  eventTypesOn(platformId: string): SemanticEventType[] {
    return this.data.events.filter((e) => e.platform === platformId).map((e) => e.type);
  }

  /** Ignored options accessor, kept so tests can assert how a runtime was built. */
  get builtWithoutCrumble(): boolean {
    return this.options.withoutCrumble === true;
  }
}
