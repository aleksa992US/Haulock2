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
  broker_name: string | null;
  broker_mc: string | null;
  broker_dot: string | null;
  broker_email: string | null;
  broker_phone: string | null;
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

const SYSTEM_PROMPT = `You are a freight fraud analyst. You receive raw OCR text extracted from a broker's rate confirmation document. Your job is to:

1) Extract structured fields about the broker and the load.
2) Score the document 0-100 for fraud signals based on writing style, urgency language, grammar oddities, mismatched formatting, and suspicious payment terms.

Return ONLY a JSON object matching this exact schema, no prose, no markdown code fences:
{
  "broker_name": string | null,
  "broker_mc": string | null,
  "broker_dot": string | null,
  "broker_email": string | null,
  "broker_phone": string | null,
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
