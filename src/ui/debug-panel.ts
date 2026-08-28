/**
 * F1 analysis overlay side panel. Pairs with the on-canvas link/ID drawing in
 * the renderer, and exists so level geometry can be playtested and adjusted
 * without regenerating any binary analysis.
 */

import { GRAPPLE, PLAYER } from "../engine/constants.ts";
import type { LevelData } from "../data/types.ts";
import type { LevelRuntime } from "../engine/level-runtime.ts";

export class DebugPanel {
  readonly root: HTMLElement;
  private body: HTMLElement;
  private ticks = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "debug is-hidden";
    this.root.innerHTML = `<p class="debug-title">F1 · ANALYSIS OVERLAY</p>`;
    this.body = document.createElement("div");
    this.body.className = "debug-body";
    this.root.append(this.body);
    parent.append(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle("is-hidden", !visible);
    if (visible) this.ticks = 0;
  }

  get visible(): boolean {
    return !this.root.classList.contains("is-hidden");
  }

  update(runtime: LevelRuntime, source: LevelData, fps: number): void {
    if (!this.visible) return;
    // Fill immediately when the overlay opens, then throttle: this is a
    // read-out, not an animation.
    this.ticks += 1;
    if (this.ticks > 1 && this.ticks % 6 !== 0) return;

    const p = runtime.player;
    const meta = runtime.data.analysis_metadata;
    const crumble = runtime.platforms.filter((x) => x.spec.kind === "crumble");
    const collapsed = crumble.filter((x) => x.crumble === "collapsed").length;
    const required = runtime.data.grapple_links.filter((l) => l.required);
    const maxRequired = required.reduce((m, l) => Math.max(m, l.distance), 0);
    const rawMax = source.grapple_links
      .filter((l) => l.required)
      .reduce((m, l) => Math.max(m, l.distance), 0);

    this.body.innerHTML = `
      <dl>
        ${row("level", `${runtime.data.level.id} · ${runtime.data.level.theme}`)}
        ${row("fps", fps.toFixed(0))}
        ${row("player", `${p.x.toFixed(0)}, ${p.y.toFixed(0)}`)}
        ${row("velocity", `${p.vx.toFixed(0)}, ${p.vy.toFixed(0)}`)}
        ${row("grounded", `${p.grounded} ${p.groundId ?? ""}`)}
        ${row("rope", `${p.rope.phase} len ${p.rope.length.toFixed(0)} ${p.rope.taut ? "taut" : ""}`)}
        ${row("route", `${runtime.progress + 1}/${runtime.data.route.platform_ids.length}`)}
        ${row("platforms", `${runtime.platforms.length} (${crumble.length} crumble, ${collapsed} down)`)}
        ${row("checkpoints", `${runtime.checkpoints.filter((c) => c.claimed).length}/${runtime.checkpoints.length}`)}
        ${row("gates", String(runtime.hazards.gates.length))}
        ${row("beams", String(runtime.hazards.beams.length))}
        ${row(
          "watchdog",
          runtime.hazards.watchdog.active
            ? `x ${runtime.hazards.watchdog.x.toFixed(0)} @ ${runtime.hazards.watchdog.speed.toFixed(0)}u/s`
            : "idle",
        )}
        ${row("world", `${runtime.data.world.width}u · death ${runtime.deathY}`)}
        ${row("max required link", `${maxRequired.toFixed(0)}u (delivered ${rawMax.toFixed(0)}u)`)}
        ${row("rope range", `${GRAPPLE.maxRange}u · jump v ${PLAYER.jumpVelocity}`)}
        ${row("layout", "gap-tuned; mappings unchanged")}
        ${row("loop strategy", meta.loop_strategy)}
        ${row("repeated nodes", `${meta.repeated_logical_nodes} → ${meta.repeated_physical_instances} instances`)}
        ${row("string encryption", String(meta.string_encryption))}
        ${row("crumble selection", meta.crumble_selection)}
      </dl>
      <p class="debug-note">Green links are required progression, red are decoys into Hikari bogus blocks, blue are optional recovery.</p>`;
  }
}

function row(label: string, value: string): string {
  return `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
