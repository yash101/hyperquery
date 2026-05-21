import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_IGNORES = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  ".hypercode",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".vercel",
  "build",
  "out",
  ".cache"
]);

export async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];

  async function visit(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (DEFAULT_IGNORES.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(full);
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
  }

  await visit(root);
  return out;
}

export function supportedExtension(file: string): boolean {
  return /\.(tsx?|jsx?|mjs|cjs|cc|cpp|cxx|c|h|hpp|hh|md|markdown|ipynb)$/.test(file);
}

export async function readSnippet(file: string, startLine: number, endLine: number, context = 2): Promise<string> {
  const source = await fs.readFile(file, "utf8");
  const lines = source.split(/\r?\n/);
  const start = Math.max(1, startLine - context);
  const end = Math.min(lines.length, endLine + context);
  return lines.slice(start - 1, end).map((line, idx) => `${start + idx}: ${line}`).join("\n");
}
