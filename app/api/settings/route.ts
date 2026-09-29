import { NextResponse } from 'next/server';
import { getSubscriptionStatus } from '@/lib/settings';
import { requireUserId } from '@/lib/auth';
import { errorResponse } from '@/lib/api-errors';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const userId = await requireUserId();
    const status = await getSubscriptionStatus(userId);
    return NextResponse.json(status);
  } catch (error) {
    return errorResponse(error, 'Failed to get settings');
  }
}
