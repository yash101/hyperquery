# Data Model

The public record shape is `CodeDetails`:

```ts
interface CodeDetails {
  record_id: number;
  fqn: string;
  kind: "file" | "namespace" | "class" | "function" | "method" | "field" | "line" | string;
  parent_id: number | null;
  child_ids: number[];
  root_id: string;
  file: string;
  start_line: number;
  end_line: number;
  ref_in: string[] | null;
  ref_in_ct: number;
  ref_out: string[];
}
```

`record_id` is a monotonic microsecond timestamp. It is numeric everywhere and is stored under `rc:{record_id}` with zero padding so LMDB range scans preserve recency order.

Richer indexing data lives in `RecordMetadata`: display names, normalized names, signatures, docs, string literals, language, duplicate group keys, occurrence roles, primary occurrence markers, and future attachment references.

## LMDB Keys

- `rt:{root_id}` stores roots.
- `rc:{record_id}` stores full records plus metadata.
- `lr:{root_id}:{file}:{start_line}` maps source locations to record IDs.
- `sf:{fqn}:{record_id}` maps FQNs to one or more records.
- `sb:{reversed_fqn}:{record_id}` supports suffix lookups.
- `sfn:{normalized_fqn}:{record_id}` supports normalized exact lookup.
- `sbn:{normalized_reversed_fqn}:{record_id}` supports normalized suffix lookup.
- `dg:{duplicate_group_key}:{record_id}` links duplicate occurrences.

## Duplicates

Duplicate FQNs are valid. A C++ header declaration and source implementation each get a unique `record_id`, while sharing a duplicate group key when they represent the same logical symbol.

Search prefers primary occurrences, especially implementations, but keeps related duplicate IDs visible so agents can inspect declarations and implementations separately.

## SQLite FTS5

SQLite FTS5 indexes comments, docs, strings, markdown, and notebook markdown. Text rows include `record_id`, `symbol_fqn`, file, line, and text kind.

Debug raw SQL is intentionally limited to `SELECT` statements.
