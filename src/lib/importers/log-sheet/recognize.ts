'use client';

import type { LogSheetCandidate, LogSheetRecognitionResult, LogSheetSourcePage } from './types';
import { candidatesFromOcrPages, OcrLine } from './parse-candidates';

const MAX_FILES = 5;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_PDF_PAGES = 12;
const MAX_CANDIDATES = 500;
const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/bmp']);

export interface LogSheetRecognitionOptions {
  readonly signal: AbortSignal;
  readonly onProgress?: (message: string) => void;
}

export function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Import cancelled', 'AbortError');
}

async function hashFile(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function groupPdfText(items: readonly { str?: string; transform?: number[]; hasEOL?: boolean }[]): OcrLine[] {
  const lines = new Map<number, string[]>();
  items.forEach(item => {
    const text = item.str?.trim();
    if (!text) return;
    const y = Math.round(item.transform?.[5] ?? 0);
    const parts = lines.get(y) ?? [];
    parts.push(text);
    lines.set(y, parts);
  });
  return [...lines.entries()]
    .sort(([left], [right]) => right - left)
    .map(([, parts]) => ({ text: parts.join(' ').slice(0, 1000), confidence: 100 }));
}

function renderPdfPage(pageValue: unknown, maxDimension = 2800): Promise<HTMLCanvasElement> {
  const page = pageValue as {
    getViewport: (args: { scale: number }) => { width: number; height: number };
    render: (args: { canvas: HTMLCanvasElement; canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void> };
  };
  const initial = page.getViewport({ scale: 2 });
  const scale = Math.min(1, maxDimension / Math.max(initial.width, initial.height));
  const viewport = page.getViewport({ scale: 2 * scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser could not render the PDF page');
  return page.render({ canvas, canvasContext: context, viewport }).promise.then(() => canvas);
}

function imageLines(result: { data: { lines?: readonly { text: string; confidence: number }[]; text: string } }): OcrLine[] {
  const lines = result.data.lines?.map(line => ({ text: line.text, confidence: line.confidence }));
  return lines?.length ? lines : result.data.text.split(/\r?\n/).map(text => ({ text, confidence: 0 }));
}

export async function recognizeLogSheetFiles(
  files: readonly File[],
  options: LogSheetRecognitionOptions,
): Promise<LogSheetRecognitionResult> {
  const { signal, onProgress } = options;
  assertNotAborted(signal);
  if (!files.length || files.length > MAX_FILES) throw new Error(`Select between 1 and ${MAX_FILES} files`);
  for (const file of files) {
    if (file.size <= 0 || file.size > MAX_FILE_BYTES) throw new Error(`${file.name}: file must be smaller than 15 MB`);
    if (file.type !== 'application/pdf' && !ACCEPTED_IMAGE_TYPES.has(file.type)) throw new Error(`${file.name}: choose a PDF, JPEG, PNG, WebP or BMP image`);
  }

  const [tesseract, pdfjs] = await Promise.all([
    import('tesseract.js'),
    import('pdfjs-dist/legacy/build/pdf.mjs'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = `${window.location.origin}/ocr/pdf.worker.min.mjs`;
  const worker = await tesseract.createWorker('eng', 1, {
    workerPath: `${window.location.origin}/ocr/tesseract-worker.min.js`,
    corePath: `${window.location.origin}/ocr/tesseract-core.wasm.js`,
    langPath: `${window.location.origin}/ocr/lang/4.0.0_best_int`,
    workerBlobURL: false,
    cacheMethod: 'write',
    gzip: true,
    logger: message => onProgress?.(message.status),
  });

  const linesByPage: Array<{ documentHash: string; fileName: string; page: number; lines: readonly OcrLine[] }> = [];
  const pages: LogSheetSourcePage[] = [];
  let objectUrl: string | undefined;
  let completed = false;
  const abort = () => { void worker.terminate(); };
  signal.addEventListener('abort', abort, { once: true });

  try {
    for (const file of files) {
      assertNotAborted(signal);
      const documentHash = await hashFile(file);
      if (file.type === 'application/pdf') {
        const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
        const pdf = await loadingTask.promise;
        if (pdf.numPages > MAX_PDF_PAGES) throw new Error(`${file.name}: PDF has ${pdf.numPages} pages; the limit is ${MAX_PDF_PAGES}`);
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          assertNotAborted(signal);
          onProgress?.(`${file.name} · page ${pageNumber} of ${pdf.numPages}`);
          const page = await pdf.getPage(pageNumber);
          const sourcePage = await renderPdfPage(page);
          const imageUrl = sourcePage.toDataURL('image/jpeg', 0.82);
          pages.push({ documentHash, fileName: file.name, page: pageNumber, imageUrl });
          if (pages.length > MAX_PDF_PAGES) throw new Error(`Import is limited to ${MAX_PDF_PAGES} total pages`);
          const textContent = await page.getTextContent();
          let lines = groupPdfText(textContent.items as readonly { str?: string; transform?: number[]; hasEOL?: boolean }[]);
          if (lines.length === 0) {
            const result = await worker.recognize(sourcePage, {}, { text: true, blocks: true });
            lines = imageLines(result);
          }
          linesByPage.push({ documentHash, fileName: file.name, page: pageNumber, lines });
          page.cleanup();
          sourcePage.width = 0;
          sourcePage.height = 0;
          if (candidatesFromOcrPages(linesByPage).length > MAX_CANDIDATES) throw new Error(`Import is limited to ${MAX_CANDIDATES} candidate rows`);
        }
        await loadingTask.destroy();
      } else {
        assertNotAborted(signal);
        onProgress?.(`Reading ${file.name}`);
        objectUrl = URL.createObjectURL(file);
        pages.push({ documentHash, fileName: file.name, page: 1, imageUrl: objectUrl });
        if (pages.length > MAX_PDF_PAGES) throw new Error(`Import is limited to ${MAX_PDF_PAGES} total pages`);
        const result = await worker.recognize(file, {}, { text: true, blocks: true });
        linesByPage.push({ documentHash, fileName: file.name, page: 1, lines: imageLines(result) });
        objectUrl = undefined;
      }
    }
    assertNotAborted(signal);
    const candidates: LogSheetCandidate[] = candidatesFromOcrPages(linesByPage);
    if (candidates.length > MAX_CANDIDATES) throw new Error(`Import is limited to ${MAX_CANDIDATES} candidate rows`);
    completed = true;
    return { candidates, pages };
  } finally {
    signal.removeEventListener('abort', abort);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    if (!completed) pages.forEach(page => {
      if (page.imageUrl.startsWith('blob:')) URL.revokeObjectURL(page.imageUrl);
    });
    await worker.terminate().catch(() => undefined);
  }
}
