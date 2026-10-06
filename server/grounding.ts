import type { AnalysisRequest } from '../shared/schema.ts';

type Source = { page: number; quote: string };
type Grounded = {
  amounts: { value: number; currency: string; source: Source }[];
  dates: { date: string; source: Source }[];
};
// Only normalize PDF line wrapping and equivalent Unicode composition. Signs,
// decimal separators and word boundaries are part of the evidence.
const normalize = (text: string) => text.normalize('NFC').replace(/\s+/gu, ' ').trim();

export function isSourceQuote(source: Source, pages: AnalysisRequest['pages']): boolean {
  const quote = normalize(source.quote);
  if (!/[\p{L}\p{N}]/u.test(quote)) return false;
  return pages.some((page) => {
    if (page.number !== source.page) return false;
    const text = normalize(page.text);
    for (let index = text.indexOf(quote); index !== -1; index = text.indexOf(quote, index + 1)) {
      const before = text.slice(Math.max(0, index - 1), index);
      const after = text.slice(index + quote.length);
      if (/^[\p{L}\p{N}]/u.test(quote) && /[\p{L}\p{N}]/u.test(before)) continue;
      if (/^\d/.test(quote) && /[.,+\-−]/u.test(before)) continue;
      if (/[\p{L}\p{N}]$/u.test(quote) && /^[\p{L}\p{N}]/u.test(after)) continue;
      if (/\d$/.test(quote) && /^[.,]\d/.test(after)) continue;
      return true;
    }
    return false;
  });
}
const months: Record<string, number> = {
  stycznia: 1,
  lutego: 2,
  marca: 3,
  kwietnia: 4,
  maja: 5,
  czerwca: 6,
  lipca: 7,
  sierpnia: 8,
  września: 9,
  października: 10,
  listopada: 11,
  grudnia: 12,
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};
const iso = (year: string, month: number | string, day: string) =>
  `${year}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`;

export function explicitDates(text: string): Set<string> {
  const dates = new Set<string>();
  for (const match of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) dates.add(match[0]);
  for (const match of text.matchAll(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/g))
    dates.add(iso(match[3], match[2], match[1]));
  for (const match of text.toLowerCase().matchAll(/\b(\d{1,2})\s+([\p{L}]+)\s+(\d{4})\b/gu)) {
    if (months[match[2]]) dates.add(iso(match[3], months[match[2]], match[1]));
  }
  for (const match of text.toLowerCase().matchAll(/\b([a-z]+)\s+(\d{1,2}),?\s+(\d{4})\b/g)) {
    if (months[match[1]]) dates.add(iso(match[3], months[match[1]], match[2]));
  }
  return dates;
}

function hasAmount(quote: string, value: number, currency: string): boolean {
  const aliases: Record<string, string[]> = {
    PLN: ['PLN', 'zł', 'zl'],
    EUR: ['EUR', '€'],
    USD: ['USD', 'US$', '$'],
    GBP: ['GBP', '£'],
  };
  const symbols = aliases[currency] || [currency];
  const hasCurrency = (text: string) =>
    symbols.some((symbol) => {
      const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(?:^|[^\\p{L}])${escaped}(?=$|[^\\p{L}])`, 'iu').test(text);
    });
  for (const token of quote.matchAll(
    /[-−]?\d+(?:[ \u00a0]\d{3})*(?:[.,]\d{3})*(?:[.,]\d{1,2})?/g,
  )) {
    let numeric = token[0].replace(/[ \u00a0]/g, '').replace('−', '-');
    const separators = [...numeric.matchAll(/[.,]/g)];
    if (separators.length) {
      const last = separators.at(-1)!;
      const both = numeric.includes(',') && numeric.includes('.');
      if (both || numeric.length - last.index - 1 !== 3) {
        numeric =
          numeric.slice(0, last.index).replace(/[.,]/g, '') + '.' + numeric.slice(last.index + 1);
      } else numeric = numeric.replace(/[.,]/g, '');
    }
    if (Math.abs(Number(numeric) - value) >= 0.001) continue;
    const before = quote.slice(0, token.index).trimEnd().toLowerCase();
    const after = quote
      .slice(token.index + token[0].length)
      .trimStart()
      .toLowerCase();
    if (
      symbols.some((symbol) => {
        const lower = symbol.toLowerCase();
        return (
          (after.startsWith(lower) &&
            !/[\p{L}]/u.test(after.slice(lower.length, lower.length + 1))) ||
          before.endsWith(lower)
        );
      })
    )
      return true;
    // Invoice total rows inherit the currency stated beside the payable total.
    // Require the value to be on a total row, not merely near a monetary amount.
    const lineStart = quote.lastIndexOf('\n', token.index) + 1;
    const lineEnd = quote.indexOf('\n', token.index);
    const line = quote.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
    if (/^\s*(?:razem|total)\b/i.test(line) && hasCurrency(quote)) return true;
  }
  return false;
}

export function checkGrounding(result: Grounded, pages: AnalysisRequest['pages']): string[] {
  const issues: string[] = [];
  const sourceMatches = (source: Source) => {
    return isSourceQuote(source, pages);
  };
  result.dates.forEach((entry, index) => {
    if (!sourceMatches(entry.source))
      issues.push(`dates[${index}]: source.quote must be an exact extract from source.page`);
    else if (!explicitDates(entry.source.quote).has(entry.date))
      issues.push(
        `dates[${index}]: date does not match the full date in its source.quote; check the year, month and day`,
      );
  });
  result.amounts.forEach((entry, index) => {
    if (!sourceMatches(entry.source))
      issues.push(`amounts[${index}]: source.quote must be an exact extract from source.page`);
    else if (!hasAmount(entry.source.quote, entry.value, entry.currency))
      issues.push(
        `amounts[${index}]: source.quote must show this value with its currency; omit customer counts, user counts and other non-monetary quantities`,
      );
  });
  return issues;
}

/** Attach verbatim evidence ourselves when the model paraphrases a source quotation. */
export function attachSourceEvidence(result: Grounded, pages: AnalysisRequest['pages']): void {
  const excerpts = (text: string) => {
    const lines = text.split('\n');
    const candidates = lines.map((_, index) =>
      lines.slice(Math.max(0, index - 1), index + 2).join('\n'),
    );
    // OCR may flatten an entire page into one line. Overlapping excerpts still
    // preserve exact source text and never rewrite the extracted value.
    for (let start = 0; start < text.length; start += 180)
      candidates.push(text.slice(start, start + 360));
    return candidates;
  };
  for (const entry of result.dates) {
    const page = pages.find((candidate) => candidate.number === entry.source.page);
    if (!page) continue;
    if (
      normalize(page.text).includes(normalize(entry.source.quote)) &&
      explicitDates(entry.source.quote).has(entry.date)
    )
      continue;
    const evidence = excerpts(page.text).find(
      (quote) => quote.length <= 600 && explicitDates(quote).has(entry.date),
    );
    if (evidence) entry.source.quote = evidence;
  }
  for (const entry of result.amounts) {
    const page = pages.find((candidate) => candidate.number === entry.source.page);
    if (!page) continue;
    if (
      normalize(page.text).includes(normalize(entry.source.quote)) &&
      hasAmount(entry.source.quote, entry.value, entry.currency)
    )
      continue;
    const evidence = excerpts(page.text).find(
      (quote) => quote.length <= 600 && hasAmount(quote, entry.value, entry.currency),
    );
    if (evidence) entry.source.quote = evidence;
  }
}

const countUnits = /użytkown|uzytkown|users?|seats?|licen[cs]|stanowisk/iu;

export function numericAmendments(pages: AnalysisRequest['pages']) {
  const changes: { page: number; oldValue: string; newValue: string }[] = [];
  for (const page of pages) {
    if (!/aneks|amendment|addendum|zmienia|zwiększ|zmniejsz|decreases|increases/iu.test(page.text))
      continue;
    for (const change of page.text.matchAll(
      /\b(?:z|ze|from)\s+(\d+)\s+(?:do|na|to)\s+(\d+)\b/giu,
    )) {
      const [, oldValue, newValue] = change;
      const context = page.text.slice(
        Math.max(0, change.index - 100),
        change.index + change[0].length + 40,
      );
      if (oldValue !== newValue && countUnits.test(context))
        changes.push({ page: page.number, oldValue, newValue });
    }
  }
  return changes;
}

/** Catch unlabelled old user/seat/license counts in explicit numeric amendments. */
export function checkAmendments(
  sentences: string[],
  pages: AnalysisRequest['pages'],
  amendments = numericAmendments(pages),
): string[] {
  const issues: string[] = [];
  for (const { page, oldValue, newValue } of amendments) {
    for (const sentence of sentences) {
      if (
        countUnits.test(sentence) &&
        new RegExp(`(?<!\\d)${oldValue}(?!\\d)`).test(sentence) &&
        !new RegExp(`(?<!\\d)${newValue}(?!\\d)`).test(sentence) &&
        !/pierwotn|poprzedn|wcześniej|początkow|przed zmian|original|previous|formerly|initial/iu.test(
          sentence,
        )
      ) {
        issues.push(
          `An explicit amendment on page ${page} changes ${oldValue} to ${newValue}. Use the amended value in summary/keyPoints; old values need an explicit historical label.`,
        );
        break;
      }
    }
  }
  return [...new Set(issues)];
}
