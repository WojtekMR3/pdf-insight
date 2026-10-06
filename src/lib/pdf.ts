import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import {
  MAX_FILE_BYTES,
  MAX_PAGES,
  MAX_SCAN_PAGES,
  MAX_TEXT_CHARS,
  type AnalysisRequest,
} from '../../shared/schema';
import { reconstructText } from './text';

GlobalWorkerOptions.workerSrc = workerUrl;

export type ExtractedDocument = {
  request: AnalysisRequest;
  thumbnail: string;
  scanPages: number[];
  warnings: string[];
  text: string;
};

export function validateFile(file: Pick<File, 'name' | 'size' | 'type'>): void {
  if (!file.name.toLowerCase().endsWith('.pdf') || (file.type && file.type !== 'application/pdf')) {
    throw new Error('Wybierz plik PDF. Inne formaty nie są obsługiwane.');
  }
  if (file.size === 0) throw new Error('Ten plik jest pusty. Wybierz inny dokument.');
  if (file.size > MAX_FILE_BYTES)
    throw new Error('Plik jest za duży. Maksymalny rozmiar to 10 MB.');
}

export async function extractPdf(
  file: File,
  signal: AbortSignal,
  onProgress: (message: string) => void,
): Promise<ExtractedDocument> {
  signal.throwIfAborted();
  validateFile(file);
  const data = new Uint8Array(await file.arrayBuffer());
  signal.throwIfAborted();
  const signature = new TextDecoder('latin1').decode(data.slice(0, 1024));
  if (!signature.includes('%PDF-')) throw new Error('Plik nie ma prawidłowego nagłówka PDF.');
  const task = getDocument({ data, useSystemFonts: true });
  const cancel = () => {
    void task.destroy().catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const document = await task.promise;
    if (document.numPages > MAX_PAGES)
      throw new Error(
        `Lokalna wersja obsługuje do ${MAX_PAGES} stron. Podziel dokument na mniejsze pliki.`,
      );
    const pages: AnalysisRequest['pages'] = [];
    const scanPages: number[] = [];
    const warnings: string[] = [];
    let thumbnail = '';
    let characters = 0;
    for (let number = 1; number <= document.numPages; number++) {
      if (signal.aborted) throw new DOMException('Anulowano', 'AbortError');
      onProgress(`Odczytuję stronę ${number} z ${document.numPages}…`);
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const items = content.items.filter((item) => 'str' in item);
      const text = reconstructText(items);
      characters += text.length;
      if (characters > MAX_TEXT_CHARS)
        throw new Error('Dokument przekracza limit 600 000 znaków. Podziel go na mniejsze pliki.');
      const needsOcr = text.replace(/\s/g, '').length < 30;
      let image: string | undefined;
      if (needsOcr) scanPages.push(number);
      if (number === 1 || (needsOcr && scanPages.length <= MAX_SCAN_PAGES)) {
        const initialViewport = page.getViewport({ scale: 1 });
        const width = needsOcr ? 1300 : 420;
        const viewport = page.getViewport({ scale: width / initialViewport.width });
        const canvas = documentElementCanvas(viewport.width, viewport.height);
        await page.render({ canvas, viewport }).promise;
        const imageUrl = canvas.toDataURL('image/jpeg', 0.88);
        if (number === 1) thumbnail = imageUrl;
        if (needsOcr && scanPages.length <= MAX_SCAN_PAGES) image = imageUrl.split(',')[1];
        canvas.width = 0;
        canvas.height = 0;
      }
      pages.push({ number, text, ...(image ? { image } : {}) });
      page.cleanup();
    }
    if (scanPages.length > MAX_SCAN_PAGES)
      warnings.push(
        `OCR obejmie pierwsze ${MAX_SCAN_PAGES} stron bez tekstu. Pozostałe zostaną oznaczone jako nieodczytane.`,
      );
    return {
      request: { fileName: file.name, fileSize: file.size, pageCount: document.numPages, pages },
      thumbnail,
      scanPages,
      warnings,
      text: pages
        .map((page) => `— Strona ${page.number} —\n${page.text || '[Strona wymaga OCR]'}\n`)
        .join('\n'),
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'PasswordException')
      throw new Error('Ten PDF jest chroniony hasłem. Wybierz niezabezpieczoną kopię.');
    if (error instanceof Error && error.name === 'InvalidPDFException')
      throw new Error('Nie można odczytać tego PDF. Plik może być uszkodzony.');
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
    await task.destroy();
  }
}

function documentElementCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width);
  canvas.height = Math.ceil(height);
  return canvas;
}
