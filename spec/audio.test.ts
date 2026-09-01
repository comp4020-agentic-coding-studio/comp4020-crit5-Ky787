// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  AudioManager,
  DEFAULT_AUDIO_PREFERENCES,
  LEVEL_MUSIC,
} from "../src/audio/audio-manager.ts";
import type { AudioHandle } from "../src/audio/audio-manager.ts";
import { AudioSettings } from "../src/ui/audio-settings.ts";

class FakeAudio implements AudioHandle {
  preload = "";
  loop = false;
  volume = 1;
  currentTime = 0;
  playbackRate = 1;
  paused = true;
  ended = false;
  plays = 0;
  pauses = 0;

  constructor(readonly src: string) {}

  play(): void {
    this.paused = false;
    this.ended = false;
    this.plays += 1;
  }

  pause(): void {
    this.paused = true;
    this.pauses += 1;
  }
}

function harness(saved: string | null = null): {
  manager: AudioManager;
  media: FakeAudio[];
  writes: string[];
} {
  const media: FakeAudio[] = [];
  const writes: string[] = [];
  const manager = new AudioManager({
    baseUrl: "/audio/",
    factory: (src) => {
      const audio = new FakeAudio(src);
      media.push(audio);
      return audio;
    },
    storage: {
      getItem: () => saved,
      setItem: (_key, value) => writes.push(value),
    },
  });
  return { manager, media, writes };
}

const frame = {
  active: true,
  alive: true,
  reeling: false,
  scannerProximity: 0,
  firewallClosed: [] as boolean[],
  watchdogPressure: 0,
  tension: 0,
};

describe("AudioManager", () => {
  it("assigns a distinct background track to every level", () => {
    const tracks = Object.values(LEVEL_MUSIC).map((plan) => plan.normal);
    expect(tracks).toHaveLength(8);
    expect(new Set(tracks).size).toBe(8);
  });

  it("loads safe defaults and persists clamped music, SFX and mute settings", () => {
    const { manager, writes } = harness();
    expect(manager.getPreferences()).toEqual(DEFAULT_AUDIO_PREFERENCES);

    manager.setPreferences({ music: 2, sfx: -1, muted: true });
    expect(manager.getPreferences()).toEqual({ music: 1, sfx: 0, muted: true });
    expect(JSON.parse(writes.at(-1)!)).toEqual({ music: 1, sfx: 0, muted: true });
  });

  it("keeps reel and scanner loops singular and stops them on reset", () => {
    const { manager, media } = harness();
    manager.startLevel("level03");
    manager.unlock();
    manager.update(1 / 60, { ...frame, reeling: true, scannerProximity: 0.8 });
    manager.update(1 / 60, { ...frame, reeling: true, scannerProximity: 0.8 });

    const reel = media.filter((audio) => audio.src.includes("grapple-reel.ogg"));
    const scanner = media.filter((audio) => audio.src.includes("scanner-loop.ogg"));
    expect(reel).toHaveLength(1);
    expect(scanner).toHaveLength(1);
    expect(reel[0].plays).toBe(1);
    expect(scanner[0].plays).toBe(1);

    manager.resetTransient();
    expect(reel[0].paused).toBe(true);
    expect(scanner[0].paused).toBe(true);
    expect(manager.snapshot()).toMatchObject({ reelPlaying: false, scannerPlaying: false });
  });

  it("uses update-driven watchdog pulses and increases their frequency with pressure", () => {
    const { manager, media } = harness();
    manager.startLevel("level04");
    manager.unlock();
    const alarm = media.find((audio) => audio.src.includes("watchdog-warning.ogg"))!;

    manager.update(0.1, { ...frame, watchdogPressure: 1, tension: 1 });
    expect(alarm.plays).toBe(1);
    for (let i = 0; i < 8; i += 1) manager.update(0.1, { ...frame, watchdogPressure: 1, tension: 1 });
    expect(alarm.plays).toBe(1);
    for (let i = 0; i < 4; i += 1) manager.update(0.1, { ...frame, watchdogPressure: 1, tension: 1 });
    expect(alarm.plays).toBe(2);

    manager.update(0.1, frame);
    expect(manager.snapshot()).toMatchObject({ watchdogCountdown: 0 });
  });

  it("stops old music and loops when changing levels or muting", () => {
    const { manager, media } = harness();
    manager.startLevel("level01");
    manager.unlock();
    manager.update(0.2, { ...frame, reeling: true });
    const firstMusic = media.find((audio) => audio.src.includes(LEVEL_MUSIC.level01.normal))!;
    expect(firstMusic.paused).toBe(false);

    manager.startLevel("level05");
    expect(firstMusic.paused).toBe(true);
    const airy = media.find((audio) => audio.src.includes(LEVEL_MUSIC.level05.normal))!;
    expect(airy.paused).toBe(false);

    manager.setPreferences({ muted: true });
    expect(airy.paused).toBe(true);
    expect(manager.snapshot()).toMatchObject({ reelPlaying: false, scannerPlaying: false });
  });

  it("does not restart ambient music underneath the completion sting", () => {
    const { manager, media } = harness();
    manager.startLevel("level08");
    manager.unlock();
    const ambient = media.find((audio) => audio.src.includes(LEVEL_MUSIC.level08.normal))!;

    manager.complete();
    manager.update(1 / 60, { ...frame, active: false, alive: false });

    expect(ambient.paused).toBe(true);
    const complete = media.find((audio) => audio.src.includes("level-complete.ogg"))!;
    expect(complete.paused).toBe(false);
    expect(complete.volume).toBeCloseTo(DEFAULT_AUDIO_PREFERENCES.sfx * 0.82);
  });

  it("stays inert when every media asset fails to initialise", () => {
    const manager = new AudioManager({ factory: () => null, storage: null, baseUrl: "/audio/" });
    expect(() => {
      manager.startLevel("level08");
      manager.unlock();
      manager.play("grappleFire");
      manager.update(1, { ...frame, scannerProximity: 1, watchdogPressure: 1, tension: 1 });
      manager.complete();
      manager.stopLevel();
    }).not.toThrow();
  });
});

describe("AudioSettings", () => {
  it("keeps both volume sliders and mute in sync with persisted preferences", () => {
    document.body.innerHTML = `
      <input data-audio-music type="range"><output data-audio-music-value></output>
      <input data-audio-sfx type="range"><output data-audio-sfx-value></output>
      <input data-audio-mute type="checkbox">
    `;
    const { manager } = harness();
    new AudioSettings(document, manager);
    const music = document.querySelector<HTMLInputElement>("[data-audio-music]")!;
    const sfx = document.querySelector<HTMLInputElement>("[data-audio-sfx]")!;
    const mute = document.querySelector<HTMLInputElement>("[data-audio-mute]")!;

    expect(music.value).toBe("35");
    expect(sfx.value).toBe("68");
    music.value = "22";
    music.dispatchEvent(new Event("input"));
    mute.checked = true;
    mute.dispatchEvent(new Event("change"));

    expect(manager.getPreferences()).toMatchObject({ music: 0.22, sfx: 0.68, muted: true });
    expect(document.querySelector<HTMLOutputElement>("[data-audio-music-value]")!.value).toBe(
      "22%",
    );
  });
});
