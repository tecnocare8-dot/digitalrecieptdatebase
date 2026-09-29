import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUserId, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { getStripe, PRO_PRICE_JPY, PRO_PRODUCT_ID } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const userId = await requireUserId();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const stripe = getStripe();

    const origin = request.nextUrl.origin;

    // 年額と言っても自動更新ではなく、1年分の一括払い。期限が来たら画面から再購入してもらう
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'jpy',
            product: PRO_PRODUCT_ID,
            unit_amount: PRO_PRICE_JPY,
          },
          quantity: 1,
        },
      ],
      // どの利用者の支払いかを webhook / 戻り画面で特定するためのID
      client_reference_id: userId,
      customer_email: user.email,
      metadata: { userId },
      success_url: `${origin}/settings?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/settings?canceled=true`,
    });

    if (!session.url) {
      return NextResponse.json({ error: 'Stripe Checkout URLの生成に失敗しました。' }, { status: 500 });
    }

    return NextResponse.json({ url: session.url });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorizedResponse();
    console.error('Stripe Checkout Error:', error);
    return NextResponse.json(
      { error: '決済画面を開けませんでした。時間をおいて再度お試しください。' },
      { status: 500 }
    );
  }
}
