import type { ExtractedIR } from "../types.js";
import type { ExtractContext } from "./common.js";
import { extractMarkdown } from "./markdown.js";
import { extractNative } from "./native.js";
import { extractNotebook } from "./notebook.js";
import { extractTypeScript } from "./typescript.js";

export async function extractDocument(ctx: ExtractContext): Promise<ExtractedIR> {
  if (ctx.document.language === "typescript") return extractTypeScript(ctx);
  if (ctx.document.language === "native") return extractNative(ctx);
  if (ctx.document.language === "markdown") return extractMarkdown(ctx);
  if (ctx.document.language === "jupyter") return extractNotebook(ctx);
  return { document: ctx.document, records: [], texts: [], attachments: [], metadata: {} };
}
