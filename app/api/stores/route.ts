import { NextResponse } from 'next/server';
import { requireActor } from '@/lib/auth';
import { DriveAuthError, DriveFolderMissingError, driveForActor } from '@/lib/drive';
import { errorResponse } from '@/lib/api-errors';

export const dynamic = 'force-dynamic';

/** よく使うお店（ワンタップ入力用）。ドライブが未準備なら空の一覧 */
export async function GET() {
  try {
    const actor = await requireActor();
    try {
      return NextResponse.json(await (await driveForActor(actor)).frequentStores());
    } catch (e) {
      if (e instanceof DriveAuthError || e instanceof DriveFolderMissingError) return NextResponse.json([]);
      throw e;
    }
  } catch (error) {
    return errorResponse(error, 'Error loading frequent stores');
  }
}
