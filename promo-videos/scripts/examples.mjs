// Example data for recording screens that need live keys or a real login (carrier
// reports, COI check, Your company). The recorders serve these in place of the API
// responses, so the app's real UI renders them. Companies are the site's vetted fictional
// names (commit 84f1862); phone numbers are 555 numbers; domains don't exist; MC/DOT are
// masked like in the reels. Shapes follow lib/fmcsa.ts CarrierReport, lib/coi-check.ts
// CoiReport, lib/fmcsa-inspections.ts SafetyActivity and app/api/profile/*.
const NOW = '2026-10-15T14:00:00Z';

const sources = (extra = []) => [
  { name: 'FMCSA registry', ok: true, note: 'Authority, insurance, safety, crashes' },
  { name: 'FMCSA census (MCS-150)', ok: true, note: 'Officers, phone and email on file' },
  { name: 'Authority history', ok: true, note: 'Every grant and revocation since first filing' },
  { name: 'Google Places', ok: true, note: 'Business listed under their name' },
  { name: 'Web presence', ok: true, note: 'Website confirmed via Google listing' },
  { name: 'Web reputation', ok: true, note: 'No fraud mentions found' },
  ...extra,
];

// A clean broker: officers, phone and email on the FMCSA filing.
export const QUILLMONT = {
  name: 'QUILLMONT FREIGHT SOLUTIONS LLC',
  dba: 'Quillmont Freight',
  mc: '612•••',
  dot: '3271•••',
  address: '2200 Riverside Dr, Columbus, OH 43221',
  phone: '(555) 019-7744',
  officers: ['Laura Bennett', 'Victor Hale'],
  fmcsaEmail: 'dispatch@quillmontfreight.com',
  emailDomain: 'quillmontfreight.com',
  censusAsOf: '2026-08-21',
  authorityStatus: 'Active',
  commonAuthority: 'Not authorized',
  brokerAuthority: 'Active',
  contractAuthority: 'Not authorized',
  authorityAge: '9y 7m',
  authorityGrantDate: '2017-03-14',
  authorityHistory: { checked: true, firstGrantDate: '2017-03-14', ageMonths: 115, activeSince: '2017-03-14' },
  safetyRating: 'Not rated',
  outOfService: false,
  allowedToOperate: true,
  bondOnFile: 75,
  insuranceSummary: '$75,000 broker bond on file',
  mcs150Date: '2026-08-21',
  mcs150Outdated: false,
  powerUnits: 0,
  drivers: 0,
  operation: 'Interstate',
  addressCheck: { configured: true, found: true, matchedName: 'Quillmont Freight Solutions', matchedAddress: '2200 Riverside Dr, Columbus, OH 43221', types: ['point_of_interest'], businessStatus: 'OPERATIONAL', addressMatched: true, nameMatches: true },
  webPresence: { configured: true, found: true, domain: 'quillmontfreight.com', url: 'https://quillmontfreight.com', title: 'Quillmont Freight Solutions | Freight brokerage', snippet: 'Licensed freight broker since 2017.', nameMatch: true, verified: true, verifiedBy: 'address', addressMatch: true, phoneMatch: true, domainAgeDays: 3480, hasMx: true, hasSpf: true, socials: [] },
  webReputation: { configured: true, ok: true, hits: [], reviewHits: [], queriesRun: 5 },
  sources: sources(),
  source: 'fmcsa',
  dataSource: 'fmcsa-live',
  fetchedAt: NOW,
  matchedBy: 'name',
  searchedFor: 'Quillmont Freight',
  score: 0,
  verdict: 'low',
  flags: [],
};

// A 12-year-old carrier whose authority was dead for 27 months and came back in April.
export const IRONVALE = {
  name: 'IRONVALE FREIGHT LINES LLC',
  mc: '118•••',
  dot: '3561•••',
  address: '4120 Commerce Pkwy, Columbus, OH 43228',
  phone: '(555) 014-8820',
  officers: ['Dana Whitfield', 'Marco Ruiz'],
  fmcsaEmail: 'dispatch@ironvalefreightlines.com',
  emailDomain: 'ironvalefreightlines.com',
  censusAsOf: '2026-04-02',
  authorityStatus: 'Active',
  commonAuthority: 'Active',
  brokerAuthority: 'Not authorized',
  authorityAge: '12y 4m · reactivated 6 months ago',
  authorityGrantDate: '2014-06-11',
  authorityHistory: { checked: true, firstGrantDate: '2014-06-11', ageMonths: 148, activeSince: '2026-04-02', reactivatedDate: '2026-04-02', dormantMonths: 27 },
  safetyRating: 'Satisfactory',
  outOfService: false,
  allowedToOperate: true,
  bipdOnFile: 1000,
  bipdRequired: 750,
  cargoOnFile: 100,
  cargoRequired: true,
  insuranceSummary: '$1,000,000 liability · $100,000 cargo',
  mcs150Date: '2026-04-02',
  mcs150Outdated: false,
  powerUnits: 14,
  drivers: 16,
  operation: 'Interstate',
  crashTotal: 1,
  fatalCrash: 0,
  injCrash: 1,
  driverOosRate: 2.44,
  driverOosRateNat: 6.67,
  vehicleOosRate: 24.32,
  vehicleOosRateNat: 22.26,
  driverInspections: 41,
  driverOosInspections: 1,
  vehicleInspections: 37,
  vehicleOosInspections: 9,
  addressCheck: { configured: true, found: true, matchedName: 'Ironvale Freight Lines', matchedAddress: '4120 Commerce Pkwy, Columbus, OH 43228', types: ['moving_company'], businessStatus: 'OPERATIONAL', addressMatched: true, nameMatches: true },
  webPresence: { configured: true, found: true, domain: 'ironvalefreightlines.com', url: 'https://ironvalefreightlines.com', title: 'Ironvale Freight Lines | Midwest Dry Van', snippet: 'Asset-based carrier.', nameMatch: true, verified: true, verifiedBy: 'address', addressMatch: true, phoneMatch: true, domainAgeDays: 4310, hasMx: true, hasSpf: true, socials: [] },
  webReputation: { configured: true, ok: true, hits: [], reviewHits: [], queriesRun: 5 },
  sms: {
    configured: true,
    fetched: true,
    dot: '3561•••',
    carrier: { totalTrucks: 14, totalDrivers: 16, carrierOperation: 'Interstate', cargoHauled: 'General Freight', mcs150Mileage: 1240000, mcs150MileageYear: '2025', hazmatCarrier: false },
    basics: {
      unsafeDriving: { measure: 1.2, inspections: 18, alert: false, percentile: 22 },
      hoursOfService: { measure: 0.8, inspections: 41, alert: false, percentile: 31 },
      vehicleMaintenance: { measure: 4.9, inspections: 37, alert: false, percentile: 58 },
    },
    inspections: { vehicleInspections: 37, driverInspections: 41, vehicleOosCount: 9, driverOosCount: 1, vehicleOosPct: 24.3, driverOosPct: 2.4, vehicleNationalAvgPct: 22.26, driverNationalAvgPct: 6.67 },
    crashes: { total: 1, fatal: 0, injury: 1, towaway: 0 },
    lastUpdate: '2026-09-26',
    fetchedAt: NOW,
  },
  sources: sources([{ name: 'FMCSA SMS', ok: true, note: '78 inspections · no BASIC alerts' }]),
  source: 'fmcsa',
  dataSource: 'fmcsa-live',
  fetchedAt: NOW,
  matchedBy: 'name',
  searchedFor: 'Ironvale Freight',
  score: 35,
  verdict: 'medium',
  flags: [
    {
      sev: 'critical',
      title: 'Authority recently reactivated',
      desc: 'Authority became active again on 2026-04-02 after 2y 3m with no active authority.',
      pts: 30,
      details: 'A common freight fraud pattern is to buy or reactivate a dormant MC number, so the company looks long-established while the people behind it are new.',
      metrics: [
        { label: 'First granted', value: '2014-06-11' },
        { label: 'Reactivated', value: '2026-04-02' },
        { label: 'Inactive before that', value: '2y 3m' },
      ],
      recommendation: 'Verify identity via an independent channel. Require payment upfront if you proceed.',
    },
    { sev: 'info', title: 'Vehicle OOS rate 24.3% · above average', desc: 'National average 22.26%. Based on 9 of 37 inspections in 24 months.', pts: 5 },
  ],
};

// A clean carrier, for the shareable PDF report (nothing in the FMCSA census is named
// Braxtone; braxtonetransport.com doesn't resolve).
export const BRAXTONE = {
  ...IRONVALE,
  name: 'BRAXTONE TRANSPORT LLC',
  dba: 'Braxtone Transport',
  mc: '305•••',
  dot: '2741•••',
  address: '1450 Lakeview Dr, Fort Wayne, IN 46808',
  phone: '(555) 017-2290',
  officers: ['Nina Calloway', 'Evan Brooks'],
  fmcsaEmail: 'dispatch@braxtonetransport.com',
  emailDomain: 'braxtonetransport.com',
  censusAsOf: '2026-07-09',
  authorityAge: '8y 2m',
  authorityGrantDate: '2018-08-02',
  authorityHistory: { checked: true, firstGrantDate: '2018-08-02', ageMonths: 98, activeSince: '2018-08-02' },
  mcs150Date: '2026-07-09',
  powerUnits: 22,
  drivers: 24,
  crashTotal: 0,
  injCrash: 0,
  driverOosRate: 1.79,
  vehicleOosRate: 14.29,
  driverInspections: 56,
  driverOosInspections: 1,
  vehicleInspections: 49,
  vehicleOosInspections: 7,
  addressCheck: { configured: true, found: true, matchedName: 'Braxtone Transport', matchedAddress: '1450 Lakeview Dr, Fort Wayne, IN 46808', types: ['moving_company'], businessStatus: 'OPERATIONAL', addressMatched: true, nameMatches: true },
  webPresence: { configured: true, found: true, domain: 'braxtonetransport.com', url: 'https://braxtonetransport.com', title: 'Braxtone Transport | Dry van & reefer', snippet: 'Asset-based carrier.', nameMatch: true, verified: true, verifiedBy: 'address', addressMatch: true, phoneMatch: true, domainAgeDays: 2950, hasMx: true, hasSpf: true, socials: [] },
  sms: {
    ...IRONVALE.sms,
    dot: '2741•••',
    carrier: { totalTrucks: 22, totalDrivers: 24, carrierOperation: 'Interstate', cargoHauled: 'General Freight', mcs150Mileage: 1980000, mcs150MileageYear: '2025', hazmatCarrier: false },
    basics: {
      unsafeDriving: { measure: 0.9, inspections: 21, alert: false, percentile: 18 },
      hoursOfService: { measure: 0.6, inspections: 56, alert: false, percentile: 24 },
      vehicleMaintenance: { measure: 3.1, inspections: 49, alert: false, percentile: 36 },
    },
    inspections: { vehicleInspections: 49, driverInspections: 56, vehicleOosCount: 7, driverOosCount: 1, vehicleOosPct: 14.3, driverOosPct: 1.8, vehicleNationalAvgPct: 22.26, driverNationalAvgPct: 6.67 },
    crashes: { total: 0, fatal: 0, injury: 0, towaway: 0 },
  },
  sources: sources([{ name: 'FMCSA SMS', ok: true, note: '105 inspections · no BASIC alerts' }]),
  searchedFor: 'Braxtone Transport',
  score: 0,
  verdict: 'low',
  flags: [],
};

// FMCSA inspection-file rows for the Braxtone PDF (the Socrata shapes lib/fmcsa-inspections.ts
// reads): 56 inspections in 24 months as its SMS numbers say (7 vehicle and 1 driver
// out-of-service), no crashes.
const SPOTS = [['OH', 'I-70 WB MM 21'], ['IN', 'I-69 NB SCALE'], ['KY', 'I-65 SB SCALE'], ['IL', 'I-57 NB MM 332'], ['MI', 'I-94 EB SCALE'], ['TN', 'I-40 WB MM 4'], ['MO', 'I-44 EB SCALE']];
const OOS_V = new Set([5, 12, 19, 27, 33, 41, 50]);
const VIOL = new Set([0, 8, 15, 24, 30, 37, 45, 52]);
export const BRAXTONE_INSPECTION_ROWS = Array.from({ length: 56 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 8, 29) - i * 12.5 * 86400000);
  const [state, loc] = SPOTS[(i + Math.floor(i / 7)) % SPOTS.length];
  const vOos = OOS_V.has(i) ? 1 : 0;
  const dOos = i === 22 ? 1 : 0;
  const viol = vOos || dOos ? 2 : VIOL.has(i) ? 1 : 0;
  return { inspection_id: String(91000001 + i), insp_date: d.toISOString().slice(0, 10).replace(/-/g, ''), report_state: state, location_desc: loc, insp_level_id: String((i % 3) + 1), viol_total: String(viol), oos_total: String(vOos + dOos), driver_oos_total: String(dOos), vehicle_oos_total: String(vOos), hazmat_oos_total: '0', post_acc_ind: 'N' };
});
export const BRAXTONE_VIOLATION_ROWS = BRAXTONE_INSPECTION_ROWS.flatMap((r, i) =>
  OOS_V.has(i) ? [{ inspection_id: r.inspection_id, viol_code: '396.3(a)(1)', viol_desc: 'Brakes out of adjustment', out_of_service_indicator: 'Y', insp_viol_unit: '1' }, { inspection_id: r.inspection_id, viol_code: '393.9', viol_desc: 'Inoperable required lamp', out_of_service_indicator: 'N', insp_viol_unit: '1' }]
  : i === 22 ? [{ inspection_id: r.inspection_id, viol_code: '395.8(e)', viol_desc: 'False report of drivers record of duty status', out_of_service_indicator: 'Y', insp_viol_unit: 'D' }, { inspection_id: r.inspection_id, viol_code: '392.2', viol_desc: 'Local laws (general)', out_of_service_indicator: 'N', insp_viol_unit: 'D' }]
  : VIOL.has(i) ? [{ inspection_id: r.inspection_id, viol_code: '393.9', viol_desc: 'Inoperable required lamp', out_of_service_indicator: 'N', insp_viol_unit: '1' }] : []
);

// Roadside inspections & crashes (last 24 months) for a report's panel.
export const safetyActivity = (dot) => {
  const months = [];
  const pattern = [3, 2, 4, 3, 5, 2, 3, 4, 2, 3, 5, 3, 4, 2, 3, 4, 3, 2, 4, 3, 5, 3, 4, 3];
  for (let i = 0; i < 24; i++) {
    const d = new Date(Date.UTC(2024, 10 + i, 1));
    const n = pattern[i];
    months.push({ month: d.toISOString().slice(0, 7), clean: Math.max(0, n - (i % 3 === 0 ? 2 : 1)), violations: i % 3 === 0 ? 1 : 1, oos: i % 4 === 1 ? 1 : 0, crashes: i === 15 ? 1 : 0 });
  }
  return {
    dot,
    months: 24,
    since: '2024-10-15',
    fetchedAt: NOW,
    inspections: {
      total: 78,
      clean: 49,
      withViolations: 20,
      oos: 9,
      driverOos: 1,
      vehicleOos: 8,
      truncated: false,
      last: { id: 'i1', date: '2026-10-06', state: 'IN', location: 'Gary', level: 2, levelLabel: 'Level II · walk-around', violations: 1, oos: 0, driverOos: 0, vehicleOos: 0, hazmatOos: 0, postCrash: false },
      recent: [
        { id: 'i1', date: '2026-10-06', state: 'IN', location: 'Gary', level: 2, levelLabel: 'Level II · walk-around', violations: 1, oos: 0, driverOos: 0, vehicleOos: 0, hazmatOos: 0, postCrash: false, details: [{ code: '393.9', desc: 'Inoperable required lamp', oos: false, unit: 'vehicle' }] },
        { id: 'i2', date: '2026-09-24', state: 'WY', location: 'Laramie', level: 1, levelLabel: 'Level I · full inspection', violations: 0, oos: 0, driverOos: 0, vehicleOos: 0, hazmatOos: 0, postCrash: false, details: [] },
      ],
    },
    crashes: { total: 1, fatal: 0, injury: 1, towAway: 1, fatalities: 0, injuries: 1, last: { id: 'c1', date: '2026-02-18', state: 'TX', city: 'Amarillo', location: 'I-40', fatalities: 0, injuries: 1, towAway: true }, recent: [{ id: 'c1', date: '2026-02-18', state: 'TX', city: 'Amarillo', location: 'I-40', fatalities: 0, injuries: 1, towAway: true }] },
    byMonth: months,
    last30: { inspections: 2, withViolations: 1, oos: 0, crashes: 0 },
  };
};

// A certificate that says $1M is in force, while FMCSA shows the policy being cancelled
// in 12 days (as on the homepage's COI example).
export const COI_MISMATCH = {
  kind: 'coi',
  verdict: 'mismatch',
  verdictLabel: 'Doesn’t match FMCSA filings — don’t accept until the insurer confirms',
  score: 40,
  checks: [
    { status: 'fail', title: 'Cancellation pending on FMCSA', detail: 'FMCSA shows policy GP-4471209 by GRANITE PLAINS MUTUAL INSURANCE CO with a cancellation effective Oct 27, 2026. Confirm the policy is still in force before dispatching.', source: 'FMCSA insurance filings (data.transportation.gov)' },
    { status: 'pass', title: 'Insured company matches the FMCSA record', detail: '"Kestrelon Freight Group LLC" matches KESTRELON FREIGHT GROUP LLC (MC-441•••).', source: 'FMCSA carrier record' },
    { status: 'pass', title: 'Auto liability policy is filed with FMCSA', detail: 'Policy GP-4471209 matches the BIPD/Primary filing by GRANITE PLAINS MUTUAL INSURANCE CO, effective Mar 1, 2026 — the same date as on the certificate.', source: 'FMCSA insurance filings (data.transportation.gov)' },
    { status: 'pass', title: 'No signs of editing in the PDF metadata', detail: 'Creation and modification data look consistent with an unedited document.', source: 'PDF metadata' },
    { status: 'info', title: 'Before you accept: call the insurer', detail: "Use a phone number from the insurer's own website, or the carrier's FMCSA-listed phone (555) 016-4410 — not a number printed on the certificate.", source: 'Haulock recommendation' },
  ],
  extraction: {
    is_coi: true,
    insurers: [{ letter: 'A', name: 'Granite Plains Mutual Insurance Co', naic: '' }],
    insured_name: 'Kestrelon Freight Group LLC',
    insured_address: '880 Industrial Blvd, Joplin, MO 64801',
    insured_mc: '441•••',
    insured_dot: null,
    producer_name: 'Lakeshore Truck Insurance Agency',
    producer_phone: '(555) 018-3301',
    producer_email: 'certs@lakeshoretruckins.com',
    certificate_date: '2026-10-10',
    certificate_holder: 'Your Brokerage LLC',
    irregularities: [],
    policies: [
      { coverage: 'auto_liability', insurer_letter: 'A', insurer_name: 'Granite Plains Mutual Insurance Co', naic: '', policy_number: 'GP-4471209', effective_date: '2026-03-01', expiration_date: '2027-03-01', limit_amount: 1000000 },
      { coverage: 'cargo', insurer_letter: 'A', insurer_name: 'Granite Plains Mutual Insurance Co', naic: '', policy_number: 'GP-CG-7712', effective_date: '2026-03-01', expiration_date: '2027-03-01', limit_amount: 100000 },
    ],
  },
  carrier: { name: 'KESTRELON FREIGHT GROUP LLC', mc: '441•••', dot: '2984•••', phone: '(555) 016-4410', authority: 'ACTIVE', outOfService: false, bipdOnFileK: 1000, bipdRequiredK: 750 },
  filings: [{ coverage: 'BIPD/Primary', formCode: '91X', insurer: 'GRANITE PLAINS MUTUAL INSURANCE CO', policyNumber: 'GP-4471209', maxCoverageK: 1000, underlyingK: 0, postedDate: '2026-02-24', effectiveDate: '2026-03-01', cancelEffectiveDate: '2026-10-27' }],
  forensics: null,
  compared: true,
  identifiedBy: 'certificate',
  dataAsOf: '2026-10-14',
  checkedAt: NOW,
  filename: 'coi-kestrelon-freight.pdf',
  name: 'KESTRELON FREIGHT GROUP LLC',
  mc: '441•••',
  dot: '2984•••',
  disclaimer: "Automated comparison of the document provided with public FMCSA insurance filings (FMCSA data updated Oct 14, 2026) and the PDF's metadata. It is not a finding that any company acted improperly. Example data.",
};

// Your company: verified, monitored, and how often it was checked (counts only).
export const OWN_SCORE = {
  ownMc: '847•••',
  ownDot: null,
  report: { name: 'KEYSTONE FREIGHT NETWORK', mc: '847•••', dot: '1827•••', score: 12, verdict: 'low', flags: [], authorityStatus: 'Active', insuranceSummary: '$1M on file', bipdOnFile: 1000, outOfService: false, safetyRating: 'Satisfactory', cached: true, cachedAt: NOW },
};
const WEEK_COUNTS = [2, 1, 3, 0, 2, 4, 3, 5, 2, 6, 4, 7];
export const COMPANY = {
  hasCompany: true,
  paid: true,
  mc: '847•••',
  dot: null,
  usdot: '1827•••',
  verified: { by: 'domain', at: '2026-09-02T14:00:00Z' },
  monitoring: { on: true, lastChecked: '2026-10-15T06:00:00Z', lastChangeAt: null },
  checks: {
    last7: 7,
    last30: 23,
    distinctAccounts30: 9,
    weeks: WEEK_COUNTS.map((count, i) => ({ weekStart: new Date(Date.UTC(2026, 6, 27 + i * 7)).toISOString().slice(0, 10), count })),
    lastCheckedDaysAgo: 1,
    byKind30: { lookups: 17, rateCons: 4, cois: 2 },
  },
};
