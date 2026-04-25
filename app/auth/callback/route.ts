import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// OAuth + magic-link return handler. Supabase redirects here with `?code=...`
// after the third-party (Google) finishes auth. We exchange the code for a
// session and set the auth cookies on the response, then bounce the user
// back to `?next=` (or `/` by default).
//
// On any failure we redirect to `/login?auth_error=<reason>` so the user
// sees a real message instead of a silently-broken page.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/';

  // Some providers (and our own login form) redirect here on failure with
  // `?error=...&error_description=...`. Surface that immediately.
  const upstreamError = url.searchParams.get('error');
  const upstreamErrorDesc = url.searchParams.get('error_description');
  if (upstreamError) {
    const dest = new URL('/login', url.origin);
    dest.searchParams.set('auth_error', upstreamErrorDesc || upstreamError);
    return NextResponse.redirect(dest);
  }

  if (!code) {
    const dest = new URL('/login', url.origin);
    dest.searchParams.set('auth_error', 'Missing code in callback URL.');
    return NextResponse.redirect(dest);
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    const dest = new URL('/login', url.origin);
    dest.searchParams.set('auth_error', 'Auth not configured on the server.');
    return NextResponse.redirect(dest);
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.warn('[auth/callback] exchangeCodeForSession failed', { message: error.message, status: error.status });
    const dest = new URL('/login', url.origin);
    dest.searchParams.set('auth_error', error.message || 'Could not complete sign-in.');
    return NextResponse.redirect(dest);
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
