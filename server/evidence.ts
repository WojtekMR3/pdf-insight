import { z } from 'zod';
import { resultSchema, type AnalysisRequest } from '../shared/schema.ts';
import { CURRENCY_CODES } from '../shared/iso-codes.ts';
import { explicitDates } from './grounding.ts';
import { proseSelectionSchema, type ProsePassage } from './prose.ts';

type Source = { page: number; quote: string };
export type EvidenceCatalog = {
  amounts: { id: string; value: number; currency: string; source: Source }[];
  dates: { id: string; date: string; source: Source }[];
};
export const isAmendmentPage = (text: string) =>
  /(?:ANEKS|AMENDMENT|ADDENDUM)\s+(?:NR|NO\.?|#)\s*\d+/iu.test(text);
const numericPattern = /[-−]?\d+(?:[ \u00a0]\d{3})*(?:[.,]\d{3})*(?:[.,]\d{1,2})?/g;
const codes = new Set(CURRENCY_CODES);
const namedMonths =
  '(?:stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia|january|february|march|april|may|june|july|august|september|october|november|december)';
const datePattern = new RegExp(
  `\\b(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[./]\\d{1,2}[./]\\d{4}|\\d{1,2}\\s+${namedMonths}\\s+\\d{4}|${namedMonths}\\s+\\d{1,2},?\\s+\\d{4})\\b`,
  'giu',
);

function numberValue(raw: string): number {
  let value = raw.replace(/[ \u00a0]/g, '').replace('−', '-');
  const last = [...value.matchAll(/[.,]/g)].at(-1);
  if (last) {
    if ((value.includes(',') && value.includes('.')) || value.length - last.index - 1 !== 3)
      value = value.slice(0, last.index).replace(/[.,]/g, '') + '.' + value.slice(last.index + 1);
    else value = value.replace(/[.,]/g, '');
  }
  return Number(value);
}

function excerpt(text: string, start: number, end: number): string {
  const lineStart = text.lastIndexOf('\n', start) + 1;
  const nextLine = text.indexOf('\n', end);
  const lineEnd = nextLine < 0 ? text.length : nextLine;
  // Prefer readable lines to arbitrary windows. Include the next line when it
  // carries the currency, net/gross qualifier or remainder of a wrapped clause.
  const afterLine = text.indexOf('\n', lineEnd + 1);
  const extendedEnd = nextLine < 0 ? lineEnd : afterLine < 0 ? text.length : afterLine;
  if (extendedEnd - lineStart <= 260) return text.slice(lineStart, extendedEnd).trim();
  if (lineEnd - lineStart <= 220) return text.slice(lineStart, lineEnd).trim();
  let left = Math.max(0, start - 100);
  let right = Math.min(text.length, end + 100);
  if (left > 0) {
    const space = text.indexOf(' ', left);
    if (space >= 0 && space < start) left = space + 1;
  }
  if (right < text.length) {
    const space = text.lastIndexOf(' ', right);
    if (space > end) right = space;
  }
  return text.slice(left, right).trim();
}

function currencyNear(before: string, after: string, text: string): string | undefined {
  const code =
    after.match(/^\s*([A-Z]{3})(?!\p{L})/u)?.[1] || before.match(/(?<!\p{L})([A-Z]{3})\s*$/u)?.[1];
  if (code && codes.has(code)) return code;
  if (/^\s*(?:zł|zl)(?!\p{L})/iu.test(after)) return 'PLN';
  if (/^\s*€/.test(after) || /€\s*$/.test(before)) return 'EUR';
  if (/^\s*£/.test(after) || /£\s*$/.test(before)) return 'GBP';
  if (/US\$\s*$/.test(before) || /^\s*US\$/.test(after)) return 'USD';
  // A bare dollar sign is ambiguous; require an explicit currency elsewhere.
  if ((/\$\s*$/.test(before) || /^\s*\$/.test(after)) && /\bUSD\b/.test(text)) return 'USD';
  return undefined;
}

/** Source-first facts: the model chooses IDs rather than retyping numbers or years. */
export function buildEvidence(pages: AnalysisRequest['pages']): EvidenceCatalog {
  const catalog: EvidenceCatalog = { amounts: [], dates: [] };
  const seen = new Set<string>();
  const amountScores = new Map<string, number>();
  for (const page of pages) {
    for (const match of page.text.matchAll(datePattern)) {
      const lineStart = page.text.lastIndexOf('\n', match.index) + 1;
      const lineEnd = page.text.indexOf('\n', match.index);
      if (
        /^Wersja\b.*Strona\s+\d+/i.test(
          page.text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd),
        )
      )
        continue;
      for (const date of explicitDates(match[0])) {
        if (!z.iso.date().safeParse(date).success) continue;
        const quote = excerpt(page.text, match.index, match.index + match[0].length);
        const key = `d:${page.number}:${date}:${quote}`;
        if (!seen.has(key)) {
          seen.add(key);
          catalog.dates.push({
            id: `d${catalog.dates.length + 1}`,
            date,
            source: { page: page.number, quote },
          });
        }
      }
    }
    for (const match of page.text.matchAll(numericPattern)) {
      const end = match.index + match[0].length;
      // A total row can contain a percentage next to money. It must not inherit
      // the currency from the payable total.
      if (/^\s*%/.test(page.text.slice(end))) continue;
      let currency = currencyNear(
        page.text.slice(Math.max(0, match.index - 12), match.index),
        page.text.slice(end, end + 12),
        page.text,
      );
      let quote = excerpt(page.text, match.index, end);
      const lineStart = page.text.lastIndexOf('\n', match.index) + 1;
      const lineEnd = page.text.indexOf('\n', end);
      const line = page.text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
      if (!currency && /^\s*(?:razem|total)\b/i.test(line)) {
        let nearbyEnd = Math.min(page.text.length, (lineEnd < 0 ? end : lineEnd) + 100);
        if (nearbyEnd < page.text.length && !/\s/u.test(page.text[nearbyEnd])) {
          while (nearbyEnd > end && !/\s/u.test(page.text[nearbyEnd - 1])) nearbyEnd--;
        }
        const nearby = page.text.slice(lineStart, nearbyEnd);
        const explicit = [...nearby.matchAll(/\b[A-Z]{3}\b/g)]
          .map((entry) => entry[0])
          .filter((entry) => codes.has(entry));
        if (/zł|\bPLN\b/iu.test(nearby)) explicit.push('PLN');
        if (new Set(explicit).size === 1) {
          currency = explicit[0];
          quote = nearby.trim();
        }
      }
      if (!currency) continue;
      const value = numberValue(match[0]);
      if (!Number.isFinite(value)) continue;
      const key = `${currency}:${value}`;
      const score =
        (isAmendmentPage(page.text) ? 100 : 0) +
        (/netto|brutto|abonament|wynagrodzeni|fee|price|cost/iu.test(quote) ? 10 : 0) -
        (/Podsumowanie finansowe/iu.test(quote) ? 20 : 0);
      const existing = catalog.amounts.find(
        (entry) => entry.currency === currency && entry.value === value,
      );
      if (existing) {
        if (score > (amountScores.get(key) || 0)) {
          existing.source = { page: page.number, quote };
          amountScores.set(key, score);
        }
      } else {
        amountScores.set(key, score);
        catalog.amounts.push({
          id: `a${catalog.amounts.length + 1}`,
          value,
          currency,
          source: { page: page.number, quote },
        });
      }
    }
  }
  return catalog;
}

export function extractionSchema(catalog: EvidenceCatalog, passages: ProsePassage[]) {
  const ids = (values: string[], max: number) =>
    values.length
      ? z.array(z.enum(values as [string, ...string[]])).max(max)
      : z.array(z.string()).max(0);
  const dates = [...new Set(catalog.dates.map((date) => date.date))];
  const currencies = [...new Set(catalog.amounts.map((amount) => amount.currency))];
  const amountGroups = Object.fromEntries(
    currencies.map((currency) => [
      currency,
      z
        .array(
          z.enum(
            catalog.amounts
              .filter((entry) => entry.currency === currency)
              .map((entry) => entry.id) as [string, ...string[]],
          ),
        )
        .min(1)
        .max(4),
    ]),
  );
  return resultSchema
    .omit({ summary: true, keyPoints: true, proseSources: true, amounts: true, dates: true })
    .extend({
      document: resultSchema.shape.document.extend({
        date: dates.length ? z.enum(dates as [string, ...string[]]).nullable() : z.null(),
      }),
      ...proseSelectionSchema(passages),
      entities: z.object({
        organizations: z.array(z.string().trim().min(1)).max(8),
        people: z.array(z.string().trim().min(1)).max(8),
      }),
      keywords: z.array(z.string().trim().min(1)).max(10),
      amounts: z.object(amountGroups),
      dates: ids(
        catalog.dates.map((entry) => entry.id),
        8,
      ),
    });
}

export function resolveEvidence(catalog: EvidenceCatalog, amounts: string[], dates: string[]) {
  return {
    amounts: [...new Set(amounts)].map((id) => {
      const entry = catalog.amounts.find((item) => item.id === id)!;
      return {
        value: entry.value,
        currency: entry.currency,
        context: entry.source.quote,
        source: entry.source,
      };
    }),
    dates: [...new Set(dates)].map((id) => {
      const entry = catalog.dates.find((item) => item.id === id)!;
      return { date: entry.date, context: entry.source.quote, source: entry.source };
    }),
  };
}
