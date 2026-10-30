import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { encryptAndStore, generateStoredName } from '@/src/lib/file-encryption';
import { sealOcrState } from '@/src/lib/ocr/crypto';

const fixture = vi.hoisted(() => {
  let document: Record<string, any> | null = null;
  const db: Record<string, any> = {
    ocrDocument: {
      findFirst: async ({ where }: { where: { id: string; familyId: string } }) =>
        document?.id === where.id && document.familyId === where.familyId ? document : null,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        if (!document) throw new Error('Synthetic document missing');
        Object.assign(document, data);
        return document;
      },
    },
    ocrAudit: { create: async () => ({}) },
    baby: {
      findFirst: async ({ where }: { where: { id: string; familyId: string } }) =>
        document?.babyId === where.id && document.familyId === where.familyId ? { id: where.id } : null,
    },
    $transaction: async (work: (tx: Record<string, any>) => unknown) => work(db),
  };
  return {
    db,
    get document() { return document; },
    set document(value: Record<string, any> | null) { document = value; },
  };
});

vi.mock('@/app/api/db', () => ({ default: fixture.db }));
vi.mock('@/app/api/utils/auth', () => ({
  withAuthContext: (handler: (request: NextRequest, auth: Record<string, unknown>) => unknown) =>
    (request: NextRequest) => handler(request, {
      authenticated: true,
      familyId: request.headers.get('x-synthetic-family'),
      isAccountOwner: true,
      caretakerId: null,
    }),
}));

import { GET } from '@/app/api/ocr/documents/[id]/source/route';

const syntheticFamily = 'synthetic-family-authorized';
const syntheticChild = 'synthetic-child-authorized';
const syntheticSource = Buffer.from('SYNTHETIC PRIVATE SOURCE TEXT <script>must-not-leak</script>');
let directory = '';
let previousFilesDir: string | undefined;
let previousEncryptionKey: string | undefined;
let encryptedName = '';
let capturedLogArguments: unknown[][] = [];

function sourceRequest(id: string, family: string) {
  return new NextRequest(`http://localhost/api/ocr/documents/${id}/source`, {
    headers: { 'x-synthetic-family': family },
  });
}

async function expectNoSensitiveDisclosure(response: Response) {
  const responseText = await response.clone().text();
  expect(responseText).not.toContain(syntheticSource.toString());
  expect(responseText).not.toContain('must-not-leak');
  const logText = capturedLogArguments.flat().map(String).join(' ');
  expect(logText).not.toContain(syntheticSource.toString());
  expect(logText).not.toContain('must-not-leak');
}

describe('GET OCR source authorization and retention boundary', () => {
  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'babytracker-ocr-source-route-'));
    previousFilesDir = process.env.BABYTRACKER_OCR_FILES_DIR;
    previousEncryptionKey = process.env.ENC_HASH;
    process.env.BABYTRACKER_OCR_FILES_DIR = directory;
    process.env.ENC_HASH = '11'.repeat(32);
    encryptedName = generateStoredName();
    encryptAndStore(syntheticSource, encryptedName, 'ocr');
    const id = randomUUID();
    const scope = `${syntheticFamily}:${id}`;
    fixture.document = {
      id,
      familyId: syntheticFamily,
      babyId: syntheticChild,
      sourceHash: 'synthetic-hash',
      sourceFile: encryptedName,
      previewFiles: '[]',
      sourceExpiresAt: new Date(Date.now() + 60_000),
      mimeType: 'image/png',
      byteSize: syntheticSource.length,
      pageCount: 1,
      parserVersion: 'synthetic-fixture-v1',
      sourceTimezone: 'UTC',
      revision: 0,
      originalState: sealOcrState({ rows: [], pages: [] }, `${scope}:original`),
      reviewState: sealOcrState({ rows: [], timeZone: 'UTC', utcOffsets: {}, duplicateDecisions: {} }, `${scope}:review`),
      committedAt: null,
      resultJson: null,
      createdAt: new Date(),
    };
    capturedLogArguments = [];
    for (const level of ['error', 'warn', 'log', 'info', 'debug', 'trace'] as const) {
      vi.spyOn(console, level).mockImplementation((...args) => { capturedLogArguments.push(...args); });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
    if (previousFilesDir === undefined) delete process.env.BABYTRACKER_OCR_FILES_DIR;
    else process.env.BABYTRACKER_OCR_FILES_DIR = previousFilesDir;
    if (previousEncryptionKey === undefined) delete process.env.ENC_HASH;
    else process.env.ENC_HASH = previousEncryptionKey;
  });

  it('returns the unexpired source only to its authorized family', async () => {
    const document = fixture.document!;
    const response = await GET(sourceRequest(document.id, syntheticFamily));

    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(syntheticSource);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('denies a foreign family without returning or deleting the source', async () => {
    const document = fixture.document!;
    const response = await GET(sourceRequest(document.id, 'synthetic-family-foreign'));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ success: false, error: 'Document not found.' });
    expect(existsSync(path.join(directory, encryptedName))).toBe(true);
    await expectNoSensitiveDisclosure(response);
  });

  it('returns unavailable for an expired source and purges its encrypted file', async () => {
    const document = fixture.document!;
    document.sourceExpiresAt = new Date(Date.now() - 60_000);
    const response = await GET(sourceRequest(document.id, syntheticFamily));

    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({
      success: false,
      error: 'The source retention period has ended. Import history is still available.',
    });
    expect(existsSync(path.join(directory, encryptedName))).toBe(false);
    expect(fixture.document?.sourceFile).toBeNull();
    expect(fixture.document?.purgedAt).toBeInstanceOf(Date);
    await expectNoSensitiveDisclosure(response);
  });

  it('returns unavailable for a source that was already purged', async () => {
    const document = fixture.document!;
    document.sourceFile = null;
    rmSync(path.join(directory, encryptedName));
    const response = await GET(sourceRequest(document.id, syntheticFamily));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ success: false, error: 'Source file not found.' });
    expect(existsSync(path.join(directory, encryptedName))).toBe(false);
    await expectNoSensitiveDisclosure(response);
  });
});
