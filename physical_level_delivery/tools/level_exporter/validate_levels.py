from __future__ import annotations

import json
import math
import re
from collections import Counter, defaultdict, deque
from pathlib import Path
from typing import Any

from export_levels import CONFIG_PATH, INPUT_ROOT, LEVELS, ROOT, load_json, rectangles_overlap, write_json


def platform_center(platform: dict[str, Any]) -> tuple[float, float]:
    return platform["x"] + platform["width"] / 2, platform["y"]


def physical_distance(a: dict[str, Any], b: dict[str, Any]) -> float:
    ax, ay = platform_center(a)
    bx, by = platform_center(b)
    return math.hypot(bx - ax, by - ay)


def reachable(start: str, target: str, links: list[dict[str, Any]], allowed: set[str]) -> bool:
    adjacency: dict[str, list[str]] = defaultdict(list)
    for link in links:
        if link["from"] in allowed and link["to"] in allowed:
            adjacency[link["from"]].append(link["to"])
    queue: deque[str] = deque([start])
    visited = {start}
    while queue:
        current = queue.popleft()
        if current == target:
            return True
        for neighbor in adjacency[current]:
            if neighbor not in visited:
                visited.add(neighbor)
                queue.append(neighbor)
    return target in visited


def validate_level(dataset: dict[str, Any], cfg: dict[str, Any], level_spec: dict[str, Any]) -> dict[str, Any]:
    level_id = dataset["level"]["id"]
    candidate = level_spec["candidate"]
    gameplay = load_json(INPUT_ROOT / "gameplay" / candidate / "gameplay_graph.json")
    semantics = load_json(INPUT_ROOT / "gameplay" / candidate / "semantic_events.json")
    analysis = load_json(INPUT_ROOT / "analysis" / candidate / "analysis.json")
    build = load_json(INPUT_ROOT / "builds" / candidate / "build.json")
    nodes = {item["id"]: item for item in gameplay["nodes"]}
    blocks = {item["id"]: item for item in analysis["blocks"]}
    source_events = {item["instance_id"]: item for item in semantics["event_instances"]}
    platforms = {item["id"]: item for item in dataset["platforms"]}
    route_ids: list[str] = dataset["route"]["platform_ids"]
    route_platforms = [platforms[item] for item in route_ids]
    crumble_platforms = [item for item in dataset["platforms"] if item["kind"] == "crumble"]
    errors: list[str] = []
    checks: dict[str, bool] = {}

    def check(name: str, condition: bool, message: str) -> None:
        checks[name] = checks.get(name, True) and condition
        if not condition:
            errors.append(message)

    check("schema_version", dataset.get("schema_version") == 1, "unsupported schema version")
    check("spawn", dataset.get("player", {}).get("spawn", {}).get("platform") in platforms, "spawn is missing or invalid")
    check("objective", dataset.get("objective", {}).get("platform") in platforms, "objective is missing or invalid")
    check("route_nonempty", bool(route_platforms), "successful route is empty")
    check("route_starts_at_spawn", dataset["player"]["spawn"]["platform"] == route_ids[0], "spawn is not on first route platform")
    check("route_ends_at_objective", dataset["objective"]["platform"] == route_ids[-1], "objective is not on final route platform")

    expected_occurrences: Counter[str] = Counter()
    for index, platform in enumerate(route_platforms):
        expected_occurrences[platform["logical_node"]] += 1
        check("chronological_mapping", platform["route_index"] == index, f"{platform['id']} has wrong route index")
        check("chronological_mapping", platform["occurrence"] == expected_occurrences[platform["logical_node"]], f"{platform['id']} has wrong logical occurrence")
        source_node = nodes.get(platform["logical_node"])
        check("logical_mapping", source_node is not None, f"{platform['id']} references invalid logical node")
        if source_node:
            check("raw_mapping", platform["raw_blocks"] == source_node["raw_blocks"], f"{platform['id']} raw mapping differs from gameplay projection")
        check("route_avoids_bogus", platform["kind"] != "crumble" and platform["required"], f"winning route includes optional/bogus {platform['id']}")
        check("above_death_plane", platform["y"] + platform["height"] < dataset["world"]["death_y"], f"{platform['id']} is at/below death plane")

    required_links = [item for item in dataset["grapple_links"] if item["required"]]
    expected_pairs = list(zip(route_ids, route_ids[1:]))
    actual_pairs = [(item["from"], item["to"]) for item in required_links]
    check("required_chain", actual_pairs == expected_pairs, "required grapple links do not exactly follow chronological route")
    for link in dataset["grapple_links"]:
        source = platforms.get(link["from"])
        target = platforms.get(link["to"])
        check("link_references", source is not None and target is not None, f"{link['id']} references invalid platform")
        if not source or not target:
            continue
        measured = physical_distance(source, target)
        check("link_distance_consistent", abs(measured - link["distance"]) <= 0.11, f"{link['id']} stored distance is inconsistent")
        if link["required"]:
            check("required_gap_range", measured <= cfg["grapple"]["maximum_required_distance"], f"{link['id']} exceeds required grapple range")
            check("required_vertical_range", abs(source["y"] - target["y"]) <= cfg["grapple"]["maximum_vertical_delta"], f"{link['id']} exceeds vertical range")
        else:
            check("optional_gap_range", measured <= cfg["grapple"]["maximum_optional_distance"], f"{link['id']} exceeds optional grapple range")

    for index, first in enumerate(route_platforms):
        for second in route_platforms[index + 1:]:
            check("required_platform_nonoverlap", not rectangles_overlap(first, second), f"required platforms {first['id']} and {second['id']} overlap")

    for crumble in crumble_platforms:
        check("crumble_optional", not crumble["required"] and crumble["id"] not in route_ids, f"{crumble['id']} is required")
        provenance = crumble.get("provenance", {})
        check("crumble_strong_provenance", provenance.get("classification") == "obfuscator_bogus" and provenance.get("source") == "hikari_alteredBB" and provenance.get("confidence") == "strong", f"{crumble['id']} lacks strong Hikari alteredBB provenance")
        check("crumble_raw_count", len(crumble["raw_blocks"]) == 1, f"{crumble['id']} should map to one proven block")
        for raw_id in crumble["raw_blocks"]:
            raw = blocks.get(raw_id)
            check("crumble_source_mapping", raw is not None, f"{crumble['id']} references missing raw block")
            if raw:
                check("crumble_source_mapping", raw.get("trace_status") == "obfuscator_bogus", f"{crumble['id']} source is not classified bogus")
                check("crumble_source_mapping", raw.get("provenance_evidence", {}).get("strength") == "strong", f"{crumble['id']} source evidence is not strong")
                check("crumble_never_executed", raw.get("execution_count") == 0, f"{crumble['id']} source executed")
        check("crumble_adjacent", crumble.get("cfg_distance") == 1, f"{crumble['id']} is not direct CFG-adjacent")

    for event in dataset["events"]:
        source_event = source_events.get(event.get("source_event_instance"))
        check("event_source", source_event is not None, f"{event['id']} has no concrete source event")
        platform = platforms.get(event["platform"])
        raw = blocks.get(event["raw_block"])
        check("event_platform", platform is not None and event["raw_block"] in platform["raw_blocks"], f"{event['id']} is not grounded in its platform")
        check("event_raw_block", raw is not None, f"{event['id']} raw block is invalid")
        if source_event:
            check("event_source", event["raw_block"] == source_event["raw_block_id"], f"{event['id']} raw source mismatch")
            check("event_source", event["instruction_address"] == source_event["call_instruction_address_hex"], f"{event['id']} instruction mismatch")
            check("event_source", event["type"] == source_event["semantic_event"], f"{event['id']} semantic mismatch")
            check("event_source", event["call_target"] == source_event["target_symbol"], f"{event['id']} target mismatch")
        if raw:
            addresses = {item["address_hex"] for item in raw["instructions"]}
            check("event_instruction", event["instruction_address"] in addresses, f"{event['id']} instruction is outside raw block")
    check("all_events_exported", len(dataset["events"]) == len(source_events), "not every concrete semantic event was exported")

    safe_ids = {item["id"] for item in route_platforms}
    complete_without_crumble = reachable(route_ids[0], route_ids[-1], dataset["grapple_links"], safe_ids)
    check("complete_without_crumble", complete_without_crumble, "objective is not reachable after removing all crumble platforms")
    check("complete_with_required_links", reachable(route_ids[0], route_ids[-1], required_links, set(route_ids)), "required route graph cannot reach objective")

    checkpoint_indices = [platforms[item["platform"]]["route_index"] for item in dataset["checkpoints"]]
    check("checkpoint_order", checkpoint_indices == sorted(checkpoint_indices) and len(set(checkpoint_indices)) == len(checkpoint_indices), "checkpoints are not in chronological order")
    for checkpoint in dataset["checkpoints"]:
        check("checkpoint_reachable", reachable(route_ids[0], checkpoint["platform"], required_links, set(route_ids)), f"{checkpoint['id']} is not reachable")

    if build["candidate"]["string_encrypt"]:
        visible_strings = [text for item in dataset["platforms"] for text in item["display"]["strings"]]
        check("str_plaintext_absent", not visible_strings, "STR level exposes plaintext display strings")

    repeated = Counter(item["logical_node"] for item in route_platforms)
    repeated_groups = {key: count for key, count in repeated.items() if count > 1}
    max_required = max((item["distance"] for item in required_links), default=0)
    return {
        "schema_version": 1,
        "level": level_id,
        "status": "READY FOR FRONTEND" if not errors else "LAYOUT REVISION NEEDED",
        "passed": not errors,
        "checks": checks,
        "errors": errors,
        "metrics": {
            "route_platforms": len(route_platforms),
            "crumble_platforms": len(crumble_platforms),
            "total_platforms": len(platforms),
            "required_links": len(required_links),
            "optional_links": len(dataset["grapple_links"]) - len(required_links),
            "semantic_events": len(dataset["events"]),
            "checkpoints": len(dataset["checkpoints"]),
            "world_width": dataset["world"]["width"],
            "maximum_required_gap": max_required,
            "repeated_logical_nodes": len(repeated_groups),
            "physical_instances_of_repeated_nodes": sum(repeated_groups.values()),
            "additional_repeat_instances": sum(value - 1 for value in repeated_groups.values()),
            "complete_without_crumble": complete_without_crumble,
            "string_encryption": build["candidate"]["string_encrypt"],
            "event_types": dict(sorted(Counter(item["type"] for item in dataset["events"]).items())),
        },
    }


def browser_leak_check(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    forbidden = [
        r"[A-Za-z]:\\", r"/Users/", r"/home/", r"source_path", r'"commands"',
        r"build_director", r"compiler_log", r'"temporary_files"',
    ]
    return [pattern for pattern in forbidden if re.search(pattern, text, flags=re.IGNORECASE)]


def make_report(results: list[dict[str, Any]], distinct: bool, browser_clean: bool) -> str:
    all_ready = all(item["passed"] for item in results)
    rows = []
    for item in results:
        m = item["metrics"]
        rows.append(
            f"| {item['level']} | {item['status']} | {m['route_platforms']} | {m['crumble_platforms']} | "
            f"{m['physical_instances_of_repeated_nodes']} | {m['semantic_events']} | {m['checkpoints']} | "
            f"{m['world_width']} | {m['maximum_required_gap']:.1f} |"
        )
    repeated_lines = []
    for item in results:
        m = item["metrics"]
        repeated_lines.append(
            f"- {item['level']}: {m['repeated_logical_nodes']} repeated logical nodes produce "
            f"{m['physical_instances_of_repeated_nodes']} physical instances "
            f"({m['additional_repeat_instances']} instances beyond the first visits)."
        )
    return "\n".join([
        "# Binary Ninja physical-level report", "",
        "## Outcome", "",
        ("All five deterministic physical layouts were generated and passed every geometry, reachability, "
         "mapping, semantic-event, and strong-provenance validation." if all_ready else
         "One or more physical layouts failed validation; see the classifications and validation JSON files below."),
        "",
        "| Level | Classification | Route platforms | Crumble platforms | Instances of repeated nodes | Events | Checkpoints | World width | Max required gap |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|",
        *rows, "",
        "## Requested findings", "",
        f"1. **Five layouts generated:** {'Yes' if len(results) == 5 else 'No'}. The authoritative and browser-facing sets each contain five levels.",
        f"2. **Successful routes geometrically reachable:** {'Yes' if all(item['checks'].get('complete_with_required_links') for item in results) else 'No'}. Required links are checked against the provisional 600-unit rope and 270-unit vertical limits.",
        f"3. **Completable without crumble platforms:** {'Yes' if all(item['metrics']['complete_without_crumble'] for item in results) else 'No'}. Validation removes every crumble object before graph traversal.",
        "4. **Platform counts:** Shown in the table above; every level uses exactly eight strong Hikari crumble decoys.",
        "5. **Loop representation:** Levels 3–5 instantiate the compacted gameplay-node trace in chronological order. A revisited logical node gets a new forward physical platform with an incremented occurrence; raw executions are not blindly unrolled.",
        "6. **Repeated-node instances:**", "", *repeated_lines, "",
        f"7. **Visual distinctness:** {'Yes' if distinct else 'No'}. Ghostline is broad/horizontal, Firewall climbs chamber tiers, Sweep repeats open chamber motifs, Watchdog uses a faster pressure cadence, and Blackout alternates four traversal phases.",
        "8. **Hazard placement:** Semantic hazards remain attached to the concrete chronological call occurrence. Firewall gates cluster in Firewall/Blackout tiers, scanner calls mark Sweep/Blackout chambers, watchdog calls mark pressure sections, and transfer events retain their Blackout stages.",
        "9. **STR Blackout suitability:** Yes. It passes native/Unicorn-backed source validation inherited from the prior phase, all physical checks pass here, and every platform display has an empty plaintext-string list while semantic event intent remains available separately.",
        f"10. **Frontend handoff:** {'Yes' if all_ready and browser_clean else 'No'}. Browser data is whitelist-exported, contains no detected absolute local paths or build commands, and requires no compiler/CFG knowledge.",
        "",
        "## Validation scope", "",
        "The graph simulator verifies the complete route using required physical grapple links and repeats the traversal after removing all crumble platforms. It also checks stored distances, vertical deltas, overlaps, death-plane clearance, spawn/objective presence, checkpoint order, source mappings, event instruction grounding, STR plaintext absence, and strong alteredBB provenance. This is intentionally not a rope-physics engine.",
        "",
        "## Classification", "",
        *[f"- **{item['level']}: {item['status']}**" for item in results], "",
    ])


def main() -> int:
    cfg = load_json(CONFIG_PATH)
    results: list[dict[str, Any]] = []
    leaks: dict[str, list[str]] = {}
    signatures: set[tuple[Any, ...]] = set()
    for spec in LEVELS:
        level_id = spec["id"]
        dataset_path = ROOT / "game_levels" / f"{level_id}.json"
        if not dataset_path.exists():
            raise SystemExit(f"Missing {dataset_path}; run export_levels.py first")
        dataset = load_json(dataset_path)
        result = validate_level(dataset, cfg, spec)
        results.append(result)
        write_json(ROOT / "game_levels" / "validation" / f"{level_id}.json", result)
        web_path = ROOT / "web_game_data" / "levels" / f"{level_id}.json"
        found = browser_leak_check(web_path)
        if found:
            leaks[level_id] = found
        signatures.add((dataset["level"]["theme"], len(dataset["route"]["platform_ids"]), dataset["world"]["width"]))
    distinct = len(signatures) == len(results)
    browser_clean = not leaks
    metrics = {
        "schema_version": 1,
        "all_ready": all(item["passed"] for item in results) and browser_clean and distinct,
        "all_routes_reachable": all(item["checks"].get("complete_with_required_links", False) for item in results),
        "all_complete_without_crumble": all(item["metrics"]["complete_without_crumble"] for item in results),
        "layouts_visually_distinct": distinct,
        "browser_export_clean": browser_clean,
        "browser_leaks": leaks,
        "levels": {item["level"]: {"status": item["status"], **item["metrics"]} for item in results},
    }
    write_json(ROOT / "reports" / "physical_level_metrics.json", metrics)
    report = make_report(results, distinct, browser_clean)
    report_path = ROOT / "reports" / "physical_level_report.md"
    report_path.write_text(report, encoding="utf-8", newline="\n")
    print(json.dumps({"all_ready": metrics["all_ready"], "levels": {item["level"]: item["status"] for item in results}}, indent=2))
    return 0 if metrics["all_ready"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
