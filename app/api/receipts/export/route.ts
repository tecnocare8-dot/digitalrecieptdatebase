import { NextRequest, NextResponse } from 'next/server';
import { listUserReceipts } from '@/lib/receipts';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        const userId = await requireUserId();
        const receipts = await listUserReceipts(userId);
        const origin = request.nextUrl.origin;

        // CSV Header
        const header = ['ID', '日付', '会社名', '登録番号', '金額', '支払い方法', '画像URL'];
        const rows = receipts.map(r => [
            r.id,
            r.date ? r.date.toISOString().split('T')[0] : '',
            r.companyName || '',
            r.invoiceNumber || '',
            r.totalAmount || '',
            r.paymentMethod || '現金',
            `${origin}${r.imageUrl}`
        ]);

        // Generate CSV String
        // Add BOM for Excel compatibility
        const bom = '﻿';
        const csvContent = bom + [
            header.join(','),
            ...rows.map(row => row.map(field => {
                // Escape quotes and wrap in quotes if necessary
                const stringField = String(field);
                if (stringField.includes(',') || stringField.includes('"') || stringField.includes('\n')) {
                    return `"${stringField.replace(/"/g, '""')}"`;
                }
                return stringField;
            }).join(','))
        ].join('\n');

        return new NextResponse(csvContent, {
            headers: {
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': 'attachment; filename="receipts.csv"',
            },
        });
    } catch (error) {
        if (error instanceof UnauthorizedError) return unauthorizedResponse();
        console.error('Error exporting CSV:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
