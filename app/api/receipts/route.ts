import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { addPermission, planStatus } from '@/lib/settings';
import { requireUserId } from '@/lib/auth';
import { driveForUser } from '@/lib/drive';
import { errorResponse } from '@/lib/api-errors';
import { toClientReceipt } from '@/lib/receipts';

export const dynamic = 'force-dynamic';

// Vercel の関数はリクエスト本文が4.5MBまで。画面側で縮小してから送るが、念のためここでも弾く
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export async function POST(request: NextRequest) {
    try {
        const userId = await requireUserId();
        const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

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
        const totalAmount = totalAmountStr ? parseInt(totalAmountStr, 10) : NaN;

        // Duplicate check disabled - same receipt can be saved multiple times
        // (e.g., toll road receipts on the same day)

        const drive = await driveForUser(userId);
        let denied: string | null = null;
        const record = await drive.addReceipt(
            {
                date: dateStr ? dateStr.slice(0, 10) : null,
                invoiceNumber: invoiceNumber || null,
                companyName: companyName || null,
                totalAmount: isNaN(totalAmount) ? null : totalAmount,
                paymentMethod: paymentMethod || '現金',
                createdAt: new Date().toISOString(),
            },
            buffer,
            (count) => {
                const permission = addPermission(user.proExpiresAt, count);
                if (!permission.canAdd) denied = permission.reason;
                return permission.canAdd;
            }
        );

        if (!record) {
            const { isPro, isExpired } = planStatus(user.proExpiresAt);
            return NextResponse.json(
                { error: denied || '領収書の新規保存制限に達しています。', isExpired, isPro },
                { status: 402 }
            );
        }

        return NextResponse.json({ success: true, receipt: toClientReceipt(record) });
    } catch (error) {
        return errorResponse(error, 'Error saving receipt');
    }
}
