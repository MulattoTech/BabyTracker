import { describe, expect, it } from 'vitest';
import type { OcrDocument, Prisma } from '@prisma/client';
import type { OcrReviewRequest } from '@/src/lib/ocr/contracts';
import { parseOcrPages } from '@/src/lib/ocr/parser';
import { findOcrDuplicates } from '@/src/lib/ocr/review';

const document = { familyId: 'synthetic-family', babyId: 'synthetic-child' } as OcrDocument;
const empty = { findMany: async () => [] };
const database = { feedLog: empty, diaperLog: empty, sleepLog: empty } as unknown as Prisma.TransactionClient;
const baseline = parseOcrPages([{ page: 1, text: '08:15 bottle formula 90 mL' }], {
  defaultDate: '2026-10-20', timeFormat: '24h',
})[0];

describe('OCR duplicate comparison', () => {
  it('retains every ordered pair in the maximum 200-row repeated-event review', async () => {
    const rows = Array.from({ length: 200 }, (_, index) => ({ ...baseline, id: `row-${index}`, approved: true }));
    const review: OcrReviewRequest = { revision: 0, rows, timeZone: 'America/Chicago' };
    const matches = await findOcrDuplicates(database, document, review);
    expect(matches).toHaveLength(200 * 199 / 2);
    expect(new Set(matches.map(match => `${match.rowId}/${match.recordId}`)).size).toBe(matches.length);
    const counts = new Map<string, number>();
    for (const match of matches) counts.set(match.rowId, (counts.get(match.rowId) || 0) + 1);
    for (let index = 0; index < rows.length; index++) expect(counts.get(rows[index].id) || 0).toBe(index);
    expect(matches[0]).toEqual({ rowId: 'row-1', recordId: 'draft:row-0', eventType: 'feed', occurredAt: '2026-10-20T13:15:00.000Z' });
    expect(matches.at(-1)).toEqual({ rowId: 'row-199', recordId: 'draft:row-198', eventType: 'feed', occurredAt: '2026-10-20T13:15:00.000Z' });
  });

  it('compares resolved instants, inclusive one-minute boundaries, event types and approval', async () => {
    const row = (id: string, time: string) => ({ ...baseline, id, localDate: '2026-11-01', localTime: time, approved: true });
    const rows = [
      row('first-occurrence', '01:30'), row('second-occurrence', '01:30'), row('one-minute', '01:31'),
      { ...row('unchecked', '01:30'), approved: false },
      { ...row('different-type', '01:30'), eventType: 'diaper' as const, diaperType: 'WET' as const },
      row('outside-window', '01:32'),
    ];
    const review: OcrReviewRequest = { revision: 0, rows, timeZone: 'America/Chicago', utcOffsets: {
      'first-occurrence': { start: -300 }, 'second-occurrence': { start: -360 }, 'one-minute': { start: -300 },
      'unchecked': { start: -300 }, 'different-type': { start: -300 }, 'outside-window': { start: -300 },
    } };
    expect(await findOcrDuplicates(database, document, review)).toEqual([
      { rowId: 'one-minute', recordId: 'draft:first-occurrence', eventType: 'feed', occurredAt: '2026-11-01T06:30:00.000Z' },
      { rowId: 'outside-window', recordId: 'draft:one-minute', eventType: 'feed', occurredAt: '2026-11-01T06:31:00.000Z' },
    ]);
  });
});
