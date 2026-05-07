import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getStripe } from '@/lib/stripe';
import { computeAffiliateEarnings, specFromMetadata, PAYOUT_MIN_CENTS } from '@/lib/affiliate-earnings';
import { sendEmail, payoutRequestedTemplate, isResendConfigured, getEmailSiteUrl } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ADMIN_INBOX = process.env.AFFILIATE_NOTIFY_EMAIL || 'marketing@viceseo.com';

// Affiliate creates a new payout request. Server is the source of truth for
// the available balance — never trust the client number. We recompute
// (Stripe lifetime − Σ DB paid+requested) before locking the row in.
export async function POST() {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const meta: any = me.user_metadata || {};
  if (meta.role !== 'affiliate') {
    return NextResponse.json({ error: 'Affiliate access only' }, { status: 403 });
  }

  const code: string = meta.affiliate_code || '';
  const spec = specFromMetadata(meta);
  if (!code) return NextResponse.json({ error: 'No promo code assigned to your account.' }, { status: 400 });

  // Block stacking — one open request at a time keeps the operator's
  // workflow simple and prevents double-counting available balance.
  const { data: pending } = await supabase
    .from('affiliate_payouts')
    .select('id')
    .eq('user_id', me.id)
    .eq('status', 'requested')
    .limit(1);
  if (pending && pending.length > 0) {
    return NextResponse.json({ error: 'You already have a payout request pending. Wait until it is paid before requesting another.' }, { status: 409 });
  }

  const stripe = getStripe();
  if (!stripe) return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });

  // Read all existing payouts (paid + still-requested) to compute available.
  const { data: priorRaw } = await supabase
    .from('affiliate_payouts')
    .select('amount_cents, status');
  const prior = priorRaw || [];
  const paidCents = prior.filter((p) => p.status === 'paid').reduce((s, p) => s + (p.amount_cents || 0), 0);
  const pendingCents = prior.filter((p) => p.status === 'requested').reduce((s, p) => s + (p.amount_cents || 0), 0);

  const earnings = await computeAffiliateEarnings(stripe, code, spec);
  const availableCents = Math.max(0, earnings.totalEarningsCents - paidCents - pendingCents);

  if (availableCents < PAYOUT_MIN_CENTS) {
    return NextResponse.json({
      error: `You need at least $${(PAYOUT_MIN_CENTS / 100).toFixed(0)} available to request a payout. You currently have $${(availableCents / 100).toFixed(2)}.`,
      availableCents,
      minRequestCents: PAYOUT_MIN_CENTS,
    }, { status: 400 });
  }

  // Insert via the user-scoped client so RLS confirms ownership. The
  // affiliate_code + redemptions_count snapshot makes the row auditable
  // even if the user's commission or assigned code changes later.
  const { data: insertRow, error: insertErr } = await supabase
    .from('affiliate_payouts')
    .insert({
      user_id: me.id,
      amount_cents: availableCents,
      status: 'requested',
      affiliate_code: code,
      redemptions_count: earnings.totalRedemptions,
    })
    .select()
    .single();

  if (insertErr || !insertRow) {
    console.error('[affiliate/payouts] insert failed', insertErr?.message);
    return NextResponse.json({ error: insertErr?.message || 'Could not create payout request' }, { status: 500 });
  }

  // Notify the operator. Best-effort — never block the response on email.
  if (isResendConfigured()) {
    try {
      const tpl = payoutRequestedTemplate({
        affiliateName: meta.full_name || meta.name || me.email || 'Affiliate',
        affiliateEmail: me.email || 'unknown',
        amountCents: availableCents,
        code,
        redemptions: earnings.totalRedemptions,
        adminUrl: `${getEmailSiteUrl()}/admin`,
      });
      await sendEmail({
        to: ADMIN_INBOX,
        subject: tpl.subject,
        html: tpl.html,
        replyTo: me.email || undefined,
        kind: 'other',
      });
    } catch (err: any) {
      console.warn('[affiliate/payouts] notify email failed', err?.message);
    }
  }

  return NextResponse.json({ ok: true, payout: insertRow });
}

// List the authed affiliate's own payout history (paid, pending, rejected).
export async function GET() {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data, error } = await supabase
    .from('affiliate_payouts')
    .select('id, amount_cents, status, requested_at, paid_at, rejected_at, reject_reason, affiliate_code, redemptions_count')
    .order('requested_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ payouts: data || [] });
}

