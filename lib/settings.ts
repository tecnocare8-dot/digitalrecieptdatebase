import { prisma } from '@/lib/prisma';

export const MAX_FREE_RECEIPTS = 5;

export interface SubscriptionStatus {
  isPro: boolean;
  isExpired: boolean;
  proExpiresAt: string | null;
  receiptCount: number;
  maxFreeReceipts: number;
  canAddReceipt: boolean;
  reason?: string;
}

// DBに接続できないときは例外をそのまま投げる（以前は「追加可」で返していたため、障害時に5件制限が外れていた）
export async function getSubscriptionStatus(userId: string): Promise<SubscriptionStatus> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const receiptCount = await prisma.receipt.count({ where: { userId } });

  const now = new Date();
  const hasPurchased = user.proExpiresAt !== null;
  const isPro = hasPurchased && user.proExpiresAt! > now;
  const isExpired = hasPurchased && !isPro;

  let canAddReceipt = true;
  let reason = '';

  if (isExpired) {
    canAddReceipt = false;
    reason = 'Proプランの有効期限（1年間）が切れています。過去の領収書データの閲覧・編集は可能ですが、新しい領収書を登録するにはProプランの再購入が必要です。';
  } else if (!isPro && receiptCount >= MAX_FREE_RECEIPTS) {
    canAddReceipt = false;
    reason = `無料プランで登録できる領収書は${MAX_FREE_RECEIPTS}件までです。新しい領収書を登録するにはProプラン（1,500円/年）にアップグレードしてください。`;
  }

  return {
    isPro,
    isExpired,
    proExpiresAt: user.proExpiresAt ? user.proExpiresAt.toISOString() : null,
    receiptCount,
    maxFreeReceipts: MAX_FREE_RECEIPTS,
    canAddReceipt,
    reason,
  };
}
