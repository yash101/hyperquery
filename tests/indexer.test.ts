import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IndexerService } from "../src/index/indexer.js";
import { RecordIdAllocator } from "../src/util/record-id.js";

let service: IndexerService;
let dataDir: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "hypercode-test-"));
  process.env.HYPERCODE_DATA_DIR = dataDir;
  service = new IndexerService();
});

afterEach(() => {
  service.close();
  delete process.env.HYPERCODE_DATA_DIR;
});

describe("RecordIdAllocator", () => {
  it("generates numeric strictly increasing IDs", () => {
    const ids = new RecordIdAllocator();
    const first = ids.next();
    const second = ids.next();
    expect(typeof first).toBe("number");
    expect(second).toBeGreaterThan(first);
  });
});

describe("IndexerService", () => {
  it("indexes TS records with hierarchy and normalized search", async () => {
    const root = path.resolve("tests/fixtures/sample-ts");
    await service.addRoot(root);
    await waitForIdle(root);
    const results = await service.search("buildAuthorizationHeader", { root, limit: 5 });
    expect(results[0]?.display_name).toBe("buildAuthorizationHeader");
    expect(results[0]?.record_id).toEqual(expect.any(Number));
    expect(results[0]?.parent_id).toEqual(expect.any(Number));
    expect(results[0]?.match_reasons).toContain("normalized_suffix_match");
    const parent = service.getParent(results[0]!.record_id);
    expect(parent?.details.kind).toBe("file");
    expect(parent?.details.child_ids).toContain(results[0]!.record_id);
  });

  it("uses LMDB prefix scans for FQN and normalized FQN search", async () => {
    const root = path.resolve("tests/fixtures/sample-ts");
    await service.addRoot(root);
    await waitForIdle(root);
    const fqnResults = await service.search("src/auth", { root, limit: 5 });
    expect(fqnResults.some((result) => result.match_reasons.includes("fqn_prefix_match"))).toBe(true);
    const normalizedResults = await service.search("srcauth", { root, limit: 5 });
    expect(normalizedResults.some((result) => result.match_reasons.includes("normalized_fqn_prefix_match"))).toBe(true);
  });

  it("indexes comments, strings, markdown, and notebook markdown in FTS5", async () => {
    const root = path.resolve("tests/fixtures/sample-ts");
    await service.addRoot(root);
    await waitForIdle(root);
    const commentResults = await service.search("outgoing HTTP requests", { root, limit: 5 });
    expect(commentResults.some((result) => result.match_reasons.includes("fts_doc_hit"))).toBe(true);
    const stringResults = await service.search("Authorization", { root, limit: 5 });
    expect(stringResults.some((result) => result.match_reasons.includes("fts_string_hit"))).toBe(true);
    const markdownResults = await service.search("retry guide", { root, limit: 5 });
    expect(markdownResults.some((result) => result.match_reasons.includes("fts_markdown_hit"))).toBe(true);
    const notebookResults = await service.search("ECONNRESET", { root, limit: 5 });
    expect(notebookResults.some((result) => result.kind === "notebook_cell")).toBe(true);
  });

  it("reads only a record span", async () => {
    const root = path.resolve("tests/fixtures/sample-ts");
    await service.addRoot(root);
    await waitForIdle(root);
    const [result] = await service.search("RetryBackoff", { root, limit: 1 });
    const read = await service.readRecord(result.record_id);
    expect(read?.text).toContain("class RetryBackoff");
    expect(read?.text).not.toContain("buildAuthorizationHeader");
  });

  it("exposes debug stats and raw index queries", async () => {
    const root = path.resolve("tests/fixtures/sample-ts");
    await service.addRoot(root);
    await waitForIdle(root);
    expect(service.debugStats().records).toBeGreaterThan(0);
    expect(service.debugSqliteFts5("Authorization").length).toBeGreaterThan(0);
    expect(service.debugLmdb("rc:", 1).length).toBe(1);
    expect(() => service.debugSqliteRaw("DELETE FROM text_search")).toThrow(/SELECT/);
  });

  it("keeps duplicate native records and exposes duplicate lookup", async () => {
    const root = path.resolve("tests/fixtures/sample-native");
    await service.addRoot(root);
    await waitForIdle(root);
    const results = await service.search("compute", { root, limit: 10 });
    expect(results.length).toBeGreaterThanOrEqual(2);
    const duplicateIds = new Set(results.flatMap((result) => [result.record_id, ...result.related_record_ids]));
    expect(duplicateIds.size).toBeGreaterThanOrEqual(2);
    const duplicates = service.getDuplicates(results[0]!.record_id);
    expect(duplicates.length).toBeGreaterThanOrEqual(2);
  });

  it("updates stale file records on change", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hypercode-root-"));
    const src = path.join(tempRoot, "index.ts");
    await fs.writeFile(src, "export function beforeName() { return \"before\"; }\n");
    await service.addRoot(tempRoot);
    await waitForIdle(tempRoot);
    expect((await service.search("beforeName", { root: tempRoot })).length).toBeGreaterThan(0);
    await fs.writeFile(src, "export function afterName() { return \"after\"; }\n");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await service.search("afterName", { root: tempRoot })).length).toBeGreaterThan(0);
    expect((await service.search("beforeName", { root: tempRoot })).length).toBe(0);
  });
});

async function waitForIdle(root: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const [status] = service.indexingStatus(root);
    if (status?.status === "idle") return;
    if (status?.status === "error") throw new Error(status.last_error ?? "indexing failed");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${root} to index`);
}
