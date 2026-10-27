import { describe, expect, it } from 'vitest';
import { parseOcrPages } from '../src/lib/ocr/parser';
import { validateOcrCandidate } from '../src/lib/ocr/validation';
import { editOcrRow, manualOcrRow, rowReviewIssues } from '../src/components/OcrImport/review-helpers';

describe('OCR review state safety', () => {
  it('creates unresolved manual drafts with explicit source-page identity', () => {
    const row = manualOcrRow(2, '12345678-abcd-1234-abcd-123456789abc');
    expect(row).toMatchObject({ id: 'manual-12345678-abcd-1234-abcd-123456789abc', approved: false, eventType: 'unknown', localDate: null, localTime: null, source: { page: 2, line: 1, engine: 'manual', confidence: null } });
    expect(validateOcrCandidate(row, { allowIncomplete: true }).valid).toBe(true);
    expect(rowReviewIssues(row, 'UTC').errors.length).toBeGreaterThan(0);
  });

  it('resets prior approval after corrections while retaining original recognized evidence', () => {
    const original = { ...parseOcrPages([{ page: 1, text: '2026-04-14 8 AM bottle 60 ml' }])[0], approved: true };
    const corrected = editOcrRow(original, { amount: 65, notes: 'Corrected against the page' });
    expect(corrected).toMatchObject({ approved: false, amount: 65, fieldSources: { amount: 'corrected', notes: 'corrected' } });
    expect(corrected.source).toEqual(original.source);
    expect(original.approved).toBe(true);
    expect(original.amount).toBe(60);
  });

  it('does not allow client approval without a chosen DST occurrence', () => {
    const row = parseOcrPages([{ page: 1, text: '2026-11-01 1:30 AM bottle 60 ml' }])[0];
    expect(rowReviewIssues(row, 'America/Chicago').errors.some(error => error.includes('repeats'))).toBe(true);
    expect(rowReviewIssues(row, 'America/Chicago', { start: -360 }).errors).toEqual([]);
  });

  it('orders sleep by explicit UTC occurrences when the fall-back clock runs backward', () => {
    const row = { ...parseOcrPages([{ page: 1, text: '2026-11-01 1:50 AM - 1:10 AM night sleep' }])[0], endLocalDate: '2026-11-01' };
    expect(validateOcrCandidate(row).valid).toBe(false);
    expect(validateOcrCandidate(row, { deferSleepOrdering: true }).valid).toBe(true);
    expect(rowReviewIssues(row, 'America/Chicago').errors.some(error => error.includes('repeats'))).toBe(true);
    expect(rowReviewIssues(row, 'America/Chicago', { start: -300, end: -360 }).errors).toEqual([]);
    expect(rowReviewIssues(row, 'America/Chicago', { start: -360, end: -360 }).errors).toContain('Sleep end must be after its start.');
    expect(rowReviewIssues(row, 'UTC').errors).toContain('Sleep end must be after its start.');
  });

  it('rejects an invalid document time zone and retains source warnings', () => {
    const row = parseOcrPages([{ page: 1, text: '2026-04-14 8 AM bottle 60 ml', confidence: 10 }])[0];
    expect(rowReviewIssues(row, 'unknown/place').errors.some(error => error.includes('time zone'))).toBe(true);
    expect(row.warnings.some(warning => warning.includes('Low engine'))).toBe(true);
    expect(row.approved).toBe(false);
  });
});
