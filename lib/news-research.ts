import Anthropic from '@anthropic-ai/sdk';

// Researches recent freight-fraud news using Brave Search and turns it into
// a short, catchy article with Claude. Used by the weekly fraud-trends
// newsletter sender. Designed to be deterministic enough to run unattended
// on a cron — every step has a sensible fallback if upstream is down.

let anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic | null {
  if (anthropic) return anthropic;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  anthropic = new Anthropic({ apiKey: key });
  return anthropic;
}

export type FraudArticle = {
  title: string;
  // Plain-text summary used as the email preview / heading subline.
  preview: string;
  // Inline HTML for the email body — already escaped.
  bodyHtml: string;
  // Sources we used (article URL + title) so the email can link out.
  sources: { title: string; url: string }[];
  // Tactic name, e.g. "Identity theft", "Double brokering", "Phishing rate cons".
  topic: string;
  // Whether Haulock can actually help with this kind of fraud (used to decide
  // whether to render the "How Haulock helps" CTA section).
  haulockHelps: boolean;
  // Generated at UTC ISO timestamp — recorded in email_log + admin tab.
  generatedAt: string;
};

// Topic seeds we cycle through so the newsletter doesn't keep covering the
// same story week after week. The cron picks the topic based on the ISO
// week number, so the same week always renders the same topic (idempotent).
const TOPICS = [
  'freight identity theft scam',
  'double brokering scam trucking',
  'rate confirmation fraud spoofed broker',
  'cargo theft strategic theft trucking',
  'fictitious pickup load theft',
  'fraudulent broker stolen MC number',
  'trucking factoring fraud non-payment',
  'spoofed email address logistics fraud',
  'phishing fake load board scam',
  'carrier impersonation freight fraud',
];

export function pickWeekTopic(now = new Date()): string {
  // ISO week number — gives a stable index per week.
  const onejan = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const week = Math.floor(((now.getTime() - onejan.getTime()) / 86400000 + onejan.getUTCDay() + 1) / 7);
  return TOPICS[week % TOPICS.length];
}

export type SearchHit = { title: string; url: string; snippet: string; age?: string };

export async function searchFraudNews(topic: string, opts: { maxResults?: number; freshness?: 'pd' | 'pw' | 'pm' } = {}): Promise<SearchHit[]> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return [];
  const params = new URLSearchParams({
    q: topic,
    count: String(opts.maxResults ?? 10),
    safesearch: 'moderate',
    text_decorations: 'false',
    freshness: opts.freshness ?? 'pm', // past month
  });
  try {
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': key,
      },
    });
    if (!res.ok) {
      console.warn('[news-research] Brave search failed', { status: res.status, topic });
      return [];
    }
    const data = await res.json();
    const results = (data?.web?.results || []) as any[];
    return results.map((r) => ({
      title: cleanText(r.title || ''),
      url: r.url || '',
      snippet: cleanText(r.description || ''),
      age: r.age || undefined,
    })).filter((r) => r.url && r.title);
  } catch (err: any) {
    console.warn('[news-research] Brave search threw', { message: err?.message, topic });
    return [];
  }
}

function cleanText(s: string): string {
  return String(s || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const SYSTEM_PROMPT = `You are a freight-industry fraud analyst writing a short, plain-spoken weekly email briefing for working carriers and brokers (the kind of people running 1-50 trucks). Your readers are busy, skeptical of marketing fluff, and lose real money to these scams.

Your job: take a topic and a few real news snippets, and write a single short article in the structure below.

CONSTRAINTS:
- Plain English. Short sentences. No marketing tone, no fearmongering, no clickbait.
- Never use em-dashes (—). Use periods, commas, "and", or colons instead. Em-dashes are an AI tell and our brand avoids them.
- Never invent statistics, dollar amounts, or specific company names that aren't in the source snippets. If you don't know, don't claim it.
- The article must end with concrete protection steps the reader can take TODAY.
- If Haulock (the product running this newsletter) can help with the specific fraud type, set haulockHelps = true and include ONE short paragraph at the end describing how. If Haulock cannot meaningfully help (e.g. cargo theft in transit, factoring fraud against the broker), set haulockHelps = false and skip that paragraph.

WHAT HAULOCK CAN HELP WITH:
- Verifying brokers and carriers before booking (identity, MC/DOT, insurance, address, website, social, web reputation).
- Detecting spoofed rate confirmations (PDF analysis, broker name vs FMCSA name match, lookalike domains).
- Flagging chameleon/serial-fraud carriers via shared addresses or phone numbers.
- Web-reputation scan across FreightWaves, Land Line, TruckersReport, BBB, and government enforcement sites.

WHAT HAULOCK CANNOT HELP WITH:
- Fraud that happens AFTER pickup (cargo theft in transit, fictitious-pickup style theft once the truck is loaded).
- Fraud against payment terms after the load is delivered (slow pay, factoring disputes, chargebacks).
- Anything that requires physical security, insurance claims, or law enforcement.

Return ONLY a JSON object matching this schema, no prose, no markdown code fences:
{
  "title": string,                // catchy, specific, max 70 chars, no em-dash
  "preview": string,              // one-sentence summary, max 140 chars
  "topic_label": string,          // 1-3 word label (e.g. "Identity theft", "Double brokering")
  "lede": string,                 // 1 short paragraph, plain English, what's happening
  "scenario": string,             // 1 short paragraph describing a concrete realistic situation a carrier might encounter
  "protect_steps": string[],      // 3-5 concrete actions the reader can take. Short bullets, imperative voice. No fluff.
  "haulock_helps": boolean,
  "haulock_paragraph": string,    // if haulock_helps=true, 1 short paragraph on how Haulock specifically helps. else "".
  "sources_used": number[]        // 0-based indices of source snippets that informed the article
}`;

export async function generateFraudArticle(topic: string, sources: SearchHit[]): Promise<FraudArticle | null> {
  const client = getAnthropic();
  if (!client) {
    console.warn('[news-research] ANTHROPIC_API_KEY not set');
    return null;
  }
  const sourceBlock = sources.length === 0
    ? '(no fresh sources found — write a careful evergreen briefing on the topic; do not fabricate news)'
    : sources.map((s, i) => `[${i}] ${s.title}\n    ${s.snippet}\n    ${s.url}`).join('\n\n');

  const userPrompt = `TOPIC: ${topic}\n\nRECENT NEWS / WEB CONTEXT:\n${sourceBlock}\n\nWrite the article now. Return only the JSON.`;

  let parsed: any;
  try {
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const textBlock = resp.content.find((b: any) => b.type === 'text') as any;
    if (!textBlock?.text) return null;
    const raw = textBlock.text.trim();
    const json = raw.startsWith('{') ? raw : raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    parsed = JSON.parse(json);
  } catch (err: any) {
    console.warn('[news-research] generateFraudArticle parse failed', { message: err?.message });
    return null;
  }

  const title = String(parsed.title || '').replace(/—/g, ':').slice(0, 100).trim() || 'Fraud trend update';
  const preview = String(parsed.preview || '').replace(/—/g, ':').slice(0, 200).trim() || 'This week in freight fraud.';
  const topicLabel = String(parsed.topic_label || 'Fraud trend').slice(0, 40);
  const lede = String(parsed.lede || '').replace(/—/g, ':').trim();
  const scenario = String(parsed.scenario || '').replace(/—/g, ':').trim();
  const protectSteps: string[] = Array.isArray(parsed.protect_steps)
    ? parsed.protect_steps.map((s: any) => String(s || '').replace(/—/g, ':').trim()).filter(Boolean).slice(0, 6)
    : [];
  const haulockHelps = parsed.haulock_helps === true;
  const haulockParagraph = haulockHelps ? String(parsed.haulock_paragraph || '').replace(/—/g, ':').trim() : '';
  const sourcesUsedIdx: number[] = Array.isArray(parsed.sources_used)
    ? parsed.sources_used.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n) && n >= 0 && n < sources.length)
    : [];
  const sourcesUsed = sourcesUsedIdx.length > 0
    ? sourcesUsedIdx.map((i) => sources[i]).map((s) => ({ title: s.title, url: s.url }))
    : sources.slice(0, 3).map((s) => ({ title: s.title, url: s.url }));

  // Render the inline HTML body using the email design tokens. Keep it simple
  // so it works in every email client.
  const bodyHtml = renderArticleHtml({ topicLabel, lede, scenario, protectSteps, haulockHelps, haulockParagraph });

  return {
    title,
    preview,
    bodyHtml,
    sources: sourcesUsed,
    topic: topicLabel,
    haulockHelps,
    generatedAt: new Date().toISOString(),
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function renderArticleHtml(args: {
  topicLabel: string;
  lede: string;
  scenario: string;
  protectSteps: string[];
  haulockHelps: boolean;
  haulockParagraph: string;
}): string {
  const stepsHtml = args.protectSteps.length === 0 ? '' : `
<div style="background:rgba(11,30,63,0.04);border-radius:12px;padding:20px;margin:0 0 24px 0;">
  <div style="font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;color:rgba(11,30,63,0.55);margin-bottom:12px;">How to protect yourself this week</div>
  <ol style="margin:0;padding-left:20px;font-size:15px;line-height:1.65;color:rgba(11,30,63,0.85);">
    ${args.protectSteps.map((s) => `<li style="margin-bottom:8px;">${escapeHtml(s)}</li>`).join('')}
  </ol>
</div>`;

  const haulockBlock = args.haulockHelps && args.haulockParagraph ? `
<div style="background:rgba(255,107,53,0.06);border:1px solid rgba(255,107,53,0.2);border-radius:12px;padding:20px;margin:0 0 24px 0;">
  <div style="font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;color:#FF6B35;font-weight:600;margin-bottom:8px;">How Haulock helps</div>
  <div style="font-size:15px;line-height:1.65;color:rgba(11,30,63,0.85);">${escapeHtml(args.haulockParagraph)}</div>
</div>` : '';

  return `
<div style="display:inline-block;padding:4px 10px;background:rgba(11,30,63,0.06);color:rgba(11,30,63,0.7);border-radius:999px;font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:16px;">${escapeHtml(args.topicLabel)} · This week</div>
${args.lede ? `<p style="margin:0 0 16px 0;font-size:16px;line-height:1.65;color:rgba(11,30,63,0.85);">${escapeHtml(args.lede)}</p>` : ''}
${args.scenario ? `<div style="border-left:3px solid rgba(11,30,63,0.15);padding-left:16px;margin:0 0 24px 0;"><div style="font-size:11px;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;color:rgba(11,30,63,0.55);margin-bottom:6px;">What it looks like</div><p style="margin:0;font-size:15px;line-height:1.65;color:rgba(11,30,63,0.75);font-style:italic;">${escapeHtml(args.scenario)}</p></div>` : ''}
${stepsHtml}
${haulockBlock}`;
}
