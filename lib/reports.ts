import { DRIVER_REPORTS_ON } from './features';
// Verified reports: who may report whom, what a report must contain, and how
// published reports count in the Haulock score. Free for every account.
//
// The rules exist to keep reports factual and the reporter accountable:
//   - only a verified reporter (company via its FMCSA email, driver via an ID
//     check, shipper via a work email) can file one;
//   - a report is one load: a fixed category, a load number, a date, facts
//     and at least one supporting document;
//   - an admin approves it before anyone sees it, and never edits the text;
//   - the reported company is told and can reply publicly;
//   - the score counts each reporter once per company, by a fixed rule.

export type ReporterRole = 'carrier' | 'broker' | 'driver' | 'shipper';
export type SubjectType = 'carrier' | 'broker' | 'shipper';
export type ReportStatus = 'pending' | 'published' | 'rejected' | 'withdrawn';

export const ROLE_LABEL: Record<ReporterRole, string> = {
  carrier: 'Carrier',
  broker: 'Broker',
  driver: 'Driver',
  shipper: 'Shipper',
};

// Who may report whom. A company never reports its own side of the load:
// carriers report the broker or shipper they hauled for, brokers the carrier
// or shipper, drivers the carrier or broker they drove for, shippers the
// carrier or broker that moved their freight.
const SUBJECTS_FOR: Record<ReporterRole, SubjectType[]> = {
  carrier: ['broker', 'shipper'],
  broker: ['carrier', 'shipper'],
  driver: ['carrier', 'broker'],
  shipper: ['carrier', 'broker'],
};

export function allowedSubjects(role: ReporterRole): SubjectType[] {
  return SUBJECTS_FOR[role] || [];
}

export type ReportCategory = {
  id: string;
  label: string;
  subjects: SubjectType[];
  // Only these reporters see it; everyone allowed to report the subject otherwise.
  roles?: ReporterRole[];
  amount?: 'required' | 'optional';
};

// Fixed, factual categories: something that happened on a load and that a
// document can show. No "scammer", no "rude".
export const REPORT_CATEGORIES: ReportCategory[] = [
  // About a broker
  { id: 'non_payment', label: 'Didn’t pay for a delivered load', subjects: ['broker', 'shipper'], roles: ['carrier'], amount: 'required' },
  { id: 'short_payment', label: 'Paid less than the rate confirmation', subjects: ['broker', 'shipper'], roles: ['carrier'], amount: 'required' },
  { id: 'late_payment', label: 'Paid more than 30 days late', subjects: ['broker', 'shipper'], roles: ['carrier'], amount: 'optional' },
  { id: 'cancelled_no_tonu', label: 'Cancelled after dispatch, no truck-ordered-not-used paid', subjects: ['broker', 'shipper'], roles: ['carrier'], amount: 'optional' },
  { id: 'rebrokered_load', label: 'Gave the load to another broker or carrier without consent', subjects: ['broker', 'carrier'], roles: ['carrier', 'broker', 'shipper'] },
  { id: 'identity_misuse', label: 'Used another company’s name or MC number', subjects: ['broker', 'carrier'] },
  // About a carrier
  { id: 'no_show', label: 'Didn’t pick up a booked load', subjects: ['carrier'], roles: ['broker', 'shipper'] },
  { id: 'freight_held', label: 'Held the freight to demand more money', subjects: ['carrier'], roles: ['broker', 'shipper'], amount: 'optional' },
  { id: 'not_delivered', label: 'Picked up the load and never delivered it', subjects: ['carrier'], roles: ['broker', 'shipper'], amount: 'optional' },
  { id: 'damage_claim_unpaid', label: 'Damaged cargo and didn’t pay the claim', subjects: ['carrier'], roles: ['broker', 'shipper'], amount: 'required' },
  { id: 'altered_documents', label: 'Sent altered documents (rate con, BOL, POD or COI)', subjects: ['carrier', 'broker'] },
  // From a driver about the company they drove for
  { id: 'driver_unpaid', label: 'Didn’t pay for a completed load or pay period', subjects: ['carrier', 'broker'], roles: ['driver'], amount: 'required' },
  { id: 'driver_deductions', label: 'Took deductions that weren’t in the agreement', subjects: ['carrier'], roles: ['driver'], amount: 'required' },
  { id: 'driver_escrow', label: 'Didn’t return escrow or a deposit', subjects: ['carrier'], roles: ['driver'], amount: 'required' },
  { id: 'driver_rate_changed', label: 'Showed the driver a lower rate than the broker’s rate con', subjects: ['carrier'], roles: ['driver'], amount: 'optional' },
  // About a shipper
  { id: 'detention_unpaid', label: 'Held the truck and didn’t pay detention', subjects: ['shipper'], roles: ['carrier', 'broker'], amount: 'optional' },
  { id: 'freight_misdescribed', label: 'Freight didn’t match what was booked (weight, size or type)', subjects: ['shipper'], roles: ['carrier', 'broker'] },
  { id: 'shipper_unpaid', label: 'Didn’t pay the freight bill', subjects: ['shipper'], roles: ['broker'], amount: 'required' },
];

export function categoriesFor(role: ReporterRole, subject: SubjectType): ReportCategory[] {
  if (!allowedSubjects(role).includes(subject)) return [];
  return REPORT_CATEGORIES.filter((c) => c.subjects.includes(subject) && (!c.roles || c.roles.includes(role)));
}

export function categoryLabel(id: string): string {
  return REPORT_CATEGORIES.find((c) => c.id === id)?.label || 'Other';
}

// ---------- Reporter identity ----------

export type DriverVerification = { name: string; state?: string | null; at: string; by: 'identity'; sessionId?: string };
export type ShipperVerification = { company: string; domain: string; at: string; by: 'work_email' };

export type ReporterIdentity =
  | { kind: 'company'; mc: string | null; dot: string | null; verifiedBy: 'email' | 'domain' | 'code'; at: string }
  | { kind: 'driver'; name: string; state?: string | null; verifiedBy: 'identity'; at: string }
  | { kind: 'shipper'; company: string; domain: string; verifiedBy: 'work_email'; at: string };

const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '').replace(/^0+/, '');

export function reporterKey(args: { role: ReporterRole; dot?: string | null; mc?: string | null; userId?: string; domain?: string }): string {
  if (args.role === 'driver') return `driver:${args.userId}`;
  if (args.role === 'shipper') return `shipper:${String(args.domain || '').toLowerCase()}`;
  const dot = digits(args.dot);
  return dot ? `dot:${dot}` : `mc:${digits(args.mc)}`;
}

// Shippers aren't in FMCSA: the same shipper is the same name in the same state.
export function shipperKey(name: string, state?: string | null): string {
  const n = String(name || '').toUpperCase().replace(/\b(LLC|L\.L\.C|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LP)\b\.?/g, ' ').replace(/[^A-Z0-9]+/g, ' ').trim().replace(/\s+/g, '-');
  return `shipper:${n}|${String(state || '').toUpperCase().slice(0, 2)}`;
}

export function subjectKey(args: { type: SubjectType; dot?: string | null; mc?: string | null; name?: string; state?: string | null }): string {
  if (args.type === 'shipper') return shipperKey(args.name || '', args.state);
  const dot = digits(args.dot);
  return dot ? `dot:${dot}` : `mc:${digits(args.mc)}`;
}

// ---------- What a report must contain ----------

export const EVIDENCE_MAX_FILES = 4;
export const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;
export const EVIDENCE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
export const DESCRIPTION_MIN = 40;
export const DESCRIPTION_MAX = 1200;
export const RESPONSE_MAX = 1200;

export type ReportInput = {
  reporterRole: ReporterRole;
  subjectType: SubjectType;
  category: string;
  loadRef: string;
  incidentDate: string; // YYYY-MM-DD
  amount?: number | null;
  description: string;
  attested: boolean;
  evidenceCount: number;
  // Drivers: documents proving they drove for the company (settlement, pay
  // stub, dispatch sheet, lease, onboarding form). Required for drivers.
  proofCount?: number;
  // Drivers may keep their name off the public report; their identity is
  // still verified and stored. Companies are always named.
  anonymous?: boolean;
};

export function validateReportInput(i: ReportInput, today: string = new Date().toISOString().slice(0, 10)): string[] {
  const errors: string[] = [];
  if (!allowedSubjects(i.reporterRole).includes(i.subjectType)) {
    errors.push(`A ${ROLE_LABEL[i.reporterRole].toLowerCase()} can report a ${allowedSubjects(i.reporterRole).join(' or ')}, not a ${i.subjectType}.`);
    return errors;
  }
  const cat = categoriesFor(i.reporterRole, i.subjectType).find((c) => c.id === i.category);
  if (!cat) errors.push('Pick what happened from the list.');
  if (!String(i.loadRef || '').trim() || String(i.loadRef).trim().length > 60) errors.push('Enter the load or reference number from the rate con or BOL.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.incidentDate) || Number.isNaN(Date.parse(`${i.incidentDate}T00:00:00Z`))) errors.push('Enter the date it happened.');
  else if (i.incidentDate > today) errors.push('The date can’t be in the future.');
  else if (i.incidentDate < '2015-01-01') errors.push('The date is too far back.');
  if (i.amount != null && (!Number.isFinite(i.amount) || i.amount < 0 || i.amount > 5_000_000)) errors.push('Enter the dollar amount as a number.');
  if (cat?.amount === 'required' && !(typeof i.amount === 'number' && i.amount > 0)) errors.push('Enter the dollar amount for this kind of report.');
  const d = String(i.description || '').trim();
  if (d.length < DESCRIPTION_MIN) errors.push(`Describe what happened in at least ${DESCRIPTION_MIN} characters: dates, amounts, who you spoke to.`);
  if (d.length > DESCRIPTION_MAX) errors.push(`Keep the description under ${DESCRIPTION_MAX} characters.`);
  if (i.evidenceCount < 1) errors.push('Attach at least one document that shows it: the rate con, BOL, invoice or settlement.');
  if (i.evidenceCount > EVIDENCE_MAX_FILES) errors.push(`Attach up to ${EVIDENCE_MAX_FILES} documents.`);
  const proofCount = i.proofCount ?? 0;
  if (i.reporterRole === 'driver') {
    if (proofCount < 1) errors.push('Attach a document that shows you drove for this company: a settlement, pay stub, dispatch sheet, lease or onboarding form.');
    if (proofCount > EVIDENCE_MAX_FILES) errors.push(`Attach up to ${EVIDENCE_MAX_FILES} proof documents.`);
  } else if (i.anonymous) {
    errors.push('Only drivers can keep their name off a report. Companies are named.');
  }
  if (!i.attested) errors.push('Confirm that the report is true.');
  return errors;
}

// ---------- The rules, as shown to users ----------

export const REPORT_RULES: { title: string; text: string }[] = [
  {
    title: 'Verified reporters only',
    text: DRIVER_REPORTS_ON
      ? 'You file as a verified carrier, broker, driver or shipper. Companies are named on the report. A driver can keep their name off the public report (it shows “Verified driver”); we still verify who they are and hold them to these rules.'
      : 'You file as a verified carrier, broker or shipper. Your company is named on the report.',
  },
  { title: 'One load per report', text: 'Each report is about one load you were part of, with its load number and date.' },
  { title: 'Facts, not opinions', text: 'Say what was agreed and what happened: dates, amounts, who you spoke to. No guesses about motives and no opinions about people.' },
  { title: 'Show it', text: `Attach the rate con, BOL, invoice, settlement or messages.${DRIVER_REPORTS_ON ? ' Drivers also attach a document that shows they drove for the company (settlement, pay stub, dispatch sheet, lease or onboarding form).' : ''} Only Haulock’s reviewers see your documents.` },
  { title: 'Keep it professional', text: 'No insults, threats or profanity (curse words are hidden automatically). No personal details of individuals: no personal phone numbers, home addresses or license numbers.' },
  { title: 'Reviewed, and the other side replies', text: 'We check every report against these rules before it’s shown. The company is told and can reply publicly under it.' },
  { title: 'You stand behind it', text: 'You confirm the report is true and you’re responsible for it. False reports are removed and can cost you your account.' },
];

// Curse words are hidden wherever a report or a reply is shown. The stored
// text is never changed: only what's displayed. Whole words only, so
// "Scunthorpe" and "assess" are left alone. Words that are also ordinary
// names or terms ("Dick's Sporting Goods", "spic and span") are left out:
// the admin review catches what a word list can't.
const PROFANITY = [
  'fuck', 'fucker', 'fuckers', 'fucking', 'fucked', 'fuckin', 'motherfucker', 'motherfuckers', 'motherfucking',
  'shit', 'shits', 'shitty', 'shithead', 'bullshit', 'horseshit', 'dipshit',
  'bitch', 'bitches', 'bitching', 'bastard', 'bastards',
  'ass', 'asses', 'asshole', 'assholes', 'jackass', 'dumbass', 'badass',
  'dickhead', 'cocksucker', 'pussy', 'cunt', 'cunts', 'twat',
  'piss', 'pissed', 'pissing', 'damn', 'goddamn', 'goddamned', 'crap', 'crappy',
  'whore', 'slut', 'douche', 'douchebag', 'wanker', 'bollocks', 'jerkoff',
  'retard', 'retarded', 'faggot', 'nigger', 'nigga', 'wetback', 'kike', 'towelhead', 'raghead',
];
const PROFANITY_RE = new RegExp(`\\b(${PROFANITY.join('|')})\\b`, 'gi');

export function maskProfanity(text: string | null | undefined): string {
  return String(text ?? '').replace(PROFANITY_RE, (w) => `${w[0]}${'*'.repeat(Math.max(2, w.length - 1))}`);
}

// ---------- Score ----------
// The published rule, the same for every company:
//   - only published reports count, and each reporter counts once per
//     company, however many loads they reported;
//   - a reporter whose reports are all marked resolved counts 0;
//   - otherwise 8 points, or 4 when their newest open report is more than
//     two years old;
//   - 30 points at most.
export const REPORT_POINTS = 8;
export const REPORT_POINTS_OLD = 4;
export const REPORT_POINTS_MAX = 30;
const TWO_YEARS_MS = 2 * 365 * 24 * 60 * 60 * 1000;

export type ScoredReport = { reporter_key: string; published_at: string | null; created_at: string; resolved_at: string | null; status: string };

export type ReportScore = {
  points: number;
  published: number;     // published reports on record
  open: number;          // published and not marked resolved
  resolved: number;
  reporters: number;     // distinct reporters with a published report
  countedReporters: number;
  oldReporters: number;  // counted at the reduced rate
};

export function scoreReports(rows: ScoredReport[], now: number = Date.now()): ReportScore {
  const published = rows.filter((r) => r.status === 'published');
  const byReporter = new Map<string, ScoredReport[]>();
  for (const r of published) byReporter.set(r.reporter_key, [...(byReporter.get(r.reporter_key) || []), r]);
  let points = 0;
  let counted = 0;
  let old = 0;
  for (const list of byReporter.values()) {
    const open = list.filter((r) => !r.resolved_at);
    if (open.length === 0) continue;
    const newest = Math.max(...open.map((r) => Date.parse(r.published_at || r.created_at)));
    const isOld = now - newest > TWO_YEARS_MS;
    points += isOld ? REPORT_POINTS_OLD : REPORT_POINTS;
    counted += 1;
    if (isOld) old += 1;
  }
  return {
    points: Math.min(REPORT_POINTS_MAX, points),
    published: published.length,
    open: published.filter((r) => !r.resolved_at).length,
    resolved: published.filter((r) => r.resolved_at).length,
    reporters: byReporter.size,
    countedReporters: counted,
    oldReporters: old,
  };
}

// ---------- Public shape ----------

export type PublicReport = {
  id: string;
  status: ReportStatus;
  reporter: { role: ReporterRole; name: string; mc: string | null; dot: string | null; anonymous?: boolean };
  subject: { type: SubjectType; name: string; mc: string | null; dot: string | null; city: string | null; state: string | null };
  category: string;
  categoryLabel: string;
  loadRef: string;
  incidentDate: string;
  amount: number | null;
  description: string;
  documents: number;
  createdAt: string;
  publishedAt: string | null;
  resolvedAt: string | null;
  rejectReason?: string | null;
  mine?: boolean;
  response: { name: string; body: string; disputes: boolean; at: string } | null;
};

export function toPublicReport(row: any, response?: any | null, viewerId?: string | null): PublicReport {
  return {
    id: row.id,
    status: row.status,
    // A driver who withheld their name is "Verified driver" to everyone but
    // themselves. Admins get the real name from their own route.
    reporter: (() => {
      const anonymous = Boolean(row.reporter_anonymous);
      const mine = Boolean(viewerId && row.reporter_user_id === viewerId);
      return { role: row.reporter_role, name: anonymous && !mine ? 'Verified driver' : row.reporter_name, mc: row.reporter_mc || null, dot: row.reporter_dot || null, ...(anonymous ? { anonymous: true } : {}) };
    })(),
    subject: { type: row.subject_type, name: row.subject_name, mc: row.subject_mc || null, dot: row.subject_dot || null, city: row.subject_city || null, state: row.subject_state || null },
    category: row.category,
    categoryLabel: categoryLabel(row.category),
    loadRef: row.load_ref,
    incidentDate: row.incident_date,
    amount: row.amount != null ? Number(row.amount) : null,
    description: maskProfanity(row.description),
    documents: Array.isArray(row.evidence) ? row.evidence.length : 0,
    createdAt: row.created_at,
    publishedAt: row.published_at || null,
    resolvedAt: row.resolved_at || null,
    ...(viewerId && row.reporter_user_id === viewerId ? { mine: true, rejectReason: row.reject_reason || null } : {}),
    response: response ? { name: response.responder_name, body: maskProfanity(response.body), disputes: Boolean(response.disputes), at: response.updated_at || response.created_at } : null,
  };
}

export const REPORT_COLUMNS = 'id, reporter_user_id, reporter_role, reporter_name, reporter_mc, reporter_dot, reporter_key, reporter_verified_by, subject_type, subject_mc, subject_dot, subject_name, subject_city, subject_state, subject_key, category, load_ref, incident_date, amount, description, evidence, status, reject_reason, published_at, resolved_at, created_at, reporter_anonymous, proof';
