/**
 * The code inspector: the richer read-out for whatever the player is aiming
 * at. Everything shown here comes verbatim from the dataset's `display`
 * payload, `raw_blocks` and `provenance`.
 *
 * When a binary was built with string encryption the exporter ships no
 * plaintext strings, and this panel says exactly that rather than inventing
 * any.
 */

import type { PlatformRuntime } from "../engine/level-runtime.ts";
import type { LevelRuntime } from "../engine/level-runtime.ts";

export class Inspector {
  readonly root: HTMLElement;
  private currentId: string | null = null;
  private pinned = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement("aside");
    this.root.className = "inspector is-hidden";
    this.root.setAttribute("aria-label", "Code block inspector");
    parent.append(this.root);
  }

  togglePin(): void {
    this.pinned = !this.pinned;
    this.root.classList.toggle("is-pinned", this.pinned);
  }

  clear(): void {
    this.currentId = null;
    this.root.classList.add("is-hidden");
  }

  show(platform: PlatformRuntime | null, runtime: LevelRuntime): void {
    if (!platform) {
      if (!this.pinned) this.clear();
      return;
    }
    if (platform.spec.id === this.currentId) return;
    this.currentId = platform.spec.id;
    this.root.classList.remove("is-hidden");

    const spec = platform.spec;
    const events = runtime.data.events.filter((e) => e.platform === spec.id);
    const encrypted = runtime.data.analysis_metadata.string_encryption;

    const rows: string[] = [];
    rows.push(`<header><span class="ins-kind">${escape(spec.kind)}</span>
      <code class="ins-addr">${escape(spec.display.address)}</code></header>`);

    rows.push(`<dl class="ins-meta">
      <div><dt>Platform</dt><dd>${escape(spec.id)}</dd></div>
      <div><dt>Logical node</dt><dd>${escape(spec.logical_node ?? "—")}${
        spec.logical_node ? ` <span class="ins-dim">occurrence ${spec.occurrence}</span>` : ""
      }</dd></div>
      <div><dt>Raw blocks</dt><dd>${spec.raw_blocks.length}</dd></div>
    </dl>`);

    rows.push(
      `<pre class="ins-code">${spec.display.instructions.map((i) => escape(i)).join("\n")}</pre>`,
    );

    if (spec.display.strings.length > 0) {
      rows.push(
        `<p class="ins-label">Strings</p><ul class="ins-strings">${spec.display.strings
          .map((s) => `<li>"${escape(s)}"</li>`)
          .join("")}</ul>`,
      );
    } else if (encrypted) {
      rows.push(
        `<p class="ins-note">No plaintext strings: this binary was built with string encryption, so the dataset ships none for this block.</p>`,
      );
    }

    rows.push(
      `<p class="ins-label">Mapped raw blocks</p><p class="ins-blocks">${spec.raw_blocks
        .map((b) => escape(b))
        .join(" ")}</p>`,
    );
    rows.push(`<p class="ins-note">${escape(spec.mapping_note)}</p>`);

    if (events.length > 0) {
      rows.push(
        `<p class="ins-label">Semantic events</p><ul class="ins-events">${events
          .map(
            (e) =>
              `<li><span>${escape(e.type)}</span> <code>${escape(e.call_target)}</code> <span class="ins-dim">@ ${escape(e.instruction_address)}</span></li>`,
          )
          .join("")}</ul>`,
      );
    }

    if (spec.provenance) {
      rows.push(`<p class="ins-label">Provenance</p>
        <p class="ins-prov"><strong>${escape(spec.provenance.classification)}</strong>
        <span class="ins-dim">${escape(spec.provenance.source)} · ${escape(spec.provenance.confidence)}</span></p>
        <p class="ins-note">${escape(spec.provenance.method)}</p>`);
    }

    this.root.innerHTML = rows.join("");
  }
}

function escape(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
