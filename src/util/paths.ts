import { homedir, tmpdir } from "node:os";
import path from "node:path";

export function dataDir(): string {
  return process.env.HYPERCODE_DATA_DIR ?? path.join(homedir(), ".hypercode");
}

export function socketPath(): string {
  return process.env.HYPERCODE_SOCKET ?? path.join(tmpdir(), `hypercode-${process.getuid?.() ?? "user"}.sock`);
}

export function displayPath(file: string, root: string): string {
  const rel = path.relative(root, file);
  return rel.startsWith("..") ? file : rel;
}
