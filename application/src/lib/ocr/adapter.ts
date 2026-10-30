import { OcrError } from './errors';

/** Local OCR engines return evidence only; they never create or approve care events. */
export interface OcrWord {
  readonly text: string;
  readonly confidence: number | null;
  readonly crop: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

export interface OcrAdapterPage {
  readonly text: string;
  readonly confidence: number | null;
  readonly engine: string;
  readonly modelVersion: string;
  readonly recognitionMode: 'printed-baseline' | 'handwriting-unsupported' | 'manual-transcription';
  readonly words?: readonly OcrWord[];
}

export interface OcrAdapter {
  readonly id: string;
  recognize(imagePath: string, imageSize: { width: number; height: number }, signal?: AbortSignal): Promise<OcrAdapterPage>;
}

export function validateAdapterPage(result: OcrAdapterPage, imageSize: { width: number; height: number }): OcrAdapterPage {
  if (!result || typeof result.text !== 'string' || result.text.length > 120_000
    || typeof result.engine !== 'string' || !result.engine || result.engine.length > 200
    || typeof result.modelVersion !== 'string' || !result.modelVersion || result.modelVersion.length > 300
    || !['printed-baseline', 'handwriting-unsupported', 'manual-transcription'].includes(result.recognitionMode)
    || (result.confidence !== null && (!Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 100))) {
    throw new OcrError('The local recognition adapter returned unsupported evidence. No care records were created.', 503);
  }
  if (result.words?.some(word => !word || typeof word.text !== 'string' || word.text.length > 1000
    || (word.confidence !== null && (!Number.isFinite(word.confidence) || word.confidence < 0 || word.confidence > 100))
    || !word.crop || ![word.crop.x, word.crop.y, word.crop.width, word.crop.height].every(Number.isFinite)
    || word.crop.x < 0 || word.crop.y < 0 || word.crop.width <= 0 || word.crop.height <= 0
    || word.crop.x + word.crop.width > imageSize.width || word.crop.y + word.crop.height > imageSize.height)) {
    throw new OcrError('The local recognition adapter returned invalid crop evidence. No care records were created.', 503);
  }
  return result;
}
