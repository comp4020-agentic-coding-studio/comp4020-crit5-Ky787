// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { sourceProgramFor, sourceProgramIds } from "../src/data/source-programs.ts";
import { renderCompileCommand, renderCSource, SourceCodeView } from "../src/ui/source-code.ts";
import { index } from "./fixtures.ts";

describe("level source programs", () => {
  it("maps one original C program to every delivered level", () => {
    expect(sourceProgramIds().sort()).toEqual(index.levels.map((level) => level.id).sort());
    const outputs: Record<string, string> = {
      level01: "level01_ghostline_house/program.s",
      level02: "level02_firewall_house/program.s",
      level03: "level03_sweep_house/program.s",
      level04: "level04_watchdog_house/program.s",
      level05: "level05_blackout_house_str/program.s",
      level06: "level06_relay_split2_bcf1/program.s",
      level07: "level07_quarantine_split2_bcf1/program.s",
      level08: "level08_root_split2_bcf1_str/program.s",
    };

    for (const level of index.levels) {
      const program = sourceProgramFor(level.id);
      expect(program, level.id).toBeDefined();
      expect(program!.filename).toMatch(new RegExp("^" + level.id + "_.+\\.c$"));
      expect(program!.text).toContain(
        "Binary Ninja - Level " + level.number + ": " + level.name,
      );
      expect(program!.text).toContain("int main(");
      const expected = [
        "clang.exe",
        "-O0",
        "-Xclang",
        "-disable-O0-optnone",
        "-fno-stack-protector",
        "-ffunction-sections",
        "-mno-incremental-linker-compatible",
        "-fno-discard-value-names",
        "-fverbose-asm",
        "-S",
        program!.filename,
        "-o",
        outputs[level.id],
        "-mllvm",
        "-enable-bcfobf",
        "-mllvm",
        "-bcf_prob=100",
        "-mllvm",
        "-enable-subobf",
        ...(["level05", "level08"].includes(level.id) ? ["-mllvm", "-enable-strcry"] : []),
        "-mllvm",
        "-enable-splitobf",
        "-mllvm",
        "-split_num=2",
        "-mllvm",
        "-aesSeed=12345",
        ...(["level06", "level07", "level08"].includes(level.id)
          ? ["-mllvm", "-bcf_loop=1"]
          : []),
      ].join(" ");
      expect(program!.compileCommand).toBe(expected);
    }

    for (const id of ["level05", "level08"]) {
      expect(sourceProgramFor(id)!.compileCommand).toContain("-mllvm -enable-strcry");
    }
    for (const id of ["level01", "level02", "level03", "level04", "level06", "level07"]) {
      expect(sourceProgramFor(id)!.compileCommand).not.toContain("-enable-strcry");
    }
    for (const id of ["level06", "level07", "level08"]) {
      expect(sourceProgramFor(id)!.compileCommand).toContain("-mllvm -bcf_loop=1");
    }
  });

  it("preserves the command string and highlights only Hikari argument pairs", () => {
    const command = sourceProgramFor("level08")!.compileCommand;
    const target = document.createElement("code");
    renderCompileCommand(target, command);

    expect(target.textContent).toBe(command);
    expect(target.querySelector(".command-tool")!.textContent).toBe("clang.exe");
    const highlighted = [...target.querySelectorAll<HTMLElement>(".command-hikari")].map(
      (node) => node.textContent,
    );
    expect(highlighted).toContain("-mllvm");
    expect(highlighted).toContain("-enable-strcry");
    expect(highlighted).toContain("-bcf_loop=1");
    expect(highlighted).not.toContain("-fno-stack-protector");
  });

  it("renders source losslessly while colouring C token classes", () => {
    const source = [
      "#include <stdint.h>",
      "/* a",
      " * comment */",
      'static uint32_t answer(void) { return 0x2Au + "text"[0]; }',
    ].join("\n");
    const target = document.createElement("code");
    renderCSource(target, source);

    const rendered = [...target.querySelectorAll<HTMLElement>(".source-line-code")]
      .map((line) => line.textContent)
      .join("\n");
    expect(rendered).toBe(source);
    for (const kind of [
      "directive",
      "comment",
      "keyword",
      "type",
      "function",
      "number",
      "string",
      "operator",
    ]) {
      expect(target.querySelector(".c-" + kind), kind).not.toBeNull();
    }
  });

  it("enables the popup for the active mission and clears it on mission select", () => {
    const root = document.createElement("div");
    root.innerHTML = [
      "<button disabled data-source-trigger></button>",
      "<p data-source-filename></p>",
      "<h2 data-source-title></h2>",
      "<code data-source-command></code>",
      "<code data-source-code></code>",
    ].join("");
    const view = new SourceCodeView(root);
    const trigger = root.querySelector<HTMLButtonElement>("[data-source-trigger]")!;

    expect(trigger.disabled).toBe(true);
    view.setLevel("level07", "Quarantine", 7);
    expect(trigger.disabled).toBe(false);
    expect(root.querySelector("[data-source-title]")!.textContent).toBe("07 — Quarantine");
    expect(root.querySelector("[data-source-filename]")!.textContent).toBe(
      "level07_quarantine.c",
    );
    expect(root.querySelector("[data-source-command]")!.textContent).toContain(
      "-mllvm -bcf_loop=1",
    );
    expect(root.querySelectorAll(".command-hikari").length).toBeGreaterThan(10);
    expect(root.querySelectorAll(".source-line").length).toBeGreaterThan(200);

    view.clear();
    expect(trigger.disabled).toBe(true);
    expect(root.querySelector("[data-source-command]")!.textContent).toBe("");
    expect(root.querySelectorAll(".source-line")).toHaveLength(0);
  });
});
