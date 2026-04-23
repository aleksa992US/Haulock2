import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [recent, unseen] = await Promise.all([
    supabase
      .from('lookups')
      .select('*')
      .eq('user_id', user.id)
      .in('verdict', ['high', 'medium'])
      .gte('created_at', since7d)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('lookups')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('verdict', 'high')
      .gte('created_at', since24h),
  ]);

  if (recent.error) return NextResponse.json({ error: recent.error.message }, { status: 500 });
  return NextResponse.json({ alerts: recent.data || [], unseenCount: unseen.count || 0 });
}
