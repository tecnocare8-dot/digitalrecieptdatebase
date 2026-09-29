import { prisma } from '@/lib/prisma';

export function receiptImageUrl(id: number) {
    return `/api/receipts/${id}/image`;
}

/** 本人の領収書を新しい順に返す。日付・金額・番号・会社名が同じものは1件にまとめる */
export async function listUserReceipts(userId: string) {
    const receipts = await prisma.receipt.findMany({
        where: { userId },
        orderBy: [
            { date: 'desc' },
            { id: 'desc' } // Ensure deterministic order (latest first)
        ],
    });

    const uniqueReceipts = [];
    const seen = new Set<string>();

    for (const r of receipts) {
        const dateStr = r.date ? r.date.toISOString().split('T')[0] : 'null';
        const key = `${dateStr}|${r.totalAmount}|${r.invoiceNumber}|${r.companyName}`;

        if (!seen.has(key)) {
            seen.add(key);
            const { imageKey: _imageKey, userId: _userId, ...rest } = r;
            uniqueReceipts.push({ ...rest, imageUrl: receiptImageUrl(r.id) });
        }
    }

    return uniqueReceipts;
}
