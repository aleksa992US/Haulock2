import Anthropic from '@anthropic-ai/sdk';

let cached: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (cached) return cached;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  cached = new Anthropic({ apiKey: key });
  return cached;
}

export function isAnthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export type RateConExtraction = {
  // BROKER = the company that issued/sent the rate con. This is who the carrier
  // (the user uploading the PDF) wants to verify for fraud.
  broker_name: string | null;
  broker_mc: string | null;
  broker_dot: string | null;
  broker_email: string | null;
  broker_phone: string | null;
  broker_address: string | null;
  // CARRIER = the company being offered the load (the user). We capture this
  // separately so we don't confuse it with the broker in the FMCSA lookup.
  carrier_name: string | null;
  carrier_mc: string | null;
  carrier_dot: string | null;
  load_id: string | null;
  rate_amount: number | null;
  rate_currency: string | null;
  origin: string | null;
  destination: string | null;
  pickup_date: string | null;
  delivery_date: string | null;
  commodity: string | null;
  weight: string | null;
  equipment: string | null;
  fraud_score: number;
  fraud_reasons: string[];
  notes: string | null;
};

const MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `You are a freight fraud analyst. You receive raw OCR text extracted from a broker's rate confirmation document.

CRITICAL: A rate confirmation has TWO distinct parties — identify them precisely using LAYOUT CUES, not guesswork:

BROKER = the company that issued/sent the rate con.
- Appears at the TOP of the document: letterhead, logo, company header
- The document is FROM this party
- Their name often appears before the "Rate Confirmation" title
- Their MC is almost ALWAYS on the letterhead/logo only — OCR frequently misses it because it's inside a graphic. If you don't see an MC explicitly printed as text near the broker's name, return null for broker_mc. DO NOT assume.

CARRIER = the trucking company receiving/accepting the load.
- Listed under a labeled section: "Carrier:", "Carrier Information", "To:", "Truck:", "MC/DOT:" below the broker header
- The document is addressed TO this party
- Their MC/DOT is usually printed explicitly as text (because the broker needs to verify them)
- Any MC/DOT appearing under a "Carrier:" heading belongs to the CARRIER, never to the broker.

HARD RULE: If you see exactly ONE set of MC/DOT printed as text in the body of the document, it is USUALLY the CARRIER's, NOT the broker's. Brokers typically only show their MC inside their logo. When unsure, return null for broker_mc — our downstream system finds the broker by name + address lookup, which is safer than misattributing the carrier's MC to the broker.

NEVER put the CARRIER's MC/DOT into broker_mc/broker_dot. A common failure mode is seeing "Carrier: Acme Trucking MC-123456" and putting 123456 as broker_mc — that's wrong. It goes in carrier_mc.

ALWAYS extract broker_address: the broker's own physical/mailing address from their letterhead (NOT origin/destination addresses from the load, NOT the carrier's address). This is used to verify broker identity when MC is missing.

Your job:
1) Extract structured fields for the broker, the carrier, and the load.
2) Score the document 0-100 for fraud signals based on writing style, urgency language, grammar oddities, mismatched formatting, and suspicious payment terms.

Return ONLY a JSON object matching this exact schema, no prose, no markdown code fences:
{
  "broker_name": string | null,
  "broker_mc": string | null,
  "broker_dot": string | null,
  "broker_email": string | null,
  "broker_phone": string | null,
  "broker_address": string | null,
  "carrier_name": string | null,
  "carrier_mc": string | null,
  "carrier_dot": string | null,
  "load_id": string | null,
  "rate_amount": number | null,
  "rate_currency": string | null,
  "origin": string | null,
  "destination": string | null,
  "pickup_date": string | null,
  "delivery_date": string | null,
  "commodity": string | null,
  "weight": string | null,
  "equipment": string | null,
  "fraud_score": number,
  "fraud_reasons": string[],
  "notes": string | null
}

Scoring guide (fraud_score, higher = more fraudulent):
- 0-20: looks legit — clean formatting, standard language, no urgency, reasonable terms
- 21-40: minor oddities but likely legit
- 41-60: some concerning signals — unusual urgency, irregular formatting, odd grammar
- 61-80: multiple strong fraud signals — high-pressure tactics, payment irregularities, spoofed-looking details
- 81-100: textbook freight fraud pattern

Common fraud signals to look for (include matching ones in fraud_reasons):
- "urgency_pressure": "URGENT", "MUST PICKUP TODAY", all-caps pressure
- "payment_irregular": upfront payment demand, wire to personal account, unusual payment terms, "quick pay fee" >2%
- "grammar_odd": non-native English phrasing, frequent typos, inconsistent capitalization
- "format_inconsistent": font changes mid-document, mismatched logos, uneven spacing
- "email_mismatch": email domain doesn't match broker name
- "mc_missing": no MC or DOT number visible
- "wire_only": wire transfer only, no check/ACH option
- "unusually_high_rate": rate significantly above market for the lane

Extract numbers like rate_amount as pure numbers (no $ or commas). Normalize dates as YYYY-MM-DD if you can infer the year; otherwise leave as written. Return null for any field you cannot confidently extract.`;

export async function analyzeRateCon(ocrText: string): Promise<RateConExtraction> {
  const client = getClient();
  if (!client) throw new Error('ANTHROPIC_API_KEY is not set');
  const trimmed = ocrText.length > 20000 ? ocrText.slice(0, 20000) : ocrText;

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Analyze this rate confirmation OCR text and return the JSON:\n\n---\n${trimmed}\n---`,
      },
    ],
  });

  const textBlock = resp.content.find((b: any) => b.type === 'text') as any;
  if (!textBlock?.text) throw new Error('Claude returned no text content');
  const raw = textBlock.text.trim();
  const jsonStr = raw.startsWith('{') ? raw : raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();

  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error('Claude returned invalid JSON');
  }
  return {
    broker_name: parsed.broker_name ?? null,
    broker_mc: parsed.broker_mc ?? null,
    broker_dot: parsed.broker_dot ?? null,
    broker_email: parsed.broker_email ?? null,
    broker_phone: parsed.broker_phone ?? null,
    broker_address: parsed.broker_address ?? null,
    carrier_name: parsed.carrier_name ?? null,
    carrier_mc: parsed.carrier_mc ?? null,
    carrier_dot: parsed.carrier_dot ?? null,
    load_id: parsed.load_id ?? null,
    rate_amount: typeof parsed.rate_amount === 'number' ? parsed.rate_amount : null,
    rate_currency: parsed.rate_currency ?? null,
    origin: parsed.origin ?? null,
    destination: parsed.destination ?? null,
    pickup_date: parsed.pickup_date ?? null,
    delivery_date: parsed.delivery_date ?? null,
    commodity: parsed.commodity ?? null,
    weight: parsed.weight ?? null,
    equipment: parsed.equipment ?? null,
    fraud_score: typeof parsed.fraud_score === 'number' ? Math.max(0, Math.min(100, parsed.fraud_score)) : 0,
    fraud_reasons: Array.isArray(parsed.fraud_reasons) ? parsed.fraud_reasons.map(String) : [],
    notes: parsed.notes ?? null,
  };
}

// ---------- Certificate of insurance (COI) extraction ----------

export type CoiCoverage = 'auto_liability' | 'cargo' | 'general_liability' | 'workers_comp' | 'umbrella' | 'other';

export type CoiPolicy = {
  coverage: CoiCoverage;
  // The INSR LTR (A–F) printed at the start of the coverage row. Optional so
  // reports saved before it existed still type-check.
  insurer_letter?: string | null;
  insurer_name: string | null;
  naic: string | null;
  policy_number: string | null;
  effective_date: string | null; // YYYY-MM-DD
  expiration_date: string | null; // YYYY-MM-DD
  limit_amount: number | null; // USD — combined single / each occurrence / cargo limit
};

// One line of the "INSURER(S) AFFORDING COVERAGE" box.
export type CoiInsurer = {
  letter: string; // A–F
  name: string | null;
  naic: string | null; // 5 digits
};

export type CoiExtraction = {
  is_coi: boolean;
  // The INSURER A–F list. Optional for reports saved before it existed.
  insurers?: CoiInsurer[];
  insured_name: string | null;
  insured_address: string | null;
  insured_mc: string | null;
  insured_dot: string | null;
  producer_name: string | null;
  producer_phone: string | null;
  producer_email: string | null;
  certificate_date: string | null; // YYYY-MM-DD
  certificate_holder: string | null;
  policies: CoiPolicy[];
  // Things in the document's own text that don't add up. Factual, not accusations.
  irregularities: string[];
};

const COI_PROMPT = `You read OCR text from a trucking company's certificate of insurance (usually an ACORD 25 "Certificate of Liability Insurance") and return structured data.

ACORD 25 layout:
- Top-right: the certificate DATE.
- Top-left: PRODUCER = the insurance agency (name, address, contact name, phone, fax, email). The producer is never an insurer.
- Below the producer: INSURED = the trucking company (the carrier) with its address. The insured is NEVER an insurer. Numbers in the insured's address (street number, suite, ZIP) are never NAIC numbers or policy numbers.
- Right of the producer/insured: the "INSURER(S) AFFORDING COVERAGE" box with a "NAIC #" column, one line per letter: "INSURER A: <company name> <NAIC #>" through "INSURER F". This box is the ONLY place insurer names and NAIC numbers come from.
- COVERAGES table: one row per policy. The leftmost column "INSR LTR" holds a single letter A–F that points to a line in the INSURER(S) box. Then TYPE OF INSURANCE, ADDL INSD / SUBR WVD, POLICY NUMBER, POLICY EFF, POLICY EXP and LIMITS.
- Then DESCRIPTION OF OPERATIONS, and CERTIFICATE HOLDER at the bottom.

Rules:
- insurers: every non-blank INSURER line, as {"letter", "name", "naic"}. naic is the 5-digit number from the NAIC # column; null if it is missing or not exactly 5 digits. Skip blank letters.
- For each coverage row: insurer_letter = the INSR LTR letter of that row; insurer_name and naic = the name and NAIC # of that letter's line in the INSURER(S) box. Never take an insurer name from the INSURED, PRODUCER, CERTIFICATE HOLDER or DESCRIPTION boxes. If the row's letter can't be read, set insurer_letter, insurer_name and naic to null rather than guessing.
- The same letter can appear on several rows; different rows often have different letters. Read each row's own letter.
- policy_number exactly as printed on that row, including any suffix like "-25" or "-01".
- coverage: "AUTOMOBILE LIABILITY" → auto_liability; "MOTOR TRUCK CARGO" or cargo in OTHER/description → cargo; "COMMERCIAL GENERAL LIABILITY" → general_liability; "WORKERS COMPENSATION" → workers_comp; "UMBRELLA"/"EXCESS LIAB" → umbrella; anything else → other.
- limit_amount: auto → COMBINED SINGLE LIMIT (or BODILY INJURY per accident if no CSL); general liability → EACH OCCURRENCE; cargo → the cargo limit; umbrella → EACH OCCURRENCE. Pure number in USD, no $ or commas.
- Dates as YYYY-MM-DD (ACORD uses MM/DD/YYYY).
- insured_mc / insured_dot only if printed as text (often in DESCRIPTION OF OPERATIONS, e.g. "MC# 123456", "USDOT 1234567"). Digits only.
- is_coi = false if this is not an insurance certificate at all.
- irregularities: short factual notes about things in the TEXT that don't add up, for example: expiration before effective date; policy term longer than ~13 months; certificate dated in the future; the same policy number listed for different insurers; insurer named without an NAIC number; producer email on a free webmail domain (gmail, yahoo, outlook, hotmail, aol, icloud, proton); misspelled well-known insurer names; limits that conflict between rows. Do not speculate about intent and never use the words fraud, fake or scam. Empty array if nothing stands out.

Return ONLY a JSON object, no prose, no code fences:
{"is_coi": boolean, "insured_name": string|null, "insured_address": string|null, "insured_mc": string|null, "insured_dot": string|null, "producer_name": string|null, "producer_phone": string|null, "producer_email": string|null, "certificate_date": string|null, "certificate_holder": string|null, "insurers": [{"letter": string, "name": string, "naic": string|null}], "policies": [{"coverage": string, "insurer_letter": string|null, "insurer_name": string|null, "naic": string|null, "policy_number": string|null, "effective_date": string|null, "expiration_date": string|null, "limit_amount": number|null}], "irregularities": string[]}`;

const COVERAGES: CoiCoverage[] = ['auto_liability', 'cargo', 'general_liability', 'workers_comp', 'umbrella', 'other'];

export async function analyzeCoi(ocrText: string): Promise<CoiExtraction> {
  const client = getClient();
  if (!client) throw new Error('ANTHROPIC_API_KEY is not set');
  const trimmed = ocrText.length > 20000 ? ocrText.slice(0, 20000) : ocrText;

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: COI_PROMPT,
    messages: [{ role: 'user', content: `Extract this certificate of insurance and return the JSON:\n\n---\n${trimmed}\n---` }],
  });

  const textBlock = resp.content.find((b: any) => b.type === 'text') as any;
  if (!textBlock?.text) throw new Error('Claude returned no text content');
  const raw = textBlock.text.trim();
  const jsonStr = raw.startsWith('{') ? raw : raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error('Claude returned invalid JSON');
  }
  const str = (v: any) => (v == null || String(v).trim() === '' ? null : String(v).trim());
  return {
    is_coi: parsed.is_coi !== false,
    insured_name: str(parsed.insured_name),
    insured_address: str(parsed.insured_address),
    insured_mc: str(parsed.insured_mc),
    insured_dot: str(parsed.insured_dot),
    producer_name: str(parsed.producer_name),
    producer_phone: str(parsed.producer_phone),
    producer_email: str(parsed.producer_email),
    certificate_date: str(parsed.certificate_date),
    certificate_holder: str(parsed.certificate_holder),
    insurers: Array.isArray(parsed.insurers)
      ? parsed.insurers
          .map((i: any) => ({ letter: String(i?.letter ?? '').trim().toUpperCase(), name: str(i?.name), naic: str(i?.naic) }))
          .filter((i: CoiInsurer) => /^[A-F]$/.test(i.letter) && i.name)
      : [],
    policies: Array.isArray(parsed.policies)
      ? parsed.policies.map((p: any) => ({
          coverage: COVERAGES.includes(p?.coverage) ? p.coverage : 'other',
          insurer_letter: str(p?.insurer_letter),
          insurer_name: str(p?.insurer_name),
          naic: str(p?.naic),
          policy_number: str(p?.policy_number),
          effective_date: str(p?.effective_date),
          expiration_date: str(p?.expiration_date),
          limit_amount: typeof p?.limit_amount === 'number' ? p.limit_amount : null,
        }))
      : [],
    irregularities: Array.isArray(parsed.irregularities) ? parsed.irregularities.map(String).slice(0, 8) : [],
  };
}
