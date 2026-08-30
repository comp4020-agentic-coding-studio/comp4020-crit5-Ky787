# Binary Ninja physical level delivery v2

This is the final production gameplay-data/export package for Levels 1–8.

- `authoritative/` contains full mappings, strong provenance, frozen PE copies,
  selection diagnostics, and validation outputs.
- `web_game_data/` contains whitelist-exported runtime JSON only.
- `previews/` contains truth-overlay and player-perception full-level views.
- `reports/` contains the final metrics and readiness decision.

Machine CFG relationships and physical grapple links are deliberately stored as
separate layers. Coordinates may be tuned, but binary hashes, raw mappings,
semantic events, and bogus/real classification are immutable.
