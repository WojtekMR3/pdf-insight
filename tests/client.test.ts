import { afterEach, expect, it, vi } from 'vitest';
import { analyze } from '../src/api/client';
import type { StreamEvent } from '../shared/schema';

const request = {
  fileName: 'report.pdf',
  fileSize: 100,
  pageCount: 1,
  pages: [{ number: 1, text: 'Report.' }],
};
const result: StreamEvent = {
  type: 'result',
  result: {
    document: {
      fileName: 'report.pdf',
      pages: 1,
      language: 'pl',
      type: 'raport',
      title: null,
      date: null,
    },
    summary: 'Raport opisuje usługę. Usługa została wykonana. Przegląd zakończono.',
    keyPoints: ['Usługa.', 'Przegląd.', 'Zakończenie.'],
    entities: { organizations: [], people: [] },
    amounts: [],
    dates: [],
    keywords: [],
  },
  meta: {
    model: 'test',
    elapsedMs: 1,
    ocrPages: [],
    unreadPages: [],
    warnings: [],
    source: 'local-ai',
  },
};
const encoder = new TextEncoder();
const mockStream = (chunks: Uint8Array[], cancel = vi.fn()) => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            chunks.forEach((chunk) => controller.enqueue(chunk));
            controller.close();
          },
          cancel,
        }),
      ),
    ),
  );
};
afterEach(() => vi.unstubAllGlobals());

it('reports a disconnected backend in Polish', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
  await expect(analyze(request, new AbortController().signal, vi.fn())).rejects.toThrow(
    'Nie można połączyć się z backendem. Spróbuj ponownie.',
  );
});

it('reports a connection lost while reading the stream in Polish', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new TypeError('network error'));
          },
        }),
      ),
    ),
  );
  await expect(analyze(request, new AbortController().signal, vi.fn())).rejects.toThrow(
    'Połączenie zostało przerwane. Spróbuj ponownie.',
  );
});

it('decodes split UTF-8 characters, heartbeat lines and a final event without a newline', async () => {
  const bytes = encoder.encode('\n' + JSON.stringify(result));
  mockStream(Array.from(bytes, (byte) => Uint8Array.of(byte)));
  const onEvent = vi.fn();
  await analyze(request, new AbortController().signal, onEvent);
  expect(onEvent).toHaveBeenCalledExactlyOnceWith(result);
});

it('treats a result as terminal and cancels the stream before any later events', async () => {
  const cancel = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                JSON.stringify(result) +
                  '\n' +
                  JSON.stringify({ type: 'error', message: 'Late error' }) +
                  '\n',
              ),
            );
          },
          cancel,
        }),
      ),
    ),
  );
  const onEvent = vi.fn();
  await expect(analyze(request, new AbortController().signal, onEvent)).resolves.toBeUndefined();
  expect(onEvent).toHaveBeenCalledExactlyOnceWith(result);
  expect(cancel).toHaveBeenCalledTimes(1);
});

it('does not deliver buffered results after cancellation', async () => {
  const controller = new AbortController();
  const progress = { type: 'progress', stage: 'analysis', message: 'Analiza…' };
  mockStream([encoder.encode(JSON.stringify(progress) + '\n' + JSON.stringify(result) + '\n')]);
  const onEvent = vi.fn(() => controller.abort());
  await expect(analyze(request, controller.signal, onEvent)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(onEvent).toHaveBeenCalledTimes(1);
});

it.each(['not json\n', '{"type":"result"}\n'])(
  'reports malformed responses in Polish: %s',
  async (line) => {
    mockStream([encoder.encode(line)]);
    await expect(analyze(request, new AbortController().signal, vi.fn())).rejects.toThrow(
      'Serwer zwrócił nieprawidłowe dane. Spróbuj ponownie.',
    );
  },
);

it('reports a truncated stream instead of leaving the interface loading', async () => {
  mockStream([encoder.encode('\n')]);
  await expect(analyze(request, new AbortController().signal, vi.fn())).rejects.toThrow(
    'Połączenie zostało przerwane',
  );
});
