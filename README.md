# Hypercode

Symbolic code search for agent context.

Hypercode indexes code as records, graph relationships, comments, docs, strings, markdown, and notebook markdown. The first implementation is a local Node.js + TypeScript research prototype with a daemon, Unix socket protocol, agent-friendly CLI, and benchmark harness.

## Quick Start

```sh
npm install
npm run build
hypercode daemon start
hypercode roots add /path/to/repo
hypercode roots status /path/to/repo
hypercode search "Authorization" --json
```

During development, run commands with `tsx`:

```sh
npx tsx src/cli/hypercode.ts roots add .
npx tsx src/cli/hypercode.ts search "search context" --json
```

## Commands

- `hypercode daemon start`
- `hypercode daemon status`
- `hypercode roots add <path>`
- `hypercode roots remove <path>`
- `hypercode roots list`
- `hypercode roots status [root]`
- `hypercode search <query> [--root <root>] [--limit <n>] [--json]`
- `hypercode inspect symbol <fqn> [--root <root>] [--json]`
- `hypercode inspect record <record_id> [--json]`
- `hypercode inspect parent <record_id> [--json]`
- `hypercode inspect children <record_id> [--json]`
- `hypercode inspect duplicates <record_id> [--json]`
- `hypercode read record <record_id> [--json]`
- `hypercode-bench <benchmark.json>`

`roots add` persists the root and watch immediately, then indexes in the background. Use `roots status` or `daemon status` to observe progress.

## Debug Commands

Debug tools are available only when the daemon process and CLI command run with `DEBUG=true`, and the CLI is invoked with `--debug`:

- `DEBUG=true hypercode --debug query:sqlite-fts5 <fts query>`
- `DEBUG=true hypercode --debug query:sqlite-raw <sql>`
- `DEBUG=true hypercode --debug query:lmdb <prefix> <count>`
- `DEBUG=true hypercode --debug dump:record <record_id>`
- `DEBUG=true hypercode --debug dump:file <root_id> <file>`
- `DEBUG=true hypercode --debug stats`

## Documentation

- [Architecture](docs/architecture.md)
- [Data model](docs/data-model.md)
- [Extractors](docs/extractors.md)
- [Protocol](docs/protocol.md)
- [Benchmarks](docs/benchmarks.md)
