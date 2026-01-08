import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { writeFile } from 'fs/promises';
import path from 'path';
import fs from 'fs';
import { createHash } from 'crypto';
import { uploadToDrive } from '@/lib/google-drive';

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const file = formData.get('image') as File;
        const dateStr = formData.get('date') as string;
        const invoiceNumber = formData.get('invoiceNumber') as string;
        const companyName = formData.get('companyName') as string;
        const totalAmountStr = formData.get('totalAmount') as string;
        const paymentMethod = formData.get('paymentMethod') as string;
        const category = formData.get('category') as string;
        const memo = formData.get('memo') as string;

        const { auth } = await import('@/lib/auth');
        const session = await auth();
        // @ts-ignore
        const userId = session?.user?.id;

        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (!file) {
            return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
        }

        // Check Limits
        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: { _count: { select: { receipts: true } } }
        });

        // @ts-ignore
        const isPro = user?.isPro || false;
        const receiptCount = user?._count.receipts || 0;

        if (!isPro && receiptCount >= 5) {
            return NextResponse.json({
                error: 'Free plan limit reached (Max 5 receipts). Please upgrade to Pro.',
                code: 'LIMIT_REACHED'
            }, { status: 402 });
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

        // Format filename: YYYYMMDD_Company_Price_Payment_Category.jpg
        // Sanitize strings
        const safeCompanyName = (companyName || 'Unknown').replace(/[^a-z0-9\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/gi, '_');
        const safeCategory = (category || 'Unknown').replace(/[^a-z0-9\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/gi, '_');
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

        const filename = `${datePart}_${safeCompanyName}_${price}_${suffix}_${safeCategory}.jpg`;
        // const uploadDir = path.join(process.cwd(), 'public/uploads'); 

        // on Vercel, filesystem is read-only. We cannot save to public/uploads.
        // We will store the image as Base64 Data URI in the database for now (Small App / MVP).
        // For production scale, use Vercel Blob or S3.

        // Convert buffer to Base64
        const base64Image = `data:${file.type || 'image/jpeg'};base64,${buffer.toString('base64')}`;

        // Save to DB
        const receipt = await prisma.receipt.create({
            data: {
                userId: userId, // Link to user
                date: dateStr ? new Date(dateStr) : null,
                invoiceNumber: invoiceNumber || null,
                companyName: companyName || null,
                category: category || null,
                memo: memo || null,
                totalAmount: totalAmountStr ? parseInt(totalAmountStr, 10) : null,
                paymentMethod: paymentMethod || '現金',
                imagePath: base64Image, // Use Data URI
                imageHash: hash,
            },
        });

        // @ts-ignore
        if (isPro) {
            const account = await prisma.account.findFirst({
                where: {
                    userId: userId,
                    provider: 'google',
                },
            });

            if (account && account.access_token) {
                await uploadToDrive(file, filename, account.access_token);
            } else {
                console.warn('⚠️ Google Account linked, but no access token found.');
            }
        } else {
            console.log('ℹ️ Free user: Skipping Drive upload.');
        }

        return NextResponse.json({ success: true, receipt });
    } catch (error) {
        console.error('Error saving receipt:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
