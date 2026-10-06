import type { AnalysisRequest } from '../shared/schema.ts';

export const CHUNK_CHARS = 32000;
type Page = AnalysisRequest['pages'][number];

/** Keep every character, original page numbers, and a short overlap at boundaries. */
export function splitPages(pages: Page[], limit = CHUNK_CHARS): Page[][] {
  if (limit < 1000) throw new Error('Chunk size must be at least 1000 characters.');
  const chunks: Page[][] = [];
  let current: Page[] = [];
  let used = 0;
  const flush = () => {
    if (current.length) chunks.push(current);
    current = [];
    used = 0;
  };
  for (const page of pages) {
    if (!page.text.trim()) continue;
    let start = 0;
    while (start < page.text.length) {
      if (limit - used < 500) flush();
      const end = Math.min(page.text.length, start + limit - used);
      current.push({ number: page.number, text: page.text.slice(start, end) });
      used += end - start;
      if (end === page.text.length) break;
      flush();
      start = end - Math.min(200, end - start - 1);
    }
  }
  flush();
  return chunks;
}

export function sourceText(pages: Page[]): string {
  return pages.map((page) => `[PAGE ${page.number}]\n${page.text}`).join('\n\n');
}
