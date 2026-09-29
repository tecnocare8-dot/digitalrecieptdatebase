import { NextResponse } from 'next/server';
import { listUserReceipts } from '@/lib/receipts';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const userId = await requireUserId();
        return NextResponse.json(await listUserReceipts(userId));
    } catch (error) {
        if (error instanceof UnauthorizedError) return unauthorizedResponse();
        console.error('Error fetching receipts:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
