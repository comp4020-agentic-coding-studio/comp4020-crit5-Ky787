#!/usr/bin/env node
/**
 * Dev tool: run the real physics over every level's route and report which
 * hops are jumpable, which need the grapple, and which nothing could clear.
 * `node scripts/route-report.ts [--raw]`
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseIndex, parseLevel } from "../src/data/levels.ts";
import { tuneLayout } from "../src/data/tuning.ts";
import { LevelRuntime } from "../src/engine/level-runtime.ts";
import { analyseRoute, playThrough } from "../src/engine/traversal.ts";

const ROOT = "physical_level_delivery/web_game_data";
const raw = process.argv.includes("--raw");
const read = (p: string): unknown => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

const index = parseIndex(read("index.json"));
for (const entry of index.levels) {
  const source = parseLevel(read(entry.path), entry.id);
  const level = raw ? source : tuneLayout(source);
  const runtime = new LevelRuntime(level, { withoutCrumble: true, withoutHazards: true });
  const report = analyseRoute(entry.id, runtime.solids, level.route.platform_ids, runtime.deathY);
  const hopCount = report.hops.length;
  const jumps = hopCount - report.grappleRequired - report.failures;
  console.log(
    `${entry.id} ${entry.name.padEnd(10)} hops=${String(hopCount).padStart(2)} ` +
      `jump=${String(jumps).padStart(2)} grapple=${String(report.grappleRequired).padStart(2)} ` +
      `FAIL=${report.failures}`,
  );
  const times = report.hops.map((h) => h.result.plan?.duration ?? 0);
  const total = times.reduce((a, b) => a + b, 0);
  const run = playThrough(new LevelRuntime(level, { withoutCrumble: true, withoutHazards: true }));
  console.log(
    `   best-case run ${total.toFixed(0)}s, slowest hop ${Math.max(...times).toFixed(1)}s, ` +
      `world ${level.world.width}u`,
  );
  const full = playThrough(new LevelRuntime(level, { withoutHazards: true }));
  console.log(
    `   end-to-end without crumble: ${run.completed ? "COMPLETED" : `STALLED at ${run.stalledAt}`}` +
      ` in ${run.seconds.toFixed(0)}s`,
  );
  const collapsed = new LevelRuntime(level, { withoutHazards: true });
  const withCrumble = playThrough(collapsed);
  console.log(
    `   end-to-end with decoys present: ${
      withCrumble.completed ? "COMPLETED" : `STALLED at ${withCrumble.stalledAt}`
    } in ${withCrumble.seconds.toFixed(0)}s (${full.completed ? "" : "!"}${collapsed.platforms.filter((p) => p.crumble === "collapsed").length} decoys collapsed)`,
  );
  for (const hop of report.hops) {
    if (!hop.result.ok) {
      console.log(`   ✗ ${hop.from} -> ${hop.to}  closest ${hop.result.bestDistance.toFixed(0)}u`);
    }
  }
}
