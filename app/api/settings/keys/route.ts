import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { generateKey } from '@/lib/api-keys';
import { isAdmin } from '@/lib/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// API access ships on Carrier and up. Server-gate the create endpoint
// so the UI is not the only thing standing between a Free user and a key.
const PAID_PLANS_FOR_API = new Set(['carrier', 'team', 'fleet']);

export async function GET() {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data, error } = await supabase
    .from('api_keys')
    .select('id,name,prefix,created_at,last_used_at,revoked_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ keys: data || [] });
}

export async function POST(req: Request) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  // Plan gate: Free users cannot create keys. Admins bypass for testing.
  const planId = String(user.user_metadata?.plan || 'free').toLowerCase();
  if (!PAID_PLANS_FOR_API.has(planId) && !(await isAdmin(user.email))) {
    return NextResponse.json({
      error: 'API access requires the Carrier plan or higher.',
      code: 'plan_required',
      requiredPlan: 'carrier',
    }, { status: 403 });
  }

  const body = await req.json().catch(() => null) as { name?: string } | null;
  const rawName = (body?.name ?? '').toString().trim();
  const name = (rawName || 'API key').slice(0, 60);

  const { raw, prefix, hash } = generateKey();

  const { data, error } = await supabase
    .from('api_keys')
    .insert({ user_id: user.id, name, prefix, key_hash: hash })
    .select('id,name,prefix,created_at,last_used_at,revoked_at')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Return the plaintext token once — it cannot be retrieved again.
  return NextResponse.json({ key: data, token: raw });
}

export async function DELETE(req: Request) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const { error } = await supabase
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
