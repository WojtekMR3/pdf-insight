import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { analyzeDocument } from '../server/analysis';
import type { AiProvider } from '../server/ai';
import { AppError } from '../server/errors';
import { resolveSummary, summarySources } from '../server/summary';
import { resultSchema, analysisMetaSchema } from '../shared/schema';
import { exportJson } from '../src/lib/history';
import Results from '../src/components/Results';
import { modelResult } from './fixtures/model-result';

const quotes = [
  'The agreement was signed on October 1, 2026.',
  'The fee is USD 1250.50 only if the optional review is accepted.',
  'The service covers a website accessibility review.',
];
const sources = quotes.map((quote, i) => ({
  id: `s${i + 1}`,
  page: i + 1,
  quote,
  origin: 'pdf-text' as const,
  required: true,
}));
const draft = () => ({
  sentences: [
    { text: 'The contract was signed on October 1, 2026.', sourceIds: ['s1'] },
    { text: 'An accepted optional review costs USD 1250.50.', sourceIds: ['s2'] },
    { text: 'The work assesses the accessibility of a website.', sourceIds: ['s3'] },
  ],
});
const request = {
  fileName: 'agreement.pdf',
  fileSize: 1000,
  pageCount: 3,
  pages: quotes.map((text, i) => ({ number: i + 1, text })),
};
const extraction = {
  ...modelResult,
  document: { ...modelResult.document, language: 'en' },
  amounts: { USD: ['a1'] },
};
const approved = { supported: true, issues: [] };
const provider = (chat: AiProvider['chat']): AiProvider => ({
  model: 'test',
  local: false,
  chat,
  health: async () => true,
});
const run = (chat: AiProvider['chat']) =>
  analyzeDocument(request, new AbortController().signal, () => {}, provider(chat));
const reply = (value: unknown) => JSON.stringify(value);

describe('Natural summary source checks', () => {
  it('keeps paraphrases separate from exact PDF/OCR quotations', () => {
    const evidence = sources.map((source) => ({ ...source, origin: 'ocr' as const }));
    const result = resolveSummary(draft(), evidence);
    expect(result.summary).toBe(
      draft()
        .sentences.map((sentence) => sentence.text)
        .join(' '),
    );
    expect(result.summarySentences[1].sources).toEqual([
      { page: 2, quote: quotes[1], origin: 'ocr' },
    ]);
  });
  it.each([
    'The fee is USD 1250.51.',
    'The fee is USD 125050.',
    'The fee is USD -1250.50.',
    'The fee starts on October 1, 2026.',
  ])('rejects unsupported numeric wording against this cited evidence: %s', (text) => {
    const value = draft();
    value.sentences[1].text = text;
    expect(() => resolveSummary(value, sources)).toThrow(/numeric expression/);
  });
  it('rejects unknown citations, duplicates, omitted sources and more than five sentences', () => {
    const unknown = draft();
    unknown.sentences[0].sourceIds = ['s99'];
    expect(() => resolveSummary(unknown, sources)).toThrow();
    const missing = draft();
    missing.sentences[1].sourceIds = ['s1'];
    missing.sentences[1].text = 'The parties signed the contract.';
    expect(() => resolveSummary(missing, sources)).toThrow(/every required source/);
    const duplicate = draft();
    duplicate.sentences[2] = { ...duplicate.sentences[0] };
    expect(() => resolveSummary(duplicate, sources)).toThrow(/distinct/);
    expect(() =>
      resolveSummary({ sentences: [...draft().sentences, ...draft().sentences] }, sources),
    ).toThrow();
  });
  it('enforces one complete sentence per item', () => {
    const value = draft();
    value.sentences[2].text = 'The review covers accessibility. The website is reviewed.';
    expect(() => resolveSummary(value, sources)).toThrow(/one complete sentence/);
    value.sentences[2].text = 'Website accessibility review';
    expect(() => resolveSummary(value, sources)).toThrow(/complete sentence/);
  });
  it('retains decimal signs and Polish abbreviations without splitting sentences', () => {
    const evidence = [
      'Firma Alfa sp. z o.o. realizuje przegląd.',
      'Zwrot wynosi −1,25 PLN.',
      'Raport obejmuje dostępność witryny.',
    ].map((quote, i) => ({ ...sources[i], quote }));
    const value = {
      sentences: evidence.map((source) => ({ text: source.quote, sourceIds: [source.id] })),
    };
    expect(resolveSummary(value, evidence).summarySentences).toHaveLength(3);
    value.sentences[1].text = 'Zwrot wynosi 1,25 PLN.';
    expect(() => resolveSummary(value, evidence)).toThrow(/numeric expression/);
  });
  it('rejects superseded user counts even when both values appear in the cited amendment', () => {
    const evidence = [...sources];
    evidence[1] = { ...sources[1], quote: 'The number of users increases from 20 to 30.' };
    const value = draft();
    value.sentences[1].text = 'The contract covers 20 users.';
    expect(() => resolveSummary(value, evidence)).toThrow(/amendment/);
  });
});

it('rejects unsupported absence filler when the review identifies missing evidence', async () => {
  const invented = draft();
  invented.sentences[2].text = 'No amendments or exceptions are noted in the provided excerpts.';
  const chat = vi
    .fn<AiProvider['chat']>()
    .mockResolvedValueOnce(reply(extraction))
    .mockResolvedValueOnce(reply(invented))
    .mockResolvedValueOnce(
      reply({
        supported: false,
        issues: ['Selected excerpts cannot establish that amendments or exceptions are absent.'],
      }),
    )
    .mockResolvedValueOnce(reply(draft()))
    .mockResolvedValueOnce(reply(approved));
  const { result } = await run(chat);
  expect(result.summary).not.toContain('No amendments');
  expect(chat.mock.calls[1][0][0].content).toContain('Never fill space');
  expect(chat.mock.calls[2][0][0].content).toContain('Selected excerpts do not establish');
});

describe('Complete summary pipeline', () => {
  it('exports the natural summary and renders expandable citations without replacing key points', async () => {
    const chat = vi
      .fn<AiProvider['chat']>()
      .mockResolvedValueOnce(reply(extraction))
      .mockResolvedValueOnce(reply(draft()))
      .mockResolvedValueOnce(reply(approved));
    const { result, meta } = await run(chat);
    expect(chat).toHaveBeenCalledTimes(3);
    expect(result.summary).toContain('The work assesses');
    expect(result.keyPoints).toEqual(quotes);
    expect(meta.proseMode).toBe('generated');
    expect(summarySources(result)).toEqual(sources);
    const record = { id: 'test', result, meta, createdAt: '2026-10-06T12:00:00Z' };
    const exported = JSON.parse(exportJson(record));
    expect(resultSchema.parse(exported).summarySentences).toEqual(result.summarySentences);
    expect(analysisMetaSchema.parse(exported.analysis).proseMode).toBe('generated');
    const html = renderToStaticMarkup(createElement(Results, { record }));
    expect(html).toContain('The work assesses');
    expect(html).toContain('<details>');
    expect(html).toContain('The service covers');
    expect(html).toContain('Źródła · str.');
    // Previously saved results remain valid and readable without the new fields.
    const legacy = {
      ...record,
      result: { ...result, summarySentences: undefined, summary: quotes.join(' ') },
      meta: { ...meta, proseMode: 'extractive' as const },
    };
    expect(resultSchema.safeParse(legacy.result).success).toBe(true);
    expect(renderToStaticMarkup(createElement(Results, { record: legacy }))).not.toContain(
      'The work assesses',
    );
  });
  it('retries a plausible but unsupported billing inference after an independent review', async () => {
    const invented = draft();
    invented.sentences[1].text = 'The fee is USD 1250.50 per month.';
    const chat = vi
      .fn<AiProvider['chat']>()
      .mockResolvedValueOnce(reply(extraction))
      .mockResolvedValueOnce(reply(invented))
      .mockResolvedValueOnce(
        reply({
          supported: false,
          issues: ['Recurring billing is not stated and the acceptance condition is missing.'],
        }),
      )
      .mockResolvedValueOnce(reply(draft()))
      .mockResolvedValueOnce(reply(approved));
    const { result } = await run(chat);
    expect(result.summary).not.toContain('per month');
    expect(chat).toHaveBeenCalledTimes(5);
    expect(chat.mock.calls[3][0].at(-1)?.content).toContain('Recurring billing');
    expect(chat.mock.calls[2][0]).toHaveLength(2);
  });
  it('rejects two failed reviews instead of displaying unsupported prose', async () => {
    const chat = vi
      .fn<AiProvider['chat']>()
      .mockResolvedValueOnce(reply(extraction))
      .mockResolvedValueOnce(reply(draft()))
      .mockResolvedValueOnce(reply({ supported: false, issues: ['Unsupported claim.'] }))
      .mockResolvedValueOnce(reply(draft()))
      .mockResolvedValueOnce(reply({ supported: false, issues: ['Still unsupported.'] }));
    await expect(run(chat)).rejects.toThrow('ponownej próbie');
    expect(chat).toHaveBeenCalledTimes(5);
  });
  it('stops on review quota errors without starting another draft', async () => {
    const chat = vi
      .fn<AiProvider['chat']>()
      .mockResolvedValueOnce(reply(extraction))
      .mockResolvedValueOnce(reply(draft()))
      .mockRejectedValueOnce(new AppError('quota', 429));
    await expect(run(chat)).rejects.toThrow('quota');
    expect(chat).toHaveBeenCalledTimes(3);
  });
  it('does not review or export an invented numeric value', async () => {
    const invented = draft();
    invented.sentences[1].text = 'The review costs USD 9999.';
    const chat = vi
      .fn<AiProvider['chat']>()
      .mockResolvedValueOnce(reply(extraction))
      .mockResolvedValueOnce(reply(invented))
      .mockResolvedValueOnce(reply(invented));
    await expect(run(chat)).rejects.toThrow('ponownej próbie');
    expect(chat).toHaveBeenCalledTimes(3);
  });
});
