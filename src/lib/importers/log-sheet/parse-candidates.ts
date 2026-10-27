import { LogSheetCandidate, LogSheetEventKind } from './types';

export interface OcrLine {
  readonly text: string;
  readonly confidence: number;
}

export interface OcrPage {
  readonly documentHash: string;
  readonly fileName: string;
  readonly page: number;
  readonly lines: readonly OcrLine[];
}

function stableId(hash: string, page: number, line: number): string {
  return `${hash.slice(0, 24)}-p${page}-l${line}`;
}

function eventKind(text: string): LogSheetEventKind {
  const normalized = text.toLowerCase();
  const feed = /\b(feed|feeding|bottle|formula|nurs(?:e|ed|ing)|breast(?:feed|fed|feeding)?|left side|right side|fl\s?oz|\boz\b|\bml\b)\b/.test(normalized);
  const diaper = /\b(diaper|nappy|wet|pee|urine|dirty|stool|poop|both)\b/.test(normalized);
  if (feed === diaper) return null;
  return feed ? 'feeding' : 'diaper';
}

function parseIsoDate(text: string): string {
  const match = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (!match) return '';
  const [, year, month, day] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === `${year}-${month}-${day}`
    ? `${year}-${month}-${day}`
    : '';
}

function parseTime(text: string): string {
  const match = text.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i);
  if (!match) return '';
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3]?.toLowerCase();
  if (minute > 59 || hour > 23 || hour < 0) return '';
  if (meridiem) {
    if (hour < 1 || hour > 12) return '';
    hour = (hour % 12) + (meridiem === 'pm' ? 12 : 0);
  } else if (hour !== 0 && hour < 13) {
    // 1–12 can be either 12-hour time or an incorrectly transcribed 24-hour time.
    return '';
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parsedFeedKind(text: string): LogSheetCandidate['feedKind'] {
  if (/\b(breast\s*milk|formula|bottle)\b/i.test(text)) return 'BOTTLE';
  if (/\b(nurs(?:e|ed|ing)|breast\s*feed(?:ing)?|left side|right side)\b/i.test(text)) return 'BREAST';
  return '';
}

function parsedBottleType(text: string): LogSheetCandidate['bottleType'] {
  if (/\bformula\b/i.test(text)) return 'Formula';
  if (/\bbreast\s*milk\b/i.test(text)) return 'Breast Milk';
  return 'Other';
}

function parsedAmount(text: string): { amount: string; unit: 'ML' | 'OZ' | '' } {
  const match = text.match(/\b(\d+(?:[.,]\d+)?)\s*(ml|millilit(?:er|re)s?|fl\s?oz|oz|ounces?)\b/i);
  if (!match) return { amount: '', unit: '' };
  const value = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0 || value > 2000) return { amount: '', unit: '' };
  const unit = /^(?:ml|millilit)/i.test(match[2]) ? 'ML' : 'OZ';
  return { amount: String(value), unit };
}

function parsedDiaperType(text: string): LogSheetCandidate['diaperType'] {
  if (/\b(both|pee\s*(?:and|&)\s*poo|wet\s*(?:and|&)\s*dirty)\b/i.test(text)) return 'BOTH';
  if (/\b(wet|pee|urine)\b/i.test(text)) return 'WET';
  if (/\b(dirty|stool|poop|poo)\b/i.test(text)) return 'DIRTY';
  return '';
}

export function candidateFromOcrLine(input: {
  readonly documentHash: string;
  readonly fileName: string;
  readonly page: number;
  readonly line: number;
  readonly text: string;
  readonly confidence: number;
}): LogSheetCandidate | null {
  const rawText = input.text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, 1000);
  if (!rawText) return null;

  const kind = eventKind(rawText);
  const time = parseTime(rawText);
  const date = parseIsoDate(rawText);
  const amount = parsedAmount(rawText);
  const feedKind = kind === 'feeding' ? parsedFeedKind(rawText) : '';
  const diaperType = kind === 'diaper' ? parsedDiaperType(rawText) : '';
  const confidence = Math.max(0, Math.min(100, Number.isFinite(input.confidence) ? input.confidence : 0));
  const warnings: string[] = [];
  if (!kind) warnings.push('event-type-unresolved');
  if (!date) warnings.push(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/.test(rawText) ? 'ambiguous-date' : 'date-unresolved');
  if (!time) warnings.push('time-unresolved');
  if (kind === 'feeding' && !feedKind) warnings.push('feed-method-unresolved');
  if (kind === 'feeding' && amount.amount && !amount.unit) warnings.push('amount-unit-unresolved');
  if (kind === 'diaper' && !diaperType) warnings.push('diaper-kind-unresolved');
  if (confidence < 75) warnings.push('low-ocr-confidence');

  return {
    id: stableId(input.documentHash, input.page, input.line),
    documentHash: input.documentHash,
    fileName: input.fileName.slice(0, 255),
    page: input.page,
    line: input.line,
    rawText,
    confidence,
    selected: true,
    reviewed: false,
    eventKind: kind,
    date,
    time,
    feedKind,
    bottleType: parsedBottleType(rawText),
    amount: amount.amount,
    unit: amount.unit,
    diaperType,
    warnings,
  };
}

export function candidatesFromOcrPages(pages: readonly OcrPage[]): LogSheetCandidate[] {
  return pages.flatMap(page => page.lines.map((line, index) => candidateFromOcrLine({
    documentHash: page.documentHash,
    fileName: page.fileName,
    page: page.page,
    line: index + 1,
    text: line.text,
    confidence: line.confidence,
  })).filter((row): row is LogSheetCandidate => Boolean(row)));
}
