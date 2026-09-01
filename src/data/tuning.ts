/**
 * Playability layout tuning.
 *
 * The delivered `x`/`y` coordinates passed the exporter's own geometric
 * validator, not a rope-physics simulation, and that validator's own note says
 * so. In several levels consecutive route platforms sit 65-200 units apart
 * while being 112-225 units wide, which is close to a continuous walkway: the
 * grappling hook has nothing to do. Ghostline in particular is completable
 * with nothing but the jump button.
 *
 * This module widens the *separation between consecutive route platforms*
 * while leaving every binary fact alone. It tunes horizontal layout only.
 * Platform ids, logical nodes, occurrences, trace occurrences, raw-block
 * mappings, code display payloads, provenance, richness, machine CFG truth,
 * semantic events, `y` and heights are copied untouched. Crumble decoys widen
 * to match the genuine route platform they appear to lead toward. Their near
 * edge stays fixed and the added width grows away from that route platform.
 * The widened slab also moves horizontally away from the straight anchor-to-
 * target corridor by the added half-width plus a small margin. That preserves
 * the clearance the authored narrow footprint gave an honest grapple while
 * making the whole rendered slab valid footing.
 *
 * Two properties make it safe for all eight levels rather than only the flat
 * ones:
 *
 * - It works on *route steps*, not on a global sorted `x` map, so a level
 *   whose route doubles back horizontally (Quarantine's shaft, Root's climbs)
 *   is handled by the same code as a level that runs left to right.
 * - Each step is widened in proportion to how horizontal it already is. A step
 *   that is mostly a climb keeps its horizontal extent, so a vertical level
 *   stays a vertical level instead of being flattened into a staircase.
 *
 * Non-route objects — every crumble decoy — ride along on the route they were
 * placed against, using the exporter's own `physical_anchor_platform` and
 * `apparent_target_platform`. A decoy positioned as a stepping stone halfway
 * to the next block stays halfway to the next block.
 */

import type { LevelData, LevelTheme, PlatformSpec } from "./types.ts";

export interface GapProfile {
  /** Multiplier applied to the supplied separation, lerped across the level. */
  gapScale: [number, number];
  /** Flat widening in game units, lerped across the level. */
  gapBonus: [number, number];
  /**
   * Hard cap on the resulting centre-to-centre required grapple distance. The
   * dataset's own design limit is 600 units; staying under it is what keeps a
   * tuned layout honest against the delivered movement model.
   */
  maxLinkDistance: number;
  /** Floor on the resulting edge-to-edge horizontal separation. */
  minGap: number;
}

/**
 * Per-theme pacing. The first value of each pair applies at the level's start
 * and the second at its end, so every level ramps from short hops into long
 * swings instead of repeating one uniform gap.
 */
export const GAP_PROFILES: Record<LevelTheme, GapProfile> = {
  // Ghostline teaches: walk, hop, then grapple. It arrives as a walkway, so it
  // needs the most widening of any level — and it ramps, so the first hops stay
  // jumpable and the rope is introduced rather than demanded.
  tutorial_horizontal: {
    gapScale: [1.05, 1.7],
    gapBonus: [60, 120],
    maxLinkDistance: 480,
    minGap: 75,
  },
  // Firewall's tiers already supply vertical difficulty; widen mostly to open
  // the gates' guarded crossings into real decisions.
  gated_mixed: { gapScale: [1.1, 1.6], gapBonus: [45, 90], maxLinkDistance: 450, minGap: 75 },
  // Sweep: mid-length gaps so the beams stay the threat, not the geometry.
  scanner_zigzag: { gapScale: [1.2, 2.1], gapBonus: [75, 150], maxLinkDistance: 525, minGap: 100 },
  // Watchdog arrives already spaced for the rope: its delivered gaps are as
  // wide as its own blocks, and eight of its eighteen hops still need the
  // line. Widening it pulls the route out from under decoys that were placed
  // to catch a shorter hop — measurably so; the honest options on its tightest
  // step drop from four in five to one — so it keeps its delivered spacing and
  // only the minimum-gap floor applies.
  pressure_momentum: { gapScale: [1.0, 1.0], gapBonus: [0, 0], maxLinkDistance: 545, minGap: 130 },
  // Blackout arrives already wide; nudge it and cap it.
  mixed_first_finale: {
    gapScale: [1.1, 1.7],
    gapBonus: [50, 125],
    maxLinkDistance: 500,
    minGap: 120,
  },
  // Relay is long. Keep the gaps generous but not exhausting, so its length
  // comes from the fork structure rather than from every hop being maximal.
  fork_reconvergence: {
    gapScale: [1.2, 2.0],
    gapBonus: [70, 150],
    maxLinkDistance: 490,
    minGap: 110,
  },
  // Quarantine is a shaft. Its steps are already 235 units of climb and every
  // one of them needs the rope, so it is left almost exactly as delivered —
  // widening it would turn the shaft into a staircase.
  vertical_containment: {
    gapScale: [1.0, 1.12],
    gapBonus: [0, 30],
    maxLinkDistance: 560,
    minGap: 0,
  },
  // Root's five phases each get the widening their own local geometry earns:
  // the climbs stay climbs, the lateral runs open up.
  multiphase_finale: {
    gapScale: [1.15, 1.85],
    gapBonus: [55, 145],
    maxLinkDistance: 500,
    minGap: 110,
  },
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

/**
 * How much of each platform's `x` moves, keyed by platform id. Exposed so the
 * developer overlay and the tests can compare delivered against tuned
 * coordinates without recomputing the transform.
 */
export type XOffsets = ReadonlyMap<string, number>;

function nearestRouteId(p: PlatformSpec, route: readonly PlatformSpec[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;
  const c = platformCentre(p);
  for (const candidate of route) {
    const rc = platformCentre(candidate);
    const d = Math.hypot(rc.x - c.x, rc.y - c.y);
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate.id;
    }
  }
  return best;
}

/**
 * Builds the per-platform horizontal offsets for a level without applying
 * them. Route platforms accumulate the widening; everything else rides along
 * on the route objects it was authored against.
 */
export function buildOffsets(level: LevelData, profile: GapProfile): XOffsets {
  const byId = new Map(level.platforms.map((p) => [p.id, p]));
  const route = level.route.platform_ids
    .map((id) => byId.get(id))
    .filter((p): p is PlatformSpec => p !== undefined);

  const offsets = new Map<string, number>();
  if (route.length === 0) return offsets;

  offsets.set(route[0].id, 0);
  let running = 0;

  for (let i = 1; i < route.length; i += 1) {
    const prev = route[i - 1];
    const next = route[i];
    const t = route.length > 1 ? (i - 1) / (route.length - 1) : 0;

    const dx = platformCentre(next).x - platformCentre(prev).x;
    const dy = next.y - prev.y;
    const absDx = Math.abs(dx);
    const halfWidths = (prev.width + next.width) / 2;
    // Edge-to-edge horizontal clearance between the two slabs. Negative when
    // they overlap in x, which is normal on a climb.
    const separation = absDx - halfWidths;

    // Only widen in proportion to how horizontal the step already is, so a
    // climb keeps its shape and a run opens up.
    const horizontality = absDx + Math.abs(dy) > 0 ? absDx / (absDx + Math.abs(dy)) : 0;
    const wanted = Math.max(
      profile.minGap,
      separation * lerp(...profile.gapScale, t) + lerp(...profile.gapBonus, t),
    );
    const target = separation + (wanted - separation) * horizontality;

    // The cap is on the centre-to-centre *hypotenuse*, so a step that also
    // drops 260 units gets a proportionally shorter horizontal reach.
    const maxRun = Math.sqrt(Math.max(0, profile.maxLinkDistance ** 2 - dy ** 2));
    // Never pull two platforms closer than the exporter placed them: tuning
    // only ever spreads a layout out.
    const widened = Math.max(absDx, Math.min(maxRun, halfWidths + target));
    const direction = dx === 0 ? 0 : Math.sign(dx);

    running += direction * widened - dx;
    offsets.set(next.id, running);
  }

  // Everything off the route rides along with the pair of route objects it was
  // authored between, so a decoy placed a third of the way to the next block
  // stays a third of the way there.
  for (const p of level.platforms) {
    if (offsets.has(p.id)) continue;
    const anchorId = p.physical_anchor_platform ?? nearestRouteId(p, route);
    const anchor = anchorId ? byId.get(anchorId) : undefined;
    const targetId = p.apparent_target_platform;
    const target = targetId ? byId.get(targetId) : undefined;
    const anchorOffset = anchorId ? (offsets.get(anchorId) ?? 0) : 0;

    if (!anchor || !target || !offsets.has(target.id)) {
      offsets.set(p.id, anchorOffset);
      continue;
    }
    // Project onto the anchor-to-target segment in two dimensions: on a climb
    // the two ends share an x, and a purely horizontal fraction would be
    // meaningless there.
    offsets.set(p.id, lerp(anchorOffset, offsets.get(target.id) ?? anchorOffset, alongSegment(anchor, target, p)));
  }

  // A route that doubles back (Quarantine's shaft, Root's climbs) accumulates
  // negative offsets, which would walk the level off the left edge of the
  // world. Rebase so the layout starts exactly where the exporter put it.
  let leftmost = Infinity;
  let deliveredLeftmost = Infinity;
  for (const p of level.platforms) {
    leftmost = Math.min(leftmost, p.x + (offsets.get(p.id) ?? 0));
    deliveredLeftmost = Math.min(deliveredLeftmost, p.x);
  }
  const rebase = Number.isFinite(leftmost) ? deliveredLeftmost - leftmost : 0;
  if (rebase !== 0) {
    for (const [id, value] of offsets) offsets.set(id, value + rebase);
  }

  return offsets;
}

/**
 * Where `p` sits between `a` and `b`, as a 0-1 parameter along the segment
 * joining their centres. Degenerate segments return the midpoint.
 */
export function alongSegment(
  a: { x: number; y: number; width: number },
  b: { x: number; y: number; width: number },
  p: { x: number; y: number; width: number },
): number {
  const ca = platformCentre(a);
  const cb = platformCentre(b);
  const cp = platformCentre(p);
  const vx = cb.x - ca.x;
  const vy = cb.y - ca.y;
  const length = vx * vx + vy * vy;
  if (length < 1) return 0.5;
  const t = ((cp.x - ca.x) * vx + (cp.y - ca.y) * vy) / length;
  return Math.min(1, Math.max(0, t));
}

/** Recomputes the centre-to-centre distance the exporter stores on each link. */
function linkDistance(a: PlatformSpec, b: PlatformSpec): number {
  const ca = platformCentre(a);
  const cb = platformCentre(b);
  return Math.round(Math.hypot(cb.x - ca.x, cb.y - ca.y) * 10) / 10;
}

/**
 * Returns a new `LevelData` with widened route spacing and visually full-sized
 * crumble decoys. Binary facts, mappings and every `y` value are preserved.
 */
export function tuneLayout(level: LevelData, profile?: GapProfile): LevelData {
  const chosen = profile ?? GAP_PROFILES[level.level.theme];
  if (!chosen) return level;
  const offsets = buildOffsets(level, chosen);
  const shift = (id: string | undefined, x: number): number =>
    x + (id ? (offsets.get(id) ?? 0) : 0);

  const deliveredById = new Map(level.platforms.map((p) => [p.id, p]));
  const platforms = level.platforms.map((p) => {
    const movedX = p.x + (offsets.get(p.id) ?? 0);
    const apparentTarget = p.apparent_target_platform
      ? deliveredById.get(p.apparent_target_platform)
      : undefined;
    const physicalAnchor = p.physical_anchor_platform
      ? deliveredById.get(p.physical_anchor_platform)
      : undefined;
    const width = p.kind === "crumble" && apparentTarget ? apparentTarget.width : p.width;
    const targetX = apparentTarget
      ? apparentTarget.x + (offsets.get(apparentTarget.id) ?? 0)
      : movedX;
    const relative = movedX + p.width / 2 - (targetX + (apparentTarget?.width ?? p.width) / 2);
    const widenedX =
      p.kind !== "crumble" || width === p.width
        ? movedX
        : relative < 0
          ? movedX - (width - p.width)
          : relative > 0
            ? movedX
            : movedX - (width - p.width) / 2;
    let corridorShift = 0;
    if (p.kind === "crumble" && width > p.width && apparentTarget && physicalAnchor) {
      const anchorX = physicalAnchor.x + (offsets.get(physicalAnchor.id) ?? 0);
      const ax = anchorX + physicalAnchor.width / 2;
      const ay = physicalAnchor.y + physicalAnchor.height / 2;
      const bx = targetX + apparentTarget.width / 2;
      const by = apparentTarget.y + apparentTarget.height / 2;
      const cx = widenedX + width / 2;
      const cy = p.y + p.height / 2;
      const vx = bx - ax;
      const vy = by - ay;
      const lengthSq = vx * vx + vy * vy;
      if (lengthSq > 1) {
        const along = Math.min(1, Math.max(0, ((cx - ax) * vx + (cy - ay) * vy) / lengthSq));
        const awayX = cx - (ax + along * vx);
        const side = Math.sign(awayX || -vy || 1);
        corridorShift = side * ((width - p.width) / 2 + 24);
      }

      // Keep the authored side of the physical anchor. A nearby decoy may
      // approach the anchor as it clears the corridor, but never cross it and
      // become a different spatial choice.
      const authoredAnchorCentre = physicalAnchor.x + physicalAnchor.width / 2;
      const authoredSide = Math.sign(p.x + p.width / 2 - authoredAnchorCentre);
      const tunedAnchorCentre = anchorX + physicalAnchor.width / 2;
      const shiftedCentre = widenedX + width / 2 + corridorShift;
      if (authoredSide !== 0 && Math.sign(shiftedCentre - tunedAnchorCentre) !== authoredSide) {
        corridorShift = tunedAnchorCentre + authoredSide - (widenedX + width / 2);
      }
    }

    return {
      ...p,
      // Keep the edge facing the apparent target where it was authored; all
      // extra footing grows away from the successful route.
      x: widenedX + corridorShift,
      width,
    };
  });
  const byId = new Map(platforms.map((p) => [p.id, p]));

  const right = platforms.reduce((m, p) => Math.max(m, p.x + p.width), 0);

  return {
    ...level,
    world: {
      ...level.world,
      width: Math.ceil(Math.max(level.world.width, right + 340)),
    },
    player: {
      spawn: {
        ...level.player.spawn,
        x: shift(level.player.spawn.platform, level.player.spawn.x),
      },
    },
    grapple_links: level.grapple_links.map((link) => {
      const a = byId.get(link.from);
      const b = byId.get(link.to);
      return a && b ? { ...link, distance: linkDistance(a, b) } : { ...link };
    }),
    checkpoints: level.checkpoints.map((c) => ({
      ...c,
      respawn: { ...c.respawn, x: shift(c.platform, c.respawn.x) },
    })),
    objective: {
      ...level.objective,
      region: {
        ...level.objective.region,
        x: shift(level.objective.platform, level.objective.region.x),
      },
    },
    platforms,
  };
}

/** The offsets a level's tuning applied, for the developer overlay. */
export function layoutOffsets(level: LevelData): XOffsets {
  const profile = GAP_PROFILES[level.level.theme];
  return profile ? buildOffsets(level, profile) : new Map<string, number>();
}
