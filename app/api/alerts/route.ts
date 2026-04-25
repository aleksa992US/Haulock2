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

  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Sidebar badge and the /alerts page list MUST match — same window, same
  // verdict set. Mismatch erodes trust in the count.
  const { data, error } = await supabase
    .from('lookups')
    .select('*')
    .eq('user_id', user.id)
    .in('verdict', ['high', 'medium'])
    .gte('created_at', since7d)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const alerts = data || [];

  // Sidebar badge counts UNIQUE brokers/carriers, not raw scan rows. The
  // /alerts page also dedupes by MC/DOT/name, so this keeps the badge in
  // lockstep with the list (no more "1 in nav, 4 in page" mismatch).
  const uniqueKeys = new Set<string>();
  for (const a of alerts) {
    const k = a.mc ? `mc:${a.mc}` : a.dot ? `dot:${a.dot}` : `name:${(a.name || '').toLowerCase()}`;
    uniqueKeys.add(k);
  }

  return NextResponse.json({ alerts, unseenCount: uniqueKeys.size });
}
