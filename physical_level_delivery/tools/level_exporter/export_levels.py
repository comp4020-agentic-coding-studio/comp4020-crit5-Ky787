from __future__ import annotations

import argparse
import hashlib
import html
import json
import math
import random
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
INPUT_ROOT = ROOT / "experiments" / "five_levels"
CONFIG_PATH = Path(__file__).with_name("layout_config.json")

LEVELS: list[dict[str, Any]] = [
    {
        "id": "level01", "name": "Ghostline", "slug": "ghostline",
        "candidate": "level01_ghostline_house", "theme": "tutorial",
        "checkpoint_indices": [6, 13], "step": 285,
    },
    {
        "id": "level02", "name": "Firewall", "slug": "firewall",
        "candidate": "level02_firewall_house", "theme": "vertical_chambers",
        "checkpoint_indices": [5, 11, 16], "step": 275,
    },
    {
        "id": "level03", "name": "Sweep", "slug": "sweep",
        "candidate": "level03_sweep_house", "theme": "scanner_chambers",
        "checkpoint_indices": [16, 33], "step": 255,
    },
    {
        "id": "level04", "name": "Watchdog", "slug": "watchdog",
        "candidate": "level04_watchdog_house", "theme": "forward_pressure",
        "checkpoint_indices": [15, 31], "step": 330,
    },
    {
        "id": "level05", "name": "Blackout", "slug": "blackout",
        "candidate": "level05_blackout_house_str", "theme": "finale",
        "checkpoint_indices": [9, 19, 29], "step": 410,
    },
]

EVENT_INTENT = {
    "authentication": "identity gate",
    "firewall": "barrier gate",
    "network_scan": "network observation zone",
    "scanner": "sweeping detection zone",
    "watchdog": "defensive timer and pursuer pressure",
    "decrypt": "decryption interaction",
    "transfer": "transfer stage",
    "checkpoint": "temporary safe location",
    "objective": "mission objective",
    "cleanup": "completion sequence",
    "navigation": "route selection",
}


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(value, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def center(platform: dict[str, Any]) -> tuple[float, float]:
    return (platform["x"] + platform["width"] / 2, platform["y"])


def distance(a: dict[str, Any], b: dict[str, Any]) -> float:
    ax, ay = center(a)
    bx, by = center(b)
    return round(math.hypot(bx - ax, by - ay), 1)


def theme_y(theme: str, index: int, total: int) -> int:
    if theme == "tutorial":
        return [790, 750, 710, 760, 700, 660, 720, 680][index % 8]
    if theme == "vertical_chambers":
        tiers = [1040, 955, 870, 785, 700, 615, 530, 445, 360]
        half = max(1, total // 2)
        position = index if index <= half else total - 1 - index
        return tiers[min(len(tiers) - 1, int(position * (len(tiers) - 1) / half))]
    if theme == "scanner_chambers":
        chamber = index // 10
        motif = [760, 690, 610, 660, 750, 820, 760, 680, 610, 700]
        return motif[index % 10] + (35 if chamber % 2 else 0)
    if theme == "forward_pressure":
        return [830, 735, 650, 720, 805, 700, 610, 690][index % 8]
    # Finale alternates climbs and descents in four visibly different phases.
    phase = min(3, int(index * 4 / max(1, total)))
    motifs = [
        [930, 835, 740, 650, 570, 680],
        [590, 500, 420, 510, 610, 700],
        [760, 845, 760, 670, 580, 500],
        [520, 610, 700, 610, 500, 390],
    ]
    return motifs[phase][index % len(motifs[phase])]


def route_width(theme: str, index: int, rng: random.Random, cfg: dict[str, Any]) -> int:
    p = cfg["platform"]
    if theme == "tutorial":
        return 220 + (index % 3) * 10
    if theme == "forward_pressure":
        return 150 + (index % 3) * 15
    if theme == "scanner_chambers" and index % 10 in {0, 5, 9}:
        return 235
    if theme == "finale" and index % 10 in {0, 9}:
        return 225
    return rng.randrange(p["route_width_min"], p["route_width_max"] + 1, 10)


def route_x(level: dict[str, Any], index: int, cfg: dict[str, Any]) -> int:
    x = cfg["world"]["margin_x"]
    for i in range(index):
        step = level["step"]
        if level["theme"] == "scanner_chambers" and (i + 1) % 10 == 0:
            step += 80
        elif level["theme"] == "vertical_chambers" and (i + 1) % 6 == 0:
            step += 55
        elif level["theme"] == "finale" and (i + 1) % 10 == 0:
            step += 70
        x += step
    return x


def compact_display(raw_ids: list[str], blocks: dict[str, dict[str, Any]], *, string_encrypted: bool) -> dict[str, Any]:
    selected = [blocks[item] for item in raw_ids if item in blocks]
    instructions: list[str] = []
    strings: list[str] = []
    for block in selected:
        for insn in block.get("instructions", []):
            if len(instructions) < 6:
                rendered = f"{insn['mnemonic']} {insn['op_str']}".rstrip()
                instructions.append(rendered)
            if not string_encrypted:
                for reference in insn.get("referenced_strings", []):
                    strings.append(reference["value"] if isinstance(reference, dict) else str(reference))
        if not string_encrypted:
            for reference in block.get("referenced_strings", []):
                strings.append(reference["value"] if isinstance(reference, dict) else str(reference))
    first = selected[0] if selected else None
    return {
        "address": f"0x{first['start_va']:016X}" if first else None,
        "entry_rva": f"0x{first['start_rva']:X}" if first else None,
        "instructions": instructions,
        "strings": list(dict.fromkeys(strings))[:4],
    }


def choose_platform_kind(index: int, total: int, checkpoints: set[int]) -> str:
    if index == 0:
        return "start"
    if index == total - 1:
        return "objective"
    if index in checkpoints:
        return "checkpoint"
    return "route"


def make_event_params(event_type: str, target: str, occurrence: int) -> dict[str, Any]:
    params: dict[str, Any] = {"intent": EVENT_INTENT.get(event_type, "semantic interaction")}
    if event_type == "scanner":
        params["mode"] = "sweep"
    elif event_type == "watchdog":
        params["pressure"] = "time"
    elif event_type == "transfer":
        params["stage"] = occurrence
    elif event_type == "firewall":
        params["mode"] = "barrier"
    params["source_symbol"] = target
    return params


def place_crumble(
    anchor: dict[str, Any], ordinal: int, occupied: list[dict[str, Any]],
    cfg: dict[str, Any], level_theme: str,
) -> tuple[int, int]:
    base_dx = cfg["layout"]["crumble_horizontal_offset"]
    base_dy = cfg["layout"]["crumble_vertical_offset"]
    directions = [-1, 1] if level_theme != "vertical_chambers" else [1, -1]
    candidates: list[tuple[int, int]] = []
    for ring in range(4):
        sign = directions[(ordinal + ring) % 2]
        candidates.extend([
            (anchor["x"] + base_dx + ring * 45, anchor["y"] + sign * (base_dy + ring * 35)),
            (anchor["x"] - 35 + ring * 55, anchor["y"] - sign * (base_dy + 20 + ring * 30)),
        ])
    ceiling = cfg["world"]["ceiling_y"]
    death_y = cfg["world"]["death_y"]
    width = cfg["platform"]["crumble_width"]
    for x, y in candidates:
        y = max(ceiling + 20, min(death_y - 100, y))
        proposed = {"x": x, "y": y, "width": width, "height": cfg["platform"]["height"]}
        if not any(rectangles_overlap(proposed, other, cfg["layout"]["minimum_platform_clearance"]) for other in occupied):
            return x, y
    return anchor["x"] + 40 + ordinal * 18, max(ceiling + 20, anchor["y"] - base_dy - ordinal * 28)


def rectangles_overlap(a: dict[str, Any], b: dict[str, Any], clearance: int = 0) -> bool:
    return not (
        a["x"] + a["width"] + clearance <= b["x"]
        or b["x"] + b["width"] + clearance <= a["x"]
        or a["y"] + a["height"] + clearance <= b["y"]
        or b["y"] + b["height"] + clearance <= a["y"]
    )


def compile_level(level: dict[str, Any], cfg: dict[str, Any]) -> dict[str, Any]:
    candidate = level["candidate"]
    game_dir = INPUT_ROOT / "gameplay" / candidate
    analysis_dir = INPUT_ROOT / "analysis" / candidate
    build_dir = INPUT_ROOT / "builds" / candidate
    gameplay = load_json(game_dir / "gameplay_graph.json")
    semantics = load_json(game_dir / "semantic_events.json")
    loops = load_json(game_dir / "loop_representation.json")
    analysis = load_json(analysis_dir / "analysis.json")
    build = load_json(build_dir / "build.json")

    nodes = {node["id"]: node for node in gameplay["nodes"]}
    blocks = {block["id"]: block for block in analysis["blocks"]}
    route_trace: list[str] = gameplay["concrete_gameplay_trace"]
    route_ids = set(route_trace)
    rng = random.Random(cfg["seed"] + int(level["id"][-2:]) * 1009)
    checkpoints = {i for i in level["checkpoint_indices"] if 0 < i < len(route_trace) - 1}
    occurrence_counter: Counter[str] = Counter()
    route_platforms: list[dict[str, Any]] = []
    logical_to_platforms: dict[str, list[str]] = defaultdict(list)
    platform_by_id: dict[str, dict[str, Any]] = {}
    string_encrypted = bool(build["candidate"]["string_encrypt"])

    for index, logical_id in enumerate(route_trace):
        occurrence_counter[logical_id] += 1
        node = nodes[logical_id]
        platform_id = f"platform_{index + 1:03d}"
        display = compact_display(node["raw_blocks"], blocks, string_encrypted=string_encrypted)
        platform = {
            "id": platform_id,
            "logical_node": logical_id,
            "occurrence": occurrence_counter[logical_id],
            "route_index": index,
            "x": route_x(level, index, cfg),
            "y": theme_y(level["theme"], index, len(route_trace)),
            "width": route_width(level["theme"], index, rng, cfg),
            "height": cfg["platform"]["height"],
            "kind": choose_platform_kind(index, len(route_trace), checkpoints),
            "required": True,
            "raw_blocks": node["raw_blocks"],
            "display": display,
            "semantic_event_ids": [],
            "mapping_note": "Physical chronological instance of a compact gameplay node; not necessarily one machine basic block.",
        }
        route_platforms.append(platform)
        platform_by_id[platform_id] = platform
        logical_to_platforms[logical_id].append(platform_id)

    # Bind concrete call events to the chronological occurrence of the projected node.
    event_use_counter: Counter[tuple[str, str]] = Counter()
    events: list[dict[str, Any]] = []
    for source_event in semantics["event_instances"]:
        raw_id = source_event["raw_block_id"]
        logical_candidates = [
            node_id for node_id in route_ids if raw_id in nodes[node_id]["raw_blocks"]
        ]
        if len(logical_candidates) != 1:
            raise ValueError(f"{candidate}: event {source_event['instance_id']} maps to {len(logical_candidates)} route nodes")
        logical_id = logical_candidates[0]
        key = (logical_id, raw_id)
        occurrence_index = event_use_counter[key]
        platform_options = logical_to_platforms[logical_id]
        platform_id = platform_options[min(occurrence_index, len(platform_options) - 1)]
        event_use_counter[key] += 1
        event_id = f"event_{len(events) + 1:03d}"
        event_type = source_event["semantic_event"]
        event = {
            "id": event_id,
            "type": event_type,
            "platform": platform_id,
            "raw_block": raw_id,
            "instruction_address": source_event["call_instruction_address_hex"],
            "call_target": source_event["target_symbol"],
            "call_site_occurrence": source_event["call_site_occurrence"],
            "params": make_event_params(event_type, source_event["target_symbol"], source_event["call_site_occurrence"]),
            "source_event_instance": source_event["instance_id"],
        }
        events.append(event)
        platform_by_id[platform_id]["semantic_event_ids"].append(event_id)

    # Select eight strong raw alteredBB blocks across the chronological route. The
    # earlier projector intentionally preferred proof over visual distribution;
    # this physical stage can use the larger proven pool while preserving that
    # truth boundary. Every selected candidate is directly CFG-adjacent.
    adjacent_candidates: dict[str, set[int]] = defaultdict(set)
    for route_index, platform in enumerate(route_platforms):
        for route_raw_id in platform["raw_blocks"]:
            route_raw = blocks[route_raw_id]
            neighbor_ids = [item["target"] for item in route_raw.get("successors", [])]
            neighbor_ids.extend(item["source"] for item in route_raw.get("predecessors", []))
            for neighbor_id in neighbor_ids:
                neighbor = blocks.get(neighbor_id)
                if (
                    neighbor
                    and neighbor.get("trace_status") == "obfuscator_bogus"
                    and neighbor.get("provenance_classification") == "obfuscator_bogus"
                    and neighbor.get("provenance_evidence", {}).get("strength") == "strong"
                ):
                    adjacent_candidates[neighbor_id].add(route_index)
    if len(adjacent_candidates) < 8:
        raise ValueError(f"{candidate}: only {len(adjacent_candidates)} direct strong decoys are available")
    selected_decoys: list[tuple[str, int]] = []
    used_raw: set[str] = set()
    for ordinal in range(8):
        target_index = round((ordinal + 1) * (len(route_platforms) - 1) / 9)
        choices: list[tuple[int, int, str]] = []
        for raw_id, anchor_indices in adjacent_candidates.items():
            if raw_id in used_raw:
                continue
            anchor_index = min(anchor_indices, key=lambda value: (abs(value - target_index), value))
            choices.append((abs(anchor_index - target_index), anchor_index, raw_id))
        _, anchor_index, raw_id = min(choices)
        selected_decoys.append((raw_id, anchor_index))
        used_raw.add(raw_id)

    crumble_platforms: list[dict[str, Any]] = []
    occupied = list(route_platforms)
    for ordinal, (raw_id, anchor_index) in enumerate(selected_decoys):
        raw = blocks[raw_id]
        anchor_id = route_platforms[anchor_index]["id"]
        anchor = platform_by_id[anchor_id]
        x, y = place_crumble(anchor, ordinal, occupied, cfg, level["theme"])
        platform_id = f"platform_{len(route_platforms) + ordinal + 1:03d}"
        crumble = {
            "id": platform_id,
            "logical_node": None,
            "occurrence": 1,
            "route_index": None,
            "x": x,
            "y": y,
            "width": cfg["platform"]["crumble_width"],
            "height": cfg["platform"]["height"],
            "kind": "crumble",
            "required": False,
            "raw_blocks": [raw_id],
            "display": compact_display([raw_id], blocks, string_encrypted=string_encrypted),
            "semantic_event_ids": [],
            "anchor_platform": anchor_id,
            "cfg_distance": 1,
            "provenance": {
                "classification": raw.get("provenance_classification"),
                "source": "hikari_alteredBB",
                "confidence": raw.get("provenance_evidence", {}).get("strength"),
                "method": raw.get("provenance_evidence", {}).get("method"),
            },
            "mapping_note": "Optional raw-block physical object with no gameplay-route logical node; represents one strongly proven Hikari alteredBB machine block.",
        }
        crumble_platforms.append(crumble)
        platform_by_id[platform_id] = crumble
        occupied.append(crumble)

    links: list[dict[str, Any]] = []
    for index, (source, target) in enumerate(zip(route_platforms, route_platforms[1:]), start=1):
        links.append({
            "id": f"link_required_{index:03d}", "from": source["id"], "to": target["id"],
            "distance": distance(source, target), "kind": "required_progression", "required": True,
        })
    for index, crumble in enumerate(crumble_platforms, start=1):
        anchor = platform_by_id[crumble["anchor_platform"]]
        links.append({
            "id": f"link_decoy_{index:03d}", "from": anchor["id"], "to": crumble["id"],
            "distance": distance(anchor, crumble), "kind": "optional_decoy", "required": False,
        })
        next_index = min(anchor["route_index"] + 1, len(route_platforms) - 1)
        recovery = route_platforms[next_index]
        if distance(crumble, recovery) <= cfg["grapple"]["maximum_optional_distance"]:
            links.append({
                "id": f"link_recovery_{index:03d}", "from": crumble["id"], "to": recovery["id"],
                "distance": distance(crumble, recovery), "kind": "optional_recovery", "required": False,
            })

    checkpoint_objects = []
    for sequence, route_index in enumerate(sorted(checkpoints), start=1):
        platform = route_platforms[route_index]
        checkpoint_objects.append({
            "id": f"checkpoint_{sequence:02d}", "sequence": sequence, "platform": platform["id"],
            "respawn": {"x": platform["x"] + 24, "y": platform["y"] - cfg["player"]["height"]},
        })

    last = route_platforms[-1]
    world_width = max(item["x"] + item["width"] for item in occupied) + cfg["world"]["margin_x"]
    repeated_nodes = {key: value for key, value in occurrence_counter.items() if value > 1}
    dataset = {
        "schema_version": 1,
        "level": {
            "id": level["id"], "name": level["name"], "theme": level["theme"],
            "direction": "left_to_right", "binary_candidate": candidate,
        },
        "world": {
            "width": world_width, "height": cfg["world"]["height"],
            "death_y": cfg["world"]["death_y"], "units": "normalized_game_units",
        },
        "player": {
            "spawn": {
                "x": route_platforms[0]["x"] + 24,
                "y": route_platforms[0]["y"] - cfg["player"]["height"],
                "platform": route_platforms[0]["id"],
            }
        },
        "movement_model": {
            "config_version": cfg["schema_version"],
            "maximum_required_grapple_distance": cfg["grapple"]["maximum_required_distance"],
            "maximum_vertical_delta": cfg["grapple"]["maximum_vertical_delta"],
        },
        "platforms": route_platforms + crumble_platforms,
        "route": {
            "platform_ids": [item["id"] for item in route_platforms],
            "chronology": "compacted_gameplay_route_occurrences",
            "logical_node_occurrences": repeated_nodes,
        },
        "grapple_links": links,
        "events": events,
        "checkpoints": checkpoint_objects,
        "objective": {
            "id": "objective_end", "platform": last["id"],
            "region": {"x": last["x"], "y": last["y"] - 100, "width": last["width"], "height": 100},
        },
        "analysis_metadata": {
            "projection_schema_version": gameplay["schema_version"],
            "loop_strategy": loops["strategy"],
            "raw_ordered_execution_count": loops["ordered_raw_block_count"],
            "raw_unique_executed_blocks": loops["unique_raw_block_count"],
            "physical_route_instances": len(route_platforms),
            "repeated_logical_nodes": len(repeated_nodes),
            "repeated_physical_instances": sum(repeated_nodes.values()),
            "crumble_selection": "projected strong BCF decoys adjacent to successful route",
            "string_encryption": string_encrypted,
            "plaintext_display_policy": "omit strings when absent from the selected binary",
            "source_sha256": build["hashes"]["source_sha256"],
            "executable_sha256": build["hashes"]["executable_sha256"],
            "fixed_recipe": {
                "optimization": "O0", "bcf": True, "substitution": True,
                "split": 2, "flattening": False, "string_encryption": string_encrypted,
                "seed": build["fixed_parameters"]["hikari_seed"],
            },
        },
    }
    return dataset


BROWSER_PLATFORM_FIELDS = {
    "id", "logical_node", "occurrence", "route_index", "x", "y", "width", "height",
    "kind", "required", "raw_blocks", "display", "semantic_event_ids", "anchor_platform",
    "cfg_distance", "provenance", "mapping_note",
}


def browser_export(dataset: dict[str, Any]) -> dict[str, Any]:
    # Explicit top-level and platform whitelists prevent local paths/build logs leaking.
    top_fields = [
        "schema_version", "level", "world", "player", "movement_model", "route",
        "grapple_links", "events", "checkpoints", "objective", "analysis_metadata",
    ]
    result = {key: dataset[key] for key in top_fields}
    result["platforms"] = [
        {key: value for key, value in platform.items() if key in BROWSER_PLATFORM_FIELDS}
        for platform in dataset["platforms"]
    ]
    return result


def svg_preview(dataset: dict[str, Any], path: Path, cfg: dict[str, Any]) -> None:
    scale = cfg["layout"]["preview_scale"]
    padding = 60
    width = int(dataset["world"]["width"] * scale + padding * 2)
    height = int(dataset["world"]["height"] * scale + padding * 2)
    platforms = {item["id"]: item for item in dataset["platforms"]}
    event_colors = {
        "firewall": "#ff5e5b", "scanner": "#c77dff", "network_scan": "#c77dff",
        "watchdog": "#ff9f1c", "transfer": "#3a86ff", "objective": "#ffe66d",
        "checkpoint": "#4dd599", "authentication": "#80ed99", "cleanup": "#a8dadc",
        "navigation": "#90e0ef", "decrypt": "#48cae4",
    }
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        '<rect width="100%" height="100%" fill="#08111f"/>',
        f'<text x="28" y="34" fill="#f8f9fa" font-family="monospace" font-size="20">{html.escape(dataset["level"]["id"] + " — " + dataset["level"]["name"])}</text>',
        f'<text x="28" y="54" fill="#8ea7c4" font-family="monospace" font-size="11">{html.escape(dataset["level"]["theme"])} · chronological physical route</text>',
    ]
    for link in dataset["grapple_links"]:
        source, target = platforms[link["from"]], platforms[link["to"]]
        x1, y1 = center(source); x2, y2 = center(target)
        color = "#55d6be" if link["required"] else ("#ef476f" if link["kind"] == "optional_decoy" else "#7c8fa6")
        dash = "" if link["required"] else ' stroke-dasharray="5 5"'
        parts.append(f'<line x1="{padding + x1*scale:.1f}" y1="{padding + y1*scale:.1f}" x2="{padding + x2*scale:.1f}" y2="{padding + y2*scale:.1f}" stroke="{color}" stroke-width="1.4"{dash}/>' )
    checkpoint_platforms = {item["platform"] for item in dataset["checkpoints"]}
    event_by_platform: dict[str, list[str]] = defaultdict(list)
    for event in dataset["events"]:
        event_by_platform[event["platform"]].append(event["type"])
    for platform in dataset["platforms"]:
        x = padding + platform["x"] * scale
        y = padding + platform["y"] * scale
        w = max(10, platform["width"] * scale)
        h = max(4, platform["height"] * scale)
        fill = "#ef476f" if platform["kind"] == "crumble" else "#55d6be"
        if platform["kind"] == "start": fill = "#80ed99"
        if platform["kind"] == "objective": fill = "#ffe66d"
        stroke = "#ffffff" if platform["id"] in checkpoint_platforms else fill
        parts.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="2" fill="{fill}" stroke="{stroke}" stroke-width="2"/>')
        label = platform["id"].replace("platform_", "p")
        if platform["occurrence"] > 1:
            label += f'/{platform["logical_node"]}#{platform["occurrence"]}'
        parts.append(f'<text x="{x:.1f}" y="{y-4:.1f}" fill="#dce8f5" font-family="monospace" font-size="8">{html.escape(label)}</text>')
        for offset, event_type in enumerate(event_by_platform.get(platform["id"], [])):
            color = event_colors.get(event_type, "#ffffff")
            parts.append(f'<circle cx="{x+w/2+offset*6:.1f}" cy="{y-13:.1f}" r="4" fill="{color}"/>')
    death_y = padding + dataset["world"]["death_y"] * scale
    parts.append(f'<line x1="{padding}" y1="{death_y:.1f}" x2="{width-padding}" y2="{death_y:.1f}" stroke="#ff3864" stroke-width="2" stroke-dasharray="8 6"/>')
    parts.append(f'<text x="{padding}" y="{death_y-5:.1f}" fill="#ff6b81" font-family="monospace" font-size="9">DEATH Y</text>')
    parts.append('</svg>')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(parts) + "\n", encoding="utf-8")


def comparison_svg(datasets: list[dict[str, Any]], path: Path) -> None:
    panel_w, panel_h, gap = 1200, 250, 22
    width, height = panel_w, len(datasets) * (panel_h + gap)
    colors = {"route": "#55d6be", "crumble": "#ef476f", "objective": "#ffe66d", "start": "#80ed99", "checkpoint": "#55d6be"}
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">', '<rect width="100%" height="100%" fill="#08111f"/>']
    for row, dataset in enumerate(datasets):
        top = row * (panel_h + gap)
        sx = (panel_w - 100) / dataset["world"]["width"]
        sy = (panel_h - 48) / dataset["world"]["height"]
        parts.append(f'<rect x="10" y="{top+8}" width="1180" height="{panel_h}" rx="10" fill="#0e1b2d" stroke="#263c56"/>')
        parts.append(f'<text x="25" y="{top+31}" fill="#f8f9fa" font-family="monospace" font-size="17">{html.escape(dataset["level"]["id"] + " " + dataset["level"]["name"] + " — " + dataset["level"]["theme"])}</text>')
        platforms = {item["id"]: item for item in dataset["platforms"]}
        for link in dataset["grapple_links"]:
            if not link["required"]: continue
            a, b = platforms[link["from"]], platforms[link["to"]]
            ax, ay = center(a); bx, by = center(b)
            parts.append(f'<line x1="{55+ax*sx:.1f}" y1="{top+38+ay*sy:.1f}" x2="{55+bx*sx:.1f}" y2="{top+38+by*sy:.1f}" stroke="#365e73"/>')
        for platform in dataset["platforms"]:
            x, y = 55 + platform["x"] * sx, top + 38 + platform["y"] * sy
            w = max(3, platform["width"] * sx)
            parts.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="4" fill="{colors.get(platform["kind"], "#55d6be")}"/>')
    parts.append('</svg>')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(parts) + "\n", encoding="utf-8")


def render_comparison_png(svg_datasets: list[dict[str, Any]], path: Path) -> bool:
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        return False
    panel_w, panel_h, gap = 1600, 300, 20
    image = Image.new("RGB", (panel_w, len(svg_datasets) * (panel_h + gap)), "#08111f")
    draw = ImageDraw.Draw(image)
    for row, dataset in enumerate(svg_datasets):
        top = row * (panel_h + gap)
        draw.rounded_rectangle((10, top + 8, panel_w - 10, top + panel_h), 10, fill="#0e1b2d", outline="#263c56", width=2)
        draw.text((28, top + 22), f"{dataset['level']['id']}  {dataset['level']['name']} — {dataset['level']['theme']}", fill="#f8f9fa")
        sx = (panel_w - 100) / dataset["world"]["width"]
        sy = (panel_h - 60) / dataset["world"]["height"]
        pmap = {item["id"]: item for item in dataset["platforms"]}
        for link in dataset["grapple_links"]:
            if not link["required"]: continue
            a, b = pmap[link["from"]], pmap[link["to"]]
            ax, ay = center(a); bx, by = center(b)
            draw.line((50 + ax*sx, top + 45 + ay*sy, 50 + bx*sx, top + 45 + by*sy), fill="#365e73", width=2)
        for platform in dataset["platforms"]:
            x, y = 50 + platform["x"] * sx, top + 45 + platform["y"] * sy
            color = "#ef476f" if platform["kind"] == "crumble" else "#55d6be"
            if platform["kind"] == "start": color = "#80ed99"
            if platform["kind"] == "objective": color = "#ffe66d"
            draw.rectangle((x, y, x + max(4, platform["width"] * sx), y + 5), fill=color)
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path)
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Compile validated gameplay graphs into physical level datasets")
    parser.add_argument("--root", type=Path, default=ROOT, help="repository root")
    args = parser.parse_args()
    if args.root.resolve() != ROOT:
        raise SystemExit("This exporter currently requires the repository containing its validated inputs")
    cfg = load_json(CONFIG_PATH)
    datasets = [compile_level(level, cfg) for level in LEVELS]
    for dataset in datasets:
        level_id = dataset["level"]["id"]
        authoritative = ROOT / "game_levels" / f"{level_id}.json"
        browser = ROOT / "web_game_data" / "levels" / f"{level_id}.json"
        write_json(authoritative, dataset)
        write_json(browser, browser_export(dataset))
        svg_preview(dataset, ROOT / "previews" / f"{level_id}.svg", cfg)
    index = {
        "schema_version": 1,
        "levels": [
            {
                "id": item["level"]["id"], "name": item["level"]["name"],
                "theme": item["level"]["theme"], "path": f"levels/{item['level']['id']}.json",
                "world": item["world"], "platform_count": len(item["platforms"]),
            }
            for item in datasets
        ],
    }
    write_json(ROOT / "web_game_data" / "index.json", index)
    write_json(ROOT / "game_levels" / "layout_config.snapshot.json", cfg)
    comparison_svg(datasets, ROOT / "previews" / "comparison.svg")
    render_comparison_png(datasets, ROOT / "previews" / "comparison.png")
    manifest = {
        "schema_version": 1,
        "generator": "tools/level_exporter/export_levels.py",
        "configuration_sha256": sha256(CONFIG_PATH),
        "outputs": [
            {"level": item["level"]["id"], "authoritative_sha256": sha256(ROOT / "game_levels" / f"{item['level']['id']}.json"), "browser_sha256": sha256(ROOT / "web_game_data" / "levels" / f"{item['level']['id']}.json")}
            for item in datasets
        ],
    }
    write_json(ROOT / "game_levels" / "manifest.json", manifest)
    print(f"Generated {len(datasets)} physical levels, browser datasets, and previews.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
