import fs from "node:fs/promises";
import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import type { DocumentRef, RootConfig, RootIndexingStatus, SearchOptions, SearchResult } from "../types.js";
import { runAnnotators, type Annotator } from "../annotators/types.js";
import { crawlFilesystem, toDocumentRef } from "../crawlers/filesystem.js";
import { extractDocument } from "../extractors/router.js";
import { HyperIndex } from "./storage.js";
import { rootIdForPath } from "../util/normalize.js";
import { supportedExtension } from "../util/files.js";
import { RecordIdAllocator } from "../util/record-id.js";

export class IndexerService {
  private watchers = new Map<string, FSWatcher>();
  private queue = Promise.resolve();
  private ids = new RecordIdAllocator();
  private statuses = new Map<string, RootIndexingStatus>();
  private scheduledRoots = new Set<string>();

  constructor(private index = new HyperIndex(), private annotators: Annotator[] = []) {}

  close(): void {
    for (const watcher of this.watchers.values()) void watcher.close();
    this.index.close();
  }

  async addRoot(rootPath: string): Promise<RootConfig> {
    const diskPath = path.resolve(rootPath);
    await fs.access(diskPath);
    const existing = this.index.getRoot(diskPath);
    if (existing) {
      this.watchRoot(existing);
      this.scheduleRootIndex(existing);
      return existing;
    }
    const root: RootConfig = {
      id: rootIdForPath(diskPath),
      disk_path: diskPath,
      remote_paths: [],
      created_at: new Date().toISOString()
    };
    this.index.putRoot(root);
    this.watchRoot(root);
    this.scheduleRootIndex(root);
    return root;
  }

  async removeRoot(rootIdOrPath: string): Promise<{ removed: boolean }> {
    const root = this.index.getRoot(rootIdOrPath);
    if (!root) return { removed: false };
    await this.watchers.get(root.id)?.close();
    this.watchers.delete(root.id);
    this.statuses.delete(root.id);
    this.scheduledRoots.delete(root.id);
    this.index.removeRoot(root.id);
    return { removed: true };
  }

  listRoots(): RootConfig[] {
    return this.index.listRoots();
  }

  indexingStatus(rootIdOrPath?: string): RootIndexingStatus[] {
    if (rootIdOrPath) {
      const root = this.index.getRoot(rootIdOrPath);
      return root ? [this.statusFor(root.id)] : [];
    }
    return this.index.listRoots().map((root) => this.statusFor(root.id));
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    return this.index.hydrateSnippets(this.index.search(query, options));
  }

  inspectSymbol(fqn: string, root?: string) {
    return this.index.inspectSymbol(fqn, root);
  }

  getRecord(recordId: number) {
    return this.index.getRecord(recordId);
  }

  getParent(recordId: number) {
    return this.index.getParent(recordId);
  }

  getChildren(recordId: number) {
    return this.index.getChildren(recordId);
  }

  getDuplicates(recordId: number) {
    return this.index.getDuplicates(recordId);
  }

  readRecord(recordId: number) {
    return this.index.readRecord(recordId);
  }

  debugSqliteFts5(query: string, limit?: number) {
    return this.index.debugSqliteFts5(query, limit);
  }

  debugSqliteRaw(sql: string) {
    return this.index.debugSqliteRaw(sql);
  }

  debugLmdb(prefix: string, count?: number) {
    return this.index.debugLmdb(prefix, count);
  }

  debugDumpRecord(recordId: number) {
    return this.index.debugDumpRecord(recordId);
  }

  debugDumpFile(rootId: string, file: string) {
    return this.index.debugDumpFile(rootId, file);
  }

  debugStats() {
    return this.index.debugStats();
  }

  async startWatchers(): Promise<void> {
    for (const root of this.index.listRoots()) {
      this.watchRoot(root);
      this.scheduleRootIndex(root);
    }
  }

  private scheduleRootIndex(root: RootConfig): void {
    if (this.scheduledRoots.has(root.id)) return;
    this.scheduledRoots.add(root.id);
    this.setStatus(root.id, { status: "queued", queued_files: 0, indexed_files: 0 });
    void this.enqueue(async () => {
      try {
        await this.indexRoot(root);
      } finally {
        this.scheduledRoots.delete(root.id);
      }
    }).catch((error) => {
      this.setStatus(root.id, {
        status: "error",
        queued_files: this.statusFor(root.id).queued_files,
        indexed_files: this.statusFor(root.id).indexed_files,
        last_error: error instanceof Error ? error.message : String(error)
      });
    });
  }

  private async indexRoot(root: RootConfig): Promise<void> {
    this.setStatus(root.id, { status: "indexing", queued_files: 0, indexed_files: 0 });
    const docs = await crawlFilesystem(root);
    this.setStatus(root.id, { status: "indexing", queued_files: docs.length, indexed_files: 0 });
    let indexed = 0;
    for (const doc of docs) {
      await this.indexDocument(doc);
      indexed += 1;
      this.setStatus(root.id, { status: "indexing", queued_files: docs.length, indexed_files: indexed });
      await yieldToEventLoop();
    }
    this.setStatus(root.id, { status: "idle", queued_files: docs.length, indexed_files: indexed });
  }

  private watchRoot(root: RootConfig): void {
    if (this.watchers.has(root.id)) return;
    const watcher = chokidar.watch(root.disk_path, {
      ignored: /(^|[/\\])(\.git|node_modules|dist|coverage)([/\\]|$)/,
      ignoreInitial: true
    });
    watcher.on("add", (file) => this.onChanged(root, file));
    watcher.on("change", (file) => this.onChanged(root, file));
    this.watchers.set(root.id, watcher);
  }

  private onChanged(root: RootConfig, file: string): void {
    if (!supportedExtension(file)) return;
    const doc = toDocumentRef(root, file);
    if (!doc) return;
    void this.enqueue(() => this.indexDocument(doc));
  }

  private async indexDocument(doc: DocumentRef): Promise<void> {
    const extracted = await extractDocument({ document: doc, ids: this.ids });
    const ir = await runAnnotators(extracted, this.annotators);
    this.index.replaceFile(doc.root_id, doc.file, ir.records, ir.texts);
  }

  private statusFor(rootId: string): RootIndexingStatus {
    return this.statuses.get(rootId) ?? {
      root_id: rootId,
      status: "idle",
      queued_files: 0,
      indexed_files: 0,
      updated_at: new Date(0).toISOString()
    };
  }

  private setStatus(rootId: string, patch: Omit<Partial<RootIndexingStatus>, "root_id" | "updated_at">): void {
    const previous = this.statusFor(rootId);
    this.statuses.set(rootId, {
      ...previous,
      ...patch,
      root_id: rootId,
      updated_at: new Date().toISOString()
    });
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
