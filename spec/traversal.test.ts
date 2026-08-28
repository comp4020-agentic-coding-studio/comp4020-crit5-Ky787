/**
 * The hard promise: every delivered route is actually playable.
 *
 * The offline validator checked reachability against an abstract model and
 * said so — "intentionally not a rope-physics engine". These tests close that
 * gap by driving the game's own fixed-step physics with scripted input. If a
 * hop cannot be made here, it cannot be made in the browser either.
 */

import { describe, expect, it } from "vitest";
import { GRAPPLE, PLAYER } from "../src/engine/constants.ts";
import { LevelRuntime } from "../src/engine/level-runtime.ts";
import { analyseRoute, playThrough, planHop, standOn } from "../src/engine/traversal.ts";
import {
  createPlayer,
  emptyInput,
  findGrappleTarget,
  probeRope,
  releaseRope,
  stepPlayer,
} from "../src/engine/physics.ts";
import type { Solid } from "../src/engine/physics.ts";
import { levels, level } from "./fixtures.ts";

function bare(tuned: (typeof levels)[number]["tuned"]): LevelRuntime {
  // Crumble decoys removed, hazards off: this is a pure geometry-and-physics
  // question, and the point is that the route needs neither.
  return new LevelRuntime(tuned, { withoutCrumble: true, withoutHazards: true });
}

describe.each(levels)("traversal: $entry.id", ({ tuned }) => {
  const runtime = bare(tuned);
  const report = analyseRoute(
    tuned.level.id,
    runtime.solids,
    tuned.route.platform_ids,
    runtime.deathY,
  );

  it("can make every hop on the successful route", () => {
    const failed = report.hops.filter((h) => !h.result.ok).map((h) => `${h.from}->${h.to}`);
    expect(failed, "hops no scripted input could clear").toEqual([]);
  });

  it("needs the grapple: not every gap is jumpable", () => {
    expect(report.grappleRequired).toBeGreaterThan(0);
  });

  it("plays through from spawn to objective with no crumble block present", () => {
    const play = playThrough(bare(tuned));
    expect(
      play.completed,
      play.stalledAt ? `stalled before ${play.stalledAt}` : "did not finish",
    ).toBe(true);
  });

  it("plays through with the decoys in place, without ever needing one", () => {
    const world = new LevelRuntime(tuned, { withoutHazards: true });
    const play = playThrough(world);
    expect(play.completed).toBe(true);
    const decoysUsedOnRoute = world.platforms.filter(
      (p) => p.spec.kind === "crumble" && p.spec.required,
    );
    expect(decoysUsedOnRoute).toEqual([]);
  });
});

describe("traversal: level identity comes out of the same engine", () => {
  it("Ghostline mixes hops and swings; the finale is nearly all rope", () => {
    const jumpShare = (id: string): number => {
      const { tuned } = level(id);
      const runtime = bare(tuned);
      const report = analyseRoute(id, runtime.solids, tuned.route.platform_ids, runtime.deathY);
      return (report.hops.length - report.grappleRequired) / report.hops.length;
    };
    expect(jumpShare("level01")).toBeGreaterThan(0.1);
    expect(jumpShare("level05")).toBeLessThan(0.15);
  });
});

describe("physics: the hook always leaves the gun", () => {
  const block = (id: string, x: number, y: number, w = 200, h = 24): Solid => ({
    id,
    x,
    y,
    w,
    h,
    oneWay: true,
    enabled: true,
    grappleable: true,
  });

  /** Fires and holds, reporting what the rope did. */
  function fireAndHold(
    solids: Solid[],
    start: { x: number; y: number; vx?: number; vy?: number },
    aim: { x: number; y: number },
    steps = 90,
  ): { phases: Set<string>; anchorId: string | null; attachPoint: { x: number; y: number } } {
    const p = createPlayer(start.x, start.y);
    p.vx = start.vx ?? 0;
    p.vy = start.vy ?? 0;
    const input = emptyInput();
    input.aim = aim;
    const phases = new Set<string>();
    for (let i = 0; i < steps; i += 1) {
      input.grappleHeld = true;
      input.grapplePressed = i === 0;
      stepPlayer(p, input, solids, 1 / 120);
      phases.add(p.rope.phase);
      if (p.rope.phase === "attached") break;
    }
    return { phases, anchorId: p.rope.anchorId, attachPoint: { ...p.rope.anchor } };
  }

  it("fires into empty space and comes back with nothing", () => {
    const solids = [block("floor", -300, 60, 600)];
    const shot = fireAndHold(solids, { x: 0, y: 0 }, { x: 0, y: -900 });
    expect(shot.phases.has("firing"), "the hook should visibly leave the gun").toBe(true);
    expect(shot.phases.has("attached")).toBe(false);
    expect(shot.phases.has("retracting"), "and then disappear").toBe(true);
    expect(shot.anchorId).toBeNull();
  });

  it("attaches when the shot is aimed at a block", () => {
    const solids = [block("target", -100, -400)];
    const shot = fireAndHold(solids, { x: 0, y: 0 }, { x: 0, y: -400 });
    expect(shot.anchorId).toBe("target");
  });

  it("catches a block the hook missed but the rope swept across", () => {
    // Straight up from x=0: the hook's own path never touches the block, which
    // sits off to the side. Moving fast drags the rope line across it.
    const target = block("swept", 60, -248, 80);
    const shot = fireAndHold([target], { x: 0, y: 0, vx: 900 }, { x: 0, y: -900 });
    expect(shot.anchorId, "the rope line should have caught it").toBe("swept");
    // And it attaches where the line met the block, not out at the hook.
    expect(shot.attachPoint.x).toBeGreaterThanOrEqual(target.x - 1);
    expect(shot.attachPoint.x).toBeLessThanOrEqual(target.x + target.w + 1);

    // Standing still, the same shot catches nothing: the sweep is what does it.
    const still = fireAndHold([target], { x: 0, y: 0 }, { x: 0, y: -900 });
    expect(still.anchorId).toBeNull();
  });

  it("will not catch on something at arm's length, or out of range", () => {
    const near = probeRope({ x: 0, y: 0 }, { x: 1, y: 0 }, 600, [block("near", 20, -12, 40)]);
    expect(near, "arm's-length scenery is not an anchor").toBeNull();

    const far = probeRope({ x: 0, y: 0 }, { x: 1, y: 0 }, 900, [block("far", 900, -12, 200)]);
    expect(far, "nothing attaches beyond the rope's reach").toBeNull();

    const good = probeRope({ x: 0, y: 0 }, { x: 1, y: 0 }, 600, [block("good", 300, -12, 200)]);
    expect(good?.solid.id).toBe("good");
  });
});

describe("physics: the grapple is a momentum mechanic", () => {
  const { tuned } = level("level01");
  const runtime = bare(tuned);
  const solids = runtime.solids;

  it("attaches to what the reticle highlighted, and only within range", () => {
    const target = runtime.routePlatforms()[2].solid;
    const player = standOn(solids, runtime.routePlatforms()[1].solid);
    const aim = { x: target.x + target.w / 2, y: target.y };
    const found = findGrappleTarget({ x: player.x, y: player.y }, aim, solids, player.groundId);
    expect(found?.solid.id).toBe(target.id);
    expect(found!.distance).toBeLessThanOrEqual(GRAPPLE.maxRange);

    const far = runtime.routePlatforms().at(-1)!.solid;
    const outOfRange = findGrappleTarget(
      { x: player.x, y: player.y },
      { x: far.x, y: far.y },
      solids,
      player.groundId,
    );
    expect(outOfRange?.solid.id).not.toBe(far.id);
  });

  it("will not attach to a collapsed block", () => {
    const world = new LevelRuntime(tuned);
    const decoy = world.platforms.find((p) => p.spec.kind === "crumble")!;
    decoy.solid.grappleable = false;
    const aim = { x: decoy.solid.x + decoy.solid.w / 2, y: decoy.solid.y };
    const found = findGrappleTarget(
      { x: decoy.solid.x - 200, y: decoy.solid.y + 40 },
      aim,
      world.solids,
    );
    expect(found?.solid.id).not.toBe(decoy.spec.id);
  });

  it("builds real speed on the swing and keeps it through the release", () => {
    const from = runtime.routePlatforms()[3].solid;
    const to = runtime.routePlatforms()[4].solid;
    const player = standOn(solids, from, 0.1);
    const input = emptyInput();
    input.aim = { x: to.x + 8, y: to.y + to.h / 2 };

    let peak = 0;
    let sinceAttach = 0;
    let before = 0;
    for (let i = 0; i < 400; i += 1) {
      input.right = true;
      input.grappleHeld = true;
      input.grapplePressed = i === 40;
      stepPlayer(player, input, solids, 1 / 120);
      if (player.rope.phase !== "attached") continue;
      sinceAttach += 1;
      peak = Math.max(peak, Math.hypot(player.vx, player.vy));
      if (sinceAttach === 60) {
        before = player.vx;
        break;
      }
    }
    expect(peak, "the swing should build more speed than running does").toBeGreaterThan(
      PLAYER.maxRunSpeed,
    );

    // Releasing must not throw the momentum away: it is the whole mechanic.
    // Vertical speed swaps sign through the arc, so travel speed is the claim.
    releaseRope(player);
    expect(player.vx).toBeCloseTo(before, 6);

    input.grappleHeld = false;
    input.grapplePressed = false;
    input.right = false;
    for (let i = 0; i < 12; i += 1) stepPlayer(player, input, solids, 1 / 120);
    expect(
      Math.abs(player.vx),
      "letting go should coast, not brake",
    ).toBeGreaterThan(Math.abs(before) * 0.9);
  });

  it("will not hook the block the player is standing on", () => {
    const stand = runtime.routePlatforms()[1].solid;
    const player = standOn(solids, stand);
    const found = findGrappleTarget(
      { x: player.x, y: player.y },
      { x: stand.x + stand.w, y: stand.y + 6 },
      solids,
      player.groundId,
    );
    expect(found?.solid.id).not.toBe(stand.id);
  });

  it("is frame-rate independent at the fixed step", () => {
    const a = standOn(solids, runtime.routePlatforms()[1].solid);
    const b = structuredClone(a);
    const input = emptyInput();
    input.right = true;
    for (let i = 0; i < 120; i += 1) stepPlayer(a, input, solids, 1 / 120);
    for (let i = 0; i < 120; i += 1) stepPlayer(b, input, solids, 1 / 120);
    expect(b.x).toBeCloseTo(a.x, 9);
    expect(b.y).toBeCloseTo(a.y, 9);
  });

  it("lets the player stand on a block and not sink through it", () => {
    const solid = runtime.routePlatforms()[5].solid;
    const player = standOn(solids, solid);
    const input = emptyInput();
    for (let i = 0; i < 600; i += 1) stepPlayer(player, input, solids, 1 / 120);
    expect(player.grounded).toBe(true);
    expect(player.y + PLAYER.height / 2).toBeCloseTo(solid.y, 3);
  });

  it("plans a reachable hop between two adjacent route blocks", () => {
    const route = runtime.routePlatforms();
    const result = planHop(solids, route[0].solid, route[1].solid, runtime.deathY);
    expect(result.ok).toBe(true);
    expect(result.plan?.duration).toBeLessThan(5);
  });
});
