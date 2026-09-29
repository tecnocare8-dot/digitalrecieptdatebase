import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth';
import { DriveAuthError, DriveFolderMissingError, driveForUser, type ReceiptRecord } from '@/lib/drive';
import { errorResponse } from '@/lib/api-errors';

export const dynamic = 'force-dynamic';

// 国税庁 適格請求書発行事業者公表システム Web-API（アプリケーションIDは国税庁への申請で発行される）
async function lookupFromNta(invoiceNumber: string): Promise<string | null> {
    const appId = process.env.NTA_APP_ID;
    if (!appId) return null;

    const url = new URL('https://web-api.invoice-kohyo.nta.go.jp/1/num');
    url.searchParams.set('id', appId);
    url.searchParams.set('number', invoiceNumber);
    url.searchParams.set('type', '21'); // JSON

    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
        console.error('NTA invoice API error:', res.status);
        return null;
    }
    const data = await res.json();
    return data?.announcement?.[0]?.name ?? null;
}

export async function GET(request: NextRequest) {
    const invoiceNumber = request.nextUrl.searchParams.get('invoiceNumber');

    if (!invoiceNumber || !/^T\d{13}$/.test(invoiceNumber)) {
        return NextResponse.json({ error: 'Invoice number is required' }, { status: 400 });
    }

    try {
        const userId = await requireUserId();

        // 1. 本人が過去に同じ登録番号で保存した会社名（ドライブの一覧CSVから）。
        //    ドライブ未連携・フォルダ未作成なら飛ばして国税庁の照会へ進む
        let history: ReceiptRecord[] = [];
        try {
            history = await (await driveForUser(userId)).listReceipts();
        } catch (e) {
            if (!(e instanceof DriveAuthError) && !(e instanceof DriveFolderMissingError)) throw e;
        }
        const lastReceipt = history
            .filter((r) => r.invoiceNumber === invoiceNumber && r.companyName)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

        if (lastReceipt?.companyName) {
            return NextResponse.json({ companyName: lastReceipt.companyName, source: 'history' });
        }

        // 2. 国税庁の公表データ
        const officialName = await lookupFromNta(invoiceNumber);
        if (officialName) {
            return NextResponse.json({ companyName: officialName, source: 'nta' });
        }

        return NextResponse.json({ companyName: null }, { status: 404 });
    } catch (error) {
        return errorResponse(error, 'Error looking up invoice');
    }
}
