// The carrier's own registration contact details from FMCSA's public
// Company Census File (data.transportation.gov az4n-8mr2), as filed on its
// MCS-150: company officer names, email address, phone and the filing date.
// QCMobile doesn't return any of these. Public FMCSA data, shown so a user
// can ask for the officer by name on a number they got from FMCSA.

const CENSUS = process.env.FMCSA_CENSUS_DATASET_ID || 'az4n-8mr2';
const BASE = 'https://data.transportation.gov/resource';
const TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // the census refreshes daily

export type CensusContact = {
  officers: string[];       // up to two, as filed (title-cased)
  email?: string;
  phone?: string;
  cellPhone?: string;
  mcs150Date?: string;      // YYYY-MM-DD — when the filing was last updated
};

const cache = new Map<string, { at: number; value: CensusContact | null }>();

function titleCase(name: string): string {
  // "MILOS STOJANOVIC" → "Milos Stojanovic"; mixed case is left as filed.
  return name === name.toUpperCase()
    ? name.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase())
    : name;
}

function phone(v: unknown): string | undefined {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : undefined;
}

export async function fetchCensusContact(dot: string | null | undefined): Promise<CensusContact | null> {
  const n = String(dot ?? '').replace(/\D/g, '').replace(/^0+/, '');
  if (!n) return null;
  const hit = cache.get(n);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const params = new URLSearchParams({
    $where: `dot_number = ${Number(n)}`,
    $limit: '1',
    $select: 'company_officer_1,company_officer_2,email_address,phone,cell_phone,mcs150_date',
  });
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (process.env.SOCRATA_APP_TOKEN) headers['X-App-Token'] = process.env.SOCRATA_APP_TOKEN;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/${CENSUS}.json?${params.toString()}`, { headers, signal: controller.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`Census ${res.status}`);
    const rows = await res.json();
    const r = Array.isArray(rows) ? rows[0] : null;
    let value: CensusContact | null = null;
    if (r) {
      const officers = [r.company_officer_1, r.company_officer_2]
        .map((o: unknown) => String(o ?? '').replace(/\s+/g, ' ').trim())
        .filter((o: string) => o.length > 1)
        .map(titleCase)
        .filter((o: string, i: number, all: string[]) => all.findIndex((x) => x.toLowerCase() === o.toLowerCase()) === i);
      const d = String(r.mcs150_date || '').match(/^(\d{4})(\d{2})(\d{2})/);
      const email = String(r.email_address || '').trim().toLowerCase();
      value = {
        officers,
        email: /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email) ? email : undefined,
        phone: phone(r.phone),
        cellPhone: phone(r.cell_phone),
        mcs150Date: d ? `${d[1]}-${d[2]}-${d[3]}` : undefined,
      };
    }
    cache.set(n, { at: Date.now(), value });
    return value;
  } catch (e) {
    console.warn('[census] contact lookup failed', { dot: n, error: e instanceof Error ? e.message : e });
    return null; // not cached: try again next lookup
  } finally {
    clearTimeout(timer);
  }
}
