import { NextResponse } from 'next/server';
import { requireActor, type Actor } from '@/lib/auth';
import { driveForActor } from '@/lib/drive';
import { errorResponse } from '@/lib/api-errors';
import { dedupeReceipts, toClientReceipt } from '@/lib/receipts';

export const dynamic = 'force-dynamic';

export async function GET() {
    let actor: Actor | null = null;
    try {
        // スタッフは自分が登録した分だけ
        actor = await requireActor();
        const drive = await driveForActor(actor);
        const records = await drive.listReceipts();
        return NextResponse.json(dedupeReceipts(records).map(toClientReceipt));
    } catch (error) {
        return errorResponse(error, 'Error fetching receipts', actor);
    }
}
