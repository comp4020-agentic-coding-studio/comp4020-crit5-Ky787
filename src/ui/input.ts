/**
 * Keyboard and Pointer Events input.
 *
 * Aiming and grappling go through Pointer Events, so a mouse, a pen and a
 * touch screen all drive the same code path. Edge-triggered actions (jump,
 * fire) are latched here and consumed by exactly one fixed physics step, so
 * behaviour does not depend on frame rate.
 */

import type { Vec2 } from "../engine/geometry.ts";
import { anyDialogOpen } from "./modals.ts";
import type { InputState } from "../engine/physics.ts";
import { emptyInput } from "../engine/physics.ts";

export type ActionName = "pause" | "restart" | "analysis" | "inspect";

export class InputManager {
  readonly state: InputState = emptyInput();
  /** Pointer position in CSS pixels relative to the canvas. */
  readonly screenAim: Vec2 = { x: 0, y: 0 };
  hasPointer = false;

  private pendingJump = false;
  private pendingGrapple = false;
  private actions = new Set<ActionName>();
  private held = new Set<string>();
  private detach: (() => void)[] = [];
  private touchMove = 0;

  attach(canvas: HTMLCanvasElement, root: HTMLElement): void {
    const onKey = (e: KeyboardEvent, down: boolean): void => {
      const code = e.code;
      if (down && e.repeat) return;
      // A dialog owns the keyboard while it is open — including Escape, which
      // closes it rather than toggling the pause menu behind it.
      if (anyDialogOpen()) {
        this.releaseAll();
        return;
      }
      if (
        [
          "KeyA",
          "KeyD",
          "KeyW",
          "KeyS",
          "Space",
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
          "KeyR",
          "F1",
        ].includes(code)
      ) {
        e.preventDefault();
      }
      if (down) this.held.add(code);
      else this.held.delete(code);

      if (!down) return;
      if (code === "Space") this.pendingJump = true;
      if (code === "Escape") this.actions.add("pause");
      if (code === "KeyR") this.actions.add("restart");
      if (code === "F1") this.actions.add("analysis");
      if (code === "KeyE" || code === "Tab") {
        e.preventDefault();
        this.actions.add("inspect");
      }
    };

    const keyDown = (e: KeyboardEvent): void => onKey(e, true);
    const keyUp = (e: KeyboardEvent): void => onKey(e, false);
    globalThis.addEventListener("keydown", keyDown);
    globalThis.addEventListener("keyup", keyUp);
    this.detach.push(() => globalThis.removeEventListener("keydown", keyDown));
    this.detach.push(() => globalThis.removeEventListener("keyup", keyUp));

    const setAim = (e: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      this.screenAim.x = e.clientX - rect.left;
      this.screenAim.y = e.clientY - rect.top;
      this.hasPointer = true;
    };

    const down = (e: PointerEvent): void => {
      if (anyDialogOpen()) return;
      setAim(e);
      if (e.button === 2) {
        this.held.add("ReelIn");
        return;
      }
      if (e.button !== 0) return;
      canvas.setPointerCapture?.(e.pointerId);
      this.pendingGrapple = true;
      this.state.grappleHeld = true;
    };
    const up = (e: PointerEvent): void => {
      if (e.button === 2) {
        this.held.delete("ReelIn");
        return;
      }
      if (e.button !== 0) return;
      this.state.grappleHeld = false;
    };
    const move = (e: PointerEvent): void => setAim(e);
    const cancel = (): void => {
      this.state.grappleHeld = false;
      this.held.delete("ReelIn");
    };
    const menu = (e: Event): void => e.preventDefault();

    canvas.addEventListener("pointerdown", down);
    globalThis.addEventListener("pointerup", up);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointercancel", cancel);
    canvas.addEventListener("contextmenu", menu);
    globalThis.addEventListener("blur", cancel);
    this.detach.push(() => canvas.removeEventListener("pointerdown", down));
    this.detach.push(() => globalThis.removeEventListener("pointerup", up));
    this.detach.push(() => canvas.removeEventListener("pointermove", move));
    this.detach.push(() => canvas.removeEventListener("pointercancel", cancel));
    this.detach.push(() => canvas.removeEventListener("contextmenu", menu));
    this.detach.push(() => globalThis.removeEventListener("blur", cancel));

    this.attachTouch(root);
  }

  /**
   * Thumb controls for touch devices. Desktop keyboard/mouse is untouched: the
   * pad is only shown when the platform reports touch support.
   */
  private attachTouch(root: HTMLElement): void {
    if (typeof navigator === "undefined" || (navigator.maxTouchPoints ?? 0) === 0) return;
    const pad = document.createElement("div");
    pad.className = "touch-pad";
    pad.innerHTML = `
      <button type="button" data-touch="left" aria-label="Move left">◀</button>
      <button type="button" data-touch="right" aria-label="Move right">▶</button>
      <button type="button" data-touch="jump" aria-label="Jump">JUMP</button>`;
    root.appendChild(pad);

    for (const button of pad.querySelectorAll<HTMLButtonElement>("[data-touch]")) {
      const kind = button.dataset.touch;
      const press = (e: PointerEvent): void => {
        e.preventDefault();
        if (kind === "left") this.touchMove = -1;
        else if (kind === "right") this.touchMove = 1;
        else this.pendingJump = true;
      };
      const release = (e: PointerEvent): void => {
        e.preventDefault();
        if (kind === "left" || kind === "right") this.touchMove = 0;
      };
      button.addEventListener("pointerdown", press);
      button.addEventListener("pointerup", release);
      button.addEventListener("pointerleave", release);
      button.addEventListener("pointercancel", release);
    }
    this.detach.push(() => pad.remove());
  }

  dispose(): void {
    for (const off of this.detach) off();
    this.detach = [];
  }

  /** Refreshes continuous state and resolves the aim into world units. */
  sync(worldAim: Vec2): void {
    const s = this.state;
    s.left = this.held.has("KeyA") || this.held.has("ArrowLeft") || this.touchMove < 0;
    s.right = this.held.has("KeyD") || this.held.has("ArrowRight") || this.touchMove > 0;
    s.down = this.held.has("KeyS") || this.held.has("ArrowDown");
    s.jumpHeld = this.held.has("Space");
    s.reelIn = this.held.has("KeyW") || this.held.has("ArrowUp") || this.held.has("ReelIn");
    s.reelOut = this.held.has("KeyS") || this.held.has("ArrowDown");
    s.aim = worldAim;
  }

  /** Consumed once per physics step; edges fire on the first step only. */
  takeEdges(): { jump: boolean; grapple: boolean } {
    const out = { jump: this.pendingJump, grapple: this.pendingGrapple };
    this.pendingJump = false;
    this.pendingGrapple = false;
    return out;
  }

  takeAction(name: ActionName): boolean {
    if (!this.actions.has(name)) return false;
    this.actions.delete(name);
    return true;
  }

  clearActions(): void {
    this.actions.clear();
  }

  releaseAll(): void {
    this.held.clear();
    this.touchMove = 0;
    this.state.grappleHeld = false;
    this.pendingJump = false;
    this.pendingGrapple = false;
  }
}
