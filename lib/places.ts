import { carrierNamesMatch } from './risk';

// `found` means Google Places has a listing whose formatted address matches
// the FMCSA address (same street number + street name, same ZIP5, same
// suite). A Places hit at a nearby or merely similar address is NOT "the
// business at this address" and is not reported. `error` set → the lookup
// itself failed: "couldn't check", never a finding.
export type AddressCheck = {
  configured: boolean;
  found: boolean;
  matchedName?: string;
  matchedAddress?: string;
  types?: string[];
  businessStatus?: string;
  isMailbox?: boolean;
  mailboxProvider?: string;
  // The listing at the address is just the address itself (a house or
  // building with no business listed) — typical of a home-based
  // owner-operator. Never treated as "a different business".
  isResidence?: boolean;
  // True whenever `found` is: the listing's address was confirmed to match.
  addressMatched?: boolean;
  // Whether the business listed at the address has the company's name
  // (generic words like "freight" / "logistics" ignored). Undefined when
  // there's no business listed or no name to compare.
  nameMatches?: boolean;
  error?: string;
};

const MAILBOX_NAME_PATTERNS: { provider: string; pattern: RegExp }[] = [
  { provider: 'UPS Store', pattern: /\bups store\b/i },
  { provider: 'Mail Boxes Etc.', pattern: /\bmail\s*boxes? etc\b/i },
  { provider: 'FedEx Office', pattern: /\bfedex office\b/i },
  { provider: 'PostalAnnex', pattern: /\bpostalannex\b/i },
  { provider: 'Postnet', pattern: /\bpostnet\b/i },
  { provider: 'Pak Mail', pattern: /\bpak mail\b/i },
  { provider: 'iPostal1', pattern: /\bipostal1?\b/i },
  { provider: 'Anytime Mailbox', pattern: /\banytime mailbox\b/i },
  { provider: 'Earth Class Mail', pattern: /\bearth class mail\b/i },
];

function detectMailbox(name: string | undefined, types: string[]): { isMailbox: boolean; provider?: string } {
  if (types.includes('post_office')) return { isMailbox: true, provider: 'Post Office' };
  if (!name) return { isMailbox: false };
  for (const m of MAILBOX_NAME_PATTERNS) {
    if (m.pattern.test(name)) return { isMailbox: true, provider: m.provider };
  }
  return { isMailbox: false };
}

// Places has no "residence" type. A result that is only an address
// (premise / subpremise / street_address) with no business type means
// Google lists nothing at that address — usually a home.
const ADDRESS_ONLY_TYPES = new Set(['premise', 'subpremise', 'street_address', 'route', 'geocode']);
const BUSINESS_TYPES = new Set(['establishment', 'point_of_interest', 'store', 'storage', 'moving_company', 'post_office']);

function detectResidence(types: string[], displayName: string | undefined, matchedAddress: string | undefined): boolean {
  if (types.some((t) => BUSINESS_TYPES.has(t))) return false;
  if (types.some((t) => ADDRESS_ONLY_TYPES.has(t))) return true;
  // No usable types: if the "name" is just the street address, it's an
  // address result, not a business.
  if (displayName && matchedAddress) {
    const street = (matchedAddress.split(',')[0] || '').trim().toLowerCase();
    if (street && displayName.trim().toLowerCase() === street) return true;
  }
  return false;
}

// ----- address matching ------------------------------------------------------

const STREET_SUFFIX: Record<string, string> = {
  STREET: 'ST', STR: 'ST', ST: 'ST', AVENUE: 'AVE', AV: 'AVE', AVE: 'AVE',
  ROAD: 'RD', RD: 'RD', DRIVE: 'DR', DR: 'DR', LANE: 'LN', LN: 'LN',
  BOULEVARD: 'BLVD', BLVD: 'BLVD', HIGHWAY: 'HWY', HWY: 'HWY', PARKWAY: 'PKWY', PKWY: 'PKWY',
  COURT: 'CT', CT: 'CT', PLACE: 'PL', PL: 'PL', CIRCLE: 'CIR', CIR: 'CIR',
  TERRACE: 'TER', TER: 'TER', TRAIL: 'TRL', TRL: 'TRL', WAY: 'WAY', PIKE: 'PIKE',
  SQUARE: 'SQ', SQ: 'SQ', EXPRESSWAY: 'EXPY', EXPY: 'EXPY', FREEWAY: 'FWY', FWY: 'FWY',
  LOOP: 'LOOP', CROSSING: 'XING', XING: 'XING', CENTER: 'CTR', CTR: 'CTR', PLAZA: 'PLZ', PLZ: 'PLZ',
};
const DIRECTIONAL: Record<string, string> = {
  NORTH: 'N', N: 'N', SOUTH: 'S', S: 'S', EAST: 'E', E: 'E', WEST: 'W', W: 'W',
  NORTHEAST: 'NE', NE: 'NE', NORTHWEST: 'NW', NW: 'NW', SOUTHEAST: 'SE', SE: 'SE', SOUTHWEST: 'SW', SW: 'SW',
};
const CORE_ALIASES: Record<string, string> = { SAINT: 'ST', MOUNT: 'MT', FORT: 'FT' };
// "FL" is deliberately absent: it's also Florida.
const UNIT_RE = /\b(?:STE|SUITE|UNIT|APT|APARTMENT|RM|ROOM|FLR|FLOOR|BLDG|BUILDING|SPC|SPACE|LOT|TRLR|PMB|DEPT)\b\.?\s*#?\s*([A-Z0-9-]+)|#\s*([A-Z0-9-]+)/;

export type ParsedAddress = {
  number: string;
  core: string[];
  suffix?: string;
  dirs: string[];
  unit?: string;
  zip5?: string;
};

export function parseUsAddress(input: string | undefined | null): ParsedAddress | null {
  if (!input) return null;
  const upper = String(input).toUpperCase().replace(/\./g, '').replace(/\s+/g, ' ');
  const segments = upper.split(',').map((s) => s.trim()).filter(Boolean);
  const streetIdx = segments.findIndex((s) => /^\d/.test(s));
  if (streetIdx < 0) return null; // PO boxes, bare city names → can't compare
  let street = segments[streetIdx];

  // Unit: inside the street segment, or a following "Suite 200" / "#200" segment.
  let unit: string | undefined;
  const um = street.match(UNIT_RE);
  if (um) {
    unit = um[1] || um[2];
    street = street.slice(0, um.index).trim();
  } else {
    const next = segments[streetIdx + 1];
    if (next) {
      const nm = next.match(UNIT_RE);
      if (nm && nm.index === 0) unit = nm[1] || nm[2];
    }
  }

  // "123A MAIN ST" / "123-A MAIN ST" keep the letter; "123 N MAIN ST" doesn't.
  const sm = street.match(/^(\d+)(?:-?([A-Z]))?\s+(.+)$/);
  if (!sm) return null;
  const number = sm[1].replace(/^0+/, '') + (sm[2] || '');
  const tokens = sm[3].replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);

  let suffix: string | undefined;
  const dirs: string[] = [];
  if (tokens.length > 1 && DIRECTIONAL[tokens[tokens.length - 1]]) dirs.push(DIRECTIONAL[tokens.pop()!]);
  if (tokens.length > 1 && STREET_SUFFIX[tokens[tokens.length - 1]]) suffix = STREET_SUFFIX[tokens.pop()!];
  if (tokens.length > 1 && DIRECTIONAL[tokens[0]]) dirs.push(DIRECTIONAL[tokens.shift()!]);
  const core = tokens.map((t) => CORE_ALIASES[t] || t);

  const rest = segments.slice(streetIdx + 1).join(' ');
  const zips = Array.from(rest.matchAll(/\b(\d{5})(?:-?\d{4})?\b/g));
  const zip5 = zips.length ? zips[zips.length - 1][1] : undefined;

  return { number, core, suffix, dirs: dirs.sort(), unit: unit ? normalizeUnit(unit) : undefined, zip5 };
}

function normalizeUnit(u: string): string {
  return u.replace(/\b0+(\d)/g, '$1');
}

function unitsMatch(fmcsaUnit: string | undefined, placesUnit: string | undefined): boolean {
  if (!fmcsaUnit && !placesUnit) return true;
  if (!fmcsaUnit || !placesUnit) return false;
  if (fmcsaUnit.replace(/-/g, '') === placesUnit.replace(/-/g, '')) return true;
  // Mail-receiving agencies: FMCSA "STE 103-221" (store suite + box) vs the
  // store's own listing "Suite 103".
  return fmcsaUnit.startsWith(placesUnit + '-');
}

// Same street number, same street name (normalized), same ZIP5, and the same
// suite when either side has one. Anything less is "not this address".
export function addressesMatch(fmcsaAddress: string | undefined | null, placesAddress: string | undefined | null): boolean {
  const a = parseUsAddress(fmcsaAddress);
  const b = parseUsAddress(placesAddress);
  if (!a || !b) return false;
  if (!a.zip5 || !b.zip5 || a.zip5 !== b.zip5) return false;
  if (a.number !== b.number) return false;
  if (a.core.join(' ') !== b.core.join(' ')) return false;
  if (a.core.length === 0 && !a.suffix && a.dirs.length === 0) return false;
  if (a.suffix && b.suffix && a.suffix !== b.suffix) return false;
  if (a.dirs.length && b.dirs.length && a.dirs.join() !== b.dirs.join()) return false;
  return unitsMatch(a.unit, b.unit);
}

function normalizeAddress(address: string): string {
  // Replace common suite/unit abbreviations FMCSA uses with neutral "Suite" wording Google handles better.
  return address
    .replace(/\bSTE\b/gi, 'Suite')
    .replace(/\bUNIT\b/gi, 'Unit')
    .replace(/\bAPT\b/gi, 'Apt')
    .replace(/\bBLDG\b/gi, 'Building')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function searchPlaces(textQuery: string, key: string): Promise<any[]> {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    signal: AbortSignal.timeout(8_000),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.types,places.businessStatus,places.id',
    },
    body: JSON.stringify({ textQuery, pageSize: 5 }),
  });
  if (!res.ok) throw new Error(`Places ${res.status}: ${await res.text().catch(() => '')}`);
  const data = await res.json();
  return Array.isArray(data?.places) ? data.places : [];
}

type AtAddress = {
  place: any;
  name?: string;
  types: string[];
  isMailbox: boolean;
  provider?: string;
  isResidence: boolean;
  nameMatches?: boolean;
};

export async function checkAddress(address: string, name?: string): Promise<AddressCheck> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return { configured: false, found: false };
  if (!address || !address.trim()) return { configured: true, found: false };

  const cleanAddress = normalizeAddress(address);
  const cleanName = (name || '').trim();
  // Try queries from most specific to least. Only results whose formatted
  // address matches the FMCSA address count; we stop at the first query
  // that returns one.
  const queries: string[] = [
    cleanName ? `${cleanName} ${cleanAddress}` : '',
    cleanAddress,
    cleanName ? `${cleanName} ${cleanAddress.split(',')[0]}` : '',
  ].filter(Boolean);

  try {
    let atAddress: AtAddress[] = [];
    for (const q of queries) {
      let places: any[];
      try {
        places = await searchPlaces(q, key);
      } catch (e: any) {
        // A failed lookup is "couldn't check" — never a finding.
        return { configured: true, found: false, error: e?.message || 'Places lookup failed' };
      }
      atAddress = places
        .filter((p) => addressesMatch(address, p?.formattedAddress))
        .map((p) => {
          const pName: string | undefined = p.displayName?.text;
          const types: string[] = Array.isArray(p.types) ? p.types : [];
          const { isMailbox, provider } = detectMailbox(pName, types);
          const isResidence = !isMailbox && detectResidence(types, pName, p.formattedAddress);
          return {
            place: p,
            name: pName,
            types,
            isMailbox,
            provider,
            isResidence,
            nameMatches: !isResidence && pName && cleanName ? carrierNamesMatch(cleanName, pName) : undefined,
          };
        });
      if (atAddress.length > 0) break;
    }
    if (atAddress.length === 0) return { configured: true, found: false };

    // Several listings can share one address. A mail-receiving agency is the
    // fact that matters most; then the company's own listing; then any other
    // business; then the bare address.
    const pick =
      atAddress.find((c) => c.isMailbox)
      || atAddress.find((c) => c.nameMatches === true)
      || atAddress.find((c) => !c.isResidence)
      || atAddress[0];

    return {
      configured: true,
      found: true,
      addressMatched: true,
      matchedName: pick.name,
      matchedAddress: pick.place.formattedAddress,
      types: pick.types,
      businessStatus: pick.place.businessStatus,
      isMailbox: pick.isMailbox,
      mailboxProvider: pick.provider,
      isResidence: pick.isResidence,
      nameMatches: pick.nameMatches,
    };
  } catch (e: any) {
    return { configured: true, found: false, error: e?.message || 'Places lookup failed' };
  }
}
