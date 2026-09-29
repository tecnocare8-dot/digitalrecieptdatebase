import { NextResponse } from 'next/server';
import { getSubscriptionStatus } from '@/lib/settings';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const userId = await requireUserId();
    const status = await getSubscriptionStatus(userId);
    return NextResponse.json(status);
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    console.error('Failed to get settings:', error);
    return NextResponse.json({ error: 'Failed to retrieve settings' }, { status: 500 });
  }
}
