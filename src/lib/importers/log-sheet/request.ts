import type { ReviewedLogSheetCandidate } from './map-reviewed';
import { mapReviewedLogSheet, ReviewedLogSheetImport } from './map-reviewed';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength) throw new Error(`Invalid ${field}`);
  return value;
}

export function parseLogSheetExecuteRequest(value: unknown): ReviewedLogSheetImport {
  if (!isObject(value) || !Array.isArray(value.rows)) throw new Error('Import request is invalid');
  if (value.rows.length > 500) throw new Error('An import can contain no more than 500 rows');
  const rows: ReviewedLogSheetCandidate[] = value.rows.map(raw => {
    if (!isObject(raw) || typeof raw.selected !== 'boolean' || typeof raw.reviewed !== 'boolean') throw new Error('A review row is invalid');
    return {
      selected: raw.selected,
      reviewed: raw.reviewed,
      documentHash: text(raw.documentHash, 'document fingerprint', 64),
      page: Number(raw.page),
      line: Number(raw.line),
      eventIndex: raw.eventIndex === undefined ? 0 : Number(raw.eventIndex),
      eventKind: raw.eventKind === 'feeding' || raw.eventKind === 'diaper' ? raw.eventKind : null,
      date: text(raw.date, 'date', 10),
      time: text(raw.time, 'time', 5),
      feedKind: raw.feedKind === 'BOTTLE' || raw.feedKind === 'BREAST' ? raw.feedKind : '',
      bottleType: raw.bottleType === 'Formula' || raw.bottleType === 'Breast Milk' || raw.bottleType === 'Other' ? raw.bottleType : 'Other',
      amount: raw.amount === undefined ? '' : text(raw.amount, 'amount', 12),
      unit: raw.unit === 'ML' || raw.unit === 'OZ' ? raw.unit : '',
      diaperType: raw.diaperType === 'WET' || raw.diaperType === 'DIRTY' || raw.diaperType === 'BOTH' ? raw.diaperType : '',
    };
  });
  return mapReviewedLogSheet({
    rows,
    babyId: text(value.babyId, 'baby', 100),
    timezone: text(value.timezone, 'timezone', 100),
  });
}
