import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { isAdmin } from '@/lib/admin';
import { resolveTeamContext } from '@/lib/teams';
import { companyCheckStats, currentVerification, ownIds, resolveOwnDot, verifyCompanyOwnership } from '@/lib/company-profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// "Your company" for paid accounts:
//   GET                          → status, check counts (verified owners), monitoring state
//   POST { action: 'verify' }    → match login email with the FMCSA filing email
//   POST { action: 'monitor', on } → daily FMCSA monitoring of the company (watchlist row, data.own)

async function context() {
  const supabase = getServerSupabase();
  if (!supabase) return { error: NextResponse.json({ error: 'Supabase not configured' }, { status: 500 }) };
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return { error: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
  const svc = getServiceSupabase();
  if (!svc) return { error: NextResponse.json({ error: 'Service role not configured' }, { status: 500 }) };
  const admin = await isAdmin(user.email);
  const ctx = await resolveTeamContext(user.id, (user.user_metadata as any)?.plan);
  const paid = admin || ctx.effectivePlan.id !== 'free';
  return { user, svc, paid, ctx };
}

async function ownWatchRow(svc: any, userId: string) {
  const { data } = await svc.from('watchlist').select('id, mc, dot, last_checked, data').eq('user_id', userId).contains('data', { own: true }).limit(1);
  return data?.[0] || null;
}

export async function GET() {
  const c = await context();
  if ('error' in c) return c.error;
  const { user, svc, paid, ctx } = c;
  const { mc, dot } = ownIds(user);
  if (!mc && !dot) return NextResponse.json({ hasCompany: false, paid });

  const verification = currentVerification(user);
  const watch = await ownWatchRow(svc, user.id);
  const body: any = {
    hasCompany: true,
    paid,
    mc,
    dot,
    verified: verification ? { by: verification.by, at: verification.at } : null,
    monitoring: watch
      ? { on: true, lastChecked: watch.last_checked, lastChangeAt: watch.data?.fmcsaWatch?.lastChangeAt || null }
      : { on: false },
  };
  // Counts only for paid accounts that proved the company is theirs.
  if (paid && verification) {
    let exclude = [user.id];
    if (ctx.team) {
      const { data: members } = await svc.from('team_members').select('user_id').eq('team_id', ctx.team.id);
      exclude = Array.from(new Set([...exclude, ...(members || []).map((m: any) => m.user_id)]));
    }
    body.checks = await companyCheckStats(svc, { mc, dot: verification.dot || dot }, exclude);
  }
  return NextResponse.json(body);
}

export async function POST(req: Request) {
  const c = await context();
  if ('error' in c) return c.error;
  const { user, svc, paid } = c;
  if (!paid) return NextResponse.json({ error: 'Available on paid plans.', code: 'not_in_plan' }, { status: 402 });
  const b = await req.json().catch(() => null) as { action?: string; on?: boolean } | null;
  const { mc, dot } = ownIds(user);
  if (!mc && !dot) return NextResponse.json({ error: 'Set your MC or DOT in Settings → Profile first.' }, { status: 400 });

  if (b?.action === 'verify') {
    const result = await verifyCompanyOwnership(user);
    if (result.ok === false) {
      const r = result as Extract<typeof result, { ok: false }>;
      const messages: Record<string, string> = {
        no_company: 'Set your MC or DOT in Settings → Profile first.',
        lookup_failed: 'We couldn’t reach FMCSA’s records right now. Try again in a minute.',
        no_fmcsa_email: 'Your company’s FMCSA filing has no email address, so we can’t verify it automatically. Contact support to verify another way.',
        no_match: `Your login email doesn’t match the email on your company’s FMCSA filing${r.emailOnFile ? ` (${r.emailOnFile})` : ''}. Sign in with that email or one on the same company domain, or update your MCS-150 with FMCSA.`,
      };
      return NextResponse.json({ ok: false, reason: r.reason, error: messages[r.reason] }, { status: 200 });
    }
    const r = result as Extract<typeof result, { ok: true }>;
    // app_metadata: server-only, so a user can't mark themselves verified.
    const { error } = await svc.auth.admin.updateUserById(user.id, {
      app_metadata: { ...(user.app_metadata || {}), company_verification: r.verification },
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, verified: { by: r.verification.by, at: r.verification.at } });
  }

  if (b?.action === 'monitor') {
    const existing = await ownWatchRow(svc, user.id);
    if (b.on === false) {
      if (existing) await svc.from('watchlist').delete().eq('id', existing.id).eq('user_id', user.id);
      return NextResponse.json({ ok: true, monitoring: { on: false } });
    }
    if (existing) return NextResponse.json({ ok: true, monitoring: { on: true } });
    const usdot = await resolveOwnDot(mc, dot);
    // Doesn't count toward the watchlist limit; marked data.own so the
    // daily check words its email as "your record changed".
    const { error } = await svc.from('watchlist').insert({
      user_id: user.id,
      mc: mc || null,
      dot: usdot || dot || null,
      name: (user.user_metadata as any)?.company || (mc ? `MC-${mc}` : `DOT-${dot}`),
      data: { own: true },
    });
    if (error) {
      // Same company already on the regular watchlist: mark that row as own.
      const { data: rows } = await svc.from('watchlist').select('id, data').eq('user_id', user.id).or([mc ? `mc.eq.${mc}` : null, usdot ? `dot.eq.${usdot}` : null].filter(Boolean).join(','));
      if (rows && rows[0]) {
        await svc.from('watchlist').update({ data: { ...(rows[0].data || {}), own: true } }).eq('id', rows[0].id);
      } else {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }
    return NextResponse.json({ ok: true, monitoring: { on: true } });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
