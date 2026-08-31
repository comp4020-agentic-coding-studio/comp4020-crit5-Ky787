/** Camera feel contracts, especially for Quarantine's vertical grapple arcs. */

import { describe, expect, it } from "vitest";
import { CAMERA } from "../src/engine/constants.ts";
import { Camera } from "../src/render/camera.ts";

describe("camera: vertical traversal", () => {
  const view = { w: 1440, h: 856 };

  function shaftCamera(): Camera {
    const camera = new Camera();
    camera.viewW = view.w;
    camera.viewH = view.h;
    camera.setWorld(1718, 8444);
    camera.snapTo(850, 4200);
    return camera;
  }

  it("does not whip downward when a grapple arc reverses vertical velocity", () => {
    const camera = shaftCamera();
    const player = { x: 850, y: 4200 };

    // Settle into a fast upward climb with the pointer on the ledge overhead.
    for (let i = 0; i < 120; i += 1) {
      camera.update(1 / 60, player, { x: 0, y: -1200 }, { x: 850, y: 3600 }, view.w, view.h);
    }

    const before = camera.y;
    camera.update(1 / 60, player, { x: 0, y: 1200 }, { x: 850, y: 4800 }, view.w, view.h);
    expect(
      Math.abs(camera.y - before),
      "one velocity reversal must not move the view by a visible chunk of the shaft",
    ).toBeLessThan(40);
  });

  it("keeps a world-space margin around the player when aim and velocity leads combine", () => {
    const camera = shaftCamera();
    const player = { x: 850, y: 4200 };
    for (let i = 0; i < 240; i += 1) {
      camera.update(1 / 60, player, { x: 0, y: -1500 }, { x: 850, y: 3200 }, view.w, view.h);
    }

    const top = camera.originY();
    const bottom = top + view.h / camera.zoom;
    expect(player.y - top).toBeGreaterThanOrEqual(CAMERA.verticalMargin - 1);
    expect(bottom - player.y).toBeGreaterThanOrEqual(CAMERA.verticalMargin - 1);
  });
});
