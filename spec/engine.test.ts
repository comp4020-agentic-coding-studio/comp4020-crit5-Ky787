/**
 * Engine contracts: the mechanics the brief promises the player. Crumble
 * blocks only ever come from proven bogus control flow, death returns you to
 * the last checkpoint with the world put back, semantic events dispatch by
 * type, and progression records what you finished.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { HAZARD, PLAYER, THEME_PROFILES } from "../src/engine/constants.ts";
import { boxesOverlap } from "../src/engine/geometry.ts";
import { beamBox, gateBox, stepBeam, stepGate } from "../src/engine/hazards.ts";
import { LevelRuntime } from "../src/engine/level-runtime.ts";
import type { RuntimeEvent } from "../src/engine/level-runtime.ts";
import { emptyInput, grappleBox, playerBox } from "../src/engine/physics.ts";
import { Progress } from "../src/ui/progress.ts";
import { levels, level } from "./fixtures.ts";

const idle = emptyInput();

function run(runtime: LevelRuntime, seconds: number): RuntimeEvent[] {
  const events: RuntimeEvent[] = [];
  const steps = Math.round(seconds * 120);
  for (let i = 0; i < steps; i += 1) {
    runtime.step(idle, 1 / 120);
    events.push(...runtime.drainEvents());
  }
  return events;
}

describe.each(levels)("engine: $entry.id builds", ({ tuned }) => {
  it("loads into the same engine with no level-specific code", () => {
    const runtime = new LevelRuntime(tuned);
    expect(runtime.platforms.length).toBe(tuned.platforms.length);
    expect(runtime.solids.length).toBe(tuned.platforms.length);
    expect(runtime.routePlatforms().length).toBe(tuned.route.platform_ids.length);
    expect(runtime.profile).toBe(THEME_PROFILES[tuned.level.theme]);
  });

  it("spawns the player standing, not falling out of the world", () => {
    const runtime = new LevelRuntime(tuned);
    run(runtime, 2);
    expect(runtime.player.grounded, "player should settle onto the entry block").toBe(true);
    expect(runtime.dead).toBe(false);
    expect(runtime.deaths).toBe(0);
  });

  it("never kills the player at a spawn or checkpoint, at any hazard phase", () => {
    const spots = [
      { x: tuned.player.spawn.x, y: tuned.player.spawn.y },
      ...new LevelRuntime(tuned).checkpoints.map((c) => ({ x: c.x, y: c.y })),
    ];
    for (const spot of spots) {
      const runtime = new LevelRuntime(tuned);
      // Hold the player on the spot for longer than any hazard cycle.
      for (let i = 0; i < 1200; i += 1) {
        runtime.player.x = spot.x;
        runtime.player.y = spot.y;
        runtime.player.vx = 0;
        runtime.player.vy = 0;
        runtime.step(idle, 1 / 120);
        runtime.drainEvents();
      }
      expect(runtime.deaths, `a hazard reaches a respawn point at ${spot.x}`).toBe(0);
    }
  });
});

describe("engine: hazards never seal the route", () => {
  it.each(levels)("$entry.id leaves a safe window on every route platform", ({ tuned }) => {
    // A beam or a gate is a timing problem, not a wall. Standing on any block
    // the route asks you to stand on has to be safe for long enough to read
    // the next crossing — otherwise the level is unfinishable by anyone, not
    // just by a bot that cannot see a beam coming.
    const runtime = new LevelRuntime(tuned);
    if (runtime.hazards.beams.length + runtime.hazards.gates.length === 0) return;
    const dt = 1 / 30;
    const window = 30;

    for (const platform of runtime.routePlatforms()) {
      const box = {
        x: platform.solid.x + platform.solid.w / 2 - PLAYER.width / 2,
        y: platform.solid.y - PLAYER.height,
        w: PLAYER.width,
        h: PLAYER.height,
      };
      // Safe harbours are safe by construction; they have their own test.
      if (runtime.inSanctuary(box)) continue;

      const gates = runtime.hazards.gates.map((g) => ({ ...g }));
      let run = 0;
      let longest = 0;
      for (let t = 0; t < window; t += dt) {
        let safe = true;
        for (const gate of gates) {
          stepGate(gate, dt);
          if (gate.lethal && boxesOverlap(box, gateBox(gate))) safe = false;
        }
        for (const beam of runtime.hazards.beams) {
          stepBeam(beam, t);
          if (boxesOverlap(box, beamBox(beam))) safe = false;
        }
        if (safe) {
          run += dt;
          longest = Math.max(longest, run);
        } else {
          run = 0;
        }
      }
      expect(
        longest,
        `${platform.spec.id} is never safe to stand on for long`,
      ).toBeGreaterThanOrEqual(1.2);
    }
  });
});

describe("engine: crumble blocks", () => {
  it("matches fake-block landing and grapple bounds to their full visual width", () => {
    const { tuned } = level("level01");
    const runtime = new LevelRuntime(tuned);

    for (const fake of runtime.platforms.filter((p) => p.spec.kind === "crumble")) {
      expect(fake.solid).toMatchObject({
        x: fake.spec.x,
        y: fake.spec.y,
        w: fake.spec.width,
        h: fake.spec.height,
      });
      expect(grappleBox(fake.solid)).toEqual({
        x: fake.spec.x,
        y: fake.spec.y,
        w: fake.spec.width,
        h: fake.spec.height,
      });
    }
  });

  it("arms only on dataset-classified bogus blocks, and collapses after a fuse", () => {
    const { tuned } = level("level01");
    const runtime = new LevelRuntime(tuned);
    const decoy = runtime.platforms.find((p) => p.spec.kind === "crumble");
    expect(decoy).toBeTruthy();

    // Drop the player straight onto the decoy.
    runtime.player.x = decoy!.solid.x + decoy!.solid.w / 2;
    runtime.player.y = decoy!.solid.y - 60;
    runtime.player.vy = 0;

    const events = run(runtime, 0.6);
    expect(events.some((e) => e.kind === "crumble-armed")).toBe(true);
    expect(decoy!.crumble).toBe("armed");
    expect(decoy!.solid.enabled).toBe(true);

    const later = run(runtime, 1.2);
    expect(later.some((e) => e.kind === "crumble-collapsed")).toBe(true);
    expect(decoy!.crumble).toBe("collapsed");
    expect(decoy!.solid.enabled).toBe(false);
    expect(decoy!.solid.grappleable).toBe(false);
  });

  it("never arms a route platform, however long the player stands on it", () => {
    const { tuned } = level("level01");
    const runtime = new LevelRuntime(tuned);
    run(runtime, 6);
    for (const p of runtime.platforms) {
      if (p.spec.kind === "crumble") continue;
      expect(p.crumble, `${p.spec.id} must never become unstable`).toBe("intact");
      expect(p.solid.enabled).toBe(true);
    }
  });

  it("restores every collapsed block when the player respawns", () => {
    const { tuned } = level("level01");
    const runtime = new LevelRuntime(tuned);
    const decoy = runtime.platforms.find((p) => p.spec.kind === "crumble")!;
    decoy.crumble = "collapsed";
    decoy.solid.enabled = false;
    decoy.solid.grappleable = false;

    runtime.respawnToCheckpoint();
    expect(decoy.crumble).toBe("intact");
    expect(decoy.solid.enabled).toBe(true);
    expect(decoy.solid.grappleable).toBe(true);
  });

  it("can be built with every decoy removed, to prove the route never needs one", () => {
    const { tuned } = level("level01");
    const stripped = new LevelRuntime(tuned, { withoutCrumble: true });
    expect(stripped.builtWithoutCrumble).toBe(true);
    expect(stripped.platforms.some((p) => p.spec.kind === "crumble")).toBe(false);
    expect(stripped.routePlatforms().length).toBe(tuned.route.platform_ids.length);
  });
});

describe("engine: death and checkpoints", () => {
  it("respawns at the last checkpoint without rebuilding the level", () => {
    const { tuned } = level("level01");
    const runtime = new LevelRuntime(tuned);
    const solids = runtime.solids;
    const checkpoint = runtime.checkpoints[0];

    // Claim the first checkpoint, then fall into the void.
    runtime.player.x = checkpoint.box.x + checkpoint.box.w / 2;
    runtime.player.y = checkpoint.box.y + checkpoint.box.h / 2;
    run(runtime, 0.05);
    expect(runtime.checkpointLabel()).toBe(checkpoint.label);

    runtime.player.y = runtime.deathY + 40;
    const events = run(runtime, 1.2);
    expect(events.some((e) => e.kind === "death")).toBe(true);
    expect(events.some((e) => e.kind === "respawn")).toBe(true);
    expect(runtime.deaths).toBe(1);
    expect(runtime.player.x).toBeCloseTo(checkpoint.x, 0);
    expect(runtime.dead).toBe(false);
    // Same world object, same solids: no page reload, no level rebuild.
    expect(runtime.solids).toBe(solids);
  });

  it("falls back to spawn when no checkpoint has been claimed", () => {
    const { tuned } = level("level02");
    const runtime = new LevelRuntime(tuned);
    expect(runtime.checkpointLabel()).toBe("SPAWN");
    runtime.player.y = runtime.deathY + 10;
    run(runtime, 1.2);
    expect(runtime.player.x).toBeCloseTo(tuned.player.spawn.x, 0);
  });

  it("restarting the level clears checkpoints, timers and retries", () => {
    const { tuned } = level("level01");
    const runtime = new LevelRuntime(tuned);
    runtime.checkpoints[0].claimed = true;
    runtime.deaths = 3;
    run(runtime, 1);
    expect(runtime.elapsed).toBeGreaterThan(0);

    runtime.restartLevel();
    expect(runtime.elapsed).toBe(0);
    expect(runtime.deaths).toBe(0);
    expect(runtime.progress).toBe(0);
    expect(runtime.checkpoints.every((c) => !c.claimed)).toBe(true);
    expect(runtime.checkpointLabel()).toBe("SPAWN");
  });
});

describe("engine: semantic events drive mechanics by type", () => {
  it("Ghostline stays gentle: no watchdog pursuit or moving sweepers", () => {
    const { tuned } = level("level01");
    const runtime = new LevelRuntime(tuned);
    expect(runtime.profile.watchdog).toBe(0);
    expect(runtime.hazards.watchdogTriggers).toEqual([]);
    expect(runtime.hazards.beams).toEqual([]);
    expect(runtime.hazards.gates.length).toBeGreaterThan(0);
  });

  it("Firewall turns firewall and authentication call sites into gates", () => {
    const { tuned } = level("level02");
    const runtime = new LevelRuntime(tuned);
    const firewalls = tuned.events.filter((e) => e.type === "firewall").length;
    const auths = tuned.events.filter((e) => e.type === "authentication").length;
    expect(runtime.hazards.gates.length).toBe(firewalls + auths);
    expect(runtime.hazards.gates.some((g) => g.identity)).toBe(true);
    expect(runtime.hazards.beams.length).toBe(0);
  });

  it("Sweep keeps every second scanner call site as a beam", () => {
    const { tuned } = level("level03");
    const runtime = new LevelRuntime(tuned);
    const scanners = tuned.events.filter((e) => e.type === "scanner").length;
    expect(scanners).toBeGreaterThan(5);
    expect(runtime.hazards.beams.length).toBe(Math.ceil(scanners / 2));
    expect(runtime.hazards.gates.length).toBe(0);
  });

  it("Watchdog builds pursuit pressure from watchdog call sites", () => {
    const { tuned } = level("level04");
    const runtime = new LevelRuntime(tuned);
    const watchdogs = tuned.events.filter((e) => e.type === "watchdog").length;
    expect(runtime.hazards.watchdogTriggers.length).toBe(watchdogs);
    expect(runtime.hazards.watchdog.strength).toBeGreaterThan(0);
    expect(runtime.hazards.watchdog.active).toBe(false);

    // Passing a call site arms the wall behind the player, never in front.
    const first = runtime.hazards.watchdogTriggers[0];
    runtime.player.x = first.x + 5;
    run(runtime, 0.05);
    expect(runtime.hazards.watchdog.active).toBe(true);
    expect(runtime.hazards.watchdog.x).toBeLessThan(runtime.player.x);
  });

  it("Blackout runs every countermeasure at once", () => {
    const { tuned } = level("level05");
    const runtime = new LevelRuntime(tuned);
    expect(runtime.hazards.gates.length).toBeGreaterThan(0);
    expect(runtime.hazards.beams.length).toBeGreaterThan(0);
    expect(runtime.hazards.watchdogTriggers.length).toBeGreaterThan(0);
  });

  it("Relay turns its firewall and authentication call sites into gates, and runs no beams", () => {
    const { tuned } = level("level06");
    const runtime = new LevelRuntime(tuned);
    const gated =
      tuned.events.filter((e) => e.type === "firewall").length +
      tuned.events.filter((e) => e.type === "authentication").length;
    expect(runtime.hazards.gates.length).toBe(gated);
    expect(runtime.hazards.beams.length).toBe(0);
    expect(runtime.hazards.watchdogTriggers.length).toBe(0);
  });

  it("Quarantine sweeps the shaft with a beam per scanner call site", () => {
    const { tuned } = level("level07");
    const runtime = new LevelRuntime(tuned);
    const scanners = tuned.events.filter((e) => e.type === "scanner").length;
    expect(scanners).toBeGreaterThan(5);
    expect(runtime.hazards.beams.length).toBe(scanners);
    // Its one firewall call site is the midpoint gate the shaft is built around.
    expect(runtime.hazards.gates.length).toBe(1);
  });

  it("Root runs every countermeasure, like Blackout but longer", () => {
    const { tuned } = level("level08");
    const runtime = new LevelRuntime(tuned);
    expect(runtime.hazards.gates.length).toBeGreaterThan(0);
    expect(runtime.hazards.beams.length).toBeGreaterThan(0);
    expect(runtime.hazards.watchdogTriggers.length).toBeGreaterThan(0);
    expect(tuned.route.platform_ids.length).toBeGreaterThan(
      level("level05").tuned.route.platform_ids.length,
    );
  });

  it("anchors a hazard in the crossing after its call site, in both axes", () => {
    // On a climb the gap the player has to get through is overhead, not off to
    // one side, so a hazard anchored only in x would guard nothing.
    const { tuned } = level("level07");
    const runtime = new LevelRuntime(tuned);
    const byId = new Map(tuned.platforms.map((p) => [p.id, p]));
    const route = tuned.route.platform_ids;
    for (const beam of runtime.hazards.beams) {
      const event = tuned.events.find((e) => e.id === beam.eventId)!;
      const at = route.indexOf(event.platform);
      const here = byId.get(event.platform)!;
      const next = byId.get(route[at + 1]);
      if (!next) continue;
      const midY = (here.y + next.y) / 2;
      // The beam's own line sits between the two blocks, not on either.
      const centreY = (beam.top + beam.bottom) / 2;
      expect(Math.abs(centreY - midY)).toBeLessThan(Math.abs(here.y - next.y));
      expect(midY).toBeLessThan(here.y);
    }
  });

  it("makes transfer and checkpoint call sites into respawn points", () => {
    const { tuned } = level("level05");
    const runtime = new LevelRuntime(tuned);
    const transferPlatforms = tuned.events
      .filter((e) => e.type === "transfer")
      .map((e) => e.platform);
    for (const platform of transferPlatforms) {
      expect(
        runtime.checkpoints.some((c) => c.platformId === platform),
        `${platform} carries a transfer, so it should be a respawn point`,
      ).toBe(true);
    }
    // Every delivered checkpoint survives too.
    for (const c of tuned.checkpoints) {
      expect(runtime.checkpoints.some((r) => r.id === c.id)).toBe(true);
    }
  });

  it("dispatches a beacon event the first time the player reaches a call site", () => {
    const { tuned } = level("level01");
    const runtime = new LevelRuntime(tuned);
    const beacon = runtime.hazards.beacons[0];
    runtime.player.x = beacon.x;
    runtime.player.y = beacon.y - 40;
    const events = run(runtime, 0.05);
    const fired = events.filter((e) => e.kind === "beacon");
    expect(fired.length).toBe(1);
    expect(beacon.triggered).toBe(true);
    // And only once.
    expect(run(runtime, 0.3).some((e) => e.kind === "beacon" && e.beacon.id === beacon.id)).toBe(
      false,
    );
  });

  it("relieves watchdog pressure when a checkpoint is claimed", () => {
    const { tuned } = level("level04");
    const runtime = new LevelRuntime(tuned);
    const trigger = runtime.hazards.watchdogTriggers[0];
    // Stand at a checkpoint that sits past the first watchdog call site, so
    // the wall is already chasing when the checkpoint is claimed.
    const checkpoint = runtime.checkpoints.find((c) => c.x > trigger.x)!;
    runtime.player.x = checkpoint.box.x + checkpoint.box.w / 2;
    runtime.player.y = checkpoint.box.y + checkpoint.box.h / 2;
    runtime.hazards.watchdog.active = true;
    runtime.hazards.watchdog.activations = 1;
    runtime.hazards.watchdog.x = runtime.player.x - 600;
    const before = runtime.hazards.watchdog.x;
    run(runtime, 0.05);
    expect(checkpoint.claimed).toBe(true);
    expect(runtime.hazards.watchdog.x).toBeLessThan(before - HAZARD.watchdog.checkpointRelief / 2);
    expect(runtime.hazards.watchdog.reliefFlash).toBeGreaterThan(0);
  });

  it("catches a player who stops moving", () => {
    const { tuned } = level("level04");
    const runtime = new LevelRuntime(tuned);
    // A route platform clear of every safe harbour, so this measures the wall
    // and not the sanctuary rule.
    const past = tuned.route.platform_ids.length * 0.6;
    const perch = runtime
      .routePlatforms()
      .find(
        (p) =>
          !runtime.checkpoints.some((c) => c.platformId === p.spec.id) &&
          p.spec.route_index !== null &&
          p.spec.route_index > past,
      )!;
    expect(perch, "a route platform clear of every safe harbour").toBeTruthy();
    runtime.player.x = perch.solid.x + perch.solid.w / 2;
    runtime.player.y = perch.solid.y - 40;
    run(runtime, 0.6);
    expect(runtime.player.grounded).toBe(true);

    runtime.hazards.watchdog.active = true;
    runtime.hazards.watchdog.activations = runtime.hazards.watchdogTriggers.length;
    runtime.hazards.watchdog.x = runtime.player.x - 400;
    const before = runtime.deaths;
    run(runtime, 6);
    expect(runtime.deaths, "idling in front of the watchdog has to cost you").toBe(before + 1);
  });

  it("stays outrunnable: full speed beats the wall even fully armed", () => {
    const { tuned } = level("level04");
    const runtime = new LevelRuntime(tuned);
    const armed = runtime.hazards.watchdogTriggers.length;
    const top =
      (HAZARD.watchdog.baseSpeed + HAZARD.watchdog.speedStep * (armed - 1)) *
      runtime.profile.watchdog;
    expect(armed).toBeGreaterThan(1);
    // Faster than a bot playing the trace cleanly (~165u/s), so sloppy play is
    // punished; slower than a flat-out run, so it is never a death sentence.
    expect(top).toBeGreaterThan(200);
    expect(top).toBeLessThan(PLAYER.maxRunSpeed);
  });

  it("gets faster with every watchdog call site the player passes", () => {
    const { tuned } = level("level04");
    const runtime = new LevelRuntime(tuned);
    const speeds: number[] = [];
    for (const trigger of runtime.hazards.watchdogTriggers) {
      runtime.player.x = trigger.x + 5;
      run(runtime, 0.05);
      speeds.push(runtime.hazards.watchdog.speed);
    }
    expect(speeds.length).toBeGreaterThan(2);
    for (let i = 1; i < speeds.length; i += 1) {
      expect(speeds[i]).toBeGreaterThan(speeds[i - 1]);
    }
  });

  it("pushes the watchdog well behind the player on respawn", () => {
    const { tuned } = level("level04");
    const runtime = new LevelRuntime(tuned);
    const first = runtime.hazards.watchdogTriggers[0];
    runtime.player.x = first.x + 5;
    run(runtime, 0.05);
    runtime.hazards.watchdog.x = runtime.player.x - 20;
    runtime.respawnToCheckpoint();
    expect(runtime.respawnPoint().x - runtime.hazards.watchdog.x).toBeGreaterThanOrEqual(
      HAZARD.watchdog.respawnSetback - 1,
    );
  });
});

describe("engine: checkpoint spacing", () => {
  it.each(levels)(
    "$entry.id never asks for a longer hold than its theme allows",
    ({ tuned }) => {
      const runtime = new LevelRuntime(tuned);
      const route = tuned.route.platform_ids;
      const index = new Map(route.map((id, i) => [id, i]));
      const anchors = [
        0,
        ...runtime.checkpoints.map((c) => index.get(c.platformId) ?? -1).filter((i) => i >= 0),
        route.length - 1,
      ].sort((a, b) => a - b);
      const longest = Math.max(...anchors.slice(1).map((v, i) => v - anchors[i]));
      // One over the spacing is the deliberate guard against dropping a relief
      // checkpoint immediately next to a delivered one.
      expect(longest).toBeLessThanOrEqual(runtime.profile.checkpointSpacing + 1);
    },
  );

  it("keeps every delivered checkpoint, and adds relief ones only on the route", () => {
    for (const { tuned } of levels) {
      const runtime = new LevelRuntime(tuned);
      const route = new Set(tuned.route.platform_ids);
      for (const c of tuned.checkpoints) {
        expect(runtime.checkpoints.some((r) => r.id === c.id)).toBe(true);
      }
      for (const c of runtime.checkpoints) {
        expect(route.has(c.platformId), `${c.id} must sit on a route platform`).toBe(true);
      }
      // Never on the exit block: the objective is not a rest stop.
      expect(runtime.checkpoints.some((c) => c.platformId === tuned.objective.platform)).toBe(
        false,
      );
    }
  });

  it("adds relief saves where the delivered checkpoints leave too long a run", () => {
    // Watchdog and Quarantine each ship two saves across 19 and 28 blocks.
    // The engine fills the gaps in, on real route platforms, so no theme ever
    // asks for a longer unbroken hold than its own profile allows.
    for (const id of ["level04", "level07"]) {
      const { tuned, source } = level(id);
      const runtime = new LevelRuntime(tuned);
      expect(source.checkpoints.length).toBe(2);
      expect(
        runtime.checkpoints.length,
        `${id} should gain relief saves`,
      ).toBeGreaterThan(source.checkpoints.length);
    }
  });

  it("gives the beam-heavy levels the tightest save spacing", () => {
    // Sweep and Quarantine are the two levels where a mistimed crossing is the
    // main way to die, so they hold the player to the shortest runs.
    for (const id of ["level03", "level07"]) {
      expect(new LevelRuntime(level(id).tuned).profile.checkpointSpacing).toBeLessThan(
        THEME_PROFILES.tutorial_horizontal.checkpointSpacing,
      );
    }
  });

  it("numbers the plain checkpoints in the order the player meets them", () => {
    const { tuned } = level("level03");
    const runtime = new LevelRuntime(tuned);
    const labels = runtime.checkpoints.map((c) => c.label);
    expect(labels[0]).toBe("CHECKPOINT 1");
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("engine: objective", () => {
  it("requires the player to hold the region, not just touch it", () => {
    const { tuned } = level("level01");
    const runtime = new LevelRuntime(tuned);
    const box = runtime.objectiveBox;
    runtime.player.x = box.x + box.w / 2;
    runtime.player.y = box.y + box.h / 2;

    run(runtime, 0.2);
    expect(runtime.completed, "a moment inside the region is not a completion").toBe(false);
    expect(runtime.objectiveHold).toBeGreaterThan(0);

    const events = run(runtime, runtime.profile.objectiveDwell + 0.5);
    expect(runtime.completed).toBe(true);
    expect(events.some((e) => e.kind === "complete")).toBe(true);
  });

  it("gives the finales the longest execution", () => {
    expect(THEME_PROFILES.mixed_first_finale.objectiveDwell).toBeGreaterThan(
      THEME_PROFILES.tutorial_horizontal.objectiveDwell,
    );
    expect(
      THEME_PROFILES.multiphase_finale.objectiveDwell,
      "Root is the true finale, so it takes the longest to execute",
    ).toBeGreaterThanOrEqual(THEME_PROFILES.mixed_first_finale.objectiveDwell);
  });

  it("keeps the objective region reachable from the objective platform", () => {
    for (const { tuned } of levels) {
      const runtime = new LevelRuntime(tuned);
      const platform = runtime.platformsById.get(tuned.objective.platform)!;
      const standing = {
        x: platform.solid.x + platform.solid.w / 2 - 11,
        y: platform.solid.y - 34,
        w: 22,
        h: 34,
      };
      expect(
        boxesOverlap(standing, runtime.objectiveBox),
        `${tuned.level.id}: standing on the exit block must count as being in the region`,
      ).toBe(true);
    }
  });
});

describe("engine: progress tracking", () => {
  it("advances with the chronological trace", () => {
    const { tuned } = level("level01");
    const runtime = new LevelRuntime(tuned);
    expect(runtime.progressFraction()).toBe(0);
    const midway = runtime.routePlatforms()[9];
    runtime.player.x = midway.solid.x + midway.solid.w / 2;
    runtime.player.y = midway.solid.y - 40;
    run(runtime, 0.6);
    expect(runtime.progress).toBeGreaterThanOrEqual(9);
    expect(runtime.progressFraction()).toBeGreaterThan(0.4);
  });

  it("reports the player's own box, so hazards read the same rectangle", () => {
    const { tuned } = level("level01");
    const runtime = new LevelRuntime(tuned);
    const box = playerBox(runtime.player);
    expect(box.w).toBeGreaterThan(0);
    expect(box.h).toBeGreaterThan(0);
  });
});

describe("progression", () => {
  let progress: Progress;
  beforeEach(() => {
    progress = new Progress();
    progress.reset();
  });

  it("starts with nothing cleared", () => {
    expect(progress.completedCount()).toBe(0);
    expect(progress.get("level01").completed).toBe(false);
  });

  it("records a clear and keeps the best run", () => {
    progress.record("level01", 92.5, 4);
    expect(progress.get("level01")).toEqual({ completed: true, bestTime: 92.5, bestDeaths: 4 });
    progress.record("level01", 71.25, 6);
    expect(progress.get("level01").bestTime).toBe(71.25);
    expect(progress.get("level01").bestDeaths).toBe(4);
    progress.record("level02", 60, 0);
    expect(progress.completedCount()).toBe(2);
  });
});
