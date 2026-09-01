/**
 * The dataset contract: every delivered level loads, describes a playable
 * world, and keeps its binary facts intact through the playability tuning
 * pass. These are the promises the game makes about the data it is built on.
 */

import { describe, expect, it } from "vitest";
import { alongSegment, layoutOffsets, platformCentre, tuneLayout } from "../src/data/tuning.ts";
import { parseIndex, parseLevel } from "../src/data/levels.ts";
import { index, levels, level, readJson } from "./fixtures.ts";

function distanceToSegment(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): number {
  const vx = end.x - start.x;
  const vy = end.y - start.y;
  const lengthSq = vx * vx + vy * vy;
  const along =
    lengthSq > 0
      ? Math.min(1, Math.max(0, ((point.x - start.x) * vx + (point.y - start.y) * vy) / lengthSq))
      : 0;
  return Math.hypot(point.x - start.x - along * vx, point.y - start.y - along * vy);
}

describe("dataset: index", () => {
  it("is schema version 2 and lists all eight missions in order", () => {
    expect(index.schema_version).toBe(2);
    expect(index.level_count).toBe(8);
    expect(index.levels.map((l) => l.id)).toEqual([
      "level01",
      "level02",
      "level03",
      "level04",
      "level05",
      "level06",
      "level07",
      "level08",
    ]);
    expect(index.levels.map((l) => l.name)).toEqual([
      "Ghostline",
      "Firewall",
      "Sweep",
      "Watchdog",
      "Blackout",
      "Relay",
      "Quarantine",
      "Root",
    ]);
    expect(index.levels.map((l) => l.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("refuses the superseded schema-1 delivery outright", () => {
    // The old five-level tree is still on disk. One loader, one schema: a
    // loader that took either would be a way for the two to drift.
    expect(() => parseIndex({ schema_version: 1, levels: [{ id: "x", path: "x", world: {} }] })).toThrow(
      /schema 1/,
    );
  });

  it("names every level file it points at", () => {
    for (const entry of index.levels) {
      expect(() => readJson(entry.path)).not.toThrow();
    }
  });
});

/**
 * The production shape of the v2 delivery. These are the counts the exporter
 * committed to, and they are what stops a later layout change from quietly
 * shrinking a level back toward the old 19-route/8-decoy design.
 */
const PRODUCTION_SHAPE: Record<string, { route: number; bogus: number }> = {
  level01: { route: 19, bogus: 11 },
  level02: { route: 19, bogus: 13 },
  level03: { route: 19, bogus: 13 },
  level04: { route: 19, bogus: 15 },
  level05: { route: 19, bogus: 15 },
  level06: { route: 26, bogus: 16 },
  level07: { route: 28, bogus: 18 },
  level08: { route: 30, bogus: 20 },
};

describe("dataset: production shape", () => {
  it.each(levels)("$entry.id ships its full route and decoy count", ({ entry, source }) => {
    const expected = PRODUCTION_SHAPE[entry.id];
    expect(source.route.platform_ids.length).toBe(expected.route);
    expect(source.platforms.filter((p) => p.kind === "crumble").length).toBe(expected.bogus);
    expect(source.platforms.length).toBe(expected.route + expected.bogus);
  });

  it("gets longer and more decoy-dense toward Root", () => {
    const route = (id: string): number => level(id).source.route.platform_ids.length;
    expect(route("level06")).toBeGreaterThan(route("level05"));
    expect(route("level07")).toBeGreaterThan(route("level06"));
    expect(route("level08")).toBeGreaterThan(route("level07"));
    const density = (id: string): number => level(id).source.physical_choice_summary.route_choice_density;
    expect(density("level08")).toBeGreaterThan(density("level01"));
  });

  it("keeps each mission's spatial identity distinct", () => {
    // Quarantine is the vertical one: taller than it is wide, by a lot.
    const quarantine = level("level07").tuned.world;
    expect(quarantine.height).toBeGreaterThan(quarantine.width * 3);
    // Root is the big one: larger in both axes than the first finale.
    const root = level("level08").tuned.world;
    const blackout = level("level05").tuned.world;
    expect(root.width).toBeGreaterThan(blackout.width);
    expect(root.height).toBeGreaterThan(blackout.height);
    // And the early levels stay wide and shallow.
    for (const id of ["level01", "level02", "level03", "level04", "level05", "level06"]) {
      const world = level(id).tuned.world;
      expect(world.width, `${id} reads left to right`).toBeGreaterThan(world.height);
    }
  });

  it("only ever ships physical-gameplay grapple links", () => {
    for (const { source } of levels) {
      for (const link of source.grapple_links) {
        expect(
          link.relationship_layer,
          `${link.id} must not claim to be a machine-CFG edge`,
        ).toBe("physical_gameplay");
      }
    }
  });
});

describe.each(levels)("dataset: $entry.id", ({ entry, source, tuned }) => {
  it("declares the id the index promised", () => {
    expect(source.level.id).toBe(entry.id);
    expect(source.level.theme).toBe(entry.theme);
    expect(source.platforms.length).toBe(entry.platform_count);
  });

  it("spawns the player on a real platform", () => {
    const spawn = source.player.spawn;
    const platform = source.platforms.find((p) => p.id === spawn.platform);
    expect(platform, "spawn names a platform that exists").toBeTruthy();
    expect(spawn.y).toBeLessThan(source.world.death_y);
    // Spawn sits above the platform it names, not inside or below it.
    expect(spawn.y).toBeLessThanOrEqual(platform!.y);
  });

  it("has an objective region over the objective platform", () => {
    const objective = source.objective;
    const platform = source.platforms.find((p) => p.id === objective.platform);
    expect(platform).toBeTruthy();
    expect(objective.region.width).toBeGreaterThan(0);
    expect(objective.region.height).toBeGreaterThan(0);
    // The region must overlap a player standing on the block.
    expect(objective.region.y).toBeLessThan(platform!.y);
    expect(objective.region.y + objective.region.height).toBeGreaterThanOrEqual(platform!.y);
  });

  it("orders checkpoints along the route and clear of the death plane", () => {
    const sequences = source.checkpoints.map((c) => c.sequence);
    expect([...sequences].sort((a, b) => a - b)).toEqual(sequences);
    for (const checkpoint of source.checkpoints) {
      expect(source.platforms.some((p) => p.id === checkpoint.platform)).toBe(true);
      expect(checkpoint.respawn.y).toBeLessThan(source.world.death_y);
    }
  });

  it("keeps every platform above the death plane", () => {
    for (const p of tuned.platforms) {
      expect(p.y, `${p.id} is at or below the death plane`).toBeLessThan(tuned.world.death_y);
    }
  });

  it("anchors every semantic event to a platform that exists", () => {
    for (const event of source.events) {
      expect(source.platforms.some((p) => p.id === event.platform)).toBe(true);
      expect(event.instruction_address).toMatch(/^0x[0-9A-Fa-f]+$/);
    }
  });

  it("gives every route platform a chronological index", () => {
    source.route.platform_ids.forEach((id, i) => {
      const platform = source.platforms.find((p) => p.id === id);
      expect(platform?.route_index, `${id} route index`).toBe(i);
      expect(platform?.required).toBe(true);
    });
  });

  it("keeps every route platform's chronological trace occurrences", () => {
    let seen = 0;
    for (const id of source.route.platform_ids) {
      const p = source.platforms.find((x) => x.id === id)!;
      expect(p.trace_occurrences.length, `${id} carries no trace occurrence`).toBeGreaterThan(0);
      expect(p.trace_occurrence_start).toBe(seen);
      expect(p.trace_occurrence_end_exclusive).toBe(seen + p.trace_occurrences.length);
      // Every occurrence names a logical node the platform also lists.
      for (const occurrence of p.trace_occurrences) {
        expect(p.logical_nodes).toContain(occurrence.logical_node);
      }
      seen += p.trace_occurrences.length;
    }
    expect(seen).toBe(source.analysis_metadata.source_gameplay_trace_length);
  });

  it("keeps the movement model the exporter validated against", () => {
    expect(source.movement_model.config_version).toBe(2);
    expect(source.movement_model.maximum_required_grapple_distance).toBeGreaterThan(0);
    for (const link of source.grapple_links.filter((l) => l.required)) {
      expect(
        link.distance,
        `${link.id} exceeds the delivered design limit`,
      ).toBeLessThanOrEqual(source.movement_model.maximum_required_grapple_distance);
    }
  });
});

describe("dataset: crumble classification", () => {
  it.each(levels)("$entry.id only marks proven Hikari bogus blocks", ({ source }) => {
    const crumble = source.platforms.filter((p) => p.kind === "crumble");
    expect(crumble.length).toBeGreaterThan(0);
    for (const p of crumble) {
      expect(p.provenance?.source).toBe("hikari_alteredBB");
      expect(p.provenance?.confidence).toBe("strong");
      expect(p.provenance?.classification).toBe("obfuscator_bogus");
      expect(p.required).toBe(false);
      expect(p.route_index).toBeNull();
      // Absence from the trace is not evidence of anything: each one maps to
      // exactly one block whose alteredBB label survived into the object file,
      // and carries the real CFG that block has.
      expect(p.raw_blocks.length, `${p.id} must map one machine block`).toBe(1);
      expect(p.trace_occurrences).toEqual([]);
      expect(p.machine_truth?.raw_block).toBe(p.raw_blocks[0]);
      expect(p.machine_truth?.physical_links_are_separate).toBe(true);
    }
  });

  it.each(levels)("$entry.id picks decoys worth looking at, not jump-only glue", ({ source }) => {
    const crumble = source.platforms.filter((p) => p.kind === "crumble");
    for (const p of crumble) {
      expect(p.richness?.unconditional_jump_only, `${p.id} is a bare jump`).toBe(false);
      expect(p.richness?.trivial_glue, `${p.id} is trivial glue`).toBe(false);
      expect(p.display.instructions.length, `${p.id} shows too little code`).toBeGreaterThan(1);
    }
    expect(source.analysis_metadata.selected_jump_only).toBe(0);
    expect(source.analysis_metadata.selected_trivial_glue).toBe(0);
  });

  it.each(levels)("$entry.id positions every decoy against the route it tempts", ({ source }) => {
    const routeIds = new Set(source.route.platform_ids);
    for (const p of source.platforms.filter((x) => x.kind === "crumble")) {
      expect(p.physical_role, `${p.id} has no physical role`).toBeTruthy();
      expect(routeIds.has(p.physical_anchor_platform ?? ""), `${p.id} anchor`).toBe(true);
      expect(routeIds.has(p.apparent_target_platform ?? ""), `${p.id} apparent target`).toBe(true);
    }
  });

  it.each(levels)("$entry.id never puts a crumble block on the route", ({ source }) => {
    const crumbleIds = new Set(
      source.platforms.filter((p) => p.kind === "crumble").map((p) => p.id),
    );
    for (const id of source.route.platform_ids) expect(crumbleIds.has(id)).toBe(false);
    // Nor may a required grapple link touch one.
    for (const link of source.grapple_links.filter((l) => l.required)) {
      expect(crumbleIds.has(link.from)).toBe(false);
      expect(crumbleIds.has(link.to)).toBe(false);
    }
  });

  it.each(levels)("$entry.id marks nothing else crumble-able", ({ source }) => {
    for (const p of source.platforms) {
      if (p.kind === "crumble") continue;
      expect(
        p.provenance,
        `${p.id} is not classified crumble but carries obfuscator provenance`,
      ).toBeUndefined();
    }
  });
});

describe("dataset: string encryption", () => {
  it.each(["level05", "level08"])("%s ships no plaintext strings", (id) => {
    const { source } = level(id);
    expect(source.analysis_metadata.string_encryption).toBe(true);
    for (const p of source.platforms) {
      expect(p.display.strings, `${p.id} must carry no plaintext strings`).toEqual([]);
    }
  });

  it("only the two STR builds are string-encrypted", () => {
    const encrypted = levels
      .filter((l) => l.source.analysis_metadata.string_encryption)
      .map((l) => l.entry.id);
    expect(encrypted).toEqual(["level05", "level08"]);
  });

  it("the game never adds strings a level did not ship", () => {
    for (const { source, tuned } of levels) {
      for (let i = 0; i < source.platforms.length; i += 1) {
        expect(tuned.platforms[i].display.strings).toEqual(source.platforms[i].display.strings);
      }
    }
  });

  it("levels without string encryption keep the strings they do ship", () => {
    for (const { source } of levels.filter((l) => !l.source.analysis_metadata.string_encryption)) {
      const total = source.platforms.reduce((n, p) => n + p.display.strings.length, 0);
      expect(total).toBeGreaterThan(0);
    }
  });
});

describe("layout tuning preserves every binary fact", () => {
  it.each(levels)("$entry.id keeps ids, mappings, code and provenance", ({ source, tuned }) => {
    expect(tuned.platforms.length).toBe(source.platforms.length);
    for (let i = 0; i < source.platforms.length; i += 1) {
      const before = source.platforms[i];
      const after = tuned.platforms[i];
      expect(after.id).toBe(before.id);
      expect(after.logical_node).toBe(before.logical_node);
      expect(after.occurrence).toBe(before.occurrence);
      expect(after.route_index).toBe(before.route_index);
      expect(after.kind).toBe(before.kind);
      expect(after.required).toBe(before.required);
      expect(after.raw_blocks).toEqual(before.raw_blocks);
      expect(after.display).toEqual(before.display);
      expect(after.provenance).toEqual(before.provenance);
      expect(after.semantic_event_ids).toEqual(before.semantic_event_ids);
      // Every v2 mapping and provenance field, not just the ones v1 had.
      expect(after.logical_nodes).toEqual(before.logical_nodes);
      expect(after.trace_occurrences).toEqual(before.trace_occurrences);
      expect(after.trace_occurrence_start).toBe(before.trace_occurrence_start);
      expect(after.trace_occurrence_end_exclusive).toBe(before.trace_occurrence_end_exclusive);
      expect(after.machine_truth).toEqual(before.machine_truth);
      expect(after.richness).toEqual(before.richness);
      expect(after.physical_role).toBe(before.physical_role);
      expect(after.physical_anchor_platform).toBe(before.physical_anchor_platform);
      expect(after.apparent_target_platform).toBe(before.apparent_target_platform);
      expect(after.machine_adjacent_route_indices).toEqual(before.machine_adjacent_route_indices);
      expect(after.cfg_distance).toBe(before.cfg_distance);
      expect(after.mapping_note).toBe(before.mapping_note);
      // Only horizontal layout may change. Route-platform size, vertical
      // layout and mapping are untouched.
      expect(after.y).toBe(before.y);
      if (before.kind === "crumble") {
        const target = source.platforms.find((p) => p.id === before.apparent_target_platform)!;
        expect(after.width).toBe(target.width);
      } else {
        expect(after.width).toBe(before.width);
      }
      expect(after.height).toBe(before.height);
    }
    expect(tuned.events).toEqual(source.events);
    expect(tuned.analysis_metadata).toEqual(source.analysis_metadata);
    expect(tuned.route).toEqual(source.route);
    expect(tuned.physical_choice_summary).toEqual(source.physical_choice_summary);
    expect(tuned.movement_model).toEqual(source.movement_model);
    expect(tuned.level).toEqual(source.level);
    expect(tuned.world.death_y).toBe(source.world.death_y);
    expect(tuned.world.height).toBe(source.world.height);
    // Grapple links keep their identity and their layer; only the measured
    // distance follows the geometry.
    expect(tuned.grapple_links.map((l) => [l.id, l.from, l.to, l.kind, l.required])).toEqual(
      source.grapple_links.map((l) => [l.id, l.from, l.to, l.kind, l.required]),
    );
  });

  it.each(levels)("$entry.id keeps consecutive route platforms in their delivered direction", ({ source, tuned }) => {
    // A level that runs left to right must still run left to right; a level
    // that climbs must still climb. Tuning spreads a route out along its own
    // path, it never reorders or reflects one.
    const before = new Map(source.platforms.map((p) => [p.id, p]));
    const after = new Map(tuned.platforms.map((p) => [p.id, p]));
    const route = source.route.platform_ids;
    for (let i = 1; i < route.length; i += 1) {
      const a0 = before.get(route[i - 1])!;
      const b0 = before.get(route[i])!;
      const a1 = after.get(route[i - 1])!;
      const b1 = after.get(route[i])!;
      const delivered = b0.x + b0.width / 2 - (a0.x + a0.width / 2);
      const tunedDx = b1.x + b1.width / 2 - (a1.x + a1.width / 2);
      expect(Math.sign(tunedDx), `${route[i]} flipped side`).toBe(Math.sign(delivered));
      expect(
        Math.abs(tunedDx),
        `${route[i]} was pulled closer than delivered`,
      ).toBeGreaterThanOrEqual(Math.abs(delivered) - 0.5);
    }
  });

  it("leaves the vertical shaft vertical", () => {
    // Quarantine's steps are climbs. Widening them horizontally would turn the
    // shaft into a staircase, so the tuner must leave them nearly alone.
    const { source, tuned } = level("level07");
    const before = new Map(source.platforms.map((p) => [p.id, p]));
    const after = new Map(tuned.platforms.map((p) => [p.id, p]));
    for (const id of source.route.platform_ids) {
      expect(Math.abs(after.get(id)!.x - before.get(id)!.x)).toBeLessThan(160);
    }
    expect(tuned.world.width).toBeLessThan(source.world.width * 1.35);
  });

  it.each(levels)("$entry.id widens gaps without exceeding the rope design limit", ({ tuned }) => {
    const limit = tuned.movement_model.maximum_required_grapple_distance;
    for (const link of tuned.grapple_links.filter((l) => l.required)) {
      expect(link.distance, `${link.id} must stay inside the ${limit}u design limit`).toBeLessThanOrEqual(
        limit,
      );
    }
  });

  it.each(levels)("$entry.id recomputes link distances from the tuned geometry", ({ tuned }) => {
    const byId = new Map(tuned.platforms.map((p) => [p.id, p]));
    for (const link of tuned.grapple_links) {
      const a = byId.get(link.from);
      const b = byId.get(link.to);
      if (!a || !b) continue;
      const ca = platformCentre(a);
      const cb = platformCentre(b);
      expect(link.distance).toBeCloseTo(Math.hypot(cb.x - ca.x, cb.y - ca.y), 0);
    }
  });

  it.each(levels)("$entry.id keeps every decoy where it was authored, relative to the route", ({ source, tuned }) => {
    // A decoy placed as a stepping stone toward the next block has to stay
    // there, or the deception stops working. It rides on the route pair it was
    // authored against, so it can never drift further from its anchor than
    // that pair's own step was widened — and it never changes side.
    const before = new Map(source.platforms.map((p) => [p.id, p]));
    const after = new Map(tuned.platforms.map((p) => [p.id, p]));
    const cx = (p: { x: number; width: number }): number => p.x + p.width / 2;

    for (const p of source.platforms.filter((x) => x.kind === "crumble")) {
      const a0 = before.get(p.physical_anchor_platform!)!;
      const b0 = before.get(p.apparent_target_platform!)!;
      const a1 = after.get(p.physical_anchor_platform!)!;
      const b1 = after.get(p.apparent_target_platform!)!;
      const p1 = after.get(p.id)!;

      const widened = Math.abs(cx(b1) - cx(a1) - (cx(b0) - cx(a0)));
      const drift = Math.abs(cx(p1) - cx(a1) - (cx(p) - cx(a0)));
      const outwardGrowth = Math.abs(p1.width - p.width);
      expect(drift, `${p.id} drifted further than layout widening explains`).toBeLessThanOrEqual(
        widened + outwardGrowth + 24.5,
      );
      // Vertical placement is delivered geometry and is never touched.
      expect(p1.y).toBe(p.y);
      if (Math.abs(cx(p) - cx(a0)) > 30) {
        expect(
          Math.sign(cx(p1) - cx(a1)),
          `${p.id} changed which side of its anchor it sits on`,
        ).toBe(Math.sign(cx(p) - cx(a0)));
      }
    }
  });

  it.each(levels)("$entry.id makes fake Hikari blocks as wide as normal blocks", ({ source, tuned }) => {
    const sourceById = new Map(source.platforms.map((p) => [p.id, p]));
    const tunedById = new Map(tuned.platforms.map((p) => [p.id, p]));
    const offsets = layoutOffsets(source);

    for (const before of source.platforms.filter((p) => p.kind === "crumble")) {
      const after = tunedById.get(before.id)!;
      const target = tunedById.get(before.apparent_target_platform!)!;
      const movedX = before.x + (offsets.get(before.id) ?? 0);
      const anchorBefore = sourceById.get(before.physical_anchor_platform!)!;
      const targetBefore = sourceById.get(before.apparent_target_platform!)!;
      const anchorAfter = tunedById.get(before.physical_anchor_platform!)!;
      const clearanceBefore = distanceToSegment(
        platformCentre(before),
        platformCentre(anchorBefore),
        platformCentre(targetBefore),
      );
      const clearanceAfter = distanceToSegment(
        platformCentre(after),
        platformCentre(anchorAfter),
        platformCentre(target),
      );

      expect(after.width, `${before.id} does not match its normal target`).toBe(target.width);
      expect(
        clearanceAfter,
        `${before.id} lost its authored clearance from the honest grapple corridor`,
      ).toBeGreaterThanOrEqual(clearanceBefore - 2);
      expect(
        Math.abs(platformCentre(after).x - (movedX + before.width / 2)),
        `${before.id} moved beyond its width-clearance allowance`,
      ).toBeLessThanOrEqual(after.width - before.width + 24.5);
    }
  });

  it("is deterministic", () => {
    const { source } = level("level03");
    expect(tuneLayout(source)).toEqual(tuneLayout(source));
  });

  it("never mutates the delivered dataset", () => {
    const fresh = parseLevel(readJson("level01.json"), "level01");
    const before = JSON.stringify(fresh);
    tuneLayout(fresh);
    expect(JSON.stringify(fresh)).toBe(before);
  });
});
