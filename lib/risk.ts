import type { CarrierReport, RiskFlag } from './fmcsa';

export function scoreCarrier(c: CarrierReport): CarrierReport {
  const flags: RiskFlag[] = [...c.flags];

  // Entity type: a "pure broker" has Active broker authority but NOT common/contract
  // carrier authority. Brokers don't operate trucks, so carrier-specific rules
  // (BIPD liability, OOS, crashes, safety rating) don't apply to them.
  const isPureBroker = c.brokerAuthority === 'Active'
    && c.commonAuthority !== 'Active'
    && c.contractAuthority !== 'Active';
  const isCarrier = c.commonAuthority === 'Active' || c.contractAuthority === 'Active';

  if (isPureBroker) {
    // For brokers, the "authority" we care about is broker authority, already
    // confirmed Active above. Skip the carrier-authority check.
  } else if (c.authorityStatus && c.authorityStatus !== 'Active') {
    flags.push({
      sev: 'critical',
      title: 'Operating authority is not active',
      desc: `FMCSA reports authority as "${c.authorityStatus}". Do not book.`,
      pts: 50,
      details: 'Authority must be "Active" for a carrier to legally haul freight in interstate commerce. Inactive, revoked, or suspended status means any load picked up could be seized and the carrier has no recourse for payment.',
      recommendation: 'Do not book. Ask the broker to use a carrier with active authority.',
    });
  }

  if (c.outOfService && isCarrier) {
    flags.push({
      sev: 'critical',
      title: 'Carrier is out of service',
      desc: 'FMCSA has placed this carrier out of service.',
      pts: 40,
      details: 'A federal OOS order means the carrier has been found in serious safety violation and is prohibited from operating any vehicle in interstate commerce until the violation is resolved.',
      recommendation: 'Do not book under any circumstances.',
    });
  }

  if (c.authorityAge && /reactivated/i.test(c.authorityAge)) {
    flags.push({
      sev: 'critical',
      title: 'Authority recently reactivated',
      desc: 'Reactivation after long dormancy is a known fraud pattern.',
      pts: 30,
      details: 'A common freight fraud pattern is to buy or reactivate a dormant MC number to inherit its clean record, then run scam loads for 30–90 days before disappearing. New activity on an old authority is a significant red flag.',
      recommendation: 'Verify identity via an independent channel. Require payment upfront if you proceed.',
    });
  } else if (c.authorityAge && /^(\d+)\s*month/i.test(c.authorityAge)) {
    const months = parseInt(c.authorityAge, 10);
    if (months < 12) {
      flags.push({
        sev: 'warning',
        title: 'Authority age under 12 months',
        desc: `Granted ${c.authorityAge} ago.`,
        pts: 15,
        details: 'New authorities aren\'t automatically fraud, but many freight scams run on brand-new MC numbers because they have no history to investigate. Legitimate new carriers usually have real-world references you can call.',
        recommendation: 'Ask the broker for references from shippers or other carriers they\'ve worked with.',
      });
    }
  }

  // BIPD (liability) insurance — only relevant to motor carriers. Pure brokers
  // don't haul freight, so FMCSA doesn't require them to carry BIPD. Brokers
  // are required to have a surety bond (BMC-84) instead — checked below.
  if (isCarrier || !isPureBroker) {
    if (c.bipdOnFile != null && c.bipdOnFile === 0) {
      flags.push({
        sev: 'critical',
        title: 'No liability insurance on file',
        desc: 'FMCSA shows $0 BIPD insurance. Federal minimum is $750K.',
        pts: 40,
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

  // Broker surety bond / trust fund — federal requirement for all property
  // brokers. Minimum is $75,000 (stored as 75 in thousands). A broker without
  // the bond can't legally pay carriers and is almost certainly a fraud front.
  if (isPureBroker) {
    // No bond on file: explicit $0 OR the field is entirely missing from
    // the FMCSA response. Both states mean the broker hasn't filed a
    // BMC-84 with FMCSA — operating illegally either way.
    const hasBond = (c.bondOnFile != null && c.bondOnFile > 0);
    if (!hasBond) {
      const bondLabel = c.bondOnFile === 0 ? '$0' : 'Not filed with FMCSA';
      flags.push({
        sev: 'critical',
        title: 'No surety bond on file',
        desc: 'Brokers are federally required to maintain a $75,000 surety bond (BMC-84) or trust fund (BMC-85).',
        pts: 40,
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

  if (!isPureBroker && c.safetyRating && /unsatisfactory|conditional/i.test(c.safetyRating)) {
    flags.push({
      sev: 'warning',
      title: `Safety rating: ${c.safetyRating}`,
      desc: 'Federal safety rating indicates compliance issues.',
      pts: 15,
      details: `FMCSA issues safety ratings after compliance reviews. "${c.safetyRating}" means the carrier was found in violation of federal safety regulations. "Unsatisfactory" ratings can lead to loss of authority if not cured.`,
      recommendation: 'Check their latest compliance review date. If more than 2 years old, ask the broker for current documentation.',
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

  if (!isPureBroker && c.driverOosRate != null && c.driverOosRateNat != null && c.driverOosRate > c.driverOosRateNat * 1.5) {
    flags.push({
      sev: 'warning',
      title: `Driver out-of-service rate ${c.driverOosRate.toFixed(1)}%`,
      desc: `Well above national average of ${c.driverOosRateNat.toFixed(2)}%.`,
      pts: 10,
      details: 'Driver OOS rate is the percentage of roadside driver inspections where the driver was placed out of service (typically for hours-of-service violations, licensing issues, or drug/alcohol failures). High rates suggest systemic driver compliance problems.',
      metrics: [
        { label: 'This carrier', value: `${c.driverOosRate.toFixed(2)}%` },
        { label: 'National average', value: `${c.driverOosRateNat.toFixed(2)}%` },
        { label: 'Multiple of avg', value: `${(c.driverOosRate / c.driverOosRateNat).toFixed(1)}×` },
      ],
      recommendation: 'Factor into delay / liability expectations. Higher OOS = more roadside stops.',
    });
  }

  if (!isPureBroker && c.vehicleOosRate != null && c.vehicleOosRateNat != null && c.vehicleOosRate > c.vehicleOosRateNat * 1.5) {
    flags.push({
      sev: 'warning',
      title: `Vehicle out-of-service rate ${c.vehicleOosRate.toFixed(1)}%`,
      desc: `Well above national average of ${c.vehicleOosRateNat.toFixed(2)}%.`,
      pts: 10,
      details: 'Vehicle OOS rate is the percentage of roadside vehicle inspections where the truck or trailer was placed out of service for equipment defects (brakes, tires, lights, etc.). High rates indicate poor maintenance — expect breakdowns and delays.',
      metrics: [
        { label: 'This carrier', value: `${c.vehicleOosRate.toFixed(2)}%` },
        { label: 'National average', value: `${c.vehicleOosRateNat.toFixed(2)}%` },
        { label: 'Multiple of avg', value: `${(c.vehicleOosRate / c.vehicleOosRateNat).toFixed(1)}×` },
      ],
      recommendation: 'For time-sensitive freight, prefer a carrier with OOS rates at or below the national average.',
    });
  } else if (!isPureBroker && c.vehicleOosRate != null && c.vehicleOosRateNat != null && c.vehicleOosRate > c.vehicleOosRateNat) {
    flags.push({
      sev: 'info',
      title: `Vehicle OOS rate ${c.vehicleOosRate.toFixed(1)}% · above average`,
      desc: `National average ${c.vehicleOosRateNat.toFixed(2)}%.`,
      pts: 5,
      details: 'Vehicle OOS rate measures the percentage of roadside vehicle inspections where the truck or trailer was placed out of service for equipment defects. Slightly above average isn\'t a booking blocker, but it indicates maintenance is below the national median.',
      metrics: [
        { label: 'This carrier', value: `${c.vehicleOosRate.toFixed(2)}%` },
        { label: 'National average', value: `${c.vehicleOosRateNat.toFixed(2)}%` },
        { label: 'Multiple of avg', value: `${(c.vehicleOosRate / c.vehicleOosRateNat).toFixed(2)}×` },
      ],
      recommendation: 'Worth noting, not a blocker. Prefer lower OOS rates for time-critical loads.',
    });
  }

  if (!isPureBroker && c.fatalCrash && c.fatalCrash > 0) {
    flags.push({
      sev: 'warning',
      title: `${c.fatalCrash} fatal crash${c.fatalCrash === 1 ? '' : 'es'} on record`,
      desc: 'Check the carrier\'s full safety record before booking.',
      pts: 15,
      details: 'FMCSA tracks the last 24 months of reportable crashes (fatal, injury, or tow-away). Fatal crashes specifically are weighted heavily in Safety Measurement System (SMS) scores and may indicate serious safety issues.',
      metrics: [
        { label: 'Fatal crashes (24mo)', value: String(c.fatalCrash) },
        { label: 'Injury crashes (24mo)', value: String(c.injCrash ?? 0) },
        { label: 'Total crashes (24mo)', value: String(c.crashTotal ?? 0) },
      ],
      recommendation: 'Pull their SMS scores and review crash details before engaging for high-liability freight.',
    });
  }

  if (!isPureBroker && c.crashTotal != null && c.crashTotal >= 10 && (!c.fatalCrash || c.fatalCrash === 0)) {
    const perTruck = c.powerUnits ? (c.crashTotal / c.powerUnits).toFixed(2) : null;
    flags.push({
      sev: 'info',
      title: `${c.crashTotal} total crashes on record`,
      desc: 'Above average for the fleet size — review details.',
      pts: 5,
      details: 'FMCSA tracks reportable crashes (fatal, injury, or tow-away) over the last 24 months. A higher count for a small fleet can indicate training or maintenance issues. Large fleets often have proportionally more crashes simply due to more miles driven.',
      metrics: [
        { label: 'Total crashes (24mo)', value: String(c.crashTotal) },
        { label: 'Injury crashes', value: String(c.injCrash ?? 0) },
        { label: 'Fleet size', value: c.powerUnits ? `${c.powerUnits} power units` : 'Unknown' },
        ...(perTruck ? [{ label: 'Crashes per truck', value: perTruck }] : []),
      ],
      recommendation: 'For context, the average US fleet sees roughly 0.2–0.4 reportable crashes per truck per year.',
    });
  }

  if (c.webPresence?.configured) {
    if (c.webPresence.found) {
      // Name-mismatch is a marketing / SEO signal, not a fraud signal.
      // Many legit carriers run on a brand-style domain (Apollo Freight
      // Systems Inc → owneroperatorsapollo.com). We deliberately do NOT
      // flag it; the report still surfaces the mismatch in a neutral
      // badge for transparency, but it does not affect the score.
      if (c.webPresence.domainAgeDays != null && c.webPresence.domainAgeDays <= 90) {
        flags.push({
          sev: 'warning',
          title: `Website domain registered ${c.webPresence.domainAgeDays} day${c.webPresence.domainAgeDays === 1 ? '' : 's'} ago`,
          desc: 'Brand-new website is a textbook freight-fraud signal.',
          pts: 25,
          details: 'Established carriers have domains that are years old. A website registered in the last 3 months for an MC that\'s also new is the classic "ghost broker" setup.',
          metrics: [
            { label: 'Domain age', value: `${c.webPresence.domainAgeDays} days` },
            { label: 'Domain', value: c.webPresence.domain || '—' },
          ],
          recommendation: 'Do not trust contact info from this website without independent verification.',
        });
      }
      if (c.webPresence.hasMx === false) {
        flags.push({
          sev: 'info',
          title: 'Carrier website has no email server',
          desc: 'The website domain has no MX records — they can\'t receive email at @' + c.webPresence.domain + '.',
          pts: 5,
          details: 'Many small carriers use Gmail and never set up email on their own domain. Not a hard red flag, but combined with other signals it adds suspicion.',
        });
      }
    } else if (!c.webPresence.error) {
      flags.push({
        sev: 'info',
        title: 'No website found',
        desc: 'Couldn\'t find a public website for this carrier.',
        pts: 5,
        details: 'Many small carriers operate without a website, so this isn\'t conclusive on its own. Combined with new authority + missing insurance, it strengthens the suspicion.',
      });
    }
  }

  if (c.addressCheck?.configured) {
    if (c.addressCheck.found && c.addressCheck.isMailbox) {
      flags.push({
        sev: 'warning',
        title: 'Address is a mail-forwarding service',
        desc: `Their on-file address resolves to ${c.addressCheck.mailboxProvider || 'a mail box rental'}, not a real business location.`,
        pts: 25,
        details: 'Freight fraud often uses commercial mail receiving agencies (UPS Store, iPostal1, etc.) so the operator can\'t be physically located. Some legitimate small carriers use them too, but combined with other flags it is a strong signal.',
        metrics: [
          { label: 'On file', value: c.address || '—' },
          { label: 'Resolves to', value: c.addressCheck.matchedName || '—' },
          { label: 'Provider', value: c.addressCheck.mailboxProvider || 'Mail box rental' },
        ],
        recommendation: 'Ask the carrier for a physical operating address (terminal/yard) and verify with a phone call.',
      });
    } else if (!c.addressCheck.found && c.address) {
      flags.push({
        sev: 'info',
        title: 'Address could not be verified',
        desc: 'Google Places couldn\'t locate their on-file physical address.',
        pts: 5,
        details: 'Not necessarily fraud — small businesses sometimes have addresses that don\'t resolve cleanly. But combined with other signals (new authority, missing insurance) it adds suspicion.',
      });
    } else if (c.addressCheck.found && c.addressCheck.businessStatus === 'CLOSED_PERMANENTLY') {
      flags.push({
        sev: 'warning',
        title: 'Business at this address is closed permanently',
        desc: 'Google Places lists the business at the on-file address as permanently closed.',
        pts: 20,
        recommendation: 'Verify the carrier\'s current operating location before booking.',
      });
    } else if (
      c.addressCheck.found
      && !c.addressCheck.isMailbox
      && c.addressCheck.matchedName
      && c.name
      && !carrierNamesMatch(c.name, c.addressCheck.matchedName)
    ) {
      // The address resolves to a real business — but a DIFFERENT one than
      // the carrier we're checking. Classic shell-broker pattern: the
      // registered "office" is just a coworking suite, executive-suite
      // service, or a real tenant whose mailing address got reused.
      const fmcsaSuite = extractSuite(c.address);
      const placesSuite = extractSuite(c.addressCheck.matchedAddress);
      const suiteMismatch = fmcsaSuite && placesSuite && fmcsaSuite !== placesSuite;
      flags.push({
        sev: 'warning',
        title: 'Address resolves to a different business',
        desc: `FMCSA lists ${c.name} at this address, but Google Places shows ${c.addressCheck.matchedName} as the business there${suiteMismatch ? ` (in ${placesSuite}, not ${fmcsaSuite})` : ''}. Could be a shared executive-suite / coworking address used by a shell broker.`,
        pts: 25,
        details: 'A common ghost-broker pattern: register an MC at a multi-tenant office building so the address looks legitimate, but no actual business operates there under the carrier name. Verify by phone, ask for a photo of their yard or terminal, or call the building manager.',
        metrics: [
          { label: 'FMCSA name', value: c.name },
          { label: 'Business at address', value: c.addressCheck.matchedName },
          ...(fmcsaSuite ? [{ label: 'FMCSA suite', value: fmcsaSuite }] : []),
          ...(placesSuite ? [{ label: 'Places suite', value: placesSuite }] : []),
        ],
        recommendation: 'Do not assume "verified business" means this carrier exists. Phone the carrier and the building.',
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
  'ltd', 'limited', 'lp', 'llp', 'pllc', 'pa', 'pc',
  'the', 'and', '&', 'group', 'holdings',
]);

function tokenizeName(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !NAME_NOISE.has(w));
}

// Two carrier names "match" if they share at least one significant token
// (after stripping LLC/Inc/etc. and "the"/"and"/etc.). Two completely
// different companies share zero tokens. False positive risk is low because
// we strip generic words, but we DO accept partial overlap as a match —
// e.g., "Acme Freight" matches "Acme Logistics Group" because they share
// "acme". The Gray Falcon vs Roadrunner Freight pair shares no tokens.
function carrierNamesMatch(a: string, b: string): boolean {
  const ta = tokenizeName(a);
  const tb = tokenizeName(b);
  if (ta.length === 0 || tb.length === 0) return true; // can't compare → don't false-flag
  const set = new Set(ta);
  return tb.some((t) => set.has(t));
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
