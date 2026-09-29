import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth';
import { driveForUser } from '@/lib/drive';
import { errorResponse } from '@/lib/api-errors';

export const dynamic = 'force-dynamic';

// ドライブに保存されている一覧CSVと同じ内容を返す
export async function GET() {
    try {
        const userId = await requireUserId();
        const drive = await driveForUser(userId);
        const csvContent = await drive.ledgerCsv();

        return new NextResponse(csvContent, {
            headers: {
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename="receipts.csv"; filename*=UTF-8''${encodeURIComponent('領収書一覧.csv')}`,
            },
        });
    } catch (error) {
        return errorResponse(error, 'Error exporting CSV');
    }
}
