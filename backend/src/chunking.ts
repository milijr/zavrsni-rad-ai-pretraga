export type TextChunk = {
  content: string;
  chunkIndex: number;
  characterStart: number;
  characterEnd: number;
  tokenCount: number;
};

const DEFAULT_CHUNK_SIZE = 1_200;
const DEFAULT_OVERLAP = 180;

function findChunkEnd(text: string, start: number, targetEnd: number): number {
  if (targetEnd >= text.length) return text.length;

  const searchStart = Math.max(start + Math.floor(DEFAULT_CHUNK_SIZE * 0.55), targetEnd - 250);
  const window = text.slice(searchStart, targetEnd + 1);
  const breakPositions = [window.lastIndexOf("\n"), window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "), window.lastIndexOf(" ")];
  const position = Math.max(...breakPositions);

  if (position < 0) return targetEnd;
  return searchStart + position + (window[position] === " " ? 0 : 1);
}

export function splitIntoChunks(text: string): TextChunk[] {
  const source = text.trim();
  if (!source) return [];

  const chunks: TextChunk[] = [];
  let start = 0;

  while (start < source.length) {
    while (source[start] && /\s/.test(source[start])) start += 1;
    if (start >= source.length) break;

    const end = findChunkEnd(source, start, Math.min(start + DEFAULT_CHUNK_SIZE, source.length));
    const content = source.slice(start, end).trim();

    if (content) {
      chunks.push({
        content,
        chunkIndex: chunks.length,
        characterStart: start,
        characterEnd: end,
        tokenCount: content.split(/\s+/).length,
      });
    }

    if (end >= source.length) break;

    const nextStart = Math.max(start + 1, end - DEFAULT_OVERLAP);
    const nextWhitespace = source.indexOf(" ", nextStart);
    start = nextWhitespace === -1 ? end : nextWhitespace + 1;
  }

  return chunks;
}
