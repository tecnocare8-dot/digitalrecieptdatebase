import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getStripe, grantProForSession } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    // 署名を確認できない通知は受け付けない（以前は署名なしJSONを受け入れていたため、偽の通知でProにできた）
    console.error('STRIPE_WEBHOOK_SECRET is not set; rejecting webhook.');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  const body = await request.text();
  const stripe = getStripe();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object as Stripe.Checkout.Session;
    try {
      const result = await grantProForSession(session);
      console.log(`Stripe ${event.type} ${session.id}: ${result}`);
    } catch (err) {
      // 500を返すとStripeが自動で再送してくれる
      console.error('Failed to grant Pro in Stripe webhook:', err);
      return NextResponse.json({ error: 'Failed to process' }, { status: 500 });
    }
  }

  return NextResponse.json({ received: true });
}
