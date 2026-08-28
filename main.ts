// Browser entry point. Everything the game needs is loaded at runtime from
// `web_game_data/index.json`; nothing here parses a binary.
import { Game } from "./src/game.ts";

const host = document.querySelector<HTMLElement>("#app");
const canvas = document.querySelector<HTMLCanvasElement>("#stage");

declare global {
  // Exposed so the headless browser check can read live state and drive input.
  // eslint-disable-next-line no-var
  var binaryNinja: Game | undefined;
}

if (host && canvas) {
  const game = new Game(host, canvas);
  globalThis.binaryNinja = game;
  void game.boot();
}
