/**
 * In-game HUD. DOM rather than canvas, and every field caches its last value
 * so a frame that changes nothing writes nothing.
 */

import { MISSION_BRIEFS } from "../engine/constants.ts";
import type { LevelRuntime } from "../engine/level-runtime.ts";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(1).padStart(4, "0")}`;
}

interface Toast {
  node: HTMLElement;
  life: number;
}

export class Hud {
  readonly root: HTMLElement;
  private missionName: HTMLElement;
  private missionBrief: HTMLElement;
  private timer: HTMLElement;
  private deaths: HTMLElement;
  private checkpoint: HTMLElement;
  private ropeState: HTMLElement;
  private progressFill: HTMLElement;
  private progressText: HTMLElement;
  private toastLayer: HTMLElement;
  private hintLayer: HTMLElement;
  private toasts: Toast[] = [];
  private cache = new Map<string, string>();

  constructor(parent: HTMLElement) {
    this.root = el("div", "hud");
    this.root.setAttribute("aria-live", "polite");

    const topLeft = el("div", "hud-block hud-mission");
    this.missionName = el("p", "hud-title", "—");
    this.missionBrief = el("p", "hud-sub", "");
    topLeft.append(this.missionName, this.missionBrief);

    const topRight = el("div", "hud-block hud-stats");
    this.timer = el("span", "hud-stat-value", "0:00.0");
    this.deaths = el("span", "hud-stat-value", "0");
    this.checkpoint = el("span", "hud-stat-value", "SPAWN");
    this.ropeState = el("span", "hud-stat-value", "READY");
    topRight.append(
      statRow("TIME", this.timer),
      statRow("RETRIES", this.deaths),
      statRow("CHECKPOINT", this.checkpoint),
      statRow("LINE", this.ropeState),
    );

    const progress = el("div", "hud-progress");
    this.progressFill = el("div", "hud-progress-fill");
    this.progressText = el("span", "hud-progress-text", "TRACE 0%");
    const bar = el("div", "hud-progress-bar");
    bar.append(this.progressFill);
    progress.append(this.progressText, bar);

    this.toastLayer = el("div", "hud-toasts");
    this.hintLayer = el("div", "hud-hints");

    this.root.append(topLeft, topRight, progress, this.toastLayer, this.hintLayer);
    parent.append(this.root);
  }

  private set(node: HTMLElement, key: string, value: string): void {
    if (this.cache.get(key) === value) return;
    this.cache.set(key, value);
    node.textContent = value;
  }

  setMission(index: number, runtime: LevelRuntime): void {
    const number = String(index + 1).padStart(2, "0");
    this.set(
      this.missionName,
      "mission",
      `${number} — ${runtime.data.level.name.toUpperCase()}`,
    );
    this.set(
      this.missionBrief,
      "brief",
      MISSION_BRIEFS[runtime.data.level.theme] ?? "Reach the end of the trace.",
    );
    this.root.style.setProperty("--accent", runtime.accent);
  }

  update(runtime: LevelRuntime, dt: number): void {
    this.set(this.timer, "time", formatTime(runtime.elapsed));
    this.set(this.deaths, "deaths", String(runtime.deaths));
    this.set(this.checkpoint, "cp", runtime.checkpointLabel());

    const rope = runtime.player.rope;
    const label =
      rope.phase === "attached"
        ? rope.taut
          ? "TAUT"
          : "SLACK"
        : rope.phase === "firing"
          ? "FIRING"
          : "READY";
    this.set(this.ropeState, "rope", label);

    const pct = Math.round(runtime.progressFraction() * 100);
    this.set(this.progressText, "progress", `TRACE ${pct}%`);
    const width = `${pct}%`;
    if (this.cache.get("progressw") !== width) {
      this.cache.set("progressw", width);
      this.progressFill.style.width = width;
    }

    for (let i = this.toasts.length - 1; i >= 0; i -= 1) {
      const toast = this.toasts[i];
      toast.life -= dt;
      if (toast.life <= 0) {
        toast.node.remove();
        this.toasts.splice(i, 1);
      } else if (toast.life < 0.5) {
        toast.node.style.opacity = String(toast.life / 0.5);
      }
    }
  }

  toast(text: string, detail = "", tone: "info" | "good" | "bad" = "info"): void {
    const node = el("div", `hud-toast hud-toast-${tone}`);
    node.append(el("strong", undefined, text));
    if (detail) node.append(el("span", undefined, detail));
    this.toastLayer.prepend(node);
    this.toasts.push({ node, life: 2.6 });
    while (this.toasts.length > 4) {
      const oldest = this.toasts.shift();
      oldest?.node.remove();
    }
  }

  /** Contextual control prompts; Ghostline teaches with these. */
  setHints(lines: string[]): void {
    const key = lines.join("|");
    if (this.cache.get("hints") === key) return;
    this.cache.set("hints", key);
    this.hintLayer.replaceChildren(
      ...lines.map((line) => {
        const node = el("p", "hud-hint");
        node.innerHTML = line;
        return node;
      }),
    );
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle("is-hidden", !visible);
  }

  reset(): void {
    for (const toast of this.toasts) toast.node.remove();
    this.toasts = [];
    this.cache.clear();
  }
}

function statRow(label: string, value: HTMLElement): HTMLElement {
  const row = el("div", "hud-stat");
  row.append(el("span", "hud-stat-label", label), value);
  return row;
}
