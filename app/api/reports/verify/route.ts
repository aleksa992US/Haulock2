import { DRIVER_REPORTS_ON, REPORTS_ON } from '@/lib/features';
import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { checkSimpleRateLimit } from '@/lib/rate-limit';
import { FREE_EMAIL_DOMAINS } from '@/lib/company-profile';
import { getEmailSiteUrl } from '@/lib/email';
import { getStripe } from '@/lib/stripe';
import type { DriverVerification, ShipperVerification } from '@/lib/reports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Proving who a reporter is, for the two kinds FMCSA has no record of.
// (Carriers and brokers verify through /api/profile/company: an email on the
// company's domain, or a code sent to the email on its FMCSA filing.)
//
//   { kind: 'driver', action: 'start' } → a Stripe Identity check of the
//       driver's license with a matching selfie; returns the URL to open.
//   { kind: 'driver', action: 'check' } → reads the result when they're back.
//   { kind: 'shipper', company, website } → the confirmed login email must be
//       on the company's own website domain (no free mail).
//
// Results go in app_metadata, which only the server can write. Haulock keeps
// the driver's name and state; the license photos stay with Stripe.
export async function POST(req: Request) {
  if (!REPORTS_ON) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Reports aren’t set up on this server yet.' }, { status: 503 });
  const b = (await req.json().catch(() => null)) as { kind?: string; action?: string; company?: string; website?: string } | null;
  const meta: any = { ...(user.app_metadata || {}) };

  if (b?.kind === 'driver') {
    if (!DRIVER_REPORTS_ON) return NextResponse.json({ error: 'Driver ID checks aren’t available.', code: 'driver_reports_off' }, { status: 404 });
    const stripe = getStripe();
    if (!stripe) return NextResponse.json({ error: 'Driver ID checks aren’t switched on yet.', code: 'not_configured' }, { status: 503 });

    if (b.action === 'start') {
      // Each completed check is billed to Haulock.
      const rl = checkSimpleRateLimit({ bucket: 'driver-id-start', identity: user.id, max: 3, windowMs: 24 * 60 * 60_000 });
      if (!rl.ok) return NextResponse.json({ error: 'You’ve started 3 ID checks today. Try again tomorrow.' }, { status: 429 });
      try {
        const session = await stripe.identity.verificationSessions.create({
          type: 'document',
          options: { document: { allowed_types: ['driving_license'], require_matching_selfie: true, require_live_capture: true } },
          metadata: { user_id: user.id, product: 'haulock', purpose: 'driver_reporter' },
          return_url: `${getEmailSiteUrl()}/reports?driver=check`,
        });
        meta.driver_verification_pending = { sessionId: session.id, at: new Date().toISOString() };
        const { error } = await svc.auth.admin.updateUserById(user.id, { app_metadata: meta });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true, url: session.url });
      } catch (e: any) {
        console.error('[reports] identity session failed', e?.message);
        return NextResponse.json({ error: 'We couldn’t start the ID check. Try again in a minute.' }, { status: 502 });
      }
    }

    if (b.action === 'check') {
      const pendingId = meta.driver_verification_pending?.sessionId;
      if (!pendingId) return NextResponse.json({ ok: false, status: 'none' });
      try {
        const session = await stripe.identity.verificationSessions.retrieve(pendingId, { expand: ['verified_outputs'] });
        if (session.metadata?.user_id !== user.id) return NextResponse.json({ ok: false, status: 'none' });
        if (session.status !== 'verified') {
          return NextResponse.json({
            ok: false,
            status: session.status, // requires_input | processing | canceled
            error: session.status === 'processing'
              ? 'Still checking your ID. Give it a minute, then check again.'
              : session.last_error?.reason || 'The ID check wasn’t completed. Start it again.',
          });
        }
        const out = session.verified_outputs;
        const name = [out?.first_name, out?.last_name].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
        if (!name) return NextResponse.json({ ok: false, status: 'verified', error: 'The ID check passed but returned no name. Contact support.' });
        const verification: DriverVerification = { name, state: out?.address?.state || null, at: new Date().toISOString(), by: 'identity', sessionId: session.id };
        meta.driver_verification = verification;
        meta.driver_verification_pending = null; // null, not delete: Supabase merges app_metadata
        const { error } = await svc.auth.admin.updateUserById(user.id, { app_metadata: meta });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true, driver: { name, state: verification.state } });
      } catch (e: any) {
        console.error('[reports] identity check failed', e?.message);
        return NextResponse.json({ error: 'We couldn’t read the ID check result. Try again in a minute.' }, { status: 502 });
      }
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }

  if (b?.kind === 'shipper') {
    const company = String(b.company || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const site = String(b.website || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '');
    if (company.length < 3) return NextResponse.json({ ok: false, error: 'Enter your company’s name.' });
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(site)) return NextResponse.json({ ok: false, error: 'Enter your company’s website, like acmefoods.com.' });
    const email = String(user.email || '').toLowerCase();
    const emailDomain = email.split('@')[1] || '';
    if (!user.email_confirmed_at) return NextResponse.json({ ok: false, error: 'Confirm your email address first (check your inbox for the link).' });
    if (FREE_EMAIL_DOMAINS.has(emailDomain)) {
      return NextResponse.json({ ok: false, error: `Sign in with your work email. ${emailDomain} is a personal mail service, so it can’t show which company you’re with.` });
    }
    if (emailDomain !== site && !emailDomain.endsWith(`.${site}`)) {
      return NextResponse.json({ ok: false, error: `Your login email is on ${emailDomain}, not ${site}. Sign in with an email on your company’s website domain.` });
    }
    const verification: ShipperVerification = { company, domain: site, at: new Date().toISOString(), by: 'work_email' };
    meta.shipper_verification = verification;
    const { error } = await svc.auth.admin.updateUserById(user.id, { app_metadata: meta });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, shipper: { company, domain: site } });
  }

  return NextResponse.json({ error: 'Unknown request' }, { status: 400 });
}
