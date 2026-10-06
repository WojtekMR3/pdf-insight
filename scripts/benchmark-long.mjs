import { mkdir, writeFile } from 'node:fs/promises';
import { analyzeDocument } from '../server/analysis.ts';
import { createProvider } from '../server/ai.ts';
const request = {
  fileName: 'synthetic-long-agreement.pdf',
  fileSize: 100000,
  pageCount: 2,
  pages: [
    {
      number: 1,
      text:
        'SERVICE AGREEMENT. Pine Studio will test the Cedar Labs website. The service initially covers 20 users. The fee is USD 1250.50. Signed on October 1, 2026.\n' +
        'The supplier tests keyboard navigation and readable mobile layouts. Results are recorded in the review report.\n'.repeat(
          340,
        ),
    },
    {
      number: 2,
      text:
        'ADDENDUM NO 1. The number of users increases from 20 to 30. The fee changes to USD 1500.00 from January 1, 2027. All other provisions remain unchanged.\n' +
        'The review includes visible focus indicators and readable buttons.\n'.repeat(70),
    },
  ],
};
const result = await analyzeDocument(
  request,
  AbortSignal.timeout(300000),
  (event) => {
    if (event.type === 'progress') process.stdout.write(event.message + '\n');
  },
  createProvider({ AI_PROVIDER: 'ollama' }),
);
await mkdir('tmp', { recursive: true });
await writeFile('tmp/benchmark-long.json', JSON.stringify(result, null, 2));
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
