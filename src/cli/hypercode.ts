#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { rpc } from "../protocol/client.js";
import { socketPath } from "../util/paths.js";

const program = new Command();

program
  .name("hypercode")
  .description("Symbolic code search for agent context")
  .version("0.1.0")
  .option("--debug", "Enable debug commands. Requires DEBUG=true.");

const daemon = program.command("daemon").description("Manage the local hypercode daemon");

daemon.command("start").description("Start hypercode-daemon").action(() => {
  if (fs.existsSync(socketPath())) {
    console.log(`hypercode-daemon appears to already be running at ${socketPath()}`);
    return;
  }
  const daemonPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../daemon/hypercode-daemon.js");
  const child = spawn(process.execPath, [daemonPath], { detached: true, stdio: "ignore" });
  child.unref();
  console.log(`started hypercode-daemon at ${socketPath()}`);
});

daemon.command("status").description("Check daemon health").action(async () => {
  await print(await rpc("health"), true);
});

daemon.command("stop").description("Stop hypercode-daemon").action(async () => {
  await print(await rpc("shutdown"), true);
});

const roots = program.command("roots").description("Manage indexed roots");

roots.command("add").argument("<path>").description("Add and index a root").action(async (rootPath: string) => {
  await print(await rpc("add_root", { path: rootPath }), true);
});

roots.command("remove").argument("<root>").description("Remove an indexed root by id or path").action(async (root: string) => {
  await print(await rpc("remove_root", { root }), true);
});

roots.command("list").description("List indexed roots").action(async () => {
  await print(await rpc("list_roots"), true);
});

roots.command("status").argument("[root]").description("Show background indexing status").action(async (root?: string) => {
  await print(await rpc("indexing_status", { root }), true);
});

program.command("search")
  .argument("<query>")
  .option("--root <root>", "Root id or path")
  .option("--limit <n>", "Maximum results", parseInt)
  .option("--json", "Print JSON")
  .description("Search indexed records")
  .action(async (query: string, options: { root?: string; limit?: number; json?: boolean }) => {
    await print(await rpc("search", { query, root: options.root, limit: options.limit }), Boolean(options.json));
  });

const inspect = program.command("inspect").description("Inspect indexed records");

inspect.command("symbol").argument("<fqn>").option("--root <root>", "Root id or path").option("--json", "Print JSON").action(async (fqn: string, options: { root?: string; json?: boolean }) => {
  await print(await rpc("inspect_symbol", { fqn, root: options.root }), Boolean(options.json));
});

inspect.command("record").argument("<record_id>").option("--json", "Print JSON").action(async (recordId: string, options: { json?: boolean }) => {
  await print(await rpc("get_record", { record_id: Number(recordId) }), Boolean(options.json));
});

inspect.command("parent").argument("<record_id>").option("--json", "Print JSON").action(async (recordId: string, options: { json?: boolean }) => {
  await print(await rpc("get_parent", { record_id: Number(recordId) }), Boolean(options.json));
});

inspect.command("children").argument("<record_id>").option("--json", "Print JSON").action(async (recordId: string, options: { json?: boolean }) => {
  await print(await rpc("get_children", { record_id: Number(recordId) }), Boolean(options.json));
});

inspect.command("duplicates").argument("<record_id>").option("--json", "Print JSON").action(async (recordId: string, options: { json?: boolean }) => {
  await print(await rpc("get_duplicates", { record_id: Number(recordId) }), Boolean(options.json));
});

const read = program.command("read").description("Read indexed source spans");

read.command("record").argument("<record_id>").option("--json", "Print JSON").action(async (recordId: string, options: { json?: boolean }) => {
  await print(await rpc("read_record", { record_id: Number(recordId) }), Boolean(options.json));
});

const debug = program.command("query:sqlite-fts5")
  .argument("<fts_query>")
  .option("--limit <n>", "Maximum rows", parseInt)
  .description("Debug: query SQLite FTS5")
  .action(async (query: string, options: { limit?: number }) => {
    requireCliDebug();
    await print(await rpc("debug_sqlite_fts5", { query, limit: options.limit }), true);
  });

program.command("query:sqlite-raw")
  .argument("<sql>")
  .description("Debug: run SELECT SQL against SQLite")
  .action(async (sql: string) => {
    requireCliDebug();
    await print(await rpc("debug_sqlite_raw", { sql }), true);
  });

program.command("query:lmdb")
  .argument("<prefix>")
  .argument("[count]", "Maximum entries", parseInt)
  .description("Debug: scan LMDB by prefix")
  .action(async (prefix: string, count?: number) => {
    requireCliDebug();
    await print(await rpc("debug_lmdb", { prefix, count }), true);
  });

program.command("dump:record")
  .argument("<record_id>")
  .description("Debug: dump a stored record")
  .action(async (recordId: string) => {
    requireCliDebug();
    await print(await rpc("debug_dump_record", { record_id: Number(recordId) }), true);
  });

program.command("dump:file")
  .argument("<root_id>")
  .argument("<file>")
  .description("Debug: dump records for a file")
  .action(async (rootId: string, file: string) => {
    requireCliDebug();
    await print(await rpc("debug_dump_file", { root_id: rootId, file }), true);
  });

program.command("stats")
  .description("Debug: dump index stats")
  .action(async () => {
    requireCliDebug();
    await print(await rpc("debug_stats"), true);
  });

await program.parseAsync(process.argv);

void debug;

function requireCliDebug(): void {
  if (program.opts<{ debug?: boolean }>().debug !== true || process.env.DEBUG !== "true") {
    throw new Error("Debug commands require --debug and DEBUG=true");
  }
}

async function print(value: unknown, json: boolean): Promise<void> {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value as Array<Record<string, unknown>>) {
      const id = item.record_id ?? item.id ?? "-";
      const details = typeof item.details === "object" && item.details !== null ? item.details as Record<string, unknown> : {};
      console.log(`${item.rank ?? "-"} ${id} ${item.display_name ?? details.fqn ?? ""} ${item.file ?? item.disk_path ?? ""}`);
      if (item.match_reasons) console.log(`  ${String((item.match_reasons as string[]).join(", "))}`);
      if (item.snippet) console.log(String(item.snippet).split("\n").slice(0, 8).map((line) => `  ${line}`).join("\n"));
    }
  } else if (typeof value === "object" && value !== null && "text" in value) {
    console.log(String((value as { text: string }).text));
  } else {
    console.log(JSON.stringify(value, null, 2));
  }
}
