import type { AudioManager, AudioPreferences } from "../audio/audio-manager.ts";

/** Binds the native settings dialog to the central audio preferences. */
export class AudioSettings {
  private readonly music: HTMLInputElement | null;
  private readonly sfx: HTMLInputElement | null;
  private readonly mute: HTMLInputElement | null;
  private readonly musicValue: HTMLOutputElement | null;
  private readonly sfxValue: HTMLOutputElement | null;

  constructor(root: ParentNode, audio: AudioManager) {
    this.music = root.querySelector<HTMLInputElement>("[data-audio-music]");
    this.sfx = root.querySelector<HTMLInputElement>("[data-audio-sfx]");
    this.mute = root.querySelector<HTMLInputElement>("[data-audio-mute]");
    this.musicValue = root.querySelector<HTMLOutputElement>("[data-audio-music-value]");
    this.sfxValue = root.querySelector<HTMLOutputElement>("[data-audio-sfx-value]");

    this.music?.addEventListener("input", () => audio.setPreferences({ music: this.number(this.music) }));
    this.sfx?.addEventListener("input", () => audio.setPreferences({ sfx: this.number(this.sfx) }));
    this.mute?.addEventListener("change", () => audio.setPreferences({ muted: this.mute?.checked }));
    audio.subscribe((preferences) => this.sync(preferences));
  }

  private number(input: HTMLInputElement | null): number {
    return Number(input?.value ?? 0) / 100;
  }

  private sync(preferences: AudioPreferences): void {
    const music = String(Math.round(preferences.music * 100));
    const sfx = String(Math.round(preferences.sfx * 100));
    if (this.music) this.music.value = music;
    if (this.sfx) this.sfx.value = sfx;
    if (this.mute) this.mute.checked = preferences.muted;
    if (this.musicValue) this.musicValue.value = `${music}%`;
    if (this.sfxValue) this.sfxValue.value = `${sfx}%`;
  }
}
