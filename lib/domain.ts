import { promises as dns } from 'dns';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const disposableList: string[] = require('disposable-email-domains');
const disposableSet = new Set(disposableList.map((d) => d.toLowerCase()));

export type DomainFlag = {
  sev: 'critical' | 'warning' | 'info';
  title: string;
  desc: string;
  pts: number;
};

export type DomainCheck = {
  input: string;
  domain: string;
  whois: {
    creationDate?: string;
    ageDays?: number;
    registrar?: string;
    error?: string;
  };
  mx: {
    hasMx: boolean;
    records?: string[];
    error?: string;
  };
  spf: {
    hasSpf: boolean;
  };
  disposable: boolean;
  safeBrowsing?: {
    flagged: boolean;
    threats?: string[];
    error?: string;
  };
  score: number;
  verdict: 'low' | 'medium' | 'high' | 'unknown';
  flags: DomainFlag[];
};

export function extractDomain(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  if (s.includes('@')) s = s.split('@')[1] || '';
  if (s.startsWith('http://') || s.startsWith('https://')) {
    try { s = new URL(s).hostname; } catch { /* ignore */ }
  }
  s = s.replace(/^www\./, '');
  return /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/.test(s) ? s : null;
}

async function getWhois(domain: string): Promise<DomainCheck['whois']> {
  try {
    const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      redirect: 'follow',
      headers: { Accept: 'application/rdap+json' },
    });
    if (!res.ok) return { error: `RDAP ${res.status}` };
    const data = await res.json();
    const reg = Array.isArray(data.events) ? data.events.find((e: any) => e.eventAction === 'registration') : null;
    const creationDate = reg?.eventDate as string | undefined;
    let ageDays: number | undefined;
    if (creationDate) {
      const ms = Date.now() - new Date(creationDate).getTime();
      if (!isNaN(ms)) ageDays = Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
    }
    let registrar: string | undefined;
    const registrarEntity = Array.isArray(data.entities) ? data.entities.find((e: any) => Array.isArray(e.roles) && e.roles.includes('registrar')) : null;
    const vcard = registrarEntity?.vcardArray?.[1];
    if (Array.isArray(vcard)) {
      const fn = vcard.find((f: any) => Array.isArray(f) && f[0] === 'fn');
      if (fn && typeof fn[3] === 'string') registrar = fn[3];
    }
    return { creationDate, ageDays, registrar };
  } catch (e: any) {
    return { error: e?.message || 'RDAP lookup failed' };
  }
}

async function getMx(domain: string): Promise<DomainCheck['mx']> {
  try {
    const records = await dns.resolveMx(domain);
    const exchanges = records.map((r) => r.exchange).filter(Boolean);
    return { hasMx: exchanges.length > 0, records: exchanges };
  } catch (e: any) {
    const code = e?.code || '';
    if (code === 'ENODATA' || code === 'ENOTFOUND') return { hasMx: false };
    return { hasMx: false, error: code || 'MX lookup failed' };
  }
}

async function getSpf(domain: string): Promise<DomainCheck['spf']> {
  try {
    const records = await dns.resolveTxt(domain);
    const hasSpf = records.flat().some((s) => typeof s === 'string' && s.toLowerCase().startsWith('v=spf1'));
    return { hasSpf };
  } catch {
    return { hasSpf: false };
  }
}

async function getSafeBrowsing(domain: string): Promise<DomainCheck['safeBrowsing']> {
  const key = process.env.GOOGLE_SAFE_BROWSING_API_KEY;
  if (!key) return undefined;
  try {
    const body = {
      client: { clientId: 'haulock', clientVersion: '1.0.0' },
      threatInfo: {
        threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
        platformTypes: ['ANY_PLATFORM'],
        threatEntryTypes: ['URL'],
        threatEntries: [{ url: `http://${domain}` }, { url: `https://${domain}` }],
      },
    };
    const res = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { flagged: false, error: `Safe Browsing ${res.status}` };
    const data = await res.json();
    const matches = Array.isArray(data.matches) ? data.matches : [];
    return { flagged: matches.length > 0, threats: matches.map((m: any) => m.threatType).filter(Boolean) };
  } catch (e: any) {
    return { flagged: false, error: e?.message || 'Safe Browsing failed' };
  }
}

function buildFlags(c: Pick<DomainCheck, 'whois' | 'mx' | 'spf' | 'safeBrowsing' | 'disposable'>): DomainFlag[] {
  const flags: DomainFlag[] = [];
  if (c.disposable) {
    flags.push({
      sev: 'critical',
      title: 'Disposable email domain',
      desc: 'This domain is on the public list of throwaway email providers. No legitimate broker uses one.',
      pts: 50,
    });
  }
  const days = c.whois.ageDays;
  if (days != null) {
    if (days <= 30) {
      flags.push({
        sev: 'critical',
        title: `Domain registered ${days} day${days === 1 ? '' : 's'} ago`,
        desc: 'Very new domains are a textbook fraud signal. Legit brokers have years-old domains.',
        pts: 40,
      });
    } else if (days <= 90) {
      flags.push({
        sev: 'warning',
        title: `Domain registered ${days} days ago`,
        desc: 'Under 90 days — treat with caution, verify identity through another channel.',
        pts: 25,
      });
    } else if (days <= 365) {
      flags.push({
        sev: 'info',
        title: `Domain under 1 year old (${days} days)`,
        desc: 'Not a red flag on its own, but worth noting.',
        pts: 5,
      });
    }
  }
  if (!c.mx.hasMx) {
    flags.push({
      sev: 'critical',
      title: 'No MX records on domain',
      desc: 'This domain is not configured to receive email. Real businesses have MX records.',
      pts: 40,
    });
  }
  if (c.mx.hasMx && !c.spf.hasSpf) {
    flags.push({
      sev: 'info',
      title: 'No SPF record',
      desc: 'Domain can send email but has no anti-spoofing policy. Not a hard red flag; many smaller businesses lack SPF.',
      pts: 5,
    });
  }
  if (c.safeBrowsing?.flagged) {
    flags.push({
      sev: 'critical',
      title: 'Flagged by Google Safe Browsing',
      desc: `Threats: ${(c.safeBrowsing.threats || []).join(', ') || 'unspecified'}.`,
      pts: 50,
    });
  }
  return flags;
}

export async function checkDomain(input: string): Promise<DomainCheck> {
  const domain = extractDomain(input);
  if (!domain) {
    return {
      input,
      domain: input,
      whois: { error: 'Invalid domain' },
      mx: { hasMx: false, error: 'Invalid domain' },
      spf: { hasSpf: false },
      disposable: false,
      score: 0,
      verdict: 'unknown',
      flags: [{ sev: 'info', title: 'Invalid input', desc: 'Enter a domain (e.g. acmefreight.com) or an email address.', pts: 0 }],
    };
  }
  const disposable = disposableSet.has(domain.toLowerCase());
  const [whois, mx, spf, safeBrowsing] = await Promise.all([getWhois(domain), getMx(domain), getSpf(domain), getSafeBrowsing(domain)]);
  const flags = buildFlags({ whois, mx, spf, safeBrowsing, disposable });
  const score = Math.min(100, flags.reduce((s, f) => s + f.pts, 0));
  const verdict: DomainCheck['verdict'] = score >= 61 ? 'high' : score >= 31 ? 'medium' : 'low';
  return { input, domain, whois, mx, spf, disposable, safeBrowsing, score, verdict, flags };
}
