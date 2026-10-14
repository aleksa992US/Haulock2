import type Stripe from 'stripe';
import { getPlan } from './plans';
import { customerIdOf, isLiveSubscription, subscriptionPlan, summarizeBilling } from './billing';

// Keeping Haulock accounts and Stripe subscriptions in step. Pure: decides
// what should change; app/api/cron/billing-sync makes the changes.

export type SyncUser = {
  id: string;
  email: string | null;
  metaPlan: string | null;            // user_metadata.plan
  stripeCustomerId: string | null;    // user_metadata.stripe_customer_id
  manualPlan: string | null;          // app_metadata.manual_plan (granted by an admin)
  team: { role: 'owner' | 'member'; plan: string } | null;
  isAdmin: boolean;
};

export type SyncAction =
  // Make the account's plan match what Stripe says they pay for.
  | { kind: 'set_plan'; userId: string; email: string | null; from: string; to: string; reason: string }
  // A live subscription whose Haulock account was deleted: stop charging.
  | { kind: 'cancel_orphan'; subscriptionId: string; taggedUserId: string; customerEmail: string | null; plan: string | null; reason: string }
  // Needs a human: e.g. a live subscription we can't tie to any account.
  | { kind: 'review'; subscriptionId: string; customerEmail: string | null; reason: string };

// Which account each Haulock subscription belongs to: the user_id we tag on
// it, else the account that stored its Stripe customer id, else the account
// with the customer's email (an account deleted and signed up again).
export function groupSubscriptionsByUser(
  subs: Stripe.Subscription[],
  users: { id: string; email: string | null; stripeCustomerId: string | null }[],
): { byUser: Map<string, Stripe.Subscription[]>; unmatched: Stripe.Subscription[] } {
  const known = new Set(users.map((u) => u.id));
  const byCustomer = new Map<string, string>();
  const byEmail = new Map<string, string>();
  for (const u of users) {
    if (u.stripeCustomerId) byCustomer.set(u.stripeCustomerId, u.id);
    if (u.email) byEmail.set(u.email.toLowerCase(), u.id);
  }
  const byUser = new Map<string, Stripe.Subscription[]>();
  const unmatched: Stripe.Subscription[] = [];
  for (const s of subs) {
    const tagged = s.metadata?.user_id;
    const custEmail = (s.customer as any)?.email;
    const uid = (tagged && known.has(tagged) ? tagged : null)
      || byCustomer.get(customerIdOf(s) || '')
      || (custEmail ? byEmail.get(String(custEmail).toLowerCase()) : undefined);
    if (uid) byUser.set(uid, [...(byUser.get(uid) || []), s]);
    else unmatched.push(s);
  }
  return { byUser, unmatched };
}

export function planBillingSync(users: SyncUser[], subs: Stripe.Subscription[], paidIds: Set<string>): SyncAction[] {
  const actions: SyncAction[] = [];
  const { byUser, unmatched } = groupSubscriptionsByUser(subs, users);

  for (const u of users) {
    // Admins have unlimited access; team members get the owner's plan.
    if (u.isAdmin || u.team?.role === 'member') continue;
    const current = getPlan(u.team?.role === 'owner' ? u.team.plan : u.metaPlan).id;
    // A plan an admin granted by hand stays as it is.
    if (u.manualPlan && u.manualPlan === current) continue;
    const b = summarizeBilling(byUser.get(u.id) || [], paidIds);
    if (b.status === 'paying' || b.status === 'canceling' || b.status === 'past_due') {
      if (current !== b.expectedPlan) {
        actions.push({ kind: 'set_plan', userId: u.id, email: u.email, from: current, to: b.expectedPlan, reason: `Paying for ${getPlan(b.expectedPlan).label} in Stripe` });
      }
    } else if (b.status === 'canceled' && current !== 'free') {
      // Only accounts whose real subscription ended. A paid plan with no
      // Stripe history at all is left for an admin to judge.
      actions.push({ kind: 'set_plan', userId: u.id, email: u.email, from: current, to: 'free', reason: 'Stripe subscription ended' });
    }
  }

  for (const s of unmatched) {
    if (!paidIds.has(s.id) || !isLiveSubscription(s)) continue;
    const customerEmail = (s.customer as any)?.email ?? null;
    const tagged = s.metadata?.user_id;
    if (tagged) {
      actions.push({ kind: 'cancel_orphan', subscriptionId: s.id, taggedUserId: tagged, customerEmail, plan: subscriptionPlan(s), reason: 'Haulock account was deleted' });
    } else {
      actions.push({ kind: 'review', subscriptionId: s.id, customerEmail, reason: 'Live subscription not tied to any account' });
    }
  }
  return actions;
}
