import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth';
import { DriveAuthError, DriveFolderMissingError, driveForUser } from '@/lib/drive';
import { errorResponse } from '@/lib/api-errors';

export const dynamic = 'force-dynamic';

/** よく使うお店（ワンタップ入力用）。ドライブが未準備なら空の一覧 */
export async function GET() {
  try {
    const userId = await requireUserId();
    try {
      return NextResponse.json(await (await driveForUser(userId)).frequentStores());
    } catch (e) {
      if (e instanceof DriveAuthError || e instanceof DriveFolderMissingError) return NextResponse.json([]);
      throw e;
    }
  } catch (error) {
    return errorResponse(error, 'Error loading frequent stores');
  }
}
