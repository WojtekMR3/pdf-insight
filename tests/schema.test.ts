import { describe, expect, it } from 'vitest';
import { analysisRequestSchema, resultSchema, MAX_TEXT_CHARS } from '../shared/schema';
import { extractionSchema } from '../server/evidence';
import { buildProseCatalog } from '../server/prose';

const valid = {
  document: {
    fileName: 'umowa.pdf',
    pages: 12,
    language: 'pl',
    type: 'umowa',
    title: 'Umowa ramowa',
    date: '2026-03-12',
  },
  summary:
    'Strony zawarły umowę. Dotyczy wdrożenia systemu CRM. Wdrożenie kosztuje 184 500 PLN netto.',
  keyPoints: ['Wdrożenie CRM.', 'Okres 24 miesięcy.', 'Obsługa 135 użytkowników.'],
  entities: { organizations: ['Example Studio sp. z o.o.'], people: [] },
  amounts: [{ value: 184500, currency: 'PLN', context: 'Wdrożenie, netto' }],
  dates: [{ date: '2026-10-12', context: 'Go-live' }],
  keywords: ['CRM', 'SLA'],
};

describe('Required output contract', () => {
  it('accepts the required shape and explicit missing information', () => {
    expect(resultSchema.parse(valid).document.pages).toBe(12);
    expect(
      resultSchema.safeParse({
        ...valid,
        document: { ...valid.document, title: null, date: null },
        amounts: [],
        dates: [],
      }).success,
    ).toBe(true);
  });
  it('rejects missing required fields, invalid dates, currencies and numeric strings', () => {
    expect(resultSchema.safeParse({ ...valid, summary: undefined }).success).toBe(false);
    expect(
      resultSchema.safeParse({ ...valid, document: { ...valid.document, date: '2026-02-30' } })
        .success,
    ).toBe(false);
    expect(
      resultSchema.safeParse({
        ...valid,
        amounts: [{ value: '184500', currency: 'zł', context: 'netto' }],
      }).success,
    ).toBe(false);
  });
  it('requires 3–7 key points and 3–5 distinct source sentences', () => {
    expect(resultSchema.safeParse({ ...valid, keyPoints: ['Only one'] }).success).toBe(false);
    const model = {
      ...valid,
      document: { ...valid.document, date: null },
      amounts: {},
      dates: [],
      summaryPassages: ['p1', 'p2', 'p3'],
      keyPointPassages: ['p1', 'p2', 'p3'],
    };
    const passages = buildProseCatalog([
      {
        number: 1,
        text: 'This is the first sentence. This is the second sentence. This is the third sentence.',
      },
    ]);
    const modelResultSchema = extractionSchema({ amounts: [], dates: [] }, passages);
    expect(modelResultSchema.safeParse(model).success).toBe(true);
    expect(modelResultSchema.safeParse({ ...model, summaryPassages: ['p1'] }).success).toBe(false);
  });
});

describe('Untrusted API inputs', () => {
  const request = {
    fileName: 'document.pdf',
    fileSize: 1000,
    pageCount: 1,
    pages: [{ number: 1, text: 'Test document' }],
  };
  it('rejects excess upload sizes and inconsistent page coverage', () => {
    expect(analysisRequestSchema.safeParse(request).success).toBe(true);
    expect(
      analysisRequestSchema.safeParse({ ...request, fileSize: 11 * 1024 * 1024 }).success,
    ).toBe(false);
    expect(analysisRequestSchema.safeParse({ ...request, pageCount: 2 }).success).toBe(false);
    expect(
      analysisRequestSchema.safeParse({ ...request, pages: [{ number: 2, text: 'Wrong order' }] })
        .success,
    ).toBe(false);
  });
  it('rejects oversized text and malformed image payloads', () => {
    expect(
      analysisRequestSchema.safeParse({
        ...request,
        pages: [{ number: 1, text: 'x'.repeat(MAX_TEXT_CHARS + 1) }],
      }).success,
    ).toBe(false);
    expect(
      analysisRequestSchema.safeParse({
        ...request,
        pages: [{ number: 1, text: '', image: 'https://example.com/image' }],
      }).success,
    ).toBe(false);
  });
});

it('rejects invented ISO codes while retaining historical currencies', () => {
  expect(
    resultSchema.safeParse({ ...valid, document: { ...valid.document, language: 'zz' } }).success,
  ).toBe(false);
  expect(
    resultSchema.safeParse({ ...valid, amounts: [{ value: 10, currency: 'ZZZ', context: 'fee' }] })
      .success,
  ).toBe(false);
  expect(
    resultSchema.safeParse({
      ...valid,
      amounts: [{ value: 10, currency: 'DEM', context: 'historical fee' }],
    }).success,
  ).toBe(true);
});
