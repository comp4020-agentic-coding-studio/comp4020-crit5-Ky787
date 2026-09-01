# Binary Ninja

A browser grappling platformer whose levels are eight real, Hikari-obfuscated
x86-64 programs. You play a reverse-engineer swinging between floating blocks of
actual disassembly, following a program's execution trace from its entry block
to the end of the run — while the obfuscator's fake control flow crumbles under
anyone who trusts it.

**Swing through the control flow of an obfuscated binary without trusting fake
code.**

## The eight missions

| # | Mission | Shape | Identity |
|---|---------|-------|----------|
| 01 | **Ghostline** | tutorial horizontal | Hops, then swings, then your first bogus block. |
| 02 | **Firewall** | gated mixed | Up and down through gated tiers; firewall and identity gates pulse open. |
| 03 | **Sweep** | scanner zig-zag | A timing gauntlet of sweeping detection beams. |
| 04 | **Watchdog** | pressure and momentum | Forward pressure: a detection wall advances from behind. |
| 05 | **Blackout** | mixed first finale | Every countermeasure at once, and a binary whose strings are encrypted. |
| 06 | **Relay** | long fork and reconvergence | Four semantic paths leave; they do not all come back. |
| 07 | **Quarantine** | vertical ascent | A 8,400-unit containment shaft. Nothing in it is jumpable. |
| 08 | **Root** | multi-phase finale | Access climb, scanner traversal, watchdog descent, routing, final ascent. |

All eight run on one data-driven engine. The differences come from the dataset's
own semantic call sites plus a theme profile — no level-specific game code, and
no addresses anywhere in gameplay logic. Each level ships 19–30 route blocks and
11–20 bogus decoys.

## Where the levels come from

`physical_level_delivery_v2/` is a completed handoff from an offline
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
  confidence can crumble, each mapping to exactly one machine block, and no
  successful route ever needs one — absence from the executed trace is never
  treated as evidence of anything;
- grapple links are *physical gameplay* reachability and never assert a machine
  CFG edge; the real CFG out of each bogus block is carried separately in
  `machine_truth`, and the analysis overlay draws the two as different layers;
- Blackout and Root ship no plaintext strings, and the game does not put any
  back.

### Layout is tuned; mappings are not

The delivered coordinates passed an abstract reachability check that was
explicitly *not* a rope-physics simulation, and at their supplied spacing
several levels very nearly form a continuous walkway — Ghostline is completable
with nothing but the jump button. `src/data/tuning.ts` widens the spacing
between consecutive route platforms with a deterministic transform before play.

It works on *route steps* rather than a global sorted `x` map, so a route that
doubles back — Quarantine's shaft, Root's climbs — goes through the same code as
one that runs left to right; and each step is widened only in proportion to how
horizontal it already is, so a climb stays a climb. Each decoy rides along on
the pair of route blocks the exporter authored it against, so a stepping stone
placed a third of the way to the next block stays a third of the way there.
Watchdog arrives already spaced for the rope and is left as delivered: widening
it measurably pulled the route out from under decoys placed to catch a shorter
hop.

It touches `x` and the derived link distances, and nothing else: every `y`,
width, id, mapping, trace occurrence, machine-CFG record, code payload and
provenance record survives untouched, and the spec asserts it field by field.
The analysis overlay reports the tuned and delivered coordinates side by side.

## Development

```sh
mise install
pnpm install
pnpm dev              # local dev server
pnpm check            # typecheck, production build, and the spec
pnpm check:evidence   # process-evidence gate CI runs before shipping
pnpm route-report     # drive the real physics over all eight routes
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
`spec/traversal.test.ts` runs that over all eight levels four ways — with the
decoys deleted, with them present, hop by hop, and from spawn to objective — so
"the route never needs a bogus block" is a test, not a claim: the run that
finishes must never have armed one.

It also measures the other half of that promise. A decoy is *meant* to be
tempting — an apparent shortcut, a stepping stone in a gap, an inviting anchor
overhead — but it must never be the only way across. `honestOptions()` stands
the player at five spots along each route block and counts how many have a plan
that never rests on a bogus block; the spec fails if any step drops to zero, and
`pnpm route-report` prints the worst step per level.

Hazards get their own guarantee: a beam or a gate is a timing problem, not a
wall, so the spec checks that every route platform has a window of at least 1.2
seconds in which standing on it is survivable.

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
