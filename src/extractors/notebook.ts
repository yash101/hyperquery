import fs from "node:fs/promises";
import path from "node:path";
import type { ExtractedIR } from "../types.js";
import { addRecord, addText, createEmptyIR, makeFqn, type ExtractContext } from "./common.js";

interface NotebookCell {
  id?: string;
  cell_type?: string;
  source?: string[] | string;
  outputs?: unknown[];
}

export async function extractNotebook(ctx: ExtractContext): Promise<ExtractedIR> {
  const ir = createEmptyIR(ctx.document);
  const raw = await fs.readFile(ctx.document.file, "utf8");
  const notebook = JSON.parse(raw) as { cells?: NotebookCell[]; metadata?: Record<string, unknown> };
  const cells = notebook.cells ?? [];
  const fileRecord = addRecord(ir, {
    ctx,
    kind: "file",
    fqn: makeFqn(ctx.document.root_path, ctx.document.file, []),
    displayName: path.basename(ctx.document.file),
    startLine: 1,
    endLine: raw.split(/\r?\n/).length,
    occurrenceRole: "definition"
  });
  ir.metadata.notebook = notebook.metadata ?? {};

  cells.forEach((cell, idx) => {
    if (cell.cell_type !== "markdown") {
      if (cell.outputs?.length) {
        ir.attachments.push({
          attachment_id: `${fileRecord.details.record_id}:cell:${idx}:outputs`,
          kind: "notebook_outputs",
          source: ctx.document.file,
          metadata: { cell_index: idx, cell_id: cell.id }
        });
      }
      return;
    }
    const text = Array.isArray(cell.source) ? cell.source.join("") : cell.source ?? "";
    const record = addRecord(ir, {
      ctx,
      kind: "notebook_cell",
      fqn: makeFqn(ctx.document.root_path, ctx.document.file, [`markdown-cell-${cell.id ?? idx}`]),
      displayName: `markdown cell ${cell.id ?? idx}`,
      startLine: idx + 1,
      endLine: idx + 1,
      parentId: fileRecord.details.record_id,
      occurrenceRole: "definition"
    });
    record.metadata.unindexable_attachments = ir.attachments;
    addText(ir, record, idx + 1, text, "notebook_markdown");
  });

  return ir;
}
