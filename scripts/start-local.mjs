import { spawn } from 'node:child_process';
import { openSync, closeSync, existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';

const root = fileURLToPath(new URL('../', import.meta.url));
if (existsSync(path.join(root, '.env'))) loadEnvFile(path.join(root, '.env'));
const port = Number(process.env.PORT) || 4173;
const address = `http://localhost:${port}`;
async function health() {
  try {
    return await (
      await fetch(`${address}/api/health`, { signal: AbortSignal.timeout(6000) })
    ).json();
  } catch {
    return null;
  }
}
function openBrowser() {
  if (process.argv.includes('--no-open')) return;
  const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', address], {
    windowsHide: true,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}
if ((await health())?.app === 'pdf-insight') {
  process.stdout.write(`PDF Insight already runs at ${address}\n`);
  openBrowser();
} else {
  if (!existsSync(path.join(root, 'dist', 'index.html')))
    throw new Error('Run npm run build first.');
  const stateDirectory = path.join(root, '.local');
  await mkdir(stateDirectory, { recursive: true });
  const log = openSync(path.join(stateDirectory, 'server.log'), 'a');
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts', '--production'], {
    cwd: root,
    windowsHide: true,
    detached: true,
    stdio: ['ignore', log, log],
  });
  child.unref();
  closeSync(log);
  await writeFile(
    path.join(stateDirectory, 'server.json'),
    JSON.stringify({ pid: child.pid, port, createdAt: new Date().toISOString() }),
  );
  let ready = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if ((await health())?.app === 'pdf-insight') {
      ready = true;
      break;
    }
  }
  if (!ready) throw new Error('Server did not start. Check .local/server.log.');
  process.stdout.write(`PDF Insight is ready at ${address}\n`);
  openBrowser();
}
