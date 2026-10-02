import { NextRequest, NextResponse } from 'next/server';
import { requireActor, requireOwner, type Actor } from '@/lib/auth';
import { driveForActor, driveForUser } from '@/lib/drive';
import { errorResponse } from '@/lib/api-errors';
import { toClientReceipt } from '@/lib/receipts';

export const dynamic = 'force-dynamic';

// 帳簿（代表者のドライブの一覧CSV）に載っている領収書だけを対象にする。他人のIDを指定しても「存在しない」扱い。
// スタッフは自分が登録した分だけ直せる。削除は証憑を消せないよう代表者だけ

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    let actor: Actor | null = null;
    try {
        actor = await requireOwner();
        const { id } = await params;

        const drive = await driveForUser(actor.ownerId);
        const deleted = await drive.trashReceipt(id);
        if (!deleted) {
            return NextResponse.json({ error: 'Receipt not found' }, { status: 404 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        return errorResponse(error, 'Error deleting receipt', actor);
    }
}

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    let actor: Actor | null = null;
    try {
        actor = await requireActor();
        const { id } = await params;

        const formData = await request.formData();

        const dateStr = formData.get('date') as string;
        const invoiceNumber = formData.get('invoiceNumber') as string;
        const companyName = formData.get('companyName') as string;
        const totalAmount = parseInt(formData.get('totalAmount') as string);
        const paymentMethod = formData.get('paymentMethod') as string;
        const category = formData.get('category') as string | null;

        const drive = await driveForActor(actor);
        const updated = await drive.updateReceipt(id, {
            date: dateStr ? dateStr.slice(0, 10) : null,
            invoiceNumber: invoiceNumber || null,
            companyName: companyName || null,
            totalAmount: isNaN(totalAmount) ? null : totalAmount,
            paymentMethod: paymentMethod || null,
            category: category || null,
        });
        if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });

        return NextResponse.json(toClientReceipt(updated));
    } catch (e) {
        return errorResponse(e, 'Error updating receipt', actor);
    }
}
