/**
 * Semantic events become gameplay here.
 *
 * The dataset labels each call site with a type (`firewall`, `scanner`,
 * `watchdog`, `transfer`, ...). This module owns the reusable mechanics those
 * types drive; which ones a level runs, and how hard, comes from the theme
 * profile. No address, platform id or level name appears below.
 */

import { HAZARD } from "./constants.ts";
import type { Box } from "./geometry.ts";
import type { PlatformSpec, SemanticEventSpec, SemanticEventType } from "../data/types.ts";

export interface FirewallGate {
  id: string;
  eventId: string;
  /** `true` for an `authentication` call site promoted to a gate. */
  identity: boolean;
  x: number;
  top: number;
  bottom: number;
  thickness: number;
  closedFor: number;
  openFor: number;
  timer: number;
  /** 0 open, 1 fully closed; drives both lethality and rendering. */
  charge: number;
  lethal: boolean;
}

export interface ScannerBeam {
  id: string;
  eventId: string;
  centreX: number;
  span: number;
  top: number;
  bottom: number;
  width: number;
  period: number;
  offset: number;
  /** Current beam centre, recomputed each step. */
  x: number;
  armed: boolean;
}

export interface WatchdogPressure {
  /** Number of watchdog call sites the player has passed. */
  activations: number;
  active: boolean;
  x: number;
  speed: number;
  strength: number;
  /** Set when a checkpoint or respawn pushes the wall back, for the shockwave. */
  reliefFlash: number;
}

/** Presentation-only markers: authentication, decrypt, transfer, cleanup, ... */
export interface Beacon {
  id: string;
  eventId: string;
  type: SemanticEventType;
  x: number;
  y: number;
  triggered: boolean;
  label: string;
  detail: string;
  /** `transfer` beacons also move the respawn point. */
  softCheckpoint: boolean;
}

export interface HazardSet {
  gates: FirewallGate[];
  beams: ScannerBeam[];
  beacons: Beacon[];
  watchdog: WatchdogPressure;
  /** Watchdog call-site x positions, in route order. */
  watchdogTriggers: { eventId: string; x: number; fired: boolean }[];
}

const BEACON_LABELS: Partial<Record<SemanticEventType, string>> = {
  authentication: "IDENTITY ACCEPTED",
  network_scan: "NETWORK MAPPED",
  decrypt: "CHANNEL DECRYPTED",
  transfer: "FRAGMENT UPLINKED",
  navigation: "ROUTE SELECTED",
  checkpoint: "CHECKPOINT CROSSED",
  cleanup: "SESSION SCRUBBED",
  objective: "OBJECTIVE ARMED",
  watchdog: "WATCHDOG ARMED",
  firewall: "FIREWALL PROBED",
  scanner: "SWEEP DETECTED",
};

export interface HazardBuildContext {
  events: readonly SemanticEventSpec[];
  platformsById: ReadonlyMap<string, PlatformSpec>;
  profile: { scanner: number; firewall: number; watchdog: number; authGates: boolean };
  /**
   * Where a hazard anchored to `platformId` should sit. Gates and beams guard
   * the *gap after* their call site, never the foothold itself, so a hazard
   * can never make its own platform unstandable.
   */
  anchorX: (platformId: string) => number;
}

export function buildHazards(ctx: HazardBuildContext): HazardSet {
  const gates: FirewallGate[] = [];
  const beams: ScannerBeam[] = [];
  const beacons: Beacon[] = [];
  const watchdogTriggers: { eventId: string; x: number; fired: boolean }[] = [];
  let beamIndex = 0;
  let watchdogCount = 0;

  for (const event of ctx.events) {
    const platform = ctx.platformsById.get(event.platform);
    if (!platform) continue;
    const cx = ctx.anchorX(event.platform);
    const cy = platform.y;
    const beaconX = platform.x + platform.width / 2;

    const asGate = (identity: boolean): void => {
      const speed = ctx.profile.firewall || 1;
      gates.push({
        id: `gate_${event.id}`,
        eventId: event.id,
        identity,
        x: cx,
        top: cy - HAZARD.firewall.reach,
        bottom: cy + HAZARD.firewall.reach * HAZARD.firewall.reachBelow,
        thickness: HAZARD.firewall.thickness,
        closedFor: HAZARD.firewall.closed / speed,
        openFor: HAZARD.firewall.open / speed,
        timer: (gates.length * 0.9) % (HAZARD.firewall.closed + HAZARD.firewall.open),
        charge: 1,
        lethal: true,
      });
    };

    switch (event.type) {
      case "firewall":
        if (ctx.profile.firewall > 0) asGate(false);
        break;
      case "authentication":
        if (ctx.profile.authGates) asGate(true);
        break;
      case "scanner":
      case "network_scan":
        if (ctx.profile.scanner > 0 && event.type === "scanner") {
          beams.push({
            id: `beam_${event.id}`,
            eventId: event.id,
            centreX: cx,
            span: HAZARD.scanner.span,
            top: cy - HAZARD.scanner.reach,
            bottom: cy + HAZARD.scanner.reach * HAZARD.scanner.reachBelow,
            width: HAZARD.scanner.beamWidth,
            period: HAZARD.scanner.period / ctx.profile.scanner,
            // Staggered so neighbouring chambers read as a travelling wave
            // instead of one synchronised, impassable wall.
            offset: (beamIndex * 0.37) % 1,
            x: cx,
            armed: false,
          });
          beamIndex += 1;
        }
        break;
      case "watchdog":
        watchdogCount += 1;
        if (ctx.profile.watchdog > 0) {
          watchdogTriggers.push({ eventId: event.id, x: cx, fired: false });
        }
        break;
      default:
        break;
    }

    const label = BEACON_LABELS[event.type] ?? event.type.toUpperCase();
    const stage = typeof event.params.stage === "number" ? ` ${event.params.stage}` : "";
    beacons.push({
      id: `beacon_${event.id}`,
      eventId: event.id,
      type: event.type,
      x: beaconX,
      y: cy,
      triggered: false,
      label: label + stage,
      detail: String(event.params.intent ?? event.type),
      // `transfer` and `checkpoint` call sites are mission milestones, so they
      // double as respawn points. That is a property of the event type.
      softCheckpoint: event.type === "transfer" || event.type === "checkpoint",
    });
  }

  return {
    gates,
    beams,
    beacons,
    watchdogTriggers,
    watchdog: {
      activations: 0,
      active: false,
      x: -HAZARD.watchdog.leadIn,
      speed: 0,
      strength: ctx.profile.watchdog * (watchdogCount > 0 ? 1 : 0),
      reliefFlash: 0,
    },
  };
}

export function gateBox(gate: FirewallGate): Box {
  return {
    x: gate.x - gate.thickness / 2,
    y: gate.top,
    w: gate.thickness,
    h: gate.bottom - gate.top,
  };
}

export function beamBox(beam: ScannerBeam): Box {
  return { x: beam.x - beam.width / 2, y: beam.top, w: beam.width, h: beam.bottom - beam.top };
}

export function stepGate(gate: FirewallGate, dt: number): void {
  const cycle = gate.closedFor + gate.openFor;
  gate.timer = (gate.timer + dt) % cycle;
  const closed = gate.timer < gate.closedFor;
  gate.lethal = closed;
  if (closed) {
    // Ramp in over the first fifth of the closed phase so the barrier is
    // visibly building before it can kill.
    gate.charge = Math.min(1, gate.timer / Math.max(0.001, gate.closedFor * 0.2));
  } else {
    const untilClose = cycle - gate.timer;
    gate.charge = untilClose < HAZARD.firewall.warn ? 1 - untilClose / HAZARD.firewall.warn : 0;
    gate.charge *= 0.55;
  }
}

export function stepBeam(beam: ScannerBeam, elapsed: number): void {
  const t = ((elapsed / beam.period) + beam.offset) % 1;
  beam.x = beam.centreX + Math.sin(t * Math.PI * 2) * beam.span;
}

export function stepWatchdog(
  wd: WatchdogPressure,
  triggers: HazardSet["watchdogTriggers"],
  playerX: number,
  dt: number,
): void {
  wd.reliefFlash = Math.max(0, wd.reliefFlash - dt);
  if (wd.strength <= 0) return;
  for (const trigger of triggers) {
    if (!trigger.fired && playerX >= trigger.x) {
      trigger.fired = true;
      wd.activations += 1;
      if (!wd.active) {
        wd.active = true;
        wd.x = playerX - HAZARD.watchdog.leadIn;
      }
    }
  }
  if (!wd.active) return;
  wd.speed =
    (HAZARD.watchdog.baseSpeed + HAZARD.watchdog.speedStep * (wd.activations - 1)) * wd.strength;
  wd.x += wd.speed * dt;
  // The wall never falls hopelessly far behind, so a strong run cannot retire
  // the threat — but it never closes in from nowhere either.
  const floor = playerX - HAZARD.watchdog.maxTrail;
  if (wd.x < floor) wd.x = floor;
}

export function relieveWatchdog(wd: WatchdogPressure, distance: number): void {
  if (!wd.active) return;
  wd.x -= distance;
  wd.reliefFlash = 1;
}
