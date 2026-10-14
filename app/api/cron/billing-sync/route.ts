import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { isAdmin } from '@/lib/admin';
import { getStripe } from '@/lib/stripe';
import { listHaulockSubscriptions, paidSubscriptionIds } from '@/lib/billing';
import { planBillingSync, type SyncAction, type SyncUser } from '@/lib/billing-sync';
import { applyUserPlan } from '@/lib/teams';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Daily safety net that keeps Haulock accounts and Stripe in step, for when
// a webhook is missed:
//   - paying in Stripe        → the account gets that plan
//   - subscription ended      → the account moves to Free (hand-granted plans stay)
//   - paying, account deleted → the subscription is canceled
// GET ?dry=1 returns what it would do without changing anything.
//
// Only Vercel Cron (Bearer CRON_SECRET) or a signed-in admin can run it.
// Unlike lib/cron-auth, the x-vercel-cron header alone is not accepted:
// anyone can send that header, and this job can cancel subscriptions.

// Guards against a bad read (e.g. a partial user list) cancelling people.
const MIN_USERS_FOR_CANCELS = 10;
const MAX_CANCELS_PER_RUN = 5;
const MAX_PLAN_CHANGES_PER_RUN = 25;

async function authorize(req: Request): Promise<NextResponse | null> {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') === `Bearer ${secret}`) return null;
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data } = await supabase.auth.getUser();
  if (data?.user?.email && (await isAdmin(data.user.email))) return null;
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function GET(req: Request) {
  const denied = await authorize(req);
  if (denied) return denied;
  const dryRun = new URL(req.url).searchParams.get('dry') === '1';

  const svc = getServiceSupabase();
  const stripe = getStripe();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });
  if (!stripe) return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });

  // Every account. Any failed page aborts the run: acting on a partial list
  // would treat missing accounts as deleted.
  const authUsers: any[] = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await svc.auth.admin.listUsers({ perPage: 1000, page });
    if (error) return NextResponse.json({ error: `listUsers failed: ${error.message}` }, { status: 502 });
    const batch = data?.users || [];
    authUsers.push(...batch);
    if (batch.length < 1000) break;
  }
  const [{ data: adminRows, error: adminErr }, { data: members, error: memberErr }] = await Promise.all([
    svc.from('admins').select('email'),
    svc.from('team_members').select('user_id, role, teams ( plan )'),
  ]);
  if (adminErr || memberErr) return NextResponse.json({ error: (adminErr || memberErr)!.message }, { status: 502 });
  const adminSet = new Set((adminRows || []).map((r: any) => String(r.email).toLowerCase()));
  const teamByUser = new Map<string, { role: 'owner' | 'member'; plan: string }>();
  for (const m of (members || []) as any[]) {
    const t = Array.isArray(m.teams) ? m.teams[0] : m.teams;
    if (t) teamByUser.set(m.user_id, { role: m.role === 'owner' ? 'owner' : 'member', plan: t.plan });
  }
  const users: SyncUser[] = authUsers.map((u) => ({
    id: u.id,
    email: u.email || null,
    metaPlan: u.user_metadata?.plan || null,
    stripeCustomerId: u.user_metadata?.stripe_customer_id || null,
    manualPlan: u.app_metadata?.manual_plan || null,
    team: teamByUser.get(u.id) || null,
    isAdmin: adminSet.has(String(u.email || '').toLowerCase()),
  }));

  let actions: SyncAction[];
  try {
    const { subs } = await listHaulockSubscriptions(stripe, ['data.customer', 'data.latest_invoice']);
    actions = planBillingSync(users, subs, await paidSubscriptionIds(stripe, subs));
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Stripe error' }, { status: 502 });
  }

  const planChanges = actions.filter((a) => a.kind === 'set_plan');
  const cancels = actions.filter((a) => a.kind === 'cancel_orphan');
  const review = actions.filter((a) => a.kind === 'review');
  const held: string[] = [];
  if (planChanges.length > MAX_PLAN_CHANGES_PER_RUN) held.push(`${planChanges.length} plan changes is more than ${MAX_PLAN_CHANGES_PER_RUN}; none applied, run it from the admin page after checking`);
  if (cancels.length > MAX_CANCELS_PER_RUN) held.push(`${cancels.length} cancellations is more than ${MAX_CANCELS_PER_RUN}; none done`);
  if (cancels.length && users.length < MIN_USERS_FOR_CANCELS) held.push(`only ${users.length} accounts read; cancellations skipped`);

  const done: string[] = [];
  const errors: string[] = [];
  if (!dryRun) {
    if (planChanges.length <= MAX_PLAN_CHANGES_PER_RUN) {
      for (const a of planChanges) {
        if (a.kind !== 'set_plan') continue;
        try {
          await applyUserPlan(a.userId, a.to);
          done.push(`${a.email || a.userId}: ${a.from} → ${a.to} (${a.reason})`);
        } catch (e: any) { errors.push(`${a.email || a.userId}: ${e?.message}`); }
      }
    }
    if (cancels.length <= MAX_CANCELS_PER_RUN && users.length >= MIN_USERS_FOR_CANCELS) {
      for (const a of cancels) {
        if (a.kind !== 'cancel_orphan') continue;
        try {
          // Re-check right before cancelling: the account really is gone, and
          // the subscription is still a live Haulock one.
          const { data: still, error: getErr } = await svc.auth.admin.getUserById(a.taggedUserId);
          if (still?.user) { errors.push(`${a.subscriptionId}: account ${a.taggedUserId} exists; not canceled`); continue; }
          if (getErr && (getErr as any).status !== 404) throw getErr;
          const s = await stripe.subscriptions.retrieve(a.subscriptionId);
          if (s.metadata?.product !== 'haulock' || !['active', 'trialing', 'past_due', 'unpaid'].includes(s.status)) continue;
          await stripe.subscriptions.cancel(a.subscriptionId);
          done.push(`${a.customerEmail || a.subscriptionId}: canceled ${a.plan || ''} subscription (${a.reason})`);
        } catch (e: any) { errors.push(`${a.subscriptionId}: ${e?.message}`); }
      }
    }
  }

  const summary = { dryRun, accounts: users.length, actions, done, held, review, errors };
  console.log('[billing-sync]', JSON.stringify({ dryRun, planned: actions.length, done: done.length, held, errors }));
  return NextResponse.json(summary);
}
