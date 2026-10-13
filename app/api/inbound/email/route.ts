import { NextResponse } from 'next/server';
import { getResendClient } from '@/lib/email';
import { getServiceSupabase } from '@/lib/supabase/service';
import { emailAddress, processInboundEmail } from '@/lib/inbound-scan';
import { isAdmin } from '@/lib/admin';
import { SCAN_EMAIL_ON } from '@/lib/features';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Resend inbound webhook (event: email.received) for scan@haulock.com.
// Setup: Resend → Receiving → add the receiving domain, then Webhooks → add
// this URL with the email.received event and put its signing secret in
// RESEND_INBOUND_WEBHOOK_SECRET.
export async function POST(req: Request) {
  const secret = process.env.RESEND_INBOUND_WEBHOOK_SECRET;
  const resend = getResendClient();
  const svc = getServiceSupabase();
  if (!secret || !resend || !svc) {
    return NextResponse.json({ error: 'Inbound email is not configured' }, { status: 503 });
  }

  const payload = await req.text();
  let event: any;
  try {
    event = resend.webhooks.verify({
      payload,
      headers: {
        id: req.headers.get('svix-id') || '',
        timestamp: req.headers.get('svix-timestamp') || '',
        signature: req.headers.get('svix-signature') || '',
      },
      webhookSecret: secret,
    });
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  if (event?.type !== 'email.received') return NextResponse.json({ ignored: event?.type || 'unknown' });
  const emailId: string = event.data?.email_id;
  if (!emailId) return NextResponse.json({ error: 'Missing email_id' }, { status: 400 });

  // Optional allow-list of receiving addresses, e.g. "scan@haulock.com,scan@in.haulock.com".
  const allowed = (process.env.INBOUND_SCAN_ADDRESSES || '').split(',').map((a) => a.trim().toLowerCase()).filter(Boolean);
  const to: string[] = (event.data?.to || []).map(emailAddress);
  if (allowed.length > 0 && !to.some((a) => allowed.includes(a))) return NextResponse.json({ ignored: 'address' });

  // Not launched yet: only admins' forwards get processed (lib/features.ts).
  // 200 so Resend doesn't retry.
  const from = emailAddress(event.data?.from);
  if (!SCAN_EMAIL_ON && !(await isAdmin(from))) return NextResponse.json({ ignored: 'not_launched' });

  // Claim the email once. Resend retries webhooks that time out; the unique
  // email_id makes those retries no-ops while the first run finishes.
  const { error: claimError } = await svc.from('inbound_scans').insert({ email_id: emailId, from_email: from, status: 'processing' });
  if (claimError) {
    if ((claimError as any).code === '23505') return NextResponse.json({ duplicate: true });
    console.error('[inbound/email] claim failed', claimError);
    return NextResponse.json({ error: 'Could not record email' }, { status: 500 });
  }

  let outcome;
  try {
    outcome = await processInboundEmail(emailId);
  } catch (e: any) {
    console.error('[inbound/email] processing failed', { emailId, error: e?.message });
    outcome = { status: 'failed' as const, note: e?.message || 'error' };
  }

  await svc
    .from('inbound_scans')
    .update({
      status: outcome.status,
      tier: outcome.tier ?? null,
      user_id: outcome.userId ?? null,
      doc_types: outcome.docTypes ?? null,
      verdict: outcome.verdict ?? null,
      note: outcome.note ?? null,
    })
    .eq('email_id', emailId);

  return NextResponse.json({ ok: true, status: outcome.status });
}
