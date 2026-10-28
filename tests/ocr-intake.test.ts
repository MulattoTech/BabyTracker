import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { jsPDF } from 'jspdf';
import { acquireOcrSlot, identifyOcrUpload, readTesseractTsv, recognizeOcrDocument, OCR_LIMITS } from '@/src/lib/ocr/intake';
import { parseOcrPages } from '@/src/lib/ocr/parser';
import { openOcrState, sealOcrState } from '@/src/lib/ocr/crypto';
import { parseBrowserOcrEvidence } from '@/src/lib/ocr/adapter';
import { OCR_ENVELOPE_MAX_BYTES, packBrowserOcrEnvelope, unpackBrowserOcrEnvelope } from '@/src/lib/ocr/envelope';

export async function syntheticCareImage(): Promise<Buffer> {
  return sharp(Buffer.from('<svg width="1800" height="900" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><g fill="black" font-family="DejaVu Sans" font-size="52"><text x="70" y="120">2026-10-20</text><text x="70" y="240">08:15 bottle formula 90 mL</text><text x="70" y="360">09:30 wet diaper</text><text x="70" y="480">14:00 bottle breast milk 3 oz</text></g></svg>')).png().toBuffer();
}

describe('bounded local OCR intake', () => {
  it('binds browser-recognized pages and crops to the exact uploaded source', () => {
    const source = Buffer.from('synthetic OCR source bytes');
    const sourceHash = createHash('sha256').update(source).digest('hex');
    const page = { page: 1, text: '08:15 bottle 90 mL', confidence: 91, engine: 'synthetic browser', modelVersion: 'synthetic-model', recognitionMode: 'printed-baseline', lineCrops: [{ x: 0.1, y: 0.2, width: 0.7, height: 0.08 }] };
    expect(parseBrowserOcrEvidence({ sourceHash, pages: [page] }, source).pages[0]).toMatchObject({ page: 1, text: page.text, lineCrops: page.lineCrops });
    expect(() => parseBrowserOcrEvidence({ sourceHash: '00'.repeat(32), pages: [page] }, source)).toThrow('does not match');
    expect(() => parseBrowserOcrEvidence({ sourceHash, pages: [{ ...page, page: 2 }] }, source)).toThrow('out of order');
    expect(() => parseBrowserOcrEvidence({ sourceHash, pages: [{ ...page, lineCrops: [{ x: 0.9, y: 0, width: 0.2, height: 0.1 }] }] }, source)).toThrow('outside');
  });
  it('round trips a bounded browser-evidence upload envelope without changing source bytes', () => {
    const source = Buffer.from('synthetic original PDF bytes');
    const sourceHash = createHash('sha256').update(source).digest('hex');
    const evidence = { sourceHash, pages: [{ page: 1, text: '08:15 bottle 90 mL', confidence: 91,
      engine: 'synthetic browser', modelVersion: 'synthetic-model', recognitionMode: 'printed-baseline',
      lineCrops: [{ x: 0.1, y: 0.2, width: 0.7, height: 0.08 }] }] } as const;
    const envelope = packBrowserOcrEnvelope(source, evidence);
    const decoded = unpackBrowserOcrEnvelope(envelope);

    expect(decoded).not.toBeNull();
    expect(Buffer.from(decoded!.sourceBytes)).toEqual(source);
    expect(parseBrowserOcrEvidence(decoded!.evidence, Buffer.from(decoded!.sourceBytes))).toMatchObject(evidence);
    expect(envelope.byteLength).toBeLessThanOrEqual(OCR_ENVELOPE_MAX_BYTES);
  });
  it('rejects malformed and oversized browser-evidence upload envelopes', () => {
    const source = Buffer.from('synthetic source');
    const evidence = { sourceHash: createHash('sha256').update(source).digest('hex'), pages: [{ page: 1, text: '',
      confidence: null, engine: 'synthetic browser', modelVersion: 'synthetic-model', recognitionMode: 'printed-baseline', lineCrops: [null] }] } as const;
    const envelope = packBrowserOcrEnvelope(source, evidence);
    const malformed = envelope.slice();
    new DataView(malformed.buffer, malformed.byteOffset, malformed.byteLength).setUint32(8, source.length + 1, false);
    expect(() => unpackBrowserOcrEnvelope(malformed)).toThrow('malformed');
    expect(() => packBrowserOcrEnvelope(Buffer.alloc(OCR_ENVELOPE_MAX_BYTES), evidence)).toThrow('12 MB');
    const oversizedEvidence = { ...evidence, extra: 'x'.repeat(512_000) } as typeof evidence;
    expect(() => packBrowserOcrEnvelope(source, oversizedEvidence)).toThrow('evidence exceeds');
  });
  it('leaves only the canonical audited OCR commit route available', () => {
    expect(existsSync(resolve(process.cwd(), 'app/api/import/log-sheet/execute/route.ts'))).toBe(false);
    expect(existsSync(resolve(process.cwd(), 'app/api/ocr/documents/[id]/commit/route.ts'))).toBe(true);
  });
  it('sniffs content, rejects unsupported formats and enforces byte limits', () => {
    expect(identifyOcrUpload(Buffer.from('%PDF-1.4\n'))).toBe('application/pdf');
    expect(() => identifyOcrUpload(Buffer.from('<script>alert(1)</script>'))).toThrow('Supported');
    expect(() => identifyOcrUpload(Buffer.alloc(OCR_LIMITS.bytes + 1))).toThrow('12 MB');
  });
  it('does not equate engine confidence with field accuracy', () => {
    const tsv = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t1\t1\t1\t1\t93\t08:15\n5\t1\t1\t1\t1\t2\t1\t1\t1\t1\t91\tbottle';
    expect(readTesseractTsv(tsv)).toEqual({ text: '08:15 bottle', confidence: 92 });
  });
  it('bounds concurrent jobs and releases the slot', () => {
    const releaseA = acquireOcrSlot('synthetic-a');
    expect(() => acquireOcrSlot('synthetic-a')).toThrow('busy');
    const releaseB = acquireOcrSlot('synthetic-b');
    expect(() => acquireOcrSlot('synthetic-c')).toThrow('busy');
    releaseA(); releaseB(); acquireOcrSlot('synthetic-c')();
  });
  it('uses the real local engine for a mixed printed image and a rotated photo', async () => {
    const bytes = await syntheticCareImage();
    const pages = await recognizeOcrDocument(bytes);
    const rows = parseOcrPages(pages, { timeFormat: '24h' });
    expect(rows.filter(row => row.eventType === 'feed')).toHaveLength(2);
    expect(rows.some(row => row.diaperType === 'WET')).toBe(true);
    expect(rows.find(row => row.amount === 90)?.unit).toBe('ML');
    expect(rows.every(row => !row.approved)).toBe(true);
    const rotated = await sharp(bytes).rotate(90).png().toBuffer();
    expect((await recognizeOcrDocument(rotated, 270))[0].text).toContain('90');
  }, 60_000);
  it('renders and recognizes each PDF page locally', async () => {
    const pdf = new jsPDF();
    pdf.setFontSize(20);
    pdf.text(['2026-10-20', '08:15 bottle formula 90 mL'], 20, 30);
    pdf.addPage();
    pdf.text(['2026-10-20', '09:30 wet diaper'], 20, 30);
    const pages = await recognizeOcrDocument(Buffer.from(pdf.output('arraybuffer')));
    expect(pages.map(page => page.page)).toEqual([1, 2]);
    expect(pages[0].text).toContain('90');
    expect(pages[1].text.toLowerCase()).toContain('diaper');
  }, 60_000);
  it('rejects malformed, oversized-page-count and cancelled documents without care writes', async () => {
    await expect(recognizeOcrDocument(Buffer.from('%PDF-not-a-pdf'))).rejects.toThrow('could not be processed');
    const pdf = new jsPDF();
    for (let i = 1; i < 7; i++) pdf.addPage();
    await expect(recognizeOcrDocument(Buffer.from(pdf.output('arraybuffer')))).rejects.toThrow('1 to 6');
    const controller = new AbortController(); controller.abort();
    await expect(recognizeOcrDocument(await syntheticCareImage(), 0, controller.signal)).rejects.toThrow('cancelled');
  }, 60_000);
  it('binds encrypted draft/audit state to its family and document', () => {
    process.env.ENC_HASH = '11'.repeat(32);
    const sealed = sealOcrState({ raw: 'Synthetic confidential text' }, 'family-a:doc-a');
    expect(sealed).not.toContain('Synthetic');
    expect(openOcrState(sealed, 'family-a:doc-a')).toEqual({ raw: 'Synthetic confidential text' });
    expect(() => openOcrState(sealed, 'family-b:doc-a')).toThrow();
  });
});
