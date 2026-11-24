import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { isAdmin } from '@/lib/admin';
import { getStripe } from '@/lib/stripe';
import { CAMPAIGNS, SALE_EMAILS, SALE_EMAIL_WINDOW_HOURS } from '@/lib/promo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Admin Email stats: what went out (email_log) and, once Resend's webhook is
// connected (/api/resend/events), how much of it was delivered, opened,
// clicked, bounced or marked as spam. Plus the sale emails' schedule and how
// often the sale codes were redeemed in Stripe.

const DAY = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 90;
const MAX_ROWS = 100_000;

type Row = {
  kind: string | null;
  to_email: string;
  sent_at: string;
  delivered_at?: string | null;
  opened_at?: string | null;
  clicked_at?: string | null;
  bounced_at?: string | null;
  complained_at?: string | null;
};
type Agg = { sent: number; delivered: number; opened: number; clicked: number; bounced: number; complained: number };
const empty = (): Agg => ({ sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, complained: 0 });
const add = (a: Agg, r: Row) => {
  a.sent += 1;
  if (r.delivered_at) a.delivered += 1;
  if (r.opened_at) a.opened += 1;
  if (r.clicked_at) a.clicked += 1;
  if (r.bounced_at) a.bounced += 1;
  if (r.complained_at) a.complained += 1;
};

export async function GET() {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!(await isAdmin(me.email))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  const now = Date.now();
  const since = new Date(now - WINDOW_DAYS * DAY).toISOString();

  // Event columns exist once the 20261124_email_events migration has run.
  let migrated = true;
  const rows: Row[] = [];
  for (let from = 0; from < MAX_ROWS; from += 1000) {
    const cols = migrated
      ? 'id, kind, to_email, sent_at, delivered_at, opened_at, clicked_at, bounced_at, complained_at'
      : 'id, kind, to_email, sent_at';
    const { data, error } = await svc.from('email_log').select(cols).gte('sent_at', since).order('id').range(from, from + 999);
    if (error) {
      if (migrated && /column/i.test(error.message)) { migrated = false; rows.length = 0; from = -1000; continue; }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    rows.push(...((data || []) as unknown as Row[]));
    if (!data || data.length < 1000) break;
  }

  const t24 = now - DAY, t7 = now - 7 * DAY, t30 = now - 30 * DAY;
  const totals = { last24h: 0, last7d: 0, last30d: 0, last90d: rows.length };
  const last30 = empty();
  const byKind = new Map<string, Agg & { last7d: number; recipients: Set<string>; lastSent: string }>();
  const daily = new Map<string, number>();
  for (let i = 29; i >= 0; i -= 1) daily.set(new Date(now - i * DAY).toISOString().slice(0, 10), 0);

  for (const r of rows) {
    const t = Date.parse(r.sent_at);
    if (t >= t24) totals.last24h += 1;
    if (t >= t7) totals.last7d += 1;
    if (t >= t30) { totals.last30d += 1; add(last30, r); }
    const day = r.sent_at.slice(0, 10);
    if (daily.has(day)) daily.set(day, (daily.get(day) || 0) + 1);
    const kind = r.kind || 'other';
    let k = byKind.get(kind);
    if (!k) { k = { ...empty(), last7d: 0, recipients: new Set(), lastSent: r.sent_at }; byKind.set(kind, k); }
    add(k, r);
    if (t >= t7) k.last7d += 1;
    k.recipients.add(r.to_email.toLowerCase());
    if (r.sent_at > k.lastSent) k.lastSent = r.sent_at;
  }

  const kinds = [...byKind.entries()]
    .map(([kind, k]) => ({ kind, sent: k.sent, last7d: k.last7d, recipients: k.recipients.size, delivered: k.delivered, opened: k.opened, clicked: k.clicked, bounced: k.bounced, complained: k.complained, lastSent: k.lastSent }))
    .sort((a, b) => b.lastSent.localeCompare(a.lastSent));

  const sale = SALE_EMAILS.map((e) => {
    const k = byKind.get(e.kind);
    const c = CAMPAIGNS.find((x) => x.id === e.campaign);
    const at = e.at ? Date.parse(e.at) : null;
    const status = k?.sent
      ? 'sent'
      : at == null ? 'manual'
        : now < at ? 'scheduled'
          : now < at + SALE_EMAIL_WINDOW_HOURS * 3600_000 && c && now < Date.parse(c.end) ? 'sending'
            : 'missed';
    return { stage: e.stage, kind: e.kind, campaign: c?.name || e.campaign, at: e.at || null, status, sent: k?.sent || 0, opened: k?.opened || 0, clicked: k?.clicked || 0, bounced: k?.bounced || 0, delivered: k?.delivered || 0 };
  });

  // Sale and everyday codes, as Stripe counts them.
  let codes: { code: string; active: boolean; redeemed: number; label: string }[] = [];
  let codesError: string | null = null;
  const stripe = getStripe();
  if (stripe) {
    const want = [...CAMPAIGNS.map((c) => ({ code: c.code, label: c.name })), { code: 'NEW20', label: 'Everyday 20% (paused during sales)' }];
    try {
      codes = await Promise.all(want.map(async (w) => {
        const list = await stripe.promotionCodes.list({ code: w.code, limit: 10 });
        const act = list.data.filter((p) => p.active);
        return { code: w.code, label: w.label, active: act.length > 0, redeemed: list.data.reduce((n, p) => n + (p.times_redeemed || 0), 0) };
      }));
    } catch (err: any) {
      codesError = err?.message || 'Stripe error';
    }
  }

  return NextResponse.json({
    me: me.email,
    windowDays: WINDOW_DAYS,
    tracking: { migrated, receivingEvents: rows.some((r) => r.delivered_at) },
    totals,
    last30,
    daily: [...daily.entries()].map(([day, sent]) => ({ day, sent })),
    kinds,
    sale,
    codes,
    codesError,
    truncated: rows.length >= MAX_ROWS,
  });
}
