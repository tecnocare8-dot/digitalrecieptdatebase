import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
    try {
        const { auth } = await import('@/lib/auth');
        const session = await auth();
        // @ts-ignore
        const userId = session?.user?.id;

        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const receipts = await prisma.receipt.findMany({
            where: { userId: userId },
            orderBy: [
                { date: 'desc' },
                { id: 'desc' }
            ],
        });

        // Deduplicate
        const uniqueReceipts = [];
        const seen = new Set();

        for (const r of receipts) {
            const dateStr = r.date ? r.date.toISOString().split('T')[0] : 'null';
            const key = `${dateStr}|${r.totalAmount}|${r.invoiceNumber}|${r.companyName}`;

            if (!seen.has(key)) {
                seen.add(key);
                uniqueReceipts.push(r);
            }
        }

        // CSV Header
        const header = ['ID', '日付', '会社名', '登録番号', '金額', '支払い方法', '画像パス'];
        const rows = uniqueReceipts.map(r => [
            r.id,
            r.date ? r.date.toISOString().split('T')[0] : '',
            r.companyName || '',
            r.invoiceNumber || '',
            r.totalAmount || '',
            r.paymentMethod || '現金',
            r.imagePath
        ]);

        // Generate CSV String
        // Add BOM for Excel compatibility
        const bom = '\uFEFF';
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
        console.error('Error exporting CSV:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
