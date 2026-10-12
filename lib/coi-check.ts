import { analyzeCoi, type CoiExtraction, type CoiPolicy } from './anthropic';
import { parseQuery, lookupCarrier, type CarrierReport } from './fmcsa';
import { fetchInsuranceFilings, type InsuranceFiling, type InsuranceFilingsResult } from './fmcsa-insurance';
import { analyzePdfForensics, type PdfForensics } from './pdf-forensics';
import { PipelineError } from './rate-con-pipeline';

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

export function coiDisclaimer(asOf: string | null): string {
  return `Automated comparison of the document provided with public FMCSA insurance filings${asOf ? ` (FMCSA data updated ${fmtDate(asOf)})` : ''} and the PDF's metadata. It is not a finding that any company acted improperly. FMCSA filings can lag a few business days and mainly cover auto liability; cargo and general liability are usually not filed. Always confirm coverage with the insurer using a phone number from the insurer's own website. Questions or corrections: contact@haulock.com.`;
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
function namesAgree(a: string | null | undefined, b: string | null | undefined, noise = ENTITY_NOISE): boolean {
  const ta = nameTokens(a, noise);
  const tb = nameTokens(b, noise);
  if (ta.size === 0 || tb.size === 0) return false;
  const shared = Array.from(ta).filter((t) => tb.has(t) || Array.from(tb).some((u) => u.startsWith(t) || t.startsWith(u))).length;
  return shared >= Math.min(2, Math.min(ta.size, tb.size));
}

const INSURED_NOISE = /\b(LLC|L\.?L\.?C|INC|INCORPORATED|CORP|CORPORATION|LTD|LIMITED|LP|LLP|PLLC|CO|COMPANY|GROUP|HOLDINGS?|THE|AND|DBA)\b/g;

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

async function resolveCarrier(ex: CoiExtraction, mcOverride?: string | null, dotOverride?: string | null): Promise<CarrierReport | null> {
  const digits = (v?: string | null) => String(v || '').replace(/[^0-9]/g, '');
  const candidates: string[] = [];
  if (digits(mcOverride)) candidates.push(`MC-${digits(mcOverride)}`);
  if (digits(dotOverride)) candidates.push(`DOT-${digits(dotOverride)}`);
  if (candidates.length === 0) {
    if (digits(ex.insured_mc)) candidates.push(`MC-${digits(ex.insured_mc)}`);
    if (digits(ex.insured_dot)) candidates.push(`DOT-${digits(ex.insured_dot)}`);
  }
  for (const q of candidates) {
    const parsed = parseQuery(q);
    if (!parsed) continue;
    try {
      const c = await lookupCarrier(parsed);
      if (c && c.source !== 'mock') return c;
    } catch { /* try the next identifier */ }
  }
  // No identifier at all: try the insured name, but only accept a record
  // whose name clearly agrees with it.
  if (candidates.length === 0 && ex.insured_name) {
    const parsed = parseQuery(ex.insured_name);
    if (parsed) {
      try {
        const c = await lookupCarrier(parsed);
        if (c && c.source !== 'mock' && (namesAgree(ex.insured_name, c.name, INSURED_NOISE) || namesAgree(ex.insured_name, c.dba, INSURED_NOISE))) return c;
      } catch { /* fall through */ }
    }
  }
  return null;
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
    ex = await analyzeCoi(args.ocrText);
  } catch (e: any) {
    throw new PipelineError(e?.message || 'Could not read the certificate', 502);
  }
  if (!ex.is_coi) {
    throw new PipelineError('This doesn’t look like a certificate of insurance (ACORD 25). Upload the COI PDF the carrier sent you.', 422);
  }
  return buildCoiReport(ex, args);
}

// The comparison itself, separate from the Claude read so it can be tested
// with a known extraction.
export async function buildCoiReport(
  ex: CoiExtraction,
  args: { bytes?: Buffer; mime?: string; filename?: string; mc?: string | null; dot?: string | null },
): Promise<CoiReport> {
  const isPdf = /pdf/i.test(args.mime || '') && args.bytes;
  const [carrier, forensics] = await Promise.all([
    resolveCarrier(ex, args.mc, args.dot),
    isPdf ? analyzePdfForensics(args.bytes!).catch(() => null) : Promise.resolve(null),
  ]);
  const insurance: InsuranceFilingsResult = carrier
    ? await fetchInsuranceFilings({ mc: carrier.mc, dot: carrier.dot })
    : { filings: [], asOf: null };
  return compareCoi(ex, { carrier, insurance, forensics, filename: args.filename });
}

// Pure comparison of the certificate against the carrier record, its FMCSA
// filings and the PDF metadata. No network calls.
export function compareCoi(
  ex: CoiExtraction,
  ctx: { carrier: CarrierReport | null; insurance: InsuranceFilingsResult; forensics: PdfForensics | null; filename?: string },
): CoiReport {
  const { carrier, insurance, forensics } = ctx;
  const filings = insurance.filings;
  const args = { filename: ctx.filename };

  const checks: CoiCheck[] = [];
  const add = (status: CoiCheckStatus, title: string, detail: string, source: string) => checks.push({ status, title, detail, source });
  const now = today();
  const carrierLabel = carrier ? `${carrier.name}${carrier.mc ? ` (MC-${carrier.mc})` : carrier.dot ? ` (DOT-${carrier.dot})` : ''}` : '';

  // 1) Which company is this, and does the COI name the same one?
  if (!carrier) {
    add('warn', 'Carrier not identified in FMCSA',
      ex.insured_name
        ? `The certificate names "${ex.insured_name}" but no MC/DOT number we could match to an FMCSA record. Enter the carrier's MC number and check again to compare insurance filings.`
        : 'No insured company or MC/DOT number could be read from the certificate. Enter the carrier’s MC number and check again.',
      FMCSA_CARRIER_SRC);
  } else if (ex.insured_name) {
    const agrees = namesAgree(ex.insured_name, carrier.name, INSURED_NOISE) || namesAgree(ex.insured_name, carrier.dba, INSURED_NOISE);
    if (agrees) {
      add('pass', 'Insured company matches the FMCSA record', `"${ex.insured_name}" matches ${carrierLabel}.`, FMCSA_CARRIER_SRC);
    } else {
      add('fail', 'Insured company differs from the FMCSA record',
        `The certificate is issued to "${ex.insured_name}", but the FMCSA record for this number is ${carrierLabel}${carrier.dba ? ` (DBA ${carrier.dba})` : ''}. Confirm you have the right carrier and the right certificate.`,
        FMCSA_CARRIER_SRC);
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
        add(insurerAgrees ? 'pass' : 'warn',
          insurerAgrees ? 'Auto liability policy is filed with FMCSA' : 'Policy number filed with FMCSA under a different insurer name',
          insurerAgrees
            ? `Policy ${p.policy_number} matches the ${matched.coverage} filing by ${matched.insurer}${plausibleDate(matched.effectiveDate) ? `, effective ${fmtDate(matched.effectiveDate)}` : ''}.`
            : `Policy ${p.policy_number} is on file, but FMCSA lists the insurer as "${matched.insurer}" while the certificate says "${p.insurer_name}". Can be a parent/subsidiary name — confirm with the insurer.`,
          FMCSA_SRC);
        if (pendingCancellation(matched)) {
          add('fail', 'Cancellation pending on FMCSA', `FMCSA shows policy ${matched.policyNumber} by ${matched.insurer} with a cancellation effective ${fmtDate(matched.cancelEffectiveDate)}. Confirm the policy is still in force before dispatching.`, FMCSA_SRC);
        }
      } else if (selfInsured) {
        add('info', 'Carrier is self-insured with FMCSA', `FMCSA lists self-insurance for ${carrierLabel}; the certificate lists ${p.insurer_name || 'an insurer'} policy ${p.policy_number || '(no number)'}. Large carriers often carry excess policies on top of self-insurance.`, FMCSA_SRC);
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
    if (forensics.verdict === 'likely_tampered') {
      add('fail', 'PDF was modified after it was created', forensics.flags.filter((f) => f.sev !== 'info').slice(0, 2).map((f) => f.title).join(' · ') || 'The file metadata shows edits after creation.', PDF_SRC);
    } else if (forensics.verdict === 'suspicious') {
      add('warn', 'PDF metadata has irregularities', forensics.flags.filter((f) => f.sev !== 'info').slice(0, 2).map((f) => f.title).join(' · ') || 'Some metadata looks unusual.', PDF_SRC);
    } else {
      add('pass', 'No signs of editing in the PDF metadata', 'Creation and modification data look consistent with an unedited document.', PDF_SRC);
    }
  }

  // 8) Oddities Claude noticed in the text itself.
  for (const note of ex.irregularities.slice(0, 3)) {
    add('warn', 'Document detail to double-check', note, COI_SRC);
  }

  const fails = checks.filter((c) => c.status === 'fail').length;
  const warns = checks.filter((c) => c.status === 'warn').length;
  const verdict: CoiVerdict = fails > 0 ? 'mismatch' : warns > 0 || !carrier ? 'verify' : 'match';
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
    verdictLabel: VERDICT_LABEL[verdict],
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
    dataAsOf: insurance.asOf,
    checkedAt: new Date().toISOString(),
    filename: args.filename,
    disclaimer: coiDisclaimer(insurance.asOf),
    name,
    mc: carrier?.mc,
    dot: carrier?.dot,
  };
}

// Policies on the certificate, exported for UI tables.
export type { CoiPolicy };
