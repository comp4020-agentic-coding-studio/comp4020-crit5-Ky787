# Binary Ninja

Binary Ninja is a browser grappling platformer built from pre-generated analysis of real Hikari-obfuscated x86-64 programs.

## Data

Use `physical_level_delivery_v2/web_game_data/index.json` (schema version 2) as the browser dataset entry point. It carries all eight levels; the superseded `physical_level_delivery/` tree is kept for reference only and must not be loaded, built or tested against.

All paths in this file are relative to the repository root.

The supplied level data is authoritative for binary facts. Never invent or alter:

* assembly instructions
* addresses
* strings
* raw-block mappings
* CFG/provenance classifications
* chronological trace occurrences
* machine CFG truth (`machine_truth`)
* richness features

A physical platform may represent multiple raw blocks or a chronological occurrence of a logical node. Do not describe every platform as literally one basic block.

Only supplied strongly proven Hikari bogus/crumble objects may use the crumble mechanic. Never infer `not executed == bogus`.

Levels 5 and 8 intentionally have encrypted strings. Do not invent plaintext strings for their player-facing code.

`grapple_links` are physical gameplay reachability only. They never assert a machine CFG edge, and the two layers must stay separate in the code and in the debug overlay.

Physical coordinates are first-pass gameplay layout data and may be tuned when necessary without changing their binary mappings.

## Architecture

Keep the game data-driven. All eight levels must use the same engine.

Keep these separate:

* binary/source facts
* physical platform layout
* gameplay/hazard behaviour
* rendering/UI

Do not hard-code raw addresses or individual level routes into engine logic.

Semantic event types should drive reusable mechanics such as firewall, scanner, watchdog and transfer behaviour.

Keep movement, grapple, camera and hazard tuning values centralized.

## Gameplay

Prioritise responsive movement and satisfying grapple/swing physics over decorative polish.

The successful route must never require a crumble platform, and no required step may be left with a crumble platform as its only way across. Crumble platforms should still be tempting: shortcuts, stepping stones, anchors and recovery ledges near the route are intended, not a bug.

Death should respawn at the latest checkpoint without reloading the webpage.

Preserve a lightweight developer/debug overlay for inspecting level geometry, links and event placement.

## Development

Inspect existing code before replacing it.

Prefer small coherent changes over unnecessary rewrites.

Reuse the current project stack unless there is a strong technical reason not to.

Run relevant tests/type checks and the production build after substantial changes.

Do not weaken existing deployment checks to hide failures.

