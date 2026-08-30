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
import { analyseRoute, honestOptions, playThrough } from "../src/engine/traversal.ts";

const ROOT = "physical_level_delivery_v2/web_game_data";
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
  // How much honest choice each step leaves: a decoy has to be tempting, never
  // the only way across.
  const options = honestOptions(new LevelRuntime(level, { withoutHazards: true }));
  const worst = options.reduce((m, o) => Math.min(m, o.honest), Infinity);
  const mean = options.reduce((n, o) => n + o.honest / o.tried, 0) / options.length;
  const sealed = options.filter((o) => o.honest === 0).map((o) => `${o.from}->${o.to}`);
  console.log(
    `   decoy-free options per step: worst ${worst}/${options[0]?.tried ?? 0}, ` +
      `mean ${(mean * 100).toFixed(0)}%${sealed.length > 0 ? ` | SEALED ${sealed.join(", ")}` : ""}`,
  );

  const collapsed = new LevelRuntime(level, { withoutHazards: true });
  const withCrumble = playThrough(collapsed);
  console.log(
    `   end-to-end with decoys present: ${
      withCrumble.completed ? "COMPLETED" : `STALLED at ${withCrumble.stalledAt}`
    } in ${withCrumble.seconds.toFixed(0)}s (${full.completed ? "" : "!"}${collapsed.platforms.filter((p) => p.crumble === "collapsed").length} decoys collapsed)`,
  );

  // Hazards on. The bot cannot read a beam or a gate, so deaths here are not a
  // verdict on fairness — but the watchdog is a pure pace contest, and this is
  // the only way to measure whether the wall is actually a threat.
  const live = new LevelRuntime(level);
  const hot = playThrough(live, { budgetSeconds: 600 });
  const wd = live.hazards.watchdog;
  const pace = hot.seconds > 0 ? level.world.width / hot.seconds : 0;
  console.log(
    `   with hazards live: ${hot.completed ? "COMPLETED" : `STALLED at ${hot.stalledAt}`}` +
      ` in ${hot.seconds.toFixed(0)}s, ${hot.deaths} deaths` +
      (wd.strength > 0
        ? ` | watchdog ${wd.activations} armed, ${wd.speed.toFixed(0)}u/s vs bot pace ${pace.toFixed(0)}u/s`
        : ""),
  );
  for (const hop of report.hops) {
    if (!hop.result.ok) {
      console.log(`   ✗ ${hop.from} -> ${hop.to}  closest ${hop.result.bestDistance.toFixed(0)}u`);
    }
  }
}
