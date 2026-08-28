/**
 * Player movement, one-way platform collision and the rope constraint.
 *
 * Everything here is pure with respect to the DOM: the same code runs in the
 * browser and in the headless traversal tests, on the same fixed timestep, so
 * a route proven reachable in a test is reachable in the game.
 */

import { GRAPPLE, PLAYER } from "./constants.ts";
import type { Box, Vec2 } from "./geometry.ts";
import { clamp, raycastBoxes } from "./geometry.ts";

export interface Solid extends Box {
  id: string;
  /** Landable from above only. Every code block behaves this way. */
  oneWay: boolean;
  /** Collapsed crumble blocks stay in the list but stop colliding. */
  enabled: boolean;
  /** Excluded from grapple targeting when false (collapsed blocks). */
  grappleable: boolean;
}

export type RopePhase = "idle" | "firing" | "attached" | "retracting";

export interface RopeState {
  phase: RopePhase;
  anchorId: string | null;
  anchor: Vec2;
  /** Animated hook position while firing or retracting. */
  tip: Vec2;
  /** Distance the hook still has to travel. */
  flightRemaining: number;
  flightTotal: number;
  length: number;
  taut: boolean;
  /** Units the rope shortened this step; converted into inward momentum. */
  shrink: number;
}

export interface PlayerState {
  /** Centre of the player's AABB. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
  groundId: string | null;
  facing: 1 | -1;
  coyote: number;
  jumpBuffer: number;
  dropThrough: number;
  /** Ground solid ignored while dropping through it. */
  dropIgnore: string | null;
  rope: RopeState;
  /** Set for one step when the player lands, so callers can trigger effects. */
  justLanded: boolean;
  /** Seconds since the rope last released; drives the HUD readout. */
  airTime: number;
}

export interface InputState {
  left: boolean;
  right: boolean;
  down: boolean;
  jumpHeld: boolean;
  jumpPressed: boolean;
  grappleHeld: boolean;
  grapplePressed: boolean;
  reelIn: boolean;
  reelOut: boolean;
  /** Pointer position in world units. */
  aim: Vec2;
}

export function emptyInput(): InputState {
  return {
    left: false,
    right: false,
    down: false,
    jumpHeld: false,
    jumpPressed: false,
    grappleHeld: false,
    grapplePressed: false,
    reelIn: false,
    reelOut: false,
    aim: { x: 0, y: 0 },
  };
}

export function createPlayer(x: number, y: number): PlayerState {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    grounded: false,
    groundId: null,
    facing: 1,
    coyote: 0,
    jumpBuffer: 0,
    dropThrough: 0,
    dropIgnore: null,
    justLanded: false,
    airTime: 0,
    rope: {
      phase: "idle",
      anchorId: null,
      anchor: { x: 0, y: 0 },
      tip: { x, y },
      flightRemaining: 0,
      flightTotal: 0,
      length: 0,
      taut: false,
      shrink: 0,
    },
  };
}

export function playerBox(p: PlayerState): Box {
  return {
    x: p.x - PLAYER.width / 2,
    y: p.y - PLAYER.height / 2,
    w: PLAYER.width,
    h: PLAYER.height,
  };
}

export interface GrappleTarget {
  solid: Solid;
  point: Vec2;
  distance: number;
}

/**
 * What the hook would attach to if fired at `aim` right now. Shared by the
 * targeting reticle, the code inspector and the firing code itself, so the
 * player always grapples exactly what the reticle highlighted.
 */
export function findGrappleTarget(
  origin: Vec2,
  aim: Vec2,
  solids: readonly Solid[],
  /** Block the player is standing on; never a useful anchor. */
  ignoreId?: string | null,
): GrappleTarget | null {
  const dx = aim.x - origin.x;
  const dy = aim.y - origin.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-4) return null;
  const dir = { x: dx / len, y: dy / len };
  const hit = raycastBoxes(
    origin,
    dir,
    GRAPPLE.maxRange,
    solids,
    GRAPPLE.aimAssistRadius,
    (i) => solids[i].grappleable && solids[i].id !== ignoreId,
  );
  if (!hit) return null;
  const solid = solids[hit.index];
  // Anything already within arm's reach is scenery, not an anchor.
  const reach = Math.hypot(hit.point.x - origin.x, hit.point.y - origin.y);
  if (reach < GRAPPLE.minRange) return null;
  return { solid, point: hit.point, distance: hit.distance };
}

export function releaseRope(p: PlayerState, boost = true): void {
  if (p.rope.phase === "idle") return;
  if (p.rope.phase === "attached" && boost) {
    p.vy -= GRAPPLE.releaseBoost;
    p.vx *= GRAPPLE.releaseMomentum;
    p.vy *= GRAPPLE.releaseMomentum;
  }
  p.rope.phase = "retracting";
  p.rope.anchorId = null;
  p.rope.taut = false;
  p.airTime = 0;
}

function fireRope(p: PlayerState, target: GrappleTarget): void {
  p.rope.phase = "firing";
  p.rope.anchorId = target.solid.id;
  p.rope.anchor = { x: target.point.x, y: target.point.y };
  p.rope.tip = { x: p.x, y: p.y };
  p.rope.flightTotal = Math.max(1, target.distance);
  p.rope.flightRemaining = p.rope.flightTotal;
  p.rope.taut = false;
}

function stepRope(p: PlayerState, input: InputState, solids: readonly Solid[], dt: number): void {
  const rope = p.rope;
  rope.shrink = 0;

  if (input.grapplePressed && (rope.phase === "idle" || rope.phase === "retracting")) {
    const target = findGrappleTarget({ x: p.x, y: p.y }, input.aim, solids, p.groundId);
    if (target) fireRope(p, target);
  }

  if (rope.phase === "firing") {
    rope.flightRemaining -= GRAPPLE.hookSpeed * dt;
    const travelled = rope.flightTotal - Math.max(0, rope.flightRemaining);
    const dx = rope.anchor.x - p.x;
    const dy = rope.anchor.y - p.y;
    const t = clamp(travelled / rope.flightTotal, 0, 1);
    rope.tip = { x: p.x + dx * t, y: p.y + dy * t };
    if (!input.grappleHeld) {
      rope.phase = "retracting";
      rope.anchorId = null;
    } else if (rope.flightRemaining <= 0) {
      const anchorSolid = solids.find((s) => s.id === rope.anchorId);
      if (!anchorSolid || !anchorSolid.grappleable) {
        rope.phase = "retracting";
        rope.anchorId = null;
      } else {
        rope.phase = "attached";
        rope.length = Math.max(GRAPPLE.minLength, Math.hypot(dx, dy));
        rope.tip = { ...rope.anchor };
      }
    }
    return;
  }

  if (rope.phase === "retracting") {
    const dx = p.x - rope.tip.x;
    const dy = p.y - rope.tip.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 24) {
      rope.phase = "idle";
      rope.tip = { x: p.x, y: p.y };
      return;
    }
    const step = Math.min(dist, GRAPPLE.hookSpeed * 1.4 * dt);
    rope.tip = { x: rope.tip.x + (dx / dist) * step, y: rope.tip.y + (dy / dist) * step };
    return;
  }

  if (rope.phase === "attached") {
    if (!input.grappleHeld) {
      releaseRope(p);
      return;
    }
    const anchorSolid = solids.find((s) => s.id === rope.anchorId);
    if (!anchorSolid || !anchorSolid.grappleable) {
      releaseRope(p, false);
      return;
    }
    rope.tip = { ...rope.anchor };
    const dist = Math.hypot(p.x - rope.anchor.x, p.y - rope.anchor.y);
    // Reeling only bites once the line is taut, so the initial drop off a
    // ledge stays a natural fall rather than an instant yank.
    const taut = dist >= rope.length - 4;
    if (input.reelOut) {
      rope.length = Math.min(GRAPPLE.maxRange, rope.length + GRAPPLE.reelOutSpeed * dt);
    } else if (taut || input.reelIn) {
      const next = Math.max(GRAPPLE.minLength, rope.length - GRAPPLE.reelInSpeed * dt);
      rope.shrink = rope.length - next;
      rope.length = next;
    }
  }
}

function applyRopeConstraint(p: PlayerState, dt: number): void {
  const rope = p.rope;
  if (rope.phase !== "attached") {
    rope.taut = false;
    return;
  }
  const dx = p.x - rope.anchor.x;
  const dy = p.y - rope.anchor.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= rope.length || dist < 1e-4) {
    rope.taut = false;
    return;
  }
  rope.taut = true;
  const nx = dx / dist;
  const ny = dy / dist;
  p.x = rope.anchor.x + nx * rope.length;
  p.y = rope.anchor.y + ny * rope.length;
  const radial = p.vx * nx + p.vy * ny;
  if (radial > 0) {
    p.vx -= nx * radial * GRAPPLE.ropeStiffness;
    p.vy -= ny * radial * GRAPPLE.ropeStiffness;
  }
  // A taut rope that shortened this step dragged the player inward; turn that
  // displacement into momentum so letting go actually launches them.
  if (rope.shrink > 0 && dt > 0) {
    const pull = (rope.shrink / dt) * GRAPPLE.reelTransfer;
    p.vx -= nx * pull;
    p.vy -= ny * pull;
  }
}

function resolveVertical(p: PlayerState, prevBottom: number, solids: readonly Solid[]): void {
  const half = PLAYER.height / 2;
  const halfW = PLAYER.width / 2;
  const bottom = p.y + half;
  p.grounded = false;
  p.groundId = null;
  if (p.vy < 0) return;

  let bestTop = Infinity;
  let bestId: string | null = null;
  for (const s of solids) {
    if (!s.enabled) continue;
    if (p.dropThrough > 0 && s.id === p.dropIgnore) continue;
    if (p.x + halfW <= s.x || p.x - halfW >= s.x + s.w) continue;
    const top = s.y;
    // One-way: only catch the player if their feet were above the surface.
    if (prevBottom > top + 1.5) continue;
    if (bottom < top) continue;
    if (top < bestTop) {
      bestTop = top;
      bestId = s.id;
    }
  }

  if (bestId !== null) {
    if (p.vy > 120) p.justLanded = true;
    p.y = bestTop - half;
    p.vy = 0;
    p.grounded = true;
    p.groundId = bestId;
  }
}

/** One fixed physics step. `dt` must be the constant step, not frame time. */
export function stepPlayer(
  p: PlayerState,
  input: InputState,
  solids: readonly Solid[],
  dt: number,
): void {
  p.justLanded = false;
  p.coyote = Math.max(0, p.coyote - dt);
  p.jumpBuffer = Math.max(0, p.jumpBuffer - dt);
  p.dropThrough = Math.max(0, p.dropThrough - dt);
  if (p.dropThrough === 0) p.dropIgnore = null;
  if (input.jumpPressed) p.jumpBuffer = PLAYER.jumpBuffer;

  stepRope(p, input, solids, dt);
  const attached = p.rope.phase === "attached";
  if (attached) p.airTime += dt;

  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (dir !== 0) p.facing = dir > 0 ? 1 : -1;

  // Horizontal control. Acceleration is skipped when it would push past the
  // run cap, so rope momentum survives but running still tops out.
  if (attached) {
    p.vx += dir * GRAPPLE.swingAccel * dt;
  } else if (dir !== 0) {
    const accel = p.grounded ? PLAYER.accel : PLAYER.airAccel;
    const over = Math.abs(p.vx) >= PLAYER.maxRunSpeed && Math.sign(p.vx) === dir;
    if (!over) {
      p.vx += dir * accel * dt;
      if (Math.sign(p.vx) === dir && Math.abs(p.vx) > PLAYER.maxRunSpeed) {
        p.vx = dir * PLAYER.maxRunSpeed;
      }
    }
  } else if (p.grounded) {
    const drop = PLAYER.groundFriction * dt;
    p.vx = Math.abs(p.vx) <= drop ? 0 : p.vx - Math.sign(p.vx) * drop;
  } else {
    const drop = PLAYER.airDrag * dt;
    p.vx = Math.abs(p.vx) <= drop ? 0 : p.vx - Math.sign(p.vx) * drop;
  }

  // Jump. While attached, a jump doubles as "let go and kick".
  if (p.jumpBuffer > 0 && (p.grounded || p.coyote > 0 || attached)) {
    if (attached) {
      releaseRope(p);
      p.vy = Math.min(p.vy, 0) - PLAYER.jumpVelocity * 0.72;
    } else {
      p.vy = -PLAYER.jumpVelocity;
    }
    p.jumpBuffer = 0;
    p.coyote = 0;
    p.grounded = false;
  }

  if (input.down && p.grounded && p.groundId) {
    p.dropIgnore = p.groundId;
    p.dropThrough = 0.22;
    p.grounded = false;
    p.y += 2;
  }

  let gravity = PLAYER.gravity;
  if (p.vy < 0 && input.jumpHeld && !attached) gravity *= PLAYER.jumpHoldGravity;
  else if (p.vy > 0) gravity *= PLAYER.fallGravity;
  p.vy += gravity * dt;
  if (p.vy > PLAYER.maxFallSpeed) p.vy = PLAYER.maxFallSpeed;

  const speed = Math.hypot(p.vx, p.vy);
  if (speed > PLAYER.maxSpeed) {
    p.vx = (p.vx / speed) * PLAYER.maxSpeed;
    p.vy = (p.vy / speed) * PLAYER.maxSpeed;
  }

  const prevBottom = p.y + PLAYER.height / 2;
  p.x += p.vx * dt;
  p.y += p.vy * dt;

  applyRopeConstraint(p, dt);
  resolveVertical(p, prevBottom, solids);

  if (p.grounded) {
    p.coyote = PLAYER.coyoteTime;
    p.airTime = 0;
  }
}
