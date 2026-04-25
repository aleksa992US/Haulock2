import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { addOrUpdateContact, isAudienceConfigured } from '@/lib/resend-audience';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Syncs the authenticated user's newsletter subscription state to Resend.
// Called by the Notifications tab right after `auth.updateUser({ data:
// { notify_fraud_trends: ... } })` succeeds, so Resend stays in sync with
// Supabase. Idempotent — safe to call on every save.
export async function POST() {
  if (!isAudienceConfigured()) {
    return NextResponse.json({ skipped: 'audience-not-configured' }, { status: 200 });
  }
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user?.email) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const meta = user.user_metadata || {};
  const wantsNewsletter = meta.notify_fraud_trends !== false;
  const fullName = (meta.full_name || meta.name || '') as string;
  const [firstName, ...rest] = fullName.trim().split(/\s+/);

  const r = await addOrUpdateContact({
    email: user.email,
    firstName: firstName || null,
    lastName: rest.length ? rest.join(' ') : null,
    unsubscribed: !wantsNewsletter,
  });
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.error || 'sync-failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, subscribed: wantsNewsletter });
}
