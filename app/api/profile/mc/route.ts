import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { parseQuery, resolveQuery, ambiguousNumberMessage } from '@/lib/fmcsa';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MC_CHANGE_COOLDOWN_DAYS = 30;

export async function POST(req: Request) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json().catch(() => null) as { id?: string; mc?: string } | null;
  const raw = String(body?.id ?? body?.mc ?? '').trim();

  let mc = '';
  let dot = '';
  if (raw) {
    const parsed = parseQuery(raw);
    if (!parsed || parsed.kind === 'name') return NextResponse.json({ error: 'Invalid MC or DOT — must be 3 to 9 digits.' }, { status: 400 });
    // A bare number can be an MC or a USDOT number for two different companies;
    // ask FMCSA instead of guessing from its length.
    const resolved = await resolveQuery(parsed);
    if ('candidates' in resolved) {
      return NextResponse.json({ error: ambiguousNumberMessage(resolved.candidates), code: 'ambiguous_number', candidates: resolved.candidates }, { status: 409 });
    }
    const id = resolved.query;
    if (id.kind === 'mc') mc = id.value;
    else if (id.kind === 'dot') dot = id.value;
  }

  const meta = me.user_metadata || {};
  const currentMc: string = meta.mc || '';
  const currentDot: string = meta.dot || '';
  if (currentMc === mc && currentDot === dot) return NextResponse.json({ ok: true, mc, dot });

  const lastChangedAt: string | null = meta.mc_changed_at || null;
  // Apply cooldown only if user previously had an ID set.
  if ((currentMc || currentDot) && lastChangedAt) {
    const diffMs = Date.now() - new Date(lastChangedAt).getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    if (diffDays < MC_CHANGE_COOLDOWN_DAYS) {
      const daysLeft = Math.ceil(MC_CHANGE_COOLDOWN_DAYS - diffDays);
      return NextResponse.json({
        error: `Your broker ID can only be changed once every ${MC_CHANGE_COOLDOWN_DAYS} days. Try again in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`,
        code: 'cooldown',
        daysLeft,
      }, { status: 429 });
    }
  }

  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  const newMeta = { ...meta, mc, dot, mc_changed_at: new Date().toISOString() };
  const { data: updateRes, error } = await svc.auth.admin.updateUserById(me.id, { user_metadata: newMeta });
  if (error) {
    console.error('[api/profile/mc] update failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  console.log('[api/profile/mc] saved →', { mc, dot, returned_meta: updateRes?.user?.user_metadata });

  // Read back to confirm persistence
  const { data: verify } = await svc.auth.admin.getUserById(me.id);
  console.log('[api/profile/mc] verify read →', verify?.user?.user_metadata);

  return NextResponse.json({ ok: true, mc, dot });
}
