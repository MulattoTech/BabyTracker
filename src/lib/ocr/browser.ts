import type { BrowserOcrEvidence } from './adapter';

const MAX_BYTES = 12 * 1024 * 1024;
const MAX_PAGES = 6;
const MAX_TEXT = 120_000;
const MAX_PIXELS = 24_000_000;
const SUPPORTED_IMAGES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface BrowserOcrProgress { readonly onProgress?: (message: string) => void }

function imageDimensions(bytes: Uint8Array, mime: string): { width: number; height: number } | null {
  const u32 = (offset: number) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false);
  if (mime === 'image/png' && bytes.length >= 24) return { width: u32(16), height: u32(20) };
  if (mime === 'image/webp' && bytes.length >= 30) {
    const tag = String.fromCharCode(...bytes.slice(12, 16));
    if (tag === 'VP8X') return { width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16) };
    if (tag === 'VP8 ' && bytes.length >= 30) return { width: ((bytes[27] & 0x3f) << 8) | bytes[26], height: ((bytes[29] & 0x3f) << 8) | bytes[28] };
    if (tag === 'VP8L' && bytes[20] === 0x2f) return {
      width: 1 + ((bytes[22] & 0x3f) << 8) + bytes[21],
      height: 1 + ((bytes[24] & 0x0f) << 10) + (bytes[23] << 2) + ((bytes[22] & 0xc0) >> 6),
    };
  }
  if (mime === 'image/jpeg' && bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1]; offset += 2;
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const length = (bytes[offset] << 8) | bytes[offset + 1];
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { height: (bytes[offset + 3] << 8) | bytes[offset + 4], width: (bytes[offset + 5] << 8) | bytes[offset + 6] };
      }
      offset += length;
    }
  }
  return null;
}

function normalizedCrop(bbox: { x0: number; y0: number; x1: number; y1: number }, width: number, height: number) {
  const x = Math.max(0, Math.min(width, bbox.x0));
  const y = Math.max(0, Math.min(height, bbox.y0));
  const right = Math.max(x, Math.min(width, bbox.x1));
  const bottom = Math.max(y, Math.min(height, bbox.y1));
  if (right <= x || bottom <= y || width <= 0 || height <= 0) return null;
  return { x: x / width, y: y / height, width: (right - x) / width, height: (bottom - y) / height };
}

async function fileCanvas(file: File, bytes: Uint8Array): Promise<HTMLCanvasElement> {
  const dimensions = imageDimensions(bytes, file.type);
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1 || dimensions.width * dimensions.height > MAX_PIXELS) {
    throw new Error('The image is invalid or exceeds the 24-megapixel limit.');
  }
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser could not prepare the source image');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally { bitmap.close(); }
}

async function recognizeCanvas(worker: { recognize: (image: HTMLCanvasElement, options?: unknown, output?: unknown) => Promise<any> }, canvas: HTMLCanvasElement) {
  const result = await worker.recognize(canvas, {}, { text: true, blocks: true });
  const lines = (result.data.lines ?? []) as { text?: string; confidence?: number; bbox?: { x0: number; y0: number; x1: number; y1: number } }[];
  const retained = lines.filter(line => typeof line.text === 'string' && line.text.trim());
  const text = (retained.length ? retained.map(line => line.text!.trim()) : String(result.data.text || '').split(/\r?\n/)).join('\n');
  const lineCrops = retained.length
    ? retained.map(line => line.bbox ? normalizedCrop(line.bbox, canvas.width, canvas.height) : null)
    : text.split(/\r?\n/).map(() => null);
  const scores = retained.map(line => line.confidence).filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100);
  return { text, confidence: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null, lineCrops };
}

/** Browser recognition returns evidence only. The canonical server creates, stores and audits the draft. */
export async function recognizeBrowserOcr(file: File, signal: AbortSignal, options: BrowserOcrProgress = {}): Promise<BrowserOcrEvidence> {
  if (file.size <= 0 || file.size > MAX_BYTES) throw new Error('Choose one document smaller than 12 MB.');
  if (file.type !== 'application/pdf' && !SUPPORTED_IMAGES.has(file.type)) throw new Error('Choose a JPEG, PNG, WebP or PDF document.');
  if (signal.aborted) throw new DOMException('Recognition cancelled', 'AbortError');
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const sourceHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', fileBytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  const [tesseract, pdfjs] = await Promise.all([import('tesseract.js'), import('pdfjs-dist/legacy/build/pdf.mjs')]);
  pdfjs.GlobalWorkerOptions.workerSrc = `${window.location.origin}/ocr/pdf.worker.min.mjs`;
  const worker = await tesseract.createWorker('eng', 1, {
    workerPath: `${window.location.origin}/ocr/tesseract-worker.min.js`,
    corePath: `${window.location.origin}/ocr/tesseract-core.wasm.js`,
    langPath: `${window.location.origin}/ocr/lang/4.0.0_best_int`, workerBlobURL: false, cacheMethod: 'write', gzip: true,
    logger: message => options.onProgress?.(message.status),
  });
  const pages: BrowserOcrEvidence['pages'][number][] = [];
  const abort = () => { void worker.terminate(); };
  signal.addEventListener('abort', abort, { once: true });
  let pdf: { numPages: number; getPage: (number: number) => Promise<any>; destroy: () => Promise<void> } | undefined;
  try {
    if (file.type === 'application/pdf') {
      const loading = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), maxImageSize: 24_000_000 });
      pdf = await loading.promise;
      if (pdf.numPages < 1 || pdf.numPages > MAX_PAGES) throw new Error('Choose a PDF with 1 to 6 pages.');
    }
    const count = pdf?.numPages ?? 1;
    for (let pageNumber = 1; pageNumber <= count; pageNumber++) {
      if (signal.aborted) throw new DOMException('Recognition cancelled', 'AbortError');
      options.onProgress?.(file.type === 'application/pdf' ? `Recognizing page ${pageNumber} of ${count}` : 'Recognizing source image');
      let canvas: HTMLCanvasElement;
      if (pdf) {
        const page = await pdf.getPage(pageNumber);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(2, 2400 / Math.max(base.width, base.height));
        const viewport = page.getViewport({ scale });
        canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        if (canvas.width * canvas.height > 24_000_000) throw new Error('A PDF page exceeds the 24-megapixel limit.');
        const context = canvas.getContext('2d');
        if (!context) throw new Error('This browser could not render the PDF page');
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        page.cleanup();
      } else canvas = await fileCanvas(file, fileBytes);
      const result = await recognizeCanvas(worker, canvas);
      pages.push({ page: pageNumber, ...result, engine: 'Tesseract.js browser', modelVersion: 'eng 4.0.0_best_int', recognitionMode: 'printed-baseline' });
      canvas.width = 0; canvas.height = 0;
      if (pages.reduce((total, item) => total + item.text.length, 0) > MAX_TEXT) throw new Error('Too much text was found. Upload a smaller section.');
    }
    if (signal.aborted) throw new DOMException('Recognition cancelled', 'AbortError');
    return { sourceHash, pages };
  } finally {
    signal.removeEventListener('abort', abort);
    if (pdf) await pdf.destroy().catch(() => undefined);
    await worker.terminate().catch(() => undefined);
  }
}
