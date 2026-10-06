import { describe, expect, it, vi } from 'vitest';
import {
  buildProseCatalog,
  normalizeProse,
  proseSelectionSchema,
  resolveProse,
} from '../server/prose';
import { analyzeDocument } from '../server/analysis';
import type { AiProvider } from '../server/ai';
import { modelResult } from './fixtures/model-result';

const text =
  'The agreement was signed on October 1, 2026. The fee is USD 1250.50. The service covers a website accessibility review.';
const request = {
  fileName: 'agreement.pdf',
  fileSize: 1000,
  pageCount: 1,
  pages: [{ number: 1, text }],
};
const provider = (chat: AiProvider['chat']): AiProvider => ({
  model: 'test',
  local: true,
  chat,
  health: async () => true,
});
const selection = { ...modelResult, amounts: { USD: ['a1'] } };

describe('Extractive summary and key point safety', () => {
  it.each([
    'The number of users increases from 20 to 30.',
    'Liczba użytkowników Systemu zostaje zwiększona ze 120 do 135.',
  ])('retains omitted count and fee amendments: %s', async (countClause) => {
    const source = [
      {
        number: 1,
        text: 'The supplier reviews the website. The report covers accessibility. The parties approve the review.',
      },
      {
        number: 2,
        text: `ADDENDUM NO 1. ${countClause} The fee changes to USD 1500.00 from January 1, 2027.`,
      },
    ];
    const chat = vi
      .fn<AiProvider['chat']>()
      .mockResolvedValue(JSON.stringify({ ...modelResult, amounts: { USD: ['a1'] } }));
    const { result } = await analyzeDocument(
      { ...request, pageCount: 2, pages: source },
      new AbortController().signal,
      () => {},
      provider(chat),
    );
    for (const phrase of [countClause, 'The fee changes to USD 1500.00 from January 1, 2027.']) {
      expect(result.summary).toContain(phrase);
      expect(result.keyPoints).toContain(phrase);
    }
    expect(result.proseSources?.summary).toHaveLength(5);
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('keeps selected quotations in document order, with their matching source references', () => {
    const passages = buildProseCatalog(request.pages);
    const result = resolveProse(passages, ['p3', 'p1', 'p2'], ['p2', 'p3', 'p1'], []);
    expect(result.summary).toBe(text);
    expect(result.keyPoints).toEqual(passages.map((passage) => passage.quote));
    expect(result.proseSources.keyPoints.map((source) => source.quote)).toEqual(result.keyPoints);
  });

  it('cannot turn a signing date into a fee start date, even when AI supplies invented prose', async () => {
    const invented = 'The fee is payable monthly from October 1, 2026.';
    const chat = vi.fn<AiProvider['chat']>().mockResolvedValue(
      JSON.stringify({
        ...selection,
        summary: invented,
        summarySentences: [invented, invented, invented],
        keyPoints: [invented, invented, invented],
      }),
    );
    const { result, meta } = await analyzeDocument(
      request,
      new AbortController().signal,
      () => {},
      provider(chat),
    );
    expect(result.summary).toBe(text);
    expect(result.keyPoints).toEqual(
      buildProseCatalog(request.pages).map((source) => source.quote),
    );
    expect(JSON.stringify(result)).not.toContain('payable monthly');
    expect(result.proseSources?.summary.every((source) => source.origin === 'pdf-text')).toBe(true);
    expect(meta.proseMode).toBe('extractive');
  });

  it('retries unknown prose IDs once, then rejects them instead of falling back to generated text', async () => {
    const chat = vi
      .fn<AiProvider['chat']>()
      .mockResolvedValue(
        JSON.stringify({ ...selection, summaryPassages: ['p1', 'p2', 'invented fee date'] }),
      );
    await expect(
      analyzeDocument(request, new AbortController().signal, () => {}, provider(chat)),
    ).rejects.toThrow('ponownej próbie');
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('preserves negations, conditional clauses and numeric punctuation in whole sentences', () => {
    const source =
      'The supplier did not agree that the fee starts on October 1, 2026. The fee is USD 1.25 only if the customer accepts the optional review.';
    const passages = buildProseCatalog([{ number: 1, text: source }]);
    expect(passages.map((passage) => passage.quote).join(' ')).toBe(source);
    expect(normalizeProse('USD 1.25')).not.toBe(normalizeProse('USD 125'));
    expect(normalizeProse('does not apply')).not.toBe(normalizeProse('does apply'));
  });

  it('does not let chunk selection remove a negation or condition from an original sentence', () => {
    const pages = [
      {
        number: 1,
        text: 'It is false that the fee starts on October 1, 2026. The fee is USD 1250.50 if the optional review is accepted.',
      },
    ];
    const shortened = [
      { number: 1, text: 'the fee starts on October 1, 2026. The fee is USD 1250.50' },
    ];
    expect(buildProseCatalog(pages, shortened)).toEqual([]);
  });

  it('rejects repeated sentences and documents too short for the required summary', async () => {
    const passages = buildProseCatalog(request.pages);
    expect(
      proseSelectionSchema(passages).summaryPassages.safeParse(['p1', 'p1', 'p1']).success,
    ).toBe(false);
    const chat = vi.fn<AiProvider['chat']>();
    await expect(
      analyzeDocument(
        {
          ...request,
          pages: [{ number: 1, text: 'Only this one sentence appears in the document.' }],
        },
        new AbortController().signal,
        () => {},
        provider(chat),
      ),
    ).rejects.toThrow('Za mało pełnych zdań');
    expect(chat).not.toHaveBeenCalled();
  });

  it('labels OCR quotations instead of presenting them as verified PDF text', async () => {
    const chat = vi
      .fn<AiProvider['chat']>()
      .mockResolvedValueOnce(JSON.stringify({ text }))
      .mockResolvedValueOnce(JSON.stringify(selection));
    const { result } = await analyzeDocument(
      { ...request, pages: [{ number: 1, text: '', image: 'YWJj' }] },
      new AbortController().signal,
      () => {},
      provider(chat),
    );
    expect(result.proseSources?.summary.every((source) => source.origin === 'ocr')).toBe(true);
  });
});
