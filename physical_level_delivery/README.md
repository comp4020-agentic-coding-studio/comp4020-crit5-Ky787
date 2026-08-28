# Physical-level delivery bundle

This folder is a focused copy of the completed physical-platforming phase. The
original files remain in their normal repository locations.

## Frontend handoff

Use `web_game_data/index.json` as the browser entry point. Its five level files
contain the physical platforms, chronological route instances, grapple links,
semantic events, checkpoints, spawn/objective regions, and compact code display
payloads.

## Contents

- `web_game_data/` — whitelist-only browser-ready datasets.
- `game_levels/` — authoritative physical datasets and per-level validation.
- `previews/` — five SVG layouts plus SVG/PNG comparisons.
- `reports/` — final readiness report and machine-readable metrics.
- `tools/level_exporter/` — a copy of the exporter, validator, and shared layout
  configuration for reference.

All five levels are classified **READY FOR FRONTEND**. Every successful route is
reachable without using a crumble platform, and all crumble objects retain
strong Hikari `alteredBB` provenance.

The copied exporter source depends on the validated analysis inputs in the main
repository. To regenerate the bundle's source datasets, run
`tools/level_exporter/run_export.ps1` from the repository root and then refresh
this delivery copy.
