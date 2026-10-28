import type { OcrCandidate, OcrEditableField } from '@/src/lib/ocr/types';
import type { OcrReviewRequest } from '@/src/lib/ocr/contracts';
import { resolveOcrLocalDateTime, validateOcrCandidate } from '@/src/lib/ocr/validation';

export type RowOffsets = NonNullable<OcrReviewRequest['utcOffsets']>[string];

export function manualOcrRow(page: number, id: string): OcrCandidate {
  return {
    id: `manual-${id}`, eventType: 'unknown', localDate: null, localTime: null,
    endLocalDate: null, endLocalTime: null, feedType: null, bottleType: null,
    amount: null, unit: null, diaperType: null, sleepType: null, notes: '', approved: false,
    source: { page, line: 1, slot: 0, rawText: '', engine: 'manual', confidence: null },
    fieldSources: {}, warnings: ['Manually transcribed from the source; verify every field.'],
  };
}

export function editOcrRow(row: OcrCandidate, patch: Partial<OcrCandidate>): OcrCandidate {
  const fieldSources = { ...row.fieldSources };
  for (const key of Object.keys(patch)) {
    if (key !== 'approved') fieldSources[key as OcrEditableField] = 'corrected';
  }
  return { ...row, ...patch, approved: false, fieldSources };
}

export function rowReviewIssues(row: OcrCandidate, timeZone: string, offsets: RowOffsets = {}) {
  const validation = validateOcrCandidate(row, { now: new Date(), deferSleepOrdering: true });
  const errors = [...validation.errors];
  const start = row.localDate && row.localTime
    ? resolveOcrLocalDateTime(row.localDate, row.localTime, timeZone, { utcOffsetMinutes: offsets.start }) : null;
  const end = row.eventType === 'sleep' && row.endLocalDate && row.endLocalTime
    ? resolveOcrLocalDateTime(row.endLocalDate, row.endLocalTime, timeZone, { utcOffsetMinutes: offsets.end }) : null;
  for (const resolution of [start, end]) if (resolution && resolution.status !== 'valid' && resolution.message) errors.push(resolution.message);
  if (start?.utc && end?.utc && end.utc <= start.utc) errors.push('Sleep end must be after its start.');
  return { errors: [...new Set(errors)], warnings: [...validation.warnings] };
}
