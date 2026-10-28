import { createHash } from 'node:crypto';
import { OcrError } from './errors';
import type { OcrPageText } from './types';
import { OCR_LIMITS } from './intake';

export interface BrowserOcrEvidence {
  readonly sourceHash: string;
  readonly pages: readonly (OcrPageText & { readonly modelVersion: string; readonly recognitionMode: 'printed-baseline' })[];
}

export function parseBrowserOcrEvidence(value: unknown, source: Buffer): BrowserOcrEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OcrError('Browser OCR evidence is invalid.');
  const evidence = value as Record<string, unknown>;
  const sourceHash = createHash('sha256').update(source).digest('hex');
  if (evidence.sourceHash !== sourceHash) throw new OcrError('Recognition evidence does not match the uploaded source. Start recognition again.');
  if (!Array.isArray(evidence.pages) || evidence.pages.length < 1 || evidence.pages.length > OCR_LIMITS.pages
    || Buffer.byteLength(JSON.stringify(value), 'utf8') > 512_000) throw new OcrError('Browser OCR evidence exceeds the document limits.');
  let totalText = 0;
  const pages = evidence.pages.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new OcrError('Browser OCR page evidence is invalid.');
    const page = raw as Record<string, unknown>;
    if (page.page !== index + 1 || typeof page.text !== 'string' || page.text.length > OCR_LIMITS.text
      || typeof page.engine !== 'string' || page.engine.length < 1 || page.engine.length > 200
      || typeof page.modelVersion !== 'string' || page.modelVersion.length < 1 || page.modelVersion.length > 300
      || page.recognitionMode !== 'printed-baseline'
      || (page.confidence !== null && (typeof page.confidence !== 'number' || !Number.isFinite(page.confidence) || page.confidence < 0 || page.confidence > 100))
      || !Array.isArray(page.lineCrops) || page.lineCrops.length !== page.text.split(/\r\n?|\n/).length || page.lineCrops.length > OCR_LIMITS.rows) {
      throw new OcrError('Browser OCR page evidence is invalid or out of order.');
    }
    for (const crop of page.lineCrops) {
      if (crop === null) continue;
      if (!crop || typeof crop !== 'object' || Array.isArray(crop)) throw new OcrError('Browser OCR crop evidence is invalid.');
      const box = crop as Record<string, unknown>;
      const [x, y, width, height] = [box.x, box.y, box.width, box.height];
      if (![x, y, width, height].every(number => typeof number === 'number' && Number.isFinite(number))
        || (x as number) < 0 || (y as number) < 0 || (width as number) <= 0 || (height as number) <= 0
        || (x as number) + (width as number) > 1 || (y as number) + (height as number) > 1) {
        throw new OcrError('Browser OCR crop evidence is outside its source page.');
      }
    }
    totalText += page.text.length;
    if (totalText > OCR_LIMITS.text) throw new OcrError('Too much text was found. Upload a smaller section.');
    return page as unknown as BrowserOcrEvidence['pages'][number];
  });
  return { sourceHash, pages };
}
