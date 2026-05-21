import fs from "node:fs/promises";
import path from "node:path";
import type { CodeDetails, DocumentRef, ExtractedIR, IndexRecord, RecordKind, TextEntry, TextKind } from "../types.js";
import { normalizeName } from "../util/normalize.js";
import type { RecordIdAllocator } from "../util/record-id.js";

export interface ExtractContext {
  document: DocumentRef;
  ids: RecordIdAllocator;
}

export function makeFqn(rootPath: string, file: string, parts: string[]): string {
  const rel = path.relative(rootPath, file).replaceAll(path.sep, "/");
  return [rel, ...parts.filter(Boolean)].join("#");
}

export function duplicateGroupKey(rootId: string, fqn: string, kind: string, signature = ""): string {
  return normalizeName(`${rootId}:${fqn}:${kind}:${signature.replace(/\s+/g, " ")}`);
}

export function createEmptyIR(document: DocumentRef): ExtractedIR {
  return { document, records: [], texts: [], attachments: [], metadata: {} };
}

export function addRecord(ir: ExtractedIR, input: {
  ctx: ExtractContext;
  kind: RecordKind;
  fqn: string;
  displayName: string;
  startLine: number;
  endLine: number;
  parentId?: number | null;
  signature?: string;
  docText?: string;
  stringLiterals?: string[];
  refOut?: string[];
  language?: string;
  occurrenceRole?: "declaration" | "definition" | "implementation" | "overload" | "generated" | "unknown";
  duplicateGroupKey?: string;
  snippet?: string;
}): IndexRecord {
  const recordId = input.ctx.ids.next();
  const details: CodeDetails = {
    record_id: recordId,
    fqn: input.fqn,
    kind: input.kind,
    parent_id: input.parentId ?? null,
    child_ids: [],
    root_id: input.ctx.document.root_id,
    file: input.ctx.document.file,
    start_line: input.startLine,
    end_line: input.endLine,
    ref_in: null,
    ref_in_ct: 0,
    ref_out: input.refOut ?? []
  };
  const record: IndexRecord = {
    details,
    metadata: {
      record_id: recordId,
      display_name: input.displayName,
      normalized_fqn: normalizeName(input.fqn),
      normalized_display_name: normalizeName(input.displayName),
      signature: input.signature,
      doc_text: input.docText,
      string_literals: input.stringLiterals ?? [],
      language: input.language ?? input.ctx.document.language,
      duplicate_group_key: input.duplicateGroupKey ?? duplicateGroupKey(input.ctx.document.root_id, input.fqn, input.kind, input.signature),
      occurrence_role: input.occurrenceRole ?? "unknown",
      is_primary_occurrence: false,
      unindexable_attachments: []
    },
    snippet_cache: input.snippet
  };
  ir.records.push(record);
  if (details.parent_id != null) {
    const parent = ir.records.find((item) => item.details.record_id === details.parent_id);
    parent?.details.child_ids.push(recordId);
  }
  return record;
}

export function addText(ir: ExtractedIR, record: IndexRecord, line: number, text: string, textKind: TextKind): void {
  if (!text.trim()) return;
  ir.texts.push({
    root_id: record.details.root_id,
    file: record.details.file,
    line,
    record_id: record.details.record_id,
    symbol_fqn: record.details.fqn,
    text,
    text_kind: textKind
  });
}

export async function sourceLines(file: string): Promise<string[]> {
  return (await fs.readFile(file, "utf8")).split(/\r?\n/);
}

export function snippetFromLines(lines: string[], startLine: number, endLine: number, context = 2): string {
  const start = Math.max(1, startLine - context);
  const end = Math.min(lines.length, endLine + context);
  return lines.slice(start - 1, end).map((line, idx) => `${start + idx}: ${line}`).join("\n");
}

export type Extractor = (ctx: ExtractContext) => Promise<ExtractedIR>;
