import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';

export async function GET(req: NextRequest) {
    const session = await auth();
    // @ts-ignore
    const userId = session?.user?.id;

    if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const settings = await prisma.userSettings.findUnique({
        where: { userId },
    });

    return NextResponse.json({
        driveFolderName: settings?.driveFolderName || 'Receipt Scanner',
    });
}

export async function POST(req: NextRequest) {
    const session = await auth();
    // @ts-ignore
    const userId = session?.user?.id;

    if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await req.json();
        const { driveFolderName } = body;

        if (!driveFolderName || driveFolderName.trim() === '') {
            return NextResponse.json({ error: 'Folder name is required' }, { status: 400 });
        }

        const settings = await prisma.userSettings.upsert({
            where: { userId },
            update: { driveFolderName: driveFolderName.trim() },
            create: {
                userId,
                driveFolderName: driveFolderName.trim(),
            },
        });

        return NextResponse.json({ success: true, settings });

    } catch (error) {
        console.error('Settings update error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
