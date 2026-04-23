import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MC_CHANGE_COOLDOWN_DAYS = 30;

type ParsedId = { kind: 'mc' | 'dot'; value: string };

function parseId(raw: string): ParsedId | null {
  const s = String(raw).trim().toUpperCase().replace(/\s+/g, '');
  const mc = s.match(/^MC[-#]?(\d{3,8})$/);
  if (mc) return { kind: 'mc', value: mc[1] };
  const dot = s.match(/^(?:DOT|USDOT)[-#]?(\d{3,9})$/);
  if (dot) return { kind: 'dot', value: dot[1] };
  if (/^\d{3,9}$/.test(s)) {
    return s.length >= 7 ? { kind: 'dot', value: s } : { kind: 'mc', value: s };
  }
  return null;
}

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
    const parsed = parseId(raw);
    if (!parsed) return NextResponse.json({ error: 'Invalid MC or DOT — must be 3 to 9 digits.' }, { status: 400 });
    if (parsed.kind === 'mc') mc = parsed.value;
    else dot = parsed.value;
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
