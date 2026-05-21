# Architecture

Hypercode is split into a staged local indexing pipeline:

1. Crawlers discover documents under a root and emit `DocumentRef` objects.
2. Extractors parse documents and emit an intermediate representation, or IR.
3. Annotators can enrich IR before indexing. The interface exists now; no annotators ship yet.
4. Indexers persist the IR. LMDB stores code-optimized record indexes, while SQLite FTS5 stores searchable text.
5. The daemon orchestrates the pipeline and serves the CLI over a Unix socket.

The filesystem crawler currently emits source files, markdown files, and Jupyter notebooks. The daemon owns roots, file watching, reindexing, and query handling.

Root registration is intentionally non-blocking. `roots add` persists the root, attaches the file watcher, schedules background indexing, and returns immediately. The indexing queue then crawls and extracts documents in the background. Clients can inspect progress through root indexing status.

The important architectural boundary is that extractors do not write indexes. They only produce IR. That keeps future extractors, crawlers, and annotators from needing to know LMDB or SQLite details.
