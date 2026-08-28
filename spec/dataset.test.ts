/**
 * The dataset contract: every delivered level loads, describes a playable
 * world, and keeps its binary facts intact through the playability tuning
 * pass. These are the promises the game makes about the data it is built on.
 */

import { describe, expect, it } from "vitest";
import { platformCentre, tuneLayout } from "../src/data/tuning.ts";
import { parseLevel } from "../src/data/levels.ts";
import { index, levels, level, readJson } from "./fixtures.ts";

describe("dataset: index", () => {
  it("lists all five missions", () => {
    expect(index.levels.map((l) => l.id)).toEqual([
      "level01",
      "level02",
      "level03",
      "level04",
      "level05",
    ]);
  });

  it("names every level file it points at", () => {
    for (const entry of index.levels) {
      expect(() => readJson(entry.path)).not.toThrow();
    }
  });
});

describe.each(levels)("dataset: $entry.id", ({ entry, source, tuned }) => {
  it("declares the id the index promised", () => {
    expect(source.level.id).toBe(entry.id);
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
  it("Blackout ships no plaintext strings", () => {
    const { source } = level("level05");
    expect(source.analysis_metadata.string_encryption).toBe(true);
    for (const p of source.platforms) {
      expect(p.display.strings, `${p.id} must carry no plaintext strings`).toEqual([]);
    }
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
      // Only x may move. Vertical layout, size and mapping are untouched.
      expect(after.y).toBe(before.y);
      expect(after.width).toBe(before.width);
      expect(after.height).toBe(before.height);
    }
    expect(tuned.events).toEqual(source.events);
    expect(tuned.analysis_metadata).toEqual(source.analysis_metadata);
    expect(tuned.route).toEqual(source.route);
    expect(tuned.world.death_y).toBe(source.world.death_y);
  });

  it.each(levels)("$entry.id keeps route platforms in chronological x order", ({ tuned }) => {
    const xs = tuned.route.platform_ids.map(
      (id) => tuned.platforms.find((p) => p.id === id)!.x,
    );
    for (let i = 1; i < xs.length; i += 1) {
      expect(xs[i], `route platform ${i} must sit right of ${i - 1}`).toBeGreaterThan(xs[i - 1]);
    }
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

  it("is deterministic", () => {
    const { source } = level("level03");
    expect(tuneLayout(source)).toEqual(tuneLayout(source));
  });

  it("never mutates the delivered dataset", () => {
    const fresh = parseLevel(readJson("levels/level01.json"), "level01");
    const before = JSON.stringify(fresh);
    tuneLayout(fresh);
    expect(JSON.stringify(fresh)).toBe(before);
  });
});
