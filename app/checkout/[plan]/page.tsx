'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { PLANS, type PlanId } from '@/lib/plans';

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
let stripePromise: Promise<Stripe | null> | null = null;
function getStripePromise() {
  if (!stripePromise) stripePromise = publishableKey ? loadStripe(publishableKey) : Promise.resolve(null);
  return stripePromise;
}

type Billing = 'monthly' | 'annual';

export default function CheckoutPage() {
  const params = useParams<{ plan: string }>();
  const search = useSearchParams();
  const billing: Billing = (search.get('billing') === 'annual' ? 'annual' : 'monthly');

  const planId = (params?.plan || '').toLowerCase() as PlanId;
  const plan = PLANS[planId];

  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!plan || plan.id === 'free') {
      setError('Choose a paid plan to continue.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/stripe/create-subscription', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan: plan.id, billing }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || `Checkout init failed (${r.status})`);
        if (!cancelled) {
          setClientSecret(j.clientSecret);
          setLoading(false);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || 'Checkout init failed');
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [plan, billing]);

  const appearance = useMemo(() => ({
    theme: 'flat' as const,
    variables: {
      colorPrimary: '#0B1E3F',
      colorBackground: '#ffffff',
      colorText: '#0B1E3F',
      colorDanger: '#DC2626',
      fontFamily: 'Instrument Sans, system-ui, -apple-system, sans-serif',
      borderRadius: '12px',
      spacingUnit: '4px',
    },
    rules: {
      '.Input': { border: '1px solid rgba(11,30,63,0.15)', boxShadow: 'none' },
      '.Input:focus': { border: '1px solid #0B1E3F', boxShadow: 'none' },
    },
  }), []);

  if (!publishableKey) {
    return <ErrorShell title="Stripe not configured" body="NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is missing. Set it in .env.local and restart the dev server." />;
  }

  if (!plan || plan.id === 'free') {
    return <ErrorShell title="Unknown plan" body="Pick a plan from the pricing page to continue." backHref="/plan" backLabel="See plans" />;
  }

  const price = billing === 'annual' ? plan.priceAnnual : plan.price;
  const priceSuffix = billing === 'annual' ? '/yr' : '/mo';

  return (
    <div className="min-h-screen bg-[#F5F3EE] text-[#0B1E3F]">
      <div className="max-w-5xl mx-auto px-6 py-12">
        <div className="mb-8 flex items-center justify-between">
          <Link href="/plan" className="text-sm text-[#0B1E3F]/60 hover:text-[#0B1E3F]">&larr; Back to plans</Link>
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#FF6B35] text-white font-bold flex items-center justify-center">H</div>
            <span className="font-semibold">Haulock</span>
          </Link>
        </div>

        <div className="grid lg:grid-cols-[1fr_420px] gap-10 items-start">
          <div>
            <div className="text-xs mono uppercase tracking-[0.2em] text-[#FF6B35] mb-3">— Subscribe</div>
            <h1 className="text-4xl md:text-5xl serif italic text-[#0B1E3F] mb-3">Start your {plan.label} plan.</h1>
            <p className="text-[#0B1E3F]/65 mb-8 max-w-lg">
              Billed by Haulock. Cancel anytime from Settings. Your card will show <span className="mono">HAULOCK</span> on the statement.
            </p>

            {error && (
              <div className="mb-6 p-4 bg-[#DC2626]/10 border border-[#DC2626]/30 rounded-xl text-sm text-[#0B1E3F]">
                {error}
              </div>
            )}

            {loading && (
              <div className="p-10 bg-white rounded-2xl border border-[#0B1E3F]/10 text-center text-sm text-[#0B1E3F]/55">
                Preparing secure checkout…
              </div>
            )}

            {clientSecret && (
              <Elements stripe={getStripePromise()} options={{ clientSecret, appearance }}>
                <CheckoutForm plan={plan.label} price={price} billing={billing} />
              </Elements>
            )}
          </div>

          <aside className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-6 card-shadow">
            <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/55 mb-2">Order summary</div>
            <div className="text-2xl font-semibold mb-1">Haulock {plan.label}</div>
            <div className="text-sm text-[#0B1E3F]/65 mb-4">{plan.desc}</div>
            <div className="flex items-baseline gap-1 mb-4">
              <div className="text-4xl serif italic text-[#0B1E3F]">{price}</div>
              <div className="text-[#0B1E3F]/60">{priceSuffix}</div>
            </div>
            {billing === 'monthly' && plan.priceAnnualNum > 0 && (
              <div className="text-xs mono text-[#16A34A] mb-4">Save {Math.round((1 - plan.priceAnnualNum / (plan.priceNum * 12)) * 100)}% with annual → <a href={`/checkout/${plan.id}?billing=annual`} className="underline">{plan.priceAnnual}/yr</a></div>
            )}
            <div className="pt-4 border-t border-[#0B1E3F]/10 space-y-1.5">
              {plan.features.slice(0, 5).map((f, i) => (
                <div key={i} className="text-sm text-[#0B1E3F]/75 flex items-start gap-2">
                  <span className="mt-1 w-1.5 h-1.5 rounded-full bg-[#16A34A] flex-shrink-0" />
                  {f}
                </div>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function CheckoutForm({ plan, price, billing }: { plan: string; price: string; billing: Billing }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true); setError(null);

    const { error: submitError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/settings?checkout=success`,
      },
    });

    if (submitError) {
      setError(submitError.message || 'Payment failed.');
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 bg-white rounded-2xl border border-[#0B1E3F]/10 p-6 card-shadow">
      <PaymentElement options={{ layout: 'tabs' }} />
      {error && <div className="text-sm text-[#DC2626]">{error}</div>}
      <button
        type="submit"
        disabled={!stripe || !elements || submitting}
        className="w-full py-3.5 bg-[#0B1E3F] text-white rounded-full font-medium hover:bg-[#0B1E3F]/90 transition disabled:opacity-60 flex items-center justify-center gap-2"
      >
        {submitting && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
        {submitting ? 'Processing…' : `Subscribe · ${price}${billing === 'annual' ? '/yr' : '/mo'}`}
      </button>
      <div className="text-xs text-[#0B1E3F]/50 text-center">
        Secure payment · Powered by Stripe · You&apos;ll be charged {price}{billing === 'annual' ? ' per year' : ' per month'} by Haulock. Cancel anytime.
      </div>
    </form>
  );
}

function ErrorShell({ title, body, backHref, backLabel }: { title: string; body: string; backHref?: string; backLabel?: string }) {
  return (
    <div className="min-h-screen bg-[#F5F3EE] text-[#0B1E3F] flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-2xl border border-[#0B1E3F]/10 p-8 card-shadow text-center">
        <div className="text-xs mono uppercase tracking-wider text-[#DC2626] mb-2">Error</div>
        <h1 className="text-2xl font-semibold mb-2">{title}</h1>
        <p className="text-sm text-[#0B1E3F]/65 mb-6">{body}</p>
        {backHref && <Link href={backHref} className="px-5 py-2.5 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90 inline-block">{backLabel || 'Go back'}</Link>}
      </div>
    </div>
  );
}
