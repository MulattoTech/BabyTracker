import type { BrowserOcrEvidence } from './adapter';
import { OcrError } from './errors';

export const OCR_ENVELOPE_MAX_BYTES = 12 * 1024 * 1024;
export const OCR_ENVELOPE_MAX_EVIDENCE_BYTES = 512_000;

const MAGIC = new Uint8Array([0x42, 0x54, 0x4f, 0x43, 0x52, 0x45, 0x56, 0x31]); // BTOCREV1
const HEADER_BYTES = 16;

export interface BrowserOcrEnvelope {
  readonly sourceBytes: Uint8Array;
  readonly evidence: unknown;
}

export function packBrowserOcrEnvelope(sourceBytes: Uint8Array, evidence: BrowserOcrEvidence): Uint8Array {
  let serialized: string;
  try { serialized = JSON.stringify(evidence); }
  catch { throw new OcrError('Browser OCR evidence cannot be encoded.'); }
  if (typeof serialized !== 'string') throw new OcrError('Browser OCR evidence cannot be encoded.');
  const evidenceBytes = new TextEncoder().encode(serialized);
  const totalBytes = HEADER_BYTES + sourceBytes.byteLength + evidenceBytes.byteLength;
  if (evidenceBytes.byteLength > OCR_ENVELOPE_MAX_EVIDENCE_BYTES) {
    throw new OcrError('Browser OCR evidence exceeds the document limits.');
  }
  if (sourceBytes.byteLength < 1 || totalBytes > OCR_ENVELOPE_MAX_BYTES) {
    throw new OcrError('The source and browser OCR evidence must fit within the 12 MB upload limit.');
  }

  const envelope = new Uint8Array(totalBytes);
  envelope.set(MAGIC, 0);
  const header = new DataView(envelope.buffer);
  header.setUint32(8, sourceBytes.byteLength, false);
  header.setUint32(12, evidenceBytes.byteLength, false);
  envelope.set(sourceBytes, HEADER_BYTES);
  envelope.set(evidenceBytes, HEADER_BYTES + sourceBytes.byteLength);
  return envelope;
}

export function unpackBrowserOcrEnvelope(input: Uint8Array): BrowserOcrEnvelope | null {
  const hasMagic = input.byteLength >= MAGIC.byteLength && MAGIC.every((byte, index) => input[index] === byte);
  if (!hasMagic) return null;
  if (input.byteLength < HEADER_BYTES || input.byteLength > OCR_ENVELOPE_MAX_BYTES) {
    throw new OcrError('Browser OCR upload envelope is malformed or exceeds 12 MB.');
  }

  const header = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const sourceLength = header.getUint32(8, false);
  const evidenceLength = header.getUint32(12, false);
  if (sourceLength < 1 || evidenceLength < 2 || evidenceLength > OCR_ENVELOPE_MAX_EVIDENCE_BYTES
    || HEADER_BYTES + sourceLength + evidenceLength !== input.byteLength) {
    throw new OcrError('Browser OCR upload envelope is malformed.');
  }

  let evidence: unknown;
  try {
    const json = new TextDecoder('utf-8', { fatal: true }).decode(input.subarray(HEADER_BYTES + sourceLength));
    evidence = JSON.parse(json);
  } catch {
    throw new OcrError('Browser OCR upload envelope evidence is malformed.');
  }
  return { sourceBytes: input.slice(HEADER_BYTES, HEADER_BYTES + sourceLength), evidence };
}
