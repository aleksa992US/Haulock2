import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { isAdmin } from '@/lib/admin';
import { resolveTeamContext } from '@/lib/teams';
import { enforcedPlanId } from '@/lib/plans';
import { NOTIFY_DELAY_MS, companyChecksSince, currentVerification } from '@/lib/company-profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET ?since=<ISO> → { count, until } for the "your company was checked"
// toast. Paid accounts with a verified company only. `until` lags real time
// by NOTIFY_DELAY_MS; the client stores it and passes it back as `since`.
export async function GET(req: Request) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ enabled: false });
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const svc = getServiceSupabase();
  const verification = currentVerification(user);
  if (!svc || !verification) return NextResponse.json({ enabled: false });
  const ctx = await resolveTeamContext(user.id, enforcedPlanId(user));
  if (ctx.effectivePlan.id === 'free' && !(await isAdmin(user.email))) return NextResponse.json({ enabled: false });

  // Whole hours only, on both ends. `since` comes from the browser, so
  // exact timestamps let an owner poll or binary-search the window and pin
  // each check to the minute (and to "the broker I just sent my rate con
  // to"). Hourly buckets, at least NOTIFY_DELAY_MS behind, only say how many.
  const HOUR = 60 * 60 * 1000;
  const floorHour = (ms: number) => Math.floor(ms / HOUR) * HOUR;
  const until = new Date(floorHour(Date.now() - NOTIFY_DELAY_MS)).toISOString();
  const sinceParam = new URL(req.url).searchParams.get('since');
  const since = sinceParam && !Number.isNaN(Date.parse(sinceParam)) ? new Date(floorHour(Date.parse(sinceParam))).toISOString() : null;
  // First call on a device: just hand back the cursor — don't toast history.
  if (!since || since >= until) return NextResponse.json({ enabled: true, count: 0, until });

  let exclude = [user.id];
  if (ctx.team) {
    const { data: members } = await svc.from('team_members').select('user_id').eq('team_id', ctx.team.id);
    exclude = Array.from(new Set([...exclude, ...(members || []).map((m: any) => m.user_id)]));
  }
  // Only the verified company's ids: the profile MC/DOT are user-editable,
  // and mixing another company's MC with the verified DOT exposed its counts.
  const count = await companyChecksSince(svc, { mc: verification.mc, dot: verification.dot }, exclude, since, until);
  return NextResponse.json({ enabled: true, count, until });
}
