import { REPORTS_ON } from './features';
import type { CarrierReport, RiskFlag } from './fmcsa';
import { roleNoun } from './recommendation';
import { isRecentReactivation, humanMonths } from './fmcsa-authority-history';

// Findings whose advice is "do not book/tender" (no active authority, out
// of service, no liability insurance, no broker bond) score the High-risk
// threshold, so any one of them alone gives a High verdict instead of
// "Proceed with caution".
const BLOCKER_PTS = 61;

export function scoreCarrier(c: CarrierReport): CarrierReport {
  const flags: RiskFlag[] = [...c.flags];

  // Entity type: a "pure broker" has Active broker authority but NOT common/contract
  // carrier authority. Brokers don't operate trucks, so carrier-specific rules
  // (BIPD liability, OOS, crashes, safety rating) don't apply to them.
  const isPureBroker = c.brokerAuthority === 'Active'
    && c.commonAuthority !== 'Active'
    && c.contractAuthority !== 'Active';
  const isCarrier = c.commonAuthority === 'Active' || c.contractAuthority === 'Active';
  const isBrokerActive = c.brokerAuthority === 'Active';

  // Authority: a company is fine if ANY of its roles is active — common or
  // contract (carrier) or broker. `authorityStatus` reflects common
  // authority only, so it's just the fallback when FMCSA returned no
  // per-role statuses (e.g. data came from a fallback source).
  const roleStatuses = [c.commonAuthority, c.contractAuthority, c.brokerAuthority].filter(Boolean);
  const noActiveAuthority = roleStatuses.length > 0
    ? !isCarrier && !isBrokerActive
    : Boolean(c.authorityStatus && c.authorityStatus !== 'Active');
  if (noActiveAuthority) {
    const parts = [
      c.commonAuthority && `common: ${c.commonAuthority}`,
      c.contractAuthority && `contract: ${c.contractAuthority}`,
      c.brokerAuthority && `broker: ${c.brokerAuthority}`,
    ].filter(Boolean).join(' · ');
    flags.push({
      sev: 'critical',
      title: 'No active operating authority',
      desc: `FMCSA shows no active carrier or broker authority${parts ? ` (${parts})` : c.authorityStatus ? ` (status: ${c.authorityStatus})` : ''}.`,
      pts: BLOCKER_PTS,
      details: 'A company needs active carrier authority to haul interstate freight, or active broker authority to arrange it. Without either, a load could be seized, and you have no federal protection if something goes wrong or you aren\'t paid.',
      recommendation: 'Do not book or tender. Ask for their MC number again and re-check, in case you were given the wrong one.',
    });
  }

  // `outOfService` is only true when FMCSA lists an OOS order AND says the
  // carrier is not allowed to operate (see normalize() in lib/fmcsa) — a
  // leftover OOS date on a carrier that's allowed to operate doesn't count.
  if (c.outOfService === true && isCarrier) {
    flags.push({
      sev: 'critical',
      title: 'Carrier is out of service',
      desc: `FMCSA lists an out-of-service order${c.oosDate ? ` dated ${c.oosDate}` : ''} and shows the carrier as not allowed to operate.`,
      pts: BLOCKER_PTS,
      details: 'While an out-of-service order is in effect, the carrier may not operate commercial motor vehicles in interstate commerce. FMCSA issues these orders for reasons such as an unsatisfactory safety rating, an imminent-hazard finding, or unpaid civil penalties, and lifts them once the cause is resolved.',
      metrics: [
        ...(c.oosDate ? [{ label: 'OOS order date', value: c.oosDate }] : []),
        { label: 'Allowed to operate', value: c.allowedToOperate === false ? 'No' : 'Not stated' },
      ],
      recommendation: 'Do not tender a load while the order is in effect. If the carrier says it was lifted, re-check FMCSA before booking.',
    });
  }

  // Authority age. Live reports carry `authorityHistory` from FMCSA's
  // AuthHist datasets; mock and older saved reports only have the
  // `authorityAge` text, so fall back to reading that.
  const hist = c.authorityHistory;
  const reactivatedRecently = hist?.checked
    ? isRecentReactivation(hist)
    : Boolean(c.authorityAge && /reactivated/i.test(c.authorityAge));
  const ageMonths = hist?.checked
    ? hist.ageMonths
    : c.authorityAge && /^(\d+)\s*month/i.test(c.authorityAge) ? parseInt(c.authorityAge, 10) : undefined;
  if (reactivatedRecently) {
    flags.push({
      sev: 'critical',
      title: 'Authority recently reactivated',
      desc: hist?.reactivatedDate
        ? `Authority became active again on ${hist.reactivatedDate} after ${hist.dormantMonths != null ? humanMonths(hist.dormantMonths) : 'a long period'} with no active authority.`
        : 'Reactivation after long dormancy is a known fraud pattern.',
      pts: 30,
      details: 'A common freight fraud pattern is to buy or reactivate a dormant MC number to inherit its clean record, then run scam loads for 30–90 days before disappearing. New activity on an old authority is a significant red flag. Legitimate companies also reinstate authority after a break, so confirm who is running it now.',
      metrics: hist?.reactivatedDate
        ? [
            ...(hist.firstGrantDate ? [{ label: 'First granted', value: hist.firstGrantDate }] : []),
            { label: 'Reactivated', value: hist.reactivatedDate },
            ...(hist.dormantMonths != null ? [{ label: 'Inactive before that', value: humanMonths(hist.dormantMonths) }] : []),
          ]
        : undefined,
      recommendation: 'Verify identity via an independent channel. Require payment upfront if you proceed.',
    });
  } else if (ageMonths != null && ageMonths < 12) {
    flags.push({
      sev: 'warning',
      title: 'Authority age under 12 months',
      desc: hist?.firstGrantDate
        ? `First granted ${hist.firstGrantDate} (${humanMonths(ageMonths)} ago).`
        : `Granted ${c.authorityAge} ago.`,
      pts: 15,
      details: 'New authorities aren\'t automatically fraud, but many freight scams run on brand-new MC numbers because they have no history to investigate. Legitimate new companies usually have real-world references you can call.',
      recommendation: 'Ask for references from shippers, brokers or carriers they\'ve worked with, and call them.',
    });
  }

  // BIPD (liability) insurance — only for motor carriers, or when FMCSA
  // itself lists a required amount. Brokers don't haul freight, so FMCSA
  // doesn't require BIPD from them; they need a surety bond (checked below).
  // FMCSA keeps the required amount on a broker's record when its carrier
  // authority went inactive, so a required amount on a broker that holds no
  // active carrier authority means nothing.
  if (isCarrier || (!isPureBroker && c.bipdRequired != null && c.bipdRequired > 0)) {
    if (c.bipdOnFile != null && c.bipdOnFile === 0) {
      flags.push({
        sev: 'critical',
        title: 'No liability insurance on file',
        desc: 'FMCSA shows $0 BIPD insurance. Federal minimum is $750K.',
        pts: BLOCKER_PTS,
        details: 'BIPD (Bodily Injury & Property Damage) insurance is federally required for all motor carriers. Without it, any claim against the carrier is uninsured and the shipper, broker, or carrier-of-record could be liable.',
        metrics: [
          { label: 'BIPD on file', value: '$0' },
          { label: 'BIPD required', value: c.bipdRequired != null ? `$${(c.bipdRequired * 1000).toLocaleString()}` : '$750,000 (federal min)' },
        ],
        recommendation: 'Do not book. Require proof of insurance before any further discussion.',
      });
    } else if (c.bipdOnFile != null && c.bipdRequired != null && c.bipdOnFile < c.bipdRequired) {
      flags.push({
        sev: 'warning',
        title: 'Liability insurance below required',
        desc: `On file: $${(c.bipdOnFile * 1000).toLocaleString()} vs required $${(c.bipdRequired * 1000).toLocaleString()}.`,
        pts: 20,
        details: 'The carrier\'s on-file liability insurance is below what FMCSA requires for their operating classification. A gap here means claims above the on-file amount have no coverage.',
        metrics: [
          { label: 'BIPD on file', value: `$${(c.bipdOnFile * 1000).toLocaleString()}` },
          { label: 'BIPD required', value: `$${(c.bipdRequired * 1000).toLocaleString()}` },
          { label: 'Shortfall', value: `$${((c.bipdRequired - c.bipdOnFile) * 1000).toLocaleString()}` },
        ],
        recommendation: 'Ask for a current certificate of insurance before booking.',
      });
    }
  }

  // Cargo insurance — only relevant for motor carriers (they haul, they can
  // lose the freight). Brokers don't need cargo insurance on their own MC.
  if (isCarrier && c.cargoRequired && c.cargoOnFile === 0) {
    flags.push({
      sev: 'warning',
      title: 'No cargo insurance on file',
      desc: 'FMCSA requires cargo insurance for this carrier, none on file.',
      pts: 20,
      details: 'Cargo insurance covers loss or damage to freight in transit. If a load is damaged, stolen, or lost, there is no insurance to recover against — the claim falls back on the carrier\'s assets or the shipper.',
      metrics: [
        { label: 'Cargo on file', value: '$0' },
        { label: 'Cargo required', value: 'Yes' },
      ],
      recommendation: 'Verify cargo coverage directly with their insurer before booking high-value freight.',
    });
  }

  // Broker surety bond / trust fund — federal requirement for anyone with
  // active broker authority, including companies that are also carriers.
  // Minimum is $75,000 (stored as 75 in thousands).
  if (isBrokerActive) {
    // $0 means FMCSA shows no bond. A MISSING field means we couldn't read
    // it (fallback data sources don't carry it) — unknown, not "not filed".
    if (c.bondOnFile == null) {
      flags.push({
        sev: 'info',
        title: 'Broker bond status couldn’t be confirmed',
        desc: 'The FMCSA data we received didn’t include bond information.',
        pts: 0,
        details: 'Brokers must keep a $75,000 surety bond (BMC-84) or trust fund (BMC-85). This doesn\'t mean the bond is missing, only that this lookup couldn\'t confirm it.',
        recommendation: 'Check the bond on FMCSA\'s Licensing & Insurance site, or run Scan again.',
      });
    } else if (c.bondOnFile === 0) {
      const bondLabel = '$0';
      flags.push({
        sev: 'critical',
        title: 'No surety bond on file',
        desc: 'Brokers are federally required to maintain a $75,000 surety bond (BMC-84) or trust fund (BMC-85).',
        pts: BLOCKER_PTS,
        details: 'The BMC-84 surety bond protects carriers and shippers when a broker fails to pay. A broker with no bond on file is operating illegally and carriers have no recourse if they stiff you.',
        metrics: [
          { label: 'Bond on file', value: bondLabel },
          { label: 'Bond required', value: '$75,000' },
        ],
        recommendation: 'Do not book. Ask the broker to show proof of their BMC-84 bond or BMC-85 trust fund before any payment terms.',
      });
    } else if (c.bondOnFile != null && c.bondOnFile < 75) {
      flags.push({
        sev: 'warning',
        title: `Surety bond below $75K minimum ($${(c.bondOnFile * 1000).toLocaleString()})`,
        desc: 'Broker bond is below the federal $75,000 requirement.',
        pts: 15,
        recommendation: 'Confirm current bond status with the broker before booking.',
      });
    }
  }

  // Insurance cancellations filed with FMCSA (lib/fmcsa-insurance). Coverage
  // stays in force until the date; insurers usually cancel for non-payment,
  // giving FMCSA 30 days' notice. Another policy of the same kind on file
  // without a cancellation is a renewal or switch, so that's only noted.
  const today = new Date().toISOString().slice(0, 10);
  const daysUntil = (iso: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const filings = c.insuranceFilings?.checked ? c.insuranceFilings.filings : [];
  const kindOf = (cov: string) => (/^BIPD/i.test(cov) ? 'bipd' : /CARGO/i.test(cov) ? 'cargo' : /SURETY|TRUST/i.test(cov) ? 'bond' : 'other');
  const kinds: { kind: 'bipd' | 'bond' | 'cargo'; applies: boolean; label: string }[] = [
    { kind: 'bipd', applies: isCarrier || (c.bipdRequired ?? 0) > 0, label: 'liability insurance' },
    { kind: 'bond', applies: isBrokerActive, label: 'broker bond' },
    { kind: 'cargo', applies: isCarrier && Boolean(c.cargoRequired), label: 'cargo insurance' },
  ];
  for (const { kind, applies, label } of kinds) {
    if (!applies) continue;
    const ofKind = filings.filter((f) => kindOf(f.coverage) === kind);
    const pending = ofKind
      .filter((f) => f.cancelEffectiveDate && f.cancelEffectiveDate >= today && f.cancelEffectiveDate !== f.effectiveDate)
      .sort((a, b) => String(a.cancelEffectiveDate).localeCompare(String(b.cancelEffectiveDate)));
    if (pending.length === 0) continue;
    const soonest = pending[0];
    const days = daysUntil(soonest.cancelEffectiveDate!);
    const replacement = ofKind.find((f) => !pending.includes(f) && !/Excess/i.test(f.coverage));
    const policy = `${soonest.insurer || 'Insurer'}${soonest.policyNumber ? ` policy ${soonest.policyNumber}` : ''}`;
    const metrics = [
      { label: 'Policy', value: policy },
      { label: 'Cancellation effective', value: `${soonest.cancelEffectiveDate} (${days} day${days === 1 ? '' : 's'})` },
      ...(replacement ? [{ label: 'Other policy on file', value: `${replacement.insurer}${replacement.policyNumber ? ` ${replacement.policyNumber}` : ''}${replacement.effectiveDate ? `, since ${replacement.effectiveDate}` : ''}` }] : []),
      { label: 'Source', value: 'FMCSA insurance filings' },
    ];
    if (replacement) {
      flags.push({
        sev: 'info',
        title: `Older ${label} policy being cancelled, another is on file`,
        desc: `${policy} cancels on ${soonest.cancelEffectiveDate}; ${replacement.insurer} is also on file.`,
        pts: 0,
        metrics,
        details: 'Usually a renewal or a switch to a new insurer. Coverage continues under the other policy.',
      });
    } else if (days <= 30) {
      flags.push({
        sev: 'critical',
        title: `${label[0].toUpperCase()}${label.slice(1)} cancellation filed: ends in ${days} day${days === 1 ? '' : 's'}`,
        desc: `${policy} is cancelled effective ${soonest.cancelEffectiveDate}, and no other ${label} is on file.`,
        pts: 40,
        metrics,
        details: kind === 'bond'
          ? 'Brokers must keep a $75,000 bond or trust fund. When it cancels, FMCSA suspends the broker authority, and carriers lose the bond they would claim against for unpaid loads.'
          : 'The insurer has told FMCSA it is cancelling, usually for non-payment. Coverage holds until that date; after it, the authority is suspended unless a new policy is filed.',
        recommendation: kind === 'bond'
          ? 'Ask the broker for proof of a new bond before agreeing to payment terms that run past the cancellation date.'
          : 'Ask for a current certificate and confirm with the insurer that the policy is paid and in force for the whole load.',
      });
    } else if (days <= 120) {
      flags.push({
        sev: 'warning',
        title: `${label[0].toUpperCase()}${label.slice(1)} cancellation filed for ${soonest.cancelEffectiveDate}`,
        desc: `${policy} cancels in ${days} days, and no other ${label} is on file yet.`,
        pts: 15,
        metrics,
        recommendation: 'Confirm with the insurer before booking loads that deliver close to that date.',
      });
    } else {
      flags.push({
        sev: 'info',
        title: `${label[0].toUpperCase()}${label.slice(1)} cancellation filed for ${soonest.cancelEffectiveDate}`,
        desc: `${policy} has a cancellation on file ${days} days out, often just the end of the policy term.`,
        pts: 0,
        metrics,
      });
    }
  }

  // Suspension notices FMCSA served (Motus). FMCSA serves an involuntary one
  // automatically when insurance or the BOC-3 filing is cancelled, and it's
  // moot once a new filing arrives, so most carriers that ever switched
  // insurers have one. Only a suspension still scheduled counts, and not
  // when a cancellation flag above already says the same thing. Past notices
  // stay listed in the report's Motus panel, without points.
  const insuranceFlagged = flags.some((f) => /cancellation filed/i.test(f.title) && f.pts > 0);
  const scheduled = (c.motus?.suspensions || []).find((n) => /involuntary/i.test(n.type) && n.effectiveDate && daysUntil(n.effectiveDate) >= 0);
  if (scheduled && !insuranceFlagged) {
    const days = daysUntil(scheduled.effectiveDate!);
    flags.push({
      sev: 'warning',
      title: `FMCSA scheduled a suspension for ${scheduled.effectiveDate}`,
      desc: `An involuntary suspension notice was served${scheduled.servedDate ? ` on ${scheduled.servedDate}` : ''}; the authority is suspended in ${days} day${days === 1 ? '' : 's'} unless the missing filing arrives.`,
      pts: 15,
      details: 'FMCSA serves this notice when required insurance or the BOC-3 process agent filing lapses. It is cancelled as soon as the company files again.',
      metrics: [
        { label: 'Notice', value: scheduled.type },
        ...(scheduled.servedDate ? [{ label: 'Served', value: scheduled.servedDate }] : []),
        { label: 'Suspension date', value: scheduled.effectiveDate! },
        ...(scheduled.authority ? [{ label: 'Authority', value: scheduled.authority }] : []),
        { label: 'Source', value: 'FMCSA Motus' },
      ],
      recommendation: 'Ask what filing lapsed and get proof it was filed again before booking loads that run past the suspension date.',
    });
  }

  // Authority history. One suspension in two years is common (a gap while
  // changing insurers) and is only noted. A company FMCSA has suspended
  // repeatedly keeps running close to having no insurance or process agent on
  // file. Suspensions FMCSA reversed as its own error aren't counted (see
  // buildAuthorityEvents).
  const lapses = hist?.checked && !hist.incomplete ? hist.lapses24m || 0 : 0;
  if (lapses > 0) {
    const recent = (hist?.events || []).filter((e) => e.kind === 'suspended' && e.bad && !e.corrected).slice(0, 4);
    const metrics = [
      ...recent.map((e) => ({ label: e.date, value: `${e.authority}: ${e.detail || e.text}` })),
      { label: 'Source', value: 'FMCSA authority history (Motus)' },
    ];
    if (lapses >= 2) {
      flags.push({
        sev: 'warning',
        title: `Authority suspended ${lapses} times in 24 months`,
        desc: 'FMCSA took this company’s operating authority away more than once in the last two years because a required filing lapsed.',
        pts: lapses >= 3 ? 15 : 10,
        metrics,
        details: 'FMCSA suspends authority when insurance or the process agent filing is cancelled and nothing replaces it. Once is usually a short gap while changing insurers. Repeated suspensions mean the company keeps letting required coverage run out.',
        recommendation: 'Get a current certificate of insurance and confirm with the insurer that the policy is in force before each load.',
      });
    } else {
      flags.push({
        sev: 'info',
        title: 'Authority was suspended once in the last 24 months',
        desc: recent[0] ? `${recent[0].detail || recent[0].text} (${recent[0].date}).` : 'FMCSA suspended the authority once; see Authority history.',
        pts: 0,
        metrics,
        details: 'A single suspension is common and usually a short gap while changing insurers.',
      });
    }
  }

  // An application FMCSA hasn't granted yet isn't an authority. It matters
  // most for a carrier that offers to broker a load.
  const pendingApps = (c.motus?.authorities || []).filter((a) => /^pending$/i.test(a.status));
  const pendingBroker = pendingApps.find((a) => /^Broker/i.test(a.type));
  const pendingCarrier = pendingApps.find((a) => /Motor Carrier/i.test(a.type));
  if (pendingBroker && c.brokerAuthority !== 'Active') {
    flags.push({
      sev: 'info',
      title: 'Broker authority applied for, not granted yet',
      desc: 'FMCSA has a pending application for broker authority. Until it is granted, this company can’t legally arrange loads for other carriers.',
      pts: 0,
      metrics: [{ label: 'Application', value: pendingBroker.type }, { label: 'Status', value: 'Pending' }, { label: 'Source', value: 'FMCSA Motus' }],
    });
  }
  if (pendingCarrier && c.commonAuthority !== 'Active' && c.contractAuthority !== 'Active') {
    flags.push({
      sev: 'info',
      title: 'Carrier authority applied for, not granted yet',
      desc: 'FMCSA has a pending application for carrier authority. Until it is granted, this company can’t legally haul for-hire loads across state lines.',
      pts: 0,
      metrics: [{ label: 'Application', value: pendingCarrier.type }, { label: 'Status', value: 'Pending' }, { label: 'Source', value: 'FMCSA Motus' }],
    });
  }

  // Past policies the insurer cancelled. On its own this is only a note: a
  // cancellation is also how a change of insurer is often filed. The
  // suspension flag above is what says coverage actually lapsed.
  const cancelled24m = c.insuranceFilings?.checked ? c.insuranceFilings.cancelled24m || 0 : 0;
  if (cancelled24m >= 2) {
    const rows = (c.insuranceFilings?.history || []).filter((f) => f.ended === 'cancelled').slice(0, 4);
    flags.push({
      sev: 'info',
      title: `Insurers cancelled ${cancelled24m} policies in 24 months`,
      desc: 'More than one policy ended by cancellation in the last two years. That can be a change of insurer; with a suspension in Authority history it means coverage ran out.',
      pts: 0,
      metrics: [
        ...rows.map((f) => ({ label: f.endedDate, value: `${f.insurer || 'Insurer'}${f.policyNumber ? ` ${f.policyNumber}` : ''}` })),
        { label: 'Source', value: 'FMCSA insurance history' },
      ],
    });
  }

  // Motus has newer values than FMCSA's other records. Authority or insurance
  // getting worse there is a warning; changed contact details are noted.
  const diffs = c.registryDiffs || [];
  const motusDate = c.motus?.asOf ? ` (as of ${c.motus.asOf})` : '';
  for (const d of diffs.filter((x) => (x.field === 'carrierAuthority' || x.field === 'brokerAuthority' || x.field === 'bipdOnFile') && x.concern)) {
    flags.push({
      sev: 'warning',
      title: `FMCSA's newest record: ${d.label.toLowerCase()} ${d.motus}`,
      desc: `Motus${motusDate} shows ${d.label.toLowerCase()} ${d.motus}; FMCSA's older record still shows ${d.fmcsa}.`,
      pts: d.field === 'bipdOnFile' ? 15 : 25,
      details: 'Since May 2026 FMCSA records changes in its new Motus system first; its other records catch up later.',
      metrics: [{ label: 'Motus', value: d.motus }, { label: 'FMCSA older record', value: d.fmcsa }],
      recommendation: 'Go by the newer Motus value until the records agree.',
    });
  }
  const taken = (c.motusApplied || []).filter((x) => x !== 'MC number');
  if (taken.length > 0) {
    flags.push({
      sev: 'info',
      title: `${taken[0][0].toUpperCase()}${taken[0].slice(1)}${taken.length > 1 ? ` and ${taken.length - 1} more` : ''} read from FMCSA's Motus records`,
      desc: `FMCSA's older record doesn't show ${taken.join(', ')} for this company yet; Motus${motusDate} does, so the report goes by Motus.`,
      pts: 0,
      details: 'Companies registered or changed since May 2026 are recorded in Motus first. Their older FMCSA record can read as "no authority" or "no insurance" until it catches up.',
      metrics: taken.map((x) => ({ label: x[0].toUpperCase() + x.slice(1), value: 'From Motus' })),
    });
  }
  const contact = diffs.filter((x) => x.field === 'name' || x.field === 'phone' || x.field === 'address');
  if (contact.length > 0) {
    flags.push({
      sev: 'info',
      title: `Newer ${contact.map((x) => x.label.toLowerCase()).join(', ')} in FMCSA's Motus records`,
      desc: 'The company changed these with FMCSA recently; the older records haven\'t caught up yet.',
      pts: 5,
      details: 'A recent change is usually routine, like a move or a new phone. It is also how stolen carrier identities start, so make sure the number you call is the new one.',
      metrics: contact.flatMap((x) => [{ label: `${x.label} (Motus)`, value: x.motus }, { label: `${x.label} (older)`, value: x.fmcsa }]),
    });
  }

  // Reports from verified users (lib/reports). Counted by a fixed rule, the
  // same for every company: each reporter once, 8 points (4 when their
  // newest open report is over two years old), 0 once resolved, 30 at most.
  // The flag states what's on record; the reports are the reporters' own
  // statements, shown with the company's replies on the report page.
  const ur = REPORTS_ON ? c.userReports : null; // off with Reports (lib/features.ts)
  if (ur && ur.published > 0) {
    const from = `${ur.reporters} verified reporter${ur.reporters === 1 ? '' : 's'}`;
    flags.push({
      sev: ur.points > 0 ? 'warning' : 'info',
      title: ur.open > 0
        ? `${ur.open} open report${ur.open === 1 ? '' : 's'} from ${from}`
        : `${ur.published} report${ur.published === 1 ? '' : 's'} on record, all marked resolved`,
      desc: 'Reports filed on Haulock by verified carriers, brokers or shippers, each with documents. They are the reporters’ statements, not findings by Haulock.',
      pts: ur.points,
      details: 'How reports count: each reporter counts once per company, however many loads they report. 8 points each, 4 when their newest open report is more than two years old, 0 once they mark it resolved. 30 points at most.',
      metrics: [
        { label: 'Published reports', value: String(ur.published) },
        { label: 'Open', value: String(ur.open) },
        { label: 'Marked resolved', value: String(ur.resolved) },
        { label: 'Reporters counted', value: `${ur.countedReporters}${ur.oldReporters ? ` (${ur.oldReporters} at the reduced rate)` : ''}` },
      ],
      recommendation: ur.open > 0 ? 'Read the reports and the company’s replies below, then ask the company about any that are still open.' : undefined,
    });
  }

  if (!isPureBroker && c.safetyRating && /unsatisfactory|conditional/i.test(c.safetyRating)) {
    flags.push({
      sev: 'warning',
      title: `Safety rating: ${c.safetyRating}`,
      desc: 'Federal safety rating indicates compliance issues.',
      pts: 15,
      details: `FMCSA issues safety ratings after compliance reviews. "${c.safetyRating}" means the carrier was found in violation of federal safety regulations. "Unsatisfactory" ratings can lead to loss of authority if not cured.`,
      recommendation: 'Check their latest compliance review date. If it\'s more than 2 years old, ask the carrier for current documentation.',
    });
  }

  if (c.mcs150Outdated) {
    flags.push({
      sev: 'info',
      title: 'MCS-150 update overdue',
      desc: 'FMCSA flags their biennial update as outdated.',
      pts: 5,
      details: 'The MCS-150 is a form motor carriers must update every 2 years. An overdue filing can result in deactivation of authority. It\'s also a sign of general administrative neglect.',
      recommendation: 'Not a booking-blocker on its own, but combine with other signals.',
    });
  }

  // Out-of-service rates. A rate from a handful of inspections is noise
  // (1 OOS out of 1 inspection = 100%), so only flag once the carrier has
  // MIN_OOS_INSPECTIONS inspections of that type. Counts come from QCMobile
  // (driverInsp / vehicleInsp), with the SMS page as backup. With no count
  // at all we still judge the rate, but the flag says the count is missing.
  const MIN_OOS_INSPECTIONS = 10;
  const smsInsp = c.sms?.fetched ? c.sms.inspections : null;
  const drvInsp = c.driverInspections ?? smsInsp?.driverInspections;
  const drvOosInsp = c.driverOosInspections ?? smsInsp?.driverOosCount;
  const vehInsp = c.vehicleInspections ?? smsInsp?.vehicleInspections;
  const vehOosInsp = c.vehicleOosInspections ?? smsInsp?.vehicleOosCount;
  const enoughInspections = (n: number | undefined) => n == null || n >= MIN_OOS_INSPECTIONS;
  const inspectionBasis = (n: number | undefined, oos: number | undefined) =>
    n == null
      ? ' The inspection count wasn’t available, so this rate may rest on only a few inspections.'
      : ` Based on ${oos != null ? `${oos} of ` : ''}${n} inspection${n === 1 ? '' : 's'} in 24 months.`;
  const inspectionMetrics = (kind: 'Driver' | 'Vehicle', n: number | undefined, oos: number | undefined) => [
    { label: `${kind} inspections (24mo)`, value: n != null ? String(n) : 'Unknown' },
    ...(n != null && oos != null ? [{ label: 'Placed out of service', value: String(oos) }] : []),
  ];

  if (!isPureBroker && c.driverOosRate != null && c.driverOosRateNat != null && c.driverOosRate > c.driverOosRateNat * 1.5 && enoughInspections(drvInsp)) {
    flags.push({
      sev: 'warning',
      title: `Driver out-of-service rate ${c.driverOosRate.toFixed(1)}%`,
      desc: `Well above national average of ${c.driverOosRateNat.toFixed(2)}%.${inspectionBasis(drvInsp, drvOosInsp)}`,
      pts: 10,
      details: 'Driver OOS rate is the percentage of roadside driver inspections where the driver was placed out of service (typically for hours-of-service violations, licensing issues, or drug/alcohol failures). High rates suggest systemic driver compliance problems.',
      metrics: [
        { label: 'This carrier', value: `${c.driverOosRate.toFixed(2)}%` },
        { label: 'National average', value: `${c.driverOosRateNat.toFixed(2)}%` },
        { label: 'Multiple of avg', value: `${(c.driverOosRate / c.driverOosRateNat).toFixed(1)}×` },
        ...inspectionMetrics('Driver', drvInsp, drvOosInsp),
      ],
      recommendation: 'Factor into delay / liability expectations. Higher OOS = more roadside stops.',
    });
  }

  if (!isPureBroker && c.vehicleOosRate != null && c.vehicleOosRateNat != null && c.vehicleOosRate > c.vehicleOosRateNat * 1.5 && enoughInspections(vehInsp)) {
    flags.push({
      sev: 'warning',
      title: `Vehicle out-of-service rate ${c.vehicleOosRate.toFixed(1)}%`,
      desc: `Well above national average of ${c.vehicleOosRateNat.toFixed(2)}%.${inspectionBasis(vehInsp, vehOosInsp)}`,
      pts: 10,
      details: 'Vehicle OOS rate is the percentage of roadside vehicle inspections where the truck or trailer was placed out of service for equipment defects (brakes, tires, lights, etc.). High rates indicate poor maintenance — expect breakdowns and delays.',
      metrics: [
        { label: 'This carrier', value: `${c.vehicleOosRate.toFixed(2)}%` },
        { label: 'National average', value: `${c.vehicleOosRateNat.toFixed(2)}%` },
        { label: 'Multiple of avg', value: `${(c.vehicleOosRate / c.vehicleOosRateNat).toFixed(1)}×` },
        ...inspectionMetrics('Vehicle', vehInsp, vehOosInsp),
      ],
      recommendation: 'For time-sensitive freight, prefer a carrier with OOS rates at or below the national average.',
    });
  } else if (!isPureBroker && c.vehicleOosRate != null && c.vehicleOosRateNat != null && c.vehicleOosRate > c.vehicleOosRateNat && enoughInspections(vehInsp)) {
    flags.push({
      sev: 'info',
      title: `Vehicle OOS rate ${c.vehicleOosRate.toFixed(1)}% · above average`,
      desc: `National average ${c.vehicleOosRateNat.toFixed(2)}%.${inspectionBasis(vehInsp, vehOosInsp)}`,
      pts: 5,
      details: 'Vehicle OOS rate measures the percentage of roadside vehicle inspections where the truck or trailer was placed out of service for equipment defects. Slightly above average isn\'t a booking blocker, but it indicates maintenance is below the national median.',
      metrics: [
        { label: 'This carrier', value: `${c.vehicleOosRate.toFixed(2)}%` },
        { label: 'National average', value: `${c.vehicleOosRateNat.toFixed(2)}%` },
        { label: 'Multiple of avg', value: `${(c.vehicleOosRate / c.vehicleOosRateNat).toFixed(2)}×` },
        ...inspectionMetrics('Vehicle', vehInsp, vehOosInsp),
      ],
      recommendation: 'Worth noting, not a blocker. Prefer lower OOS rates for time-critical loads.',
    });
  }

  // Fatal crashes. FMCSA counts every reportable crash a carrier was
  // involved in over 24 months, whatever its driver's role, and big fleets
  // drive far more miles. One fatal crash says more about a 3-truck carrier
  // than a 300-truck one, so large fleets get the count set against fleet
  // size instead of a flat penalty.
  if (!isPureBroker && c.fatalCrash && c.fatalCrash > 0) {
    const n = c.fatalCrash;
    const LARGE_FLEET_UNITS = 50;
    const large = c.powerUnits != null && c.powerUnits >= LARGE_FLEET_UNITS;
    const per100 = c.powerUnits ? (n / c.powerUnits) * 100 : null;
    const crashMetrics = [
      { label: 'Fatal crashes (24mo)', value: String(n) },
      { label: 'Injury crashes (24mo)', value: String(c.injCrash ?? 0) },
      { label: 'Total crashes (24mo)', value: String(c.crashTotal ?? 0) },
      { label: 'Fleet size', value: c.powerUnits ? `${c.powerUnits} power units` : 'Unknown' },
      ...(per100 != null ? [{ label: 'Fatal per 100 power units (24mo)', value: per100.toFixed(1) }] : []),
    ];
    const plural = n === 1 ? '' : 'es';
    if (large && per100 != null) {
      const many = per100 >= 2;
      flags.push({
        sev: many ? 'warning' : 'info',
        title: `${n} fatal crash${plural} in 24 months · ${c.powerUnits}-truck fleet`,
        desc: `About ${per100.toFixed(1)} per 100 power units over 24 months${many ? ', which is a lot for a fleet this size' : ''}. FMCSA counts crashes regardless of who was at fault, and large fleets drive many more miles.`,
        pts: many ? 10 : 5,
        details: 'FMCSA lists every reportable crash (fatal, injury, or tow-away) the carrier was involved in over the last 24 months, regardless of its driver\'s role. For a large fleet, the count is best read against the number of trucks on the road.',
        metrics: crashMetrics,
        recommendation: 'Review the crash details on FMCSA SMS before tendering high-liability freight.',
      });
    } else {
      flags.push({
        sev: 'warning',
        title: `${n} fatal crash${plural} in 24 months`,
        desc: c.powerUnits
          ? `For a ${c.powerUnits}-truck fleet. Check the carrier's full safety record before booking.`
          : 'Fleet size unknown. Check the carrier\'s full safety record before booking.',
        pts: 15,
        details: 'FMCSA lists every reportable crash (fatal, injury, or tow-away) the carrier was involved in over the last 24 months, regardless of its driver\'s role. For a small fleet, a fatal crash is a significant event worth asking about.',
        metrics: crashMetrics,
        recommendation: 'Pull their SMS scores and review crash details before engaging for high-liability freight.',
      });
    }
  }

  // FMCSA counts crashes over 24 months; the usual benchmark is about
  // 0.2–0.4 reportable crashes per truck per YEAR. Only flag when the
  // carrier is clearly above that (or when we can't tell the fleet size).
  const crashesPerTruckYear = c.crashTotal != null && c.powerUnits ? c.crashTotal / 2 / c.powerUnits : null;
  const crashesHigh = crashesPerTruckYear != null ? crashesPerTruckYear > 0.4 && (c.crashTotal ?? 0) >= 3 : (c.crashTotal ?? 0) >= 10;
  if (!isPureBroker && c.crashTotal != null && crashesHigh && (!c.fatalCrash || c.fatalCrash === 0)) {
    const perTruck = crashesPerTruckYear != null ? crashesPerTruckYear.toFixed(2) : null;
    flags.push({
      sev: 'info',
      title: `${c.crashTotal} crashes in 24 months`,
      desc: perTruck
        ? `About ${perTruck} per truck per year — above the usual 0.2–0.4.`
        : 'Fleet size unknown, so we can\'t compare this to similar carriers.',
      pts: 5,
      details: 'FMCSA tracks reportable crashes (fatal, injury, or tow-away) over the last 24 months. A higher count for a small fleet can indicate training or maintenance issues. Large fleets often have proportionally more crashes simply due to more miles driven.',
      metrics: [
        { label: 'Total crashes (24mo)', value: String(c.crashTotal) },
        { label: 'Injury crashes', value: String(c.injCrash ?? 0) },
        { label: 'Fleet size', value: c.powerUnits ? `${c.powerUnits} power units` : 'Unknown' },
        ...(perTruck ? [{ label: 'Per truck per year', value: perTruck }] : []),
      ],
      recommendation: 'Review their crash details on FMCSA SMS before tendering high-value or time-critical freight.',
    });
  }

  if (c.webPresence?.configured) {
    // `verified` / `verifiedBy` come from lib/website-finder's
    // assessWebsiteOwnership (not yet on the shared CarrierReport type).
    const wp = c.webPresence as NonNullable<CarrierReport['webPresence']> & { verified?: boolean; verifiedBy?: string };
    if (wp.found) {
      // Name-mismatch is a marketing / SEO signal, not a fraud signal.
      // Many legit carriers run on a brand-style domain (Apollo Freight
      // Systems Inc → owneroperatorsapollo.com). We deliberately do NOT
      // flag it; the report still surfaces the mismatch in a neutral
      // badge for transparency, but it does not affect the score.
      // Only judge the site's age / email setup when we've confirmed the
      // site is theirs: the name matches AND its Google listing is at the
      // FMCSA address or has the FMCSA phone. A site that merely ranks for
      // the name may be someone else's — or an impersonator's.
      const siteIsTheirs = wp.nameMatch === true && wp.verified === true;
      // FMCSA's email domain, when it's a different domain from the site.
      const em = wp.emailDomainCheck;
      const establishedEmail = em && em.ageDays != null && em.ageDays > 365 && em.hasMx === true ? em : undefined;
      if (siteIsTheirs && wp.domainAgeDays != null && wp.domainAgeDays <= 90 && establishedEmail) {
        // A new website while FMCSA has them on an older, working email
        // domain: often a legitimate new site, but Google listings are also
        // edited by impersonators. Smaller weight — the listing still has
        // their FMCSA address/phone — and the advice is about which contact
        // details to trust.
        const years = Math.floor(establishedEmail.ageDays! / 365);
        flags.push({
          sev: 'warning',
          title: 'Their Google listing links to a brand-new website',
          desc: `${wp.domain} was registered ${wp.domainAgeDays} day${wp.domainAgeDays === 1 ? '' : 's'} ago. FMCSA's record has their email on ${establishedEmail.domain}, which they've had for ${years}+ year${years === 1 ? '' : 's'}.`,
          pts: 10,
          details: 'This can simply be a new website. But scammers sometimes edit a real company\'s Google listing to point to a site and email they control, so treat contact details from the new site with care.',
          metrics: [
            { label: 'Website domain', value: `${wp.domain} · ${wp.domainAgeDays} days old` },
            { label: 'FMCSA email domain', value: `${establishedEmail.domain} · ${years}+ yrs${establishedEmail.provider ? ` · ${establishedEmail.provider}` : ''}` },
          ],
          recommendation: `Use the phone number from FMCSA and an @${establishedEmail.domain} email. Be careful with emails from @${wp.domain}.`,
        });
      } else if (siteIsTheirs && wp.domainAgeDays != null && wp.domainAgeDays <= 90) {
        flags.push({
          sev: 'warning',
          title: `Website domain registered ${wp.domainAgeDays} day${wp.domainAgeDays === 1 ? '' : 's'} ago`,
          desc: 'Established companies usually have websites that are years old.',
          pts: 25,
          details: 'This website is tied to the company\'s FMCSA address or phone, but the domain is under 3 months old. That can mean the business was recently set up or taken over. Legitimate new companies exist too, so check how long they\'ve had authority.',
          metrics: [
            { label: 'Domain age', value: `${wp.domainAgeDays} days` },
            { label: 'Domain', value: wp.domain || '—' },
          ],
          recommendation: 'Do not trust contact info from this website without independent verification.',
        });
      }
      // No mail server on the website domain only matters if that's where
      // their email would be. When FMCSA has them on another domain that
      // does take mail, it's not a finding.
      if (siteIsTheirs && wp.hasMx === false && !(em && em.hasMx === true)) {
        flags.push({
          sev: 'info',
          title: 'Their website domain has no email server',
          desc: 'The website domain has no MX records, so email to @' + wp.domain + ' won\'t arrive.',
          pts: 5,
          details: 'Many small companies use Gmail and never set up email on their own domain, so this isn\'t a red flag on its own. It does mean an email "from @' + wp.domain + '" wasn\'t sent from a real mailbox there.',
        });
      }
    } else if (!wp.error) {
      flags.push({
        sev: 'info',
        title: 'No website found',
        desc: 'Couldn\'t find a public website for this company.',
        pts: 5,
        details: 'Many small carriers operate without a website, so this isn\'t conclusive on its own. Combined with new authority + missing insurance, it strengthens the suspicion.',
      });
    }
  }

  // `found` means Places has a listing at exactly the FMCSA address (see
  // lib/places addressesMatch). A failed lookup (`error`) is "couldn't
  // check" and produces no flag at all.
  const addr = c.addressCheck as (NonNullable<CarrierReport['addressCheck']> & { addressMatched?: boolean; nameMatches?: boolean }) | undefined;
  if (addr?.configured && addr.error) {
    // Couldn't check — not a finding.
  } else if (addr?.configured) {
    if (addr.found && addr.isMailbox) {
      flags.push({
        sev: 'warning',
        title: 'Address is a mail-forwarding service',
        desc: `Their on-file address resolves to ${addr.mailboxProvider || 'a mail box rental'}, not a real business location.`,
        pts: 25,
        details: 'Freight fraud often uses commercial mail receiving agencies (UPS Store, iPostal1, etc.) so the operator can\'t be physically located. Some legitimate small carriers use them too, but combined with other flags it is a strong signal.',
        metrics: [
          { label: 'On file', value: c.address || '—' },
          { label: 'Resolves to', value: addr.matchedName || '—' },
          { label: 'Provider', value: addr.mailboxProvider || 'Mail box rental' },
        ],
        recommendation: `Ask the ${roleNoun(c)} for a physical operating address and verify it with a phone call.`,
      });
    } else if (!addr.found && c.address) {
      flags.push({
        sev: 'info',
        title: 'Address could not be verified',
        desc: 'Google Places has no listing at exactly their on-file address.',
        pts: 5,
        details: 'Not necessarily fraud — small businesses sometimes have addresses that don\'t resolve cleanly. But combined with other signals (new authority, missing insurance) it adds suspicion.',
      });
    } else if (addr.found && addr.isResidence) {
      // A house or building with no business listed — normal for a
      // home-based owner-operator. Neutral; shown in the address panel.
    } else if (addr.found && addr.businessStatus === 'CLOSED_PERMANENTLY') {
      flags.push({
        sev: 'warning',
        title: 'Business at this address is closed permanently',
        desc: 'Google Places lists the business at the on-file address as permanently closed.',
        pts: 20,
        recommendation: `Verify the ${roleNoun(c)}'s current operating location before booking.`,
      });
    } else if (
      addr.found
      && addr.addressMatched === true
      && !addr.isMailbox
      && !addr.isResidence
      && addr.matchedName
      && c.name
      && !carrierNamesMatch(c.name, addr.matchedName)
    ) {
      // Google lists a DIFFERENT business at exactly this address (same
      // street number, street, ZIP and suite). Can mean a shared office or
      // executive suite that hosts registrations, or simply a tenant
      // without its own Google listing.
      const noun = roleNoun(c);
      const suite = extractSuite(c.address);
      flags.push({
        sev: 'warning',
        title: 'Address resolves to a different business',
        desc: `FMCSA lists ${c.name} at this address, but Google Places shows ${addr.matchedName} as the business there. It could be a shared office or executive-suite address, or the ${noun} may simply not have its own Google listing.`,
        pts: 25,
        details: 'Some shell companies register at a multi-tenant office building so the address looks legitimate, while no business operates there under their name. Many real companies also share buildings. Verify by phone, ask for a photo of their office, yard or terminal, or call the building manager.',
        metrics: [
          { label: 'FMCSA name', value: c.name },
          { label: 'Business at address', value: addr.matchedName },
          ...(suite ? [{ label: 'Suite', value: suite }] : []),
        ],
        recommendation: `A Google listing at the address doesn't show this ${noun} operates there. Phone the ${noun} and the building.`,
      });
    }
  }

  // (The pure-broker bond check above already covers the active-broker
  // -without-bond pattern. We removed a duplicate copy of that check that
  // was firing alongside it and producing two flags for the same issue.)

  // FMCSA's QCMobile API inconsistently exposes phone — sometimes it is
  // there, sometimes it is not, even for the same carrier across consecutive
  // requests. We backfill from snapshot history when missing, so by the time
  // we get here a truly empty `phone` is rare. We keep the surface flag as
  // info-only (zero points) so it does not penalize otherwise legitimate
  // carriers just because of upstream data-quality variance.
  if ((c.brokerAuthority === 'Active' || isCarrier) && !c.phone) {
    flags.push({
      sev: 'info',
      title: 'No phone number available',
      desc: 'No phone number found in the current FMCSA record or in our snapshot history for this carrier.',
      pts: 0,
      details: 'FMCSA carriers file their phone via MCS-150, but the QCMobile API does not always return it. This can also mean the carrier has not updated their public contact info in a while. It is informational — not a fraud signal on its own.',
      recommendation: 'Get a phone number directly from the rate confirmation, then verify it against an independent source (their website, Google Business, or the FMCSA L&I update).',
    });
  }

  const score = Math.min(100, flags.reduce((s, f) => s + f.pts, 0));
  const verdict: CarrierReport['verdict'] = score >= 61 ? 'high' : score >= 31 ? 'medium' : 'low';
  return { ...c, score, verdict, flags };
}

// Common entity-suffix words to strip when comparing two company names.
// "GRAY FALCON UNITED LLC" vs "Gray Falcon United" should be a match;
// "Gray Falcon United" vs "Roadrunner Freight" should NOT be.
const NAME_NOISE = new Set([
  'llc', 'lc', 'inc', 'incorporated', 'corp', 'corporation', 'co', 'company',
  'ltd', 'limited', 'lp', 'llp', 'pllc', 'pa', 'pc', 'dba',
  'the', 'and', 'of', '&', 'group', 'holdings',
]);

// Industry words that half the companies in freight share. Two names that
// only have these in common ("Acme Freight" / "Roadrunner Freight") are NOT
// the same company, so these never count as a match on their own.
export const GENERIC_INDUSTRY_WORDS = new Set([
  'freight', 'freights', 'logistics', 'logistic', 'trucking', 'truck', 'trucks', 'truckers',
  'transport', 'transports', 'transportation', 'transit', 'trans', 'express', 'xpress', 'expedited',
  'expediting', 'carrier', 'carriers', 'services', 'service', 'solutions', 'lines', 'line',
  'delivery', 'deliveries', 'hauling', 'haulers', 'hauler', 'haul', 'enterprises', 'enterprise',
  'shipping', 'cargo', 'moving', 'movers', 'brokerage', 'brokers', 'broker', 'dispatch',
  'dispatching', 'distribution', 'intermodal', 'motor', 'motors', 'fleet', 'systems', 'supply',
  'chain', 'worldwide', 'international', 'global', 'national', 'usa', 'us', 'america', 'american',
]);

export function tokenizeName(name: string): string[] {
  return (name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !NAME_NOISE.has(w));
}

// The words that actually identify a company: tokens minus generic
// industry words. "ACME FREIGHT LLC" → ['acme'].
export function distinctiveNameTokens(name: string): string[] {
  return tokenizeName(name).filter((w) => !GENERIC_INDUSTRY_WORDS.has(w));
}

// Lenient comparison, used before raising "a different business is at this
// address": we'd rather miss a mismatch than accuse a company. Names match
// when they share a distinctive word (3+ letters), when one's distinctive
// words run together inside the other's ("GRAYFALCON" / "Gray Falcon
// United"), or — when a name is made only of generic words ("Express
// Logistics Inc") — when they share any word at all. Generic words alone
// never make a match: "Acme Freight" vs "Roadrunner Freight" → no match.
export function carrierNamesMatch(a: string, b: string): boolean {
  const ta = tokenizeName(a);
  const tb = tokenizeName(b);
  if (ta.length === 0 || tb.length === 0) return true; // can't compare → don't false-flag
  const da = ta.filter((w) => !GENERIC_INDUSTRY_WORDS.has(w));
  const db = tb.filter((w) => !GENERIC_INDUSTRY_WORDS.has(w));
  if (da.length === 0 || db.length === 0) {
    // Only generic words on one side — fall back to any shared word.
    const set = new Set(ta);
    return tb.some((t) => set.has(t));
  }
  const ja = da.join('');
  const jb = db.join('');
  if (ja === jb) return true;
  const shorter = ja.length <= jb.length ? ja : jb;
  const longer = ja.length <= jb.length ? jb : ja;
  if (shorter.length >= 4 && longer.includes(shorter)) return true;
  const set = new Set(da.filter((w) => w.length >= 3));
  return db.some((t) => t.length >= 3 && set.has(t));
}

// Strict comparison, used when a name match is evidence that something
// belongs to the company (a website's Google listing). The distinctive words
// must be the same on both sides: "Acme Freight LLC" = "Acme Freight
// Services", but "Acme Freight" ≠ "Acme Plumbing".
export function companyNamesStrictMatch(a: string, b: string): boolean {
  const da = distinctiveNameTokens(a).join('');
  const db = distinctiveNameTokens(b).join('');
  if (da && db) return da === db;
  if (da || db) return false;
  const fa = tokenizeName(a).join('');
  const fb = tokenizeName(b).join('');
  return Boolean(fa) && fa === fb;
}

// Pull the suite/unit/apartment number out of a US address string. Used to
// detect "same building, different tenant" patterns where Places confirms a
// different business at a different suite of the FMCSA-listed building.
function extractSuite(addr: string | undefined): string | undefined {
  if (!addr) return undefined;
  const s = addr.toUpperCase();
  // Match "STE 110", "SUITE 110", "UNIT 5B", "APT 12", "# 530".
  const m = s.match(/\b(STE|SUITE|UNIT|APT|RM|ROOM|#)\s*([A-Z0-9-]+)/);
  return m ? `${m[1]} ${m[2]}`.replace('SUITE', 'STE') : undefined;
}
