import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
    try {
        const { auth } = await import('@/lib/auth');
        const session = await auth();
        // @ts-ignore
        const userId = session?.user?.id;

        if (!userId) {
            return NextResponse.json([]); // Return empty for guests
        }

        // Parse query params
        const url = new URL(request.url);
        const startDate = url.searchParams.get('startDate');
        const endDate = url.searchParams.get('endDate');
        const minAmount = url.searchParams.get('minAmount');
        const maxAmount = url.searchParams.get('maxAmount');
        const keyword = url.searchParams.get('keyword'); // company, category, memo
        const paymentMethod = url.searchParams.get('paymentMethod');

        // Build where clause
        const where: any = {
            userId: userId,
            isActive: true, // Only active receipts
        };

        if (startDate || endDate) {
            where.date = {};
            if (startDate) where.date.gte = new Date(startDate);
            if (endDate) where.date.lte = new Date(endDate);
        }

        if (minAmount || maxAmount) {
            where.totalAmount = {};
            if (minAmount) where.totalAmount.gte = parseInt(minAmount);
            if (maxAmount) where.totalAmount.lte = parseInt(maxAmount);
        }

        if (paymentMethod) {
            where.paymentMethod = paymentMethod;
        }

        if (keyword) {
            where.OR = [
                { companyName: { contains: keyword, mode: 'insensitive' } },
                { category: { contains: keyword, mode: 'insensitive' } },
                { memo: { contains: keyword, mode: 'insensitive' } },
                { invoiceNumber: { contains: keyword, mode: 'insensitive' } },
            ];
        }

        const receipts = await prisma.receipt.findMany({
            where: where,
            orderBy: [
                { date: 'desc' },
                { id: 'desc' }
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
