import level01 from "../../sources/levels_01_05/level01_ghostline.c?raw";
import level02 from "../../sources/levels_01_05/level02_firewall.c?raw";
import level03 from "../../sources/levels_01_05/level03_sweep.c?raw";
import level04 from "../../sources/levels_01_05/level04_watchdog.c?raw";
import level05 from "../../sources/levels_01_05/level05_blackout.c?raw";
import level06 from "../../sources/levels_06_08/level06_relay.c?raw";
import level07 from "../../sources/levels_06_08/level07_quarantine.c?raw";
import level08 from "../../sources/levels_06_08/level08_root.c?raw";

export interface SourceProgram {
  filename: string;
  text: string;
}

const SOURCE_PROGRAMS: Readonly<Record<string, SourceProgram>> = Object.freeze({
  level01: { filename: "level01_ghostline.c", text: level01 },
  level02: { filename: "level02_firewall.c", text: level02 },
  level03: { filename: "level03_sweep.c", text: level03 },
  level04: { filename: "level04_watchdog.c", text: level04 },
  level05: { filename: "level05_blackout.c", text: level05 },
  level06: { filename: "level06_relay.c", text: level06 },
  level07: { filename: "level07_quarantine.c", text: level07 },
  level08: { filename: "level08_root.c", text: level08 },
});

export function sourceProgramFor(levelId: string): SourceProgram | undefined {
  return SOURCE_PROGRAMS[levelId];
}

export function sourceProgramIds(): string[] {
  return Object.keys(SOURCE_PROGRAMS);
}
