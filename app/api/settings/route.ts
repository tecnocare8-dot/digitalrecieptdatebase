import { NextResponse } from 'next/server';
import { getSubscriptionStatus, staffView } from '@/lib/settings';
import { requireActor } from '@/lib/auth';
import { errorResponse } from '@/lib/api-errors';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const actor = await requireActor();
    const status = await getSubscriptionStatus(actor.ownerId);
    return NextResponse.json(actor.staffId ? staffView(status, actor.displayName) : status);
  } catch (error) {
    return errorResponse(error, 'Failed to get settings');
  }
}
