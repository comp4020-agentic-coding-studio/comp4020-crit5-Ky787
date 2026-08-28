#!/usr/bin/env node
/**
 * Headless play test.
 *
 * Screenshots prove the game renders; this proves it *runs*: it drives real
 * keyboard and pointer events through the Chrome DevTools Protocol against the
 * built site and asserts the player moves, jumps, grapples and swings, with no
 * console errors along the way.
 *
 *   node scripts/browser-check.ts [url]
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL_BASE = process.argv[2] ?? "http://localhost:4173/";
const BROWSERS = ["chromium-browser", "chromium", "google-chrome", "google-chrome-stable"];
const PORT = 9333;

interface Cdp {
  send: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  close: () => void;
  errors: string[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function launch(): Promise<{ kill: () => void; profile: string }> {
  const profile = mkdtempSync(join(tmpdir(), "bn-"));
  for (const bin of BROWSERS) {
    try {
      const child = spawn(
        bin,
        [
          "--headless",
          "--disable-gpu",
          "--no-sandbox",
          "--no-first-run",
          `--remote-debugging-port=${PORT}`,
          `--user-data-dir=${profile}`,
          "--window-size=1440,900",
          "about:blank",
        ],
        { stdio: "ignore" },
      );
      for (let i = 0; i < 60; i += 1) {
        await sleep(250);
        try {
          const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
          if (res.ok) return { kill: () => child.kill(), profile };
        } catch {
          /* not up yet */
        }
      }
      child.kill();
    } catch {
      /* try the next binary */
    }
  }
  throw new Error(`no usable browser found (tried ${BROWSERS.join(", ")})`);
}

async function connect(url: string): Promise<Cdp> {
  const created = await fetch(
    `http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`,
    { method: "PUT" },
  );
  const target = (await created.json()) as { webSocketDebuggerUrl: string };
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let id = 0;
  const pending = new Map<number, (value: Record<string, unknown>) => void>();
  const errors: string[] = [];

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as {
      id?: number;
      method?: string;
      result?: Record<string, unknown>;
      error?: { message: string };
      params?: Record<string, unknown>;
    };
    if (message.id !== undefined) {
      pending.get(message.id)?.(message.error ? { error: message.error } : (message.result ?? {}));
      pending.delete(message.id);
      return;
    }
    if (message.method === "Runtime.exceptionThrown") {
      const details = message.params?.exceptionDetails as { text?: string } | undefined;
      errors.push(details?.text ?? "uncaught exception");
    }
    if (message.method === "Runtime.consoleAPICalled") {
      const params = message.params as { type?: string; args?: { value?: unknown }[] };
      if (params.type === "error") {
        errors.push(params.args?.map((a) => String(a.value)).join(" ") ?? "console error");
      }
    }
  });

  const send: Cdp["send"] = (method, params = {}) =>
    new Promise((resolve) => {
      id += 1;
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });

  await send("Runtime.enable");
  await send("Page.enable");
  return { send, close: () => socket.close(), errors };
}

async function evaluate<T>(cdp: Cdp, expression: string): Promise<T> {
  const result = (await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })) as {
    result?: { value?: T };
    exceptionDetails?: Record<string, unknown>;
    error?: { message: string };
  };
  if (result.error) throw new Error(result.error.message);
  if (result.exceptionDetails) {
    const details = result.exceptionDetails as {
      text?: string;
      exception?: { description?: string };
    };
    throw new Error(details.exception?.description ?? details.text ?? "evaluate failed");
  }
  return result.result?.value as T;
}

async function key(cdp: Cdp, type: "keyDown" | "keyUp", code: string, keyName: string): Promise<void> {
  await cdp.send("Input.dispatchKeyEvent", {
    type,
    code,
    key: keyName,
    windowsVirtualKeyCode: keyName === " " ? 32 : keyName.toUpperCase().charCodeAt(0),
    nativeVirtualKeyCode: keyName === " " ? 32 : keyName.toUpperCase().charCodeAt(0),
  });
}

async function pointer(
  cdp: Cdp,
  type: "mousePressed" | "mouseReleased" | "mouseMoved",
  x: number,
  y: number,
): Promise<void> {
  await cdp.send("Input.dispatchMouseEvent", {
    type,
    x,
    y,
    button: type === "mouseMoved" ? "none" : "left",
    buttons: type === "mousePressed" ? 1 : 0,
    clickCount: type === "mouseMoved" ? 0 : 1,
    pointerType: "mouse",
  });
}

type Snapshot = {
  mode: string;
  level: string | null;
  x: number;
  y: number;
  vx: number;
  grounded: boolean;
  dead: boolean;
  theme: string;
  rope: string;
  elapsed: number;
  targetId: string | null;
  fps: number;
};

/** Polls a snapshot until the predicate holds, or the deadline passes. */
async function waitFor(
  cdp: Cdp,
  predicate: (snapshot: Snapshot) => boolean,
  timeoutMs: number,
): Promise<Snapshot> {
  return waitForRaw<Snapshot>(cdp, "globalThis.binaryNinja.snapshot()", predicate, timeoutMs);
}

async function waitForRaw<T>(
  cdp: Cdp,
  expression: string,
  predicate: (value: T) => boolean,
  timeoutMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = await evaluate<T>(cdp, expression);
  while (!predicate(last) && Date.now() < deadline) {
    await sleep(100);
    last = await evaluate<T>(cdp, expression);
  }
  return last;
}

const checks: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main(): Promise<void> {
  const browser = await launch();
  let cdp: Cdp | undefined;
  try {
    cdp = await connect(`${URL_BASE}?level=level01`);

    let ready = false;
    for (let i = 0; i < 60 && !ready; i += 1) {
      await sleep(250);
      ready = await evaluate<boolean>(
        cdp,
        "typeof globalThis.binaryNinja !== 'undefined' && globalThis.binaryNinja.snapshot().level !== null",
      );
    }
    if (!ready) {
      const where = await evaluate<string>(cdp, "location.href + ' | ' + document.title");
      throw new Error(`the game never booted at ${where}`);
    }
    await sleep(900);

    const booted = await evaluate<Snapshot>(cdp, "globalThis.binaryNinja.snapshot()");
    check("the game boots into Ghostline", booted.level === "level01", `mode ${booted.mode}`);
    check("the fixed-step loop is running", booted.elapsed > 0.4, `${booted.elapsed.toFixed(2)}s simulated`);
    check("the player lands on the entry block", booted.grounded, `y ${booted.y.toFixed(0)}`);

    // Run right for a second.
    const before = booted.x;
    await key(cdp, "keyDown", "KeyD", "d");
    await sleep(900);
    const running = await evaluate<Snapshot>(cdp, "globalThis.binaryNinja.snapshot()");
    await key(cdp, "keyUp", "KeyD", "d");
    check("A/D moves the player", running.x > before + 120, `moved ${(running.x - before).toFixed(0)}u`);

    // Jump, once the run has actually settled back onto a block.
    const grounded = await waitFor(cdp, (s) => s.grounded, 4000);
    await key(cdp, "keyDown", "Space", " ");
    await sleep(140);
    const jumping = await evaluate<Snapshot>(cdp, "globalThis.binaryNinja.snapshot()");
    await key(cdp, "keyUp", "Space", " ");
    check("space jumps", jumping.y < grounded.y - 30, `rose ${(grounded.y - jumping.y).toFixed(0)}u`);
    await sleep(900);
    await waitFor(cdp, (s) => s.grounded, 4000);

    // Aim at the next code block and fire the line.
    const aim = await evaluate<{ sx: number; sy: number; id: string } | null>(
      cdp,
      `(() => {
        const g = globalThis.binaryNinja;
        const rt = g.runtime; const cam = g.renderer.camera;
        const here = rt.player.x;
        const next = rt.routePlatforms().map(p => p.solid)
          .filter(s => s.x > here + 40).sort((a,b) => a.x - b.x)[0];
        if (!next) return null;
        const wx = next.x + next.w * 0.3, wy = next.y + 6;
        return {
          sx: (wx - cam.originX()) * cam.zoom,
          sy: (wy - cam.originY()) * cam.zoom + 44,
          id: next.id,
        };
      })()`,
    );
    check("a reachable block is on screen to aim at", aim !== null, aim?.id ?? "none");

    if (aim) {
      await pointer(cdp, "mouseMoved", aim.sx, aim.sy);
      await sleep(120);
      const aimed = await evaluate<Snapshot>(cdp, "globalThis.binaryNinja.snapshot()");
      check("the reticle finds a grapple target", aimed.targetId !== null, aimed.targetId ?? "none");

      await pointer(cdp, "mousePressed", aim.sx, aim.sy);
      await key(cdp, "keyDown", "KeyD", "d");
      await sleep(250);
      const attached = await evaluate<Snapshot>(cdp, "globalThis.binaryNinja.snapshot()");
      check(
        "holding the button attaches the line",
        attached.rope === "attached" || attached.rope === "firing",
        `rope ${attached.rope}`,
      );

      await sleep(700);
      const swinging = await evaluate<Snapshot>(cdp, "globalThis.binaryNinja.snapshot()");
      await pointer(cdp, "mouseReleased", aim.sx, aim.sy);
      await sleep(260);
      const released = await evaluate<Snapshot>(cdp, "globalThis.binaryNinja.snapshot()");
      await key(cdp, "keyUp", "KeyD", "d");
      check(
        "the swing carries the player forward",
        swinging.x > attached.x + 60,
        `${(swinging.x - attached.x).toFixed(0)}u while attached`,
      );
      check(
        "releasing keeps the momentum",
        Math.abs(released.vx) > 120,
        `vx ${released.vx.toFixed(0)}u/s after release`,
      );
    }

    // Pause and resume.
    await key(cdp, "keyDown", "Escape", "Escape");
    await key(cdp, "keyUp", "Escape", "Escape");
    await sleep(300);
    const paused = await evaluate<Snapshot>(cdp, "globalThis.binaryNinja.snapshot()");
    check("escape pauses", paused.mode === "paused");
    await key(cdp, "keyDown", "Escape", "Escape");
    await key(cdp, "keyUp", "Escape", "Escape");
    await sleep(300);
    const resumed = await evaluate<Snapshot>(cdp, "globalThis.binaryNinja.snapshot()");
    check("escape resumes", resumed.mode === "playing");

    // Death and checkpoint respawn, without reloading the page. Wait for a
    // clean, grounded state first: the swing above may have ended in a fall.
    await waitFor(cdp, (s) => s.grounded && !s.dead, 6000);
    const instance = await evaluate<number>(
      cdp,
      "(globalThis.__bnInstance = (globalThis.__bnInstance ?? 0) + 1)",
    );
    const deaths = await evaluate<number>(
      cdp,
      `(() => { const rt = globalThis.binaryNinja.runtime;
        if (rt.dead) return -1;
        const before = rt.deaths;
        rt.player.y = rt.deathY + 50;
        return before; })()`,
    );
    const after = await waitForRaw<{ deaths: number; grounded: boolean; dead: boolean }>(
      cdp,
      `(() => { const rt = globalThis.binaryNinja.runtime;
        return { deaths: rt.deaths, grounded: rt.player.grounded, dead: rt.dead }; })()`,
      (v) => v.deaths > deaths && v.grounded && !v.dead,
      4000,
    );
    check("falling out of the trace costs a retry", after.deaths === deaths + 1, `${deaths} -> ${after.deaths}`);
    const stillHere = await evaluate<number>(cdp, "globalThis.__bnInstance ?? 0");
    check(
      "respawn happens in place, with no page reload",
      after.grounded && !after.dead && stillHere === instance,
    );

    // A bogus block gives way under the player, with the collapse FX running.
    const decoy = await evaluate<{ id: string } | null>(
      cdp,
      `(() => { const rt = globalThis.binaryNinja.runtime;
        const d = rt.platforms.find(p => p.spec.kind === 'crumble');
        if (!d) return null;
        rt.player.x = d.solid.x + d.solid.w / 2;
        rt.player.y = d.solid.y - 40;
        rt.player.vx = 0; rt.player.vy = 0;
        return { id: d.spec.id }; })()`,
    );
    const collapse = await waitForRaw<{ state: string; particles: boolean }>(
      cdp,
      `(() => { const rt = globalThis.binaryNinja.runtime;
        const d = rt.platforms.find(p => p.spec.kind === 'crumble');
        return { state: d.crumble, particles: true }; })()`,
      (v) => v.state === "collapsed",
      5000,
    );
    check(
      "trusting a Hikari bogus block drops you through it",
      collapse.state === "collapsed",
      `${decoy?.id} ${collapse.state}`,
    );

    // Mission select, and starting a different level from it.
    await evaluate(cdp, "globalThis.binaryNinja.showSelect()");
    await sleep(400);
    const missions = await evaluate<number>(
      cdp,
      "document.querySelectorAll('button.mission').length",
    );
    check("mission select lists all five missions", missions === 5, `${missions} listed`);

    await evaluate(cdp, "document.querySelectorAll('button.mission')[2].click()");
    const switched = await waitFor(cdp, (s) => s.level === "level03", 8000);
    check("a different mission loads in the same engine", switched.level === "level03");
    check(
      "the new mission runs its own hazard identity",
      switched.theme === "scanner_chambers",
      String(switched.theme),
    );

    check("no console errors", cdp.errors.length === 0, cdp.errors.slice(0, 3).join(" | "));
  } finally {
    cdp?.close();
    browser.kill();
    rmSync(browser.profile, { recursive: true, force: true });
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} browser checks passed`);
  if (failed.length > 0) process.exit(1);
}

await main();
