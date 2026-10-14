// What a looked-up company IS, and what to tell the user about it. Shared
// by the report page, the PDF and the emails so the advice never disagrees
// between them. A broker gives you a load (you decide whether to book it);
// a carrier hauls your load (you decide whether to tender to it).

export type AuthorityFields = {
  commonAuthority?: string;
  contractAuthority?: string;
  brokerAuthority?: string;
  authorityStatus?: string;
  // When present, lets low-risk wording say "clean record" only when
  // nothing at all added to the score.
  flags?: any[];
};

export type EntityRole = 'carrier' | 'broker' | 'both' | 'none';

export function entityRole(r: AuthorityFields): EntityRole {
  const carrier = r.commonAuthority === 'Active' || r.contractAuthority === 'Active';
  const broker = r.brokerAuthority === 'Active';
  if (carrier && broker) return 'both';
  if (carrier) return 'carrier';
  if (broker) return 'broker';
  // No per-role statuses at all (fallback data): trust the overall status.
  if (!r.commonAuthority && !r.contractAuthority && !r.brokerAuthority && r.authorityStatus === 'Active') return 'carrier';
  return 'none';
}

// "carrier" / "broker" / "company" for use in sentences.
export function roleNoun(r: AuthorityFields): string {
  const role = entityRole(r);
  return role === 'carrier' ? 'carrier' : role === 'broker' ? 'broker' : 'company';
}

// "Active", "Active (contract)", "Not authorized", … for the carrier role.
export function carrierAuthorityLabel(r: AuthorityFields): string {
  if (r.commonAuthority === 'Active' || r.contractAuthority === 'Active') {
    if (r.commonAuthority === 'Active' && r.contractAuthority === 'Active') return 'Active (common & contract)';
    return r.contractAuthority === 'Active' ? 'Active (contract)' : 'Active';
  }
  return r.commonAuthority || r.contractAuthority || (r.brokerAuthority ? 'Not authorized' : r.authorityStatus) || '—';
}

export function recommendationFor(r: AuthorityFields, verdict: string): { headline: string; detail: string } {
  const role = entityRole(r);
  const high = verdict === 'high';
  const medium = verdict === 'medium';
  const minor = Array.isArray(r.flags) && r.flags.some((f) => (Number(f?.pts) || 0) > 0);
  const lowLead = minor ? 'No major red flags, only minor findings (listed below).' : 'Clean record: nothing added to the risk score.';
  if (role === 'carrier') {
    if (high) return { headline: 'Don’t tender to this carrier yet.', detail: 'Multiple serious red flags. Before you hand off a load, confirm who you’re dealing with by calling a number you look up yourself, and confirm insurance directly with the insurer.' };
    if (medium) return { headline: 'Proceed with caution.', detail: 'This carrier shows some risk signals. Review the red flags, confirm their insurance is active, and confirm identity by calling a number you look up yourself before you tender.' };
    return { headline: 'Looks safe to tender.', detail: `${lowLead} As always, confirm insurance is current before you hand off the load.` };
  }
  if (role === 'broker') {
    if (high) return { headline: 'Do not book this load.', detail: 'Multiple serious red flags. If you must proceed, require full payment upfront and confirm identity through an independent channel.' };
    if (medium) return { headline: 'Proceed with caution.', detail: 'This broker shows some risk signals. Check that the rate con details match FMCSA records and confirm identity independently.' };
    return { headline: 'Safe to book.', detail: `${lowLead} Standard payment terms are appropriate.` };
  }
  if (role === 'none') {
    return { headline: high ? 'Do not do business with this company.' : 'Proceed with caution.', detail: 'This company has no active FMCSA operating authority, so it can’t legally broker or haul interstate freight right now. Confirm its authority before booking or tendering anything.' };
  }
  if (high) return { headline: 'Don’t book or tender yet.', detail: 'Multiple serious red flags. Whether they’re brokering a load to you or hauling one for you, confirm identity through an independent channel first.' };
  if (medium) return { headline: 'Proceed with caution.', detail: 'This company holds both carrier and broker authority and shows some risk signals. Check the red flags and confirm identity independently.' };
  return { headline: 'Looks safe.', detail: `This company holds both carrier and broker authority. ${lowLead}` };
}
