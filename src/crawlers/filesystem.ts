import path from "node:path";
import type { DocumentRef, RootConfig } from "../types.js";
import { walkFiles } from "../util/files.js";

export async function crawlFilesystem(root: RootConfig): Promise<DocumentRef[]> {
  const files = await walkFiles(root.disk_path);
  return files.map((file) => toDocumentRef(root, file)).filter((doc): doc is DocumentRef => Boolean(doc));
}

export function toDocumentRef(root: RootConfig, file: string): DocumentRef | null {
  const ext = path.extname(file).toLowerCase();
  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
    return { root_id: root.id, root_path: root.disk_path, file, kind: "source", language: "typescript", metadata: { ext } };
  }
  if ([".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp"].includes(ext)) {
    return { root_id: root.id, root_path: root.disk_path, file, kind: "source", language: "native", metadata: { ext } };
  }
  if (ext === ".md" || ext === ".markdown") {
    return { root_id: root.id, root_path: root.disk_path, file, kind: "markdown", language: "markdown", metadata: { ext } };
  }
  if (ext === ".ipynb") {
    return { root_id: root.id, root_path: root.disk_path, file, kind: "notebook", language: "jupyter", metadata: { ext } };
  }
  return null;
}
