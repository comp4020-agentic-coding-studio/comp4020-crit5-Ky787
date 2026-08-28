# Binary Ninja physical-level report

## Outcome

All five deterministic physical layouts were generated and passed every geometry, reachability, mapping, semantic-event, and strong-provenance validation.

| Level | Classification | Route platforms | Crumble platforms | Instances of repeated nodes | Events | Checkpoints | World width | Max required gap |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| level01 | READY FOR FRONTEND | 19 | 8 | 0 | 10 | 2 | 5590 | 310.2 |
| level02 | READY FOR FRONTEND | 19 | 8 | 0 | 7 | 3 | 5595 | 350.5 |
| level03 | READY FOR FRONTEND | 50 | 8 | 44 | 12 | 2 | 13290 | 348.2 |
| level04 | READY FOR FRONTEND | 47 | 8 | 43 | 13 | 2 | 15585 | 365.4 |
| level05 | READY FOR FRONTEND | 40 | 8 | 29 | 17 | 3 | 16665 | 545.9 |

## Requested findings

1. **Five layouts generated:** Yes. The authoritative and browser-facing sets each contain five levels.
2. **Successful routes geometrically reachable:** Yes. Required links are checked against the provisional 600-unit rope and 270-unit vertical limits.
3. **Completable without crumble platforms:** Yes. Validation removes every crumble object before graph traversal.
4. **Platform counts:** Shown in the table above; every level uses exactly eight strong Hikari crumble decoys.
5. **Loop representation:** Levels 3–5 instantiate the compacted gameplay-node trace in chronological order. A revisited logical node gets a new forward physical platform with an incremented occurrence; raw executions are not blindly unrolled.
6. **Repeated-node instances:**

- level01: 0 repeated logical nodes produce 0 physical instances (0 instances beyond the first visits).
- level02: 0 repeated logical nodes produce 0 physical instances (0 instances beyond the first visits).
- level03: 13 repeated logical nodes produce 44 physical instances (31 instances beyond the first visits).
- level04: 15 repeated logical nodes produce 43 physical instances (28 instances beyond the first visits).
- level05: 8 repeated logical nodes produce 29 physical instances (21 instances beyond the first visits).

7. **Visual distinctness:** Yes. Ghostline is broad/horizontal, Firewall climbs chamber tiers, Sweep repeats open chamber motifs, Watchdog uses a faster pressure cadence, and Blackout alternates four traversal phases.
8. **Hazard placement:** Semantic hazards remain attached to the concrete chronological call occurrence. Firewall gates cluster in Firewall/Blackout tiers, scanner calls mark Sweep/Blackout chambers, watchdog calls mark pressure sections, and transfer events retain their Blackout stages.
9. **STR Blackout suitability:** Yes. It passes native/Unicorn-backed source validation inherited from the prior phase, all physical checks pass here, and every platform display has an empty plaintext-string list while semantic event intent remains available separately.
10. **Frontend handoff:** Yes. Browser data is whitelist-exported, contains no detected absolute local paths or build commands, and requires no compiler/CFG knowledge.

## Validation scope

The graph simulator verifies the complete route using required physical grapple links and repeats the traversal after removing all crumble platforms. It also checks stored distances, vertical deltas, overlaps, death-plane clearance, spawn/objective presence, checkpoint order, source mappings, event instruction grounding, STR plaintext absence, and strong alteredBB provenance. This is intentionally not a rope-physics engine.

## Classification

- **level01: READY FOR FRONTEND**
- **level02: READY FOR FRONTEND**
- **level03: READY FOR FRONTEND**
- **level04: READY FOR FRONTEND**
- **level05: READY FOR FRONTEND**
