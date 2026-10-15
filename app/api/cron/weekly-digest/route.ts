import { NextResponse } from 'next/server';
import { authorizeCronOrAdmin } from '@/lib/cron-auth';
import { getServiceSupabase } from '@/lib/supabase/service';
import { weeklyDigestTemplate, isResendConfigured, recentlySentTo, sendEmailBatch, type BatchEmail, type DigestStats } from '@/lib/email';

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

  // Every page: Supabase Auth returns at most 1,000 users per call.
  const allUsers: any[] = [];
  for (let page = 1; ; page += 1) {
    const { data: usersPage, error: usersErr } = await svc.auth.admin.listUsers({ page, perPage: 1000 });
    if (usersErr) return NextResponse.json({ error: usersErr.message }, { status: 500 });
    const batch = usersPage?.users || [];
    allUsers.push(...batch);
    if (batch.length < 1000) break;
  }
  const users = allUsers.filter((u: any) => {
    const meta = u.user_metadata || {};
    return u.email && meta.notify_weekly_digest !== false;
  });

  let skipped = 0;
  let alreadySent = 0;
  const sample: any[] = [];
  const outbox: BatchEmail[] = [];
  // Anyone who got this week's digest already (a re-run or a retry).
  const already = dryRun ? new Set<string>() : await recentlySentTo('weekly_digest', new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString());

  // Build each user's digest (10 users' queries at a time), then send them
  // all through Resend's batch API. One send per user with a pause between
  // took minutes and could run out of time partway through the list.
  const buildDigest = async (u: any) => {
    const meta = (u.user_metadata || {}) as any;
    const toAddress = (typeof meta.notification_email === 'string' && meta.notification_email.trim()) ? meta.notification_email.trim() : u.email;
    const recipientName = String(meta.full_name || meta.name || '');
    if (already.has(String(toAddress).toLowerCase())) { alreadySent += 1; return; }

    // Aggregate the week's activity for this user.
    // head:true counts come back as `count`; `data` is null.
    const [{ data: lookups }, { count: watchTotal }, { count: watchChanged }] = await Promise.all([
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
      // Real changes only: the daily watchlist job stamps lastChangeAt when
      // FMCSA's record actually changed. last_checked moves every day for
      // every row, so counting it reported every watched company as changed.
      svc.from('watchlist')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', u.id)
        .gte('data->fmcsaWatch->>lastChangeAt', since),
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
      watchlistTotal: watchTotal ?? 0,
      watchlistChanges: watchChanged ?? 0,
    };

    if (skipQuiet && stats.lookups === 0 && stats.watchlistChanges === 0) {
      skipped += 1;
      return;
    }

    if (dryRun) {
      sample.push({ to: toAddress, stats });
      return;
    }

    const { subject, html } = weeklyDigestTemplate({
      stats,
      recipientEmail: toAddress,
      recipientName,
      siteUrl,
    });
    outbox.push({ to: toAddress, subject, html, kind: 'weekly_digest' });
  };

  for (let i = 0; i < users.length; i += 10) {
    await Promise.all(users.slice(i, i + 10).map((u) => buildDigest(u).catch((err: any) => {
      console.warn('[cron/weekly-digest] could not build digest', { user: u.email, message: err?.message });
    })));
  }

  const { sent, failed, errors } = outbox.length ? await sendEmailBatch(outbox) : { sent: 0, failed: 0, errors: [] as string[] };
  if (errors.length) console.warn('[cron/weekly-digest] batch errors', errors.slice(0, 3));

  return NextResponse.json({ ok: true, sent, failed, skipped, alreadySent, dryRun, totalUsers: users.length, sample: sample.slice(0, 5) });
}
