import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const invoiceNumber = searchParams.get('invoiceNumber');

    if (!invoiceNumber) {
        return NextResponse.json({ error: 'Invoice number is required' }, { status: 400 });
    }

    try {
        // 1. Check User's History (Receipts) first
        // If the user has saved a receipt with this invoice number before, use that name.
        const lastReceipt = await prisma.receipt.findFirst({
            where: { invoiceNumber },
            orderBy: { createdAt: 'desc' },
        });

        if (lastReceipt && lastReceipt.companyName) {
            return NextResponse.json({ companyName: lastReceipt.companyName, source: 'history' });
        }

        // 2. Check Official Database
        const issuer = await prisma.invoiceIssuer.findUnique({
            where: { invoiceNumber },
        });

        if (issuer) {
            return NextResponse.json({ companyName: issuer.legalName });
        } else {
            return NextResponse.json({ companyName: null }, { status: 404 });
        }
    } catch (error) {
        console.error('Error looking up invoice:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
