import type { ExtractedIR } from "../types.js";

export interface Annotator {
  name: string;
  annotate(ir: ExtractedIR): Promise<ExtractedIR>;
}

export async function runAnnotators(ir: ExtractedIR, annotators: Annotator[] = []): Promise<ExtractedIR> {
  let current = ir;
  for (const annotator of annotators) current = await annotator.annotate(current);
  return current;
}
