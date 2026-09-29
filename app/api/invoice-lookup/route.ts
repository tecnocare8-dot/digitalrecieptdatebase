import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';

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

        // 1. 本人が過去に同じ登録番号で保存した会社名
        const lastReceipt = await prisma.receipt.findFirst({
            where: { userId, invoiceNumber, companyName: { not: null } },
            orderBy: { createdAt: 'desc' },
        });

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
        if (error instanceof UnauthorizedError) return unauthorizedResponse();
        console.error('Error looking up invoice:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
