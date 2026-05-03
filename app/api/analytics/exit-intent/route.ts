import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Log an exit-intent modal event (shown / claimed / dismissed) so admin
// can measure how often it fires and how many users actually convert
// against the discount. Fire-and-forget from the checkout page; failure
// here must never block checkout, so we always return 200.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null) as {
      kind?: string;
      plan?: string;
      billing?: string;
      meta?: Record<string, any>;
    } | null;
    if (!body) return NextResponse.json({ ok: true });

    const kind = body.kind === 'shown' || body.kind === 'claimed' || body.kind === 'dismissed'
      ? body.kind
      : null;
    if (!kind) return NextResponse.json({ ok: true });

    // Best-effort user attribution — anonymous events still get logged.
    let userId: string | null = null;
    let userEmail: string | null = null;
    const ssr = getServerSupabase();
    if (ssr) {
      const { data } = await ssr.auth.getUser();
      userId = data?.user?.id || null;
      userEmail = data?.user?.email || null;
    }

    const svc = getServiceSupabase();
    if (!svc) return NextResponse.json({ ok: true });

    await svc.from('exit_intent_events').insert({
      user_id: userId,
      user_email: userEmail,
      plan: typeof body.plan === 'string' ? body.plan : null,
      billing: typeof body.billing === 'string' ? body.billing : null,
      kind,
      meta: body.meta || null,
    });
  } catch {
    // Telemetry failures must never bubble to the client.
  }
  return NextResponse.json({ ok: true });
}
