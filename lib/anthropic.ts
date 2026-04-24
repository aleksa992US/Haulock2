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
