import type { CarrierReport, RiskFlag } from './fmcsa';

export function scoreCarrier(c: CarrierReport): CarrierReport {
  const flags: RiskFlag[] = [...c.flags];

  if (c.authorityStatus && c.authorityStatus !== 'Active') {
    flags.push({
      sev: 'critical',
      title: 'Operating authority is not active',
      desc: `FMCSA reports authority as "${c.authorityStatus}". Do not book.`,
      pts: 50,
      details: 'Authority must be "Active" for a carrier to legally haul freight in interstate commerce. Inactive, revoked, or suspended status means any load picked up could be seized and the carrier has no recourse for payment.',
      recommendation: 'Do not book. Ask the broker to use a carrier with active authority.',
    });
  }

  if (c.outOfService) {
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

  if (c.cargoRequired && c.cargoOnFile === 0) {
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

  if (c.safetyRating && /unsatisfactory|conditional/i.test(c.safetyRating)) {
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

  if (c.driverOosRate != null && c.driverOosRateNat != null && c.driverOosRate > c.driverOosRateNat * 1.5) {
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

  if (c.vehicleOosRate != null && c.vehicleOosRateNat != null && c.vehicleOosRate > c.vehicleOosRateNat * 1.5) {
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
  } else if (c.vehicleOosRate != null && c.vehicleOosRateNat != null && c.vehicleOosRate > c.vehicleOosRateNat) {
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

  if (c.fatalCrash && c.fatalCrash > 0) {
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

  if (c.crashTotal != null && c.crashTotal >= 10 && (!c.fatalCrash || c.fatalCrash === 0)) {
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
      if (c.webPresence.nameMatch === false) {
        flags.push({
          sev: 'warning',
          title: 'Website domain doesn\'t match company name',
          desc: `Found a candidate website (${c.webPresence.domain}) but its domain doesn't include the legal name.`,
          pts: 10,
          details: 'A legitimate carrier usually owns a domain that matches their business name (e.g. "Acme Freight" → acmefreight.com). When the search-result domain looks unrelated, the website may be a misattributed result OR (worse) a generic placeholder set up to look legit.',
          recommendation: 'Verify the domain is actually theirs before trusting any contact info from it.',
        });
      }
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
    }
  }

  const score = Math.min(100, flags.reduce((s, f) => s + f.pts, 0));
  const verdict: CarrierReport['verdict'] = score >= 61 ? 'high' : score >= 31 ? 'medium' : 'low';
  return { ...c, score, verdict, flags };
}
