export type SocialLink = { platform: SocialPlatform; url: string };
export type SocialPlatform = 'facebook' | 'linkedin' | 'twitter' | 'instagram' | 'youtube' | 'tiktok';

const SOCIAL_PATTERNS: { platform: SocialPlatform; pattern: RegExp }[] = [
  { platform: 'facebook', pattern: /https?:\/\/(?:www\.)?(?:facebook|fb)\.com\/[A-Za-z0-9.\-_/]+/gi },
  { platform: 'linkedin', pattern: /https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in|school)\/[A-Za-z0-9.\-_/]+/gi },
  { platform: 'twitter',  pattern: /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[A-Za-z0-9_]+/gi },
  { platform: 'instagram',pattern: /https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9._]+/gi },
  { platform: 'youtube',  pattern: /https?:\/\/(?:www\.)?youtube\.com\/(?:channel\/|c\/|user\/|@)[A-Za-z0-9._\-/]+/gi },
  { platform: 'tiktok',   pattern: /https?:\/\/(?:www\.)?tiktok\.com\/@[A-Za-z0-9._]+/gi },
];

// Reject share/intent/help/login URLs that aren't actually a profile
const REJECT_PATH = /\/(?:sharer|share|intent|tr\?|tracker|plugins|policies|policy|help|login|signup|home|hashtag|search|tweet|watch\?)\b/i;
// Reject obvious non-profile platform paths
const REJECT_HOSTS_PATHS: Record<string, RegExp> = {
  'facebook.com': /^\/(?:sharer|tr|plugins|policies|help|login|signup|hashtag|home|watch|search|gaming)$/i,
  'linkedin.com': /^\/(?:share|sharing|jobs|search|feed|login|help|legal|sales)$/i,
  'twitter.com': /^\/(?:share|intent|home|search|i|login|signup|hashtag|explore)$/i,
  'x.com':       /^\/(?:share|intent|home|search|i|login|signup|hashtag|explore)$/i,
  'instagram.com': /^\/(?:p|reel|tv|stories|explore|accounts)\/?$/i,
  'youtube.com': /^\/(?:watch|results|feed|playlist|shorts|t)$/i,
  'tiktok.com': /^\/(?:tag|search|signup|login|live|foryou)$/i,
};

function cleanUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    u.hash = '';
    u.search = '';
    let p = u.pathname.replace(/\/+$/, '');
    if (p === '') return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const rejectPattern = REJECT_HOSTS_PATHS[host];
    const firstSeg = '/' + p.split('/').filter(Boolean)[0];
    if (rejectPattern && rejectPattern.test(firstSeg)) return null;
    if (REJECT_PATH.test(p)) return null;
    u.pathname = p;
    return u.toString();
  } catch {
    return null;
  }
}

const FETCH_TIMEOUT_MS = 5000;
const MAX_BYTES = 500_000; // cap at ~500KB to avoid slurping huge pages

export async function findSocialLinks(websiteUrl: string): Promise<SocialLink[]> {
  let html = '';
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(websiteUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; HaulockBot/1.0; +https://haulock.com)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    }).finally(() => clearTimeout(t));
    if (!res.ok) return [];
    const reader = res.body?.getReader();
    if (!reader) return [];
    const decoder = new TextDecoder();
    let received = 0;
    while (received < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      html += decoder.decode(value, { stream: true });
    }
    try { await reader.cancel(); } catch {}
  } catch {
    return [];
  }

  const found = new Map<SocialPlatform, string>();
  for (const { platform, pattern } of SOCIAL_PATTERNS) {
    const matches = html.match(pattern);
    if (!matches) continue;
    for (const raw of matches) {
      const cleaned = cleanUrl(raw);
      if (!cleaned) continue;
      if (!found.has(platform)) {
        found.set(platform, cleaned);
        break;
      }
    }
  }
  return Array.from(found.entries()).map(([platform, url]) => ({ platform, url }));
}
