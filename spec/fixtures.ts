/** Shared dataset access for the spec. Reads the delivered bundle from disk. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseIndex, parseLevel } from "../src/data/levels.ts";
import { tuneLayout } from "../src/data/tuning.ts";
import type { LevelData, LevelIndexEntry } from "../src/data/types.ts";

export const DATASET_DIR = "physical_level_delivery_v2/web_game_data";

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(join(DATASET_DIR, path), "utf8")) as unknown;
}

export const index = parseIndex(readJson("index.json"));

export const levels: { entry: LevelIndexEntry; source: LevelData; tuned: LevelData }[] =
  index.levels.map((entry) => {
    const source = parseLevel(readJson(entry.path), entry.id);
    return { entry, source, tuned: tuneLayout(source) };
  });

export function level(id: string): { entry: LevelIndexEntry; source: LevelData; tuned: LevelData } {
  const found = levels.find((l) => l.entry.id === id);
  if (!found) throw new Error(`no such level ${id}`);
  return found;
}
