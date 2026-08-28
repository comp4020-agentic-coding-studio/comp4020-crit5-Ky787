/**
 * Headless traversal solver.
 *
 * The delivered layouts were validated against an abstract reachability model,
 * explicitly "not a rope-physics engine". This module closes that gap: it
 * drives the real fixed-step physics with scripted input and reports whether a
 * hop between two platforms is actually achievable, and whether a whole level
 * can be played through from spawn to objective.
 */

import { FIXED_DT, PLAYER } from "./constants.ts";
import type { LevelRuntime } from "./level-runtime.ts";
import type { InputState, PlayerState, Solid } from "./physics.ts";
import { createPlayer, emptyInput, stepPlayer } from "./physics.ts";

export interface HopPlan {
  kind: "jump" | "grapple";
  /** Seconds of run-up before the action. */
  runUp: number;
  jumpHold?: number;
  aimPoint?: number;
  /** Seconds the rope was held (grapple plans). */
  ropeHold?: number;
  jumpOff?: boolean;
  /** Simulated seconds the hop took. */
  duration: number;
  /** Replayable input script; lets a caller run the plan on a live runtime. */
  script: InputScript;
}

export type InputScript = (t: number, p: PlayerState, input: InputState) => void;

export interface HopResult {
  ok: boolean;
  plan: HopPlan | null;
  /** Closest approach to the landing surface, for diagnosing failures. */
  bestDistance: number;
}

const RUN_UPS = [0.05, 0.18, 0.32, 0.5, 0.75, 1.05];
const JUMP_HOLDS = [0.04, 0.18, 0.4];
const BACK_UPS = [0, 0.28, 0.6];
/** How far inside a block's edges a landing must come to rest to count. */
const LANDING_MARGIN = 16;
const ROPE_HOLDS = [0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.05, 1.2, 1.4, 1.6, 1.9, 2.3, 2.8];

export function clearInput(input: InputState): void {
  input.left = false;
  input.right = false;
  input.down = false;
  input.jumpPressed = false;
  input.jumpHeld = false;
  input.grapplePressed = false;
  input.grappleHeld = false;
  input.reelIn = false;
  input.reelOut = false;
}

/** Places a player standing on the given solid, settled and still. */
export function standOn(solids: readonly Solid[], target: Solid, atRatio = 0.5): PlayerState {
  const p = createPlayer(target.x + target.w * atRatio, target.y - PLAYER.height / 2 - 2);
  const input = emptyInput();
  for (let i = 0; i < 30 && !p.grounded; i += 1) stepPlayer(p, input, solids, FIXED_DT);
  return p;
}

function aimPoints(target: Solid): { x: number; y: number }[] {
  return [
    { x: target.x + 6, y: target.y + target.h / 2 },
    { x: target.x + target.w * 0.35, y: target.y + target.h / 2 },
    { x: target.x + target.w * 0.72, y: target.y + target.h / 2 },
    { x: target.x + target.w - 6, y: target.y + target.h / 2 },
  ];
}

/**
 * A landing only counts if the player will still be on the block once friction
 * has stopped them. Clipping the corner at speed and skating off the far side
 * is not a landing, and a plan built on one is not reproducible.
 */
export function stuckOn(p: PlayerState, target: Solid): boolean {
  if (p.groundId !== target.id) return false;
  const slide = (p.vx * p.vx) / (2 * PLAYER.groundFriction);
  const restX = p.x + Math.sign(p.vx) * slide;
  return (
    p.x > target.x + LANDING_MARGIN &&
    p.x < target.x + target.w - LANDING_MARGIN &&
    restX > target.x + LANDING_MARGIN &&
    restX < target.x + target.w - LANDING_MARGIN
  );
}

interface SimOutcome {
  landed: boolean;
  time: number;
  bestDistance: number;
}

function trySim(
  solids: readonly Solid[],
  start: PlayerState,
  target: Solid,
  deathY: number,
  script: InputScript,
  maxTime: number,
): SimOutcome {
  const p: PlayerState = structuredClone(start);
  const input = emptyInput();
  let t = 0;
  let best = Infinity;
  const goalX = target.x + target.w / 2;
  const goalY = target.y;

  while (t < maxTime) {
    clearInput(input);
    script(t, p, input);
    stepPlayer(p, input, solids, FIXED_DT);
    t += FIXED_DT;
    best = Math.min(best, Math.hypot(p.x - goalX, p.y - goalY));
    if (p.y > deathY) return { landed: false, time: t, bestDistance: best };
    if (p.grounded && p.groundId === target.id && stuckOn(p, target)) {
      return { landed: true, time: t, bestDistance: 0 };
    }
  }
  return { landed: false, time: t, bestDistance: best };
}

/**
 * Searches a small space of scripted inputs for one that gets the player from
 * where they are standing onto `to`. Plain jumps are tried first, then the
 * adaptive "swing until clear of the lip, then let go" plan a person would
 * use, then a grid of fixed rope holds.
 */
export function planHopFrom(
  solids: readonly Solid[],
  start: PlayerState,
  to: Solid,
  deathY: number,
): HopResult {
  if (!start.grounded) return { ok: false, plan: null, bestDistance: Infinity };
  const forward = to.x + to.w / 2 >= start.x ? 1 : -1;
  let best = Infinity;

  const hold = (input: InputState): void => {
    if (forward > 0) input.right = true;
    else input.left = true;
  };
  const backOff = (input: InputState): void => {
    if (forward > 0) input.left = true;
    else input.right = true;
  };

  /** Prefixes a plan with a short walk backwards, to buy run-up room. */
  const withBackUp = (backUp: number, inner: InputScript): InputScript => {
    if (backUp <= 0) return inner;
    return (t, p, input) => {
      if (t < backUp) {
        backOff(input);
        return;
      }
      inner(t - backUp, p, input);
    };
  };

  const attempt = (
    script: InputScript,
    maxTime: number,
    describe: () => Omit<HopPlan, "duration" | "script">,
    replay: () => InputScript,
  ): HopResult | null => {
    const outcome = trySim(solids, start, to, deathY, script, maxTime);
    best = Math.min(best, outcome.bestDistance);
    if (!outcome.landed) return null;
    return {
      ok: true,
      plan: { ...describe(), duration: outcome.time, script: replay() },
      bestDistance: 0,
    };
  };

  const points = aimPoints(to);

  for (const backUp of BACK_UPS) {
    for (const runUp of RUN_UPS) {
      for (const jumpHold of JUMP_HOLDS) {
        const build = (): InputScript =>
          withBackUp(backUp, (t, _p, input) => {
            hold(input);
            if (t >= runUp && t < runUp + FIXED_DT * 1.5) input.jumpPressed = true;
            if (t >= runUp && t <= runUp + jumpHold) input.jumpHeld = true;
          });
        const hit = attempt(
          build(),
          3.2 + backUp,
          () => ({ kind: "jump", runUp, jumpHold }),
          build,
        );
        if (hit) return hit;
      }
    }
  }

  // The adaptive plan — swing until clear of the target's lip, then let go —
  // is what a person actually does, so it is tried before any fixed grid.
  for (const backUp of BACK_UPS) {
    for (let a = 0; a < points.length; a += 1) {
      const aim = points[a];
      for (const runUp of RUN_UPS) {
        for (const jumpOff of [false, true]) {
          const build = (): InputScript => {
            let released = -1;
            return withBackUp(backUp, (t, sp, input) => {
              hold(input);
              input.aim = aim;
              if (t < runUp) return;
              const clear =
                sp.y + PLAYER.height / 2 < to.y - 2 && sp.x > to.x - 70 && sp.x < to.x + to.w + 70;
              if (released < 0 && clear && sp.rope.phase === "attached") released = t;
              if (released < 0) {
                input.grappleHeld = true;
                if (t < runUp + FIXED_DT * 1.5) input.grapplePressed = true;
              } else if (jumpOff && t < released + FIXED_DT * 1.5) {
                input.jumpPressed = true;
                input.jumpHeld = true;
              }
            });
          };
          const hit = attempt(
            build(),
            5.0 + backUp,
            () => ({ kind: "grapple", runUp, aimPoint: a, jumpOff }),
            build,
          );
          if (hit) return hit;
        }
      }
    }
  }

  for (const backUp of BACK_UPS) {
    for (let a = 0; a < points.length; a += 1) {
      const aim = points[a];
      for (const runUp of RUN_UPS) {
        for (const ropeHold of ROPE_HOLDS) {
          for (const jumpOff of [false, true]) {
            const build = (): InputScript =>
              withBackUp(backUp, (t, _p, input) => {
                hold(input);
                input.aim = aim;
                if (t >= runUp && t < runUp + ropeHold) {
                  input.grappleHeld = true;
                  if (t < runUp + FIXED_DT * 1.5) input.grapplePressed = true;
                } else if (
                  jumpOff &&
                  t >= runUp + ropeHold &&
                  t < runUp + ropeHold + FIXED_DT * 1.5
                ) {
                  input.jumpPressed = true;
                  input.jumpHeld = true;
                }
              });
            const hit = attempt(
              build(),
              5.0 + backUp,
              () => ({ kind: "grapple", runUp, aimPoint: a, ropeHold, jumpOff }),
              build,
            );
            if (hit) return hit;
          }
        }
      }
    }
  }

  return { ok: false, plan: null, bestDistance: best };
}

export function planHop(
  solids: readonly Solid[],
  from: Solid,
  to: Solid,
  deathY: number,
): HopResult {
  const forward = to.x + to.w / 2 >= from.x + from.w / 2 ? 1 : -1;
  return planHopFrom(solids, standOn(solids, from, forward > 0 ? 0.12 : 0.88), to, deathY);
}

export interface RouteReport {
  levelId: string;
  hops: { from: string; to: string; result: HopResult }[];
  failures: number;
  /** Hops that no plain jump could clear, i.e. hops that need the grapple. */
  grappleRequired: number;
}

export function analyseRoute(
  levelId: string,
  solids: readonly Solid[],
  routeIds: readonly string[],
  deathY: number,
): RouteReport {
  const byId = new Map(solids.map((s) => [s.id, s]));
  const hops: RouteReport["hops"] = [];
  let failures = 0;
  let grappleRequired = 0;

  for (let i = 1; i < routeIds.length; i += 1) {
    const from = byId.get(routeIds[i - 1]);
    const to = byId.get(routeIds[i]);
    if (!from || !to) continue;
    const result = planHop(solids, from, to, deathY);
    hops.push({ from: from.id, to: to.id, result });
    if (!result.ok) failures += 1;
    else if (result.plan?.kind === "grapple") grappleRequired += 1;
  }

  return { levelId, hops, failures, grappleRequired };
}

export interface PlaythroughResult {
  completed: boolean;
  seconds: number;
  deaths: number;
  /** Route platform the run stalled on, if it did. */
  stalledAt: string | null;
  reachedIndex: number;
}

/**
 * Plays a level end to end on a live `LevelRuntime`: plans each hop from the
 * player's actual state, replays it against the real world (so checkpoints,
 * crumble blocks and the objective all really fire), then holds the objective.
 */
export interface PlaythroughOptions {
  budgetSeconds?: number;
  /** Optional hop-by-hop trace, for diagnosing a stall. */
  trace?: (message: string) => void;
}

export function playThrough(
  runtime: LevelRuntime,
  options: PlaythroughOptions = {},
): PlaythroughResult {
  const budgetSeconds = options.budgetSeconds ?? 400;
  const trace = options.trace;
  const input = emptyInput();
  const route = runtime.data.route.platform_ids;
  const routeIndex = new Map(route.map((id, i) => [id, i]));
  const solidById = new Map(runtime.solids.map((s) => [s.id, s]));
  let clock = 0;
  let furthest = 0;
  let stalledAt: string | null = null;

  const advance = (script: InputScript, seconds: number, stopWhen?: () => boolean): void => {
    let t = 0;
    while (t < seconds && clock < budgetSeconds) {
      clearInput(input);
      script(t, runtime.player, input);
      runtime.step(input, FIXED_DT);
      runtime.drainEvents();
      t += FIXED_DT;
      clock += FIXED_DT;
      if (stopWhen?.()) return;
    }
  };

  const ground = (): Solid | undefined =>
    runtime.player.groundId ? solidById.get(runtime.player.groundId) : undefined;

  /**
   * Walks to a spot on the current block and stops there, braking early enough
   * not to slide off. A swing often lands on the very lip of a block still
   * carrying sideways speed; a person pushes back onto it, and so must the bot.
   */
  const walkTo = (targetX: number): void => {
    advance(
      (_t, p, input) => {
        const remaining = targetX - p.x;
        const stopping = (p.vx * p.vx) / (2 * PLAYER.groundFriction);
        if (Math.abs(remaining) <= stopping + 3) {
          if (p.vx > 5) input.left = true;
          else if (p.vx < -5) input.right = true;
        } else if (remaining > 0) {
          input.right = true;
        } else {
          input.left = true;
        }
      },
      1.8,
      () =>
        !runtime.player.grounded ||
        runtime.dead ||
        (Math.abs(runtime.player.x - targetX) < 6 && Math.abs(runtime.player.vx) < 20),
    );
  };

  /** Waits for the ground, then coasts to a stop. */
  const settle = (): void => {
    if (!runtime.player.grounded || runtime.dead) {
      advance(
        () => {},
        2.2,
        () => runtime.player.grounded && !runtime.dead,
      );
    }
    if (runtime.dead) return;
    advance(
      () => {},
      0.8,
      () => !runtime.player.grounded || Math.abs(runtime.player.vx) < 20,
    );
  };

  // State-driven rather than index-driven: after a death the player is back at
  // a checkpoint, so "where am I standing?" is the only reliable question.
  const attempts = new Map<number, number>();
  let guard = 0;
  const guardLimit = route.length * 8 + 40;

  settle();
  while (!runtime.completed && clock < budgetSeconds && guard < guardLimit) {
    guard += 1;
    if (runtime.dead || !runtime.player.grounded) {
      settle();
      continue;
    }

    const standing = runtime.player.groundId;
    let index = standing ? (routeIndex.get(standing) ?? -1) : -1;
    if (index < 0) {
      // Landed somewhere off-route (a decoy). Aim at the next route platform
      // ahead of us and carry on.
      index = route.findIndex((id) => (solidById.get(id)?.x ?? -Infinity) > runtime.player.x) - 1;
      if (index < 0) {
        stalledAt = standing;
        break;
      }
    }
    furthest = Math.max(furthest, index);

    if (index >= route.length - 1) {
      advance(
        () => {},
        runtime.profile.objectiveDwell + 2.5,
        () => runtime.completed,
      );
      break;
    }

    const to = solidById.get(route[index + 1]);
    if (!to) break;

    // Try the hop from a few standing spots along the block, the way a person
    // shuffles back for more run-up when the first attempt looks short.
    const block = ground();
    let plan: HopResult = { ok: false, plan: null, bestDistance: Infinity };
    const forward = to.x + to.w / 2 >= runtime.player.x ? 1 : -1;
    const spots = block
      ? (forward > 0
          ? [block.x + 26, block.x + block.w * 0.42, block.x + block.w - 34]
          : [block.x + block.w - 26, block.x + block.w * 0.58, block.x + 34])
      : [runtime.player.x];
    for (const spot of spots) {
      if (block) {
        walkTo(spot);
        if (!runtime.player.grounded || runtime.dead) break;
      }
      plan = planHopFrom(runtime.solids, runtime.player, to, runtime.deathY);
      if (plan.ok) break;
    }
    if (!runtime.player.grounded || runtime.dead) {
      settle();
      continue;
    }
    if (!plan.ok || !plan.plan) {
      trace?.(
        `${route[index]} -> ${to.id}: no plan from x=${runtime.player.x.toFixed(0)} ` +
          `vx=${runtime.player.vx.toFixed(0)} (closest ${plan.bestDistance.toFixed(0)}u)`,
      );
      stalledAt = route[index + 1];
      break;
    }
    const startX = runtime.player.x;
    // Stop on the same condition the planner used, or the replay would bail
    // out on a lip-touch the plan never counted as a landing.
    const landed = (): boolean => runtime.player.grounded && stuckOn(runtime.player, to);
    advance(plan.plan.script, plan.plan.duration + 0.5, () => landed() || runtime.dead);
    settle();
    trace?.(
      `${route[index]} -> ${to.id} via ${plan.plan.kind} (runUp ${plan.plan.runUp}, hold ` +
        `${plan.plan.ropeHold ?? "adaptive"}) from x=${startX.toFixed(0)} → ` +
        `${runtime.player.groundId ?? "air"} x=${runtime.player.x.toFixed(0)}`,
    );

    // Only a hop that failed counts against the retry budget, so a long run
    // that passes through an index repeatedly after deaths is not penalised.
    if (runtime.player.groundId !== to.id) {
      const failures = (attempts.get(index) ?? 0) + 1;
      attempts.set(index, failures);
      if (failures > 6) {
        stalledAt = route[index + 1];
        break;
      }
    }
  }

  return {
    completed: runtime.completed,
    seconds: clock,
    deaths: runtime.deaths,
    stalledAt: runtime.completed ? null : (stalledAt ?? route[Math.min(furthest + 1, route.length - 1)]),
    reachedIndex: furthest,
  };
}
