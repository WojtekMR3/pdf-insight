import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { createServer as createViteServer } from 'vite';
import { analysisRequestSchema, type StreamEvent } from '../shared/schema.ts';
import { analyzeDocument } from './analysis.ts';
import { AppError } from './errors.ts';
import { createProvider, getHealth } from './ai.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
if (existsSync(path.join(root, '.env'))) loadEnvFile(path.join(root, '.env'));
const port = Number(process.env.PORT) || 4173;
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS || `http://localhost:${port},http://127.0.0.1:${port}`)
    .split(',')
    .map((origin) => origin.trim()),
);
const isProduction = process.argv.includes('--production');
const vite = isProduction
  ? null
  : await createViteServer({ root, server: { middlewareMode: true }, appType: 'spa' });
let busy = false;
const requests = new Map<string, number[]>();

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += bytes.length;
    if (size > 12 * 1024 * 1024) throw new AppError('Żądanie przekracza limit rozmiaru.', 413);
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new AppError('Nieprawidłowe dane żądania.');
  }
}

const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const url = new URL(req.url || '/', `http://localhost:${port}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      const origin = req.headers.origin;
      if (origin && !allowedOrigins.has(origin)) {
        json(res, 403, { message: 'Niedozwolone źródło żądania.' });
        return;
      }
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
      if (req.method === 'OPTIONS') {
        res
          .writeHead(204, {
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          })
          .end();
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/health') {
        json(res, 200, await getHealth(process.env));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/sample') {
        const sample = path.join(root, 'Test_PDF_Insight_umowa_14-2026.pdf');
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'inline; filename="Test_PDF_Insight_umowa_14-2026.pdf"',
        });
        createReadStream(sample).pipe(res);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/analyze') {
        if (!req.headers['content-type']?.startsWith('application/json'))
          throw new AppError('Wymagany format application/json.', 415);
        if (busy) throw new AppError('Trwa już analiza. Poczekaj na jej zakończenie.', 429);
        const key = req.socket.remoteAddress || 'local';
        const recent = (requests.get(key) || []).filter((time) => Date.now() - time < 60000);
        if (recent.length >= 6)
          throw new AppError('Zbyt wiele żądań. Spróbuj ponownie za minutę.', 429);
        requests.set(key, [...recent, Date.now()]);
        const parsed = analysisRequestSchema.safeParse(await readBody(req));
        if (!parsed.success)
          throw new AppError(
            'Nieprawidłowe dane dokumentu. Sprawdź format, rozmiar i liczbę stron.',
          );
        // Recheck after awaiting the body so concurrent uploads cannot both acquire the model.
        if (busy) throw new AppError('Trwa już analiza. Poczekaj na jej zakończenie.', 429);
        busy = true;
        const controller = new AbortController();
        res.on('close', () => {
          if (!res.writableEnded) controller.abort();
        });
        res.writeHead(200, {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Accel-Buffering': 'no',
        });
        const emit = (event: StreamEvent) => {
          if (!res.destroyed) res.write(`${JSON.stringify(event)}\n`);
        };
        const heartbeat = setInterval(() => {
          if (!res.destroyed) res.write('\n');
        }, 10000);
        try {
          const analysis = await analyzeDocument(
            parsed.data,
            controller.signal,
            emit,
            createProvider(process.env),
          );
          emit({ type: 'result', ...analysis });
        } catch (error) {
          emit({
            type: 'error',
            message:
              error instanceof AppError
                ? error.message
                : 'Wystąpił błąd podczas analizy dokumentu. Spróbuj ponownie.',
          });
        } finally {
          clearInterval(heartbeat);
          busy = false;
          res.end();
        }
        return;
      }
      json(res, 404, { message: 'Nie znaleziono tego endpointu.' });
      return;
    }
    if (vite) {
      vite.middlewares(req, res);
      return;
    }
    const dist = path.join(root, 'dist');
    const requested = path.resolve(dist, `.${decodeURIComponent(url.pathname)}`);
    if (!requested.startsWith(dist + path.sep) && requested !== dist)
      throw new AppError('Niedozwolona ścieżka.', 403);
    let target = requested;
    try {
      if (!(await stat(target)).isFile()) target = path.join(dist, 'index.html');
    } catch {
      target = path.join(dist, 'index.html');
    }
    const types: Record<string, string> = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.mjs': 'text/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
      '.wasm': 'application/wasm',
    };
    res.writeHead(200, {
      'Content-Type': types[path.extname(target)] || 'application/octet-stream',
    });
    res.end(await readFile(target));
  } catch (error) {
    if (!res.headersSent)
      json(res, error instanceof AppError ? error.status : 500, {
        message: error instanceof AppError ? error.message : 'Błąd serwera lokalnego.',
      });
    else res.end();
  }
});

server.listen(port, '127.0.0.1', () =>
  process.stdout.write(`PDF Insight działa pod adresem http://localhost:${port}\n`),
);
async function shutdown() {
  server.close();
  await vite?.close();
  process.exit(0);
}
process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
