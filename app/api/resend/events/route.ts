import { NextResponse } from 'next/server';
import { getResendClient } from '@/lib/email';
import { getServiceSupabase } from '@/lib/supabase/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Resend delivery/engagement webhook → email_log (supabase/migrations/
// 20261124_email_events.sql). In Resend: Webhooks → Add endpoint
// https://haulock.com/api/resend/events with email.delivered, email.opened,
// email.clicked, email.bounced and email.complained, and put its signing
// secret in RESEND_EVENTS_WEBHOOK_SECRET. Opens and clicks are only reported
// when open/click tracking is on for the sending domain.

const FIELD: Record<string, 'delivered_at' | 'opened_at' | 'clicked_at' | 'bounced_at' | 'complained_at'> = {
  'email.delivered': 'delivered_at',
  'email.opened': 'opened_at',
  'email.clicked': 'clicked_at',
  'email.bounced': 'bounced_at',
  'email.complained': 'complained_at',
};

export async function POST(req: Request) {
  const secret = process.env.RESEND_EVENTS_WEBHOOK_SECRET;
  const resend = getResendClient();
  const svc = getServiceSupabase();
  if (!secret || !resend || !svc) return NextResponse.json({ error: 'Not configured' }, { status: 500 });

  const payload = await req.text();
  let event: any;
  try {
    event = resend.webhooks.verify({
      payload,
      headers: {
        id: req.headers.get('svix-id') || '',
        timestamp: req.headers.get('svix-timestamp') || '',
        signature: req.headers.get('svix-signature') || '',
      } as any,
      webhookSecret: secret,
    });
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const field = FIELD[event?.type];
  const emailId = event?.data?.email_id;
  if (!field || !emailId) return NextResponse.json({ ok: true, ignored: event?.type || 'unknown' });
  const at = event.created_at || new Date().toISOString();

  const { data: rows, error } = await svc
    .from('email_log')
    .select(`id, ${field}, open_count, click_count`)
    .eq('resend_id', emailId)
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  for (const r of (rows || []) as any[]) {
    const patch: Record<string, unknown> = {};
    if (!r[field]) patch[field] = at;
    if (field === 'opened_at') patch.open_count = (r.open_count || 0) + 1;
    if (field === 'clicked_at') patch.click_count = (r.click_count || 0) + 1;
    if (Object.keys(patch).length) await svc.from('email_log').update(patch).eq('id', r.id);
  }
  return NextResponse.json({ ok: true, matched: rows?.length || 0 });
}
