/** Smooth follow camera over worlds up to ~21k units wide. */

import { CAMERA } from "../engine/constants.ts";
import { clamp, damp } from "../engine/geometry.ts";
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

  setWorld(width: number, height: number): void {
    this.world = { width, height };
  }

  snapTo(x: number, y: number): void {
    this.x = x;
    this.y = y;
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
    this.zoom = clamp(
      Math.min(viewH / CAMERA.viewHeight, viewW / CAMERA.viewWidth),
      CAMERA.minZoom,
      CAMERA.maxZoom,
    );

    let wantX = target.x + clamp(velocity.x * CAMERA.velocityLead, -CAMERA.maxLead, CAMERA.maxLead);
    let wantY =
      target.y + clamp(velocity.y * CAMERA.velocityLead * 0.6, -CAMERA.maxLead, CAMERA.maxLead);
    if (aim) {
      wantX += clamp((aim.x - target.x) * CAMERA.aimLead, -220, 220);
      wantY += clamp((aim.y - target.y) * CAMERA.aimLead, -160, 160);
    }

    this.x = damp(this.x, wantX, CAMERA.followRate, dt);
    this.y = damp(this.y, wantY, CAMERA.followRate * 0.85, dt);
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
