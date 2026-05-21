import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { open, type RootDatabase } from "lmdb";
import type { CodeDetails, DebugLmdbEntry, DebugStats, IndexRecord, RecordMetadata, RootConfig, SearchResult, TextEntry, TextKind } from "../types.js";
import { dataDir } from "../util/paths.js";
import { normalizeName, reverseString } from "../util/normalize.js";
import { readSnippet } from "../util/files.js";
import { recordKey } from "../util/record-id.js";

interface StoredRecord extends IndexRecord {}

interface Candidate {
  record: StoredRecord;
  score: number;
  reasons: Set<string>;
}

interface FtsRow {
  record_id: number;
  text_kind: TextKind;
  rank: number;
}

export class LmdbCodeIndexer {
  constructor(private kv: RootDatabase) {}

  putRoot(root: RootConfig): void {
    this.kv.putSync(`rt:${root.id}`, root);
  }

  getRoot(idOrPath: string): RootConfig | undefined {
    const direct = this.kv.get(`rt:${idOrPath}`) as RootConfig | undefined;
    if (direct) return direct;
    const resolved = path.resolve(idOrPath);
    return this.listRoots().find((root) => root.disk_path === idOrPath || root.disk_path === resolved);
  }

  listRoots(): RootConfig[] {
    const roots: RootConfig[] = [];
    for (const { value } of this.kv.getRange({ start: "rt:", end: "rt:\xFF" })) roots.push(value as RootConfig);
    return roots;
  }

  removeRoot(rootId: string): void {
    for (const record of this.recordsForRoot(rootId)) this.deleteRecord(record);
    this.kv.removeSync(`rt:${rootId}`);
  }

  replaceFile(rootId: string, file: string, records: IndexRecord[]): void {
    const affected = new Set<number>();
    for (const { key, value } of this.kv.getRange({ start: `lr:${rootId}:${file}:`, end: `lr:${rootId}:${file}:\xFF` })) {
      affected.add(Number(value));
      this.kv.removeSync(key);
    }
    for (const id of affected) {
      const record = this.getRecord(id);
      if (record) this.deleteRecord(record);
    }
    this.insertRecords(records);
    this.recomputeRelationships(rootId);
    this.markPrimaryOccurrences(rootId);
  }

  insertRecords(records: IndexRecord[]): void {
    for (const record of records) {
      const stored = record as StoredRecord;
      this.kv.putSync(`rc:${recordKey(record.details.record_id)}`, stored);
      this.kv.putSync(`sf:${record.details.fqn}:${recordKey(record.details.record_id)}`, record.details.record_id);
      this.kv.putSync(`sb:${reverseString(record.details.fqn)}:${recordKey(record.details.record_id)}`, record.details.record_id);
      this.kv.putSync(`sfn:${record.metadata.normalized_fqn}:${recordKey(record.details.record_id)}`, record.details.record_id);
      this.kv.putSync(`sbn:${reverseString(record.metadata.normalized_fqn)}:${recordKey(record.details.record_id)}`, record.details.record_id);
      if (record.metadata.duplicate_group_key) this.kv.putSync(`dg:${record.metadata.duplicate_group_key}:${recordKey(record.details.record_id)}`, record.details.record_id);
      this.kv.putSync(`lr:${record.details.root_id}:${record.details.file}:${record.details.start_line}`, record.details.record_id);
    }
  }

  deleteRecord(record: StoredRecord): void {
    this.kv.removeSync(`rc:${recordKey(record.details.record_id)}`);
    this.kv.removeSync(`sf:${record.details.fqn}:${recordKey(record.details.record_id)}`);
    this.kv.removeSync(`sb:${reverseString(record.details.fqn)}:${recordKey(record.details.record_id)}`);
    this.kv.removeSync(`sfn:${record.metadata.normalized_fqn}:${recordKey(record.details.record_id)}`);
    this.kv.removeSync(`sbn:${reverseString(record.metadata.normalized_fqn)}:${recordKey(record.details.record_id)}`);
    if (record.metadata.duplicate_group_key) this.kv.removeSync(`dg:${record.metadata.duplicate_group_key}:${recordKey(record.details.record_id)}`);
    this.kv.removeSync(`lr:${record.details.root_id}:${record.details.file}:${record.details.start_line}`);
  }

  getRecord(recordId: number): StoredRecord | undefined {
    return this.kv.get(`rc:${recordKey(recordId)}`) as StoredRecord | undefined;
  }

  getParent(recordId: number): StoredRecord | null {
    const record = this.getRecord(recordId);
    return record?.details.parent_id == null ? null : this.getRecord(record.details.parent_id) ?? null;
  }

  getChildren(recordId: number): StoredRecord[] {
    const record = this.getRecord(recordId);
    return record ? record.details.child_ids.map((id) => this.getRecord(id)).filter((item): item is StoredRecord => Boolean(item)) : [];
  }

  getDuplicates(recordId: number): StoredRecord[] {
    const record = this.getRecord(recordId);
    const key = record?.metadata.duplicate_group_key;
    return key ? this.recordsByIndexPrefix(`dg:${key}:`) : [];
  }

  recordsForRoot(rootId: string): StoredRecord[] {
    const records: StoredRecord[] = [];
    for (const { value } of this.kv.getRange({ start: "rc:", end: "rc:\xFF" })) {
      const record = value as StoredRecord;
      if (record.details.root_id === rootId) records.push(record);
    }
    return records;
  }

  recordsByFqn(fqn: string, rootId?: string): StoredRecord[] {
    return this.recordsByIndexPrefix(`sf:${fqn}:`, rootId);
  }

  recordsByNormalizedFqn(normalized: string, rootId?: string): StoredRecord[] {
    return this.recordsByIndexPrefix(`sfn:${normalized}:`, rootId);
  }

  recordsByFqnPrefix(fqnPrefix: string, rootId?: string, limit = 100): StoredRecord[] {
    return this.recordsByIndexPrefix(`sf:${fqnPrefix}`, rootId, limit);
  }

  recordsByNormalizedFqnPrefix(normalizedPrefix: string, rootId?: string, limit = 100): StoredRecord[] {
    return this.recordsByIndexPrefix(`sfn:${normalizedPrefix}`, rootId, limit);
  }

  recordsBySuffix(query: string, normalized: boolean, rootId?: string, limit = 100): StoredRecord[] {
    const prefix = normalized ? `sbn:${reverseString(query)}` : `sb:${reverseString(query)}`;
    return this.recordsByIndexPrefix(prefix, rootId, limit);
  }

  recordsByIds(ids: number[], rootId?: string): StoredRecord[] {
    return ids.map((id) => this.getRecord(id)).filter((record): record is StoredRecord => {
      return record != null && (!rootId || record.details.root_id === rootId);
    });
  }

  debugPrefix(prefix: string, count: number): DebugLmdbEntry[] {
    const entries: DebugLmdbEntry[] = [];
    for (const { key, value } of this.kv.getRange({ start: prefix, end: `${prefix}\xFF` })) {
      entries.push({ key: String(key), value });
      if (entries.length >= count) break;
    }
    return entries;
  }

  debugKeyCount(limit = 100000): number {
    let count = 0;
    for (const _entry of this.kv.getRange({ start: "", end: "\xFF" })) {
      count += 1;
      if (count >= limit) break;
    }
    return count;
  }

  private recordsByIndexPrefix(prefix: string, rootId?: string, limit = 100): StoredRecord[] {
    const records: StoredRecord[] = [];
    for (const { value } of this.kv.getRange({ start: prefix, end: `${prefix}\xFF` })) {
      const record = this.getRecord(Number(value));
      if (record && (!rootId || record.details.root_id === rootId)) records.push(record);
      if (records.length >= limit) break;
    }
    return records;
  }

  private recomputeRelationships(rootId: string): void {
    const records = this.recordsForRoot(rootId);
    const byFqn = new Map(records.map((record) => [record.details.fqn, record]));
    const refIn = new Map<string, string[]>();
    for (const record of records) {
      for (const ref of record.details.ref_out) {
        const target = byFqn.get(ref);
        if (!target) continue;
        const arr = refIn.get(target.details.fqn) ?? [];
        arr.push(record.details.fqn);
        refIn.set(target.details.fqn, arr);
      }
    }
    for (const record of records) {
      const refs = refIn.get(record.details.fqn) ?? [];
      record.details.ref_in = refs.length > 0 ? refs : null;
      record.details.ref_in_ct = refs.length;
      this.kv.putSync(`rc:${recordKey(record.details.record_id)}`, record);
    }
  }

  private markPrimaryOccurrences(rootId: string): void {
    const groups = new Map<string, StoredRecord[]>();
    for (const record of this.recordsForRoot(rootId)) {
      const key = record.metadata.duplicate_group_key;
      if (!key) continue;
      const group = groups.get(key) ?? [];
      group.push(record);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      const primary = [...group].sort(compareOccurrence)[0];
      for (const record of group) {
        record.metadata.is_primary_occurrence = record.details.record_id === primary.details.record_id;
        this.kv.putSync(`rc:${recordKey(record.details.record_id)}`, record);
      }
    }
  }
}

export class SqliteTextIndexer {
  private sqlite: Database.Database;

  constructor(baseDir: string) {
    this.sqlite = new Database(path.join(baseDir, "text.sqlite"));
    this.init();
  }

  close(): void {
    this.sqlite.close();
  }

  deleteRoot(rootId: string): void {
    this.sqlite.prepare("DELETE FROM text_search WHERE root_id = ?").run(rootId);
  }

  replaceFile(rootId: string, file: string, texts: TextEntry[]): void {
    this.sqlite.prepare("DELETE FROM text_search WHERE root_id = ? AND file = ?").run(rootId, file);
    this.insertTexts(texts);
  }

  search(query: string, rootId: string | undefined, limit: number): FtsRow[] {
    const safeQuery = query.trim().split(/\s+/).filter(Boolean).map((part) => `"${part.replaceAll('"', '""')}"`).join(" OR ");
    if (!safeQuery) return [];
    const sql = rootId
      ? "SELECT record_id, text_kind, rank FROM text_search WHERE text_search MATCH ? AND root_id = ? ORDER BY rank LIMIT ?"
      : "SELECT record_id, text_kind, rank FROM text_search WHERE text_search MATCH ? ORDER BY rank LIMIT ?";
    return (rootId ? this.sqlite.prepare(sql).all(safeQuery, rootId, limit) : this.sqlite.prepare(sql).all(safeQuery, limit)) as FtsRow[];
  }

  debugFts5(query: string, limit: number): unknown[] {
    const safeQuery = query.trim();
    if (!safeQuery) return [];
    return this.sqlite.prepare("SELECT root_id, file, line, record_id, symbol_fqn, text, text_kind, rank FROM text_search WHERE text_search MATCH ? ORDER BY rank LIMIT ?").all(safeQuery, limit);
  }

  debugRaw(sql: string): unknown[] {
    const trimmed = sql.trim();
    if (!/^select\b/i.test(trimmed)) throw new Error("Debug raw SQL only allows SELECT statements");
    return this.sqlite.prepare(trimmed).all();
  }

  debugRowCount(): number {
    return Number((this.sqlite.prepare("SELECT count(*) AS count FROM text_search").get() as { count: number }).count);
  }

  debugTableInfo(): unknown[] {
    return this.sqlite.prepare("PRAGMA table_info(text_search)").all();
  }

  private init(): void {
    this.sqlite.pragma("journal_mode = WAL");
    this.sqlite.pragma("synchronous = NORMAL");
    this.sqlite.pragma("temp_store = MEMORY");
    this.sqlite.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS text_search USING fts5(
        root_id UNINDEXED,
        file UNINDEXED,
        line UNINDEXED,
        record_id UNINDEXED,
        symbol_fqn UNINDEXED,
        text,
        text_kind UNINDEXED,
        tokenize = 'unicode61 remove_diacritics 2'
      );
    `);
  }

  private insertTexts(texts: TextEntry[]): void {
    const insert = this.sqlite.prepare("INSERT INTO text_search(root_id, file, line, record_id, symbol_fqn, text, text_kind) VALUES (?, ?, ?, ?, ?, ?, ?)");
    const tx = this.sqlite.transaction((items: TextEntry[]) => {
      for (const item of items) insert.run(item.root_id, item.file, item.line, item.record_id, item.symbol_fqn, item.text, item.text_kind);
    });
    tx(texts.filter((item) => item.text.trim().length > 0));
  }
}

export class HyperIndex {
  private kv: RootDatabase;
  private code: LmdbCodeIndexer;
  private text: SqliteTextIndexer;

  constructor(private baseDir = dataDir()) {
    fs.mkdirSync(baseDir, { recursive: true });
    this.kv = open({ path: path.join(baseDir, "lmdb"), compression: true });
    this.code = new LmdbCodeIndexer(this.kv);
    this.text = new SqliteTextIndexer(baseDir);
  }

  close(): void {
    this.text.close();
    this.kv.close();
  }

  putRoot(root: RootConfig): void {
    this.code.putRoot(root);
  }

  getRoot(idOrPath: string): RootConfig | undefined {
    return this.code.getRoot(idOrPath);
  }

  listRoots(): RootConfig[] {
    return this.code.listRoots();
  }

  removeRoot(rootId: string): void {
    this.code.removeRoot(rootId);
    this.text.deleteRoot(rootId);
  }

  replaceFile(rootId: string, file: string, records: IndexRecord[], texts: TextEntry[]): void {
    this.code.replaceFile(rootId, file, records);
    this.text.replaceFile(rootId, file, texts);
  }

  search(query: string, options: { root?: string; limit?: number } = {}): SearchResult[] {
    const limit = options.limit ?? 10;
    const lmdbPrefixLimit = 100;
    const root = options.root ? this.getRoot(options.root) : undefined;
    const rootId = root?.id;
    const normalizedQuery = normalizeName(query);
    const candidates = new Map<number, Candidate>();

    const add = (record: StoredRecord | undefined, score: number, reason: string): void => {
      if (!record) return;
      if (rootId && record.details.root_id !== rootId) return;
      const existing = candidates.get(record.details.record_id);
      if (existing) {
        existing.score += score;
        existing.reasons.add(reason);
      } else {
        candidates.set(record.details.record_id, { record, score, reasons: new Set([reason]) });
      }
    };

    for (const record of this.code.recordsByFqnPrefix(query, rootId, lmdbPrefixLimit)) add(record, record.details.fqn === query ? 120 : 70, record.details.fqn === query ? "exact_fqn_match" : "fqn_prefix_match");
    for (const record of this.code.recordsByNormalizedFqnPrefix(normalizedQuery, rootId, lmdbPrefixLimit)) add(record, record.metadata.normalized_fqn === normalizedQuery ? 115 : 68, record.metadata.normalized_fqn === normalizedQuery ? "exact_normalized_fqn_match" : "normalized_fqn_prefix_match");
    for (const record of this.code.recordsBySuffix(query, false, rootId, lmdbPrefixLimit)) add(record, 85, "exact_name_match");
    for (const record of this.code.recordsBySuffix(normalizedQuery, true, rootId, lmdbPrefixLimit)) add(record, 80, "normalized_suffix_match");

    for (const row of this.text.search(query, rootId, 100)) {
      const reason = row.text_kind === "string" ? "fts_string_hit" : row.text_kind === "doc" ? "fts_doc_hit" : row.text_kind === "markdown" || row.text_kind === "notebook_markdown" ? "fts_markdown_hit" : "fts_comment_hit";
      add(this.code.getRecord(row.record_id), 35 + Math.max(0, 10 - row.rank), reason);
    }

    for (const candidate of [...candidates.values()]) {
      candidate.score += Math.min(35, candidate.record.details.ref_in_ct * 2);
      if (candidate.record.details.ref_in_ct >= 5) candidate.reasons.add("high_inbound_reference_count");
      if (candidate.record.metadata.display_name.length <= 2) candidate.score -= 20;
      if (candidate.record.metadata.is_primary_occurrence) candidate.score += 8;
      if (candidate.record.metadata.occurrence_role === "implementation") candidate.score += 6;
      if (["exact_fqn_match", "exact_normalized_fqn_match", "exact_name_match"].some((reason) => candidate.reasons.has(reason))) {
        for (const ref of candidate.record.details.ref_out.slice(0, 20)) {
          const neighbor = this.code.recordsByFqn(ref, rootId)[0];
          add(neighbor, 12, "neighbor_of_exact_match");
        }
      }
    }

    return [...candidates.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((candidate, idx) => this.toResult(candidate, idx + 1));
  }

  inspectSymbol(fqn: string, rootIdOrPath?: string): StoredRecord[] {
    const root = rootIdOrPath ? this.getRoot(rootIdOrPath) : undefined;
    return this.code.recordsByFqn(fqn, root?.id).concat(this.code.recordsByNormalizedFqn(normalizeName(fqn), root?.id));
  }

  getRecord(recordId: number): StoredRecord | undefined {
    return this.code.getRecord(recordId);
  }

  getParent(recordId: number): StoredRecord | null {
    return this.code.getParent(recordId);
  }

  getChildren(recordId: number): StoredRecord[] {
    return this.code.getChildren(recordId);
  }

  getDuplicates(recordId: number): StoredRecord[] {
    return this.code.getDuplicates(recordId);
  }

  async readRecord(recordId: number): Promise<{ record: StoredRecord; text: string } | null> {
    const record = this.getRecord(recordId);
    if (!record) return null;
    return { record, text: await readSnippet(record.details.file, record.details.start_line, record.details.end_line, 0) };
  }

  debugSqliteFts5(query: string, limit = 25): unknown[] {
    return this.text.debugFts5(query, limit);
  }

  debugSqliteRaw(sql: string): unknown[] {
    return this.text.debugRaw(sql);
  }

  debugLmdb(prefix: string, count = 25): DebugLmdbEntry[] {
    return this.code.debugPrefix(prefix, count);
  }

  debugDumpRecord(recordId: number): StoredRecord | null {
    return this.getRecord(recordId) ?? null;
  }

  debugDumpFile(rootId: string, file: string): StoredRecord[] {
    return this.code.recordsForRoot(rootId).filter((record) => record.details.file === file);
  }

  debugStats(): DebugStats {
    const roots = this.listRoots();
    return {
      roots: roots.length,
      records: roots.reduce((sum, root) => sum + this.code.recordsForRoot(root.id).length, 0),
      fts_rows: this.text.debugRowCount(),
      lmdb_keys_sampled: this.code.debugKeyCount()
    };
  }

  private toResult(candidate: Candidate, rank: number): SearchResult {
    const record = candidate.record;
    const duplicates = this.code.getDuplicates(record.details.record_id).map((item) => item.details.record_id).filter((id) => id !== record.details.record_id);
    return {
      rank,
      score: Number(candidate.score.toFixed(3)),
      record_id: record.details.record_id,
      fqn: record.details.fqn,
      display_name: record.metadata.display_name,
      kind: record.details.kind,
      parent_id: record.details.parent_id,
      child_ids: record.details.child_ids,
      file: record.details.file,
      start_line: record.details.start_line,
      end_line: record.details.end_line,
      language: record.metadata.language,
      signature: record.metadata.signature,
      snippet: record.snippet_cache ?? "",
      match_reasons: [...candidate.reasons].sort(),
      ref_in_ct: record.details.ref_in_ct,
      ref_out_preview: record.details.ref_out.slice(0, 10),
      duplicate_group_key: record.metadata.duplicate_group_key,
      occurrence_role: record.metadata.occurrence_role,
      related_record_ids: duplicates
    };
  }

  async hydrateSnippets(results: SearchResult[]): Promise<SearchResult[]> {
    return Promise.all(results.map(async (result) => ({
      ...result,
      snippet: result.snippet || await readSnippet(result.file, result.start_line, result.end_line)
    })));
  }
}

function compareOccurrence(a: StoredRecord, b: StoredRecord): number {
  const roleScore = (record: StoredRecord): number => {
    if (record.metadata.occurrence_role === "implementation") return 0;
    if (record.metadata.occurrence_role === "definition") return 1;
    if (record.metadata.occurrence_role === "declaration") return 2;
    return 3;
  };
  const extScore = (record: StoredRecord): number => [".cc", ".cpp", ".cxx", ".c"].includes(path.extname(record.details.file).toLowerCase()) ? 0 : 1;
  return roleScore(a) - roleScore(b) || extScore(a) - extScore(b) || a.details.record_id - b.details.record_id;
}
