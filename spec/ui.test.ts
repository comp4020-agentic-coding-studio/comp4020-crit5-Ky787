// @vitest-environment jsdom
/**
 * UI contracts. The inspector is where the dataset meets the player, so what
 * it is allowed to say about a block matters as much as the physics: it shows
 * the delivered instructions and raw-block mappings, and for a string-encrypted
 * binary it says there are no plaintext strings rather than inventing any.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { LevelRuntime } from "../src/engine/level-runtime.ts";
import { Hud, formatTime } from "../src/ui/hud.ts";
import { Inspector } from "../src/ui/inspector.ts";
import { Screens } from "../src/ui/screens.ts";
import type { MissionFacts } from "../src/ui/screens.ts";
import { Progress } from "../src/ui/progress.ts";
import { DebugPanel } from "../src/ui/debug-panel.ts";
import { Modals, anyDialogOpen } from "../src/ui/modals.ts";
import { index, level, levels } from "./fixtures.ts";

function host(): HTMLElement {
  const node = document.createElement("div");
  document.body.append(node);
  return node;
}

const noop = (): void => {};
const callbacks = {
  play: noop,
  resume: noop,
  restartCheckpoint: noop,
  restartLevel: noop,
  toSelect: noop,
  next: noop,
};

describe("inspector", () => {
  it("shows the delivered address, instructions and raw-block mapping", () => {
    const { tuned } = level("level01");
    const runtime = new LevelRuntime(tuned);
    const inspector = new Inspector(host());
    const platform = runtime.routePlatforms()[0];
    inspector.show(platform, runtime);

    const text = inspector.root.textContent ?? "";
    expect(text).toContain(platform.spec.display.address);
    for (const instruction of platform.spec.display.instructions) {
      expect(text).toContain(instruction);
    }
    for (const block of platform.spec.raw_blocks) expect(text).toContain(block);
    // And it says plainly that a visible block is not one basic block.
    expect(text).toContain("not necessarily one machine basic block");
  });

  it("shows Hikari provenance on a bogus block, and nothing on a real one", () => {
    const { tuned } = level("level01");
    const runtime = new LevelRuntime(tuned);
    const inspector = new Inspector(host());

    const decoy = runtime.platforms.find((p) => p.spec.kind === "crumble")!;
    inspector.show(decoy, runtime);
    expect(inspector.root.textContent).toContain("hikari_alteredBB");
    expect(inspector.root.textContent).toContain("obfuscator_bogus");

    inspector.show(runtime.routePlatforms()[1], runtime);
    expect(inspector.root.textContent).not.toContain("hikari_alteredBB");
  });

  it("never invents a plaintext string for the encrypted binary", () => {
    const { tuned, source } = level("level05");
    const runtime = new LevelRuntime(tuned);
    const inspector = new Inspector(host());
    // Names that only appear in the semantic event metadata must not leak into
    // the code read-out as if they were strings recovered from the binary.
    const symbols = source.events.map((e) => e.call_target);

    for (const platform of runtime.platforms) {
      inspector.show(platform, runtime);
      const strings = inspector.root.querySelectorAll(".ins-strings li");
      expect(strings.length, `${platform.spec.id} must show no strings`).toBe(0);
      expect(inspector.root.textContent).toContain("string encryption");
      const code = inspector.root.querySelector(".ins-code")?.textContent ?? "";
      for (const symbol of symbols) expect(code).not.toContain(symbol);
    }
  });

  it("does show the strings a level actually ships", () => {
    const { tuned } = level("level01");
    const runtime = new LevelRuntime(tuned);
    const inspector = new Inspector(host());
    const withString = runtime.platforms.find((p) => p.spec.display.strings.length > 0)!;
    inspector.show(withString, runtime);
    expect(inspector.root.textContent).toContain(withString.spec.display.strings[0]);
  });

  it("hides itself when nothing is being aimed at", () => {
    const { tuned } = level("level01");
    const runtime = new LevelRuntime(tuned);
    const inspector = new Inspector(host());
    inspector.show(runtime.routePlatforms()[0], runtime);
    expect(inspector.root.classList.contains("is-hidden")).toBe(false);
    inspector.show(null, runtime);
    expect(inspector.root.classList.contains("is-hidden")).toBe(true);
  });
});

describe("hud", () => {
  it("names the mission and tracks time, retries and the checkpoint", () => {
    const { tuned } = level("level03");
    const runtime = new LevelRuntime(tuned);
    const hud = new Hud(host());
    hud.setMission(2, runtime);
    runtime.step({ ...emptyish(), aim: { x: 0, y: 0 } }, 1 / 120);
    hud.update(runtime, 1 / 120);

    const text = hud.root.textContent ?? "";
    expect(text).toContain("03 — SWEEP");
    expect(text).toContain("SPAWN");
    expect(text).toContain("TRACE 0%");
  });

  it("formats times as minutes and tenths", () => {
    expect(formatTime(0)).toBe("0:00.0");
    expect(formatTime(65.44)).toBe("1:05.4");
  });

  it("keeps at most four status messages on screen", () => {
    const hud = new Hud(host());
    for (let i = 0; i < 9; i += 1) hud.toast(`EVENT ${i}`, "detail");
    expect(hud.root.querySelectorAll(".hud-toast").length).toBeLessThanOrEqual(4);
  });
});

describe("screens", () => {
  const facts = new Map<string, MissionFacts>(
    levels.map((l) => [
      l.entry.id,
      {
        route: l.source.route.platform_ids.length,
        crumble: l.source.platforms.filter((p) => p.kind === "crumble").length,
        encrypted: l.source.analysis_metadata.string_encryption,
      },
    ]),
  );

  it("lists all five missions, all selectable", () => {
    const screens = new Screens(host(), callbacks);
    const progress = new Progress();
    progress.reset();
    screens.select(index.levels, progress, facts);
    const buttons = screens.root.querySelectorAll("button.mission");
    expect(buttons.length).toBe(5);
    const text = screens.root.textContent ?? "";
    for (const name of ["GHOSTLINE", "FIREWALL", "SWEEP", "WATCHDOG", "BLACKOUT"]) {
      expect(text).toContain(name);
    }
    expect(text, "Blackout's encryption is part of its identity").toContain("strings encrypted");
  });

  it("marks a cleared mission with its best time", () => {
    const screens = new Screens(host(), callbacks);
    const progress = new Progress();
    progress.reset();
    progress.record("level01", 61.5, 2);
    screens.select(index.levels, progress, facts);
    expect(screens.root.textContent).toContain("CLEARED");
    expect(screens.root.textContent).toContain("1:01.5");
  });

  it("offers resume, checkpoint restart, level restart and mission select on pause", () => {
    const screens = new Screens(host(), callbacks);
    screens.pause("Ghostline");
    const labels = [...screens.root.querySelectorAll(".screen-actions button")].map(
      (b) => b.textContent,
    );
    expect(labels).toEqual([
      "Resume",
      "Restart from checkpoint",
      "Restart mission",
      "Mission select",
    ]);
    expect(screens.name).toBe("pause");
  });

  it("offers the next mission after a clear, except on the last one", () => {
    const screens = new Screens(host(), callbacks);
    screens.complete("Ghostline", 61.5, 1, { bestTime: 61.5 }, true);
    expect(screens.root.textContent).toContain("Next mission");
    screens.complete("Blackout", 120, 9, { bestTime: 120 }, false);
    expect(screens.root.textContent).not.toContain("Next mission");
    expect(screens.root.textContent).toContain("Replay");
  });

  it("hides cleanly so the game can be played", () => {
    const screens = new Screens(host(), callbacks);
    screens.select(index.levels, new Progress(), facts);
    screens.hide();
    expect(screens.root.classList.contains("is-hidden")).toBe(true);
    expect(screens.name).toBe("none");
  });
});

describe("top-bar dialogs", () => {
  // `anyDialogOpen` reads the whole document, so each case starts from a page
  // with nothing left open by the last one.
  beforeEach(() => {
    document.body.replaceChildren();
  });

  function page(): { root: HTMLElement; modals: Modals } {
    const root = host();
    root.innerHTML = `
      <nav>
        <button type="button" data-nav="missions">Missions</button>
        <button type="button" data-opens-modal="howto">How to play</button>
        <button type="button" data-opens-modal="about">About the data</button>
      </nav>
      <dialog data-modal="howto"><div><button data-close>x</button>controls</div></dialog>
      <dialog data-modal="about"><div><button data-close>x</button>provenance</div></dialog>`;
    return { root, modals: new Modals(root) };
  }

  it("starts closed", () => {
    const { modals } = page();
    expect(modals.isOpen).toBe(false);
    expect(modals.has("howto")).toBe(true);
    expect(modals.has("about")).toBe(true);
  });

  it("opens from its top-bar button and closes from the close button", () => {
    const { root, modals } = page();
    root.querySelector<HTMLButtonElement>('[data-opens-modal="howto"]')!.click();
    expect(modals.isOpen).toBe(true);
    expect(root.querySelector<HTMLDialogElement>('[data-modal="howto"]')!.open).toBe(true);

    root.querySelector<HTMLButtonElement>('[data-modal="howto"] [data-close]')!.click();
    expect(modals.isOpen).toBe(false);
  });

  it("only shows one dialog at a time", () => {
    const { root, modals } = page();
    modals.open("howto");
    modals.open("about");
    expect(root.querySelector<HTMLDialogElement>('[data-modal="howto"]')!.open).toBe(false);
    expect(root.querySelector<HTMLDialogElement>('[data-modal="about"]')!.open).toBe(true);
  });

  it("reports every open and close, so the game can suspend and resume", () => {
    const { modals } = page();
    const seen: boolean[] = [];
    modals.watch((open) => seen.push(open));
    modals.open("about");
    modals.close();
    expect(seen).toEqual([true, false]);
  });

  it("is visible to the input layer, so game keys stay out of a dialog", () => {
    const { modals } = page();
    expect(anyDialogOpen()).toBe(false);
    modals.open("howto");
    expect(anyDialogOpen()).toBe(true);
    modals.close();
    expect(anyDialogOpen()).toBe(false);
  });
});

describe("analysis overlay", () => {
  it("reports geometry and provenance facts, and stays hidden by default", () => {
    const { tuned, source } = level("level01");
    const runtime = new LevelRuntime(tuned);
    const panel = new DebugPanel(host());
    expect(panel.visible).toBe(false);

    panel.setVisible(true);
    for (let i = 0; i < 6; i += 1) panel.update(runtime, source, 60);
    const text = panel.root.textContent ?? "";
    expect(text).toContain("level01");
    expect(text).toContain("crumble");
    expect(text).toContain("max required link");
    expect(text).toContain(source.analysis_metadata.loop_strategy);
  });
});

function emptyish(): Parameters<LevelRuntime["step"]>[0] {
  return {
    left: false,
    right: false,
    down: false,
    jumpHeld: false,
    jumpPressed: false,
    grappleHeld: false,
    grapplePressed: false,
    reelIn: false,
    reelOut: false,
    aim: { x: 0, y: 0 },
  };
}
