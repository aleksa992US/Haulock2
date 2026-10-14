import { analyzeCoi, type CoiExtraction, type CoiInsurer, type CoiPolicy } from './anthropic';
import { parseQuery, lookupCarrier, type CarrierReport, type ParsedQuery } from './fmcsa';
import {
  fetchInsuranceFilings,
  findFilingsByPolicyNumber,
  type InsuranceFiling,
  type InsuranceFilingsResult,
  type PolicyFilingMatch,
} from './fmcsa-insurance';
import { analyzePdfForensics, type PdfForensics } from './pdf-forensics';
import { PipelineError } from './rate-con-pipeline';
import { repairWithAcord25Text, implausibleInsuredName } from './acord25-parse';

// Compares a certificate of insurance (COI) with public FMCSA data and the
// PDF's own metadata. Wording rules (legal): every check states what was
// compared and where the data came from. Nothing here says a company is a
// fraud or that a document is fake — only that things match, don't match,
// or need confirming with the insurer.

export type CoiCheckStatus = 'pass' | 'fail' | 'warn' | 'info';
export type CoiCheck = { status: CoiCheckStatus; title: string; detail: string; source: string };

export type CoiVerdict = 'match' | 'verify' | 'mismatch';

export type CoiReport = {
  kind: 'coi';
  verdict: CoiVerdict;
  verdictLabel: string;
  // 0–100, higher = more things that don't line up. Drives history colours.
  score: number;
  checks: CoiCheck[];
  extraction: CoiExtraction;
  carrier: {
    name: string;
    dba?: string;
    mc?: string;
    dot?: string;
    phone?: string;
    authority?: string;
    outOfService?: boolean;
    bipdOnFileK?: number;
    bipdRequiredK?: number;
  } | null;
  filings: InsuranceFiling[];
  forensics: PdfForensics | null;
  // False when the certificate wasn't compared with FMCSA insurance filings
  // (carrier not identified, or the filings couldn't be loaded). Missing on
  // reports saved before it existed — treat those as `carrier != null`.
  compared: boolean;
  notComparedReason?: string;
  // How the carrier was found: an MC/DOT the user typed, one printed on the
  // certificate, the insured name, or the auto liability policy number.
  identifiedBy?: 'override' | 'certificate' | 'name' | 'policy';
  dataAsOf: string | null;
  checkedAt: string;
  filename?: string;
  disclaimer: string;
  // Lets history rows and email replies show a name without digging.
  name: string;
  mc?: string;
  dot?: string;
};

export const VERDICT_LABEL: Record<CoiVerdict, string> = {
  match: 'Matches FMCSA filings',
  verify: 'Verify with the insurer before accepting',
  mismatch: 'Doesn’t match FMCSA filings — don’t accept until the insurer confirms',
};

// Headlines that depend on what was actually compared.
export const COI_LABEL = {
  notIdentified: 'Not compared with FMCSA — carrier not identified',
  notIdentifiedWithProblems: 'Problems on the certificate — not compared with FMCSA (carrier not identified)',
  filingsUnavailable: 'Not compared — FMCSA insurance data unavailable',
  consistent: 'Consistent with FMCSA filings — confirm with the insurer before accepting',
} as const;

export function coiDisclaimer(asOf: string | null, compared = true): string {
  const what = compared
    ? `Automated comparison of the document provided with public FMCSA insurance filings${asOf ? ` (FMCSA data updated ${fmtDate(asOf)})` : ''} and the PDF's metadata.`
    : `Automated reading of the document provided and the PDF's metadata. It was not compared with FMCSA insurance filings.`;
  return `${what} It is not a finding that any company acted improperly. FMCSA filings can lag a few business days and mainly cover auto liability; cargo and general liability are usually not filed. Always confirm coverage with the insurer using a phone number from the insurer's own website. Questions or corrections: contact@haulock.com.`;
}

const FMCSA_SRC = 'FMCSA insurance filings (data.transportation.gov)';
const FMCSA_CARRIER_SRC = 'FMCSA carrier record';
const COI_SRC = 'The certificate you provided';
const PDF_SRC = 'PDF metadata';

const FREE_MAIL = /@(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|aol|icloud|me|proton|protonmail|gmx|zoho|mail)\.[a-z.]+$/i;
const ENTITY_NOISE = /\b(LLC|L\.?L\.?C|INC|INCORPORATED|CORP|CORPORATION|LTD|LIMITED|LP|LLP|PLLC|CO|COMPANY|GROUP|HOLDINGS?|INS|INSURANCE|OF|THE|AND|AMERICA|AMERICAN|MUTUAL|CASUALTY|INDEMNITY|SPECIALTY|UNDERWRITERS)\b/g;

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null) return '—';
  return n >= 1_000_000 ? `$${(n / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 2 })}M` : `$${Math.round(n / 1000).toLocaleString('en-US')}K`;
}

const normPolicy = (s: string | null | undefined) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function policyNumbersMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normPolicy(a);
  const y = normPolicy(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // Agencies sometimes add or drop a short prefix/suffix (term number, "-01").
  return Math.min(x.length, y.length) >= 6 && (x.includes(y) || y.includes(x));
}

function nameTokens(s: string | null | undefined, noise = ENTITY_NOISE): Set<string> {
  return new Set(
    String(s || '').toUpperCase().replace(/[.,&'/()-]/g, ' ').replace(noise, ' ').split(/\s+/).filter((w) => w.length >= 3),
  );
}

// True when the two names share their significant words. FMCSA truncates
// insurer names at 45 characters, so a prefix overlap counts.
// An FMCSA liability filing from the certificate's insurer, if any.
function sameInsurer(p: CoiPolicy, filings: InsuranceFiling[]): InsuranceFiling | undefined {
  if (!p.insurer_name) return undefined;
  return filings.find((f) => namesAgree(p.insurer_name, f.insurer));
}

function namesAgree(a: string | null | undefined, b: string | null | undefined, noise = ENTITY_NOISE): boolean {
  const ta = nameTokens(a, noise);
  const tb = nameTokens(b, noise);
  if (ta.size === 0 || tb.size === 0) return false;
  const shared = Array.from(ta).filter((t) => tb.has(t) || Array.from(tb).some((u) => u.startsWith(t) || t.startsWith(u))).length;
  return shared >= Math.min(2, Math.min(ta.size, tb.size));
}

const INSURED_NOISE = /\b(LLC|L\.?L\.?C|INC|INCORPORATED|CORP|CORPORATION|LTD|LIMITED|LP|LLP|PLLC|CO|COMPANY|GROUP|HOLDINGS?|THE|AND|DBA)\b/g;

// ---------- Cleaning up the extraction ----------
// The model sometimes misreads the ACORD 25 layout: the INSURED (the carrier)
// lands in an insurer slot, a street number becomes an NAIC number, or rows
// get the wrong insurer. These rules undo what can be undone deterministically.

// Words that mark a company as an insurer rather than a trucking company.
const INSURER_WORDS = /\b(INSURANCE|INS|ASSURANCE|CASUALTY|INDEMNITY|UNDERWRITERS?|MUTUAL|EXCHANGE|RECIPROCAL|LLOYD'?S|SURETY|FIRE|RE|REINSURANCE|GUARANTY|FIDELITY|SPECIALTY|RISK)\b/i;

// NAIC company codes are exactly 5 digits. Anything else (a street number,
// a ZIP+4, a phone fragment) is dropped.
export function normalizeNaic(v: unknown): string | null {
  const s = String(v ?? '').replace(/^\s*(?:NAIC)?\s*#?\s*/i, '').trim();
  return /^\d{5}$/.test(s) ? s : null;
}

// MM/DD/YYYY (as printed on ACORD forms) → YYYY-MM-DD; ISO passes through.
function isoOrNull(v: string | null | undefined): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : s;
}

const bareName = (s: string | null | undefined) => String(s || '').toUpperCase().replace(INSURED_NOISE, ' ').replace(/[^A-Z0-9]/g, '');

// True when a name in an insurer slot is really the insured carrier, the
// producing agency, or an address.
function notAnInsurer(name: string | null | undefined, ex: CoiExtraction): boolean {
  const n = String(name || '').trim();
  if (!n) return true;
  // A street address ("1900 Lake St Ste 1") read as a company.
  if (/^\d+\s+[A-Z]/i.test(n)) return true;
  if (ex.insured_name) {
    if (bareName(n) && bareName(n) === bareName(ex.insured_name)) return true;
    // Every significant word of the insured's name appears in the slot, and
    // nothing in it says "insurer".
    const insured = Array.from(nameTokens(ex.insured_name, INSURED_NOISE));
    const slot = nameTokens(n, INSURED_NOISE);
    if (!INSURER_WORDS.test(n) && insured.length > 0 && insured.every((t) => slot.has(t))) return true;
  }
  if (ex.producer_name) {
    if (bareName(n) && bareName(n) === bareName(ex.producer_name)) return true;
    if (/\b(AGENCY|AGENTS?|BROKERAGE)\b/i.test(n) && namesAgree(n, ex.producer_name, INSURED_NOISE)) return true;
  }
  return false;
}

// Pure and idempotent. Insurers come only from the INSURER A–F list; each
// policy takes its insurer from its INSR LTR when the letter is on that list.
export function sanitizeCoiExtraction(ex: CoiExtraction): CoiExtraction {
  const insurers: CoiInsurer[] = [];
  for (const i of ex.insurers || []) {
    const letter = String(i?.letter || '').trim().toUpperCase();
    const name = String(i?.name || '').replace(/\s+/g, ' ').trim() || null;
    if (!/^[A-F]$/.test(letter) || !name || notAnInsurer(name, ex)) continue;
    if (insurers.some((x) => x.letter === letter)) continue;
    insurers.push({ letter, name, naic: normalizeNaic(i.naic) });
  }
  const byLetter = new Map(insurers.map((i) => [i.letter, i] as const));

  const policies: CoiPolicy[] = (ex.policies || []).map((p) => {
    const rawLetter = String(p.insurer_letter || '').trim().toUpperCase();
    const letter = /^[A-F]$/.test(rawLetter) ? rawLetter : null;
    const base = {
      ...p,
      insurer_letter: letter,
      effective_date: isoOrNull(p.effective_date),
      expiration_date: isoOrNull(p.expiration_date),
    };
    const listed = letter ? byLetter.get(letter) : undefined;
    if (listed) return { ...base, insurer_name: listed.name, naic: listed.naic };

    let insurerName = p.insurer_name ? String(p.insurer_name).replace(/\s+/g, ' ').trim() : null;
    let naic = normalizeNaic(p.naic);
    if (insurerName && notAnInsurer(insurerName, ex)) {
      insurerName = null;
      naic = null;
    }
    if (insurers.length > 0) {
      // Match the row to the INSURER list by name, else by a valid NAIC.
      const known =
        (insurerName && insurers.find((i) => bareName(i.name) === bareName(insurerName) || namesAgree(i.name, insurerName))) ||
        (naic ? insurers.find((i) => i.naic === naic) : undefined);
      if (known) return { ...base, insurer_letter: letter || known.letter, insurer_name: known.name, naic: known.naic };
      // Named, but not on the certificate's INSURER list: not trustworthy.
      insurerName = null;
      naic = null;
    }
    return { ...base, insurer_name: insurerName, naic };
  });

  return {
    ...ex,
    certificate_date: isoOrNull(ex.certificate_date),
    insurers,
    policies,
  };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// FMCSA's dataset carries some placeholder dates years in the future; only
// show an effective date that could be real.
function plausibleDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return daysBetween(today(), iso) <= 60 ? iso : null;
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

// A pending cancellation we trust: after today, within ~13 months, and not
// equal to the effective date (the dataset has a few rows where both dates
// carry the same far-future placeholder).
function pendingCancellation(f: InsuranceFiling): boolean {
  if (!f.cancelEffectiveDate) return false;
  if (f.effectiveDate && f.cancelEffectiveDate === f.effectiveDate) return false;
  const d = daysBetween(today(), f.cancelEffectiveDate);
  return d >= 0 && d <= 400;
}

// Network calls the check makes, injectable for tests.
export type CoiDeps = {
  lookupCarrier: (q: ParsedQuery) => Promise<CarrierReport | null>;
  findFilingsByPolicyNumber: typeof findFilingsByPolicyNumber;
  fetchInsuranceFilings: typeof fetchInsuranceFilings;
};
const DEFAULT_DEPS: CoiDeps = { lookupCarrier, findFilingsByPolicyNumber, fetchInsuranceFilings };

export type CarrierIdentification = {
  by: 'override' | 'certificate' | 'name' | 'policy';
  // Set when by = 'policy': the certificate's policy number and the FMCSA
  // filing it matched.
  policyNumber?: string;
  filing?: InsuranceFiling;
};

export type CarrierResolution = {
  carrier: CarrierReport | null;
  identifiedBy: CarrierIdentification | null;
  // The auto liability policy number(s) we tried to match in FMCSA's filings.
  policyLookupTried: string[];
};

export async function resolveCarrier(
  ex: CoiExtraction,
  mcOverride?: string | null,
  dotOverride?: string | null,
  deps: CoiDeps = DEFAULT_DEPS,
): Promise<CarrierResolution> {
  const digits = (v?: string | null) => String(v || '').replace(/[^0-9]/g, '');
  const real = async (q: string): Promise<CarrierReport | null> => {
    const parsed = parseQuery(q);
    if (!parsed) return null;
    try {
      const c = await deps.lookupCarrier(parsed);
      return c && c.source !== 'mock' ? c : null;
    } catch {
      return null;
    }
  };
  const nameAgrees = (c: CarrierReport) =>
    Boolean(ex.insured_name) && (namesAgree(ex.insured_name, c.name, INSURED_NOISE) || namesAgree(ex.insured_name, c.dba, INSURED_NOISE));

  const candidates: string[] = [];
  if (digits(mcOverride)) candidates.push(`MC-${digits(mcOverride)}`);
  if (digits(dotOverride)) candidates.push(`DOT-${digits(dotOverride)}`);
  const overridden = candidates.length > 0;
  if (!overridden) {
    if (digits(ex.insured_mc)) candidates.push(`MC-${digits(ex.insured_mc)}`);
    if (digits(ex.insured_dot)) candidates.push(`DOT-${digits(ex.insured_dot)}`);
  }
  for (const q of candidates) {
    const c = await real(q);
    if (c) return { carrier: c, identifiedBy: { by: overridden ? 'override' : 'certificate' }, policyLookupTried: [] };
  }
  // No identifier at all: try the insured name, but only accept a record
  // whose name clearly agrees with it.
  if (candidates.length === 0 && ex.insured_name) {
    const c = await real(ex.insured_name);
    if (c && nameAgrees(c)) return { carrier: c, identifiedBy: { by: 'name' }, policyLookupTried: [] };
  }

  // Fallback: find the carrier through FMCSA's insurance filings by the auto
  // liability policy number. Skipped when the user typed a number — that's
  // the carrier they asked about.
  const tried: string[] = [];
  if (!overridden) {
    const policyNumbers = Array.from(new Set(
      ex.policies.filter((p) => p.coverage === 'auto_liability' && p.policy_number).map((p) => String(p.policy_number)),
    )).slice(0, 2);
    for (const policyNumber of policyNumbers) {
      tried.push(policyNumber);
      const { matches } = await deps.findFilingsByPolicyNumber(policyNumber);
      // One entry per carrier (several filings can share a policy number).
      const perCarrier = new Map<string, PolicyFilingMatch>();
      for (const m of matches) {
        const key = m.dot ? `dot:${m.dot}` : m.docket ? `mc:${m.docket}` : '';
        if (key && !perCarrier.has(key)) perCarrier.set(key, m);
      }
      const resolved: { carrier: CarrierReport; match: PolicyFilingMatch }[] = [];
      for (const m of Array.from(perCarrier.values()).slice(0, 3)) {
        const c = (m.docket ? await real(`MC-${m.docket}`) : null) || (m.dot ? await real(`DOT-${m.dot}`) : null);
        if (c) resolved.push({ carrier: c, match: m });
      }
      // A single carrier filed this policy; or, if several did, the one whose
      // name agrees with the insured on the certificate.
      const agreeing = resolved.filter((r) => nameAgrees(r.carrier));
      const pick = perCarrier.size === 1 && resolved.length === 1 ? resolved[0] : agreeing.length === 1 ? agreeing[0] : undefined;
      if (pick) {
        return { carrier: pick.carrier, identifiedBy: { by: 'policy', policyNumber, filing: pick.match.filing }, policyLookupTried: tried };
      }
    }
  }
  return { carrier: null, identifiedBy: null, policyLookupTried: tried };
}

export async function runCoiCheckFromText(args: {
  ocrText: string;
  bytes?: Buffer;
  mime?: string;
  filename?: string;
  mc?: string | null;
  dot?: string | null;
}): Promise<CoiReport> {
  let ex: CoiExtraction;
  try {
    ex = await analyzeCoi(args.ocrText, args.bytes ? { bytes: args.bytes, mime: args.mime } : undefined);
  } catch (e: any) {
    throw new PipelineError(e?.message || 'Could not read the certificate', 502);
  }
  if (!ex.is_coi) {
    throw new PipelineError('This doesn’t look like a certificate of insurance (ACORD 25). Upload the COI PDF the carrier sent you.', 422);
  }
  // The model misreads ACORD 25 layouts (insured in an insurer slot, the
  // city as the insured, missing INSR LTR letters). Correct it with what
  // the fixed-layout text shows unambiguously.
  ex = repairWithAcord25Text(ex, args.ocrText);
  return buildCoiReport(ex, args);
}

// The comparison itself, separate from the Claude read so it can be tested
// with a known extraction.
export async function buildCoiReport(
  rawEx: CoiExtraction,
  // `forensics`: the PDF metadata result saved with an earlier check, for a
  // re-check where the file itself is no longer available.
  args: { bytes?: Buffer; mime?: string; filename?: string; mc?: string | null; dot?: string | null; forensics?: PdfForensics | null },
  deps: Partial<CoiDeps> = {},
): Promise<CoiReport> {
  const d: CoiDeps = { ...DEFAULT_DEPS, ...deps };
  const ex = sanitizeCoiExtraction(rawEx);
  const isPdf = /pdf/i.test(args.mime || '') && args.bytes;
  const [resolution, forensics] = await Promise.all([
    resolveCarrier(ex, args.mc, args.dot, d),
    isPdf ? analyzePdfForensics(args.bytes!).catch(() => null) : Promise.resolve(args.forensics ?? null),
  ]);
  const { carrier } = resolution;
  const insurance: InsuranceFilingsResult = carrier
    ? await d.fetchInsuranceFilings({ mc: carrier.mc, dot: carrier.dot })
    : { filings: [], asOf: null };
  return compareCoi(ex, {
    carrier,
    insurance,
    forensics,
    filename: args.filename,
    identifiedBy: resolution.identifiedBy,
    policyLookupTried: resolution.policyLookupTried,
  });
}

// Second safety net, once the carrier is known from FMCSA: an "insurer"
// that is really the carrier itself is the insured (drop it), and an
// insured name that is just the city from the insured's address is a
// misread (treat as unread rather than as a different company).
export function repairAgainstCarrier(ex: CoiExtraction, carrier: CarrierReport | null): CoiExtraction {
  if (!carrier) return ex;
  const isCarrier = (n: string | null | undefined) => Boolean(n) && (namesAgree(n, carrier.name, INSURED_NOISE) || namesAgree(n, carrier.dba, INSURED_NOISE));
  const insurers = (ex.insurers || []).filter((i) => !isCarrier(i.name));
  const policies = ex.policies.map((p) => (isCarrier(p.insurer_name) ? { ...p, insurer_name: null, naic: null } : p));
  // A ZIP, "IL 60453" or the address's city is a misread, not a company.
  let insured = ex.insured_name;
  if (insured && !isCarrier(insured) && implausibleInsuredName(insured, ex.insured_address)) insured = null;
  return { ...ex, insurers, policies, insured_name: insured };
}

// The model's free-text "irregularities" are mostly about its own reading
// (blank INSURER E/F, a letter it couldn't see, where an address "may"
// belong) or normal practice (a certificate dated before renewals start,
// workers' comp renewing on a different date). Only notes that point at the
// document itself being wrong or altered are shown.
const DOCUMENT_PROBLEM = /\b(alter(ed|ation)|edit(ed|ing)|tamper|white[- ]?out|overwrit|font|mismatch(ed)? (font|text)|expir\w* (date )?(is )?before (the )?effective|effective (date )?(is )?after (the )?expir|limit\w* .*below|cancel(l)?ed|void|not (a )?valid|invalid (date|policy))\b/i;

function documentIssues(ex: CoiExtraction): string[] {
  return (ex.irregularities || []).filter((note) => DOCUMENT_PROBLEM.test(note));
}

// Pure comparison of the certificate against the carrier record, its FMCSA
// filings and the PDF metadata. No network calls.
export function compareCoi(
  rawEx: CoiExtraction,
  ctx: {
    carrier: CarrierReport | null;
    insurance: InsuranceFilingsResult;
    forensics: PdfForensics | null;
    filename?: string;
    identifiedBy?: CarrierIdentification | null;
    policyLookupTried?: string[];
  },
): CoiReport {
  const { carrier, insurance, forensics } = ctx;
  const ex = repairAgainstCarrier(sanitizeCoiExtraction(rawEx), carrier);
  const filings = insurance.filings;
  const args = { filename: ctx.filename };

  const checks: CoiCheck[] = [];
  const add = (status: CoiCheckStatus, title: string, detail: string, source: string) => checks.push({ status, title, detail, source });
  const now = today();
  const carrierLabel = carrier ? `${carrier.name}${carrier.mc ? ` (MC-${carrier.mc})` : carrier.dot ? ` (DOT-${carrier.dot})` : ''}` : '';

  // 1) Which company is this, and does the COI name the same one?
  const byPolicy = ctx.identifiedBy?.by === 'policy' ? ctx.identifiedBy : null;
  if (!carrier) {
    const tried = (ctx.policyLookupTried || []).join(', ');
    const policyNote = tried ? ` We also looked for auto liability policy ${tried} in FMCSA’s insurance filings and couldn’t match it to one carrier.` : '';
    add('warn', 'Carrier not identified — not compared with FMCSA',
      ex.insured_name
        ? `The certificate names "${ex.insured_name}" but no MC/DOT number we could match to an FMCSA record.${policyNote} Nothing on this certificate was compared with FMCSA filings. Enter the carrier’s MC number and check again to compare.`
        : `No insured company or MC/DOT number could be read from the certificate.${policyNote} Nothing on this certificate was compared with FMCSA filings. Enter the carrier’s MC number and check again.`,
      FMCSA_CARRIER_SRC);
  } else {
    if (byPolicy) {
      const f = byPolicy.filing;
      add('info', 'Carrier identified from the auto liability policy number',
        `The certificate doesn’t print an MC or USDOT number we could match, so we looked up auto liability policy ${byPolicy.policyNumber} in FMCSA’s insurance filings: ${f?.insurer || 'the insurer'} filed policy ${f?.policyNumber || byPolicy.policyNumber} for ${carrierLabel}${carrier.dot ? `, USDOT ${carrier.dot}` : ''}. The checks below compare against that carrier.`,
        FMCSA_SRC);
    }
    if (ex.insured_name) {
      const agrees = namesAgree(ex.insured_name, carrier.name, INSURED_NOISE) || namesAgree(ex.insured_name, carrier.dba, INSURED_NOISE);
      // A short name with no company word ("Dyer", "IL") on a certificate
      // already tied to this carrier by its own policy number is almost
      // always a misread of the INSURED box, not a different company.
      const companyish = /\b(LLC|L\.L\.C|INC|CORP|CORPORATION|CO|COMPANY|LTD|LP|GROUP|TRUCKING|TRANSPORT\w*|LOGISTICS|FREIGHT|EXPRESS|LINES?|CARRIERS?|HAULING|ENTERPRISES?|SERVICES?|SOLUTIONS|TRANS)\b/i.test(ex.insured_name);
      const likelyMisread = Boolean(byPolicy) && !companyish && ex.insured_name.trim().split(/\s+/).length <= 2;
      if (agrees) {
        add('pass', 'Insured company matches the FMCSA record', `"${ex.insured_name}" matches ${carrierLabel}.`, FMCSA_CARRIER_SRC);
      } else if (likelyMisread) {
        add('warn', 'Insured name unclear — check the INSURED box',
          `We read the insured as "${ex.insured_name}", which doesn't look like a company name. The policy number ties this certificate to ${carrierLabel}; open the PDF and confirm the INSURED box shows that company.`,
          COI_SRC);
      } else {
        add('fail', 'Insured company differs from the FMCSA record',
          `The certificate is issued to "${ex.insured_name}", but the FMCSA record for ${byPolicy ? 'the carrier that filed this policy' : 'this number'} is ${carrierLabel}${carrier.dba ? ` (DBA ${carrier.dba})` : ''}. Confirm you have the right carrier and the right certificate.`,
          FMCSA_CARRIER_SRC);
      }
    }
  }
  if (carrier && ex.insured_mc) {
    const coiMc = ex.insured_mc.replace(/[^0-9]/g, '').replace(/^0+/, '');
    const recMc = String(carrier.mc || '').replace(/^0+/, '');
    if (coiMc && recMc && coiMc !== recMc) {
      add('fail', 'MC number on the certificate differs', `The certificate shows MC-${coiMc}; the carrier checked is MC-${recMc}.`, COI_SRC);
    }
  }

  // 2) Authority status
  if (carrier) {
    if (carrier.outOfService) {
      add('fail', 'FMCSA lists the carrier as out of service', `${carrierLabel} has an out-of-service order on its FMCSA record.`, FMCSA_CARRIER_SRC);
    }
    const auth = carrier.commonAuthority || carrier.authorityStatus;
    if (auth && !/^active/i.test(auth)) {
      add('fail', `Operating authority: ${auth}`, `FMCSA shows the carrier's operating authority as ${auth.toLowerCase()}. Insurance alone doesn't make a carrier authorized to haul.`, FMCSA_CARRIER_SRC);
    }
  }

  // 3) Auto liability: the coverage FMCSA actually records.
  const autoPolicies = ex.policies.filter((p) => p.coverage === 'auto_liability');
  const bipdFilings = filings.filter((f) => /^BIPD/i.test(f.coverage) || f.formCode === '91X' || f.formCode === '91');
  const fmcsaListing = (fs: InsuranceFiling[]) =>
    fs.slice(0, 3).map((f) => `${f.insurer || 'Unknown insurer'}${f.policyNumber ? ` · policy ${f.policyNumber}` : ''}${f.maxCoverageK != null ? ` · ${fmtUsd(f.maxCoverageK * 1000)}` : ''}`).join('; ');

  if (autoPolicies.length === 0) {
    add('warn', 'No auto liability on the certificate', 'The certificate doesn’t list an automobile liability policy, which is the coverage FMCSA requires for motor carriers. Ask the carrier for a certificate that includes it.', COI_SRC);
  }

  if (carrier && insurance.error) {
    add('warn', 'FMCSA insurance data unavailable', `We couldn't load FMCSA insurance filings right now (${insurance.error}). Try again in a few minutes.`, FMCSA_SRC);
  } else if (carrier) {
    if (bipdFilings.length === 0) {
      add('fail', 'No liability insurance filing on record with FMCSA',
        `FMCSA lists no active or pending liability (BIPD) filing for ${carrierLabel}${carrier.bipdOnFile != null ? ` and shows ${fmtUsd(carrier.bipdOnFile * 1000)} on file` : ''}. A newly written policy can take a few business days to appear — confirm with the insurer.`,
        FMCSA_SRC);
    }
    for (const p of autoPolicies) {
      if (bipdFilings.length === 0) break;
      const matched = bipdFilings.find((f) => policyNumbersMatch(p.policy_number, f.policyNumber));
      const selfInsured = bipdFilings.find((f) => /SELF[- ]?INSURED/i.test(f.insurer));
      if (matched) {
        const insurerAgrees = !p.insurer_name || namesAgree(p.insurer_name, matched.insurer);
        const filedAs = normPolicy(matched.policyNumber) !== normPolicy(p.policy_number) ? ` (filed as ${matched.policyNumber})` : '';
        const eff = plausibleDate(matched.effectiveDate);
        const effNote = !eff
          ? ''
          : !p.effective_date || p.effective_date === eff
            ? `, effective ${fmtDate(eff)}${p.effective_date ? ' — the same date as on the certificate' : ''}`
            : `, effective ${fmtDate(eff)} (the certificate shows ${fmtDate(p.effective_date)})`;
        add(insurerAgrees ? 'pass' : 'warn',
          insurerAgrees ? 'Auto liability policy is filed with FMCSA' : 'Policy number filed with FMCSA under a different insurer name',
          insurerAgrees
            ? `Policy ${p.policy_number}${filedAs} matches the ${matched.coverage} filing by ${matched.insurer}${effNote}.${matched.cancelEffectiveDate ? '' : ' No cancellation is pending.'}`
            : `Policy ${p.policy_number} is on file, but FMCSA lists the insurer as "${matched.insurer}" while the certificate says "${p.insurer_name}". Can be a parent/subsidiary name — confirm with the insurer.`,
          FMCSA_SRC);
        if (pendingCancellation(matched)) {
          add('fail', 'Cancellation pending on FMCSA', `FMCSA shows policy ${matched.policyNumber} by ${matched.insurer} with a cancellation effective ${fmtDate(matched.cancelEffectiveDate)}. Confirm the policy is still in force before dispatching.`, FMCSA_SRC);
        }
      } else if (selfInsured) {
        add('info', 'Carrier is self-insured with FMCSA', `FMCSA lists self-insurance for ${carrierLabel}; the certificate lists ${p.insurer_name || 'an insurer'} policy ${p.policy_number || '(no number)'}. Large carriers often carry excess policies on top of self-insurance.`, FMCSA_SRC);
      } else if (sameInsurer(p, bipdFilings)) {
        // Same insurer, different number: usually a renewal. FMCSA filings stay
        // in force until cancelled, so the original policy number often stays
        // on record after the policy is renewed under a new one.
        const f = sameInsurer(p, bipdFilings)!;
        add('warn', 'Policy number differs from the FMCSA filing',
          `The certificate lists ${p.insurer_name} policy ${p.policy_number || '(no number shown)'}; FMCSA shows ${f.insurer}${f.policyNumber ? ` policy ${f.policyNumber}` : ''} on file. Often a renewal under a new number — confirm with the insurer that this policy is the one in force.`,
          FMCSA_SRC);
        if (pendingCancellation(f)) {
          add('fail', 'Cancellation pending on FMCSA', `FMCSA shows ${f.insurer}${f.policyNumber ? ` policy ${f.policyNumber}` : ''} with a cancellation effective ${fmtDate(f.cancelEffectiveDate)}. Confirm the policy is still in force before dispatching.`, FMCSA_SRC);
        }
      } else {
        add('fail', 'Auto liability policy not found in FMCSA filings',
          `The certificate lists ${p.insurer_name || 'an insurer'} policy ${p.policy_number || '(no number shown)'}, which isn't among the filings FMCSA lists for ${carrierLabel}. FMCSA shows: ${fmcsaListing(bipdFilings) || 'no matching policies'}.`,
          FMCSA_SRC);
      }
    }
    // Any other pending cancellation on a liability filing.
    for (const f of bipdFilings) {
      if (pendingCancellation(f) && !checks.some((c) => c.title === 'Cancellation pending on FMCSA')) {
        add('fail', 'Cancellation pending on FMCSA', `FMCSA shows ${f.insurer}${f.policyNumber ? ` policy ${f.policyNumber}` : ''} with a cancellation effective ${fmtDate(f.cancelEffectiveDate)}.`, FMCSA_SRC);
      }
    }
  }

  // 4) Dates and limits printed on the certificate.
  const requiredUsd = carrier?.bipdRequired ? carrier.bipdRequired * 1000 : 750_000;
  for (const p of autoPolicies) {
    if (p.expiration_date && p.expiration_date < now) {
      add('fail', 'Auto liability on the certificate has expired', `The certificate shows policy ${p.policy_number || ''} expiring ${fmtDate(p.expiration_date)}. Ask for a current certificate.`, COI_SRC);
    } else if (p.expiration_date && daysBetween(now, p.expiration_date) <= 14) {
      add('warn', 'Auto liability expires within 2 weeks', `Policy ${p.policy_number || ''} expires ${fmtDate(p.expiration_date)}. Make sure it renews before the load delivers.`, COI_SRC);
    }
    if (p.effective_date && p.effective_date > now) {
      add('warn', 'Auto liability starts in the future', `Policy ${p.policy_number || ''} isn't effective until ${fmtDate(p.effective_date)}.`, COI_SRC);
    }
    if (p.limit_amount != null && p.limit_amount < requiredUsd) {
      add('fail', 'Auto liability limit is below the FMCSA minimum', `The certificate shows ${fmtUsd(p.limit_amount)}; the minimum for this carrier is ${fmtUsd(requiredUsd)}.`, COI_SRC);
    }
  }
  // Any other coverage on the certificate that has already expired.
  const coverageName: Record<string, string> = {
    general_liability: 'General liability',
    workers_comp: 'Workers’ comp',
    cargo: 'Cargo coverage',
    umbrella: 'Umbrella / excess liability',
  };
  for (const p of ex.policies) {
    if (p.coverage === 'auto_liability' || !p.expiration_date || p.expiration_date >= now) continue;
    const what = coverageName[p.coverage];
    add('warn',
      `${what || 'Other coverage'} on the certificate has expired`,
      what
        ? `${what} on this certificate${p.policy_number ? ` (policy ${p.policy_number})` : ''} expired ${fmtDate(p.expiration_date)} — ask for a current certificate.`
        : `${p.policy_number ? `Policy ${p.policy_number}` : 'A policy'} on this certificate expired ${fmtDate(p.expiration_date)} — ask for a current certificate.`,
      COI_SRC);
  }
  if (ex.certificate_date && daysBetween(ex.certificate_date, now) > 365) {
    add('warn', 'Certificate is more than a year old', `Issued ${fmtDate(ex.certificate_date)}. Ask the agent for a freshly issued certificate.`, COI_SRC);
  }

  // 5) Cargo can't be verified against FMCSA for most carriers.
  const cargo = ex.policies.find((p) => p.coverage === 'cargo');
  if (cargo) {
    const cargoFiled = filings.find((f) => /CARGO/i.test(f.coverage) && policyNumbersMatch(cargo.policy_number, f.policyNumber));
    if (cargoFiled) {
      add('pass', 'Cargo policy is filed with FMCSA', `Policy ${cargo.policy_number} matches the cargo filing by ${cargoFiled.insurer}.`, FMCSA_SRC);
    } else {
      add('info', 'Cargo coverage can’t be checked against FMCSA', `The certificate lists ${fmtUsd(cargo.limit_amount)} cargo with ${cargo.insurer_name || 'an insurer'}. Most carriers don’t file cargo insurance with FMCSA, so confirm it with the insurer directly.`, COI_SRC);
    }
  }

  // 6) Agent contact details.
  if (ex.producer_email && FREE_MAIL.test(ex.producer_email)) {
    add('warn', 'Agent email is a free webmail address', `The certificate lists the agent as ${ex.producer_email}. Insurance agencies normally use their own domain — call the agency using a number from its website before relying on this certificate.`, COI_SRC);
  }

  // 7) PDF metadata.
  if (forensics) {
    // A warning, not a mismatch: agents routinely edit certificates after
    // issuing them (adding the certificate holder, for one).
    if (forensics.verdict === 'likely_tampered') {
      add('warn', 'PDF was modified after it was created', `${forensics.flags.filter((f) => f.sev !== 'info').slice(0, 2).map((f) => f.title).join(' · ') || 'The file metadata shows edits after creation.'} Agents often edit certificates to add the certificate holder — ask the agent to email the certificate to you directly.`, PDF_SRC);
    } else if (forensics.verdict === 'suspicious') {
      add('warn', 'PDF metadata has irregularities', forensics.flags.filter((f) => f.sev !== 'info').slice(0, 2).map((f) => f.title).join(' · ') || 'Some metadata looks unusual.', PDF_SRC);
    } else {
      add('pass', 'No signs of editing in the PDF metadata', 'Creation and modification data look consistent with an unedited document.', PDF_SRC);
    }
  }

  // 8) Oddities Claude noticed in the text itself.
  for (const note of documentIssues(ex).slice(0, 3)) {
    add('warn', 'Document detail to double-check', note, COI_SRC);
  }

  const fails = checks.filter((c) => c.status === 'fail').length;
  const warns = checks.filter((c) => c.status === 'warn').length;
  // Compared = the certificate was actually checked against FMCSA filings.
  const compared = Boolean(carrier) && !insurance.error;
  const notComparedReason = !carrier ? 'carrier not identified' : insurance.error ? 'FMCSA insurance data unavailable' : undefined;
  const verdict: CoiVerdict = fails > 0 ? 'mismatch' : warns > 0 || !compared ? 'verify' : 'match';
  const autoMatched = checks.some((c) => c.status === 'pass' && c.title === 'Auto liability policy is filed with FMCSA');
  // The headline never implies a comparison that didn't happen.
  const verdictLabel = !carrier
    ? (fails > 0 ? COI_LABEL.notIdentifiedWithProblems : COI_LABEL.notIdentified)
    : insurance.error && fails === 0
      ? COI_LABEL.filingsUnavailable
      : verdict === 'verify' && autoMatched
        ? COI_LABEL.consistent
        : VERDICT_LABEL[verdict];
  const score = Math.min(100, fails * 30 + warns * 10 + (carrier ? 0 : 20));

  // Order: fails, warns, passes, info — the important things first.
  const rank: Record<CoiCheckStatus, number> = { fail: 0, warn: 1, pass: 2, info: 3 };
  checks.sort((a, b) => rank[a.status] - rank[b.status]);
  checks.push({
    status: 'info',
    title: 'Before you accept: call the insurer',
    detail: `Use a phone number from the insurer's own website${carrier?.phone ? `, or the carrier's FMCSA-listed phone ${carrier.phone}` : ''} — not a number printed on the certificate.`,
    source: 'Haulock recommendation',
  });

  const name = carrier?.name || ex.insured_name || 'Certificate of insurance';
  return {
    kind: 'coi',
    verdict,
    verdictLabel,
    score,
    checks,
    extraction: ex,
    carrier: carrier
      ? {
          name: carrier.name,
          dba: carrier.dba,
          mc: carrier.mc,
          dot: carrier.dot,
          phone: carrier.phone,
          authority: carrier.commonAuthority || carrier.authorityStatus,
          outOfService: carrier.outOfService,
          bipdOnFileK: carrier.bipdOnFile,
          bipdRequiredK: carrier.bipdRequired,
        }
      : null,
    filings,
    forensics,
    compared,
    notComparedReason,
    identifiedBy: carrier ? ctx.identifiedBy?.by : undefined,
    dataAsOf: compared ? insurance.asOf : null,
    checkedAt: new Date().toISOString(),
    filename: args.filename,
    disclaimer: coiDisclaimer(compared ? insurance.asOf : null, compared),
    name,
    mc: carrier?.mc,
    dot: carrier?.dot,
  };
}

// Policies on the certificate, exported for UI tables.
export type { CoiPolicy };
