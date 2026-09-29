import { NextResponse } from 'next/server';
import { getSubscriptionStatus } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const status = await getSubscriptionStatus();
    return NextResponse.json(status);
  } catch (error) {
    console.error('Failed to get settings:', error);
    return NextResponse.json({ error: 'Failed to retrieve settings' }, { status: 500 });
  }
}
