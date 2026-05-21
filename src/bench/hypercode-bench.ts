#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { IndexerService } from "../index/indexer.js";

interface BenchCase {
  query: string;
  expected_fqns: string[];
}

interface BenchFile {
  root: string;
  cases: BenchCase[];
}

const file = process.argv[2];
if (!file) {
  console.error("Usage: hypercode-bench <benchmark.json>");
  process.exit(1);
}

const bench = JSON.parse(await fs.readFile(file, "utf8")) as BenchFile;
process.env.HYPERCODE_DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "hypercode-bench-"));
const service = new IndexerService();
await service.addRoot(bench.root);
await waitForIdle(bench.root, service);

let hits = 0;
const rows = [];
for (const item of bench.cases) {
  const results = await service.search(item.query, { limit: 10 });
  const fqns = new Set(results.map((result) => result.fqn));
  const hit = item.expected_fqns.some((expected) => fqns.has(expected));
  if (hit) hits += 1;
  rows.push({ query: item.query, hit, top: results.slice(0, 3).map((result) => result.fqn) });
}

console.log(JSON.stringify({
  cases: bench.cases.length,
  hits,
  hit_rate: bench.cases.length === 0 ? 0 : hits / bench.cases.length,
  rows
}, null, 2));

service.close();

async function waitForIdle(root: string, svc: IndexerService): Promise<void> {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const [status] = svc.indexingStatus(root);
    if (status?.status === "idle") return;
    if (status?.status === "error") throw new Error(status.last_error ?? "indexing failed");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${root} to index`);
}
