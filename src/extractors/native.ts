import path from "node:path";
import type { ExtractedIR } from "../types.js";
import { addRecord, addText, createEmptyIR, duplicateGroupKey, makeFqn, snippetFromLines, sourceLines, type ExtractContext } from "./common.js";
import { extractDoxygenMembers } from "./doxygen.js";

const FUNCTION_RE = /^\s*(?:[\w:*&<>,~]+\s+)+(?<name>[A-Za-z_]\w*(?:::[A-Za-z_]\w*)?)\s*\([^;{}]*\)\s*(?:const\s*)?(?<body>\{)?/;

export async function extractNative(ctx: ExtractContext): Promise<ExtractedIR> {
  const ir = createEmptyIR(ctx.document);
  const lines = await sourceLines(ctx.document.file);
  const fileFqn = makeFqn(ctx.document.root_path, ctx.document.file, []);
  const fileRecord = addRecord(ir, {
    ctx,
    kind: "file",
    fqn: fileFqn,
    displayName: path.basename(ctx.document.file),
    startLine: 1,
    endLine: lines.length,
    snippet: snippetFromLines(lines, 1, Math.min(lines.length, 8), 0)
  });

  let doxygenWorked = false;
  try {
    const members = await extractDoxygenMembers(ctx);
    doxygenWorked = members.length > 0;
    for (const member of members) {
      const fqn = makeFqn(ctx.document.root_path, ctx.document.file, [member.name]);
      addRecord(ir, {
        ctx,
        kind: member.kind,
        fqn,
        displayName: member.name.split("::").at(-1) ?? member.name,
        startLine: Math.max(1, member.line),
        endLine: Math.max(1, member.line),
        signature: member.signature,
        parentId: fileRecord.details.record_id,
        occurrenceRole: member.role,
        duplicateGroupKey: duplicateGroupKey(ctx.document.root_id, member.name, member.kind),
        snippet: snippetFromLines(lines, Math.max(1, member.line), Math.max(1, member.line))
      });
    }
  } catch (error) {
    ir.metadata.doxygen_error = error instanceof Error ? error.message : String(error);
  }

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx] ?? "";
    const lineNo = idx + 1;
    const comment = line.match(/\/\/(.*)$/)?.[1];
    if (comment) addText(ir, fileRecord, lineNo, comment.trim(), "comment");
    for (const match of line.matchAll(/"((?:\\"|[^"])*)"/g)) {
      const text = match[1] ?? "";
      fileRecord.metadata.string_literals?.push(text);
      addText(ir, fileRecord, lineNo, text, "string");
    }
    if (doxygenWorked) continue;
    const fn = line.match(FUNCTION_RE);
    const name = fn?.groups?.name;
    if (name) {
      const role = fn.groups?.body ? "implementation" : "declaration";
      const fqn = makeFqn(ctx.document.root_path, ctx.document.file, [name]);
      addRecord(ir, {
        ctx,
        kind: "function",
        fqn,
        displayName: name.split("::").at(-1) ?? name,
        startLine: lineNo,
        endLine: lineNo,
        signature: line.trim(),
        parentId: fileRecord.details.record_id,
        occurrenceRole: role,
        duplicateGroupKey: duplicateGroupKey(ctx.document.root_id, name, "function"),
        snippet: snippetFromLines(lines, lineNo, lineNo)
      });
    }
  }

  return ir;
}
