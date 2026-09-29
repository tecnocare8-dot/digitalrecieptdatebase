import { prisma } from '@/lib/prisma';

export interface SubscriptionStatus {
  isPro: boolean;
  isExpired: boolean;
  proExpiresAt: string | null;
  receiptCount: number;
  maxFreeReceipts: number;
  canAddReceipt: boolean;
  reason?: string;
}

export async function getSubscriptionStatus(): Promise<SubscriptionStatus> {
  const maxFreeReceipts = 5;

  try {
    const settings = await prisma.userSettings.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1, isPro: false },
    });

    const receiptCount = await prisma.receipt.count();
    const now = new Date();

    let isExpired = false;
    if (settings.isPro && settings.proExpiresAt) {
      if (new Date(settings.proExpiresAt) < now) {
        isExpired = true;
      }
    }

    let canAddReceipt = true;
    let reason = '';

    if (isExpired) {
      canAddReceipt = false;
      reason = 'Proプランの有効期限（1年間）が切れています。過去の領収書データの閲覧・編集は可能ですが、新しい領収書を登録するにはProプランの再購入が必要です。';
    } else if (!settings.isPro && receiptCount >= maxFreeReceipts) {
      canAddReceipt = false;
      reason = `無料プランで登録できる領収書は${maxFreeReceipts}件までです。新しい領収書を登録するにはProプラン（1,500円/年）にアップグレードしてください。`;
    }

    return {
      isPro: settings.isPro && !isExpired,
      isExpired,
      proExpiresAt: settings.proExpiresAt ? settings.proExpiresAt.toISOString() : null,
      receiptCount,
      maxFreeReceipts,
      canAddReceipt,
      reason,
    };
  } catch (error) {
    console.error('Database connection error in getSubscriptionStatus, returning fallback:', error);
    // Safe fallback if database is not initialized or unreachable on serverless
    return {
      isPro: false,
      isExpired: false,
      proExpiresAt: null,
      receiptCount: 0,
      maxFreeReceipts: maxFreeReceipts,
      canAddReceipt: true,
    };
  }
}
