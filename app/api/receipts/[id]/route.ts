import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth';
import { driveForUser } from '@/lib/drive';
import { errorResponse } from '@/lib/api-errors';
import { toClientReceipt } from '@/lib/receipts';

export const dynamic = 'force-dynamic';

// 本人のドライブの一覧CSVに載っている領収書だけを対象にする。他人のIDを指定しても「存在しない」扱い

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const userId = await requireUserId();
        const { id } = await params;

        const drive = await driveForUser(userId);
        const deleted = await drive.trashReceipt(id);
        if (!deleted) {
            return NextResponse.json({ error: 'Receipt not found' }, { status: 404 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        return errorResponse(error, 'Error deleting receipt');
    }
}

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const userId = await requireUserId();
        const { id } = await params;

        const formData = await request.formData();

        const dateStr = formData.get('date') as string;
        const invoiceNumber = formData.get('invoiceNumber') as string;
        const companyName = formData.get('companyName') as string;
        const totalAmount = parseInt(formData.get('totalAmount') as string);
        const paymentMethod = formData.get('paymentMethod') as string;

        const drive = await driveForUser(userId);
        const updated = await drive.updateReceipt(id, {
            date: dateStr ? dateStr.slice(0, 10) : null,
            invoiceNumber: invoiceNumber || null,
            companyName: companyName || null,
            totalAmount: isNaN(totalAmount) ? null : totalAmount,
            paymentMethod: paymentMethod || null,
        });
        if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });

        return NextResponse.json(toClientReceipt(updated));
    } catch (e) {
        return errorResponse(e, 'Error updating receipt');
    }
}
