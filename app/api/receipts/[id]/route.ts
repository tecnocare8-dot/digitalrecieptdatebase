import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { unlink } from 'fs/promises';
import path from 'path';
import fs from 'fs';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const receiptId = parseInt(id, 10);

        if (isNaN(receiptId)) {
            return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
        }

        const receipt = await prisma.receipt.findUnique({
            where: { id: receiptId },
            include: {
                // @ts-ignore
                logs: {
                    orderBy: { changedAt: 'desc' }
                }
            }
        });

        if (!receipt) {
            return NextResponse.json({ error: 'Receipt not found' }, { status: 404 });
        }

        return NextResponse.json(receipt);
    } catch (error) {
        console.error('Error fetching receipt:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}


export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const receiptId = parseInt(id, 10);

        if (isNaN(receiptId)) {
            return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
        }

        // Find receipt to get image path and snapshot
        const receipt = await prisma.receipt.findUnique({
            where: { id: receiptId },
        });

        if (!receipt) {
            return NextResponse.json({ error: 'Receipt not found' }, { status: 404 });
        }

        // Create Audit Log (Snapshot before delete)
        await prisma.receiptLog.create({
            data: {
                receiptId: receiptId,
                operationType: 'DELETE',
                previousData: receipt as any, // Store full object
                changedBy: 'user', // In a real app, use session.user.id
            }
        });

        // Logical Delete
        await prisma.receipt.update({
            where: { id: receiptId },
            data: { isActive: false }
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error deleting receipt:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const receiptId = parseInt(id, 10);
        const formData = await request.formData();

        const dateStr = formData.get('date') as string;
        const invoiceNumber = formData.get('invoiceNumber') as string;
        const companyName = formData.get('companyName') as string;
        const totalAmount = parseInt(formData.get('totalAmount') as string);
        const paymentMethod = formData.get('paymentMethod') as string;
        const category = formData.get('category') as string;
        const memo = formData.get('memo') as string;

        const receipt = await prisma.receipt.findUnique({ where: { id: receiptId } });
        if (!receipt) return NextResponse.json({ error: 'Not found' }, { status: 404 });

        let imagePath = receipt.imagePath;

        // Rename logic
        if (dateStr && paymentMethod && companyName) {
            const ext = path.extname(receipt.imagePath);
            const dateObj = new Date(dateStr);
            const yyyy = dateObj.getFullYear();
            const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
            const dd = String(dateObj.getDate()).padStart(2, '0');
            const datePart = `${yyyy}${mm}${dd}`;

            let suffix = 'ca';
            if (paymentMethod === 'クレジットカード') suffix = 'cr';
            else if (paymentMethod === '電子マネー') suffix = 'd';

            const safeCompanyName = (companyName || 'Unknown').replace(/[^a-z0-9\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/gi, '_');
            const safeCategory = (category || 'Unknown').replace(/[^a-z0-9\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/gi, '_');
            const price = totalAmount ? totalAmount.toString() : '0';

            const newFilename = `${datePart}_${safeCompanyName}_${price}_${suffix}_${safeCategory}${ext}`;
            const newImagePath = `/uploads/${newFilename}`;

            const oldAbsPath = path.join(process.cwd(), 'public', receipt.imagePath.replace(/^\//, ''));
            const newAbsPath = path.join(process.cwd(), 'public', 'uploads', newFilename);

            if (fs.existsSync(oldAbsPath) && oldAbsPath !== newAbsPath) {
                try {
                    await fs.promises.rename(oldAbsPath, newAbsPath);
                    imagePath = newImagePath;
                } catch (e) {
                    console.error('Failed to rename file', e);
                }
            }
        }

        // Create Audit Log (Snapshot before update)
        await prisma.receiptLog.create({
            data: {
                receiptId: receiptId,
                operationType: 'UPDATE',
                previousData: receipt as any,
                changedBy: 'user',
            }
        });

        const updated = await prisma.receipt.update({
            where: { id: receiptId },
            data: {
                date: new Date(dateStr),
                invoiceNumber,
                companyName,
                category,
                memo,
                totalAmount,
                paymentMethod,
                imagePath,
                updatedAt: new Date(), // Force update timestamp
            }
        });

        return NextResponse.json(updated);

    } catch (e) {
        console.error('Error updating receipt:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
