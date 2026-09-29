import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { readImage } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const userId = await requireUserId();
        const { id } = await params;
        const receiptId = parseInt(id, 10);
        if (isNaN(receiptId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

        const receipt = await prisma.receipt.findFirst({ where: { id: receiptId, userId } });
        if (!receipt) return NextResponse.json({ error: 'Not found' }, { status: 404 });

        const image = await readImage(receipt.imageKey);
        if (!image) return NextResponse.json({ error: 'Image not found' }, { status: 404 });

        return new NextResponse(image.body as BodyInit, {
            headers: {
                'Content-Type': image.contentType,
                // 本人しか見られない画像なので共有キャッシュには載せない
                'Cache-Control': 'private, max-age=3600',
            },
        });
    } catch (error) {
        if (error instanceof UnauthorizedError) return unauthorizedResponse();
        console.error('Error reading receipt image:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
