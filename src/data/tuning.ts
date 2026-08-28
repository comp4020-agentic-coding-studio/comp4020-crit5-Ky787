/**
 * First-pass layout tuning.
 *
 * The delivered `x`/`y` coordinates passed an abstract reachability check, not
 * a rope-physics simulation: consecutive route platforms sit 15-260 units
 * apart while being 112-240 units wide, so the supplied layouts are close to a
 * continuous walkway and a grappling hook has nothing to do.
 *
 * This module stretches the horizontal *gaps* between route platforms while
 * leaving every binary fact alone. It only ever touches `x` values (and the
 * derived `distance` on grapple links, plus `world.width`). Platform ids,
 * logical nodes, occurrences, raw-block mappings, code display payloads,
 * provenance, semantic events, `y`, widths and heights are copied through
 * untouched.
 *
 * The transform is a monotone piecewise-linear map on `x`, built from the
 * route platforms, so every non-route object (crumble decoys included) keeps
 * its position *relative to the route* and simply spreads with it.
 */

import type { LevelData, LevelTheme, PlatformSpec } from "./types.ts";

export interface GapProfile {
  /** Multiplier applied to the supplied gap, lerped across the level. */
  gapScale: [number, number];
  /** Flat widening in game units, lerped across the level. */
  gapBonus: [number, number];
  /**
   * Hard cap on the resulting centre-to-centre required grapple distance. The
   * dataset's own design limit is 600 units; staying under it is what keeps a
   * tuned layout honest against the delivered movement model.
   */
  maxLinkDistance: number;
  /** Floor on the resulting edge-to-edge gap. */
  minGap: number;
}

/**
 * Per-theme pacing. The first value of each pair applies at the level's start
 * and the second at its end, so every level ramps from short hops into long
 * swings instead of repeating one uniform gap.
 */
export const GAP_PROFILES: Record<LevelTheme, GapProfile> = {
  // Ghostline teaches: walk, hop, then grapple. Slow ramp, generous cap.
  tutorial: { gapScale: [1.0, 2.6], gapBonus: [40, 150], maxLinkDistance: 520, minGap: 80 },
  // Firewall climbs; the vertical deltas already supply the difficulty.
  vertical_chambers: { gapScale: [1.1, 2.0], gapBonus: [40, 110], maxLinkDistance: 530, minGap: 80 },
  // Sweep is long and rhythmic: mid-length gaps so beams stay the threat.
  scanner_chambers: { gapScale: [1.4, 2.2], gapBonus: [60, 120], maxLinkDistance: 520, minGap: 90 },
  // Watchdog wants momentum: consistently long, chainable gaps.
  forward_pressure: { gapScale: [0.95, 1.8], gapBonus: [25, 95], maxLinkDistance: 540, minGap: 120 },
  // Blackout arrives already wide; nudge it and cap it.
  finale: { gapScale: [1.0, 1.4], gapBonus: [20, 70], maxLinkDistance: 545, minGap: 130 },
};

/** Centre point the exporter used when it measured grapple-link distances. */
export function platformCentre(p: { x: number; y: number; width: number }): {
  x: number;
  y: number;
} {
  return { x: p.x + p.width / 2, y: p.y };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** A monotone piecewise-linear `x -> x` map defined by sorted knots. */
export class XMap {
  private readonly from: number[];
  private readonly to: number[];

  constructor(from: number[], to: number[]) {
    this.from = from;
    this.to = to;
  }

  apply(x: number): number {
    const { from, to } = this;
    if (from.length === 0) return x;
    if (from.length === 1) return x + (to[0] - from[0]);
    if (x <= from[0]) return x + (to[0] - from[0]);
    const last = from.length - 1;
    if (x >= from[last]) return x + (to[last] - from[last]);
    // Binary search for the segment containing x.
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (from[mid] <= x) lo = mid;
      else hi = mid;
    }
    const span = from[hi] - from[lo];
    const t = span === 0 ? 0 : (x - from[lo]) / span;
    return lerp(to[lo], to[hi], t);
  }
}

/** Builds the x-map for a level without applying it (used by tests and tools). */
export function buildXMap(level: LevelData, profile: GapProfile): XMap {
  const byId = new Map(level.platforms.map((p) => [p.id, p]));
  const route = level.route.platform_ids
    .map((id) => byId.get(id))
    .filter((p): p is PlatformSpec => p !== undefined);

  const from: number[] = [];
  const to: number[] = [];
  if (route.length === 0) return new XMap(from, to);

  from.push(route[0].x);
  to.push(route[0].x);

  for (let i = 1; i < route.length; i += 1) {
    const prev = route[i - 1];
    const next = route[i];
    const t = route.length > 1 ? (i - 1) / (route.length - 1) : 0;
    const rawGap = next.x - (prev.x + prev.width);
    const halfWidths = (prev.width + next.width) / 2;
    // The cap is on the centre-to-centre *hypotenuse*, so a tier that also
    // drops 260 units gets a proportionally shorter horizontal reach.
    const dy = next.y - prev.y;
    const maxRun = Math.sqrt(Math.max(0, profile.maxLinkDistance ** 2 - dy ** 2));
    const gapCap = Math.max(profile.minGap, maxRun - halfWidths);
    const widened = rawGap * lerp(...profile.gapScale, t) + lerp(...profile.gapBonus, t);
    const gap = Math.min(gapCap, Math.max(profile.minGap, widened));
    from.push(next.x);
    to.push(to[i - 1] + prev.width + gap);
  }

  return new XMap(from, to);
}

/** Recomputes the centre-to-centre distance the exporter stores on each link. */
function linkDistance(a: PlatformSpec, b: PlatformSpec): number {
  const ca = platformCentre(a);
  const cb = platformCentre(b);
  return Math.round(Math.hypot(cb.x - ca.x, cb.y - ca.y) * 10) / 10;
}

/**
 * Returns a new `LevelData` with widened horizontal spacing. Binary facts,
 * mappings and every `y` value are preserved exactly.
 */
export function tuneLayout(level: LevelData, profile?: GapProfile): LevelData {
  const chosen = profile ?? GAP_PROFILES[level.level.theme];
  if (!chosen) return level;
  const map = buildXMap(level, chosen);

  const platforms = level.platforms.map((p) => ({ ...p, x: map.apply(p.x) }));
  const byId = new Map(platforms.map((p) => [p.id, p]));

  const rightEdge = platforms.reduce((m, p) => Math.max(m, p.x + p.width), 0);

  return {
    ...level,
    world: { ...level.world, width: Math.ceil(rightEdge + 340) },
    player: {
      spawn: { ...level.player.spawn, x: map.apply(level.player.spawn.x) },
    },
    grapple_links: level.grapple_links.map((link) => {
      const a = byId.get(link.from);
      const b = byId.get(link.to);
      return a && b ? { ...link, distance: linkDistance(a, b) } : { ...link };
    }),
    checkpoints: level.checkpoints.map((c) => ({
      ...c,
      respawn: { ...c.respawn, x: map.apply(c.respawn.x) },
    })),
    objective: {
      ...level.objective,
      region: { ...level.objective.region, x: map.apply(level.objective.region.x) },
    },
    platforms,
  };
}
