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

const EXIT_OFFER_CODE = 'NEW20';
const EXIT_OFFER_KEY = 'haulock_exit_offer_seen';

export default function CheckoutPage() {
  const params = useParams<{ plan: string }>();
  const search = useSearchParams();
  const billing: Billing = (search.get('billing') === 'annual' ? 'annual' : 'monthly');

  const planId = (params?.plan || '').toLowerCase() as PlanId;
  const plan = PLANS[planId];

  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [promoCode, setPromoCode] = useState('');
  const [appliedCode, setAppliedCode] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [showExitOffer, setShowExitOffer] = useState(false);
  const [claimingExitOffer, setClaimingExitOffer] = useState(false);
  const [totals, setTotals] = useState<{
    currency: string;
    subtotal: number | null;
    discount: number;
    tax: number;
    total: number | null;
  } | null>(null);

  const createSubscription = async (code: string | null) => {
    setLoading(true); setError(null); setClientSecret(null);
    try {
      const r = await fetch('/api/stripe/create-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: plan!.id, billing, ...(code ? { promoCode: code } : {}) }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `Checkout init failed (${r.status})`);
      if (j.totals) setTotals(j.totals);
      // 100%-off coupon — subscription already active, no card needed.
      if (j.noPaymentNeeded) {
        window.location.href = `/settings?checkout=success&promo=${encodeURIComponent(code || '')}`;
        return;
      }
      setClientSecret(j.clientSecret);
      if (code) setAppliedCode(code); else setAppliedCode(null);
    } catch (err: any) {
      setError(err?.message || 'Checkout init failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!plan || plan.id === 'free') {
      setError('Choose a paid plan to continue.');
      setLoading(false);
      return;
    }
    createSubscription(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, billing]);

  const applyPromo = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = promoCode.trim();
    if (!code) return;
    setApplying(true);
    await createSubscription(code);
    setApplying(false);
  };

  const removePromo = async () => {
    setPromoCode('');
    setAppliedCode(null);
    await createSubscription(null);
  };

  // Fire-and-forget telemetry for the admin "exit intent" stats card.
  // Failures must never block checkout, so we swallow everything.
  const logExitEvent = (kind: 'shown' | 'claimed' | 'dismissed') => {
    try {
      fetch('/api/analytics/exit-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, plan: planId, billing }),
        keepalive: true,
      }).catch(() => null);
    } catch { /* ignore */ }
  };

  const claimExitOffer = async () => {
    if (claimingExitOffer || appliedCode) return;
    setClaimingExitOffer(true);
    setShowExitOffer(false);
    logExitEvent('claimed');
    try {
      sessionStorage.setItem(EXIT_OFFER_KEY, '1');
    } catch { /* sessionStorage may be unavailable */ }
    await createSubscription(EXIT_OFFER_CODE);
    setPromoCode(EXIT_OFFER_CODE);
    setClaimingExitOffer(false);
  };

  const dismissExitOffer = () => {
    setShowExitOffer(false);
    logExitEvent('dismissed');
    try {
      sessionStorage.setItem(EXIT_OFFER_KEY, '1');
    } catch { /* ignore */ }
  };

  // Exit-intent triggers — fire only while the Payment Element is mounted
  // (we have a clientSecret), no code is already applied, and we haven't
  // shown the offer in this session yet. Three triggers:
  //   1. Desktop: mouse leaves the viewport via the top edge.
  //   2. Mobile/desktop: pagehide / visibility change (back button, tab switch).
  //   3. Idle fallback: 30s on the page with no interaction.
  useEffect(() => {
    if (!clientSecret || appliedCode) return;
    try {
      if (sessionStorage.getItem(EXIT_OFFER_KEY) === '1') return;
    } catch { /* ignore */ }

    let fired = false;
    const fire = () => {
      if (fired) return;
      fired = true;
      setShowExitOffer(true);
      logExitEvent('shown');
    };

    const onMouseOut = (e: MouseEvent) => {
      // Mouse left the viewport via the top — classic exit intent.
      if (e.clientY <= 0 && (!e.relatedTarget && !(e as any).toElement)) fire();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') fire();
    };
    const idleTimer = window.setTimeout(fire, 30_000);
    const resetIdle = () => {
      window.clearTimeout(idleTimer);
    };

    document.addEventListener('mouseout', onMouseOut);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', fire);
    document.addEventListener('mousemove', resetIdle, { once: true });
    document.addEventListener('keydown', resetIdle, { once: true });
    document.addEventListener('touchstart', resetIdle, { once: true });

    return () => {
      window.clearTimeout(idleTimer);
      document.removeEventListener('mouseout', onMouseOut);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', fire);
      document.removeEventListener('mousemove', resetIdle);
      document.removeEventListener('keydown', resetIdle);
      document.removeEventListener('touchstart', resetIdle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientSecret, appliedCode]);

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

  const fmtMoney = (cents: number, currency = 'USD') =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
  const hasDiscount = totals && totals.discount > 0;
  const actualTotal = totals?.total != null ? fmtMoney(totals.total, totals.currency) : null;

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
                <CheckoutForm plan={plan.label} price={price} billing={billing} actualTotal={actualTotal} />
              </Elements>
            )}
          </div>

          <aside className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-6 card-shadow">
            <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/55 mb-2">Order summary</div>
            <div className="text-2xl font-semibold mb-1">Haulock {plan.label}</div>
            <div className="text-sm text-[#0B1E3F]/65 mb-4">{plan.desc}</div>
            <div className="flex items-baseline gap-1 mb-1">
              <div className={`text-4xl serif italic ${hasDiscount ? 'text-[#0B1E3F]/40 line-through decoration-2' : 'text-[#0B1E3F]'}`}>{price}</div>
              <div className={`${hasDiscount ? 'text-[#0B1E3F]/40 line-through' : 'text-[#0B1E3F]/60'}`}>{priceSuffix}</div>
            </div>
            {hasDiscount && totals && (
              <div className="space-y-1 mb-4 text-sm">
                <div className="flex justify-between text-[#0B1E3F]/70">
                  <span>Subtotal</span>
                  <span>{fmtMoney(totals.subtotal || 0, totals.currency)}</span>
                </div>
                <div className="flex justify-between text-[#16A34A]">
                  <span>Discount ({appliedCode})</span>
                  <span>−{fmtMoney(totals.discount, totals.currency)}</span>
                </div>
                {totals.tax > 0 && (
                  <div className="flex justify-between text-[#0B1E3F]/70">
                    <span>Tax</span>
                    <span>{fmtMoney(totals.tax, totals.currency)}</span>
                  </div>
                )}
                <div className="flex justify-between pt-2 mt-2 border-t border-[#0B1E3F]/10 font-semibold text-[#0B1E3F]">
                  <span>Total due today</span>
                  <span className="text-lg">{actualTotal}</span>
                </div>
              </div>
            )}
            {!hasDiscount && billing === 'monthly' && plan.priceAnnualNum > 0 && (
              <div className="text-xs mono text-[#16A34A] mb-4">Save {Math.round((1 - plan.priceAnnualNum / (plan.priceNum * 12)) * 100)}% with annual → <a href={`/checkout/${plan.id}?billing=annual`} className="underline">{plan.priceAnnual}/yr</a></div>
            )}

            <div className="pt-4 mt-4 border-t border-[#0B1E3F]/10">
              {appliedCode ? (
                <div className="flex items-center justify-between gap-2 p-3 bg-[#16A34A]/10 border border-[#16A34A]/30 rounded-lg">
                  <div className="text-sm text-[#0B1E3F]">
                    <span className="text-xs mono uppercase tracking-wider text-[#16A34A] mr-2">Code applied</span>
                    <span className="font-semibold">{appliedCode}</span>
                  </div>
                  <button type="button" onClick={removePromo} className="text-xs text-[#0B1E3F]/60 hover:text-[#DC2626] transition">Remove</button>
                </div>
              ) : (
                <form onSubmit={applyPromo}>
                  <label className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/55 block mb-2">Promo code <span className="normal-case tracking-normal text-[#0B1E3F]/40">(optional)</span></label>
                  <div className="flex gap-2">
                    <input
                      value={promoCode}
                      onChange={(e) => setPromoCode(e.target.value)}
                      placeholder="TESTFREE"
                      className="flex-1 px-3 py-2 bg-white border border-[#0B1E3F]/15 rounded-lg text-sm focus:outline-none focus:border-[#0B1E3F] text-[#0B1E3F] placeholder:text-[#0B1E3F]/30"
                    />
                    <button type="submit" disabled={!promoCode.trim() || applying} className="px-3 py-2 bg-[#0B1E3F] text-white rounded-lg text-xs font-medium hover:bg-[#0B1E3F]/90 transition disabled:opacity-50">
                      {applying ? '…' : 'Apply'}
                    </button>
                  </div>
                </form>
              )}
            </div>

            <div className="pt-4 mt-4 border-t border-[#0B1E3F]/10 space-y-1.5">
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
      {showExitOffer && (
        <ExitOfferModal
          planLabel={plan.label}
          price={price}
          priceSuffix={priceSuffix}
          claiming={claimingExitOffer}
          onClaim={claimExitOffer}
          onDismiss={dismissExitOffer}
        />
      )}
    </div>
  );
}

function ExitOfferModal({
  planLabel,
  price,
  priceSuffix,
  claiming,
  onClaim,
  onDismiss,
}: {
  planLabel: string;
  price: string;
  priceSuffix: string;
  claiming: boolean;
  onClaim: () => void;
  onDismiss: () => void;
}) {
  // Lock body scroll while the modal is open and close on Escape.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [onDismiss]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-4 animate-[fadeIn_0.2s_ease-out]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="exit-offer-title"
    >
      <style jsx>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes popIn { from { opacity: 0; transform: scale(0.94) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }
      `}</style>
      <button
        type="button"
        aria-label="Close offer"
        onClick={onDismiss}
        className="absolute inset-0 bg-[#0B1E3F]/55 backdrop-blur-sm"
      />
      <div
        className="relative w-full max-w-md bg-white rounded-3xl card-shadow border border-[#0B1E3F]/10 overflow-hidden"
        style={{ animation: 'popIn 0.28s cubic-bezier(0.22, 1, 0.36, 1)' }}
      >
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Close"
          className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-[#0B1E3F]/5 hover:bg-[#0B1E3F]/10 text-[#0B1E3F]/55 hover:text-[#0B1E3F] flex items-center justify-center transition"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1L13 13M13 1L1 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
        </button>

        <div className="px-8 pt-10 pb-2 text-center">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#FF6B35]/10 text-[#FF6B35] text-[11px] mono uppercase tracking-[0.18em] font-semibold mb-5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#FF6B35] animate-pulse" />
            Wait — one second
          </div>
          <h2 id="exit-offer-title" className="text-3xl md:text-4xl serif italic text-[#0B1E3F] leading-tight mb-3">
            Take 20% off your first month.
          </h2>
          <p className="text-[15px] text-[#0B1E3F]/65 leading-relaxed mb-6 max-w-sm mx-auto">
            Try Haulock {planLabel} risk-free. Cancel anytime — but most carriers stay after their first flagged broker.
          </p>
        </div>

        <div className="px-8 pb-6">
          <div className="bg-gradient-to-br from-[#0B1E3F] to-[#0B1E3F]/90 rounded-2xl p-5 text-white">
            <div className="flex items-baseline justify-between mb-1">
              <div className="text-xs mono uppercase tracking-wider text-white/55">Your price today</div>
              <div className="text-[11px] mono uppercase tracking-wider text-[#FF6B35] bg-white/10 px-2 py-0.5 rounded-full">Code NEW20</div>
            </div>
            <div className="flex items-baseline gap-3 mt-1">
              <div className="text-[15px] text-white/45 line-through">{price}{priceSuffix}</div>
              <div className="text-3xl serif italic text-white">{discountedPriceLabel(price)}<span className="text-base text-white/60">{priceSuffix}</span></div>
            </div>
            <div className="text-[13px] text-white/60 mt-2 leading-relaxed">
              First month only. Renews at <span className="text-white/85">{price}{priceSuffix}</span>. One-time use per account.
            </div>
          </div>
        </div>

        <div className="px-8 pb-8 space-y-3">
          <button
            type="button"
            onClick={onClaim}
            disabled={claiming}
            className="w-full py-4 bg-[#FF6B35] text-white rounded-full font-semibold text-[15px] hover:bg-[#FF6B35]/92 transition disabled:opacity-60 flex items-center justify-center gap-2 shadow-[0_8px_24px_-8px_rgba(255,107,53,0.6)]"
          >
            {claiming && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            {claiming ? 'Applying NEW20…' : 'Apply 20% off → keep checking out'}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="w-full py-2.5 text-[13px] text-[#0B1E3F]/55 hover:text-[#0B1E3F] transition"
          >
            No thanks, I&rsquo;ll pay full price
          </button>
        </div>
      </div>
    </div>
  );
}

// Best-effort 20%-off label for the modal headline. We don't have invoice
// totals yet at modal-open time (those arrive only after createSubscription),
// so we shave 20% off the displayed plan price string. If the price isn't a
// simple "$NN" we fall back to the original label.
function discountedPriceLabel(price: string): string {
  const m = price.match(/^\$(\d+(?:\.\d+)?)/);
  if (!m) return price;
  const v = Number(m[1]);
  if (!Number.isFinite(v)) return price;
  const cut = v * 0.8;
  const formatted = cut % 1 === 0 ? `$${cut.toFixed(0)}` : `$${cut.toFixed(2)}`;
  return formatted;
}

function CheckoutForm({ plan, price, billing, actualTotal }: { plan: string; price: string; billing: Billing; actualTotal?: string | null }) {
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
        {submitting ? 'Processing…' : `Subscribe · ${actualTotal ? `${actualTotal} today` : `${price}${billing === 'annual' ? '/yr' : '/mo'}`}`}
      </button>
      <div className="text-xs text-[#0B1E3F]/50 text-center">
        Secure payment · Powered by Stripe · {actualTotal ? `You'll be charged ${actualTotal} today` : `You'll be charged ${price}${billing === 'annual' ? ' per year' : ' per month'} by Haulock`}. Cancel anytime.
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
