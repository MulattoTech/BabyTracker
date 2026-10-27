interface CodedPrismaError extends Error {
  readonly code?: string;
  readonly meta?: { readonly modelName?: string; readonly target?: unknown };
}

export function isLogSheetIdempotencyRace(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const coded = error as CodedPrismaError;
  if (coded.code === 'P2034') return true;
  if (coded.code !== 'P2002') return false;
  const target = JSON.stringify(coded.meta?.target ?? '');
  return coded.meta?.modelName === 'ExternalImportRecord' ||
    (target.includes('familyId') && target.includes('providerId') && target.includes('sourceRecordId'));
}

export async function retryLogSheetIdempotent<T>(
  run: () => Promise<T>,
  maxRetries = 2,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= maxRetries || !isLogSheetIdempotencyRace(error)) throw error;
    }
  }
}
