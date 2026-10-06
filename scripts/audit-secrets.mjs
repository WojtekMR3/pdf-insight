import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const findings = [];
let scanned = 0;
const rules = [
  ['google-api-key', /AIza[0-9A-Za-z_-]{35}/g],
  ['github-token', /(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{50,255})/g],
  ['aws-access-key', /(?:AKIA|ASIA)[A-Z0-9]{16}/g],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g],
  ['slack-token', /xox[baprs]-[A-Za-z0-9-]{20,}/g],
  ['stripe-live-secret', /[sr]k_live_[A-Za-z0-9]{20,}/g],
  ['credential-in-url', /https?:\/\/[^\s/:@]{2,}:[^\s/@]{8,}@/g],
  [
    'literal-credential',
    /\b(?:GEMINI_API_KEY|CLOUDFLARE_API_TOKEN|AWS_SECRET_ACCESS_KEY|password|api_key|apiKey|access_token|client_secret)\s*[:=]\s*["']([A-Za-z0-9_+/=-]{24,})["']/g,
  ],
];
const configuredSecrets = ['AUDIT_GEMINI_API_KEY', 'AUDIT_CLOUDFLARE_API_TOKEN']
  .map((name) => [name, process.env[name]])
  .filter(([, value]) => value && value.length >= 16);
const knownValues = configuredSecrets.flatMap(([name, value]) =>
  [...new Set([value, encodeURIComponent(value), Buffer.from(value).toString('base64')])].map(
    (encoded) => [name.replace('AUDIT_', ''), encoded],
  ),
);

function scan(label, input) {
  scanned++;
  for (const [, regex] of rules) label = label.replace(regex, '[redacted]');
  for (const [, value] of knownValues) label = label.replaceAll(value, '[redacted]');
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : input;
  for (const [rule, regex] of rules) {
    for (const match of text.matchAll(regex)) {
      findings.push({ location: label, rule, fingerprint: fingerprint(match[0]) });
    }
  }
  for (const [name, value] of knownValues) {
    if (text.includes(value)) findings.push({ location: label, rule: `known-${name}` });
  }
}

function fingerprint(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function git(args, options = {}) {
  return execFileSync('git', args, { maxBuffer: 128 * 1024 * 1024, ...options });
}

async function scanHistory() {
  const entries = git(['rev-list', '--objects', '--all'], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean);
  const names = new Map(
    entries.map((entry) => {
      const space = entry.indexOf(' ');
      return [space < 0 ? entry : entry.slice(0, space), space < 0 ? '' : entry.slice(space + 1)];
    }),
  );
  const ids = [...names.keys()];
  const objectTypes = git(['cat-file', '--batch-check=%(objectname) %(objecttype)'], {
    input: ids.join('\n') + '\n',
    encoding: 'utf8',
  })
    .trim()
    .split('\n');
  const blobs = objectTypes
    .filter((line) => line.endsWith(' blob'))
    .map((line) => line.split(' ')[0]);
  for (const id of blobs)
    scan(`git:${id.slice(0, 12)}:${names.get(id)}`, git(['cat-file', 'blob', id]));
  // Commit and annotated-tag messages can also accidentally contain credentials.
  for (const line of objectTypes.filter((line) => / (commit|tag)$/.test(line))) {
    const [id, type] = line.split(' ');
    scan(`git-${type}:${id.slice(0, 12)}`, git(['cat-file', type, id]));
  }
  process.stdout.write(
    `Scanned ${blobs.length} unique historical blobs across all fetched refs.\n`,
  );
}

async function scanLocal(directory = '.') {
  const ignored = new Set(['node_modules', '.git', '.local', '.npm-cache', 'tmp']);
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(item.name)) continue;
    const name = path.join(directory, item.name);
    if (item.isDirectory()) await scanLocal(name);
    else if (item.isFile() && !name.toLowerCase().endsWith('.pdf'))
      scan(name, await readFile(name));
  }
}

async function scanDeployed() {
  const site = 'https://wojtekmr3.github.io/pdf-insight/';
  const assets = new Set([site]);
  const visited = new Set();
  for (const address of assets) {
    if (assets.size > 100) throw new Error('Unexpected number of deployed assets.');
    const response = await fetch(address, {
      signal: AbortSignal.timeout(30000),
      redirect: 'error',
    });
    if (!response.ok) {
      process.stderr.write(
        `Public asset ${fingerprint(address)} returned HTTP ${response.status}.\n`,
      );
      throw new Error('Public asset fetch failed.');
    }
    const text = await response.text();
    scan(`public:${new URL(address).pathname}`, text);
    visited.add(address);
    // Follow generated Vite assets only. Dependencies can mention optional unbundled modules
    // such as qcms_bg.js; those string literals are not published frontend assets.
    const references =
      /["'`](\/?pdf-insight\/assets\/[^"'`\s<>]+|(?:\.\/)?assets\/[^"'`\s<>]+|\.\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8}\.(?:m?js|css))["'`]/g;
    for (const match of text.matchAll(references)) {
      const next = new URL(match[1], /^(?:\.\/)?assets\//.test(match[1]) ? site : address);
      if (next.origin !== new URL(site).origin || !next.pathname.startsWith('/pdf-insight/assets/'))
        continue;
      if (!/\.(?:m?js|css|json|svg|map)$/.test(next.pathname)) continue;
      next.hash = '';
      if (!visited.has(next.href)) assets.add(next.href);
    }
  }
  if (visited.size < 4)
    throw new Error('Too few public assets discovered; audit coverage is incomplete.');
  process.stdout.write(`Scanned ${visited.size} deployed HTML and asset files.\n`);
  // Public API responses should expose configuration readiness, never credential values.
  const api = 'https://pdf-insight-api.r3flexmlg.workers.dev';
  for (const route of ['/api/health', '/api/unknown']) {
    const response = await fetch(api + route, {
      headers: { Origin: new URL(site).origin },
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    scan(`public-api:${route}`, await response.text());
    scan(`public-api-headers:${route}`, JSON.stringify([...response.headers]));
  }
}

try {
  if (process.argv.includes('--deployed') && configuredSecrets.length !== 2)
    throw new Error('Both configured credentials are required for the deployed audit.');
  if (process.argv.includes('--history')) await scanHistory();
  else await scanLocal();
  if (process.argv.includes('--deployed')) await scanDeployed();
  process.stdout.write(
    JSON.stringify(
      {
        scanned,
        configuredSecretComparisons: configuredSecrets.length,
        findingCount: findings.length,
        findings,
      },
      null,
      2,
    ) + '\n',
  );
  if (findings.length) process.exitCode = 1;
} catch {
  // Do not echo exception messages: network/process errors can contain sensitive request details.
  process.stderr.write('Secret audit could not complete. No clean result should be inferred.\n');
  process.exitCode = 1;
}
