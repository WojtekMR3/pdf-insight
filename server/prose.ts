import { z } from 'zod';
import type { AnalysisRequest } from '../shared/schema.ts';
import { checkAmendments, numericAmendments } from './grounding.ts';
import { AppError, InvalidModelReply } from './errors.ts';
import { isDirective, isRepeatedLine, repeatedLines, sentenceSpans } from './sentences.ts';

type Page = AnalysisRequest['pages'][number];
export type ProsePassage = { id: string; page: number; quote: string };
// Preserve words, case, punctuation, signs and decimal separators. Only PDF
// line wrapping and equivalent Unicode composition may change for display.
export const normalizeProse = (text: string) => text.normalize('NFC').replace(/\s+/gu, ' ').trim();

// A clause number at the start of a line begins a new sentence: "1. Umowa", "§ 3. Okres".
const clauseStart =
  /^\s*(?:§\s*\d+[a-z]?(?:\s*[–-]\s*\d+)?\.|\d{1,3}(?:\.\d{1,3})*[.)])\s+(?=[\p{Lu}„"(])/u;
const isTable = (quote: string) =>
  quote.length > 150 && (quote.match(/\d/g) || []).length / quote.length > 0.2;

/** Line groups separated by running headers/footers and clause numbers. */
function sentenceUnits(text: string, repeated: Set<string>): string[] {
  const units: string[][] = [[]];
  for (const line of text.split('\n')) {
    if (isRepeatedLine(line, repeated)) units.push([]);
    else {
      if (clauseStart.test(line)) units.push([]);
      units[units.length - 1].push(line);
    }
  }
  return units.filter((unit) => unit.length).map((unit) => unit.join('\n'));
}

/** Readable sentences: no headers, headings, clause numbers, fragments or table rows. */
function readableSentences(page: Page, repeated: Set<string>): string[] {
  // A paragraph separator always ends a sentence, so one pass keeps the units apart.
  const text = sentenceUnits(page.text, repeated).map(normalizeProse).join('\u2029');
  // Keep complete clauses up to the catalog's existing 1,200-character limit.
  // Readability must not hide an amendment when shorter sentences exist.
  return sentenceSpans(text)
    .map(({ start, end }) => text.slice(start, end).trim())
    .filter((quote) => /^[\p{Lu}\p{Lo}„"«(]/u.test(quote) && !isTable(quote));
}

const segmenter = new Intl.Segmenter(['pl', 'en'], { granularity: 'sentence' });
const allSentences = (page: Page) =>
  [...segmenter.segment(normalizeProse(page.text))].map(({ segment }) => segment.trim());

/** Build whole source sentences before any AI selection. Never accept AI prose. */
export function buildProseCatalog(
  pages: AnalysisRequest['pages'],
  selectedPages: AnalysisRequest['pages'] = pages,
  repeated = repeatedLines(pages),
): ProsePassage[] {
  const readable = catalog(pages, selectedPages, (page) => readableSentences(page, repeated));
  // Unusual layouts can leave too few readable sentences; keep the previous behaviour then.
  return readable.length >= 3 ? readable : catalog(pages, selectedPages, allSentences);
}

function catalog(
  pages: AnalysisRequest['pages'],
  selectedPages: AnalysisRequest['pages'],
  sentences: (page: Page) => string[],
): ProsePassage[] {
  const selected = new Map<number, string[]>();
  for (const page of selectedPages)
    selected.set(page.number, [...(selected.get(page.number) || []), normalizeProse(page.text)]);
  const amendments = numericAmendments(pages);
  const seen = new Set<string>();
  const passages: ProsePassage[] = [];
  for (const page of pages) {
    for (const quote of sentences(page)) {
      if (
        quote.length < 20 ||
        quote.length > 1200 ||
        !/[.!?。！？]["'”’»)]*$/u.test(quote) ||
        !/\p{L}/u.test(quote) ||
        seen.has(quote) ||
        isDirective(quote) ||
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
  summarySelection: string[],
  keyPointSelection: string[],
  ocrPages: number[],
  requiredIds: string[] = [],
) {
  const required = [...new Set(requiredIds)];
  if (required.length > 5)
    throw new AppError(
      'Dokument zawiera zbyt wiele zmian, aby zmieścić je w krótkim podsumowaniu. Podziel dokument na części.',
      422,
    );
  const summaryIds = [
    ...required,
    ...summarySelection.filter((id) => !required.includes(id)),
  ].slice(0, 5);
  // Key points should add information: prefer selections the summary does not already quote.
  const keyPointIds = [
    ...required,
    ...keyPointSelection.filter((id) => !required.includes(id) && !summaryIds.includes(id)),
  ];
  for (const id of keyPointSelection)
    if (keyPointIds.length < 3 && !keyPointIds.includes(id)) keyPointIds.push(id);
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
  const summary = resolve(summaryIds);
  const keyPoints = resolve(keyPointIds.slice(0, 7));
  return {
    summary: summary.map((source) => source.quote).join(' '),
    keyPoints: keyPoints.map((source) => source.quote),
    proseSources: { summary, keyPoints },
  };
}
