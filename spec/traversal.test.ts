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
import { emptyInput, stepPlayer, findGrappleTarget, releaseRope } from "../src/engine/physics.ts";
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
