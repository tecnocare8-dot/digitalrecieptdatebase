import { fileUrl, type ReceiptRecord } from '@/lib/drive';

export function receiptImageUrl(id: string) {
    return `/api/receipts/${encodeURIComponent(id)}/image`;
}

/** 画面に返す形。画像はアプリ経由（本人確認付き）とドライブ上の両方のリンクを付ける */
export function toClientReceipt(r: ReceiptRecord) {
    return {
        id: r.id,
        date: r.date,
        invoiceNumber: r.invoiceNumber,
        companyName: r.companyName,
        totalAmount: r.totalAmount,
        paymentMethod: r.paymentMethod,
        category: r.category,
        createdAt: r.createdAt,
        registeredBy: r.registeredBy,
        registeredById: r.registeredById,
        imageUrl: receiptImageUrl(r.id),
        driveUrl: fileUrl(r.id),
    };
}

/** 日付・金額・番号・会社名が同じものは1件にまとめる（以前からの一覧表示の仕様） */
export function dedupeReceipts(records: ReceiptRecord[]) {
    const seen = new Set<string>();
    return records.filter((r) => {
        const key = `${r.date ?? 'null'}|${r.totalAmount}|${r.invoiceNumber}|${r.companyName}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
