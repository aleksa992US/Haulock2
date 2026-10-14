// Load planner: geocode the driver's location, pickup and delivery, get
// truck miles and drive time, and this week's diesel price for the region.
//
// Providers, best first (each falls back to the next):
//   Places  — OpenRouteService geocoder (ORS_API_KEY), Google Places
//             (GOOGLE_PLACES_API_KEY, already used for address checks),
//             OpenStreetMap Nominatim (light use only).
//   Route   — OpenRouteService truck profile (driving-hgv, ORS_API_KEY);
//             else the public Valhalla server run by FOSSGIS (truck
//             costing, no key, fair use; trips up to ~930 straight-line
//             miles); else FOSSGIS's public OSRM road router (no distance
//             limit, not truck-specific) for long hauls; else straight-line
//             distance × a road factor, clearly marked as an estimate.
//   Diesel  — EIA API v2 (EIA_API_KEY); without a key, EIA's weekly
//             on-highway diesel table on eia.gov.

import { findUsPlace, suggestUsPlaces, US_STATES } from './us-places';

const TIMEOUT_MS = 9000;
const ROAD_FACTOR = 1.18; // typical road miles per straight-line mile in the US
const UA = 'Haulock load planner (https://haulock.com)';

export type PlannerPoint = { lat: number; lng: number; label: string; state: string | null };
export type PlannerLeg = { miles: number; hours: number };
export type DieselPrice = { region: string; price: number; week: string; source: 'eia-api' | 'eia-web' };
export type PlannerRoute = {
  points: PlannerPoint[];
  legs: PlannerLeg[];
  geometry: [number, number][][];      // one [lng, lat] line per leg
  routing: 'truck' | 'estimate';
  routingSource: 'ors' | 'valhalla' | 'osrm' | 'estimate';
};

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ---------- places ----------

const STATES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE',
  'district of columbia': 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
  pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};
const stateCode = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  if (/^[A-Z]{2}$/.test(s)) return s;
  return STATES[s.toLowerCase()] || null;
};

const placeCache = new Map<string, { at: number; value: PlannerPoint | null }>();
const PLACE_TTL_MS = 24 * 60 * 60 * 1000;

async function orsGeocode(q: string, key: string): Promise<PlannerPoint | null> {
  const p = new URLSearchParams({ text: q, size: '1', 'boundary.country': 'US' });
  const j = await fetchJson(`https://api.openrouteservice.org/geocode/search?${p}`, { headers: { Authorization: key, Accept: 'application/json' } });
  const f = j?.features?.[0];
  if (!f || (f.properties?.country_a && f.properties.country_a !== 'USA')) return null;
  const [lng, lat] = f.geometry.coordinates;
  return { lat, lng, label: f.properties?.label || q, state: stateCode(f.properties?.region_a) || stateCode(f.properties?.region) };
}

async function googleGeocode(q: string, key: string): Promise<PlannerPoint | null> {
  const j = await fetchJson('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.formattedAddress,places.location,places.addressComponents' },
    body: JSON.stringify({ textQuery: q, pageSize: 1, regionCode: 'US' }),
  });
  const pl = j?.places?.[0];
  if (!pl?.location) return null;
  const country = (pl.addressComponents || []).find((c: any) => (c.types || []).includes('country'));
  if (country && country.shortText !== 'US') return null;
  const st = (pl.addressComponents || []).find((c: any) => (c.types || []).includes('administrative_area_level_1'));
  return { lat: pl.location.latitude, lng: pl.location.longitude, label: pl.formattedAddress || q, state: stateCode(st?.shortText) };
}

// U.S. Census Bureau geocoder: official, free, no key, US street addresses
// only (matched against the Census street database). Returns no match for
// an address that doesn't exist.
async function censusGeocode(q: string): Promise<PlannerPoint | null> {
  const p = new URLSearchParams({ address: q, benchmark: 'Public_AR_Current', format: 'json' });
  const j = await fetchJson(`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${p}`);
  const m = j?.result?.addressMatches?.[0];
  if (!m?.coordinates) return null;
  const st = stateCode(m.addressComponents?.state);
  const label = String(m.matchedAddress || q).toLowerCase().replace(/\b([a-z])/g, (x) => x.toUpperCase())
    .replace(/\b(Nw|Ne|Sw|Se)\b/g, (x) => x.toUpperCase())
    .replace(/,\s*([A-Z][a-z])(?=,\s*\d{5}|\s*$)/, (_x, st) => `, ${st.toUpperCase()}`);
  return { lat: Number(m.coordinates.y), lng: Number(m.coordinates.x), label, state: st };
}

async function nominatimGeocode(q: string): Promise<PlannerPoint | null> {
  const p = new URLSearchParams({ q, format: 'jsonv2', limit: '1', countrycodes: 'us', addressdetails: '1' });
  const j = await fetchJson(`https://nominatim.openstreetmap.org/search?${p}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  const r = Array.isArray(j) ? j[0] : null;
  if (!r) return null;
  const a = r.address || {};
  if (a.country_code && a.country_code !== 'us') return null;
  const iso = String(a['ISO3166-2-lvl4'] || '').split('-')[1];
  const label = [a.city || a.town || a.village || a.hamlet || a.county, stateCode(a.state) || a.state, a.postcode].filter(Boolean).join(', ') || r.display_name;
  return { lat: Number(r.lat), lng: Number(r.lon), label, state: stateCode(iso) || stateCode(a.state) };
}

// Canadian provinces, or "Canada" / "Mexico" in the text.
const FOREIGN = /(?:,|\s)(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)\.?\s*(?:[A-Z]\d[A-Z]\s?\d[A-Z]\d)?$|\b(canada|mexico|méxico)\b/i;
export class OutsideUsError extends Error {}

// Geocoders return their closest guess even for nonsense; keep a result
// only when it shares a place word with what was typed.
const STOP = new Set(['street', 'st', 'avenue', 'ave', 'road', 'rd', 'drive', 'dr', 'suite', 'ste', 'highway', 'hwy', 'north', 'south', 'east', 'west', 'usa', 'the']);
function sharesPlaceWord(q: string, label: string): boolean {
  const words = (x: string) => new Set(x.toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w)));
  const a = words(q), b = words(label);
  return Array.from(a).some((w) => b.has(w));
}

// US only: a city, ZIP or "City, ST" comes from our own list; street
// addresses go to a geocoder restricted to the US.
export async function geocode(query: string): Promise<PlannerPoint | null> {
  const q = query.replace(/\s+/g, ' ').trim();
  if (!q) return null;
  if (FOREIGN.test(q)) throw new OutsideUsError('outside the US');
  // A street address (house number first) is matched to the street; a
  // city, ZIP or "City, ST" comes straight from our list.
  const isStreet = /\d+\s+[A-Za-z]/.test(q.split(',')[0] || '');
  if (!isStreet) {
    const local = findUsPlace(q);
    if (local) return { lat: local.lat, lng: local.lng, label: local.label, state: local.state };
    // Just a city name ("Dallas"): the largest US place with that name,
    // the same one the suggestion list shows first.
    const top = suggestUsPlaces(q, 1)[0];
    if (top && !/,/.test(q) && top.label.split(',')[0].toLowerCase() === q.toLowerCase()) return { lat: top.lat, lng: top.lng, label: top.label, state: top.state };
  }
  const key = q.toLowerCase();
  const hit = placeCache.get(key);
  if (hit && Date.now() - hit.at < PLACE_TTL_MS) return hit.value;
  const providers: (() => Promise<PlannerPoint | null>)[] = [];
  if (isStreet) providers.push(() => censusGeocode(q));
  if (process.env.ORS_API_KEY) providers.push(() => orsGeocode(q, process.env.ORS_API_KEY!));
  if (process.env.GOOGLE_PLACES_API_KEY) providers.push(() => googleGeocode(q, process.env.GOOGLE_PLACES_API_KEY!));
  providers.push(() => nominatimGeocode(q));
  let value: PlannerPoint | null = null;
  let failures = 0;
  for (const p of providers) {
    try {
      value = await p();
      if (value && !(value.state && US_STATES.has(value.state))) value = null; // outside the 50 states + DC
      if (value && !sharesPlaceWord(q, value.label)) value = null;          // a guess, not a match
      if (value) break;
    } catch { failures += 1; }
  }
  // Street not matched: use the town or ZIP it's in, and say so.
  if (!value && isStreet) {
    const town = findUsPlace(q) || findUsPlace(q.split(',').slice(-2).join(','));
    if (town) value = { lat: town.lat, lng: town.lng, label: `${town.label} (street not matched)`, state: town.state };
  }
  // Every provider failing is "try again", not "no such place".
  if (!value && failures === providers.length) throw new Error('Address lookup is unavailable right now.');
  placeCache.set(key, { at: Date.now(), value });
  return value;
}

// ---------- route ----------

function haversineMiles(a: PlannerPoint, b: PlannerPoint): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Keep at most ~600 points so the response stays small.
function thin(coords: [number, number][], max = 600): [number, number][] {
  if (coords.length <= max) return coords;
  const step = coords.length / max;
  const out: [number, number][] = [];
  for (let i = 0; i < max; i++) out.push(coords[Math.floor(i * step)]);
  out.push(coords[coords.length - 1]);
  return out;
}

export async function routeBetween(points: PlannerPoint[]): Promise<PlannerRoute> {
  const key = process.env.ORS_API_KEY;
  if (key && points.length >= 2) {
    try {
      const j = await fetchJson('https://api.openrouteservice.org/v2/directions/driving-hgv/geojson', {
        method: 'POST',
        headers: { Authorization: key, 'Content-Type': 'application/json', Accept: 'application/geo+json' },
        body: JSON.stringify({ coordinates: points.map((p) => [p.lng, p.lat]), units: 'mi', instructions: false, radiuses: points.map(() => 5000) }),
      });
      const f = j?.features?.[0];
      const segs: any[] = f?.properties?.segments || [];
      const wp: number[] = f?.properties?.way_points || [];
      if (f && segs.length === points.length - 1) {
        const coords = f.geometry.coordinates as [number, number][];
        return {
          points,
          legs: segs.map((s) => ({ miles: Math.round(Number(s.distance) * 10) / 10, hours: Math.round((Number(s.duration) / 3600) * 100) / 100 })),
          geometry: segs.map((_, i) => thin(wp.length === points.length ? coords.slice(wp[i], wp[i + 1] + 1) : coords, 400)),
          routing: 'truck',
          routingSource: 'ors',
        };
      }
    } catch { /* try the next router */ }
  }
  if (points.length >= 2) {
    try {
      const v = await valhallaRoute(points);
      if (v) return v;
    } catch { /* too long for the public truck router, or busy */ }
    try {
      const o = await osrmRoute(points);
      if (o) return o;
    } catch { /* fall back to the estimate */ }
  }
  const legs: PlannerLeg[] = [];
  for (let i = 1; i < points.length; i++) {
    const miles = haversineMiles(points[i - 1], points[i]) * ROAD_FACTOR;
    legs.push({ miles: Math.round(miles * 10) / 10, hours: Math.round((miles / 55) * 100) / 100 });
  }
  const geometry = legs.map((_, i) => [[points[i].lng, points[i].lat], [points[i + 1].lng, points[i + 1].lat]] as [number, number][]);
  return { points, legs, geometry, routing: 'estimate', routingSource: 'estimate' };
}

// Valhalla's encoded polyline (precision 6) → [lng, lat] pairs.
function decodePolyline6(str: string): [number, number][] {
  const out: [number, number][] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < str.length) {
    for (const which of [0, 1]) {
      let result = 0, shift = 0, b: number;
      do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20 && index < str.length);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta; else lng += delta;
    }
    out.push([lng / 1e6, lat / 1e6]);
  }
  return out;
}

const routeCache = new Map<string, { at: number; value: PlannerRoute }>();

// FOSSGIS's public OSRM (the router behind openstreetmap.org directions):
// road routes of any length, one request per leg so each leg keeps its own
// line. Requests are spaced to stay within its fair-use limit.
async function osrmRoute(points: PlannerPoint[]): Promise<PlannerRoute | null> {
  const key = 'osrm:' + points.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join(';');
  const hit = routeCache.get(key);
  if (hit && Date.now() - hit.at < 6 * 60 * 60 * 1000) return { ...hit.value, points };
  const legs: PlannerLeg[] = [];
  const geometry: [number, number][][] = [];
  for (let i = 1; i < points.length; i++) {
    if (i > 1) await new Promise((r) => setTimeout(r, 1000));
    const a = points[i - 1], b = points[i];
    const j = await fetchJson(`https://routing.openstreetmap.de/routed-car/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`, { headers: { 'User-Agent': UA } });
    const r = j?.code === 'Ok' ? j.routes?.[0] : null;
    if (!r?.geometry?.coordinates?.length) return null;
    legs.push({ miles: Math.round((Number(r.distance) / 1609.344) * 10) / 10, hours: Math.round((Number(r.duration) / 3600) * 100) / 100 });
    geometry.push(thin(r.geometry.coordinates as [number, number][], 400));
  }
  const value: PlannerRoute = { points, legs, geometry, routing: 'truck', routingSource: 'osrm' };
  routeCache.set(key, { at: Date.now(), value });
  return value;
}

// Public Valhalla instance (FOSSGIS e.V., OpenStreetMap data), truck costing.
async function valhallaRoute(points: PlannerPoint[]): Promise<PlannerRoute | null> {
  const key = points.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join(';');
  const hit = routeCache.get(key);
  if (hit && Date.now() - hit.at < 6 * 60 * 60 * 1000) return { ...hit.value, points };
  const j = await fetchJson('https://valhalla1.openstreetmap.de/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ locations: points.map((p) => ({ lat: p.lat, lon: p.lng })), costing: 'truck', units: 'miles', directions_type: 'none' }),
  });
  const legsIn: any[] = j?.trip?.legs || [];
  if (j?.trip?.status !== 0 || legsIn.length !== points.length - 1) return null;
  const value: PlannerRoute = {
    points,
    legs: legsIn.map((l) => ({ miles: Math.round(Number(l.summary?.length) * 10) / 10, hours: Math.round((Number(l.summary?.time) / 3600) * 100) / 100 })),
    geometry: legsIn.map((l) => thin(decodePolyline6(String(l.shape || '')), 400)),
    routing: 'truck',
    routingSource: 'valhalla',
  };
  routeCache.set(key, { at: Date.now(), value });
  return value;
}

// ---------- diesel ----------

// EIA regions (PADD districts) by state. California and the rest of the
// West Coast are priced separately.
const REGION_BY_STATE: Record<string, string> = {};
const assign = (region: string, states: string) => states.split(' ').forEach((s) => { REGION_BY_STATE[s] = region; });
assign('New England', 'CT ME MA NH RI VT');
assign('Central Atlantic', 'DE DC MD NJ NY PA');
assign('Lower Atlantic', 'FL GA NC SC VA WV');
assign('Midwest', 'IL IN IA KS KY MI MN MO NE ND SD OH OK TN WI');
assign('Gulf Coast', 'AL AR LA MS NM TX');
assign('Rocky Mountain', 'CO ID MT UT WY');
assign('West Coast less California', 'AK AZ HI NV OR WA');
assign('California', 'CA');

const SERIES: Record<string, string> = {
  'U.S.': 'EMD_EPD2D_PTE_NUS_DPG',
  'New England': 'EMD_EPD2D_PTE_R1X_DPG',
  'Central Atlantic': 'EMD_EPD2D_PTE_R1Y_DPG',
  'Lower Atlantic': 'EMD_EPD2D_PTE_R1Z_DPG',
  Midwest: 'EMD_EPD2D_PTE_R20_DPG',
  'Gulf Coast': 'EMD_EPD2D_PTE_R30_DPG',
  'Rocky Mountain': 'EMD_EPD2D_PTE_R40_DPG',
  'West Coast less California': 'EMD_EPD2D_PTE_R5XCA_DPG',
  California: 'EMD_EPD2D_PTE_SCA_DPG',
};

export const regionForState = (state: string | null | undefined): string => (state && REGION_BY_STATE[state]) || 'U.S.';

let dieselCache: { at: number; prices: Record<string, DieselPrice> } | null = null;
const DIESEL_TTL_MS = 6 * 60 * 60 * 1000; // EIA publishes weekly (Monday data, Tuesday release)

async function dieselFromApi(key: string): Promise<Record<string, DieselPrice>> {
  const p = new URLSearchParams({ api_key: key, frequency: 'weekly', 'data[0]': 'value', 'sort[0][column]': 'period', 'sort[0][direction]': 'desc', length: String(Object.keys(SERIES).length * 2) });
  for (const id of Object.values(SERIES)) p.append('facets[series][]', id);
  const j = await fetchJson(`https://api.eia.gov/v2/petroleum/pri/gnd/data/?${p}`);
  const rows: any[] = j?.response?.data || [];
  const out: Record<string, DieselPrice> = {};
  for (const [region, id] of Object.entries(SERIES)) {
    const r = rows.find((x) => x.series === id);
    if (r && Number(r.value) > 0) out[region] = { region, price: Number(r.value), week: String(r.period), source: 'eia-api' };
  }
  return out;
}

// EIA's public "Gasoline and Diesel Fuel Update" page: a table with the last
// three weekly prices per region.
async function dieselFromWeb(): Promise<Record<string, DieselPrice>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let html = '';
  try {
    const res = await fetch('https://www.eia.gov/petroleum/gasdiesel/', { headers: { 'User-Agent': UA }, signal: controller.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`eia.gov ${res.status}`);
    html = await res.text();
  } finally {
    clearTimeout(timer);
  }
  const start = html.indexOf('On-Highway Diesel');
  if (start < 0) throw new Error('EIA diesel table not found');
  const text = html.slice(start, start + 8000).replace(/<[^>]+>/g, ' | ').replace(/&nbsp;/g, ' ').replace(/(\s*\|\s*)+/g, ' | ');
  const dates = Array.from(text.matchAll(/(\d{2})\/(\d{2})\/(\d{2})/g)).slice(0, 3).map((m) => `20${m[3]}-${m[1]}-${m[2]}`);
  const week = dates[2] || dates[dates.length - 1] || '';
  const out: Record<string, DieselPrice> = {};
  const labels: [string, RegExp][] = [
    ['U.S.', /\| U\.S\. \|/],
    ['New England', /\| New England \| \(PADD1A\) \|/],
    ['Central Atlantic', /\| Central Atlantic \| \(PADD1B\) \|/],
    ['Lower Atlantic', /\| Lower Atlantic \| \(PADD1C\) \|/],
    ['Midwest', /\| Midwest \| \(PADD2\) \|/],
    ['Gulf Coast', /\| Gulf Coast \| \(PADD3\) \|/],
    ['Rocky Mountain', /\| Rocky Mountain \| \(PADD4\) \|/],
    ['West Coast less California', /\| West Coast \| less California \|/],
    ['California', /\| California \|/],
  ];
  for (const [region, re] of labels) {
    const m = re.exec(text);
    if (!m) continue;
    // Three weekly values follow the label; the third is the latest week.
    const nums = text.slice(m.index + m[0].length).match(/\d+\.\d{3}/g) || [];
    const price = Number(nums[2]);
    if (price > 0) out[region] = { region, price, week, source: 'eia-web' };
  }
  if (!out['U.S.']) throw new Error('EIA diesel table unreadable');
  return out;
}

export async function dieselPrices(): Promise<Record<string, DieselPrice>> {
  if (dieselCache && Date.now() - dieselCache.at < DIESEL_TTL_MS) return dieselCache.prices;
  let prices: Record<string, DieselPrice> | null = null;
  if (process.env.EIA_API_KEY) {
    try { prices = await dieselFromApi(process.env.EIA_API_KEY); if (!prices['U.S.']) prices = null; } catch { prices = null; }
  }
  if (!prices) prices = await dieselFromWeb();
  dieselCache = { at: Date.now(), prices };
  return prices;
}
