# Process overview

## What I built

**Binary Ninja** — a browser grappling platformer whose eight levels are eight
real, Hikari-obfuscated x86-64 programs. The player swings between floating
blocks of actual disassembly, following each program's execution trace from its
entry block to the end of the run, while the obfuscator's invented control flow
crumbles under anyone who trusts it. The whole game is one data-driven engine
reading the delivered `web_game_data/index.json`; the eight levels differ
because their semantic call sites and theme profiles differ, not because any of
them has its own code.

The moments below were written against the first five-level delivery. The
schema-2 delivery that superseded it added Relay, Quarantine and Root, and the
notes in `README.md` describe how the loader, the layout tuning and the
traversal solver changed to take them.

## The moments that mattered

### 1. The handoff told me what it hadn't checked, so I checked it

The delivery report classified all five levels **READY FOR FRONTEND**, and also
said, in one line, that its validator was "intentionally not a rope-physics
engine". Measuring the geometry made the gap concrete: consecutive route
platforms sit 15–260 units apart while being 112–240 units wide. Reachable, yes
— and effectively a continuous walkway, with nothing for a grappling hook to do.

The obvious move was to pick a side: ship the coordinates and accept a
platformer where the hook is decoration, or redraw the layouts and quietly lose
the provenance. I did neither. Binary facts and physical layout are different
kinds of claim, and the handoff says so itself — mappings are authoritative,
coordinates are a first-pass layout. So the coordinates became a tunable layer
with a deterministic monotone transform, and the *tests* hold the line: every
id, occurrence, raw-block mapping, code payload, provenance record and `y` value
is asserted unchanged through it, and required links are asserted to stay under
the dataset's own 600-unit design limit.

I knew it was right because `pnpm route-report` went from *every gap jumpable*
to a measured mix — Ghostline 5 hops and 13 swings, Blackout 1 and 38 — with no
unreachable hop anywhere, and because `spec/dataset.test.ts` fails loudly if the
transform ever touches a binary fact.

[`0beb921`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-Ky787/commit/0beb921)

### 2. I built the thing that plays the game before I tuned the game

I could not tell whether a grapple felt good by looking at a screenshot, and I
could not tell whether a level was completable by reading coordinates. So
`src/engine/traversal.ts` drives the *real* fixed-step physics with scripted
input, searching a small space of jump and grapple plans for one that lands each
hop, then plays whole levels end to end — planning from the player's actual
state, replaying against a live `LevelRuntime`, dying and retrying from
checkpoints like a person would.

That instrument found three things no screenshot would have: the jump was strong
enough to clear every gap and make the hook pointless; the reel-in repositioned
the player without imparting velocity, so letting go dropped you instead of
launching you; and landings that clipped a block's lip slid straight back off, so
"landed" had to mean *comes to rest on the block*, not *touched it*. Each fix
came with the measurement that justified it.

It also turned the strongest claim in the brief into a check rather than a
promise: all five routes complete with **every crumble block removed from the
world**.

[`c15d983...e30f1c9`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-Ky787/compare/c15d983...e30f1c9)

### 3. A hazard that stands on a checkpoint is not a hazard, it's a bug

Writing the fairness test — "no hazard may kill the player at a spawn or
checkpoint, at any phase of its cycle" — failed immediately on a Sweep beam whose
600-unit envelope covered a respawn point. The retry-shaped fix was to nudge
that beam. The harness-shaped fix was to make it structurally impossible: gates
and beams anchor to the *gap after* their call site rather than the foothold
itself, and spawn and checkpoint boxes became sanctuaries no hazard can kill
inside — which is also what the dataset's own `checkpoint` events mean when they
say "temporary safe location". The test now runs over all five levels and every
respawn point, holding the player there for longer than any hazard cycle.

[`c15d983`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-Ky787/commit/c15d983)

### 4. Rendering is not playing

The screenshots looked like a game well before it was one. To close that,
`scripts/browser-check.ts` drives the *built* site in headless Chrome over the
DevTools protocol with real key and pointer events, and asserts the things the
brief actually asks for: move, jump, aim, attach, swing forward, release with
momentum intact, pause and resume, fall and respawn without a page reload,
collapse a Hikari decoy, and switch missions from the select screen — with no
console errors. It caught that the hook was happily grabbing the block under the
player's own feet, which every headless test had missed because they all aimed
from a standing start at something far away.

It is a local tool, not a CI gate: it needs a browser on the machine, and I
would rather have an honest local instrument than a flaky required check.

[`e30f1c9`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-Ky787/commit/e30f1c9)

## Verification

`pnpm check` — typecheck, production build, 168 spec tests over the built site,
the dataset contracts, the engine mechanics and all five traversals.
`pnpm check:browser` — 19/19 in headless Chrome against `dist/`.
