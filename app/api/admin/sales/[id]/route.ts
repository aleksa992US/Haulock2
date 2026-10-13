import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { isAdmin } from '@/lib/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STAGES = ['new', 'contacted', 'replied', 'offer_sent', 'won', 'lost'] as const;

// Admin-only. Update one user's manual pipeline row: stage, private notes,
// follow-up date, or "mark contacted now". Only the fields sent are changed.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!(await isAdmin(me.email))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Service role not configured' }, { status: 500 });

  const body = await req.json().catch(() => null) as {
    stage?: string; notes?: string; followUpAt?: string | null; contacted?: boolean;
  } | null;
  if (!body) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });

  const row: Record<string, any> = { user_id: params.id, updated_by: me.email, updated_at: new Date().toISOString() };
  if (typeof body.stage === 'string') {
    if (!(STAGES as readonly string[]).includes(body.stage)) return NextResponse.json({ error: 'Unknown stage' }, { status: 400 });
    row.stage = body.stage;
  }
  if (typeof body.notes === 'string') row.notes = body.notes.slice(0, 5000);
  if (body.followUpAt === null || typeof body.followUpAt === 'string') {
    if (body.followUpAt && !/^\d{4}-\d{2}-\d{2}$/.test(body.followUpAt)) return NextResponse.json({ error: 'Bad follow-up date' }, { status: 400 });
    row.follow_up_at = body.followUpAt || null;
  }
  if (body.contacted) {
    row.last_contacted_at = new Date().toISOString();
    // Logging a contact on a fresh lead moves it forward automatically.
    if (!row.stage) {
      const { data: existing } = await svc.from('sales_leads').select('stage').eq('user_id', params.id).maybeSingle();
      if (!existing || existing.stage === 'new') row.stage = 'contacted';
    }
  }

  const { data, error } = await svc.from('sales_leads').upsert(row, { onConflict: 'user_id' }).select().single();
  if (error) {
    const missing = /sales_leads/.test(error.message) && /does not exist|schema cache/i.test(error.message);
    return NextResponse.json(
      { error: missing ? 'The sales_leads table is missing — run the new block at the end of supabase/schema.sql.' : error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ lead: data });
}
