# Binary Ninja

A browser grappling platformer whose levels are five real, Hikari-obfuscated
x86-64 programs. You play a reverse-engineer swinging between floating blocks of
actual disassembly, following a program's execution trace from its entry block
to the end of the run — while the obfuscator's fake control flow crumbles under
anyone who trusts it.

**Swing through the control flow of an obfuscated binary without trusting fake
code.**

## Playing it

```text
A / D            move
Space            jump — or let go of the line with a kick
Mouse            aim
Left click       hold to grapple, release to let go (fires hit or miss)
W / right click  reel the line in
S                pay line out, or drop through a block
R                restart at the last checkpoint
Esc              pause
F1               analysis overlay
```

`?level=level03` deep-links a mission; `?analysis=1` opens the overlay on load.

**How to play** and **About the data** in the top bar open as dialogs rather
than pages, so reading either mid-mission suspends the run instead of throwing
it away.

## The five missions

| # | Mission | Identity |
|---|---------|----------|
| 01 | **Ghostline** | Tutorial. Hops, then swings, then your first bogus block. |
| 02 | **Firewall** | A climb through gated tiers; firewall and identity gates pulse open. |
| 03 | **Sweep** | Scanner chambers — a timing gauntlet of sweeping detection beams. |
| 04 | **Watchdog** | Forward pressure: a detection wall advances from behind. |
| 05 | **Blackout** | Everything at once, and a binary whose strings are encrypted. |

All five run on one data-driven engine. The differences come from the dataset's
own semantic call sites plus a theme profile — no level-specific game code, and
no addresses anywhere in gameplay logic.

## Where the levels come from

`physical_level_delivery/` is a completed handoff from an offline
binary-analysis pipeline. The browser entry point is
`web_game_data/index.json`; the build serves and ships that folder as-is, so
there is exactly one copy of the authoritative data. The page never parses a PE
file, LLVM IR, a CFG or an emulator trace.

The rules the game holds itself to are spelled out in the **About the data**
dialog in the top bar, and enforced by the spec:

- addresses, instructions, raw-block mappings, strings and Hikari provenance are
  reproduced verbatim, never invented;
- a visible block is a chronological instance of a compact gameplay node, and
  usually stands for several machine basic blocks — the inspector says so and
  shows the real count;
- only blocks classified `obfuscator_bogus` / `hikari_alteredBB` with strong
  confidence can crumble, and no successful route ever needs one;
- Blackout ships no plaintext strings, and the game does not put any back.

### Layout is tuned; mappings are not

The delivered coordinates passed an abstract reachability check that was
explicitly *not* a rope-physics simulation, and at their supplied spacing the
platforms very nearly form a continuous walkway — a grappling hook would have
nothing to do. `src/data/tuning.ts` widens the horizontal gaps between route
platforms with a deterministic, monotone transform before play. It touches `x`
and the derived link distances, and nothing else: every `y`, width, id, mapping,
code payload and provenance record survives untouched, and the spec asserts it.
The analysis overlay reports the tuned and delivered link distances side by side.

## Development

```sh
mise install
pnpm install
pnpm dev              # local dev server
pnpm check            # typecheck, production build, and the spec
pnpm check:evidence   # process-evidence gate CI runs before shipping
pnpm route-report     # drive the real physics over all five routes
pnpm check:browser    # play test the built site in headless Chrome
```

`pnpm route-report` and `pnpm check:browser` are local tools rather than CI
gates: the first is a tuning aid, and the second needs a browser on the machine.

### How the routes are proven playable

The offline validator said what it was: a graph simulator, not a rope-physics
engine. `src/engine/traversal.ts` closes that gap. It drives the game's own
fixed-step physics with scripted input, searching a small space of jumps and
grapple plans for one that lands a hop, and then plays whole levels end to end —
planning each hop from the player's actual state, replaying it against a live
`LevelRuntime`, and dying and retrying from checkpoints like a person would.
`spec/traversal.test.ts` runs that over all five levels with every crumble block
removed, so "the route never needs a bogus block" is a test, not a claim.

### Layout

```text
src/data/      dataset types, loading, and the layout tuning pass
src/engine/    fixed-step physics, rope, hazards, level runtime, traversal solver
src/render/    canvas renderer, camera, cached code panels, particles
src/ui/        HUD, code inspector, screens, analysis overlay, input
spec/          the checks: dataset contracts, engine behaviour, traversal, UI
```

Binary facts, physical layout, gameplay behaviour and presentation are kept in
separate layers, and every movement, camera and hazard constant lives in
`src/engine/constants.ts`.
