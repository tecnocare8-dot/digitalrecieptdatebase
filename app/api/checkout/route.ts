import { NextResponse } from 'next/server';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2025-12-15.clover' as any,
});

export async function POST(req: Request) {
    try {
        const { auth } = await import('@/lib/auth');
        const session = await auth();
        // @ts-ignore
        const userId = session?.user?.id;

        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const checkoutSession = await stripe.checkout.sessions.create({
            mode: 'payment',
            line_items: [
                {
                    price_data: {
                        currency: 'jpy',
                        product_data: {
                            name: 'Pro Plan Upgrade',
                            description: 'Unlimited receipts and Google Drive sync.',
                        },
                        unit_amount: 500, // Example price: 500 JPY
                    },
                    quantity: 1,
                },
            ],
            metadata: {
                userId: userId,
            },
            allow_promotion_codes: true,
            success_url: `${process.env.NEXTAUTH_URL}?payment=success`,
            cancel_url: `${process.env.NEXTAUTH_URL}?payment=cancelled`,
        });

        return NextResponse.json({ sessionId: checkoutSession.id, url: checkoutSession.url });
    } catch (err: any) {
        console.error('Stripe Checkout Error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
