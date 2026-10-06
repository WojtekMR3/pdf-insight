// Shared text-structure helpers for the source catalogs. They only decide which
// verbatim source text is eligible; they never rewrite document wording.

type Span = { start: number; end: number };

// Abbreviations whose period usually continues the sentence, e.g. "ul. Portowa",
// "§ 5 ust. 2", "sp. z o.o.", "e.g. Excel". Year markers ("2026 r.") stay terminal.
const ABBREVIATIONS = new Set(
  (
    'al art dr godz inż lit mgr np nr ok os par pkt pl poz prof sp str tel tj tzn tzw ul ust woj zał ' +
    'm.in o.o approx dept e.g fig i.e mr mrs ms no sec vs'
  ).split(' '),
);
const segmenter = new Intl.Segmenter(['pl', 'en'], { granularity: 'sentence' });
const trailingWord = /(?:^|[^\p{L}.])(\p{L}[\p{L}.]*)\.\s*$/u;

function continuesAfterPeriod(segment: string): boolean {
  // Abbreviations are short; checking the tail keeps long sentences cheap.
  const word = segment.slice(-24).match(trailingWord)?.[1];
  // A single capital letter is an initial, as in "A. Kowalczyk".
  return !!word && (ABBREVIATIONS.has(word.toLowerCase()) || /^\p{Lu}$/u.test(word));
}

/** Sentence spans of `text`. Line breaks and common abbreviations do not end a sentence. */
export function sentenceSpans(text: string): Span[] {
  const spans: Span[] = [];
  let start = 0;
  // Replacing line breaks keeps every offset while letting sentences wrap across lines.
  for (const { index, segment } of segmenter.segment(text.replace(/[\r\n]/g, ' '))) {
    const end = index + segment.length;
    // Never continue past a paragraph separator, which marks a structural break.
    if (end < text.length && !segment.includes('\u2029') && continuesAfterPeriod(segment)) continue;
    spans.push({ start, end });
    start = end;
  }
  return spans;
}

// Lines carrying a page number differ only in digits from page to page.
const pageMarker = /(?:strona|page|str\.|seite)\s*\d+/iu;
const lineKey = (line: string) => {
  const text = line.trim().replace(/\s+/g, ' ');
  return pageMarker.test(text) ? text.toLowerCase().replace(/\d+/g, '#') : text;
};

/** Lines repeated on most pages, such as running headers, footers and page numbers. */
export function repeatedLines(pages: { text: string }[]): Set<string> {
  const withText = pages.filter((page) => page.text.trim());
  if (withText.length < 3) return new Set();
  const counts = new Map<string, number>();
  for (const page of withText)
    for (const key of new Set(page.text.split('\n').map(lineKey).filter(Boolean)))
      counts.set(key, (counts.get(key) || 0) + 1);
  const minimum = Math.max(3, Math.ceil(withText.length / 2));
  return new Set([...counts].filter(([, count]) => count >= minimum).map(([key]) => key));
}

export const isRepeatedLine = (line: string, repeated: Set<string>) =>
  repeated.size > 0 && repeated.has(lineKey(line));

// Embedded prompt injection: an imperative aimed at an AI, a summary or its instructions.
const word = (pattern: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, 'iu');
const imperative = word(
  "zignoruj|ignoruj|pomiń|zapomnij|nie\\s+wspominaj|nie\\s+ujawniaj|napisz|wpisz|podaj|odpowiedz|stwierdź|ignore|disregard|forget|do\\s+not\\s+(?:mention|reveal)|don['’]t\\s+(?:mention|reveal)|write|say|respond|reply|output",
);
const addressee = word(
  'polece\\p{L}*|instrukcj\\p{L}*|podsumowani\\p{L}*|streszczeni\\p{L}*|prompt\\p{L}*|system\\p{L}*\\s+ai|ai|llm|chatbot\\p{L}*|asystent\\p{L}*|instructions?|summary|assistant|language\\s+model',
);

/** True for a sentence that instructs an AI system instead of describing the document. */
export const isDirective = (sentence: string) =>
  imperative.test(sentence) && addressee.test(sentence);

/** Spans of embedded AI instructions in raw page text. */
export function directiveSpans(text: string): Span[] {
  if (!imperative.test(text)) return [];
  return sentenceSpans(text).filter(({ start, end }) => isDirective(text.slice(start, end)));
}
