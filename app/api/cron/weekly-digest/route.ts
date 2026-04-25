import { NextResponse } from 'next/server';
import { authorizeCronOrAdmin } from '@/lib/cron-auth';
import { getServiceSupabase } from '@/lib/supabase/service';
import { sendEmail, weeklyDigestTemplate, isResendConfigured, type DigestStats } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Weekly digest. For every user with notify_weekly_digest != false, gather
// their lookups + watchlist activity from the past 7 days and send a
// personal summary. Designed for Monday morning Vercel Cron.
export async function GET(req: Request) { return run(req); }
export async function POST(req: Request) { return run(req); }

async function run(req: Request) {
  const denied = await authorizeCronOrAdmin(req);
  if (denied) return denied;
  if (!isResendConfigured()) return NextResponse.json({ error: 'Resend not configured' }, { status: 503 });

  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dryRun') === '1';
  const skipQuiet = url.searchParams.get('skipQuiet') !== '0'; // default true: don't email users with zero activity

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { getEmailSiteUrl } = await import('@/lib/email');
  const siteUrl = getEmailSiteUrl();

  const { data: usersPage, error: usersErr } = await svc.auth.admin.listUsers({ perPage: 1000 });
  if (usersErr) return NextResponse.json({ error: usersErr.message }, { status: 500 });
  const users = (usersPage?.users || []).filter((u: any) => {
    const meta = u.user_metadata || {};
    return u.email && meta.notify_weekly_digest !== false;
  });

  let sent = 0;
  let skipped = 0;
  const sample: any[] = [];

  for (const u of users) {
    const meta = (u.user_metadata || {}) as any;
    const toAddress = (typeof meta.notification_email === 'string' && meta.notification_email.trim()) ? meta.notification_email.trim() : u.email;
    const recipientName = String(meta.full_name || meta.name || '');

    // Aggregate the week's activity for this user.
    const [{ data: lookups }, { data: watch }, { data: watchChanged }] = await Promise.all([
      svc.from('lookups')
        .select('id, name, mc, dot, score, verdict, created_at')
        .eq('user_id', u.id)
        .is('hidden_at', null)
        .gte('created_at', since)
        .order('score', { ascending: false })
        .limit(200),
      svc.from('watchlist')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', u.id),
      svc.from('watchlist')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', u.id)
        .gte('last_checked', since),
    ]);

    const all = lookups || [];
    // Dedupe by carrier so a user who scanned the same broker 4× isn't
    // shown 4 rows in their own digest.
    const dedup = new Map<string, any>();
    for (const l of all) {
      const k = l.mc ? `mc:${l.mc}` : l.dot ? `dot:${l.dot}` : `name:${(l.name || '').toLowerCase()}`;
      const cur = dedup.get(k);
      if (!cur || (Number(l.score) || 0) > (Number(cur.score) || 0)) dedup.set(k, l);
    }
    const dedupedSorted = Array.from(dedup.values()).sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));

    const stats: DigestStats = {
      lookups: all.length,
      highVerdictCount: all.filter((l: any) => l.verdict === 'high').length,
      cautionVerdictCount: all.filter((l: any) => l.verdict === 'medium').length,
      topRiskCarriers: dedupedSorted.slice(0, 5).map((l: any) => ({
        name: l.name || 'Unknown',
        mc: l.mc,
        dot: l.dot,
        score: Number(l.score) || 0,
      })),
      watchlistTotal: (watch as any)?.count ?? 0,
      watchlistChanges: (watchChanged as any)?.count ?? 0,
    };

    if (skipQuiet && stats.lookups === 0 && stats.watchlistChanges === 0) {
      skipped += 1;
      continue;
    }

    if (dryRun) {
      sample.push({ to: toAddress, stats });
      continue;
    }

    try {
      const { subject, html } = weeklyDigestTemplate({
        stats,
        recipientEmail: toAddress,
        recipientName,
        siteUrl,
      });
      await sendEmail({ to: toAddress, subject, html, kind: 'newsletter' });
      sent += 1;
      await new Promise((r) => setTimeout(r, 500));
    } catch (err: any) {
      console.warn('[cron/weekly-digest] send failed', { user: u.email, message: err?.message });
    }
  }

  return NextResponse.json({ ok: true, sent, skipped, dryRun, totalUsers: users.length, sample: sample.slice(0, 5) });
}
