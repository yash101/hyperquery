# Extractors

Extractors convert `DocumentRef` inputs into IR. They do not write indexes directly.

## TypeScript And JavaScript

The TS/JS extractor uses the TypeScript compiler API. It emits file records, functions, classes, methods, fields, interfaces, types, enums, docs, comments, string literals, and best-effort symbol references.

## Native And Doxygen

The native extractor tries Doxygen first. Doxygen XML is parsed for classes, functions, line numbers, signatures, and occurrence roles. If Doxygen fails or returns no useful records, Hypercode falls back to a lightweight scanner.

Header declarations and source implementations can share a duplicate group while remaining separate records.

## Markdown

Markdown files emit a file record and heading records. Heading text and body text are indexed into FTS5 with line spans preserved.

## Jupyter

Jupyter notebooks emit a file record and markdown-cell records. v1 indexes markdown cells only. Code cells and outputs are deferred, while outputs can be represented as unindexable attachment references for future annotators.
