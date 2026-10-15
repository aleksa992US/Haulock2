import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { isAdmin } from '@/lib/admin';
import { addOrUpdateContact, isAudienceConfigured, listContacts } from '@/lib/resend-audience';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Backfill every Supabase user into the Resend audience. Idempotent — uses
// addOrUpdateContact which does an upsert. Respects each user's
// notify_fraud_trends flag (default: subscribed).
//
// Run once after deploying the auto-add change to bring existing users in
// line; thereafter the welcome flow handles new signups in real time.
export async function POST() {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!(await isAdmin(me.email))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (!isAudienceConfigured()) {
    return NextResponse.json({ skipped: 'Resend not configured' }, { status: 200 });
  }

  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  const users: any[] = [];
  for (let page = 1; ; page += 1) {
    const { data: usersData, error: usersErr } = await svc.auth.admin.listUsers({ page, perPage: 1000 });
    if (usersErr) return NextResponse.json({ error: usersErr.message }, { status: 500 });
    const batch = usersData?.users || [];
    users.push(...batch);
    if (batch.length < 1000) break;
  }

  // People who unsubscribed by email link are unsubscribed in Resend; this
  // sync must never turn that back on. If the list can't be read, stop
  // rather than risk re-subscribing them.
  const existing = await listContacts();
  if (!existing.ok) return NextResponse.json({ error: existing.error || 'Could not read the Resend audience' }, { status: 502 });
  const optedOut = new Set(existing.contacts.filter((c) => c.unsubscribed).map((c) => c.email.toLowerCase()));

  let added = 0;
  let updated = 0;
  let skipped = 0;
  const errors: { email: string; message: string }[] = [];

  for (const u of users as any[]) {
    if (!u?.email) { skipped += 1; continue; }
    // Skip unconfirmed accounts — they may have used a typo'd email and
    // we don't want to pollute the audience with bouncing addresses.
    if (!u.email_confirmed_at) { skipped += 1; continue; }

    const meta = u.user_metadata || {};
    const linkOptOut = optedOut.has(String(u.email).toLowerCase());
    // Opted out by link before the unsubscribe route updated accounts too:
    // copy it onto the account so Settings saves and other emails honour it.
    if (linkOptOut && (meta.notify_fraud_trends !== false || meta.notify_weekly_digest !== false)) {
      await svc.auth.admin.updateUserById(u.id, { user_metadata: { ...meta, notify_fraud_trends: false, notify_weekly_digest: false } });
    }
    const wantsNewsletter = meta.notify_fraud_trends !== false && !linkOptOut;
    const fullName: string = meta.full_name || meta.name || '';
    const [firstName, ...rest] = fullName.trim().split(/\s+/);

    try {
      const r = await addOrUpdateContact({
        email: u.email,
        firstName: firstName || null,
        lastName: rest.length ? rest.join(' ') : null,
        unsubscribed: !wantsNewsletter,
      });
      if (r.ok && r.alreadyExisted) updated += 1;
      else if (r.ok) added += 1;
      else errors.push({ email: u.email, message: r.error || 'unknown' });
    } catch (err: any) {
      errors.push({ email: u.email, message: err?.message || 'threw' });
    }
  }

  return NextResponse.json({
    ok: true,
    total: users.length,
    added,
    updated,
    skipped,
    errors: errors.slice(0, 20), // cap so the response stays small
  });
}
