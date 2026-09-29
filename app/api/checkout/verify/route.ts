import { NextRequest, NextResponse } from 'next/server';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { getStripe, grantProForSession } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

/**
 * 決済完了後の戻り画面から呼ぶ。webhook の到着を待たずに、Stripe に直接問い合わせて反映する。
 * webhook と重なっても grantProForSession 側で二重延長しない。
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await requireUserId();
    const { sessionId } = await request.json();
    if (typeof sessionId !== 'string' || !sessionId.startsWith('cs_')) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 400 });
    }

    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    if (session.client_reference_id !== userId) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 403 });
    }

    const result = await grantProForSession(session);
    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    console.error('Checkout verify error:', error);
    return NextResponse.json({ error: '決済状況の確認に失敗しました。' }, { status: 500 });
  }
}
