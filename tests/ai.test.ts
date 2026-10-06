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

const geminiEnv = {
  AI_PROVIDER: 'gemini',
  GEMINI_MODEL: 'gemini-test',
  GEMINI_API_KEY: 'test-secret',
  AI_RETRY_DELAY_MS: '0',
};
const geminiReply = () =>
  new Response(
    JSON.stringify({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }],
    }),
  );

it('retries one transient provider failure, then reports it in Polish', async () => {
  const signal = new AbortController().signal;
  const recovering = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('overloaded', { status: 503 }))
    .mockImplementation(async () => geminiReply());
  expect(await createProvider(geminiEnv, recovering).chat([], {}, signal, 10)).toBe('{}');
  expect(recovering).toHaveBeenCalledTimes(2);

  const failing = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response('overloaded', { status: 503 }));
  await expect(createProvider(geminiEnv, failing).chat([], {}, signal, 10)).rejects.toThrow(
    'chwilowo niedostępna',
  );
  expect(failing).toHaveBeenCalledTimes(2);

  const rejected = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response('bad', { status: 400 }));
  await expect(createProvider(geminiEnv, rejected).chat([], {}, signal, 10)).rejects.toThrow(
    'Usługa AI odrzuciła żądanie',
  );
  expect(rejected).toHaveBeenCalledTimes(1);
});

it('caps hosted model requests per analysis below the Workers subrequest limit', async () => {
  const transport = vi.fn<typeof fetch>().mockImplementation(async () => geminiReply());
  const provider = createProvider(geminiEnv, transport);
  const signal = new AbortController().signal;
  for (let call = 0; call < 40; call++) await provider.chat([], {}, signal, 10);
  await expect(provider.chat([], {}, signal, 10)).rejects.toThrow('zbyt wielu');
  expect(transport).toHaveBeenCalledTimes(40);
  expect(provider.chunkChars).toBeGreaterThan(createProvider({}).chunkChars ?? 0);
});

it('blocks cloud Ollama addresses and missing Gemini configuration', () => {
  expect(() => createProvider({ OLLAMA_URL: 'https://example.com' })).toThrow('Tryb lokalny');
  expect(() => createProvider({ OLLAMA_MODEL: 'model:cloud' })).toThrow('Tryb lokalny');
  expect(() => createProvider({ AI_PROVIDER: 'gemini' })).toThrow('GEMINI_MODEL');
});
