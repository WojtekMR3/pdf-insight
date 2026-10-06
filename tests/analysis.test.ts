import { describe, it, expect, vi } from 'vitest';
import { analyzeDocument, validatedReply } from '../server/analysis';
import { splitPages } from '../server/chunks';
import { AppError, InvalidModelReply } from '../server/errors';
import { checkAmendments } from '../server/grounding';
import type { AiProvider } from '../server/ai';
import { modelResult } from './fixtures/model-result';
const signal = () => new AbortController().signal;
const provider = (chat: AiProvider['chat']): AiProvider => ({
  model: 'test',
  local: true,
  chat,
  health: async () => true,
});

describe('Single retry and source accuracy', () => {
  it('retries a truncated response exactly once, then accepts valid JSON', async () => {
    const chat = vi
      .fn<AiProvider['chat']>()
      .mockRejectedValueOnce(new InvalidModelReply('truncated'))
      .mockResolvedValueOnce('{"ok":true}');
    expect(await validatedReply(provider(chat), [], {}, (value) => value, signal(), 100)).toEqual({
      ok: true,
    });
    expect(chat).toHaveBeenCalledTimes(2);
  });
  it('stops after two malformed replies and does not retry transport failures', async () => {
    const malformed = vi.fn<AiProvider['chat']>().mockResolvedValue('not json');
    await expect(
      validatedReply(provider(malformed), [], {}, (value) => value, signal(), 100),
    ).rejects.toThrow('ponownej próbie');
    expect(malformed).toHaveBeenCalledTimes(2);
    const unavailable = vi.fn<AiProvider['chat']>().mockRejectedValue(new AppError('offline', 503));
    await expect(
      validatedReply(provider(unavailable), [], {}, (value) => value, signal(), 100),
    ).rejects.toThrow('offline');
    expect(unavailable).toHaveBeenCalledTimes(1);
  });
  it('uses verified date wording, discarding an incorrect AI date label', async () => {
    const quote = 'Stara stawka obowiązuje do dnia 31 marca 2027 r., nowa od 1 kwietnia 2027 r.';
    const chat = vi.fn<AiProvider['chat']>().mockResolvedValue(
      JSON.stringify({
        ...modelResult,
        dates: ['d1'],
        dateLabels: ['Data wejścia nowej stawki'],
      }),
    );
    const result = await analyzeDocument(
      {
        fileName: 'actual.pdf',
        fileSize: 1000,
        pageCount: 1,
        pages: [
          {
            number: 1,
            text: quote + '\n\nUmowa dotyczy wdrożenia systemu. System obsługuje użytkowników.',
          },
        ],
      },
      signal(),
      () => {},
      provider(chat),
    );
    expect(result.result.dates[0].context).toBe(quote);
    expect(result.result.document.fileName).toBe('actual.pdf');
  });
  it('rejects unlabelled superseded counts but allows explicit historical comparisons', () => {
    const pages = [
      { number: 2, text: 'Aneks: Liczba użytkowników zostaje zwiększona ze 120 do 135.' },
    ];
    expect(checkAmendments(['System dla 120 użytkowników.'], pages)).toHaveLength(1);
    expect(checkAmendments(['System dla 135 użytkowników.'], pages)).toHaveLength(0);
    expect(checkAmendments(['Pierwotnie 120 użytkowników.'], pages)).toHaveLength(0);
    expect(checkAmendments(['Opłata wynosi 120 PLN.'], pages)).toHaveLength(0);
  });
});

describe('Long documents', () => {
  it('retains original page numbers and every character across overlapping chunks', () => {
    const first = Array.from({ length: 1700 }, (_, i) => String.fromCharCode(0x400 + i)).join('');
    const chunks = splitPages(
      [
        { number: 1, text: first },
        { number: 2, text: 'TAIL'.repeat(300) },
      ],
      1000,
    );
    expect(chunks.length).toBeGreaterThan(1);
    expect(
      chunks.every((chunk) => chunk.reduce((n, page) => n + page.text.length, 0) <= 1000),
    ).toBe(true);
    const reconstructed = chunks
      .flat()
      .filter((p) => p.number === 1)
      .map((p) => p.text)
      .join('');
    for (const char of first) expect(reconstructed).toContain(char);
    expect(chunks.at(-1)?.at(-1)?.number).toBe(2);
    expect(chunks.at(-1)?.at(-1)?.text.endsWith('TAIL')).toBe(true);
  });
  it('merges selected evidence from every chunk before producing the final result', async () => {
    const seen: string[] = [];
    const chat = vi.fn<AiProvider['chat']>(async (messages) => {
      const input = messages.at(-1)!.content;
      if (messages[0].content.includes('Select up to 12')) {
        seen.push(input);
        const page = input.includes('[PAGE 2]') ? 2 : 1;
        return JSON.stringify({
          passages: [
            {
              page,
              quote:
                page === 2
                  ? 'AMENDMENT changes the scope.'
                  : 'MAIN document identifies the parties. The supplier tests the website.',
            },
          ],
        });
      }
      expect(input).toContain('MAIN document identifies the parties.');
      expect(input).toContain('AMENDMENT changes the scope.');
      return JSON.stringify(modelResult);
    });
    const result = await analyzeDocument(
      {
        fileName: 'long.pdf',
        fileSize: 2000,
        pageCount: 2,
        pages: [
          {
            number: 1,
            text:
              'MAIN document identifies the parties. The supplier tests the website.' +
              ' FILLER'.repeat(4600),
          },
          { number: 2, text: 'AMENDMENT changes the scope.' + ' TAIL'.repeat(2000) },
        ],
      },
      signal(),
      () => {},
      provider(chat),
    );
    expect(seen.length).toBe(2);
    expect(result.meta.chunkCount).toBe(2);
    expect(result.result.document.pages).toBe(2);
  });
});
