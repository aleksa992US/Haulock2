import { NextResponse } from 'next/server';
import { checkSimpleRateLimit } from '@/lib/rate-limit';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { isAdmin } from '@/lib/admin';
import { resolveTeamContext } from '@/lib/teams';
import { enforcedPlanId } from '@/lib/plans';
import { checkVerificationCode, companyCheckStats, createVerificationCode, currentVerification, ownIds, resolveOwnDot, verifyCompanyOwnership } from '@/lib/company-profile';
import { companyVerificationCodeTemplate, getEmailSiteUrl, sendEmail } from '@/lib/email';

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
  const ctx = await resolveTeamContext(user.id, enforcedPlanId(user));
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
      ? {
          on: true,
          lastChecked: watch.last_checked,
          lastChangeAt: watch.data?.fmcsaWatch?.lastChangeAt || null,
          safetyBaselineAt: watch.data?.safetyWatch?.baselineAt || null,
          lastSafetyEventAt: watch.data?.safetyWatch?.lastEventAt || null,
        }
      : { on: false },
  };
  // The USDOT number keys FMCSA's inspection and crash files.
  body.usdot = verification?.dot || dot || watch?.dot || (mc ? await resolveOwnDot(mc, dot).catch(() => null) : null);
  // Counts only for paid accounts that proved the company is theirs.
  if (paid && verification) {
    let exclude = [user.id];
    if (ctx.team) {
      const { data: members } = await svc.from('team_members').select('user_id').eq('team_id', ctx.team.id);
      exclude = Array.from(new Set([...exclude, ...(members || []).map((m: any) => m.user_id)]));
    }
    // Only the verified company's ids: the profile MC/DOT are user-editable.
    body.checks = await companyCheckStats(svc, { mc: verification.mc, dot: verification.dot }, exclude);
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
        no_match: `Your login email isn’t on your company’s domain. Any email ending in @${(r.emailOnFile || '').split('@')[1] || 'your company domain'} works, or we can email a code to the address on your FMCSA filing (${r.emailOnFile}).`,
      };
      return NextResponse.json({ ok: false, reason: r.reason, error: messages[r.reason], emailOnFile: r.emailOnFile || null }, { status: 200 });
    }
    const r = result as Extract<typeof result, { ok: true }>;
    // app_metadata: server-only, so a user can't mark themselves verified.
    const { error } = await svc.auth.admin.updateUserById(user.id, {
      app_metadata: { ...(user.app_metadata || {}), company_verification: r.verification },
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, verified: { by: r.verification.by, at: r.verification.at } });
  }

  // Email a 6-digit code to the address on the company's FMCSA filing.
  if (b?.action === 'send_code') {
    const r = await createVerificationCode(user);
    if (r.ok === false) {
      const f = r as Extract<typeof r, { ok: false }>;
      return NextResponse.json({ ok: false, reason: f.reason, error: f.error }, { status: 200 });
    }
    const okR = r as Extract<typeof r, { ok: true }>;
    const { pending } = okR;
    try {
      const tpl = companyVerificationCodeTemplate({
        code: okR.code,
        companyName: okR.companyName,
        idLabel: [pending.mc && `MC-${pending.mc}`, pending.dot && `DOT-${pending.dot}`].filter(Boolean).join(' · '),
        requestedBy: user.email || 'a Haulock user',
        siteUrl: getEmailSiteUrl(),
      });
      await sendEmail({ to: okR.email, subject: tpl.subject, html: tpl.html, kind: 'other' });
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: 'We couldn’t send the code email right now. Try again in a minute.' }, { status: 200 });
    }
    await svc.auth.admin.updateUserById(user.id, { app_metadata: { ...(user.app_metadata || {}), company_verification_pending: pending } });
    return NextResponse.json({ ok: true, sentTo: pending.sentTo });
  }

  if (b?.action === 'confirm_code') {
    // The attempt counter lives in app_metadata and is read-modify-written,
    // so many guesses sent at once all saw the same count. Cap attempts per
    // user before checking (5 per half hour, the same as one code allows).
    const rl = checkSimpleRateLimit({ bucket: 'company-code', identity: user.id, max: 5, windowMs: 30 * 60_000 });
    if (!rl.ok) return NextResponse.json({ ok: false, error: 'Too many tries. Wait a little, then send a new code.' }, { status: 429 });
    const r = checkVerificationCode(user, String((b as any).code || ''));
    const meta: any = { ...(user.app_metadata || {}) };
    if (r.ok === false) {
      const f = r as Extract<typeof r, { ok: false }>;
      // null, not delete: Supabase merges app_metadata, so a missing key
      // left the old pending code in place.
      // Keep only the send times, so the 3-codes-an-hour limit still holds.
      if (f.pending === null) meta.company_verification_pending = { sends: (meta.company_verification_pending?.sends || []) };
      else if (f.pending) meta.company_verification_pending = f.pending;
      if (f.pending !== undefined) await svc.auth.admin.updateUserById(user.id, { app_metadata: meta });
      return NextResponse.json({ ok: false, error: f.error }, { status: 200 });
    }
    const okR = r as Extract<typeof r, { ok: true }>;
    meta.company_verification_pending = null; // used up (see above: null, not delete)
    meta.company_verification = okR.verification;
    const { error } = await svc.auth.admin.updateUserById(user.id, { app_metadata: meta });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, verified: { by: 'code', at: okR.verification.at } });
  }

  if (b?.action === 'monitor') {
    const existing = await ownWatchRow(svc, user.id);
    if (b.on === false) {
      if (existing?.data?.ownAdopted) {
        // The company was on the regular watchlist before monitoring was
        // turned on: keep that entry, just stop the own-company monitoring.
        const { own, ownAdopted, safetyWatch, ...rest } = existing.data || {};
        await svc.from('watchlist').update({ data: rest }).eq('id', existing.id).eq('user_id', user.id);
      } else if (existing) {
        await svc.from('watchlist').delete().eq('id', existing.id).eq('user_id', user.id);
      }
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
        // ownAdopted: turning monitoring off later keeps this entry.
        await svc.from('watchlist').update({ data: { ...(rows[0].data || {}), own: true, ownAdopted: true } }).eq('id', rows[0].id);
      } else {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }
    return NextResponse.json({ ok: true, monitoring: { on: true } });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
