// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { sourceProgramFor, sourceProgramIds } from "../src/data/source-programs.ts";
import { renderCSource, SourceCodeView } from "../src/ui/source-code.ts";
import { index } from "./fixtures.ts";

describe("level source programs", () => {
  it("maps one original C program to every delivered level", () => {
    expect(sourceProgramIds().sort()).toEqual(index.levels.map((level) => level.id).sort());

    for (const level of index.levels) {
      const program = sourceProgramFor(level.id);
      expect(program, level.id).toBeDefined();
      expect(program!.filename).toMatch(new RegExp("^" + level.id + "_.+\\.c$"));
      expect(program!.text).toContain(
        "Binary Ninja - Level " + level.number + ": " + level.name,
      );
      expect(program!.text).toContain("int main(");
    }
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
    expect(root.querySelectorAll(".source-line").length).toBeGreaterThan(200);

    view.clear();
    expect(trigger.disabled).toBe(true);
    expect(root.querySelectorAll(".source-line")).toHaveLength(0);
  });
});
