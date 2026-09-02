import level01 from "../../sources/levels_01_05/level01_ghostline.c?raw";
import level02 from "../../sources/levels_01_05/level02_firewall.c?raw";
import level03 from "../../sources/levels_01_05/level03_sweep.c?raw";
import level04 from "../../sources/levels_01_05/level04_watchdog.c?raw";
import level05 from "../../sources/levels_01_05/level05_blackout.c?raw";
import level06 from "../../sources/levels_06_08/level06_relay.c?raw";
import level07 from "../../sources/levels_06_08/level07_quarantine.c?raw";
import level08 from "../../sources/levels_06_08/level08_root.c?raw";

export interface SourceProgram {
  compileCommand: string;
  filename: string;
  text: string;
}

interface BuildOptions {
  bcfLoop?: boolean;
  stringEncryption?: boolean;
}

const COMMON_CLANG_ARGS = [
  "-O0",
  "-Xclang",
  "-disable-O0-optnone",
  "-fno-stack-protector",
  "-ffunction-sections",
  "-mno-incremental-linker-compatible",
  "-fno-discard-value-names",
  "-fverbose-asm",
];

function program(
  filename: string,
  output: string,
  text: string,
  options: BuildOptions = {},
): SourceProgram {
  const hikariArgs = [
    "-mllvm",
    "-enable-bcfobf",
    "-mllvm",
    "-bcf_prob=100",
    "-mllvm",
    "-enable-subobf",
  ];
  if (options.stringEncryption) hikariArgs.push("-mllvm", "-enable-strcry");
  hikariArgs.push(
    "-mllvm",
    "-enable-splitobf",
    "-mllvm",
    "-split_num=2",
    "-mllvm",
    "-aesSeed=12345",
  );
  if (options.bcfLoop) hikariArgs.push("-mllvm", "-bcf_loop=1");

  return {
    compileCommand: [
      "clang.exe",
      ...COMMON_CLANG_ARGS,
      "-S",
      filename,
      "-o",
      output + "/program.s",
      ...hikariArgs,
    ].join(" "),
    filename,
    text,
  };
}

const SOURCE_PROGRAMS: Readonly<Record<string, SourceProgram>> = Object.freeze({
  level01: program("level01_ghostline.c", "level01_ghostline_house", level01),
  level02: program("level02_firewall.c", "level02_firewall_house", level02),
  level03: program("level03_sweep.c", "level03_sweep_house", level03),
  level04: program("level04_watchdog.c", "level04_watchdog_house", level04),
  level05: program("level05_blackout.c", "level05_blackout_house_str", level05, {
    stringEncryption: true,
  }),
  level06: program("level06_relay.c", "level06_relay_split2_bcf1", level06, {
    bcfLoop: true,
  }),
  level07: program(
    "level07_quarantine.c",
    "level07_quarantine_split2_bcf1",
    level07,
    { bcfLoop: true },
  ),
  level08: program("level08_root.c", "level08_root_split2_bcf1_str", level08, {
    bcfLoop: true,
    stringEncryption: true,
  }),
});

export function sourceProgramFor(levelId: string): SourceProgram | undefined {
  return SOURCE_PROGRAMS[levelId];
}

export function sourceProgramIds(): string[] {
  return Object.keys(SOURCE_PROGRAMS);
}
