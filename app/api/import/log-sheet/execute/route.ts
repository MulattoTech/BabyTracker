import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../db';
import { ApiResponse, AuthResult, withAuthContext } from '../../../utils/auth';
import { checkWritePermission } from '../../../utils/writeProtection';
import { executeExternalImport } from '@/src/lib/importers/execute';
import { parseLogSheetExecuteRequest } from '@/src/lib/importers/log-sheet/request';
import { retryLogSheetIdempotent } from '@/src/lib/importers/log-sheet/retry';
import { ExternalImportExecutionResult } from '@/src/types/external-import';

async function handlePost(
  request: NextRequest,
  authContext: AuthResult,
): Promise<NextResponse<ApiResponse<ExternalImportExecutionResult>>> {
  const writeCheck = checkWritePermission(authContext);
  if (!writeCheck.allowed) return writeCheck.response!;
  const familyId = authContext.familyId;
  if (!familyId) {
    return NextResponse.json({ success: false, error: 'User is not associated with a family.' }, { status: 403 });
  }
  const allowed = authContext.isSysAdmin || authContext.isSetupAuth || authContext.isAccountOwner ||
    authContext.caretakerRole === 'ADMIN' || authContext.caretakerRole === 'OWNER';
  if (!allowed) {
    return NextResponse.json({ success: false, error: 'Administrator access is required to import external data.' }, { status: 403 });
  }

  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > 1_000_000) throw new Error('Import review is larger than the 1 MB limit');
    const payload = parseLogSheetExecuteRequest(JSON.parse(body) as unknown);
    const result = await retryLogSheetIdempotent(() =>
      prisma.$transaction(
          (tx: Parameters<typeof executeExternalImport>[0]) => executeExternalImport(tx, {
            familyId,
            caretakerId: authContext.caretakerId,
            records: payload.records,
            configuration: payload.configuration,
          }),
          { maxWait: 10000, timeout: 120000 },
      ) as Promise<ExternalImportExecutionResult>,
    );
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json<ApiResponse<ExternalImportExecutionResult>>({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to execute reviewed log import',
    }, { status: 400 });
  }
}

export const POST = withAuthContext(handlePost);
