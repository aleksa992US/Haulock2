import { Resend } from 'resend';

// Resend Contacts sync (account-level — no audiences). We treat Resend as
// the source of truth for newsletter contacts (built-in unsubscribe links +
// bounce handling). These helpers are best-effort: any failure is logged
// and swallowed so the parent flow (signup, toggle, delete) is never
// blocked by a Resend outage.

let cached: Resend | null = null;
function getResend(): Resend | null {
  if (cached) return cached;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  cached = new Resend(key);
  return cached;
}

export function isAudienceConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export type ContactInput = {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  unsubscribed?: boolean;
};

export type ContactRecord = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  unsubscribed: boolean;
  createdAt: string | null;
};

// Idempotent upsert. create() returns 409-ish for an existing email, in
// which case we fall through to update() so the unsubscribed flag converges.
// `alreadyExisted` lets callers tell a fresh signup from a re-submit so the
// UI can say "you're already on the list" instead of "thanks for signing up".
export async function addOrUpdateContact(input: ContactInput): Promise<{ ok: boolean; alreadyExisted?: boolean; skipped?: string; error?: string }> {
  if (!isAudienceConfigured()) return { ok: false, skipped: 'resend-not-configured' };
  const resend = getResend();
  if (!resend) return { ok: false, skipped: 'resend-not-configured' };

  const email = input.email.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'invalid-email' };

  try {
    const created = await (resend.contacts as any).create({
      email,
      firstName: input.firstName || undefined,
      lastName: input.lastName || undefined,
      unsubscribed: input.unsubscribed === true,
    });
    if (!created?.error) return { ok: true, alreadyExisted: false };

    const msg = String(created.error.message || '');
    // Existing contact → update so the unsubscribed flag converges.
    if (/already exists|already subscribed|conflict|duplicate/i.test(msg)) {
      const updated = await (resend.contacts as any).update({
        email,
        firstName: input.firstName || undefined,
        lastName: input.lastName || undefined,
        unsubscribed: input.unsubscribed === true,
      });
      if (updated?.error) {
        console.warn('[resend-contacts] update after exists failed', { email, message: updated.error.message });
        return { ok: false, error: updated.error.message };
      }
      return { ok: true, alreadyExisted: true };
    }
    console.warn('[resend-contacts] create failed', { email, message: msg });
    return { ok: false, error: msg };
  } catch (err: any) {
    console.warn('[resend-contacts] addOrUpdateContact threw', { email, message: err?.message });
    return { ok: false, error: err?.message || 'unknown' };
  }
}

// Soft-unsubscribe: keeps the row in Resend but flips the unsubscribed flag.
// Preferred over removeContact for opt-out flows so the user's history /
// unsubscribe link is preserved.
export async function setSubscribed(email: string, subscribed: boolean): Promise<{ ok: boolean }> {
  const r = await addOrUpdateContact({ email, unsubscribed: !subscribed });
  return { ok: r.ok };
}

// Hard delete — only used when the user deletes their Haulock account.
export async function removeContact(email: string): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  if (!isAudienceConfigured()) return { ok: false, skipped: 'resend-not-configured' };
  const resend = getResend();
  if (!resend) return { ok: false, skipped: 'resend-not-configured' };

  const normalized = email.trim().toLowerCase();
  if (!normalized) return { ok: false, error: 'invalid-email' };
  try {
    const res = await (resend.contacts as any).remove({ email: normalized });
    if (res?.error) {
      // Not-found is fine — caller wanted them gone, they are gone.
      if (/not found|does not exist/i.test(res.error.message || '')) return { ok: true };
      console.warn('[resend-contacts] remove failed', { email: normalized, message: res.error.message });
      return { ok: false, error: res.error.message };
    }
    return { ok: true };
  } catch (err: any) {
    console.warn('[resend-contacts] removeContact threw', { email: normalized, message: err?.message });
    return { ok: false, error: err?.message || 'unknown' };
  }
}

// Pulls the full contact list out of Resend. Resend's list endpoint is
// capped at 100 per page (per their pagination docs), so we walk pages with
// `after` cursors until we hit `maxTotal` or the API reports no more rows.
// `maxTotal` is a soft safety bound (don't loop forever for a misconfigured
// account); 5000 covers the dashboard for the foreseeable future.
const PAGE_SIZE = 100;

export async function listContacts(maxTotal = 5000): Promise<{ ok: boolean; contacts: ContactRecord[]; error?: string }> {
  if (!isAudienceConfigured()) return { ok: false, contacts: [], error: 'resend-not-configured' };
  const resend = getResend();
  if (!resend) return { ok: false, contacts: [], error: 'resend-not-configured' };

  const collected: ContactRecord[] = [];
  let cursor: string | undefined;
  let safety = 0;
  try {
    while (collected.length < maxTotal && safety < 100) {
      safety += 1;
      const params: any = { limit: PAGE_SIZE };
      if (cursor) params.after = cursor;
      const res = await (resend.contacts as any).list(params);
      if (res?.error) {
        // If pagination isn't supported (older SDK / smaller account), bail
        // with whatever we already have rather than failing the whole tab.
        if (collected.length > 0) break;
        console.warn('[resend-contacts] list failed', { message: res.error.message });
        return { ok: false, contacts: [], error: res.error.message };
      }
      // Resend wraps results as { data: { data: [...], has_more, next_cursor? } }
      // in newer SDKs and { data: [...] } in older ones. Tolerate both.
      const raw: any[] = Array.isArray(res?.data?.data) ? res.data.data
        : Array.isArray(res?.data) ? res.data
        : [];
      for (const c of raw) {
        collected.push({
          id: String(c.id || ''),
          email: String(c.email || '').toLowerCase(),
          firstName: c.first_name ?? c.firstName ?? null,
          lastName: c.last_name ?? c.lastName ?? null,
          unsubscribed: Boolean(c.unsubscribed),
          createdAt: c.created_at ?? c.createdAt ?? null,
        });
      }
      const hasMore = Boolean(res?.data?.has_more);
      const nextCursor = res?.data?.next_cursor || res?.data?.last || (raw.length > 0 ? raw[raw.length - 1]?.id : undefined);
      if (!hasMore || raw.length < PAGE_SIZE || !nextCursor) break;
      cursor = nextCursor;
    }
    return { ok: true, contacts: collected.slice(0, maxTotal) };
  } catch (err: any) {
    console.warn('[resend-contacts] listContacts threw', { message: err?.message });
    return { ok: false, contacts: collected, error: err?.message || 'unknown' };
  }
}
