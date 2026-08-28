/**
 * Engine contracts: the mechanics the brief promises the player. Crumble
 * blocks only ever come from proven bogus control flow, death returns you to
 * the last checkpoint with the world put back, semantic events dispatch by
 * type, and progression records what you finished.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { HAZARD, THEME_PROFILES } from "../src/engine/constants.ts";
import { boxesOverlap } from "../src/engine/geometry.ts";
import { LevelRuntime } from "../src/engine/level-runtime.ts";
import type { RuntimeEvent } from "../src/engine/level-runtime.ts";
import { emptyInput, playerBox } from "../src/engine/physics.ts";
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

describe("engine: crumble blocks", () => {
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
  it("Ghostline stays gentle: no watchdog pursuit, slow gates", () => {
    const { tuned } = level("level01");
    const runtime = new LevelRuntime(tuned);
    expect(runtime.profile.watchdog).toBe(0);
    expect(runtime.hazards.watchdogTriggers).toEqual([]);
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

  it("Sweep turns every scanner call site into a beam", () => {
    const { tuned } = level("level03");
    const runtime = new LevelRuntime(tuned);
    const scanners = tuned.events.filter((e) => e.type === "scanner").length;
    expect(scanners).toBeGreaterThan(5);
    expect(runtime.hazards.beams.length).toBe(scanners);
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

  it("makes transfer and checkpoint call sites into respawn points", () => {
    const { tuned } = level("level05");
    const runtime = new LevelRuntime(tuned);
    const transfers = tuned.events.filter((e) => e.type === "transfer").length;
    const soft = runtime.checkpoints.filter((c) => c.soft);
    expect(soft.length).toBe(transfers);
    expect(runtime.checkpoints.length).toBe(tuned.checkpoints.length + transfers);
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

  it("gives the finale the longest execution", () => {
    expect(THEME_PROFILES.finale.objectiveDwell).toBeGreaterThan(
      THEME_PROFILES.tutorial.objectiveDwell,
    );
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
