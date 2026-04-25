import { NextResponse } from 'next/server';
import { authorizeCronOrAdmin } from '@/lib/cron-auth';
import { getServiceSupabase } from '@/lib/supabase/service';
import { lookupCarrier, parseQuery } from '@/lib/fmcsa';
import { scoreCarrier } from '@/lib/risk';
import { sendEmail, watchlistUpdateTemplate, isResendConfigured, type WatchlistChange } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Daily watchlist refresh. For each watchlist row:
//   1. Run a fresh FMCSA lookup.
//   2. Compare the fresh score / verdict / authority / flags to the row's
//      stored snapshot.
//   3. If anything meaningful changed, email the watchlist owner (subject
//      to their notify_watchlist preference) and update the row's snapshot.
// Runs from Vercel Cron once a day. Safe to re-run; won't double-send.
export async function GET(req: Request) { return run(req); }
export async function POST(req: Request) { return run(req); }

async function run(req: Request) {
  const auth = await authorizeCronOrAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  const { data: rows, error } = await svc.from('watchlist').select('*').order('last_checked', { ascending: true, nullsFirst: true }).limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rows || rows.length === 0) return NextResponse.json({ ok: true, processed: 0 });

  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dryRun') === '1';

  // Pull every user once so we know their email + notification preference.
  // Service role can list users via the auth admin API.
  const userMap = new Map<string, { email: string; notifyOn: boolean; notificationEmail: string | null }>();
  {
    const { data: usersPage } = await svc.auth.admin.listUsers({ perPage: 1000 });
    for (const u of usersPage?.users || []) {
      const meta = (u.user_metadata || {}) as any;
      userMap.set(u.id, {
        email: u.email || '',
        notifyOn: meta.notify_watchlist !== false,
        notificationEmail: typeof meta.notification_email === 'string' && meta.notification_email.trim() ? meta.notification_email.trim() : null,
      });
    }
  }

  let processed = 0;
  let sent = 0;
  let skipped = 0;
  const results: any[] = [];
  const { getEmailSiteUrl } = await import('@/lib/email');
  const siteUrl = getEmailSiteUrl();
  const checkedAt = new Date().toISOString();

  for (const row of rows) {
    processed += 1;
    const u = userMap.get(row.user_id);
    if (!u?.email) { skipped += 1; continue; }

    // Build the lookup query — prefer MC over DOT for FMCSA reliability.
    const queryStr = row.mc ? `MC-${row.mc}` : row.dot ? `DOT-${row.dot}` : '';
    const parsed = parseQuery(queryStr);
    if (!parsed) { skipped += 1; continue; }

    let fresh: any;
    try {
      const carrier = await lookupCarrier(parsed);
      fresh = scoreCarrier(carrier);
    } catch (err: any) {
      // FMCSA hiccup — leave the row untouched, try again tomorrow.
      results.push({ id: row.id, status: 'fmcsa-error', message: err?.message });
      continue;
    }

    const prev = (row.data || {}) as any;
    const prevFlagTitles = new Set<string>(((prev.flags || []) as any[]).map((f) => String(f?.title || '')).filter(Boolean));
    const freshFlagTitles = new Set<string>(((fresh.flags || []) as any[]).map((f) => String(f?.title || '')).filter(Boolean));
    const newFlags: string[] = [];
    for (const t of freshFlagTitles) if (!prevFlagTitles.has(t)) newFlags.push(t);

    const prevScore = Number(row.last_score ?? prev.score ?? 0);
    const prevVerdict = String(row.last_verdict || prev.verdict || '');
    const newScore = Number(fresh.score) || 0;
    const newVerdict = String(fresh.verdict || '');
    const prevAuthority = prev.authorityStatus ?? null;
    const newAuthority = fresh.authorityStatus ?? null;
    const authorityChanged = (prevAuthority || '') !== (newAuthority || '');

    const meaningful = newScore !== prevScore || newVerdict !== prevVerdict || newFlags.length > 0 || authorityChanged;

    if (!meaningful) {
      // Touch last_checked so we round-robin through the table fairly.
      if (!dryRun) await svc.from('watchlist').update({ last_checked: checkedAt }).eq('id', row.id);
      skipped += 1;
      continue;
    }

    const change: WatchlistChange = {
      scoreFrom: prevScore,
      scoreTo: newScore,
      verdictFrom: prevVerdict,
      verdictTo: newVerdict,
      newFlags,
      authorityChanged,
      authorityFrom: prevAuthority,
      authorityTo: newAuthority,
    };

    if (u.notifyOn && isResendConfigured() && !dryRun) {
      const toAddress = u.notificationEmail || u.email;
      try {
        const { subject, html } = watchlistUpdateTemplate({
          carrier: { name: fresh.name || row.name, mc: fresh.mc || row.mc, dot: fresh.dot || row.dot },
          change,
          recipientEmail: toAddress,
          siteUrl,
        });
        await sendEmail({ to: toAddress, subject, html, kind: 'newsletter' });
        sent += 1;
      } catch (err: any) {
        results.push({ id: row.id, status: 'send-error', message: err?.message });
      }
    }

    if (!dryRun) {
      await svc.from('watchlist').update({
        last_score: newScore,
        last_verdict: newVerdict,
        last_checked: checkedAt,
        data: fresh,
      }).eq('id', row.id);
    }

    results.push({
      id: row.id,
      name: fresh.name || row.name,
      mc: row.mc, dot: row.dot,
      changed: { score: change.scoreFrom !== change.scoreTo, verdict: change.verdictFrom !== change.verdictTo, newFlags: newFlags.length, authorityChanged },
      notified: u.notifyOn && !dryRun,
    });

    // Polite spacing for the FMCSA + Resend APIs.
    await new Promise((r) => setTimeout(r, 400));
  }

  return NextResponse.json({ ok: true, processed, sent, skipped, dryRun, sample: results.slice(0, 10) });
}
