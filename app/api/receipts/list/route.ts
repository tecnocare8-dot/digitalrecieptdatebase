import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
    try {
        const receipts = await prisma.receipt.findMany({
            orderBy: [
                { date: 'desc' },
                { id: 'desc' } // Ensure deterministic order (latest first)
            ],
        });

        // Deduplicate: Keep only the first occurrence of a unique combination
        const uniqueReceipts = [];
        const seen = new Set();

        for (const r of receipts) {
            // Create a unique key based on content
            const dateStr = r.date ? r.date.toISOString().split('T')[0] : 'null';
            const key = `${dateStr}|${r.totalAmount}|${r.invoiceNumber}|${r.companyName}`;

            if (!seen.has(key)) {
                seen.add(key);
                uniqueReceipts.push(r);
            }
        }

        return NextResponse.json(uniqueReceipts);
    } catch (error) {
        console.error('Error fetching receipts:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
