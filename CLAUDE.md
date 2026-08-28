# Binary Ninja

Binary Ninja is a browser grappling platformer built from pre-generated analysis of real Hikari-obfuscated x86-64 programs.

## Data

Use `physical_level_delivery/web_game_data/index.json` as the browser dataset entry point.

The workspace folder is /home/ky/Documents/ANU/2026 Semester 2/COMP8020 - Agentic Coding Studio/comp4020-crit5-Ky787

The supplied level data is authoritative for binary facts. Never invent or alter:

* assembly instructions
* addresses
* strings
* raw-block mappings
* CFG/provenance classifications

A physical platform may represent multiple raw blocks or a chronological occurrence of a logical node. Do not describe every platform as literally one basic block.

Only supplied strongly proven Hikari bogus/crumble objects may use the crumble mechanic. Never infer `not executed == bogus`.

Level 5 intentionally has encrypted strings. Do not invent plaintext strings for its player-facing code.

Physical coordinates are first-pass gameplay layout data and may be tuned when necessary without changing their binary mappings.

## Architecture

Keep the game data-driven. All five levels must use the same engine.

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

The successful route must never require a crumble platform.

Death should respawn at the latest checkpoint without reloading the webpage.

Preserve a lightweight developer/debug overlay for inspecting level geometry, links and event placement.

## Development

Inspect existing code before replacing it.

Prefer small coherent changes over unnecessary rewrites.

Reuse the current project stack unless there is a strong technical reason not to.

Run relevant tests/type checks and the production build after substantial changes.

Do not weaken existing deployment checks to hide failures.

