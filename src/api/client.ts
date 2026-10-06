import { z } from 'zod';
import { streamEventSchema, type AnalysisRequest, type StreamEvent } from '../../shared/schema';

const api = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const healthSchema = z.object({
  available: z.boolean(),
  model: z.string(),
  local: z.boolean(),
  message: z.string(),
});
export type Health = z.infer<typeof healthSchema>;

export async function getHealth(): Promise<Health> {
  const response = await fetch(`${api}/api/health`, { signal: AbortSignal.timeout(6000) });
  if (!response.ok) throw new Error('Serwer lokalny nie odpowiada.');
  return healthSchema.parse(await response.json());
}

export async function loadSample(signal: AbortSignal): Promise<File> {
  signal.throwIfAborted();
  const { default: sampleUrl } = await import('../assets/example-invoice.pdf?url');
  const response = await fetch(sampleUrl, { signal });
  if (!response.ok) throw new Error('Nie udało się wczytać przykładowego dokumentu.');
  return new File([await response.blob()], 'example-invoice.pdf', {
    type: 'application/pdf',
  });
}

export async function analyze(
  request: AnalysisRequest,
  signal: AbortSignal,
  onEvent: (event: StreamEvent) => void,
) {
  signal.throwIfAborted();
  let response: Response;
  try {
    response = await fetch(`${api}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
  } catch {
    signal.throwIfAborted();
    throw new Error('Nie można połączyć się z backendem. Spróbuj ponownie.');
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const error = z.object({ message: z.string() }).safeParse(body);
    throw new Error(error.success ? error.data.message : 'Nie udało się rozpocząć analizy.');
  }
  if (!response.body) throw new Error('Serwer nie zwrócił odpowiedzi.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const handleLine = (line: string) => {
    signal.throwIfAborted();
    if (!line.trim()) return false;
    let event: StreamEvent;
    try {
      event = streamEventSchema.parse(JSON.parse(line));
    } catch {
      throw new Error('Serwer zwrócił nieprawidłowe dane. Spróbuj ponownie.');
    }
    if (event.type === 'error') throw new Error(event.message);
    onEvent(event);
    return event.type === 'result';
  };
  const cancelRead = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', cancelRead, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) if (handleLine(line)) return;
    }
    buffer += decoder.decode();
    if (handleLine(buffer)) return;
    throw new Error('Połączenie zostało przerwane. Spróbuj ponownie.');
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof TypeError)
      throw new Error('Połączenie zostało przerwane. Spróbuj ponownie.');
    throw error;
  } finally {
    signal.removeEventListener('abort', cancelRead);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
