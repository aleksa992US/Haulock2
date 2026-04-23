export type AddressCheck = {
  configured: boolean;
  found: boolean;
  matchedName?: string;
  matchedAddress?: string;
  types?: string[];
  businessStatus?: string;
  isMailbox?: boolean;
  mailboxProvider?: string;
  isResidence?: boolean;
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

function detectResidence(types: string[]): boolean {
  // Places API rarely flags residences directly, but we look for the obvious ones.
  return types.includes('locality') === false && types.includes('premise') && !types.some((t) => ['establishment', 'point_of_interest', 'store'].includes(t));
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

async function searchPlaces(textQuery: string, key: string): Promise<any | null> {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.types,places.businessStatus,places.id',
    },
    body: JSON.stringify({ textQuery, pageSize: 3 }),
  });
  if (!res.ok) throw new Error(`Places ${res.status}: ${await res.text().catch(() => '')}`);
  const data = await res.json();
  return (data?.places || [])[0] || null;
}

export async function checkAddress(address: string, name?: string): Promise<AddressCheck> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return { configured: false, found: false };
  if (!address || !address.trim()) return { configured: true, found: false };

  const cleanAddress = normalizeAddress(address);
  const cleanName = (name || '').trim();
  // Try queries from most specific to least, returning the first match.
  const queries: string[] = [
    cleanName ? `${cleanName} ${cleanAddress}` : '',
    cleanAddress,
    cleanName ? `${cleanName} ${cleanAddress.split(',')[0]}` : '',
  ].filter(Boolean);

  try {
    let place: any | null = null;
    for (const q of queries) {
      try {
        const p = await searchPlaces(q, key);
        if (p) { place = p; break; }
      } catch (e: any) {
        // First failure → bail with error so the user sees it.
        return { configured: true, found: false, error: e?.message || 'Places lookup failed' };
      }
    }
    if (!place) return { configured: true, found: false };

    const matchedName: string | undefined = place.displayName?.text;
    const matchedAddress: string | undefined = place.formattedAddress;
    const types: string[] = Array.isArray(place.types) ? place.types : [];
    const businessStatus: string | undefined = place.businessStatus;
    const { isMailbox, provider } = detectMailbox(matchedName, types);
    const isResidence = detectResidence(types);

    return {
      configured: true,
      found: true,
      matchedName,
      matchedAddress,
      types,
      businessStatus,
      isMailbox,
      mailboxProvider: provider,
      isResidence,
    };
  } catch (e: any) {
    return { configured: true, found: false, error: e?.message || 'Places lookup failed' };
  }
}
