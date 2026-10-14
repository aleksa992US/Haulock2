import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { isAdmin } from '@/lib/admin';
import { getEmailSiteUrl, salesEmailTemplate } from '@/lib/email';
import { applyMergeTags, loadRecentLookups, mergeVars } from '@/lib/sales';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Admin-only. Renders a Sales email exactly as one recipient would get it:
// merge tags filled in and (optionally) their own recent lookups. Uses the
// same template function as the real send.
export async function POST(req: Request) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!(await isAdmin(me.email))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  const b = await req.json().catch(() => null) as any;
  if (!b?.lead?.id) return NextResponse.json({ error: 'Pick a recipient to preview' }, { status: 400 });

  // Merge vars come from the lead row the admin is looking at (same data
  // the send recomputes server-side); lookups are always read fresh.
  const vars = mergeVars(b.lead);
  const showLookups = b.showLookups !== false;
  const lookups = showLookups ? (await loadRecentLookups(svc, [String(b.lead.id)])).get(String(b.lead.id)) || [] : [];
  const tpl = salesEmailTemplate({
    subject: applyMergeTags(String(b.subject || ''), vars),
    body: applyMergeTags(String(b.body || ''), vars),
    ctaLabel: b.ctaLabel ? applyMergeTags(String(b.ctaLabel), vars) : null,
    ctaUrl: b.ctaUrl || null,
    showLookups,
    lookups,
    recipientEmail: String(b.lead.email || 'preview@example.com'),
    siteUrl: getEmailSiteUrl(),
  });
  return NextResponse.json({ ...tpl, lookupCount: lookups.length });
}
