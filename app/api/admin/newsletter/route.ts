import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { isAdmin } from '@/lib/admin';
import { listContacts, isAudienceConfigured } from '@/lib/resend-audience';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Admin-only. Returns the full Resend Contacts list joined with the local
// email_log so each contact carries a `emailsSent` counter and a small
// breakdown by kind. Used by the AdminPage → Newsletter tab.
export async function GET() {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me?.email) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!(await isAdmin(me.email))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (!isAudienceConfigured()) {
    return NextResponse.json({
      configured: false,
      contacts: [],
      totalSent: 0,
      sentByKind: {},
      message: 'Set RESEND_API_KEY in .env to start tracking newsletter contacts.',
    });
  }

  // listContacts paginates internally — Resend caps each page at 100, so we
  // pass a "max total" instead of a per-page limit.
  const list = await listContacts(5000);
  if (!list.ok) {
    return NextResponse.json({ error: list.error || 'Resend list failed' }, { status: 500 });
  }

  // Pull every email_log row + aggregate per-recipient counts. The log is
  // small enough that an unbounded select is fine for now; bound to last
  // 365 days as a soft guard.
  const since = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
  const svc = getServiceSupabase();
  type LogCounts = Map<string, { total: number; byKind: Record<string, number>; lastSentAt: string | null }>;
  const counts: LogCounts = new Map();
  const sentByKind: Record<string, number> = {};
  let totalSent = 0;

  if (svc) {
    const { data: logs, error } = await svc
      .from('email_log')
      .select('to_email, kind, sent_at')
      .gte('sent_at', since)
      .order('sent_at', { ascending: false });
    if (error) {
      console.warn('[admin/newsletter] email_log read failed:', error.message);
    } else if (logs) {
      for (const row of logs) {
        const email = String(row.to_email || '').toLowerCase();
        const kind = String(row.kind || 'other');
        if (!email) continue;
        const slot = counts.get(email) || { total: 0, byKind: {}, lastSentAt: null };
        slot.total += 1;
        slot.byKind[kind] = (slot.byKind[kind] || 0) + 1;
        if (!slot.lastSentAt || row.sent_at > slot.lastSentAt) slot.lastSentAt = row.sent_at;
        counts.set(email, slot);
        sentByKind[kind] = (sentByKind[kind] || 0) + 1;
        totalSent += 1;
      }
    }
  }

  // Merge counts into Resend contacts. Also surface "log-only" recipients
  // (people we emailed transactionally who never signed up) so the admin
  // tab is the full picture, not just the newsletter list.
  const contactsByEmail = new Map<string, any>();
  for (const c of list.contacts) {
    const slot = counts.get(c.email);
    contactsByEmail.set(c.email, {
      ...c,
      inResend: true,
      emailsSent: slot?.total || 0,
      sentByKind: slot?.byKind || {},
      lastSentAt: slot?.lastSentAt || null,
    });
  }
  for (const [email, slot] of counts.entries()) {
    if (contactsByEmail.has(email)) continue;
    contactsByEmail.set(email, {
      id: '',
      email,
      firstName: null,
      lastName: null,
      unsubscribed: false,
      createdAt: null,
      inResend: false,
      emailsSent: slot.total,
      sentByKind: slot.byKind,
      lastSentAt: slot.lastSentAt,
    });
  }

  const contacts = Array.from(contactsByEmail.values()).sort((a, b) => {
    // Newest activity first (lastSentAt OR createdAt).
    const aT = a.lastSentAt || a.createdAt || '';
    const bT = b.lastSentAt || b.createdAt || '';
    return bT.localeCompare(aT);
  });

  return NextResponse.json({
    configured: true,
    contacts,
    totalSent,
    sentByKind,
  });
}
