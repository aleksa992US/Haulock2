import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { isAdmin } from '@/lib/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Admin-only CRUD for saved Sales email templates. Built-in templates live
// in the client; these are the operator's own.

async function requireAdmin() {
  const supabase = getServerSupabase();
  if (!supabase) return { error: NextResponse.json({ error: 'Supabase not configured' }, { status: 500 }) };
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user;
  if (!me) return { error: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
  if (!(await isAdmin(me.email))) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  const svc = getServiceSupabase();
  if (!svc) return { error: NextResponse.json({ error: 'Service role not configured' }, { status: 500 }) };
  return { me, svc };
}

export async function GET() {
  const auth = await requireAdmin();
  if ('error' in auth) return auth.error;
  const { data, error } = await auth.svc
    .from('sales_email_templates')
    .select('id, name, subject, body, cta_label, cta_url, show_lookups, updated_at')
    .order('updated_at', { ascending: false });
  if (error) return NextResponse.json({ templates: [], ready: false });
  return NextResponse.json({ templates: data || [], ready: true });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if ('error' in auth) return auth.error;
  const b = await req.json().catch(() => null) as any;
  const name = String(b?.name || '').trim().slice(0, 120);
  const subject = String(b?.subject || '').trim().slice(0, 300);
  const body = String(b?.body || '').slice(0, 20000);
  if (!name || !subject || !body.trim()) return NextResponse.json({ error: 'Name, subject and body are required' }, { status: 400 });
  const row: Record<string, any> = {
    name, subject, body,
    cta_label: b?.ctaLabel ? String(b.ctaLabel).slice(0, 80) : null,
    cta_url: b?.ctaUrl ? String(b.ctaUrl).slice(0, 500) : null,
    show_lookups: b?.showLookups !== false,
    created_by: auth.me.email,
    updated_at: new Date().toISOString(),
  };
  const q = b?.id
    ? auth.svc.from('sales_email_templates').update(row).eq('id', String(b.id))
    : auth.svc.from('sales_email_templates').insert(row);
  const { data, error } = await q.select('id, name, subject, body, cta_label, cta_url, show_lookups, updated_at').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ template: data });
}

export async function DELETE(req: Request) {
  const auth = await requireAdmin();
  if ('error' in auth) return auth.error;
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  const { error } = await auth.svc.from('sales_email_templates').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
