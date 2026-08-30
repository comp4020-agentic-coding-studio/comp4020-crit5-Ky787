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

    const choice = runtime.data.physical_choice_summary;
    const roles = Object.entries(choice.role_counts)
      .sort((a, b) => b[1] - a[1])
      .map(([role, n]) => `${role} ${n}`)
      .join(", ");
    const tuned = runtime.platforms.reduce(
      (m, p) => Math.max(m, Math.abs(runtime.layoutShift(p.spec.id))),
      0,
    );

    this.body.innerHTML = `
      <dl>
        ${row("level", `${runtime.data.level.id} · ${runtime.data.level.theme}`)}
        ${row("identity", runtime.data.level.spatial_identity)}
        ${row("fps", fps.toFixed(0))}
        ${row("player", `${p.x.toFixed(0)}, ${p.y.toFixed(0)}`)}
        ${row("velocity", `${p.vx.toFixed(0)}, ${p.vy.toFixed(0)}`)}
        ${row("grounded", `${p.grounded} ${p.groundId ?? ""}`)}
        ${row("rope", `${p.rope.phase} len ${p.rope.length.toFixed(0)} ${p.rope.taut ? "taut" : ""}`)}
        ${row("route", `${runtime.progress + 1}/${runtime.data.route.platform_ids.length}`)}
        ${row(
          "trace",
          `${meta.source_gameplay_trace_length} gameplay nodes → ${meta.physical_route_instances} physical instances`,
        )}
        ${row("raw blocks", `${meta.raw_ordered_execution_count} executed, ${meta.raw_unique_executed_blocks} unique`)}
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
        ${row("world", `${runtime.data.world.width} × ${runtime.data.world.height}u · death ${runtime.deathY}`)}
        ${row("max required link", `${maxRequired.toFixed(0)}u (delivered ${rawMax.toFixed(0)}u)`)}
        ${row("rope range", `${GRAPPLE.maxRange}u · jump v ${PLAYER.jumpVelocity}`)}
        ${row("layout", `x-tuned, max ${tuned.toFixed(0)}u; y, widths and mappings unchanged`)}
        ${row("physical links", `${runtime.data.grapple_links.length} gameplay`)}
        ${row("machine cfg edges", `${runtime.machineCfgEdges.length} resolved from machine_truth`)}
        ${row("fake choices", `${choice.plausible_fake_choice_situations} situations · density ${choice.route_choice_density}`)}
        ${row("decoy roles", roles)}
        ${row("bogus pool", `${meta.selected_strong_bogus_candidates} of ${meta.strong_bogus_machine_blocks} strong, avg richness ${meta.selected_average_richness}`)}
        ${row("trivial selections", `${meta.selected_jump_only} jump-only, ${meta.selected_trivial_glue} glue`)}
        ${row("string encryption", String(meta.string_encryption))}
        ${row("crumble selection", meta.crumble_selection)}
        ${row("executable", meta.executable_sha256)}
      </dl>
      <p class="debug-note">Solid green links are required progression, dashed red are fake choices into
      Hikari bogus blocks, dashed blue are apparent progression. All three are <em>physical gameplay</em>
      relationships. The dotted amber arcs are the separate layer: real machine CFG edges out of a bogus
      block, read from <code>machine_truth</code>. A gameplay link never asserts a CFG edge.</p>`;
  }
}

function row(label: string, value: string): string {
  return `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
