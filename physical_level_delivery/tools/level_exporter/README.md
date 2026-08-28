# Physical level exporter

This stage consumes only the validated five-level analysis outputs under
`experiments/five_levels`. It does not rebuild binaries or alter the frozen C
sources.

Run from the repository root:

```powershell
python tools/level_exporter/export_levels.py
python tools/level_exporter/validate_levels.py
```

The exporter creates authoritative physical datasets in `game_levels/`, a
whitelist-only browser export in `web_game_data/`, SVG previews in `previews/`,
and metrics/readiness reports in `reports/`. Movement and geometry assumptions
are centralized in `layout_config.json`.

Physical route platforms are chronological instances of compact gameplay
nodes. They are projections that retain raw-block mappings; they are not
claimed to be literal machine basic blocks. Crumble platforms are drawn only
from selected raw blocks with strong `hikari_alteredBB` provenance.
