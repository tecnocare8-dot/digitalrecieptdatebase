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
        let apiLegalName: string | null = null;
        let apiError = false;

        if (NTA_APP_ID) {
            try {
                const apiUrl = `https://web-api.invoice-kohyo.nta.go.jp/1/num?id=${NTA_APP_ID}&type=21&history=0&invoiceNumber=${invoiceNumber}`;
                const response = await fetch(apiUrl);
                if (response.ok) {
                    const text = await response.text();
                    const nameMatch = text.match(/<name>(.*?)<\/name>/);
                    if (nameMatch) {
                        apiLegalName = nameMatch[1];
                    }
                } else {
                    apiError = true;
                }
            } catch (e) {
                console.warn('NTA API failed:', e);
                apiError = true;
            }
        } else {
            // Treat missing ID as "API not available" -> fallthrough to local list
            apiError = true;
        }

        if (apiLegalName) {
            // Cache result from API
            await prisma.invoiceIssuer.upsert({
                where: { invoiceNumber },
                update: { legalName: apiLegalName },
                create: { invoiceNumber, legalName: apiLegalName }
            });
            return NextResponse.json({ companyName: apiLegalName, source: 'api' });
        }


        // 4. Fallback: Check Local List (CSV/JSON)
        // If API failed or returned execution without result, check local fallback
        // This is useful while waiting for API approval or as a backup.

        // Simple CSV parsing for the demo
        const fs = require('fs');
        const path = require('path');
        const csvPath = path.join(process.cwd(), 'data', 'invoice_local_list.csv');

        if (fs.existsSync(csvPath)) {
            const fileContent = fs.readFileSync(csvPath, 'utf-8');
            const lines = fileContent.split('\n');
            for (const line of lines) {
                const [csvInvoice, csvName] = line.split(',');
                if (csvInvoice?.trim() === invoiceNumber) {
                    return NextResponse.json({ companyName: csvName.trim(), source: 'local_list' });
                }
            }
        }

        // If all failing, return 404
        return NextResponse.json({ companyName: null }, { status: 404 });

    } catch (error) {
        console.error('Error looking up invoice:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
