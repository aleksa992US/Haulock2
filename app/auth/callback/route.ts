import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export const dynamic = 'force-dynamic';

// OAuth + magic-link return handler. Supabase redirects here with `?code=...`
// after the third-party (Google) finishes auth. We exchange the code for a
// session and set the auth cookies on the response, then bounce the user
// back to `?next=` (or `/` by default).
//
// IMPORTANT: in a Route Handler, auth cookies must be written onto the
// response we are about to return. Writing via `next/headers`'s cookies()
// store does not reliably propagate onto a NextResponse.redirect(), so the
// session is silently lost on the next request.
export async function GET(req: NextRequest) {
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

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    const dest = new URL('/login', url.origin);
    dest.searchParams.set('auth_error', 'Auth not configured on the server.');
    return NextResponse.redirect(dest);
  }

  const response = NextResponse.redirect(new URL(next, url.origin));

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set({ name, value, ...options });
        });
      },
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.warn('[auth/callback] exchangeCodeForSession failed', { message: error.message, status: error.status });
    const dest = new URL('/login', url.origin);
    dest.searchParams.set('auth_error', error.message || 'Could not complete sign-in.');
    return NextResponse.redirect(dest);
  }

  return response;
}
