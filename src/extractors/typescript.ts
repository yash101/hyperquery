import ts from "typescript";
import type { ExtractedIR, RecordKind } from "../types.js";
import { addRecord, addText, createEmptyIR, makeFqn, snippetFromLines, sourceLines, type ExtractContext } from "./common.js";

const SYMBOL_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.PropertyDeclaration,
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.VariableStatement,
  ts.SyntaxKind.EnumDeclaration
]);

export async function extractTypeScript(ctx: ExtractContext): Promise<ExtractedIR> {
  const ir = createEmptyIR(ctx.document);
  const lines = await sourceLines(ctx.document.file);
  const source = lines.join("\n");
  const sourceFile = ts.createSourceFile(ctx.document.file, source, ts.ScriptTarget.Latest, true, scriptKind(ctx.document.file));
  const fileFqn = makeFqn(ctx.document.root_path, ctx.document.file, []);
  const fileRecord = addRecord(ir, {
    ctx,
    kind: "file",
    fqn: fileFqn,
    displayName: fileFqn,
    startLine: 1,
    endLine: lines.length,
    stringLiterals: collectStrings(sourceFile),
    snippet: snippetFromLines(lines, 1, Math.min(lines.length, 8), 0)
  });

  for (const comment of collectComments(sourceFile, source)) {
    addText(ir, fileRecord, comment.line, comment.text, comment.isDoc ? "doc" : "comment");
  }
  for (const literal of collectStringEntries(sourceFile)) {
    addText(ir, fileRecord, literal.line, literal.text, "string");
  }

  const nameStack: string[] = [];
  const parentStack: number[] = [fileRecord.details.record_id];

  const visit = (node: ts.Node): void => {
    if (SYMBOL_KINDS.has(node.kind)) {
      const name = nodeName(node);
      if (name) {
        const kind = recordKind(node);
        const startLine = lineOf(sourceFile, node.getStart(sourceFile));
        const endLine = lineOf(sourceFile, node.getEnd());
        const fqn = makeFqn(ctx.document.root_path, ctx.document.file, [...nameStack, name]);
        const docText = leadingDocText(sourceFile, node);
        const stringLiterals = collectStrings(node);
        const refOut = collectIdentifiers(node).filter((id) => id !== name);
        const record = addRecord(ir, {
          ctx,
          kind,
          fqn,
          displayName: name,
          startLine,
          endLine,
          signature: signatureFor(node, sourceFile),
          docText,
          stringLiterals,
          refOut,
          parentId: parentStack.at(-1) ?? fileRecord.details.record_id,
          occurrenceRole: "definition",
          snippet: snippetFromLines(lines, startLine, endLine)
        });
        if (docText) addText(ir, record, startLine, docText, "doc");
        for (const literal of stringLiterals) addText(ir, record, startLine, literal, "string");
        nameStack.push(name);
        parentStack.push(record.details.record_id);
        ts.forEachChild(node, visit);
        parentStack.pop();
        nameStack.pop();
        return;
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  const fqnByName = new Map(ir.records.map((record) => [record.metadata.display_name, record.details.fqn]));
  for (const record of ir.records) {
    record.details.ref_out = [...new Set(record.details.ref_out.map((ref) => fqnByName.get(ref)).filter((ref): ref is string => Boolean(ref)))];
  }
  return ir;
}

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".cjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function lineOf(sourceFile: ts.SourceFile, pos: number): number {
  return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

function nodeName(node: ts.Node): string | null {
  if (ts.isVariableStatement(node)) {
    const first = node.declarationList.declarations[0];
    return first && ts.isIdentifier(first.name) ? first.name.text : null;
  }
  const named = node as ts.Node & { name?: ts.Node };
  return named.name && ts.isIdentifier(named.name) ? named.name.text : null;
}

function recordKind(node: ts.Node): RecordKind {
  if (ts.isClassDeclaration(node)) return "class";
  if (ts.isMethodDeclaration(node)) return "method";
  if (ts.isPropertyDeclaration(node)) return "field";
  if (ts.isInterfaceDeclaration(node)) return "interface";
  if (ts.isTypeAliasDeclaration(node)) return "type";
  if (ts.isEnumDeclaration(node)) return "enum";
  if (ts.isVariableStatement(node)) return "field";
  return "function";
}

function signatureFor(node: ts.Node, sourceFile: ts.SourceFile): string {
  const text = node.getText(sourceFile).split(/\r?\n/)[0] ?? "";
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

function collectIdentifiers(node: ts.Node): string[] {
  const ids: string[] = [];
  const visit = (child: ts.Node): void => {
    if (ts.isIdentifier(child)) ids.push(child.text);
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return ids;
}

function collectStrings(node: ts.Node): string[] {
  return collectStringEntries(node).map((entry) => entry.text);
}

function collectStringEntries(node: ts.Node): Array<{ text: string; line: number }> {
  const entries: Array<{ text: string; line: number }> = [];
  const sourceFile = node.getSourceFile();
  const visit = (child: ts.Node): void => {
    if (ts.isStringLiteralLike(child) || child.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral) {
      entries.push({ text: (child as ts.StringLiteralLike).text, line: lineOf(sourceFile, child.getStart(sourceFile)) });
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return entries;
}

function leadingDocText(sourceFile: ts.SourceFile, node: ts.Node): string {
  const ranges = ts.getLeadingCommentRanges(sourceFile.text, node.getFullStart()) ?? [];
  return ranges
    .map((range) => sourceFile.text.slice(range.pos, range.end))
    .filter((text) => text.startsWith("/**"))
    .map(cleanComment)
    .join("\n");
}

function collectComments(sourceFile: ts.SourceFile, source: string): Array<{ text: string; line: number; isDoc: boolean }> {
  const comments: Array<{ text: string; line: number; isDoc: boolean }> = [];
  const seen = new Set<string>();
  const visit = (node: ts.Node): void => {
    for (const range of ts.getLeadingCommentRanges(source, node.getFullStart()) ?? []) {
      const key = `${range.pos}:${range.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const raw = source.slice(range.pos, range.end);
      comments.push({ text: cleanComment(raw), line: lineOf(sourceFile, range.pos), isDoc: raw.startsWith("/**") });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return comments;
}

function cleanComment(raw: string): string {
  return raw
    .replace(/^\/\*\*?/, "")
    .replace(/\*\/$/, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\* ?/, "").replace(/^\/\//, "").trim())
    .join("\n")
    .trim();
}
