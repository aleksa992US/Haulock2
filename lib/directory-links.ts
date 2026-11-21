// URLs and labels for the public directory. Safe to import from client
// components: no keys, no server calls.

export type DirectoryKind = 'brokers' | 'carriers';

export const KIND_LABEL: Record<DirectoryKind, { plural: string; singular: string; title: string }> = {
  brokers: { plural: 'freight brokers', singular: 'freight broker', title: 'Freight brokers' },
  carriers: { plural: 'trucking companies', singular: 'trucking company', title: 'Trucking companies' },
};

export function isDirectoryKind(v: string): v is DirectoryKind {
  return v === 'brokers' || v === 'carriers';
}

export const US_STATES: { code: string; name: string }[] = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'], ['CO', 'Colorado'],
  ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'],
  ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'],
  ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'], ['MA', 'Massachusetts'],
  ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'],
  ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'],
  ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'],
  ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'], ['SD', 'South Dakota'],
  ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'],
  ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
].map(([code, name]) => ({ code, name }));

export function stateByCode(code: string | undefined | null): { code: string; name: string } | undefined {
  const c = String(code || '').toUpperCase();
  return US_STATES.find((s) => s.code === c);
}

const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '').replace(/^0+/, '');

// A company's page: by MC when it has one, otherwise by USDOT number.
export function companyPath(c: { mc?: string | null; dot?: string | null }): string | null {
  const mc = digits(c.mc);
  const dot = digits(c.dot);
  return mc ? `/company/mc-${mc}` : dot ? `/company/dot-${dot}` : null;
}

export function parseCompanyId(id: string): { mc?: string; dot?: string } | null {
  const m = String(id || '').toLowerCase().match(/^(mc|dot)-(\d{1,9})$/);
  if (!m) return null;
  const n = m[2].replace(/^0+/, '');
  if (!n) return null;
  return m[1] === 'mc' ? { mc: n } : { dot: n };
}

export function statePath(kind: DirectoryKind, stateCode: string, page = 1): string {
  return `/directory/${kind}/${stateCode.toLowerCase()}${page > 1 ? `/${page}` : ''}`;
}

export function roleLabel(role: string): string {
  return role === 'both' ? 'Carrier and broker' : role === 'broker' ? 'Freight broker' : role === 'carrier' ? 'Carrier' : role === 'dot-only' ? 'Carrier (USDOT number only)' : 'No active operating authority';
}
