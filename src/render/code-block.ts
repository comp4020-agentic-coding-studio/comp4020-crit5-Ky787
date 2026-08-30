/**
 * Pre-rendered debugger panels.
 *
 * Every platform's code is drawn once into an offscreen canvas and then blitted
 * each frame, so a level with 58 code blocks costs 58 `drawImage` calls instead
 * of several hundred `fillText` calls per frame.
 *
 * The text comes straight from the dataset's `display` payload, in full:
 * every instruction the dataset supplies is drawn, never reworded or cut, and
 * the panel grows to fit. Strings are shown only when the dataset supplies
 * them (level 5's are encrypted, so it supplies none).
 */

import { WORLD } from "../engine/constants.ts";
import type { PlatformSpec } from "../data/types.ts";

const SUPERSAMPLE = 2;
const BODY_FONT = 11.5;
const LINE_H = 15.5;

export interface PanelSprite {
  canvas: HTMLCanvasElement;
  /** Panel size in world units. */
  w: number;
  h: number;
  /** Offset of the panel's left edge from the platform's left edge. */
  dx: number;
}

function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

export function buildPanel(spec: PlatformSpec, accent: string): PanelSprite {
  const w = Math.max(spec.width, WORLD.codePanelMinWidth);
  const pad = 11;
  const headerH = pad + 10 + 8 + LINE_H;
  const bodyH = spec.display.instructions.length * LINE_H;
  const stringsH = spec.display.strings.length > 0 ? LINE_H : 0;
  const footerH = 20;
  const h = Math.max(WORLD.codePanelHeight, Math.ceil(headerH + bodyH + stringsH + footerH));
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(w * SUPERSAMPLE);
  canvas.height = Math.ceil(h * SUPERSAMPLE);
  const ctx = canvas.getContext("2d");
  if (!ctx) return { canvas, w, h, dx: (spec.width - w) / 2 };
  ctx.scale(SUPERSAMPLE, SUPERSAMPLE);

  const bogus = spec.kind === "crumble";

  // Body plate.
  ctx.fillStyle = bogus ? "rgba(12,14,22,0.80)" : "rgba(9,15,23,0.82)";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(120,160,200,0.16)";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

  // Gutter rule, like a disassembly listing.
  ctx.fillStyle = "rgba(120,160,200,0.07)";
  ctx.fillRect(0, 0, 5, h);

  let y = pad + 10;

  ctx.font = `500 10px ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, monospace`;
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.85;
  ctx.fillText(fit(ctx, spec.display.address, w - pad * 2), pad, y);
  ctx.globalAlpha = 1;
  y += 8;
  ctx.fillStyle = "rgba(120,160,200,0.18)";
  ctx.fillRect(pad, y, w - pad * 2, 1);
  y += LINE_H;

  ctx.font = `${BODY_FONT}px ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, monospace`;
  for (const line of spec.display.instructions) {
    const [mnemonic, ...rest] = line.split(" ");
    ctx.fillStyle = "rgba(214,232,248,0.90)";
    ctx.fillText(mnemonic, pad, y);
    const mw = ctx.measureText(`${mnemonic} `).width;
    ctx.fillStyle = "rgba(150,178,204,0.72)";
    ctx.fillText(fit(ctx, rest.join(" "), w - pad * 2 - mw), pad + mw, y);
    y += LINE_H;
  }

  if (spec.display.strings.length > 0) {
    ctx.font = `10.5px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.fillStyle = "rgba(255,214,140,0.80)";
    ctx.fillText(fit(ctx, `"${spec.display.strings[0]}"`, w - pad * 2), pad, Math.min(y, h - pad));
  }

  // Raw-block count, bottom right: honest about the fact that one visible
  // block can stand for several machine basic blocks.
  ctx.font = `9.5px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.fillStyle = "rgba(120,150,175,0.38)";
  const tag = `${spec.raw_blocks.length} bb`;
  ctx.fillText(tag, w - pad - ctx.measureText(tag).width, h - 9);

  return { canvas, w, h, dx: (spec.width - w) / 2 };
}
