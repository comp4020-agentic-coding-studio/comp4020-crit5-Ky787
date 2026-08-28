/** Full-screen overlays: mission select, pause, mission complete, loading. */

import { THEME_PROFILES } from "../engine/constants.ts";
import type { LevelIndexEntry } from "../data/types.ts";
import { formatTime } from "./hud.ts";
import type { Progress } from "./progress.ts";

export type ScreenName = "loading" | "select" | "pause" | "complete" | "none";

/** Honest dataset facts shown on each mission card. */
export interface MissionFacts {
  route: number;
  crumble: number;
  encrypted: boolean;
}

export interface ScreenCallbacks {
  play: (levelId: string) => void;
  resume: () => void;
  restartCheckpoint: () => void;
  restartLevel: () => void;
  toSelect: () => void;
  next: () => void;
}

export class Screens {
  readonly root: HTMLElement;
  private current: ScreenName = "loading";

  constructor(
    parent: HTMLElement,
    private readonly callbacks: ScreenCallbacks,
  ) {
    this.root = document.createElement("div");
    this.root.className = "screens";
    parent.append(this.root);
  }

  get name(): ScreenName {
    return this.current;
  }

  hide(): void {
    this.current = "none";
    this.root.replaceChildren();
    this.root.classList.add("is-hidden");
  }

  private open(name: ScreenName, node: HTMLElement): void {
    this.current = name;
    this.root.replaceChildren(node);
    this.root.classList.remove("is-hidden");
    node.querySelector<HTMLElement>("button, [tabindex]")?.focus({ preventScroll: true });
  }

  loading(message = "Loading level data…"): void {
    const panel = panelNode("screen-loading");
    panel.append(para("screen-loading-text", message));
    this.open("loading", panel);
  }

  error(message: string): void {
    const panel = panelNode("screen-loading");
    panel.append(para("screen-error", message));
    this.open("loading", panel);
  }

  select(entries: LevelIndexEntry[], progress: Progress, facts: Map<string, MissionFacts>): void {
    const panel = panelNode("screen-select");
    panel.append(
      para("screen-eyebrow", "MISSION SELECT"),
      para(
        "screen-lede",
        "Five programs, five traces. Every block below is a real chunk of an obfuscated x86-64 binary. Some of it is a lie.",
      ),
    );

    const list = document.createElement("ol");
    list.className = "mission-list";
    entries.forEach((entry, index) => {
      const record = progress.get(entry.id);
      const profile = THEME_PROFILES[entry.theme];
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mission";
      button.style.setProperty("--accent", profile?.accent ?? "#4ee0a1");
      button.innerHTML = `
        <span class="mission-no">${String(index + 1).padStart(2, "0")}</span>
        <span class="mission-body">
          <span class="mission-name">${entry.name.toUpperCase()}</span>
          <span class="mission-tag">${profile?.tagline ?? ""}</span>
          <span class="mission-facts">${entry.platform_count} code blocks · ${
            facts.get(entry.id)?.route ?? 0
          } on the trace · ${facts.get(entry.id)?.crumble ?? 0} bogus decoys${
            facts.get(entry.id)?.encrypted ? " · strings encrypted" : ""
          }</span>
        </span>
        <span class="mission-status">${
          record.completed
            ? `<span class="mission-done">CLEARED</span><span class="mission-best">${formatTime(
                record.bestTime ?? 0,
              )}</span>`
            : "<span class=\"mission-todo\">OPEN</span>"
        }</span>`;
      button.addEventListener("click", () => this.callbacks.play(entry.id));
      item.append(button);
      list.append(item);
    });
    panel.append(list);

    panel.append(
      controlsNode(),
      para(
        "screen-footnote",
        "Physical layout is tuned for playability; addresses, instructions, raw-block mappings and Hikari provenance are exactly as delivered.",
      ),
    );
    this.open("select", panel);
  }

  pause(levelName: string): void {
    const panel = panelNode("screen-pause");
    panel.append(para("screen-eyebrow", "PAUSED"), para("screen-heading", levelName.toUpperCase()));
    panel.append(
      buttonRow([
        ["Resume", this.callbacks.resume],
        ["Restart from checkpoint", this.callbacks.restartCheckpoint],
        ["Restart mission", this.callbacks.restartLevel],
        ["Mission select", this.callbacks.toSelect],
      ]),
    );
    panel.append(controlsNode());
    this.open("pause", panel);
  }

  complete(
    levelName: string,
    time: number,
    deaths: number,
    record: { bestTime: number | null },
    hasNext: boolean,
  ): void {
    const panel = panelNode("screen-complete");
    panel.append(
      para("screen-eyebrow", "TRACE COMPLETE"),
      para("screen-heading", levelName.toUpperCase()),
    );
    const stats = document.createElement("dl");
    stats.className = "screen-stats";
    stats.innerHTML = `
      <div><dt>Time</dt><dd>${formatTime(time)}</dd></div>
      <div><dt>Retries</dt><dd>${deaths}</dd></div>
      <div><dt>Best</dt><dd>${formatTime(record.bestTime ?? time)}</dd></div>`;
    panel.append(stats);
    const actions: [string, () => void][] = [];
    if (hasNext) actions.push(["Next mission", this.callbacks.next]);
    actions.push(["Replay", this.callbacks.restartLevel], ["Mission select", this.callbacks.toSelect]);
    panel.append(buttonRow(actions));
    this.open("complete", panel);
  }
}

function panelNode(className: string): HTMLElement {
  const node = document.createElement("div");
  node.className = `screen ${className}`;
  return node;
}

function para(className: string, text: string): HTMLElement {
  const node = document.createElement("p");
  node.className = className;
  node.textContent = text;
  return node;
}

function buttonRow(actions: [string, () => void][]): HTMLElement {
  const row = document.createElement("div");
  row.className = "screen-actions";
  for (const [label, handler] of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", handler);
    row.append(button);
  }
  return row;
}

function controlsNode(): HTMLElement {
  const node = document.createElement("div");
  node.className = "screen-controls";
  node.innerHTML = `
    <p class="screen-eyebrow">CONTROLS</p>
    <ul>
      <li><kbd>A</kbd><kbd>D</kbd> move</li>
      <li><kbd>Space</kbd> jump — or let go of the line with a kick</li>
      <li><kbd>Mouse</kbd> aim · <kbd>Left click</kbd> hold to grapple, release to let go</li>
      <li><kbd>W</kbd> reel in · <kbd>S</kbd> pay out line, or drop through a block</li>
      <li><kbd>R</kbd> restart at checkpoint · <kbd>Esc</kbd> pause · <kbd>F1</kbd> analysis overlay</li>
    </ul>`;
  return node;
}
