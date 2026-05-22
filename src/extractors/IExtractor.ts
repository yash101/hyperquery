import { FileCandidate } from "../crawlers/FileCandidate.js";

export interface 

export interface IExtractor {
  getSuportedFileExtensions(): string[];
  extract(context: FileCandidate): Promise<>;
}
