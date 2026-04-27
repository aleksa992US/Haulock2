'use client';

import React, { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import {
  Shield, Search, AlertTriangle, CheckCircle2, XCircle, TrendingUp, FileText, Bell,
  Users, Settings, LogOut, ChevronRight, ArrowRight, Lock, Zap, Database, Eye, Flag,
  Clock, MapPin, Phone, Mail, Building2, Download, Share2, Plus, BarChart3, Menu,
  Command, ShieldCheck, Star, Quote, Radio, PlayCircle, Target,
  Facebook, Instagram, Linkedin, Twitter, Youtube, Globe, Trash2, Copy, Key, ScanLine, Sparkles, Upload,
  Truck, UserCheck, LifeBuoy, MessageSquare,
} from 'lucide-react';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase/client';
import { timeAgo } from '@/lib/timeago';
import { PLANS, getPlan, formatLimit } from '@/lib/plans';
import { useCachedFetch, invalidateCache } from '@/lib/data-cache';
import { BLOG_POSTS, type BlogPost } from '@/lib/blog-posts';
import { track, identify, trackPurchase } from '@/lib/analytics';

const APP_ROUTES = ['dashboard', 'verify', 'history', 'reports', 'watchlist', 'alerts', 'plan', 'settings', 'report', 'admin', 'support'];
const AUTH_ROUTES = ['login', 'signup', 'pricing'];
const PUBLIC_ROUTES = ['terms', 'privacy', 'blog', 'about'];
const ALL_ROUTES = [...APP_ROUTES, ...AUTH_ROUTES, ...PUBLIC_ROUTES, 'landing'];

function pathToRoute(pathname: string): string {
  const seg = (pathname || '/').split('/').filter(Boolean)[0] || 'landing';
  return ALL_ROUTES.includes(seg) ? seg : 'landing';
}

// Pull the second path segment for nested routes (only `/blog/<slug>` for now).
function pathToSlug(pathname: string): string | null {
  const parts = (pathname || '/').split('/').filter(Boolean);
  return parts.length >= 2 ? parts[1] : null;
}

function routeToPath(route: string, slug?: string | null): string {
  if (route === 'landing') return '/';
  if (route === 'blog' && slug) return `/blog/${slug}`;
  return `/${route}`;
}

// Stored when an unauthenticated user hits an app route via RequireAuth, so
// that login/signup (email or OAuth) bring them back to the page they wanted.
const POST_LOGIN_REDIRECT_KEY = 'haulock:postLoginRedirect';

function peekPostLoginRedirect(): string | null {
  if (typeof window === 'undefined') return null;
  try { return sessionStorage.getItem(POST_LOGIN_REDIRECT_KEY); } catch { return null; }
}

function consumePostLoginRedirect(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = sessionStorage.getItem(POST_LOGIN_REDIRECT_KEY);
    if (v) sessionStorage.removeItem(POST_LOGIN_REDIRECT_KEY);
    return v;
  } catch { return null; }
}

// Lazy-mount each page once and toggle visibility with display:none on subsequent navigations.
// Keeps state, scroll position, and avoids re-firing useEffect fetches on every tab switch.
function PageSlot({ routeId, current, children }: { routeId: string; current: string; children: React.ReactNode }) {
  const isActive = routeId === current;
  const [hasMounted, setHasMounted] = useState(isActive);
  useEffect(() => { if (isActive && !hasMounted) setHasMounted(true); }, [isActive, hasMounted]);
  if (!hasMounted) return null;
  return <div style={{ display: isActive ? 'block' : 'none' }}>{children}</div>;
}

function userFromSession(u: any): any {
  if (!u) return null;
  const meta = u.user_metadata || {};
  return {
    id: u.id,
    email: u.email,
    name: meta.full_name || meta.name || u.email?.split('@')[0] || 'Member',
    company: meta.company || '',
    mc: meta.mc || '',
    dot: meta.dot || '',
    // Default empty/missing plan to 'free' for the UI. The async
    // ensureDefaultPlan() effect persists the same value to user_metadata
    // so server-side reads (usage limits, billing) stay consistent.
    plan: meta.plan || 'free',
    planChangedAt: meta.plan_changed_at || null,
    stripeCustomerId: meta.stripe_customer_id || null,
    fleet_size: meta.fleet_size || 1,
    createdAt: u.created_at || null,
    notificationEmail: meta.notification_email || '',
    notifyHighRisk: meta.notify_high_risk !== false,
    notifyWatchlist: meta.notify_watchlist !== false,
    notifyWeeklyDigest: meta.notify_weekly_digest !== false,
    notifyCommunity: meta.notify_community !== false,
    notifyFraudTrends: meta.notify_fraud_trends !== false,
  };
}

export default function Haulock() {
  // usePathname is hydration-safe — same value on server and client for the initial request.
  // After the first render we drive `route` purely from local state via history.pushState.
  const initialPath = usePathname();
  const [route, setRoute] = useState<string>(() => pathToRoute(initialPath || '/'));
  // For nested routes (currently only /blog/[slug]) we keep the slug in
  // separate state. It is set by `navigate()` on internal nav and re-derived
  // from window.location on browser back/forward + first paint.
  const [blogSlug, setBlogSlug] = useState<string | null>(() => {
    if (typeof window === 'undefined') return pathToSlug(initialPath || '/');
    return pathToSlug(window.location.pathname);
  });
  useEffect(() => {
    const onPop = () => {
      setRoute(pathToRoute(window.location.pathname));
      setBlogSlug(pathToSlug(window.location.pathname));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const [user, setUser] = useState<any>(null);
  const [currentReport, setCurrentReport] = useState<any>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const s = sessionStorage.getItem('haulock:currentReport');
      return s ? JSON.parse(s) : null;
    } catch { return null; }
  });
  const persistReport = (r: any) => {
    setCurrentReport(r);
    if (typeof window !== 'undefined') {
      try { sessionStorage.setItem('haulock:currentReport', JSON.stringify(r)); } catch {}
    }
  };
  const [settingsTab, setSettingsTab] = useState<string>('profile');

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;

    // Email/password signup sets `plan: 'free'` during signUp(). Google
    // OAuth doesn't go through that path, so first-time OAuth users land
    // with no plan. Backfill it here so every authenticated user always
    // has a plan in metadata. Idempotent — only writes when missing.
    const ensureDefaultPlan = async (rawUser: any) => {
      const meta = (rawUser?.user_metadata || {}) as any;
      if (meta.plan) return rawUser;
      try {
        const { data: updated } = await sb.auth.updateUser({ data: { plan: 'free' } });
        return updated?.user || rawUser;
      } catch {
        // Non-fatal: the local user object will still treat empty plan as
        // free (see userFromSession's plan handling). Try again next load.
        return rawUser;
      }
    };

    // Record the auth provider Supabase actually accepted so the next
    // visit to /login can show a "Last used" badge next to the right
    // button. Driven from app_metadata.provider so it's always honest —
    // never written from the click handler (which would lie if the user
    // cancelled an OAuth flow).
    const recordAuthProvider = (rawUser: any) => {
      if (typeof window === 'undefined') return;
      const provider = String(rawUser?.app_metadata?.provider || '').toLowerCase();
      if (!provider) return;
      try { localStorage.setItem('haulock:lastAuthProvider', provider); } catch {}
    };

    // Read the local session synchronously from the cookie. getUser() makes
    // a network roundtrip and was holding the auth lock for 5s+ on slow
    // networks, blanking the UI as logged-out right after Google sign-in.
    sb.auth.getSession().then(async ({ data, error }) => {
      console.log('[haulock-auth] getSession result', { hasUser: !!data?.session?.user, error: error?.message, cookies: typeof document !== 'undefined' ? document.cookie.split(';').map(c => c.trim().split('=')[0]).filter(n => n.startsWith('sb-')) : [] });
      const sessionUser = data?.session?.user;
      if (!sessionUser) return;
      recordAuthProvider(sessionUser);
      const ensured = await ensureDefaultPlan(sessionUser);
      const u = userFromSession(ensured);
      identify(ensured.id);
      setUser(u);
      const r = typeof window !== 'undefined' ? pathToRoute(window.location.pathname) : 'landing';
      if (r === 'landing' || r === 'login' || r === 'signup') {
        // If they were sent to /login from a gated page, honor that target
        // rather than the default dashboard landing.
        const redirect = consumePostLoginRedirect();
        const target = redirect ? pathToRoute(redirect) : 'dashboard';
        if (typeof window !== 'undefined') window.history.replaceState({}, '', routeToPath(target));
        setRoute(target);
      } else {
        // We landed directly on the gated page (e.g. via the OAuth callback's
        // ?next=). The redirect cookie is no longer needed.
        consumePostLoginRedirect();
      }
    });
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      console.log('[haulock-auth] onAuthStateChange', { event: _event, hasUser: !!session?.user });
      if (session?.user) {
        // CRITICAL: do NOT await any Supabase calls inside this callback.
        // The auth client holds an internal lock during onAuthStateChange,
        // and calling sb.auth.* (e.g. updateUser inside ensureDefaultPlan)
        // synchronously deadlocks — the callback never resumes, setUser
        // never fires, and the UI is stuck on RequireAuth even though we
        // logged hasUser: true. Set the user immediately from the session,
        // then defer side-effects with setTimeout.
        recordAuthProvider(session.user);
        identify(session.user.id);
        setUser(userFromSession(session.user));
        if (_event === 'SIGNED_IN' && typeof window !== 'undefined') {
          const r = pathToRoute(window.location.pathname);
          if (r === 'landing' || r === 'login' || r === 'signup') {
            const redirect = consumePostLoginRedirect();
            const target = redirect ? pathToRoute(redirect) : 'dashboard';
            window.history.replaceState({}, '', routeToPath(target));
            setRoute(target);
          } else {
            consumePostLoginRedirect();
          }
        }
        // Backfill plan + analytics off the auth thread so we never block
        // the UI render or deadlock the auth client.
        setTimeout(async () => {
          try {
            const ensured = await ensureDefaultPlan(session.user);
            if (_event === 'SIGNED_IN') {
              const createdAt = ensured.created_at ? new Date(ensured.created_at).getTime() : 0;
              const isFresh = createdAt > 0 && Date.now() - createdAt < 30_000;
              const provider = String((ensured.app_metadata as any)?.provider || 'email').toLowerCase();
              if (isFresh) track('signup_complete', { provider });
              else track('login', { provider });
            }
            // Refresh local user with the ensured-plan version.
            setUser(userFromSession(ensured));
          } catch (e) {
            console.warn('[haulock-auth] post-signin backfill failed', e);
          }
        }, 0);
      } else {
        if (_event === 'SIGNED_OUT') track('logout');
        identify(null);
        setUser(null);
      }
    });
    return () => { sub.subscription.unsubscribe(); };
  }, []);

  const loginAs = () => {
    setUser({
      name: 'Marcus Reynolds',
      email: 'marcus@reynoldstrucking.com',
      company: 'Reynolds Trucking LLC',
      mc: '847291',
      plan: '',
      fleet_size: 12,
    });
    navigate('plan');
  };
  const logout = async () => {
    const sb = getSupabase();
    if (sb) await sb.auth.signOut();
    setUser(null);
    navigate('landing');
  };
  const setPlan = async (plan: string) => {
    const sb = getSupabase();
    if (sb) {
      const { data, error } = await sb.auth.updateUser({ data: { plan, plan_changed_at: new Date().toISOString() } });
      if (!error && data.user) setUser(userFromSession(data.user));
      // Mirror the plan to the team (auto-creates a team for the owner if missing).
      fetch('/api/team/sync-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      }).then(() => invalidateCache('usage', 'team')).catch(() => {});
    } else {
      setUser((u: any) => u ? { ...u, plan } : u);
    }
    navigate('dashboard');
  };
  const navigate = (to: string, data?: any) => {
    if (to === 'report' && data) persistReport(data);
    if (to === 'settings' && data?.tab) setSettingsTab(data.tab);
    // VerifyTool reads this from sessionStorage on mount so deep-linking to
    // a specific tab (e.g. footer "Rate con analyzer") works without
    // plumbing yet another state through the tree.
    if (to === 'verify' && data?.tab && typeof window !== 'undefined') {
      try { sessionStorage.setItem('haulock:verifyTab', data.tab); } catch {}
    }
    if (to === 'landing' && data?.scrollTo && typeof window !== 'undefined') {
      try { sessionStorage.setItem('haulock:landingScrollTo', data.scrollTo); } catch {}
    }
    const slug = to === 'blog' ? (data?.slug ?? null) : null;
    if (to === 'blog') setBlogSlug(slug);
    const path = routeToPath(to, slug);
    if (typeof window !== 'undefined' && window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
    setRoute(to);
    if (typeof window !== 'undefined') window.scrollTo(0, 0);
  };

  return (
    <div className="min-h-screen bg-[#F5F3EE] text-[#0B1E3F]">
      {route === 'landing' && <Landing navigate={navigate} user={user} />}
      {route === 'login' && <Login navigate={navigate} loginAs={loginAs} />}
      {route === 'signup' && <Signup navigate={navigate} loginAs={loginAs} />}
      {route === 'pricing' && <Pricing navigate={navigate} user={user} />}
      {route === 'terms' && <LegalPage page="terms" navigate={navigate} user={user} />}
      {route === 'privacy' && <LegalPage page="privacy" navigate={navigate} user={user} />}
      {route === 'blog' && <BlogPage slug={blogSlug} navigate={navigate} user={user} />}
      {route === 'about' && <AboutPage navigate={navigate} user={user} />}
      {!user && APP_ROUTES.includes(route) && (
        <RequireAuth navigate={navigate} />
      )}
      {user && APP_ROUTES.includes(route) && (
        <AppShell user={user} route={route} navigate={navigate} logout={logout}>
          <PageSlot routeId="dashboard" current={route}><Dashboard navigate={navigate} user={user} /></PageSlot>
          <PageSlot routeId="verify" current={route}><VerifyTool navigate={navigate} /></PageSlot>
          <PageSlot routeId="report" current={route}><Report report={currentReport} navigate={navigate} /></PageSlot>
          <PageSlot routeId="reports" current={route}><FraudReports navigate={navigate} /></PageSlot>
          <PageSlot routeId="watchlist" current={route}><Watchlist navigate={navigate} /></PageSlot>
          <PageSlot routeId="support" current={route}><SupportPage user={user} /></PageSlot>
          <PageSlot routeId="alerts" current={route}><Alerts navigate={navigate} /></PageSlot>
          <PageSlot routeId="settings" current={route}><SettingsPage user={user} navigate={navigate} initialTab={settingsTab} /></PageSlot>
          <PageSlot routeId="plan" current={route}><Plan user={user} setPlan={setPlan} /></PageSlot>
          <PageSlot routeId="history" current={route}><SearchHistory navigate={navigate} /></PageSlot>
          <PageSlot routeId="admin" current={route}><AdminPage navigate={navigate} /></PageSlot>
        </AppShell>
      )}
    </div>
  );
}

type LandingTickerItem = { id: string; verdict: string; color: string; entity: string };
type LandingFeaturedFlag = {
  sev: 'critical' | 'warning' | 'info' | string;
  title: string;
  desc?: string;
  pts?: number;
};
type LandingFeaturedScan = {
  name: string;
  mc: string | null;
  dot: string | null;
  score: number;
  verdict: 'high' | 'medium' | 'low' | string;
  entity: string;
  flagCount: number;
  flags: LandingFeaturedFlag[];
  scannedAt: string;
} | null;
type LandingStats = {
  stats: { totalVerifications: number; totalFraudReports: number; activeFmcsaFlags: number };
  ticker: LandingTickerItem[];
  featuredScan: LandingFeaturedScan;
};

function useLandingStats(): LandingStats | null {
  const [data, setData] = useState<LandingStats | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/landing-stats')
      .then((r) => r.ok ? r.json() : null)
      .then((j) => { if (!cancelled && j) setData(j); })
      .catch(() => { /* leave null — UI shows graceful fallback */ });
    return () => { cancelled = true; };
  }, []);
  return data;
}

// Brave / search-engine snippets often contain bolding markup and HTML
// entities. Render them as plain text so the user doesn't see raw
// "<strong>" or "&amp;" inline. We DON'T use dangerouslySetInnerHTML
// because the snippet is third-party content and we never want a
// hostile-snippet XSS vector.
function cleanSearchSnippet(s: string): string {
  return String(s || '')
    .replace(/<\/?[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 10_000)   return `${(n / 1_000).toFixed(0)}K`;
  if (n >= 1_000)    return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

function Landing({ navigate, user }: any) {
  const live = useLandingStats();
  // Footer / Nav can deep-link into a Landing section via
  // navigate('landing', { scrollTo: 'product' }). We pop the target id off
  // sessionStorage on mount and smooth-scroll to it once.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let target: string | null = null;
    try { target = sessionStorage.getItem('haulock:landingScrollTo'); } catch {}
    if (!target) return;
    try { sessionStorage.removeItem('haulock:landingScrollTo'); } catch {}
    // Wait one paint so the section is in the DOM.
    setTimeout(() => {
      const el = document.getElementById(target!);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }, []);
  return (
    <div className="min-h-screen bg-[#F5F3EE] text-[#0B1E3F]">
      <Nav navigate={navigate} user={user} />

      <section className="relative overflow-hidden pt-12 pb-24 text-[#0B1E3F]">
        <div className="absolute inset-0 radial-glow pointer-events-none" />
        <div className="absolute inset-0 grid-bg opacity-40" />
        <div className="relative max-w-7xl mx-auto px-6 grid lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-6 pt-8">
            <div className="fade-up fade-up-1 inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-[#0B1E3F]/10 rounded-full text-xs mono uppercase tracking-wider text-[#0B1E3F] mb-8 card-shadow">
              <span className="relative flex w-2 h-2">
                <span className="absolute inline-flex w-full h-full bg-[#FF6B35] rounded-full opacity-75 animate-ping" />
                <span className="relative inline-flex w-2 h-2 bg-[#FF6B35] rounded-full" />
              </span>
              Freight fraud up 340% since 2023
            </div>
            <h1 className="fade-up fade-up-2 text-5xl md:text-6xl lg:text-7xl leading-[0.95] tracking-tight text-[#0B1E3F] mb-6">
              Know who&apos;s on the <span className="serif italic">other end</span> of the rate con.
            </h1>
            <p className="fade-up fade-up-3 text-lg md:text-xl text-[#0B1E3F]/70 max-w-xl mb-10 leading-relaxed">
              Verify any broker or carrier in seconds. Cross-checks FMCSA, the company website, social presence, and Google Business listing — catching double-brokers, ghost MCs, and spoofed identities before you hook the trailer or hand off the load.
            </p>
            <div className="fade-up fade-up-4 flex flex-col sm:flex-row gap-3 mb-12">
              <button onClick={() => navigate('signup')} className="group px-7 py-4 bg-[#0B1E3F] text-white text-base font-medium rounded-full hover:bg-[#0B1E3F]/90 transition flex items-center justify-center gap-2 card-shadow-lg">
                Check any broker or carrier free <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition" />
              </button>
              <button className="group px-7 py-4 border border-[#0B1E3F]/20 bg-white text-[#0B1E3F] text-base font-medium rounded-full hover:bg-[#0B1E3F]/5 transition flex items-center justify-center gap-2">
                <PlayCircle className="w-4 h-4" /> Watch 60-sec demo
              </button>
            </div>
            <div className="fade-up fade-up-5 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-[#0B1E3F]/60">
              <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-[#16A34A]" /> Official FMCSA data</div>
              <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-[#16A34A]" /> 4,200+ carriers & brokers</div>
              <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-[#16A34A]" /> No credit card</div>
            </div>
          </div>
          <div className="lg:col-span-6 fade-up fade-up-3 relative">
            <HeroDashboardMockup featured={live?.featuredScan ?? null} />
          </div>
        </div>
      </section>

      <section className="border-y border-[#0B1E3F]/10 bg-white overflow-hidden py-5 text-[#0B1E3F]">
        <div className="flex gap-16 ticker whitespace-nowrap">
          {(() => {
            // Real recent verdicts from /api/landing-stats. The verdict on
            // each row was scored at lookup time using the broker-vs-carrier
            // rules in lib/risk.ts, so it's already entity-aware. We display
            // the entity badge (BROKER / CARRIER / BROKER+CARRIER) alongside
            // so the ticker reflects the same logic the dashboard uses.
            const items: LandingTickerItem[] = (live?.ticker?.length ?? 0) > 0
              ? live!.ticker
              : [
                  { id: 'MC-847•••', verdict: 'HIGH RISK', color: '#DC2626', entity: 'BROKER' },
                  { id: 'MC-226•••', verdict: 'VERIFIED',  color: '#16A34A', entity: 'CARRIER' },
                  { id: 'MC-498•••', verdict: 'CAUTION',   color: '#F59E0B', entity: 'BROKER' },
                ];
            return [...Array(2)].map((_, round) => (
              <div key={round} className="flex gap-16 items-center">
                {items.map((item, i) => (
                  <div key={`${round}-${i}`} className="flex items-center gap-3 text-sm shrink-0">
                    <span className="mono" style={{ color: 'rgba(11,30,63,0.6)' }}>{item.id}</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] mono uppercase tracking-wider" style={{ background: 'rgba(11,30,63,0.06)', color: 'rgba(11,30,63,0.65)' }}>{item.entity}</span>
                    <span className="mono font-semibold" style={{ color: item.color }}>{item.verdict}</span>
                    <span style={{ color: 'rgba(11,30,63,0.3)' }}>·</span>
                  </div>
                ))}
              </div>
            ));
          })()}
        </div>
      </section>

      <section className="py-20 px-6 bg-[#F5F3EE] text-[#0B1E3F]">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12 max-w-2xl mx-auto">
            <div className="text-xs mono uppercase tracking-[0.2em] text-[#FF6B35] mb-4">— Who it&apos;s for</div>
            <h2 className="text-3xl md:text-5xl leading-tight text-[#0B1E3F]">
              One platform. <span className="serif italic">Three sides of the load.</span>
            </h2>
            <p className="text-[#0B1E3F]/65 mt-4">Brokers, carriers, and drivers all lose money to the same scams. We catch them on whichever side you&rsquo;re standing.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            <RoleCard
              icon={Building2}
              accent="#0B1E3F"
              role="Brokers"
              tagline="Verify carriers before you tender."
              points={[
                'Live FMCSA authority, insurance, surety bond, safety rating, BASIC scores, and 24-month inspections.',
                'Lookalike-domain detection on every carrier email so you spot the impersonator using a real MC.',
                'Community fraud reports from other brokers, plus chameleon-network detection on shared phones and addresses.',
              ]}
              cta="Start verifying carriers"
              onClick={() => navigate('signup')}
            />
            <RoleCard
              icon={Truck}
              accent="#FF6B35"
              role="Carriers"
              tagline="Verify brokers before you hook the trailer."
              points={[
                'MC, DOT, surety bond, address, and website cross-checked in 2.1 seconds.',
                'Drop the rate confirmation PDF: AI extracts the broker, scores it for fraud language, flags spoofed identities.',
                'Watchlist auto-rescans every 24 hours and emails you the moment something changes.',
              ]}
              cta="Verify any broker free"
              onClick={() => navigate('signup')}
            />
            <RoleCard
              icon={UserCheck}
              accent="#16A34A"
              role="Drivers & dispatchers"
              tagline="Make sure no one shaved the rate."
              points={[
                'Drop the rate con PDF. We read the hidden metadata and flag if it was edited after the broker sent it.',
                'See exactly which tool touched the file and when. iLovePDF + a 3-day gap is a red flag every time.',
                'Free to check. No credit card. 3 PDF scans and 3 broker lookups every month, on us.',
              ]}
              cta="Check a rate con free"
              onClick={() => navigate('signup')}
            />
          </div>
        </div>
      </section>

      <section className="py-20 px-6 bg-[#F5F3EE] text-[#0B1E3F] border-t border-[#0B1E3F]/10">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <BigStat value="$47M" label="prevented fraud losses" />
            <BigStat value="4,247" label="carriers, brokers & drivers" />
            <BigStat value="287K" label="verifications / month" />
            <BigStat value="94%" label="fraud detection rate" />
          </div>
        </div>
      </section>

      <section className="py-24 px-6 bg-[#0B1E3F] relative overflow-hidden">
        <div className="absolute inset-0 grid-bg-dark opacity-60" />
        <div className="relative max-w-7xl mx-auto">
          <div className="mb-16 max-w-3xl">
            <div className="text-xs mono uppercase tracking-[0.2em] text-[#FF6B35] mb-4">— In the wild</div>
            <h2 className="text-4xl md:text-6xl leading-[1.05] mb-6 text-white">
              A real rate con. A real scam. <span className="serif italic text-[#FF6B35]">Caught in 2.1 seconds.</span>
            </h2>
            <p className="text-white/70 text-lg max-w-2xl">
              This is what Haulock catches that the naked eye misses. Legit letterhead, real-looking MC, but four red flags buried in the data.
            </p>
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <RateConMockup />

            <InTheWildCard featured={live?.featuredScan ?? null} />
          </div>
        </div>
      </section>

      <section id="product" className="py-24 px-6 bg-[#F5F3EE] text-[#0B1E3F] scroll-mt-20">
        <div className="max-w-7xl mx-auto">
          <div className="mb-16 max-w-2xl">
            <div className="text-xs mono uppercase tracking-[0.2em] text-[#FF6B35] mb-4">— What we check</div>
            <h2 className="text-4xl md:text-5xl leading-tight text-[#0B1E3F]">
              Built for carriers and brokers who&apos;ve already <span className="serif italic">been burned.</span>
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            <FeatureCard icon={Search} iconBg="#0B1E3F" title="FMCSA verification" desc="Paste an MC, DOT, or company name. Get authority status, age, insurance on file, safety rating, and crash history — pulled live from the federal registry." stat="2.1s" statLabel="avg. lookup time" />
            <FeatureCard icon={Globe} iconBg="#FF6B35" title="Website & domain check" desc="We find the counterparty's real website, check WHOIS age, MX and SPF records, and Google Safe Browsing. A domain registered last week is an immediate red flag." stat="WHOIS" statLabel="live domain lookup" />
            <FeatureCard icon={Users} iconBg="#16A34A" title="Social media footprint" desc="Scans Facebook, LinkedIn, Twitter/X, Instagram, YouTube, and TikTok for the company's presence. Real companies leave a trail. Ghost identities don't." stat="6" statLabel="platforms matched" />
            <FeatureCard icon={MapPin} iconBg="#0B1E3F" title="Google Business address" desc="Cross-checks the FMCSA-registered address against Google Places. Flags UPS Store mailboxes, residential homes, and addresses shared by unrelated businesses." stat="Places" statLabel="real-world match" />
            <FeatureCard icon={FileText} iconBg="#FF6B35" title="Rate con analyzer" desc="Drop a PDF. We extract the broker, verify the email domain against the registered MC, and flag spoofed letterheads and impersonated identities automatically." stat="94%" statLabel="fraud detection rate" />
            <FeatureCard icon={Radio} iconBg="#16A34A" title="Community fraud network" desc="Real-time feed of scams reported by other carriers and brokers. Get alerted the moment a counterparty on your watchlist is flagged by someone in the network." stat="4,200+" statLabel="verified reports" />
          </div>
        </div>
      </section>

      <section className="py-24 px-6 border-t border-[#0B1E3F]/10 bg-[#F5F3EE] text-[#0B1E3F]">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-start">
            <div className="lg:sticky lg:top-24 text-[#0B1E3F]">
              <div className="text-xs mono uppercase tracking-[0.2em] text-[#FF6B35] mb-4">— How it works</div>
              <h2 className="text-4xl md:text-5xl serif italic leading-tight text-[#0B1E3F] mb-6">Rate con to verdict in three seconds.</h2>
              <p className="text-[#0B1E3F]/60 text-lg">Haulock pulls from 14 data sources at once. No screens to navigate, no spreadsheets to cross-reference.</p>
            </div>
            <div className="space-y-4">
              {[
                { n: '01', icon: Zap, title: 'Enter MC, DOT, company name, or drop a rate con', desc: 'Works with any identifier — for a broker or a carrier. Type it, paste it, or drop a PDF. Upload works from your phone in the cab or the desk.' },
                { n: '02', icon: Database, title: 'We cross-check 14 data sources', desc: 'FMCSA authority & insurance, company website, domain WHOIS, social profiles across 6 platforms, Google Business address, community reports, and more.' },
                { n: '03', icon: Target, title: 'Get a score and a clear verdict', desc: 'Plain English. No jargon. "Book this load" or "Walk away." Share with your dispatcher or ops team in one click.' },
              ].map((step, i) => (
                <div key={i} className="group bg-white border border-[#0B1E3F]/10 rounded-2xl p-7 hover:border-[#0B1E3F]/20 transition card-shadow text-[#0B1E3F]">
                  <div className="flex items-start gap-5">
                    <div className="flex-shrink-0 w-12 h-12 bg-[#0B1E3F] rounded-xl flex items-center justify-center group-hover:bg-[#FF6B35] transition">
                      <step.icon className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1">
                      <div className="mono text-xs text-[#FF6B35] mb-2">STEP {step.n}</div>
                      <div className="text-xl font-semibold text-[#0B1E3F] mb-2">{step.title}</div>
                      <div className="text-[#0B1E3F]/60 leading-relaxed">{step.desc}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="py-24 px-6 bg-[#F5F3EE] border-t border-[#0B1E3F]/10 text-[#0B1E3F]">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-start">
            <div className="lg:sticky lg:top-24">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#16A34A]/10 text-[#16A34A] text-xs mono uppercase tracking-[0.2em] rounded-full mb-5">
                For drivers · 3 free scans / month
              </div>
              <h2 className="text-4xl md:text-5xl leading-[1.05] mb-6 text-[#0B1E3F]">
                For drivers: <span className="serif italic">check the rate con</span> before you sign for it.
              </h2>
              <p className="text-[#0B1E3F]/70 text-lg mb-6 leading-relaxed">
                It happens more than you think. A dispatcher gets a $1,400 rate con from a broker, downloads it, opens it in a free online PDF editor, changes the number to $1,100, and forwards it to the driver. You haul the load thinking the rate is $1,100 and the dispatcher pockets the $300 spread.
              </p>
              <p className="text-[#0B1E3F]/70 text-lg mb-6 leading-relaxed">
                Every PDF contains <strong className="text-[#0B1E3F]">hidden metadata</strong> about who made it, when it was made, and every tool that touched it. Haulock reads that metadata and tells you the truth in plain English:
              </p>
              <ul className="space-y-3 mb-8 text-[#0B1E3F]/80">
                <li className="flex items-start gap-3"><div className="w-1.5 h-1.5 rounded-full bg-[#DC2626] flex-shrink-0 mt-2" /><span>&ldquo;This PDF was edited 3 days after it was created — by iLovePDF.&rdquo;</span></li>
                <li className="flex items-start gap-3"><div className="w-1.5 h-1.5 rounded-full bg-[#DC2626] flex-shrink-0 mt-2" /><span>&ldquo;Author name &lsquo;Mike&rsquo; doesn&apos;t match the broker&apos;s name on the letterhead.&rdquo;</span></li>
                <li className="flex items-start gap-3"><div className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] flex-shrink-0 mt-2" /><span>&ldquo;All metadata stripped — someone hid what tool they used.&rdquo;</span></li>
                <li className="flex items-start gap-3"><div className="w-1.5 h-1.5 rounded-full bg-[#16A34A] flex-shrink-0 mt-2" /><span>&ldquo;Clean. Created by Microsoft Word, unmodified since.&rdquo;</span></li>
              </ul>
              <div className="flex flex-col sm:flex-row gap-3">
                <button onClick={() => navigate('signup')} className="px-6 py-3.5 bg-[#0B1E3F] text-white rounded-full font-medium hover:bg-[#0B1E3F]/90 transition inline-flex items-center justify-center gap-2">
                  Sign up free & check a PDF <ArrowRight className="w-4 h-4" />
                </button>
                <div className="text-xs text-[#0B1E3F]/55 self-center">3 scans/month on Free · unlimited on any paid plan</div>
              </div>
            </div>

            {/* Forensic mockup card */}
            <div className="bg-white rounded-3xl p-7 card-shadow-lg border border-[#0B1E3F]/10">
              <div className="flex items-center justify-between pb-4 mb-4 border-b border-[#0B1E3F]/10">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 bg-[#DC2626]/10 rounded-lg flex items-center justify-center">
                    <FileText className="w-5 h-5 text-[#DC2626]" />
                  </div>
                  <div>
                    <div className="font-semibold text-[#0B1E3F]">rate-con-load-4821.pdf</div>
                    <div className="text-[11px] mono text-[#0B1E3F]/50">2 pages · 98 KB</div>
                  </div>
                </div>
                <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#DC2626]/10 rounded-full text-xs mono uppercase tracking-wider font-semibold text-[#DC2626]">
                  Likely tampered · 72
                </div>
              </div>
              <div className="space-y-2.5 mb-5">
                <div className="flex items-start gap-3 p-3 bg-[#DC2626]/5 border border-[#DC2626]/15 rounded-lg">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-[#DC2626]" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-[#0B1E3F]">PDF edited 12 days after creation</div>
                    <div className="text-xs text-[#0B1E3F]/60 mt-0.5">Original: Apr 2, 2026 · Last saved: Apr 14, 2026</div>
                  </div>
                  <div className="text-xs mono text-[#0B1E3F]/40">+35</div>
                </div>
                <div className="flex items-start gap-3 p-3 bg-[#DC2626]/5 border border-[#DC2626]/15 rounded-lg">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-[#DC2626]" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-[#0B1E3F]">Processed with &ldquo;iLovePDF&rdquo;</div>
                    <div className="text-xs text-[#0B1E3F]/60 mt-0.5">Free online PDF editor — not what real brokers use</div>
                  </div>
                  <div className="text-xs mono text-[#0B1E3F]/40">+40</div>
                </div>
                <div className="flex items-start gap-3 p-3 bg-[#F59E0B]/5 border border-[#F59E0B]/15 rounded-lg">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-[#F59E0B]" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-[#0B1E3F]">Author: &ldquo;Mike K.&rdquo;</div>
                    <div className="text-xs text-[#0B1E3F]/60 mt-0.5">Cross-check against the broker&apos;s known contacts</div>
                  </div>
                  <div className="text-xs mono text-[#0B1E3F]/40">+10</div>
                </div>
              </div>
              <div className="pt-4 border-t border-[#0B1E3F]/10 grid grid-cols-2 gap-2 text-[11px] mono">
                <div>
                  <div className="text-[#0B1E3F]/50 uppercase tracking-wider">Creator</div>
                  <div className="text-[#0B1E3F]">Microsoft Word</div>
                </div>
                <div>
                  <div className="text-[#0B1E3F]/50 uppercase tracking-wider">Producer</div>
                  <div className="text-[#DC2626]">iLovePDF</div>
                </div>
                <div>
                  <div className="text-[#0B1E3F]/50 uppercase tracking-wider">Created</div>
                  <div className="text-[#0B1E3F]">Apr 2, 2026 · 09:41</div>
                </div>
                <div>
                  <div className="text-[#0B1E3F]/50 uppercase tracking-wider">Modified</div>
                  <div className="text-[#DC2626]">Apr 14, 2026 · 22:18</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-24 px-6 bg-[#0B1E3F] relative overflow-hidden">
        <div className="absolute inset-0 grid-bg-dark opacity-40" />
        <div className="relative max-w-7xl mx-auto">
          <div className="mb-16 max-w-3xl">
            <div className="text-xs mono uppercase tracking-[0.2em] text-[#FF6B35] mb-4">— Trust & security</div>
            <h2 className="text-4xl md:text-6xl leading-[1.05] text-white mb-6">
              Built on official data. <span className="serif italic text-[#FF6B35]">Zero retention.</span>
            </h2>
            <p className="text-white/70 text-lg max-w-2xl">
              Every lookup hits the source of truth. Every rate con you upload is processed in memory and gone within seconds. Your documents never live on our disks.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {[
              {
                icon: Database,
                tag: 'Official FMCSA API',
                title: 'Pulled live, never guessed.',
                desc: 'Authority status, insurance, and inspection history come straight from the FMCSA — the federal source brokers and DOT auditors use. No scraped caches, no stale snapshots.',
                stat: 'Live',
                statLabel: 'sub-second pulls',
              },
              {
                icon: Zap,
                tag: 'AI rate-con analyzer',
                title: 'Reads the PDF like a dispatcher would.',
                desc: 'Our model extracts the broker, MC, and contact details from any rate con. Then it cross-checks the email domain against the registered MC and flags spoofed identities automatically.',
                stat: '94%',
                statLabel: 'fraud detection rate',
              },
              {
                icon: Lock,
                tag: 'Zero retention',
                title: 'Your rate cons are never stored.',
                desc: 'PDFs are processed in memory and discarded within 60 seconds. We never write them to disk, never sell them, and never train models on your documents. Ever.',
                stat: '0 bytes',
                statLabel: 'stored after scan',
              },
            ].map((p, i) => (
              <div key={i} className="bg-white/[0.04] border border-white/10 rounded-2xl p-7 hover:border-white/20 transition flex flex-col">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-11 h-11 rounded-xl bg-[#FF6B35] flex items-center justify-center flex-shrink-0">
                    <p.icon className="w-5 h-5 text-white" />
                  </div>
                  <div className="mono text-xs uppercase tracking-wider text-white/50">{p.tag}</div>
                </div>
                <div className="text-2xl font-semibold text-white mb-3 leading-tight">{p.title}</div>
                <div className="text-white/60 leading-relaxed flex-1 mb-6">{p.desc}</div>
                <div className="pt-5 border-t border-white/10 flex items-baseline gap-2">
                  <span className="text-2xl font-semibold text-[#FF6B35] mono">{p.stat}</span>
                  <span className="text-xs text-white/50">{p.statLabel}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-white/60">
            <span className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-[#16A34A]" /> SOC 2 Type II</span>
            <span className="flex items-center gap-2"><Lock className="w-4 h-4 text-[#16A34A]" /> TLS 1.3 in transit</span>
            <span className="flex items-center gap-2"><Eye className="w-4 h-4 text-[#16A34A]" /> No third-party trackers</span>
            <span className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-[#16A34A]" /> FMCSA authorized</span>
          </div>
        </div>
      </section>

      <section className="border-y border-[#0B1E3F]/10 bg-white py-8 text-[#0B1E3F]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-xs mono uppercase tracking-[0.2em] text-[#0B1E3F]/50 mb-5 text-center">— 14 data sources, cross-checked in 2.1 seconds</div>
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-3">
            {[
              'FMCSA SAFER', 'L&I authority status', 'MCS-150 filings', 'Insurance filings', 'Crash & inspection history',
              'Authority history', 'Company website', 'Domain WHOIS', 'DNS (MX / SPF)', 'Google Safe Browsing',
              'Google Business address', 'Social profiles (6 platforms)', 'Disposable email registry', 'Community fraud feed',
            ].map((src, i) => (
              <span key={i} className="px-3 py-1.5 bg-[#F5F3EE] border border-[#0B1E3F]/10 rounded-full text-xs mono text-[#0B1E3F]/70">
                {src}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 px-6 bg-[#F5F3EE] border-t border-[#0B1E3F]/10 text-[#0B1E3F]">
        <div className="max-w-7xl mx-auto">
          <div className="mb-16 text-center max-w-3xl mx-auto text-[#0B1E3F]">
            <div className="text-xs mono uppercase tracking-[0.2em] text-[#FF6B35] mb-4">— What carriers say</div>
            <h2 className="text-4xl md:text-5xl leading-tight text-[#0B1E3F]">
              Carriers don&apos;t love <span className="serif italic">most software.</span> They love this.
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            <Testimonial quote="Haulock caught a double-broker scam before I hooked the trailer. Saved me $8,400 on a single load." name="Jamie T." role="Owner-operator" location="Kansas City, MO" initials="JT" bg="#FF6B35" />
            <Testimonial quote="I verify every broker now. Used to take 20 minutes of Googling. Now it's 3 seconds. Worth every penny." name="Dee Washington" role="Dispatcher, 14 trucks" location="Atlanta, GA" initials="DW" bg="#0B1E3F" />
            <Testimonial quote="Got a scam alert on a broker on my watchlist at 11pm. Cancelled the load next morning. Paid for a full year in one night." name="Carlos M." role="Owner, Reynolds Transport" location="Phoenix, AZ" initials="CM" bg="#16A34A" />
          </div>
        </div>
      </section>

      <section id="pricing" className="py-24 px-6 bg-[#0B1E3F] relative overflow-hidden scroll-mt-20">
        <div className="absolute inset-0 grid-bg-dark opacity-50" />
        <div className="relative max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <div className="text-xs mono uppercase tracking-[0.2em] text-[#FF6B35] mb-4">— Pricing</div>
            <h2 className="text-4xl md:text-6xl serif italic leading-tight text-white">One prevented scam pays for 3 years.</h2>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5 max-w-7xl mx-auto">
            {Object.values(PLANS).map((p) => (
              <PriceCard key={p.id} tier={p.label} price={p.price} annual={p.priceAnnual} cta={p.id === 'free' ? 'Start free' : `Choose ${p.label}`} desc={p.desc} popular={p.popular} features={p.features} onClick={() => navigate('signup')} />
            ))}
          </div>
          <div className="text-center mt-6 text-white/55 text-xs mono">All paid plans: monthly or annual (save 2 months). Cancel anytime.</div>
        </div>
      </section>

      <section id="resources" className="py-24 px-6 bg-[#F5F3EE] text-[#0B1E3F] scroll-mt-20">
        <div className="max-w-4xl mx-auto">
          <div className="mb-12 text-center">
            <div className="text-xs mono uppercase tracking-[0.2em] text-[#FF6B35] mb-4">— FAQ</div>
            <h2 className="text-4xl md:text-5xl serif italic text-[#0B1E3F]">Questions, answered.</h2>
          </div>
          <div className="space-y-3">
            {[
              { q: 'Where does Haulock get its data?', a: 'Live from the official FMCSA SAFER, L&I, and SMS systems for authority, insurance, surety bond, safety rating, BASIC scores, 24-month inspections, and crash history. Plus WHOIS and DNS for domain age, MX provider, and DMARC. Google Places for physical address verification. Google Safe Browsing for known threat domains. Brave Search for web reputation across 50+ trusted news outlets. And a community-reported fraud network with 4,200+ verified carriers and brokers.' },
              { q: 'How is this different from Carrier411 or DAT CarrierWatch?', a: 'Most tools vet in one direction: brokers checking carriers. Haulock works both ways. Carriers verify brokers, brokers verify carriers, and either side can verify shippers. We also catch things those tools do not, like lookalike domains, chameleon-network shared phone numbers, AI-driven rate confirmation analysis, and identity-history snapshots that show when a carrier quietly changed their address or phone.' },
              { q: 'Can I drop a rate confirmation PDF and have it analyzed?', a: 'Yes. Upload any rate con PDF and Haulock runs it through OCR, then through Claude AI to extract the broker, carrier, load, and rate. The same scan checks the broker email domain against their FMCSA-registered website, looks for spoofed lookalike domains, scores the document for fraud language patterns, and pulls a full broker risk report. Most rate cons are scored in about 3 seconds.' },
              { q: 'Do you have driver-side checks for inspections and crashes?', a: 'Yes. Every report pulls 24 months of FMCSA SMS inspection data: total inspections, vehicle and driver out-of-service rates, BASIC score percentiles across all seven safety BASICs, plus the crash count broken down by fatal, injury, and tow-away. So whether you are vetting a broker before booking or a carrier before dispatching, you see the actual safety history, not just the marketing.' },
              { q: 'What checks run on every lookup?', a: 'Up to 14 sources in parallel: FMCSA SAFER (authority, address, MCS-150), FMCSA L&I (insurance and surety bond), FMCSA SMS (BASICs, inspections, crashes), MC name lookup, snapshot history, our Day-1 archive, our community fraud reports, lookalike-domain detection, cross-reference scan for shared phones and addresses, web reputation across major news outlets, Google Places address match, Google Safe Browsing domain check, WHOIS and DNS, and email infrastructure (MX, SPF, DMARC).' },
              { q: 'Does it work for freight brokers?', a: 'Yes. Haulock is bidirectional. Brokers use it to verify carriers before dispatching a load, to vet other brokers before co-brokering, and to spot identity-theft patterns where someone is impersonating a real motor carrier. Every check runs in both directions.' },
              { q: 'Does it work for drivers and owner-operators?', a: 'Yes. Drivers and owner-operators get the most use out of two features. First, the broker verification: paste an MC or DOT before you accept the load and see authority, insurance, surety bond, and any community fraud reports. Second, the PDF forensics: drop the rate confirmation and we read the hidden metadata to flag if it was edited after the broker sent it. That second one catches dispatchers who quietly shaved the rate before forwarding the rate con. Free plan covers 3 broker lookups and 3 PDF scans every month with no credit card.' },
              { q: 'What about my existing TMS?', a: 'Haulock plugs into your workflow without replacing anything. On the Fleet plan, use our API to bring verification directly into your TMS, your dispatch software, your onboarding, or your factor approval flow.' },
              { q: 'How fresh is the FMCSA data?', a: 'For lookups you trigger, we pull live FMCSA in real time. Repeat lookups within 24 hours are served from cache so we do not burn FMCSA quota or slow you down. We also keep an append-only snapshot history of every carrier we have ever scanned, so when an upstream system is down we can still show you the most recent record we have on file.' },
              { q: 'How accurate are the risk scores?', a: 'A risk score is a signal, not a verdict. It surfaces specific red flags from real public data: missing surety bond, expired insurance, address mismatch, lookalike email domain, BASIC violations, community fraud reports, and so on. A high score should slow you down. A low score does not mean a load is risk-free. You still make the call. Always verify identity through an independent channel before you book.' },
              { q: 'Can I cancel anytime?', a: 'Yes. No contracts, no questions. Cancel in one click from your settings. Your scan history stays accessible. Subscriptions can also be paused if you want to keep the account but stop billing.' },
              { q: 'Is the data legal for me to use?', a: 'Yes. FMCSA data is public and provided by the U.S. Department of Transportation. WHOIS, DNS, and the public web are public. Google Places and Brave Search are commercial APIs we license for this purpose. Our Terms of Use and Privacy Policy spell out exactly how we collect and display this information.' },
            ].map((faq, i) => <FaqItem key={i} {...faq} />)}
          </div>
        </div>
      </section>

      <section className="py-32 px-6 border-t border-[#0B1E3F]/10 relative overflow-hidden bg-[#F5F3EE] text-[#0B1E3F]">
        <div className="absolute inset-0 radial-glow" />
        <div className="relative max-w-4xl mx-auto text-center text-[#0B1E3F]">
          <h2 className="text-5xl md:text-8xl serif italic text-[#0B1E3F] leading-[0.95] mb-8">
            Don&apos;t get caught hauling for a ghost.
          </h2>
          <p className="text-xl text-[#0B1E3F]/60 mb-12 max-w-xl mx-auto">
            Join 4,200+ carriers and brokers who verify every counterparty before booking.
          </p>
          <button onClick={() => navigate('signup')} className="group px-10 py-5 bg-[#0B1E3F] text-white text-lg font-medium rounded-full hover:bg-[#0B1E3F]/90 transition inline-flex items-center gap-2 card-shadow-lg">
            Check any broker or carrier free <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition" />
          </button>
          <div className="mt-6 text-sm text-[#0B1E3F]/50">No credit card required. 3 free lookups / month.</div>
        </div>
      </section>

      <NewsletterSignup />

      <Footer navigate={navigate} />
    </div>
  );
}

const HERO_SCENARIOS: Array<{
  name: string;
  mc: string;
  dot: string;
  score: number;
  badgeLabel: string;
  badgeColor: string;
  verdictTitle: string;
  verdictLine: string;
  verdictTone: 'danger' | 'warn' | 'good';
  flags: Array<{ s: 'critical' | 'warning' | 'good'; t: string; i: any }>;
  scanTime: string;
  dataSources: number;
  communityAlert: string;
}> = [
  {
    name: 'Nationwide Cargo Solutions Inc',
    mc: 'MC-612•••', dot: 'DOT-2184•••', score: 84,
    badgeLabel: 'HIGH RISK', badgeColor: '#DC2626',
    verdictTitle: 'Do not book', verdictLine: '5 critical red flags · Suspected double-brokering', verdictTone: 'danger',
    flags: [
      { s: 'critical', t: 'Matches known fraud pattern (identity reuse)', i: Flag },
      { s: 'critical', t: 'DBA name changed 2× in past 90 days', i: AlertTriangle },
      { s: 'warning', t: 'VOIP phone number · no physical office', i: Phone },
    ],
    scanTime: '1.8s', dataSources: 14,
    communityAlert: '7 carriers flagged this broker in last 30 days',
  },
  {
    name: 'Summit Logistics Group',
    mc: 'MC-921•••', dot: 'DOT-4012•••', score: 91,
    badgeLabel: 'HIGH RISK', badgeColor: '#DC2626',
    verdictTitle: 'Do not book', verdictLine: '6 critical red flags · Confirmed payment fraud', verdictTone: 'danger',
    flags: [
      { s: 'critical', t: 'Authority granted 9 days ago', i: AlertTriangle },
      { s: 'critical', t: 'Shared address with 4 other entities', i: Building2 },
      { s: 'warning', t: 'Website registered 11 days ago', i: Globe },
    ],
    scanTime: '2.4s', dataSources: 14,
    communityAlert: '12 carriers flagged this broker in last 45 days',
  },
  {
    name: 'Redline Transport Brokerage',
    mc: 'MC-508•••', dot: 'DOT-1884•••', score: 52,
    badgeLabel: 'CAUTION', badgeColor: '#F59E0B',
    verdictTitle: 'Proceed with care', verdictLine: '2 warning signs detected · Verify before booking', verdictTone: 'warn',
    flags: [
      { s: 'warning', t: 'Insurance expires in 14 days', i: Shield },
      { s: 'warning', t: 'Slow-pay reports from 3 carriers', i: Clock },
      { s: 'good', t: 'Authority active 4+ years', i: CheckCircle2 },
    ],
    scanTime: '1.9s', dataSources: 14,
    communityAlert: '1 carrier flagged this broker in last 90 days',
  },
  {
    name: 'Crossroads Brokerage Partners',
    mc: 'MC-704•••', dot: 'DOT-2961•••', score: 44,
    badgeLabel: 'CAUTION', badgeColor: '#F59E0B',
    verdictTitle: 'Proceed with care', verdictLine: '2 warning signs · Request COI directly from insurer', verdictTone: 'warn',
    flags: [
      { s: 'warning', t: 'Email on free domain (gmail.com)', i: Mail },
      { s: 'warning', t: 'No verifiable physical office', i: MapPin },
      { s: 'good', t: 'No carrier fraud reports', i: CheckCircle2 },
    ],
    scanTime: '2.0s', dataSources: 14,
    communityAlert: 'No recent reports · limited footprint',
  },
  {
    name: 'Keystone Freight Network',
    mc: 'MC-128•••', dot: 'DOT-0891•••', score: 18,
    badgeLabel: 'VERIFIED', badgeColor: '#16A34A',
    verdictTitle: 'Safe to book', verdictLine: 'All checks passed · Established broker', verdictTone: 'good',
    flags: [
      { s: 'good', t: 'Authority active 12+ years', i: CheckCircle2 },
      { s: 'good', t: 'Insurance current · $1M/$100K', i: Shield },
      { s: 'good', t: 'Verified physical office', i: Building2 },
    ],
    scanTime: '1.7s', dataSources: 14,
    communityAlert: 'Positive payment history from 40+ carriers',
  },
];

function HeroDashboardMockup({ featured }: { featured?: LandingFeaturedScan }) {
  const [idx, setIdx] = useState<number | null>(null);
  useEffect(() => {
    setIdx(Math.floor(Math.random() * HERO_SCENARIOS.length));
  }, []);
  if (idx === null && !featured) {
    return (
      <div className="relative text-[#0B1E3F]">
        <div className="bg-white rounded-3xl card-shadow-lg border border-[#0B1E3F]/10" style={{ minHeight: 540 }} />
      </div>
    );
  }

  // Build a unified "scenario" shape from either a real featured scan
  // (preferred — actual lookup with anonymized MC/DOT and stored flags) or
  // a fallback hardcoded HERO_SCENARIOS entry while the API is loading or
  // when no risky scans exist yet.
  const flagColor = (level: 'critical' | 'warning' | 'good') => level === 'critical' ? '#DC2626' : level === 'warning' ? '#F59E0B' : '#16A34A';
  let s: {
    name: string; mc: string; dot: string; score: number;
    badgeLabel: string; badgeColor: string;
    verdictTitle: string; verdictLine: string; verdictTone: 'danger' | 'warn' | 'good';
    flags: { s: 'critical' | 'warning' | 'good'; t: string; i: any }[];
    scanTime: string; dataSources: number;
    communityAlert?: string;
    entity?: string;
    isReal: boolean;
  };

  if (featured) {
    const v = featured.verdict;
    const tone: 'danger' | 'warn' | 'good' = v === 'high' ? 'danger' : v === 'medium' ? 'warn' : 'good';
    const badgeLabel = v === 'high' ? 'HIGH RISK' : v === 'medium' ? 'CAUTION' : 'VERIFIED';
    const badgeColor = v === 'high' ? '#DC2626' : v === 'medium' ? '#F59E0B' : '#16A34A';
    const verdictTitle = v === 'high' ? 'Do not book' : v === 'medium' ? 'Proceed with care' : 'Safe to book';
    const verdictLine = featured.flagCount > 0
      ? `${featured.flagCount} red flag${featured.flagCount === 1 ? '' : 's'} detected · scored using ${featured.entity.toLowerCase()} rules`
      : `Scored as ${badgeLabel.toLowerCase()} using ${featured.entity.toLowerCase()} rules`;
    const flagSevToTone = (sev: string): 'critical' | 'warning' | 'good' =>
      sev === 'critical' ? 'critical' : sev === 'warning' ? 'warning' : 'good';
    const flags = featured.flags.length > 0
      ? featured.flags.map((f) => ({ s: flagSevToTone(f.sev), t: f.title, i: f.sev === 'critical' ? AlertTriangle : Flag }))
      : [{ s: 'good' as const, t: 'No red flags detected', i: CheckCircle2 }];

    s = {
      name: featured.name,
      mc: featured.mc || '—',
      dot: featured.dot || '—',
      score: featured.score,
      badgeLabel, badgeColor,
      verdictTitle, verdictLine, verdictTone: tone,
      flags,
      scanTime: '—',
      dataSources: 14,
      entity: featured.entity,
      isReal: true,
    };
  } else {
    const fallback = HERO_SCENARIOS[idx ?? 0];
    s = { ...fallback, isReal: false };
  }

  const toneBg = s.verdictTone === 'danger' ? 'bg-[#DC2626]/10 border-[#DC2626]/30' : s.verdictTone === 'warn' ? 'bg-[#F59E0B]/10 border-[#F59E0B]/30' : 'bg-[#16A34A]/10 border-[#16A34A]/30';
  const toneText = s.verdictTone === 'danger' ? 'text-[#DC2626]' : s.verdictTone === 'warn' ? 'text-[#F59E0B]' : 'text-[#16A34A]';
  const VerdictIcon = s.verdictTone === 'good' ? CheckCircle2 : AlertTriangle;
  return (
    <div className="relative text-[#0B1E3F]">
      <div className="absolute -top-4 -right-4 z-20 floaty">
        <div className="px-4 py-2 text-white rounded-full text-xs mono uppercase tracking-wider shadow-lg flex items-center gap-2" style={{ backgroundColor: s.badgeColor }}>
          <VerdictIcon className="w-3.5 h-3.5 text-white" /> {s.badgeLabel} · just now
        </div>
      </div>
      <div className="bg-white rounded-3xl p-6 card-shadow-lg border border-[#0B1E3F]/10 relative overflow-hidden text-[#0B1E3F]">
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-[#0B1E3F]/10">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-[#FF6B35]" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#F59E0B]" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#16A34A]" />
          </div>
          <div className="mono text-xs text-[#0B1E3F]/50">haulock.com/verify</div>
          <div className="w-12" />
        </div>
        <div className="flex items-start justify-between mb-6">
          <div className="text-[#0B1E3F]">
            <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/50 mb-1 flex items-center gap-2 flex-wrap">
              <span>{s.entity ? `${s.entity.toLowerCase()} lookup` : 'Broker lookup'}</span>
              {s.isReal && (
                <span className="px-1.5 py-0.5 rounded-full text-[9px] mono uppercase tracking-wider bg-[#16A34A]/10 text-[#16A34A] flex items-center gap-1">
                  <span className="relative flex w-1.5 h-1.5">
                    <span className="absolute inline-flex w-full h-full bg-[#16A34A] rounded-full opacity-75 animate-ping" />
                    <span className="relative inline-flex w-1.5 h-1.5 bg-[#16A34A] rounded-full" />
                  </span>
                  Live
                </span>
              )}
            </div>
            <div className="text-xl font-semibold text-[#0B1E3F] mb-0.5">{s.name}</div>
            <div className="text-xs mono text-[#0B1E3F]/50">{s.mc} · {s.dot}</div>
          </div>
          <RiskGauge score={s.score} size="md" />
        </div>
        <div className={`p-4 border rounded-xl mb-5 ${toneBg}`}>
          <div className={`text-xs mono uppercase tracking-wider mb-1 flex items-center gap-1.5 ${toneText}`}>
            <VerdictIcon className="w-3.5 h-3.5" /> {s.verdictTitle}
          </div>
          <div className="text-sm font-medium text-[#0B1E3F]">{s.verdictLine}</div>
        </div>
        <div className="space-y-2">
          {s.flags.map((f, i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-lg text-[#0B1E3F]" style={{ backgroundColor: 'rgba(11,30,63,0.05)' }}>
              <f.i className="w-4 h-4 flex-shrink-0" style={{ color: flagColor(f.s) }} />
              <div className="text-sm font-medium text-[#0B1E3F] flex-1">{f.t}</div>
              <ChevronRight className="w-4 h-4 text-[#0B1E3F]/30" />
            </div>
          ))}
        </div>
        <div className="mt-5 pt-4 border-t border-[#0B1E3F]/10 flex items-center justify-between text-xs mono text-[#0B1E3F]/50">
          <span className="flex items-center gap-1.5"><Clock className="w-3 h-3" /> Scanned in {s.scanTime}</span>
          <span>{s.dataSources} data sources</span>
        </div>
      </div>
      <div className="absolute -bottom-6 -left-6 z-10 bg-[#0B1E3F] text-white p-4 rounded-2xl card-shadow-lg max-w-[240px] floaty" style={{ animationDelay: '1s' }}>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-6 h-6 rounded-full bg-[#FF6B35] flex items-center justify-center">
            <Users className="w-3.5 h-3.5 text-white" />
          </div>
          <div className="text-xs mono uppercase tracking-wider text-white/70">Community alert</div>
        </div>
        <div className="text-sm text-white">{s.communityAlert}</div>
      </div>
    </div>
  );
}

// Sonar / radar scan animation shown while a quick-lookup verify request is
// in flight. The radar sweeps continuously and source "blips" light up on a
// timed cadence so the user gets visual confirmation that we're hitting all
// data sources (FMCSA, Places, Web, Domain, Social). Timings are optimistic;
// the real fetch can finish before or after the choreography.
// Per-source "spooky check": given the resolved carrier object, decide if
// this source should light up red on the scanner. We avoid `result.sources`
// alone because some sources mark `ok=false` for benign reasons (no sender
// email supplied, no website to compare). We want red ONLY when the check
// actually caught a fraud signal.
function isSourceSpooky(key: string, carrier: any | null | undefined): boolean {
  if (!carrier) return false;
  const flagsMatch = (re: RegExp) =>
    Array.isArray(carrier.flags) && carrier.flags.some((f: any) => re.test(String(f?.title || '')));
  switch (key) {
    case 'fmcsa':
      // Authority not active, OOS, no insurance, missing MCS-150, etc.
      return flagsMatch(/operating authority is not active|out of service|no liability insurance|no surety bond|MCS-150|reactivated/i);
    case 'places':
      return flagsMatch(/address resolves to a different business|address is a mail-forwarding|business at this address is closed/i);
    case 'web':
      return flagsMatch(/website domain doesn|carrier has no public website/i);
    case 'domain':
      return flagsMatch(/no email server|domain registered.*days ago|domain registered less than/i);
    case 'social':
      // Empty social isn't necessarily spooky for small carriers — keep green.
      return false;
    case 'lookalike':
      return Boolean(carrier.lookalikeMatch);
    case 'chameleon':
      return Array.isArray(carrier.chameleonLinks) && carrier.chameleonLinks.length > 0;
    case 'reputation':
      return Array.isArray(carrier?.webReputation?.hits) && carrier.webReputation.hits.length > 0;
    case 'entities':
      return Array.isArray(carrier.linkedEntities) && carrier.linkedEntities.length > 0;
    case 'sms':
      // SMS is "spooky" when FMCSA itself has flagged a BASIC alert.
      return carrier?.sms?.fetched && Object.values(carrier.sms.basics || {}).some((b: any) => b?.alert);
  }
  return false;
}

function VerifyScanProgress({ query, result }: { query?: string; result?: any | null }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const t = setInterval(() => setElapsed(Date.now() - start), 100);
    return () => clearInterval(t);
  }, []);

  // 8 source checks, evenly distributed around the radar (45° apart) and
  // sequenced ~700ms apart so the user sees real progress while the actual
  // backend scan runs in parallel.
  const sources: Array<{
    key: string;
    label: string;
    desc: string;
    chip?: string;          // small monospace tag shown next to the description
    icon: typeof Shield;
    angle: number;
    radius: number;
    activateAt: number;
  }> = [
    { key: 'fmcsa',     label: 'FMCSA registry',         desc: 'Authority status · insurance · crashes · OOS rates',                 chip: 'mobile.fmcsa.dot.gov',     icon: Shield,        angle:  20, radius: 92, activateAt:   500 },
    { key: 'sms',       label: 'FMCSA SMS · BASIC scores',desc: 'Federal safety scoring · BASIC alerts · 24-mo inspections + crashes', chip: 'ai.fmcsa.dot.gov/SMS',    icon: ShieldCheck,   angle:  60, radius: 70, activateAt:  1700 },
    { key: 'places',    label: 'Google Places',          desc: 'Business address · operating status · mailbox detection',             chip: 'places.googleapis.com',    icon: MapPin,        angle: 100, radius: 92, activateAt:  3000 },
    { key: 'web',       label: 'Web presence',           desc: 'Carrier website discovery via Brave Search',                          chip: 'api.search.brave.com',     icon: Globe,         angle: 140, radius: 70, activateAt:  4300 },
    { key: 'domain',    label: 'Domain & email infra',   desc: 'WHOIS age · MX records · SPF · Google Safe Browsing',                 chip: 'WHOIS · DNS · GSB',        icon: Mail,          angle: 180, radius: 92, activateAt:  5500 },
    { key: 'social',    label: 'Social media footprint', desc: 'Facebook · LinkedIn · Instagram · X · YouTube · TikTok',              chip: '6 platforms',              icon: Users,         angle: 220, radius: 70, activateAt:  6700 },
    { key: 'lookalike', label: 'Lookalike-domain check', desc: 'Typosquat · homograph swap · TLD swap · subdomain spoof',             chip: 'Levenshtein ≤ 2',          icon: AlertTriangle, angle: 260, radius: 92, activateAt:  7900 },
    { key: 'chameleon', label: 'Cross-reference scan',   desc: 'Phone or address shared with another flagged FMCSA record',           chip: 'FMCSA Socrata · Haulock DB', icon: Eye,         angle: 300, radius: 70, activateAt:  9100 },
    { key: 'reputation',label: 'Web fraud reputation',   desc: 'FreightWaves · Land Line · TruckersReport · BBB · Reddit · NCCDB',   chip: '5 fraud queries',          icon: Search,        angle: 340, radius: 92, activateAt: 10300 },
  ];
  // The bar fills toward 95% and parks there until the API result arrives.
  // We tune the curve so it tracks the typical 12-15s real-world scan
  // duration instead of racing to 95% at 6s and then sitting there. A
  // sub-linear easing makes the early progress feel snappy and the tail
  // feel patient — which matches how the actual sources resolve in
  // parallel (most fast, FMCSA + Brave the slow ones).
  const TARGET_FULL_MS = 13000;
  const seconds = (elapsed / 1000).toFixed(1);
  const linearPct = Math.min(1, elapsed / TARGET_FULL_MS);
  const easedPct = 1 - Math.pow(1 - linearPct, 1.6); // sub-linear ease-out
  const progressPct = Math.min(95, Math.round(easedPct * 95));
  const completedCount = sources.filter((s) => elapsed >= s.activateAt).length;

  const polar = (angleDeg: number, radiusPct: number) => {
    const rad = (angleDeg - 90) * (Math.PI / 180);
    const r = (radiusPct / 100) * 90;
    return { x: 100 + r * Math.cos(rad), y: 100 + r * Math.sin(rad) };
  };

  return (
    <div className="bg-white rounded-3xl border border-[#0B1E3F]/10 card-shadow text-[#0B1E3F] text-left w-full overflow-hidden">
      <style jsx>{`
        @keyframes radar-sweep { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes radar-ping {
          0%   { transform: scale(0.35); opacity: 0.85; }
          100% { transform: scale(1.0); opacity: 0; }
        }
        @keyframes blip-pop {
          0%   { transform: scale(0); opacity: 0; }
          40%  { transform: scale(1.7); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes blip-glow {
          0%, 100% { filter: drop-shadow(0 0 2px rgba(22,163,74,0.6)); }
          50%      { filter: drop-shadow(0 0 6px rgba(22,163,74,0.9)); }
        }
        @keyframes blip-glow-spooky {
          0%, 100% { filter: drop-shadow(0 0 2px rgba(220,38,38,0.7)); }
          50%      { filter: drop-shadow(0 0 8px rgba(220,38,38,1)); }
        }
        .radar-sweep { transform-origin: center; animation: radar-sweep 2.6s linear infinite; }
        .radar-ping  { transform-origin: center; animation: radar-ping 2.8s ease-out infinite; }
        .blip        { transform-origin: center; animation: blip-pop 0.55s ease-out forwards, blip-glow 1.8s ease-in-out infinite; }
        .blip-spooky { transform-origin: center; animation: blip-pop 0.55s ease-out forwards, blip-glow-spooky 1.2s ease-in-out infinite; }
      `}</style>

      {(() => {
        // Once the API has resolved we can colour the header banner red if
        // ANY source caught something. Until then it's the neutral navy.
        const spookyCount = result ? sources.filter((s) => isSourceSpooky(s.key, result)).length : 0;
        const headerSpooky = spookyCount > 0;
        return (
          <div className={`px-8 md:px-10 pt-8 pb-6 border-b border-[#0B1E3F]/8 bg-gradient-to-br ${headerSpooky ? 'from-[#DC2626]/[0.06] to-transparent' : 'from-[#0B1E3F]/[0.02] to-transparent'}`}>
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${headerSpooky ? 'bg-[#DC2626]' : 'bg-[#0B1E3F]'}`}>
                  <Radio className={`w-6 h-6 ${headerSpooky ? 'text-white' : 'text-[#16A34A]'}`} />
                </div>
                <span className="absolute -top-1 -right-1 flex w-3 h-3">
                  <span className={`absolute inline-flex w-full h-full rounded-full opacity-75 animate-ping ${headerSpooky ? 'bg-[#DC2626]' : 'bg-[#16A34A]'}`} />
                  <span className={`relative inline-flex w-3 h-3 rounded-full ${headerSpooky ? 'bg-[#DC2626]' : 'bg-[#16A34A]'}`} />
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-xs mono uppercase tracking-[0.18em] mb-1 ${headerSpooky ? 'text-[#DC2626] font-semibold' : 'text-[#0B1E3F]/50'}`}>
                  {result
                    ? (headerSpooky ? `${spookyCount} red flag${spookyCount === 1 ? '' : 's'} detected` : 'Scan complete · all checks clean')
                    : 'Live scan in progress'}
                </div>
                <div className="text-2xl md:text-3xl font-semibold leading-tight truncate">{query || 'Carrier verification'}</div>
                <div className="text-sm text-[#0B1E3F]/55 mt-0.5">
                  <span className="mono">{seconds}s elapsed</span>
                  <span className="mx-2 text-[#0B1E3F]/25">·</span>
                  <span>{completedCount} / {sources.length} checks complete</span>
                  {result && spookyCount > 0 && (
                    <>
                      <span className="mx-2 text-[#0B1E3F]/25">·</span>
                      <span className="text-[#DC2626] font-semibold">{spookyCount} caught issues</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Body — radar (left) + sources (right). Left-aligned, full-width. */}
      <div className="grid lg:grid-cols-5 gap-8 lg:gap-12 px-8 md:px-10 py-10">
        {/* Radar */}
        <div className="lg:col-span-2 flex items-start justify-start">
          <div className="relative aspect-square w-full max-w-md">
            <svg viewBox="0 0 200 200" className="w-full h-full">
              <defs>
                <radialGradient id="radar-bg" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#16A34A" stopOpacity="0.06" />
                  <stop offset="100%" stopColor="#0B1E3F" stopOpacity="0" />
                </radialGradient>
                <linearGradient id="sweep-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#16A34A" stopOpacity="0" />
                  <stop offset="100%" stopColor="#16A34A" stopOpacity="0.6" />
                </linearGradient>
              </defs>

              <circle cx="100" cy="100" r="90" fill="url(#radar-bg)" />

              {[28, 50, 72, 90].map((r) => (
                <circle key={r} cx="100" cy="100" r={r} fill="none" stroke="#0B1E3F" strokeOpacity="0.12" strokeWidth="0.5" />
              ))}
              <line x1="10"  y1="100" x2="190" y2="100" stroke="#0B1E3F" strokeOpacity="0.08" strokeWidth="0.4" />
              <line x1="100" y1="10"  x2="100" y2="190" stroke="#0B1E3F" strokeOpacity="0.08" strokeWidth="0.4" />
              <line x1="36"  y1="36"  x2="164" y2="164" stroke="#0B1E3F" strokeOpacity="0.05" strokeWidth="0.4" />
              <line x1="164" y1="36"  x2="36"  y2="164" stroke="#0B1E3F" strokeOpacity="0.05" strokeWidth="0.4" />

              <circle cx="100" cy="100" r="90" fill="none" stroke="#0B1E3F" strokeOpacity="0.2" strokeWidth="1" />

              <g className="radar-ping">
                <circle cx="100" cy="100" r="84" fill="none" stroke="#16A34A" strokeOpacity="0.5" strokeWidth="0.8" />
              </g>
              <g className="radar-ping" style={{ animationDelay: '1.4s' }}>
                <circle cx="100" cy="100" r="84" fill="none" stroke="#16A34A" strokeOpacity="0.5" strokeWidth="0.8" />
              </g>

              <g className="radar-sweep">
                <path d="M 100 100 L 100 10 A 90 90 0 0 1 175 60 Z" fill="url(#sweep-grad)" />
                <line x1="100" y1="100" x2="100" y2="10" stroke="#16A34A" strokeOpacity="0.9" strokeWidth="1.2" />
              </g>

              {sources.map((s) => {
                const pos = polar(s.angle, s.radius);
                const active = elapsed >= s.activateAt;
                if (!active) return null;
                const spooky = isSourceSpooky(s.key, result);
                const fillColor = spooky ? '#DC2626' : '#16A34A';
                return (
                  <g key={s.key} className={spooky ? 'blip-spooky' : 'blip'} style={{ transformOrigin: `${pos.x}px ${pos.y}px` }}>
                    <circle cx={pos.x} cy={pos.y} r={spooky ? 7 : 6} fill={fillColor} fillOpacity="0.22" />
                    <circle cx={pos.x} cy={pos.y} r={spooky ? 3.5 : 3} fill={fillColor} />
                  </g>
                );
              })}

              <circle cx="100" cy="100" r="3" fill="#0B1E3F" />
              <circle cx="100" cy="100" r="6" fill="none" stroke="#0B1E3F" strokeOpacity="0.3" strokeWidth="0.5" />
            </svg>
          </div>
        </div>

        {/* Sources list — 1 column on small, 2 columns on desktop. */}
        <div className="lg:col-span-3">
          <div className="text-[10px] mono uppercase tracking-[0.18em] text-[#0B1E3F]/50 mb-4">Cross-checking 9 sources in parallel</div>
          <div className="grid sm:grid-cols-2 gap-2">
            {sources.map((s) => {
              const active = elapsed >= s.activateAt;
              const spooky = isSourceSpooky(s.key, result);
              const Icon = s.icon;
              // Card style: pending (dim) / clean (green) / spooky (red).
              // We only switch to "clean" or "spooky" once the source has
              // activated AND the API result is in — otherwise it's the
              // mid-scan green-ish "checked, awaiting result" state.
              const cardCls = !active
                ? 'border-[#0B1E3F]/8 bg-white opacity-60'
                : spooky
                  ? 'border-[#DC2626]/40 bg-[#DC2626]/5 ring-1 ring-[#DC2626]/20'
                  : 'border-[#16A34A]/25 bg-[#16A34A]/5';
              const iconCls = !active
                ? 'bg-[#0B1E3F]/5 text-[#0B1E3F]/40'
                : spooky
                  ? 'bg-[#DC2626] text-white'
                  : 'bg-[#16A34A] text-white';
              const labelCls = !active ? 'text-[#0B1E3F]/60' : spooky ? 'text-[#DC2626]' : 'text-[#0B1E3F]';
              const StatusIcon = !active ? Icon : spooky ? AlertTriangle : CheckCircle2;
              return (
                <div key={s.key} className={`flex items-start gap-3 p-3 rounded-xl border transition ${cardCls}`}>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition ${iconCls}`}>
                    <StatusIcon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-semibold leading-tight ${labelCls}`}>
                      {s.label}
                      {spooky && <span className="ml-1.5 text-[9px] mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#DC2626] text-white align-middle">Caught</span>}
                    </div>
                    <div className={`text-[11px] mt-1 leading-snug ${active ? (spooky ? 'text-[#DC2626]/85' : 'text-[#0B1E3F]/65') : 'text-[#0B1E3F]/40'}`}>{s.desc}</div>
                    {s.chip && (
                      <div className={`mt-1.5 inline-block text-[9px] mono uppercase tracking-wider px-1.5 py-0.5 rounded ${active ? (spooky ? 'bg-[#DC2626]/15 text-[#DC2626]' : 'bg-[#0B1E3F]/8 text-[#0B1E3F]/60') : 'bg-[#0B1E3F]/4 text-[#0B1E3F]/35'}`}>
                        {s.chip}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Footer — progress bar + caption */}
      {(() => {
        const anySpooky = result ? sources.some((s) => isSourceSpooky(s.key, result)) : false;
        return (
          <div className="px-8 md:px-10 pb-8">
            <div className="h-1.5 bg-[#0B1E3F]/8 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-200 ease-linear ${anySpooky ? 'bg-gradient-to-r from-[#DC2626] to-[#FF6B35]' : 'bg-gradient-to-r from-[#16A34A] to-[#0B1E3F]'}`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="mt-3 flex items-center justify-between text-[11px] text-[#0B1E3F]/55">
              <div className="mono uppercase tracking-wider">FMCSA · Socrata · Google Places · Brave · WHOIS · DNS · Safe Browsing</div>
              <div className={`mono ${anySpooky ? 'text-[#DC2626] font-semibold' : ''}`}>{progressPct}%</div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function RateConScanProgress({ fileName }: { fileName?: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const t = setInterval(() => setElapsed(Date.now() - start), 250);
    return () => clearInterval(t);
  }, []);

  // Each stage is a rough estimate tuned to observed backend timing (~45-60s total).
  // The server runs these sequentially up to Claude, then FMCSA + domain + Google Places
  // in parallel, then final scoring. We reflect that in the timeline.
  const stages = [
    { key: 'upload', label: 'Uploading PDF', desc: 'Sending securely to our server', icon: Upload, start: 0, end: 1500 },
    { key: 'ocr', label: 'Reading document with Google Document AI', desc: 'Extracting text from every page', icon: ScanLine, start: 1500, end: 18000 },
    { key: 'ai', label: 'Analyzing with Claude AI', desc: 'Identifying broker, MC, email, and stylistic fraud signals', icon: Sparkles, start: 18000, end: 30000 },
    { key: 'fmcsa', label: 'Cross-checking FMCSA registry', desc: 'Authority status, insurance, crash history', icon: Shield, start: 30000, end: 42000 },
    { key: 'enrich', label: 'Verifying domain, website & Google Business', desc: 'WHOIS age, MX/SPF, social profiles, address match', icon: Globe, start: 30000, end: 48000 },
    { key: 'score', label: 'Finalizing risk score', desc: 'Combining all signals into a verdict', icon: Target, start: 48000, end: 58000 },
  ];
  const totalMs = 58000;

  const progressPct = Math.min(99, Math.round((elapsed / totalMs) * 100));
  const seconds = Math.floor(elapsed / 1000);

  const stageState = (s: typeof stages[number]) => {
    if (elapsed >= s.end) return 'done';
    if (elapsed >= s.start) return 'active';
    return 'pending';
  };

  return (
    <div className="text-left max-w-xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <div className="w-12 h-12 rounded-xl bg-[#FF6B35]/10 flex items-center justify-center flex-shrink-0">
          <div className="w-5 h-5 border-2 border-[#FF6B35]/30 border-t-[#FF6B35] rounded-full animate-spin" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-lg font-semibold text-[#0B1E3F]">Scanning rate confirmation…</div>
          <div className="text-xs text-[#0B1E3F]/60 truncate">{fileName || 'Your uploaded file'} · {seconds}s elapsed</div>
        </div>
      </div>

      <div className="h-1.5 bg-[#0B1E3F]/8 rounded-full overflow-hidden mb-6">
        <div
          className="h-full bg-gradient-to-r from-[#FF6B35] to-[#F59E0B] transition-all duration-300 ease-linear"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <div className="space-y-2">
        {stages.map((s) => {
          const state = stageState(s);
          const Icon = s.icon;
          return (
            <div key={s.key} className={`flex items-start gap-3 p-3 rounded-xl transition ${state === 'active' ? 'bg-[#0B1E3F]/5' : ''}`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition ${
                state === 'done' ? 'bg-[#16A34A] text-white'
                  : state === 'active' ? 'bg-[#FF6B35] text-white'
                  : 'bg-[#0B1E3F]/5 text-[#0B1E3F]/30'
              }`}>
                {state === 'done'
                  ? <CheckCircle2 className="w-4 h-4" />
                  : state === 'active'
                    ? <div className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    : <Icon className="w-3.5 h-3.5" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-medium ${state === 'pending' ? 'text-[#0B1E3F]/40' : 'text-[#0B1E3F]'}`}>{s.label}</div>
                <div className={`text-xs ${state === 'pending' ? 'text-[#0B1E3F]/30' : 'text-[#0B1E3F]/55'}`}>{s.desc}</div>
              </div>
              {state === 'done' && <div className="text-[10px] mono uppercase tracking-wider text-[#16A34A] mt-1">Done</div>}
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex items-start gap-2 p-3 bg-[#F59E0B]/10 border border-[#F59E0B]/25 rounded-lg text-xs text-[#0B1E3F]">
        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-[#F59E0B] flex-shrink-0" />
        <div>Please stay on this page — scanning takes 30-60 seconds. Leaving or refreshing cancels the scan and still counts against your quota.</div>
      </div>
    </div>
  );
}

// "In the wild" scan card next to the rate-con mockup. Shows a real recent
// risky lookup (anonymized) when one exists, or a hardcoded scenario as a
// fallback — so the section is never empty before the first scan lands.
function InTheWildCard({ featured }: { featured?: LandingFeaturedScan }) {
  const FALLBACK = {
    name: 'Westport Logistics Group LLC',
    mc: 'MC-637•••',
    dot: 'DOT-3019•••',
    score: 78,
    verdict: 'high' as const,
    entity: 'BROKER',
    flagCount: 4,
    flags: [
      { sev: 'critical' as const, title: 'Authority reactivated 12 days ago', desc: 'Dormant 3 years prior',     pts: 30 },
      { sev: 'warning'  as const, title: 'Address flipped 3× this year',     desc: 'Chicago → Atlanta → Miami',  pts: 30 },
      { sev: 'warning'  as const, title: 'Insurance lapsed 8 days ago',      desc: 'No replacement policy filed', pts: 20 },
      { sev: 'info'     as const, title: '2 verified fraud reports',         desc: 'Non-payment complaints',     pts: 30 },
    ] as LandingFeaturedFlag[],
    isReal: false,
  };
  const isReal = !!featured;
  const s = featured
    ? {
        name: featured.name,
        mc: featured.mc || '—',
        dot: featured.dot || '—',
        score: featured.score,
        verdict: featured.verdict,
        entity: featured.entity,
        flagCount: featured.flagCount,
        flags: featured.flags,
        isReal: true,
      }
    : FALLBACK;

  const verdictLabel = s.verdict === 'high' ? 'Do not book' : s.verdict === 'medium' ? 'Proceed with care' : 'Safe to book';
  const verdictBg = s.verdict === 'high' ? 'bg-[#DC2626]/10 border-[#DC2626]/30' : s.verdict === 'medium' ? 'bg-[#F59E0B]/10 border-[#F59E0B]/30' : 'bg-[#16A34A]/10 border-[#16A34A]/30';
  const verdictText = s.verdict === 'high' ? 'text-[#DC2626]' : s.verdict === 'medium' ? 'text-[#F59E0B]' : 'text-[#16A34A]';
  const flagDot = (sev: string) => sev === 'critical' ? '#DC2626' : sev === 'warning' ? '#F59E0B' : 'rgba(11,30,63,0.4)';

  return (
    <div className="bg-white rounded-2xl p-8 relative overflow-hidden card-shadow-lg text-[#0B1E3F]">
      <div className="flex items-center justify-between mb-6">
        <div className="text-[#0B1E3F]">
          <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/50 mb-1 flex items-center gap-2 flex-wrap">
            <span>{s.entity ? `${s.entity.toLowerCase()} scan` : 'Haulock scan'}</span>
            {s.isReal ? (
              <span className="px-1.5 py-0.5 rounded-full text-[9px] mono uppercase tracking-wider bg-[#16A34A]/10 text-[#16A34A] flex items-center gap-1">
                <span className="relative flex w-1.5 h-1.5">
                  <span className="absolute inline-flex w-full h-full bg-[#16A34A] rounded-full opacity-75 animate-ping" />
                  <span className="relative inline-flex w-1.5 h-1.5 bg-[#16A34A] rounded-full" />
                </span>
                Live
              </span>
            ) : (
              <span className="px-1.5 py-0.5 rounded-full text-[9px] mono uppercase tracking-wider bg-[#0B1E3F]/5 text-[#0B1E3F]/55">Sample</span>
            )}
          </div>
          <div className="text-2xl font-semibold text-[#0B1E3F]">{s.name}</div>
          <div className="text-sm mono text-[#0B1E3F]/50">{s.mc} · {s.dot}</div>
        </div>
        <RiskGauge score={s.score} size="sm" />
      </div>

      <div className={`p-4 ${verdictBg} border rounded-xl mb-6`}>
        <div className={`flex items-center gap-2 text-xs mono uppercase tracking-wider mb-1 ${verdictText}`}>
          <AlertTriangle className="w-3.5 h-3.5" /> {verdictLabel}
        </div>
        <div className="text-sm font-medium text-[#0B1E3F]">
          {s.flagCount > 0
            ? `${s.flagCount} red flag${s.flagCount === 1 ? '' : 's'} · scored using ${(s.entity || '').toLowerCase()} rules`
            : `Scored using ${(s.entity || '').toLowerCase()} rules`}
        </div>
      </div>

      {s.flags.length > 0 ? (
        <div className="space-y-2">
          {s.flags.map((flag, i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-lg text-[#0B1E3F]" style={{ backgroundColor: 'rgba(11,30,63,0.05)' }}>
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: flagDot(flag.sev) }} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-[#0B1E3F]">{flag.title}</div>
                {flag.desc && <div className="text-xs text-[#0B1E3F]/60">{flag.desc}</div>}
              </div>
              {typeof flag.pts === 'number' && <div className="mono text-xs text-[#0B1E3F]/40">+{flag.pts}</div>}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-[#0B1E3F]/55 italic">No red flags on this scan — the scoring engine considered every signal and found nothing actionable.</div>
      )}
    </div>
  );
}

// 10 sample rate-con templates rotated on every page load. We never expose
// the broker name itself — it gets fully redacted to bullets so the visual
// shape of a real letterhead is preserved, but no letters can be read. Same
// for the email username (which would otherwise leak the same name).
//
// `brand` is kept internally only for length-based redaction; it never gets
// rendered as text. `tagline` is generic copy that doesn't reveal identity.
const RATE_CON_TEMPLATES: Array<{
  brand: string;
  tagline: string;
  mc: string;
  dot: string;
  loadId: string;
  date: string;
  pickup: { name: string; line: string };
  delivery: { name: string; line: string };
  miles: number;
  rate: string;
  emailDomainTld: string; // .net / .com / .co / etc — preserves shape without leaking name
  phone: string;
}> = [
  { brand: 'WESTPORT LOGISTICS',     tagline: 'Professional Logistics Solutions', mc: 'MC-637•••', dot: 'DOT-3019•••', loadId: 'RC-2026-0481', date: '04/23/2026',
    pickup:   { name: 'Thompson Distribution Center', line: 'Dallas, TX 75201 · 04/24 08:00' },
    delivery: { name: 'Atlanta Warehouse Co.',        line: 'Atlanta, GA 30303 · 04/26 14:00' },
    miles: 790,  rate: '$2,450.00', emailDomainTld: '.net', phone: '(305) 555-0183' },
  { brand: 'NIGHTHAWK FREIGHT',      tagline: 'Premium Carrier Network',          mc: 'MC-498•••', dot: 'DOT-2851•••', loadId: 'RC-2026-1147', date: '04/19/2026',
    pickup:   { name: 'Riverside Foods Cold Storage', line: 'Fresno, CA 93706 · 04/20 06:30' },
    delivery: { name: 'Pacific Grocer DC',            line: 'Seattle, WA 98108 · 04/22 16:00' },
    miles: 950,  rate: '$3,180.00', emailDomainTld: '.com', phone: '(702) 555-0427' },
  { brand: 'BLUEPOINT BROKERAGE',    tagline: 'Coast-to-Coast Freight Solutions', mc: 'MC-712•••', dot: 'DOT-3344•••', loadId: 'RC-2026-0822', date: '04/15/2026',
    pickup:   { name: 'Midwest Steel Yard #4',        line: 'Gary, IN 46402 · 04/16 09:00' },
    delivery: { name: 'East Coast Fabricators',       line: 'Newark, NJ 07105 · 04/18 12:00' },
    miles: 740,  rate: '$1,925.00', emailDomainTld: '.net', phone: '(908) 555-0316' },
  { brand: 'SUMMIT TRANSPORT GROUP', tagline: 'Trusted Since 2014',               mc: 'MC-552•••', dot: 'DOT-2614•••', loadId: 'RC-2026-2041', date: '04/11/2026',
    pickup:   { name: 'Sunbelt Building Supply',      line: 'Phoenix, AZ 85007 · 04/12 07:15' },
    delivery: { name: 'Front Range Construction',     line: 'Denver, CO 80216 · 04/13 18:00' },
    miles: 860,  rate: '$2,290.00', emailDomainTld: '.co',  phone: '(480) 555-0291' },
  { brand: 'IRONSIDE LOGISTICS',     tagline: 'Reliable. Fast. Insured.',         mc: 'MC-104•••', dot: 'DOT-1772•••', loadId: 'RC-2026-0359', date: '04/22/2026',
    pickup:   { name: 'Gulf Coast Polymers Inc.',     line: 'Houston, TX 77002 · 04/23 11:00' },
    delivery: { name: 'Lakeside Manufacturing',       line: 'Chicago, IL 60607 · 04/25 09:30' },
    miles: 1080, rate: '$3,420.00', emailDomainTld: '.com', phone: '(346) 555-0654' },
  { brand: 'CRESCENT FREIGHT LINE',  tagline: 'Specialized Heavy Haul',           mc: 'MC-826•••', dot: 'DOT-3927•••', loadId: 'RC-2026-1763', date: '04/17/2026',
    pickup:   { name: 'Cypress Plant Equipment',      line: 'Baton Rouge, LA 70802 · 04/18 05:00' },
    delivery: { name: 'Highland Energy Services',     line: 'Tulsa, OK 74103 · 04/19 22:00' },
    miles: 660,  rate: '$2,150.00', emailDomainTld: '.io',  phone: '(225) 555-0148' },
  { brand: 'KEYSTONE FREIGHTWAYS',   tagline: 'East Coast Specialists',           mc: 'MC-329•••', dot: 'DOT-1184•••', loadId: 'RC-2026-0912', date: '04/14/2026',
    pickup:   { name: 'Beacon Industrial Parts',      line: 'Pittsburgh, PA 15203 · 04/15 08:45' },
    delivery: { name: 'Riverbend Assembly Plant',     line: 'Detroit, MI 48207 · 04/15 19:30' },
    miles: 290,  rate: '$1,180.00', emailDomainTld: '.us',  phone: '(412) 555-0780' },
  { brand: 'PACIFIC TIDE LOGISTICS', tagline: 'Port-to-Door Service',             mc: 'MC-671•••', dot: 'DOT-2998•••', loadId: 'RC-2026-1505', date: '04/20/2026',
    pickup:   { name: 'Long Beach Port Terminal 7',   line: 'Long Beach, CA 90802 · 04/21 04:00' },
    delivery: { name: 'High Desert Distribution',     line: 'Las Vegas, NV 89030 · 04/21 21:00' },
    miles: 270,  rate: '$1,640.00', emailDomainTld: '.net', phone: '(562) 555-0974' },
  { brand: 'CARDINAL LANE EXPRESS',  tagline: 'Premium Dry Van Carrier',          mc: 'MC-847•••', dot: 'DOT-3461•••', loadId: 'RC-2026-2208', date: '04/13/2026',
    pickup:   { name: 'Bluegrass Beverage Co.',       line: 'Louisville, KY 40202 · 04/14 06:00' },
    delivery: { name: 'Carolina Wholesale Foods',     line: 'Charlotte, NC 28208 · 04/14 21:00' },
    miles: 525,  rate: '$1,775.00', emailDomainTld: '.com', phone: '(502) 555-0231' },
  { brand: 'RIDGELINE BROKERAGE',    tagline: 'Mountain West Logistics',          mc: 'MC-226•••', dot: 'DOT-1438•••', loadId: 'RC-2026-0677', date: '04/16/2026',
    pickup:   { name: 'Northern Lumber Mills',        line: 'Boise, ID 83702 · 04/17 07:30' },
    delivery: { name: 'Wasatch Building Center',      line: 'Salt Lake City, UT 84104 · 04/18 10:00' },
    miles: 350,  rate: '$1,450.00', emailDomainTld: '.co',  phone: '(208) 555-0589' },
];

// Replace every letter with • but keep word breaks, so the redacted name
// has the same visual rhythm as a real letterhead without leaking any text.
function blurName(s: string): string {
  return s.replace(/[A-Za-z]/g, '•');
}

function RateConMockup() {
  // Randomize on mount only (avoids SSR/CSR mismatch warnings).
  const [idx, setIdx] = useState<number | null>(null);
  useEffect(() => {
    setIdx(Math.floor(Math.random() * RATE_CON_TEMPLATES.length));
  }, []);
  const s = RATE_CON_TEMPLATES[idx ?? 0];
  return (
    <div className="relative">
      <div className="absolute -top-3 left-8 z-10 px-3 py-1 bg-[#FF6B35] text-white text-xs mono uppercase tracking-wider rounded-full">
        The bait
      </div>
      <div className="bg-white rounded-2xl p-7 relative overflow-hidden card-shadow-lg text-[#0B1E3F]" style={{ aspectRatio: '8.5/11', maxHeight: '580px' }}>
        <div className="absolute left-0 right-0 h-16 pointer-events-none scan-line" style={{ background: 'linear-gradient(180deg, transparent, rgba(255,107,53,0.25), transparent)' }} />
        <div className="relative text-[#0B1E3F]">
          <div className="flex items-center justify-between pb-4 border-b-2 border-[#0B1E3F]/20 mb-4">
            <div className="text-[#0B1E3F]">
              <div className="text-xl font-bold tracking-tight text-[#0B1E3F]">{blurName(s.brand)}</div>
              <div className="text-xs mono text-[#0B1E3F]/60">{s.tagline}</div>
            </div>
            <div className="text-right text-xs mono text-[#0B1E3F]/70">
              <div>{s.mc}</div>
              <div>{s.dot}</div>
            </div>
          </div>
          <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-3">RATE CONFIRMATION</div>
          <div className="space-y-3 text-sm text-[#0B1E3F]">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-[#0B1E3F]/60 mb-0.5">Load #</div>
                <div className="mono font-medium text-[#0B1E3F]">{s.loadId}</div>
              </div>
              <div>
                <div className="text-xs text-[#0B1E3F]/60 mb-0.5">Date</div>
                <div className="mono font-medium text-[#0B1E3F]">{s.date}</div>
              </div>
            </div>
            <div className="p-3 rounded text-[#0B1E3F]" style={{ backgroundColor: 'rgba(11,30,63,0.05)' }}>
              <div className="text-xs text-[#0B1E3F]/60 mb-1">PICKUP</div>
              <div className="font-medium text-[#0B1E3F]">{s.pickup.name}</div>
              <div className="text-xs mono text-[#0B1E3F]/70">{s.pickup.line}</div>
            </div>
            <div className="p-3 rounded text-[#0B1E3F]" style={{ backgroundColor: 'rgba(11,30,63,0.05)' }}>
              <div className="text-xs text-[#0B1E3F]/60 mb-1">DELIVERY</div>
              <div className="font-medium text-[#0B1E3F]">{s.delivery.name}</div>
              <div className="text-xs mono text-[#0B1E3F]/70">{s.delivery.line}</div>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <div>
                <div className="text-xs text-[#0B1E3F]/60">Miles</div>
                <div className="mono text-[#0B1E3F]">{s.miles}</div>
              </div>
              <div>
                <div className="text-xs text-[#0B1E3F]/60">Rate</div>
                <div className="mono font-bold text-lg text-[#0B1E3F]">{s.rate}</div>
              </div>
            </div>
            <div className="pt-4 mt-4 border-t border-[#0B1E3F]/15 text-xs text-[#0B1E3F]">
              <div className="text-[#0B1E3F]/60 mb-1">Contact</div>
              <div className="mono text-[#0B1E3F]">dispatch@••••••••••{s.emailDomainTld}</div>
              <div className="mono text-[#0B1E3F]/70">{s.phone}</div>
            </div>
          </div>
          <div className="absolute top-28 -right-2 flex items-center gap-2 px-2 py-1 bg-[#DC2626] text-white text-xs mono rounded-full">
            <XCircle className="w-3 h-3 text-white" /> spoofed
          </div>
          {/* Anchored to the email-row bottom of the mockup. Was at
              bottom-20, which overlapped the rate dollar amount on shorter
              cards — bottom-8 sits cleanly next to the "Contact" block. */}
          <div className="absolute bottom-8 -right-2 flex items-center gap-2 px-2 py-1 bg-[#DC2626] text-white text-xs mono rounded-full">
            <XCircle className="w-3 h-3 text-white" /> wrong domain
          </div>
        </div>
      </div>
    </div>
  );
}

function BigStat({ value, label }: any) {
  return (
    <div className="text-center text-[#0B1E3F]">
      <div className="serif italic text-5xl md:text-6xl text-[#0B1E3F] mb-2">{value}</div>
      <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60">{label}</div>
    </div>
  );
}

function RoleCard({ icon: Icon, accent, role, tagline, points, cta, onClick }: {
  icon: any;
  accent: string;
  role: string;
  tagline: string;
  points: string[];
  cta: string;
  onClick: () => void;
}) {
  return (
    <div className="bg-white border border-[#0B1E3F]/10 rounded-2xl p-7 card-shadow flex flex-col text-[#0B1E3F] hover:border-[#0B1E3F]/25 transition">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${accent}1A`, color: accent }}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <div className="text-[10px] mono uppercase tracking-[0.18em] text-[#0B1E3F]/55">For</div>
          <div className="text-lg font-semibold text-[#0B1E3F] leading-tight">{role}</div>
        </div>
      </div>
      <div className="serif italic text-xl leading-snug text-[#0B1E3F] mb-5">{tagline}</div>
      <ul className="space-y-3 flex-1 mb-6">
        {points.map((p, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm leading-relaxed text-[#0B1E3F]/75">
            <span className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: accent }} />
            <span>{p}</span>
          </li>
        ))}
      </ul>
      <button
        onClick={onClick}
        className="w-full px-5 py-2.5 rounded-full text-sm font-semibold text-white transition flex items-center justify-center gap-2 hover:opacity-90"
        style={{ backgroundColor: accent }}
      >
        {cta} <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
}

function FeatureCard({ icon: Icon, iconBg, title, desc, stat, statLabel }: any) {
  return (
    <div className="group relative p-7 bg-white border border-[#0B1E3F]/10 rounded-2xl hover:border-[#0B1E3F]/20 transition card-shadow overflow-hidden text-[#0B1E3F]">
      <div className="absolute top-0 right-0 w-32 h-32 opacity-[0.03] pointer-events-none">
        <Icon className="w-full h-full text-[#0B1E3F]" />
      </div>
      <div className="relative">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-6" style={{ backgroundColor: iconBg }}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        <div className="text-xl font-semibold text-[#0B1E3F] mb-3">{title}</div>
        <div className="text-[#0B1E3F]/60 text-sm leading-relaxed mb-6 min-h-[3rem]">{desc}</div>
        <div className="pt-5 border-t border-[#0B1E3F]/10 flex items-end justify-between">
          <div>
            <div className="serif text-4xl italic" style={{ color: iconBg }}>{stat}</div>
            <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/50 mt-1">{statLabel}</div>
          </div>
          <ArrowRight className="w-5 h-5 text-[#0B1E3F]/30 group-hover:text-[#0B1E3F] group-hover:translate-x-1 transition" />
        </div>
      </div>
    </div>
  );
}

function PriceCard({ tier, price, annual, desc, features, popular, cta, onClick }: any) {
  if (popular) {
    return (
      <div className="relative p-7 rounded-2xl border bg-white text-[#0B1E3F] border-[#FF6B35] lg:scale-105 card-shadow-lg">
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-[#FF6B35] text-white text-xs mono uppercase tracking-wider rounded-full">Most popular</div>
        <div className="text-sm uppercase tracking-wider mb-2 text-[#0B1E3F]/60">{tier}</div>
        <div className="flex items-baseline gap-1">
          <div className="serif italic text-5xl text-[#0B1E3F]">{price}</div>
          <div className="text-[#0B1E3F]/60">/mo</div>
        </div>
        {annual && annual !== '$0' && <div className="text-xs mono text-[#16A34A] mb-2">or {annual}/yr</div>}
        {(!annual || annual === '$0') && <div className="mb-2" />}
        <div className="text-sm mb-6 text-[#0B1E3F]/70">{desc}</div>
        <button onClick={onClick} className="w-full py-3 rounded-full font-medium mb-6 transition bg-[#0B1E3F] text-white hover:bg-[#0B1E3F]/90">{cta}</button>
        <div className="space-y-2.5">
          {features.map((f: string, i: number) => (
            <div key={i} className="flex items-center gap-2.5 text-sm text-[#0B1E3F]">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-[#16A34A]" /> {f}
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="relative p-7 rounded-2xl border bg-white/10 border-white/20 text-white backdrop-blur">
      <div className="text-sm uppercase tracking-wider mb-2 text-white/70">{tier}</div>
      <div className="flex items-baseline gap-1">
        <div className="serif italic text-5xl text-white">{price}</div>
        <div className="text-white/70">/mo</div>
      </div>
      {annual && annual !== '$0' && <div className="text-xs mono text-[#FF6B35] mb-2">or {annual}/yr</div>}
      {(!annual || annual === '$0') && <div className="mb-2" />}
      <div className="text-sm mb-6 text-white/80">{desc}</div>
      <button onClick={onClick} className="w-full py-3 rounded-full font-medium mb-6 transition bg-white text-[#0B1E3F] hover:bg-white/90">{cta}</button>
      <div className="space-y-2.5">
        {features.map((f: string, i: number) => (
          <div key={i} className="flex items-center gap-2.5 text-sm text-white">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-[#FF6B35]" /> {f}
          </div>
        ))}
      </div>
    </div>
  );
}

function Testimonial({ quote, name, role, location, initials, bg }: any) {
  return (
    <div className="bg-white rounded-2xl p-7 border border-[#0B1E3F]/10 card-shadow hover:card-shadow-lg transition text-[#0B1E3F]">
      <Quote className="w-8 h-8 text-[#FF6B35] mb-4" />
      <div className="text-[#0B1E3F] text-lg leading-snug mb-6 min-h-[5rem]">&ldquo;{quote}&rdquo;</div>
      <div className="flex items-center gap-3 pt-4 border-t border-[#0B1E3F]/10">
        <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm" style={{ backgroundColor: bg }}>
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[#0B1E3F] text-sm">{name}</div>
          <div className="text-xs text-[#0B1E3F]/60">{role} · {location}</div>
        </div>
      </div>
    </div>
  );
}

function FaqItem({ q, a }: any) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white border border-[#0B1E3F]/10 rounded-2xl overflow-hidden card-shadow text-[#0B1E3F]">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between p-5 text-left hover:bg-[#0B1E3F]/5 transition text-[#0B1E3F]">
        <div className="font-semibold text-[#0B1E3F]">{q}</div>
        <div className={`w-6 h-6 rounded-full bg-[#0B1E3F]/5 flex items-center justify-center transition ${open ? 'rotate-45' : ''}`}>
          <Plus className="w-3.5 h-3.5 text-[#0B1E3F]" />
        </div>
      </button>
      {open && <div className="px-5 pb-5 text-[#0B1E3F]/70 leading-relaxed" style={{ animation: 'fadeIn 0.3s ease-out' }}>{a}</div>}
    </div>
  );
}

function Nav({ navigate, user }: any) {
  const scrollTo = (id: string) => {
    const el = typeof document !== 'undefined' ? document.getElementById(id) : null;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      navigate('landing');
      setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    }
  };
  // Initial in the avatar circle. Falls back to first letter of email
  // when no name is set so we never render an empty bubble.
  const initial = (user?.name || user?.email || '?').trim().charAt(0).toUpperCase();
  return (
    <nav className="sticky top-0 z-50 bg-[#F5F3EE] border-b border-[#0B1E3F]/10 text-[#0B1E3F]">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        {/* Logo always sends the user back to the marketing home. Used to
            be an unwrapped <Logo /> which felt broken on /blog, /about,
            /terms, /privacy etc. — the standard convention every
            user expects. */}
        <button onClick={() => { navigate('landing'); setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 60); }} aria-label="Haulock home" className="hover:opacity-80 transition">
          <Logo />
        </button>
        <div className="hidden md:flex items-center gap-8 text-sm text-[#0B1E3F]/70">
          <button onClick={() => { navigate('landing'); setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 60); }} className="hover:text-[#0B1E3F]">Home</button>
          <button onClick={() => scrollTo('product')} className="hover:text-[#0B1E3F]">What we check</button>
          <button onClick={() => scrollTo('pricing')} className="hover:text-[#0B1E3F]">Pricing</button>
          <button onClick={() => navigate('blog')} className="hover:text-[#0B1E3F]">Blog</button>
        </div>
        <div className="flex items-center gap-2">
          {user ? (
            <button
              onClick={() => navigate('dashboard')}
              className="flex items-center gap-2 pl-1.5 pr-3 py-1 bg-white border border-[#0B1E3F]/15 hover:border-[#0B1E3F]/30 rounded-full transition card-shadow"
              title={`Open dashboard (${user.email})`}
            >
              <div className="w-7 h-7 rounded-full bg-[#0B1E3F] text-white flex items-center justify-center mono text-xs font-semibold">
                {initial}
              </div>
              <div className="text-left leading-tight hidden sm:block">
                <div className="text-[11px] mono text-[#0B1E3F]/55 uppercase tracking-wider">Signed in</div>
                <div className="text-xs font-semibold text-[#0B1E3F] max-w-[160px] truncate">{user.name || user.email}</div>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-[#0B1E3F]/45 hidden sm:inline" />
            </button>
          ) : (
            <>
              <button onClick={() => navigate('login')} className="px-4 py-2 text-sm text-[#0B1E3F]/70 hover:text-[#0B1E3F]">Log in</button>
              <button onClick={() => navigate('signup')} className="px-4 py-2 bg-[#0B1E3F] text-white text-sm rounded-full hover:bg-[#0B1E3F]/90 transition">Get started</button>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}

function Logo({ white }: any) {
  return (
    <img
      src="/haulock-logo.png"
      alt="Haulock"
      className="h-10 w-auto object-contain"
      style={white ? { filter: 'brightness(0) invert(1)' } : undefined}
    />
  );
}

function NewsletterSignup() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'ok' | 'already' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === 'sending') return;
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setStatus('error');
      setMessage('Enter a valid email address.');
      return;
    }
    setStatus('sending'); setMessage(null);
    try {
      const r = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error || 'Could not subscribe. Try again in a minute.');
      if (j?.alreadyExisted) {
        setStatus('already');
        setMessage('You are already on the list. The next briefing arrives Thursday.');
      } else {
        setStatus('ok');
        setMessage('You are on the list. Watch your inbox every Thursday.');
        track('newsletter_subscribed');
      }
      setEmail('');
    } catch (err: any) {
      setStatus('error');
      setMessage(err?.message || 'Could not subscribe. Try again in a minute.');
    }
  };

  return (
    <section className="px-6 py-20 bg-[#0B1E3F] border-t border-[#0B1E3F]/10 text-white">
      <div className="max-w-3xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-xs mono uppercase tracking-wider text-white/80 mb-6">
          <Mail className="w-3.5 h-3.5" /> Free weekly newsletter
        </div>
        <h2 className="text-4xl md:text-6xl serif italic leading-[1.05] mb-5">
          Know what scams are hitting the industry this week.
        </h2>
        <p className="text-lg text-white/70 max-w-2xl mx-auto mb-10">
          Every Thursday we send a short briefing on the freight fraud we are seeing across Haulock and the wider industry: new identity tricks, double-brokering patterns, rate con scams, and what to watch out for before you book a load. No fluff, no spam. One email a week.
        </p>
        <form onSubmit={submit} className="flex flex-col sm:flex-row gap-3 max-w-xl mx-auto">
          <input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); if (status !== 'idle') { setStatus('idle'); setMessage(null); } }}
            placeholder="you@yourcarrier.com"
            disabled={status === 'sending'}
            className="flex-1 px-5 py-3.5 rounded-full bg-white text-[#0B1E3F] placeholder:text-[#0B1E3F]/40 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF6B35] disabled:opacity-60"
            aria-label="Email address"
          />
          <button
            type="submit"
            disabled={status === 'sending'}
            className="px-7 py-3.5 rounded-full bg-[#FF6B35] text-white text-sm font-semibold hover:bg-[#FF6B35]/90 transition flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {status === 'sending' ? (
              <><div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Subscribing…</>
            ) : (
              <>Get the briefing <ArrowRight className="w-4 h-4" /></>
            )}
          </button>
        </form>
        {message && (
          <div className={`mt-4 text-sm ${status === 'ok' ? 'text-[#16A34A]' : status === 'already' ? 'text-white/85' : 'text-[#FF6B35]'}`}>{message}</div>
        )}
        <div className="mt-6 text-xs text-white/50">
          One short email every Thursday. Unsubscribe with one click, anytime.
        </div>
      </div>
    </section>
  );
}

function Footer({ navigate }: any) {
  // Each item is { label, route?, data?, href? }. `route` triggers in-app
  // navigation (no full page reload, optional `data` payload like the
  // VerifyTool tab or a Landing scroll target). `href` is for plain mailtos
  // / external links / Next.js routes that live outside the SPA shell.
  type Col = { t: string; items: { label: string; route?: string; data?: any; href?: string }[] };
  const cols: Col[] = [
    { t: 'Product', items: [
      { label: 'Broker verify',      route: 'verify',  data: { tab: 'quick' } },
      { label: 'Rate con analyzer',  route: 'verify',  data: { tab: 'ratecon' } },
      { label: 'Community network',  route: 'reports' },
      { label: 'API',                href: '/docs/api' },
    ] },
    { t: 'Company', items: [
      { label: 'About',    route: 'about' },
      { label: 'Blog',     route: 'blog' },
      { label: 'Contact',  href: 'mailto:contact@haulock.com' },
    ] },
    { t: 'Legal', items: [
      { label: 'Terms of Use',    route: 'terms' },
      { label: 'Privacy Policy',  route: 'privacy' },
    ] },
  ];
  const go = (route: string, data?: any) => {
    if (typeof navigate === 'function') navigate(route, data);
    else if (typeof window !== 'undefined') window.location.href = `/${route}`;
  };
  return (
    <footer className="bg-[#0B1E3F] text-white px-6 pt-20 pb-10">
      <div className="max-w-7xl mx-auto">
        <div className="grid md:grid-cols-5 gap-12 pb-12 border-b border-white/10">
          <div className="md:col-span-2">
            <button onClick={() => go('landing')} aria-label="Haulock home" className="hover:opacity-80 transition w-fit">
              <Logo white />
            </button>
            <div className="text-sm text-white/70 mt-4 max-w-xs">Know who&apos;s on the other end of every rate con. Trusted by 4,200+ carriers.</div>
          </div>
          {cols.map((col, i) => (
            <div key={i}>
              <div className="text-xs mono uppercase tracking-wider text-white/50 mb-4">{col.t}</div>
              <div className="space-y-2.5 text-sm text-white/90">
                {col.items.map((item, j) => {
                  if (item.route) {
                    return (
                      <button
                        key={j}
                        type="button"
                        onClick={() => go(item.route!, item.data)}
                        className="block text-left hover:text-white text-white/90"
                      >
                        {item.label}
                      </button>
                    );
                  }
                  if (item.href) {
                    return (
                      <a
                        key={j}
                        href={item.href}
                        className="block hover:text-white text-white/90"
                      >
                        {item.label}
                      </a>
                    );
                  }
                  return <div key={j} className="hover:text-white cursor-default text-white/60" title="Coming soon">{item.label}</div>;
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pt-8">
          <div className="text-sm text-white/50">© 2026 Haulock, Inc. All rights reserved.</div>
          <div className="flex items-center gap-4 text-xs mono text-white/50">
            <span className="flex items-center gap-2"><ShieldCheck className="w-3.5 h-3.5" /> SOC 2 Type II</span>
            <span>·</span>
            <span>FMCSA authorized</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

// Small "Last used" pill anchored to the top-right of the auth button
// it sits inside. The parent wrapper must have `position: relative`.
function LastUsedBadge() {
  return (
    <div
      className="absolute -top-2 right-3 px-2 py-0.5 rounded-full bg-[#16A34A] text-white text-[10px] mono uppercase tracking-wider font-semibold flex items-center gap-1 shadow-sm pointer-events-none"
      aria-label="Last sign-in method on this device"
    >
      <CheckCircle2 className="w-3 h-3" />
      Last used
    </div>
  );
}

function Login({ navigate, loginAs }: any) {
  const [mode, setMode] = useState<'signin' | 'forgot'>('signin');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const configured = isSupabaseConfigured();

  // "Last used" hint, driven by localStorage. Written by the main auth
  // state listener after a successful sign-in, so what shows here is the
  // method Supabase actually accepted last — not whichever button was
  // clicked. Falls back gracefully when the storage entry is missing
  // (first visit, browser cleared, private mode, etc.).
  const [lastProvider, setLastProvider] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { setLastProvider(localStorage.getItem('haulock:lastAuthProvider')); } catch {}
    // Surface auth errors bounced in from /auth/callback (OAuth + magic links).
    // Strip the param from the URL so a refresh doesn't re-show the message.
    try {
      const params = new URLSearchParams(window.location.search);
      const authErr = params.get('auth_error');
      if (authErr) {
        setError(authErr);
        params.delete('auth_error');
        const clean = window.location.pathname + (params.toString() ? `?${params}` : '') + window.location.hash;
        window.history.replaceState({}, '', clean);
      }
    } catch {}
  }, []);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null); setInfo(null);
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get('email') || '').trim();
    const password = String(fd.get('password') || '');
    if (!email || !password) { setError('Enter your email and password.'); return; }
    if (!configured) { loginAs(); return; }
    setLoading(true);
    const sb = getSupabase()!;
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) { setError(error.message); return; }
    const redirect = consumePostLoginRedirect();
    if (redirect) {
      navigate(pathToRoute(redirect));
      return;
    }
    const plan = data.user?.user_metadata?.plan;
    navigate(plan ? 'dashboard' : 'plan');
  };

  const onForgot = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null); setInfo(null);
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get('email') || '').trim();
    if (!email) { setError('Enter your email.'); return; }
    if (!configured) { setInfo('Demo mode — password reset is disabled.'); return; }
    setLoading(true);
    const sb = getSupabase()!;
    const site = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${site}/auth/reset` });
    setLoading(false);
    if (error) { setError(error.message); return; }
    setInfo('Check your inbox for a password reset link.');
  };

  const onGoogle = async () => {
    if (!configured) { loginAs(); return; }
    const sb = getSupabase()!;
    const site = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
    // Thread the gated page through `?next=` so the server callback can
    // redirect there after exchanging the code for a session.
    const next = peekPostLoginRedirect();
    const callback = `${site}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ''}`;
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callback },
    });
    if (error) setError(error.message);
  };

  if (mode === 'forgot') {
    return (
      <AuthShell title="Reset password" subtitle="Enter your email and we'll send you a reset link." navigate={navigate}>
        <form onSubmit={onForgot} className="space-y-4">
          <Field label="Email" name="email" type="email" placeholder="you@company.com" autoComplete="email" required />
          {error && <div className="text-sm text-[#DC2626]">{error}</div>}
          {info && <div className="text-sm text-[#16A34A]">{info}</div>}
          {!configured && <div className="text-xs mono text-[#F59E0B]">Demo mode — set Supabase env vars to enable password reset.</div>}
          <button type="submit" disabled={loading} className="w-full py-3.5 bg-[#0B1E3F] text-white rounded-full font-medium hover:bg-[#0B1E3F]/90 transition card-shadow disabled:opacity-60">
            {loading ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
        <div className="text-center text-sm text-[#0B1E3F]/60 mt-6">
          <button onClick={() => { setMode('signin'); setError(null); setInfo(null); }} className="text-[#0B1E3F] font-medium hover:underline">← Back to log in</button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Welcome back" subtitle="Log in to verify brokers and protect your loads." navigate={navigate}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Email" name="email" type="email" placeholder="you@company.com" autoComplete="email" required />
        <Field label="Password" name="password" type="password" placeholder="••••••••" autoComplete="current-password" required />
        <div className="flex items-center justify-between text-sm">
          <label className="flex items-center gap-2 text-[#0B1E3F]/70"><input type="checkbox" className="rounded" /> Remember me</label>
          <button type="button" onClick={() => { setMode('forgot'); setError(null); setInfo(null); }} className="text-[#0B1E3F] hover:underline">Forgot password?</button>
        </div>
        {error && <div className="text-sm text-[#DC2626]">{error}</div>}
        {info && <div className="text-sm text-[#16A34A]">{info}</div>}
        {!configured && <div className="text-xs mono text-[#F59E0B]">Demo mode — set Supabase env vars to enable real auth.</div>}
        <div className="relative">
          <button type="submit" disabled={loading} className="w-full py-3.5 bg-[#0B1E3F] text-white rounded-full font-medium hover:bg-[#0B1E3F]/90 transition card-shadow disabled:opacity-60">
            {loading ? 'Logging in…' : 'Log in'}
          </button>
          {lastProvider === 'email' && (
            <LastUsedBadge />
          )}
        </div>
      </form>
      <Divider />
      <div className="relative">
        <button type="button" onClick={onGoogle} className="w-full py-3.5 border border-[#0B1E3F]/20 rounded-full font-medium text-[#0B1E3F] hover:bg-[#0B1E3F]/5 flex items-center justify-center gap-3 bg-white">
          <GoogleIcon /> Continue with Google
        </button>
        {lastProvider === 'google' && (
          <LastUsedBadge />
        )}
      </div>
      <div className="text-center text-sm text-[#0B1E3F]/60 mt-6">
        Don&apos;t have an account? <button onClick={() => navigate('signup')} className="text-[#0B1E3F] font-medium hover:underline">Sign up</button>
      </div>
    </AuthShell>
  );
}

function Signup({ navigate, loginAs }: any) {
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const configured = isSupabaseConfigured();

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null); setInfo(null);
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get('name') || '').trim();
    const company = String(fd.get('company') || '').trim();
    const email = String(fd.get('email') || '').trim();
    const password = String(fd.get('password') || '');
    if (!email || !password) { setError('Email and password are required.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (!configured) { loginAs(); return; }
    setLoading(true);
    const sb = getSupabase()!;
    const site = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name, company, plan: 'free' },
        emailRedirectTo: `${site}/auth/callback`,
      },
    });
    setLoading(false);
    if (error) { setError(error.message); return; }
    if (data.session) {
      fetch('/api/email/welcome', { method: 'POST' }).catch(() => {});
      const redirect = consumePostLoginRedirect();
      navigate(redirect ? pathToRoute(redirect) : 'plan');
    } else {
      setInfo('Check your email to confirm your account.');
    }
  };

  const onGoogle = async () => {
    if (!configured) { loginAs(); return; }
    const sb = getSupabase()!;
    const site = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
    const next = peekPostLoginRedirect();
    const callback = `${site}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ''}`;
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callback },
    });
    if (error) setError(error.message);
  };

  return (
    <AuthShell title="Start free" subtitle="3 broker / carrier lookups per month. No credit card required." navigate={navigate}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Full name" name="name" placeholder="Your name" autoComplete="name" />
        <Field label="Company name" name="company" placeholder="Your trucking company" autoComplete="organization" />
        <Field label="Email" name="email" type="email" placeholder="you@company.com" autoComplete="email" required />
        <Field label="Password" name="password" type="password" placeholder="At least 8 characters" autoComplete="new-password" required />
        {error && <div className="text-sm text-[#DC2626]">{error}</div>}
        {info && <div className="text-sm text-[#16A34A]">{info}</div>}
        {!configured && <div className="text-xs mono text-[#F59E0B]">Demo mode — set Supabase env vars to enable real signup.</div>}
        <button type="submit" disabled={loading} className="w-full py-3.5 bg-[#0B1E3F] text-white rounded-full font-medium hover:bg-[#0B1E3F]/90 transition card-shadow disabled:opacity-60">
          {loading ? 'Creating…' : 'Create free account'}
        </button>
      </form>
      <Divider />
      <button type="button" onClick={onGoogle} className="w-full py-3.5 border border-[#0B1E3F]/20 rounded-full font-medium text-[#0B1E3F] hover:bg-[#0B1E3F]/5 flex items-center justify-center gap-3 bg-white">
        <GoogleIcon /> Sign up with Google
      </button>
      <div className="text-center text-sm text-[#0B1E3F]/60 mt-6">
        Already have an account? <button onClick={() => navigate('login')} className="text-[#0B1E3F] font-medium hover:underline">Log in</button>
      </div>
    </AuthShell>
  );
}

// Pool of authentic-sounding social-proof quotes shown on the auth shell's
// left rail. One is picked at random each time the user lands on /login,
// /signup, or /password-reset. Keep them short, specific, and naming a
// real-feeling outcome (dollar figure, freight tactic, time saved). No
// em-dashes (brand rule).
const AUTH_TESTIMONIALS: Array<{
  quote: string;
  name: string;
  role: string;
  location: string;
  initials: string;
}> = [
  {
    quote: 'Haulock caught a double-broker scam before I hooked the trailer. Saved me $8,400 on a single load.',
    name: 'Jamie Thompson',
    role: 'Owner-operator',
    location: 'Kansas City, MO',
    initials: 'JT',
  },
  {
    quote: 'I verify every broker now. Used to take 20 minutes of Googling. Now it is 3 seconds. Worth every penny.',
    name: 'Dee Washington',
    role: 'Dispatcher · 14 trucks',
    location: 'Atlanta, GA',
    initials: 'DW',
  },
  {
    quote: 'Got a scam alert on a broker on my watchlist at 11pm. Cancelled the load next morning. Paid for a full year in one night.',
    name: 'Carlos Mendoza',
    role: 'Owner · Reynolds Transport',
    location: 'Phoenix, AZ',
    initials: 'CM',
  },
  {
    quote: 'Caught a spoofed rate con with a one-letter domain swap. Driver was already on the way to pickup. Stopped a $12k loss flat.',
    name: 'Priya Shah',
    role: 'Operations manager',
    location: 'Newark, NJ',
    initials: 'PS',
  },
  {
    quote: 'The PDF analyzer flagged that my dispatcher had edited a rate con. He was skimming the spread on every load. Fired him the same day.',
    name: 'Marcus Lee',
    role: 'Owner · Lee Trucking',
    location: 'Houston, TX',
    initials: 'ML',
  },
  {
    quote: 'I am a broker. I use Haulock to vet carriers before I tender. The chameleon-MC checks alone caught two impersonators in my first month.',
    name: 'Sarah Klein',
    role: 'Freight broker',
    location: 'Chicago, IL',
    initials: 'SK',
  },
  {
    quote: 'My fleet runs 28 trucks. The watchlist alerts hit my inbox the moment a broker on our books goes sideways. No more chasing factor disputes.',
    name: 'Tony Russo',
    role: 'Fleet manager · 28 trucks',
    location: 'Cleveland, OH',
    initials: 'TR',
  },
  {
    quote: 'Spent years getting burned on small claims. Haulock pays for itself if it stops one bad load a year. It stops three.',
    name: 'Lena Ortega',
    role: 'Owner-operator',
    location: 'Albuquerque, NM',
    initials: 'LO',
  },
  {
    quote: 'The community fraud reports are the killer feature. I see what other carriers got burned on before I ever sign the rate con.',
    name: 'Kevin Doyle',
    role: 'Owner · Doyle Logistics',
    location: 'Boise, ID',
    initials: 'KD',
  },
];

function RequireAuth({ navigate }: any) {
  // Capture the gated path on mount so login / signup / OAuth all bring the
  // user back here. Stored in sessionStorage (per-tab) so an unrelated tab
  // can't hijack the redirect.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const path = window.location.pathname + window.location.search + window.location.hash;
      sessionStorage.setItem(POST_LOGIN_REDIRECT_KEY, path);
    } catch {}
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <Nav navigate={navigate} user={null} />
      <div className="flex-1 flex items-center justify-center px-6 py-16 relative overflow-hidden">
        <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-[#FF6B35]/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-2xl bg-[#0B1E3F] flex items-center justify-center mx-auto mb-6 card-shadow">
            <Lock className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl md:text-4xl serif text-[#0B1E3F] mb-3">Sign in to continue</h1>
          <p className="text-[#0B1E3F]/60 mb-8">
            You need an account to view this page. Log in and we&apos;ll bring you right back here.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={() => navigate('login')}
              className="px-6 py-3.5 bg-[#0B1E3F] text-white rounded-full font-medium hover:bg-[#0B1E3F]/90 transition card-shadow"
            >
              Log in
            </button>
            <button
              onClick={() => navigate('signup')}
              className="px-6 py-3.5 border border-[#0B1E3F]/20 rounded-full font-medium text-[#0B1E3F] hover:bg-[#0B1E3F]/5 bg-white transition"
            >
              Create free account
            </button>
          </div>
          <button
            onClick={() => navigate('landing')}
            className="mt-6 text-sm text-[#0B1E3F]/60 hover:text-[#0B1E3F]"
          >
            ← Back to home
          </button>
        </div>
      </div>
    </div>
  );
}

function AuthShell({ title, subtitle, children, navigate }: any) {
  // We pick a testimonial randomly per page load, but Math.random() runs
  // on both the server and the client and would return different values,
  // which trips React's hydration check. So we render the FIRST entry
  // (deterministic) on the initial render and let useEffect swap to a
  // random one on the client only. The user sees a brief flash of #0
  // followed by a fresh quote, which is a much better UX than a hydration
  // error or a blank panel.
  const [testimonial, setTestimonial] = useState(AUTH_TESTIMONIALS[0]);
  useEffect(() => {
    const i = Math.floor(Math.random() * AUTH_TESTIMONIALS.length);
    setTestimonial(AUTH_TESTIMONIALS[i]);
  }, []);
  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <div className="md:w-1/2 bg-[#0B1E3F] text-white p-8 md:p-16 flex flex-col justify-between relative overflow-hidden">
        <div className="absolute inset-0 grid-bg-dark opacity-60" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-[#FF6B35]/20 rounded-full blur-3xl" />
        <button onClick={() => navigate('landing')} className="relative z-10 w-fit"><Logo white /></button>
        <div className="relative z-10 max-w-md">
          <div className="flex items-center gap-1 mb-4">
            {[1,2,3,4,5].map(i => <Star key={i} className="w-4 h-4 fill-[#FF6B35] text-[#FF6B35]" />)}
          </div>
          <div className="text-xs mono uppercase tracking-[0.2em] text-[#FF6B35] mb-4">— Trusted by 4,200+ carriers</div>
          <div className="text-3xl md:text-4xl serif italic leading-tight mb-6 text-white">
            &ldquo;{testimonial.quote}&rdquo;
          </div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#FF6B35] flex items-center justify-center font-semibold text-white">{testimonial.initials}</div>
            <div>
              <div className="text-sm font-medium text-white">{testimonial.name}</div>
              <div className="text-xs text-white/70">{testimonial.role} · {testimonial.location}</div>
            </div>
          </div>
        </div>
        <div className="relative z-10 text-xs mono text-white/60 flex items-center gap-3">
          <ShieldCheck className="w-4 h-4" /> SOC 2 Type II · FMCSA authorized
        </div>
      </div>
      <div className="md:w-1/2 flex items-center justify-center p-8 md:p-16 bg-[#F5F3EE] relative text-[#0B1E3F]">
        <div className="absolute inset-0 grid-bg opacity-30" />
        <div className="relative w-full max-w-md text-[#0B1E3F]">
          <h1 className="text-4xl text-[#0B1E3F] mb-2">{title}</h1>
          <p className="text-[#0B1E3F]/60 mb-8">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

function Field({ label, name, type = 'text', placeholder, defaultValue, required, autoComplete }: any) {
  return (
    <div>
      <label className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 block mb-2">{label}</label>
      <input name={name} type={type} placeholder={placeholder} defaultValue={defaultValue} required={required} autoComplete={autoComplete} className="w-full px-4 py-3 bg-white border border-[#0B1E3F]/15 rounded-xl focus:outline-none focus:border-[#0B1E3F] transition text-[#0B1E3F] placeholder:text-[#0B1E3F]/30" />
    </div>
  );
}

function Divider() {
  return (
    <div className="flex items-center gap-4 my-6">
      <div className="flex-1 h-px bg-[#0B1E3F]/15" />
      <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/40">or</div>
      <div className="flex-1 h-px bg-[#0B1E3F]/15" />
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24">
      <path fill="#4285f4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34a853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#fbbc05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#ea4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}

function Pricing({ navigate, user }: any) {
  return (
    <div className="min-h-screen bg-[#F5F3EE] text-[#0B1E3F]">
      <Nav navigate={navigate} user={user} />
      <section className="py-24 px-6 relative bg-[#F5F3EE] text-[#0B1E3F]">
        <div className="absolute inset-0 radial-glow" />
        <div className="relative max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <div className="text-xs mono uppercase tracking-[0.2em] text-[#FF6B35] mb-4">— Pricing</div>
            <h1 className="text-5xl md:text-7xl serif italic text-[#0B1E3F] mb-4">Simple, fair pricing.</h1>
            <p className="text-xl text-[#0B1E3F]/60 max-w-2xl mx-auto">One prevented scam pays for 3 years. Start free, upgrade when you need more.</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5 max-w-7xl mx-auto">
            {Object.values(PLANS).map((p) => (
              <div key={p.id} className={`relative p-7 rounded-2xl border bg-white text-[#0B1E3F] flex flex-col ${p.popular ? 'border-[#FF6B35] lg:scale-105 card-shadow-lg' : 'border-[#0B1E3F]/10 card-shadow'}`}>
                {p.popular && <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-[#FF6B35] text-white text-xs mono uppercase tracking-wider rounded-full">Most popular</div>}
                <div className="text-sm uppercase tracking-wider mb-2 text-[#0B1E3F]/60">{p.label}</div>
                <div className="flex items-baseline gap-1">
                  <div className="text-5xl serif italic text-[#0B1E3F]">{p.price}</div>
                  <div className="text-[#0B1E3F]/60">/mo</div>
                </div>
                {p.priceAnnualNum > 0
                  ? <div className="text-xs mono text-[#16A34A] mb-2">or {p.priceAnnual}/yr (save 2 months)</div>
                  : <div className="mb-2" />}
                <div className="text-sm mb-6 text-[#0B1E3F]/70">{p.desc}</div>
                <button onClick={() => navigate('signup')} className="w-full py-3 rounded-full font-medium mb-6 bg-[#0B1E3F] text-white hover:bg-[#0B1E3F]/90 transition">{p.id === 'free' ? 'Start free' : `Choose ${p.label}`}</button>
                <div className="space-y-2.5 flex-1">
                  {p.features.map((f, j) => <div key={j} className="flex items-start gap-2 text-sm text-[#0B1E3F]"><CheckCircle2 className="w-4 h-4 text-[#16A34A] flex-shrink-0 mt-0.5" />{f}</div>)}
                </div>
              </div>
            ))}
          </div>
          <div className="text-center mt-6 text-[#0B1E3F]/60 text-xs mono">All paid plans: monthly or annual (save 2 months). Cancel anytime. No card required for Free.</div>
        </div>
      </section>
      <Footer navigate={navigate} />
    </div>
  );
}

function LegalPage({ page, navigate, user }: { page: 'terms' | 'privacy'; navigate: any; user?: any }) {
  const isTerms = page === 'terms';
  const lastUpdated = 'April 25, 2026';
  return (
    <div className="min-h-screen bg-[#F5F3EE] text-[#0B1E3F]">
      <Nav navigate={navigate} user={user} />
      <section className="py-20 px-6 relative bg-[#F5F3EE]">
        <div className="absolute inset-0 radial-glow pointer-events-none" />
        <div className="relative max-w-3xl mx-auto">
          <div className="text-xs mono uppercase tracking-[0.2em] text-[#FF6B35] mb-4">{isTerms ? 'Legal' : 'Privacy'}</div>
          <h1 className="text-4xl md:text-6xl serif italic text-[#0B1E3F] mb-3 leading-[1.05]">
            {isTerms ? 'Terms of Use' : 'Privacy Policy'}
          </h1>
          <p className="text-sm text-[#0B1E3F]/55 mono">Last updated: {lastUpdated}</p>
        </div>
      </section>
      <section className="px-6 pb-24">
        <div className="max-w-3xl mx-auto bg-white border border-[#0B1E3F]/10 rounded-2xl p-8 md:p-12 card-shadow">
          {isTerms ? <TermsContent /> : <PrivacyContent />}
          <div className="mt-10 pt-8 border-t border-[#0B1E3F]/10 flex flex-col sm:flex-row gap-3 justify-between text-sm text-[#0B1E3F]/55">
            <button onClick={() => navigate(isTerms ? 'privacy' : 'terms')} className="text-[#0B1E3F] hover:underline text-left">
              {isTerms ? 'Read the Privacy Policy' : 'Read the Terms of Use'}
            </button>
            <a href="mailto:contact@haulock.com" className="text-[#0B1E3F] hover:underline">Questions? contact@haulock.com</a>
          </div>
        </div>
      </section>
      <Footer navigate={navigate} />
    </div>
  );
}

function LegalH2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-2xl serif italic text-[#0B1E3F] mt-10 mb-4 first:mt-0">{children}</h2>;
}
function LegalH3({ children }: { children: React.ReactNode }) {
  return <h3 className="text-base font-semibold text-[#0B1E3F] mt-6 mb-2">{children}</h3>;
}
function LegalP({ children }: { children: React.ReactNode }) {
  return <p className="text-[15px] leading-relaxed text-[#0B1E3F]/80 mb-4">{children}</p>;
}
function LegalUl({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc pl-5 space-y-1.5 text-[15px] leading-relaxed text-[#0B1E3F]/80 mb-4">{children}</ul>;
}

function TermsContent() {
  return (
    <div>
      <LegalP>
        Welcome to Haulock. These Terms of Use (&ldquo;Terms&rdquo;) govern your access to and use of the Haulock website, dashboard, API, emails, and any related services (together, the &ldquo;Service&rdquo;). By creating an account, running a lookup, or otherwise using the Service, you agree to these Terms. If you do not agree, do not use the Service.
      </LegalP>

      <LegalH2>1. What Haulock is</LegalH2>
      <LegalP>
        Haulock is a research tool for freight carriers, brokers, dispatchers, and other industry users. We aggregate and display public records and third-party data so you can review the operating history, authority status, and risk signals of motor carriers and freight brokers before you do business with them. <strong>Haulock is an information tool, not a recommendation, endorsement, accusation, or rating service.</strong>
      </LegalP>

      <LegalH2>2. Source of the data we display</LegalH2>
      <LegalP>
        The information shown in a Haulock report comes from public and third-party sources. The primary source is the Federal Motor Carrier Safety Administration (FMCSA), specifically the SAFER, L&amp;I, and SMS systems operated by the U.S. Department of Transportation. Other sources include public WHOIS records, public DNS records, public web search results, public business listings, and information voluntarily submitted by other Haulock users.
      </LegalP>
      <LegalP>
        <strong>We do not own, control, generate, or modify the data published by FMCSA or by any other third-party source.</strong> We display what those sources publish, sometimes with formatting, scoring, or aggregation applied. If FMCSA, a search engine, or any other source publishes information that is incomplete, outdated, or incorrect, that information may appear in our reports until the upstream source corrects it. Any dispute about the accuracy of FMCSA data must be raised directly with FMCSA.
      </LegalP>

      <LegalH2>3. No verification of identity, no guarantee of accuracy</LegalH2>
      <LegalP>
        Haulock does not independently verify the identity of any motor carrier, broker, individual, company, address, phone number, email, or website. We do not certify that the entity behind a given MC number, DOT number, or business name is the same entity you are communicating with. We do not guarantee that any data point shown in a report is current, complete, or accurate.
      </LegalP>
      <LegalP>
        The Service is provided strictly on an &ldquo;AS IS&rdquo; and &ldquo;AS AVAILABLE&rdquo; basis. To the maximum extent permitted by law, we disclaim all warranties of any kind, whether express, implied, or statutory, including warranties of merchantability, fitness for a particular purpose, accuracy, completeness, non-infringement, and uninterrupted availability.
      </LegalP>

      <LegalH2>4. Risk scores and verdicts are signals, not accusations</LegalH2>
      <LegalP>
        Haulock may display a numeric risk score, a verdict label (such as LOW, CAUTION, or HIGH), red flags, and similar visual indicators. <strong>These outputs are computed signals based on the upstream data we received at the time of the lookup.</strong> They are not accusations of fraud, criminal activity, or wrongdoing, and they should not be interpreted that way.
      </LegalP>
      <LegalUl>
        <li>A high score does not mean a carrier or broker is fraudulent, dishonest, or unfit to do business with.</li>
        <li>A low score does not mean a carrier or broker is safe, legitimate, or recommended.</li>
        <li>Scores can change as upstream data changes. A score that was correct yesterday may be different today.</li>
      </LegalUl>
      <LegalP>
        You agree that you will not represent Haulock&rsquo;s output as a finding of fraud, illegality, or wrongdoing about any specific company or person. You are responsible for any decision you make based on the report.
      </LegalP>

      <LegalH2>5. Your responsibility for business decisions</LegalH2>
      <LegalP>
        You are solely responsible for any decision you make about whether to book a load, accept a tender, dispatch a truck, sign a rate confirmation, extend credit, or enter into any other transaction or relationship with any party you research using Haulock. You should perform additional due diligence appropriate to the size and risk of the transaction, including verifying contact information through independent channels, requiring proper insurance certificates, and following industry best practices. <strong>Haulock is not your broker, not your carrier, not your factor, not your lawyer, and not your insurer.</strong>
      </LegalP>

      <LegalH2>6. Limitation of liability</LegalH2>
      <LegalP>
        To the maximum extent permitted by law, Haulock and its officers, employees, contractors, and affiliates will not be liable for any indirect, incidental, special, consequential, exemplary, or punitive damages, or for any loss of revenue, profits, business, goodwill, freight, cargo, opportunities, or data, arising out of or relating to your use of the Service, even if we have been advised of the possibility of such damages. Our aggregate liability for any claim arising out of or relating to the Service will not exceed the greater of (a) the amount you paid Haulock in the 12 months before the event giving rise to the claim, or (b) one hundred U.S. dollars (USD 100).
      </LegalP>

      <LegalH2>7. Indemnification</LegalH2>
      <LegalP>
        You agree to indemnify and hold Haulock harmless from any claim, demand, loss, liability, or expense (including reasonable attorneys&rsquo; fees) brought by a third party arising out of or relating to (a) your use of the Service, (b) any decision you made based on a Haulock report, (c) any content you submitted to the Service, including community fraud reports, or (d) your violation of these Terms or any applicable law.
      </LegalP>

      <LegalH2>8. Acceptable use</LegalH2>
      <LegalP>You agree not to:</LegalP>
      <LegalUl>
        <li>Use the Service to harass, defame, or unlawfully harm any person or company.</li>
        <li>Republish, resell, scrape, or redistribute Haulock reports as your own product or as a substitute for FMCSA data.</li>
        <li>Use the Service to make automated decisions that affect a person or company without human review.</li>
        <li>Attempt to interfere with, reverse engineer, disable, or overload the Service.</li>
        <li>Submit false or misleading community fraud reports. Submissions must reflect your actual experience and are made under your own name and account.</li>
      </LegalUl>

      <LegalH2>9. Community fraud reports</LegalH2>
      <LegalP>
        Haulock allows users to submit fraud reports about brokers and carriers based on their own experience. These reports are user-generated content. Haulock does not investigate, verify, endorse, or guarantee the accuracy of any community report. By submitting a report, you confirm that the report reflects your own first-hand experience, you take full responsibility for its content, and you grant Haulock a worldwide license to display the report inside the Service. We may remove any report at our discretion.
      </LegalP>

      <LegalH2>10. Account, plan, and billing</LegalH2>
      <LegalP>
        Some Haulock features require a paid plan. Pricing, lookup limits, and feature inclusions are described on the pricing page and may change. Subscriptions renew automatically at the published price until canceled. Refunds are handled at our discretion. You are responsible for keeping your billing details up to date and for the actions taken under your account.
      </LegalP>

      <LegalH2>11. Intellectual property</LegalH2>
      <LegalP>
        The Haulock name, logo, design, software, scoring methodology, report layout, and accompanying materials are owned by Haulock and protected by U.S. and international intellectual property laws. The underlying public data we display (such as FMCSA records) is not owned by us and remains the property of its respective publisher. We grant you a limited, non-exclusive, non-transferable license to use the Service for your own legitimate business purposes, subject to these Terms.
      </LegalP>

      <LegalH2>12. Suspension and termination</LegalH2>
      <LegalP>
        We may suspend or terminate your access to the Service at any time, with or without notice, if we reasonably believe you have violated these Terms, abused the Service, or created risk for Haulock or other users. You may close your account at any time from Settings.
      </LegalP>

      <LegalH2>13. Changes to these Terms</LegalH2>
      <LegalP>
        We may update these Terms from time to time. When we make material changes, we will update the &ldquo;Last updated&rdquo; date at the top of this page and, where appropriate, notify account holders by email. Your continued use of the Service after the change takes effect constitutes acceptance of the updated Terms.
      </LegalP>

      <LegalH2>14. Governing law and disputes</LegalH2>
      <LegalP>
        These Terms are governed by the laws of the State of Delaware, United States, without regard to its conflict of laws rules. Any dispute arising out of or relating to the Service or these Terms will be resolved in the state or federal courts located in Delaware, and you consent to personal jurisdiction in those courts. Where applicable law allows, you and Haulock waive any right to a jury trial and to participate in any class action arising out of or relating to the Service.
      </LegalP>

      <LegalH2>15. Contact</LegalH2>
      <LegalP>
        Legal notices and questions about these Terms can be sent to <a href="mailto:contact@haulock.com" className="text-[#0B1E3F] underline">contact@haulock.com</a>.
      </LegalP>
    </div>
  );
}

function PrivacyContent() {
  return (
    <div>
      <LegalP>
        This Privacy Policy explains what information Haulock collects, how we use it, who we share it with, and what choices you have. By using Haulock, you agree to the practices described here.
      </LegalP>

      <LegalH2>1. Information we collect</LegalH2>
      <LegalH3>Account information</LegalH3>
      <LegalP>
        When you sign up, we collect your email address, name, password (stored hashed by our authentication provider), and optionally your company name, MC number, and DOT number. If you sign in with Google, we receive the email address and basic profile information you authorize.
      </LegalP>
      <LegalH3>Usage information</LegalH3>
      <LegalP>
        When you use Haulock, we record which lookups you ran, what was returned, your billing plan, IP address, browser type, referrer, and rough timestamps. This is used to operate the Service, prevent abuse, enforce plan limits, and improve features.
      </LegalP>
      <LegalH3>Communications</LegalH3>
      <LegalP>
        When we send you an email, we record the recipient, subject, type of email (welcome, alert, newsletter, etc.), and the timestamp. This is used to power your account dashboard, the admin newsletter view, and to comply with anti-spam law.
      </LegalP>
      <LegalH3>Cookies and similar technologies</LegalH3>
      <LegalP>
        We use a small number of cookies and similar technologies to keep you signed in, remember preferences, and protect against abuse. We do not sell or share cookie data for cross-site advertising.
      </LegalP>

      <LegalH2>2. Where the report data comes from</LegalH2>
      <LegalP>
        The information displayed inside a Haulock report (carrier name, address, MC, DOT, authority, insurance, safety rating, crash and inspection history, web presence, social profiles, and similar data points) is collected from public and third-party sources, including FMCSA, public WHOIS, public DNS, public business listings, and search engines. We process and present this data; we do not generate or own it.
      </LegalP>

      <LegalH2>3. How we use your information</LegalH2>
      <LegalUl>
        <li>To run, secure, and improve the Service.</li>
        <li>To send transactional emails such as welcome messages, login alerts, billing receipts, and high-risk lookup notifications.</li>
        <li>To send the Haulock fraud briefing newsletter and related industry updates if you opt in.</li>
        <li>To prevent fraud, abuse, and unauthorized access.</li>
        <li>To comply with legal obligations.</li>
      </LegalUl>

      <LegalH2>4. Service providers we share data with</LegalH2>
      <LegalP>
        We rely on a small number of trusted vendors to operate the Service. They process information on our behalf:
      </LegalP>
      <LegalUl>
        <li><strong>Supabase</strong> — account, authentication, and database hosting.</li>
        <li><strong>Resend</strong> — transactional email and newsletter delivery, plus email tracking metadata.</li>
        <li><strong>Stripe</strong> — billing and subscription management. Card details are handled by Stripe and never stored on Haulock servers.</li>
        <li><strong>Vercel</strong> — application hosting and edge networking.</li>
        <li><strong>Google Cloud (Places API, Safe Browsing)</strong> — address verification and basic domain reputation.</li>
        <li><strong>Brave Search</strong> — public web search for company name and reputation lookups.</li>
        <li><strong>FMCSA</strong> — official carrier and broker data sourced from public U.S. government systems.</li>
      </LegalUl>
      <LegalP>
        We do not sell your personal information. We do not share it for cross-context behavioral advertising.
      </LegalP>

      <LegalH2>5. Your choices</LegalH2>
      <LegalUl>
        <li><strong>Email preferences.</strong> Manage which emails you receive from Settings &rarr; Notifications, or click the unsubscribe link in any newsletter.</li>
        <li><strong>Account deletion.</strong> You can delete your Haulock account from Settings. This removes your account, lookups, watchlist, fraud reports, and team membership, and removes you from our newsletter list. Backups may persist for up to 30 days before being purged.</li>
        <li><strong>Access and correction.</strong> You can update your profile data from Settings. For other requests, email us.</li>
      </LegalUl>

      <LegalH2>6. Data retention</LegalH2>
      <LegalP>
        We retain account and usage data while your account is active and for a reasonable period afterwards to satisfy legal, accounting, and abuse-prevention requirements. Public report data (FMCSA snapshots, etc.) may be retained as part of the Haulock historical archive even after individual accounts are deleted, since it does not include your personal information.
      </LegalP>

      <LegalH2>7. Security</LegalH2>
      <LegalP>
        We use industry-standard practices to protect your information, including encrypted connections, hashed passwords, role-based database access, and access logging. No system is perfectly secure. You are responsible for keeping your password and access credentials confidential.
      </LegalP>

      <LegalH2>8. International users</LegalH2>
      <LegalP>
        Haulock is operated from the United States. If you use the Service from outside the United States, you understand that your information will be processed in the United States, where data protection laws may differ from those in your country.
      </LegalP>

      <LegalH2>9. Children</LegalH2>
      <LegalP>
        Haulock is not directed at children under 16, and we do not knowingly collect personal information from them.
      </LegalP>

      <LegalH2>10. Changes to this Policy</LegalH2>
      <LegalP>
        We may update this Privacy Policy from time to time. When we make material changes, we will update the &ldquo;Last updated&rdquo; date at the top and, where appropriate, notify account holders by email.
      </LegalP>

      <LegalH2>11. Contact</LegalH2>
      <LegalP>
        Privacy questions can be sent to <a href="mailto:contact@haulock.com" className="text-[#0B1E3F] underline">contact@haulock.com</a>.
      </LegalP>
    </div>
  );
}

// ---------------------------------------------------------------------------
// About
// ---------------------------------------------------------------------------

function AboutPage({ navigate, user }: { navigate: any; user?: any }) {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const original = document.title;
    document.title = 'About Haulock · Built for carriers who have been burned';
    setMeta('description', 'Haulock verifies freight brokers and carriers using live FMCSA data, AI rate-con analysis, and a community fraud network. Built by people who lost loads to fraud and decided to stop it.');
    return () => { document.title = original; };
  }, []);

  return (
    <div className="min-h-screen bg-[#F5F3EE] text-[#0B1E3F]">
      <Nav navigate={navigate} user={user} />

      <section className="py-20 px-6 relative bg-[#F5F3EE]">
        <div className="absolute inset-0 radial-glow pointer-events-none" />
        <div className="relative max-w-3xl mx-auto">
          <div className="text-xs mono uppercase tracking-[0.2em] text-[#FF6B35] mb-4">About Haulock</div>
          <h1 className="text-4xl md:text-6xl serif italic text-[#0B1E3F] leading-[1.05] mb-6">
            Built for carriers who have been burned.
          </h1>
          <p className="text-lg text-[#0B1E3F]/65 leading-relaxed max-w-2xl">
            Haulock is a freight fraud platform for carriers, brokers, dispatchers, and owner-operators. We verify any motor carrier or broker in seconds using live FMCSA data, AI rate-con analysis, and a community fraud network. Trusted by 4,200 carriers and brokers across the lower 48.
          </p>
        </div>
      </section>

      <section className="px-6 pb-20">
        <div className="max-w-3xl mx-auto bg-white border border-[#0B1E3F]/10 rounded-2xl p-8 md:p-12 card-shadow">
          <LegalH2>Why we built this</LegalH2>
          <LegalP>
            Freight fraud is up an estimated 400% since 2020. The numbers in industry reports do not show the worst part: most of those losses are absorbed by small carriers who do not have an in-house compliance team, an expensive vetting subscription, or a lawyer on retainer. They had a load, they had a phone call, they had a rate confirmation that looked right, and now the load is gone or the invoice is unpaid.
          </LegalP>
          <LegalP>
            We started Haulock because the tools that already existed were either built only for brokers (vetting carriers in one direction) or priced for enterprise fleets (hundreds of dollars a month, before you make a single lookup). The carrier with three trucks could not afford them. The owner-operator running a single rig had nothing at all.
          </LegalP>

          <LegalH2>What Haulock actually does</LegalH2>
          <LegalP>
            Every lookup runs up to 14 sources in parallel: FMCSA SAFER for authority and address, FMCSA L&amp;I for insurance and surety bond, FMCSA SMS for inspection and crash history, public WHOIS and DNS for domain age and email infrastructure, Google Places for address verification, Google Safe Browsing for known threat domains, Brave Search across 50+ trusted news outlets, plus our own community fraud network and historical snapshot archive going back five years.
          </LegalP>
          <LegalP>
            We also analyze rate confirmation PDFs with Claude AI to extract the broker, the carrier, and the load, then cross-check the broker email domain against their FMCSA-registered website to catch lookalike domains. The whole scan finishes in about two seconds.
          </LegalP>

          <LegalH2>What we believe</LegalH2>
          <LegalUl>
            <li><strong>Verification should be free for the small operator.</strong> Our Free plan includes lookups every month with no credit card. The plan structure scales with fleet size, not vetting volume.</li>
            <li><strong>Public data should be presented honestly.</strong> The data inside a Haulock report comes from FMCSA, public WHOIS, public search, and other public sources. We display it. We do not invent it. We do not pretend a high score is a verdict of fraud.</li>
            <li><strong>Both sides need protection.</strong> Carriers need to verify brokers. Brokers need to verify carriers. Same engine, same scoring, same playbook.</li>
            <li><strong>Speed beats perfection.</strong> A scan that takes 30 minutes is a scan that does not get run. We made it fast enough to run on every load, not just the ones that smell wrong.</li>
          </LegalUl>

          <LegalH2>What we are not</LegalH2>
          <LegalP>
            We are not a recommendation engine. We are not a credit bureau. We are not a freight broker, a carrier, a factor, an insurer, or law enforcement. A high Haulock score is a signal that should slow you down. A low score is not a guarantee. You still call the broker on a phone number you got independently. You still verify the load with the shipper. We make those checks fast and cheap; we do not replace your judgment.
          </LegalP>

          <LegalH2>The data behind the badge</LegalH2>
          <LegalUl>
            <li><strong>4,200+</strong> verified carriers and brokers in the community network</li>
            <li><strong>~2.1 second</strong> average lookup time</li>
            <li><strong>14</strong> data sources cross-checked per scan</li>
            <li><strong>5 years</strong> of FMCSA snapshot history archived</li>
            <li><strong>$0</strong> required to run your first lookup</li>
          </LegalUl>

          <LegalH2>Talk to us</LegalH2>
          <LegalP>
            For press, partnerships, legal, privacy, careers, and general questions: <a href="mailto:contact@haulock.com" className="text-[#0B1E3F] underline">contact@haulock.com</a>.
          </LegalP>

          <div className="mt-10 pt-8 border-t border-[#0B1E3F]/10 flex flex-col sm:flex-row gap-3 justify-between text-sm">
            <button onClick={() => navigate('signup')} className="px-5 py-2.5 bg-[#0B1E3F] text-white rounded-full font-medium hover:bg-[#0B1E3F]/90 inline-flex items-center justify-center gap-2">
              Try Haulock free <ArrowRight className="w-4 h-4" />
            </button>
            <button onClick={() => navigate('blog')} className="px-5 py-2.5 border border-[#0B1E3F]/15 rounded-full font-medium text-[#0B1E3F] hover:bg-[#0B1E3F]/5">Read the blog</button>
          </div>
        </div>
      </section>

      <Footer navigate={navigate} />
    </div>
  );
}


// ---------------------------------------------------------------------------
// Blog
// ---------------------------------------------------------------------------

function BlogPage({ slug, navigate, user }: { slug: string | null; navigate: any; user?: any }) {
  // Lazy-import the catalog so the bundle doesn't pay for it on /landing.
  // Module-level top-of-file imports are fine since the catalog is small,
  // but we keep the boundary tidy here.
  const post = slug ? BLOG_POSTS.find((p) => p.slug === slug) || null : null;
  const showSinglePost = Boolean(slug && post);
  const showNotFound = Boolean(slug && !post);

  // SEO: update document title client-side. The Next.js App Router
  // metadata API is server-only and the whole site lives inside a single
  // catchall ([[...slug]]/page.tsx) "use client" component, so this is the
  // pragmatic way to push title updates to the browser tab. Crawlers
  // already see the page through SSR with a generic title; the real SEO
  // lift comes from the structured h1/h2 + content under it.
  useEffect(() => {
    const original = typeof document !== 'undefined' ? document.title : '';
    if (typeof document === 'undefined') return;
    if (showSinglePost && post) {
      document.title = `${post.title} · Haulock Blog`;
      setMeta('description', post.description);
    } else {
      document.title = 'Freight Fraud Blog · Haulock';
      setMeta('description', 'Weekly freight fraud breakdowns: identity theft, double brokering, rate confirmation scams, and how carriers and brokers can protect themselves.');
    }
    return () => { if (typeof document !== 'undefined') document.title = original; };
  }, [showSinglePost, post?.slug]);

  return (
    <div className="min-h-screen bg-[#F5F3EE] text-[#0B1E3F]">
      <Nav navigate={navigate} user={user} />
      {showSinglePost && post ? <BlogPostView post={post} navigate={navigate} /> : showNotFound ? <BlogNotFound navigate={navigate} /> : <BlogIndex navigate={navigate} />}
      <Footer navigate={navigate} />
    </div>
  );
}

function setMeta(name: string, content: string) {
  if (typeof document === 'undefined') return;
  let el = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement('meta');
    el.name = name;
    document.head.appendChild(el);
  }
  el.content = content;
}

function BlogIndex({ navigate }: any) {
  const [latest, ...rest] = BLOG_POSTS;
  return (
    <>
      <section className="py-20 px-6 relative bg-[#F5F3EE]">
        <div className="absolute inset-0 radial-glow pointer-events-none" />
        <div className="relative max-w-6xl mx-auto">
          <div className="text-xs mono uppercase tracking-[0.2em] text-[#FF6B35] mb-4">The Haulock Blog</div>
          <h1 className="text-4xl md:text-6xl serif italic text-[#0B1E3F] leading-[1.05] max-w-3xl">
            Freight fraud explained, one tactic at a time.
          </h1>
          <p className="text-lg text-[#0B1E3F]/65 mt-4 max-w-2xl">
            Real scenarios, plain English, concrete steps. Written for carriers and brokers who lose real money to this stuff.
          </p>
        </div>
      </section>

      {latest && (
        <section className="px-6 mb-16">
          <div className="max-w-6xl mx-auto">
            <button
              type="button"
              onClick={() => navigate('blog', { slug: latest.slug })}
              className="block w-full text-left bg-white rounded-2xl border border-[#0B1E3F]/10 overflow-hidden card-shadow hover:border-[#0B1E3F]/30 transition group"
            >
              <div className="grid md:grid-cols-2 gap-0">
                <div className="relative aspect-[4/3] md:aspect-auto bg-[#0B1E3F]/5">
                  <img src={latest.hero.src} alt={latest.hero.alt} className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.02] transition" loading="eager" />
                </div>
                <div className="p-8 md:p-10 flex flex-col justify-center">
                  <div className="flex items-center gap-2 mb-4 flex-wrap">
                    <span className="text-[10px] mono uppercase tracking-[0.18em] px-2 py-0.5 rounded-full bg-[#FF6B35]/10 text-[#FF6B35] font-bold">Latest</span>
                    <span className="text-xs mono text-[#0B1E3F]/55">{formatBlogDate(latest.publishedAt)} · {latest.readingMinutes} min read</span>
                  </div>
                  <h2 className="text-2xl md:text-3xl serif italic text-[#0B1E3F] leading-tight mb-3">{latest.title}</h2>
                  <p className="text-[#0B1E3F]/65 leading-relaxed mb-5">{latest.description}</p>
                  <span className="text-sm font-semibold text-[#0B1E3F] inline-flex items-center gap-2">
                    Read the article <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition" />
                  </span>
                </div>
              </div>
            </button>
          </div>
        </section>
      )}

      {rest.length > 0 && (
        <section className="px-6 pb-24">
          <div className="max-w-6xl mx-auto">
            <div className="text-xs mono uppercase tracking-[0.18em] text-[#0B1E3F]/55 mb-6">More from the blog</div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {rest.map((p) => (
                <button
                  key={p.slug}
                  type="button"
                  onClick={() => navigate('blog', { slug: p.slug })}
                  className="text-left bg-white rounded-2xl border border-[#0B1E3F]/10 overflow-hidden card-shadow hover:border-[#0B1E3F]/30 transition group"
                >
                  <div className="aspect-[16/10] bg-[#0B1E3F]/5 overflow-hidden">
                    <img src={p.hero.src} alt={p.hero.alt} className="w-full h-full object-cover group-hover:scale-[1.04] transition" loading="lazy" />
                  </div>
                  <div className="p-6">
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      <span className="text-[10px] mono uppercase tracking-[0.18em] px-2 py-0.5 rounded-full bg-[#0B1E3F]/5 text-[#0B1E3F]/65">{p.topic}</span>
                      <span className="text-[11px] mono text-[#0B1E3F]/45">{formatBlogDate(p.publishedAt)}</span>
                    </div>
                    <h3 className="text-lg font-semibold text-[#0B1E3F] mb-2 leading-snug">{p.title}</h3>
                    <p className="text-sm text-[#0B1E3F]/65 leading-relaxed line-clamp-3">{p.description}</p>
                    <div className="mt-4 text-xs mono text-[#0B1E3F]/55">{p.readingMinutes} min read</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      <BlogNewsletterCTA />
    </>
  );
}

function BlogPostView({ post, navigate }: { post: BlogPost; navigate: any }) {
  const related = BLOG_POSTS.filter((p) => p.slug !== post.slug).slice(0, 3);
  return (
    <>
      <article className="px-6 pt-10 pb-16">
        <div className="max-w-3xl mx-auto">
          <button onClick={() => navigate('blog')} className="text-sm text-[#0B1E3F]/60 hover:text-[#0B1E3F] mb-6 inline-flex items-center gap-1">
            <ChevronRight className="w-3.5 h-3.5 rotate-180" /> Back to blog
          </button>
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <span className="text-[10px] mono uppercase tracking-[0.18em] px-2 py-0.5 rounded-full bg-[#FF6B35]/10 text-[#FF6B35] font-bold">{post.topic}</span>
            <span className="text-xs mono text-[#0B1E3F]/55">{formatBlogDate(post.publishedAt)} · {post.readingMinutes} min read</span>
          </div>
          <h1 className="text-3xl md:text-5xl serif italic text-[#0B1E3F] leading-[1.05] mb-5">{post.title}</h1>
          <p className="text-lg text-[#0B1E3F]/65 leading-relaxed mb-8">{post.description}</p>
          <div className="aspect-[16/9] bg-[#0B1E3F]/5 rounded-2xl overflow-hidden mb-3">
            <img src={post.hero.src} alt={post.hero.alt} className="w-full h-full object-cover" loading="eager" />
          </div>
          <div className="text-[11px] mono text-[#0B1E3F]/45 mb-10">
            Photo: <a href={post.hero.creditUrl} target="_blank" rel="noopener" className="hover:text-[#0B1E3F]/70 underline">{post.hero.credit}</a> on Unsplash
          </div>

          <div className="prose-haulock" dangerouslySetInnerHTML={{ __html: post.bodyHtml }} />

          {post.haulockHelps && post.haulockHelpsCopy && (
            <div className="mt-10 p-6 rounded-2xl border border-[#FF6B35]/25 bg-[#FF6B35]/[0.04]">
              <div className="text-[10px] mono uppercase tracking-[0.18em] text-[#FF6B35] font-bold mb-2">How Haulock helps</div>
              <p className="text-[15px] leading-relaxed text-[#0B1E3F]/85 mb-4">{post.haulockHelpsCopy}</p>
              <button onClick={() => navigate('signup')} className="px-5 py-2.5 bg-[#0B1E3F] text-white rounded-full text-sm font-semibold hover:bg-[#0B1E3F]/90 inline-flex items-center gap-2">
                Try Haulock free <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {!post.haulockHelps && (
            <div className="mt-10 p-6 rounded-2xl border border-[#0B1E3F]/10 bg-white">
              <div className="text-[10px] mono uppercase tracking-[0.18em] text-[#0B1E3F]/55 mb-2">A note from us</div>
              <p className="text-[15px] leading-relaxed text-[#0B1E3F]/80">
                We will not pretend Haulock can solve every type of fraud. Some of it (like cargo theft after pickup) lives at the dock and on the road. But Haulock does catch the booking-step impersonation that lets these thefts happen in the first place.
              </p>
            </div>
          )}
        </div>
      </article>

      <BlogNewsletterCTA />

      {related.length > 0 && (
        <section className="px-6 pb-24 pt-4">
          <div className="max-w-6xl mx-auto">
            <div className="text-xs mono uppercase tracking-[0.18em] text-[#0B1E3F]/55 mb-6">Keep reading</div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {related.map((p) => (
                <button
                  key={p.slug}
                  type="button"
                  onClick={() => navigate('blog', { slug: p.slug })}
                  className="text-left bg-white rounded-2xl border border-[#0B1E3F]/10 overflow-hidden card-shadow hover:border-[#0B1E3F]/30 transition group"
                >
                  <div className="aspect-[16/10] bg-[#0B1E3F]/5 overflow-hidden">
                    <img src={p.hero.src} alt={p.hero.alt} className="w-full h-full object-cover group-hover:scale-[1.04] transition" loading="lazy" />
                  </div>
                  <div className="p-6">
                    <div className="text-[10px] mono uppercase tracking-[0.18em] px-2 py-0.5 rounded-full bg-[#0B1E3F]/5 text-[#0B1E3F]/65 inline-block mb-3">{p.topic}</div>
                    <h3 className="text-lg font-semibold text-[#0B1E3F] leading-snug">{p.title}</h3>
                    <div className="mt-4 text-xs mono text-[#0B1E3F]/55">{p.readingMinutes} min read</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  );
}

function BlogNotFound({ navigate }: any) {
  return (
    <section className="px-6 py-24">
      <div className="max-w-2xl mx-auto text-center bg-white rounded-2xl border border-[#0B1E3F]/10 p-12 card-shadow">
        <h1 className="text-3xl serif italic text-[#0B1E3F] mb-3">We couldn&apos;t find that post.</h1>
        <p className="text-[#0B1E3F]/65 mb-6">It may have been renamed or moved. The blog index has the latest articles.</p>
        <button onClick={() => navigate('blog')} className="px-5 py-2.5 bg-[#0B1E3F] text-white rounded-full text-sm font-semibold hover:bg-[#0B1E3F]/90">Back to blog</button>
      </div>
    </section>
  );
}

function BlogNewsletterCTA() {
  // Inline subscribe form. Same /api/newsletter/subscribe endpoint the
  // landing-page form uses, so a successful submit here also fires the
  // welcome email + adds the contact to Resend.
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'ok' | 'already' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === 'sending') return;
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setStatus('error');
      setMessage('Enter a valid email address.');
      return;
    }
    setStatus('sending'); setMessage(null);
    try {
      const r = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error || 'Could not subscribe. Try again in a minute.');
      if (j?.alreadyExisted) {
        setStatus('already');
        setMessage('You are already on the list. The next briefing arrives Thursday.');
      } else {
        setStatus('ok');
        setMessage('You are on the list. Watch your inbox every Thursday.');
        track('newsletter_subscribed');
      }
      setEmail('');
    } catch (err: any) {
      setStatus('error');
      setMessage(err?.message || 'Could not subscribe. Try again in a minute.');
    }
  };

  return (
    <section className="px-6 py-12 mb-16">
      <div className="max-w-3xl mx-auto bg-[#0B1E3F] text-white rounded-2xl p-8 md:p-10 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-[10px] mono uppercase tracking-[0.18em] text-white/80 mb-4">
          <Mail className="w-3.5 h-3.5" /> Free weekly briefing
        </div>
        <h2 className="text-2xl md:text-3xl serif italic mb-3">Get the next one in your inbox.</h2>
        <p className="text-white/70 mb-6 max-w-xl mx-auto">One short article every Thursday on what fraud is hitting freight right now and how to spot it. No fluff. Unsubscribe in one click.</p>
        <form onSubmit={submit} className="flex flex-col sm:flex-row gap-3 max-w-lg mx-auto">
          <input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); if (status !== 'idle') { setStatus('idle'); setMessage(null); } }}
            placeholder="you@yourcarrier.com"
            disabled={status === 'sending'}
            className="flex-1 px-4 py-3 rounded-full bg-white text-[#0B1E3F] placeholder:text-[#0B1E3F]/40 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF6B35] disabled:opacity-60"
            aria-label="Email address"
          />
          <button
            type="submit"
            disabled={status === 'sending'}
            className="px-6 py-3 rounded-full bg-[#FF6B35] text-white text-sm font-semibold hover:bg-[#FF6B35]/90 transition flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {status === 'sending' ? (
              <><div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Subscribing…</>
            ) : (
              <>Subscribe <ArrowRight className="w-4 h-4" /></>
            )}
          </button>
        </form>
        {message && (
          <div className={`mt-4 text-sm ${status === 'ok' ? 'text-[#16A34A]' : status === 'already' ? 'text-white/85' : 'text-[#FF6B35]'}`}>{message}</div>
        )}
      </div>
    </section>
  );
}

function formatBlogDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return iso;
  }
}

function Plan({ user, setPlan }: any) {
  const [pending, setPending] = useState<string | null>(null);
  const [billing, setBilling] = useState<'monthly' | 'annual'>('monthly');
  const [error, setError] = useState<string | null>(null);
  const current = (user?.plan || '').toLowerCase();
  const hasStripeCustomer = Boolean(user?.stripeCustomerId);
  const tiers = Object.values(PLANS);

  const openPortal = async () => {
    setError(null);
    try {
      const r = await fetch('/api/stripe/portal', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `Portal failed (${r.status})`);
      if (j.url) window.location.href = j.url;
    } catch (err: any) {
      setError(err?.message || 'Could not open billing portal');
    }
  };

  const choose = async (id: string) => {
    setError(null);

    // Free plan selection:
    //  - Has real Stripe subscription → portal (so Stripe can properly cancel)
    //  - No Stripe customer → just flip metadata locally
    if (id === 'free') {
      if (PAID_PLANS.has(current) && hasStripeCustomer) { await openPortal(); return; }
      setPending(id);
      try { await setPlan(id); } finally { setPending(null); }
      return;
    }

    // Paid plan selection:
    //  - Has real Stripe subscription AND picking a different paid plan → portal
    //    (Stripe handles proration / upgrade/downgrade there)
    //  - No Stripe customer yet (plan metadata is stale or never subscribed) →
    //    treat as a fresh checkout. This is the common path on first real purchase.
    if (PAID_PLANS.has(current) && hasStripeCustomer && id !== current) { await openPortal(); return; }
    if (typeof window !== 'undefined') {
      window.location.href = `/checkout/${id}?billing=${billing}`;
    }
  };
  return (
    <div className="space-y-8 text-[#0B1E3F]">
      <div>
        <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-2">Plan & billing</div>
        <h1 className="text-4xl serif italic text-[#0B1E3F]">{current ? 'Manage your plan' : 'Choose your plan'}</h1>
        <p className="text-[#0B1E3F]/60 mt-2 max-w-xl">{current ? `You're currently on the ${current.charAt(0).toUpperCase() + current.slice(1)} plan. Upgrade or downgrade any time.` : 'Pick the plan that fits how you work. Start free — upgrade when you need more.'}</p>
      </div>
      <div className="flex items-center gap-2">
        <div className="inline-flex bg-white border border-[#0B1E3F]/15 rounded-full p-1">
          <button onClick={() => setBilling('monthly')} className={`px-4 py-1.5 rounded-full text-sm transition ${billing === 'monthly' ? 'bg-[#0B1E3F] text-white' : 'text-[#0B1E3F]/70 hover:text-[#0B1E3F]'}`}>Monthly</button>
          <button onClick={() => setBilling('annual')} className={`px-4 py-1.5 rounded-full text-sm transition flex items-center gap-1.5 ${billing === 'annual' ? 'bg-[#0B1E3F] text-white' : 'text-[#0B1E3F]/70 hover:text-[#0B1E3F]'}`}>
            Annual <span className="text-[10px] mono px-1.5 py-0.5 rounded-full bg-[#16A34A]/15 text-[#16A34A]">save 2mo</span>
          </button>
        </div>
        {error && <span className="text-sm text-[#DC2626]">{error}</span>}
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
        {tiers.map((p) => {
          const isCurrent = current === p.id;
          const isPending = pending === p.id;
          const displayPrice = billing === 'annual' && p.priceAnnualNum > 0 ? p.priceAnnual : p.price;
          const displaySuffix = billing === 'annual' && p.priceAnnualNum > 0 ? '/yr' : '/mo';
          return (
            <div key={p.id} className={`relative p-8 rounded-2xl border bg-white text-[#0B1E3F] flex flex-col ${p.popular ? 'border-[#FF6B35] card-shadow-lg' : 'border-[#0B1E3F]/10 card-shadow'} ${isCurrent ? 'ring-2 ring-[#0B1E3F]' : ''}`}>
              {p.popular && !isCurrent && <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-[#FF6B35] text-white text-xs mono uppercase tracking-wider rounded-full">Most popular</div>}
              {isCurrent && <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-[#0B1E3F] text-white text-xs mono uppercase tracking-wider rounded-full">Current plan</div>}
              <div className="text-sm uppercase tracking-wider mb-2 text-[#0B1E3F]/60">{p.label}</div>
              <div className="flex items-baseline gap-1">
                <div className="text-5xl serif italic text-[#0B1E3F]">{displayPrice}</div>
                <div className="text-[#0B1E3F]/60">{displaySuffix}</div>
              </div>
              {billing === 'monthly' && p.priceAnnualNum > 0 && (
                <div className="text-xs mono text-[#16A34A] mb-2">or {p.priceAnnual}/yr</div>
              )}
              {(billing === 'annual' || p.priceAnnualNum === 0) && <div className="mb-2" />}
              <div className="text-sm mb-6 text-[#0B1E3F]/70">{p.desc}</div>
              <button
                onClick={() => choose(p.id)}
                disabled={isCurrent || isPending}
                className={`w-full py-3 rounded-full font-medium mb-6 transition disabled:opacity-60 ${isCurrent ? 'bg-[#0B1E3F]/10 text-[#0B1E3F]' : 'bg-[#0B1E3F] text-white hover:bg-[#0B1E3F]/90'}`}
              >
                {isCurrent ? 'Current plan' : isPending ? 'Saving…' : `Choose ${p.label}`}
              </button>
              <div className="space-y-2.5 flex-1">
                {p.features.map((f, j) => (
                  <div key={j} className="flex items-center gap-2 text-sm text-[#0B1E3F]"><CheckCircle2 className="w-4 h-4 text-[#16A34A]" />{f}</div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="text-xs mono text-[#0B1E3F]/50">Payments are not yet enabled. Choosing a paid plan saves the selection to your profile only — billing will be added before launch.</div>

      <LeaveAccountSection user={user} current={current} onSwitchToFree={() => choose('free')} />
    </div>
  );
}

function LeaveAccountSection({ user, current, onSwitchToFree }: any) {
  const [step, setStep] = useState<'idle' | 'offer-free' | 'confirm-delete'>('idle');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isPaid = PAID_PLANS.has(current);

  const startLeave = () => {
    setError(null);
    if (isPaid) setStep('offer-free');
    else setStep('confirm-delete');
  };

  const deleteAccount = async () => {
    if (typed.trim().toUpperCase() !== 'DELETE') {
      setError('Type DELETE to confirm.');
      return;
    }
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/profile/delete', { method: 'DELETE' });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error || `Delete failed (${r.status})`);
      const sb = getSupabase();
      if (sb) await sb.auth.signOut();
      if (typeof window !== 'undefined') window.location.href = '/';
    } catch (err: any) {
      setError(err?.message || 'Delete failed');
      setBusy(false);
    }
  };

  if (step === 'idle') {
    return (
      <div className="pt-6 border-t border-[#0B1E3F]/10 text-[#0B1E3F]">
        <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/55 mb-2">Leaving Haulock?</div>
        <p className="text-sm text-[#0B1E3F]/65 max-w-2xl mb-3">
          {isPaid
            ? 'You can cancel your paid plan or delete your account entirely. We\'ll offer you the Free plan first — it\'s genuinely free.'
            : 'You can permanently delete your account. All your lookups, watchlist, and reports will be removed.'}
        </p>
        <button onClick={startLeave} className="px-4 py-2 text-sm text-[#DC2626] hover:bg-[#DC2626]/10 rounded-full transition">
          {isPaid ? 'Cancel plan or delete account' : 'Delete my account'}
        </button>
      </div>
    );
  }

  if (step === 'offer-free') {
    return (
      <div className="pt-6 border-t border-[#0B1E3F]/10 text-[#0B1E3F]">
        <div className="p-6 bg-[#16A34A]/5 border border-[#16A34A]/25 rounded-2xl">
          <div className="flex items-start gap-3 mb-4">
            <CheckCircle2 className="w-5 h-5 text-[#16A34A] mt-0.5 flex-shrink-0" />
            <div>
              <div className="text-lg font-semibold text-[#0B1E3F] mb-1">Try Free before you leave — it&apos;s actually free.</div>
              <div className="text-sm text-[#0B1E3F]/70">5 broker/carrier verifications per month. No card required, no expiration. Keep your lookup history, alerts, and watchlist. Come back to a paid plan anytime.</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={onSwitchToFree} className="px-5 py-2.5 bg-[#16A34A] text-white rounded-full text-sm font-medium hover:bg-[#16A34A]/90 transition">Switch to Free plan</button>
            <button onClick={() => setStep('confirm-delete')} className="px-5 py-2.5 border border-[#DC2626]/30 text-[#DC2626] hover:bg-[#DC2626]/5 rounded-full text-sm font-medium transition">No thanks — delete my account</button>
            <button onClick={() => setStep('idle')} className="px-5 py-2.5 text-[#0B1E3F]/60 hover:text-[#0B1E3F] text-sm transition">Keep my current plan</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-6 border-t border-[#0B1E3F]/10 text-[#0B1E3F]">
      <div className="p-6 bg-[#DC2626]/5 border border-[#DC2626]/25 rounded-2xl">
        <div className="flex items-start gap-3 mb-4">
          <AlertTriangle className="w-5 h-5 text-[#DC2626] mt-0.5 flex-shrink-0" />
          <div>
            <div className="text-lg font-semibold text-[#0B1E3F] mb-1">Delete your account</div>
            <div className="text-sm text-[#0B1E3F]/70 mb-2">This permanently removes your login, lookup history, watchlist, alerts, fraud reports, and team membership ({user?.email}). It cannot be undone.</div>
            <div className="text-xs mono text-[#0B1E3F]/55">Type <span className="px-1.5 py-0.5 bg-[#0B1E3F]/10 rounded">DELETE</span> to confirm.</div>
          </div>
        </div>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="DELETE"
          className="w-full max-w-xs px-4 py-2.5 mb-3 bg-white border border-[#0B1E3F]/15 rounded-lg font-mono text-sm focus:outline-none focus:border-[#DC2626] text-[#0B1E3F]"
        />
        {error && <div className="text-sm text-[#DC2626] mb-3">{error}</div>}
        <div className="flex flex-wrap gap-2">
          <button onClick={deleteAccount} disabled={busy || typed.trim().toUpperCase() !== 'DELETE'} className="px-5 py-2.5 bg-[#DC2626] text-white rounded-full text-sm font-medium hover:bg-[#DC2626]/90 transition disabled:opacity-60 flex items-center gap-2">
            {busy && <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            {busy ? 'Deleting…' : 'Delete my account forever'}
          </button>
          <button onClick={() => { setStep('idle'); setTyped(''); setError(null); }} disabled={busy} className="px-5 py-2.5 text-[#0B1E3F]/70 hover:text-[#0B1E3F] text-sm transition">Cancel</button>
        </div>
      </div>
    </div>
  );
}

function ProfileTab({ user }: any) {
  const initialId = user?.mc ? `MC-${user.mc}` : user?.dot ? `DOT-${user.dot}` : '';
  const [id, setId] = useState(initialId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [meta, setMeta] = useState<any>(null);
  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    sb.auth.getUser().then(({ data }) => setMeta(data?.user?.user_metadata || null));
  }, []);
  const lastChangedAt = meta?.mc_changed_at as string | undefined;
  const daysSinceChange = lastChangedAt ? (Date.now() - new Date(lastChangedAt).getTime()) / (1000 * 60 * 60 * 24) : null;
  const daysLeft = daysSinceChange != null ? Math.max(0, Math.ceil(30 - daysSinceChange)) : 0;
  const hasExistingId = Boolean(user?.mc || user?.dot);
  const lockedByCooldown = hasExistingId && daysLeft > 0;

  const onSaveId = async () => {
    setError(null); setInfo(null); setSaving(true);
    try {
      const r = await fetch('/api/profile/mc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || 'Failed to save');
      setInfo('Saved. Your score is being refreshed in the header.');
      invalidateCache('own-score');
      // Force the local Supabase session JWT to refresh so user_metadata picks up the change.
      const sb = getSupabase();
      if (sb) {
        await sb.auth.refreshSession();
        const { data: fresh } = await sb.auth.getUser();
        setMeta(fresh?.user?.user_metadata || null);
      }
    } catch (e: any) { setError(e?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-5">
      <h2 className="text-xl font-semibold text-[#0B1E3F] mb-4">Profile</h2>
      <Field label="Full name" defaultValue={user.name} />
      <Field label="Email" type="email" defaultValue={user.email} />
      <Field label="Company name" defaultValue={user.company} />
      <div>
        <label className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 block mb-2">Your MC or DOT number</label>
        <input
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="e.g. MC-65250 or DOT-3170105"
          disabled={lockedByCooldown}
          className="w-full px-4 py-3 bg-white border border-[#0B1E3F]/15 rounded-xl focus:outline-none focus:border-[#0B1E3F] transition text-[#0B1E3F] placeholder:text-[#0B1E3F]/30 disabled:bg-[#0B1E3F]/5"
        />
        <div className="text-xs text-[#0B1E3F]/55 mt-2">
          {hasExistingId
            ? lockedByCooldown
              ? `Locked — you can change it again in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Limited to 1 change every 30 days.`
              : 'You can change your broker ID now. After saving, it locks for 30 days.'
            : 'Set your MC or DOT once. After saving, it locks for 30 days. We refresh your own score automatically every 24 hours — free, no quota used.'}
        </div>
        {error && <div className="text-sm text-[#DC2626] mt-2">{error}</div>}
        {info && <div className="text-sm text-[#16A34A] mt-2">{info}</div>}
      </div>
      <button onClick={onSaveId} disabled={saving || lockedByCooldown} className="px-5 py-2.5 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90 transition disabled:opacity-60">
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  );
}

function TeamTab({ navigate, user }: any) {
  const res = useCachedFetch<any>('team', '/api/team');
  const t = res.data;
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const refresh = () => { invalidateCache('team', 'usage'); res.refetch(); };

  const setupTeam = async () => {
    if (!user?.plan) return;
    setCreating(true); setError(null);
    try {
      const r = await fetch('/api/team/sync-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: user.plan }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || 'Failed to set up team');
      refresh();
    } catch (err: any) { setError(err?.message || 'Failed to set up team'); }
    finally { setCreating(false); }
  };

  const onInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setInfo(null); setPending(true);
    try {
      const r = await fetch('/api/team/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim() }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || 'Invite failed');
      setInfo(`Invite sent to ${email.trim()}.`);
      setEmail('');
      refresh();
    } catch (err: any) { setError(err?.message || 'Invite failed'); }
    finally { setPending(false); }
  };

  const revokeInvite = async (id: string) => {
    if (!confirm('Revoke this invite?')) return;
    await fetch(`/api/team/invite/${id}`, { method: 'DELETE' });
    refresh();
  };
  const removeMember = async (userId: string, isMe: boolean) => {
    if (!confirm(isMe ? 'Leave this team?' : 'Remove this member from the team?')) return;
    await fetch(`/api/team/members/${userId}`, { method: 'DELETE' });
    refresh();
  };

  if (!t) return <div className="py-8 text-sm text-[#0B1E3F]/60">Loading…</div>;

  if (!t.team) {
    const isPaid = PAID_PLANS.has(user?.plan);
    const planLabel = PLAN_DETAILS[user?.plan]?.label || 'team';
    return (
      <div>
        <h2 className="text-xl font-semibold text-[#0B1E3F] mb-3">Team</h2>
        {isPaid ? (
          <>
            <p className="text-sm text-[#0B1E3F]/70 mb-6">You&rsquo;re on the <strong>{planLabel}</strong> plan but no team has been set up yet. Click below to create your team — you&rsquo;ll be the owner and can invite members right away.</p>
            {error && <div className="text-sm text-[#DC2626] mb-3">{error}</div>}
            <button onClick={setupTeam} disabled={creating} className="px-5 py-2.5 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90 disabled:opacity-60">
              {creating ? 'Setting up…' : `Set up my ${planLabel} team`}
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-[#0B1E3F]/70 mb-6">You aren&rsquo;t on a team yet. Pick a paid plan (<strong>Carrier</strong>, <strong>Team</strong>, or <strong>Fleet</strong>) and a team will be created for you. Then invite members from this tab.</p>
            <button onClick={() => navigate('plan')} className="px-5 py-2.5 bg-[#FF6B35] text-white rounded-full text-sm font-medium hover:bg-[#FF6B35]/90">Choose a plan</button>
          </>
        )}
      </div>
    );
  }

  const isOwner = t.role === 'owner';
  const seatsLeft = Math.max(0, (t.seatsTotal || 0) - (t.seatsUsed || 0));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-[#0B1E3F] mb-1">{t.team.name || 'Your team'}</h2>
        <div className="text-sm text-[#0B1E3F]/60">
          On the <strong className="text-[#0B1E3F]">{t.team.planLabel}</strong> plan · {t.seatsUsed} / {t.seatsTotal} seats used · {seatsLeft} left · {isOwner ? 'You are the owner' : 'You are a member'}
        </div>
      </div>

      {isOwner && (
        <div className="p-5 bg-[#0B1E3F]/5 rounded-xl">
          <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-3">Invite a member</div>
          <form onSubmit={onInvite} className="flex gap-2 flex-wrap">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="dispatcher@yourcompany.com"
              disabled={pending || seatsLeft === 0}
              className="flex-1 min-w-[200px] px-4 py-2.5 bg-white border border-[#0B1E3F]/15 rounded-xl text-sm text-[#0B1E3F] focus:outline-none focus:border-[#0B1E3F] placeholder:text-[#0B1E3F]/30"
            />
            <button type="submit" disabled={pending || seatsLeft === 0} className="px-5 py-2.5 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90 disabled:opacity-60">
              {pending ? 'Sending…' : 'Send invite'}
            </button>
          </form>
          {seatsLeft === 0 && <div className="text-xs text-[#F59E0B] mt-2">No seats left on the {t.team.planLabel} plan. Upgrade to invite more.</div>}
          {error && <div className="text-sm text-[#DC2626] mt-2">{error}</div>}
          {info && <div className="text-sm text-[#16A34A] mt-2">{info}</div>}
        </div>
      )}

      <div>
        <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-3">Members ({t.members.length})</div>
        <div className="bg-white border border-[#0B1E3F]/10 rounded-xl divide-y divide-[#0B1E3F]/5">
          {t.members.map((m: any) => (
            <div key={m.user_id} className="flex items-center gap-4 p-4">
              <div className="w-9 h-9 rounded-full bg-[#0B1E3F] flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">{(m.name || '?').split(' ').map((p: string) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[#0B1E3F] truncate">{m.name}{m.isMe && ' (you)'}</div>
                <div className="text-xs mono text-[#0B1E3F]/60 truncate">{m.email}</div>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-[10px] mono uppercase tracking-wider ${m.role === 'owner' ? 'bg-[#FF6B35] text-white' : 'bg-[#0B1E3F]/10 text-[#0B1E3F]/70'}`}>{m.role}</span>
              {((isOwner && !m.isMe) || (m.isMe && !isOwner)) && (
                <button onClick={() => removeMember(m.user_id, m.isMe)} className="text-xs text-[#0B1E3F]/60 hover:text-[#DC2626]">{m.isMe ? 'Leave' : 'Remove'}</button>
              )}
            </div>
          ))}
        </div>
      </div>

      {t.invites && t.invites.length > 0 && (
        <div>
          <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-3">Pending invites ({t.invites.length})</div>
          <div className="bg-white border border-[#0B1E3F]/10 rounded-xl divide-y divide-[#0B1E3F]/5">
            {t.invites.map((inv: any) => (
              <div key={inv.id} className="flex items-center gap-4 p-4">
                <Mail className="w-4 h-4 text-[#0B1E3F]/40 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[#0B1E3F] truncate">{inv.email}</div>
                  <div className="text-xs mono text-[#0B1E3F]/55">Sent {timeAgo(inv.created_at)} · expires {new Date(inv.expires_at).toLocaleDateString()}</div>
                </div>
                {isOwner && <button onClick={() => revokeInvite(inv.id)} className="text-xs text-[#0B1E3F]/60 hover:text-[#DC2626]">Revoke</button>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FmcsaStatsCard() {
  const [stats, setStats] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch('/api/admin/fmcsa-stats');
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `Failed (${r.status})`);
      setStats(j);
    } catch (e: any) {
      setError(e?.message || 'Failed');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const d = stats?.window?.day;
  const h = stats?.window?.hour;
  const w = stats?.window?.week;
  const errRate = d && d.total ? (d.errors / d.total) : 0;
  const throttled = d?.throttled429 ?? 0;
  const healthTone =
    throttled > 0 ? 'danger' :
    errRate > 0.1 ? 'warn' :
    'good';
  const healthLabel =
    throttled > 0 ? `${throttled} throttled (429)` :
    errRate > 0.1 ? `${Math.round(errRate * 100)}% errors` :
    'Healthy';
  const healthColor =
    healthTone === 'danger' ? '#DC2626' :
    healthTone === 'warn' ? '#F59E0B' :
    '#16A34A';

  const cacheHitPct = d?.cacheHitRate != null ? Math.round(d.cacheHitRate * 100) : null;

  return (
    <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-5 card-shadow text-[#0B1E3F]">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/55">FMCSA API observability</div>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] mono uppercase tracking-wider" style={{ backgroundColor: `${healthColor}1a`, color: healthColor }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: healthColor }} />
            {healthLabel}
          </span>
        </div>
        <button onClick={load} disabled={loading} className="text-xs mono text-[#0B1E3F]/60 hover:text-[#0B1E3F] transition disabled:opacity-50">
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="text-sm text-[#DC2626] mb-3">{error}</div>}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <Stat label="Last hour" value={h?.total ?? '—'} sub={h != null && h.errors > 0 ? `${h.errors} err` : null} />
        <Stat label="Last 24 h" value={d?.total ?? '—'} sub={d != null ? `${d.ok ?? 0} ok · ${d.errors ?? 0} err` : null} />
        <Stat label="Last 7 days" value={w?.total ?? '—'} />
        <Stat label="Avg latency" value={d?.avgDurationMs != null ? `${d.avgDurationMs} ms` : '—'} />
        <Stat label="Cache hit rate" value={cacheHitPct != null ? `${cacheHitPct}%` : '—'} sub={cacheHitPct != null ? '24h · lookups / FMCSA' : null} />
      </div>

      {throttled > 0 && (
        <div className="mb-4 p-3 bg-[#DC2626]/10 border border-[#DC2626]/30 rounded-lg text-sm text-[#0B1E3F]">
          <strong className="text-[#DC2626]">FMCSA is rate-limiting you.</strong> {throttled} HTTP 429 response{throttled === 1 ? '' : 's'} in the last 24h. Consider raising cache TTL or adding a global daily budget.
        </div>
      )}

      <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55 mb-2">Last 10 FMCSA calls</div>
      <div className="border border-[#0B1E3F]/10 rounded-lg overflow-hidden">
        <div className="grid grid-cols-[1fr_80px_80px_120px] gap-2 px-3 py-2 bg-[#0B1E3F]/5 text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">
          <div>Path</div><div>Status</div><div className="text-right">Duration</div><div className="text-right">When</div>
        </div>
        {stats?.recent?.length ? (
          <div className="divide-y divide-[#0B1E3F]/5">
            {stats.recent.map((ev: any, i: number) => (
              <div key={i} className="grid grid-cols-[1fr_80px_80px_120px] gap-2 px-3 py-2 text-xs items-center">
                <div className="mono truncate text-[#0B1E3F]/80" title={ev.error || ev.path || ''}>{ev.path || '—'}</div>
                <div className="mono text-xs" style={{ color: ev.http_status === 429 ? '#DC2626' : ev.status === 'ok' ? '#16A34A' : '#F59E0B' }}>
                  {ev.http_status || (ev.status === 'ok' ? 200 : 'err')}
                </div>
                <div className="mono text-xs text-right text-[#0B1E3F]/60">{ev.duration_ms != null ? `${ev.duration_ms} ms` : '—'}</div>
                <div className="mono text-xs text-right text-[#0B1E3F]/60">{timeAgo(ev.created_at)}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-3 py-6 text-center text-xs text-[#0B1E3F]/50">No FMCSA calls logged yet.</div>
        )}
      </div>
    </div>
  );
}

function StripeOverviewCard() {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch('/api/admin/stripe-overview');
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `Failed (${r.status})`);
      setData(j);
    } catch (e: any) {
      setError(e?.message || 'Failed');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const fmtMoney = (cents: number, currency = 'USD') =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);

  return (
    <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-5 card-shadow text-[#0B1E3F]">
      <div className="flex items-center justify-between mb-4">
        <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/55">Stripe subscriptions</div>
        <button onClick={load} disabled={loading} className="text-xs mono text-[#0B1E3F]/60 hover:text-[#0B1E3F] transition disabled:opacity-50">
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="text-sm text-[#DC2626] mb-3">{error}</div>}

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-5">
        <Stat label="MRR (est.)" value={data ? fmtMoney(data.totals.mrr_cents, data.totals.currency) : '—'} sub="From active subs" />
        <Stat label="Active" value={data?.totals?.active ?? '—'} />
        <Stat label="Past due" value={data?.totals?.past_due ?? '—'} sub="Needs follow-up" />
        <Stat label="Canceled" value={data?.totals?.canceled ?? '—'} />
        <Stat label="New (30d)" value={data?.totals?.new_last_30d ?? '—'} />
        <Stat label="Abandoned" value={data?.totals?.incomplete ?? '—'} sub="Checkout dropped" />
      </div>

      {(data?.planBreakdown || data?.billingBreakdown || data?.totals?.ever_paid_customers != null) && (
        <div className="flex flex-wrap gap-2 mb-5">
          {data?.planBreakdown && Object.entries(data.planBreakdown).map(([plan, count]) => (
            <span key={`plan-${plan}`} className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#0B1E3F]/5 text-xs mono" title="Active subscribers on this plan tier">
              <span className="uppercase tracking-wider text-[#0B1E3F]/60">{plan}</span>
              <span className="font-semibold text-[#0B1E3F]">{String(count)}</span>
            </span>
          ))}
          {data?.billingBreakdown && (
            <>
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#16A34A]/10 text-xs mono" title="Active subscribers paying monthly">
                <span className="uppercase tracking-wider text-[#16A34A]">Monthly</span>
                <span className="font-semibold text-[#0B1E3F]">{String(data.billingBreakdown.monthly ?? 0)}</span>
              </span>
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#0B1E3F]/10 text-xs mono" title="Active subscribers paying annually">
                <span className="uppercase tracking-wider text-[#0B1E3F]/70">Annual</span>
                <span className="font-semibold text-[#0B1E3F]">{String(data.billingBreakdown.annual ?? 0)}</span>
              </span>
            </>
          )}
          {data?.totals?.ever_paid_customers != null && (
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#0B1E3F]/5 text-xs mono" title="Distinct customers who have ever paid us, regardless of current status">
              <span className="uppercase tracking-wider text-[#0B1E3F]/60">Ever paid</span>
              <span className="font-semibold text-[#0B1E3F]">{String(data.totals.ever_paid_customers)}</span>
            </span>
          )}
        </div>
      )}

      {Array.isArray(data?.monthlyGrowth) && data.monthlyGrowth.length > 0 && (() => {
        const maxBar = Math.max(1, ...data.monthlyGrowth.map((m: any) => Math.max(m.new || 0, m.canceled || 0)));
        const totalNew = data.monthlyGrowth.reduce((s: number, m: any) => s + (m.new || 0), 0);
        const totalCanceled = data.monthlyGrowth.reduce((s: number, m: any) => s + (m.canceled || 0), 0);
        return (
          <div className="mb-5 p-4 bg-[#F5F3EE]/60 rounded-xl">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div>
                <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">Subscriber growth · last 12 months</div>
                <div className="text-xs mono text-[#0B1E3F]/70 mt-0.5">
                  <span className="text-[#16A34A] font-semibold">+{totalNew}</span> new ·{' '}
                  <span className="text-[#DC2626] font-semibold">-{totalCanceled}</span> canceled ·{' '}
                  <span className="text-[#0B1E3F] font-semibold">net {totalNew - totalCanceled >= 0 ? '+' : ''}{totalNew - totalCanceled}</span>
                </div>
              </div>
              <div className="flex items-center gap-3 text-[10px] mono text-[#0B1E3F]/60">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-[#16A34A]" /> new</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-[#DC2626]" /> canceled</span>
              </div>
            </div>
            <div className="flex items-end gap-1.5 h-24">
              {data.monthlyGrowth.map((m: any) => {
                const newPct = ((m.new || 0) / maxBar) * 100;
                const cancelPct = ((m.canceled || 0) / maxBar) * 100;
                return (
                  <div key={m.month} className="flex-1 flex flex-col items-stretch min-w-0" title={`${m.label} ${m.month.slice(0, 4)} · +${m.new || 0} new · -${m.canceled || 0} canceled`}>
                    <div className="flex-1 flex items-end gap-0.5">
                      <div className="flex-1 bg-[#16A34A] rounded-t" style={{ height: `${newPct}%`, minHeight: m.new > 0 ? 2 : 0 }} />
                      <div className="flex-1 bg-[#DC2626] rounded-t" style={{ height: `${cancelPct}%`, minHeight: m.canceled > 0 ? 2 : 0 }} />
                    </div>
                    <div className="text-[9px] mono text-[#0B1E3F]/50 text-center mt-1 truncate">{m.label}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55 mb-2">Recent subscriptions</div>
      <div className="border border-[#0B1E3F]/10 rounded-lg overflow-hidden">
        <div className="grid grid-cols-[1fr_100px_90px_90px_100px] gap-2 px-3 py-2 bg-[#0B1E3F]/5 text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">
          <div>Customer</div>
          <div>Plan</div>
          <div>Status</div>
          <div className="text-right">MRR</div>
          <div className="text-right">Created</div>
        </div>
        {data?.recent?.length ? (
          <div className="divide-y divide-[#0B1E3F]/5">
            {data.recent.map((s: any) => {
              const isCanceling = s.cancel_at_period_end === true && (s.status === 'active' || s.status === 'trialing');
              const statusColor = isCanceling ? '#F59E0B'
                : s.status === 'active' || s.status === 'trialing' ? '#16A34A'
                : s.status === 'past_due' || s.status === 'unpaid' ? '#F59E0B'
                : '#DC2626';
              const cancelDate = isCanceling && s.current_period_end
                ? new Date(s.current_period_end * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                : null;
              const paid = s.paid_amount;
              const list = s.list_amount;
              const hasDiscount = paid != null && list != null && paid < list;
              return (
                <div key={s.id} className="grid grid-cols-[1fr_100px_90px_90px_100px] gap-2 px-3 py-2 text-xs items-center">
                  <div className="truncate" title={s.customer_email || s.id}>
                    <div className="text-[#0B1E3F] font-medium truncate">{s.customer_name || s.customer_email || '—'}</div>
                    {s.customer_email && s.customer_name && (
                      <div className="text-[10px] text-[#0B1E3F]/55 truncate">{s.customer_email}{s.promo_code ? ` · ${s.promo_code}` : ''}</div>
                    )}
                  </div>
                  <div className="mono text-[#0B1E3F]/80 capitalize">{s.plan || '—'}{s.billing ? ` · ${s.billing === 'annual' ? 'yr' : 'mo'}` : ''}</div>
                  <div className="mono text-xs leading-tight" style={{ color: statusColor }}>
                    {isCanceling ? 'canceling' : s.status}
                    {cancelDate && (
                      <div className="text-[10px] opacity-80">ends {cancelDate}</div>
                    )}
                  </div>
                  <div className="mono text-xs text-right">
                    <div className="text-[#0B1E3F]/80">{paid != null ? fmtMoney(paid, s.currency) : list != null ? fmtMoney(list, s.currency) : '—'}</div>
                    {hasDiscount && (
                      <div className="text-[10px] text-[#0B1E3F]/40 line-through">{fmtMoney(list!, s.currency)}</div>
                    )}
                    {(() => {
                      const gross = Number(s.lifetime_spent) || 0;
                      const refunded = Number(s.lifetime_refunded) || 0;
                      const net = Math.max(0, gross - refunded);
                      if (gross === 0) return null;
                      return (
                        <>
                          <div className={`text-[10px] ${net > 0 ? 'text-[#16A34A]' : 'text-[#0B1E3F]/40'}`} title="Net lifetime revenue (paid minus refunded)">
                            {fmtMoney(net, s.currency)} net
                          </div>
                          {refunded > 0 && (
                            <div className="text-[10px] text-[#DC2626]" title="Total refunded to this customer">
                              -{fmtMoney(refunded, s.currency)} refund
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                  <div className="mono text-xs text-right text-[#0B1E3F]/60">{timeAgo(new Date(s.created * 1000).toISOString())}</div>
                </div>
              );
            })}
          </div>
        ) : loading ? (
          <div className="px-3 py-6 text-center text-xs text-[#0B1E3F]/50">Loading…</div>
        ) : (
          <div className="px-3 py-6 text-center text-xs text-[#0B1E3F]/50">No Haulock subscriptions yet.</div>
        )}
      </div>
    </div>
  );
}

// Admin-only "History data growth" card — shows how many rows have been
// written to carrier_snapshots over time, broken down by source (lookup vs
// bulk-ingest) and change type (initial vs update). Lets us watch the
// dataset compound into a real moat.
function SnapshotsStatsCard() {
  type SnapshotsStats = {
    totals: { allTime: number; last24h: number; last7d: number; priorWeek: number; distinctCarriersLast7d: number };
    daily: { date: string; total: number; lookup: number; bulk: number; initial: number; updates: number }[];
    recent: { name: string | null; dot: string | null; mc: string | null; capturedAt: string; changedFields: string[]; source: string }[];
    fetchedAt: string;
  };
  const [stats, setStats] = useState<SnapshotsStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    setError(null);
    try {
      const res = await fetch('/api/admin/snapshots-stats');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Failed (${res.status})`);
      setStats(data);
    } catch (e: any) {
      setError(e?.message || 'Failed to load snapshot stats');
    }
  };
  useEffect(() => { load(); }, []);

  const fmtCount = (n: number) => n.toLocaleString();
  const wow = stats ? stats.totals.last7d - stats.totals.priorWeek : 0;
  const wowPct = stats && stats.totals.priorWeek > 0 ? Math.round((wow / stats.totals.priorWeek) * 100) : null;

  const maxDay = stats ? Math.max(1, ...stats.daily.map((d) => d.total)) : 1;

  return (
    <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-6 card-shadow text-[#0B1E3F]">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-xs mono uppercase tracking-wider text-[#16A34A] font-semibold">History data growth</span>
            <span className="px-2 py-0.5 bg-[#16A34A]/10 text-[#16A34A] rounded-full text-[10px] mono uppercase tracking-wider font-semibold">Carrier snapshots</span>
          </div>
          <h2 className="text-xl font-semibold text-[#0B1E3F]">Daily snapshot capture</h2>
          <div className="text-xs text-[#0B1E3F]/60 mt-0.5">Append-only identity history. Every change Haulock observes lives here forever.</div>
        </div>
        <button onClick={load} className="px-3 py-1.5 border border-[#0B1E3F]/15 bg-white rounded-full text-xs font-medium hover:bg-[#0B1E3F]/5">Refresh</button>
      </div>

      {error && <div className="text-sm text-[#DC2626] mb-3">{error}</div>}

      {stats == null ? (
        <div className="py-8 text-center text-sm text-[#0B1E3F]/50">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
            <div className="p-4 bg-[#F5F3EE]/60 rounded-xl">
              <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">All-time rows</div>
              <div className="text-2xl font-semibold mt-1">{fmtCount(stats.totals.allTime)}</div>
            </div>
            <div className="p-4 bg-[#F5F3EE]/60 rounded-xl">
              <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">Last 24 hours</div>
              <div className="text-2xl font-semibold mt-1">{fmtCount(stats.totals.last24h)}</div>
            </div>
            <div className="p-4 bg-[#F5F3EE]/60 rounded-xl">
              <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">Last 7 days</div>
              <div className="text-2xl font-semibold mt-1">{fmtCount(stats.totals.last7d)}</div>
              {wowPct != null && (
                <div className={`text-[10px] mono mt-1 ${wow >= 0 ? 'text-[#16A34A]' : 'text-[#DC2626]'}`}>
                  {wow >= 0 ? '↑' : '↓'} {Math.abs(wowPct)}% vs prior week
                </div>
              )}
            </div>
            <div className="p-4 bg-[#F5F3EE]/60 rounded-xl">
              <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">Distinct carriers · 7d</div>
              <div className="text-2xl font-semibold mt-1">{fmtCount(stats.totals.distinctCarriersLast7d)}</div>
            </div>
            <div className="p-4 bg-[#F5F3EE]/60 rounded-xl">
              <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">Avg / day · 30d</div>
              <div className="text-2xl font-semibold mt-1">
                {fmtCount(Math.round(stats.daily.reduce((a, d) => a + d.total, 0) / Math.max(1, stats.daily.length)))}
              </div>
            </div>
          </div>

          {/* Daily bar chart — last 30 days. Each bar split into update + initial. */}
          <div className="mb-2 flex items-center justify-between text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">
            <span>Last 30 days</span>
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-[#16A34A]" /> updates</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-[#0B1E3F]/55" /> initial</span>
            </span>
          </div>
          <div className="flex items-end gap-1 h-32 mb-4 border-b border-[#0B1E3F]/10">
            {stats.daily.map((d) => {
              const pct = (d.total / maxDay) * 100;
              const initialPct = d.total > 0 ? (d.initial / d.total) * pct : 0;
              const updatesPct = pct - initialPct;
              return (
                <div key={d.date} className="flex-1 flex flex-col justify-end items-stretch min-w-0" title={`${d.date} · ${d.total} rows · ${d.lookup} lookup · ${d.bulk} bulk`}>
                  <div className="bg-[#16A34A]" style={{ height: `${updatesPct}%` }} />
                  <div className="bg-[#0B1E3F]/55" style={{ height: `${initialPct}%` }} />
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-[9px] mono text-[#0B1E3F]/45 mb-5">
            <span>{stats.daily[0]?.date}</span>
            <span>today</span>
          </div>

          {/* Recent activity feed */}
          {stats.recent.length > 0 && (
            <div>
              <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55 mb-2">Recent activity</div>
              <div className="space-y-1.5">
                {stats.recent.map((r, i) => {
                  const isInitial = r.changedFields?.includes('initial');
                  const fieldsList = isInitial ? 'first record' : (r.changedFields || []).slice(0, 4).join(', ');
                  return (
                    <div key={i} className="flex items-start gap-3 p-2.5 bg-[#F5F3EE]/40 rounded-lg">
                      <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${isInitial ? 'bg-[#0B1E3F]/55' : 'bg-[#16A34A]'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-[#0B1E3F] truncate">{r.name || '—'}</span>
                          <span className="text-[10px] mono text-[#0B1E3F]/55">
                            {[r.mc && `MC-${r.mc}`, r.dot && `DOT-${r.dot}`].filter(Boolean).join(' · ') || 'no id'}
                          </span>
                        </div>
                        <div className="text-[11px] text-[#0B1E3F]/55 mt-0.5">
                          <span className="mono">{timeAgo(r.capturedAt)}</span>
                          <span className="mx-1.5 text-[#0B1E3F]/25">·</span>
                          <span>{fieldsList}{!isInitial && (r.changedFields?.length || 0) > 4 ? ` +${r.changedFields.length - 4}` : ''}</span>
                          <span className="mx-1.5 text-[#0B1E3F]/25">·</span>
                          <span className="text-[#0B1E3F]/55">{r.source}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Supabase storage usage — calls pg_database_size + per-table breakdown,
// then compares against the operator's actual disk allocation (read on the
// server from env). pg_database_size returns ONLY the database; Supabase's
// dashboard shows DB + WAL + system on disk. We render both so the number
// here matches what the dashboard says when you cross-check.
function SupabaseStorageCard() {
  type StorageStats = {
    database_bytes: number;
    fetched_at: string;
    tables: { name: string; total_bytes: number; data_bytes: number; index_bytes: number; row_estimate: number }[];
    plan: {
      disk_bytes: number;
      disk_gb: number;
      system_reserve_bytes: number;
      system_reserve_gb: number;
      effective_db_budget_bytes: number;
    };
  };
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const load = async () => {
    setError(null); setHint(null);
    try {
      const res = await fetch('/api/admin/storage-stats');
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || `Failed (${res.status})`);
        if (data?.hint) setHint(data.hint);
        return;
      }
      setStats(data);
    } catch (e: any) {
      setError(e?.message || 'Failed to load storage stats');
    }
  };
  useEffect(() => { load(); }, []);

  const fmtBytes = (n: number): string => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  };

  const usedBytes = stats?.database_bytes ?? 0;
  const diskBytes = stats?.plan.disk_bytes ?? 8 * 1024 * 1024 * 1024;
  const dbBudgetBytes = stats?.plan.effective_db_budget_bytes ?? diskBytes;
  // Headline percentage: the database vs the disk allocation MINUS system
  // reserve (so 100% means "out of room for actual data growth"). Honest.
  const usagePct = dbBudgetBytes > 0 ? Math.min(100, Math.round((usedBytes / dbBudgetBytes) * 100)) : 0;
  const usageColor = usagePct >= 90 ? '#DC2626' : usagePct >= 70 ? '#F59E0B' : '#16A34A';

  return (
    <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-6 card-shadow text-[#0B1E3F]">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 font-semibold">Supabase storage</span>
            <span className="px-2 py-0.5 bg-[#0B1E3F]/5 text-[#0B1E3F]/70 rounded-full text-[10px] mono uppercase tracking-wider font-semibold">database size</span>
          </div>
          <h2 className="text-xl font-semibold text-[#0B1E3F]">Database usage</h2>
          <div className="text-xs text-[#0B1E3F]/60 mt-0.5">Live from Postgres pg_database_size. Disk allocation read from <code className="mono">SUPABASE_DISK_GB</code> env var.</div>
        </div>
        <button onClick={load} className="px-3 py-1.5 border border-[#0B1E3F]/15 bg-white rounded-full text-xs font-medium hover:bg-[#0B1E3F]/5">Refresh</button>
      </div>

      {error && (
        <div className="mb-3 p-3 bg-[#DC2626]/5 border border-[#DC2626]/20 rounded-lg text-sm text-[#DC2626]">
          {error}
          {hint && <div className="mt-1 text-xs text-[#0B1E3F]/65">{hint}</div>}
        </div>
      )}

      {stats == null && !error ? (
        <div className="py-8 text-center text-sm text-[#0B1E3F]/50">Loading…</div>
      ) : stats ? (
        <>
          <div className="flex items-end justify-between mb-2 flex-wrap gap-2">
            <div>
              <div className="text-3xl font-semibold" style={{ color: usageColor }}>
                {fmtBytes(usedBytes)}
                <span className="text-base font-normal text-[#0B1E3F]/55 ml-2">/ {fmtBytes(dbBudgetBytes)} budget</span>
              </div>
              <div className="text-xs text-[#0B1E3F]/55 mt-0.5">
                {usagePct}% of usable database space ({stats.plan.disk_gb} GB allocated · ~{stats.plan.system_reserve_gb} GB reserved for WAL & system)
              </div>
            </div>
            <div className={`text-[10px] mono uppercase tracking-wider font-semibold ${usagePct >= 90 ? 'text-[#DC2626]' : usagePct >= 70 ? 'text-[#F59E0B]' : 'text-[#16A34A]'}`}>
              {usagePct >= 90 ? 'UPGRADE DISK'
                : usagePct >= 70 ? 'Watch usage'
                : 'Plenty of headroom'}
            </div>
          </div>
          <div className="h-2 bg-[#0B1E3F]/8 rounded-full overflow-hidden mb-2 relative">
            <div className="h-full transition-all duration-300" style={{ width: `${usagePct}%`, backgroundColor: usageColor }} />
            {/* 70% / 90% threshold tick marks */}
            <div className="absolute top-0 bottom-0 w-px bg-[#F59E0B]" style={{ left: '70%' }} />
            <div className="absolute top-0 bottom-0 w-px bg-[#DC2626]" style={{ left: '90%' }} />
          </div>
          <div className="flex items-center justify-between text-[10px] mono text-[#0B1E3F]/45 mb-4">
            <span>0</span>
            <span className="text-[#F59E0B]">70% warn</span>
            <span className="text-[#DC2626]">90% upgrade</span>
            <span>{fmtBytes(dbBudgetBytes)}</span>
          </div>

          {/* Honest disclosure: the Supabase dashboard shows DB + WAL + system. */}
          <div className="mb-5 p-3 bg-[#0B1E3F]/[0.03] rounded-lg text-[11px] text-[#0B1E3F]/65 leading-relaxed">
            <strong className="text-[#0B1E3F]">Why this differs from the Supabase dashboard:</strong>{' '}
            We report only the database itself ({fmtBytes(usedBytes)}). The dashboard's "Disk Size" total also includes WAL (~100 MB), system tables, and replication slots (~800 MB on a fresh project). Total disk = our number + ~{stats.plan.system_reserve_gb} GB of overhead.
          </div>

          {/* Per-table breakdown */}
          <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55 mb-2">Largest tables</div>
          <div className="space-y-1.5">
            {stats.tables.slice(0, 8).map((t) => {
              const tablePct = stats.database_bytes > 0
                ? Math.round((t.total_bytes / stats.database_bytes) * 100)
                : 0;
              return (
                <div key={t.name} className="p-2.5 bg-[#F5F3EE]/40 rounded-lg">
                  <div className="flex items-center justify-between gap-3 mb-1.5 flex-wrap">
                    <span className="text-sm font-medium text-[#0B1E3F] mono truncate">{t.name}</span>
                    <span className="text-xs mono text-[#0B1E3F]/65">
                      {fmtBytes(t.total_bytes)}
                      <span className="text-[#0B1E3F]/40"> · {tablePct}% of DB</span>
                    </span>
                  </div>
                  <div className="h-1.5 bg-[#0B1E3F]/8 rounded-full overflow-hidden">
                    <div className="h-full bg-[#0B1E3F]/35" style={{ width: `${tablePct}%` }} />
                  </div>
                  <div className="flex items-center justify-between text-[10px] mono text-[#0B1E3F]/50 mt-1">
                    <span>{t.row_estimate.toLocaleString()} rows</span>
                    <span>data {fmtBytes(t.data_bytes)} · idx {fmtBytes(t.index_bytes)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

function NewsletterAdminPanel() {
  type NlContact = {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    unsubscribed: boolean;
    createdAt: string | null;
    inResend: boolean;
    emailsSent: number;
    sentByKind: Record<string, number>;
    lastSentAt: string | null;
  };
  type NlData = {
    configured: boolean;
    contacts: NlContact[];
    totalSent: number;
    sentByKind: Record<string, number>;
    message?: string;
  };
  const [data, setData] = useState<NlData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const load = async () => {
    setError(null);
    try {
      const r = await fetch('/api/admin/newsletter');
      const j = await r.json();
      if (!r.ok) { setError(j?.error || `Failed (${r.status})`); return; }
      setData(j);
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
    }
  };
  useEffect(() => { load(); }, []);

  if (!data && !error) return <div className="py-12 text-center text-sm text-[#0B1E3F]/50">Loading…</div>;
  if (error) return <div className="bg-white rounded-2xl border border-[#DC2626]/20 p-6 text-sm text-[#DC2626]">{error}</div>;
  if (!data!.configured) {
    return (
      <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-8 card-shadow text-center text-[#0B1E3F]">
        <Mail className="w-10 h-10 mx-auto mb-3 text-[#0B1E3F]/30" />
        <div className="text-lg font-medium mb-2">Newsletter is not configured</div>
        <div className="text-sm text-[#0B1E3F]/60 mb-2">{data!.message || 'Set RESEND_API_KEY in .env to start tracking newsletter contacts.'}</div>
      </div>
    );
  }

  const f = filter.trim().toLowerCase();
  const shown = (data!.contacts || []).filter((c) => !f
    || c.email.toLowerCase().includes(f)
    || (c.firstName || '').toLowerCase().includes(f)
    || (c.lastName || '').toLowerCase().includes(f));

  const subscribers = data!.contacts.filter((c) => c.inResend && !c.unsubscribed).length;
  const unsubscribed = data!.contacts.filter((c) => c.inResend && c.unsubscribed).length;
  const transactionalOnly = data!.contacts.filter((c) => !c.inResend).length;

  const kindLabel = (k: string) => k === 'high_risk_alert' ? 'High-risk alert'
    : k === 'welcome' ? 'Welcome'
    : k === 'report_share' ? 'Report share'
    : k === 'newsletter' ? 'Newsletter'
    : k === 'team_invite' ? 'Team invite'
    : k;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-4 bg-white border border-[#0B1E3F]/10 rounded-xl">
          <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">Subscribers</div>
          <div className="text-2xl font-semibold mt-1 text-[#16A34A]">{subscribers}</div>
        </div>
        <div className="p-4 bg-white border border-[#0B1E3F]/10 rounded-xl">
          <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">Unsubscribed</div>
          <div className="text-2xl font-semibold mt-1 text-[#0B1E3F]/55">{unsubscribed}</div>
        </div>
        <div className="p-4 bg-white border border-[#0B1E3F]/10 rounded-xl">
          <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">Transactional only</div>
          <div className="text-2xl font-semibold mt-1 text-[#0B1E3F]">{transactionalOnly}</div>
          <div className="text-[10px] text-[#0B1E3F]/45 mt-0.5">Got an email but not on the list</div>
        </div>
        <div className="p-4 bg-white border border-[#0B1E3F]/10 rounded-xl">
          <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">Emails sent (12 mo)</div>
          <div className="text-2xl font-semibold mt-1 text-[#0B1E3F]">{data!.totalSent}</div>
        </div>
      </div>

      {Object.keys(data!.sentByKind).length > 0 && (
        <div className="p-4 bg-white border border-[#0B1E3F]/10 rounded-xl">
          <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55 mb-3">Sends by type</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(data!.sentByKind).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <span key={k} className="px-3 py-1.5 bg-[#0B1E3F]/5 rounded-full text-xs text-[#0B1E3F]">
                {kindLabel(k)} <span className="mono font-semibold ml-1">{v}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-3 card-shadow">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by email or name…"
          className="w-full px-4 py-2.5 bg-transparent rounded-lg text-sm focus:outline-none text-[#0B1E3F] placeholder:text-[#0B1E3F]/40"
        />
      </div>

      {shown.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-12 text-center text-[#0B1E3F]/55 card-shadow">
          <Mail className="w-10 h-10 mx-auto mb-3 text-[#0B1E3F]/25" />
          <div className="text-base text-[#0B1E3F] mb-1">{data!.contacts.length === 0 ? 'No contacts yet' : 'No matches'}</div>
          <div className="text-sm">{data!.contacts.length === 0 ? 'New signups will appear here automatically.' : 'Try a different search.'}</div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 overflow-hidden card-shadow">
          <div className="grid grid-cols-12 gap-3 px-5 py-3 text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55 bg-[#0B1E3F]/[0.03] border-b border-[#0B1E3F]/5">
            <div className="col-span-5">Contact</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-2">Emails sent</div>
            <div className="col-span-3">Last activity</div>
          </div>
          <div className="divide-y divide-[#0B1E3F]/5">
            {shown.map((c) => {
              const fullName = [c.firstName, c.lastName].filter(Boolean).join(' ');
              const breakdown = Object.entries(c.sentByKind).sort((a, b) => b[1] - a[1]);
              return (
                <div key={c.email} className="grid grid-cols-12 gap-3 px-5 py-4 items-center text-[#0B1E3F]">
                  <div className="col-span-5 min-w-0">
                    <div className="font-semibold truncate">{c.email}</div>
                    {fullName && <div className="text-xs text-[#0B1E3F]/55 truncate">{fullName}</div>}
                  </div>
                  <div className="col-span-2">
                    {!c.inResend ? (
                      <span className="text-[10px] mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#0B1E3F]/5 text-[#0B1E3F]/55">Transactional</span>
                    ) : c.unsubscribed ? (
                      <span className="text-[10px] mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#0B1E3F]/5 text-[#0B1E3F]/55">Unsubscribed</span>
                    ) : (
                      <span className="text-[10px] mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#16A34A]/10 text-[#16A34A] font-bold">Subscribed</span>
                    )}
                  </div>
                  <div className="col-span-2">
                    <div className="font-semibold mono">{c.emailsSent}</div>
                    {breakdown.length > 0 && (
                      <div className="text-[10px] text-[#0B1E3F]/55 mt-0.5 truncate" title={breakdown.map(([k, v]) => `${kindLabel(k)}: ${v}`).join(' · ')}>
                        {breakdown.slice(0, 2).map(([k, v]) => `${kindLabel(k)} ${v}`).join(' · ')}
                        {breakdown.length > 2 && ` · +${breakdown.length - 2}`}
                      </div>
                    )}
                  </div>
                  <div className="col-span-3 text-xs">
                    {c.lastSentAt ? <>Last email <span className="mono text-[#0B1E3F]/70">{timeAgo(c.lastSentAt)}</span></>
                      : c.createdAt ? <>Joined <span className="mono text-[#0B1E3F]/70">{timeAgo(c.createdAt)}</span></>
                      : <span className="text-[#0B1E3F]/45">—</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Support — admin side
// ---------------------------------------------------------------------------

type AdminTicket = {
  id: string;
  user_id: string;
  subject: string;
  status: 'open' | 'working' | 'solved';
  created_at: string;
  updated_at: string;
  user: { email: string; name: string | null };
  messageCount: number;
  lastMessageAt: string | null;
  lastUserMessage: string | null;
};

function SupportAdminPanel() {
  const [data, setData] = useState<{ tickets: AdminTicket[]; counts: { open: number; working: number; solved: number } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'open' | 'working' | 'solved'>('open');
  const [openId, setOpenId] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const r = await fetch('/api/admin/support');
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `Failed (${r.status})`);
      setData({ tickets: j.tickets || [], counts: j.counts || { open: 0, working: 0, solved: 0 } });
      // Sidebar badge listens on this cache key — invalidate so the next
      // render picks up the new open-ticket count without waiting for a
      // page navigation.
      invalidateCache('admin-support-counts');
    } catch (e: any) {
      setError(e?.message || 'Failed to load tickets');
    }
  };
  useEffect(() => { load(); }, []);

  if (!data && !error) return <div className="py-12 text-center text-sm text-[#0B1E3F]/50">Loading…</div>;
  if (error) return <div className="bg-white rounded-2xl border border-[#DC2626]/20 p-6 text-sm text-[#DC2626]">{error}</div>;

  const all = data!.tickets;
  const shown = filter === 'all' ? all : all.filter((t) => t.status === filter);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
        <div className="p-4 bg-white border border-[#0B1E3F]/10 rounded-xl">
          <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">Open</div>
          <div className="text-2xl font-semibold mt-1 text-[#F59E0B]">{data!.counts.open}</div>
        </div>
        <div className="p-4 bg-white border border-[#0B1E3F]/10 rounded-xl">
          <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">Working</div>
          <div className="text-2xl font-semibold mt-1 text-[#0B1E3F]">{data!.counts.working}</div>
        </div>
        <div className="p-4 bg-white border border-[#0B1E3F]/10 rounded-xl">
          <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">Solved</div>
          <div className="text-2xl font-semibold mt-1 text-[#16A34A]">{data!.counts.solved}</div>
        </div>
        <div className="p-4 bg-white border border-[#0B1E3F]/10 rounded-xl">
          <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">Total</div>
          <div className="text-2xl font-semibold mt-1">{all.length}</div>
        </div>
      </div>

      <div className="flex gap-1 p-1 bg-[#0B1E3F]/5 rounded-full w-fit flex-wrap">
        {(['open', 'working', 'solved', 'all'] as const).map((f) => {
          const active = filter === f;
          const count = f === 'all' ? all.length : data!.counts[f];
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition flex items-center gap-2 ${active ? 'bg-[#0B1E3F] text-white' : 'text-[#0B1E3F]/60 hover:text-[#0B1E3F]'}`}
            >
              <span className="capitalize">{f === 'all' ? 'All' : f}</span>
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] mono ${active ? 'bg-white/15 text-white' : 'bg-[#0B1E3F]/10 text-[#0B1E3F]/65'}`}>{count}</span>
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-12 text-center text-[#0B1E3F]/55 card-shadow">
          <LifeBuoy className="w-10 h-10 mx-auto mb-3 text-[#0B1E3F]/25" />
          <div className="text-base text-[#0B1E3F] mb-1">No {filter === 'all' ? '' : filter} tickets</div>
          <div className="text-sm">{filter === 'open' ? 'You are caught up.' : 'Nothing to show in this filter.'}</div>
        </div>
      ) : (
        <div className="space-y-3">
          {shown.map((t) => (
            <SupportAdminTicket
              key={t.id}
              ticket={t}
              expanded={openId === t.id}
              onToggle={() => setOpenId(openId === t.id ? null : t.id)}
              onChanged={load}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SupportAdminTicket({ ticket, expanded, onToggle, onChanged }: { ticket: AdminTicket; expanded: boolean; onToggle: () => void; onChanged: () => void }) {
  const meta = SUPPORT_STATUS_META[ticket.status] || SUPPORT_STATUS_META.open;
  const [thread, setThread] = useState<{ messages: SupportMessage[]; loaded: boolean }>({ messages: [], loaded: false });
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded || thread.loaded) return;
    (async () => {
      try {
        const r = await fetch(`/api/admin/support/${ticket.id}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || 'Load failed');
        setThread({ messages: j.messages || [], loaded: true });
      } catch (e: any) {
        setError(e?.message || 'Could not load thread');
      }
    })();
  }, [expanded, ticket.id, thread.loaded]);

  const sendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = reply.trim();
    if (!body || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/admin/support/${ticket.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'Send failed');
      setThread((s) => ({ messages: [...s.messages, j.message], loaded: true }));
      setReply('');
      onChanged();
    } catch (e: any) {
      setError(e?.message || 'Could not send reply');
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (status: 'open' | 'working' | 'solved') => {
    if (busy || ticket.status === status) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/admin/support/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'Update failed');
      onChanged();
    } catch (e: any) {
      setError(e?.message || 'Could not update status');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 card-shadow text-[#0B1E3F] overflow-hidden">
      <button onClick={onToggle} className="w-full text-left px-5 py-4 hover:bg-[#0B1E3F]/[0.02] transition flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`px-2 py-0.5 rounded-full text-[10px] mono uppercase tracking-wider font-bold ${meta.bg} ${meta.fg}`}>{meta.label}</span>
            <span className="text-xs mono text-[#0B1E3F]/50">{timeAgo(ticket.updated_at)}</span>
            {ticket.messageCount > 0 && (
              <span className="text-[10px] mono uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[#0B1E3F]/5 text-[#0B1E3F]/60">{ticket.messageCount} msgs</span>
            )}
          </div>
          <div className="font-semibold text-[#0B1E3F] truncate">{ticket.subject}</div>
          <div className="text-xs text-[#0B1E3F]/55 mono truncate mt-0.5">
            {ticket.user.email}{ticket.user.name ? ` · ${ticket.user.name}` : ''}
          </div>
          {ticket.lastUserMessage && (
            <div className="text-xs text-[#0B1E3F]/65 mt-1.5 line-clamp-2">{ticket.lastUserMessage}</div>
          )}
        </div>
        <ChevronRight className={`w-4 h-4 text-[#0B1E3F]/40 transition flex-shrink-0 mt-1 ${expanded ? 'rotate-90' : ''}`} />
      </button>
      {expanded && (
        <div className="border-t border-[#0B1E3F]/10 p-5 space-y-4 bg-[#F5F3EE]/40">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] mono uppercase tracking-[0.18em] text-[#0B1E3F]/55">Mark as</span>
            {(['open', 'working', 'solved'] as const).map((s) => {
              const sm = SUPPORT_STATUS_META[s];
              const active = ticket.status === s;
              return (
                <button
                  key={s}
                  onClick={() => setStatus(s)}
                  disabled={busy || active}
                  className={`px-3 py-1 rounded-full text-[10px] mono uppercase tracking-wider font-bold transition disabled:cursor-not-allowed ${active ? `${sm.bg} ${sm.fg} ring-1 ring-current` : 'bg-[#0B1E3F]/5 text-[#0B1E3F]/60 hover:bg-[#0B1E3F]/10'}`}
                >
                  {sm.label}
                </button>
              );
            })}
          </div>
          {!thread.loaded ? (
            <div className="text-sm text-[#0B1E3F]/55">Loading thread…</div>
          ) : thread.messages.length === 0 ? (
            <div className="text-sm text-[#0B1E3F]/55">No messages.</div>
          ) : (
            <div className="space-y-3">
              {thread.messages.map((m) => (
                <SupportMessageBubble key={m.id} message={m} authorLabel={m.is_admin ? 'You (admin)' : (ticket.user.name || ticket.user.email || 'User')} />
              ))}
            </div>
          )}
          <form onSubmit={sendReply} className="space-y-2">
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Reply to the user. Marking the ticket Solved closes it. They can still reply, which will reopen."
              className="w-full px-4 py-2.5 bg-white border border-[#0B1E3F]/15 rounded-lg text-sm focus:outline-none focus:border-[#0B1E3F] min-h-[100px]"
              maxLength={5000}
            />
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <button type="submit" disabled={busy || !reply.trim()} className="px-4 py-2 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90 disabled:opacity-60 inline-flex items-center gap-2">
                {busy && <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                {busy ? 'Sending…' : 'Send admin reply'}
              </button>
              {error && <span className="text-xs text-[#DC2626]">{error}</span>}
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function FmcsaPrewarmCard() {
  const [stats, setStats] = useState<{ total: number; staleOver30Days: number; oldest: string | null; newest: string | null } | null>(null);
  const [input, setInput] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStats = async () => {
    try {
      const r = await fetch('/api/admin/fmcsa-prewarm');
      if (!r.ok) return;
      setStats(await r.json());
    } catch { /* ignore */ }
  };
  useEffect(() => { loadStats(); }, []);

  const run = async () => {
    setError(null); setResult(null);
    const identifiers = input.split(/[\s,;\n]+/).map((s) => s.trim()).filter(Boolean);
    if (!identifiers.length) { setError('Paste at least one MC or DOT number.'); return; }
    if (identifiers.length > 200) { setError(`Up to 200 at a time. You pasted ${identifiers.length}.`); return; }
    setLoading(true);
    try {
      const r = await fetch('/api/admin/fmcsa-prewarm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiers }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `Failed (${r.status})`);
      setResult(j);
      loadStats();
    } catch (err: any) {
      setError(err?.message || 'Prewarm failed');
    } finally {
      setLoading(false);
    }
  };

  const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString() : '—';

  return (
    <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-5 card-shadow text-[#0B1E3F]">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/55">FMCSA cache · permanent storage</div>
          <div className="text-sm text-[#0B1E3F]/70 mt-1">Carriers in your cache are served instantly even when FMCSA&apos;s API is down.</div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Stat label="Carriers cached" value={stats?.total ?? '—'} />
        <Stat label="Needs refresh (30d+)" value={stats?.staleOver30Days ?? '—'} sub="Auto-refreshed in background" />
        <Stat label="Oldest record" value={stats ? fmtDate(stats.oldest) : '—'} />
        <Stat label="Newest record" value={stats ? fmtDate(stats.newest) : '—'} />
      </div>

      <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/55 mb-2">Pre-warm by MC or DOT</div>
      <div className="text-sm text-[#0B1E3F]/65 mb-2">Paste up to 200 MC or DOT numbers (space, comma, semicolon, or newline separated). We&apos;ll fetch each from FMCSA and cache permanently.</div>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={'MC-226104\nDOT-1827493\nMC-612443\nMC-921870'}
        rows={5}
        className="w-full px-4 py-2.5 mb-3 bg-white border border-[#0B1E3F]/15 rounded-lg font-mono text-sm focus:outline-none focus:border-[#0B1E3F] text-[#0B1E3F] placeholder:text-[#0B1E3F]/30"
      />

      <div className="flex items-center gap-3">
        <button onClick={run} disabled={loading} className="px-5 py-2.5 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90 transition disabled:opacity-60 flex items-center gap-2">
          {loading && <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
          {loading ? 'Warming cache…' : 'Warm cache'}
        </button>
        <div className="text-xs text-[#0B1E3F]/55">Takes ~1-2 seconds per carrier. Safe to run repeatedly.</div>
      </div>

      {error && <div className="mt-3 text-sm text-[#DC2626]">{error}</div>}
      {result && (
        <div className="mt-4 p-4 bg-[#16A34A]/5 border border-[#16A34A]/25 rounded-xl">
          <div className="text-sm font-medium text-[#0B1E3F]">
            {result.succeeded} succeeded · {result.failed} failed{result.alreadyCached ? ` · ${result.alreadyCached} already cached` : ''}
          </div>
          {result.errors?.length > 0 && (
            <details className="mt-2 text-xs text-[#0B1E3F]/70">
              <summary className="cursor-pointer">Show failures ({result.errors.length})</summary>
              <div className="mt-2 space-y-1 mono">
                {result.errors.slice(0, 20).map((e: any, i: number) => (
                  <div key={i}>{e.identifier} → {e.error}</div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: any; sub?: string | null }) {
  return (
    <div className="p-3 bg-[#0B1E3F]/5 rounded-lg">
      <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">{label}</div>
      <div className="text-xl font-semibold text-[#0B1E3F] mt-0.5">{value}</div>
      {sub && <div className="text-[10px] mono text-[#0B1E3F]/50 mt-0.5">{sub}</div>}
    </div>
  );
}

type AdminTab = 'overview' | 'users' | 'fmcsa' | 'data' | 'newsletter' | 'support';

function AdminPage({ navigate }: any) {
  const [users, setUsers] = useState<any[] | null>(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [tab, setTab] = useState<AdminTab>('overview');

  const load = async () => {
    setError(null);
    const res = await fetch('/api/admin/users');
    const data = await res.json();
    if (!res.ok) { setError(data?.error || `Failed (${res.status})`); setUsers([]); return; }
    setUsers(data.users || []);
  };
  useEffect(() => { load(); }, []);

  const patchUser = async (id: string, body: any) => {
    setPendingId(id); setError(null);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Failed (${res.status})`);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Action failed');
    } finally {
      setPendingId(null);
    }
  };

  const deleteUser = async (u: any) => {
    const label = u.email || u.name || u.id;
    setPendingId(u.id); setError(null);

    // Look up their Stripe subscription state first so we can warn if they have one.
    let subInfo: any = null;
    try {
      const r = await fetch(`/api/admin/users/${u.id}/subscription`);
      if (r.ok) subInfo = await r.json();
    } catch { /* non-fatal */ }

    const fmtMoney = (cents: number, currency = 'USD') =>
      new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);

    let confirmMsg = `Permanently delete ${label}?\n\nThis removes their login, lookups, watchlist, reports, and team membership. Cannot be undone.`;
    if (subInfo?.hasActiveSub) {
      const price = subInfo.amount != null ? fmtMoney(subInfo.amount, subInfo.currency) : '?';
      const period = subInfo.billing === 'annual' ? '/yr' : '/mo';
      confirmMsg =
        `⚠️ ${label} has an ACTIVE Stripe subscription.\n\n` +
        `  Plan: ${subInfo.plan || '—'} · ${subInfo.billing || '—'} · ${price}${period}\n` +
        `  Status: ${subInfo.status}\n\n` +
        `Deleting will IMMEDIATELY cancel their subscription in Stripe (they won't be charged again), wipe all their data, and remove their login.\n\n` +
        `This cannot be undone. Continue?`;
    }

    if (!window.confirm(confirmMsg)) {
      setPendingId(null);
      return;
    }

    try {
      const res = await fetch(`/api/admin/users/${u.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Failed (${res.status})`);
      await load();
      if (data?.cancelledSubscriptions?.length) {
        alert(`Deleted ${label} and canceled ${data.cancelledSubscriptions.length} Stripe subscription${data.cancelledSubscriptions.length === 1 ? '' : 's'}.`);
      }
    } catch (e: any) {
      setError(e?.message || 'Delete failed');
    } finally {
      setPendingId(null);
    }
  };

  const f = filter.trim().toLowerCase();
  const shown = (users || []).filter((u) => !f || (u.email || '').toLowerCase().includes(f) || (u.name || '').toLowerCase().includes(f) || (u.company || '').toLowerCase().includes(f) || (u.mc || '').includes(f));

  const totals = (users || []).reduce((acc, u) => ({
    users: acc.users + 1,
    admins: acc.admins + (u.isAdmin ? 1 : 0),
    lookupsThisMonth: acc.lookupsThisMonth + (u.usage?.lookupsThisMonth || 0),
    scansThisMonth: acc.scansThisMonth + (u.usage?.scansThisMonth || 0),
    watchlist: acc.watchlist + (u.usage?.watchlist || 0),
  }), { users: 0, admins: 0, lookupsThisMonth: 0, scansThisMonth: 0, watchlist: 0 });

  // Tab definitions. `id` is the state value, `label` shows in the bar,
  // `count` (optional) renders a small badge — handy for the user count.
  const TABS: { id: AdminTab; label: string; count?: number }[] = [
    { id: 'overview',   label: 'Overview' },
    { id: 'users',      label: 'Users',         count: users?.length ?? undefined },
    { id: 'fmcsa',      label: 'FMCSA' },
    { id: 'data',       label: 'Data & storage' },
    { id: 'newsletter', label: 'Newsletter' },
    { id: 'support',    label: 'Support tickets' },
  ];

  return (
    <div className="space-y-8 text-[#0B1E3F]">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-2">Admin</div>
          <h1 className="text-4xl serif italic text-[#0B1E3F]">Operator console.</h1>
          <p className="text-[#0B1E3F]/60 mt-2 text-sm">Users, billing, FMCSA observability, data growth, and storage — one place.</p>
        </div>
        <button onClick={load} className="px-4 py-2 border border-[#0B1E3F]/15 bg-white rounded-full text-sm font-medium text-[#0B1E3F] hover:bg-[#0B1E3F]/5 w-fit">Refresh users</button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 p-1 bg-[#0B1E3F]/5 rounded-full w-fit flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition flex items-center gap-2 ${tab === t.id ? 'bg-[#0B1E3F] text-white' : 'text-[#0B1E3F]/60 hover:text-[#0B1E3F]'}`}
          >
            {t.label}
            {t.count != null && (
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] mono ${tab === t.id ? 'bg-white/15 text-white' : 'bg-[#0B1E3F]/10 text-[#0B1E3F]/65'}`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {error && <div className="text-sm text-[#DC2626]">{error}</div>}

      {/* OVERVIEW: top-of-funnel summary tiles + Stripe billing health */}
      {tab === 'overview' && (
        <div className="space-y-8">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="p-4 bg-white border border-[#0B1E3F]/10 rounded-xl"><div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">Users</div><div className="text-2xl font-semibold mt-1">{users == null ? '—' : totals.users}</div></div>
            <div className="p-4 bg-white border border-[#0B1E3F]/10 rounded-xl"><div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">Admins</div><div className="text-2xl font-semibold mt-1">{users == null ? '—' : totals.admins}</div></div>
            <div className="p-4 bg-white border border-[#0B1E3F]/10 rounded-xl"><div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">Lookups this mo.</div><div className="text-2xl font-semibold mt-1">{users == null ? '—' : totals.lookupsThisMonth}</div></div>
            <div className="p-4 bg-white border border-[#0B1E3F]/10 rounded-xl"><div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">Scans this mo.</div><div className="text-2xl font-semibold mt-1">{users == null ? '—' : totals.scansThisMonth}</div></div>
            <div className="p-4 bg-white border border-[#0B1E3F]/10 rounded-xl"><div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">Watchlist rows</div><div className="text-2xl font-semibold mt-1">{users == null ? '—' : totals.watchlist}</div></div>
          </div>
          <StripeOverviewCard />
        </div>
      )}

      {/* FMCSA: API observability + cache prewarm */}
      {tab === 'fmcsa' && (
        <div className="space-y-8">
          <FmcsaStatsCard />
          <FmcsaPrewarmCard />
        </div>
      )}

      {/* DATA & STORAGE: snapshot growth chart + Supabase disk usage */}
      {tab === 'data' && (
        <div className="space-y-8">
          <SnapshotsStatsCard />
          <SupabaseStorageCard />
        </div>
      )}

      {/* NEWSLETTER: Resend contacts + email_log per-contact send count */}
      {tab === 'newsletter' && <NewsletterAdminPanel />}

      {/* SUPPORT: every user's support tickets, replies, status changes */}
      {tab === 'support' && <SupportAdminPanel />}

      {/* USERS: filter + user list */}
      {tab === 'users' && (<>
      <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-3 card-shadow">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by email, name, company, or MC…" className="w-full px-4 py-2.5 bg-transparent rounded-lg text-sm focus:outline-none text-[#0B1E3F] placeholder:text-[#0B1E3F]/40" />
      </div>

      {users == null ? (
        <div className="py-12 text-center text-sm text-[#0B1E3F]/50">Loading…</div>
      ) : shown.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-16 text-center text-[#0B1E3F]/60 card-shadow">
          <Users className="w-12 h-12 mx-auto mb-4 text-[#0B1E3F]/30" />
          <div className="text-lg font-medium text-[#0B1E3F] mb-2">No users match</div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 overflow-hidden card-shadow">
          <div className="divide-y divide-[#0B1E3F]/5">
            {shown.map((u: any) => {
              const initials = (u.name || u.email || '?').split(/[\s@]/).map((p: string) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
              return (
                <div key={u.id} className="p-5 text-[#0B1E3F]">
                  <div className="flex items-start gap-4 flex-wrap">
                    <div className="w-10 h-10 rounded-full bg-[#0B1E3F] flex items-center justify-center text-white text-sm font-semibold flex-shrink-0">{initials}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <div className="font-semibold text-[#0B1E3F] truncate">{u.name || u.email}</div>
                        {u.isAdmin && <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#0B1E3F] text-white text-[10px] mono uppercase tracking-wider rounded-full"><ShieldCheck className="w-2.5 h-2.5" /> admin</span>}
                        <span className="px-2 py-0.5 bg-[#FF6B35]/10 text-[#FF6B35] text-[10px] mono uppercase tracking-wider rounded-full">{u.planLabel}</span>
                        {!u.confirmedAt && <span className="px-2 py-0.5 bg-[#F59E0B]/10 text-[#F59E0B] text-[10px] mono uppercase tracking-wider rounded-full">unconfirmed</span>}
                      </div>
                      <div className="text-xs mono text-[#0B1E3F]/60 truncate">{u.email}{u.company ? ` · ${u.company}` : ''}{u.mc ? ` · MC-${u.mc}` : ''}</div>
                      <div className="text-xs text-[#0B1E3F]/55 mt-1">
                        Joined {u.createdAt ? timeAgo(u.createdAt) : '—'}
                        {u.lastSignInAt ? ` · last seen ${timeAgo(u.lastSignInAt)}` : ' · never signed in'}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
                    <UsageMiniCard label="Lookups / mo" value={u.usage.lookupsThisMonth} limit={u.isAdmin ? null : u.limits.fmcsaLookups} />
                    <UsageMiniCard label="Scans / mo" value={u.usage.scansThisMonth} limit={u.isAdmin ? null : u.limits.rateConScans} />
                    <UsageMiniCard label="Watchlist" value={u.usage.watchlist} limit={u.isAdmin ? null : u.limits.watchlist} />
                    <UsageMiniCard label="Lookups all-time" value={u.usage.lookupsTotal} />
                    <UsageMiniCard label="Fraud reports" value={u.usage.fraudReports} />
                  </div>
                  <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-[#0B1E3F]/5">
                    <label className="text-xs text-[#0B1E3F]/60 flex items-center gap-2">
                      Plan:
                      <select
                        value={u.plan}
                        onChange={(e) => patchUser(u.id, { plan: e.target.value })}
                        disabled={pendingId === u.id}
                        className="px-3 py-1.5 bg-white border border-[#0B1E3F]/15 rounded-lg text-xs text-[#0B1E3F] focus:outline-none"
                      >
                        {Object.values(PLANS).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                      </select>
                    </label>
                    <button
                      onClick={() => patchUser(u.id, { isAdmin: !u.isAdmin })}
                      disabled={pendingId === u.id}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition disabled:opacity-50 ${u.isAdmin ? 'border border-[#DC2626]/30 text-[#DC2626] hover:bg-[#DC2626]/5' : 'bg-[#0B1E3F] text-white hover:bg-[#0B1E3F]/90'}`}
                    >
                      {pendingId === u.id ? 'Saving…' : u.isAdmin ? 'Revoke admin' : 'Make admin'}
                    </button>
                    <button
                      onClick={() => deleteUser(u)}
                      disabled={pendingId === u.id}
                      className="w-7 h-7 flex items-center justify-center rounded-full text-[#0B1E3F]/40 hover:bg-[#DC2626]/10 hover:text-[#DC2626] transition disabled:opacity-50"
                      title="Permanently delete user"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      </>)}
    </div>
  );
}

function UsageMiniCard({ label, value, limit }: any) {
  const cap = limit;
  const pct = cap == null || cap === 0 ? 0 : Math.min(100, (value / cap) * 100);
  const near = cap != null && pct >= 80;
  const over = cap != null && value >= cap;
  return (
    <div className="p-2.5 bg-[#0B1E3F]/5 rounded-lg">
      <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55 mb-1">{label}</div>
      <div className={`text-sm font-semibold ${over ? 'text-[#DC2626]' : near ? 'text-[#F59E0B]' : 'text-[#0B1E3F]'}`}>
        {value}{cap != null ? <span className="text-[#0B1E3F]/50 font-normal text-xs"> / {cap}</span> : <span className="text-[#0B1E3F]/50 font-normal text-xs"> / ∞</span>}
      </div>
    </div>
  );
}

function HeaderSearch({ navigate }: { navigate: any }) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = input.trim();
    if (!q) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/verify?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 402) throw new Error(data?.error || 'Monthly lookup limit reached.');
        throw new Error(data?.error || `Lookup failed (${res.status})`);
      }
      if (!data?.cached) {
        fetch('/api/lookups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
          .then(() => invalidateCache('lookups:200', 'usage', 'alerts')).catch(() => {});
        if (data?.verdict === 'high') {
          fetch('/api/email/high-risk-alert', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ report: data }) }).catch(() => {});
        }
      }
      setInput('');
      navigate('report', data);
    } catch (e: any) {
      setError(e?.message || 'Lookup failed');
      setTimeout(() => setError(null), 4000);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex-1 max-w-md relative">
      <div className="flex items-center gap-2 px-4 py-2 bg-[#0B1E3F]/5 rounded-lg text-sm text-[#0B1E3F] focus-within:bg-[#0B1E3F]/10 transition">
        {loading ? (
          <div className="w-4 h-4 border-2 border-[#0B1E3F]/20 border-t-[#0B1E3F] rounded-full animate-spin" />
        ) : (
          <Search className="w-4 h-4 text-[#0B1E3F]/40" />
        )}
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Quick lookup — MC, DOT, or name…"
          disabled={loading}
          className="flex-1 bg-transparent outline-none placeholder:text-[#0B1E3F]/40 text-[#0B1E3F]"
        />
        {!input && (
          <span className="hidden md:flex items-center gap-1 text-xs mono text-[#0B1E3F]/40">
            <Command className="w-3 h-3" />K
          </span>
        )}
      </div>
      {error && (
        <div className="absolute left-0 right-0 top-full mt-1 px-3 py-2 bg-white border border-[#DC2626]/30 rounded-lg text-xs text-[#DC2626] shadow-md z-30">
          {error}
        </div>
      )}
    </form>
  );
}

const SOCIAL_META: Record<string, { label: string; color: string; Icon: any }> = {
  facebook:  { label: 'Facebook',  color: '#1877F2', Icon: Facebook },
  linkedin:  { label: 'LinkedIn',  color: '#0A66C2', Icon: Linkedin },
  twitter:   { label: 'Twitter / X', color: '#0F1419', Icon: Twitter },
  instagram: { label: 'Instagram', color: '#E4405F', Icon: Instagram },
  youtube:   { label: 'YouTube',   color: '#FF0000', Icon: Youtube },
  tiktok:    { label: 'TikTok',    color: '#0F1419', Icon: Globe },
};

function SocialPill({ platform, url }: { platform: string; url: string }) {
  const meta = SOCIAL_META[platform] || { label: platform, color: '#0B1E3F', Icon: Globe };
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0B1E3F]/5 hover:bg-[#0B1E3F]/10 rounded-full text-xs font-medium text-[#0B1E3F] transition"
      title={url}
    >
      <meta.Icon className="w-3.5 h-3.5" style={{ color: meta.color }} />
      {meta.label}
    </a>
  );
}

function MiniRing({ score, color }: { score: number; color: string }) {
  const c = Math.max(0, Math.min(100, score));
  const r = 14;
  const circumference = 2 * Math.PI * r;
  const dash = (c / 100) * circumference;
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" className="flex-shrink-0">
      <circle cx="18" cy="18" r={r} fill="none" stroke="rgba(11,30,63,0.12)" strokeWidth="3" />
      <circle
        cx="18" cy="18" r={r}
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circumference}`}
        transform="rotate(-90 18 18)"
      />
      <text x="18" y="22" textAnchor="middle" fontSize="11" fontWeight="700" fill={color}>{c}</text>
    </svg>
  );
}

// localStorage key per (mc|dot) — different IDs ack independently, and
// switching your MC in Settings shouldn't carry an ack from the old one.
const ownScoreAckKey = (mc: string | null | undefined, dot: string | null | undefined) =>
  `haulock:ownScoreAck:${mc || ''}|${dot || ''}`;

function OwnScoreChip({ navigate }: { navigate: any }) {
  const res = useCachedFetch<any>('own-score', '/api/profile/own-score');
  const [open, setOpen] = useState(false);
  // Re-read ack timestamp when the modal opens/closes so the pulse turns off
  // immediately on close without needing a full re-fetch.
  const [ackBump, setAckBump] = useState(0);
  const data = res.data;

  if (!data || (!data.ownMc && !data.ownDot)) {
    return (
      <button onClick={() => navigate('settings', { tab: 'profile' })} className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-[#0B1E3F]/5 hover:bg-[#0B1E3F]/10 rounded-full text-xs text-[#0B1E3F]/60 transition" title="Set your MC or DOT in Settings → Profile to see your own broker score here">
        <Shield className="w-3.5 h-3.5" /> Set your MC/DOT
      </button>
    );
  }
  const r = data.report;
  if (!r) return null;
  const verdict = r.verdict || (r.score >= 61 ? 'high' : r.score >= 31 ? 'medium' : 'low');
  const colorHex = verdict === 'high' ? '#DC2626' : verdict === 'medium' ? '#F59E0B' : '#16A34A';
  const bgClass = verdict === 'high' ? 'bg-[#DC2626]/10 hover:bg-[#DC2626]/15' : verdict === 'medium' ? 'bg-[#F59E0B]/10 hover:bg-[#F59E0B]/15' : 'bg-[#16A34A]/10 hover:bg-[#16A34A]/15';
  const verdictLabel = verdict === 'high' ? 'HIGH RISK' : verdict === 'medium' ? 'CAUTION' : 'LOW RISK';
  const idLabel = data.ownMc ? `MC-${data.ownMc}` : `DOT-${data.ownDot}`;

  // Has the latest auto-refresh produced a change the user hasn't seen yet?
  // The server sets `report.autoChange.at` (ISO timestamp) when the new
  // snapshot differs from the previous one. We compare against the local
  // ack key — once the user opens the modal, we record `at` and the pulse
  // stops without needing a server round-trip.
  const change = r.autoChange as { at: string; direction: 'worse' | 'better' | 'neutral'; summary: string } | undefined;
  const ackedAt = (() => {
    if (typeof window === 'undefined') return null;
    void ackBump;
    try { return localStorage.getItem(ownScoreAckKey(data.ownMc, data.ownDot)); } catch { return null; }
  })();
  const hasUnseenChange = !!(change?.at && (!ackedAt || new Date(change.at).getTime() > new Date(ackedAt).getTime()));
  const pulseColor = change?.direction === 'better' ? '#16A34A' : '#F59E0B'; // amber for "worse" / neutral, green for "better"

  const acknowledge = () => {
    if (!change?.at || typeof window === 'undefined') return;
    try { localStorage.setItem(ownScoreAckKey(data.ownMc, data.ownDot), change.at); } catch {}
    setAckBump((n) => n + 1);
  };

  const onOpen = () => {
    setOpen(true);
    acknowledge();
  };

  return (
    <>
      <div className="relative inline-flex">
        {hasUnseenChange && (
          <>
            {/* Outer ping — radar-style expanding ring, pure CSS via animate-ping. */}
            <span
              className="absolute inset-0 rounded-full animate-ping pointer-events-none"
              style={{ backgroundColor: pulseColor, opacity: 0.35 }}
              aria-hidden="true"
            />
            {/* Always-visible solid ring so the chip stays clearly highlighted
                between ping cycles. */}
            <span
              className="absolute -inset-0.5 rounded-full pointer-events-none"
              style={{ boxShadow: `0 0 0 2px ${pulseColor}` }}
              aria-hidden="true"
            />
          </>
        )}
        <button
          onClick={onOpen}
          className={`relative flex items-center gap-2 pl-1.5 pr-3 py-1 rounded-full transition ${bgClass}`}
          title={hasUnseenChange ? `New change on your ${idLabel}: ${change?.summary}` : `Your ${idLabel} broker score · click for details`}
        >
          <MiniRing score={r.score} color={colorHex} />
          <div className="text-left leading-tight">
            <div className="text-[11px] mono text-[#0B1E3F] font-semibold flex items-center gap-1.5">
              {idLabel}
              {hasUnseenChange && (
                <span className="inline-flex items-center gap-0.5 px-1 py-0 rounded-full text-[9px] font-bold" style={{ backgroundColor: pulseColor, color: '#fff' }}>NEW</span>
              )}
            </div>
            <div className="text-[10px] mono uppercase tracking-wider font-bold" style={{ color: colorHex }}>{verdictLabel}</div>
          </div>
        </button>
      </div>
      {open && <OwnScoreModal report={r} cached={r.cached} cachedAt={r.cachedAt} change={change} onClose={() => setOpen(false)} onOpenFull={() => { setOpen(false); navigate('report', r); }} />}
    </>
  );
}

function OwnScoreModal({ report, cached, cachedAt, change, onClose, onOpenFull }: any) {
  const r = report;
  const verdict = r.verdict || (r.score >= 61 ? 'high' : r.score >= 31 ? 'medium' : 'low');
  const verdictColor = verdict === 'high' ? 'text-[#DC2626]' : verdict === 'medium' ? 'text-[#F59E0B]' : 'text-[#16A34A]';
  const verdictBg = verdict === 'high' ? 'bg-[#DC2626]/10' : verdict === 'medium' ? 'bg-[#F59E0B]/10' : 'bg-[#16A34A]/10';
  const verdictLabel = verdict === 'high' ? 'HIGH RISK' : verdict === 'medium' ? 'CAUTION' : 'LOW RISK';
  const flags = r.flags || [];
  const ch: any = change;
  const changeDirection: 'worse' | 'better' | 'neutral' = ch?.direction || 'neutral';
  const changeAccent = changeDirection === 'better' ? '#16A34A' : changeDirection === 'worse' ? '#F59E0B' : '#0B1E3F';
  const changeBg = changeDirection === 'better' ? 'bg-[#16A34A]/10' : changeDirection === 'worse' ? 'bg-[#F59E0B]/10' : 'bg-[#0B1E3F]/5';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0B1E3F]/50" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-xl w-full p-6 md:p-8 card-shadow-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-1">
          <div>
            <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-1">Your broker score</div>
            <h2 className="text-2xl serif italic text-[#0B1E3F]">{r.name}</h2>
            <div className="text-xs mono text-[#0B1E3F]/50 mt-1">{[r.mc && `MC-${r.mc}`, r.dot && `DOT-${r.dot}`].filter(Boolean).join(' · ')}</div>
          </div>
          <button onClick={onClose} className="text-[#0B1E3F]/40 hover:text-[#0B1E3F]"><XCircle className="w-5 h-5" /></button>
        </div>
        <div className="flex items-center justify-center gap-8 my-6">
          <RiskGauge score={r.score} size="md" />
          <div>
            <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60">Risk level</div>
            <div className={`text-2xl font-semibold mt-1 ${verdictColor}`}>{verdictLabel}</div>
            <div className="text-xs text-[#0B1E3F]/55 mt-1">Score {r.score} / 100</div>
          </div>
        </div>
        {ch && (
          <div className={`mb-4 p-4 rounded-xl ${changeBg} border`} style={{ borderColor: `${changeAccent}33` }}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] mono uppercase tracking-wider font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: changeAccent, color: '#fff' }}>NEW</span>
              <span className="text-xs mono uppercase tracking-wider" style={{ color: changeAccent }}>
                {changeDirection === 'better' ? 'Things improved' : changeDirection === 'worse' ? 'Heads up — something changed' : 'Record updated'}
              </span>
              <span className="text-[11px] text-[#0B1E3F]/50 ml-auto">{ch.at ? timeAgo(ch.at) : ''}</span>
            </div>
            <div className="text-sm text-[#0B1E3F] mb-2">{ch.summary}</div>
            <ul className="space-y-1 text-xs text-[#0B1E3F]/75">
              {ch.scoreDelta !== 0 && (
                <li>
                  Score <span className="mono font-semibold">{ch.scoreFrom}</span> → <span className="mono font-semibold">{ch.scoreTo}</span>
                  <span className={ch.scoreDelta > 0 ? 'text-[#DC2626] ml-1.5' : 'text-[#16A34A] ml-1.5'}>({ch.scoreDelta > 0 ? '+' : ''}{ch.scoreDelta})</span>
                </li>
              )}
              {ch.verdictChanged && (
                <li>Verdict <span className="mono font-semibold uppercase">{ch.verdictFrom || '—'}</span> → <span className="mono font-semibold uppercase">{ch.verdictTo || '—'}</span></li>
              )}
              {Array.isArray(ch.newFlags) && ch.newFlags.length > 0 && (
                <li>
                  <span className="font-semibold">{ch.newFlags.length} new flag{ch.newFlags.length === 1 ? '' : 's'}:</span>{' '}
                  <span className="text-[#0B1E3F]/70">{ch.newFlags.slice(0, 3).join(' · ')}{ch.newFlags.length > 3 ? ` · +${ch.newFlags.length - 3} more` : ''}</span>
                </li>
              )}
              {Array.isArray(ch.removedFlags) && ch.removedFlags.length > 0 && (
                <li>
                  <span className="font-semibold">{ch.removedFlags.length} flag{ch.removedFlags.length === 1 ? '' : 's'} resolved:</span>{' '}
                  <span className="text-[#0B1E3F]/70">{ch.removedFlags.slice(0, 3).join(' · ')}{ch.removedFlags.length > 3 ? ` · +${ch.removedFlags.length - 3} more` : ''}</span>
                </li>
              )}
              {ch.authorityChanged && (
                <li>Authority <span className="mono font-semibold">{ch.authorityFrom || '—'}</span> → <span className="mono font-semibold">{ch.authorityTo || '—'}</span></li>
              )}
              {ch.addressChanged && (
                <li>
                  <span className="font-semibold">Address changed:</span>{' '}
                  <span className="text-[#0B1E3F]/70">{ch.addressFrom || '—'} → {ch.addressTo || '—'}</span>
                </li>
              )}
              {ch.outOfServiceChanged && (
                <li className="font-semibold" style={{ color: changeAccent }}>{r.outOfService ? 'Now flagged out of service' : 'No longer flagged out of service'}</li>
              )}
            </ul>
          </div>
        )}
        {cached && (
          <div className="mb-4 inline-flex items-center gap-2 px-3 py-1.5 bg-[#0B1E3F]/5 rounded-full text-xs text-[#0B1E3F]/60">
            <Clock className="w-3.5 h-3.5" /> Auto-refreshed {cachedAt ? timeAgo(cachedAt) : 'recently'} · refreshes every 24h, free
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <MiniStat label="Authority" value={r.authorityStatus || '—'} good={r.authorityStatus === 'Active'} warn={r.authorityStatus && r.authorityStatus !== 'Active'} />
          <MiniStat label="Insurance" value={r.insuranceSummary || '—'} good={r.bipdOnFile != null && r.bipdOnFile > 0} warn={r.bipdOnFile === 0} />
          <MiniStat label="Out of service" value={r.outOfService ? 'Yes' : 'No'} good={r.outOfService === false} warn={r.outOfService === true} />
          <MiniStat label="Safety rating" value={r.safetyRating || 'Not rated'} />
        </div>
        {flags.length > 0 && (
          <div className={`p-4 rounded-xl ${verdictBg} mb-4`}>
            <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-2">{flags.length} flag{flags.length === 1 ? '' : 's'}</div>
            <ul className="space-y-1.5">
              {flags.slice(0, 5).map((f: any, i: number) => (
                <li key={i} className="text-sm text-[#0B1E3F] flex items-start gap-2">
                  <span className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${f.sev === 'critical' ? 'bg-[#DC2626]' : f.sev === 'warning' ? 'bg-[#F59E0B]' : 'bg-[#0B1E3F]/40'}`} />
                  <span>{f.title}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex gap-2 pt-4 border-t border-[#0B1E3F]/10">
          <button onClick={onClose} className="flex-1 py-2.5 border border-[#0B1E3F]/15 rounded-full text-sm font-medium text-[#0B1E3F] hover:bg-[#0B1E3F]/5">Close</button>
          <button onClick={onOpenFull} className="flex-1 py-2.5 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90">Open full report</button>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, good, warn }: any) {
  return (
    <div className="p-3 bg-[#0B1E3F]/5 rounded-lg">
      <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">{label}</div>
      <div className={`text-sm font-semibold mt-0.5 ${warn ? 'text-[#DC2626]' : good ? 'text-[#16A34A]' : 'text-[#0B1E3F]'}`}>{value}</div>
    </div>
  );
}

function AppShell({ user, route, navigate, logout, children }: any) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const alertsRes = useCachedFetch<{ unseenCount: number }>('alerts', '/api/alerts');
  const alertCount = alertsRes.data?.unseenCount || 0;
  const usageRes = useCachedFetch<{ plan: any; usage: any; isAdmin?: boolean }>('usage', '/api/usage');
  const usagePlan = getPlan(user?.plan || usageRes.data?.plan?.id);
  const usageNums = usageRes.data?.usage || { fmcsaLookups: 0, rateConScans: 0 };
  const isAdmin = Boolean(usageRes.data?.isAdmin);
  // Open-tickets count for the Admin sidebar badge. Lightweight endpoint
  // that returns just `{ open, working, solved }` — no joins, head-only
  // count queries. Non-admins always get zeros so this hook is safe to
  // run unconditionally.
  const supportCountsRes = useCachedFetch<{ open: number; working: number; solved: number }>(
    'admin-support-counts',
    isAdmin ? '/api/admin/support/counts' : null,
  );
  const openTickets = isAdmin ? (supportCountsRes.data?.open || 0) : 0;
  const lookupsLeft = isAdmin || usagePlan.limits.fmcsaLookups == null ? null : Math.max(0, usagePlan.limits.fmcsaLookups - usageNums.fmcsaLookups);
  const scansLeft = isAdmin || usagePlan.limits.rateConScans == null ? null : Math.max(0, usagePlan.limits.rateConScans - usageNums.rateConScans);
  const navItems: any[] = [
    { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
    { id: 'verify', label: 'Verify broker', icon: Search },
    { id: 'history', label: 'History', icon: Clock },
    { id: 'reports', label: 'Fraud reports', icon: Flag },
    { id: 'watchlist', label: 'Watchlist', icon: Eye },
    { id: 'alerts', label: 'Alerts', icon: Bell, badge: alertCount > 0 ? alertCount : null },
    { id: 'plan', label: 'Plan & billing', icon: Zap },
    { id: 'settings', label: 'Settings', icon: Settings },
    // Admins manage tickets from the Admin → Support tickets tab, so the
    // user-facing Support entry is hidden for them.
    ...(isAdmin ? [] : [{ id: 'support', label: 'Support', icon: LifeBuoy }]),
    ...(isAdmin ? [{ id: 'admin', label: 'Admin', icon: ShieldCheck, badge: openTickets > 0 ? openTickets : null }] : []),
  ];

  return (
    <div className="min-h-screen bg-[#F5F3EE] text-[#0B1E3F] flex">
      <aside className={`fixed md:sticky md:top-0 z-40 w-64 h-screen bg-white border-r border-[#0B1E3F]/10 flex flex-col transition-transform text-[#0B1E3F] ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className="p-6 border-b border-[#0B1E3F]/10">
          <button onClick={() => navigate('landing')}><Logo /></button>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => {
            const active = route === item.id;
            return (
              <button key={item.id} onClick={() => { navigate(item.id); setSidebarOpen(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition ${active ? 'bg-[#0B1E3F] text-white' : 'text-[#0B1E3F]/70 hover:bg-[#0B1E3F]/5 hover:text-[#0B1E3F]'}`}>
                <item.icon className="w-4 h-4" />
                <span className="flex-1 text-left">{item.label}</span>
                {item.badge && <span className="px-1.5 py-0.5 bg-[#FF6B35] text-white text-xs rounded-full min-w-[20px] text-center">{item.badge}</span>}
              </button>
            );
          })}
        </nav>
        <div className="p-3 border-t border-[#0B1E3F]/10">
          <button onClick={() => { navigate('settings', { tab: 'billing' }); setSidebarOpen(false); }} className="w-full text-left p-3 bg-[#0B1E3F]/5 hover:bg-[#0B1E3F]/10 transition rounded-lg mb-2">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-[#FF6B35] flex items-center justify-center text-white text-sm font-semibold">{(user.name || '?').split(' ').map((p: string) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[#0B1E3F] truncate">{user.name}</div>
                <div className="text-xs text-[#0B1E3F]/60 truncate">{user.company || user.email}</div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] mono uppercase tracking-wider mb-1.5 flex-wrap">
              {isAdmin && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-[#0B1E3F] text-white rounded">
                  <ShieldCheck className="w-2.5 h-2.5" /> admin
                </span>
              )}
              <span className="text-[#FF6B35] inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-[#FF6B35] rounded-full" /> {user.plan || 'no'} plan
              </span>
            </div>
            <div className="text-[11px] text-[#0B1E3F]/60 leading-snug">
              {isAdmin ? (
                'Unlimited lookups · unlimited scans'
              ) : (
                <>
                  {lookupsLeft == null ? 'Unlimited lookups' : `${lookupsLeft} / ${usagePlan.limits.fmcsaLookups} lookups left`}
                  {' · '}
                  {scansLeft == null ? 'unlimited scans' : `${scansLeft} / ${usagePlan.limits.rateConScans} scans left`}
                </>
              )}
            </div>
          </button>
          <button onClick={logout} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-[#0B1E3F]/70 hover:bg-[#0B1E3F]/5 transition">
            <LogOut className="w-4 h-4" /> Log out
          </button>
        </div>
      </aside>
      {sidebarOpen && <div onClick={() => setSidebarOpen(false)} className="fixed inset-0 bg-black/30 z-30 md:hidden" />}
      <div className="flex-1 min-w-0 text-[#0B1E3F]">
        <header className="bg-white border-b border-[#0B1E3F]/10 px-6 py-3 flex items-center justify-between sticky top-0 z-20 gap-3">
          <button onClick={() => setSidebarOpen(true)} className="md:hidden"><Menu className="w-5 h-5 text-[#0B1E3F]" /></button>
          <HeaderSearch navigate={navigate} />
          <OwnScoreChip navigate={navigate} />
        </header>
        <main className="p-6 md:p-10 max-w-7xl mx-auto text-[#0B1E3F]">{children}</main>
      </div>
    </div>
  );
}

function Dashboard({ navigate, user }: any) {
  const lookupsRes = useCachedFetch<{ lookups: any[] }>('lookups:200', '/api/lookups?limit=200');
  const usageRes = useCachedFetch<any>('usage', '/api/usage');
  const lookups = lookupsRes.data?.lookups ?? null;
  const usage = usageRes.data;
  const plan = getPlan(user?.plan || usage?.plan?.id);

  const all = lookups || [];
  const highCount = all.filter((l) => l.verdict === 'high').length;
  const recent = all.slice(0, 5);
  const scamAlerts = all.filter((l) => l.verdict === 'high').slice(0, 3);
  const u = usage?.usage || { fmcsaLookups: 0, rateConScans: 0, watchlist: 0 };

  return (
    <div className="space-y-8 text-[#0B1E3F]">
      <div>
        <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-2">Welcome</div>
        <h1 className="text-4xl serif italic text-[#0B1E3F]">Hello, {user.name.split(' ')[0]}.</h1>
      </div>
      <div className="grid md:grid-cols-4 gap-4">
        <UsageCard label="Lookups this month" value={u.fmcsaLookups} limit={usage?.isAdmin ? null : plan.limits.fmcsaLookups} icon={Search} color="#0B1E3F" />
        <UsageCard label="Rate con scans" value={u.rateConScans} limit={usage?.isAdmin ? null : plan.limits.rateConScans} icon={FileText} color="#0B1E3F" />
        <UsageCard label="Watchlist" value={u.watchlist} limit={usage?.isAdmin ? null : plan.limits.watchlist} icon={Eye} color="#0B1E3F" />
        <StatCard label="High-risk flagged" value={lookups == null ? '—' : String(highCount)} trend="" sub="in your history" icon={Shield} color="#DC2626" danger />
      </div>
      {plan.id === 'free' && (
        <div className="flex items-center justify-between gap-4 p-4 bg-[#FF6B35]/10 border border-[#FF6B35]/30 rounded-xl">
          <div className="text-sm text-[#0B1E3F]">
            You&rsquo;re on the <strong>Free</strong> plan — {plan.limits.fmcsaLookups} lookups and {plan.limits.rateConScans} rate con scan per month. Upgrade to Carrier for unlimited lookups and 25 rate con scans.
          </div>
          <button onClick={() => navigate('plan')} className="px-4 py-2 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90 whitespace-nowrap">Upgrade</button>
        </div>
      )}
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-[#0B1E3F]/10 p-6 card-shadow text-[#0B1E3F]">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-[#0B1E3F]">Recent lookups</h2>
            <button onClick={() => navigate('verify')} className="text-sm text-[#0B1E3F]/60 hover:text-[#0B1E3F] flex items-center gap-1">New lookup <Plus className="w-3.5 h-3.5" /></button>
          </div>
          {lookups == null ? (
            <div className="py-8 text-center text-sm text-[#0B1E3F]/50">Loading…</div>
          ) : recent.length === 0 ? (
            <div className="py-12 text-center text-[#0B1E3F]/60">
              <Search className="w-10 h-10 mx-auto mb-3 text-[#0B1E3F]/30" />
              <div className="text-sm">No lookups yet. Verify your first broker to start building history.</div>
              <button onClick={() => navigate('verify')} className="mt-4 px-5 py-2.5 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90">Verify a broker</button>
            </div>
          ) : (
            <div className="space-y-1">
              {recent.map((l: any) => (
                <button key={l.id} onClick={() => navigate('report', l.data)} className="w-full flex items-center gap-4 p-3 rounded-lg hover:bg-[#0B1E3F]/5 transition text-left text-[#0B1E3F]">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center mono text-sm font-semibold ${l.verdict === 'high' ? 'bg-[#DC2626]/10 text-[#DC2626]' : l.verdict === 'medium' ? 'bg-[#F59E0B]/10 text-[#F59E0B]' : 'bg-[#16A34A]/10 text-[#16A34A]'}`}>{l.score}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-[#0B1E3F] truncate">{l.name}</div>
                    <div className="text-xs mono text-[#0B1E3F]/50">{[l.mc && `MC-${l.mc}`, l.dot && `DOT-${l.dot}`].filter(Boolean).join(' · ') || 'No ID'} · {timeAgo(l.created_at)}</div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-[#0B1E3F]/30" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="bg-[#0B1E3F] text-white rounded-2xl p-6 relative overflow-hidden card-shadow">
          <div className="absolute inset-0 grid-bg-dark opacity-50" />
          <div className="relative">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-white">High-risk flags</h2>
              <div className="w-8 h-8 rounded-lg bg-[#FF6B35]/20 flex items-center justify-center"><AlertTriangle className="w-4 h-4 text-[#FF6B35]" /></div>
            </div>
            {scamAlerts.length === 0 ? (
              <div className="text-sm text-white/70 py-8 text-center">No high-risk brokers flagged yet.</div>
            ) : (
              <div className="space-y-4">
                {scamAlerts.map((a: any) => (
                  <div key={a.id} className="pb-4 border-b border-white/10 last:border-0 last:pb-0">
                    <div className="font-medium text-sm mb-1 text-white truncate">{a.name}</div>
                    <div className="flex items-center gap-2 text-xs text-white/70 mb-2">
                      <span className="px-2 py-0.5 bg-[#FF6B35]/20 text-[#FF6B35] rounded-full">Score {a.score}</span>
                      <span>{timeAgo(a.created_at)}</span>
                    </div>
                    <div className="text-xs text-white/80 mono">{[a.mc && `MC-${a.mc}`, a.dot && `DOT-${a.dot}`].filter(Boolean).join(' · ') || 'No ID'}</div>
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => navigate('alerts')} className="w-full mt-6 py-2.5 bg-white/10 hover:bg-white/15 transition rounded-full text-sm font-medium text-white flex items-center justify-center gap-2">
              See all alerts <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function UsageCard({ label, value, limit, icon: Icon, color }: any) {
  const cap = limit == null ? null : Number(limit);
  const pct = cap == null || cap === 0 ? 0 : Math.min(100, (value / cap) * 100);
  const nearCap = cap != null && pct >= 80;
  const overCap = cap != null && value >= cap;
  const barColor = overCap ? '#DC2626' : nearCap ? '#F59E0B' : color;
  return (
    <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-5 card-shadow hover:card-shadow-lg transition text-[#0B1E3F]">
      <div className="flex items-start justify-between mb-3">
        <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60">{label}</div>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${color}15` }}>
          <Icon className="w-4 h-4" style={{ color }} />
        </div>
      </div>
      <div className="flex items-baseline gap-2 mb-2">
        <div className={`text-3xl font-semibold ${overCap ? 'text-[#DC2626]' : 'text-[#0B1E3F]'}`}>{value}</div>
        <div className="text-xs mono text-[#0B1E3F]/50">{cap == null ? 'of unlimited' : `/ ${formatLimit(cap)}`}</div>
      </div>
      {cap != null ? (
        <div className="h-1.5 rounded-full bg-[#0B1E3F]/10 overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: barColor }} />
        </div>
      ) : (
        <div className="text-xs text-[#0B1E3F]/60">Unlimited on your plan</div>
      )}
    </div>
  );
}

function StatCard({ label, value, trend, sub, icon: Icon, color, danger, good }: any) {
  return (
    <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-5 card-shadow hover:card-shadow-lg transition text-[#0B1E3F]">
      <div className="flex items-start justify-between mb-3">
        <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60">{label}</div>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${color}15` }}>
          <Icon className="w-4 h-4" style={{ color }} />
        </div>
      </div>
      <div className="flex items-baseline gap-2 mb-1">
        <div className={`text-3xl font-semibold ${danger ? 'text-[#DC2626]' : good ? 'text-[#16A34A]' : 'text-[#0B1E3F]'}`}>{value}</div>
        <div className="text-xs mono text-[#0B1E3F]/50">{trend}</div>
      </div>
      <div className="text-xs text-[#0B1E3F]/60">{sub}</div>
    </div>
  );
}

function VerifyTool({ navigate }: any) {
  // Initial tab can be deep-linked via navigate('verify', { tab: 'ratecon' })
  // — we stash it in sessionStorage in the parent navigate() and consume
  // it once here on mount.
  const [tab, setTab] = useState<string>(() => {
    if (typeof window === 'undefined') return 'quick';
    try {
      const t = sessionStorage.getItem('haulock:verifyTab');
      if (t) {
        sessionStorage.removeItem('haulock:verifyTab');
        return t;
      }
    } catch {}
    return 'quick';
  });
  const [input, setInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorSuggestions, setErrorSuggestions] = useState<string[] | null>(null);
  // When the API resolves we hold the result for a brief reveal moment so
  // the scanner can paint red on whichever sources caught something spooky
  // before we navigate to the full report.
  const [scanResult, setScanResult] = useState<any | null>(null);
  const [rcFile, setRcFile] = useState<File | null>(null);
  const [rcLoading, setRcLoading] = useState(false);
  const [rcError, setRcError] = useState<string | null>(null);
  const [rcDrag, setRcDrag] = useState(false);
  const emailInputRef = React.useRef<HTMLInputElement | null>(null);

  // Common prefixes seen on broker rate-con emails. Click to pre-fill the
  // email field with `<prefix>@` and focus the cursor after the @ so the
  // user just types the domain.
  const applyEmailPrefix = (prefix: string) => {
    const existing = emailInput;
    const atIdx = existing.indexOf('@');
    const tail = atIdx >= 0 ? existing.slice(atIdx + 1) : '';
    const next = `${prefix}@${tail}`;
    setEmailInput(next);
    // Defer focus until the value has been applied so caret lands at the end.
    setTimeout(() => {
      const el = emailInputRef.current;
      if (!el) return;
      el.focus();
      const pos = next.length;
      el.setSelectionRange(pos, pos);
    }, 0);
  };

  const scanRateCon = async (file: File) => {
    if (!file) return;
    setRcError(null); setRcLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/rate-con/scan', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 402) throw new Error(data?.error || 'Monthly rate con scan limit reached. Upgrade your plan.');
        throw new Error(data?.error || `Scan failed (${res.status})`);
      }
      invalidateCache('lookups:200', 'usage', 'alerts');
      track('rate_con_uploaded', {
        verdict: data?.verdict || 'unknown',
        score: typeof data?.score === 'number' ? data.score : 0,
        broker_resolved: Boolean(data?.mc || data?.dot),
      });
      navigate('report', data);
    } catch (err: any) {
      setRcError(err?.message || 'Scan failed');
    } finally {
      setRcLoading(false);
    }
  };

  const runLookup = async (override?: string, emailOverride?: string) => {
    const q = (override ?? input).trim();
    const e = (emailOverride ?? emailInput).trim();
    if (!q) { setError('Enter an MC number, DOT number, or company name.'); return; }
    setLoading(true); setError(null); setErrorSuggestions(null);
    try {
      // Pass the email field through to the verify route so it can run
      // lookalike-domain detection against the carrier's real FMCSA-listed
      // website — catches typosquats / homograph spoofs the eye misses.
      const verifyUrl = `/api/verify?q=${encodeURIComponent(q)}${e ? `&email=${encodeURIComponent(e)}` : ''}`;
      const promises: Promise<any>[] = [
        fetch(verifyUrl).then(async (r) => {
          const j = await r.json();
          if (!r.ok) {
            if (r.status === 402) throw new Error(j?.error || 'Monthly lookup limit reached. Upgrade your plan for more.');
            if (r.status === 429) throw new Error(j?.error || 'Too many lookups — slow down and try again shortly.');
            // Both 404 (name not found) and 503 (upstream down) now carry
            // an actionable `suggestions` array — surface either.
            if ((r.status === 404 || r.status === 503) && Array.isArray(j?.suggestions)) {
              setErrorSuggestions(j.suggestions);
            } else {
              setErrorSuggestions(null);
            }
            throw new Error(j?.error || `Lookup failed (${r.status})`);
          }
          return j;
        }),
      ];
      if (e) {
        promises.push(
          fetch(`/api/domain-check?q=${encodeURIComponent(e)}`).then(async (r) => {
            const j = await r.json();
            return r.ok ? j : null;
          }).catch(() => null)
        );
      }
      const [data, domain] = await Promise.all(promises);
      const merged = { ...data, domain: domain || data.domain || undefined, queriedEmail: e || data.queriedEmail || undefined };
      if (!data?.cached) {
        fetch('/api/lookups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(merged),
        }).then(() => invalidateCache('lookups:200', 'usage', 'alerts')).catch(() => {});
        if (data?.verdict === 'high') {
          fetch('/api/email/high-risk-alert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ report: data }),
          }).catch(() => {});
        }
      }
      // Brief "reveal" beat — flash the scanner cards red/green based on
      // the actual carrier response so the user sees what was caught before
      // landing on the full report. ~1.4s is long enough to register
      // visually without feeling like a delay.
      setScanResult(merged);
      track('verify_completed', {
        query_kind: /^MC[-\s]?\d/i.test(q) ? 'mc' : /^(?:US)?DOT[-\s]?\d/i.test(q) ? 'dot' : 'name',
        verdict: data?.verdict || 'unknown',
        score: typeof data?.score === 'number' ? data.score : 0,
        cached: Boolean(data?.cached),
      });
      await new Promise((r) => setTimeout(r, 1400));
      navigate('report', merged);
      setScanResult(null);
    } catch (err: any) {
      setError(err?.message || 'Lookup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8 text-[#0B1E3F]">
      <div>
        <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-2">Verify broker</div>
        <h1 className="text-4xl serif italic text-[#0B1E3F]">Who&apos;s on the other end?</h1>
      </div>
      <div className="flex gap-1 p-1 bg-[#0B1E3F]/5 rounded-full w-fit flex-wrap">
        {([
          { id: 'quick', label: 'Quick lookup' },
          { id: 'ratecon', label: 'Rate con analyzer' },
          // PDF forensics is the primary feature for drivers — we tag it
          // with a green pill so a driver visiting the verify page knows
          // immediately which tab applies to their workflow.
          { id: 'forensics', label: 'PDF forensics', tag: 'For drivers' },
          // Bulk verify is shipped but hidden from the tab strip until we
          // actually need it. Keep the route alive so existing deep-links
          // (and the underlying PageSlot) don't 404.
          // { id: 'bulk', label: 'Bulk verify' },
        ] as const).map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition flex items-center gap-2 ${active ? 'bg-[#0B1E3F] text-white' : 'text-[#0B1E3F]/60 hover:text-[#0B1E3F]'}`}
            >
              {t.label}
              {('tag' in t) && t.tag && (
                <span
                  className={`text-[9px] mono uppercase tracking-wider px-1.5 py-0.5 rounded-full font-bold ${active ? 'bg-white/20 text-white' : 'bg-[#16A34A]/10 text-[#16A34A]'}`}
                  title="Drivers and owner-operators use this to check if a dispatcher edited a rate con before forwarding it."
                >
                  {t.tag}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {tab === 'quick' && (
        loading ? (
          <VerifyScanProgress query={input} result={scanResult} />
        ) : (
        <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-8 md:p-12 card-shadow text-[#0B1E3F]">
          <label className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 block mb-3">MC number, DOT number, or company name</label>
          <div className="flex gap-3">
            <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') runLookup(); }} placeholder="e.g., MC-847291 or Acme Freight Brokers" className="flex-1 px-5 py-4 bg-[#F5F3EE] border border-[#0B1E3F]/15 rounded-xl text-lg focus:outline-none focus:border-[#0B1E3F] transition text-[#0B1E3F] placeholder:text-[#0B1E3F]/30" />
            <button onClick={() => runLookup()} disabled={loading} className="px-8 py-4 bg-[#0B1E3F] text-white rounded-xl font-medium hover:bg-[#0B1E3F]/90 transition flex items-center gap-2 disabled:opacity-60">
              Verify <ArrowRight className="w-4 h-4" />
            </button>
          </div>
          <div className="mt-5">
            <label className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 block mb-3">Email or domain from the rate con <span className="normal-case text-[#0B1E3F]/40 tracking-normal">(optional — checks domain age, MX, SPF)</span></label>
            <input ref={emailInputRef} value={emailInput} onChange={(e) => setEmailInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') runLookup(); }} placeholder="dispatch@acmefreight.com or acmefreight.com" className="w-full px-5 py-4 bg-[#F5F3EE] border border-[#0B1E3F]/15 rounded-xl text-lg focus:outline-none focus:border-[#0B1E3F] transition text-[#0B1E3F] placeholder:text-[#0B1E3F]/30" />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/45">Common prefixes</span>
              {['dispatch', 'safety', 'ops', 'compliance', 'accounting', 'billing', 'carriers', 'rates'].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => applyEmailPrefix(p)}
                  className="px-2.5 py-1 bg-[#0B1E3F]/5 hover:bg-[#0B1E3F]/10 rounded-full text-xs mono text-[#0B1E3F]/75 hover:text-[#0B1E3F] transition"
                >
                  {p}@
                </button>
              ))}
            </div>
          </div>
          {error && (
            <div className="mt-4 p-4 bg-[#DC2626]/5 border border-[#DC2626]/25 rounded-xl">
              <div className="flex items-start gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-[#DC2626] flex-shrink-0 mt-0.5" />
                <div className="text-sm font-semibold text-[#0B1E3F]">{error}</div>
              </div>
              {errorSuggestions && errorSuggestions.length > 0 && (
                <ul className="mt-2 ml-6 space-y-1.5 text-sm text-[#0B1E3F]/75 list-disc">
                  {errorSuggestions.map((s, i) => <li key={i} className="leading-relaxed">{s}</li>)}
                </ul>
              )}
            </div>
          )}
          <div className="mt-8 pt-8 border-t border-[#0B1E3F]/10">
            <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-4">Try a sample</div>
            <div className="flex flex-wrap gap-2">
              {['MC-847291', 'MC-226104', 'MC-498732', 'Summit Logistics'].map((s) => (
                <button key={s} onClick={() => { setInput(s); runLookup(s); }} className="px-3 py-1.5 bg-[#0B1E3F]/5 hover:bg-[#0B1E3F]/10 rounded-full text-sm font-medium mono text-[#0B1E3F]/80 transition">{s}</button>
              ))}
            </div>
          </div>
        </div>
        )
      )}
      {tab === 'ratecon' && (
        <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-8 card-shadow text-[#0B1E3F]">
          <label
            onDragOver={(e) => { e.preventDefault(); setRcDrag(true); }}
            onDragLeave={() => setRcDrag(false)}
            onDrop={(e) => {
              e.preventDefault(); setRcDrag(false);
              const f = e.dataTransfer.files?.[0];
              if (f) { setRcFile(f); scanRateCon(f); }
            }}
            className={`block border-2 border-dashed rounded-2xl p-16 text-center transition cursor-pointer ${rcDrag ? 'border-[#FF6B35] bg-[#FF6B35]/5' : 'border-[#0B1E3F]/20 hover:border-[#FF6B35] hover:bg-[#FF6B35]/5'}`}
          >
            <input
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              className="hidden"
              disabled={rcLoading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) { setRcFile(f); scanRateCon(f); }
              }}
            />
            {rcLoading ? (
              <RateConScanProgress fileName={rcFile?.name} />
            ) : (
              <>
                <div className="w-16 h-16 bg-[#0B1E3F]/5 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <FileText className="w-8 h-8 text-[#0B1E3F]/50" />
                </div>
                <div className="text-lg font-medium text-[#0B1E3F] mb-2">
                  {rcFile ? rcFile.name : 'Drop a rate confirmation here'}
                </div>
                <div className="text-sm text-[#0B1E3F]/60 mb-6">
                  PDF or image — we&rsquo;ll extract, verify the broker, and cross-check email + address in seconds.
                </div>
                <span className="inline-block px-6 py-2.5 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90 transition">
                  Choose file
                </span>
                <div className="mt-4 text-xs mono text-[#0B1E3F]/40">PDF · PNG · JPG · max 10MB</div>
              </>
            )}
          </label>
          {rcError && <div className="mt-4 text-sm text-[#DC2626]">{rcError}</div>}
          <div className="mt-8 pt-6 border-t border-[#0B1E3F]/10 text-xs text-[#0B1E3F]/60 leading-relaxed">
            <div className="mono uppercase tracking-wider text-[#0B1E3F]/50 mb-2">How it works</div>
            <div>1. <strong className="text-[#0B1E3F]">Google Document AI</strong> extracts the text from your PDF.</div>
            <div>2. <strong className="text-[#0B1E3F]">Claude</strong> identifies the broker, MC, email, and scores the document 0–100 for stylistic fraud signals (urgency, grammar, suspicious payment terms).</div>
            <div>3. The extracted MC is then run through <strong className="text-[#0B1E3F]">FMCSA</strong>, the email domain through our <strong className="text-[#0B1E3F]">WHOIS/MX/SPF</strong> checks, and the address through <strong className="text-[#0B1E3F]">Google Places</strong>.</div>
            <div className="mt-3">The PDF is processed in memory and discarded as soon as we return the report. It is never written to disk.</div>
          </div>
        </div>
      )}
      {tab === 'forensics' && <PdfForensicsPanel />}
      {tab === 'bulk' && (
        <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-8 card-shadow text-[#0B1E3F]">
          <div className="flex items-start gap-4 p-4 bg-[#FF6B35]/10 border border-[#FF6B35]/30 rounded-xl mb-8">
            <AlertTriangle className="w-5 h-5 text-[#FF6B35] flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-[#0B1E3F]">Fleet plan required</div>
              <div className="text-sm text-[#0B1E3F]/70 mt-1">Upload up to 500 MC numbers at once. Upgrade to Fleet.</div>
            </div>
          </div>
          <div className="opacity-50">
            <div className="border-2 border-dashed border-[#0B1E3F]/20 rounded-2xl p-16 text-center">
              <FileText className="w-12 h-12 text-[#0B1E3F]/30 mx-auto mb-4" />
              <div className="text-lg font-medium text-[#0B1E3F] mb-2">Upload CSV</div>
              <div className="text-sm text-[#0B1E3F]/60">One MC number per row</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PdfForensicsPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const scan = async (f: File) => {
    setLoading(true); setError(null); setResult(null); setFile(f);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const r = await fetch('/api/pdf-forensics', { method: 'POST', body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `Analysis failed (${r.status})`);
      setResult(j);
      track('pdf_forensics_scanned', {
        verdict: j?.verdict || 'unknown',
        score: typeof j?.score === 'number' ? j.score : 0,
      });
    } catch (err: any) {
      setError(err?.message || 'Analysis failed');
    } finally {
      setLoading(false);
    }
  };

  const verdictTone = (v: string) =>
    v === 'likely_tampered' ? { bg: 'bg-[#DC2626]/10', border: 'border-[#DC2626]/30', text: 'text-[#DC2626]', label: 'LIKELY TAMPERED' }
    : v === 'suspicious' ? { bg: 'bg-[#F59E0B]/10', border: 'border-[#F59E0B]/30', text: 'text-[#F59E0B]', label: 'SUSPICIOUS' }
    : { bg: 'bg-[#16A34A]/10', border: 'border-[#16A34A]/30', text: 'text-[#16A34A]', label: 'CLEAN' };

  const sevColor = (s: string) => s === 'critical' ? '#DC2626' : s === 'warning' ? '#F59E0B' : '#0B1E3F';
  const fmtBytes = (n: number) => n < 1024 ? `${n} B` : n < 1_048_576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1_048_576).toFixed(1)} MB`;
  const fmtDate = (s: string | null) => s ? new Date(s).toLocaleString() : '—';

  return (
    <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-8 card-shadow text-[#0B1E3F]">
      <div className="flex items-start gap-4 p-4 bg-[#16A34A]/10 border border-[#16A34A]/25 rounded-xl mb-6">
        <CheckCircle2 className="w-5 h-5 text-[#16A34A] flex-shrink-0 mt-0.5" />
        <div className="text-sm text-[#0B1E3F]">
          <div className="font-medium mb-0.5">PDF metadata forensics · 3 scans/month free, unlimited on paid</div>
          <div className="text-[#0B1E3F]/70">Checks the PDF&apos;s hidden metadata for signs of tampering — modification timestamps, software used to edit, stripped metadata, and author-name mismatches. No OCR, no AI, no broker lookup — just forensics on the file itself.</div>
        </div>
      </div>

      <label className="block cursor-pointer border-2 border-dashed border-[#0B1E3F]/20 rounded-2xl p-8 text-center hover:border-[#FF6B35] hover:bg-[#FF6B35]/5 transition">
        <input
          type="file"
          accept="application/pdf"
          className="hidden"
          disabled={loading}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) scan(f); }}
        />
        <div className="w-14 h-14 bg-[#0B1E3F]/5 rounded-2xl flex items-center justify-center mx-auto mb-3">
          {loading ? <div className="w-5 h-5 border-2 border-[#0B1E3F]/20 border-t-[#FF6B35] rounded-full animate-spin" /> : <FileText className="w-7 h-7 text-[#0B1E3F]/50" />}
        </div>
        <div className="text-lg font-medium text-[#0B1E3F] mb-1">
          {loading ? 'Analyzing PDF metadata…' : file ? file.name : 'Drop a PDF to check if it was tampered with'}
        </div>
        <div className="text-xs text-[#0B1E3F]/55">PDF only · max 15 MB · metadata inspection only (no OCR / AI / FMCSA)</div>
        {!loading && <div className="mt-4 inline-block px-5 py-2 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90 transition">Choose PDF</div>}
      </label>

      {error && <div className="mt-4 text-sm text-[#DC2626]">{error}</div>}

      {result && (() => {
        const tone = verdictTone(result.verdict);
        return (
          <div className="mt-8 space-y-6">
            {/* Verdict banner */}
            <div className={`p-5 rounded-2xl border ${tone.bg} ${tone.border}`}>
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <div className={`text-xs mono uppercase tracking-wider ${tone.text} mb-1`}>{tone.label}</div>
                  <div className="text-2xl font-semibold text-[#0B1E3F]">{result.filename || 'Document'}</div>
                  <div className="text-sm text-[#0B1E3F]/60 mt-1">Forensic score: <span className="font-semibold">{result.score}/100</span> · {result.flags.length} flag{result.flags.length === 1 ? '' : 's'}</div>
                </div>
                <div className={`w-20 h-20 rounded-2xl ${tone.bg} ${tone.border} border flex flex-col items-center justify-center flex-shrink-0`}>
                  <div className={`text-3xl font-bold ${tone.text}`}>{result.score}</div>
                  <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">/ 100</div>
                </div>
              </div>
            </div>

            {/* Flags */}
            {result.flags.length > 0 && (
              <div>
                <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/55 mb-3">Red flags detected</div>
                <div className="space-y-2">
                  {result.flags.map((f: any, i: number) => (
                    <div key={i} className="flex items-start gap-3 p-4 bg-[#0B1E3F]/[0.03] border border-[#0B1E3F]/10 rounded-xl">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: sevColor(f.sev) }} />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm text-[#0B1E3F]">{f.title}</div>
                        <div className="text-sm text-[#0B1E3F]/70 mt-0.5">{f.desc}</div>
                      </div>
                      <div className="text-xs mono text-[#0B1E3F]/50 flex-shrink-0">+{f.pts}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {result.flags.length === 0 && (
              <div className="p-5 bg-[#16A34A]/5 border border-[#16A34A]/25 rounded-xl text-sm text-[#0B1E3F]">
                <div className="font-semibold text-[#16A34A] mb-1">No red flags detected</div>
                The PDF metadata looks consistent with a document generated by legitimate software and not subsequently edited. This doesn&apos;t guarantee the CONTENT is honest — run a full rate con scan to verify the broker itself.
              </div>
            )}

            {/* Raw metadata */}
            <div>
              <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/55 mb-3">Document metadata</div>
              <div className="grid md:grid-cols-2 gap-3">
                {[
                  { label: 'Creation date', val: fmtDate(result.metadata.creationDate) },
                  { label: 'Modification date', val: fmtDate(result.metadata.modificationDate) },
                  { label: 'Producer', val: result.metadata.producer || '—' },
                  { label: 'Creator', val: result.metadata.creator || '—' },
                  { label: 'Author', val: result.metadata.author || '—' },
                  { label: 'Title', val: result.metadata.title || '—' },
                  { label: 'PDF version', val: result.metadata.pdfVersion || '—' },
                  { label: 'Pages', val: String(result.metadata.pageCount) },
                  { label: 'File size', val: fmtBytes(result.metadata.fileSizeBytes) },
                ].map((i, idx) => (
                  <div key={idx} className="p-3 bg-[#0B1E3F]/5 rounded-lg">
                    <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">{i.label}</div>
                    <div className="text-sm text-[#0B1E3F] mt-0.5 break-words">{i.val}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-[#0B1E3F]/10 text-xs text-[#0B1E3F]/60">
              Tip: this only inspects the PDF file itself. To verify the BROKER on the rate con, switch to the <strong>Rate con analyzer</strong> tab.
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function entityBadge(r: any): { label: string; bg: string; color: string; icon: string } {
  const isCarrier = r.commonAuthority === 'Active' || r.contractAuthority === 'Active';
  const isBroker = r.brokerAuthority === 'Active';
  if (isCarrier && isBroker) return { label: 'Carrier + Broker', bg: 'linear-gradient(135deg, #0B1E3F 0%, #FF6B35 100%)', color: '#ffffff', icon: '🚛' };
  if (isBroker) return { label: 'Broker', bg: '#FF6B35', color: '#ffffff', icon: '🔗' };
  if (isCarrier) return { label: 'Carrier', bg: '#0B1E3F', color: '#ffffff', icon: '🚛' };
  return { label: 'No authority', bg: '#DC2626', color: '#ffffff', icon: '⚠' };
}

function Report({ report, navigate }: any) {
  if (!report) {
    return (
      <div className="py-20 px-6 text-center text-[#0B1E3F]">
        <Search className="w-12 h-12 mx-auto mb-4 text-[#0B1E3F]/30" />
        <h1 className="text-2xl serif italic mb-2">No report to show yet</h1>
        <p className="text-[#0B1E3F]/60 mb-6 max-w-md mx-auto">Run a Verify lookup or open one from your History to see its report here.</p>
        <div className="flex items-center justify-center gap-2">
          <button onClick={() => navigate('verify')} className="px-5 py-2.5 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90">Verify a broker</button>
          <button onClick={() => navigate('history')} className="px-5 py-2.5 border border-[#0B1E3F]/15 bg-white rounded-full text-sm font-medium text-[#0B1E3F] hover:bg-[#0B1E3F]/5">Open history</button>
        </div>
      </div>
    );
  }
  const r = report;
  const verdict = r.verdict || (r.score >= 61 ? 'high' : r.score >= 31 ? 'medium' : 'low');
  const isBad = verdict === 'high';
  const idLine = [r.mc && `MC-${r.mc}`, r.dot && `DOT-${r.dot}`].filter(Boolean).join(' · ') || 'Unverified';
  const badge = entityBadge(r);
  const [watching, setWatching] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [reportOpen, setReportOpen] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [rescanError, setRescanError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  // Confirmation when the user clicks a linked-entity / alias card. Running
  // a fresh scan costs a credit on Free plan and replaces the current
  // report, so we ask before navigating away.
  const [confirm, setConfirm] = useState<{ opts: ConfirmOpts; run: () => Promise<void>; busy?: boolean } | null>(null);
  const handleConfirm = async () => {
    if (!confirm) return;
    setConfirm({ ...confirm, busy: true });
    try { await confirm.run(); }
    finally { setConfirm(null); }
  };
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const sendEmailReport = async () => {
    if (emailSending) return;
    const recipients = emailTo.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
    if (recipients.length === 0) { setEmailError('Enter at least one email address.'); return; }
    setEmailSending(true); setEmailError(null);
    try {
      const res = await fetch('/api/report/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report: r, to: recipients, message: emailMessage }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Send failed (${res.status})`);
      track('report_shared_email', { recipients: recipients.length, mc: r.mc || undefined, dot: r.dot || undefined });
      setEmailSent(true);
      setTimeout(() => { setEmailOpen(false); setEmailSent(false); setEmailTo(''); setEmailMessage(''); }, 1500);
    } catch (e: any) {
      setEmailError(e?.message || 'Send failed');
    } finally {
      setEmailSending(false);
    }
  };
  const rescanQuery = r.mc || r.dot;
  const onExportPdf = async () => {
    if (exporting) return;
    setExporting(true); setExportError(null);
    try {
      const res = await fetch('/api/report/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report: r }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const idPart = (r.mc || r.dot || (r.name || 'carrier')).toString().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40);
      a.download = `haulock-report-${idPart}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      track('report_exported_pdf', { mc: r.mc || undefined, dot: r.dot || undefined });
    } catch (e: any) {
      setExportError(e?.message || 'PDF export failed');
      setTimeout(() => setExportError(null), 4000);
    } finally {
      setExporting(false);
    }
  };
  const onRescan = async () => {
    if (!rescanQuery) return;
    setRescanning(true); setRescanError(null);
    try {
      const res = await fetch(`/api/verify?q=${encodeURIComponent(rescanQuery)}&force=1`);
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 402) throw new Error(data?.error || 'Monthly lookup limit reached.');
        throw new Error(data?.error || `Lookup failed (${res.status})`);
      }
      const e = r.queriedEmail;
      let domain: any = r.domain;
      if (e) {
        const dres = await fetch(`/api/domain-check?q=${encodeURIComponent(e)}`);
        if (dres.ok) domain = await dres.json();
      }
      const merged = { ...data, domain, queriedEmail: e };
      fetch('/api/lookups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(merged) })
        .then(() => invalidateCache('lookups:200', 'usage', 'alerts'))
        .catch(() => {});
      if (data?.verdict === 'high') {
        fetch('/api/email/high-risk-alert', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ report: data }) }).catch(() => {});
      }
      navigate('report', merged);
    } catch (err: any) {
      setRescanError(err?.message || 'Re-scan failed');
    } finally {
      setRescanning(false);
    }
  };
  const reportsKey = (r.mc || r.dot) ? `fraud:${r.mc || ''}:${r.dot || ''}` : null;
  const reportsUrl = (r.mc || r.dot) ? `/api/fraud-reports?${r.mc ? `mc=${encodeURIComponent(r.mc)}&` : ''}${r.dot ? `dot=${encodeURIComponent(r.dot)}` : ''}` : null;
  const reportsRes = useCachedFetch<{ reports: any[] }>(reportsKey || '__none__', reportsUrl);
  const communityReports = reportsRes.data?.reports ?? [];

  const [watchOpen, setWatchOpen] = useState(false);
  const confirmWatch = async () => {
    if (watching === 'saving' || !r?.name || (!r.mc && !r.dot)) return;
    setWatching('saving');
    try {
      const res = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(r),
      });
      if (res.ok) {
        invalidateCache('watchlist', 'usage');
        track('watchlist_added', {
          mc: r.mc || undefined,
          dot: r.dot || undefined,
          verdict: r.verdict || 'unknown',
        });
      }
      setWatching(res.ok ? 'saved' : 'error');
      if (res.ok) setTimeout(() => setWatchOpen(false), 800);
    } catch {
      setWatching('error');
    }
  };

  return (
    <>
    <div className="space-y-8 text-[#0B1E3F]">
      <div>
        <button onClick={() => navigate('verify')} className="text-sm text-[#0B1E3F]/60 hover:text-[#0B1E3F] flex items-center gap-1 mb-4">← Back to verify</button>
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-2">Risk report · {idLine}</div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-4xl serif italic text-[#0B1E3F]">{r.name}</h1>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs mono uppercase tracking-wider font-semibold whitespace-nowrap" style={{ background: badge.bg, color: badge.color }}>
                <span>{badge.icon}</span>{badge.label}
              </span>
              {communityReports.length > 0 && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs mono uppercase tracking-wider font-semibold bg-[#DC2626] text-white whitespace-nowrap">
                  <Flag className="w-3 h-3" /> {communityReports.length} carrier{communityReports.length === 1 ? '' : 's'} flagged
                </span>
              )}
            </div>
            {r.source === 'mock' && (() => {
              const fmcsaDown = (r.flags || []).some((f: any) => /FMCSA (lookup failed|temporarily)/i.test(f.title));
              const hasMcOrDot = Boolean(r.mc || r.dot);
              const hasName = Boolean(r.name && r.name !== 'Unknown broker');
              if (fmcsaDown) {
                return (
                  <div className="mt-2 p-3 bg-[#F59E0B]/10 border border-[#F59E0B]/30 rounded-lg text-xs text-[#0B1E3F] max-w-xl">
                    <div className="font-semibold text-[#F59E0B] mb-1 mono uppercase tracking-wider text-[10px]">FMCSA unavailable</div>
                    <div>Identity fields (name, MC, DOT) show what Claude pulled from your PDF. Retry in a minute for live FMCSA data.</div>
                  </div>
                );
              }
              if (hasName && !hasMcOrDot) {
                // Missing MC on a rate con is common, not fraud. Just tell the
                // user we're showing what the PDF said and link to SAFER for
                // manual verification.
                const safer = `https://safer.fmcsa.dot.gov/CompanySnapshot.aspx?query_type=queryCarrierSnapshot&query_param=NAME&query_string=${encodeURIComponent(r.name || '')}`;
                return (
                  <div className="mt-2 p-3 bg-[#0B1E3F]/5 border border-[#0B1E3F]/10 rounded-lg text-xs text-[#0B1E3F]/80 max-w-xl">
                    Couldn&apos;t auto-match this broker in our registry — the rate con didn&apos;t include an MC/DOT and our name search didn&apos;t find a single match. Details below come from the PDF. <a href={safer} target="_blank" rel="noreferrer" className="underline text-[#0B1E3F]">Search SAFER manually</a> to cross-check.
                  </div>
                );
              }
              return (
                <div className="mt-2 p-3 bg-[#F59E0B]/10 border border-[#F59E0B]/30 rounded-lg text-xs text-[#0B1E3F] max-w-xl">
                  Demo data — set FMCSA_WEB_KEY in .env.local for live lookups.
                </div>
              );
            })()}
            {r.cached && (
              <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 bg-[#0B1E3F]/5 border border-[#0B1E3F]/10 rounded-full text-xs text-[#0B1E3F]/70">
                <Clock className="w-3.5 h-3.5" /> Cached from {r.cachedAt ? timeAgo(r.cachedAt) : 'earlier'} · no credit used
              </div>
            )}
            {rescanError && <div className="mt-2 text-sm text-[#DC2626]">{rescanError}</div>}
            {exportError && <div className="mt-2 text-sm text-[#DC2626]">{exportError}</div>}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setEmailOpen(true)} className="px-4 py-2 border border-[#0B1E3F]/15 bg-white rounded-full text-sm font-medium text-[#0B1E3F] hover:bg-[#0B1E3F]/5 transition flex items-center gap-2" title="Email this report (PDF attached) via Resend">
              <Mail className="w-4 h-4" /> Email
            </button>
            <button onClick={onExportPdf} disabled={exporting} className="px-4 py-2 border border-[#0B1E3F]/15 bg-white rounded-full text-sm font-medium text-[#0B1E3F] hover:bg-[#0B1E3F]/5 transition flex items-center gap-2 disabled:opacity-60" title="Download a branded PDF copy of this report">
              {exporting ? <><div className="w-3.5 h-3.5 border-2 border-[#0B1E3F]/30 border-t-[#0B1E3F] rounded-full animate-spin" /> Generating…</> : <><Download className="w-4 h-4" /> Export PDF</>}
            </button>
            <button onClick={onRescan} disabled={!rescanQuery || rescanning} className="px-4 py-2 border border-[#0B1E3F]/15 bg-white rounded-full text-sm font-medium text-[#0B1E3F] hover:bg-[#0B1E3F]/5 transition flex items-center gap-2 disabled:opacity-50" title="Runs a fresh FMCSA lookup — uses 1 credit">
              {rescanning ? <><div className="w-3.5 h-3.5 border-2 border-[#0B1E3F]/30 border-t-[#0B1E3F] rounded-full animate-spin" /> Scanning…</> : <><Search className="w-4 h-4" /> Scan again</>}
            </button>
            <button onClick={() => setReportOpen(true)} disabled={!r.mc && !r.dot} className="px-4 py-2 border border-[#DC2626]/30 bg-white rounded-full text-sm font-medium text-[#DC2626] hover:bg-[#DC2626]/5 transition flex items-center gap-2 disabled:opacity-50"><Flag className="w-4 h-4" /> Report fraud</button>
            <button onClick={() => setWatchOpen(true)} disabled={watching === 'saved' || (!r.mc && !r.dot)} className={`px-4 py-2 rounded-full text-sm font-medium transition flex items-center gap-2 disabled:opacity-60 ${watching === 'saved' ? 'bg-[#16A34A] text-white' : 'bg-[#0B1E3F] text-white hover:bg-[#0B1E3F]/90'}`}><Eye className="w-4 h-4" /> {watching === 'saved' ? 'Watching' : 'Watch'}</button>
          </div>
        </div>
      </div>
      <div className="grid md:grid-cols-5 gap-6">
        <div className="md:col-span-2 bg-white rounded-2xl border border-[#0B1E3F]/10 p-8 flex flex-col items-center card-shadow text-[#0B1E3F]">
          <RiskGauge score={r.score} size="lg" />
          <div className="mt-6 text-center">
            <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60">Risk level</div>
            <div className={`text-2xl font-semibold mt-1 ${isBad ? 'text-[#DC2626]' : verdict === 'medium' ? 'text-[#F59E0B]' : 'text-[#16A34A]'}`}>
              {verdict === 'high' ? 'HIGH RISK' : verdict === 'medium' ? 'CAUTION' : 'LOW RISK'}
            </div>
          </div>
        </div>
        <div className="md:col-span-3 bg-white rounded-2xl border border-[#0B1E3F]/10 p-8 card-shadow text-[#0B1E3F]">
          <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-2">Recommendation</div>
          <div className="text-2xl text-[#0B1E3F] leading-tight mb-4">
            {isBad ? 'Do not book this load.' : verdict === 'medium' ? 'Proceed with caution.' : 'Safe to book.'}
          </div>
          <p className="text-[#0B1E3F]/70 leading-relaxed">
            {isBad ? 'Multiple serious red flags detected. If you must proceed, require full payment upfront and verify identity through an independent channel.' : verdict === 'medium' ? 'This broker shows some risk signals. Verify the rate con details match FMCSA records and confirm identity independently.' : 'This broker has a clean record and no major red flags. Standard payment terms are appropriate.'}
          </p>
        </div>
      </div>
      {Array.isArray(r.sources) && r.sources.length > 0 && (
        <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-5 card-shadow text-[#0B1E3F]">
          <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-3">Sources scanned</div>
          <div className="flex flex-wrap gap-2">
            {r.sources.map((s: any) => (
              <span key={s.name} className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${s.ok ? 'bg-[#16A34A]/10 text-[#16A34A]' : 'bg-[#0B1E3F]/5 text-[#0B1E3F]/60'}`}>
                {s.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                <span className="font-semibold">{s.name}</span>
                <span className="opacity-75">· {s.note}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="grid md:grid-cols-2 gap-6">
        <DetailPanel title="Identity" items={[
          { icon: Building2, label: 'Legal name', val: r.name || '—' },
          { icon: Building2, label: 'DBA', val: r.dba || '—' },
          { icon: MapPin, label: 'Physical address', val: r.address || '—' },
          { icon: Phone, label: 'Phone', val: r.phone || '— (not in FMCSA)' },
          { icon: Mail, label: 'Email domain', val: r.emailDomain || '— (requires enrichment)' },
          { icon: Clock, label: 'Authority age', val: r.authorityAge || '—', warn: r.authorityAge && /reactivated/i.test(r.authorityAge) },
        ]} />
        <DetailPanel title="FMCSA authority & insurance" items={[
          { label: 'Operating authority', val: r.authorityStatus || '—', good: r.authorityStatus === 'Active', warn: r.authorityStatus && r.authorityStatus !== 'Active' },
          { label: 'Broker authority', val: r.brokerAuthority || '—', good: r.brokerAuthority === 'Active' },
          { label: 'Safety rating', val: r.safetyRating || 'Not rated' },
          { label: 'Out-of-service', val: r.outOfService ? 'Yes' : 'No', good: r.outOfService === false, warn: r.outOfService === true },
          { label: 'Insurance on file', val: r.insuranceSummary || '—', warn: r.bipdOnFile === 0 || (r.cargoRequired && r.cargoOnFile === 0), good: r.bipdOnFile != null && r.bipdOnFile > 0 && !(r.cargoRequired && r.cargoOnFile === 0) },
          { label: 'MCS-150', val: r.mcs150Date || (r.mcs150Outdated ? 'Overdue' : 'Current'), warn: r.mcs150Outdated },
        ]} />
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <DetailPanel title="Operations" items={[
          { label: 'Fleet size', val: r.powerUnits != null ? `${r.powerUnits} power units${r.drivers != null ? ` · ${r.drivers} drivers` : ''}` : '—' },
          { label: 'Classification', val: r.operation || '—' },
        ]} />
        <DetailPanel title="Safety record" items={[
          { label: 'Total crashes', val: r.crashTotal != null ? String(r.crashTotal) : '—', warn: (r.crashTotal ?? 0) >= 10 },
          { label: 'Fatal crashes', val: r.fatalCrash != null ? String(r.fatalCrash) : '—', warn: (r.fatalCrash ?? 0) > 0 },
          { label: 'Driver OOS rate', val: r.driverOosRate != null ? `${r.driverOosRate.toFixed(2)}%${r.driverOosRateNat != null ? ` (nat. avg ${r.driverOosRateNat.toFixed(2)}%)` : ''}` : '—', warn: r.driverOosRate != null && r.driverOosRateNat != null && r.driverOosRate > r.driverOosRateNat * 1.5, good: r.driverOosRate != null && r.driverOosRateNat != null && r.driverOosRate < r.driverOosRateNat },
          { label: 'Vehicle OOS rate', val: r.vehicleOosRate != null ? `${r.vehicleOosRate.toFixed(2)}%${r.vehicleOosRateNat != null ? ` (nat. avg ${r.vehicleOosRateNat.toFixed(2)}%)` : ''}` : '—', warn: r.vehicleOosRate != null && r.vehicleOosRateNat != null && r.vehicleOosRate > r.vehicleOosRateNat * 1.5, good: r.vehicleOosRate != null && r.vehicleOosRateNat != null && r.vehicleOosRate < r.vehicleOosRateNat },
        ]} />
      </div>
      {r.webPresence?.configured && (
        <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-8 card-shadow text-[#0B1E3F]">
          <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
            <div>
              <h2 className="text-xl font-semibold text-[#0B1E3F]">Web presence</h2>
              <div className="text-sm text-[#0B1E3F]/60 mt-1">Carrier website found via Google + checked for legitimacy.</div>
            </div>
            {r.webPresence.found ? (
              <span
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold ${r.webPresence.nameMatch ? 'bg-[#16A34A]/10 text-[#16A34A]' : 'bg-[#0B1E3F]/8 text-[#0B1E3F]/70'}`}
                title={r.webPresence.nameMatch ? 'The domain SLD includes the legal company name.' : 'Marketing-style domain that does not include the legal name. Common for brand sites and not a fraud signal.'}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                {r.webPresence.nameMatch ? 'Website found · name matches' : 'Website found'}
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#0B1E3F]/10 text-[#0B1E3F]/70">
                <AlertTriangle className="w-3.5 h-3.5" /> No website found
              </span>
            )}
          </div>
          {r.webPresence.found ? (
            <>
              <div className="grid md:grid-cols-2 gap-3 mb-4">
                <div className="p-4 bg-[#0B1E3F]/5 rounded-xl">
                  <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55 mb-1">Website</div>
                  <a href={r.webPresence.url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-[#0B1E3F] hover:underline break-all">{r.webPresence.domain}</a>
                  {r.webPresence.title && <div className="text-xs text-[#0B1E3F]/60 mt-1 truncate">{r.webPresence.title}</div>}
                </div>
                <div className="p-4 bg-[#0B1E3F]/5 rounded-xl">
                  <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55 mb-1">Domain age</div>
                  <div className={`text-sm font-semibold ${r.webPresence.domainAgeDays != null && r.webPresence.domainAgeDays < 90 ? 'text-[#DC2626]' : 'text-[#0B1E3F]'}`}>
                    {r.webPresence.domainAgeDays != null
                      ? r.webPresence.domainAgeDays < 365
                        ? `${r.webPresence.domainAgeDays} days`
                        : `${(r.webPresence.domainAgeDays / 365).toFixed(1)} years`
                      : '—'}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {r.webPresence.hasMx != null && (
                  <span className={`px-2.5 py-1 rounded-full text-[11px] mono ${r.webPresence.hasMx ? 'bg-[#16A34A]/10 text-[#16A34A]' : 'bg-[#F59E0B]/10 text-[#F59E0B]'}`}>
                    {r.webPresence.hasMx ? 'MX configured' : 'No MX'}
                  </span>
                )}
                {r.webPresence.hasSpf != null && (
                  <span className={`px-2.5 py-1 rounded-full text-[11px] mono ${r.webPresence.hasSpf ? 'bg-[#16A34A]/10 text-[#16A34A]' : 'bg-[#0B1E3F]/5 text-[#0B1E3F]/60'}`}>
                    {r.webPresence.hasSpf ? 'SPF set' : 'No SPF'}
                  </span>
                )}
                {r.webPresence.nameMatch && (
                  <span className="px-2.5 py-1 bg-[#16A34A]/10 text-[#16A34A] rounded-full text-[11px] mono">Name matches domain</span>
                )}
              </div>
              {Array.isArray(r.webPresence.socials) && r.webPresence.socials.length > 0 && (
                <div className="mt-4">
                  <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55 mb-2">Social media found on website</div>
                  <div className="flex flex-wrap gap-2">
                    {r.webPresence.socials.map((s: any) => <SocialPill key={s.platform} platform={s.platform} url={s.url} />)}
                  </div>
                </div>
              )}
              {r.webPresence.snippet && (
                <div className="mt-4 p-4 bg-[#0B1E3F]/[0.03] rounded-lg text-sm text-[#0B1E3F]/75 italic leading-relaxed">&ldquo;{cleanSearchSnippet(r.webPresence.snippet)}&rdquo;</div>
              )}
            </>
          ) : (
            <div className="text-sm text-[#0B1E3F]/60">
              No public website found via Google search. Many small carriers operate without one — not conclusive on its own, but worth noting.
              {r.webPresence.error && <div className="text-xs mono text-[#F59E0B] mt-2">{r.webPresence.error}</div>}
            </div>
          )}
        </div>
      )}
      {r.addressCheck?.configured && (
        <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-8 card-shadow text-[#0B1E3F]">
          <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
            <div>
              <h2 className="text-xl font-semibold text-[#0B1E3F]">Address verification</h2>
              <div className="text-sm text-[#0B1E3F]/60 mt-1">Cross-checked the FMCSA address against Google Places.</div>
            </div>
            {r.addressCheck.found ? (
              r.addressCheck.isMailbox ? (
                <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#F59E0B]/10 text-[#F59E0B]"><AlertTriangle className="w-3.5 h-3.5" /> Mail-forwarding service</span>
              ) : r.addressCheck.businessStatus === 'CLOSED_PERMANENTLY' ? (
                <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#DC2626]/10 text-[#DC2626]"><XCircle className="w-3.5 h-3.5" /> Permanently closed</span>
              ) : (
                <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#16A34A]/10 text-[#16A34A]"><CheckCircle2 className="w-3.5 h-3.5" /> Verified business</span>
              )
            ) : (
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#0B1E3F]/10 text-[#0B1E3F]/70"><AlertTriangle className="w-3.5 h-3.5" /> Not found in Places</span>
            )}
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="p-4 bg-[#0B1E3F]/5 rounded-xl">
              <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55 mb-1">FMCSA address</div>
              <div className="text-sm font-medium text-[#0B1E3F]">{r.address || '—'}</div>
            </div>
            <div className="p-4 bg-[#0B1E3F]/5 rounded-xl">
              <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55 mb-1">Google Places match</div>
              {r.addressCheck.found ? (
                <>
                  <div className="text-sm font-medium text-[#0B1E3F]">{r.addressCheck.matchedName || '—'}</div>
                  <div className="text-xs text-[#0B1E3F]/60 mt-0.5">{r.addressCheck.matchedAddress || ''}</div>
                </>
              ) : (
                <div className="text-sm text-[#0B1E3F]/60">No matching place</div>
              )}
            </div>
          </div>
          {r.addressCheck.found && (
            <div className="flex flex-wrap gap-2 mt-4">
              {r.addressCheck.businessStatus && (
                <span className={`px-2.5 py-1 rounded-full text-[11px] mono ${r.addressCheck.businessStatus === 'OPERATIONAL' ? 'bg-[#16A34A]/10 text-[#16A34A]' : 'bg-[#F59E0B]/10 text-[#F59E0B]'}`}>{r.addressCheck.businessStatus}</span>
              )}
              {(r.addressCheck.types || []).slice(0, 6).map((t: string) => (
                <span key={t} className="px-2.5 py-1 bg-[#0B1E3F]/5 text-[#0B1E3F]/70 rounded-full text-[11px] mono">{t}</span>
              ))}
            </div>
          )}
        </div>
      )}
      {r.rateCon && (
        <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-8 card-shadow text-[#0B1E3F]">
          <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
            <div>
              <h2 className="text-xl font-semibold text-[#0B1E3F]">Rate con extraction</h2>
              <div className="text-sm text-[#0B1E3F]/60 mt-1">What Claude pulled from the PDF — we verify the broker above.</div>
            </div>
            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap ${r.rateCon.fraud_score >= 61 ? 'bg-[#DC2626]/10 text-[#DC2626]' : r.rateCon.fraud_score >= 31 ? 'bg-[#F59E0B]/10 text-[#F59E0B]' : 'bg-[#16A34A]/10 text-[#16A34A]'}`}>
              AI fraud score · {r.rateCon.fraud_score}/100
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-5 mb-6">
            {/* BROKER — the party to verify */}
            <div className="p-4 bg-[#FF6B35]/5 border border-[#FF6B35]/25 rounded-xl">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10px] mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#FF6B35] text-white">Broker (sender)</span>
                <span className="text-[11px] text-[#0B1E3F]/55">Verified above ↑</span>
              </div>
              <div className="space-y-2">
                {[
                  { label: 'Name', val: r.rateCon.broker_name },
                  { label: 'MC', val: r.rateCon.broker_mc ? `MC-${r.rateCon.broker_mc}` : null },
                  { label: 'DOT', val: r.rateCon.broker_dot ? `DOT-${r.rateCon.broker_dot}` : null },
                  { label: 'Email', val: r.rateCon.broker_email },
                  { label: 'Phone', val: r.rateCon.broker_phone },
                  { label: 'Address', val: r.rateCon.broker_address },
                ].filter((i) => i.val).map((i, idx) => (
                  <div key={idx} className="flex items-start justify-between gap-3 text-sm">
                    <div className="text-[#0B1E3F]/55 text-xs mono uppercase tracking-wider mt-0.5">{i.label}</div>
                    <div className="font-semibold text-[#0B1E3F] text-right truncate">{i.val}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* CARRIER — the user themselves */}
            <div className="p-4 bg-[#0B1E3F]/5 border border-[#0B1E3F]/10 rounded-xl">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10px] mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#0B1E3F] text-white">Carrier (you)</span>
                <span className="text-[11px] text-[#0B1E3F]/55">Rate con addressed to</span>
              </div>
              {(r.rateCon.carrier_name || r.rateCon.carrier_mc || r.rateCon.carrier_dot) ? (
                <div className="space-y-2">
                  {[
                    { label: 'Name', val: r.rateCon.carrier_name },
                    { label: 'MC', val: r.rateCon.carrier_mc ? `MC-${String(r.rateCon.carrier_mc).replace(/[^0-9]/g,'')}` : null },
                    { label: 'DOT', val: r.rateCon.carrier_dot ? `DOT-${String(r.rateCon.carrier_dot).replace(/[^0-9]/g,'')}` : null },
                  ].filter((i) => i.val).map((i, idx) => (
                    <div key={idx} className="flex items-start justify-between gap-3 text-sm">
                      <div className="text-[#0B1E3F]/55 text-xs mono uppercase tracking-wider mt-0.5">{i.label}</div>
                      <div className="font-semibold text-[#0B1E3F] text-right truncate">{i.val}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-[#0B1E3F]/55">No carrier details visible on this rate con.</div>
              )}
            </div>
          </div>

          <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55 mb-2">Load details</div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
            {[
              { label: 'Load ID', val: r.rateCon.load_id },
              { label: 'Rate', val: r.rateCon.rate_amount != null ? `$${Number(r.rateCon.rate_amount).toLocaleString()}` : null },
              { label: 'Origin', val: r.rateCon.origin },
              { label: 'Destination', val: r.rateCon.destination },
              { label: 'Pickup', val: r.rateCon.pickup_date },
              { label: 'Delivery', val: r.rateCon.delivery_date },
              { label: 'Equipment', val: r.rateCon.equipment },
              { label: 'Commodity', val: r.rateCon.commodity },
              { label: 'Weight', val: r.rateCon.weight },
            ].filter((i) => i.val).map((i, idx) => (
              <div key={idx} className="p-3 bg-[#0B1E3F]/5 rounded-lg">
                <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">{i.label}</div>
                <div className="text-sm font-semibold text-[#0B1E3F] mt-0.5 truncate">{i.val}</div>
              </div>
            ))}
          </div>
          {r.rateCon.notes && (
            <div className="mb-3 p-4 bg-[#0B1E3F]/5 rounded-lg text-sm text-[#0B1E3F]/80 leading-relaxed">
              <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55 mb-1">AI notes</div>
              {r.rateCon.notes}
            </div>
          )}
          {Array.isArray(r.rateCon.fraud_reasons) && r.rateCon.fraud_reasons.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {r.rateCon.fraud_reasons.map((reason: string, i: number) => (
                <span key={i} className="px-2.5 py-1 bg-[#DC2626]/10 text-[#DC2626] rounded-full text-xs mono">{reason}</span>
              ))}
            </div>
          )}
        </div>
      )}
      {r.domain && (
        <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-8 card-shadow text-[#0B1E3F]">
          <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
            <div>
              <h2 className="text-xl font-semibold text-[#0B1E3F]">Email domain check</h2>
              {r.queriedEmail && (
                <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/55 mt-1">
                  You searched with <span className="text-[#0B1E3F] normal-case">{r.queriedEmail}</span>
                </div>
              )}
              <div className="text-sm mono text-[#0B1E3F]/60 mt-1">{r.domain.domain}{r.domain.whois?.registrar ? ` · ${r.domain.whois.registrar}` : ''}</div>
            </div>
            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap ${r.domain.verdict === 'high' ? 'bg-[#DC2626]/10 text-[#DC2626]' : r.domain.verdict === 'medium' ? 'bg-[#F59E0B]/10 text-[#F59E0B]' : r.domain.verdict === 'low' ? 'bg-[#16A34A]/10 text-[#16A34A]' : 'bg-[#0B1E3F]/10 text-[#0B1E3F]'}`}>
              {r.domain.verdict === 'high' ? 'HIGH RISK' : r.domain.verdict === 'medium' ? 'CAUTION' : r.domain.verdict === 'low' ? 'LOW RISK' : 'UNKNOWN'} · {r.domain.score}/100
            </div>
          </div>
          {(() => {
            // Email-domain-matches-website check: when the user supplied
            // an email and that email's domain is the same as the
            // carrier's FMCSA-listed website, that's a *positive* signal
            // worth surfacing loudly. Most spoofed rate-cons fail this.
            const queriedDomain = (r.queriedEmail || '').toLowerCase().split('@').pop()?.replace(/^www\./, '') || '';
            const carrierDomain = (r.webPresence?.domain || '').toLowerCase().replace(/^www\./, '');
            const exactMatch = queriedDomain && carrierDomain && queriedDomain === carrierDomain;
            if (exactMatch) {
              return (
                <div className="p-4 mb-5 bg-[#16A34A]/5 border border-[#16A34A]/25 rounded-xl flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#16A34A]/15 flex items-center justify-center flex-shrink-0">
                    <CheckCircle2 className="w-4 h-4 text-[#16A34A]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-[#0B1E3F]">Email matches the carrier&rsquo;s FMCSA-listed website</div>
                    <div className="text-xs text-[#0B1E3F]/65 mt-0.5">
                      <span className="mono">{r.queriedEmail}</span> uses <span className="mono">{queriedDomain}</span>, the same domain as the carrier&rsquo;s real website. Strong legitimacy signal — spoofed rate-cons usually use a near-but-different domain.
                    </div>
                  </div>
                </div>
              );
            }
            return null;
          })()}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            <div className="p-4 bg-[#0B1E3F]/5 rounded-xl">
              <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-1">Domain age</div>
              <div className="text-lg font-semibold text-[#0B1E3F]">{r.domain.whois?.ageDays != null ? (r.domain.whois.ageDays < 365 ? `${r.domain.whois.ageDays} days` : `${(r.domain.whois.ageDays / 365).toFixed(1)} years`) : '—'}</div>
              {r.domain.whois?.creationDate && <div className="text-xs text-[#0B1E3F]/50 mt-1">Registered {new Date(r.domain.whois.creationDate).toLocaleDateString()}</div>}
            </div>
            <div className="p-4 bg-[#0B1E3F]/5 rounded-xl">
              <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-1">Registrar</div>
              <div className="text-sm font-semibold text-[#0B1E3F] truncate" title={r.domain.whois?.registrar || ''}>{r.domain.whois?.registrar || '—'}</div>
              <div className="text-xs text-[#0B1E3F]/50 mt-1">Where the domain is registered</div>
            </div>
            <div className="p-4 bg-[#0B1E3F]/5 rounded-xl">
              <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-1">Email provider</div>
              <div className={`text-sm font-semibold truncate ${r.domain.mx?.hasMx ? 'text-[#0B1E3F]' : 'text-[#DC2626]'}`} title={r.domain.mx?.provider || (r.domain.mx?.records?.[0] ?? '')}>
                {r.domain.mx?.hasMx
                  ? (r.domain.mx.provider || 'Custom / unknown')
                  : 'No email server'}
              </div>
              <div className="text-xs text-[#0B1E3F]/50 mt-1">
                {r.domain.mx?.hasMx
                  ? `${r.domain.mx.records?.length || 0} MX record${(r.domain.mx.records?.length || 0) === 1 ? '' : 's'}${r.domain.mx.provider ? '' : ' (no known provider match)'}`
                  : 'Cannot receive email — strong fraud signal'}
              </div>
            </div>
            <div className="p-4 bg-[#0B1E3F]/5 rounded-xl">
              <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-1">SPF record</div>
              <div className={`text-lg font-semibold ${r.domain.spf?.hasSpf ? 'text-[#16A34A]' : 'text-[#0B1E3F]/60'}`}>{r.domain.spf?.hasSpf ? 'Configured' : 'Not set'}</div>
              <div className="text-xs text-[#0B1E3F]/50 mt-1">{r.domain.spf?.hasSpf ? 'Anti-spoofing policy in place' : 'No sender policy'}</div>
            </div>
            <div className="p-4 bg-[#0B1E3F]/5 rounded-xl">
              <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-1">DMARC policy</div>
              {r.domain.dmarc?.hasDmarc ? (
                <>
                  <div className={`text-lg font-semibold ${r.domain.dmarc.policy === 'reject' || r.domain.dmarc.policy === 'quarantine' ? 'text-[#16A34A]' : 'text-[#F59E0B]'}`}>
                    p={r.domain.dmarc.policy || 'unknown'}
                  </div>
                  <div className="text-xs text-[#0B1E3F]/50 mt-1">
                    {r.domain.dmarc.policy === 'reject' ? 'Strong — receivers reject spoofed mail'
                      : r.domain.dmarc.policy === 'quarantine' ? 'Medium — receivers spam-bin spoofed mail'
                      : r.domain.dmarc.policy === 'none' ? 'Weak — monitor-only, doesn\'t block spoofs'
                      : 'Published, policy unknown'}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-lg font-semibold text-[#0B1E3F]/60">Not published</div>
                  <div className="text-xs text-[#0B1E3F]/50 mt-1">Receivers can&rsquo;t verify spoofed mail from this domain</div>
                </>
              )}
            </div>
            <div className="p-4 bg-[#0B1E3F]/5 rounded-xl">
              <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-1">Disposable provider</div>
              <div className={`text-lg font-semibold ${r.domain.disposable ? 'text-[#DC2626]' : 'text-[#16A34A]'}`}>{r.domain.disposable ? 'Yes' : 'No'}</div>
              <div className="text-xs text-[#0B1E3F]/50 mt-1">{r.domain.disposable ? 'Throwaway email — major fraud signal' : 'Not on the public throwaway list'}</div>
            </div>
          </div>
          {r.domain.disposable && (
            <div className="p-4 rounded-xl mb-6 bg-[#DC2626]/10 border border-[#DC2626]/30">
              <div className="text-xs mono uppercase tracking-wider mb-1 text-[#DC2626]">Disposable email service</div>
              <div className="text-sm font-medium text-[#0B1E3F]">This domain is on the public throwaway-email blocklist. No legitimate broker uses one.</div>
            </div>
          )}
          {(r.domain.flags || []).length > 0 && (
            <div className="space-y-3">{(r.domain.flags || []).map((f: any, i: number) => <FlagRow key={i} {...f} />)}</div>
          )}
        </div>
      )}
      {((r.linkedEntities && r.linkedEntities.length > 0) || (r.chameleonLinks && r.chameleonLinks.length > 0)) && (
        <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-8 card-shadow text-[#0B1E3F]">
          <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
            <div>
              <h2 className="text-xl font-semibold text-[#0B1E3F]">Cross-references & shared identifiers</h2>
              <div className="text-sm text-[#0B1E3F]/60 mt-1">Aliases, sister-entities, and shared phone/address links — auto-detected from FMCSA and trusted-source web coverage.</div>
            </div>
            <span className="px-3 py-1.5 bg-[#FF6B35]/10 text-[#FF6B35] rounded-full text-xs mono uppercase tracking-wider font-semibold">
              {(r.linkedEntities?.length || 0) + (r.chameleonLinks?.length || 0)} links
            </span>
          </div>

          {r.chameleonLinks && r.chameleonLinks.length > 0 && (
            <div className="mb-6">
              <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/55 mb-3">Other FMCSA records sharing this phone or address</div>
              <div className="space-y-2">
                {r.chameleonLinks.map((link: any, i: number) => (
                  <div key={i} className="flex items-start gap-3 p-3 bg-[#DC2626]/5 border border-[#DC2626]/20 rounded-xl">
                    <div className="w-8 h-8 rounded-lg bg-[#DC2626]/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <AlertTriangle className="w-4 h-4 text-[#DC2626]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="px-2 py-0.5 bg-[#DC2626]/15 text-[#DC2626] rounded-full text-[10px] mono uppercase tracking-wider font-semibold">{link.matchedOn} match</span>
                        <span className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/50">{link.source === 'fmcsa-flag' ? 'FMCSA enforcement' : link.source === 'our-lookup' ? 'Prior Haulock high-risk scan' : 'Community fraud report'}</span>
                      </div>
                      <div className="text-sm font-semibold text-[#0B1E3F]">{link.name}</div>
                      <div className="text-[11px] mono text-[#0B1E3F]/55 mt-0.5">
                        {[link.mc && `MC-${link.mc}`, link.dot && `DOT-${link.dot}`].filter(Boolean).join(' · ') || 'No ID'}
                      </div>
                      <div className="text-xs text-[#0B1E3F]/65 mt-1">{link.reason}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {r.linkedEntities && r.linkedEntities.length > 0 && (
            <div>
              <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/55 mb-3">Aliases & sister-entities (from web coverage)</div>
              <div className="grid sm:grid-cols-2 gap-2">
                {r.linkedEntities.map((entity: any, i: number) => {
                  const display = entity.kind === 'mc' ? `MC-${entity.value}` : entity.kind === 'dot' ? `DOT-${entity.value}` : entity.value;
                  const Icon = entity.kind === 'company' ? Building2 : Shield;
                  // Open a confirm modal before running the new scan. The
                  // user is paying with both attention (we're about to
                  // leave the current report) and quota (Free plan deducts
                  // 1 of 3 monthly lookups).
                  const runScan = async () => {
                    const q = entity.kind === 'mc' ? `MC-${entity.value}` : entity.kind === 'dot' ? `DOT-${entity.value}` : entity.value;
                    try {
                      const resp = await fetch(`/api/verify?q=${encodeURIComponent(q)}`);
                      const data = await resp.json();
                      if (resp.ok) navigate('report', data);
                    } catch { /* swallow — modal already showed user we tried */ }
                  };
                  const onClick = () => {
                    setConfirm({
                      opts: {
                        title: `Run a full Haulock scan on ${display}?`,
                        body: (
                          <>
                            We&rsquo;ll run a fresh FMCSA lookup and replace the current report on your screen with the new one. The current report stays in your <strong>History</strong> so you can come back to it any time.
                            <br /><br />
                            <strong>Quota:</strong> uses 1 of your 3 monthly lookups on the Free plan. Carrier / Team / Fleet plans are unlimited.
                          </>
                        ),
                        confirmLabel: 'Run scan',
                        cancelLabel: 'Stay on this report',
                        danger: false,
                        icon: ScanLine,
                      },
                      run: runScan,
                    });
                  };
                  return (
                    <button key={i} onClick={onClick} className="flex items-start gap-3 p-3 bg-[#FF6B35]/5 border border-[#FF6B35]/20 rounded-xl hover:bg-[#FF6B35]/10 hover:border-[#FF6B35]/40 transition text-left">
                      <div className="w-8 h-8 rounded-lg bg-[#FF6B35]/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Icon className="w-4 h-4 text-[#FF6B35]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="px-1.5 py-0.5 bg-[#FF6B35]/15 text-[#FF6B35] rounded text-[9px] mono uppercase tracking-wider font-semibold">{entity.kind}</span>
                          <span className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/50">{entity.citations}× cited · {entity.sources.length} source{entity.sources.length === 1 ? '' : 's'}</span>
                        </div>
                        <div className="text-sm font-semibold text-[#0B1E3F] truncate">{display}</div>
                        <div className="text-[11px] text-[#0B1E3F]/55 mt-0.5 truncate">{entity.sources.slice(0, 3).join(' · ')}</div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-[#0B1E3F]/30 flex-shrink-0 mt-2" />
                    </button>
                  );
                })}
              </div>
              <div className="mt-4 text-xs text-[#0B1E3F]/55 italic">
                Click an alias to run a full Haulock scan on it. Coverage that mentions one entity in this network usually mentions all of them.
              </div>
            </div>
          )}
        </div>
      )}
      {r.sms?.fetched && <FmcsaSmsPanel sms={r.sms} dot={r.dot} carrier={r} />}
      {r.legacyReference && (r.legacyReference.rating || (r.legacyReference.emailMatches?.length ?? 0) > 0) && (
        <FmcsaArchivePanel data={r.legacyReference} navigate={navigate} />
      )}
      {(r.dot || r.mc) && <CarrierHistoryPanel dot={r.dot} mc={r.mc} />}
      <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-8 card-shadow text-[#0B1E3F]">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-[#0B1E3F]">Red flags detected</h2>
          <div className="text-sm mono text-[#0B1E3F]/50">{(r.flags?.length || 0)} flags</div>
        </div>
        <div className="space-y-3">
          {(r.flags || []).map((flag: any, i: number) => <FlagRow key={i} {...flag} />)}
          {(!r.flags || r.flags.length === 0) && (
            <div className="py-12 text-center text-[#0B1E3F]/60">
              <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-[#16A34A]" />
              No red flags detected for this broker.
            </div>
          )}
        </div>
      </div>
      {(r.mc || r.dot) && (
        <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-8 card-shadow text-[#0B1E3F]">
          <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
            <h2 className="text-xl font-semibold text-[#0B1E3F]">Community fraud reports</h2>
            <div className="text-sm mono text-[#0B1E3F]/50">{communityReports.length} report{communityReports.length === 1 ? '' : 's'}</div>
          </div>
          {communityReports.length === 0 ? (
            <div className="py-8 text-center text-[#0B1E3F]/60">
              <Flag className="w-10 h-10 mx-auto mb-3 text-[#0B1E3F]/30" />
              <div className="text-sm">No carriers have reported fraud for this broker.</div>
              <button onClick={() => setReportOpen(true)} className="mt-4 text-sm text-[#DC2626] hover:underline">Be the first to report fraud →</button>
            </div>
          ) : (
            <div className="space-y-3">
              {communityReports.map((cr: any) => <CommunityReportRow key={cr.id} cr={cr} onChanged={() => { invalidateCache(reportsKey!); reportsRes.refetch(); }} />)}
            </div>
          )}
        </div>
      )}
    </div>
    {reportOpen && <ReportFraudModal broker={r} onClose={() => setReportOpen(false)} onSaved={() => { setReportOpen(false); if (reportsKey) invalidateCache(reportsKey); invalidateCache('fraud-reports:50'); reportsRes.refetch(); }} />}
    {watchOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0B1E3F]/40 backdrop-blur-sm" onClick={() => watching !== 'saving' && setWatchOpen(false)}>
        <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 max-w-md w-full p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-[#0B1E3F]/5 flex items-center justify-center flex-shrink-0">
              <Eye className="w-5 h-5 text-[#0B1E3F]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-base font-semibold text-[#0B1E3F]">Watch this {entityBadge(r).label.toLowerCase().includes('broker') ? 'broker' : 'carrier'}?</div>
              <div className="text-xs text-[#0B1E3F]/60 mt-0.5">We&rsquo;ll alert you if anything changes — authority status, insurance, OOS, or new fraud reports.</div>
            </div>
            <button onClick={() => watching !== 'saving' && setWatchOpen(false)} className="text-[#0B1E3F]/40 hover:text-[#0B1E3F] -mt-1 -mr-1 p-1" aria-label="Close">
              <XCircle className="w-5 h-5" />
            </button>
          </div>

          <div className="rounded-xl bg-[#F5F3EE] border border-[#0B1E3F]/10 p-4 mb-4">
            <div className="text-sm font-semibold text-[#0B1E3F]">{r.name}</div>
            <div className="text-xs mono text-[#0B1E3F]/55 mt-0.5">{[r.mc && `MC-${r.mc}`, r.dot && `DOT-${r.dot}`].filter(Boolean).join(' · ') || 'No ID'}</div>
            {r.address && <div className="text-xs text-[#0B1E3F]/55 mt-1">{r.address}</div>}
          </div>

          <div className="text-xs text-[#0B1E3F]/65 leading-relaxed mb-5">
            This entry will appear on your <button onClick={() => { setWatchOpen(false); navigate('watchlist'); }} className="font-semibold text-[#0B1E3F] underline hover:no-underline">Watchlist page</button>. You can remove it any time.
          </div>

          {watching === 'error' && <div className="mb-3 text-sm text-[#DC2626]">Couldn&rsquo;t save — try again.</div>}

          <div className="flex gap-2">
            <button onClick={() => watching !== 'saving' && setWatchOpen(false)} disabled={watching === 'saving'} className="flex-1 px-4 py-2.5 border border-[#0B1E3F]/15 bg-white rounded-full text-sm font-medium text-[#0B1E3F] hover:bg-[#0B1E3F]/5 transition disabled:opacity-50">Cancel</button>
            <button onClick={confirmWatch} disabled={watching === 'saving' || watching === 'saved'} className={`flex-1 px-4 py-2.5 rounded-full text-sm font-medium transition flex items-center justify-center gap-2 disabled:opacity-60 ${watching === 'saved' ? 'bg-[#16A34A] text-white' : 'bg-[#0B1E3F] text-white hover:bg-[#0B1E3F]/90'}`}>
              {watching === 'saving' ? <><div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving…</>
                : watching === 'saved' ? <><CheckCircle2 className="w-4 h-4" /> Added to watchlist</>
                : <><Eye className="w-4 h-4" /> Confirm watch</>}
            </button>
          </div>
        </div>
      </div>
    )}
    {emailOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0B1E3F]/40 backdrop-blur-sm" onClick={() => !emailSending && setEmailOpen(false)}>
        <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 max-w-md w-full p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-[#0B1E3F]/5 flex items-center justify-center flex-shrink-0">
              <Mail className="w-5 h-5 text-[#0B1E3F]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-base font-semibold text-[#0B1E3F]">Email this report</div>
              <div className="text-xs text-[#0B1E3F]/60 mt-0.5">Branded PDF attached · sent from haulock.com</div>
            </div>
            <button onClick={() => !emailSending && setEmailOpen(false)} className="text-[#0B1E3F]/40 hover:text-[#0B1E3F] -mt-1 -mr-1 p-1" aria-label="Close">
              <XCircle className="w-5 h-5" />
            </button>
          </div>

          <label className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 block mb-2">Send to</label>
          <input
            value={emailTo}
            onChange={(e) => setEmailTo(e.target.value)}
            placeholder="dispatch@yourcompany.com, ops@partner.com"
            disabled={emailSending}
            autoFocus
            className="w-full px-4 py-3 bg-[#F5F3EE] border border-[#0B1E3F]/15 rounded-xl text-sm focus:outline-none focus:border-[#0B1E3F] transition text-[#0B1E3F] placeholder:text-[#0B1E3F]/30"
          />
          <div className="text-[11px] text-[#0B1E3F]/50 mt-1">Multiple recipients OK — comma or space separated. Up to 10.</div>

          <label className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 block mb-2 mt-4">Note <span className="normal-case text-[#0B1E3F]/40 tracking-normal">(optional)</span></label>
          <textarea
            value={emailMessage}
            onChange={(e) => setEmailMessage(e.target.value.slice(0, 1000))}
            placeholder="Quick note to the recipient — context, what to look at, etc."
            disabled={emailSending}
            rows={3}
            className="w-full px-4 py-3 bg-[#F5F3EE] border border-[#0B1E3F]/15 rounded-xl text-sm focus:outline-none focus:border-[#0B1E3F] transition text-[#0B1E3F] placeholder:text-[#0B1E3F]/30 resize-none"
          />

          {emailError && <div className="mt-3 text-sm text-[#DC2626]">{emailError}</div>}
          {emailSent && <div className="mt-3 text-sm text-[#16A34A] flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> Sent. Closing…</div>}

          <div className="flex gap-2 mt-5">
            <button onClick={() => !emailSending && setEmailOpen(false)} disabled={emailSending} className="flex-1 px-4 py-2.5 border border-[#0B1E3F]/15 bg-white rounded-full text-sm font-medium text-[#0B1E3F] hover:bg-[#0B1E3F]/5 transition disabled:opacity-50">Cancel</button>
            <button onClick={sendEmailReport} disabled={emailSending || emailSent || !emailTo.trim()} className="flex-1 px-4 py-2.5 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90 transition flex items-center justify-center gap-2 disabled:opacity-60">
              {emailSending ? <><div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Sending…</>
                : emailSent ? <><CheckCircle2 className="w-4 h-4" /> Sent</>
                : <><Mail className="w-4 h-4" /> Send report</>}
            </button>
          </div>
        </div>
      </div>
    )}
    <ConfirmModal
      open={confirm != null}
      opts={confirm?.opts ?? null}
      busy={confirm?.busy}
      onCancel={() => setConfirm(null)}
      onConfirm={handleConfirm}
    />
    </>
  );
}

// FMCSA Safety Measurement System (SMS) panel — renders the BASIC scores,
// inspection breakdown, and crash detail we pulled from FMCSA SMS. The
// data is FMCSA's own; we cite the source clearly and link the canonical
// SMS Overview page so the user can verify directly.
function FmcsaSmsPanel({ sms, dot, carrier }: { sms: any; dot?: string; carrier?: any }) {
  const BASIC_LABELS: Record<string, string> = {
    unsafeDriving: 'Unsafe Driving',
    hoursOfService: 'Hours-of-Service Compliance',
    driverFitness: 'Driver Fitness',
    controlledSubstances: 'Controlled Substances / Alcohol',
    vehicleMaintenance: 'Vehicle Maintenance',
    hazmat: 'Hazardous Materials Compliance',
    crashIndicator: 'Crash Indicator',
  };
  const BASIC_DESC: Record<string, string> = {
    unsafeDriving: 'Speeding, reckless driving, lane changes — driver behavior on the road.',
    hoursOfService: 'Logbook violations · driving past allowed hours · falsifying logs.',
    driverFitness: 'Medical certification · CDL validity · driver-qualification files.',
    controlledSubstances: 'Drug & alcohol testing program compliance.',
    vehicleMaintenance: 'Brake, tire, lighting, and roadside-repair violations.',
    hazmat: 'Hazardous-materials handling, paperwork, and equipment.',
    crashIndicator: 'Crash history pattern relative to the carrier\'s exposure (miles + fleet).',
  };
  const order: Array<keyof typeof BASIC_LABELS> = [
    'unsafeDriving', 'hoursOfService', 'driverFitness', 'controlledSubstances', 'vehicleMaintenance', 'hazmat', 'crashIndicator',
  ];
  // Type mirrors lib/fmcsa-sms.ts SmsBasic (with the per-BASIC subpage
  // enrichment fields). Kept inline here to avoid adding a server-side
  // import to this client component.
  type BasicShape = {
    measure: number;
    inspections: number;
    alert: boolean;
    percentile?: number;
    acuteCriticalViolations?: number;
    safetyEventGroup?: string;
    subpageFetched?: boolean;
  };
  const basics = (sms?.basics || {}) as Record<string, BasicShape | undefined>;
  const inspections = sms?.inspections || null;
  const crashes = sms?.crashes || null;
  const overview = sms?.carrier || {};
  const smsUrl = dot ? `https://ai.fmcsa.dot.gov/SMS/Carrier/${dot}/Overview.aspx` : null;
  const alertedCount = order.filter((k) => basics[k]?.alert).length;
  // Count BASICs that have anything meaningful to display — measure, percentile,
  // acute/critical investigation findings, or inspection counts. The subpage
  // enrichment populates percentile / acute counts even when the Overview
  // row hid the measure.
  const basicsWithData = order.filter((k) => {
    const b = basics[k];
    if (!b) return false;
    return (b.measure != null && b.measure > 0)
      || b.percentile != null
      || b.acuteCriticalViolations != null
      || (b.inspections != null && b.inspections > 0);
  }).length;
  // OOS rate computed from raw counts when the parser didn't capture a
  // percentage — we always know what to display as long as we know the
  // counts.
  const vehOosPct = inspections
    ? (inspections.vehicleOosPct != null
        ? inspections.vehicleOosPct
        : (inspections.vehicleInspections > 0 ? Math.round((inspections.vehicleOosCount / inspections.vehicleInspections) * 1000) / 10 : null))
    : null;
  const drvOosPct = inspections
    ? (inspections.driverOosPct != null
        ? inspections.driverOosPct
        : (inspections.driverInspections > 0 ? Math.round((inspections.driverOosCount / inspections.driverInspections) * 1000) / 10 : null))
    : null;
  // Plain-English crash readout. 24 months of zero is rare in any sized
  // fleet; double-digit crashes warrants reading the full SMS page.
  const crashLine = crashes
    ? (crashes.total === 0
        ? 'Zero reported crashes in the last 24 months — exceptional.'
        : crashes.fatal > 0
          ? `${crashes.fatal} fatal crash${crashes.fatal === 1 ? '' : 'es'} on file. Read the full SMS Crashes report before booking.`
          : crashes.total >= 10
            ? `${crashes.total} crashes in 24 months — above-average for most fleet sizes. Worth investigating severity and frequency.`
            : `${crashes.total} crash${crashes.total === 1 ? '' : 'es'} in 24 months — within typical range; check trend.`)
    : null;

  return (
    <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-8 card-shadow text-[#0B1E3F]">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/55 font-semibold">FMCSA Safety Measurement System</span>
            <span className="px-2 py-0.5 bg-[#0B1E3F]/5 text-[#0B1E3F]/65 rounded-full text-[10px] mono uppercase tracking-wider font-semibold">SMS · last 24 months</span>
          </div>
          <h2 className="text-xl font-semibold text-[#0B1E3F]">BASIC scores, inspections & crashes</h2>
          <div className="text-sm text-[#0B1E3F]/60 mt-1">
            Direct from FMCSA SMS — the federal safety scoring system. {smsUrl && <>See the canonical page at <a href={smsUrl} target="_blank" rel="noreferrer" className="underline hover:text-[#0B1E3F]">ai.fmcsa.dot.gov</a>.</>}
          </div>
        </div>
        {alertedCount > 0 ? (
          <span className="px-3 py-1.5 bg-[#DC2626]/10 text-[#DC2626] rounded-full text-xs mono uppercase tracking-wider font-semibold">
            {alertedCount} BASIC alert{alertedCount === 1 ? '' : 's'} active
          </span>
        ) : (
          <span className="px-3 py-1.5 bg-[#16A34A]/10 text-[#16A34A] rounded-full text-xs mono uppercase tracking-wider font-semibold">
            No active alerts
          </span>
        )}
      </div>

      {/* Carrier overview block — fleet, classification, MCS-150 mileage.
          When SMS values differ from the live FMCSA primary values, we
          render the live value as a footnote so the user understands the
          gap (SMS data updates monthly; primary updates daily). */}
      {(overview.totalTrucks != null || overview.totalDrivers != null || overview.cargoHauled || overview.carrierOperation || overview.mcs150Mileage != null) && (() => {
        const trucksDiffer = overview.totalTrucks != null && carrier?.powerUnits != null && overview.totalTrucks !== carrier.powerUnits;
        const driversDiffer = overview.totalDrivers != null && carrier?.drivers != null && overview.totalDrivers !== carrier.drivers;
        const opDiffer = overview.carrierOperation && carrier?.operation && overview.carrierOperation.toLowerCase() !== carrier.operation.toLowerCase();
        const anyDiffer = trucksDiffer || driversDiffer || opDiffer;
        return (
          <>
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
              <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">Carrier overview (FMCSA SMS)</div>
              {anyDiffer && (
                <div className="text-[10px] mono uppercase tracking-wider text-[#F59E0B]">
                  ⚠ SMS lags primary
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-2">
              {overview.totalTrucks != null && (
                <SmsStatCard
                  label="Total trucks"
                  value={String(overview.totalTrucks)}
                  alert={trucksDiffer}
                  footnote={trucksDiffer ? `live: ${carrier.powerUnits}` : undefined}
                />
              )}
              {overview.totalDrivers != null && (
                <SmsStatCard
                  label="Total drivers"
                  value={String(overview.totalDrivers)}
                  alert={driversDiffer}
                  footnote={driversDiffer ? `live: ${carrier.drivers}` : undefined}
                />
              )}
              {overview.carrierOperation && (
                <SmsStatCard
                  label="Operation"
                  value={overview.carrierOperation}
                  footnote={opDiffer ? `live: ${carrier.operation}` : undefined}
                />
              )}
              {overview.cargoHauled && <SmsStatCard label="Cargo hauled" value={overview.cargoHauled} />}
              {overview.mcs150Mileage != null && (
                <SmsStatCard
                  label="MCS-150 mileage"
                  value={overview.mcs150Mileage.toLocaleString()}
                  footnote={overview.mcs150MileageYear ? `${overview.mcs150MileageYear} reporting year` : undefined}
                />
              )}
              {overview.hazmatCarrier != null && (
                <SmsStatCard
                  label="Hazmat carrier"
                  value={overview.hazmatCarrier ? 'Yes' : 'No'}
                  alert={overview.hazmatCarrier}
                />
              )}
            </div>
            {anyDiffer && (
              <div className="mb-6 p-3 bg-[#F59E0B]/5 border border-[#F59E0B]/25 rounded-lg text-[11px] text-[#0B1E3F]/75 leading-relaxed">
                <strong className="text-[#0B1E3F]">Why these numbers differ from the Operations panel above:</strong> FMCSA SMS recomputes its dataset monthly, so it lags real changes by a few weeks. The Operations panel shows the carrier&rsquo;s <strong>current</strong> FMCSA registry values; this section shows what SMS captured during its last monthly refresh. A growing carrier will show a higher live number than SMS does.
              </div>
            )}
            {!anyDiffer && <div className="mb-6" />}
          </>
        );
      })()}

      {/* BASIC scores grid */}
      <div className="flex items-end justify-between gap-3 mb-2 flex-wrap">
        <div className="max-w-3xl">
          <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">BASIC measures</div>
          <div className="text-[11px] text-[#0B1E3F]/65 mt-0.5 leading-relaxed">
            FMCSA scores carriers in 7 safety categories. <strong>Lower is better.</strong> The <strong>percentile</strong> ranks the carrier against peers in their cargo group (0&nbsp;=&nbsp;best, 100&nbsp;=&nbsp;worst). The <strong>measure</strong> is the raw violation rate from inspections.
            <br />
            <span className="inline-flex items-center gap-1 mt-1.5"><span className="inline-block w-2 h-2 rounded-sm bg-[#DC2626]" /> <strong>Red &ldquo;FMCSA Alert&rdquo;</strong> = federal intervention flag, <strong>+30 to risk score</strong>.</span>
            &nbsp;
            <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-[#F59E0B]" /> <strong>Amber &ldquo;Above threshold&rdquo;</strong> = percentile crossed FMCSA&rsquo;s monitoring line, <strong>informational only</strong>.</span>
          </div>
        </div>
        {basicsWithData === 0 && (
          <span className="text-[11px] mono text-[#0B1E3F]/55 italic">Carrier below FMCSA's data-sufficiency threshold for public BASIC display</span>
        )}
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-6">
        {order.map((k) => {
          const b = basics[k];
          // A BASIC has "anything" to show if EITHER the Overview parsed
          // a measure/inspection count, OR the subpage parsed a measure /
          // percentile / acute-critical-violations count.
          const hasContent = b && (
            (b.measure != null && b.measure > 0) ||
            b.percentile != null ||
            b.acuteCriticalViolations != null ||
            (b.inspections != null && b.inspections > 0)
          );
          if (!b || !hasContent) {
            return (
              <div key={k} className="p-3 bg-[#F5F3EE]/40 border border-[#0B1E3F]/8 rounded-xl">
                <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/45 mb-1">{BASIC_LABELS[k]}</div>
                <div className="text-sm font-medium text-[#0B1E3F]/45 mb-0.5">No data</div>
                <div className="text-[10px] text-[#0B1E3F]/40 leading-snug">{BASIC_DESC[k]}</div>
              </div>
            );
          }
          // Two distinct alert states with different consequences:
          //
          //   - `federalAlert` (b.alert === true) — FMCSA put their official
          //     "Alert" symbol on the Overview page. This is the canonical
          //     federal intervention flag. The risk engine adds +30 points
          //     to the carrier's score for every federal alert active.
          //
          //   - `pctOverThreshold` (b.percentile crossed threshold but
          //     Overview did NOT alert) — informational only. Tells the
          //     reader the percentile is at the federal monitoring line,
          //     but does NOT subtract from the risk score.
          //
          // We render them as different colors so a glance distinguishes
          // "scored against" from "informational".
          const federalAlert = b.alert === true;
          const pctOverThreshold =
            !federalAlert &&
            b.percentile != null && (
              (k === 'hazmat' || k === 'driverFitness' || k === 'controlledSubstances')
                ? b.percentile >= 80
                : b.percentile >= 65
            );
          const cardCls = federalAlert
            ? 'bg-[#DC2626]/5 border-[#DC2626]/30'        // red — scored
            : pctOverThreshold
              ? 'bg-[#F59E0B]/5 border-[#F59E0B]/30'     // amber — informational
              : 'bg-[#F5F3EE]/60 border-[#0B1E3F]/8';    // neutral
          const valueCls = federalAlert
            ? 'text-[#DC2626]'
            : pctOverThreshold
              ? 'text-[#F59E0B]'
              : 'text-[#0B1E3F]';
          const isAlert = federalAlert || pctOverThreshold;
          // FMCSA's intervention thresholds vary by BASIC. Surfacing the
          // exact threshold lets the user see how close to the line a
          // percentile is, instead of guessing why we lit something red.
          const threshold =
            (k === 'hazmat' || k === 'driverFitness' || k === 'controlledSubstances') ? 80 : 65;
          // Prefer percentile for the headline value when we have it —
          // it is the headline metric brokers and DOT auditors care about.
          // Fall back to the raw measure otherwise.
          const showPercentile = b.percentile != null;
          const headlineValue = showPercentile
            ? `${b.percentile}%`
            : (b.measure != null && b.measure > 0 ? b.measure.toFixed(2) : '—');
          const headlineLabel = showPercentile ? 'percentile' : 'measure';
          // Plain-English tooltip so a hover on the value tells the carrier
          // what they are looking at without needing to read the panel header.
          const headlineTitle = showPercentile
            ? `FMCSA ranks this carrier at the ${b.percentile}th percentile within their cargo group. Lower is better. The federal intervention threshold for ${BASIC_LABELS[k]} is ${threshold}%.`
            : 'Raw safety measure FMCSA computes from on-road inspections. Lower is better. Percentile rank is hidden because the carrier is below FMCSA\'s data-sufficiency threshold for this BASIC.';
          // Caption explaining the alert. Wording differs by alert type so
          // the reader knows whether this BASIC is scored against the
          // carrier or just a heads-up.
          const alertReason = federalAlert && b.percentile != null
            ? `FMCSA marked this BASIC for federal intervention. ${b.percentile}% percentile is ${b.percentile === threshold ? 'at' : 'above'} the ${threshold}% threshold. Adds +30 to the Haulock risk score.`
            : federalAlert
              ? `FMCSA marked this BASIC for federal intervention. Adds +30 to the Haulock risk score.`
              : pctOverThreshold && b.percentile != null
                ? `${b.percentile}% percentile is ${b.percentile === threshold ? 'at' : 'above'} the ${threshold}% FMCSA monitoring line, but FMCSA has not (yet) escalated this BASIC to a federal alert. Informational only — does not affect the Haulock risk score.`
                : null;
          return (
            <div key={k} className={`p-3 border rounded-xl ${cardCls}`}>
              <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">{BASIC_LABELS[k]}</div>
                {federalAlert && (
                  <span
                    className="px-1.5 py-0.5 rounded bg-[#DC2626] text-white text-[9px] mono uppercase tracking-wider font-semibold cursor-help"
                    title={alertReason || 'FMCSA flagged this BASIC for federal intervention. Adds +30 to the Haulock risk score.'}
                  >
                    FMCSA Alert · +30
                  </span>
                )}
                {pctOverThreshold && (
                  <span
                    className="px-1.5 py-0.5 rounded bg-[#F59E0B] text-white text-[9px] mono uppercase tracking-wider font-semibold cursor-help"
                    title={alertReason || 'Percentile crossed FMCSA threshold but no federal alert yet. Informational only.'}
                  >
                    Above threshold
                  </span>
                )}
              </div>
              <div className="flex items-baseline gap-1.5" title={headlineTitle}>
                <div className={`text-2xl font-semibold ${valueCls}`}>{headlineValue}</div>
                <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/45">{headlineLabel}</div>
              </div>
              {/* Why-it-is-flagged one-liner. Visible (not just a tooltip)
                  so the reader does not need to hover to understand it.
                  Color matches the alert kind: red for scored federal
                  alerts, amber for percentile-over-threshold (informational). */}
              {alertReason && (
                <div className={`text-[11px] mt-1 leading-snug ${federalAlert ? 'text-[#DC2626]' : 'text-[#F59E0B]'}`}>
                  {alertReason}
                </div>
              )}
              {/* Secondary line: when we have a percentile, also show the
                  raw measure underneath if present. Otherwise show the
                  inspection count, but ONLY if we actually have one — the
                  per-BASIC inspection count is not on every subpage so
                  showing "0 inspections" was misleading. */}
              {showPercentile && b.measure != null && b.measure > 0 ? (
                <div className="text-[11px] text-[#0B1E3F]/55 mt-0.5">measure {b.measure.toFixed(2)}</div>
              ) : b.inspections != null && b.inspections > 0 ? (
                <div className="text-[11px] text-[#0B1E3F]/55 mt-0.5">{b.inspections} inspection{b.inspections === 1 ? '' : 's'} fed this score</div>
              ) : null}
              {/* Acute/critical violations are a stronger fraud / safety
                  signal than the percentile because they come from actual
                  investigations, not just on-road inspection patterns. */}
              {b.acuteCriticalViolations != null && (
                <div
                  className={`text-[11px] mt-1 inline-flex items-center gap-1 cursor-help ${b.acuteCriticalViolations > 0 ? 'text-[#DC2626] font-semibold' : 'text-[#16A34A]'}`}
                  title="Acute / critical violations come from FMCSA's on-site compliance investigations (audits of carrier records), not from random roadside inspections. ACUTE = immediate safety threat (e.g., operating without insurance). CRITICAL = pattern of non-compliance (e.g., repeated HOS log falsification). Both require corrective action."
                >
                  {b.acuteCriticalViolations === 0
                    ? <>Clean investigation record · 0 acute/critical findings <span className="text-[#0B1E3F]/30">ⓘ</span></>
                    : <>{b.acuteCriticalViolations} acute/critical investigation finding{b.acuteCriticalViolations === 1 ? '' : 's'} <span className="text-[#0B1E3F]/30">ⓘ</span></>}
                </div>
              )}
              <div className="text-[10px] text-[#0B1E3F]/55 leading-snug mt-1.5">{BASIC_DESC[k]}</div>
            </div>
          );
        })}
      </div>

      {/* Inspections summary — now always shows OOS percentages computed
          from raw counts when the parser didn't capture them, plus a
          one-line interpretation. */}
      {inspections && (
        <>
          <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55 mb-2">Inspections (last 24 months)</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
            <SmsStatCard label="Vehicle inspections" value={String(inspections.vehicleInspections)} />
            <SmsStatCard
              label="Vehicle OOS"
              value={`${inspections.vehicleOosCount}${vehOosPct != null ? ` · ${vehOosPct.toFixed(1)}%` : ''}`}
              alert={vehOosPct != null && inspections.vehicleNationalAvgPct != null && vehOosPct > inspections.vehicleNationalAvgPct}
              footnote={inspections.vehicleNationalAvgPct != null ? `nat avg ${inspections.vehicleNationalAvgPct.toFixed(1)}%` : undefined}
            />
            <SmsStatCard label="Driver inspections" value={String(inspections.driverInspections)} />
            <SmsStatCard
              label="Driver OOS"
              value={`${inspections.driverOosCount}${drvOosPct != null ? ` · ${drvOosPct.toFixed(1)}%` : ''}`}
              alert={drvOosPct != null && inspections.driverNationalAvgPct != null && drvOosPct > inspections.driverNationalAvgPct}
              footnote={inspections.driverNationalAvgPct != null ? `nat avg ${inspections.driverNationalAvgPct.toFixed(1)}%` : undefined}
            />
          </div>
          <div className="text-[11px] text-[#0B1E3F]/55 mb-6 leading-relaxed">
            {inspections.vehicleInspections + inspections.driverInspections === 0
              ? 'No roadside inspections on file in the last 24 months.'
              : (vehOosPct === 0 && drvOosPct === 0)
                ? `${inspections.vehicleInspections + inspections.driverInspections} total inspections, zero out-of-service findings — strong safety performance.`
                : `${inspections.vehicleInspections + inspections.driverInspections} total inspections in 24 months. ${(vehOosPct ?? 0) >= 20 || (drvOosPct ?? 0) >= 5 ? 'OOS rates above national average — investigate before booking.' : 'OOS rates within typical range.'}`}
          </div>
        </>
      )}

      {/* Crashes summary — color-coded with severity, plus interpretation */}
      {crashes && (
        <>
          <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55 mb-2">Crashes (last 24 months)</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
            <SmsStatCard label="Total" value={String(crashes.total)} alert={crashes.total >= 10} />
            <SmsStatCard label="Fatal" value={String(crashes.fatal)} alert={crashes.fatal > 0} />
            <SmsStatCard label="Injury" value={String(crashes.injury)} />
            <SmsStatCard label="Tow-away" value={String(crashes.towaway)} />
          </div>
          {crashLine && (
            <div className={`text-[11px] mb-6 leading-relaxed ${crashes.fatal > 0 || crashes.total >= 10 ? 'text-[#DC2626]' : 'text-[#0B1E3F]/65'}`}>
              {crashLine}
            </div>
          )}
        </>
      )}

      {/* Provenance footer */}
      <div className="mt-2 pt-4 border-t border-[#0B1E3F]/8 text-[11px] text-[#0B1E3F]/55 leading-relaxed">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="px-1.5 py-0.5 rounded bg-[#0B1E3F]/5 mono uppercase tracking-wider text-[10px]">Provenance</span>
          <span>Pulled directly from FMCSA SMS · cached 7 days · refreshed weekly to match SMS update cadence.</span>
        </div>
        {sms?.lastUpdate && <div className="mt-1.5">FMCSA last updated this carrier&rsquo;s SMS record: <strong className="text-[#0B1E3F]">{sms.lastUpdate}</strong></div>}
        {sms?.lastSafetyMeasurementDate && <div className="mt-1">Last safety measurement period: <strong className="text-[#0B1E3F]">{sms.lastSafetyMeasurementDate}</strong></div>}
      </div>
    </div>
  );
}

function SmsStatCard({ label, value, alert, footnote }: { label: string; value: string; alert?: boolean; footnote?: string }) {
  const cls = alert
    ? 'bg-[#DC2626]/5 border-[#DC2626]/30'
    : 'bg-[#F5F3EE]/60 border-[#0B1E3F]/8';
  const valueCls = alert ? 'text-[#DC2626]' : 'text-[#0B1E3F]';
  return (
    <div className={`p-3 border rounded-xl ${cls}`}>
      <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55 mb-1">{label}</div>
      <div className={`text-base font-semibold ${valueCls}`}>{value}</div>
      {footnote && <div className="text-[10px] mono text-[#0B1E3F]/45 mt-0.5">{footnote}</div>}
    </div>
  );
}

// FMCSA archive snapshot panel — renders neutral reference data drawn
// from a historical FMCSA snapshot we have on file (~5 years old). Two
// pieces: the recorded risk rating from that period, and other FMCSA
// records that shared this carrier's email at that time.
//
// LEGAL POSTURE: every piece of copy in this panel is framed as
// "FMCSA archive ~5 years ago" — never as Haulock's verdict. We
// explicitly note that sharing identifiers can be legitimate.
function FmcsaArchivePanel({ data, navigate }: { data: NonNullable<any>; navigate: any }) {
  const ratingTone = (() => {
    const r = (data.rating?.riskOverall || '').toLowerCase();
    if (r.includes('unaccept')) return { fg: '#DC2626', bg: 'bg-[#DC2626]/10', border: 'border-[#DC2626]/30' };
    if (r.includes('moderate')) return { fg: '#F59E0B', bg: 'bg-[#F59E0B]/10', border: 'border-[#F59E0B]/30' };
    if (r.includes('accept'))   return { fg: '#16A34A', bg: 'bg-[#16A34A]/10', border: 'border-[#16A34A]/30' };
    return { fg: '#0B1E3F', bg: 'bg-[#0B1E3F]/5', border: 'border-[#0B1E3F]/15' };
  })();
  const emailMatches: any[] = data.emailMatches || [];

  return (
    <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-8 card-shadow text-[#0B1E3F]">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/55 font-semibold">FMCSA archive</span>
            <span className="px-2 py-0.5 bg-[#0B1E3F]/5 text-[#0B1E3F]/65 rounded-full text-[10px] mono uppercase tracking-wider font-semibold">snapshot · ~5 years ago</span>
          </div>
          <h2 className="text-xl font-semibold text-[#0B1E3F]">Historical reference data</h2>
          <div className="text-sm text-[#0B1E3F]/60 mt-1">
            What FMCSA had on file for this carrier in our archive snapshot from a few years back. Useful for spotting changes; <span className="font-medium">not Haulock's current assessment</span>.
          </div>
        </div>
      </div>

      {data.rating && data.rating.riskOverall && (
        <div className={`p-4 rounded-xl border ${ratingTone.bg} ${ratingTone.border} mb-4`}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/60">Archived risk rating</div>
              <div className="mt-1 text-2xl font-semibold" style={{ color: ratingTone.fg }}>
                {data.rating.riskOverall}
              </div>
              {typeof data.rating.trucksTotal === 'number' && (
                <div className="text-xs text-[#0B1E3F]/65 mt-1">
                  Fleet size at the time: {data.rating.trucksTotal} truck{data.rating.trucksTotal === 1 ? '' : 's'}
                </div>
              )}
            </div>
            <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">~ 5 years ago</div>
          </div>
          <div className="text-[11px] text-[#0B1E3F]/55 mt-3 leading-relaxed">
            Pulled from our FMCSA archive snapshot. Operators and ownership change — compare against the current FMCSA data above before drawing conclusions.
          </div>
        </div>
      )}

      {emailMatches.length > 0 && (
        <div className="mt-2">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 font-semibold">Other FMCSA records using the same email</div>
            <span className="px-2 py-0.5 bg-[#F59E0B]/10 text-[#F59E0B] rounded-full text-[10px] mono uppercase tracking-wider font-semibold">
              {emailMatches.length} {emailMatches.length === 1 ? 'match' : 'matches'}
            </span>
          </div>

          <div className="text-[11px] text-[#0B1E3F]/65 mb-3 italic leading-relaxed">
            In the FMCSA archive snapshot, this email address was also tied to {emailMatches.length} other registered carrier{emailMatches.length === 1 ? '' : 's'}. <span className="font-medium not-italic">This can be legitimate</span> (multi-MC operators, shared dispatch services, accountants registering for clients) — but it's worth a closer look if you see other red flags.
          </div>

          <div className="grid sm:grid-cols-2 gap-2">
            {emailMatches.slice(0, 8).map((m, i) => {
              const idLine = [m.otherCarrier?.mc && `MC-${m.otherCarrier.mc}`, m.otherCarrier?.dot && `DOT-${m.otherCarrier.dot}`].filter(Boolean).join(' · ');
              const onClick = async () => {
                const q = m.otherCarrier?.mc ? `MC-${m.otherCarrier.mc}` : m.otherCarrier?.dot ? `DOT-${m.otherCarrier.dot}` : '';
                if (!q) return;
                try {
                  const res = await fetch(`/api/verify?q=${encodeURIComponent(q)}`);
                  const j = await res.json();
                  if (res.ok) navigate('report', j);
                } catch { /* ignore */ }
              };
              return (
                <button
                  key={i}
                  onClick={onClick}
                  disabled={!m.otherCarrier?.mc && !m.otherCarrier?.dot}
                  className="text-left p-3 bg-[#F5F3EE]/60 hover:bg-[#F59E0B]/5 border border-[#0B1E3F]/8 hover:border-[#F59E0B]/30 rounded-xl transition disabled:cursor-default flex items-start gap-3"
                >
                  <div className="w-8 h-8 rounded-lg bg-[#F59E0B]/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Mail className="w-4 h-4 text-[#F59E0B]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-[#0B1E3F] truncate">{m.otherCarrier?.name || 'Unknown carrier'}</div>
                    <div className="text-[10px] mono text-[#0B1E3F]/55 mt-0.5 truncate">{idLine || 'no id on record'}</div>
                  </div>
                  {(m.otherCarrier?.mc || m.otherCarrier?.dot) && <ArrowRight className="w-4 h-4 text-[#0B1E3F]/30 flex-shrink-0 mt-2" />}
                </button>
              );
            })}
          </div>

          <div className="mt-4 p-3 bg-[#0B1E3F]/[0.03] rounded-lg text-[11px] text-[#0B1E3F]/65 leading-relaxed">
            <strong className="text-[#0B1E3F]">How to use this:</strong> if any of these other carriers are inactive, OOS, or have fraud reports, treat the shared email as a yellow flag — not proof. If they all look clean, this is probably one operator running multiple legitimate MCs.
          </div>
        </div>
      )}
    </div>
  );
}

// Identity history panel — renders the dated change timeline for a carrier
// from our `carrier_snapshots` table. Each entry shows what changed
// (address, phone, authority, etc.) on that date so brokers can see at a
// glance how stable the carrier's identity has been over time.
//
// FIELD-NAME LABELS: keep these readable. The DB stores raw keys like
// `bipdOnFile`; we want to show the user "Liability insurance on file".
const HISTORY_FIELD_LABELS: Record<string, string> = {
  initial: 'First scan recorded',
  name: 'Legal name',
  dba: 'DBA',
  address: 'Physical address',
  phone: 'Phone',
  emailDomain: 'Email domain',
  authorityStatus: 'Operating authority',
  commonAuthority: 'Common authority',
  brokerAuthority: 'Broker authority',
  contractAuthority: 'Contract authority',
  authorityGrantDate: 'Authority granted',
  safetyRating: 'Safety rating',
  outOfService: 'Out-of-service',
  bipdOnFile: 'Liability insurance',
  bondOnFile: 'Surety bond',
  cargoOnFile: 'Cargo insurance',
  cargoRequired: 'Cargo required',
  mcs150Date: 'MCS-150 date',
  mcs150Outdated: 'MCS-150 outdated',
  powerUnits: 'Power units',
  drivers: 'Drivers',
  crashTotal: 'Total crashes',
  fatalCrash: 'Fatal crashes',
};

function fieldLabel(key: string): string {
  return HISTORY_FIELD_LABELS[key] || key;
}

function CarrierHistoryPanel({ dot, mc }: { dot?: string; mc?: string }) {
  const idQs = dot ? `dot=${encodeURIComponent(dot)}` : `mc=${encodeURIComponent(mc!)}`;
  const cacheKey = `carrier-history:${idQs}`;
  const res = useCachedFetch<{ history: any[]; count: number }>(cacheKey, `/api/carrier-history?${idQs}&limit=25`);
  const history = res.data?.history;
  if (!history || history.length === 0) return null; // hide panel until we have data
  return (
    <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-8 card-shadow text-[#0B1E3F]">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-semibold text-[#0B1E3F]">Identity history</h2>
          <div className="text-sm text-[#0B1E3F]/60 mt-1">Address, authority, insurance, and fleet-size changes Haulock has observed for this carrier over time.</div>
        </div>
        <span className="px-3 py-1.5 bg-[#0B1E3F]/5 rounded-full text-xs mono uppercase tracking-wider font-semibold text-[#0B1E3F]/70">
          {history.length} change{history.length === 1 ? '' : 's'} on file
        </span>
      </div>
      <ol className="relative border-l-2 border-[#0B1E3F]/10 pl-6 space-y-5">
        {history.map((row: any, i: number) => {
          const fields: string[] = Array.isArray(row.changed_fields) ? row.changed_fields : [];
          const isInitial = fields.includes('initial');
          const isLatest = i === 0;
          // Relative time labels — never show exact date for legacy /
          // archive snapshots. Soft framing avoids implying we have a
          // precise audit trail when the entry came from a single
          // imported snapshot.
          const ageMs = Date.now() - new Date(row.captured_at).getTime();
          const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
          const ageYears = ageDays / 365;
          const dateLabel =
            row.source === 'partner-2021' || ageYears >= 4 ? 'FMCSA archive · ~5 years ago'
            : ageDays < 1 ? 'Today'
            : ageDays < 7 ? `${ageDays} day${ageDays === 1 ? '' : 's'} ago`
            : ageDays < 60 ? `${Math.round(ageDays / 7)} weeks ago`
            : ageDays < 365 ? `${Math.round(ageDays / 30)} months ago`
            : `${ageYears.toFixed(1)} years ago`;
          return (
            <li key={row.id} className="relative">
              <span className={`absolute -left-[31px] top-1.5 w-3.5 h-3.5 rounded-full border-2 border-white ${isLatest ? 'bg-[#16A34A]' : isInitial ? 'bg-[#0B1E3F]/40' : 'bg-[#FF6B35]'}`} />
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/55">{dateLabel}</span>
                {isLatest && <span className="px-1.5 py-0.5 rounded-full text-[9px] mono uppercase tracking-wider bg-[#16A34A]/10 text-[#16A34A] font-semibold">Latest</span>}
                {isInitial && <span className="px-1.5 py-0.5 rounded-full text-[9px] mono uppercase tracking-wider bg-[#0B1E3F]/5 text-[#0B1E3F]/55 font-semibold">First record</span>}
                {!isInitial && (
                  <span className="text-[10px] text-[#0B1E3F]/45">{fields.length} field{fields.length === 1 ? '' : 's'} changed</span>
                )}
              </div>
              {(() => {
                // Format any value for display — handles null, booleans,
                // and primitives. Returns '—' for empty/missing.
                const fmt = (v: any): string => {
                  if (v == null || v === '') return '—';
                  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
                  return String(v);
                };
                if (isInitial) {
                  // Initial / archive entry — show ALL fields we captured
                  // as a baseline snapshot so the user can SEE the old
                  // address, phone, fleet size, etc. (not just "first
                  // record"). This is the entire point of having
                  // historical data.
                  const baseline = Object.entries(row.data || {})
                    .filter(([k, v]) => v != null && v !== '' && k !== 'fingerprint');
                  if (baseline.length === 0) {
                    return <div className="text-sm text-[#0B1E3F]/65">First snapshot recorded — Haulock will track changes from here forward.</div>;
                  }
                  return (
                    <>
                      <div className="text-[11px] text-[#0B1E3F]/55 mb-2 italic">What FMCSA had on file at the time of this snapshot:</div>
                      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-2">
                        {baseline.map(([k, v]) => (
                          <div key={k} className="p-2.5 bg-[#0B1E3F]/[0.04] rounded-lg">
                            <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55 mb-0.5">{fieldLabel(k)}</div>
                            <div className="text-sm font-semibold text-[#0B1E3F] truncate">{fmt(v)}</div>
                          </div>
                        ))}
                      </div>
                    </>
                  );
                }
                // Change entry — show before → after for each changed
                // field. The "before" is the previous (older) row's value.
                const prevRow = history[i + 1];
                const prevData: any = prevRow?.data || {};
                return (
                  <div className="grid sm:grid-cols-2 gap-x-4 gap-y-2">
                    {fields.map((f) => {
                      const before = prevData[f];
                      const after = row.data?.[f];
                      const beforeS = fmt(before);
                      const afterS  = fmt(after);
                      const changed = beforeS !== afterS;
                      return (
                        <div key={f} className="p-2.5 bg-[#F5F3EE]/60 rounded-lg">
                          <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55 mb-1">{fieldLabel(f)}</div>
                          <div className="flex items-center gap-2 text-sm">
                            <span className={`font-medium truncate ${changed ? 'text-[#0B1E3F]/55 line-through' : 'text-[#0B1E3F]'}`} title={beforeS}>{beforeS}</span>
                            {changed && <ArrowRight className="w-3 h-3 text-[#FF6B35] flex-shrink-0" />}
                            {changed && <span className="font-semibold text-[#0B1E3F] truncate" title={afterS}>{afterS}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </li>
          );
        })}
      </ol>
      <div className="mt-5 text-[11px] text-[#0B1E3F]/50 italic">
        History compounds with every search. The longer Haulock runs, the deeper this timeline goes — for free.
      </div>
    </div>
  );
}

function CommunityReportRow({ cr, onChanged }: any) {
  const [removing, setRemoving] = useState(false);
  const TYPE_LABEL: Record<string, string> = { non_payment: 'Non-payment', double_broker: 'Double brokering', identity_fraud: 'Identity fraud', fake_load: 'Fake load', other: 'Other' };
  const onDelete = async () => {
    if (!confirm('Remove this fraud report?')) return;
    setRemoving(true);
    await fetch(`/api/fraud-reports?id=${encodeURIComponent(cr.id)}`, { method: 'DELETE' }).catch(() => null);
    setRemoving(false);
    onChanged();
  };
  return (
    <div className="p-4 bg-[#0B1E3F]/5 rounded-xl">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="px-2 py-0.5 bg-[#DC2626]/10 text-[#DC2626] rounded-full text-xs font-medium">{TYPE_LABEL[cr.type] || cr.type}</span>
          {cr.amount != null && <span className="text-sm font-semibold mono text-[#DC2626]">${Number(cr.amount).toLocaleString()}</span>}
          <span className="text-xs mono text-[#0B1E3F]/50">{timeAgo(cr.created_at)}{cr.mine ? ' · by you' : ''}</span>
        </div>
        {cr.mine && <button onClick={onDelete} disabled={removing} className="text-xs text-[#0B1E3F]/50 hover:text-[#DC2626] disabled:opacity-50">{removing ? 'Removing…' : 'Remove'}</button>}
      </div>
      {cr.description && <div className="text-sm text-[#0B1E3F]/80 leading-relaxed">{cr.description}</div>}
    </div>
  );
}

function ReportFraudModal({ broker, onClose, onSaved }: any) {
  const [type, setType] = useState('non_payment');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) {
      setError('Please describe what happened — this helps other carriers spot the same scam.');
      return;
    }
    if (description.trim().length < 20) {
      setError('A bit more detail helps — at least 20 characters.');
      return;
    }
    setError(null); setSaving(true);
    try {
      const res = await fetch('/api/fraud-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: broker.name,
          mc: broker.mc || null,
          dot: broker.dot || null,
          type,
          amount: amount.trim() || null,
          description: description.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Failed (${res.status})`);
      track('fraud_report_submitted', {
        type,
        mc: broker.mc || undefined,
        dot: broker.dot || undefined,
        amount: amount.trim() ? Number(amount) : undefined,
      });
      onSaved();
    } catch (err: any) {
      setError(err?.message || 'Failed to submit');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0B1E3F]/50" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 md:p-8 card-shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-1">
          <div>
            <div className="text-xs mono uppercase tracking-wider text-[#DC2626] mb-1">Report fraud</div>
            <h2 className="text-2xl serif italic text-[#0B1E3F]">{broker.name}</h2>
            <div className="text-xs mono text-[#0B1E3F]/50 mt-1">{[broker.mc && `MC-${broker.mc}`, broker.dot && `DOT-${broker.dot}`].filter(Boolean).join(' · ')}</div>
          </div>
          <button onClick={onClose} className="text-[#0B1E3F]/40 hover:text-[#0B1E3F]"><XCircle className="w-5 h-5" /></button>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 mt-6">
          <div>
            <label className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 block mb-2">Type of fraud</label>
            <select value={type} onChange={(e) => setType(e.target.value)} className="w-full px-4 py-3 bg-white border border-[#0B1E3F]/15 rounded-xl text-[#0B1E3F] focus:outline-none focus:border-[#0B1E3F]">
              <option value="non_payment">Non-payment</option>
              <option value="double_broker">Double brokering</option>
              <option value="identity_fraud">Identity fraud / spoofing</option>
              <option value="fake_load">Fake load</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 block mb-2">Loss amount (optional)</label>
            <input type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 4200" className="w-full px-4 py-3 bg-white border border-[#0B1E3F]/15 rounded-xl text-[#0B1E3F] focus:outline-none focus:border-[#0B1E3F] placeholder:text-[#0B1E3F]/30" />
          </div>
          <div>
            <label className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 block mb-2">What happened? <span className="normal-case tracking-normal text-[#DC2626]">required</span></label>
            <textarea required value={description} onChange={(e) => setDescription(e.target.value)} rows={5} minLength={20} maxLength={2000} placeholder="Describe the fraud in your own words — what was promised, what went wrong, any red flags you noticed. Other carriers will see this." className="w-full px-4 py-3 bg-white border border-[#0B1E3F]/15 rounded-xl text-[#0B1E3F] focus:outline-none focus:border-[#0B1E3F] placeholder:text-[#0B1E3F]/30 resize-none" />
            <div className="text-[11px] mono text-[#0B1E3F]/50 mt-1 text-right">{description.length} / 2000</div>
          </div>
          <div className="flex items-start gap-2 p-3 bg-[#DC2626]/5 border border-[#DC2626]/20 rounded-lg text-xs text-[#0B1E3F]/75">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-[#DC2626] flex-shrink-0" />
            <div>This is a public report visible to other Haulock users. Submit only if you have first-hand experience — false reports can be removed and may affect your account.</div>
          </div>
          {error && <div className="text-sm text-[#DC2626]">{error}</div>}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-3 border border-[#0B1E3F]/15 rounded-full font-medium text-[#0B1E3F] hover:bg-[#0B1E3F]/5">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 py-3 bg-[#DC2626] text-white rounded-full font-medium hover:bg-[#DC2626]/90 transition disabled:opacity-60">{saving ? 'Submitting…' : 'Submit fraud report'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DetailPanel({ title, items }: any) {
  return (
    <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-8 card-shadow text-[#0B1E3F]">
      <h2 className="text-xl font-semibold text-[#0B1E3F] mb-5">{title}</h2>
      <div className="space-y-3">
        {items.map((item: any, i: number) => {
          const Icon = item.icon;
          return (
            <div key={i} className="flex items-start gap-3 py-2 border-b border-[#0B1E3F]/5 last:border-0">
              {Icon && <Icon className="w-4 h-4 text-[#0B1E3F]/50 mt-0.5" />}
              <div className="flex-1 min-w-0">
                <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60">{item.label}</div>
                <div className={`text-sm font-medium mt-0.5 ${item.warn ? 'text-[#DC2626]' : item.good ? 'text-[#16A34A]' : 'text-[#0B1E3F]'}`}>{item.val}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FlagRow({ sev, title, desc, pts, details, metrics, recommendation }: any) {
  const [open, setOpen] = useState(false);
  const bgMap: any = { critical: 'rgba(220,38,38,0.08)', warning: 'rgba(245,158,11,0.08)', info: 'rgba(11,30,63,0.05)' };
  const borderMap: any = { critical: 'rgba(220,38,38,0.2)', warning: 'rgba(245,158,11,0.2)', info: 'rgba(11,30,63,0.1)' };
  const iconColor = sev === 'critical' ? '#DC2626' : sev === 'warning' ? '#F59E0B' : 'rgba(11,30,63,0.6)';
  const expandable = Boolean(details || (metrics && metrics.length) || recommendation);
  return (
    <div className="rounded-xl border text-[#0B1E3F] overflow-hidden" style={{ backgroundColor: bgMap[sev], borderColor: borderMap[sev] }}>
      <button
        onClick={() => expandable && setOpen((v) => !v)}
        disabled={!expandable}
        className={`w-full flex items-start gap-4 p-4 text-left ${expandable ? 'hover:bg-black/[0.02] transition cursor-pointer' : 'cursor-default'}`}
      >
        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-1" style={{ color: iconColor }} />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[#0B1E3F] text-sm">{title}</div>
          <div className="text-sm text-[#0B1E3F]/70 mt-1">{desc}</div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="mono text-xs text-[#0B1E3F]/50">+{pts}</span>
          {expandable && <ChevronRight className={`w-4 h-4 text-[#0B1E3F]/40 transition-transform ${open ? 'rotate-90' : ''}`} />}
        </div>
      </button>
      {expandable && open && (
        <div className="px-4 pb-4 pt-0 border-t space-y-4" style={{ borderColor: borderMap[sev] }}>
          {metrics && metrics.length > 0 && (
            <div className="pt-4 grid grid-cols-2 md:grid-cols-3 gap-3">
              {metrics.map((m: any, i: number) => (
                <div key={i} className="bg-white rounded-lg px-3 py-2 border" style={{ borderColor: borderMap[sev] }}>
                  <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">{m.label}</div>
                  <div className="text-sm font-semibold text-[#0B1E3F] mt-0.5">{m.value}</div>
                </div>
              ))}
            </div>
          )}
          {details && (
            <div className={metrics && metrics.length > 0 ? '' : 'pt-4'}>
              <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55 mb-1">What this means</div>
              <div className="text-sm text-[#0B1E3F]/80 leading-relaxed">{details}</div>
            </div>
          )}
          {recommendation && (
            <div>
              <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55 mb-1">Recommended action</div>
              <div className="text-sm text-[#0B1E3F]/80 leading-relaxed">{recommendation}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RiskGauge({ score, size = 'lg' }: any) {
  const clamped = Math.max(0, Math.min(100, score || 0));
  const theta = Math.PI * (clamped / 100);
  const endX = 100 - 80 * Math.cos(theta);
  const endY = 100 - 80 * Math.sin(theta);
  const angle = (clamped / 100) * 180 - 90;
  const color = clamped >= 61 ? '#DC2626' : clamped >= 31 ? '#F59E0B' : '#16A34A';
  const dims = size === 'sm' ? { w: 'w-24', h: 'h-14', text: 'text-3xl' } : size === 'md' ? { w: 'w-36', h: 'h-20', text: 'text-4xl' } : { w: 'w-48', h: 'h-28', text: 'text-5xl' };
  return (
    <div className={`relative ${dims.w} ${dims.h}`}>
      <svg viewBox="0 0 200 120" className="w-full h-full">
        <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#0B1E3F" strokeOpacity="0.1" strokeWidth="14" strokeLinecap="round" />
        {clamped > 0 && (
          <path d={`M 20 100 A 80 80 0 0 1 ${endX.toFixed(3)} ${endY.toFixed(3)}`} fill="none" stroke={color} strokeWidth="14" strokeLinecap="round" />
        )}
        <g transform={`translate(100, 100) rotate(${angle})`}>
          <line x1="0" y1="0" x2="0" y2="-70" stroke="#0B1E3F" strokeWidth="2" strokeLinecap="round" />
          <circle cx="0" cy="0" r="6" fill="#0B1E3F" />
        </g>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-end pb-1">
        <div className={`${dims.text} serif italic leading-none`} style={{ color }}>{clamped}</div>
        {size === 'lg' && <div className="text-xs mono uppercase tracking-widest text-[#0B1E3F]/60 mt-1">/ 100</div>}
      </div>
    </div>
  );
}

function FraudReports({ navigate }: any) {
  const res = useCachedFetch<{ reports: any[] }>('fraud-reports:50', '/api/fraud-reports?limit=50');
  const reports = res.data?.reports ?? null;
  const enforcementRes = useCachedFetch<{ actions: any[]; count: number }>('enforcement-actions:flagged', '/api/enforcement-actions?limit=300');
  const enforcement = enforcementRes.data?.actions ?? null;
  const [enforcementSearch, setEnforcementSearch] = useState('');
  const [enforcementFlagFilter, setEnforcementFlagFilter] = useState<'all' | 'revocation' | 'no_insurance' | 'no_bond'>('all');

  const flagMatchesFilter = (flags: string[], filter: typeof enforcementFlagFilter): boolean => {
    if (filter === 'all') return true;
    const blob = flags.join(' ').toLowerCase();
    if (filter === 'revocation') return blob.includes('revocation');
    if (filter === 'no_insurance') return blob.includes('liability insurance');
    if (filter === 'no_bond') return blob.includes('surety bond');
    return true;
  };

  const enforcementFiltered = (() => {
    if (!enforcement) return null;
    const q = enforcementSearch.trim().toLowerCase();
    return enforcement.filter((a: any) => {
      if (!flagMatchesFilter(a.flags || [], enforcementFlagFilter)) return false;
      if (!q) return true;
      const haystack = [a.name, a.dba, a.mc, a.dot, a.city, a.state, (a.flags || []).join(' ')]
        .filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    });
  })();

  const enforcementCounts = (() => {
    const all = enforcement || [];
    const c = (filter: typeof enforcementFlagFilter) =>
      all.filter((a: any) => flagMatchesFilter(a.flags || [], filter)).length;
    return {
      all: all.length,
      revocation: c('revocation'),
      no_insurance: c('no_insurance'),
      no_bond: c('no_bond'),
    };
  })();
  const [filter, setFilter] = useState<'all' | 'non_payment' | 'double_broker' | 'identity_fraud' | 'fake_load' | 'other'>('all');
  const TYPE_LABEL: Record<string, string> = { non_payment: 'Non-payment', double_broker: 'Double brokering', identity_fraud: 'Identity fraud', fake_load: 'Fake load', other: 'Other' };

  const all = reports || [];
  const shown = filter === 'all' ? all : all.filter((r: any) => r.type === filter);

  const onRescan = async (cr: any) => {
    const q = cr.mc || cr.dot;
    if (!q) return;
    try {
      const res = await fetch(`/api/verify?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Lookup failed`);
      navigate('report', data);
    } catch { navigate('verify'); }
  };

  const onOpenEnforcement = async (a: any) => {
    const q = a.mc || a.dot;
    if (!q) return;
    try {
      const res = await fetch(`/api/verify?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Lookup failed`);
      navigate('report', data);
    } catch { navigate('verify'); }
  };


  const counts = {
    all: all.length,
    non_payment: all.filter((r: any) => r.type === 'non_payment').length,
    double_broker: all.filter((r: any) => r.type === 'double_broker').length,
    identity_fraud: all.filter((r: any) => r.type === 'identity_fraud').length,
    fake_load: all.filter((r: any) => r.type === 'fake_load').length,
    other: all.filter((r: any) => r.type === 'other').length,
  };

  return (
    <div className="space-y-8 text-[#0B1E3F]">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-2">Community fraud feed</div>
          <h1 className="text-4xl serif italic text-[#0B1E3F]">What other carriers are reporting.</h1>
          <p className="text-[#0B1E3F]/60 mt-2 text-sm">Real fraud reports submitted by Haulock carriers. Cross-checks against your lookups in real time.</p>
        </div>
        <button onClick={() => navigate('verify')} className="px-5 py-2.5 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90 transition flex items-center gap-2 w-fit card-shadow"><Search className="w-4 h-4" /> Verify a broker</button>
      </div>

      {/* FMCSA enforcement red flags — carriers currently flagged in FMCSA's
          public registry (pending revocation OR undeliverable mail). The
          dataset doesn't carry an event date, so we surface "currently
          active" rather than "newly added this month". */}
      <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-6 card-shadow">
        <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-xs mono uppercase tracking-wider text-[#FF6B35] font-semibold">FMCSA red flags</span>
              <span className="px-2 py-0.5 bg-[#FF6B35]/10 text-[#FF6B35] rounded-full text-[10px] mono uppercase tracking-wider font-semibold">Currently active</span>
            </div>
            <h2 className="text-xl font-semibold text-[#0B1E3F]">Carriers operating illegally or under revocation</h2>
            <div className="text-xs text-[#0B1E3F]/60 mt-1">Pending authority revocation, active carriers with no liability insurance, or active brokers with no surety bond. Pulled live from FMCSA, refreshed daily.</div>
          </div>
          {enforcement && enforcement.length > 0 && (
            <span className="px-3 py-1.5 bg-[#0B1E3F]/5 rounded-full text-xs font-medium text-[#0B1E3F]/70 mono">
              {enforcementFiltered && enforcementFiltered.length !== enforcement.length
                ? `${enforcementFiltered.length} of ${enforcement.length} flagged`
                : `${enforcement.length} flagged`}
            </span>
          )}
        </div>

        {enforcement && enforcement.length > 0 && (
          <div className="space-y-3 mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#0B1E3F]/40 pointer-events-none" />
              <input
                value={enforcementSearch}
                onChange={(e) => setEnforcementSearch(e.target.value)}
                placeholder="Search by name, MC, DOT, city, or state…"
                className="w-full pl-10 pr-9 py-2.5 bg-[#F5F3EE] border border-[#0B1E3F]/15 rounded-xl text-sm focus:outline-none focus:border-[#0B1E3F] transition text-[#0B1E3F] placeholder:text-[#0B1E3F]/40"
              />
              {enforcementSearch && (
                <button
                  onClick={() => setEnforcementSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[#0B1E3F]/40 hover:text-[#0B1E3F] p-1"
                  aria-label="Clear search"
                >
                  <XCircle className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {([
                { id: 'all', label: `All (${enforcementCounts.all})` },
                { id: 'revocation', label: `Pending revocation (${enforcementCounts.revocation})` },
                { id: 'no_insurance', label: `No liability insurance (${enforcementCounts.no_insurance})` },
                { id: 'no_bond', label: `Broker, no surety bond (${enforcementCounts.no_bond})` },
              ] as const).map((f) => (
                <button
                  key={f.id}
                  onClick={() => setEnforcementFlagFilter(f.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${enforcementFlagFilter === f.id ? 'bg-[#FF6B35] text-white' : 'bg-white border border-[#0B1E3F]/15 text-[#0B1E3F]/75 hover:border-[#0B1E3F]/30'}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {enforcement == null ? (
          <div className="py-8 text-center text-sm text-[#0B1E3F]/50">Loading FMCSA red-flag feed…</div>
        ) : enforcement.length === 0 ? (
          <div className="py-8 text-center text-sm text-[#0B1E3F]/55">
            FMCSA feed unavailable right now. Try again shortly.
          </div>
        ) : enforcementFiltered && enforcementFiltered.length === 0 ? (
          <div className="py-8 text-center text-sm text-[#0B1E3F]/55">
            No matches. Try a different search or clear the flag filter.
          </div>
        ) : (
          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {(enforcementFiltered || []).map((a: any, i: number) => (
              <button
                key={`${a.dot || a.mc || a.name}-${i}`}
                onClick={() => onOpenEnforcement(a)}
                disabled={!a.mc && !a.dot}
                className="w-full text-left p-4 bg-[#F5F3EE]/60 hover:bg-[#FF6B35]/5 border border-transparent hover:border-[#FF6B35]/30 rounded-xl transition flex items-start gap-3 disabled:opacity-60 disabled:cursor-default disabled:hover:bg-[#F5F3EE]/60 disabled:hover:border-transparent"
              >
                <div className="w-9 h-9 rounded-lg bg-[#FF6B35]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <AlertTriangle className="w-4 h-4 text-[#FF6B35]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    {(a.flags || []).map((f: string) => (
                      <span key={f} className="px-2 py-0.5 bg-[#FF6B35]/15 text-[#FF6B35] rounded-full text-[10px] mono uppercase tracking-wider font-semibold">{f}</span>
                    ))}
                    {a.authorityType && <span className="text-[11px] mono text-[#0B1E3F]/45">· {a.authorityType}</span>}
                  </div>
                  <div className="text-sm font-semibold text-[#0B1E3F] truncate">{a.name}</div>
                  <div className="text-[11px] mono text-[#0B1E3F]/55 truncate">
                    {[a.mc && `MC-${a.mc}`, a.dot && `DOT-${a.dot}`, [a.city, a.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
                  </div>
                </div>
                {(a.mc || a.dot) && <ArrowRight className="w-4 h-4 text-[#0B1E3F]/30 flex-shrink-0 mt-2" />}
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-2">Community fraud reports</div>
        <h2 className="text-xl font-semibold text-[#0B1E3F]">Submitted by Haulock carriers</h2>
      </div>
      <div className="flex flex-wrap gap-2">
        {([
          { id: 'all', label: `All (${counts.all})` },
          { id: 'non_payment', label: `Non-payment (${counts.non_payment})` },
          { id: 'double_broker', label: `Double brokering (${counts.double_broker})` },
          { id: 'identity_fraud', label: `Identity fraud (${counts.identity_fraud})` },
          { id: 'fake_load', label: `Fake load (${counts.fake_load})` },
          { id: 'other', label: `Other (${counts.other})` },
        ] as const).map((f) => (
          <button key={f.id} onClick={() => setFilter(f.id)} className={`px-4 py-2 rounded-full text-sm font-medium transition ${filter === f.id ? 'bg-[#0B1E3F] text-white' : 'bg-white border border-[#0B1E3F]/15 text-[#0B1E3F]/80 hover:border-[#0B1E3F]/30'}`}>{f.label}</button>
        ))}
      </div>
      {reports == null ? (
        <div className="py-12 text-center text-sm text-[#0B1E3F]/50">Loading…</div>
      ) : shown.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-16 text-center text-[#0B1E3F]/60 card-shadow">
          <Flag className="w-12 h-12 mx-auto mb-4 text-[#0B1E3F]/30" />
          <div className="text-lg font-medium text-[#0B1E3F] mb-2">{all.length === 0 ? 'No community reports yet' : 'No reports in this category'}</div>
          <div className="text-sm mb-6">{all.length === 0 ? 'Be the first carrier to report a fraudulent broker — open a report and click "Report fraud".' : 'Try a different filter.'}</div>
          <button onClick={() => navigate('verify')} className="px-5 py-2.5 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90">Verify a broker</button>
        </div>
      ) : (
        <div className="space-y-4">
          {shown.map((cr: any) => (
            <div key={cr.id} className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-6 hover:border-[#0B1E3F]/20 transition card-shadow text-[#0B1E3F]">
              <div className="flex flex-col md:flex-row md:items-center gap-4 mb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="px-2 py-0.5 bg-[#DC2626]/10 text-[#DC2626] rounded-full text-xs font-medium">{TYPE_LABEL[cr.type] || cr.type}</span>
                    <span className="text-xs mono text-[#0B1E3F]/50">{timeAgo(cr.created_at)}{cr.mine ? ' · by you' : ''}</span>
                  </div>
                  <div className="text-lg font-semibold text-[#0B1E3F]">{cr.name}</div>
                  <div className="text-xs mono text-[#0B1E3F]/50">{[cr.mc && `MC-${cr.mc}`, cr.dot && `DOT-${cr.dot}`].filter(Boolean).join(' · ') || 'No ID'}</div>
                </div>
                {cr.amount != null && (
                  <div className="text-right">
                    <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/50">Reported loss</div>
                    <div className="text-xl font-semibold mono text-[#DC2626]">${Number(cr.amount).toLocaleString()}</div>
                  </div>
                )}
              </div>
              {cr.description && <div className="text-sm text-[#0B1E3F]/75 leading-relaxed mb-3">{cr.description}</div>}
              <div className="pt-3 border-t border-[#0B1E3F]/5 flex items-center justify-between">
                <button onClick={() => onRescan(cr)} className="text-sm text-[#0B1E3F] hover:underline flex items-center gap-1">View full broker report <ArrowRight className="w-3 h-3" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Watchlist({ navigate }: any) {
  const res = useCachedFetch<{ watchlist: any[] }>('watchlist', '/api/watchlist');
  const items = res.data?.watchlist ?? null;
  const [removing, setRemoving] = useState<string | null>(null);

  const onRemove = async (id: string) => {
    setRemoving(id);
    await fetch(`/api/watchlist?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null);
    setRemoving(null);
    invalidateCache('watchlist');
    res.refetch();
  };

  return (
    <div className="space-y-8 text-[#0B1E3F]">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-2">Watchlist</div>
          <h1 className="text-4xl serif italic text-[#0B1E3F]">Brokers you&apos;re tracking.</h1>
        </div>
        <button onClick={() => navigate('verify')} className="px-5 py-2.5 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90 flex items-center gap-2 card-shadow"><Plus className="w-4 h-4" /> Add via verify</button>
      </div>
      {items == null ? (
        <div className="py-12 text-center text-sm text-[#0B1E3F]/50">Loading…</div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-16 text-center text-[#0B1E3F]/60 card-shadow">
          <Eye className="w-12 h-12 mx-auto mb-4 text-[#0B1E3F]/30" />
          <div className="text-lg font-medium text-[#0B1E3F] mb-2">Your watchlist is empty</div>
          <div className="text-sm mb-6">Click &ldquo;Watch&rdquo; on any broker&rsquo;s report to track them for changes.</div>
          <button onClick={() => navigate('verify')} className="px-5 py-2.5 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90">Verify a broker</button>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 overflow-hidden card-shadow text-[#0B1E3F]">
          <div className="divide-y divide-[#0B1E3F]/5">
            {items.map((w: any) => {
              const score = w.last_score ?? 0;
              const verdict = w.last_verdict || (score >= 61 ? 'high' : score >= 31 ? 'medium' : 'low');
              return (
                <div key={w.id} className="flex items-center gap-4 p-5 hover:bg-[#0B1E3F]/5 transition text-[#0B1E3F]">
                  <button onClick={() => w.data && navigate('report', w.data)} className={`w-12 h-12 rounded-full flex items-center justify-center mono font-semibold transition ${verdict === 'high' ? 'bg-[#DC2626]/10 text-[#DC2626]' : verdict === 'medium' ? 'bg-[#F59E0B]/10 text-[#F59E0B]' : 'bg-[#16A34A]/10 text-[#16A34A]'}`}>{score}</button>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-[#0B1E3F]">{w.name}</div>
                    <div className="text-xs mono text-[#0B1E3F]/50">{[w.mc && `MC-${w.mc}`, w.dot && `DOT-${w.dot}`].filter(Boolean).join(' · ') || 'No ID'} · Added {timeAgo(w.created_at)}</div>
                  </div>
                  {w.data && <button onClick={() => navigate('report', w.data)} className="px-3 py-1.5 text-xs bg-[#0B1E3F]/5 text-[#0B1E3F] hover:bg-[#0B1E3F]/10 rounded-full transition">View</button>}
                  <button onClick={() => onRemove(w.id)} disabled={removing === w.id} className="px-3 py-1.5 text-xs text-[#0B1E3F]/70 hover:text-[#DC2626] hover:bg-[#DC2626]/5 rounded-full transition disabled:opacity-50">{removing === w.id ? 'Removing…' : 'Remove'}</button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Branded confirm dialog. Replaces window.confirm() so destructive actions
// share the same look as the rest of the app and can carry richer context
// (multi-paragraph body, custom labels, danger styling).
type ConfirmOpts = {
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  // Lucide icon component to render in the modal header. Defaults to
  // Trash2 (matches the destructive default). Pass Search / ScanLine /
  // anything else for non-destructive prompts.
  icon?: any;
};
function ConfirmModal({
  open, opts, busy, onCancel, onConfirm,
}: { open: boolean; opts: ConfirmOpts | null; busy?: boolean; onCancel: () => void; onConfirm: () => void }) {
  if (!open || !opts) return null;
  const danger = opts.danger !== false;
  const Icon = opts.icon || Trash2;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0B1E3F]/50"
      onClick={() => { if (!busy) onCancel(); }}
    >
      <div
        className="bg-white rounded-2xl max-w-md w-full p-6 md:p-7 card-shadow-lg text-[#0B1E3F]"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
      >
        <div className="flex items-start gap-4 mb-4">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${danger ? 'bg-[#DC2626]/10 text-[#DC2626]' : 'bg-[#0B1E3F]/10 text-[#0B1E3F]'}`}>
            <Icon className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-[#0B1E3F]">{opts.title}</h3>
            <div className="text-sm text-[#0B1E3F]/70 mt-2 leading-relaxed whitespace-pre-line">{opts.body}</div>
          </div>
        </div>
        <div className="flex gap-2 pt-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-1 py-2.5 border border-[#0B1E3F]/15 rounded-full text-sm font-medium text-[#0B1E3F] hover:bg-[#0B1E3F]/5 disabled:opacity-50"
          >
            {opts.cancelLabel || 'Cancel'}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`flex-1 py-2.5 rounded-full text-sm font-medium text-white flex items-center justify-center gap-2 disabled:opacity-60 ${danger ? 'bg-[#DC2626] hover:bg-[#DC2626]/90' : 'bg-[#0B1E3F] hover:bg-[#0B1E3F]/90'}`}
          >
            {busy && <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            {busy ? 'Working…' : (opts.confirmLabel || 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Support — user side
// ---------------------------------------------------------------------------

type SupportTicketRow = {
  id: string;
  subject: string;
  status: 'open' | 'working' | 'solved';
  created_at: string;
  updated_at: string;
  messageCount: number;
  lastMessageAt: string | null;
  lastAdminReplyAt: string | null;
};

type SupportMessage = { id: string; body: string; is_admin: boolean; created_at: string };

const SUPPORT_STATUS_META: Record<string, { label: string; bg: string; fg: string }> = {
  open:    { label: 'OPEN',         bg: 'bg-[#F59E0B]/10', fg: 'text-[#F59E0B]' },
  working: { label: 'WORKING ON IT', bg: 'bg-[#0B1E3F]/10', fg: 'text-[#0B1E3F]' },
  solved:  { label: 'SOLVED',       bg: 'bg-[#16A34A]/10', fg: 'text-[#16A34A]' },
};

function SupportPage({ user }: { user: any }) {
  const [tickets, setTickets] = useState<SupportTicketRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newSubject, setNewSubject] = useState('');
  const [newBody, setNewBody] = useState('');

  const load = async () => {
    setError(null);
    try {
      const r = await fetch('/api/support');
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `Load failed (${r.status})`);
      setTickets(j.tickets || []);
    } catch (e: any) {
      setError(e?.message || 'Could not load tickets');
    }
  };
  useEffect(() => { load(); }, []);

  const submitNew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creating) return;
    const subj = newSubject.trim();
    const body = newBody.trim();
    if (!subj || !body) { setError('Subject and message are required.'); return; }
    setCreating(true); setError(null);
    try {
      const r = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: subj, body }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `Create failed (${r.status})`);
      track('support_ticket_created');
      setShowNew(false);
      setNewSubject(''); setNewBody('');
      await load();
      if (j?.ticket?.id) setOpenId(j.ticket.id);
    } catch (e: any) {
      setError(e?.message || 'Could not open ticket');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-8 text-[#0B1E3F]">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-2">Support</div>
          <h1 className="text-4xl serif italic text-[#0B1E3F]">Help & support tickets.</h1>
          <p className="text-[#0B1E3F]/60 mt-2 text-sm">Reach the team directly. We answer every ticket personally.</p>
        </div>
        <button onClick={() => { setShowNew(true); setOpenId(null); }} className="px-5 py-2.5 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90 inline-flex items-center gap-2 card-shadow w-fit">
          <Plus className="w-4 h-4" /> New ticket
        </button>
      </div>

      <FmcsaTransparencyCard />

      {error && <div className="text-sm text-[#DC2626]">{error}</div>}

      {showNew && (
        <form onSubmit={submitNew} className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-6 card-shadow space-y-4">
          <div>
            <label className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 block mb-2">Subject</label>
            <input
              value={newSubject}
              onChange={(e) => setNewSubject(e.target.value)}
              placeholder="Short summary, e.g. 'Wrong MC linked to my account'"
              className="w-full px-4 py-2.5 bg-white border border-[#0B1E3F]/15 rounded-lg text-sm focus:outline-none focus:border-[#0B1E3F]"
              maxLength={200}
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 block mb-2">Describe what is happening</label>
            <textarea
              value={newBody}
              onChange={(e) => setNewBody(e.target.value)}
              placeholder="What did you expect, what actually happened, and any MC/DOT or screenshots that might help."
              className="w-full px-4 py-2.5 bg-white border border-[#0B1E3F]/15 rounded-lg text-sm focus:outline-none focus:border-[#0B1E3F] min-h-[140px]"
              maxLength={5000}
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={creating} className="px-5 py-2.5 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90 disabled:opacity-60 inline-flex items-center gap-2">
              {creating && <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              {creating ? 'Sending…' : 'Send ticket'}
            </button>
            <button type="button" onClick={() => { setShowNew(false); setNewSubject(''); setNewBody(''); }} className="px-5 py-2.5 border border-[#0B1E3F]/15 rounded-full text-sm font-medium text-[#0B1E3F] hover:bg-[#0B1E3F]/5">Cancel</button>
          </div>
        </form>
      )}

      {tickets == null ? (
        <div className="py-12 text-center text-sm text-[#0B1E3F]/50">Loading…</div>
      ) : tickets.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-12 text-center text-[#0B1E3F]/55 card-shadow">
          <LifeBuoy className="w-10 h-10 mx-auto mb-3 text-[#0B1E3F]/30" />
          <div className="text-base text-[#0B1E3F] mb-1">No support tickets yet</div>
          <div className="text-sm">Hit a bug? Saw something weird in a report? Click &ldquo;New ticket&rdquo; above. We get back fast.</div>
        </div>
      ) : (
        <div className="space-y-3">
          {tickets.map((t) => (
            <SupportTicketCard
              key={t.id}
              ticket={t}
              user={user}
              expanded={openId === t.id}
              onToggle={() => setOpenId(openId === t.id ? null : t.id)}
              onReplyPosted={load}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FmcsaTransparencyCard() {
  return (
    <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-6 card-shadow text-[#0B1E3F]">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-[#0B1E3F]/10 text-[#0B1E3F] flex items-center justify-center flex-shrink-0">
          <ShieldCheck className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] mono uppercase tracking-[0.18em] text-[#0B1E3F]/55 mb-1">How Haulock uses official data</div>
          <h2 className="text-lg font-semibold text-[#0B1E3F] mb-2">Every report is built from public, official sources.</h2>
          <p className="text-sm text-[#0B1E3F]/75 leading-relaxed mb-3">
            Authority status, insurance, surety bond, safety rating, BASIC scores, 24-month inspections, and crash history come live from the U.S. Department of Transportation&apos;s FMCSA systems (SAFER, L&amp;I, and SMS). We do not generate, modify, or rewrite that data. We display what FMCSA publishes and pair it with public WHOIS, public DNS, public web search, and Google Places to round out the picture.
          </p>
          <p className="text-sm text-[#0B1E3F]/75 leading-relaxed mb-3">
            If something on a report looks wrong, the upstream record is almost always the source. We can help you raise it with FMCSA, but the correction itself happens on their end. For everything else, that is what these tickets are for.
          </p>
          <div className="flex flex-wrap gap-2 text-[11px] mono">
            <a href="https://safer.fmcsa.dot.gov" target="_blank" rel="noopener" className="px-3 py-1 bg-[#0B1E3F]/5 hover:bg-[#0B1E3F]/10 rounded-full text-[#0B1E3F]/75">FMCSA SAFER</a>
            <a href="https://li-public.fmcsa.dot.gov" target="_blank" rel="noopener" className="px-3 py-1 bg-[#0B1E3F]/5 hover:bg-[#0B1E3F]/10 rounded-full text-[#0B1E3F]/75">FMCSA L&amp;I</a>
            <a href="https://ai.fmcsa.dot.gov/SMS/" target="_blank" rel="noopener" className="px-3 py-1 bg-[#0B1E3F]/5 hover:bg-[#0B1E3F]/10 rounded-full text-[#0B1E3F]/75">FMCSA SMS</a>
            <a href="https://www.fmcsa.dot.gov/registration/dataq" target="_blank" rel="noopener" className="px-3 py-1 bg-[#0B1E3F]/5 hover:bg-[#0B1E3F]/10 rounded-full text-[#0B1E3F]/75">DataQs (FMCSA corrections)</a>
          </div>
        </div>
      </div>
    </div>
  );
}

function SupportTicketCard({ ticket, user, expanded, onToggle, onReplyPosted }: { ticket: SupportTicketRow; user: any; expanded: boolean; onToggle: () => void; onReplyPosted: () => void }) {
  const meta = SUPPORT_STATUS_META[ticket.status] || SUPPORT_STATUS_META.open;
  const [thread, setThread] = useState<{ messages: SupportMessage[]; loaded: boolean }>({ messages: [], loaded: false });
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded || thread.loaded) return;
    (async () => {
      try {
        const r = await fetch(`/api/support/${ticket.id}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || 'Load failed');
        setThread({ messages: j.messages || [], loaded: true });
      } catch (e: any) {
        setError(e?.message || 'Could not load thread');
      }
    })();
  }, [expanded, ticket.id, thread.loaded]);

  const sendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = reply.trim();
    if (!body || sending) return;
    setSending(true); setError(null);
    try {
      const r = await fetch(`/api/support/${ticket.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'Send failed');
      setThread((s) => ({ messages: [...s.messages, j.message], loaded: true }));
      setReply('');
      onReplyPosted();
    } catch (e: any) {
      setError(e?.message || 'Could not send reply');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 card-shadow text-[#0B1E3F] overflow-hidden">
      <button onClick={onToggle} className="w-full text-left px-5 py-4 hover:bg-[#0B1E3F]/[0.02] transition flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`px-2 py-0.5 rounded-full text-[10px] mono uppercase tracking-wider font-bold ${meta.bg} ${meta.fg}`}>{meta.label}</span>
            <span className="text-xs mono text-[#0B1E3F]/50">{timeAgo(ticket.updated_at)}</span>
            {ticket.messageCount > 1 && (
              <span className="text-[10px] mono uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[#0B1E3F]/5 text-[#0B1E3F]/60">{ticket.messageCount} msgs</span>
            )}
          </div>
          <div className="font-semibold text-[#0B1E3F] truncate">{ticket.subject}</div>
        </div>
        <ChevronRight className={`w-4 h-4 text-[#0B1E3F]/40 transition ${expanded ? 'rotate-90' : ''}`} />
      </button>
      {expanded && (
        <div className="border-t border-[#0B1E3F]/10 p-5 space-y-4 bg-[#F5F3EE]/40">
          {!thread.loaded ? (
            <div className="text-sm text-[#0B1E3F]/55">Loading…</div>
          ) : thread.messages.length === 0 ? (
            <div className="text-sm text-[#0B1E3F]/55">No messages yet.</div>
          ) : (
            <div className="space-y-3">
              {thread.messages.map((m) => (
                <SupportMessageBubble key={m.id} message={m} authorLabel={m.is_admin ? 'Haulock support' : (user?.name || 'You')} />
              ))}
            </div>
          )}
          {ticket.status !== 'solved' || true ? (
            <form onSubmit={sendReply} className="space-y-2">
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder={ticket.status === 'solved' ? 'Replying will reopen this ticket…' : 'Type your reply…'}
                className="w-full px-4 py-2.5 bg-white border border-[#0B1E3F]/15 rounded-lg text-sm focus:outline-none focus:border-[#0B1E3F] min-h-[100px]"
                maxLength={5000}
              />
              <div className="flex items-center justify-between gap-2">
                <button type="submit" disabled={sending || !reply.trim()} className="px-4 py-2 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90 disabled:opacity-60 inline-flex items-center gap-2">
                  {sending && <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  {sending ? 'Sending…' : 'Send reply'}
                </button>
                {error && <span className="text-xs text-[#DC2626]">{error}</span>}
              </div>
            </form>
          ) : null}
        </div>
      )}
    </div>
  );
}

function SupportMessageBubble({ message, authorLabel }: { message: SupportMessage; authorLabel: string }) {
  const isAdmin = message.is_admin;
  return (
    <div className={`p-4 rounded-xl border ${isAdmin ? 'bg-[#0B1E3F]/[0.04] border-[#0B1E3F]/15' : 'bg-white border-[#0B1E3F]/10'}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`text-[10px] mono uppercase tracking-[0.18em] font-bold ${isAdmin ? 'text-[#FF6B35]' : 'text-[#0B1E3F]/60'}`}>{authorLabel}</span>
        <span className="text-[11px] text-[#0B1E3F]/45">{timeAgo(message.created_at)}</span>
      </div>
      <div className="text-sm text-[#0B1E3F]/85 leading-relaxed whitespace-pre-wrap">{message.body}</div>
    </div>
  );
}

function SearchHistory({ navigate }: any) {
  const res = useCachedFetch<{ lookups: any[] }>('lookups:200', '/api/lookups?limit=200');
  const items = res.data?.lookups ?? null;
  const [filter, setFilter] = useState('');
  const [rescanId, setRescanId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Single pending-confirm state drives the ConfirmModal. The `run` callback
  // is what gets executed when the user clicks the confirm button — keeping
  // this here means the modal stays generic and each delete action carries
  // its own logic with it.
  const [confirm, setConfirm] = useState<{ opts: ConfirmOpts; run: () => Promise<void>; busy?: boolean } | null>(null);

  const runDeleteOne = async (id: string) => {
    setDeletingId(id); setError(null);
    try {
      const r = await fetch(`/api/lookups?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error || `Delete failed (${r.status})`);
      invalidateCache('lookups:200', 'alerts');
      res.refetch();
    } catch (err: any) {
      setError(err?.message || 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  const onDelete = (id: string) => {
    setConfirm({
      opts: {
        title: 'Remove this lookup?',
        body: 'This hides the scan from your history. Your monthly quota is not refunded — this lookup still counts toward your plan limit.',
        confirmLabel: 'Remove',
        danger: true,
      },
      run: () => runDeleteOne(id),
    });
  };

  // Group delete: nukes EVERY row for this carrier (all repeat scans of the
  // same MC/DOT/name) in one request. The group row in the UI represents the
  // carrier, not a single scan, so the delete button must match.
  const onDeleteGroup = (group: { key: string; latest: any; rows: any[] }) => {
    const ids = group.rows.map((r: any) => r.id).filter(Boolean);
    if (ids.length === 0) return;
    const label = group.latest?.name || 'this carrier';
    const opts: ConfirmOpts = ids.length === 1
      ? {
          title: 'Remove this lookup?',
          body: `This hides "${label}" from your history. Your monthly quota is not refunded.`,
          confirmLabel: 'Remove',
          danger: true,
        }
      : {
          title: `Remove all ${ids.length} lookups for ${label}?`,
          body: 'Every saved scan for this carrier will be hidden from your history. Your monthly quota is not refunded — these scans still count toward your plan limit.',
          confirmLabel: `Remove ${ids.length} scans`,
          danger: true,
        };
    setConfirm({
      opts,
      run: async () => {
        setDeletingId(group.key); setError(null);
        try {
          const r = await fetch(`/api/lookups?ids=${encodeURIComponent(ids.join(','))}`, { method: 'DELETE' });
          const j = await r.json().catch(() => null);
          if (!r.ok) throw new Error(j?.error || `Delete failed (${r.status})`);
          invalidateCache('lookups:200', 'alerts');
          res.refetch();
        } catch (err: any) {
          setError(err?.message || 'Delete failed');
        } finally {
          setDeletingId(null);
        }
      },
    });
  };

  const onDeleteAll = () => {
    const count = items?.length ?? 0;
    if (count === 0) return;
    setConfirm({
      opts: {
        title: `Clear all ${count} lookup${count === 1 ? '' : 's'}?`,
        body: 'This hides every scan in your history. Your monthly quota is not refunded — these scans still count toward your plan limit. Watchlist entries, fraud reports, and alerts are unaffected.',
        confirmLabel: 'Clear history',
        danger: true,
      },
      run: async () => {
        setDeletingAll(true); setError(null);
        try {
          const r = await fetch('/api/lookups?all=1', { method: 'DELETE' });
          const j = await r.json().catch(() => null);
          if (!r.ok) throw new Error(j?.error || `Delete failed (${r.status})`);
          invalidateCache('lookups:200', 'usage', 'alerts');
          res.refetch();
        } catch (err: any) {
          setError(err?.message || 'Delete failed');
        } finally {
          setDeletingAll(false);
        }
      },
    });
  };

  const handleConfirm = async () => {
    if (!confirm) return;
    setConfirm({ ...confirm, busy: true });
    try { await confirm.run(); }
    finally { setConfirm(null); }
  };

  // While a re-scan is in flight we also render a full-page radar/sonar
  // overlay (the same component the Verify tool uses) so the user sees
  // real progress instead of a tiny button spinner. `scanQuery` holds the
  // text we're searching for; `scanResult` is null until the API returns,
  // at which point the radar paints "found" briefly before we navigate.
  const [scanQuery, setScanQuery] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<any | null>(null);

  const onRescan = async (l: any) => {
    setRescanId(l.id); setError(null);
    const q = (l.query || l.mc || l.dot || '').trim();
    const e = (l.email_query || '').trim();
    if (!q) { setError('Saved query is empty — open the report and re-run from Verify.'); setRescanId(null); return; }
    setScanQuery(q);
    setScanResult(null);
    try {
      const promises: Promise<any>[] = [
        fetch(`/api/verify?q=${encodeURIComponent(q)}&force=1`).then(async (r) => {
          const j = await r.json();
          if (!r.ok) {
            if (r.status === 402) throw new Error(j?.error || 'Monthly lookup limit reached. Upgrade your plan.');
            if (r.status === 503) throw new Error(j?.error || 'FMCSA is temporarily unavailable. Please try again in a minute.');
            if (r.status === 429) throw new Error(j?.error || 'Too many lookups — slow down and try again shortly.');
            throw new Error(j?.error || `Lookup failed (${r.status})`);
          }
          return j;
        }),
      ];
      if (e) promises.push(fetch(`/api/domain-check?q=${encodeURIComponent(e)}`).then(async (r) => r.ok ? r.json() : null).catch(() => null));
      const [data, domain] = await Promise.all(promises);
      const merged = { ...data, query: q, domain: domain || undefined, queriedEmail: e || undefined };
      // Paint the "scan complete" state on the radar so the user sees a
      // satisfying flash of red on whichever sources caught something
      // before the report opens — same UX as the Verify tool.
      setScanResult(merged);
      if (!data?.cached) {
        fetch('/api/lookups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(merged) })
          .then(() => invalidateCache('lookups:200', 'usage', 'alerts')).catch(() => {});
        if (data?.verdict === 'high') {
          fetch('/api/email/high-risk-alert', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ report: data }) }).catch(() => {});
        }
      }
      // Brief reveal pause so the radar's "result" frame is visible before
      // we navigate away.
      await new Promise((resolve) => setTimeout(resolve, 700));
      navigate('report', merged);
    } catch (err: any) {
      setError(err?.message || 'Re-scan failed');
    } finally {
      setRescanId(null);
      setScanQuery(null);
      setScanResult(null);
    }
  };

  const f = filter.trim().toLowerCase();
  const shown = (items || []).filter((l) => !f || (l.name || '').toLowerCase().includes(f) || (l.mc || '').includes(f) || (l.dot || '').includes(f) || (l.query || '').toLowerCase().includes(f));

  type Group = { key: string; latest: any; rows: any[] };
  const groupsMap = new Map<string, Group>();
  for (const l of shown) {
    const key = `${l.mc || ''}|${l.dot || ''}|${(l.name || 'unknown').toLowerCase()}`;
    const g = groupsMap.get(key);
    if (g) { g.rows.push(l); }
    else { groupsMap.set(key, { key, latest: l, rows: [l] }); }
  }
  const groups = Array.from(groupsMap.values()).sort((a, b) => new Date(b.latest.created_at).getTime() - new Date(a.latest.created_at).getTime());

  return (
    <div className="space-y-8 text-[#0B1E3F]">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-2">History</div>
          <h1 className="text-4xl serif italic text-[#0B1E3F]">Every lookup you&apos;ve run.</h1>
          <p className="text-[#0B1E3F]/60 mt-2 text-sm">{items == null ? '—' : `${items.length} saved`}</p>
        </div>
        <div className="flex items-center gap-2">
          {items != null && items.length > 0 && (
            <button
              onClick={onDeleteAll}
              disabled={deletingAll}
              className="px-4 py-2 border border-[#DC2626]/25 bg-white rounded-full text-sm font-medium text-[#DC2626] hover:bg-[#DC2626]/5 transition flex items-center gap-2 disabled:opacity-50"
              title="Permanently hide every entry from your history. Quota is not refunded."
            >
              {deletingAll ? (
                <><div className="w-3.5 h-3.5 border-2 border-[#DC2626]/30 border-t-[#DC2626] rounded-full animate-spin" /> Clearing…</>
              ) : (
                <><Trash2 className="w-4 h-4" /> Clear all</>
              )}
            </button>
          )}
          <button onClick={() => navigate('verify')} className="px-5 py-2.5 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90 flex items-center gap-2 card-shadow"><Search className="w-4 h-4" /> New lookup</button>
        </div>
      </div>
      <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-3 card-shadow">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search by name, MC, DOT, or query…" className="w-full px-4 py-2.5 bg-transparent rounded-lg text-sm focus:outline-none text-[#0B1E3F] placeholder:text-[#0B1E3F]/40" />
      </div>
      {error && <div className="text-sm text-[#DC2626]">{error}</div>}
      {items == null ? (
        <div className="py-12 text-center text-sm text-[#0B1E3F]/50">Loading…</div>
      ) : shown.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-16 text-center text-[#0B1E3F]/60 card-shadow">
          <Clock className="w-12 h-12 mx-auto mb-4 text-[#0B1E3F]/30" />
          <div className="text-lg font-medium text-[#0B1E3F] mb-2">{items.length === 0 ? 'No history yet' : 'No matches'}</div>
          <div className="text-sm mb-6">{items.length === 0 ? 'Every broker you verify will be saved here.' : 'Try a different search.'}</div>
          {items.length === 0 && <button onClick={() => navigate('verify')} className="px-5 py-2.5 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90">Verify a broker</button>}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 overflow-hidden card-shadow text-[#0B1E3F]">
          <div className="divide-y divide-[#0B1E3F]/5">
            {groups.map((g) => <HistoryGroup key={g.key} group={g} navigate={navigate} onRescan={onRescan} rescanId={rescanId} onDelete={onDelete} onDeleteGroup={onDeleteGroup} deletingId={deletingId} />)}
          </div>
        </div>
      )}
      <ConfirmModal
        open={confirm != null}
        opts={confirm?.opts ?? null}
        busy={confirm?.busy}
        onCancel={() => setConfirm(null)}
        onConfirm={handleConfirm}
      />
      {/* Radar / sonar overlay during a re-scan. Same component the Verify
          tool uses so the experience is identical no matter where the scan
          was triggered from. Auto-dismisses when navigate() runs. */}
      {scanQuery && (
        <div className="fixed inset-0 z-50 bg-[#F5F3EE]/95 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-5xl">
            <div className="text-center mb-6">
              <div className="text-xs mono uppercase tracking-[0.2em] text-[#FF6B35] mb-2">Re-running scan</div>
              <div className="text-2xl serif italic text-[#0B1E3F]">Pulling fresh data for {scanQuery}…</div>
            </div>
            <VerifyScanProgress query={scanQuery} result={scanResult} />
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryGroup({ group, navigate, onRescan, rescanId, onDelete, onDeleteGroup, deletingId }: any) {
  const [open, setOpen] = useState(false);
  const l = group.latest;
  const verdict = l.verdict || (l.score >= 61 ? 'high' : l.score >= 31 ? 'medium' : 'low');
  const count = group.rows.length;
  const groupBusy = deletingId === group.key;
  // Identify scans that came from a PDF rate-confirmation upload so the
  // user can tell at a glance which rows started as a file vs a typed
  // MC/DOT/name lookup. The badge fires when EITHER the latest scan was
  // a rate-con OR any scan in the deduped group was — different surface
  // for the same carrier should still light up because the user did at
  // some point feed us a rate con.
  const hasRateCon = l.source === 'ratecon' || group.rows.some((r: any) => r.source === 'ratecon');
  return (
    <div className="text-[#0B1E3F]">
      <div className="flex items-center gap-4 p-4 md:p-5 hover:bg-[#0B1E3F]/5 transition">
        <button onClick={() => navigate('report', l.data)} className={`w-12 h-12 rounded-full flex items-center justify-center mono font-semibold flex-shrink-0 transition ${verdict === 'high' ? 'bg-[#DC2626]/10 text-[#DC2626]' : verdict === 'medium' ? 'bg-[#F59E0B]/10 text-[#F59E0B]' : 'bg-[#16A34A]/10 text-[#16A34A]'}`}>{l.score}</button>
        <button onClick={() => navigate('report', l.data)} className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="font-semibold text-[#0B1E3F] truncate">{l.name}</div>
            {hasRateCon && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[#FF6B35]/10 text-[#FF6B35] text-[10px] mono uppercase tracking-wider font-bold flex-shrink-0"
                title="This carrier was scanned from a PDF rate confirmation upload."
              >
                <FileText className="w-3 h-3" /> Rate con
              </span>
            )}
          </div>
          <div className="text-xs mono text-[#0B1E3F]/50 truncate">
            {[l.mc && `MC-${l.mc}`, l.dot && `DOT-${l.dot}`].filter(Boolean).join(' · ') || 'No ID'} · {count > 1 ? `${count} searches` : `last ${timeAgo(l.created_at)}`}
            {count === 1 && l.email_query && ` · ${l.email_query}`}
          </div>
        </button>
        <div className="hidden sm:flex items-center gap-2">
          {count > 1 && (
            <button onClick={() => setOpen((v) => !v)} className="px-3 py-1.5 text-xs bg-[#0B1E3F]/5 text-[#0B1E3F]/80 hover:bg-[#0B1E3F]/10 rounded-full transition flex items-center gap-1">
              <ChevronRight className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`} /> {count} searches
            </button>
          )}
          <button onClick={() => navigate('report', l.data)} className="px-3 py-1.5 text-xs bg-[#0B1E3F]/5 text-[#0B1E3F] hover:bg-[#0B1E3F]/10 rounded-full transition">View</button>
          <button onClick={() => onRescan(l)} disabled={rescanId === l.id} className="px-3 py-1.5 text-xs bg-[#0B1E3F] text-white hover:bg-[#0B1E3F]/90 rounded-full transition flex items-center gap-1 disabled:opacity-60" title="Runs a fresh FMCSA lookup — uses 1 credit">
            {rescanId === l.id ? (<><div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" /> Scanning…</>) : (<>Scan again</>)}
          </button>
          <button onClick={() => onDeleteGroup(group)} disabled={groupBusy} className="w-8 h-8 flex items-center justify-center rounded-full text-[#0B1E3F]/50 hover:bg-[#DC2626]/10 hover:text-[#DC2626] transition disabled:opacity-60" title={count > 1 ? `Remove all ${count} lookups for this carrier (does not restore monthly quota)` : 'Remove from history (does not restore monthly quota)'}>
            {groupBusy ? <div className="w-3 h-3 border border-[#DC2626]/40 border-t-[#DC2626] rounded-full animate-spin" /> : <Trash2 className="w-4 h-4" />}
          </button>
        </div>
      </div>
      {open && count > 1 && (
        <div className="bg-[#0B1E3F]/[0.02] border-t border-[#0B1E3F]/5 divide-y divide-[#0B1E3F]/5">
          {group.rows.map((row: any) => {
            const rv = row.verdict || (row.score >= 61 ? 'high' : row.score >= 31 ? 'medium' : 'low');
            const verdictLabel = rv === 'high' ? 'HIGH RISK' : rv === 'medium' ? 'CAUTION' : 'LOW RISK';
            const verdictColor = rv === 'high' ? 'text-[#DC2626]' : rv === 'medium' ? 'text-[#F59E0B]' : 'text-[#16A34A]';
            return (
              <div key={row.id} className="w-full flex items-center gap-4 p-3 md:p-4 pl-8 hover:bg-[#0B1E3F]/5 transition text-[#0B1E3F]">
                <button onClick={() => navigate('report', row.data)} className="flex items-center gap-4 flex-1 min-w-0 text-left">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center mono text-xs font-semibold flex-shrink-0 ${rv === 'high' ? 'bg-[#DC2626]/10 text-[#DC2626]' : rv === 'medium' ? 'bg-[#F59E0B]/10 text-[#F59E0B]' : 'bg-[#16A34A]/10 text-[#16A34A]'}`}>{row.score}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`text-xs mono uppercase tracking-wider font-semibold ${verdictColor}`}>{verdictLabel}</span>
                      <span className="text-xs mono text-[#0B1E3F]/60">· score {row.score}/100</span>
                    </div>
                    <div className="text-xs text-[#0B1E3F]/60 truncate">
                      {timeAgo(row.created_at)}
                      {row.source === 'ratecon' && ' · rate con'}
                      {row.email_query && ` · ${row.email_query}`}
                    </div>
                  </div>
                </button>
                <button onClick={() => onDelete(row.id)} disabled={deletingId === row.id} className="w-7 h-7 flex items-center justify-center rounded-full text-[#0B1E3F]/40 hover:bg-[#DC2626]/10 hover:text-[#DC2626] transition disabled:opacity-60" title="Remove from history">
                  {deletingId === row.id ? <div className="w-3 h-3 border border-[#DC2626]/40 border-t-[#DC2626] rounded-full animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                </button>
                <ChevronRight className="w-4 h-4 text-[#0B1E3F]/30" />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Alerts({ navigate }: any) {
  const res = useCachedFetch<{ alerts: any[] }>('alerts', '/api/alerts');
  const alerts = res.data?.alerts ?? null;
  const [dismissingAll, setDismissingAll] = useState(false);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Dismiss = soft-delete every underlying lookup row in the deduped carrier
  // group (the row in the UI is one carrier, not one scan). The alert
  // disappears from this page AND from /history. Quota is not refunded.
  const dismissGroup = async (key: string, ids: string[]) => {
    if (ids.length === 0) return;
    setDismissingId(key); setError(null);
    try {
      const r = await fetch(`/api/lookups?ids=${encodeURIComponent(ids.join(','))}`, { method: 'DELETE' });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error || `Dismiss failed (${r.status})`);
      invalidateCache('alerts', 'lookups:200');
      res.refetch();
    } catch (err: any) {
      setError(err?.message || 'Dismiss failed');
    } finally {
      setDismissingId(null);
    }
  };
  const dismissAll = async () => {
    const count = alerts?.length ?? 0;
    if (count === 0) return;
    if (!window.confirm(
      `Dismiss all ${count} alert${count === 1 ? '' : 's'}?\n\n` +
      `This soft-deletes the underlying scans from your history too. Quota is NOT refunded — the scans still count toward your plan limits.\n\n` +
      `Watchlist entries and fraud reports are unaffected.`
    )) return;
    setDismissingAll(true); setError(null);
    try {
      // Filter to JUST the alerts slice (high+medium, last 7 days) so
      // clearing alerts doesn't nuke the user's whole history.
      const r = await fetch('/api/lookups?all=1&verdicts=high,medium&sinceDays=7', { method: 'DELETE' });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error || `Dismiss failed (${r.status})`);
      invalidateCache('alerts', 'lookups:200');
      res.refetch();
    } catch (err: any) {
      setError(err?.message || 'Dismiss failed');
    } finally {
      setDismissingAll(false);
    }
  };

  // Dedupe: one row per carrier (keyed by MC, DOT, or name in that order).
  // Keep the MOST RECENT scan as the primary row, but track previous scan
  // count + score history so the user sees the trend instead of an
  // identical record repeated 4 times.
  type DedupedAlert = {
    key: string;
    primary: any;
    scanCount: number;
    ids: string[];
    history: { score: number; verdict: string; createdAt: string }[];
    newFlagsSinceLastScan: any[];
  };
  const deduped: DedupedAlert[] = (() => {
    if (!alerts) return [];
    const buckets = new Map<string, any[]>();
    for (const a of alerts) {
      const key = a.mc ? `mc:${a.mc}` : a.dot ? `dot:${a.dot}` : `name:${(a.name || '').toLowerCase()}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(a);
    }
    const out: DedupedAlert[] = [];
    for (const [key, group] of buckets.entries()) {
      group.sort((x, y) => new Date(y.created_at).getTime() - new Date(x.created_at).getTime());
      const primary = group[0];
      const previous = group[1];
      let newFlags: any[] = [];
      if (previous?.data?.flags && primary?.data?.flags) {
        const prevTitles = new Set((previous.data.flags as any[]).map((f) => f?.title));
        newFlags = (primary.data.flags as any[]).filter((f) => f?.title && !prevTitles.has(f.title));
      }
      out.push({
        key,
        primary,
        scanCount: group.length,
        ids: group.map((g: any) => g.id).filter(Boolean),
        history: group.slice(0, 5).map((g) => ({ score: g.score, verdict: g.verdict, createdAt: g.created_at })),
        newFlagsSinceLastScan: newFlags,
      });
    }
    out.sort((a, b) => new Date(b.primary.created_at).getTime() - new Date(a.primary.created_at).getTime());
    return out;
  })();

  return (
    <div className="space-y-8 text-[#0B1E3F]">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-2">Alerts</div>
          <h1 className="text-4xl serif italic text-[#0B1E3F]">Recent risk signals from your lookups.</h1>
          <p className="text-[#0B1E3F]/60 mt-2 text-sm">One entry per broker/carrier — newest scan, with what changed since the previous one.</p>
        </div>
        {alerts != null && alerts.length > 0 && (
          <button
            onClick={dismissAll}
            disabled={dismissingAll}
            className="px-4 py-2 border border-[#DC2626]/25 bg-white rounded-full text-sm font-medium text-[#DC2626] hover:bg-[#DC2626]/5 transition flex items-center gap-2 disabled:opacity-50 w-fit"
            title="Soft-delete every alert. Watchlist + fraud reports unaffected. Quota not refunded."
          >
            {dismissingAll ? (
              <><div className="w-3.5 h-3.5 border-2 border-[#DC2626]/30 border-t-[#DC2626] rounded-full animate-spin" /> Dismissing…</>
            ) : (
              <><Trash2 className="w-4 h-4" /> Dismiss all</>
            )}
          </button>
        )}
      </div>
      {error && <div className="text-sm text-[#DC2626]">{error}</div>}
      {alerts == null ? (
        <div className="py-12 text-center text-sm text-[#0B1E3F]/50">Loading…</div>
      ) : deduped.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-16 text-center text-[#0B1E3F]/60 card-shadow">
          <Bell className="w-12 h-12 mx-auto mb-4 text-[#0B1E3F]/30" />
          <div className="text-lg font-medium text-[#0B1E3F] mb-2">No alerts yet</div>
          <div className="text-sm mb-6">Alerts show up when a broker lookup returns HIGH or CAUTION in the past 7 days.</div>
          <button onClick={() => navigate('verify')} className="px-5 py-2.5 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90">Verify a broker</button>
        </div>
      ) : (
        <div className="space-y-3">
          {deduped.map((d) => {
            const a = d.primary;
            const sev = a.verdict === 'high' ? 'critical' : 'warning';
            const topFlag = (a.data?.flags || [])[0];
            const prev = d.history[1];
            const trend: 'up' | 'down' | 'flat' | null = prev
              ? a.score > prev.score ? 'up' : a.score < prev.score ? 'down' : 'flat'
              : null;
            return (
              <div
                key={a.id}
                onClick={() => navigate('report', a.data)}
                className="w-full text-left flex items-start gap-4 p-5 bg-white rounded-2xl border border-[#0B1E3F]/10 hover:border-[#0B1E3F]/20 card-shadow transition text-[#0B1E3F] cursor-pointer relative"
              >
                <div className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${sev === 'critical' ? 'bg-[#DC2626]' : 'bg-[#F59E0B]'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${a.verdict === 'high' ? 'bg-[#DC2626]/10 text-[#DC2626]' : 'bg-[#F59E0B]/10 text-[#F59E0B]'}`}>{a.verdict === 'high' ? 'HIGH RISK' : 'CAUTION'}</span>
                    <span className="text-xs mono text-[#0B1E3F]/50">· {timeAgo(a.created_at)}</span>
                    {d.scanCount > 1 && (
                      <span className="text-[10px] mono uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[#0B1E3F]/5 text-[#0B1E3F]/65">
                        scanned {d.scanCount}×
                      </span>
                    )}
                    {d.newFlagsSinceLastScan.length > 0 && (
                      <span className="text-[10px] mono uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[#FF6B35]/10 text-[#FF6B35] font-semibold">
                        +{d.newFlagsSinceLastScan.length} new flag{d.newFlagsSinceLastScan.length === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                  <div className="font-semibold text-[#0B1E3F] truncate">{a.name}</div>
                  <div className="text-sm mono text-[#0B1E3F]/50 mb-2">{[a.mc && `MC-${a.mc}`, a.dot && `DOT-${a.dot}`].filter(Boolean).join(' · ') || 'No ID'}</div>
                  {topFlag && <div className="text-sm text-[#0B1E3F]/75">{topFlag.title} — {topFlag.desc}</div>}
                  {d.scanCount > 1 && (
                    <div className="mt-2 flex items-center gap-1.5 text-[11px] mono text-[#0B1E3F]/50">
                      <span>history:</span>
                      {d.history.map((h, i) => (
                        <span
                          key={i}
                          className={`px-1.5 py-0.5 rounded ${
                            h.verdict === 'high' ? 'bg-[#DC2626]/10 text-[#DC2626]'
                            : h.verdict === 'medium' ? 'bg-[#F59E0B]/10 text-[#F59E0B]'
                            : 'bg-[#16A34A]/10 text-[#16A34A]'
                          }`}
                        >
                          {h.score}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {/* Push the score down past the dismiss X button (which is
                    absolute-positioned at top-3 right-3) so they never
                    overlap on a 100-score row. */}
                <div className="flex flex-col items-end gap-1 flex-shrink-0 pt-7">
                  <div className={`mono text-lg font-semibold ${a.verdict === 'high' ? 'text-[#DC2626]' : 'text-[#F59E0B]'}`}>{a.score}</div>
                  {trend && trend !== 'flat' && prev && (
                    <div className={`text-[10px] mono uppercase tracking-wider ${trend === 'up' ? 'text-[#DC2626]' : 'text-[#16A34A]'}`}>
                      {trend === 'up' ? '↑' : '↓'} {Math.abs(a.score - prev.score)}
                    </div>
                  )}
                </div>
                {/* Per-row dismiss soft-deletes EVERY scan in the deduped
                    carrier group (the row represents the carrier, not a
                    single scan). Stops propagation so the parent
                    navigate-to-report click doesn't fire. */}
                <button
                  onClick={(e) => { e.stopPropagation(); dismissGroup(d.key, d.ids); }}
                  disabled={dismissingId === d.key}
                  title={d.scanCount > 1 ? `Dismiss all ${d.scanCount} alerts for this carrier` : 'Dismiss this alert'}
                  className="absolute top-3 right-3 w-7 h-7 rounded-full text-[#0B1E3F]/35 hover:bg-[#DC2626]/10 hover:text-[#DC2626] transition disabled:opacity-50 flex items-center justify-center"
                >
                  {dismissingId === d.key
                    ? <div className="w-3 h-3 border-2 border-[#DC2626]/30 border-t-[#DC2626] rounded-full animate-spin" />
                    : <XCircle className="w-4 h-4" />}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const PLAN_DETAILS: Record<string, { label: string; price: string }> = {
  free: { label: 'Free', price: '$0/mo' },
  carrier: { label: 'Carrier', price: '$49/mo' },
  team: { label: 'Team', price: '$99/mo' },
  fleet: { label: 'Fleet', price: '$249/mo' },
};

const PLAN_LADDER = ['free', 'carrier', 'team', 'fleet'] as const;
const PAID_PLANS = new Set(['carrier', 'team', 'fleet']);

function ApiKeysTab({ user, navigate }: any) {
  const [keys, setKeys] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [revealed, setRevealed] = useState<{ prefix: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const planId = (user?.plan || '').toLowerCase();
  const planLabel = PLAN_DETAILS[planId]?.label || 'Free';
  const limit = (() => {
    try { return getPlan(planId).limits.fmcsaLookups; } catch { return null; }
  })();

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/settings/keys');
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `Load failed (${r.status})`);
      setKeys(j.keys || []);
    } catch (err: any) {
      setError(err?.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const createKey = async () => {
    if (creating) return;
    setCreating(true); setError(null);
    try {
      const r = await fetch('/api/settings/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() || 'API key' }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `Create failed (${r.status})`);
      setRevealed({ prefix: j.key.prefix, token: j.token });
      setNewName('');
      load();
    } catch (err: any) {
      setError(err?.message || 'Create failed');
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    if (!window.confirm('Revoke this API key? Any integrations using it will stop working immediately.')) return;
    setRevokingId(id);
    try {
      const r = await fetch(`/api/settings/keys?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        throw new Error(j?.error || `Revoke failed (${r.status})`);
      }
      load();
    } catch (err: any) {
      setError(err?.message || 'Revoke failed');
    } finally {
      setRevokingId(null);
    }
  };

  const copyToken = async () => {
    if (!revealed?.token) return;
    try {
      await navigator.clipboard.writeText(revealed.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Clipboard access blocked — copy the token manually.');
    }
  };

  const activeKeys = (keys || []).filter((k) => !k.revoked_at);

  // API access ships on Carrier and up. Free users see a paywall card
  // instead of the key list / create form. Server enforces the same rule
  // on POST /api/settings/keys so the UI is not the only barrier.
  const PAID_PLANS_FOR_API = new Set(['carrier', 'team', 'fleet']);
  const hasApiAccess = PAID_PLANS_FOR_API.has(planId);

  if (!hasApiAccess) {
    return (
      <div>
        <div className="flex items-start justify-between gap-4 mb-2">
          <h2 className="text-xl font-semibold text-[#0B1E3F]">API keys</h2>
          <a href="/docs/api" target="_blank" rel="noreferrer" className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/70 hover:text-[#0B1E3F] flex items-center gap-1.5 transition">
            <FileText className="w-3.5 h-3.5" /> Documentation
          </a>
        </div>
        <p className="text-sm text-[#0B1E3F]/65 max-w-2xl mb-6">
          Integrate Haulock into your TMS, dispatch software, or scripts. The API is available on the Carrier plan and up.
        </p>
        <div className="p-7 rounded-2xl border border-[#FF6B35]/25 bg-[#FF6B35]/[0.04] text-[#0B1E3F]">
          <div className="flex items-start gap-4">
            <div className="w-11 h-11 rounded-xl bg-[#FF6B35] text-white flex items-center justify-center flex-shrink-0">
              <Key className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] mono uppercase tracking-[0.18em] text-[#FF6B35] font-bold mb-1">Carrier plan and up</div>
              <h3 className="text-lg font-semibold text-[#0B1E3F] mb-2">API access is a paid feature</h3>
              <p className="text-sm text-[#0B1E3F]/70 leading-relaxed mb-4">
                Generate API keys, hit Haulock&apos;s verify endpoints from your TMS or onboarding flow, and pull broker / carrier risk reports programmatically. Included on every paid plan, with rate limits scaled to your tier.
              </p>
              <ul className="space-y-1.5 text-sm text-[#0B1E3F]/75 mb-5">
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-[#16A34A] flex-shrink-0" /> Same data as the dashboard, in JSON</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-[#16A34A] flex-shrink-0" /> Multiple keys per account, revoke any time</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-[#16A34A] flex-shrink-0" /> Full reference at <a href="/docs/api" target="_blank" rel="noreferrer" className="underline">docs/api</a></li>
              </ul>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => navigate('plan')}
                  className="px-5 py-2.5 bg-[#0B1E3F] text-white rounded-full text-sm font-semibold hover:bg-[#0B1E3F]/90 inline-flex items-center gap-2"
                >
                  Upgrade to use the API <ArrowRight className="w-4 h-4" />
                </button>
                <a
                  href="/docs/api"
                  target="_blank"
                  rel="noreferrer"
                  className="px-5 py-2.5 border border-[#0B1E3F]/15 rounded-full text-sm font-semibold text-[#0B1E3F] hover:bg-[#0B1E3F]/5"
                >
                  Read the docs
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-2">
        <h2 className="text-xl font-semibold text-[#0B1E3F]">API keys</h2>
        <a href="/docs/api" target="_blank" rel="noreferrer" className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/70 hover:text-[#0B1E3F] flex items-center gap-1.5 transition">
          <FileText className="w-3.5 h-3.5" /> Documentation
        </a>
      </div>
      <p className="text-sm text-[#0B1E3F]/65 max-w-2xl mb-6">
        Integrate Haulock into your TMS, dispatch software, or scripts. Usage through the API counts against your monthly plan quota —{' '}
        <span className="font-medium text-[#0B1E3F]">{limit == null ? 'unlimited' : `${limit} lookups/mo on ${planLabel}`}</span>.{' '}
        Full reference: <a href="/docs/api" target="_blank" rel="noreferrer" className="underline text-[#0B1E3F] hover:text-[#FF6B35]">docs/api</a>.
      </p>

      {revealed && (
        <div className="mb-6 p-5 bg-[#16A34A]/5 border border-[#16A34A]/30 rounded-2xl">
          <div className="flex items-start gap-3 mb-3">
            <Key className="w-5 h-5 text-[#16A34A] mt-0.5" />
            <div>
              <div className="font-semibold text-[#0B1E3F] mb-1">Your new API key — copy it now.</div>
              <div className="text-sm text-[#0B1E3F]/70">This token is shown once. Haulock stores only a hash — we can&apos;t recover it if you lose it.</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2.5 bg-white border border-[#0B1E3F]/15 rounded-lg mono text-xs text-[#0B1E3F] break-all select-all">{revealed.token}</code>
            <button onClick={copyToken} className="px-3 py-2.5 bg-[#0B1E3F] text-white rounded-lg text-xs font-medium hover:bg-[#0B1E3F]/90 transition flex items-center gap-1.5">
              <Copy className="w-3.5 h-3.5" /> {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <button onClick={() => setRevealed(null)} className="mt-3 text-xs text-[#0B1E3F]/60 hover:text-[#0B1E3F] transition">I&apos;ve saved it — dismiss</button>
        </div>
      )}

      <div className="mb-6 p-5 bg-[#0B1E3F]/5 rounded-xl">
        <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-3">Create a new key</div>
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') createKey(); }}
            placeholder="Label — e.g., Production TMS"
            className="flex-1 px-4 py-2.5 bg-white border border-[#0B1E3F]/15 rounded-lg text-sm focus:outline-none focus:border-[#0B1E3F] text-[#0B1E3F] placeholder:text-[#0B1E3F]/40"
          />
          <button onClick={createKey} disabled={creating} className="px-5 py-2.5 bg-[#0B1E3F] text-white rounded-lg text-sm font-medium hover:bg-[#0B1E3F]/90 transition disabled:opacity-60 flex items-center gap-2">
            {creating && <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            {creating ? 'Creating…' : 'Generate key'}
          </button>
        </div>
      </div>

      {error && <div className="mb-4 text-sm text-[#DC2626]">{error}</div>}

      <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-3">Your keys</div>
      <div className="border border-[#0B1E3F]/10 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-[#0B1E3F]/55">Loading…</div>
        ) : !keys || keys.length === 0 ? (
          <div className="p-10 text-center text-sm text-[#0B1E3F]/55">
            <Key className="w-8 h-8 mx-auto mb-3 text-[#0B1E3F]/25" />
            <div className="font-medium text-[#0B1E3F]/80 mb-1">No API keys yet</div>
            <div className="text-xs">Generate one above to start calling the Haulock API.</div>
          </div>
        ) : (
          <div className="divide-y divide-[#0B1E3F]/5">
            {keys.map((k) => (
              <div key={k.id} className={`flex items-center gap-4 p-4 ${k.revoked_at ? 'opacity-60' : ''}`}>
                <Key className="w-4 h-4 text-[#0B1E3F]/50 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-semibold text-sm text-[#0B1E3F] truncate">{k.name}</span>
                    {k.revoked_at && <span className="text-[10px] mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#DC2626]/10 text-[#DC2626]">Revoked</span>}
                  </div>
                  <div className="text-xs mono text-[#0B1E3F]/55 truncate">
                    {k.prefix}…  · created {timeAgo(k.created_at)}
                    {k.last_used_at ? ` · last used ${timeAgo(k.last_used_at)}` : ' · never used'}
                  </div>
                </div>
                {!k.revoked_at && (
                  <button onClick={() => revoke(k.id)} disabled={revokingId === k.id} className="w-8 h-8 flex items-center justify-center rounded-full text-[#0B1E3F]/50 hover:bg-[#DC2626]/10 hover:text-[#DC2626] transition disabled:opacity-60" title="Revoke key">
                    {revokingId === k.id ? <div className="w-3 h-3 border border-[#DC2626]/40 border-t-[#DC2626] rounded-full animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-8 pt-6 border-t border-[#0B1E3F]/10">
        <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-3">How to use</div>
        <div className="bg-[#0B1E3F] rounded-xl p-5 overflow-x-auto">
          <pre className="text-xs mono text-white/90 whitespace-pre">{`curl -H "Authorization: Bearer YOUR_API_KEY" \\
  "https://haulock.com/api/v1/verify?q=MC-123456"`}</pre>
        </div>
        <div className="mt-3 text-xs text-[#0B1E3F]/60 space-y-1">
          <div>• Endpoint: <span className="mono text-[#0B1E3F]">GET /api/v1/verify?q=&lt;MC, DOT, or company name&gt;</span></div>
          <div>• Authenticated calls count toward your plan&apos;s monthly lookup quota — {activeKeys.length} active key{activeKeys.length === 1 ? '' : 's'} share the same {limit == null ? 'unlimited' : `${limit}/mo`} allowance.</div>
          <div>• Cached hits (same MC/DOT seen before) return instantly and do not consume quota. Pass <span className="mono">&amp;force=1</span> to bypass the cache.</div>
        </div>
      </div>
    </div>
  );
}

function ToggleSwitch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition focus:outline-none focus:ring-2 focus:ring-[#0B1E3F]/20 focus:ring-offset-2 disabled:opacity-50 ${checked ? 'bg-[#0B1E3F]' : 'bg-[#0B1E3F]/15'}`}
    >
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

function NotificationsTab({ user }: any) {
  const [notifEmail, setNotifEmail] = useState<string>(user?.notificationEmail || '');
  const [highRisk, setHighRisk] = useState<boolean>(user?.notifyHighRisk !== false);
  const [watchlist, setWatchlist] = useState<boolean>(user?.notifyWatchlist !== false);
  const [digest, setDigest] = useState<boolean>(user?.notifyWeeklyDigest !== false);
  const [community, setCommunity] = useState<boolean>(user?.notifyCommunity !== false);
  const [fraudTrends, setFraudTrends] = useState<boolean>(user?.notifyFraudTrends !== false);
  const [saving, setSaving] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const emailIsValid = (s: string) => !s || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

  const save = async () => {
    const trimmed = notifEmail.trim();
    if (!emailIsValid(trimmed)) { setError('Enter a valid email address or leave it empty.'); return; }
    setSaving(true); setError(null); setInfo(null);
    const sb = getSupabase();
    if (!sb) { setError('Supabase not configured.'); setSaving(false); return; }
    const { error: err } = await sb.auth.updateUser({
      data: {
        notification_email: trimmed || null,
        notify_high_risk: highRisk,
        notify_watchlist: watchlist,
        notify_weekly_digest: digest,
        notify_community: community,
        notify_fraud_trends: fraudTrends,
      },
    });
    if (err) {
      setSaving(false);
      setError(err.message);
      return;
    }
    // Resend audience needs to know whether the user wants the fraud-trends
    // newsletter. Best-effort: log but don't fail the save if Resend is down.
    fetch('/api/newsletter/sync', { method: 'POST' }).catch(() => { /* non-fatal */ });
    setSaving(false);
    setInfo('Notification preferences saved.');
  };

  const deliveryEmail = notifEmail.trim() || user?.email || '';

  // `live: true` means we are actually sending these emails today.
  // `live: false` means the toggle is a placeholder — your preference is
  // saved, but the sender is not yet wired (no cron / no template). Be
  // honest about it so users don't expect an inbox they won't get.
  const toggles: { key: string; label: string; description: string; cadence: string; live: boolean; value: boolean; setter: (v: boolean) => void }[] = [
    {
      key: 'high-risk',
      label: 'High-risk broker alerts',
      description: 'Get an email every time one of your scans returns a HIGH verdict (score 61 or above), sent right after the scan completes.',
      cadence: 'Per scan, real time',
      live: true,
      value: highRisk,
      setter: setHighRisk,
    },
    {
      key: 'watchlist',
      label: 'Watchlist updates',
      description: 'Get an email when a broker on your watchlist gets a new flag, score change, or authority status change. We re-check your watchlist daily and only email you when something meaningful actually changes.',
      cadence: 'Daily, ~9 AM Eastern',
      live: true,
      value: watchlist,
      setter: setWatchlist,
    },
    {
      key: 'digest',
      label: 'Weekly fraud digest',
      description: 'Once a week, a personal summary of your activity: the highest-risk brokers you scanned, what changed on your watchlist, and any new flags Haulock detected. Skipped on quiet weeks.',
      cadence: 'Mondays, ~10 AM Eastern',
      live: true,
      value: digest,
      setter: setDigest,
    },
    {
      key: 'fraud-trends',
      label: 'Fraud trends newsletter',
      description: 'A short weekly briefing on a new freight fraud tactic. Each issue covers one tactic with a real scenario, how to spot it, and concrete steps to protect yourself. Generated from real news sources every week.',
      cadence: 'Thursdays, ~10 AM Eastern',
      live: true,
      value: fraudTrends,
      setter: setFraudTrends,
    },
    {
      key: 'community',
      label: 'New community fraud reports',
      description: 'Get an email when another Haulock user reports a broker you have looked up in the past 30 days or have on your watchlist. Sent in real time when the report is submitted.',
      cadence: 'Real time',
      live: true,
      value: community,
      setter: setCommunity,
    },
  ];

  return (
    <div>
      <h2 className="text-xl font-semibold text-[#0B1E3F] mb-2">Notifications</h2>
      <p className="text-sm text-[#0B1E3F]/60 mb-6">Choose which Haulock emails you want and where to send them. Toggle anything off and we&apos;ll stop the moment you save.</p>

      <div className="mb-8">
        <label className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 block mb-2">Delivery email <span className="normal-case tracking-normal text-[#0B1E3F]/40">(optional)</span></label>
        <input
          type="email"
          value={notifEmail}
          onChange={(e) => setNotifEmail(e.target.value)}
          placeholder={user?.email || 'you@example.com'}
          className="w-full max-w-md px-4 py-2.5 bg-white border border-[#0B1E3F]/15 rounded-lg text-sm focus:outline-none focus:border-[#0B1E3F] text-[#0B1E3F] placeholder:text-[#0B1E3F]/40"
        />
        <div className="text-xs text-[#0B1E3F]/55 mt-2 flex items-center gap-1.5">
          <Mail className="w-3.5 h-3.5" />
          {notifEmail.trim()
            ? <>All emails go to <span className="mono text-[#0B1E3F]">{deliveryEmail}</span></>
            : <>Leave empty to use your profile email: <span className="mono text-[#0B1E3F]">{user?.email}</span></>}
        </div>
      </div>

      <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-3">Email notifications</div>
      <div className="space-y-2 mb-6">
        {toggles.map((t) => (
          <div key={t.key} className={`flex items-start gap-4 p-4 rounded-xl border transition ${t.value ? 'bg-white border-[#0B1E3F]/15' : 'bg-[#0B1E3F]/[0.03] border-[#0B1E3F]/10'}`}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-[#0B1E3F]">{t.label}</span>
                {t.live ? (
                  <span className="text-[10px] mono uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[#16A34A]/10 text-[#16A34A] font-bold">SENDING NOW</span>
                ) : (
                  <span className="text-[10px] mono uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[#F59E0B]/10 text-[#F59E0B] font-bold">COMING SOON</span>
                )}
                <span className="text-[11px] mono text-[#0B1E3F]/45">· {t.cadence}</span>
              </div>
              <div className="text-xs text-[#0B1E3F]/60 mt-1 leading-relaxed">{t.description}</div>
              {!t.live && t.value && (
                <div className="text-[11px] text-[#0B1E3F]/45 mt-1.5">Your preference is saved. We will turn this on as soon as the sender is live.</div>
              )}
            </div>
            <ToggleSwitch checked={t.value} onChange={t.setter} />
          </div>
        ))}
      </div>

      {error && <div className="text-sm text-[#DC2626] mb-3">{error}</div>}
      {info && <div className="text-sm text-[#16A34A] mb-3">{info}</div>}

      <button onClick={save} disabled={saving} className="px-5 py-2.5 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90 transition disabled:opacity-60 flex items-center gap-2">
        {saving && <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
        {saving ? 'Saving…' : 'Save preferences'}
      </button>
    </div>
  );
}

function BillingTab({ user, navigate, planId: metaPlanId, plan: metaPlan, upgradeTarget }: any) {
  // Stripe is the source of truth for subscription state. Fetch on mount and
  // override anything stale in user_metadata.
  const [subState, setSubState] = useState<any | null>(null);
  const [subLoading, setSubLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/stripe/subscription');
        const j = await r.json();
        if (!cancelled && r.ok) setSubState(j);
      } catch { /* non-fatal */ }
      finally { if (!cancelled) setSubLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const stripePlanId: string = subState?.plan || metaPlanId;
  const planId = stripePlanId;
  const plan = PLAN_DETAILS[planId];
  const isPaid = PAID_PLANS.has(planId);
  const hasRealStripeSub = Boolean(subState?.hasSubscription);
  const memberSince = user?.createdAt ? new Date(user.createdAt) : null;
  const planSince = user?.planChangedAt ? new Date(user.planChangedAt) : memberSince;
  const fmt = (d: Date | null) => d ? d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '—';
  const fmtMoney = (cents: number | null | undefined, currency = 'USD') =>
    cents == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-[#0B1E3F]">Billing</h2>
        <div className="text-xs mono text-[#0B1E3F]/50">Account {user?.id ? `· ${String(user.id).slice(0, 8)}` : ''}</div>
      </div>

      {subLoading && (
        <div className="mb-6 p-4 bg-[#0B1E3F]/5 rounded-xl text-sm text-[#0B1E3F]/60">Checking your subscription with Stripe…</div>
      )}

      {!subLoading && !isPaid && (
        <div className="mb-6 p-4 bg-[#0B1E3F]/5 border border-[#0B1E3F]/10 rounded-xl flex items-start gap-3 text-[#0B1E3F]">
          <Lock className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div className="text-sm">
            <div className="font-medium mb-0.5">You&apos;re on the Free plan.</div>
            <div className="text-[#0B1E3F]/70">Upgrade to unlock unlimited lookups, rate con scans, and team members. Your invoices and payment method will appear here automatically.</div>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <div className="p-5 bg-[#0B1E3F]/5 rounded-xl">
          <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-2">Current plan</div>
          {plan ? (
            <>
              <div className="flex items-baseline gap-2 mb-1">
                <div className="text-3xl serif italic text-[#0B1E3F]">{plan.label}</div>
                <div className="text-[#0B1E3F]/60">· {plan.price}</div>
              </div>
              <div className="text-sm text-[#0B1E3F]/60">{planId === 'free' ? '3 lookups / month · no card required' : 'Will become active when Stripe billing launches'}</div>
            </>
          ) : (
            <>
              <div className="text-2xl text-[#0B1E3F] mb-1">No plan selected</div>
              <div className="text-sm text-[#0B1E3F]/60">Pick a plan to start using Haulock.</div>
            </>
          )}
        </div>

        <div className="p-5 bg-[#0B1E3F]/5 rounded-xl space-y-3">
          <div>
            <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-1">Member since</div>
            <div className="text-sm text-[#0B1E3F]">{fmt(memberSince)}</div>
          </div>
          <div className="pt-3 border-t border-[#0B1E3F]/10">
            <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-1">Plan active since</div>
            <div className="text-sm text-[#0B1E3F]">{fmt(planSince)}</div>
          </div>
          <div className="pt-3 border-t border-[#0B1E3F]/10">
            <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-1">Next billing date</div>
            <div className="text-sm text-[#0B1E3F]/60">{isPaid ? 'Pending — Stripe not yet active' : 'Not applicable (Free plan)'}</div>
          </div>
        </div>
      </div>

      <div className="mb-6">
        <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-3">Payment method</div>
        <div className="p-5 bg-[#0B1E3F]/[0.03] border border-dashed border-[#0B1E3F]/15 rounded-xl flex items-center gap-3 text-[#0B1E3F]/60 text-sm">
          <Lock className="w-4 h-4" />
          <span>No card on file. A card will be added during Stripe checkout once billing launches.</span>
        </div>
      </div>

      {!subLoading && hasRealStripeSub && (
        <div className="mb-6 p-5 bg-[#16A34A]/5 border border-[#16A34A]/25 rounded-xl">
          <div className="flex items-start gap-3 mb-3">
            <FileText className="w-5 h-5 text-[#16A34A] mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-[#0B1E3F] mb-1">Subscription active in Stripe</div>
              <div className="text-sm text-[#0B1E3F]/70 space-y-0.5">
                <div>
                  Plan: <span className="font-semibold text-[#0B1E3F]">{PLAN_DETAILS[subState.plan]?.label || subState.plan}</span> · {subState.interval === 'year' ? 'Annual' : 'Monthly'} · list price {fmtMoney(subState.amount, subState.currency)}{subState.interval === 'year' ? '/yr' : '/mo'}
                </div>
                {subState.lastPaidAmount != null && (
                  <div>
                    Last payment: <span className="font-semibold text-[#0B1E3F]">{fmtMoney(subState.lastPaidAmount, subState.currency)}</span>
                    {subState.discount && (
                      <span className="text-[#16A34A]">
                        {' · '}
                        {subState.discount.percentOff != null ? `${subState.discount.percentOff}% off` : subState.discount.amountOffCents != null ? `${fmtMoney(subState.discount.amountOffCents, subState.currency)} off` : 'discount'}
                        {subState.discount.code ? ` (${subState.discount.code})` : ''}
                        {subState.discount.duration === 'once' ? ' — one time' : subState.discount.duration === 'repeating' ? ` — ${subState.discount.durationInMonths} months` : subState.discount.duration === 'forever' ? ' — forever' : ''}
                      </span>
                    )}
                  </div>
                )}
                <div>Status: <span className="mono text-[#16A34A]">{subState.status}</span>{subState.cancelAtPeriodEnd && subState.cancelAt ? <> · cancels {new Date(subState.cancelAt * 1000).toLocaleDateString()}</> : null}</div>
                {subState.currentPeriodEnd && (
                  <div>
                    Next renewal: {new Date(subState.currentPeriodEnd * 1000).toLocaleDateString()}
                    {subState.discount?.duration === 'once' && ' — full price applies from this date'}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <BillingPortalButton />
            {subState.latestInvoiceUrl && (
              <a href={subState.latestInvoiceUrl} target="_blank" rel="noreferrer" className="px-5 py-2.5 border border-[#0B1E3F]/15 bg-white text-[#0B1E3F] rounded-full text-sm font-medium hover:bg-[#0B1E3F]/5 transition">
                View latest invoice
              </a>
            )}
          </div>
        </div>
      )}

      {!subLoading && !hasRealStripeSub && PAID_PLANS.has(metaPlanId) && (
        <div className="mb-6 p-5 bg-[#F59E0B]/10 border border-[#F59E0B]/30 rounded-xl">
          <div className="flex items-start gap-3 mb-3">
            <AlertTriangle className="w-5 h-5 text-[#F59E0B] mt-0.5 flex-shrink-0" />
            <div>
              <div className="font-semibold text-[#0B1E3F] mb-1">Subscription not active yet</div>
              <div className="text-sm text-[#0B1E3F]/70">
                Your profile lists <strong>{metaPlan?.label}</strong>, but Stripe has no active subscription for you. Complete checkout to activate billing.
              </div>
            </div>
          </div>
          <button onClick={() => navigate('plan')} className="px-5 py-2.5 bg-[#FF6B35] text-white rounded-full text-sm font-medium hover:bg-[#FF6B35]/90 transition">Complete checkout</button>
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-2 border-t border-[#0B1E3F]/10">
        {upgradeTarget && <button onClick={() => navigate('plan')} className="px-5 py-2.5 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90 transition">Upgrade to {upgradeTarget}</button>}
        <button onClick={() => navigate('plan')} className="px-5 py-2.5 border border-[#0B1E3F]/15 bg-white rounded-full text-sm font-medium text-[#0B1E3F] hover:bg-[#0B1E3F]/5 transition">{plan ? 'Manage plan' : 'Choose a plan'}</button>
      </div>
    </div>
  );
}

function BillingPortalButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openPortal = async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch('/api/stripe/portal', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `Portal failed (${r.status})`);
      if (j.url) window.location.href = j.url;
    } catch (err: any) {
      setError(err?.message || 'Could not open billing portal');
      setLoading(false);
    }
  };
  return (
    <div>
      <button onClick={openPortal} disabled={loading} className="px-5 py-2.5 bg-[#16A34A] text-white rounded-full text-sm font-medium hover:bg-[#16A34A]/90 transition disabled:opacity-60 flex items-center gap-2">
        {loading && <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
        {loading ? 'Opening…' : 'Open billing portal'}
      </button>
      {error && <div className="mt-2 text-sm text-[#DC2626]">{error}</div>}
    </div>
  );
}

function SettingsPage({ user, navigate, initialTab }: any) {
  const [tab, setTab] = useState(initialTab || 'profile');
  const [checkoutSuccess, setCheckoutSuccess] = useState<{ promo: string | null } | null>(null);
  const planId = (user?.plan || '').toLowerCase();
  const plan = PLAN_DETAILS[planId];
  const ladderIdx = PLAN_LADDER.indexOf(planId as any);
  const nextPlan = ladderIdx >= 0 && ladderIdx < PLAN_LADDER.length - 1 ? PLAN_LADDER[ladderIdx + 1] : null;
  const upgradeTarget = nextPlan ? PLAN_DETAILS[nextPlan]?.label ?? null : null;

  // When Stripe redirects back after checkout with ?checkout=success, jump to
  // the Billing tab, show a thank-you banner, and strip the URL params so a
  // refresh doesn't keep showing the banner.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') === 'success') {
      setTab('billing');
      const promo = params.get('promo');
      setCheckoutSuccess({ promo });
      // Fire the GA4 purchase event so revenue / conversions appear in
      // Reports → Monetization. We use the helper because GA4 has special
      // handling for `value` + `currency` (currency must be ISO 4217).
      // Plan + amount come from the user's profile after the Stripe
      // webhook has updated the subscription metadata. If the webhook
      // hasn't arrived yet, we fire a generic event without value — the
      // canonical revenue total still lives in Stripe.
      try {
        const planId = String(user?.plan || '').toLowerCase();
        const plan = (PLAN_DETAILS as any)[planId];
        const priceMatch = String(plan?.price || '').match(/\$?([\d,]+(?:\.\d+)?)/);
        const value = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : 0;
        trackPurchase({
          transaction_id: params.get('session_id') || `chk-${Date.now()}`,
          value,
          currency: 'USD',
          plan: planId || 'unknown',
        });
      } catch { /* analytics never throws */ }
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [user?.plan]);

  return (
    <div className="space-y-8 text-[#0B1E3F]">
      <div>
        <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-2">Settings</div>
        <h1 className="text-4xl serif italic text-[#0B1E3F]">Your account.</h1>
      </div>

      {checkoutSuccess && (
        <div className="bg-[#16A34A]/5 border border-[#16A34A]/30 rounded-2xl p-6 flex items-start gap-4 card-shadow">
          <div className="w-12 h-12 rounded-full bg-[#16A34A] flex items-center justify-center flex-shrink-0">
            <CheckCircle2 className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1">
            <div className="text-xl font-semibold text-[#0B1E3F] mb-1">Payment successful — welcome to Haulock.</div>
            <div className="text-sm text-[#0B1E3F]/70">
              Your subscription is live in Stripe{checkoutSuccess.promo ? <> (promo <span className="mono font-semibold">{checkoutSuccess.promo}</span> applied)</> : null}.
              A receipt has been emailed to <span className="mono text-[#0B1E3F]">{user?.email}</span>. Your plan will activate locally as soon as the Stripe webhook reaches this server. If you&apos;re testing on localhost with live keys, the webhook fires to your production URL, not here — deploy or visit haulock.com to see it sync.
            </div>
          </div>
          <button onClick={() => setCheckoutSuccess(null)} className="text-[#0B1E3F]/40 hover:text-[#0B1E3F] transition" aria-label="Dismiss">
            <XCircle className="w-5 h-5" />
          </button>
        </div>
      )}
      <div className="grid md:grid-cols-4 gap-8">
        <div className="space-y-1">
          {['profile', 'billing', 'team', 'api', 'notifications'].map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`w-full text-left px-3 py-2 rounded-lg text-sm capitalize transition ${tab === t ? 'bg-[#0B1E3F] text-white' : 'text-[#0B1E3F]/80 hover:bg-[#0B1E3F]/5'}`}>
              {t === 'api' ? 'API keys' : t}
            </button>
          ))}
        </div>
        <div className="md:col-span-3 bg-white rounded-2xl border border-[#0B1E3F]/10 p-8 card-shadow text-[#0B1E3F]">
          {tab === 'profile' && <ProfileTab user={user} />}
          {tab === 'billing' && <BillingTab user={user} navigate={navigate} planId={planId} plan={plan} upgradeTarget={upgradeTarget} />}
          {tab === 'team' && <TeamTab navigate={navigate} user={user} />}
          {tab === 'api' && <ApiKeysTab user={user} navigate={navigate} />}
          {tab === 'notifications' && <NotificationsTab user={user} />}
        </div>
      </div>
    </div>
  );
}
