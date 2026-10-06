import { z } from 'zod';
import type { AnalysisRequest } from '../shared/schema.ts';
import { checkAmendments, numericAmendments } from './grounding.ts';
import { AppError, InvalidModelReply } from './errors.ts';

export type ProsePassage = { id: string; page: number; quote: string };
// Preserve words, case, punctuation, signs and decimal separators. Only PDF
// line wrapping and equivalent Unicode composition may change for display.
export const normalizeProse = (text: string) => text.normalize('NFC').replace(/\s+/gu, ' ').trim();

/** Build whole source sentences before any AI selection. Never accept AI prose. */
export function buildProseCatalog(
  pages: AnalysisRequest['pages'],
  selectedPages: AnalysisRequest['pages'] = pages,
): ProsePassage[] {
  const segmenter = new Intl.Segmenter(['pl', 'en'], { granularity: 'sentence' });
  const selected = new Map<number, string[]>();
  for (const page of selectedPages)
    selected.set(page.number, [...(selected.get(page.number) || []), normalizeProse(page.text)]);
  const amendments = numericAmendments(pages);
  const seen = new Set<string>();
  const passages: ProsePassage[] = [];
  for (const page of pages) {
    for (const { segment } of segmenter.segment(normalizeProse(page.text))) {
      const quote = segment.trim();
      if (
        quote.length < 20 ||
        quote.length > 1200 ||
        !/[.!?。！？]["'”’»)]*$/u.test(quote) ||
        !/\p{L}/u.test(quote) ||
        seen.has(quote) ||
        checkAmendments([quote], pages, amendments).length ||
        (selectedPages !== pages &&
          !selected.get(page.number)?.some((part) => part.includes(quote)))
      )
        continue;
      seen.add(quote);
      passages.push({ id: `p${passages.length + 1}`, page: page.number, quote });
    }
  }
  return passages;
}

export function proseSelectionSchema(passages: ProsePassage[]) {
  if (passages.length < 3)
    throw new AppError(
      'Za mało pełnych zdań źródłowych, aby utworzyć podsumowanie bez dopisywania treści. Spróbuj dokumentu z bardziej rozbudowaną warstwą tekstową.',
      422,
    );
  const id = z.enum(passages.map((passage) => passage.id) as [string, ...string[]]);
  const unique = (ids: string[]) => new Set(ids).size === ids.length;
  return {
    summaryPassages: z.array(id).min(3).max(5).refine(unique, 'Choose distinct source passages.'),
    keyPointPassages: z.array(id).min(3).max(7).refine(unique, 'Choose distinct source passages.'),
  };
}

export function resolveProse(
  passages: ProsePassage[],
  summaryIds: string[],
  keyPointIds: string[],
  ocrPages: number[],
  requiredIds: string[] = [],
) {
  const includeRequired = (ids: string[], limit: number) => {
    const required = [...new Set(requiredIds)];
    if (required.length > limit)
      throw new AppError(
        'Dokument zawiera zbyt wiele zmian, aby zmieścić je w krótkim podsumowaniu. Podziel dokument na części.',
        422,
      );
    return [...required, ...ids.filter((id) => !required.includes(id))].slice(0, limit);
  };
  const resolve = (ids: string[]) =>
    ids
      .map((id) => {
        const source = passages.find((passage) => passage.id === id);
        if (!source) throw new InvalidModelReply(`Unknown source passage: ${id}`);
        return source;
      })
      .sort((left, right) => passages.indexOf(left) - passages.indexOf(right))
      .map((source) => ({
        page: source.page,
        quote: source.quote,
        origin: ocrPages.includes(source.page) ? ('ocr' as const) : ('pdf-text' as const),
      }));
  const summary = resolve(includeRequired(summaryIds, 5));
  const keyPoints = resolve(includeRequired(keyPointIds, 7));
  return {
    summary: summary.map((source) => source.quote).join(' '),
    keyPoints: keyPoints.map((source) => source.quote),
    proseSources: { summary, keyPoints },
  };
}
