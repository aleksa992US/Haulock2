'use client';

import { useEffect, useState } from 'react';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase/client';

export default function ResetPasswordPage() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) { setError('Supabase is not configured.'); setReady(true); return; }
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    if (code) {
      sb.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (error) setError(error.message);
        setReady(true);
      });
    } else {
      sb.auth.getSession().then(({ data }) => {
        if (!data.session) setError('This reset link is invalid or has expired. Please request a new one.');
        setReady(true);
      });
    }
  }, []);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null); setInfo(null);
    const fd = new FormData(e.currentTarget);
    const password = String(fd.get('password') || '');
    const confirm = String(fd.get('confirm') || '');
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    const sb = getSupabase();
    if (!sb) { setError('Supabase is not configured.'); return; }
    setLoading(true);
    const { error } = await sb.auth.updateUser({ password });
    setLoading(false);
    if (error) { setError(error.message); return; }
    setInfo('Password updated. Redirecting…');
    setTimeout(() => { window.location.href = '/'; }, 1200);
  };

  return (
    <div className="min-h-screen bg-[#F5F3EE] flex items-center justify-center p-6 text-[#0B1E3F]">
      <div className="w-full max-w-md bg-white rounded-2xl border border-[#0B1E3F]/10 p-8 md:p-10 card-shadow">
        <div className="mb-6">
          <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-2">Haulock</div>
          <h1 className="text-3xl serif italic text-[#0B1E3F]">Set a new password</h1>
          <p className="text-[#0B1E3F]/60 mt-2 text-sm">Choose a strong password. At least 8 characters.</p>
        </div>
        {!ready ? (
          <div className="text-sm text-[#0B1E3F]/60">Verifying link…</div>
        ) : !isSupabaseConfigured() ? (
          <div className="text-sm text-[#DC2626]">Supabase is not configured.</div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 block mb-2">New password</label>
              <input name="password" type="password" placeholder="At least 8 characters" autoComplete="new-password" required className="w-full px-4 py-3 bg-white border border-[#0B1E3F]/15 rounded-xl focus:outline-none focus:border-[#0B1E3F] transition text-[#0B1E3F] placeholder:text-[#0B1E3F]/30" />
            </div>
            <div>
              <label className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 block mb-2">Confirm password</label>
              <input name="confirm" type="password" placeholder="Repeat password" autoComplete="new-password" required className="w-full px-4 py-3 bg-white border border-[#0B1E3F]/15 rounded-xl focus:outline-none focus:border-[#0B1E3F] transition text-[#0B1E3F] placeholder:text-[#0B1E3F]/30" />
            </div>
            {error && <div className="text-sm text-[#DC2626]">{error}</div>}
            {info && <div className="text-sm text-[#16A34A]">{info}</div>}
            <button type="submit" disabled={loading} className="w-full py-3.5 bg-[#0B1E3F] text-white rounded-full font-medium hover:bg-[#0B1E3F]/90 transition disabled:opacity-60">
              {loading ? 'Updating…' : 'Update password'}
            </button>
          </form>
        )}
        <div className="mt-6 text-sm text-[#0B1E3F]/60 text-center">
          <a href="/" className="text-[#0B1E3F] font-medium hover:underline">← Back to Haulock</a>
        </div>
      </div>
    </div>
  );
}
