import { analysisRequestSchema, type StreamEvent } from '../shared/schema.ts';
import { createProvider, getHealth, type Environment } from './ai.ts';
import { analyzeDocument } from './analysis.ts';
import { AppError } from './errors.ts';

export type WorkerEnv = {
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  ALLOWED_ORIGINS?: string;
  AI_TIMEOUT_MS?: string;
  ANALYSIS_LIMIT: { limit(options: { key: string }): Promise<{ success: boolean }> };
};
export const MAX_BODY_BYTES = 12 * 1024 * 1024;

async function readJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get('Content-Length')) > MAX_BODY_BYTES)
    throw new AppError('Żądanie przekracza limit rozmiaru.', 413);
  if (!request.body) throw new AppError('Brak danych dokumentu.');
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new AppError('Żądanie przekracza limit rozmiaru.', 413);
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new AppError('Nieprawidłowy JSON.');
  }
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const headers = new Headers({
      'Cache-Control': 'no-store',
      Vary: 'Origin',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    const json = (status: number, body: unknown) => {
      headers.set('Content-Type', 'application/json; charset=utf-8');
      return new Response(JSON.stringify(body), { status, headers });
    };
    try {
      const allowed = (env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      if (!allowed.length || allowed.includes('*'))
        throw new AppError('Backend wymaga dokładnej domeny demo w ALLOWED_ORIGINS.', 503);
      const origin = request.headers.get('Origin');
      if (!origin || !allowed.includes(origin))
        return json(403, { message: 'Niedozwolone źródło żądania.' });
      headers.set('Access-Control-Allow-Origin', origin);
      if (request.method === 'OPTIONS') {
        headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        headers.set('Access-Control-Allow-Headers', 'Content-Type');
        return new Response(null, { status: 204, headers });
      }
      const config: Environment = {
        AI_PROVIDER: 'gemini',
        GEMINI_MODEL: env.GEMINI_MODEL,
        GEMINI_API_KEY: env.GEMINI_API_KEY,
        AI_TIMEOUT_MS: env.AI_TIMEOUT_MS,
      };
      const route = new URL(request.url).pathname;
      if (route === '/api/health' && request.method === 'GET')
        return json(200, await getHealth(config));
      if (route !== '/api/analyze') return json(404, { message: 'Nie znaleziono endpointu.' });
      if (request.method !== 'POST') return json(405, { message: 'Wymagane żądanie POST.' });
      if (!request.headers.get('Content-Type')?.startsWith('application/json'))
        throw new AppError('Wymagany format application/json.', 415);
      if (!env.ANALYSIS_LIMIT) throw new AppError('Brak konfiguracji limitu żądań.', 503);
      // Anonymous demo: IP buckets are deliberately conservative and may be shared behind NAT.
      const limited = await env.ANALYSIS_LIMIT.limit({
        key: request.headers.get('CF-Connecting-IP') || 'anonymous',
      });
      if (!limited.success)
        throw new AppError('Zbyt wiele żądań. Spróbuj ponownie za minutę.', 429);
      const parsed = analysisRequestSchema.safeParse(await readJson(request));
      if (!parsed.success)
        throw new AppError('Nieprawidłowe dane, rozmiar lub liczba stron dokumentu.');
      const provider = createProvider(config);
      const abort = new AbortController();
      const signal = AbortSignal.any([request.signal, abort.signal]);
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const emit = (event: StreamEvent) => {
            if (!signal.aborted) controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
          };
          const heartbeat = setInterval(() => {
            if (!signal.aborted) controller.enqueue(encoder.encode('\n'));
          }, 10000);
          void analyzeDocument(parsed.data, signal, emit, provider)
            .then(
              (analysis) => emit({ type: 'result', ...analysis }),
              (error: unknown) =>
                emit({
                  type: 'error',
                  message:
                    error instanceof AppError ? error.message : 'Błąd analizy. Spróbuj ponownie.',
                }),
            )
            .finally(() => {
              clearInterval(heartbeat);
              if (!signal.aborted) controller.close();
            });
        },
        cancel() {
          abort.abort();
        },
      });
      headers.set('Content-Type', 'application/x-ndjson; charset=utf-8');
      return new Response(stream, { headers });
    } catch (error) {
      return json(error instanceof AppError ? error.status : 500, {
        message: error instanceof AppError ? error.message : 'Błąd backendu.',
      });
    }
  },
};
