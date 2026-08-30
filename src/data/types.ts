/**
 * Types for the browser-facing dataset produced by the offline binary-analysis
 * pipeline (`physical_level_delivery_v2/web_game_data`, schema version 2).
 * These mirror the shipped JSON exactly; nothing here is invented, and the
 * runtime never derives binary facts of its own.
 */

/** One theme per mission. The engine reads gameplay behaviour off these. */
export type LevelTheme =
  | "tutorial_horizontal"
  | "gated_mixed"
  | "scanner_zigzag"
  | "pressure_momentum"
  | "mixed_first_finale"
  | "fork_reconvergence"
  | "vertical_containment"
  | "multiphase_finale";

/** Physical object classes the exporter emits. */
export type PlatformKind = "start" | "route" | "checkpoint" | "objective" | "crumble";

/** Semantic call-site classes the exporter emits. */
export type SemanticEventType =
  | "authentication"
  | "network_scan"
  | "firewall"
  | "scanner"
  | "watchdog"
  | "decrypt"
  | "transfer"
  | "navigation"
  | "reconvergence"
  | "checkpoint"
  | "cleanup"
  | "objective";

/**
 * Link kinds are *physical gameplay* relationships only. `optional_fake_choice`
 * and `optional_apparent_progression` deliberately do not assert a machine-CFG
 * edge; see `MachineTruth` for the CFG the binary actually has.
 */
export type GrappleLinkKind =
  | "required_progression"
  | "optional_apparent_progression"
  | "optional_fake_choice";

/** How a crumble platform is meant to tempt the player. */
export type PhysicalRole =
  | "alternate_route"
  | "apparent_safe_zone"
  | "apparent_shortcut"
  | "false_recovery"
  | "forward_anchor"
  | "gap_stepping_stone"
  | "gate_bypass"
  | "high_route"
  | "low_route"
  | "reconvergence_shortcut"
  | "recovery_ledge"
  | "shaft_shortcut"
  | "side_recovery"
  | "tutorial_crumble"
  | "upward_step";

export interface WorldSpec {
  width: number;
  height: number;
  death_y: number;
  units: string;
}

export interface CodeDisplay {
  address: string;
  entry_rva: string;
  instructions: string[];
  /** Empty for string-encrypted binaries (levels 5 and 8). Never synthesise entries. */
  strings: string[];
}

export interface Provenance {
  classification: string;
  source: string;
  confidence: string;
  method: string;
}

/** One chronological visit to a gameplay node, in trace order. */
export interface TraceOccurrence {
  index: number;
  logical_node: string;
}

export interface CfgEdge {
  target?: string;
  source?: string;
  kind: string;
}

/**
 * The machine control flow a crumble platform's block actually has. This is
 * binary truth and is kept strictly apart from `grapple_links`, which are
 * gameplay-only.
 */
export interface MachineTruth {
  raw_block: string;
  start_rva: string;
  actual_cfg_successors: CfgEdge[];
  actual_cfg_predecessors: CfgEdge[];
  physical_links_are_separate: boolean;
}

/** Why a bogus block was rich enough to be worth showing the player. */
export interface Richness {
  visual_richness_score: number;
  instruction_count: number;
  control_flow_instruction_count: number;
  conditional_branch_count: number;
  unconditional_branch_count: number;
  arithmetic_boolean_instruction_count: number;
  arithmetic_density: number;
  memory_load_store_count: number;
  call_count: number;
  comparison_test_count: number;
  unique_mnemonic_count: number;
  one_instruction_only: boolean;
  two_or_fewer_instructions: boolean;
  unconditional_jump_only: boolean;
  branch_control_flow_only: boolean;
  no_arithmetic_boolean: boolean;
  no_memory_operations: boolean;
  trivial_glue: boolean;
}

export interface PlatformSpec {
  id: string;
  /** First logical node of the segment; null for a crumble block. */
  logical_node: string | null;
  /** Every gameplay node this physical segment compacts, in order. */
  logical_nodes: string[];
  occurrence: number;
  route_index: number | null;
  trace_occurrence_start: number | null;
  trace_occurrence_end_exclusive: number | null;
  trace_occurrences: TraceOccurrence[];
  x: number;
  y: number;
  width: number;
  height: number;
  kind: PlatformKind;
  required: boolean;
  raw_blocks: string[];
  display: CodeDisplay;
  semantic_event_ids: string[];
  /** Crumble platforms only, from here down. */
  physical_role?: PhysicalRole;
  physical_anchor_platform?: string;
  apparent_target_platform?: string;
  plausible_fake_choice?: boolean;
  machine_adjacent_route_indices?: number[];
  cfg_distance?: number;
  provenance?: Provenance;
  richness?: Richness;
  machine_truth?: MachineTruth;
  mapping_note: string;
}

export interface GrappleLinkSpec {
  id: string;
  from: string;
  to: string;
  distance: number;
  kind: GrappleLinkKind;
  required: boolean;
  /** Always `physical_gameplay`: a link is never a claim about machine CFG. */
  relationship_layer: string;
}

export interface SemanticEventSpec {
  id: string;
  type: SemanticEventType;
  platform: string;
  raw_block: string;
  instruction_address: string;
  call_target: string;
  call_site_occurrence: number;
  params: Record<string, string | number | boolean>;
  source_event_instance: string;
}

export interface CheckpointSpec {
  id: string;
  sequence: number;
  platform: string;
  respawn: { x: number; y: number };
}

export interface ObjectiveSpec {
  id: string;
  platform: string;
  region: { x: number; y: number; width: number; height: number };
}

/** How much genuine physical route choice the exporter built into a level. */
export interface PhysicalChoiceSummary {
  plausible_fake_choice_situations: number;
  route_choice_density: number;
  selected_bogus_platforms: number;
  apparent_shortcuts: number;
  recovery_looking: number;
  apparent_alternate_route_members: number;
  role_counts: Record<string, number>;
}

export interface AnalysisMetadata {
  projection_schema_version: number;
  source_gameplay_trace_length: number;
  raw_ordered_execution_count: number;
  raw_unique_executed_blocks: number;
  physical_route_instances: number;
  strong_bogus_machine_blocks: number;
  direct_strong_bogus_candidates: number;
  selected_strong_bogus_candidates: number;
  selected_average_richness: number;
  selected_jump_only: number;
  selected_trivial_glue: number;
  crumble_selection: string;
  string_encryption: boolean;
  plaintext_display_policy: string;
  source_sha256: string;
  executable_sha256: string;
  input_validation_ok: boolean;
  input_trace_stop_reason: string;
  input_trace_return: number;
  fixed_recipe: Record<string, string | number | boolean>;
}

export interface LevelData {
  schema_version: number;
  level: {
    id: string;
    number: number;
    name: string;
    theme: LevelTheme;
    spatial_identity: string;
    direction: string;
    binary_candidate: string;
  };
  world: WorldSpec;
  player: { spawn: { x: number; y: number; platform: string } };
  movement_model: {
    config_version: number;
    solver: string;
    maximum_required_grapple_distance: number;
    maximum_optional_grapple_distance: number;
    maximum_vertical_delta: number;
  };
  route: {
    platform_ids: string[];
    chronology: string;
    source_gameplay_trace_length: number;
    visible_route_target: number;
    logical_node_physical_instances: Record<string, string[]>;
  };
  grapple_links: GrappleLinkSpec[];
  events: SemanticEventSpec[];
  checkpoints: CheckpointSpec[];
  objective: ObjectiveSpec;
  physical_choice_summary: PhysicalChoiceSummary;
  analysis_metadata: AnalysisMetadata;
  platforms: PlatformSpec[];
}

export interface LevelIndexEntry {
  id: string;
  number: number;
  name: string;
  theme: LevelTheme;
  spatial_identity: string;
  path: string;
  world: WorldSpec;
  platform_count: number;
}

export interface LevelIndex {
  schema_version: number;
  level_count: number;
  levels: LevelIndexEntry[];
}
