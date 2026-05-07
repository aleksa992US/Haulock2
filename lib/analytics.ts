// Thin wrapper around gtag() so we get a single, type-safe surface for
// every analytics call in the app. Every helper is safe to invoke on the
// server (no-op) and safe to invoke before gtag.js has loaded (queues into
// dataLayer the same way Google's snippet does).
//
// Why a wrapper exists at all:
//   1. We never want a missing GA tag to crash a render. `track()` swallows.
//   2. We want one call site per logical action so adding Mixpanel /
//      PostHog / Amplitude later is a one-file refactor, not a search.
//   3. We use a stable event-name vocabulary (see EventName below) so the
//      GA4 dashboard doesn't fill up with typos like 'sign_up' AND 'signup'.

declare global {
  interface Window {
    gtag?: (command: string, ...args: any[]) => void;
    dataLayer?: any[];
  }
}

// Canonical event names. Keep this list short and meaningful — every entry
// here will become a row in GA4 → Reports → Events. Don't add events for
// every button; add them for state transitions that mean something for
// the business (signup, conversion, paid action, retention signal).
export type EventName =
  | 'signup_complete'
  | 'login'
  | 'logout'
  | 'verify_completed'
  | 'rate_con_uploaded'
  | 'pdf_forensics_scanned'
  | 'report_shared_email'
  | 'report_exported_pdf'
  | 'watchlist_added'
  | 'newsletter_subscribed'
  | 'support_ticket_created'
  | 'subscription_started'
  | 'plan_changed';

function gtag(...args: any[]): void {
  if (typeof window === 'undefined') return;
  // dataLayer is created by Google's loader. If it doesn't exist yet, the
  // script is still loading — fall back to manual queue so events fired
  // during early hydration aren't lost.
  if (typeof window.gtag === 'function') {
    (window.gtag as any)(...args);
  } else {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(args);
  }
}

// Track a logical event. Properties are flattened into GA4 event params —
// keep keys snake_case (GA convention) and values primitive.
export function track(event: EventName, properties: Record<string, string | number | boolean | undefined | null> = {}): void {
  if (typeof window === 'undefined') return;
  // Strip undefined/null so GA doesn't store empty params.
  const clean: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(properties)) {
    if (v === undefined || v === null) continue;
    clean[k] = v as any;
  }
  try { gtag('event', event, clean); } catch { /* analytics never throws */ }
}

// Set the User-ID on the current GA4 session. Call this on login so cross-
// device sessions can be stitched together in GA4 → User attributes →
// User-ID coverage. We pass the Supabase user id (UUID, no PII).
export function identify(userId: string | null | undefined): void {
  if (typeof window === 'undefined') return;
  const id = (userId || '').trim();
  try {
    if (id) gtag('set', { user_id: id });
    else gtag('set', { user_id: null });
  } catch { /* analytics never throws */ }
}

// Helper for purchases (subscription_started). GA4 has special handling
// for `value` + `currency` so revenue reports work — keep this helper
// distinct so callers can't forget the currency.
export function trackPurchase(args: {
  transaction_id: string;
  value: number;        // dollars (not cents)
  currency: string;     // ISO 4217, e.g. 'USD'
  plan: string;
  billing?: 'monthly' | 'annual';
}): void {
  track('subscription_started', {
    transaction_id: args.transaction_id,
    value: args.value,
    currency: args.currency,
    plan: args.plan,
    billing: args.billing || 'monthly',
  });
}
