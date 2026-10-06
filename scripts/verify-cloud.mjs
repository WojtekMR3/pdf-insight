import assert from 'node:assert/strict';
import { appendFile, readFile, stat } from 'node:fs/promises';
import { analysisRequestSchema, streamEventSchema } from '../shared/schema.ts';

const api = new URL(process.env.API_URL || '');
const frontend = new URL(process.env.FRONTEND_ORIGIN || '');
assert.equal(api.protocol, 'https:', 'The deployed API must use HTTPS.');
assert.equal(frontend.protocol, 'https:', 'The frontend must use HTTPS.');
assert.equal(frontend.href, `${frontend.origin}/`, 'FRONTEND_ORIGIN must not include a path.');
const headers = { Origin: frontend.origin };
const request = (path, options = {}) =>
  fetch(new URL(path, api), {
    ...options,
    cache: 'no-store',
    headers: { ...headers, ...options.headers },
    signal: AbortSignal.timeout(180000),
  });

const health = await request('/api/health');
assert.equal(health.status, 200, 'Health endpoint failed.');
assert.equal(health.headers.get('Access-Control-Allow-Origin'), frontend.origin);
const status = await health.json();
assert.equal(status.available, true, 'Backend provider configuration is missing.');
assert.equal(status.local, false, 'Public demo must use the cloud provider.');
const preflight = await request('/api/analyze', {
  method: 'OPTIONS',
  headers: {
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'content-type',
  },
});
assert.equal(preflight.status, 204, 'Browser preflight failed.');
assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), frontend.origin);
assert.match(preflight.headers.get('Access-Control-Allow-Methods') || '', /POST/);
assert.match(preflight.headers.get('Access-Control-Allow-Headers') || '', /content-type/i);
const denied = await request('/api/health', { headers: { Origin: 'https://unrelated.example' } });
assert.equal(
  denied.status,
  403,
  `An unrelated browser origin was accepted: ${JSON.stringify({
    status: denied.status,
    allowOrigin: denied.headers.get('Access-Control-Allow-Origin'),
    cacheControl: denied.headers.get('Cache-Control'),
    cacheStatus: denied.headers.get('CF-Cache-Status'),
    vary: denied.headers.get('Vary'),
    body: (await denied.text()).slice(0, 500),
  })}`,
);
assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
process.stdout.write('Backend configuration and CORS checks passed.\n');

if (process.argv.includes('--sample')) {
  const fileName = 'example-invoice.pdf';
  const filePath = 'src/assets/example-invoice.pdf';
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading = getDocument({
    data: new Uint8Array(await readFile(filePath)),
    useSystemFonts: true,
  });
  const pdf = await loading.promise;
  const content = await (await pdf.getPage(1)).getTextContent();
  const pages = [{ number: 1, text: content.items.map((item) => item.str || '').join(' ') }];
  assert.equal(pdf.numPages, 1);
  await loading.destroy();
  const body = analysisRequestSchema.parse({
    fileName,
    fileSize: (await stat(filePath)).size,
    pageCount: pages.length,
    pages,
  });
  const start = performance.now();
  const response = await request('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200, `Analysis endpoint returned ${response.status}.`);
  const events = (await response.text())
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => streamEventSchema.parse(JSON.parse(line)));
  const failure = events.find((event) => event.type === 'error');
  assert.equal(failure, undefined, failure?.message);
  const completed = events.at(-1);
  assert.equal(completed?.type, 'result', 'Analysis stream ended without a result.');
  const { result, meta } = completed;
  assert.equal(meta.source, 'cloud-ai');
  assert.equal(result.document.type, 'faktura');
  assert.equal(result.document.language, 'en');
  assert.equal(result.document.date, '2026-10-01');
  assert.equal(result.document.pages, 1);
  assert.deepEqual(meta.unreadPages, [], 'Some pages could not be read.');
  assert.ok(result.amounts.some(({ value, currency }) => value === 1250.5 && currency === 'USD'));
  assert.ok(
    result.dates.some(({ date }) => date === '2026-10-15'),
    'Payment due date is missing.',
  );
  const seconds = ((performance.now() - start) / 1000).toFixed(3);
  const report = `Hosted synthetic invoice: ${seconds} s, model ${meta.model}, USD 1,250.50 and payment due date verified. This timer excludes browser PDF extraction and does not test OCR.`;
  process.stdout.write(`${report}\n`);
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
  if (Number(seconds) >= 30)
    throw new Error("Hosted analysis alone exceeded the brief's 30-second end-to-end target.");
}
