import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import mammoth from "mammoth";
import pdf from "pdf-parse";

export async function extractTextFromFile(filePath: string): Promise<string> {
  const extension = extname(filePath).toLowerCase();
  const buffer = await readFile(filePath);

  if (extension === ".docx") {
    const result = await mammoth.extractRawText({ buffer });
    return result.value.replace(/\s+/g, " ").trim();
  }

  if (extension === ".pdf") {
    const result = await pdf(buffer);
    return result.text.replace(/\s+/g, " ").trim();
  }

  throw new Error("Podržani su samo PDF i DOCX fajlovi.");
}
