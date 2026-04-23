import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { isAdmin, invalidateAdminCache } from '@/lib/admin';
import { PLANS } from '@/lib/plans';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!(await isAdmin(me.email))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  const body = await req.json().catch(() => null) as { plan?: string; isAdmin?: boolean } | null;
  if (!body) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });

  // Update plan (stored in user_metadata)
  if (typeof body.plan === 'string') {
    if (!(body.plan in PLANS)) return NextResponse.json({ error: 'Unknown plan' }, { status: 400 });
    const { data: existing } = await svc.auth.admin.getUserById(params.id);
    const merged = { ...(existing.user?.user_metadata || {}), plan: body.plan };
    const { error } = await svc.auth.admin.updateUserById(params.id, { user_metadata: merged });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Toggle admin (by email, in admins table)
  if (typeof body.isAdmin === 'boolean') {
    const { data: target } = await svc.auth.admin.getUserById(params.id);
    const email = target.user?.email;
    if (!email) return NextResponse.json({ error: 'Target user has no email' }, { status: 400 });
    if (body.isAdmin) {
      const { error } = await svc.from('admins').upsert({ email: email.toLowerCase(), added_by: me.id }, { onConflict: 'email' });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else {
      if (email.toLowerCase() === (me.email || '').toLowerCase()) {
        return NextResponse.json({ error: "You can't remove yourself as admin" }, { status: 400 });
      }
      const { error } = await svc.from('admins').delete().eq('email', email.toLowerCase());
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    invalidateAdminCache();
  }

  return NextResponse.json({ ok: true });
}
