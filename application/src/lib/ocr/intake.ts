import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { OcrError } from './errors';

const exec = promisify(execFile);
export const OCR_LIMITS = { bytes: 12 * 1024 * 1024, pages: 6, pixels: 24_000_000, rows: 200, text: 120_000 } as const;
export const OCR_MODEL_SHA256 = '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2';
const activeFamilies = new Set<string>();

export function acquireOcrSlot(familyId: string): () => void {
  if (activeFamilies.has(familyId) || activeFamilies.size >= 2) {
    throw new OcrError('Document recognition is busy. Try again after the current document finishes.', 429);
  }
  activeFamilies.add(familyId);
  return () => { activeFamilies.delete(familyId); };
}

export function identifyOcrUpload(bytes: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf' {
  if (!bytes.length || bytes.length > OCR_LIMITS.bytes) throw new OcrError('Choose a document smaller than 12 MB.');
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (bytes.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  throw new OcrError('Supported documents are JPEG, PNG, WebP and unencrypted PDF. Convert HEIC photos before uploading.');
}

export interface RecognizedPage {
  page: number;
  text: string;
  confidence: number | null;
  engine: string;
  recognitionMode: 'printed-baseline' | 'handwriting-unsupported' | 'manual-transcription';
  image: Buffer;
  width: number;
  height: number;
  lines: { text: string; crop: { x: number; y: number; width: number; height: number } }[];
}

export interface OcrRecognitionAdapter {
  readonly id: string;
  prepare(signal?: AbortSignal): Promise<{ readonly engineVersion: string; readonly modelVersion: string }>;
  recognize(imagePath: string, signal?: AbortSignal): Promise<{ readonly text: string; readonly confidence: number | null; readonly lines: RecognizedPage['lines']; readonly recognitionMode: RecognizedPage['recognitionMode'] }>;
}

async function run(command: string, args: string[], signal?: AbortSignal): Promise<string> {
  try {
    if (process.platform !== 'linux') throw new OcrError('Run local recognition in the Linux OCR-enabled application container.', 503);
    const result = await exec('prlimit', ['--as=805306368', '--cpu=25', '--fsize=67108864', '--', command, ...args], {
      timeout: 25_000, killSignal: 'SIGKILL', maxBuffer: 3 * 1024 * 1024,
      signal, windowsHide: true, env: { ...process.env, OMP_THREAD_LIMIT: '1' },
    });
    return result.stdout;
  } catch (error) {
    if (error instanceof OcrError) throw error;
    if (signal?.aborted) throw new OcrError('Recognition cancelled. No care records were created.', 499);
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new OcrError('Local OCR tools are unavailable. Install Tesseract, Poppler and prlimit in the application image.', 503);
    }
    // Native errors can contain document text or filenames; never return or log them.
    throw new OcrError('The document could not be processed within the local limits. Try a smaller, unencrypted page.');
  }
}

async function verifiedEngine(signal?: AbortSignal): Promise<string> {
  const version = (await run('tesseract', ['--version'], signal)).split('\n')[0].trim();
  const languages = await run('tesseract', ['--list-langs'], signal);
  const directory = process.env.TESSDATA_PREFIX || languages.match(/"([^"]+)"/)?.[1];
  if (!directory) throw new OcrError('The local English OCR model could not be verified.', 503);
  let model: Buffer;
  try { model = await readFile(path.join(directory, 'eng.traineddata')); }
  catch { throw new OcrError('The pinned English OCR model is unavailable.', 503); }
  if (createHash('sha256').update(model).digest('hex') !== OCR_MODEL_SHA256) {
    throw new OcrError('The English OCR model differs from the verified model. Install the pinned model before recognizing documents.', 503);
  }
  return `${version}; eng-fast sha256:${OCR_MODEL_SHA256}; psm6`;
}

export function readTesseractTsv(tsv: string): { text: string; confidence: number | null; lines: RecognizedPage['lines'] } {
  const lines = new Map<string, { words: string[]; x: number; y: number; right: number; bottom: number }>();
  const confidences: number[] = [];
  for (const row of tsv.split('\n').slice(1)) {
    const cells = row.split('\t');
    if (cells[0] !== '5' || cells.length < 12) continue;
    const word = cells.slice(11).join('\t').trim();
    if (!word) continue;
    const id = cells.slice(1, 5).join('-');
    const x = Number(cells[6]); const y = Number(cells[7]);
    const width = Number(cells[8]); const height = Number(cells[9]);
    if (![x, y, width, height].every(Number.isInteger) || x < 0 || y < 0 || width < 1 || height < 1) {
      throw new OcrError('The local recognition engine returned invalid page coordinates. No care records were created.', 503);
    }
    if (!lines.has(id)) lines.set(id, { words: [], x, y, right: x + width, bottom: y + height });
    const line = lines.get(id)!;
    line.words.push(word); line.x = Math.min(line.x, x); line.y = Math.min(line.y, y);
    line.right = Math.max(line.right, x + width); line.bottom = Math.max(line.bottom, y + height);
    const confidence = Number(cells[10]);
    if (Number.isFinite(confidence) && confidence >= 0 && confidence <= 100) confidences.push(confidence);
  }
  const recognizedLines = [...lines.values()].map(line => ({
    text: line.words.join(' '),
    crop: { x: line.x, y: line.y, width: line.right - line.x, height: line.bottom - line.y },
  }));
  return {
    text: recognizedLines.map(line => line.text).join('\n'),
    confidence: confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null,
    lines: recognizedLines,
  };
}

/** Printed English baseline. This adapter contract is replaceable; it is not handwriting proof. */
export const tesseractPrintedBaseline: OcrRecognitionAdapter = {
  id: 'tesseract-printed-baseline',
  async prepare(signal) {
    const modelVersion = await verifiedEngine(signal);
    return { engineVersion: modelVersion.split(';')[0], modelVersion };
  },
  async recognize(imagePath, signal) {
    const tsv = await run('tesseract', [imagePath, 'stdout', '-l', 'eng', '--psm', '6', '-c', 'tessedit_create_tsv=1'], signal);
    if (!tsv.startsWith('level\tpage_num\tblock_num\t')) throw new OcrError('The local recognition engine returned an unsupported result. No care records were created.', 503);
    return { ...readTesseractTsv(tsv), recognitionMode: 'printed-baseline' };
  },
};

export async function recognizeOcrDocument(bytes: Buffer, rotation = 0, signal?: AbortSignal, adapter: OcrRecognitionAdapter = tesseractPrintedBaseline): Promise<RecognizedPage[]> {
  const mime = identifyOcrUpload(bytes);
  if (![0, 90, 180, 270].includes(rotation)) throw new OcrError('Choose a rotation of 0, 90, 180 or 270 degrees.');
  const identity = await adapter.prepare(signal);
  if (typeof adapter.id !== 'string' || adapter.id.length === 0 || adapter.id.length > 80
    || !identity || typeof identity.engineVersion !== 'string' || identity.engineVersion.length === 0 || identity.engineVersion.length > 100
    || typeof identity.modelVersion !== 'string' || identity.modelVersion.length === 0 || identity.modelVersion.length > 150) {
    throw new OcrError('The local recognition adapter identity is invalid.', 503);
  }
  const engine = `${adapter.id}; ${identity.engineVersion}; ${identity.modelVersion}`;
  if (engine.length > 200) throw new OcrError('The local recognition adapter identity is too long.', 503);
  const dir = await mkdtemp(path.join(tmpdir(), 'babytracker-ocr-'));
  try {
    let count = 1;
    const source = path.join(dir, 'source.pdf');
    if (mime === 'application/pdf') {
      await writeFile(source, bytes, { mode: 0o600 });
      const info = await run('pdfinfo', [source], signal);
      if (/^Encrypted:\s+yes/im.test(info)) throw new OcrError('Password-protected PDFs are not supported.');
      count = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
      if (!Number.isInteger(count) || count < 1 || count > OCR_LIMITS.pages) throw new OcrError('Choose a PDF with 1 to 6 pages.');
    }
    const pages: RecognizedPage[] = [];
    for (let page = 1; page <= count; page++) {
      if (signal?.aborted) throw new OcrError('Recognition cancelled.', 499);
      let input = bytes;
      if (mime === 'application/pdf') {
        const prefix = path.join(dir, `render-${page}`);
        await run('pdftoppm', ['-f', String(page), '-l', String(page), '-singlefile', '-scale-to', '2400', '-png', source, prefix], signal);
        input = await readFile(`${prefix}.png`);
      }
      let image: Buffer;
      let width = 0;
      let height = 0;
      try {
        const metadata = await sharp(input, { limitInputPixels: OCR_LIMITS.pixels }).metadata();
        if ((metadata.pages || 1) !== 1) throw new OcrError('Animated or multi-frame images are not supported.');
        const normalized = await sharp(input, { limitInputPixels: OCR_LIMITS.pixels }).autoOrient().rotate(rotation)
          .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
          .flatten({ background: '#ffffff' }).grayscale().normalize().sharpen().png().toBuffer({ resolveWithObject: true });
        image = normalized.data; width = normalized.info.width; height = normalized.info.height;
      } catch (error) {
        if (error instanceof OcrError) throw error;
        throw new OcrError('The image is invalid or exceeds the 24-megapixel limit.');
      }
      const imagePath = path.join(dir, `page-${page}.png`);
      await writeFile(imagePath, image, { mode: 0o600 });
      // Explicit output flags work with a model-only TESSDATA_PREFIX; a named
      // `tsv` config requires a separate configs/tsv file and can silently fall
      // back to plain text when that file is absent.
      const result = await adapter.recognize(imagePath, signal);
      if (!result || typeof result.text !== 'string' || result.text.length > OCR_LIMITS.text
        || !['printed-baseline', 'handwriting-unsupported', 'manual-transcription'].includes(result.recognitionMode)
        || (result.confidence !== null && (!Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 100))
        || !Array.isArray(result.lines) || result.lines.length > OCR_LIMITS.rows
        || result.lines.some(line => typeof line.text !== 'string' || !line.crop
          || ![line.crop.x, line.crop.y, line.crop.width, line.crop.height].every(Number.isInteger)
          || line.crop.x < 0 || line.crop.y < 0 || line.crop.width < 1 || line.crop.height < 1
          || line.crop.x + line.crop.width > width || line.crop.y + line.crop.height > height)) {
        throw new OcrError('The local recognition adapter returned invalid page evidence.', 503);
      }
      if (result.text.length > OCR_LIMITS.text) throw new OcrError('Too much text was found. Upload a smaller section.');
      pages.push({ page, ...result, engine, extractionVersion: identity.modelVersion, width, height, image });
    }
    return pages;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
