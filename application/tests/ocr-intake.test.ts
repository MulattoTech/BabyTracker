import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { jsPDF } from 'jspdf';
import { acquireOcrSlot, identifyOcrUpload, readTesseractTsv, recognizeOcrDocument, recognizeWithOcrAdapter, OCR_LIMITS } from '@/src/lib/ocr/intake';
import { parseOcrPages } from '@/src/lib/ocr/parser';
import { openOcrState, sealOcrState } from '@/src/lib/ocr/crypto';
import { validateAdapterPage } from '@/src/lib/ocr/adapter';

export async function syntheticCareImage(): Promise<Buffer> {
  return sharp(Buffer.from('<svg width="1800" height="900" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><g fill="black" font-family="DejaVu Sans" font-size="52"><text x="70" y="120">2026-10-20</text><text x="70" y="240">08:15 bottle formula 90 mL</text><text x="70" y="360">09:30 wet diaper</text><text x="70" y="480">14:00 bottle breast milk 3 oz</text></g></svg>')).png().toBuffer();
}

describe('bounded local OCR intake', () => {
  it('sniffs content, rejects unsupported formats and enforces byte limits', () => {
    expect(identifyOcrUpload(Buffer.from('%PDF-1.4\n'))).toBe('application/pdf');
    expect(() => identifyOcrUpload(Buffer.from('<script>alert(1)</script>'))).toThrow('Supported');
    expect(() => identifyOcrUpload(Buffer.alloc(OCR_LIMITS.bytes + 1))).toThrow('12 MB');
  });
  it('does not equate engine confidence with field accuracy', () => {
    const tsv = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t1\t1\t1\t1\t93\t08:15\n5\t1\t1\t1\t1\t2\t1\t1\t1\t1\t91\tbottle';
    expect(readTesseractTsv(tsv)).toEqual({ text: '08:15 bottle', confidence: 92, words: [
      { text: '08:15', confidence: 93, crop: { x: 1, y: 1, width: 1, height: 1 } },
      { text: 'bottle', confidence: 91, crop: { x: 1, y: 1, width: 1, height: 1 } },
    ] });
  });
  it('validates replaceable adapter evidence and rejects out-of-page crops', () => {
    const result = { text: '<script>not markup</script>', confidence: 80, engine: 'synthetic-adapter', modelVersion: 'fixture-v1', recognitionMode: 'handwriting-unsupported' as const,
      words: [{ text: '<script>', confidence: 80, crop: { x: 1, y: 2, width: 3, height: 4 } }] };
    expect(validateAdapterPage(result, { width: 10, height: 10 })).toMatchObject({ recognitionMode: 'handwriting-unsupported', modelVersion: 'fixture-v1' });
    expect(() => validateAdapterPage({ ...result, words: [{ ...result.words[0], crop: { x: 9, y: 2, width: 3, height: 4 } }] }, { width: 10, height: 10 })).toThrow('crop');
  });
  it('accepts adapter substitution only when its identity matches returned evidence', async () => {
    const adapter = { id: 'fixture-local', async recognize() { return { text: 'printed words', confidence: null, engine: 'fixture-local', modelVersion: 'model-fixture-1', recognitionMode: 'printed-baseline' as const }; } };
    await expect(recognizeWithOcrAdapter(adapter, 'synthetic-only', { width: 10, height: 10 })).resolves.toMatchObject({ engine: 'fixture-local', modelVersion: 'model-fixture-1' });
    await expect(recognizeWithOcrAdapter({ ...adapter, id: 'other' }, 'synthetic-only', { width: 10, height: 10 })).rejects.toThrow('identity');
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
