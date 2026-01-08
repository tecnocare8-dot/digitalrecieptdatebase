import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { prisma } from '@/lib/prisma';
import { headers } from 'next/headers';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2025-12-15.clover' as any,
});

// Disable body parsing for webhook verification
export const dynamic = 'force-dynamic'; // Disable static optimization for webhook

export async function POST(req: Request) {
    const body = await req.text();
    const signature = (await headers()).get('stripe-signature') as string;

    let event: Stripe.Event;

    try {
        if (!process.env.STRIPE_WEBHOOK_SECRET) {
            console.warn('⚠️ STRIPE_WEBHOOK_SECRET is not string. Using unverified parsing for dev (NOT SAFE FOR PROD) if live mode is off.');
            // In a real scenario, this should error. For now, if secret is missing, we might fail or (dangerously) proceed.
            // Strict logic:
            return NextResponse.json({ error: 'Webhook secret missing' }, { status: 500 });
        }
        event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err: any) {
        console.error(`⚠️  Webhook signature verification failed.`, err.message);
        return NextResponse.json({ error: 'Webhook Error' }, { status: 400 });
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;

        if (userId) {
            console.log(`✅ Payment successful for user ${userId}. Upgrading to Pro.`);
            await prisma.user.update({
                where: { id: userId },
                data: {
                    // @ts-ignore
                    isPro: true,
                    stripeCustomerId: session.customer as string,
                },
            });
        }
    }

    return NextResponse.json({ received: true });
}
