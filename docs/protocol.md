# Protocol

The CLI talks to `hypercode-daemon` over a Unix domain socket using length-prefixed JSON frames.

Each request includes:

```json
{
  "id": "request-id",
  "method": "search",
  "params": {}
}
```

Each response includes:

```json
{
  "id": "request-id",
  "ok": true,
  "result": {}
}
```

Daemon methods:

- `health`
- `shutdown`
- `add_root`
- `remove_root`
- `list_roots`
- `indexing_status`
- `search`
- `inspect_symbol`
- `get_record`
- `get_parent`
- `get_children`
- `get_duplicates`
- `read_record`
- `debug_sqlite_fts5`
- `debug_sqlite_raw`
- `debug_lmdb`
- `debug_dump_record`
- `debug_dump_file`
- `debug_stats`

`read_record` returns only the source span for the target record.

Debug methods require `DEBUG=true` on the daemon process. The CLI also requires `--debug` plus `DEBUG=true`.
