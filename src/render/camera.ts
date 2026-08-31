/**
 * Smooth follow camera. It has to serve two very different shapes of level:
 * Root is 9,400 units wide, and Quarantine is a 8,400-unit vertical shaft
 * barely 1,700 wide. Rather than special-casing a level, the camera reads how
 * tall the world is in screens and leans its look-ahead, its follow rate and
 * how far it zooms out accordingly.
 */

import { CAMERA } from "../engine/constants.ts";
import { clamp, damp, lerp } from "../engine/geometry.ts";
import type { Vec2 } from "../engine/geometry.ts";

export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  shake = 0;
  private shakeX = 0;
  private shakeY = 0;

  /** Viewport size in CSS pixels, set by the renderer each frame. */
  viewW = 1280;
  viewH = 720;

  private world = { width: 1000, height: 1000 };
  /** 0 for a level that fits one screen vertically, 1 for a tall shaft. */
  private verticality = 0;
  /** Raw rope velocity changes direction sharply at the top of a swing. */
  private leadVelocityY = 0;

  setWorld(width: number, height: number): void {
    this.world = { width, height };
    this.leadVelocityY = 0;
    this.verticality = clamp(
      (height - CAMERA.viewHeight) / (CAMERA.viewHeight * 2.5),
      0,
      1,
    );
  }

  /** How tall this world is, on the 0-1 scale the camera tunes itself with. */
  get tallness(): number {
    return this.verticality;
  }

  snapTo(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.leadVelocityY = 0;
    this.clampToWorld();
  }

  private clampToWorld(): void {
    const halfW = this.viewW / 2 / this.zoom;
    const halfH = this.viewH / 2 / this.zoom;
    this.x =
      this.world.width <= halfW * 2
        ? this.world.width / 2
        : clamp(this.x, halfW, this.world.width - halfW);
    this.y =
      this.world.height <= halfH * 2
        ? this.world.height / 2
        : clamp(this.y, halfH, this.world.height - halfH);
  }

  update(
    dt: number,
    target: Vec2,
    velocity: Vec2,
    aim: Vec2 | null,
    viewW: number,
    viewH: number,
  ): void {
    this.viewW = viewW;
    this.viewH = viewH;
    const v = this.verticality;
    // A shaft is travelled vertically at rope speed, so it gets more world
    // height in view than a level you read left to right.
    const wantHeight = CAMERA.viewHeight + lerp(...CAMERA.verticalViewBonus, v);
    this.zoom = clamp(
      Math.min(viewH / wantHeight, viewW / CAMERA.viewWidth),
      CAMERA.minZoom,
      CAMERA.maxZoom,
    );

    // A grapple arc can reverse vertical velocity in a handful of frames. If
    // raw velocity drives the view, that reversal throws a tall-level camera
    // from one side of the player to the other. Filter only the look-ahead;
    // the camera still follows the player's actual position every frame.
    this.leadVelocityY = damp(
      this.leadVelocityY,
      velocity.y,
      CAMERA.velocityResponse,
      dt,
    );
    const yLead = CAMERA.velocityLead * lerp(...CAMERA.verticalLead, v);
    const yMaxLead = CAMERA.maxLead * lerp(1, 1.15, v);
    let wantX = target.x + clamp(velocity.x * CAMERA.velocityLead, -CAMERA.maxLead, CAMERA.maxLead);
    let wantY = target.y + clamp(this.leadVelocityY * yLead, -yMaxLead, yMaxLead);
    if (aim) {
      wantX += clamp((aim.x - target.x) * CAMERA.aimLead, -220, 220);
      // Negative Y is up. Tall worlds give extra room to look toward the next
      // ledge overhead, rather than below the player.
      wantY += clamp((aim.y - target.y) * CAMERA.aimLead, -(160 + 120 * v), 160);
    }

    // Velocity lead and pointer lead used to be capped separately, so their
    // sum could put the player at (or beyond) the edge of Quarantine's view.
    const halfVisibleHeight = viewH / 2 / this.zoom;
    const safeVerticalLead = Math.max(0, halfVisibleHeight - CAMERA.verticalMargin);
    wantY = target.y + clamp(wantY - target.y, -safeVerticalLead, safeVerticalLead);

    this.x = damp(this.x, wantX, CAMERA.followRate, dt);
    this.y = damp(this.y, wantY, CAMERA.followRate * lerp(...CAMERA.verticalFollow, v), dt);
    this.clampToWorld();

    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - CAMERA.shakeDecay * dt * this.shake);
      if (this.shake < 0.01) this.shake = 0;
      const mag = this.shake * 26;
      this.shakeX = (Math.random() * 2 - 1) * mag;
      this.shakeY = (Math.random() * 2 - 1) * mag;
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
    }
  }

  kick(amount: number): void {
    this.shake = Math.min(1.4, this.shake + amount);
  }

  /** Left/top of the visible world rectangle, shake included. */
  originX(): number {
    return this.x + this.shakeX - this.viewW / 2 / this.zoom;
  }

  originY(): number {
    return this.y + this.shakeY - this.viewH / 2 / this.zoom;
  }

  screenToWorld(sx: number, sy: number): Vec2 {
    return { x: this.originX() + sx / this.zoom, y: this.originY() + sy / this.zoom };
  }

  visibleBounds(pad = 200): { x0: number; y0: number; x1: number; y1: number } {
    const x0 = this.originX() - pad;
    const y0 = this.originY() - pad;
    return {
      x0,
      y0,
      x1: x0 + this.viewW / this.zoom + pad * 2,
      y1: y0 + this.viewH / this.zoom + pad * 2,
    };
  }
}
