/** Small geometry helpers shared by physics, targeting and rendering. */

export interface Vec2 {
  x: number;
  y: number;
}

/** Axis-aligned box in world units, anchored at its top-left corner. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Frame-rate independent exponential smoothing. */
export function damp(a: number, b: number, rate: number, dt: number): number {
  return lerp(a, b, 1 - Math.exp(-rate * dt));
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function pointInBox(px: number, py: number, b: Box): boolean {
  return px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;
}

export function clampPointToBox(px: number, py: number, b: Box): Vec2 {
  return { x: clamp(px, b.x, b.x + b.w), y: clamp(py, b.y, b.y + b.h) };
}

export interface RayHit {
  index: number;
  distance: number;
  point: Vec2;
}

/**
 * Nearest hit of a ray against boxes fattened by `radius` (a swept-circle
 * approximation). Fattening is what makes 24-unit-tall slabs realistic aim
 * targets from a few hundred units away.
 */
export function raycastBoxes(
  origin: Vec2,
  dir: Vec2,
  maxDistance: number,
  boxes: readonly Box[],
  radius = 0,
  accept?: (index: number) => boolean,
): RayHit | null {
  let best: RayHit | null = null;
  const invX = dir.x === 0 ? Infinity : 1 / dir.x;
  const invY = dir.y === 0 ? Infinity : 1 / dir.y;

  for (let i = 0; i < boxes.length; i += 1) {
    if (accept && !accept(i)) continue;
    const b = boxes[i];
    const minX = b.x - radius;
    const minY = b.y - radius;
    const maxX = b.x + b.w + radius;
    const maxY = b.y + b.h + radius;

    let t0 = 0;
    let t1 = maxDistance;

    if (dir.x === 0) {
      if (origin.x < minX || origin.x > maxX) continue;
    } else {
      const ta = (minX - origin.x) * invX;
      const tb = (maxX - origin.x) * invX;
      t0 = Math.max(t0, Math.min(ta, tb));
      t1 = Math.min(t1, Math.max(ta, tb));
      if (t0 > t1) continue;
    }

    if (dir.y === 0) {
      if (origin.y < minY || origin.y > maxY) continue;
    } else {
      const ta = (minY - origin.y) * invY;
      const tb = (maxY - origin.y) * invY;
      t0 = Math.max(t0, Math.min(ta, tb));
      t1 = Math.min(t1, Math.max(ta, tb));
      if (t0 > t1) continue;
    }

    if (t0 > maxDistance) continue;
    if (best && t0 >= best.distance) continue;

    // Snap the contact back onto the real box so the rope visibly touches it.
    const raw = { x: origin.x + dir.x * t0, y: origin.y + dir.y * t0 };
    best = { index: i, distance: t0, point: clampPointToBox(raw.x, raw.y, b) };
  }

  return best;
}
