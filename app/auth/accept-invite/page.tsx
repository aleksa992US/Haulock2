'use client';

import { useEffect, useState } from 'react';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase/client';

export default function AcceptInvitePage() {
  const [token, setToken] = useState<string | null>(null);
  const [invite, setInvite] = useState<any>(null);
  const [me, setMe] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    const t = url.searchParams.get('token');
    setToken(t);
    if (!t) { setError('Missing invite token.'); setLoading(false); return; }
    const sb = getSupabase();
    Promise.all([
      fetch(`/api/team/accept?token=${encodeURIComponent(t)}`).then(async (r) => ({ ok: r.ok, body: await r.json() })),
      sb ? sb.auth.getUser() : Promise.resolve({ data: { user: null } } as any),
    ]).then(([inv, ses]: any) => {
      if (!inv.ok) { setError(inv.body?.error || 'Invite invalid'); }
      else setInvite(inv.body.invite);
      setMe(ses?.data?.user || null);
      setLoading(false);
    });
  }, []);

  const accept = async () => {
    setActing(true); setError(null);
    try {
      const res = await fetch('/api/team/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Failed (${res.status})`);
      setInfo('Joined the team. Redirecting…');
      setTimeout(() => { window.location.href = '/dashboard'; }, 1000);
    } catch (e: any) { setError(e?.message || 'Failed'); }
    finally { setActing(false); }
  };

  const signUpFlow = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setActing(true); setError(null); setInfo(null);
    const fd = new FormData(e.currentTarget);
    const password = String(fd.get('password') || '');
    const fullName = String(fd.get('fullName') || '').trim();
    if (password.length < 8) { setError('Password must be at least 8 characters.'); setActing(false); return; }
    const sb = getSupabase();
    if (!sb || !invite) { setError('Supabase is not configured.'); setActing(false); return; }
    const site = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
    const { data, error } = await sb.auth.signUp({
      email: invite.email,
      password,
      options: { data: { full_name: fullName }, emailRedirectTo: `${site}/auth/accept-invite?token=${encodeURIComponent(token!)}` },
    });
    if (error) { setError(error.message); setActing(false); return; }
    if (!data.session) {
      setInfo('Check your inbox to confirm your email. After confirming, you\'ll be redirected back here to join the team.');
      setActing(false);
      return;
    }
    // Logged in immediately — accept now
    await accept();
  };

  const signInFlow = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setActing(true); setError(null);
    const fd = new FormData(e.currentTarget);
    const password = String(fd.get('password') || '');
    const sb = getSupabase();
    if (!sb || !invite) { setError('Supabase is not configured.'); setActing(false); return; }
    const { error } = await sb.auth.signInWithPassword({ email: invite.email, password });
    if (error) { setError(error.message); setActing(false); return; }
    await accept();
  };

  return (
    <div className="min-h-screen bg-[#F5F3EE] flex items-center justify-center p-6 text-[#0B1E3F]">
      <div className="w-full max-w-md bg-white rounded-2xl border border-[#0B1E3F]/10 p-8 md:p-10 card-shadow">
        <div className="mb-6">
          <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-2">Team invite</div>
          <h1 className="text-3xl serif italic text-[#0B1E3F]">{loading ? 'Loading…' : invite ? `Join ${invite.teamName}` : 'Invite'}</h1>
          {invite && <p className="text-[#0B1E3F]/60 mt-2 text-sm">You were invited as <strong className="text-[#0B1E3F]">{invite.email}</strong> — they’re on the <strong className="text-[#0B1E3F]">{invite.teamPlan}</strong> plan.</p>}
        </div>

        {!isSupabaseConfigured() && <div className="text-sm text-[#DC2626]">Supabase is not configured.</div>}

        {!loading && invite && (() => {
          const myEmail = (me?.email || '').toLowerCase();
          const inviteEmail = invite.email.toLowerCase();

          if (me && myEmail === inviteEmail) {
            return (
              <div className="space-y-4">
                <p className="text-sm text-[#0B1E3F]/70">You&rsquo;re signed in as <strong>{me.email}</strong>.</p>
                {error && <div className="text-sm text-[#DC2626]">{error}</div>}
                {info && <div className="text-sm text-[#16A34A]">{info}</div>}
                <button onClick={accept} disabled={acting} className="w-full py-3.5 bg-[#0B1E3F] text-white rounded-full font-medium hover:bg-[#0B1E3F]/90 disabled:opacity-60">
                  {acting ? 'Joining…' : 'Accept invite'}
                </button>
              </div>
            );
          }

          if (me && myEmail !== inviteEmail) {
            return (
              <div className="space-y-4">
                <div className="text-sm text-[#DC2626]">You&rsquo;re signed in as <strong>{me.email}</strong> but the invite is for <strong>{invite.email}</strong>. Sign out and sign in with that email.</div>
                <a href="/" className="block text-center py-3 border border-[#0B1E3F]/15 rounded-full font-medium text-[#0B1E3F] hover:bg-[#0B1E3F]/5">Go home</a>
              </div>
            );
          }

          // Not signed in — offer sign up (new) or sign in (existing).
          return <NewOrExistingSwitch invite={invite} signUpFlow={signUpFlow} signInFlow={signInFlow} acting={acting} error={error} info={info} />;
        })()}

        {!loading && !invite && (
          <div className="space-y-4">
            <div className="text-sm text-[#DC2626]">{error || 'This invite link is invalid or expired.'}</div>
            <a href="/" className="block text-center py-3 border border-[#0B1E3F]/15 rounded-full font-medium text-[#0B1E3F] hover:bg-[#0B1E3F]/5">Go home</a>
          </div>
        )}
      </div>
    </div>
  );
}

function NewOrExistingSwitch({ invite, signUpFlow, signInFlow, acting, error, info }: any) {
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  return (
    <div className="space-y-4">
      <div className="flex gap-1 p-1 bg-[#0B1E3F]/5 rounded-full text-sm">
        <button onClick={() => setMode('new')} className={`flex-1 py-2 rounded-full font-medium ${mode === 'new' ? 'bg-[#0B1E3F] text-white' : 'text-[#0B1E3F]/70'}`}>Create account</button>
        <button onClick={() => setMode('existing')} className={`flex-1 py-2 rounded-full font-medium ${mode === 'existing' ? 'bg-[#0B1E3F] text-white' : 'text-[#0B1E3F]/70'}`}>I have one</button>
      </div>
      {mode === 'new' ? (
        <form onSubmit={signUpFlow} className="space-y-3">
          <FieldSimple label="Email" value={invite.email} disabled />
          <FieldSimple label="Full name" name="fullName" placeholder="Your name" />
          <FieldSimple label="Password" name="password" type="password" placeholder="At least 8 characters" required />
          {error && <div className="text-sm text-[#DC2626]">{error}</div>}
          {info && <div className="text-sm text-[#16A34A]">{info}</div>}
          <button type="submit" disabled={acting} className="w-full py-3.5 bg-[#0B1E3F] text-white rounded-full font-medium hover:bg-[#0B1E3F]/90 disabled:opacity-60">
            {acting ? 'Creating…' : 'Create account & join'}
          </button>
        </form>
      ) : (
        <form onSubmit={signInFlow} className="space-y-3">
          <FieldSimple label="Email" value={invite.email} disabled />
          <FieldSimple label="Password" name="password" type="password" placeholder="Your password" required />
          {error && <div className="text-sm text-[#DC2626]">{error}</div>}
          <button type="submit" disabled={acting} className="w-full py-3.5 bg-[#0B1E3F] text-white rounded-full font-medium hover:bg-[#0B1E3F]/90 disabled:opacity-60">
            {acting ? 'Signing in…' : 'Sign in & join'}
          </button>
        </form>
      )}
    </div>
  );
}

function FieldSimple({ label, name, value, type = 'text', placeholder, required, disabled }: any) {
  return (
    <div>
      <label className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 block mb-1.5">{label}</label>
      <input name={name} type={type} placeholder={placeholder} required={required} disabled={disabled} defaultValue={value} className="w-full px-4 py-3 bg-white border border-[#0B1E3F]/15 rounded-xl focus:outline-none focus:border-[#0B1E3F] transition text-[#0B1E3F] placeholder:text-[#0B1E3F]/30 disabled:bg-[#0B1E3F]/5 disabled:text-[#0B1E3F]/60" />
    </div>
  );
}
