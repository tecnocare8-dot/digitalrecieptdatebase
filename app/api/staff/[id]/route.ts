import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import { errorResponse } from '@/lib/api-errors';
import { deleteStaff, renameStaff, resetStaffPassword, StaffInputError } from '@/lib/staff';

export const dynamic = 'force-dynamic';

// スタッフ1人の変更（代表者だけ）。
//   PATCH { resetPassword: true, password? } … パスワード再設定（ログイン中の画面も無効になる）
//   PATCH { displayName }                    … 表示名の変更
//   DELETE                                   … 削除

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ownerId } = await requireOwner();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    if (body.resetPassword) return NextResponse.json(await resetStaffPassword(ownerId, id, body));
    if ('displayName' in body) return NextResponse.json({ staff: await renameStaff(ownerId, id, body.displayName) });
    return NextResponse.json({ error: '変更する内容がありません。' }, { status: 400 });
  } catch (error) {
    if (error instanceof StaffInputError) return NextResponse.json({ error: error.message }, { status: error.status });
    return errorResponse(error, 'Error updating staff');
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ownerId } = await requireOwner();
    const { id } = await params;
    await deleteStaff(ownerId, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof StaffInputError) return NextResponse.json({ error: error.message }, { status: error.status });
    return errorResponse(error, 'Error deleting staff');
  }
}
