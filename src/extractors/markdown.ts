import path from "node:path";
import type { ExtractedIR, IndexRecord } from "../types.js";
import { addRecord, addText, createEmptyIR, makeFqn, snippetFromLines, sourceLines, type ExtractContext } from "./common.js";

export async function extractMarkdown(ctx: ExtractContext): Promise<ExtractedIR> {
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

  let current: IndexRecord = fileRecord;
  let currentStart = 1;
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx] ?? "";
    const lineNo = idx + 1;
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      if (current !== fileRecord) current.details.end_line = Math.max(current.details.start_line, lineNo - 1);
      const title = heading[2]?.trim() ?? `heading-${lineNo}`;
      currentStart = lineNo;
      current = addRecord(ir, {
        ctx,
        kind: "markdown_heading",
        fqn: makeFqn(ctx.document.root_path, ctx.document.file, [title]),
        displayName: title,
        startLine: lineNo,
        endLine: lines.length,
        parentId: fileRecord.details.record_id,
        occurrenceRole: "definition",
        snippet: snippetFromLines(lines, lineNo, lineNo)
      });
      addText(ir, current, lineNo, title, "markdown");
    } else {
      addText(ir, current, lineNo, line, "markdown");
    }
  }
  if (current !== fileRecord) current.details.end_line = Math.max(currentStart, lines.length);
  return ir;
}
