// US cities, towns and ZIP codes for the load planner: type-ahead
// suggestions and offline lookup, US only (50 states + DC).
// Data: GeoNames (https://www.geonames.org, CC BY 4.0). See data/us-places.README.txt.

import raw from '@/data/us-places.json';

export type UsPlace = { label: string; detail?: string; lat: number; lng: number; state: string; zip?: string };

type City = { name: string; st: string; lat: number; lng: number; pop: number; key: string };

export const US_STATES = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' '));

const STATE_NAMES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE',
  'district of columbia': 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
  pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};

// "St. Louis" / "Saint Louis" / "st louis" all compare equal; same for Ft/Fort, Mt/Mount.
const ALIAS: Record<string, string> = { st: 'saint', ste: 'sainte', ft: 'fort', mt: 'mount', pt: 'point' };
function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
    .split(' ').map((w) => ALIAS[w] || w).join(' ');
}

let cities: City[] | null = null;
let zips: { zip: string; lat: number; lng: number; city: City | null }[] = [];
let zipIndex = new Map<string, number>();

function load(): City[] {
  if (cities) return cities;
  const data = raw as { c: string[]; z: string[] };
  cities = data.c.map((row) => {
    const [name, st, lat, lng, pop] = row.split('|');
    return { name, st, lat: Number(lat), lng: Number(lng), pop: Number(pop), key: norm(name) };
  });
  zips = data.z.map((row) => {
    const [zip, lat, lng, idx] = row.split('|');
    const i = Number(idx);
    return { zip, lat: Number(lat), lng: Number(lng), city: i >= 0 ? cities![i] : null };
  });
  zipIndex = new Map(zips.map((z, i) => [z.zip, i]));
  return cities;
}

const cityPlace = (c: City): UsPlace => ({
  label: `${c.name}, ${c.st}`,
  detail: c.pop >= 1000 ? `pop. ${c.pop.toLocaleString('en-US')}` : undefined,
  lat: c.lat, lng: c.lng, state: c.st,
});

// Split "Austin, TX" / "austin tx" / "Austin Texas" into city text + state.
function splitState(q: string): { city: string; st: string | null } {
  const t = q.trim().replace(/\s+/g, ' ');
  const m = t.match(/^(.*?)[,\s]+([A-Za-z]{2})\.?$/);
  if (m && m[1].trim() && US_STATES.has(m[2].toUpperCase())) return { city: m[1].trim(), st: m[2].toUpperCase() };
  const lower = t.toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ');
  for (const [name, st] of Object.entries(STATE_NAMES)) {
    if (lower.endsWith(` ${name}`) && lower.length > name.length + 1) return { city: t.slice(0, lower.length - name.length).replace(/[,\s]+$/, ''), st };
  }
  return { city: t.replace(/,\s*$/, ''), st: null };
}

export function suggestUsPlaces(qIn: string, limit = 8): UsPlace[] {
  const q = (qIn || '').trim();
  if (q.length < 2) return [];
  const list = load();

  // ZIP codes: "604" → 60401, 60402…
  const zipM = q.match(/^(\d{3,5})$/);
  if (zipM) {
    const out: UsPlace[] = [];
    for (const z of zips) {
      if (!z.zip.startsWith(zipM[1])) continue;
      out.push({
        label: z.city ? `${z.city.name}, ${z.city.st} ${z.zip}` : z.zip,
        detail: z.zip,
        lat: z.lat, lng: z.lng, state: z.city?.st || '', zip: z.zip,
      });
      if (out.length >= limit) break;
    }
    return out.filter((p) => p.state);
  }

  const { city, st } = splitState(q);
  const key = norm(city);
  if (!key) return [];
  const exact: City[] = [], prefix: City[] = [], word: City[] = [];
  for (const c of list) {
    if (st && c.st !== st) continue;
    if (c.key === key) exact.push(c);
    else if (c.key.startsWith(key)) prefix.push(c);
    else if (key.length >= 3 && c.key.includes(` ${key}`)) word.push(c);
    if (exact.length + prefix.length >= limit * 6) break; // list is sorted by population
  }
  return [...exact, ...prefix, ...word].slice(0, limit).map(cityPlace);
}

// Exact lookup of what a user typed: a ZIP, "City, ST", "City ST 12345".
export function findUsPlace(qIn: string): UsPlace | null {
  const q = (qIn || '').trim();
  if (!q) return null;
  load();
  const zip = q.match(/\b(\d{5})(?:-\d{4})?\s*$/);
  if (zip && zipIndex.has(zip[1])) {
    const z = zips[zipIndex.get(zip[1])!];
    if (z.city) return { label: `${z.city.name}, ${z.city.st} ${z.zip}`, lat: z.lat, lng: z.lng, state: z.city.st, zip: z.zip };
  }
  const withoutZip = q.replace(/\b\d{5}(?:-\d{4})?\s*$/, '').trim();
  const { city, st } = splitState(withoutZip);
  // Street addresses ("123 Main St, Joliet, IL") go to a geocoder instead.
  if (!st || /\d/.test(city)) return null;
  const key = norm(city.split(',').pop() || city);
  const c = load().find((x) => x.st === st && x.key === key);
  return c ? cityPlace(c) : null;
}

// Nearest US city to a point (for "use my location"), or null when the
// point isn't within 25 miles of one (outside the US).
export function nearestUsCity(lat: number, lng: number): (UsPlace & { miles: number }) | null {
  let best: City | null = null, bestD = Infinity;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  for (const c of load()) {
    const dy = c.lat - lat, dx = (c.lng - lng) * cosLat;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = c; }
  }
  if (!best) return null;
  const miles = Math.sqrt(bestD) * 69;
  return miles <= 25 ? { ...cityPlace(best), miles } : null;
}
