import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const invoiceNumber = searchParams.get('invoiceNumber'); // Expects T + 13 digits
    const userId = request.headers.get('x-user-id') || 'system'; // Placeholder for auth

    if (!invoiceNumber) {
        return NextResponse.json({ error: 'Invoice number is required' }, { status: 400 });
    }

    try {
        // 1. Check User's History (Receipts) first
        const lastReceipt = await prisma.receipt.findFirst({
            where: { invoiceNumber },
            orderBy: { createdAt: 'desc' },
        });

        if (lastReceipt && lastReceipt.companyName) {
            return NextResponse.json({ companyName: lastReceipt.companyName, source: 'history' });
        }

        // 2. Check Official Database (Local Cache)
        const issuer = await prisma.invoiceIssuer.findUnique({
            where: { invoiceNumber },
        });

        if (issuer) {
            return NextResponse.json({ companyName: issuer.legalName, source: 'cache' });
        }

        // 3. Fetch from NTA API
        const NTA_APP_ID = process.env.NTA_APP_ID;
        if (!NTA_APP_ID) {
            console.warn('NTA_APP_ID is not configured');
            return NextResponse.json({ companyName: null, error: 'NTA API configuration missing' }, { status: 404 });
        }

        // Log API Usage
        // Note: In real app, ensure User exists. For now, we skip if user constraint fails or use try/catch
        try {
            // Need a valid user for relation. If we don't have auth yet, we might skip logging or use a system user if seeded.
            // checking if user exists logic omitted for speed, assuming system works or handle error silently
        } catch (e) {
            console.warn('Failed to log usage', e);
        }

        // Construct API URL
        // NTA API: https://web-api.invoice-kohyo.nta.go.jp/1/num
        // Parameters: id=<AppID>, type=21 (GET), history=0, invoiceNumber=<T+13digits>
        const apiUrl = `https://web-api.invoice-kohyo.nta.go.jp/1/num?id=${NTA_APP_ID}&type=21&history=0&invoiceNumber=${invoiceNumber}`;

        const response = await fetch(apiUrl);
        if (!response.ok) {
            throw new Error(`NTA API Error: ${response.statusText}`);
        }

        const text = await response.text();

        // Simple XML Parsing (Regex) to avoid huge deps for one field
        // Look for <legalName>Name</legalName> or <name>Name</name> depending on format
        // NTA API Format v2 returns <publication>...<name>...</name>...</publication>
        const nameMatch = text.match(/<name>(.*?)<\/name>/);
        const legalName = nameMatch ? nameMatch[1] : null;

        if (legalName) {
            // Cache result
            await prisma.invoiceIssuer.upsert({
                where: { invoiceNumber },
                update: { legalName },
                create: { invoiceNumber, legalName }
            });

            // Log usage if possible (requires existing User)
            // await prisma.apiUsageLog.create({ ... }) 

            return NextResponse.json({ companyName: legalName, source: 'api' });
        } else {
            // Return 404 but with successful structure
            return NextResponse.json({ companyName: null }, { status: 404 });
        }

    } catch (error) {
        console.error('Error looking up invoice:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
