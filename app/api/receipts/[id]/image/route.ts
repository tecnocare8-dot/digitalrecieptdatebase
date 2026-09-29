import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth';
import { driveForUser } from '@/lib/drive';
import { errorResponse } from '@/lib/api-errors';

export const dynamic = 'force-dynamic';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const userId = await requireUserId();
        const { id } = await params;

        const drive = await driveForUser(userId);
        const image = await drive.downloadReceipt(id);
        if (!image) return NextResponse.json({ error: 'Not found' }, { status: 404 });

        return new NextResponse(new Uint8Array(image), {
            headers: {
                'Content-Type': 'image/jpeg',
                // 本人しか見られない画像なので共有キャッシュには載せない
                'Cache-Control': 'private, max-age=3600',
            },
        });
    } catch (error) {
        return errorResponse(error, 'Error reading receipt image');
    }
}
