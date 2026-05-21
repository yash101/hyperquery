export interface RpcRequest {
  id: string;
  method:
    | "add_root"
    | "remove_root"
    | "list_roots"
    | "indexing_status"
    | "search"
    | "inspect_symbol"
    | "get_record"
    | "get_parent"
    | "get_children"
    | "get_duplicates"
    | "read_record"
    | "debug_sqlite_fts5"
    | "debug_sqlite_raw"
    | "debug_lmdb"
    | "debug_dump_record"
    | "debug_dump_file"
    | "debug_stats"
    | "health"
    | "shutdown";
  params?: Record<string, unknown>;
}

export interface RpcResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}
