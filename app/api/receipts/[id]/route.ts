import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { unlink } from 'fs/promises';
import path from 'path';
import fs from 'fs';

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

        // Find receipt to get image path
        const receipt = await prisma.receipt.findUnique({
            where: { id: receiptId },
        });

        if (!receipt) {
            return NextResponse.json({ error: 'Receipt not found' }, { status: 404 });
        }

        // Delete from DB
        await prisma.receipt.delete({
            where: { id: receiptId },
        });

        // Delete image file
        if (receipt.imagePath) {
            // imagePath is like "/uploads/filename.jpg"
            // We need absolute path
            const relativePath = receipt.imagePath.startsWith('/') ? receipt.imagePath.slice(1) : receipt.imagePath;
            const absolutePath = path.join(process.cwd(), 'public', relativePath);

            if (fs.existsSync(absolutePath)) {
                try {
                    await unlink(absolutePath);
                } catch (e) {
                    console.error('Failed to delete image file', e);
                    // Continue even if file delete fails
                }
            }
        }

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
                imagePath
            }
        });

        return NextResponse.json(updated);

    } catch (e) {
        console.error('Error updating receipt:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
