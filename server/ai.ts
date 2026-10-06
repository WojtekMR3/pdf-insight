import { z } from 'zod';
import { CHUNK_CHARS } from './chunks.ts';
import { AppError, InvalidModelReply } from './errors.ts';

export type Environment = Record<string, string | undefined>;
export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[];
};
export type AiProvider = {
  model: string;
  local: boolean;
  /** Characters per long-document chunk; defaults to the local model's context. */
  chunkChars?: number;
  chat(
    messages: ChatMessage[],
    schema: unknown,
    signal: AbortSignal,
    maxTokens: number,
  ): Promise<string>;
  health(): Promise<boolean>;
};
type Transport = typeof fetch;

// Cloudflare Workers Free allows 50 subrequests per request; keep a safety margin.
export const MAX_CLOUD_REQUESTS = 40;
// Gemini reads far more context than the local model, so long documents need fewer requests.
const CLOUD_CHUNK_CHARS = 100_000;
const TRANSIENT_STATUSES = new Set([500, 502, 503, 504]);

const cancelled = () => new AppError('Anulowano analizę.', 499);
function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(cancelled());
    const stop = () => {
      clearTimeout(timer);
      reject(cancelled());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', stop);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', stop, { once: true });
  });
}

export function createProvider(env: Environment, transport: Transport = fetch): AiProvider {
  const name = env.AI_PROVIDER || 'ollama';
  if (!['ollama', 'gemini'].includes(name)) throw new AppError('Nieobsługiwany dostawca AI.', 500);
  const local = name === 'ollama';
  const model = local ? env.OLLAMA_MODEL || 'qwen3.5:9b' : env.GEMINI_MODEL;
  if (!model || (!local && !env.GEMINI_API_KEY))
    throw new AppError('Backend wymaga GEMINI_MODEL i sekretu GEMINI_API_KEY.', 503);
  const url = env.OLLAMA_URL || 'http://127.0.0.1:11434';
  if (
    local &&
    (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname) ||
      /:cloud|-cloud$/.test(model))
  )
    throw new AppError('Tryb lokalny wymaga modelu Ollama na tym komputerze.', 500);
  const timeoutMs = Number(env.AI_TIMEOUT_MS) || (local ? 240000 : 60000);
  const retryDelay = Number(env.AI_RETRY_DELAY_MS ?? 800) || 0;
  const maxRequests = local ? Number.POSITIVE_INFINITY : MAX_CLOUD_REQUESTS;
  let requests = 0; // A provider is created for each analysis request.

  async function send(
    endpoint: string,
    init: RequestInit,
    signal: AbortSignal,
    retried = false,
  ): Promise<Response> {
    if (++requests > maxRequests)
      throw new AppError(
        'Dokument wymaga zbyt wielu zapytań do AI. Podziel go na mniejsze części i spróbuj ponownie.',
        413,
      );
    let response: Response;
    try {
      response = await transport(endpoint, {
        ...init,
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      });
    } catch (error) {
      if (signal.aborted) throw cancelled();
      if (error instanceof Error && /timeout/i.test(error.name))
        throw new AppError('AI nie odpowiedziało na czas. Spróbuj ponownie.', 504);
      if (!retried) {
        await pause(retryDelay, signal);
        return send(endpoint, init, signal, true);
      }
      throw new AppError(
        local ? 'Nie można połączyć się z Ollama.' : 'Nie można połączyć się z API AI.',
        503,
      );
    }
    // An overloaded or briefly unavailable provider gets one more attempt.
    if (!retried && TRANSIENT_STATUSES.has(response.status)) {
      await response.body?.cancel().catch(() => {});
      await pause(retryDelay, signal);
      return send(endpoint, init, signal, true);
    }
    return response;
  }

  return {
    model,
    local,
    chunkChars: local ? CHUNK_CHARS : CLOUD_CHUNK_CHARS,
    async health() {
      if (!local) return true; // Configuration readiness, not a paid model request.
      try {
        const response = await transport(`${url}/api/tags`, { signal: AbortSignal.timeout(3000) });
        const data = z
          .object({ models: z.array(z.object({ name: z.string() })) })
          .parse(await response.json());
        return response.ok && data.models.some((entry) => entry.name === model);
      } catch {
        return false;
      }
    },
    async chat(messages, schema, signal, maxTokens) {
      const options: RequestInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      };
      let endpoint = `${url}/api/chat`;
      if (local) {
        options.body = JSON.stringify({
          model,
          stream: false,
          think: false,
          keep_alive: '15m',
          messages,
          format: schema,
          options: { temperature: 0, num_ctx: 32768, num_predict: maxTokens },
        });
      } else {
        endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
        options.headers = { ...options.headers, 'x-goog-api-key': env.GEMINI_API_KEY! };
        options.body = JSON.stringify({
          systemInstruction: {
            parts: messages.filter((m) => m.role === 'system').map((m) => ({ text: m.content })),
          },
          contents: messages
            .filter((m) => m.role !== 'system')
            .map((m) => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: [
                { text: m.content },
                ...(m.images || []).map((data) => ({
                  inlineData: { mimeType: 'image/jpeg', data },
                })),
              ],
            })),
          generationConfig: {
            temperature: 0,
            maxOutputTokens: maxTokens,
            responseMimeType: 'application/json',
            responseJsonSchema: schema,
            ...(model.startsWith('gemini-2.5-') && !model.includes('pro')
              ? { thinkingConfig: { thinkingBudget: 0 } }
              : {}),
          },
        });
      }
      const response = await send(endpoint, options, signal);
      if (!response.ok) {
        if (response.status === 429)
          throw new AppError('Wyczerpano chwilowy limit AI. Spróbuj ponownie później.', 429);
        if (TRANSIENT_STATUSES.has(response.status))
          throw new AppError(
            'Usługa AI jest chwilowo niedostępna. Spróbuj ponownie za chwilę.',
            503,
          );
        throw new AppError(
          local
            ? 'Ollama odrzuciła żądanie. Sprawdź, czy wybrany model jest zainstalowany.'
            : 'Usługa AI odrzuciła żądanie. Spróbuj ponownie lub wybierz mniejszy dokument.',
          502,
        );
      }
      let data: unknown;
      try {
        data = await response.json();
      } catch {
        throw new InvalidModelReply('AI returned invalid JSON.');
      }
      if (local) {
        const parsed = z
          .object({
            message: z.object({ content: z.string() }),
            done_reason: z.string().optional(),
          })
          .safeParse(data);
        if (!parsed.success)
          throw new InvalidModelReply('AI returned an invalid response envelope.');
        if (parsed.data.done_reason === 'length')
          throw new InvalidModelReply('Output was truncated; return more concise JSON.');
        return parsed.data.message.content;
      }
      const parsed = z
        .object({
          candidates: z
            .array(
              z.object({
                finishReason: z.string().optional(),
                content: z
                  .object({ parts: z.array(z.object({ text: z.string().optional() })) })
                  .optional(),
              }),
            )
            .min(1),
        })
        .safeParse(data);
      if (!parsed.success) throw new InvalidModelReply('AI returned an empty or invalid response.');
      const candidate = parsed.data.candidates[0];
      if (candidate.finishReason !== 'STOP')
        throw new InvalidModelReply(
          'AI response incomplete or blocked; return concise factual JSON.',
        );
      return candidate.content?.parts.map((part) => part.text || '').join('') || '';
    },
  };
}

export async function getHealth(env: Environment) {
  try {
    const provider = createProvider(env);
    const available = await provider.health();
    return {
      app: 'pdf-insight',
      available,
      model: provider.model,
      local: provider.local,
      message: available
        ? provider.local
          ? 'Model lokalny gotowy'
          : 'Połączenie z API AI skonfigurowane'
        : 'Uruchom Ollama i zainstaluj wybrany model.',
    };
  } catch (error) {
    return {
      app: 'pdf-insight',
      available: false,
      model: env.AI_PROVIDER || 'ollama',
      local: env.AI_PROVIDER !== 'gemini',
      message: error instanceof AppError ? error.message : 'Nieprawidłowa konfiguracja AI.',
    };
  }
}
