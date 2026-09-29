import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createHash, randomUUID } from 'crypto';
import { getSubscriptionStatus } from '@/lib/settings';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { saveImage } from '@/lib/storage';

export const dynamic = 'force-dynamic';

// Vercel の関数はリクエスト本文が4.5MBまで。画面側で縮小してから送るが、念のためここでも弾く
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export async function POST(request: NextRequest) {
    try {
        const userId = await requireUserId();

        const subStatus = await getSubscriptionStatus(userId);
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

        const file = formData.get('image') as File | null;
        const dateStr = formData.get('date') as string;
        const invoiceNumber = formData.get('invoiceNumber') as string;
        const companyName = formData.get('companyName') as string;
        const totalAmountStr = formData.get('totalAmount') as string;
        const paymentMethod = formData.get('paymentMethod') as string;

        if (!file) {
            return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
        }
        if (!file.type.startsWith('image/')) {
            return NextResponse.json({ error: '画像ファイルを選択してください。' }, { status: 400 });
        }
        if (file.size > MAX_IMAGE_BYTES) {
            return NextResponse.json({ error: '画像が大きすぎます（4MBまで）。' }, { status: 413 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());

        // Calculate Hash (kept for potential future use)
        const hash = createHash('sha256').update(buffer).digest('hex');

        // Duplicate check disabled - same receipt can be saved multiple times
        // (e.g., toll road receipts on the same day)

        const imageKey = `receipts/${userId}/${randomUUID()}.jpg`;
        await saveImage(imageKey, buffer, file.type);

        const receipt = await prisma.receipt.create({
            data: {
                userId,
                date: dateStr ? new Date(dateStr) : null,
                invoiceNumber: invoiceNumber || null,
                companyName: companyName || null,
                totalAmount: totalAmountStr ? parseInt(totalAmountStr, 10) : null,
                paymentMethod: paymentMethod || '現金',
                imageKey,
                imageHash: hash,
            },
        });

        return NextResponse.json({ success: true, receipt });
    } catch (error) {
        if (error instanceof UnauthorizedError) return unauthorizedResponse();
        console.error('Error saving receipt:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
