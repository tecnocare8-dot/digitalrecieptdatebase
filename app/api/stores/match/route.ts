import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth';
import { DriveAuthError, DriveFolderMissingError, driveForUser } from '@/lib/drive';
import { errorResponse } from '@/lib/api-errors';
import { AUTO_FILL_SCORE, sanitizeSignals } from '@/lib/stores';

export const dynamic = 'force-dynamic';

/**
 * 撮影したレシートの手がかり（見た目の指紋・電話番号・読めた文字）から、学習済みのお店を判別する。
 * autoFill が true の候補は、画面側で入力欄に自動で入れてよい
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await requireUserId();
    const body = await request.json().catch(() => ({}));
    const signals = sanitizeSignals(body.signals);
    if (!signals) return NextResponse.json({ error: 'Invalid signals' }, { status: 400 });
    const invoiceNumber = typeof body.invoiceNumber === 'string' && /^T\d{13}$/.test(body.invoiceNumber) ? body.invoiceNumber : null;

    try {
      const candidates = await (await driveForUser(userId)).matchStores(signals, invoiceNumber);
      return NextResponse.json({
        candidates: candidates.map((c, i) => ({ ...c, autoFill: i === 0 && c.score >= AUTO_FILL_SCORE })),
      });
    } catch (e) {
      if (e instanceof DriveAuthError || e instanceof DriveFolderMissingError) return NextResponse.json({ candidates: [] });
      throw e;
    }
  } catch (error) {
    return errorResponse(error, 'Error matching stores');
  }
}
