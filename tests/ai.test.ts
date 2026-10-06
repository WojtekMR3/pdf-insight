import { it, expect, vi } from 'vitest';
import { createProvider, getHealth } from '../server/ai';
import { InvalidModelReply } from '../server/errors';

it('keeps Gemini credentials in headers and forwards image/schema requests', async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"text":"ok"}' }] } }],
      }),
    ),
  );
  const provider = createProvider(
    { AI_PROVIDER: 'gemini', GEMINI_MODEL: 'gemini-test', GEMINI_API_KEY: 'test-secret' },
    transport,
  );
  const result = await provider.chat(
    [
      { role: 'system', content: 'Extract data.' },
      { role: 'user', content: 'Read', images: ['YWJj'] },
    ],
    { type: 'object' },
    new AbortController().signal,
    1000,
  );
  expect(result).toBe('{"text":"ok"}');
  const [url, options] = transport.mock.calls[0];
  expect(String(url)).not.toContain('test-secret');
  expect(new Headers(options?.headers).get('x-goog-api-key')).toBe('test-secret');
  expect(String(options?.body)).not.toContain('test-secret');
  const body = JSON.parse(String(options?.body));
  expect(body.contents[0].parts[1].inlineData).toEqual({ mimeType: 'image/jpeg', data: 'YWJj' });
  expect(body.generationConfig.responseJsonSchema).toEqual({ type: 'object' });
  expect(
    await getHealth({
      AI_PROVIDER: 'gemini',
      GEMINI_MODEL: 'gemini-test',
      GEMINI_API_KEY: 'test-secret',
    }),
  ).not.toHaveProperty('GEMINI_API_KEY');
});

it('treats Ollama output truncation as a retryable invalid response', async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(JSON.stringify({ message: { content: '{' }, done_reason: 'length' })),
    );
  await expect(
    createProvider({}, transport).chat([], {}, new AbortController().signal, 10),
  ).rejects.toBeInstanceOf(InvalidModelReply);
});

it('blocks cloud Ollama addresses and missing Gemini configuration', () => {
  expect(() => createProvider({ OLLAMA_URL: 'https://example.com' })).toThrow('Tryb lokalny');
  expect(() => createProvider({ OLLAMA_MODEL: 'model:cloud' })).toThrow('Tryb lokalny');
  expect(() => createProvider({ AI_PROVIDER: 'gemini' })).toThrow('GEMINI_MODEL');
});
