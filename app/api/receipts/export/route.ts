import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import { driveForUser } from '@/lib/drive';
import { errorResponse } from '@/lib/api-errors';

export const dynamic = 'force-dynamic';

// ドライブに保存されている一覧CSVと同じ内容を返す（会社全体の帳簿なので代表者だけ）
export async function GET() {
    try {
        const { ownerId } = await requireOwner();
        const drive = await driveForUser(ownerId);
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
