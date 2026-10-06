import { appendFile, readFile, writeFile } from 'node:fs/promises';

const repository = process.env.GITHUB_REPOSITORY || '';
if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repository))
  throw new Error('GITHUB_REPOSITORY must identify the intended owner/repository.');
const model = process.env.GEMINI_MODEL || '';
if (!/^gemini-[a-z0-9.-]+$/.test(model))
  throw new Error('Set the GEMINI_MODEL repository variable to an available Gemini vision model.');
const origin = `https://${repository.split('/')[0].toLowerCase()}.github.io`;
const original = await readFile('wrangler.toml', 'utf8');
for (const key of ['ALLOWED_ORIGINS', 'GEMINI_MODEL']) {
  if (!new RegExp(`^${key} = ".*"$`, 'm').test(original))
    throw new Error(`Expected ${key} in wrangler.toml.`);
}
const configured = original
  .replace(/^ALLOWED_ORIGINS = ".*"$/m, `ALLOWED_ORIGINS = ${JSON.stringify(origin)}`)
  .replace(/^GEMINI_MODEL = ".*"$/m, `GEMINI_MODEL = ${JSON.stringify(model)}`);
await writeFile('wrangler.toml', configured);
if (process.env.GITHUB_ENV) await appendFile(process.env.GITHUB_ENV, `FRONTEND_ORIGIN=${origin}\n`);
process.stdout.write(`Configured ${origin} and ${model}; no secrets written to configuration.\n`);
