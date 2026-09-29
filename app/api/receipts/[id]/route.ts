import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { deleteImage } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/** 本人の領収書だけを返す。他人のIDを指定しても「存在しない」扱いにする */
async function findOwnReceipt(userId: string, id: string) {
    const receiptId = parseInt(id, 10);
    if (isNaN(receiptId)) return null;
    return prisma.receipt.findFirst({ where: { id: receiptId, userId } });
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const userId = await requireUserId();
        const { id } = await params;

        const receipt = await findOwnReceipt(userId, id);
        if (!receipt) {
            return NextResponse.json({ error: 'Receipt not found' }, { status: 404 });
        }

        await prisma.receipt.delete({ where: { id: receipt.id } });

        try {
            await deleteImage(receipt.imageKey);
        } catch (e) {
            // DBからは消えているので、画像の削除失敗は記録だけして続行する
            console.error('Failed to delete image file', e);
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        if (error instanceof UnauthorizedError) return unauthorizedResponse();
        console.error('Error deleting receipt:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const userId = await requireUserId();
        const { id } = await params;

        const receipt = await findOwnReceipt(userId, id);
        if (!receipt) return NextResponse.json({ error: 'Not found' }, { status: 404 });

        const formData = await request.formData();

        const dateStr = formData.get('date') as string;
        const invoiceNumber = formData.get('invoiceNumber') as string;
        const companyName = formData.get('companyName') as string;
        const totalAmount = parseInt(formData.get('totalAmount') as string);
        const paymentMethod = formData.get('paymentMethod') as string;

        const updated = await prisma.receipt.update({
            where: { id: receipt.id },
            data: {
                date: dateStr ? new Date(dateStr) : null,
                invoiceNumber,
                companyName,
                totalAmount: isNaN(totalAmount) ? null : totalAmount,
                paymentMethod,
            }
        });

        const { imageKey: _imageKey, userId: _userId, ...rest } = updated;
        return NextResponse.json(rest);
    } catch (e) {
        if (e instanceof UnauthorizedError) return unauthorizedResponse();
        console.error('Error updating receipt:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
