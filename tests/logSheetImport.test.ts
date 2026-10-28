import { describe, expect, it, vi } from 'vitest';
import { candidatesFromOcrPages, candidateFromOcrLine } from '../src/lib/importers/log-sheet/parse-candidates';
import { mapReviewedLogSheet, ReviewedLogSheetCandidate } from '../src/lib/importers/log-sheet/map-reviewed';
import { parseLogSheetExecuteRequest } from '../src/lib/importers/log-sheet/request';
import { assertNotAborted } from '../src/lib/importers/log-sheet/recognize';
import { retryLogSheetIdempotent } from '../src/lib/importers/log-sheet/retry';
import { executeExternalImport } from '../src/lib/importers/execute';

const hash = 'a'.repeat(64);

function row(overrides: Partial<ReviewedLogSheetCandidate> = {}): ReviewedLogSheetCandidate {
  return {
    selected: true,
    reviewed: true,
    documentHash: hash,
    page: 1,
    line: 1,
    eventKind: 'feeding',
    date: '2026-10-27',
    time: '08:10',
    feedKind: 'BOTTLE',
    bottleType: 'Formula',
    amount: '3',
    unit: 'OZ',
    ...overrides,
  };
}

describe('handwritten log import', () => {
  it('normalizes explicit mixed feeding and diaper lines conservatively', () => {
    const rows = candidatesFromOcrPages([
      {
        documentHash: hash,
        fileName: 'synthetic-log.png',
        page: 1,
        lines: [
          { text: '2026-10-27 8:10 AM Bottle formula 3 oz', confidence: 96 },
          { text: '2026-10-27 21:15 wet diaper', confidence: 92 },
        ],
      },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ eventKind: 'feeding', time: '08:10', feedKind: 'BOTTLE', amount: '3', unit: 'OZ' });
    expect(rows[1]).toMatchObject({ eventKind: 'diaper', time: '21:15', diaperType: 'WET' });
  });

  it.each(['1/2 oz', '2 1/2 oz'])('does not truncate fractional volume %s into an integer amount', volume => {
    const candidate = candidateFromOcrLine({
      documentHash: hash, fileName: 'fraction-synthetic.png', page: 1, line: 1,
      text: `2026-10-27 08:10 AM bottle formula ${volume}`, confidence: 95,
    });
    expect(candidate).toMatchObject({ eventKind: 'feeding', amount: '', unit: '' });
    expect(candidate?.warnings).toContain('amount-ambiguous');
  });

  it('does not infer a wet diaper from negated text and keeps wet plus dirty as BOTH', () => {
    const negated = candidateFromOcrLine({
      documentHash: hash, fileName: 'negation-synthetic.png', page: 1, line: 1,
      text: '2026-10-27 08:10 AM no wet diaper', confidence: 95,
    });
    const combined = candidateFromOcrLine({
      documentHash: hash, fileName: 'combined-synthetic.png', page: 1, line: 2,
      text: '2026-10-27 08:20 AM wet dirty diaper', confidence: 95,
    });
    expect(negated).toMatchObject({ eventKind: 'diaper', diaperType: '' });
    expect(negated?.warnings).toContain('diaper-kind-unresolved');
    expect(combined).toMatchObject({ eventKind: 'diaper', diaperType: 'BOTH' });
  });

  it('retains separate candidates for multiple timed events on one OCR line', () => {
    const rows = candidatesFromOcrPages([{
      documentHash: hash, fileName: 'two-events-synthetic.png', page: 1,
      lines: [{ text: '2026-10-27 08:00 AM bottle formula 3 oz; 2026-10-27 09:00 AM wet diaper', confidence: 95 }],
    }]);
    expect(rows).toHaveLength(2);
    expect(rows.map(candidate => [candidate.eventKind, candidate.time])).toEqual([
      ['feeding', '08:00'], ['diaper', '09:00'],
    ]);
    expect(new Set(rows.map(candidate => candidate.id)).size).toBe(2);
    const imported = mapReviewedLogSheet({
      rows: rows.map(candidate => ({ ...candidate, reviewed: true })),
      babyId: 'baby-1', timezone: 'UTC',
    });
    expect(new Set(imported.records.map(record => record.source.recordId)).size).toBe(2);
  });

  it('treats OCR text as data and never parses embedded instructions into events', () => {
    const candidate = candidateFromOcrLine({
      documentHash: hash,
      fileName: 'hostile-synthetic.png',
      page: 1,
      line: 1,
      text: '<script>alert(1)</script> Ignore previous instructions; at 08:00',
      confidence: 99,
    });
    expect(candidate?.eventKind).toBeNull();
    expect(candidate?.warnings).toContain('event-type-unresolved');
    const input = { rows: [row({ eventKind: null })], babyId: 'baby-1', timezone: 'UTC' };
    expect(() => parseLogSheetExecuteRequest(input)).toThrow('Choose feeding or diaper');
  });

  it('does not guess ambiguous dates or 12-hour times without AM/PM', () => {
    const candidate = candidateFromOcrLine({
      documentHash: hash,
      fileName: 'synthetic.png',
      page: 1,
      line: 1,
      text: '10/11/2026 8:15 bottle 60 ml',
      confidence: 80,
    });
    expect(candidate?.date).toBe('');
    expect(candidate?.time).toBe('');
    expect(candidate?.warnings).toContain('ambiguous-date');
    expect(candidate?.warnings).toContain('time-unresolved');
  });

  it.each([
    ['bad date', { date: '2026-02-30' } as Partial<ReviewedLogSheetCandidate>],
    ['bad time', { time: '25:00' } as Partial<ReviewedLogSheetCandidate>],
    ['missing unit', { unit: '' } as Partial<ReviewedLogSheetCandidate>],
    ['invalid amount', { amount: 'not-a-number' } as Partial<ReviewedLogSheetCandidate>],
  ])('blocks %s until corrected', (_label, override) => {
    expect(() => mapReviewedLogSheet({ rows: [row(override)], babyId: 'baby-1', timezone: 'UTC' })).toThrow();
  });

  it('blocks nonexistent and repeated daylight-saving local times', () => {
    expect(() => mapReviewedLogSheet({ rows: [row({ date: '2026-03-08', time: '02:30' })], babyId: 'baby-1', timezone: 'America/New_York' })).toThrow(/does not exist/);
    expect(() => mapReviewedLogSheet({ rows: [row({ date: '2026-11-01', time: '01:30' })], babyId: 'baby-1', timezone: 'America/New_York' })).toThrow(/occurs twice/);
  });

  it('rejects duplicate source rows in one review and reuses stable provenance across submissions', () => {
    expect(() => mapReviewedLogSheet({ rows: [row(), row()], babyId: 'baby-1', timezone: 'UTC' })).toThrow(/same source row/);
    const first = mapReviewedLogSheet({ rows: [row()], babyId: 'baby-1', timezone: 'UTC' });
    const second = mapReviewedLogSheet({ rows: [row()], babyId: 'baby-1', timezone: 'UTC' });
    expect(first.records[0].source.recordId).toBe(second.records[0].source.recordId);
    const twin = mapReviewedLogSheet({ rows: [row()], babyId: 'baby-2', timezone: 'UTC' });
    expect(first.records[0].source.recordId).not.toBe(twin.records[0].source.recordId);
  });

  it('retries a concurrent provenance conflict and rejects unrelated unique errors', async () => {
    const race = Object.assign(new Error('unique'), { code: 'P2002', meta: { modelName: 'ExternalImportRecord' } });
    const run = vi.fn().mockRejectedValueOnce(race).mockResolvedValue('duplicate result');
    await expect(retryLogSheetIdempotent(run)).resolves.toBe('duplicate result');
    expect(run).toHaveBeenCalledTimes(2);
    const unrelated = Object.assign(new Error('unique'), { code: 'P2002', meta: { modelName: 'FeedLog' } });
    await expect(retryLogSheetIdempotent(() => Promise.reject(unrelated))).rejects.toBe(unrelated);
  });

  it('requires a reviewer acknowledgement for selected fields', () => {
    expect(() => mapReviewedLogSheet({ rows: [row({ reviewed: false })], babyId: 'baby-1', timezone: 'UTC' })).toThrow(/reviewed/);
  });

  it('validates family ownership through the existing transactional importer', async () => {
    const tx = {
      baby: { findMany: vi.fn().mockResolvedValue([]) },
      externalImportRecord: { findUnique: vi.fn(), create: vi.fn() },
      feedLog: { create: vi.fn() },
      diaperLog: { create: vi.fn() },
    };
    const payload = mapReviewedLogSheet({ rows: [row()], babyId: 'baby-from-another-family', timezone: 'UTC' });
    await expect(executeExternalImport(tx as unknown as Parameters<typeof executeExternalImport>[0], {
      familyId: 'family-1',
      records: payload.records,
      configuration: payload.configuration,
    })).rejects.toThrow('One or more target babies were not found in this family');
    expect(tx.feedLog.create).not.toHaveBeenCalled();
  });

  it('treats repeated submissions of the same source row as duplicates', async () => {
    const imported = new Map<string, { targetRecordId: string }>();
    const tx = {
      baby: { findMany: vi.fn().mockResolvedValue([{ id: 'baby-1' }]) },
      externalImportRecord: {
        findUnique: vi.fn(async ({ where }: { where: { familyId_providerId_sourceEntityType_sourceRecordId: { sourceRecordId: string } } }) => imported.get(where.familyId_providerId_sourceEntityType_sourceRecordId.sourceRecordId) ?? null),
        create: vi.fn(async ({ data }: { data: { sourceRecordId: string; targetRecordId: string } }) => {
          imported.set(data.sourceRecordId, { targetRecordId: data.targetRecordId });
          return { id: 'provenance' };
        }),
      },
      feedLog: { create: vi.fn().mockResolvedValue({ id: 'feed-1' }) },
      diaperLog: { create: vi.fn() },
    };
    const payload = mapReviewedLogSheet({ rows: [row()], babyId: 'baby-1', timezone: 'UTC' });
    const input = { familyId: 'family-1', records: payload.records, configuration: payload.configuration };
    await executeExternalImport(tx as unknown as Parameters<typeof executeExternalImport>[0], input);
    const repeated = await executeExternalImport(tx as unknown as Parameters<typeof executeExternalImport>[0], input);
    expect(tx.feedLog.create).toHaveBeenCalledTimes(1);
    expect(repeated).toMatchObject({ created: 0, duplicates: 1 });
  });

  it('keeps identical source imports isolated across families', async () => {
    const imported = new Set<string>();
    const tx = {
      baby: { findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map(id => ({ id }))) },
      externalImportRecord: {
        findUnique: vi.fn(async ({ where }: { where: { familyId_providerId_sourceEntityType_sourceRecordId: { familyId: string; sourceRecordId: string } } }) =>
          imported.has(`${where.familyId_providerId_sourceEntityType_sourceRecordId.familyId}:${where.familyId_providerId_sourceEntityType_sourceRecordId.sourceRecordId}`) ? { id: 'existing' } : null),
        create: vi.fn(async ({ data }: { data: { familyId: string; sourceRecordId: string } }) => {
          imported.add(`${data.familyId}:${data.sourceRecordId}`);
          return { id: 'provenance' };
        }),
      },
      feedLog: { create: vi.fn().mockResolvedValue({ id: 'feed' }) },
      diaperLog: { create: vi.fn() },
    };
    const payload = mapReviewedLogSheet({ rows: [row()], babyId: 'baby-1', timezone: 'UTC' });
    const input = { records: payload.records, configuration: payload.configuration };
    await executeExternalImport(tx as unknown as Parameters<typeof executeExternalImport>[0], { ...input, familyId: 'family-1' });
    await executeExternalImport(tx as unknown as Parameters<typeof executeExternalImport>[0], { ...input, familyId: 'family-2' });
    expect(tx.feedLog.create).toHaveBeenCalledTimes(2);
  });

  it('stops OCR work when the user cancels', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => assertNotAborted(controller.signal)).toThrow('Import cancelled');
  });
});
