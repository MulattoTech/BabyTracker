import { formatInTimeZone, getTimezoneOffset } from 'date-fns-tz';
import type {
  ExternalImportDiaperRecord,
  ExternalImportExecutionConfiguration,
  ExternalImportFeedRecord,
  ExternalImportRecord,
} from '@/src/types/external-import';

export interface ReviewedLogSheetCandidate {
  readonly selected: boolean;
  readonly reviewed: boolean;
  readonly documentHash: string;
  readonly page: number;
  readonly line: number;
  readonly eventIndex?: number;
  readonly eventKind: 'feeding' | 'diaper' | null;
  readonly date: string;
  readonly time: string;
  readonly feedKind?: 'BOTTLE' | 'BREAST' | '';
  readonly bottleType?: 'Formula' | 'Breast Milk' | 'Other';
  readonly amount?: string;
  readonly unit?: 'ML' | 'OZ' | '';
  readonly diaperType?: 'WET' | 'DIRTY' | 'BOTH' | '';
}

export interface ReviewedLogSheetImport {
  readonly records: readonly ExternalImportRecord[];
  readonly configuration: ExternalImportExecutionConfiguration;
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateOccurrence(date: string, time: string, timezone: string): string {
  if (!isCalendarDate(date)) throw new Error('A valid date is required for every selected row');
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('A valid 24-hour time is required for every selected row');
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format(new Date());
  } catch {
    throw new Error('Choose a valid source timezone');
  }
  const local = `${date}T${time}:00`;
  const naiveTime = Date.parse(`${local}.000Z`);
  const offsets = new Set<number>();
  for (const delta of [-36, -12, -3, 0, 3, 12, 36]) {
    offsets.add(getTimezoneOffset(timezone, new Date(naiveTime + delta * 3600_000)));
  }
  const possibleInstants = [...offsets]
    .map(offset => new Date(naiveTime - offset))
    .filter(instant => formatInTimeZone(instant, timezone, "yyyy-MM-dd'T'HH:mm:ss") === local);
  if (possibleInstants.length === 0) throw new Error('The selected local time does not exist because of a daylight-saving clock change');
  if (possibleInstants.length > 1) throw new Error('The selected local time occurs twice because of a daylight-saving clock change; choose a time outside the repeated hour');
  return local;
}

function mapFeed(row: ReviewedLogSheetCandidate, sourceChildId: string, time: string, recordId: string): ExternalImportFeedRecord {
  if (row.feedKind !== 'BOTTLE' && row.feedKind !== 'BREAST') throw new Error('Choose a feeding method for every selected feeding row');
  const base = {
    targetType: 'feed' as const,
    source: { providerId: 'handwritten-log-sheet', entityType: 'feeding', recordId, childId: sourceChildId },
    sourceChildId,
    time,
  };
  if (row.feedKind === 'BREAST') return { ...base, type: 'BREAST' };
  const amount = Number(row.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 2000) throw new Error('Enter a valid bottle amount between 0 and 2,000');
  if (row.unit !== 'ML' && row.unit !== 'OZ') throw new Error('Choose ML or OZ for every bottle amount');
  return {
    ...base,
    type: 'BOTTLE',
    bottleType: row.bottleType ?? 'Other',
    amount,
    unitAbbr: row.unit,
  };
}

function mapDiaper(row: ReviewedLogSheetCandidate, sourceChildId: string, time: string, recordId: string): ExternalImportDiaperRecord {
  if (!['WET', 'DIRTY', 'BOTH'].includes(row.diaperType ?? '')) throw new Error('Choose wet, dirty, or both for every selected diaper row');
  return {
    targetType: 'diaper',
    source: { providerId: 'handwritten-log-sheet', entityType: 'diaper', recordId, childId: sourceChildId },
    sourceChildId,
    time,
    type: row.diaperType as 'WET' | 'DIRTY' | 'BOTH',
  };
}

export function mapReviewedLogSheet(input: {
  readonly rows: readonly ReviewedLogSheetCandidate[];
  readonly babyId: string;
  readonly timezone: string;
}): ReviewedLogSheetImport {
  const { rows, babyId, timezone } = input;
  if (!babyId.trim()) throw new Error('Choose a baby before importing');
  if (!timezone.trim()) throw new Error('Source timezone is required');
  const selected = rows.filter(row => row.selected);
  if (!selected.length) throw new Error('Select at least one reviewed row');
  if (selected.length > 500) throw new Error('An import can contain no more than 500 selected rows');

  const sourceChildId = 'log-sheet-destination';
  const seen = new Set<string>();
  const records: ExternalImportRecord[] = selected.map(row => {
    if (row.reviewed !== true) throw new Error('Mark every selected row as reviewed before importing');
    if (!/^[a-f0-9]{64}$/i.test(row.documentHash)) throw new Error('Invalid document fingerprint');
    if (!Number.isInteger(row.page) || row.page < 1 || row.page > 12 || !Number.isInteger(row.line) || row.line < 1 || row.line > 1000) throw new Error('Invalid source page or row number');
    if (row.eventKind !== 'feeding' && row.eventKind !== 'diaper') throw new Error('Choose feeding or diaper for every selected row');
    const eventIndex = row.eventIndex ?? 0;
    if (!Number.isInteger(eventIndex) || eventIndex < 0 || eventIndex > 499) throw new Error('Invalid source event index');
    const sourceRowId = `${row.documentHash}:baby:${babyId.trim()}:page:${row.page}:line:${row.line}`;
    const recordId = eventIndex === 0 ? sourceRowId : `${sourceRowId}:event:${eventIndex}`;
    if (seen.has(recordId)) throw new Error('The review contains the same source row more than once');
    seen.add(recordId);
    const time = validateOccurrence(row.date, row.time, timezone);
    return row.eventKind === 'feeding'
      ? mapFeed(row, sourceChildId, time, recordId)
      : mapDiaper(row, sourceChildId, time, recordId);
  });

  return {
    records,
    configuration: {
      sourceTimezone: timezone,
      childDestinations: {
        [sourceChildId]: { mode: 'existing', targetBabyId: babyId.trim() },
      },
    },
  };
}
