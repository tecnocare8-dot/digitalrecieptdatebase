import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { writeFile } from 'fs/promises';
import path from 'path';
import fs from 'fs';
import { createHash } from 'crypto';
import { getSubscriptionStatus } from '@/lib/settings';

export async function POST(request: NextRequest) {
    try {
        const subStatus = await getSubscriptionStatus();
        if (!subStatus.canAddReceipt) {
            return NextResponse.json(
                {
                    error: subStatus.reason || '領収書の新規保存制限に達しています。',
                    isExpired: subStatus.isExpired,
                    isPro: subStatus.isPro,
                },
                { status: 402 }
            );
        }

        const formData = await request.formData();

        const file = formData.get('image') as File;
        const dateStr = formData.get('date') as string;
        const invoiceNumber = formData.get('invoiceNumber') as string;
        const companyName = formData.get('companyName') as string;
        const totalAmountStr = formData.get('totalAmount') as string;
        const paymentMethod = formData.get('paymentMethod') as string;

        if (!file) {
            return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());

        // Calculate Hash (kept for potential future use)
        const hash = createHash('sha256').update(buffer).digest('hex');

        // Duplicate check disabled - same receipt can be saved multiple times
        // (e.g., toll road receipts on the same day)
        // const existing = await prisma.receipt.findUnique({
        //     where: { imageHash: hash },
        // });
        // if (existing) {
        //     return NextResponse.json({
        //         error: 'Duplicate receipt',
        //         code: 'DUPLICATE_RECEIPT',
        //         existingId: existing.id
        //     }, { status: 409 });
        // }

        // Format filename: YYYYMMDD_Company_Price.jpg
        // Sanitize company name to be safe for filenames
        const safeCompanyName = (companyName || 'Unknown').replace(/[^a-z0-9\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/gi, '_');
        const price = totalAmountStr ? totalAmountStr : '0';

        let datePart = '00000000';
        if (dateStr) {
            try {
                const d = new Date(dateStr);
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                datePart = `${y}${m}${day}`;
            } catch (e) {
                console.error('Date parse error', e);
            }
        }

        let suffix = 'ca';
        if (paymentMethod === 'クレジットカード') {
            suffix = 'cr';
        } else if (paymentMethod === '電子マネー') {
            suffix = 'd';
        }

        const filename = `${datePart}_${safeCompanyName}_${price}_${suffix}.jpg`;
        const uploadDir = path.join(process.cwd(), 'public/uploads');

        // Ensure directory exists (redundant but safe)
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        const filePath = path.join(uploadDir, filename);
        await writeFile(filePath, buffer);

        // Save to DB
        const receipt = await prisma.receipt.create({
            data: {
                date: dateStr ? new Date(dateStr) : null,
                invoiceNumber: invoiceNumber || null,
                companyName: companyName || null,
                totalAmount: totalAmountStr ? parseInt(totalAmountStr, 10) : null,
                paymentMethod: paymentMethod || '現金',
                imagePath: `/uploads/${filename}`,
                imageHash: hash,
            },
        });

        return NextResponse.json({ success: true, receipt });
    } catch (error) {
        console.error('Error saving receipt:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
