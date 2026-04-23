import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE() {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  // Best-effort cleanup of rows the user owns. Most tables have
  // ON DELETE CASCADE against auth.users, so deleting the auth user
  // is enough — but we scrub explicitly in case cascades are missing
  // or the user owns a team that isn't cascaded.
  try {
    await svc.from('lookups').delete().eq('user_id', me.id);
    await svc.from('watchlist').delete().eq('user_id', me.id);
    await svc.from('fraud_reports').delete().eq('user_id', me.id);
    await svc.from('team_members').delete().eq('user_id', me.id);
    await svc.from('teams').delete().eq('owner_id', me.id);
  } catch (err) {
    console.warn('[api/profile/delete] cleanup warnings:', err);
  }

  const { error } = await svc.auth.admin.deleteUser(me.id);
  if (error) {
    console.error('[api/profile/delete] auth delete failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
