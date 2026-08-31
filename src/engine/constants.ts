/**
 * Every gameplay-feel number lives here. Nothing in this file references a
 * specific level, address or platform id: level identity comes from the
 * dataset plus the theme profiles at the bottom.
 */

import type { LevelTheme } from "../data/types.ts";

/** Physics runs on a fixed step so behaviour does not drift with frame rate. */
export const FIXED_DT = 1 / 120;
/** Never simulate more than this much wall time in one frame (tab-switch guard). */
export const MAX_FRAME_TIME = 0.25;

export const PLAYER = {
  width: 22,
  height: 34,
  /** Horizontal ground acceleration. */
  accel: 3400,
  airAccel: 1900,
  maxRunSpeed: 380,
  groundFriction: 2900,
  airDrag: 130,
  gravity: 3400,
  /** Gravity multiplier while rising with jump held (floaty ascent). */
  jumpHoldGravity: 0.72,
  /** Extra gravity while falling, for a snappy arc. */
  fallGravity: 1.25,
  jumpVelocity: 640,
  /** Grace period after leaving a ledge during which a jump still works. */
  coyoteTime: 0.11,
  /** Jump presses are remembered this long before landing. */
  jumpBuffer: 0.13,
  maxFallSpeed: 1500,
  /** Hard ceiling on speed, so rope slingshots cannot tunnel. */
  maxSpeed: 2100,
} as const;

export const GRAPPLE = {
  /** Hook cannot attach beyond this distance (dataset design limit is 600). */
  maxRange: 620,
  /** Nor closer than this, so the hook never grabs the block under your feet. */
  minRange: 58,
  /** Hook travel speed while the line is being fired. */
  hookSpeed: 3400,
  /** Radius of the aim capsule; makes 24-unit-tall slabs practical targets. */
  aimAssistRadius: 26,
  /** Rope shortens at this rate while the grapple button is held. */
  reelInSpeed: 330,
  reelOutSpeed: 430,
  minLength: 46,
  /** Fraction of outward velocity killed when the rope goes taut. */
  ropeStiffness: 1.0,
  /**
   * How much of the reel-in motion becomes real velocity. Without this the
   * winch would slide the player along the rope with no momentum to release
   * with, and the hook would feel like a slow teleport.
   */
  reelTransfer: 0.9,
  /** Tangential acceleration from A/D while swinging. */
  swingAccel: 1500,
  /** Upward kick on release, so a well-timed let-go clears the lip. */
  releaseBoost: 90,
  /** Velocity multiplier at release; 1 preserves momentum exactly. */
  releaseMomentum: 1.0,
} as const;

export const CAMERA = {
  /** World units of height kept in view; width follows the aspect ratio. */
  viewHeight: 1020,
  /**
   * Minimum world width kept in view. On a phone the height-derived zoom would
   * show barely 500 units, which is less than one grapple, so the narrower of
   * the two constraints wins.
   */
  viewWidth: 1150,
  minZoom: 0.30,
  maxZoom: 1.15,
  /** Exponential smoothing rate; higher is tighter. */
  followRate: 9.5,
  /** How far the camera leads the player's velocity. */
  velocityLead: 0.30,
  /** Response rate for the velocity used by look-ahead (filters grapple reversals). */
  velocityResponse: 3.2,
  maxLead: 320,
  /** Aim influence: the camera drifts toward where the pointer is looking. */
  aimLead: 0.16,
  shakeDecay: 4.2,
  /**
   * Vertical look-ahead, as a fraction of the horizontal figure. A wide level
   * reads left to right and wants the first value; a shaft like Quarantine is
   * travelled at 300+ units/second straight up, and needs the second or the
   * player arrives at a platform they have not seen yet. The blend comes from
   * the level's own world aspect, so no level id appears here.
   */
  verticalLead: [0.6, 1.1],
  /** Extra world height kept in view, lerped by the same verticality blend. */
  verticalViewBonus: [0, 260],
  /** Follow rate on Y, relative to X. */
  verticalFollow: [0.85, 1.0],
  /** World-space margin kept between the player and the top/bottom of view. */
  verticalMargin: 180,
} as const;

export const CRUMBLE = {
  /** Delay between the player touching a bogus block and it giving way. */
  fuse: 0.85,
  /** How long the fragments linger. */
  debris: 1.1,
  /** Time before a collapsed block is restored (never, until respawn). */
  respawnOnCheckpoint: true,
} as const;

export const HAZARD = {
  firewall: {
    /** Barrier reach above and below the gap it guards. */
    reach: 300,
    reachBelow: 0.6,
    thickness: 26,
    /** Seconds the gate is lethal, then open. */
    closed: 2.4,
    open: 2.1,
    warn: 0.7,
  },
  scanner: {
    /** Half-width of the sweep, centred on the gap it patrols. */
    span: 300,
    beamWidth: 20,
    period: 5.0,
    /** Beam reach above the platform line, and below it as a fraction. */
    reach: 340,
    reachBelow: 0.62,
    /** Grace after a respawn before beams can kill again. */
    armDelay: 0.9,
  },
  watchdog: {
    /**
     * How far behind the player the wall starts. Roughly two thirds of a
     * screen, so it is visible almost immediately rather than a rumour.
     */
    leadIn: 1250,
    /**
     * Speed of the first activation. A bot playing the trace cleanly averages
     * about 180 units/second, so the wall starts above that — sloppy play gets
     * caught — and climbs as more call sites arm, while a player who keeps
     * chaining swings still outruns it.
     */
    baseSpeed: 145,
    /** Added to speed by each further watchdog call site. */
    speedStep: 21,
    /** Wall is pushed back this far when a checkpoint is claimed. */
    checkpointRelief: 620,
    /**
     * The furthest the wall may fall behind. This is what stops a strong run
     * from retiring the threat for the rest of the level, and it also caps the
     * room a respawn can buy, so both are set together.
     */
    maxTrail: 2000,
    /** Wall is put this far behind the player after a death. */
    respawnSetback: 2000,
  },
} as const;

export const WORLD = {
  /** Fall this far past the delivered death plane and you are gone. */
  deathMargin: 0,
  /** Height of the non-solid code panel drawn under each platform slab. */
  codePanelHeight: 132,
  codePanelMinWidth: 236,
  deathFreeze: 0.5,
} as const;

/**
 * Which hazards a theme runs and how hard. Every entry maps a *semantic event
 * type* from the dataset onto engine behaviour; no addresses appear here.
 */
export interface ThemeProfile {
  /** Multiplier on scanner beam speed; 0 disables scanners on this level. */
  scanner: number;
  /** Multiplier on firewall cycle speed; 0 disables firewall gates. */
  firewall: number;
  /** Watchdog pursuit strength; 0 leaves watchdog call sites presentational. */
  watchdog: number;
  /** Treat `authentication` call sites as identity gates (Firewall's motif). */
  authGates: boolean;
  /** Seconds the player must hold the objective region to finish the run. */
  objectiveDwell: number;
  /**
   * The longest run of route platforms the level may ask the player to hold in
   * one go. Where the delivered checkpoints leave a bigger gap than this, the
   * engine adds relief checkpoints on real route platforms in between. The
   * long missions (Sweep, Relay, Quarantine, Root) ship only two to four saves
   * across 19-30 platforms, so they get a tighter spacing than the short ones.
   */
  checkpointSpacing: number;
  /** Background/accent tint, used by the renderer only. */
  accent: string;
  tagline: string;
}

export const THEME_PROFILES: Record<LevelTheme, ThemeProfile> = {
  // Ghostline teaches: walk, hop, then grapple. Slow ramp, generous cap.
  tutorial_horizontal: {
    scanner: 0.62,
    firewall: 0.7,
    watchdog: 0,
    authGates: false,
    objectiveDwell: 1.0,
    checkpointSpacing: 8,
    accent: "#4ee0a1",
    tagline: "Learn the line. Nothing here is in a hurry.",
  },
  // Firewall climbs and drops through gated tiers; the gates are the level.
  gated_mixed: {
    scanner: 0,
    firewall: 1.0,
    watchdog: 0,
    authGates: true,
    objectiveDwell: 1.2,
    checkpointSpacing: 8,
    accent: "#ff9f4a",
    tagline: "Every tier is gated. Read the cycle before you commit.",
  },
  // Sweep is rhythmic zig-zag: beams are the only threat, so they run full pace.
  scanner_zigzag: {
    scanner: 1.0,
    firewall: 0,
    watchdog: 0,
    authGates: false,
    objectiveDwell: 1.2,
    checkpointSpacing: 6,
    accent: "#59c8ff",
    tagline: "Sweeping detection. Move on the beat.",
  },
  // Watchdog wants momentum: the wall punishes anyone who stops to look.
  pressure_momentum: {
    scanner: 0.5,
    firewall: 0,
    watchdog: 1.0,
    authGates: false,
    objectiveDwell: 1.4,
    checkpointSpacing: 8,
    accent: "#ff5f6d",
    tagline: "Something is following the trace. Do not stall.",
  },
  // Blackout runs every countermeasure at once, with no strings to read by.
  mixed_first_finale: {
    scanner: 0.95,
    firewall: 1.05,
    watchdog: 0.85,
    authGates: false,
    objectiveDwell: 2.6,
    checkpointSpacing: 8,
    accent: "#c08cff",
    tagline: "Every countermeasure at once, and no strings to read by.",
  },
  // Relay is long and full of forks. Its difficulty is route choice and
  // stamina, so gates give it structure without stacking hazards on top.
  fork_reconvergence: {
    scanner: 0,
    firewall: 1.0,
    watchdog: 0,
    authGates: true,
    objectiveDwell: 1.6,
    checkpointSpacing: 7,
    accent: "#7ce0c8",
    tagline: "Four paths leave here. They do not all come back.",
  },
  // Quarantine is a climb through sweeping containment. Beams run a little
  // slower than Sweep's because a shaft gives you fewer places to wait.
  vertical_containment: {
    scanner: 0.85,
    firewall: 1.0,
    watchdog: 0,
    authGates: false,
    objectiveDwell: 1.6,
    checkpointSpacing: 6,
    accent: "#6fd0ff",
    tagline: "Straight up through containment. The only way out is the top.",
  },
  // Root is the long one: five phases, every mechanic, longest execution.
  multiphase_finale: {
    scanner: 1.0,
    firewall: 1.05,
    watchdog: 1.0,
    authGates: false,
    objectiveDwell: 3.0,
    checkpointSpacing: 7,
    accent: "#ff7bd1",
    tagline: "Access, sweep, pursuit, routing, ascent. Then root.",
  },
};

export const MISSION_BRIEFS: Record<LevelTheme, string> = {
  tutorial_horizontal: "Follow the trace to the exit block.",
  gated_mixed: "Breach every firewall tier and reach the end of the trace.",
  scanner_zigzag: "Cross the scanner chambers without tripping a sweep.",
  pressure_momentum: "Outrun the watchdog to the end of the trace.",
  mixed_first_finale: "Run the blackout operation blind. No plaintext, no second pass.",
  fork_reconvergence: "Follow the relay through every fork to the reconvergence.",
  vertical_containment: "Climb out of containment. Lower deck to quarantine core.",
  multiphase_finale: "Take root. Five phases, no plaintext, no second pass.",
};
