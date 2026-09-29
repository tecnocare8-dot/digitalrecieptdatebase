import Stripe from 'stripe';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export const PRO_PRICE_JPY = 1500;
// Stripeの商品ID。テスト環境と本番環境で別IDになるため環境変数で上書きできる
export const PRO_PRODUCT_ID = process.env.STRIPE_PRODUCT_ID || 'prod_VLY4V3qhIvZbmu';

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error('STRIPE_SECRET_KEY が設定されていません。');
  if (!key.startsWith('sk_') && !key.startsWith('rk_')) {
    throw new Error('STRIPE_SECRET_KEY にはシークレットキー（sk_live_... / sk_test_...）を設定してください。');
  }
  return new Stripe(key);
}

/**
 * 支払い済みの Checkout Session を利用者のProプランに反映する。
 * webhook と決済後の戻り画面の両方から呼ばれるが、stripeSessionId の一意制約により1回しか延長されない。
 * 期限内に再購入した場合は、残り期間の末尾から1年延長する。
 */
export async function grantProForSession(session: Stripe.Checkout.Session): Promise<'granted' | 'already' | 'not_paid'> {
  // 100%割引クーポンでは支払いが発生せず 'no_payment_required' になる。これも購入完了として扱う
  if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') return 'not_paid';

  const userId = session.client_reference_id;
  if (!userId) throw new Error(`Checkout Session ${session.id} に client_reference_id がありません。`);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          userId,
          stripeSessionId: session.id,
          amount: session.amount_total ?? 0,
          currency: session.currency ?? 'jpy',
        },
      });

      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const now = new Date();
      const base = user.proExpiresAt && user.proExpiresAt > now ? user.proExpiresAt : now;
      const expiresAt = new Date(base);
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);

      await tx.user.update({ where: { id: userId }, data: { proExpiresAt: expiresAt } });
    });
    return 'granted';
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return 'already';
    throw e;
  }
}
