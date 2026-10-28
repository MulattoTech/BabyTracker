export type LogSheetEventKind = 'feeding' | 'diaper' | null;

export interface LogSheetCandidate {
  readonly id: string;
  readonly documentHash: string;
  readonly fileName: string;
  readonly page: number;
  readonly line: number;
  /** Zero-based event slot when one OCR line contains multiple timed events. */
  readonly eventIndex: number;
  readonly rawText: string;
  readonly confidence: number;
  readonly selected: boolean;
  readonly reviewed: boolean;
  readonly eventKind: LogSheetEventKind;
  readonly date: string;
  readonly time: string;
  readonly feedKind: 'BOTTLE' | 'BREAST' | '';
  readonly bottleType: 'Formula' | 'Breast Milk' | 'Other';
  readonly amount: string;
  readonly unit: 'ML' | 'OZ' | '';
  readonly diaperType: 'WET' | 'DIRTY' | 'BOTH' | '';
  readonly warnings: readonly string[];
}

export interface LogSheetSourcePage {
  readonly documentHash: string;
  readonly fileName: string;
  readonly page: number;
  readonly imageUrl: string;
}

export interface LogSheetRecognitionResult {
  readonly candidates: readonly LogSheetCandidate[];
  readonly pages: readonly LogSheetSourcePage[];
}
