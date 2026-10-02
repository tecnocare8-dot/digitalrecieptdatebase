import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import { errorResponse } from '@/lib/api-errors';
import { createStaff, listStaff, StaffInputError } from '@/lib/staff';

export const dynamic = 'force-dynamic';

// スタッフの一覧・追加（代表者だけ）

export async function GET() {
  try {
    const { ownerId } = await requireOwner();
    return NextResponse.json(await listStaff(ownerId));
  } catch (error) {
    return errorResponse(error, 'Error listing staff');
  }
}

export async function POST(request: NextRequest) {
  try {
    const { ownerId } = await requireOwner();
    const body = await request.json().catch(() => ({}));
    // パスワードはこの応答でだけ返す（画面で一度だけ表示して手渡してもらう）
    return NextResponse.json(await createStaff(ownerId, body));
  } catch (error) {
    if (error instanceof StaffInputError) return NextResponse.json({ error: error.message }, { status: error.status });
    return errorResponse(error, 'Error creating staff');
  }
}
