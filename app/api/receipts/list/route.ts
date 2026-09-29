import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth';
import { driveForUser } from '@/lib/drive';
import { errorResponse } from '@/lib/api-errors';
import { dedupeReceipts, toClientReceipt } from '@/lib/receipts';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const userId = await requireUserId();
        const drive = await driveForUser(userId);
        const records = await drive.listReceipts();
        return NextResponse.json(dedupeReceipts(records).map(toClientReceipt));
    } catch (error) {
        return errorResponse(error, 'Error fetching receipts');
    }
}
