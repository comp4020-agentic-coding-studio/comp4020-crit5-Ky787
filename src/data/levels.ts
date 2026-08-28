/**
 * Dataset loading. The browser entry point is `web_game_data/index.json`; the
 * frontend never touches PE files, LLVM output, CFGs or Unicorn traces.
 */

import type { LevelData, LevelIndex, LevelIndexEntry, PlatformKind } from "./types.ts";
import { tuneLayout } from "./tuning.ts";

/** Where the delivered dataset is served from, relative to the page. */
export const DATA_ROOT = "web_game_data/";

const PLATFORM_KINDS: readonly PlatformKind[] = [
  "start",
  "route",
  "checkpoint",
  "objective",
  "crumble",
];

export class DatasetError extends Error {}

function need<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new DatasetError(`dataset is missing ${what}`);
  return value;
}

/** Validates the shape the engine relies on, and nothing beyond it. */
export function parseIndex(raw: unknown): LevelIndex {
  const data = raw as LevelIndex;
  if (!data || !Array.isArray(data.levels) || data.levels.length === 0) {
    throw new DatasetError("index.json has no levels");
  }
  for (const entry of data.levels) {
    need(entry.id, "a level id");
    need(entry.path, `a path for ${entry.id}`);
    need(entry.world, `world bounds for ${entry.id}`);
  }
  return data;
}

export function parseLevel(raw: unknown, expectedId?: string): LevelData {
  const data = raw as LevelData;
  need(data?.level?.id, "level.id");
  if (expectedId && data.level.id !== expectedId) {
    throw new DatasetError(`level file declares ${data.level.id}, index says ${expectedId}`);
  }
  const where = data.level.id;
  if (!Array.isArray(data.platforms) || data.platforms.length === 0) {
    throw new DatasetError(`${where} has no platforms`);
  }
  const ids = new Set<string>();
  for (const p of data.platforms) {
    if (ids.has(p.id)) throw new DatasetError(`${where} repeats platform id ${p.id}`);
    ids.add(p.id);
    if (!PLATFORM_KINDS.includes(p.kind)) {
      throw new DatasetError(`${where}/${p.id} has unknown kind ${p.kind}`);
    }
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      throw new DatasetError(`${where}/${p.id} has a non-finite position`);
    }
  }
  need(data.player?.spawn, `${where} spawn`);
  need(data.objective?.platform, `${where} objective`);
  if (!ids.has(data.objective.platform)) {
    throw new DatasetError(`${where} objective points at missing ${data.objective.platform}`);
  }
  if (!Array.isArray(data.route?.platform_ids) || data.route.platform_ids.length < 2) {
    throw new DatasetError(`${where} has no route`);
  }
  for (const id of data.route.platform_ids) {
    if (!ids.has(id)) throw new DatasetError(`${where} route references missing ${id}`);
  }
  for (const c of data.checkpoints ?? []) {
    if (!ids.has(c.platform)) {
      throw new DatasetError(`${where} checkpoint ${c.id} references missing ${c.platform}`);
    }
  }
  for (const e of data.events ?? []) {
    if (!ids.has(e.platform)) {
      throw new DatasetError(`${where} event ${e.id} references missing ${e.platform}`);
    }
  }
  return data;
}

/** A level as delivered, plus the playability-tuned layout the engine runs. */
export interface LoadedLevel {
  entry: LevelIndexEntry;
  /** Verbatim delivered dataset. Never mutated. */
  source: LevelData;
  /** Same dataset with widened horizontal spacing; identical binary facts. */
  tuned: LevelData;
}

export type Fetcher = (path: string) => Promise<unknown>;

/** Resolves dataset paths against the served page, so any base path works. */
export function browserFetcher(root = DATA_ROOT): Fetcher {
  return async (path: string) => {
    const base = typeof document === "undefined" ? undefined : document.baseURI;
    const url = base ? new URL(root + path, base).href : root + path;
    const response = await fetch(url, { cache: "no-cache" });
    if (!response.ok) {
      throw new DatasetError(`could not load ${root}${path} (HTTP ${response.status})`);
    }
    return (await response.json()) as unknown;
  };
}

export async function loadIndex(fetcher: Fetcher): Promise<LevelIndex> {
  return parseIndex(await fetcher("index.json"));
}

export async function loadLevel(
  fetcher: Fetcher,
  entry: LevelIndexEntry,
  tune = true,
): Promise<LoadedLevel> {
  const source = parseLevel(await fetcher(entry.path), entry.id);
  return { entry, source, tuned: tune ? tuneLayout(source) : source };
}
