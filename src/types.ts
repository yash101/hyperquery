export type FQN = string;
export type RootId = string;

export type RecordKind =
  | "file"
  | "namespace"
  | "class"
  | "function"
  | "method"
  | "field"
  | "line"
  | "interface"
  | "type"
  | "enum"
  | "markdown_heading"
  | "notebook_cell"
  | "native"
  | string;

export type TextKind = "comment" | "doc" | "string" | "markdown" | "notebook_markdown";

export type OccurrenceRole = "declaration" | "definition" | "implementation" | "overload" | "generated" | "unknown";

export interface RootConfig {
  id: RootId;
  disk_path: string;
  remote_paths: string[];
  created_at: string;
}

export interface CodeDetails {
  record_id: number;
  fqn: FQN;
  kind: RecordKind;
  parent_id: number | null;
  child_ids: number[];
  root_id: RootId;
  file: string;
  start_line: number;
  end_line: number;
  ref_in: string[] | null;
  ref_in_ct: number;
  ref_out: string[];
}

export interface AttachmentRef {
  attachment_id: string;
  kind: string;
  source: string;
  metadata?: Record<string, unknown>;
}

export interface RecordMetadata {
  record_id: number;
  display_name: string;
  normalized_fqn: string;
  normalized_display_name: string;
  signature?: string;
  doc_text?: string;
  string_literals?: string[];
  language?: string;
  duplicate_group_key?: string;
  occurrence_role?: OccurrenceRole;
  is_primary_occurrence?: boolean;
  unindexable_attachments?: AttachmentRef[];
}

export interface IndexRecord {
  details: CodeDetails;
  metadata: RecordMetadata;
  snippet_cache?: string;
}

export interface TextEntry {
  root_id: RootId;
  file: string;
  line: number;
  record_id: number;
  symbol_fqn: FQN;
  text: string;
  text_kind: TextKind;
}

export interface DocumentRef {
  root_id: RootId;
  root_path: string;
  file: string;
  kind: "source" | "markdown" | "notebook";
  language: string;
  metadata: Record<string, unknown>;
}

export interface ExtractedIR {
  document: DocumentRef;
  records: IndexRecord[];
  texts: TextEntry[];
  attachments: AttachmentRef[];
  metadata: Record<string, unknown>;
}

export interface SearchResult {
  rank: number;
  score: number;
  record_id: number;
  fqn: FQN;
  display_name: string;
  kind: RecordKind;
  parent_id: number | null;
  child_ids: number[];
  file: string;
  start_line: number;
  end_line: number;
  language?: string;
  signature?: string;
  snippet: string;
  match_reasons: string[];
  ref_in_ct: number;
  ref_out_preview: string[];
  duplicate_group_key?: string;
  occurrence_role?: OccurrenceRole;
  related_record_ids: number[];
}

export interface SearchOptions {
  root?: string;
  limit?: number;
}

export type IndexingStatusState = "queued" | "indexing" | "idle" | "error";

export interface RootIndexingStatus {
  root_id: RootId;
  status: IndexingStatusState;
  queued_files: number;
  indexed_files: number;
  last_error?: string;
  updated_at: string;
}

export interface DebugLmdbEntry {
  key: string;
  value: unknown;
}

export interface DebugStats {
  roots: number;
  records: number;
  fts_rows: number;
  lmdb_keys_sampled: number;
}
