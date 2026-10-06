import { afterEach, expect, it, vi } from 'vitest';
import worker, { MAX_BODY_BYTES, type WorkerEnv } from '../server/worker';

const origin = 'https://demo.example';
const env = (): WorkerEnv => ({
  ALLOWED_ORIGINS: origin,
  GEMINI_MODEL: 'gemini-test',
  GEMINI_API_KEY: 'test-secret',
  ANALYSIS_LIMIT: { limit: vi.fn().mockResolvedValue({ success: true }) },
});
const request = (body: string, headers: Record<string, string> = {}) =>
  new Request('https://api.example/api/analyze', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
    body,
  });
afterEach(() => vi.restoreAllMocks());

it('allows only the exact configured origin and handles preflight', async () => {
  expect(
    (await worker.fetch(request('{}', { Origin: 'https://demo.example.evil.test' }), env())).status,
  ).toBe(403);
  const preflight = await worker.fetch(
    new Request('https://api.example/api/analyze', {
      method: 'OPTIONS',
      headers: { Origin: origin },
    }),
    env(),
  );
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(origin);
  expect((await worker.fetch(request('{}'), { ...env(), ALLOWED_ORIGINS: '*' })).status).toBe(503);
});

it('enforces rate, content type, JSON schema and streaming body size limits', async () => {
  const limited = env();
  limited.ANALYSIS_LIMIT.limit = vi.fn().mockResolvedValue({ success: false });
  expect((await worker.fetch(request('{}'), limited)).status).toBe(429);
  expect((await worker.fetch(request('{}', { 'Content-Type': 'text/plain' }), env())).status).toBe(
    415,
  );
  expect((await worker.fetch(request('not json'), env())).status).toBe(400);
  expect((await worker.fetch(request('{}'), env())).status).toBe(400);
  expect((await worker.fetch(request('x'.repeat(MAX_BODY_BYTES + 1)), env())).status).toBe(413);
});

it('streams a schema-validated result using a mocked Gemini response without exposing the key', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        candidates: [
          {
            finishReason: 'STOP',
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    document: {
                      fileName: 'file.pdf',
                      pages: 1,
                      language: 'en',
                      type: 'raport',
                      title: null,
                      date: null,
                    },
                    summaryPassages: ['p1', 'p2', 'p3'],
                    keyPointPassages: ['p1', 'p2', 'p3'],
                    entities: { organizations: [], people: [] },
                    amounts: {},
                    dates: [],
                    keywords: [],
                  }),
                },
              ],
            },
          },
        ],
      }),
    ),
  );
  const response = await worker.fetch(
    request(
      JSON.stringify({
        fileName: 'file.pdf',
        fileSize: 1000,
        pageCount: 1,
        pages: [
          {
            number: 1,
            text: 'The report describes a project. The project is complete. No service price is stated.',
          },
        ],
      }),
    ),
    env(),
  );
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text).not.toContain('test-secret');
  const events = text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  expect(events.at(-1).type).toBe('result');
  expect(events.at(-1).meta.source).toBe('cloud-ai');
});
