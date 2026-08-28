/**
 * Types for the browser-facing dataset produced by the offline binary-analysis
 * pipeline (`physical_level_delivery/web_game_data`). These mirror the shipped
 * JSON exactly; nothing here is invented, and the runtime never derives binary
 * facts of its own.
 */

export type LevelTheme =
  | "tutorial"
  | "vertical_chambers"
  | "scanner_chambers"
  | "forward_pressure"
  | "finale";

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
  | "checkpoint"
  | "cleanup"
  | "objective";

export type GrappleLinkKind = "required_progression" | "optional_decoy" | "optional_recovery";

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
  /** Empty for string-encrypted binaries (level 5). Never synthesise entries. */
  strings: string[];
}

export interface Provenance {
  classification: string;
  source: string;
  confidence: string;
  method: string;
}

export interface PlatformSpec {
  id: string;
  logical_node: string | null;
  occurrence: number;
  route_index: number | null;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: PlatformKind;
  required: boolean;
  raw_blocks: string[];
  display: CodeDisplay;
  semantic_event_ids: string[];
  anchor_platform?: string;
  cfg_distance?: number;
  provenance?: Provenance;
  mapping_note: string;
}

export interface GrappleLinkSpec {
  id: string;
  from: string;
  to: string;
  distance: number;
  kind: GrappleLinkKind;
  required: boolean;
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

export interface AnalysisMetadata {
  projection_schema_version: number;
  loop_strategy: string;
  raw_ordered_execution_count: number;
  raw_unique_executed_blocks: number;
  physical_route_instances: number;
  repeated_logical_nodes: number;
  repeated_physical_instances: number;
  crumble_selection: string;
  string_encryption: boolean;
  plaintext_display_policy: string;
  source_sha256: string;
  executable_sha256: string;
  fixed_recipe: Record<string, string | number | boolean>;
}

export interface LevelData {
  schema_version: number;
  level: {
    id: string;
    name: string;
    theme: LevelTheme;
    direction: string;
    binary_candidate: string;
  };
  world: WorldSpec;
  player: { spawn: { x: number; y: number; platform: string } };
  movement_model: {
    config_version: number;
    maximum_required_grapple_distance: number;
    maximum_vertical_delta: number;
  };
  route: {
    platform_ids: string[];
    chronology: string;
    logical_node_occurrences: Record<string, number>;
  };
  grapple_links: GrappleLinkSpec[];
  events: SemanticEventSpec[];
  checkpoints: CheckpointSpec[];
  objective: ObjectiveSpec;
  analysis_metadata: AnalysisMetadata;
  platforms: PlatformSpec[];
}

export interface LevelIndexEntry {
  id: string;
  name: string;
  theme: LevelTheme;
  path: string;
  world: WorldSpec;
  platform_count: number;
}

export interface LevelIndex {
  schema_version: number;
  levels: LevelIndexEntry[];
}
