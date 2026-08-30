# Claude integration handoff

**READY FOR CLAUDE INTEGRATION**

This directory is the isolated final Levels 1–8 gameplay-data/export package and replaces the older `physical_level_delivery` dataset. Load `web_game_data/index.json`, then follow each entry's relative `path`. No frontend code was changed.

## Contract

- Schema version is `2`. Platform IDs, route order, raw block mappings, semantic event instances, provenance, binary/source hashes, and the bogus/legitimate classification are authoritative and immutable.
- Coordinates, widths, checkpoint tuning, and presentation styling may be tuned only if the movement contract and the full validator continue to pass.
- `grapple_links` are physical gameplay relationships. They deliberately do not assert machine CFG edges. A fake-choice link has `machine_cfg_edge_claimed: false`.
- Machine CFG truth for each crumble platform lives under `machine_truth`; direct executed-route adjacency is under `machine_adjacent_route_indices`.
- Every route platform contains chronological `trace_occurrences`, all compacted `logical_nodes`, and the complete ordered-deduplicated union of their `raw_blocks`. Repeated gameplay trace occurrences are preserved rather than collapsed out of existence.
- Every crumble platform maps to exactly one zero-execution, strong `hikari_alteredBB` block. Richness is a secondary ranking metric after provenance and direct adjacency.
- Assembly snippets are copied from actual mapped instructions. Blackout and Root have empty `display.strings` because STR is enabled.
- Required progression never uses crumble platforms. The validator removes all crumble platforms and proves the objective still reachable.

## Level identities

- Ghostline: tutorial horizontal, gentle readable choices.
- Firewall: gated mixed ascent/descent.
- Sweep: scanner zig-zag.
- Watchdog: wider pressure-and-momentum traversal.
- Blackout: mixed four-part first finale.
- Relay: long fork/reconvergence clusters.
- Quarantine: strict bottom-to-top vertical containment ascent.
- Root: five-phase finale—access climb, lateral scanner traversal, watchdog descent, choice region, final ascent.

Choice density rises from `level01` 0.2778 to `level08` 0.6552; the later levels are not coordinate-scaled copies of the early levels.

## Existing runtime concepts vs optional effects

The data continues the prior runtime concepts: horizontal platforms, required/crumble kinds, spawn, objective, checkpoints, directed grapple links, assembly display, raw-block references, and source-backed semantic events. The v2 additions are additive debug/mapping fields—chronological trace occurrences, physical-role tags, choice summaries, richness features, machine CFG truth, and explicit relationship-layer labels. A consumer may ignore those additions outside its debug overlay.

The geometry itself needs no new movement mechanic. Scanner beams, watchdog pressure, gated firewall presentation, darker STR presentation, and other event-specific visual behaviour remain semantic-event requests: use an existing implementation where one exists. If a particular effect is absent in the target frontend, it is optional presentation work rather than a reason to alter mappings, invent events, or block loading the level data.

## Fixed binaries

All production recipes are O0 + BCF100 loop1/condition3 + SUB50 loop1 + split2, flattening off. STR is enabled only for Levels 5 and 8.

- `level01` `DAD1B10756545AD04708DDAEB5D17161D5AECC95245CCF7979658176F0F6E022`
- `level02` `BC0C0E4F94A67DEF3B877E943373AA032180029824DFBBCACBEC0C72B484C8FE`
- `level03` `322A80E9953A84D976E89CA56AEF28A581731F0D7FEB2121460605A16435E795`
- `level04` `E15C862B583C3C95EACB7465DC8BFCC7D440926E9BAC3834E474E5E28BC06BA0`
- `level05` `E0FD1B1E3668F4118F74661018AFF42CBA1C77B60B5AFA4BC464B07D687B77A3`
- `level06` `5CF213F1DA9E43B048D5D9EA4C02265FAC1F3D22237053A10CA336BE03256BB7`
- `level07` `8195414C3D687DEDA1E633BD036D72441C55B51DFDE7ADBACB316604275D983B`
- `level08` `340263A69FE1ACE144C7E9154FAEDE4A05DCA260FBB461123117CB2BCA4F86EA`

Root's PE is a narrow freeze exception created because no validated split2+STR Root artifact existed. Its exact hash is immutable. Do not regenerate it: STR is known not to guarantee byte-identical output.

## QA and regeneration

Run `tools/level_exporter_v2/run_export.ps1` to regenerate only data/previews from frozen inputs, then run `python tools/level_exporter_v2/validate_production.py`. Validation JSON is in `authoritative/validation/`; human and machine metrics are in `reports/`.

The fixed-step solver validates directed graph reachability, exact center-to-center grapple distance, configured vertical delta, checkpoints, overlap, bounds, and survival after all crumble platforms are removed. There is no frontend physics implementation in this workspace, so no claim is made about unavailable engine-level collision simulation.
