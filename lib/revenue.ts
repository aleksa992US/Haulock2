import { planFromPriceId } from './stripe';

// Revenue math for the admin Revenue card, kept pure so it can be tested
// without Stripe. Input: paid invoices as returned by the API pinned in
// lib/stripe.ts (2025-01-27.acacia), with charge.balance_transaction expanded.

export type RevenueTotals = { gross: number; refunded: number; fees: number; net: number; invoices: number };
export const emptyTotals = (): RevenueTotals => ({ gross: 0, refunded: 0, fees: 0, net: 0, invoices: 0 });

// The Stripe account is shared with other products: count an invoice only
// when it's for a Haulock subscription or a Haulock price.
export function isHaulockInvoice(inv: any): boolean {
  if (inv?.subscription_details?.metadata?.product === 'haulock') return true;
  const lines: any[] = inv?.lines?.data || [];
  return lines.some((l) => planFromPriceId(l?.price?.id || l?.plan?.id || null));
}

export function addInvoice(byMonth: Map<string, RevenueTotals>, allTime: RevenueTotals, inv: any): boolean {
  if (!isHaulockInvoice(inv)) return false;
  const paid = Number(inv.amount_paid) || 0;
  if (paid <= 0) return false;
  const charge: any = inv.charge && typeof inv.charge === 'object' ? inv.charge : null;
  const refunded = Math.min(paid, Number(charge?.amount_refunded) || 0);
  const fee = Number(charge?.balance_transaction?.fee) || 0;
  const paidAt = Number(inv.status_transitions?.paid_at) || Number(inv.created);
  const d = new Date(paidAt * 1000);
  const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const m = byMonth.get(key) || emptyTotals();
  for (const t of [allTime, m]) {
    t.gross += paid; t.refunded += refunded; t.fees += fee; t.net += paid - refunded - fee; t.invoices += 1;
  }
  byMonth.set(key, m);
  return true;
}

export function summarizeRevenue(byMonth: Map<string, RevenueTotals>, allTime: RevenueTotals, now: Date = new Date()) {
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (11 - i), 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    return { month: key, label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }), ...(byMonth.get(key) || emptyTotals()) };
  });
  const year = String(now.getUTCFullYear());
  const ytd = emptyTotals();
  for (const [k, t] of Array.from(byMonth.entries())) {
    if (!k.startsWith(year)) continue;
    ytd.gross += t.gross; ytd.refunded += t.refunded; ytd.fees += t.fees; ytd.net += t.net; ytd.invoices += t.invoices;
  }
  return {
    currency: 'usd',
    allTime,
    thisMonth: byMonth.get(months[11].month) || emptyTotals(),
    lastMonth: byMonth.get(months[10].month) || emptyTotals(),
    yearToDate: ytd,
    months,
    firstMonth: Array.from(byMonth.keys()).sort()[0] || null,
  };
}
