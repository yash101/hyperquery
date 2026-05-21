import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { OccurrenceRole, RecordKind } from "../types.js";
import type { ExtractContext } from "./common.js";

const execFileAsync = promisify(execFile);

export interface DoxygenMember {
  kind: RecordKind;
  name: string;
  signature: string;
  line: number;
  role: OccurrenceRole;
}

export async function extractDoxygenMembers(ctx: ExtractContext): Promise<DoxygenMember[]> {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "hypercode-doxygen-"));
  const xmlDir = path.join(temp, "xml");
  const doxyfile = path.join(temp, "Doxyfile");
  const config = [
    "QUIET = YES",
    "WARNINGS = NO",
    "GENERATE_HTML = NO",
    "GENERATE_LATEX = NO",
    "GENERATE_XML = YES",
    `OUTPUT_DIRECTORY = ${temp}`,
    "XML_OUTPUT = xml",
    `INPUT = ${ctx.document.file}`,
    "EXTRACT_ALL = YES",
    "MACRO_EXPANSION = NO"
  ].join("\n");

  try {
    await fs.writeFile(doxyfile, config);
    await execFileAsync("doxygen", [doxyfile], { timeout: 15_000 });
    return await readDoxygenMembers(xmlDir, ctx.document.file);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

async function readDoxygenMembers(xmlDir: string, file: string): Promise<DoxygenMember[]> {
  const files = await fs.readdir(xmlDir).catch(() => []);
  const members: DoxygenMember[] = [];
  for (const item of files.filter((name) => name.endsWith(".xml"))) {
    const xml = await fs.readFile(path.join(xmlDir, item), "utf8");
    for (const match of xml.matchAll(/<memberdef kind="([^"]+)"[\s\S]*?<\/memberdef>/g)) {
      const block = match[0];
      const rawKind = match[1] ?? "native";
      const kind = rawKind === "function" ? "function" : rawKind === "variable" ? "field" : "native";
      const name = textOf(block, "qualifiedname") || textOf(block, "name");
      const args = textOf(block, "argsstring");
      const location = block.match(/<location[^>]*line="(\d+)"[^>]*(?:bodyfile="([^"]+)")?[^>]*(?:bodystart="(\d+)")?/) ?? [];
      const line = Number(location[3] ?? location[1] ?? "1");
      const role = roleFor(file, block);
      if (name) members.push({ kind, name, signature: `${name}${args}`, line, role });
    }
    for (const match of xml.matchAll(/<compounddef kind="class"[\s\S]*?<\/compounddef>/g)) {
      const block = match[0];
      const name = textOf(block, "compoundname");
      const line = Number(block.match(/<location[^>]*line="(\d+)"/)?.[1] ?? "1");
      if (name) members.push({ kind: "class", name, signature: name, line, role: "definition" });
    }
  }
  return members;
}

function roleFor(file: string, block: string): OccurrenceRole {
  const ext = path.extname(file).toLowerCase();
  if ([".h", ".hh", ".hpp"].includes(ext)) return block.includes("bodystart=") ? "definition" : "declaration";
  return block.includes("bodystart=") ? "implementation" : "definition";
}

function textOf(xml: string, tag: string): string {
  return decode(xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`))?.[1]?.trim() ?? "");
}

function decode(value: string): string {
  return value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}
