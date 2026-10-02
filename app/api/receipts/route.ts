import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { addPermission, planStatus, STAFF_CONTACT_OWNER } from '@/lib/settings';
import { requireActor, type Actor } from '@/lib/auth';
import { driveForActor } from '@/lib/drive';
import { errorResponse } from '@/lib/api-errors';
import { toClientReceipt } from '@/lib/receipts';
import { sanitizeSignals } from '@/lib/stores';

export const dynamic = 'force-dynamic';

// Vercel の関数はリクエスト本文が4.5MBまで。画面側で縮小してから送るが、念のためここでも弾く
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export async function POST(request: NextRequest) {
    let actor: Actor | null = null;
    try {
        actor = await requireActor();
        // 件数制限・Proは代表者（帳簿の持ち主）の状態で判定する
        const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.ownerId } });

        const formData = await request.formData();

        const file = formData.get('image') as File | null;
        const dateStr = formData.get('date') as string;
        const invoiceNumber = formData.get('invoiceNumber') as string;
        const companyName = formData.get('companyName') as string;
        const totalAmountStr = formData.get('totalAmount') as string;
        const paymentMethod = formData.get('paymentMethod') as string;
        const category = formData.get('category') as string | null;
        // お店の学習に使う手がかり（見た目の指紋・電話番号など）。画面側で作ってJSONで送る
        let signals = null;
        try {
            signals = sanitizeSignals(JSON.parse((formData.get('signals') as string) || 'null'));
        } catch {
            signals = null;
        }

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

        const drive = await driveForActor(actor);
        let denied: string | null = null;
        const record = await drive.addReceipt(
            {
                date: dateStr ? dateStr.slice(0, 10) : null,
                invoiceNumber: invoiceNumber || null,
                companyName: companyName || null,
                totalAmount: isNaN(totalAmount) ? null : totalAmount,
                paymentMethod: paymentMethod || '現金',
                category: category || null,
                createdAt: new Date().toISOString(),
            },
            buffer,
            (count) => {
                const permission = addPermission(user.proExpiresAt, count);
                if (!permission.canAdd) denied = permission.reason;
                return permission.canAdd;
            },
            signals
        );

        if (!record) {
            const { isPro, isExpired } = planStatus(user.proExpiresAt);
            const message = denied || '領収書の新規保存制限に達しています。';
            return NextResponse.json(
                { error: actor.staffId ? `${message} ${STAFF_CONTACT_OWNER}` : message, isExpired, isPro },
                { status: 402 }
            );
        }

        return NextResponse.json({ success: true, receipt: toClientReceipt(record) });
    } catch (error) {
        return errorResponse(error, 'Error saving receipt', actor);
    }
}
