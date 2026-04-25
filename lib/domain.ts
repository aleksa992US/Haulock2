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
    // Friendly classification of WHO actually runs this domain's email.
    // "Google Workspace" / "Microsoft 365" → enterprise email, legitimate.
    // "Cloudflare email routing" / "Forwarder only" → light setup.
    // null → unknown / non-standard.
    provider?: string | null;
    error?: string;
  };
  spf: {
    hasSpf: boolean;
  };
  // DMARC = the spec that tells receivers how strictly to enforce SPF/DKIM
  // alignment. Real businesses publish a DMARC policy; spoofers usually
  // don't. Cheap, free DNS lookup.
  dmarc: {
    hasDmarc: boolean;
    policy?: 'none' | 'quarantine' | 'reject' | string;
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
    return {
      hasMx: exchanges.length > 0,
      records: exchanges,
      provider: detectMxProvider(exchanges),
    };
  } catch (e: any) {
    const code = e?.code || '';
    if (code === 'ENODATA' || code === 'ENOTFOUND') return { hasMx: false, provider: null };
    return { hasMx: false, provider: null, error: code || 'MX lookup failed' };
  }
}

// Pattern-match the MX exchange hostnames to identify the email provider.
// Real businesses use one of a handful of well-known providers; novel
// hostnames suggest a small / hobbyist setup or a shell domain.
function detectMxProvider(exchanges: string[]): string | null {
  if (!exchanges || exchanges.length === 0) return null;
  const all = exchanges.map((x) => x.toLowerCase()).join(' ');
  const checks: Array<{ re: RegExp; name: string }> = [
    // Big enterprise / SMB providers
    { re: /(^|\.)google(?:mail)?\.com$|aspmx.*google|googlemail/, name: 'Google Workspace' },
    { re: /\.protection\.outlook\.com$|\.mail\.protection\.outlook\.com$|mail\.outlook\.com$/, name: 'Microsoft 365' },
    { re: /\.pphosted\.com$|proofpoint/, name: 'Proofpoint' },
    { re: /\.mimecast\.com$/, name: 'Mimecast' },
    { re: /\.barracudanetworks\.com$/, name: 'Barracuda' },
    { re: /\.iphmx\.com$|cisco\.iphmx/, name: 'Cisco IronPort' },
    // Smaller business providers
    { re: /\.zoho\.com$|zohomail/, name: 'Zoho Mail' },
    { re: /\.fastmail(?:\.com)?$|messagingengine\.com$/, name: 'Fastmail' },
    { re: /\.protonmail\.ch$|\.proton\.me$/, name: 'ProtonMail' },
    { re: /\.icloud\.com$/, name: 'iCloud' },
    { re: /\.yandex\.(?:com|ru|net)$/, name: 'Yandex' },
    { re: /\.yahoodns\.net$|\.yahoo\.com$/, name: 'Yahoo' },
    // Hosting bundles (lots of small biz domains live here)
    { re: /secureserver\.net$/, name: 'GoDaddy / Smartermail' },
    { re: /\.namecheap\.com$|privateemail\.com$|jellyfish\.systems$/, name: 'Namecheap Private Email' },
    { re: /\.bluehost\.com$|\.hostgator\.com$|\.dreamhost\.com$/, name: 'Bluehost / cPanel host' },
    { re: /\.ionos\.(?:com|de)$|hosteurope/, name: 'IONOS / 1&1' },
    { re: /\.titan\.email$/, name: 'Titan (Hostinger / Namecheap)' },
    // Email-routing / forwarder services (lighter signal)
    { re: /\.cloudflare\.net$/, name: 'Cloudflare email routing' },
    { re: /improvmx\.com$|forwardemail/, name: 'Email-forwarding service' },
    // Transactional / sending-only (uncommon as primary MX, often a flag)
    { re: /mailgun\.org$/, name: 'Mailgun (transactional)' },
    { re: /sendgrid\.net$/, name: 'SendGrid (transactional)' },
    { re: /amazonaws\.com$|amazonses/, name: 'Amazon SES' },
  ];
  for (const c of checks) if (c.re.test(all)) return c.name;
  return null;
}

async function getDmarc(domain: string): Promise<DomainCheck['dmarc']> {
  try {
    const records = await dns.resolveTxt(`_dmarc.${domain}`);
    for (const chunks of records) {
      const joined = chunks.join('').toLowerCase();
      if (!joined.startsWith('v=dmarc1')) continue;
      // p= directive: 'none' | 'quarantine' | 'reject' (per RFC 7489)
      const m = joined.match(/[;\s]p=(none|quarantine|reject)/);
      return { hasDmarc: true, policy: m ? (m[1] as any) : undefined };
    }
    return { hasDmarc: false };
  } catch {
    return { hasDmarc: false };
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

function buildFlags(c: Pick<DomainCheck, 'whois' | 'mx' | 'spf' | 'dmarc' | 'safeBrowsing' | 'disposable'>): DomainFlag[] {
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
  if (c.mx.hasMx && !c.dmarc.hasDmarc) {
    flags.push({
      sev: 'info',
      title: 'No DMARC policy',
      desc: 'Domain doesn\'t publish a DMARC policy — receivers can\'t verify whether spoofed mail from this domain should be rejected. Not conclusive (many small businesses skip DMARC), but real enterprise email setups publish one.',
      pts: 5,
    });
  } else if (c.dmarc.hasDmarc && c.dmarc.policy === 'none') {
    flags.push({
      sev: 'info',
      title: 'DMARC policy set to "none"',
      desc: 'DMARC is published but configured in monitor-only mode. Provides visibility but doesn\'t block spoofed mail.',
      pts: 0,
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
      mx: { hasMx: false, provider: null, error: 'Invalid domain' },
      spf: { hasSpf: false },
      dmarc: { hasDmarc: false },
      disposable: false,
      score: 0,
      verdict: 'unknown',
      flags: [{ sev: 'info', title: 'Invalid input', desc: 'Enter a domain (e.g. acmefreight.com) or an email address.', pts: 0 }],
    };
  }
  const disposable = disposableSet.has(domain.toLowerCase());
  const [whois, mx, spf, dmarc, safeBrowsing] = await Promise.all([
    getWhois(domain), getMx(domain), getSpf(domain), getDmarc(domain), getSafeBrowsing(domain),
  ]);
  const flags = buildFlags({ whois, mx, spf, dmarc, safeBrowsing, disposable });
  const score = Math.min(100, flags.reduce((s, f) => s + f.pts, 0));
  const verdict: DomainCheck['verdict'] = score >= 61 ? 'high' : score >= 31 ? 'medium' : 'low';
  return { input, domain, whois, mx, spf, dmarc, disposable, safeBrowsing, score, verdict, flags };
}
