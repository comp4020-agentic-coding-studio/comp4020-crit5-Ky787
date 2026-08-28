/** Mission progression, persisted per browser. */

const KEY = "binary-ninja/progress/v1";

export interface LevelRecord {
  completed: boolean;
  bestTime: number | null;
  bestDeaths: number | null;
}

export type ProgressMap = Record<string, LevelRecord>;

function empty(): LevelRecord {
  return { completed: false, bestTime: null, bestDeaths: null };
}

export class Progress {
  private data: ProgressMap = {};

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const raw = globalThis.localStorage?.getItem(KEY);
      if (raw) this.data = JSON.parse(raw) as ProgressMap;
    } catch {
      this.data = {};
    }
  }

  private save(): void {
    try {
      globalThis.localStorage?.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // Private browsing or a blocked storage partition: progress is a
      // convenience, never a requirement.
    }
  }

  get(levelId: string): LevelRecord {
    return this.data[levelId] ?? empty();
  }

  record(levelId: string, time: number, deaths: number): LevelRecord {
    const current = this.get(levelId);
    const next: LevelRecord = {
      completed: true,
      bestTime: current.bestTime === null ? time : Math.min(current.bestTime, time),
      bestDeaths: current.bestDeaths === null ? deaths : Math.min(current.bestDeaths, deaths),
    };
    this.data[levelId] = next;
    this.save();
    return next;
  }

  completedCount(): number {
    return Object.values(this.data).filter((r) => r.completed).length;
  }

  reset(): void {
    this.data = {};
    this.save();
  }
}
