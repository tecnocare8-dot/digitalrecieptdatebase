import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const stripeKey = process.env.STRIPE_SECRET_KEY;

    if (!stripeKey) {
      return NextResponse.json(
        {
          error: 'Stripe APIキー (STRIPE_SECRET_KEY) が未設定です。Vercelの環境変数で sk_live_... または sk_test_... を設定してください。',
        },
        { status: 500 }
      );
    }

    if (stripeKey.startsWith('pk_')) {
      return NextResponse.json(
        {
          error: 'STRIPE_SECRET_KEY に Publishable Key (pk_...) が指定されています。Vercelの環境変数で Secret Key (sk_live_... または sk_test_...) を設定してください。',
        },
        { status: 500 }
      );
    }

    const stripe = new Stripe(stripeKey, {
      apiVersion: '2025-02-24.acacia' as any,
    });

    const origin = request.headers.get('origin') || request.headers.get('referer') || 'https://digitalrecieptdatebase.vercel.app';

    // Stripe Checkout Session Creation
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'jpy',
            product_data: {
              name: 'Proプラン (1年間)',
              description: '年間サブスクリプション / 有効期間1年間・自動同期・無制限保存',
              metadata: {
                productId: 'prod_VLY4V3qhIvZbmu',
              },
            },
            unit_amount: 1500,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${origin}/settings?success=true`,
      cancel_url: `${origin}/settings?canceled=true`,
      metadata: {
        productId: 'prod_VLY4V3qhIvZbmu',
      },
    });

    if (!session.url) {
      return NextResponse.json(
        { error: 'Stripe Checkout URLの生成に失敗しました。' },
        { status: 500 }
      );
    }

    return NextResponse.json({ url: session.url });
  } catch (error: any) {
    console.error('Stripe Checkout Error:', error);
    return NextResponse.json(
      {
        error: error.message || 'Stripe決済の呼び出し中にエラーが発生しました。',
      },
      { status: 500 }
    );
  }
}
