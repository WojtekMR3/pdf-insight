import { mkdir, writeFile } from 'node:fs/promises';

// Small, synthetic ASCII fixtures; no personal documents are used in failure tests.
function pdf(lines) {
  const stream =
    'BT /F1 11 Tf 48 780 Td ' +
    lines
      .map((line, i) => `${i ? '0 -18 Td ' : ''}(${line.replace(/[\\()]/g, '\\$&')}) Tj`)
      .join('\n') +
    ' ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  return (
    output + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  );
}
await mkdir('tmp/test-pdfs', { recursive: true });
await writeFile(
  'tmp/test-pdfs/english-invoice.pdf',
  pdf([
    'INVOICE 2026-101',
    'Issued on October 1, 2026.',
    'Supplier: Pine Studio. Customer: Cedar Labs.',
    'Service: website accessibility review.',
    'Total due: USD 1,250.50.',
    'Payment due on October 15, 2026.',
    'The review covers keyboard navigation and mobile layouts.',
  ]),
);
await writeFile('tmp/test-pdfs/wrong-type.txt', 'This is not a PDF.');
await writeFile('tmp/test-pdfs/fake.pdf', 'This is not a PDF despite the extension.');
await writeFile('tmp/test-pdfs/corrupt.pdf', '%PDF-1.7\ntruncated');
await writeFile('tmp/test-pdfs/empty.pdf', '');
await writeFile('tmp/test-pdfs/oversized.pdf', Buffer.alloc(10_000_001));
process.stdout.write('Synthetic upload fixtures written under tmp/test-pdfs/.\n');
