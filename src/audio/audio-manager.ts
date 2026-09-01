/**
 * Centralised, failure-tolerant game audio.
 *
 * Gameplay asks for named sounds and supplies a compact state snapshot. This
 * module owns files, mixing, voice limits, cooldowns, loops and music changes.
 */

export interface AudioPreferences {
  music: number;
  sfx: number;
  muted: boolean;
}

export interface AudioFrameState {
  active: boolean;
  alive: boolean;
  reeling: boolean;
  scannerProximity: number;
  /** `null` gates are outside listening range and do not emit transitions. */
  firewallClosed: readonly (boolean | null)[];
  watchdogPressure: number;
  tension: number;
  objectiveCharging: boolean;
  objectiveProgress: number;
  objectiveDuration: number;
}

export type SfxName =
  | "grappleFire"
  | "grappleAttach"
  | "landing"
  | "crumbleStart"
  | "crumbleBreak"
  | "firewallOpen"
  | "watchdogWarning"
  | "notification"
  | "confirm"
  | "death"
  | "respawn";

interface SoundSpec {
  file: string;
  gain: number;
  cooldown: number;
  voices: number;
  rate?: number;
}

interface MusicPlan {
  normal:
    | "ambient-pulse.ogg"
    | "level02-firewall.ogg"
    | "ambient-airy.ogg"
    | "level04-watchdog.ogg"
    | "level05-blackout.ogg"
    | "level06-relay.ogg"
    | "level07-quarantine.ogg"
    | "level08-root.ogg";
  tension?: "tension-urgent.ogg";
}

/** Explicit assignments make auditioning or replacing a level's score simple. */
export const LEVEL_MUSIC: Readonly<Record<string, MusicPlan>> = {
  level01: { normal: "ambient-pulse.ogg" },
  level02: { normal: "level02-firewall.ogg" },
  level03: { normal: "ambient-airy.ogg" },
  level04: { normal: "level04-watchdog.ogg", tension: "tension-urgent.ogg" },
  level05: { normal: "level05-blackout.ogg" },
  level06: { normal: "level06-relay.ogg" },
  level07: { normal: "level07-quarantine.ogg" },
  level08: { normal: "level08-root.ogg", tension: "tension-urgent.ogg" },
};

const SFX: Readonly<Record<SfxName, SoundSpec>> = {
  grappleFire: { file: "grapple-fire.ogg", gain: 0.52, cooldown: 0.075, voices: 3 },
  grappleAttach: { file: "grapple-attach.ogg", gain: 0.82, cooldown: 0.07, voices: 3 },
  landing: { file: "landing.ogg", gain: 0.68, cooldown: 0.1, voices: 2 },
  crumbleStart: { file: "crumble-start.ogg", gain: 0.74, cooldown: 0.2, voices: 2 },
  crumbleBreak: { file: "crumble-break.ogg", gain: 0.69, cooldown: 0.18, voices: 2 },
  firewallOpen: { file: "firewall-open.ogg", gain: 0.48, cooldown: 0.3, voices: 2 },
  watchdogWarning: { file: "watchdog-warning.ogg", gain: 0.76, cooldown: 0.7, voices: 1 },
  notification: { file: "notification.ogg", gain: 0.55, cooldown: 0.24, voices: 1 },
  confirm: { file: "confirm.ogg", gain: 0.66, cooldown: 0.12, voices: 2 },
  // Reusing the short collapse transient at a lower pitch gives death an
  // electronic failure character without adding another near-duplicate file.
  death: { file: "crumble-break.ogg", gain: 0.86, cooldown: 0.5, voices: 1, rate: 0.72 },
  respawn: { file: "confirm.ogg", gain: 0.42, cooldown: 0.3, voices: 1, rate: 0.86 },
};

export const DEFAULT_AUDIO_PREFERENCES: AudioPreferences = {
  music: 0.35,
  sfx: 0.68,
  muted: false,
};

const STORAGE_KEY = "binary-ninja/audio/v1";
// Public audio keeps descriptive stable filenames; this revision prevents a
// browser cache from retaining an earlier audition mix after assets change.
const AUDIO_REVISION = "4";
const OBJECTIVE_CHARGE_SECONDS = 3;

export interface AudioHandle {
  src: string;
  preload: string;
  loop: boolean;
  volume: number;
  currentTime: number;
  playbackRate: number;
  readonly paused: boolean;
  readonly ended: boolean;
  play(): Promise<void> | void;
  pause(): void;
}

export type AudioFactory = (src: string) => AudioHandle | null;

export interface AudioManagerOptions {
  factory?: AudioFactory;
  baseUrl?: string;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
}

interface Voice {
  media: AudioHandle;
}

interface LoopChannel {
  media: AudioHandle | null;
  gain: number;
  target: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function browserFactory(src: string): AudioHandle | null {
  if (typeof Audio === "undefined") return null;
  return new Audio(src);
}

function browserStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function safePlay(media: AudioHandle): void {
  try {
    const result = media.play();
    if (result instanceof Promise) void result.catch(() => undefined);
  } catch {
    // A blocked autoplay policy or failed codec must never affect gameplay.
  }
}

function stop(media: AudioHandle | null, rewind = true): void {
  if (!media) return;
  try {
    media.pause();
    if (rewind) media.currentTime = 0;
  } catch {
    // Treat an unusable media element as silence.
  }
}

export class AudioManager {
  private readonly factory: AudioFactory;
  private readonly baseUrl: string;
  private readonly storage: AudioManagerOptions["storage"];
  private preferences: AudioPreferences;
  private readonly listeners = new Set<(preferences: AudioPreferences) => void>();
  private readonly pools = new Map<SfxName, Voice[]>();
  private readonly cooldownUntil = new Map<SfxName, number>();
  private clock = 0;
  private unlocked = false;
  private suspended = false;
  private activeLevel: string | null = null;
  private normalMusic: AudioHandle | null = null;
  private tensionMusic: AudioHandle | null = null;
  private completeSting: AudioHandle | null = null;
  private musicMix = 0;
  private watchdogCountdown = 0;
  private previousGates: (boolean | null)[] | null = null;
  private readonly reel: LoopChannel;
  private readonly scanner: LoopChannel;
  private readonly objectiveCharge: AudioHandle | null;
  private wasObjectiveCharging = false;

  constructor(options: AudioManagerOptions = {}) {
    this.factory = options.factory ?? browserFactory;
    this.baseUrl = options.baseUrl ?? `${import.meta.env.BASE_URL}audio/`;
    this.storage = options.storage === undefined ? browserStorage() : options.storage;
    this.preferences = this.loadPreferences();
    this.reel = this.makeLoop("sfx/grapple-reel.ogg", 0.18);
    this.scanner = this.makeLoop("sfx/scanner-loop.ogg", 0.22);
    this.objectiveCharge = this.create("sfx/objective-charge.ogg");
    if (this.objectiveCharge) {
      this.objectiveCharge.preload = "auto";
      this.objectiveCharge.loop = false;
      this.objectiveCharge.volume = 0;
    }

    // One cached voice per effect is enough to preload common sounds. Pools
    // grow only when an effect overlaps, and never beyond its declared cap.
    for (const name of Object.keys(SFX) as SfxName[]) this.addVoice(name);
  }

  installUnlock(target: Document | HTMLElement = document): void {
    const unlock = (): void => {
      this.unlock();
      target.removeEventListener("pointerdown", unlock);
      target.removeEventListener("keydown", unlock);
      target.removeEventListener("touchstart", unlock);
    };
    target.addEventListener("pointerdown", unlock, { passive: true });
    target.addEventListener("keydown", unlock);
    target.addEventListener("touchstart", unlock, { passive: true });
  }

  /** Must be called from an ordinary player gesture to satisfy autoplay. */
  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    this.resumeMusic();
  }

  getPreferences(): AudioPreferences {
    return { ...this.preferences };
  }

  setPreferences(patch: Partial<AudioPreferences>): void {
    this.preferences = {
      music: patch.music === undefined ? this.preferences.music : clamp01(patch.music),
      sfx: patch.sfx === undefined ? this.preferences.sfx : clamp01(patch.sfx),
      muted: patch.muted ?? this.preferences.muted,
    };
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.preferences));
    } catch {
      // Preferences are optional when storage is unavailable.
    }
    if (this.preferences.muted) this.pauseAll();
    else if (!this.suspended) this.resumeMusic();
    this.applyVolumes();
    for (const listener of this.listeners) listener(this.getPreferences());
  }

  subscribe(listener: (preferences: AudioPreferences) => void): () => void {
    this.listeners.add(listener);
    listener(this.getPreferences());
    return () => this.listeners.delete(listener);
  }

  startLevel(levelId: string): void {
    this.stopLevel();
    const plan = LEVEL_MUSIC[levelId] ?? LEVEL_MUSIC.level01;
    this.activeLevel = levelId;
    this.normalMusic = this.makeMusic(`music/${plan.normal}`);
    this.tensionMusic = plan.tension ? this.makeMusic(`music/${plan.tension}`) : null;
    this.musicMix = 0;
    this.previousGates = null;
    this.watchdogCountdown = 0;
    this.resumeMusic();
  }

  stopLevel(): void {
    this.activeLevel = null;
    stop(this.normalMusic);
    stop(this.tensionMusic);
    stop(this.completeSting);
    this.normalMusic = null;
    this.tensionMusic = null;
    this.completeSting = null;
    this.resetTransient();
  }

  resetTransient(): void {
    this.setLoop(this.reel, 0, true);
    this.setLoop(this.scanner, 0, true);
    stop(this.objectiveCharge);
    this.wasObjectiveCharging = false;
    this.watchdogCountdown = 0;
    this.previousGates = null;
  }

  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
    if (suspended) this.pauseAll();
    else this.resumeMusic();
  }

  play(name: SfxName, gain = 1, rate = 1): void {
    if (!this.unlocked || this.suspended || this.preferences.muted) return;
    const spec = SFX[name];
    if (this.clock < (this.cooldownUntil.get(name) ?? 0)) return;
    const voices = this.pools.get(name) ?? [];
    let voice = voices.find(({ media }) => media.paused || media.ended);
    if (!voice && voices.length < spec.voices) voice = this.addVoice(name);
    // Single-voice warnings deliberately retrigger instead of being dropped:
    // at high pressure the shorter interval is the warning information.
    if (!voice && spec.voices === 1) voice = voices[0];
    if (!voice) return;

    try {
      voice.media.currentTime = 0;
      voice.media.playbackRate = Math.min(1.35, Math.max(0.65, (spec.rate ?? 1) * rate));
      voice.media.volume = clamp01(spec.gain * gain * this.preferences.sfx);
      safePlay(voice.media);
      this.cooldownUntil.set(name, this.clock + spec.cooldown);
    } catch {
      // Silence is the graceful fallback.
    }
  }

  complete(): void {
    this.setLoop(this.reel, 0, true);
    this.setLoop(this.scanner, 0, true);
    stop(this.objectiveCharge);
    this.wasObjectiveCharging = false;
    stop(this.normalMusic);
    stop(this.tensionMusic);
    this.normalMusic = null;
    this.tensionMusic = null;
    stop(this.completeSting);
    this.completeSting = this.create("music/level-complete.ogg");
    if (!this.completeSting) return;
    this.completeSting.preload = "auto";
    this.completeSting.volume = this.completeVolume();
    if (this.unlocked && !this.preferences.muted) safePlay(this.completeSting);
  }

  update(dt: number, state: AudioFrameState): void {
    this.clock += Math.max(0, dt);
    const audible = state.active && state.alive && !this.suspended && !this.preferences.muted;

    this.reel.target = audible && state.reeling ? this.reel.gain : 0;
    this.scanner.target = audible ? this.scanner.gain * clamp01(state.scannerProximity) : 0;
    this.updateLoop(this.reel, dt);
    this.updateLoop(this.scanner, dt);
    this.updateObjectiveCharge(dt, audible, state);

    if (state.active && state.alive) {
      if (this.previousGates) {
        state.firewallClosed.forEach((closed, index) => {
          if (closed !== null && this.previousGates?.[index] === true && !closed) {
            this.play("firewallOpen");
          }
        });
      }
      this.previousGates = [...state.firewallClosed];
      this.updateWatchdog(dt, clamp01(state.watchdogPressure));
    } else {
      this.previousGates = null;
      this.watchdogCountdown = 0;
    }

    this.updateMusic(dt, audible ? clamp01(state.tension) : 0);
  }

  /** Stable state used by focused tests and the developer console. */
  snapshot(): Record<string, unknown> {
    return {
      unlocked: this.unlocked,
      suspended: this.suspended,
      level: this.activeLevel,
      reelPlaying: this.reel.media ? !this.reel.media.paused : false,
      scannerPlaying: this.scanner.media ? !this.scanner.media.paused : false,
      objectiveChargePlaying: this.objectiveCharge ? !this.objectiveCharge.paused : false,
      watchdogCountdown: this.watchdogCountdown,
      preferences: this.getPreferences(),
    };
  }

  private loadPreferences(): AudioPreferences {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_AUDIO_PREFERENCES };
      const saved = JSON.parse(raw) as Partial<AudioPreferences>;
      return {
        music: saved.music === undefined ? DEFAULT_AUDIO_PREFERENCES.music : clamp01(saved.music),
        sfx: saved.sfx === undefined ? DEFAULT_AUDIO_PREFERENCES.sfx : clamp01(saved.sfx),
        muted: typeof saved.muted === "boolean" ? saved.muted : DEFAULT_AUDIO_PREFERENCES.muted,
      };
    } catch {
      return { ...DEFAULT_AUDIO_PREFERENCES };
    }
  }

  private create(path: string): AudioHandle | null {
    try {
      return this.factory(`${this.baseUrl}${path}?v=${AUDIO_REVISION}`);
    } catch {
      return null;
    }
  }

  private addVoice(name: SfxName): Voice | undefined {
    const media = this.create(`sfx/${SFX[name].file}`);
    if (!media) return undefined;
    media.preload = "auto";
    const voice = { media };
    const voices = this.pools.get(name) ?? [];
    voices.push(voice);
    this.pools.set(name, voices);
    return voice;
  }

  private makeLoop(path: string, gain: number): LoopChannel {
    const media = this.create(path);
    if (media) {
      media.preload = "auto";
      media.loop = true;
      media.volume = 0;
    }
    return { media, gain, target: 0 };
  }

  private makeMusic(path: string): AudioHandle | null {
    const media = this.create(path);
    if (!media) return null;
    media.preload = "auto";
    media.loop = true;
    media.volume = 0;
    return media;
  }

  private updateLoop(channel: LoopChannel, dt: number): void {
    const media = channel.media;
    if (!media) return;
    const master = this.preferences.muted ? 0 : this.preferences.sfx;
    const target = channel.target * master;
    const blend = Math.min(1, dt * 7);
    media.volume += (target - media.volume) * blend;
    if (target > 0.002 && this.unlocked && media.paused) safePlay(media);
    if (target <= 0.002 && media.volume <= 0.004) stop(media);
  }

  private setLoop(channel: LoopChannel, target: number, immediate = false): void {
    channel.target = target;
    if (immediate && channel.media) {
      channel.media.volume = 0;
      stop(channel.media);
    }
  }

  private updateWatchdog(dt: number, pressure: number): void {
    if (pressure <= 0) {
      this.watchdogCountdown = 0;
      return;
    }
    this.watchdogCountdown -= dt;
    if (this.watchdogCountdown > 0) return;
    this.play("watchdogWarning", 0.72 + pressure * 0.28, 0.93 + pressure * 0.07);
    this.watchdogCountdown = 3.6 + (1.05 - 3.6) * pressure;
  }

  private updateObjectiveCharge(dt: number, audible: boolean, state: AudioFrameState): void {
    const media = this.objectiveCharge;
    if (!media) return;
    const progress = clamp01(state.objectiveProgress);
    const charging = audible && state.objectiveCharging && progress < 1;
    if (!charging) {
      if (this.wasObjectiveCharging || !media.paused) stop(media);
      this.wasObjectiveCharging = false;
      return;
    }

    if (!this.wasObjectiveCharging) {
      media.currentTime = progress * OBJECTIVE_CHARGE_SECONDS;
      media.playbackRate = OBJECTIVE_CHARGE_SECONDS / Math.max(0.1, state.objectiveDuration);
      media.volume = 0;
      safePlay(media);
    } else if (media.paused) {
      safePlay(media);
    }
    const target = (0.13 + progress * 0.22) * this.preferences.sfx;
    media.volume += (target - media.volume) * Math.min(1, dt * 10);
    this.wasObjectiveCharging = true;
  }

  private updateMusic(dt: number, tension: number): void {
    if (!this.normalMusic) return;
    const targetMix = this.tensionMusic ? tension : 0;
    this.musicMix += (targetMix - this.musicMix) * Math.min(1, dt * 0.65);
    this.applyVolumes();
    if (!this.unlocked || this.suspended || this.preferences.muted) return;
    if (this.normalMusic.paused) safePlay(this.normalMusic);
    if (this.tensionMusic && this.tensionMusic.paused) safePlay(this.tensionMusic);
  }

  private applyVolumes(): void {
    const master = this.preferences.muted ? 0 : this.preferences.music;
    if (this.normalMusic) this.normalMusic.volume = master * (1 - this.musicMix * 0.78);
    if (this.tensionMusic) this.tensionMusic.volume = master * this.musicMix * 0.9;
    if (this.completeSting) this.completeSting.volume = this.completeVolume();
    if (this.reel.media) this.reel.media.volume = this.preferences.muted ? 0 : this.reel.media.volume;
    if (this.scanner.media)
      this.scanner.media.volume = this.preferences.muted ? 0 : this.scanner.media.volume;
  }

  private pauseAll(): void {
    stop(this.normalMusic, false);
    stop(this.tensionMusic, false);
    stop(this.completeSting, false);
    stop(this.reel.media, false);
    stop(this.scanner.media, false);
    stop(this.objectiveCharge, false);
    for (const voices of this.pools.values()) for (const voice of voices) stop(voice.media);
  }

  private resumeMusic(): void {
    if (!this.unlocked || this.suspended || this.preferences.muted || !this.activeLevel) return;
    if (this.normalMusic) safePlay(this.normalMusic);
    if (this.tensionMusic) safePlay(this.tensionMusic);
  }

  private completeVolume(): number {
    if (this.preferences.muted) return 0;
    // Completion is feedback as well as music: keep it clear when a player
    // turns the background score down but still wants gameplay sounds.
    return clamp01(Math.max(this.preferences.music * 0.95, this.preferences.sfx * 0.82));
  }
}
