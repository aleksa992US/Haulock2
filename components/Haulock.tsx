'use client';

import React, { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { createPortal } from 'react-dom';
import {
  Shield, Search, AlertTriangle, CheckCircle2, XCircle, TrendingUp, FileText, Bell,
  Users, Settings, LogOut, ChevronRight, ArrowRight, Lock, Zap, Database, Eye, EyeOff, Flag,
  Clock, MapPin, Phone, Mail, Building2, Download, Share2, Plus, BarChart3, Menu,
  Command, ShieldCheck, Star, Quote, Radio, PlayCircle, Target,
  Facebook, Instagram, Linkedin, Twitter, Youtube, Globe, Trash2, Copy, Key, ScanLine, Sparkles, Upload,
  Truck, UserCheck, LifeBuoy, MessageSquare, Fuel, Navigation, Route as RouteIcon,
  X,
} from 'lucide-react';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase/client';
import { timeAgo } from '@/lib/timeago';
import { PLANS, getPlan, formatLimit } from '@/lib/plans';
import { useCachedFetch, invalidateCache } from '@/lib/data-cache';
import { COI_CHECK_ON, SCAN_EMAIL_ON } from '@/lib/features';
import { BLOG_POSTS, type BlogPost } from '@/lib/blog-posts';
import { track, identify, trackPurchase } from '@/lib/analytics';
import { recommendationFor, carrierAuthorityLabel } from '@/lib/recommendation';

const APP_ROUTES = ['dashboard', 'verify', 'planner', 'history', 'watchlist', 'alerts', 'plan', 'settings', 'report', 'admin', 'sales', 'support', 'earnings'];
const AUTH_ROUTES = ['login', 'signup', 'pricing'];
const PUBLIC_ROUTES = ['terms', 'privacy', 'blog', 'about', 'affiliate'];
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
    notifyFraudTrends: meta.notify_fraud_trends !== false,
    role: (meta.role || null) as null | 'affiliate',
    affiliateCode: meta.affiliate_code || null,
    affiliateCommissionMode: (meta.affiliate_commission_mode === 'per_plan' ? 'per_plan' : 'uniform') as 'uniform' | 'per_plan',
    affiliateCommissionType: (meta.affiliate_commission_type || null) as null | 'flat' | 'percent',
    affiliateCommissionValue: typeof meta.affiliate_commission_value === 'number' ? meta.affiliate_commission_value : null,
    affiliateCommissionByPlan: (meta.affiliate_commission_by_plan && typeof meta.affiliate_commission_by_plan === 'object') ? meta.affiliate_commission_by_plan : null,
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
    // Load planner prefill (e.g. "Plan this load" on a rate con report).
    if (to === 'planner' && data && typeof window !== 'undefined') {
      try { sessionStorage.setItem('haulock:plannerPrefill', JSON.stringify(data)); } catch {}
      window.dispatchEvent(new CustomEvent('haulock:planner-prefill'));
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
      {route === 'affiliate' && <AffiliatePage navigate={navigate} user={user} />}
      {!user && APP_ROUTES.includes(route) && (
        <RequireAuth navigate={navigate} />
      )}
      {user && APP_ROUTES.includes(route) && (
        <AppShell user={user} route={route} navigate={navigate} logout={logout}>
          <PageSlot routeId="dashboard" current={route}><Dashboard navigate={navigate} user={user} /></PageSlot>
          <PageSlot routeId="verify" current={route}><VerifyTool navigate={navigate} /></PageSlot>
          <PageSlot routeId="planner" current={route}><LoadPlanner navigate={navigate} /></PageSlot>
          <PageSlot routeId="report" current={route}><Report report={currentReport} navigate={navigate} /></PageSlot>
          <PageSlot routeId="watchlist" current={route}><Watchlist navigate={navigate} /></PageSlot>
          <PageSlot routeId="support" current={route}><SupportPage user={user} /></PageSlot>
          <PageSlot routeId="alerts" current={route}><Alerts navigate={navigate} /></PageSlot>
          <PageSlot routeId="settings" current={route}><SettingsPage user={user} navigate={navigate} initialTab={settingsTab} /></PageSlot>
          <PageSlot routeId="plan" current={route}><Plan user={user} setPlan={setPlan} /></PageSlot>
          <PageSlot routeId="history" current={route}><SearchHistory navigate={navigate} /></PageSlot>
          <PageSlot routeId="admin" current={route}><AdminPage navigate={navigate} /></PageSlot>
          <PageSlot routeId="sales" current={route}><SalesPage /></PageSlot>
          <PageSlot routeId="earnings" current={route}><EarningsPage user={user} /></PageSlot>
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
  stats: { totalVerifications: number; activeFmcsaFlags: number };
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
  const [demoOpen, setDemoOpen] = useState(false);
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
              Cargo theft hit a record in 2024 · up 27%
            </div>
            <h1 className="fade-up fade-up-2 text-5xl md:text-6xl lg:text-7xl leading-[0.95] tracking-tight text-[#0B1E3F] mb-6">
              Know who&apos;s on the <span className="serif italic">other end</span> of the rate con.
            </h1>
            <p className="fade-up fade-up-3 text-lg md:text-xl text-[#0B1E3F]/70 max-w-xl mb-10 leading-relaxed">
              Verify any broker or carrier in seconds. Cross-checks FMCSA (including the officer names on file), the company website, social presence, and Google Business listing — catching double-brokers, ghost MCs, and spoofed identities before you hook the trailer or hand off the load.
            </p>
            <div className="fade-up fade-up-4 flex flex-col sm:flex-row gap-3 mb-12">
              <button onClick={() => navigate('signup')} className="group px-7 py-4 bg-[#0B1E3F] text-white text-base font-medium rounded-full hover:bg-[#0B1E3F]/90 transition flex items-center justify-center gap-2 card-shadow-lg">
                Check any broker or carrier free <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition" />
              </button>
              <button onClick={() => { setDemoOpen(true); track('demo_opened'); }} className="group px-7 py-4 border border-[#0B1E3F]/20 bg-white text-[#0B1E3F] text-base font-medium rounded-full hover:bg-[#0B1E3F]/5 transition flex items-center justify-center gap-2">
                <PlayCircle className="w-4 h-4" /> Watch 60-sec demo
              </button>
              {demoOpen && <DemoModal onClose={() => setDemoOpen(false)} />}
            </div>
            <div className="fade-up fade-up-5 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-[#0B1E3F]/60">
              <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-[#16A34A]" /> Official FMCSA data</div>
              <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-[#16A34A]" /> 14 data sources per lookup</div>
              <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-[#16A34A]" /> No credit card</div>
            </div>
          </div>
          <div className="lg:col-span-6 fade-up fade-up-3 relative">
            <HeroDashboardMockup />
          </div>
        </div>
      </section>

      <section className="border-y border-[#0B1E3F]/10 bg-white overflow-hidden py-5 text-[#0B1E3F]">
        <div className="flex gap-16 ticker whitespace-nowrap">
          {(() => {
            // Marketing ticker — hardcoded demo data biased toward HIGH RISK /
            // CAUTION so the band reads as "we catch problems," not "everyone
            // is verified." IDs are blurred (last 3 chars masked) and aren't
            // tied to specific real lookups. Do not wire this back to real
            // user history.
            const items: LandingTickerItem[] = [
              { id: 'MC-847•••', verdict: 'HIGH RISK', color: '#DC2626', entity: 'BROKER' },
              { id: 'DOT-3271•••', verdict: 'CAUTION', color: '#F59E0B', entity: 'CARRIER' },
              { id: 'MC-612•••', verdict: 'HIGH RISK', color: '#DC2626', entity: 'BROKER' },
              { id: 'DOT-1547•••', verdict: 'CAUTION', color: '#F59E0B', entity: 'CARRIER' },
              { id: 'MC-921•••', verdict: 'HIGH RISK', color: '#DC2626', entity: 'BROKER' },
              { id: 'DOT-4012•••', verdict: 'CAUTION', color: '#F59E0B', entity: 'BROKER+CARRIER' },
              { id: 'MC-508•••', verdict: 'CAUTION', color: '#F59E0B', entity: 'BROKER' },
              { id: 'DOT-2438•••', verdict: 'HIGH RISK', color: '#DC2626', entity: 'CARRIER' },
              { id: 'MC-704•••', verdict: 'HIGH RISK', color: '#DC2626', entity: 'BROKER' },
              { id: 'DOT-1226•••', verdict: 'HIGH RISK', color: '#DC2626', entity: 'BROKER+CARRIER' },
              { id: 'MC-339•••', verdict: 'CAUTION', color: '#F59E0B', entity: 'CARRIER' },
              { id: 'DOT-2961•••', verdict: 'CAUTION', color: '#F59E0B', entity: 'BROKER' },
              { id: 'MC-128•••', verdict: 'VERIFIED', color: '#16A34A', entity: 'BROKER' },
              { id: 'MC-672•••', verdict: 'HIGH RISK', color: '#DC2626', entity: 'CARRIER' },
              { id: 'DOT-0891•••', verdict: 'CAUTION', color: '#F59E0B', entity: 'BROKER+CARRIER' },
              { id: 'MC-441•••', verdict: 'HIGH RISK', color: '#DC2626', entity: 'BROKER' },
              { id: 'DOT-3271•••', verdict: 'CAUTION', color: '#F59E0B', entity: 'CARRIER' },
              { id: 'MC-203•••', verdict: 'VERIFIED', color: '#16A34A', entity: 'BROKER' },
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
                'Live FMCSA authority, insurance, surety bond, safety rating, BASIC scores, 24-month inspections, and the officer names on the carrier’s FMCSA filing.',
                'Lookalike-domain detection on every carrier email so you spot the impersonator using a real MC.',
                'Chameleon-network detection on shared phones and addresses, plus FMCSA enforcement cross-reference.',
              ]}
              highlight={COI_CHECK_ON ? {
                label: 'COI check',
                text: 'Upload a carrier’s certificate of insurance and see whether it matches what the insurer filed with FMCSA.',
                link: 'See how it works',
                onClick: () => document.getElementById('coi-check')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
              } : undefined}
              cta="Start verifying carriers"
              onClick={() => navigate('signup')}
            />
            <RoleCard
              icon={Truck}
              accent="#FF6B35"
              role="Carriers"
              tagline="Verify brokers before you hook the trailer."
              points={[
                'MC, DOT, surety bond, address, and website cross-checked in one lookup, plus the officer names and phone FMCSA has on file.',
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
                'Drop the rate con PDF. We open the file, rebuild every saved version, and show the exact text that changed, before and after.',
                'Flags white-out boxes, text typed on top, hidden text, and online editors like iLovePDF. Filled-in form fields and signatures aren’t flagged.',
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
            <BigStat value="14" label="data sources per lookup" />
            <BigStat value="FMCSA" label="official federal data" />
            <BigStat value="1 verdict" label="in plain English" />
            <BigStat value="3 free" label="lookups every month" />
          </div>
        </div>
      </section>

      <section className="py-24 px-6 bg-[#0B1E3F] relative overflow-hidden">
        <div className="absolute inset-0 grid-bg-dark opacity-60" />
        <div className="relative max-w-7xl mx-auto">
          <div className="mb-16 max-w-3xl">
            <div className="text-xs mono uppercase tracking-[0.2em] text-[#FF6B35] mb-4">— In the wild</div>
            <h2 className="text-4xl md:text-6xl leading-[1.05] mb-6 text-white">
              A real rate con. A real scam. <span className="serif italic text-[#FF6B35]">Caught before the load moved.</span>
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
            <FeatureCard icon={Search} iconBg="#0B1E3F" title="FMCSA verification" desc="Type an MC, DOT, or company name and pick the right company as you type. Carrier and broker authority shown separately, plus authority age, insurance on file, safety rating, and crash history — pulled live from the federal registry." stat="Live" statLabel="from FMCSA" />
            <FeatureCard icon={UserCheck} iconBg="#FF6B35" title="Officer names on file" desc="See the company officers on the FMCSA filing (MCS-150), plus the phone and email on it and when it was last updated. Ask for the owner by name, on the number FMCSA has — not the one on the rate con." stat="MCS-150" statLabel="FMCSA company census" />
            <FeatureCard icon={Globe} iconBg="#16A34A" title="Website & domain check" desc="We find the counterparty's real website and check it, and their email domain, against the FMCSA record. Plus WHOIS age, MX and SPF records, and Google Safe Browsing. A domain registered last week is an immediate red flag." stat="WHOIS" statLabel="live domain lookup" />
            <FeatureCard icon={Clock} iconBg="#0B1E3F" title="Inspections, crashes & history" desc="Every roadside inspection and crash from the last 24 months: when, where, each violation, and whether a driver or truck was put out of service. Plus authority, insurance, name, address, and phone changes over time." stat="24 mo" statLabel="every inspection & crash" />
            <FeatureCard icon={MapPin} iconBg="#FF6B35" title="Google Business address" desc="Cross-checks the FMCSA-registered address against Google Places. Flags UPS Store mailboxes, residential homes, and addresses shared by unrelated businesses." stat="Places" statLabel="real-world match" />
            <FeatureCard icon={Users} iconBg="#16A34A" title="Social media footprint" desc="Scans Facebook, LinkedIn, Twitter/X, Instagram, YouTube, and TikTok for the company's presence. Real companies leave a trail. Ghost identities don't." stat="6" statLabel="platforms matched" />
            <FeatureCard icon={Eye} iconBg="#0B1E3F" title="Web reputation scan" desc="Searches FreightWaves, Land Line, TruckersReport, BBB, Reddit, and government enforcement sites for fraud, scam, or lawsuit mentions tied to the carrier or broker." stat="50+" statLabel="trusted sources" />
            <FeatureCard icon={FileText} iconBg="#FF6B35" title="Rate con analyzer" desc="Drop a PDF. We extract the broker, verify the email domain against the registered MC, and flag spoofed letterheads and impersonated identities automatically." stat="AI" statLabel="broker & email extraction" />
            <FeatureCard icon={ScanLine} iconBg="#16A34A" title="PDF tamper check" desc="Drop any PDF. We rebuild every saved version inside the file and show the exact text that changed, plus white-out boxes, typed-on-top text, hidden text, and edits after signing. Filled-in forms and signatures aren't flagged." stat="No AI" statLabel="file checked, not stored" />
          </div>
        </div>
      </section>

      <section className="py-24 px-6 border-t border-[#0B1E3F]/10 bg-[#F5F3EE] text-[#0B1E3F]">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-start">
            <div className="lg:sticky lg:top-24 text-[#0B1E3F]">
              <div className="text-xs mono uppercase tracking-[0.2em] text-[#FF6B35] mb-4">— How it works</div>
              <h2 className="text-4xl md:text-5xl serif italic leading-tight text-[#0B1E3F] mb-6">Rate con to verdict before you sign.</h2>
              <p className="text-[#0B1E3F]/60 text-lg">Haulock pulls from 14 data sources at once. No screens to navigate, no spreadsheets to cross-reference.</p>
            </div>
            <div className="space-y-4">
              {[
                { n: '01', icon: Zap, title: 'Enter MC, DOT, company name, or drop a rate con', desc: 'Works with any identifier — for a broker or a carrier. Start typing and pick the right company from the suggestions, or drop a PDF. Upload works from your phone in the cab or the desk.' },
                { n: '02', icon: Database, title: 'We cross-check 14 data sources', desc: 'FMCSA authority & insurance, the officer names on the FMCSA filing, company website, domain WHOIS, social profiles across 6 platforms, Google Business address, web reputation across 50+ trusted news outlets, and more.' },
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
                Haulock opens the file itself, not just its <strong className="text-[#0B1E3F]">hidden metadata</strong>. We rebuild every saved version inside the PDF, compare them page by page, and look for white-out boxes, text typed on top, hidden text, and changes made after signing. Then we tell you in plain English:
              </p>
              <ul className="space-y-3 mb-6 text-[#0B1E3F]/80">
                <li className="flex items-start gap-3"><div className="w-1.5 h-1.5 rounded-full bg-[#DC2626] flex-shrink-0 mt-2" /><span>&ldquo;The rate on page 1 was changed in a later save: $1,400.00 → $1,100.00.&rdquo;</span></li>
                <li className="flex items-start gap-3"><div className="w-1.5 h-1.5 rounded-full bg-[#DC2626] flex-shrink-0 mt-2" /><span>&ldquo;A white box was drawn over the old rate and new text typed on top — saved with iLovePDF.&rdquo;</span></li>
                <li className="flex items-start gap-3"><div className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] flex-shrink-0 mt-2" /><span>&ldquo;All metadata stripped — someone hid what tool they used.&rdquo;</span></li>
                <li className="flex items-start gap-3"><div className="w-1.5 h-1.5 rounded-full bg-[#16A34A] flex-shrink-0 mt-2" /><span>&ldquo;Clean. Form fields were filled in and it was signed — that&apos;s normal. Nothing else changed.&rdquo;</span></li>
              </ul>
              <p className="text-[#0B1E3F]/60 text-sm mb-8 leading-relaxed">
                Changed spots are highlighted on a preview of your PDF. No AI and no broker lookup needed — the file itself is checked, and it&apos;s never stored on our servers.
              </p>
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
                  Likely tampered · 85
                </div>
              </div>
              <div className="space-y-2.5 mb-5">
                <div className="flex items-start gap-3 p-3 bg-[#DC2626]/5 border border-[#DC2626]/15 rounded-lg">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-[#DC2626]" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-[#0B1E3F]">Text changed after it was created: &ldquo;$1,400.00&rdquo; → &ldquo;$1,100.00&rdquo;</div>
                    <div className="text-xs text-[#0B1E3F]/60 mt-0.5">Page 1 · the file still holds the original version from Apr 2, 2026</div>
                  </div>
                  <div className="text-xs mono text-[#0B1E3F]/40">+45</div>
                </div>
                <div className="flex items-start gap-3 p-3 bg-[#DC2626]/5 border border-[#DC2626]/15 rounded-lg">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-[#DC2626]" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-[#0B1E3F]">Saved with an online PDF editor (iLovePDF)</div>
                    <div className="text-xs text-[#0B1E3F]/60 mt-0.5">Brokers normally make PDFs from their TMS or office software</div>
                  </div>
                  <div className="text-xs mono text-[#0B1E3F]/40">+40</div>
                </div>
                <div className="flex items-start gap-3 p-3 bg-[#16A34A]/5 border border-[#16A34A]/15 rounded-lg">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5 text-[#16A34A]" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-[#0B1E3F]">Fillable form, 6 fields filled in</div>
                    <div className="text-xs text-[#0B1E3F]/60 mt-0.5">Form fields are meant to be filled in. That&apos;s normal.</div>
                  </div>
                  <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/40">Normal</div>
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

      {COI_CHECK_ON && (
        <section id="coi-check" className="py-24 px-6 bg-[#F5F3EE] border-t border-[#0B1E3F]/10 text-[#0B1E3F] scroll-mt-20">
          <div className="max-w-7xl mx-auto">
            <div className="grid lg:grid-cols-2 gap-16 items-start">
              <div className="lg:sticky lg:top-24">
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#0B1E3F]/10 text-[#0B1E3F] text-xs mono uppercase tracking-[0.2em] rounded-full mb-5">
                  For brokers · paid plans
                </div>
                <h2 className="text-4xl md:text-5xl leading-[1.05] mb-6 text-[#0B1E3F]">
                  For brokers: <span className="serif italic">check the COI</span> before you book.
                </h2>
                <p className="text-[#0B1E3F]/70 text-lg mb-6 leading-relaxed">
                  A certificate of insurance is easy to fake and easy to outlive — a policy can be cancelled the day after the certificate is printed. Upload the ACORD 25 certificate and Haulock reads the insurers, policies, and coverage on it, then compares them with the filings the carrier&apos;s insurer made with FMCSA:
                </p>
                <ul className="space-y-3 mb-6 text-[#0B1E3F]/80">
                  {[
                    'Is the auto liability policy on file with FMCSA, from the same insurer?',
                    'Is a cancellation pending on that filing?',
                    'Are the dates current, and is the limit at least the FMCSA minimum?',
                    'Was the PDF edited after it was created?',
                  ].map((t) => (
                    <li key={t} className="flex items-start gap-3"><div className="w-1.5 h-1.5 rounded-full bg-[#FF6B35] flex-shrink-0 mt-2" /><span>{t}</span></li>
                  ))}
                </ul>
                <p className="text-[#0B1E3F]/70 text-lg mb-8 leading-relaxed">
                  You get <strong className="text-[#0B1E3F]">match</strong>, <strong className="text-[#0B1E3F]">verify</strong>, or <strong className="text-[#0B1E3F]">mismatch</strong>, with the source of every finding. On verify or mismatch, call the insurer — on a number you look up yourself — before you book.
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <button onClick={() => navigate('signup')} className="px-6 py-3.5 bg-[#0B1E3F] text-white rounded-full font-medium hover:bg-[#0B1E3F]/90 transition inline-flex items-center justify-center gap-2">
                    Start checking COIs <ArrowRight className="w-4 h-4" />
                  </button>
                  <div className="text-xs text-[#0B1E3F]/55 self-center">Carrier {PLANS.carrier.limits.coiChecks}/month · Team {PLANS.team.limits.coiChecks}/month · Fleet unlimited</div>
                </div>
              </div>

              {/* COI result mockup */}
              <div className="bg-white rounded-3xl p-7 card-shadow-lg border border-[#0B1E3F]/10">
                <div className="flex items-center justify-between pb-4 mb-4 border-b border-[#0B1E3F]/10">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 bg-[#0B1E3F]/10 rounded-lg flex items-center justify-center">
                      <ShieldCheck className="w-5 h-5 text-[#0B1E3F]" />
                    </div>
                    <div>
                      <div className="font-semibold text-[#0B1E3F]">coi-acme-trucking.pdf</div>
                      <div className="text-[11px] mono text-[#0B1E3F]/50">ACORD 25 · 1 page · example</div>
                    </div>
                  </div>
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#DC2626]/10 rounded-full text-xs mono uppercase tracking-wider font-semibold text-[#DC2626]">
                    Mismatch
                  </div>
                </div>
                <div className="space-y-2.5 mb-5">
                  <div className="flex items-start gap-3 p-3 bg-[#DC2626]/5 border border-[#DC2626]/15 rounded-lg">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-[#DC2626]" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-[#0B1E3F]">Cancellation pending on FMCSA</div>
                      <div className="text-xs text-[#0B1E3F]/60 mt-0.5">Auto liability filing · cancellation effective in 12 days</div>
                    </div>
                    <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/40">FMCSA</div>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-[#F59E0B]/5 border border-[#F59E0B]/15 rounded-lg">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-[#F59E0B]" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-[#0B1E3F]">Policy number differs from the FMCSA filing</div>
                      <div className="text-xs text-[#0B1E3F]/60 mt-0.5">Same insurer — often a renewal. Confirm with the insurer.</div>
                    </div>
                    <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/40">FMCSA</div>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-[#16A34A]/5 border border-[#16A34A]/15 rounded-lg">
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5 text-[#16A34A]" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-[#0B1E3F]">Insured company matches the FMCSA record</div>
                      <div className="text-xs text-[#0B1E3F]/60 mt-0.5">Acme Trucking LLC · MC-441•••</div>
                    </div>
                    <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/40">COI</div>
                  </div>
                </div>
                <div className="pt-4 border-t border-[#0B1E3F]/10 grid grid-cols-2 gap-2 text-[11px] mono">
                  <div>
                    <div className="text-[#0B1E3F]/50 uppercase tracking-wider">Auto liability on COI</div>
                    <div className="text-[#0B1E3F]">$1,000,000</div>
                  </div>
                  <div>
                    <div className="text-[#0B1E3F]/50 uppercase tracking-wider">FMCSA minimum</div>
                    <div className="text-[#0B1E3F]">$750,000</div>
                  </div>
                  <div>
                    <div className="text-[#0B1E3F]/50 uppercase tracking-wider">Expires</div>
                    <div className="text-[#0B1E3F]">in 7 months</div>
                  </div>
                  <div>
                    <div className="text-[#0B1E3F]/50 uppercase tracking-wider">PDF metadata</div>
                    <div className="text-[#16A34A]">No signs of editing</div>
                  </div>
                </div>
                <div className="mt-4 text-xs text-[#0B1E3F]/60">Before you accept: call the insurer on a number you look up yourself.</div>
              </div>
            </div>

            {/* Forward-to-scan */}
            {SCAN_EMAIL_ON && (
            <div className="mt-16 bg-[#0B1E3F] rounded-3xl p-8 md:p-10 text-white flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-[#FF6B35] flex items-center justify-center flex-shrink-0">
                  <Mail className="w-5 h-5 text-white" />
                </div>
                <div>
                  <div className="mono text-xs uppercase tracking-[0.2em] text-[#FF6B35] mb-2">— Forward to scan</div>
                  <div className="text-2xl md:text-3xl font-semibold mb-2">Or just forward it to <span className="mono text-[#FF6B35]">{SCAN_EMAIL}</span></div>
                  <p className="text-white/70 max-w-2xl">Forward a rate con or a COI from the email on your Haulock account. The verdict comes back in the same thread, usually within a minute. Full reports on paid plans; free accounts get a short preview of rate cons.</p>
                </div>
              </div>
              <button onClick={() => navigate('signup')} className="px-6 py-3.5 bg-white text-[#0B1E3F] rounded-full font-medium hover:bg-white/90 transition inline-flex items-center justify-center gap-2 flex-shrink-0">
                Start free <ArrowRight className="w-4 h-4" />
              </button>
            </div>
            )}
          </div>
        </section>
      )}

      {/* Your own company: check counts + daily FMCSA monitoring (paid).
          The example chart is fixed demo data — marketing surfaces never show
          real searches. */}
      <InspectionShowcase navigate={navigate} />

      <section id="your-company" className="py-24 px-6 bg-white border-t border-[#0B1E3F]/10 text-[#0B1E3F] scroll-mt-20">
        <div className="max-w-7xl mx-auto">
          <div className="mb-12 max-w-3xl">
            <div className="text-xs mono uppercase tracking-[0.2em] text-[#FF6B35] mb-4">— For your own company</div>
            <h2 className="text-4xl md:text-6xl leading-[1.05] mb-6">
              Know who&apos;s checking you. <span className="serif italic text-[#FF6B35]">Know the second your FMCSA record changes.</span>
            </h2>
            <p className="text-[#0B1E3F]/70 text-lg max-w-2xl">
              Brokers and shippers check carriers before every load, and fraudsters hijack carrier identities by quietly changing FMCSA records. Haulock watches your side too.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="p-8 rounded-3xl border border-[#0B1E3F]/10 bg-[#F5F3EE]">
              <div className="w-11 h-11 rounded-xl bg-[#0B1E3F] flex items-center justify-center mb-5"><Eye className="w-5 h-5 text-white" /></div>
              <h3 className="text-2xl font-semibold mb-3">See how often you&apos;re checked</h3>
              <p className="text-[#0B1E3F]/70 leading-relaxed">Every time a broker, carrier or shipper checks your MC on Haulock, it counts. See checks per week and how many different accounts looked you up, with a notice in the app when you&apos;re checked.</p>
              <div className="mt-6 p-4 bg-white rounded-2xl border border-[#0B1E3F]/10">
                <div className="flex items-baseline gap-2"><span className="text-3xl font-semibold">23</span><span className="text-sm text-[#0B1E3F]/60">checks in the last 30 days · by 9 accounts</span></div>
                <div className="flex items-end h-12 mt-3" style={{ gap: 2 }} aria-hidden="true">
                  {[2, 1, 3, 0, 2, 4, 3, 5, 2, 6, 4, 7].map((n, i) => (
                    <div key={i} className="flex-1 rounded-t" style={{ height: `${n ? Math.max(10, (n / 7) * 100) : 6}%`, background: n ? (i === 11 ? '#FF6B35' : '#0B1E3F') : 'rgba(11,30,63,0.12)' }} />
                  ))}
                </div>
                <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/45 mt-2">Example · last 12 weeks</div>
              </div>
              <p className="mt-4 text-xs text-[#0B1E3F]/55">Counts only: we never reveal who searched. Unlocks once you verify the company is yours: a login email on the same domain as your FMCSA filing email, or a code we send to that address. Searches on FMCSA&apos;s own site aren&apos;t visible to anyone.</p>
            </div>
            <div className="p-8 rounded-3xl border border-[#0B1E3F]/10 bg-[#F5F3EE]">
              <div className="w-11 h-11 rounded-xl bg-[#FF6B35] flex items-center justify-center mb-5"><Bell className="w-5 h-5 text-white" /></div>
              <h3 className="text-2xl font-semibold mb-3">Live FMCSA monitoring of your company</h3>
              <p className="text-[#0B1E3F]/70 leading-relaxed">We check your FMCSA record every day: insurance, authority, address, phone, email of record and company officers, plus every new roadside inspection and crash filed on your DOT. If anything changes, you get an email right away.</p>
              <div className="mt-6 p-4 bg-white rounded-2xl border border-[#0B1E3F]/10 text-sm">
                <div className="text-[10px] mono uppercase tracking-wider text-[#DC2626] mb-2">Example alert · Your FMCSA record changed</div>
                <div className="flex justify-between gap-3 py-1.5 border-b border-[#0B1E3F]/5"><span className="text-[#0B1E3F]/60">Email on FMCSA filing</span><span><span className="text-[#0B1E3F]/45 line-through">dispatch@yourco.com</span> → <strong className="text-[#DC2626]">ops@yourco-freight.net</strong></span></div>
                <div className="flex justify-between gap-3 py-1.5"><span className="text-[#0B1E3F]/60">Liability insurance</span><span><span className="text-[#0B1E3F]/45 line-through">$1,000,000</span> → <strong className="text-[#DC2626]">$0</strong></span></div>
              </div>
              <div className="mt-3 p-4 bg-white rounded-2xl border border-[#0B1E3F]/10 text-sm">
                <div className="text-[10px] mono uppercase tracking-wider text-[#DC2626] mb-2">Example alert · New roadside inspection</div>
                <div className="flex items-center justify-between gap-3 flex-wrap"><span><strong>Oct 2</strong> <span className="text-[#0B1E3F]/60">· Joplin, MO · Level II walk-around</span></span><span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#DC2626]/10 text-[#DC2626]">Out of service · vehicle</span></div>
                <div className="text-xs text-[#0B1E3F]/60 mt-1.5">Brake out of adjustment · out of service</div>
              </div>
              <p className="mt-4 text-xs text-[#0B1E3F]/55">The fastest way to catch a hijacked identity, a lapsed policy or an out-of-service inspection before a customer or your insurer does.</p>
            </div>
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <span className="px-3 py-1 rounded-full bg-[#0B1E3F]/5 text-xs mono uppercase tracking-wider text-[#0B1E3F]/70">Included on paid plans</span>
            <button onClick={() => navigate('signup')} className="px-6 py-3 bg-[#0B1E3F] text-white rounded-full font-medium hover:bg-[#0B1E3F]/90 transition inline-flex items-center gap-2">Start free <ArrowRight className="w-4 h-4" /></button>
            <button onClick={() => navigate('pricing')} className="px-6 py-3 border border-[#0B1E3F]/15 rounded-full font-medium hover:bg-[#0B1E3F]/5 transition">See plans</button>
          </div>
        </div>
      </section>

      <section className="py-24 px-6 bg-[#0B1E3F] relative overflow-hidden">
        <div className="absolute inset-0 grid-bg-dark opacity-40" />
        <div className="relative max-w-7xl mx-auto">
          <div className="mb-16 max-w-3xl">
            <div className="text-xs mono uppercase tracking-[0.2em] text-[#FF6B35] mb-4">— Trust & security</div>
            <h2 className="text-4xl md:text-6xl leading-[1.05] text-white mb-6">
              Built on official data. <span className="serif italic text-[#FF6B35]">Your files aren&apos;t kept.</span>
            </h2>
            <p className="text-white/70 text-lg max-w-2xl">
              Every report comes from FMCSA and the other sources at the time you run it, with the date shown. Rate cons and PDFs you upload are read in memory and discarded when the scan finishes. Your history keeps the verdict, not the file.{SCAN_EMAIL_ON && ' Forwarded emails are the exception: our email provider keeps a copy under its own retention policy.'}
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {[
              {
                icon: Database,
                tag: 'Official FMCSA data',
                title: 'From the federal source.',
                desc: 'Authority status, insurance, and inspection history come from FMCSA — the federal source brokers and DOT auditors use. Every report shows when it was run, and Scan again pulls fresh data.',
                stat: 'FMCSA',
                statLabel: 'official source',
              },
              {
                icon: Zap,
                tag: 'AI rate-con analyzer',
                title: 'Reads the PDF like a dispatcher would.',
                desc: 'Our model extracts the broker, MC, and contact details from any rate con. Then it cross-checks the email domain against the registered MC and flags spoofed identities automatically.',
                stat: '14',
                statLabel: 'sources per scan',
              },
              {
                icon: Lock,
                tag: 'Files not kept',
                title: 'Your uploads aren’t stored.',
                desc: 'Uploaded PDFs are read in memory — by us and by our OCR and AI providers, only to produce your result — and discarded when the scan finishes. We never write them to our disks, never sell them, and never use them to train AI models.',
                stat: '0 files',
                statLabel: 'kept after an upload',
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
            <span className="flex items-center gap-2"><Lock className="w-4 h-4 text-[#16A34A]" /> TLS encryption in transit</span>
            <span className="flex items-center gap-2"><Database className="w-4 h-4 text-[#16A34A]" /> Official FMCSA data</span>
            <span className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-[#16A34A]" /> Card payments handled by Stripe</span>
            <span className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-[#16A34A]" /> Uploaded files not stored</span>
          </div>
        </div>
      </section>

      <section className="border-y border-[#0B1E3F]/10 bg-white py-8 text-[#0B1E3F]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-xs mono uppercase tracking-[0.2em] text-[#0B1E3F]/50 mb-5 text-center">— 14 data sources, cross-checked on every lookup</div>
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-3">
            {[
              'FMCSA SAFER', 'L&I authority status', 'MCS-150 officers & contacts', 'Insurance filings', 'Crash & inspection history',
              'Authority & identity history', 'Company website', 'Domain WHOIS', 'DNS (MX / SPF)', 'Google Safe Browsing',
              'Google Business address', 'Social profiles (6 platforms)', 'Disposable email registry', 'Web reputation scan',
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
              { q: 'Where does Haulock get its data?', a: 'Live from the official FMCSA SAFER, L&I, and SMS systems for authority, insurance, surety bond, safety rating, BASIC scores, 24-month inspections, and crash history. FMCSA’s public Company Census for the officer names, phone, and email on the company’s MCS-150 filing. Plus WHOIS and DNS for domain age, MX provider, and DMARC. Google Places for physical address verification. Google Safe Browsing for known threat domains. Brave Search for web reputation across 50+ trusted news outlets. And our own historical snapshot archive going back five years.' },
              { q: 'How is this different from Carrier411 or DAT CarrierWatch?', a: 'Most tools vet in one direction: brokers checking carriers. Haulock works both ways. Carriers verify brokers, brokers verify carriers, and either side can verify shippers. We also catch things those tools do not, like lookalike domains, chameleon-network shared phone numbers, AI-driven rate confirmation analysis, and identity-history snapshots that show when a carrier quietly changed their address or phone.' },
              { q: 'Can I drop a rate confirmation PDF and have it analyzed?', a: 'Yes. Upload any rate con PDF and Haulock runs it through OCR, then through Claude AI to extract the broker, carrier, load, and rate. The same scan checks the broker email domain against their FMCSA-registered website, looks for spoofed lookalike domains, scores the document for fraud language patterns, and pulls a full broker risk report. Most rate cons are scanned in under a minute.' },
              { q: 'Do you have driver-side checks for inspections and crashes?', a: 'Yes. Every report pulls 24 months of FMCSA SMS inspection data: total inspections, vehicle and driver out-of-service rates, BASIC score percentiles across all seven safety BASICs, plus the crash count broken down by fatal, injury, and tow-away. So whether you are vetting a broker before booking or a carrier before dispatching, you see the actual safety history, not just the marketing.' },
              { q: 'What checks run on every lookup?', a: 'Up to 14 sources in parallel: FMCSA SAFER and Company Census (authority, address, MCS-150 officers and contact details), FMCSA L&I (insurance and surety bond), FMCSA SMS (BASICs, inspections, crashes) plus every roadside inspection and crash from FMCSA’s inspection and crash files, MC name lookup, authority, insurance, and identity-change history (name, address, phone), our Day-1 archive, lookalike-domain detection, cross-reference scan for shared phones and addresses, web reputation across major news outlets and forums, linked-entity extraction, Google Places address match, Google Safe Browsing domain check, WHOIS and DNS, and email infrastructure (MX, SPF, DMARC).' },
              { q: 'Can I see who owns a carrier or broker?', a: 'Yes. Reports show the company officers listed on the FMCSA filing (the MCS-150, from FMCSA’s public Company Census), plus the phone and email on that filing and the date it was last updated. Before you book, call the number FMCSA has, not the one on the rate con, and ask for the owner by name. The names are only as current as the company’s last MCS-150 update, which we show next to them. If FMCSA has no names on file, the report says so.' },
              { q: 'Can I see a carrier’s roadside inspections and crashes?', a: 'Yes. Every carrier report lists the roadside inspections and crashes from the last 24 months, from FMCSA’s public inspection and crash files, which are refreshed daily: the date, where it happened, the inspection level, each violation, and whether a driver or truck was put out of service. A month-by-month chart shows whether things are getting better or worse. Inspections reach FMCSA a few days after they happen, and crash records don’t say who was at fault. On paid plans, we also email you each new inspection and crash filed on your own DOT.' },
              { q: 'Does it work for freight brokers?', a: `Yes. Haulock is bidirectional. Brokers use it to verify carriers before dispatching a load, to vet other brokers before co-brokering, and to spot identity-theft patterns where someone is impersonating a real motor carrier. Every check runs in both directions.${COI_CHECK_ON ? ' On paid plans, brokers can also check a carrier’s certificate of insurance against its FMCSA filings.' : ''}` },
              { q: 'Does it work for drivers and owner-operators?', a: 'Yes. Drivers and owner-operators get the most use out of two features. First, the broker verification: paste an MC or DOT before you accept the load and see authority, insurance, surety bond, FMCSA enforcement history, the officer names on the FMCSA filing, and any web-reputation hits from trusted sources. Second, the PDF tamper check: drop the rate confirmation and we open the file, rebuild every saved version, and show exactly what text changed after it was made. That second one catches dispatchers who quietly shaved the rate before forwarding the rate con. Free plan covers 3 broker lookups and 3 PDF scans every month with no credit card.' },
              { q: 'How does the PDF tamper check work?', a: 'We open the PDF itself, not just its metadata. When a PDF is edited and saved, the earlier version often stays inside the file, so we rebuild every saved version and compare them page by page, showing the exact text that changed (before → after). We also look for white-out boxes drawn over text with new text on top, text boxes typed on top of the page, invisible text, changes made after a digital signature, Acrobat “Edit Text” markers, the same font embedded twice, online editors like iLovePDF, Sejda, or Smallpdf, impossible dates, stripped metadata, and JavaScript. Changed spots are highlighted on a preview of your PDF. We also tell you what’s normal, like filled-in form fields, signatures, the text layer on a scan, or a re-save that changed nothing, so an honest document isn’t flagged. No AI and no broker lookup: the file itself is checked, and it isn’t stored. Free plan: 3 scans a month. Paid plans: unlimited.' },
              { q: 'What about my existing TMS?', a: 'Haulock plugs into your workflow without replacing anything. On the Fleet plan, use our API to bring verification directly into your TMS, your dispatch software, your onboarding, or your factor approval flow.' },
              { q: 'How fresh is the FMCSA data?', a: 'For lookups you trigger, we pull live FMCSA in real time. Repeat lookups within 24 hours are served from cache so we do not burn FMCSA quota or slow you down. We also keep an append-only snapshot history of every carrier we have ever scanned, so when an upstream system is down we can still show you the most recent record we have on file.' },
              { q: 'Can I see who is checking my company?', a: 'On paid plans you can see how often your company is checked on Haulock: checks per week, and how many different accounts looked you up. We never show who searched, and nobody can see lookups made on FMCSA\u2019s own site, because FMCSA doesn\u2019t publish them. You also get a notice in the app when your company is checked. To protect other users, these counts unlock only after you verify the company is yours: either your login email is on the same company domain as the email on your FMCSA filing, or you enter a code we email to that address. Paid plans also monitor your own FMCSA record every day and email you if anything changes, including each new roadside inspection or crash filed on your DOT.' },
              { q: 'How accurate are the risk scores?', a: 'A risk score is a signal, not a verdict. It surfaces specific red flags from real public data: missing surety bond, expired insurance, address mismatch, lookalike email domain, BASIC violations, fraud or lawsuit mentions in trusted news sources, and so on. A high score should slow you down. A low score does not mean a load is risk-free. You still make the call. Always verify identity through an independent channel before you book.' },
              { q: 'Can I cancel anytime?', a: 'Yes. No contracts, no questions. Cancel in one click from your settings. Your scan history stays accessible. Subscriptions can also be paused if you want to keep the account but stop billing.' },
              { q: 'Is the data legal for me to use?', a: 'Yes. FMCSA data is public and provided by the U.S. Department of Transportation. WHOIS, DNS, and the public web are public. Google Places and Brave Search are commercial APIs we license for this purpose. Our Terms of Use and Privacy Policy spell out exactly how we collect and display this information.' },
              ...(COI_CHECK_ON ? [
                { q: 'Can Haulock check a carrier’s certificate of insurance (COI)?', a: `Yes, on paid plans. Upload the ACORD 25 certificate${SCAN_EMAIL_ON ? ' (or forward it to us)' : ''} and Haulock uses AI to read the insurers, policies, dates, and limits, then compares them with the filings the carrier’s insurer made with FMCSA: is the auto liability policy on file, is a cancellation pending, is the limit at least the FMCSA minimum, and was the PDF edited after it was created. You get match, verify, or mismatch with the source of every finding. No tool can prove a COI is genuine — on verify or mismatch, call the insurer using a number you look up yourself before you book.` },
              ] : []),
              ...(SCAN_EMAIL_ON ? [
                { q: 'Can I forward a rate con or COI by email?', a: `Yes. Forward the email to ${SCAN_EMAIL} from the address on your Haulock account and the verdict comes back in the same thread, usually within a minute. Paid plans get the full report, saved to your history; free accounts get a short preview of rate cons.` },
              ] : []),
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
            Verify every counterparty before you book. Your first 3 lookups each month are free.
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
  entity: 'BROKER' | 'CARRIER' | 'BROKER+CARRIER';
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
    entity: 'BROKER',
    badgeLabel: 'HIGH RISK', badgeColor: '#DC2626',
    verdictTitle: 'Do not book', verdictLine: '5 critical red flags · Suspected double-brokering', verdictTone: 'danger',
    flags: [
      { s: 'critical', t: 'Matches known fraud pattern (identity reuse)', i: Flag },
      { s: 'critical', t: 'DBA name changed 2× in past 90 days', i: AlertTriangle },
      { s: 'warning', t: 'VOIP phone number · no physical office', i: Phone },
    ],
    scanTime: '1.8s', dataSources: 14,
    communityAlert: 'Web reputation: 4 fraud mentions in trade press · FMCSA enforcement match',
  },
  {
    name: 'Kestrelon Freight Group',
    mc: 'MC-921•••', dot: 'DOT-4012•••', score: 91,
    entity: 'BROKER',
    badgeLabel: 'HIGH RISK', badgeColor: '#DC2626',
    verdictTitle: 'Do not book', verdictLine: '6 critical red flags · Confirmed payment fraud', verdictTone: 'danger',
    flags: [
      { s: 'critical', t: 'Authority granted 9 days ago', i: AlertTriangle },
      { s: 'critical', t: 'Shared address with 4 other entities', i: Building2 },
      { s: 'warning', t: 'Website registered 11 days ago', i: Globe },
    ],
    scanTime: '2.4s', dataSources: 14,
    communityAlert: 'Web reputation: 6 trade-press hits · linked to 4 flagged MCs',
  },
  {
    name: 'Redline Transport Brokerage',
    mc: 'MC-508•••', dot: 'DOT-1884•••', score: 52,
    entity: 'BROKER',
    badgeLabel: 'CAUTION', badgeColor: '#F59E0B',
    verdictTitle: 'Proceed with care', verdictLine: '2 warning signs detected · Verify before booking', verdictTone: 'warn',
    flags: [
      { s: 'warning', t: 'Insurance expires in 14 days', i: Shield },
      { s: 'warning', t: 'BBB complaints on file · trade-press mention', i: Clock },
      { s: 'good', t: 'Authority active 4+ years', i: CheckCircle2 },
    ],
    scanTime: '1.9s', dataSources: 14,
    communityAlert: 'Web reputation: 1 trade-press mention · clean enforcement record',
  },
  {
    name: 'Crossroads Brokerage Partners',
    mc: 'MC-704•••', dot: 'DOT-2961•••', score: 44,
    entity: 'BROKER',
    badgeLabel: 'CAUTION', badgeColor: '#F59E0B',
    verdictTitle: 'Proceed with care', verdictLine: '2 warning signs · Request COI directly from insurer', verdictTone: 'warn',
    flags: [
      { s: 'warning', t: 'Email on free domain (gmail.com)', i: Mail },
      { s: 'warning', t: 'No verifiable physical office', i: MapPin },
      { s: 'good', t: 'No web reputation hits', i: CheckCircle2 },
    ],
    scanTime: '2.0s', dataSources: 14,
    communityAlert: 'No web reputation hits · limited public footprint',
  },
  {
    name: 'Keystone Freight Network',
    mc: 'MC-128•••', dot: 'DOT-0891•••', score: 18,
    entity: 'BROKER+CARRIER',
    badgeLabel: 'VERIFIED', badgeColor: '#16A34A',
    verdictTitle: 'Safe to book', verdictLine: 'All checks passed · Established broker', verdictTone: 'good',
    flags: [
      { s: 'good', t: 'Authority active 12+ years', i: CheckCircle2 },
      { s: 'good', t: 'Insurance current · $1M/$100K', i: Shield },
      { s: 'good', t: 'Verified physical office', i: Building2 },
    ],
    scanTime: '1.7s', dataSources: 14,
    communityAlert: 'Clean across all 14 sources · 12-year authority',
  },
  {
    name: 'Braxtone Logistics LLC',
    mc: 'MC-845•••', dot: 'DOT-3271•••', score: 76,
    entity: 'BROKER',
    badgeLabel: 'HIGH RISK', badgeColor: '#DC2626',
    verdictTitle: 'Do not book', verdictLine: '4 critical red flags · Identity reuse pattern', verdictTone: 'danger',
    flags: [
      { s: 'critical', t: 'MC reactivated 6 days ago after 2-year gap', i: AlertTriangle },
      { s: 'critical', t: 'Same officer name on 3 revoked authorities', i: Flag },
      { s: 'warning', t: 'Email on free domain (gmail.com)', i: Mail },
    ],
    scanTime: '2.1s', dataSources: 14,
    communityAlert: 'Officer linked to 3 revoked authorities (FMCSA archive)',
  },
  {
    name: 'Eastline Cargo Services',
    mc: 'MC-339•••', dot: 'DOT-1547•••', score: 62,
    entity: 'CARRIER',
    badgeLabel: 'CAUTION', badgeColor: '#F59E0B',
    verdictTitle: 'Proceed with care', verdictLine: '3 warning signs · Verify rate con before booking', verdictTone: 'warn',
    flags: [
      { s: 'warning', t: 'Vehicle OOS rate 31.2% · above national avg', i: AlertTriangle },
      { s: 'warning', t: '2 fatal crashes on record (24 mo)', i: Flag },
      { s: 'good', t: 'Authority active 6 years', i: CheckCircle2 },
    ],
    scanTime: '2.0s', dataSources: 14,
    communityAlert: 'Web reputation: 1 mention · 24-month inspection record reviewed',
  },
  {
    name: 'Atlas Carrier Group LLC',
    mc: 'MC-672•••', dot: 'DOT-2438•••', score: 48,
    entity: 'CARRIER',
    badgeLabel: 'CAUTION', badgeColor: '#F59E0B',
    verdictTitle: 'Proceed with care', verdictLine: '2 warning signs detected · Limited operating history', verdictTone: 'warn',
    flags: [
      { s: 'warning', t: 'Authority granted 11 months ago', i: Clock },
      { s: 'warning', t: 'No website on file', i: Globe },
      { s: 'good', t: 'Insurance current · $1M/$100K', i: Shield },
    ],
    scanTime: '1.6s', dataSources: 14,
    communityAlert: 'No web reputation hits · short operating history',
  },
  {
    name: 'Ironvale Freight Lines LLC',
    mc: 'MC-441•••', dot: 'DOT-1226•••', score: 88,
    entity: 'BROKER+CARRIER',
    badgeLabel: 'HIGH RISK', badgeColor: '#DC2626',
    verdictTitle: 'Do not book', verdictLine: '5 critical red flags · Double-brokering pattern', verdictTone: 'danger',
    flags: [
      { s: 'critical', t: 'Email domain registered 9 days ago', i: Flag },
      { s: 'critical', t: 'DBA changed 3× in last 6 months', i: AlertTriangle },
      { s: 'critical', t: 'VOIP phone · address is mailbox center', i: Phone },
    ],
    scanTime: '2.3s', dataSources: 14,
    communityAlert: 'Web reputation: 6 fraud mentions in industry press',
  },
  {
    name: 'Quillmont Freight Solutions',
    mc: 'MC-203•••', dot: 'DOT-0764•••', score: 12,
    entity: 'BROKER',
    badgeLabel: 'VERIFIED', badgeColor: '#16A34A',
    verdictTitle: 'Safe to book', verdictLine: 'All checks passed · Strong payment history', verdictTone: 'good',
    flags: [
      { s: 'good', t: 'Authority active 18+ years', i: CheckCircle2 },
      { s: 'good', t: 'Clean web reputation · featured in trade press', i: Shield },
      { s: 'good', t: 'Verified physical office · 2,400 sqft', i: Building2 },
    ],
    scanTime: '1.5s', dataSources: 14,
    communityAlert: 'Clean across all 14 sources · 18-year authority',
  },
];

// Hero "Watch 60-sec demo": the carrier, broker and driver reels back to back
// (promo-videos composition "demo", rendered to public/demo). Portaled to
// <body> because the hero's fade-up animation (a transform) would otherwise
// trap a fixed overlay inside it.
function DemoModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[60] bg-[#040B1A]/85 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="Haulock demo video">
      <div className="relative" onClick={(e) => e.stopPropagation()}>
        <video
          src="/demo/haulock-demo.mp4"
          poster="/demo/haulock-demo-poster.jpg"
          controls
          autoPlay
          playsInline
          className="block rounded-2xl shadow-2xl bg-black"
          style={{ height: 'min(86vh, 860px)', aspectRatio: '9 / 16', maxWidth: 'calc(100vw - 32px)' }}
        />
        <button onClick={onClose} aria-label="Close demo" className="absolute -top-3 -right-3 w-10 h-10 rounded-full bg-white text-[#0B1E3F] shadow-lg flex items-center justify-center hover:bg-[#F5F3EE] transition">
          <X className="w-5 h-5" />
        </button>
      </div>
    </div>,
    document.body,
  );
}

function HeroDashboardMockup() {
  // Marketing hero deliberately renders only hardcoded HERO_SCENARIOS — never
  // real user lookups — so a visitor's own search history can't appear on the
  // public landing page. Pick a random scenario per page load.
  const [idx, setIdx] = useState<number | null>(null);
  useEffect(() => {
    setIdx(Math.floor(Math.random() * HERO_SCENARIOS.length));
  }, []);
  if (idx === null) {
    return (
      <div className="relative text-[#0B1E3F]">
        <div className="bg-white rounded-3xl card-shadow-lg border border-[#0B1E3F]/10" style={{ minHeight: 540 }} />
      </div>
    );
  }

  const flagColor = (level: 'critical' | 'warning' | 'good') => level === 'critical' ? '#DC2626' : level === 'warning' ? '#F59E0B' : '#16A34A';
  const s: {
    name: string; mc: string; dot: string; score: number;
    badgeLabel: string; badgeColor: string;
    verdictTitle: string; verdictLine: string; verdictTone: 'danger' | 'warn' | 'good';
    flags: { s: 'critical' | 'warning' | 'good'; t: string; i: any }[];
    scanTime: string; dataSources: number;
    communityAlert?: string;
    entity?: string;
    isReal: boolean;
  } = { ...HERO_SCENARIOS[idx], isReal: false };

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
            <div className="text-xl font-semibold text-[#0B1E3F] mb-0.5 flex items-center gap-2 flex-wrap">
              <span>{s.name}</span>
              {s.entity && (
                <span className="px-1.5 py-0.5 rounded text-[10px] mono uppercase tracking-wider bg-[#0B1E3F]/5 text-[#0B1E3F]/65 font-normal">
                  {s.entity}
                </span>
              )}
            </div>
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
          <span className="flex items-center gap-1.5"><Clock className="w-3 h-3" /> Example report</span>
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
  // "Caught" only when the source produced a flag that actually counts
  // toward the score (pts > 0). Informational findings stay green.
  const flagsMatch = (re: RegExp) =>
    Array.isArray(carrier.flags) && carrier.flags.some((f: any) => (Number(f?.pts) || 0) > 0 && re.test(String(f?.title || '')));
  switch (key) {
    case 'fmcsa':
      // SAFER subset: authority status, OOS, MCS-150 freshness.
      return flagsMatch(/no active operating authority|operating authority is not active|out of service|MCS-150|reactivated|authority age under/i);
    case 'fmcsa-li':
      // L&I subset: liability / cargo insurance and broker bond.
      return flagsMatch(/liability insurance|no cargo insurance|surety bond|insurance.*cancelled/i);
    case 'fmcsa-name':
      // Name → MC/DOT resolution. No spooky outcome on its own.
      return false;
    case 'places':
      return flagsMatch(/address resolves to a different business|address is a mail-forwarding|business at this address is closed|address could not be verified/i);
    case 'gsb':
      // Google Safe Browsing flags malicious domains. No emitter today, so this stays green unless we add one.
      return flagsMatch(/safe browsing|known malicious|phishing/i);
    case 'web':
      return flagsMatch(/no website found/i);
    case 'domain':
      return flagsMatch(/email server|website domain registered|no MX/i);
    case 'social':
      // Empty social isn't necessarily spooky for small carriers — keep green.
      return false;
    case 'lookalike':
      return Boolean(carrier.lookalikeMatch);
    case 'chameleon':
      return flagsMatch(/shares a phone|shares an address|cross-reference|chameleon/i);
    case 'reputation':
      return flagsMatch(/^web reputation/i);
    case 'entities':
      return flagsMatch(/other companies named in coverage/i);
    case 'sms':
      return flagsMatch(/BASIC alert/i);
    case 'archive':
      // Reference only — the ~5-year-old archive never affects the score.
      return false;
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

  // 14 source checks — matches the "14 data sources" promise on the
  // homepage and FAQ. Distributed evenly around the radar (~25.7° apart)
  // and sequenced ~750ms apart so the user sees real progress while the
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
    { key: 'fmcsa',      label: 'FMCSA SAFER',                desc: 'Authority status · MCS-150 · operating status · address',               chip: 'mobile.fmcsa.dot.gov',       icon: Shield,        angle:  13, radius: 92, activateAt:   500 },
    { key: 'fmcsa-li',   label: 'FMCSA Licensing & Insurance', desc: 'Liability insurance · cargo coverage · surety bond on file',             chip: 'li-public.fmcsa.dot.gov',    icon: ShieldCheck,   angle:  39, radius: 70, activateAt:  1250 },
    { key: 'fmcsa-name', label: 'MC name lookup',             desc: 'Socrata fallback · resolves company name to MC / DOT',                   chip: 'data.transportation.gov',    icon: Search,        angle:  64, radius: 92, activateAt:  2000 },
    { key: 'sms',        label: 'FMCSA SMS · BASIC scores',   desc: 'Federal safety scoring · BASIC alerts · 24-mo inspections + crashes',    chip: 'ai.fmcsa.dot.gov/SMS',       icon: ShieldCheck,   angle:  90, radius: 70, activateAt:  2750 },
    { key: 'places',     label: 'Google Places',              desc: 'Business address · operating status · mailbox detection',                 chip: 'places.googleapis.com',      icon: MapPin,        angle: 116, radius: 92, activateAt:  3500 },
    { key: 'gsb',        label: 'Google Safe Browsing',       desc: 'Known malicious · phishing · malware domain check',                       chip: 'safebrowsing.google.com',    icon: Lock,          angle: 141, radius: 70, activateAt:  4250 },
    { key: 'domain',     label: 'WHOIS · DNS · email infra',  desc: 'Domain age · registrar · MX records · SPF · DMARC',                       chip: 'WHOIS · DNS · DMARC',        icon: Mail,          angle: 167, radius: 92, activateAt:  5000 },
    { key: 'social',     label: 'Social media footprint',     desc: 'Facebook · LinkedIn · Instagram · X · YouTube · TikTok',                  chip: '6 platforms',                icon: Users,         angle: 193, radius: 70, activateAt:  5750 },
    { key: 'web',        label: 'Web presence',               desc: 'Carrier website discovery via Brave Search',                              chip: 'api.search.brave.com',       icon: Globe,         angle: 219, radius: 92, activateAt:  6500 },
    { key: 'lookalike',  label: 'Lookalike-domain check',     desc: 'Typosquat · homograph swap · TLD swap · subdomain spoof',                 chip: 'Levenshtein ≤ 2',            icon: AlertTriangle, angle: 244, radius: 70, activateAt:  7250 },
    { key: 'chameleon',  label: 'Cross-reference scan',       desc: 'Phone or address shared with another flagged FMCSA record',               chip: 'FMCSA Socrata · Haulock DB', icon: Eye,           angle: 270, radius: 92, activateAt:  8000 },
    { key: 'reputation', label: 'Web fraud reputation',       desc: 'FreightWaves · Land Line · TruckersReport · BBB · Reddit · NCCDB',       chip: '5 fraud queries',            icon: Search,        angle: 296, radius: 70, activateAt:  8750 },
    { key: 'entities',   label: 'Linked-entity extractor',    desc: 'Other companies and MC / DOT numbers named in news coverage',       chip: 'NLP entity scan',            icon: Building2,     angle: 321, radius: 92, activateAt:  9500 },
    { key: 'archive',    label: 'Haulock Day-1 archive',      desc: '5-year FMCSA snapshot history · email-shared MC cross-reference',         chip: 'Haulock archive',            icon: Database,      angle: 347, radius: 70, activateAt: 10250 },
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
        @keyframes count-pulse {
          0%   { transform: scale(1); }
          40%  { transform: scale(1.12); }
          100% { transform: scale(1); }
        }
        .node-pop    { transform-box: fill-box; transform-origin: center; animation: blip-pop 0.55s ease-out forwards; }
        .count-pulse { transform-box: fill-box; transform-origin: center; animation: count-pulse 0.6s ease-out 1; }
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

      {/* Progress — right under the header so it's always on screen. */}
      {(() => {
        const anySpooky = result ? sources.some((s) => isSourceSpooky(s.key, result)) : false;
        return (
          <div className="px-6 md:px-10 pt-4">
            <div className="h-1.5 bg-[#0B1E3F]/8 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-200 ease-linear ${anySpooky ? 'bg-gradient-to-r from-[#DC2626] to-[#FF6B35]' : 'bg-gradient-to-r from-[#16A34A] to-[#0B1E3F]'}`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-[#0B1E3F]/55">
              <div className="mono uppercase tracking-wider truncate">FMCSA · Socrata · Google Places · Brave · WHOIS · DNS · Safe Browsing</div>
              <div className={`mono ${anySpooky ? 'text-[#DC2626] font-semibold' : ''}`}>{progressPct}%</div>
            </div>
          </div>
        );
      })()}

      {/* Body — the 14-source radar (same design as the promo reels) on a dark
          panel, then the per-source detail list below it. */}
      <div className="px-4 md:px-10 pt-4 pb-6">
        {(() => {
          const spookyKeys = result ? sources.filter((s) => isSourceSpooky(s.key, result)).map((s) => s.key) : [];
          const complete = completedCount === sources.length;
          // viewBox 1000×640: ring centred at (500, 320). Labels sit just
          // outside the ring and are hidden on phones (the list below has them).
          const CX = 500, CY = 320, R = 210, LABEL_R = 246;
          // Short names for the radar; the list below keeps the full ones.
          const RADAR_LABEL: Record<string, string> = {
            fmcsa: 'FMCSA SAFER', 'fmcsa-li': 'Insurance & bond', 'fmcsa-name': 'MC name lookup', sms: 'SMS · BASICs',
            places: 'Google Places', gsb: 'Safe Browsing', domain: 'WHOIS · DNS', social: 'Social media', web: 'Web presence',
            lookalike: 'Lookalike domains', chameleon: 'Cross-reference', reputation: 'Fraud reputation', entities: 'Linked entities',
            archive: '5-yr archive',
          };
          const at = (angleDeg: number, r: number) => {
            const rad = (angleDeg - 90) * (Math.PI / 180);
            return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
          };
          return (
            <div
              className="relative rounded-2xl overflow-hidden"
              style={{
                background: 'radial-gradient(70% 70% at 50% 45%, #0B1E3F 0%, #06122A 70%)',
              }}
            >
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  backgroundImage:
                    'linear-gradient(rgba(245,243,238,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(245,243,238,0.035) 1px, transparent 1px)',
                  backgroundSize: '36px 36px',
                }}
              />
              {/* Height-capped so the whole radar fits on screen with the header above it. */}
              <svg viewBox="0 0 1000 640" className="relative w-full max-w-[920px] mx-auto h-auto block" style={{ maxHeight: 'min(46vh, 520px)' }}>
                <defs>
                  <radialGradient id="radar-glow">
                    <stop offset="0%" stopColor="#FF6B35" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#FF6B35" stopOpacity="0" />
                  </radialGradient>
                </defs>
                <circle cx={CX} cy={CY} r={R + 40} fill="url(#radar-glow)" opacity={complete ? 0.9 : 0.5} />
                {[0.35, 0.68, 1].map((k) => (
                  <circle key={k} cx={CX} cy={CY} r={R * k} fill="none" stroke="#F5F3EE" strokeOpacity="0.14" strokeWidth="1.5" />
                ))}

                <g className="radar-sweep" style={{ transformOrigin: `${CX}px ${CY}px` }}>
                  <path
                    d={`M ${CX} ${CY} L ${CX} ${CY - R} A ${R} ${R} 0 0 1 ${at(28, R).x} ${at(28, R).y} Z`}
                    fill="#FF6B35"
                    fillOpacity="0.16"
                  />
                  <line x1={CX} y1={CY} x2={CX} y2={CY - R} stroke="#FF6B35" strokeWidth="2.5" />
                </g>

                {sources.map((s) => {
                  const active = elapsed >= s.activateAt;
                  const spooky = active && spookyKeys.includes(s.key);
                  const p = at(s.angle, R);
                  const color = spooky ? '#DC2626' : '#FF6B35';
                  return (
                    <g key={s.key}>
                      <line
                        x1={CX}
                        y1={CY}
                        x2={p.x}
                        y2={p.y}
                        stroke={active ? color : '#F5F3EE'}
                        strokeOpacity={active ? 0.55 : 0.08}
                        strokeWidth={active ? 2 : 1.2}
                      />
                      {active ? (
                        <g className="node-pop">
                          <circle cx={p.x} cy={p.y} r="15" fill={color} stroke={spooky ? '#FCA5A5' : '#FFD2BF'} strokeWidth="3" />
                          {spooky ? (
                            <text x={p.x} y={p.y + 6} textAnchor="middle" fontSize="18" fontWeight="700" fill="#fff">!</text>
                          ) : (
                            <path d={`M ${p.x - 6} ${p.y} l 4 4.5 l 8 -9`} fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
                          )}
                        </g>
                      ) : (
                        <circle cx={p.x} cy={p.y} r="10" fill="#06122A" stroke="#F5F3EE" strokeOpacity="0.2" strokeWidth="2" />
                      )}
                    </g>
                  );
                })}

                <g className="hidden sm:inline">
                  {sources.map((s) => {
                    const active = elapsed >= s.activateAt;
                    const spooky = active && spookyKeys.includes(s.key);
                    const p = at(s.angle, LABEL_R);
                    const cos = Math.cos((s.angle - 90) * (Math.PI / 180));
                    const sin = Math.sin((s.angle - 90) * (Math.PI / 180));
                    const anchor = Math.abs(cos) < 0.1 ? 'middle' : cos > 0 ? 'start' : 'end';
                    const dy = Math.abs(cos) < 0.1 ? (sin > 0 ? 22 : -8) : Math.abs(cos) < 0.3 ? (sin > 0 ? 16 : -2) : 7;
                    return (
                      <text
                        key={s.key}
                        x={p.x + (anchor === 'start' ? 4 : anchor === 'end' ? -4 : 0)}
                        y={p.y + dy}
                        textAnchor={anchor}
                        fontSize="21"
                        fontWeight="500"
                        style={{ fontFamily: "'Instrument Sans', system-ui, sans-serif" }}
                        fill={spooky ? '#F87171' : active ? '#F5F3EE' : 'rgba(245,243,238,0.28)'}
                      >
                        {RADAR_LABEL[s.key] ?? s.label}
                      </text>
                    );
                  })}
                </g>

                <text
                  x={CX}
                  y={CY + 30}
                  textAnchor="middle"
                  fontSize="128"
                  fontStyle="italic"
                  className={complete ? 'count-pulse' : undefined}
                  style={{ fontFamily: "'Instrument Serif', Georgia, serif", transformOrigin: `${CX}px ${CY}px` }}
                  fill={spookyKeys.length > 0 ? '#F87171' : complete ? '#FF6B35' : '#F5F3EE'}
                >
                  {completedCount}
                </text>
                <text
                  x={CX}
                  y={CY + 72}
                  textAnchor="middle"
                  fontSize="17"
                  letterSpacing="4"
                  fontWeight="600"
                  style={{ fontFamily: "'JetBrains Mono', monospace" }}
                  fill="#F5F3EE"
                >
                  DATA SOURCES
                </text>
              </svg>

              <div className="relative pb-6 -mt-2 flex flex-col items-center gap-4">
                <div
                  className={`mono text-[11px] sm:text-xs uppercase tracking-[0.3em] ${
                    spookyKeys.length > 0 ? 'text-[#F87171] font-semibold' : complete ? 'text-[#4ADE80]' : 'text-[#F5F3EE]/55'
                  }`}
                >
                  {spookyKeys.length > 0
                    ? `⚠ ${spookyKeys.length} red flag${spookyKeys.length === 1 ? '' : 's'} · ${completedCount} / 14 checked`
                    : complete
                      ? `✓ ${completedCount} / 14 cross-checked`
                      : `Cross-checking ${completedCount} / 14…`}
                </div>
                <div className="flex items-center gap-3 mono text-[10px] sm:text-[11px] uppercase tracking-[0.25em]">
                  <span className="px-2 py-1 rounded bg-[#FF6B35] text-white font-semibold">Live</span>
                  <span className="text-[#F5F3EE]">14 data sources in parallel</span>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Sources list — detail for each check, under the radar. */}
        <div className="mt-5">
          <div className="text-[10px] mono uppercase tracking-[0.18em] text-[#0B1E3F]/50 mb-3">Cross-checking 14 sources in parallel</div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-1.5">
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
                <div key={s.key} title={`${s.desc}${s.chip ? ` · ${s.chip}` : ''}`} className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border transition ${cardCls}`}>
                  <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 transition ${iconCls}`}>
                    <StatusIcon className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={`text-xs font-semibold leading-tight truncate ${labelCls}`}>
                      {s.label}
                      {spooky && <span className="ml-1.5 text-[9px] mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#DC2626] text-white align-middle">Caught</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

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
      { sev: 'info'     as const, title: '2 trade-press fraud mentions',     desc: 'FreightWaves · TruckersReport',  pts: 30 },
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
          <div
            className="text-2xl font-semibold text-[#0B1E3F]"
            style={s.isReal ? { filter: 'blur(6px)', userSelect: 'none' } : undefined}
            aria-label={s.isReal ? 'Company name redacted' : undefined}
          >
            {s.name}
          </div>
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

function RoleCard({ icon: Icon, accent, role, tagline, points, cta, onClick, highlight }: {
  icon: any;
  accent: string;
  role: string;
  tagline: string;
  points: string[];
  cta: string;
  onClick: () => void;
  // A new feature called out in its own box (e.g. the COI check on Brokers).
  highlight?: { label: string; text: string; link: string; onClick: () => void };
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
      {highlight && (
        <button onClick={highlight.onClick} className="text-left mb-6 p-4 rounded-xl border border-[#FF6B35]/35 bg-[#FF6B35]/[0.06] hover:bg-[#FF6B35]/10 transition">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[9px] mono uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[#FF6B35] text-white font-bold">New</span>
            <span className="text-sm font-semibold text-[#0B1E3F]">{highlight.label}</span>
          </div>
          <div className="text-sm leading-relaxed text-[#0B1E3F]/75">{highlight.text}</div>
          <div className="text-sm font-medium text-[#FF6B35] mt-2 inline-flex items-center gap-1">{highlight.link} <ArrowRight className="w-3.5 h-3.5" /></div>
        </button>
      )}
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
          {COI_CHECK_ON && (
            <button onClick={() => scrollTo('coi-check')} className="hover:text-[#0B1E3F] flex items-center gap-1.5">
              COI check <span className="text-[9px] mono uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[#FF6B35]/15 text-[#FF6B35] font-bold">New</span>
            </button>
          )}
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
      { label: 'Verify broker / carrier', route: 'verify', data: { tab: 'quick' } },
      { label: 'Rate con analyzer',  route: 'verify',  data: { tab: 'ratecon' } },
      { label: 'API',                href: '/docs/api' },
    ] },
    { t: 'Company', items: [
      { label: 'About',     route: 'about' },
      { label: 'Blog',      route: 'blog' },
      { label: 'Affiliates', route: 'affiliate' },
      { label: 'Contact',   href: 'mailto:contact@haulock.com' },
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
            <div className="text-sm text-white/70 mt-4 max-w-xs">Know who&apos;s on the other end of every rate con.</div>
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
            <span className="flex items-center gap-2"><ShieldCheck className="w-3.5 h-3.5" /> Official FMCSA data</span>
            <span>·</span>
            <span>Not affiliated with FMCSA or USDOT</span>
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
    quote: 'The web-reputation scan is the killer feature. If a broker has burned anyone the trade press wrote about, it shows up in my report before I ever sign the rate con.',
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
          <div className="text-xs mono uppercase tracking-[0.2em] text-[#FF6B35] mb-4">— Built for carriers and brokers</div>
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
          <ShieldCheck className="w-4 h-4" /> Official FMCSA data · Payments by Stripe
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
  const isPassword = type === 'password';
  const [reveal, setReveal] = useState(false);
  const inputType = isPassword && reveal ? 'text' : type;
  return (
    <div>
      <label className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 block mb-2">{label}</label>
      <div className="relative">
        <input
          name={name}
          type={inputType}
          placeholder={placeholder}
          defaultValue={defaultValue}
          required={required}
          autoComplete={autoComplete}
          className={`w-full px-4 py-3 ${isPassword ? 'pr-11' : ''} bg-white border border-[#0B1E3F]/15 rounded-xl focus:outline-none focus:border-[#0B1E3F] transition text-[#0B1E3F] placeholder:text-[#0B1E3F]/30`}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setReveal(v => !v)}
            aria-label={reveal ? 'Hide password' : 'Show password'}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#0B1E3F]/50 hover:text-[#0B1E3F] p-1"
          >
            {reveal ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
      </div>
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
        You agree to indemnify and hold Haulock harmless from any claim, demand, loss, liability, or expense (including reasonable attorneys&rsquo; fees) brought by a third party arising out of or relating to (a) your use of the Service, (b) any decision you made based on a Haulock report, (c) any content you submitted to the Service, or (d) your violation of these Terms or any applicable law.
      </LegalP>

      <LegalH2>8. Acceptable use</LegalH2>
      <LegalP>You agree not to:</LegalP>
      <LegalUl>
        <li>Use the Service to harass, defame, or unlawfully harm any person or company.</li>
        <li>Republish, resell, scrape, or redistribute Haulock reports as your own product or as a substitute for FMCSA data.</li>
        <li>Use the Service to make automated decisions that affect a person or company without human review.</li>
        <li>Attempt to interfere with, reverse engineer, disable, or overload the Service.</li>
      </LegalUl>

      <LegalH2>9. Account, plan, and billing</LegalH2>
      <LegalP>
        Some Haulock features require a paid plan. Pricing, lookup limits, and feature inclusions are described on the pricing page and may change. Subscriptions renew automatically at the published price until canceled. Refunds are handled at our discretion. You are responsible for keeping your billing details up to date and for the actions taken under your account.
      </LegalP>

      <LegalH2>10. Intellectual property</LegalH2>
      <LegalP>
        The Haulock name, logo, design, software, scoring methodology, report layout, and accompanying materials are owned by Haulock and protected by U.S. and international intellectual property laws. The underlying public data we display (such as FMCSA records) is not owned by us and remains the property of its respective publisher. We grant you a limited, non-exclusive, non-transferable license to use the Service for your own legitimate business purposes, subject to these Terms.
      </LegalP>

      <LegalH2>11. Suspension and termination</LegalH2>
      <LegalP>
        We may suspend or terminate your access to the Service at any time, with or without notice, if we reasonably believe you have violated these Terms, abused the Service, or created risk for Haulock or other users. You may close your account at any time from Settings.
      </LegalP>

      <LegalH2>12. Changes to these Terms</LegalH2>
      <LegalP>
        We may update these Terms from time to time. When we make material changes, we will update the &ldquo;Last updated&rdquo; date at the top of this page and, where appropriate, notify account holders by email. Your continued use of the Service after the change takes effect constitutes acceptance of the updated Terms.
      </LegalP>

      <LegalH2>13. Governing law and disputes</LegalH2>
      <LegalP>
        These Terms are governed by the laws of the State of Delaware, United States, without regard to its conflict of laws rules. Any dispute arising out of or relating to the Service or these Terms will be resolved in the state or federal courts located in Delaware, and you consent to personal jurisdiction in those courts. Where applicable law allows, you and Haulock waive any right to a jury trial and to participate in any class action arising out of or relating to the Service.
      </LegalP>

      <LegalH2>14. Contact</LegalH2>
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
        <li><strong>Account deletion.</strong> You can delete your Haulock account from Settings. This removes your account, lookups, watchlist, alerts, and team membership, and removes you from our newsletter list. Backups may persist for up to 30 days before being purged.</li>
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
    setMeta('description', 'Haulock verifies freight brokers and carriers using live FMCSA data, AI rate-con analysis, and a 14-source web-reputation scan. Built by people who lost loads to fraud and decided to stop it.');
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
            Haulock is a freight fraud platform for carriers, brokers, dispatchers, and owner-operators. We verify any motor carrier or broker in seconds using live FMCSA data, AI rate-con analysis, and 14 data sources cross-checked on every lookup.
          </p>
        </div>
      </section>

      <section className="px-6 pb-20">
        <div className="max-w-3xl mx-auto bg-white border border-[#0B1E3F]/10 rounded-2xl p-8 md:p-12 card-shadow">
          <LegalH2>Why we built this</LegalH2>
          <LegalP>
            Cargo theft hit a record in 2024: 3,625 incidents in the U.S. and Canada, up 27% from 2023, with an estimated $455 million stolen (CargoNet). The numbers in industry reports do not show the worst part: most of those losses are absorbed by small carriers who do not have an in-house compliance team, an expensive vetting subscription, or a lawyer on retainer. They had a load, they had a phone call, they had a rate confirmation that looked right, and now the load is gone or the invoice is unpaid.
          </LegalP>
          <LegalP>
            We started Haulock because the tools that already existed were either built only for brokers (vetting carriers in one direction) or priced for enterprise fleets (hundreds of dollars a month, before you make a single lookup). The carrier with three trucks could not afford them. The owner-operator running a single rig had nothing at all.
          </LegalP>

          <LegalH2>What Haulock actually does</LegalH2>
          <LegalP>
            Every lookup runs up to 14 sources in parallel: FMCSA SAFER for authority and address, FMCSA L&amp;I for insurance and surety bond, FMCSA SMS for inspection and crash history, public WHOIS and DNS for domain age and email infrastructure, Google Places for address verification, Google Safe Browsing for known threat domains, Brave Search across 50+ trusted news outlets and forums, FMCSA enforcement cross-reference, linked-entity extraction, plus our historical snapshot archive going back five years.
          </LegalP>
          <LegalP>
            We also analyze rate confirmation PDFs with Claude AI to extract the broker, the carrier, and the load, then cross-check the broker email domain against their FMCSA-registered website to catch lookalike domains. The whole scan usually takes under a minute.
          </LegalP>
          <LegalP>
            Reports also show the company officers on the FMCSA filing, with the phone and email FMCSA has, so you can call the number on record and ask for the owner by name. And the PDF tamper check opens any rate con or document, rebuilds every saved version inside the file, and shows exactly what text changed. That check uses no AI, and the file isn&apos;t stored.
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
// Affiliate program — public application page + authed earnings dashboard
// ---------------------------------------------------------------------------

function AffiliatePage({ navigate, user }: { navigate: any; user?: any }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState(user?.email || '');
  const [audience, setAudience] = useState('');
  const [audienceSize, setAudienceSize] = useState('');
  const [social, setSocial] = useState('');
  const [source, setSource] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-rotating hero slider: three angles on the same promise.
  const heroSlides = [
    {
      tag: 'Passive income',
      title: 'Earn passive income while you drive.',
      sub: 'Drop your code once. Get paid every month a carrier, broker, or driver you sent keeps using Haulock.',
    },
    {
      tag: 'Recurring forever',
      title: 'Get paid every single month.',
      sub: 'Not a one-time bounty. A real recurring check for as long as your referral stays subscribed.',
    },
    {
      tag: 'Refer anyone in trucking',
      title: 'Carriers, brokers, drivers. All pay you.',
      sub: 'Refer fleets to a plan or send individual drivers to the app. Every subscription through you earns.',
    },
  ];
  const [slide, setSlide] = useState(0);
  useEffect(() => {
    if (submitted) return;
    const id = setInterval(() => setSlide((s) => (s + 1) % heroSlides.length), 4500);
    return () => clearInterval(id);
  }, [submitted, heroSlides.length]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const original = document.title;
    document.title = 'Affiliate partners · Earn passive income while you drive · Haulock';
    setMeta('description', 'Become a Haulock affiliate partner and earn recurring commission every single month for every subscription you refer, for as long as that customer keeps paying. Passive income while you drive. Apply in two minutes.');
    return () => { document.title = original; };
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    if (!name.trim() || !email.trim() || message.trim().length < 20) {
      setError('Please fill in your name, email, and a short note about how you plan to promote Haulock (at least 20 characters).');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/affiliate/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, audience, audienceSize, social, source, message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Failed (${res.status})`);
      setSubmitted(true);
    } catch (err: any) {
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-[#F5F3EE] text-[#0B1E3F] flex flex-col">
        <Nav navigate={navigate} user={user} />

        <section className="flex-1 py-20 px-6 relative bg-[#F5F3EE] flex items-center justify-center">
          <div className="absolute inset-0 radial-glow pointer-events-none" />
          <div className="relative max-w-2xl mx-auto text-center">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-[#16A34A] text-white mb-8 card-shadow">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <div className="text-xs mono uppercase tracking-[0.2em] text-[#16A34A] mb-4 font-semibold">Application received</div>
            <h1 className="text-4xl md:text-6xl serif italic text-[#0B1E3F] leading-[1.05] mb-6">
              Thanks{name.trim() ? `, ${name.trim().split(/\s+/)[0]}` : ''}. We&rsquo;ve got it.
            </h1>
            <p className="text-lg text-[#0B1E3F]/70 leading-relaxed max-w-xl mx-auto mb-10">
              Your application landed in our inbox at <span className="mono text-[#0B1E3F]">marketing@viceseo.com</span>. We read every one personally and reply within <strong className="text-[#0B1E3F]">48 hours</strong> with a yes, a no, or a question.
            </p>

            <div className="bg-white border border-[#0B1E3F]/10 rounded-2xl p-6 md:p-8 card-shadow text-left max-w-xl mx-auto">
              <div className="text-xs mono uppercase tracking-wider text-[#FF6B35] font-semibold mb-4">What happens next</div>
              <ol className="space-y-4">
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-7 h-7 rounded-full bg-[#0B1E3F] text-white flex items-center justify-center text-xs mono font-bold">1</span>
                  <div>
                    <div className="text-sm font-semibold text-[#0B1E3F]">We review your application</div>
                    <div className="text-xs text-[#0B1E3F]/60 mt-0.5">A real person reads every submission. Usually within 24-48 hours.</div>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-7 h-7 rounded-full bg-[#0B1E3F] text-white flex items-center justify-center text-xs mono font-bold">2</span>
                  <div>
                    <div className="text-sm font-semibold text-[#0B1E3F]">If you&rsquo;re a fit, we email you a promo code</div>
                    <div className="text-xs text-[#0B1E3F]/60 mt-0.5">Plus the rate we&rsquo;re paying per signup and a link to create your Haulock account.</div>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-7 h-7 rounded-full bg-[#0B1E3F] text-white flex items-center justify-center text-xs mono font-bold">3</span>
                  <div>
                    <div className="text-sm font-semibold text-[#0B1E3F]">You log in to track every redemption live</div>
                    <div className="text-xs text-[#0B1E3F]/60 mt-0.5">The <strong>My earnings</strong> tab updates the moment your code is used at checkout.</div>
                  </div>
                </li>
              </ol>
              <div className="mt-6 pt-5 border-t border-[#0B1E3F]/10 text-xs text-[#0B1E3F]/60 leading-relaxed">
                <strong className="text-[#0B1E3F]">Heads-up:</strong> our reply comes from <span className="mono text-[#0B1E3F]">marketing@viceseo.com</span>. If you don&rsquo;t see it, check spam. The first email from a new sender often lands there.
              </div>
            </div>

            <div className="mt-10 flex items-center justify-center gap-3 flex-wrap">
              <button
                onClick={() => navigate('landing')}
                className="px-6 py-3 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90 transition flex items-center gap-2"
              >
                <ArrowRight className="w-4 h-4 rotate-180" /> Back to Haulock
              </button>
              <button
                onClick={() => { setSubmitted(false); setName(''); setAudience(''); setAudienceSize(''); setSocial(''); setSource(''); setMessage(''); }}
                className="text-xs mono text-[#0B1E3F]/55 hover:text-[#0B1E3F] transition"
              >
                Submit another application
              </button>
            </div>
          </div>
        </section>

        <Footer navigate={navigate} />
      </div>
    );
  }

  const scrollToApply = () => {
    if (typeof document === 'undefined') return;
    document.getElementById('apply')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="min-h-screen bg-[#F5F3EE] text-[#0B1E3F]">
      <Nav navigate={navigate} user={user} />

      {/* Hero: colorful auto-rotating slider */}
      <section className="relative overflow-hidden bg-[#0B1E3F]">
        {/* color blobs */}
        <div className="absolute -top-32 -left-24 w-[28rem] h-[28rem] rounded-full bg-[#FF6B35]/35 blur-[120px] pointer-events-none" />
        <div className="absolute -bottom-40 -right-20 w-[30rem] h-[30rem] rounded-full bg-[#2563EB]/30 blur-[130px] pointer-events-none" />
        <div className="absolute top-1/3 left-1/2 w-80 h-80 rounded-full bg-[#16A34A]/20 blur-[120px] pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-br from-[#0B1E3F] via-[#0B1E3F]/85 to-[#11254A] pointer-events-none" />

        <div className="relative max-w-4xl mx-auto px-6 py-24 md:py-32 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 border border-white/15 backdrop-blur text-white/90 text-xs mono uppercase tracking-[0.18em] mb-8">
            <Sparkles className="w-3.5 h-3.5 text-[#FF6B35]" /> Affiliate partners
          </div>

          {/* rotating slides */}
          <div className="relative min-h-[15rem] md:min-h-[16rem]">
            {heroSlides.map((s, i) => (
              <div
                key={i}
                className={`absolute inset-0 transition-all duration-700 ${i === slide ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}
              >
                <div className="text-xs mono uppercase tracking-[0.2em] text-[#FF6B35] mb-4">{s.tag}</div>
                <h1 className="text-4xl md:text-6xl serif italic text-white leading-[1.05] mb-5 bg-gradient-to-r from-white via-white to-[#FFD9C7] bg-clip-text text-transparent">
                  {s.title}
                </h1>
                <p className="text-lg text-white/70 leading-relaxed max-w-2xl mx-auto">{s.sub}</p>
              </div>
            ))}
          </div>

          {/* slider dots */}
          <div className="flex items-center justify-center gap-2 mt-2 mb-9">
            {heroSlides.map((_, i) => (
              <button
                key={i}
                onClick={() => setSlide(i)}
                aria-label={`Slide ${i + 1}`}
                className={`h-2 rounded-full transition-all ${i === slide ? 'w-8 bg-[#FF6B35]' : 'w-2 bg-white/25 hover:bg-white/40'}`}
              />
            ))}
          </div>

          {/* earnings chips */}
          <div className="flex flex-wrap items-center justify-center gap-2.5 mb-10">
            {['$10 / mo · Carrier', '$20 / mo · Team', '$30 / mo · Fleet', 'Paid every month', 'Refer drivers too'].map((chip, i) => (
              <span key={i} className="px-3.5 py-1.5 rounded-full bg-white/10 border border-white/15 text-white/85 text-xs mono backdrop-blur">
                {chip}
              </span>
            ))}
          </div>

          <div className="flex items-center justify-center gap-3 flex-wrap">
            <button onClick={scrollToApply} className="px-8 py-4 bg-[#FF6B35] text-white rounded-full text-sm font-semibold hover:bg-[#FF6B35]/90 transition flex items-center gap-2 shadow-lg shadow-[#FF6B35]/25">
              Apply for partnership <ArrowRight className="w-4 h-4" />
            </button>
            <button onClick={() => document.getElementById('payouts')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="px-8 py-4 bg-white/10 border border-white/20 text-white rounded-full text-sm font-medium hover:bg-white/15 transition backdrop-blur">
              See how much you earn
            </button>
          </div>
        </div>
      </section>

      {/* Blinking highlight: every affiliate gets a 20%-off promo code */}
      <section className="px-6 -mt-10 mb-16 relative z-10">
        <div className="max-w-3xl mx-auto blink-box bg-white border-2 border-[#FF6B35] rounded-2xl p-6 md:p-8 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#FF6B35] text-white text-xs mono uppercase tracking-[0.18em] mb-3">
            <Sparkles className="w-3.5 h-3.5" /> Built in for every partner
          </div>
          <div className="text-2xl md:text-3xl serif italic text-[#0B1E3F] mb-2">
            Every approved affiliate gets their own promo code with{' '}
            <span className="text-[#FF6B35] not-italic font-bold">20% OFF</span> for their customers.
          </div>
          <p className="text-sm md:text-base text-[#0B1E3F]/65 leading-relaxed max-w-xl mx-auto">
            That discount is your closing tool. Your audience saves 20% the moment they use your code, you earn your recurring commission on every one of them. Everybody wins.
          </p>
        </div>
      </section>

      {/* Why this matters: recurring / compounding / passive */}
      <section className="px-6 pb-16">
        <div className="max-w-5xl mx-auto grid md:grid-cols-3 gap-4">
          {[
            { icon: <TrendingUp className="w-5 h-5" />, title: 'Recurring, not one-off', body: 'You don’t get a one-time bounty. You earn from every subscription, every month, for as long as that customer stays on Haulock.' },
            { icon: <BarChart3 className="w-5 h-5" />, title: 'It compounds', body: 'Month two pays you for last month’s referrals plus this month’s. Keep referring and the monthly check keeps stacking.' },
            { icon: <Truck className="w-5 h-5" />, title: 'Truly passive', body: 'Drop your code in a video description, a newsletter footer, a group pin. It keeps converting and paying while you’re on the road.' },
          ].map((c, i) => (
            <div key={i} className="bg-white border border-[#0B1E3F]/10 rounded-2xl p-6 card-shadow">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-[#0B1E3F] text-white mb-4">{c.icon}</div>
              <div className="font-semibold text-[#0B1E3F] mb-1.5">{c.title}</div>
              <div className="text-sm text-[#0B1E3F]/65 leading-relaxed">{c.body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* The payout system */}
      <section className="px-6 pb-16">
        <div className="max-w-3xl mx-auto bg-white border border-[#0B1E3F]/10 rounded-2xl p-8 md:p-12 card-shadow">
          <div className="text-xs mono uppercase tracking-wider text-[#FF6B35] font-semibold mb-2">The payout system</div>
          <LegalH2>Apply once. Get paid every month.</LegalH2>
          <LegalUl>
            <li><strong>You apply, we review.</strong> Our team reads every application personally. If you&apos;re approved, we issue a unique promo code (e.g. <span className="mono">JOHN20</span>) tied to your account that gives your customers 20% off.</li>
            <li><strong>You share your code.</strong> Drop it on a podcast, a YouTube channel, an email list, a forum, a driver group. Your audience gets 20% off, which is a real reason to use it.</li>
            <li><strong>Refer companies <em>or</em> drivers.</strong> Send a fleet or broker team onto a paid plan, or point individual drivers and owner-operators to Haulock to verify brokers before they accept a load. Either way, every subscription that comes through your code counts.</li>
            <li><strong>They subscribe.</strong> The moment your code is used at checkout, that customer (carrier, broker, or driver) is permanently attributed to you and shows up in your affiliate profile.</li>
            <li><strong>You get paid every month they stay.</strong> While that customer keeps their subscription active, you earn your commission on that subscription <em>every billing cycle</em>. They keep renewing, you keep getting paid.</li>
            <li><strong>Cash out by ACH or Zelle.</strong> We pay out via ACH bank transfer or Zelle. Request a payout from your affiliate page whenever your balance is ready.</li>
            <li><strong>You track it live.</strong> Once approved you get a private affiliate profile where every active referral, the plan they&apos;re on, and your running monthly total update in real time.</li>
          </LegalUl>
          <LegalP>
            No quotas, no exclusivity, no clawbacks once a payout clears. The only thing that ends a commission is the customer cancelling, which is exactly why we built Haulock to be worth keeping.
          </LegalP>
        </div>
      </section>

      {/* How much you earn: depends on the client */}
      <section id="payouts" className="px-6 pb-16 scroll-mt-24">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10">
            <div className="text-xs mono uppercase tracking-[0.2em] text-[#FF6B35] mb-3">What you earn</div>
            <h2 className="text-3xl md:text-4xl serif italic text-[#0B1E3F] mb-3">Bigger client, bigger monthly check.</h2>
            <p className="text-[#0B1E3F]/60 max-w-2xl mx-auto leading-relaxed">
              Flat commission, paid <strong className="text-[#0B1E3F]">every month</strong>, scaled to the plan your referral is on. No math, no tiers to unlock. You know exactly what each signup is worth before you ever share your code.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            {[
              { plan: 'Carrier', price: 49, commission: 10, blurb: 'Owner-operators & solo drivers', accent: false },
              { plan: 'Team', price: 99, commission: 20, blurb: 'Growing dispatch & broker teams', accent: true },
              { plan: 'Fleet', price: 249, commission: 30, blurb: 'Multi-truck fleets & enterprises', accent: false },
            ].map((t) => (
              <div key={t.plan} className={`rounded-2xl p-7 card-shadow border ${t.accent ? 'bg-[#0B1E3F] text-white border-[#0B1E3F]' : 'bg-white text-[#0B1E3F] border-[#0B1E3F]/10'}`}>
                <div className="text-xs mono uppercase tracking-wider mb-1 text-[#FF6B35]">{t.plan} plan</div>
                <div className={`text-sm mb-5 ${t.accent ? 'text-white/60' : 'text-[#0B1E3F]/55'}`}>{t.blurb}</div>
                <div className="flex items-baseline gap-1.5 mb-1">
                  <span className="text-4xl serif italic">${t.commission}</span>
                  <span className={`text-sm ${t.accent ? 'text-white/55' : 'text-[#0B1E3F]/50'}`}>/ mo, per referral</span>
                </div>
                <div className={`text-sm mb-5 ${t.accent ? 'text-white/55' : 'text-[#0B1E3F]/50'}`}>
                  <strong className={t.accent ? 'text-white' : 'text-[#0B1E3F]'}>${t.commission * 12}</strong> a year, for one referral, every year they stay.
                </div>
                <div className={`text-xs pt-4 border-t ${t.accent ? 'border-white/15 text-white/55' : 'border-[#0B1E3F]/10 text-[#0B1E3F]/55'}`}>
                  Customer pays ${t.price}/mo
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 bg-[#FF6B35]/10 border border-[#FF6B35]/25 rounded-2xl p-6 md:p-7 flex items-start gap-4">
            <div className="flex-shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-xl bg-[#FF6B35] text-white"><Sparkles className="w-5 h-5" /></div>
            <div>
              <div className="font-semibold text-[#0B1E3F] mb-1">It stacks while you sleep.</div>
              <div className="text-sm text-[#0B1E3F]/70 leading-relaxed">
                Send <strong>10 Team-plan customers</strong> at <strong>$20/mo</strong> each. That&apos;s <strong>$200 every month</strong>, <strong>$2,400 a year</strong>, without lifting a finger after the referral. Refer more next month and last month&apos;s referrals are still paying you.
              </div>
            </div>
          </div>
          <p className="text-xs text-[#0B1E3F]/45 mt-4 text-center max-w-2xl mx-auto">
            Commission is a flat monthly amount per active referral ($10 Carrier, $20 Team, $30 Fleet), paid for as long as the customer stays subscribed. Plan prices: Carrier $49/mo, Team $99/mo, Fleet $249/mo. Rates are confirmed in writing at approval.
          </p>
        </div>
      </section>

      {/* Who we partner with: relevance + right to choose */}
      <section className="px-6 pb-16">
        <div className="max-w-3xl mx-auto bg-white border border-[#0B1E3F]/10 rounded-2xl p-8 md:p-12 card-shadow">
          <div className="text-xs mono uppercase tracking-wider text-[#FF6B35] font-semibold mb-2">Who we partner with</div>
          <LegalH2>You have to be relevant to trucking.</LegalH2>
          <LegalP>
            This program is for people already trusted inside the freight world: industry podcasters and YouTubers, driver influencers, trade-newsletter writers, freight-forum and driver-group moderators, dispatching and CDL schools, and consultants who work with drivers, carriers, brokers, owner-operators, and fleets every day.
          </LegalP>
          <LegalP>
            We don&apos;t work with coupon-aggregator sites, cashback portals, or audiences with no connection to trucking. A code in front of the wrong people helps no one: not you, not us, not the driver.
          </LegalP>
          <div className="mt-6 flex items-start gap-4 bg-[#0B1E3F]/[0.04] rounded-xl p-5">
            <div className="flex-shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg bg-[#0B1E3F] text-white"><UserCheck className="w-4 h-4" /></div>
            <div className="text-sm text-[#0B1E3F]/75 leading-relaxed">
              <strong className="text-[#0B1E3F]">Every application is reviewed and approved by our team.</strong> We protect the Haulock brand and the people we serve, so we reserve the right to choose who we work with and to decline or end a partnership at our discretion. Applying is not a guarantee of acceptance.
            </div>
          </div>
        </div>
      </section>

      {/* CTA + application form */}
      <section id="apply" className="px-6 pb-16 scroll-mt-24">
        <div className="max-w-3xl mx-auto bg-white border border-[#0B1E3F]/10 rounded-2xl p-8 md:p-12 card-shadow">
          <div className="text-xs mono uppercase tracking-wider text-[#FF6B35] font-semibold mb-2">Apply for partnership</div>
          <h2 className="text-3xl serif italic text-[#0B1E3F] mb-3">Tell us about yourself.</h2>
          <p className="text-[#0B1E3F]/60 leading-relaxed mb-8">
            Takes about two minutes. A real person on our team reviews every submission and replies within 48 hours with a yes, a no, or a question.
          </p>

          <form onSubmit={onSubmit} className="space-y-5">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 block mb-2">Your name <span className="text-[#DC2626] tracking-normal normal-case">required</span></label>
                <input value={name} onChange={(e) => setName(e.target.value)} required className="w-full px-4 py-3 bg-[#F5F3EE] border border-[#0B1E3F]/15 rounded-xl text-[#0B1E3F] focus:outline-none focus:border-[#0B1E3F]" />
              </div>
              <div>
                <label className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 block mb-2">Email <span className="text-[#DC2626] tracking-normal normal-case">required</span></label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full px-4 py-3 bg-[#F5F3EE] border border-[#0B1E3F]/15 rounded-xl text-[#0B1E3F] focus:outline-none focus:border-[#0B1E3F]" />
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 block mb-2">What&apos;s your audience?</label>
                <input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="Podcast, YouTube channel, newsletter, etc." className="w-full px-4 py-3 bg-[#F5F3EE] border border-[#0B1E3F]/15 rounded-xl text-[#0B1E3F] focus:outline-none focus:border-[#0B1E3F] placeholder:text-[#0B1E3F]/30" />
              </div>
              <div>
                <label className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 block mb-2">How big?</label>
                <input value={audienceSize} onChange={(e) => setAudienceSize(e.target.value)} placeholder="e.g. 12k subscribers, 800 weekly listens" className="w-full px-4 py-3 bg-[#F5F3EE] border border-[#0B1E3F]/15 rounded-xl text-[#0B1E3F] focus:outline-none focus:border-[#0B1E3F] placeholder:text-[#0B1E3F]/30" />
              </div>
            </div>
            <div>
              <label className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 block mb-2">Social media profiles &amp; links</label>
              <textarea value={social} onChange={(e) => setSocial(e.target.value)} rows={3} maxLength={1000} placeholder="Drop the links to where your trucking audience lives: YouTube, Instagram, TikTok, X, Facebook group, LinkedIn, your website or newsletter. One per line is fine." className="w-full px-4 py-3 bg-[#F5F3EE] border border-[#0B1E3F]/15 rounded-xl text-[#0B1E3F] focus:outline-none focus:border-[#0B1E3F] placeholder:text-[#0B1E3F]/30 resize-none" />
              <div className="flex items-center gap-3 mt-2 text-[#0B1E3F]/30">
                <Youtube className="w-4 h-4" /><Instagram className="w-4 h-4" /><Facebook className="w-4 h-4" /><Twitter className="w-4 h-4" /><Linkedin className="w-4 h-4" /><Globe className="w-4 h-4" />
              </div>
            </div>
            <div>
              <label className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 block mb-2">How did you find us?</label>
              <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Search, referral, podcast guest, etc." className="w-full px-4 py-3 bg-[#F5F3EE] border border-[#0B1E3F]/15 rounded-xl text-[#0B1E3F] focus:outline-none focus:border-[#0B1E3F] placeholder:text-[#0B1E3F]/30" />
            </div>
            <div>
              <label className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 block mb-2">How do you plan to promote Haulock? <span className="text-[#DC2626] tracking-normal normal-case">required</span></label>
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} required minLength={20} maxLength={2000} placeholder="One paragraph is plenty. Tell us where you&rsquo;d feature it, who you&rsquo;re reaching in the trucking industry, and why Haulock fits your audience." className="w-full px-4 py-3 bg-[#F5F3EE] border border-[#0B1E3F]/15 rounded-xl text-[#0B1E3F] focus:outline-none focus:border-[#0B1E3F] placeholder:text-[#0B1E3F]/30 resize-none" />
              <div className="text-[11px] mono text-[#0B1E3F]/50 mt-1 text-right">{message.length} / 2000</div>
            </div>
            {error && <div className="text-sm text-[#DC2626]">{error}</div>}
            <button type="submit" disabled={submitting} className="px-8 py-4 bg-[#0B1E3F] text-white rounded-xl font-medium hover:bg-[#0B1E3F]/90 transition flex items-center gap-2 disabled:opacity-60">
              {submitting ? 'Sending…' : <>Apply for partnership <ArrowRight className="w-4 h-4" /></>}
            </button>
            <p className="text-xs text-[#0B1E3F]/45 leading-relaxed">
              Submitting an application doesn&apos;t create a partnership. Our team reviews every applicant and we reserve the right to choose who we work with. You&apos;ll hear back within 48 hours either way.
            </p>
          </form>
        </div>
      </section>

      {/* FAQ */}
      <section className="px-6 pb-24">
        <div className="max-w-3xl mx-auto">
          <div className="text-xs mono uppercase tracking-[0.2em] text-[#FF6B35] mb-4">FAQ</div>
          <h2 className="text-3xl md:text-4xl serif italic text-[#0B1E3F] mb-8">Questions partners ask first.</h2>
          <div className="space-y-3">
            {[
              {
                q: 'How much can I actually earn, and how do I get paid?',
                a: 'A flat monthly commission for every active referral: $10 on the Carrier plan, $20 on Team, and $30 on Fleet, paid every month for as long as that customer stays subscribed. No tiers to unlock and no percentages to calculate. We pay out by ACH bank transfer or Zelle, and you request a payout from your affiliate page whenever your balance is ready.',
              },
              {
                q: 'Do my customers get a discount?',
                a: 'Yes. Every approved affiliate gets a unique promo code that gives their customers 20% off. That discount is your closing tool. Your audience saves money the moment they use your code, and you earn your recurring commission on every one of them.',
              },
              {
                q: 'Is this a one-time payment or recurring?',
                a: 'Recurring. This is the whole point of the program. You are not paid a one-off bounty. As long as the customer you referred keeps paying their Haulock subscription, you keep earning your commission on it every billing cycle. Stop promoting tomorrow and the customers you already sent still pay you every month.',
              },
              {
                q: 'Who qualifies to become a partner?',
                a: 'You need a real, relevant audience in the trucking industry: drivers, carriers, brokers, dispatchers, owner-operators, or fleets. Think industry podcasters, YouTubers, newsletter writers, freight-forum and driver-group admins, dispatching/CDL schools, factoring companies, and consultants. We do not accept coupon or cashback sites, or audiences unrelated to freight. Every application is reviewed and approved by our team, and we reserve the right to choose who we work with.',
              },
              {
                q: 'How do I track my referrals and earnings?',
                a: 'Once you are approved you receive your own private affiliate profile. It updates in real time with every active referral, the plan they are on, their signup date, and your running monthly total, and it is where you request your payouts by ACH or Zelle. No spreadsheets, no guessing.',
              },
            ].map((f, i) => <FaqItem key={i} {...f} />)}
          </div>

          <div className="mt-12 text-center bg-[#0B1E3F] rounded-2xl p-10 card-shadow">
            <h3 className="text-2xl md:text-3xl serif italic text-white mb-3">Earn while the wheels turn.</h3>
            <p className="text-white/60 max-w-xl mx-auto mb-7 leading-relaxed">
              Apply now, get approved, share your 20%-off code, and start earning a monthly check from every carrier, broker, and driver you send our way.
            </p>
            <button onClick={scrollToApply} className="px-8 py-4 bg-[#FF6B35] text-white rounded-full text-sm font-semibold hover:bg-[#FF6B35]/90 transition inline-flex items-center gap-2">
              Apply for partnership <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </section>

      <Footer navigate={navigate} />
    </div>
  );
}

type PerPlanCell = { type: 'flat' | 'percent'; value: string };
type PerPlanInput = Record<string, PerPlanCell>; // keyed by `${plan}-${billing}`
const PLAN_BILLING_CELLS: { plan: 'carrier' | 'team' | 'fleet'; billing: 'monthly' | 'annual' }[] = [
  { plan: 'carrier', billing: 'monthly' },
  { plan: 'carrier', billing: 'annual' },
  { plan: 'team',    billing: 'monthly' },
  { plan: 'team',    billing: 'annual' },
  { plan: 'fleet',   billing: 'monthly' },
  { plan: 'fleet',   billing: 'annual' },
];

function AffiliateAssignModal({ user, onClose, onSaved }: { user: any; onClose: () => void; onSaved: () => void }) {
  const [codes, setCodes] = useState<any[] | null>(null);
  const [code, setCode] = useState<string>(user?.affiliateCode || '');
  // Hydrate from existing user if they're already an affiliate so editing
  // an existing config doesn't wipe their values.
  const initialMode: 'uniform' | 'per_plan' = user?.affiliateCommissionMode === 'per_plan' ? 'per_plan' : 'uniform';
  const [mode, setMode] = useState<'uniform' | 'per_plan'>(initialMode);
  const [commissionType, setCommissionType] = useState<'flat' | 'percent'>(user?.affiliateCommissionType || 'flat');
  const [commissionValue, setCommissionValue] = useState<string>(user?.affiliateCommissionValue != null ? String(user.affiliateCommissionValue) : '');
  const initialByPlan: PerPlanInput = (() => {
    const out: PerPlanInput = {};
    const stored = user?.affiliateCommissionByPlan || {};
    for (const { plan, billing } of PLAN_BILLING_CELLS) {
      const key = `${plan}-${billing}`;
      // Prefer the specific plan-billing entry; fall back to the legacy
      // bare-plan entry so admins editing an older config see what it pays.
      const cell = stored[key] ?? stored[plan];
      out[key] = {
        type: cell?.type || 'flat',
        value: cell?.value != null ? String(cell.value) : '',
      };
    }
    return out;
  })();
  const [byPlan, setByPlan] = useState<PerPlanInput>(initialByPlan);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const r = await fetch('/api/admin/promo-codes');
        const j = await r.json();
        if (cancel) return;
        if (!r.ok) { setError(j?.error || 'Could not load promo codes'); setCodes([]); return; }
        setCodes(j.codes || []);
      } catch (e: any) {
        if (!cancel) { setError(e?.message || 'Could not load promo codes'); setCodes([]); }
      }
    })();
    return () => { cancel = true; };
  }, []);

  const save = async () => {
    setError(null);
    if (!code) { setError('Pick a promo code first.'); return; }
    setSaving(true);
    try {
      const payload: any = { userId: user.id, action: 'assign', code, commissionMode: mode };
      if (mode === 'uniform') {
        const value = Number(commissionValue);
        if (!Number.isFinite(value) || value <= 0) { setError('Enter a positive commission number.'); setSaving(false); return; }
        if (commissionType === 'percent' && value > 100) { setError('Percent cannot exceed 100.'); setSaving(false); return; }
        payload.commissionType = commissionType;
        payload.commissionValue = value;
      } else {
        const cleanByPlan: Record<string, { type: 'flat' | 'percent'; value: number }> = {};
        let count = 0;
        for (const { plan, billing } of PLAN_BILLING_CELLS) {
          const key = `${plan}-${billing}`;
          const raw = byPlan[key];
          if (!raw) continue;
          const v = Number(raw.value);
          if (!raw.value || !Number.isFinite(v) || v <= 0) continue;
          if (raw.type === 'percent' && v > 100) { setError(`${plan} ${billing}: percent cannot exceed 100.`); setSaving(false); return; }
          cleanByPlan[key] = { type: raw.type, value: v };
          count += 1;
        }
        if (count === 0) { setError('Set a commission for at least one plan/billing combo.'); setSaving(false); return; }
        payload.commissionByPlan = cleanByPlan;
      }
      const res = await fetch('/api/admin/affiliates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Failed (${res.status})`);
      onSaved();
    } catch (e: any) {
      setError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const unassign = async () => {
    if (!confirm(`Remove affiliate status from ${user.email}?`)) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch('/api/admin/affiliates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, action: 'unassign' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Failed (${res.status})`);
      onSaved();
    } catch (e: any) {
      setError(e?.message || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0B1E3F]/50" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 md:p-8 card-shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-1">
          <div>
            <div className="text-xs mono uppercase tracking-wider text-[#FF6B35] mb-1">Affiliate</div>
            <h2 className="text-2xl serif italic text-[#0B1E3F]">{user?.email}</h2>
            <div className="text-xs mono text-[#0B1E3F]/50 mt-1">{user?.name || 'No name'}</div>
          </div>
          <button onClick={onClose} className="text-[#0B1E3F]/40 hover:text-[#0B1E3F]"><XCircle className="w-5 h-5" /></button>
        </div>

        <div className="space-y-4 mt-6">
          <div>
            <label className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 block mb-2">Stripe promo code</label>
            {codes === null ? (
              <div className="text-sm text-[#0B1E3F]/55">Loading codes…</div>
            ) : codes.length === 0 ? (
              <div className="text-sm text-[#DC2626]">No active Stripe promo codes found. Create one in Stripe Dashboard first, then refresh.</div>
            ) : (
              <select value={code} onChange={(e) => setCode(e.target.value)} className="w-full px-4 py-3 bg-white border border-[#0B1E3F]/15 rounded-xl text-[#0B1E3F] focus:outline-none focus:border-[#0B1E3F]">
                <option value="">— Pick a code —</option>
                {codes.map((c) => {
                  const discount = c.percent_off != null ? `${c.percent_off}% off` : c.amount_off != null ? `$${(c.amount_off/100).toFixed(2)} off` : '';
                  return <option key={c.id} value={c.code}>{c.code}{discount ? ` · ${discount}` : ''}{c.duration ? ` · ${c.duration}` : ''}{c.times_redeemed ? ` · ${c.times_redeemed} used` : ''}</option>;
                })}
              </select>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <label className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60">Commission</label>
              <div className="flex gap-1 p-0.5 bg-[#0B1E3F]/5 rounded-lg text-xs">
                <button
                  type="button"
                  onClick={() => setMode('uniform')}
                  className={`px-3 py-1 rounded font-semibold transition ${mode === 'uniform' ? 'bg-[#0B1E3F] text-white' : 'text-[#0B1E3F]/60 hover:text-[#0B1E3F]'}`}
                >Same for all plans</button>
                <button
                  type="button"
                  onClick={() => setMode('per_plan')}
                  className={`px-3 py-1 rounded font-semibold transition ${mode === 'per_plan' ? 'bg-[#0B1E3F] text-white' : 'text-[#0B1E3F]/60 hover:text-[#0B1E3F]'}`}
                >Per package</button>
              </div>
            </div>

            {mode === 'uniform' ? (
              <>
                <div className="flex gap-2">
                  <div className="flex gap-1 p-0.5 bg-[#0B1E3F]/5 rounded-lg">
                    <button type="button" onClick={() => setCommissionType('flat')} className={`px-3 py-2 rounded text-xs font-semibold mono transition ${commissionType === 'flat' ? 'bg-[#0B1E3F] text-white' : 'text-[#0B1E3F]/60 hover:text-[#0B1E3F]'}`}>$ flat</button>
                    <button type="button" onClick={() => setCommissionType('percent')} className={`px-3 py-2 rounded text-xs font-semibold mono transition ${commissionType === 'percent' ? 'bg-[#0B1E3F] text-white' : 'text-[#0B1E3F]/60 hover:text-[#0B1E3F]'}`}>% of paid</button>
                  </div>
                  <div className="flex-1 relative">
                    <input
                      type="number" min="0" step="any"
                      value={commissionValue}
                      onChange={(e) => setCommissionValue(e.target.value)}
                      placeholder={commissionType === 'flat' ? '10' : '20'}
                      className="w-full px-4 py-3 pr-10 bg-white border border-[#0B1E3F]/15 rounded-xl text-[#0B1E3F] focus:outline-none focus:border-[#0B1E3F]"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm mono text-[#0B1E3F]/40">{commissionType === 'flat' ? '$' : '%'}</span>
                  </div>
                </div>
                <div className="text-[11px] text-[#0B1E3F]/55 mt-2">
                  {commissionType === 'flat'
                    ? `${user.email} earns $${commissionValue || '—'} for every paid subscription created with this code, regardless of plan.`
                    : `${user.email} earns ${commissionValue || '—'}% of what each customer actually paid (post-discount), regardless of plan.`}
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-[80px_1fr_1fr] gap-2 items-center">
                  <div></div>
                  <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55 text-center">Monthly</div>
                  <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55 text-center">Annual</div>

                  {(['carrier', 'team', 'fleet'] as const).map((plan) => {
                    const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1);
                    const renderCell = (billing: 'monthly' | 'annual') => {
                      const key = `${plan}-${billing}`;
                      const row = byPlan[key];
                      const update = (patch: Partial<PerPlanCell>) =>
                        setByPlan((b) => ({ ...b, [key]: { ...b[key], ...patch } }));
                      return (
                        <div key={billing} className="flex items-center gap-1.5">
                          <div className="flex gap-0.5 p-0.5 bg-[#0B1E3F]/5 rounded-md flex-shrink-0">
                            <button type="button" onClick={() => update({ type: 'flat' })} className={`px-2 py-1 rounded text-[10px] font-semibold mono transition ${row.type === 'flat' ? 'bg-[#0B1E3F] text-white' : 'text-[#0B1E3F]/60 hover:text-[#0B1E3F]'}`}>$</button>
                            <button type="button" onClick={() => update({ type: 'percent' })} className={`px-2 py-1 rounded text-[10px] font-semibold mono transition ${row.type === 'percent' ? 'bg-[#0B1E3F] text-white' : 'text-[#0B1E3F]/60 hover:text-[#0B1E3F]'}`}>%</button>
                          </div>
                          <div className="flex-1 relative min-w-0">
                            <input
                              type="number" min="0" step="any"
                              value={row.value}
                              onChange={(e) => update({ value: e.target.value })}
                              placeholder={billing === 'monthly' ? '10' : '100'}
                              className="w-full px-2.5 py-1.5 pr-6 bg-white border border-[#0B1E3F]/15 rounded-md text-sm text-[#0B1E3F] focus:outline-none focus:border-[#0B1E3F]"
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] mono text-[#0B1E3F]/40">{row.type === 'flat' ? '$' : '%'}</span>
                          </div>
                        </div>
                      );
                    };
                    return (
                      <React.Fragment key={plan}>
                        <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/65">{planLabel}</div>
                        {renderCell('monthly')}
                        {renderCell('annual')}
                      </React.Fragment>
                    );
                  })}
                </div>
                <div className="text-[11px] text-[#0B1E3F]/55 mt-3 leading-relaxed">
                  Leave a cell blank to pay <strong>$0</strong> for that plan + billing combo. Free plan never has commission since it&rsquo;s not a paid signup. Annual customers pay 12&times; what monthly do, so a flat-rate annual commission usually makes sense to be higher.
                </div>
              </>
            )}
          </div>

          {error && <div className="text-sm text-[#DC2626]">{error}</div>}

          <div className="flex gap-2 pt-2">
            {user?.role === 'affiliate' && (
              <button type="button" onClick={unassign} disabled={saving} className="px-4 py-3 border border-[#DC2626]/30 rounded-full text-sm font-medium text-[#DC2626] hover:bg-[#DC2626]/5 disabled:opacity-60">
                Remove affiliate
              </button>
            )}
            <button type="button" onClick={onClose} className="ml-auto py-3 px-5 border border-[#0B1E3F]/15 rounded-full font-medium text-[#0B1E3F] hover:bg-[#0B1E3F]/5">Cancel</button>
            <button type="button" onClick={save} disabled={saving} className="py-3 px-6 bg-[#0B1E3F] text-white rounded-full font-medium hover:bg-[#0B1E3F]/90 transition disabled:opacity-60">
              {saving ? 'Saving…' : user?.role === 'affiliate' ? 'Update' : 'Make affiliate'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AffiliatesAdminPanel() {
  type Rate = { type: 'flat' | 'percent'; value: number };
  type AdminCommissionSpec =
    | { mode: 'uniform'; rate: Rate }
    | { mode: 'per_plan'; byPlan: Partial<Record<string, Rate>> };
  type AffiliateRow = {
    id: string;
    email: string;
    name: string;
    code: string | null;
    commission: AdminCommissionSpec | null;
    redemptions: number;
    lifetimeCents: number;
    paidCents: number;
    pendingCents: number;
    availableCents: number;
    pendingRequests: number;
    assignedAt: string | null;
  };
  type PayoutRow = {
    id: string;
    user_id: string;
    amount_cents: number;
    status: 'requested' | 'paid' | 'rejected';
    requested_at: string;
    paid_at: string | null;
    rejected_at: string | null;
    reject_reason: string | null;
    admin_notes: string | null;
    affiliate_code: string | null;
    redemptions_count: number | null;
    user: { email: string; name: string };
  };

  const [affiliates, setAffiliates] = useState<AffiliateRow[] | null>(null);
  const [payouts, setPayouts] = useState<PayoutRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [view, setView] = useState<'pending' | 'all'>('pending');

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const [a, p] = await Promise.all([
        fetch('/api/admin/affiliates').then((r) => r.json()),
        fetch('/api/admin/affiliate-payouts').then((r) => r.json()),
      ]);
      setAffiliates(a?.affiliates || []);
      setPayouts(p?.payouts || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const fmtMoney = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));

  const markPaid = async (p: PayoutRow) => {
    if (!confirm(`Mark ${fmtMoney(p.amount_cents)} as paid to ${p.user.email}? This sends them a confirmation email and resets their balance.`)) return;
    setActing(p.id); setError(null);
    try {
      const r = await fetch('/api/admin/affiliate-payouts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, action: 'pay' }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `Failed (${r.status})`);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Could not mark paid');
    } finally {
      setActing(null);
    }
  };

  const reject = async (p: PayoutRow) => {
    const reason = prompt(`Reject ${fmtMoney(p.amount_cents)} request from ${p.user.email}? Reason (shown to affiliate):`);
    if (reason == null) return;
    setActing(p.id); setError(null);
    try {
      const r = await fetch('/api/admin/affiliate-payouts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, action: 'reject', reason }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `Failed (${r.status})`);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Could not reject');
    } finally {
      setActing(null);
    }
  };

  const pending = (payouts || []).filter((p) => p.status === 'requested');
  const history = (payouts || []).filter((p) => p.status !== 'requested');

  const totalLifetime = (affiliates || []).reduce((s, a) => s + a.lifetimeCents, 0);
  const totalPaid = (affiliates || []).reduce((s, a) => s + a.paidCents, 0);
  const totalPending = (affiliates || []).reduce((s, a) => s + a.pendingCents, 0);
  const totalAvailable = (affiliates || []).reduce((s, a) => s + a.availableCents, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-semibold text-[#0B1E3F]">Affiliates</h2>
          <p className="text-sm text-[#0B1E3F]/60 mt-1">Pending payout requests, lifetime earnings per affiliate, and the full payout ledger.</p>
        </div>
        <button onClick={load} disabled={loading} className="text-xs mono text-[#0B1E3F]/60 hover:text-[#0B1E3F] transition disabled:opacity-50">
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="p-4 bg-[#DC2626]/5 border border-[#DC2626]/25 rounded-xl text-sm text-[#DC2626]">{error}</div>}

      {/* Overall totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Lifetime earned" value={affiliates ? fmtMoney(totalLifetime) : '—'} sub={`${affiliates?.length ?? 0} affiliate${affiliates?.length === 1 ? '' : 's'}`} />
        <Stat label="Already paid" value={affiliates ? fmtMoney(totalPaid) : '—'} />
        <Stat label="Pending requests" value={affiliates ? fmtMoney(totalPending) : '—'} sub={`${pending.length} open`} />
        <Stat label="Available (unpaid)" value={affiliates ? fmtMoney(totalAvailable) : '—'} />
      </div>

      {/* Pending payout requests — top of page because they need action */}
      {pending.length > 0 && (
        <div className="bg-white rounded-2xl border border-[#F59E0B]/30 card-shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-[#0B1E3F]/10 flex items-center justify-between flex-wrap gap-2 bg-[#F59E0B]/5">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-[#0B1E3F]">Pending payout requests</h3>
              <span className="px-2 py-0.5 bg-[#F59E0B]/15 text-[#F59E0B] rounded-full text-[10px] mono uppercase tracking-wider font-semibold">{pending.length} waiting</span>
            </div>
            <div className="text-[11px] mono text-[#0B1E3F]/55">30-day window from request</div>
          </div>
          <div className="divide-y divide-[#0B1E3F]/5">
            {pending.map((p) => {
              const days = daysSince(p.requested_at);
              const overdue = days >= 30;
              return (
                <div key={p.id} className="px-6 py-4 flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-3 flex-wrap">
                      <span className="text-xl font-semibold text-[#0B1E3F] mono">{fmtMoney(p.amount_cents)}</span>
                      <span className="text-sm font-medium text-[#0B1E3F]">{p.user.name || p.user.email}</span>
                      {p.user.name && <span className="text-xs mono text-[#0B1E3F]/55">{p.user.email}</span>}
                    </div>
                    <div className="text-xs mono text-[#0B1E3F]/55 mt-1">
                      Requested {fmtDate(p.requested_at)} · {days}d ago
                      {p.affiliate_code && <> · code {p.affiliate_code}</>}
                      {p.redemptions_count != null && <> · {p.redemptions_count} redemption{p.redemptions_count === 1 ? '' : 's'}</>}
                      {overdue && <span className="ml-2 px-1.5 py-0.5 bg-[#DC2626]/10 text-[#DC2626] rounded text-[9px] uppercase tracking-wider font-semibold">past 30 days</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => reject(p)}
                      disabled={acting === p.id}
                      className="px-3 py-1.5 border border-[#DC2626]/30 text-[#DC2626] rounded-full text-xs font-medium hover:bg-[#DC2626]/5 transition disabled:opacity-50"
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => markPaid(p)}
                      disabled={acting === p.id}
                      className="px-4 py-1.5 bg-[#16A34A] text-white rounded-full text-xs font-medium hover:bg-[#16A34A]/90 transition disabled:opacity-50"
                    >
                      {acting === p.id ? 'Marking…' : 'Mark paid'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Affiliate roster */}
      <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 card-shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-[#0B1E3F]/10 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-[#0B1E3F]">All affiliates</h3>
            <span className="text-xs mono text-[#0B1E3F]/55">{affiliates?.length ?? 0}</span>
          </div>
        </div>
        {!affiliates ? (
          <div className="p-8 text-center text-sm text-[#0B1E3F]/55">{loading ? 'Loading…' : ''}</div>
        ) : affiliates.length === 0 ? (
          <div className="p-10 text-center text-sm text-[#0B1E3F]/55">
            No affiliates yet. Go to <strong>Users</strong>, find someone to promote, and click <strong>Make affiliate</strong>.
          </div>
        ) : (
          <div className="divide-y divide-[#0B1E3F]/5 overflow-x-auto">
            {affiliates.map((a) => (
              <div key={a.id} className="px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-[#0B1E3F]">{a.name || a.email}</span>
                    {a.name && <span className="text-xs mono text-[#0B1E3F]/55">{a.email}</span>}
                  </div>
                  <div className="text-xs mono text-[#0B1E3F]/55 mt-1">
                    {a.code ? <>code <strong className="text-[#0B1E3F]">{a.code}</strong></> : <span className="text-[#DC2626]">no code</span>}
                    {a.code && a.commission && (() => {
                      if (a.commission.mode === 'uniform') {
                        const r = a.commission.rate;
                        return <> · {r.type === 'flat' ? `$${r.value} per signup` : `${r.value}% of paid`}</>;
                      }
                      // Per-plan: collapse the 6 rates into a one-line summary.
                      const byPlan = a.commission.byPlan;
                      const summary: string[] = [];
                      for (const plan of ['carrier', 'team', 'fleet'] as const) {
                        const m = byPlan[`${plan}-monthly`] || byPlan[plan];
                        const y = byPlan[`${plan}-annual`]  || byPlan[plan];
                        if (!m && !y) continue;
                        const fmt = (r?: Rate) => r ? (r.type === 'flat' ? `$${r.value}` : `${r.value}%`) : '—';
                        summary.push(`${plan[0].toUpperCase()} m${fmt(m)}/y${fmt(y)}`);
                      }
                      return <> · per-plan {summary.join(' · ') || 'unset'}</>;
                    })()}
                    · {a.redemptions} redemption{a.redemptions === 1 ? '' : 's'}
                    {a.pendingRequests > 0 && <span className="ml-2 px-1.5 py-0.5 bg-[#F59E0B]/10 text-[#F59E0B] rounded text-[9px] uppercase tracking-wider font-semibold">{a.pendingRequests} pending</span>}
                  </div>
                </div>
                <div className="flex items-center gap-6 flex-wrap text-right">
                  <div>
                    <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/45">Lifetime</div>
                    <div className="text-sm mono font-semibold text-[#0B1E3F]">{fmtMoney(a.lifetimeCents)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/45">Paid</div>
                    <div className="text-sm mono font-semibold text-[#0B1E3F]/65">{fmtMoney(a.paidCents)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/45">Available</div>
                    <div className="text-sm mono font-semibold text-[#16A34A]">{fmtMoney(a.availableCents)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Full payout ledger — paid + rejected */}
      {history.length > 0 && (
        <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 card-shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-[#0B1E3F]/10 flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-base font-semibold text-[#0B1E3F]">Payout ledger</h3>
            <span className="text-xs mono text-[#0B1E3F]/55">{history.length} settled</span>
          </div>
          <div className="divide-y divide-[#0B1E3F]/5 max-h-[600px] overflow-y-auto">
            {history.map((p) => {
              const badge = p.status === 'paid'
                ? <span className="text-[10px] mono uppercase tracking-wider px-2 py-0.5 bg-[#16A34A]/10 text-[#16A34A] rounded-full font-semibold">Paid</span>
                : <span className="text-[10px] mono uppercase tracking-wider px-2 py-0.5 bg-[#DC2626]/10 text-[#DC2626] rounded-full font-semibold">Rejected</span>;
              return (
                <div key={p.id} className="px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-[#0B1E3F] mono">{fmtMoney(p.amount_cents)}</span>
                      {badge}
                      <span className="text-sm text-[#0B1E3F]">{p.user.name || p.user.email}</span>
                    </div>
                    <div className="text-xs mono text-[#0B1E3F]/55 mt-1">
                      Requested {fmtDate(p.requested_at)}
                      {p.status === 'paid' && p.paid_at && <> · paid {fmtDate(p.paid_at)}</>}
                      {p.status === 'rejected' && p.rejected_at && <> · rejected {fmtDate(p.rejected_at)}</>}
                      {p.affiliate_code && <> · code {p.affiliate_code}</>}
                      {p.reject_reason && <span className="text-[#DC2626] ml-2">— {p.reject_reason}</span>}
                    </div>
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

function EarningsPage({ user }: any) {
  type Redemption = {
    id: string;
    customerFirstName: string;
    plan: string | null;
    billing: string | null;
    createdAt: string;
    status: string;
    amountPaidCents: number;
    earningsCents: number;
  };
  type Payout = {
    id: string;
    amount_cents: number;
    status: 'requested' | 'paid' | 'rejected';
    requested_at: string;
    paid_at: string | null;
    rejected_at: string | null;
    reject_reason: string | null;
    affiliate_code: string | null;
    redemptions_count: number | null;
  };
  type CommissionRate = { type: 'flat' | 'percent'; value: number };
  type CommissionSpec =
    | { mode: 'uniform'; rate: CommissionRate }
    | { mode: 'per_plan'; byPlan: Partial<Record<string, CommissionRate>> };
  type Stats = {
    code: { code: string; active: boolean; percent_off: number | null; amount_off: number | null; duration: string | null } | null;
    commission: CommissionSpec;
    summary: {
      totalRedemptions: number;
      totalEarningsCents: number;
      monthEarningsCents: number;
      paidCents: number;
      pendingCents: number;
      availableCents: number;
      canRequest: boolean;
      minRequestCents: number;
      payoutWindowDays: number;
    };
    redemptions: Redemption[];
    payouts: Payout[];
    message?: string;
  };
  const [data, setData] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [requestSuccess, setRequestSuccess] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch('/api/affiliate/stats');
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `Failed (${r.status})`);
      setData(j);
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const fmtMoney = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const addDays = (iso: string, days: number) => {
    const d = new Date(iso);
    d.setDate(d.getDate() + days);
    return d.toISOString();
  };

  const requestPayout = async () => {
    if (!data?.summary.canRequest || requesting) return;
    setRequesting(true); setError(null); setRequestSuccess(null);
    try {
      const r = await fetch('/api/affiliate/payouts', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `Failed (${r.status})`);
      setRequestSuccess(`Requested ${fmtMoney(j.payout.amount_cents)}. We'll send the money within ${data.summary.payoutWindowDays} days.`);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Could not request payout');
    } finally {
      setRequesting(false);
    }
  };

  return (
    <div className="space-y-8 text-[#0B1E3F]">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-2">My earnings</div>
          <h1 className="text-4xl serif italic text-[#0B1E3F]">Every signup. Every dollar.</h1>
          <p className="text-sm text-[#0B1E3F]/60 mt-2">Live from Stripe. Every time someone uses your promo code, this page updates.</p>
        </div>
        <button onClick={load} disabled={loading} className="text-xs mono text-[#0B1E3F]/60 hover:text-[#0B1E3F] transition disabled:opacity-50">
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="p-4 bg-[#DC2626]/5 border border-[#DC2626]/20 rounded-xl text-sm text-[#DC2626]">{error}</div>}

      {/* Code card */}
      <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-6 card-shadow">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-2">Your promo code</div>
            {data?.code ? (
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="text-3xl mono font-bold tracking-tight text-[#0B1E3F]">{data.code.code}</span>
                <span className="text-sm mono text-[#0B1E3F]/55">
                  {data.code.percent_off != null ? `${data.code.percent_off}% off` : data.code.amount_off != null ? `$${(data.code.amount_off/100).toFixed(2)} off` : ''}
                  {data.code.duration ? ` · ${data.code.duration}` : ''}
                </span>
                {!data.code.active && <span className="text-[10px] mono uppercase tracking-wider px-2 py-0.5 bg-[#DC2626]/10 text-[#DC2626] rounded-full font-semibold">inactive</span>}
              </div>
            ) : (
              <div className="text-sm text-[#0B1E3F]/55">{data?.message || 'No code assigned yet.'}</div>
            )}
          </div>
          {data?.commission && (
            <div className="text-right">
              <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-1">Your commission</div>
              {data.commission.mode === 'uniform' ? (
                <div className="text-xl mono font-semibold text-[#0B1E3F]">
                  {data.commission.rate.type === 'flat' ? `$${data.commission.rate.value} per signup` : `${data.commission.rate.value}% of paid`}
                </div>
              ) : (
                <div className="text-[11px] mono text-[#0B1E3F]/75 leading-relaxed text-right">
                  {(['carrier', 'team', 'fleet'] as const).map((plan) => {
                    const monthly = data.commission.mode === 'per_plan' ? (data.commission.byPlan[`${plan}-monthly`] || data.commission.byPlan[plan]) : null;
                    const annual = data.commission.mode === 'per_plan' ? (data.commission.byPlan[`${plan}-annual`] || data.commission.byPlan[plan]) : null;
                    if (!monthly && !annual) return null;
                    const fmt = (r: CommissionRate | undefined | null) => r ? (r.type === 'flat' ? `$${r.value}` : `${r.value}%`) : '—';
                    return (
                      <div key={plan} className="flex items-center justify-end gap-2">
                        <span className="uppercase tracking-wider text-[#0B1E3F]/55">{plan}</span>
                        <span className="font-semibold">m {fmt(monthly)}</span>
                        <span className="text-[#0B1E3F]/30">·</span>
                        <span className="font-semibold">y {fmt(annual)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-5 card-shadow">
          <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-2">Redemptions</div>
          <div className="text-3xl font-semibold mono">{data ? data.summary.totalRedemptions : '—'}</div>
        </div>
        <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-5 card-shadow">
          <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-2">This month</div>
          <div className="text-3xl font-semibold mono text-[#16A34A]">{data ? fmtMoney(data.summary.monthEarningsCents) : '—'}</div>
        </div>
        <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-5 card-shadow">
          <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-2">Lifetime earned</div>
          <div className="text-3xl font-semibold mono">{data ? fmtMoney(data.summary.totalEarningsCents) : '—'}</div>
        </div>
        <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-5 card-shadow">
          <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-2">Already paid</div>
          <div className="text-3xl font-semibold mono text-[#0B1E3F]/65">{data ? fmtMoney(data.summary.paidCents) : '—'}</div>
        </div>
      </div>

      {/* Available balance + payout request */}
      <div className="bg-gradient-to-br from-[#0B1E3F] to-[#0B1E3F]/92 text-white rounded-2xl p-6 md:p-8 card-shadow">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div>
            <div className="text-xs mono uppercase tracking-wider text-white/55 mb-2">Available to request</div>
            <div className="text-5xl font-semibold mono tracking-tight">{data ? fmtMoney(data.summary.availableCents) : '—'}</div>
            {data && (
              <div className="text-xs mono text-white/55 mt-3 leading-relaxed">
                {fmtMoney(data.summary.totalEarningsCents)} lifetime
                {' '}&minus;{' '}
                {fmtMoney(data.summary.paidCents)} already paid
                {data.summary.pendingCents > 0 && <> &minus; {fmtMoney(data.summary.pendingCents)} pending</>}
              </div>
            )}
          </div>
          <div className="flex flex-col items-stretch md:items-end gap-2">
            <button
              onClick={requestPayout}
              disabled={!data?.summary.canRequest || requesting}
              className="px-6 py-3 bg-white text-[#0B1E3F] rounded-full text-sm font-semibold hover:bg-white/90 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {requesting ? (
                <><div className="w-4 h-4 border-2 border-[#0B1E3F]/30 border-t-[#0B1E3F] rounded-full animate-spin" /> Requesting…</>
              ) : (
                <>Request payout <ArrowRight className="w-4 h-4" /></>
              )}
            </button>
            <div className="text-[11px] mono text-white/55 text-right">
              {data?.summary.pendingCents && data.summary.pendingCents > 0
                ? 'Pending request — wait for it to clear'
                : data && data.summary.availableCents < data.summary.minRequestCents
                  ? `Minimum ${fmtMoney(data.summary.minRequestCents)} to request`
                  : data
                    ? `Paid within ${data.summary.payoutWindowDays} days of request`
                    : ''}
            </div>
          </div>
        </div>

        {requestSuccess && (
          <div className="mt-5 p-4 bg-[#16A34A]/15 border border-[#16A34A]/40 rounded-xl text-sm text-white">
            <CheckCircle2 className="w-4 h-4 inline mr-2" />
            {requestSuccess}
          </div>
        )}
      </div>

      {/* Payout history */}
      {data && data.payouts.length > 0 && (
        <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 card-shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-[#0B1E3F]/10 flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-lg font-semibold text-[#0B1E3F]">Payout history</h2>
            <div className="text-xs mono text-[#0B1E3F]/55">{data.payouts.length} total</div>
          </div>
          <div className="divide-y divide-[#0B1E3F]/5">
            {data.payouts.map((p) => {
              const expectedPaidAt = p.status === 'requested' ? addDays(p.requested_at, data.summary.payoutWindowDays) : null;
              const statusBadge =
                p.status === 'paid' ? <span className="text-[10px] mono uppercase tracking-wider px-2 py-0.5 bg-[#16A34A]/10 text-[#16A34A] rounded-full font-semibold">Paid</span> :
                p.status === 'rejected' ? <span className="text-[10px] mono uppercase tracking-wider px-2 py-0.5 bg-[#DC2626]/10 text-[#DC2626] rounded-full font-semibold">Rejected</span> :
                <span className="text-[10px] mono uppercase tracking-wider px-2 py-0.5 bg-[#F59E0B]/10 text-[#F59E0B] rounded-full font-semibold">Requested</span>;
              return (
                <div key={p.id} className="px-6 py-4 flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-base font-semibold text-[#0B1E3F] mono">{fmtMoney(p.amount_cents)}</span>
                      {statusBadge}
                    </div>
                    <div className="text-xs mono text-[#0B1E3F]/55 mt-1">
                      Requested {fmtDate(p.requested_at)}
                      {p.affiliate_code && <> · code {p.affiliate_code}</>}
                      {p.redemptions_count != null && <> · {p.redemptions_count} redemption{p.redemptions_count === 1 ? '' : 's'}</>}
                    </div>
                  </div>
                  <div className="text-right text-xs mono text-[#0B1E3F]/55">
                    {p.status === 'paid' && p.paid_at && <>Paid {fmtDate(p.paid_at)}</>}
                    {p.status === 'rejected' && p.rejected_at && (
                      <>
                        Rejected {fmtDate(p.rejected_at)}
                        {p.reject_reason && <div className="text-[11px] text-[#DC2626] mt-1">{p.reject_reason}</div>}
                      </>
                    )}
                    {p.status === 'requested' && expectedPaidAt && <>Expected by {fmtDate(expectedPaidAt)}</>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Redemption table */}
      <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 card-shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-[#0B1E3F]/10 flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-lg font-semibold text-[#0B1E3F]">Recent signups</h2>
          <div className="text-xs mono text-[#0B1E3F]/55">{data ? `${data.redemptions.length} total` : ''}</div>
        </div>
        {!data ? (
          <div className="p-8 text-center text-sm text-[#0B1E3F]/55">{loading ? 'Loading…' : ''}</div>
        ) : data.redemptions.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#0B1E3F]/55">
            No signups yet. Once someone uses your promo code at checkout, they&apos;ll show up here.
          </div>
        ) : (
          <div className="divide-y divide-[#0B1E3F]/5">
            {data.redemptions.map((r) => (
              <div key={r.id} className="px-6 py-4 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-[#0B1E3F]/5 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs mono text-[#0B1E3F]/70 font-semibold">{r.customerFirstName.slice(0, 2).toUpperCase()}</span>
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[#0B1E3F]">{r.customerFirstName}</div>
                    <div className="text-xs mono text-[#0B1E3F]/55">
                      {fmtDate(r.createdAt)}
                      {r.plan ? ` · ${r.plan}` : ''}
                      <span className={`ml-1 px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-semibold ${r.status === 'active' || r.status === 'trialing' ? 'bg-[#16A34A]/10 text-[#16A34A]' : 'bg-[#0B1E3F]/5 text-[#0B1E3F]/55'}`}>{r.status}</span>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-[#16A34A] mono">+{fmtMoney(r.earningsCents)}</div>
                  <div className="text-[10px] mono text-[#0B1E3F]/45">customer paid {fmtMoney(r.amountPaidCents)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="text-[11px] mono text-[#0B1E3F]/45 text-right">Source: Stripe (live)</div>
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
            <div className="text-sm text-[#0B1E3F]/70 mb-2">This permanently removes your login, lookup history, watchlist, alerts, and team membership ({user?.email}). It cannot be undone.</div>
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
      const savedAs = data?.mc ? `MC-${data.mc}` : data?.dot ? `USDOT ${data.dot}` : 'your ID';
      setInfo(`Saved as ${savedAs}. Your score is being refreshed in the header.`);
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

// Money collected for Haulock subscriptions (paid Stripe invoices, net of
// refunds and Stripe fees), all-time and by month.
function RevenueCard() {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNet, setShowNet] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const load = async (fresh = false) => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/admin/revenue${fresh ? '?fresh=1' : ''}`);
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
  const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: cents >= 100000 ? 0 : 2 }).format((cents || 0) / 100);
  const val = (t: any) => (t ? (showNet ? t.net : t.gross - t.refunded) : 0);
  const months: any[] = data?.months || [];
  const max = Math.max(1, ...months.map(val));
  const tile = (label: string, t: any, sub?: string) => (
    <div className="p-4 bg-[#0B1E3F]/[0.04] rounded-xl">
      <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">{label}</div>
      <div className="text-2xl font-semibold mt-1">{data ? money(val(t)) : '—'}</div>
      <div className="text-[11px] text-[#0B1E3F]/50 mt-0.5">{data ? `${t?.invoices || 0} payment${t?.invoices === 1 ? '' : 's'}${sub ? ` · ${sub}` : ''}` : ''}</div>
    </div>
  );
  return (
    <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-5 card-shadow text-[#0B1E3F]">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/55">Revenue · subscriptions</div>
        <div className="flex items-center gap-3">
          {/* Collected = paid minus refunds; Net also takes off Stripe's fees. */}
          <div className="flex p-0.5 bg-[#0B1E3F]/5 rounded-full text-xs">
            {([{ id: false, label: 'Collected' }, { id: true, label: 'Net after fees' }] as const).map((o) => (
              <button key={String(o.id)} onClick={() => setShowNet(o.id)} className={`px-3 py-1 rounded-full font-medium ${showNet === o.id ? 'bg-[#0B1E3F] text-white' : 'text-[#0B1E3F]/60'}`}>{o.label}</button>
            ))}
          </div>
          <button onClick={() => load(true)} disabled={loading} className="text-xs mono text-[#0B1E3F]/60 hover:text-[#0B1E3F] disabled:opacity-50">{loading ? 'Loading…' : 'Refresh'}</button>
        </div>
      </div>
      {error && <div className="text-sm text-[#DC2626] mb-3">{error}</div>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {tile('Total earned', data?.allTime, data?.firstMonth ? `since ${data.firstMonth}` : undefined)}
        {tile('This month', data?.thisMonth)}
        {tile('Last month', data?.lastMonth)}
        {tile(`${new Date().getUTCFullYear()} so far`, data?.yearToDate)}
      </div>
      {months.length > 0 && (
        <>
          <div className="flex items-center justify-between text-xs text-[#0B1E3F]/60 mb-2">
            <span>{showNet ? 'Net after Stripe fees' : 'Collected'} per month, last 12 months</span>
            <span className="mono">{hover != null ? `${months[hover].label}: ${money(val(months[hover]))} · ${months[hover].invoices} payment${months[hover].invoices === 1 ? '' : 's'}` : ''}</span>
          </div>
          {/* Single series; whole column is the hover target. */}
          <div className="flex items-end h-36" style={{ gap: 2 }} role="img" aria-label={`Monthly revenue: ${months.map((m) => `${m.label} ${money(val(m))}`).join(', ')}`}>
            {months.map((m, i) => (
              <div key={m.month} className="flex-1 h-full flex items-end cursor-default" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <div className="w-full rounded-t" style={{ height: `${val(m) > 0 ? Math.max(3, (val(m) / max) * 100) : 1.5}%`, background: val(m) > 0 ? (hover === i ? '#FF6B35' : '#0B1E3F') : 'rgba(11,30,63,0.12)' }} />
              </div>
            ))}
          </div>
          <div className="flex text-[10px] mono text-[#0B1E3F]/45 mt-1" style={{ gap: 2 }}>
            {months.map((m) => <div key={m.month} className="flex-1 text-center truncate">{m.label.split(' ')[0]}</div>)}
          </div>
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-xs text-[#0B1E3F]/60 hover:text-[#0B1E3F]">Show as a table</summary>
            <table className="w-full mt-2 text-xs">
              <thead><tr className="text-left text-[#0B1E3F]/55 mono uppercase tracking-wider"><th className="py-1.5">Month</th><th className="text-right">Payments</th><th className="text-right">Collected</th><th className="text-right">Refunds</th><th className="text-right">Stripe fees</th><th className="text-right">Net</th></tr></thead>
              <tbody>
                {[...months].reverse().map((m) => (
                  <tr key={m.month} className="border-t border-[#0B1E3F]/5"><td className="py-1.5">{m.label}</td><td className="text-right mono">{m.invoices}</td><td className="text-right mono">{money(m.gross)}</td><td className="text-right mono">{m.refunded ? `−${money(m.refunded)}` : '—'}</td><td className="text-right mono">{m.fees ? `−${money(m.fees)}` : '—'}</td><td className="text-right mono font-semibold">{money(m.net)}</td></tr>
                ))}
              </tbody>
            </table>
          </details>
          <div className="mt-3 text-[11px] text-[#0B1E3F]/45">
            Paid Stripe invoices for Haulock plans only (the Stripe account&apos;s other products are excluded). Months are UTC.{data?.truncated ? ' Showing the newest 5,000 invoices.' : ''}{data?.cached ? ' Cached up to 10 minutes; Refresh pulls live.' : ''}
          </div>
        </>
      )}
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

// Admin-only "Cart recovery" card — exit-intent modal events, abandoned-
// cart email sends, and live promo-code redemption counts from Stripe.
// Pairs with the abandoned-carts cron + checkout exit-intent modal.
function CartRecoveryCard() {
  type PromoStats = {
    id: string;
    code: string;
    active: boolean;
    times_redeemed: number;
    max_redemptions: number | null;
    coupon_id: string | null;
    percent_off: number | null;
    amount_off: number | null;
    duration: string | null;
  };
  type Stats = {
    exitIntent: {
      shown: { all: number; last30d: number };
      claimed: { all: number; last30d: number };
      dismissed: { all: number; last30d: number };
    };
    emails: {
      abandoned_1h: { all: number; last30d: number };
      abandoned_7d: { all: number; last30d: number };
      total_recovery_rows: { all: number; last30d: number };
    };
    promos: PromoStats[];
    recoveryCode: string;
  };
  const [data, setData] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch('/api/admin/cart-recovery-stats');
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

  // Conversion = claimed / shown. Surfaces whether the modal is actually
  // pulling people back vs. just being annoying.
  const shown = data?.exitIntent.shown.last30d ?? 0;
  const claimed = data?.exitIntent.claimed.last30d ?? 0;
  const claimRate = shown > 0 ? Math.round((claimed / shown) * 100) : null;

  return (
    <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-5 card-shadow text-[#0B1E3F]">
      {(() => {
        const recovery = data?.promos.find((p) => p.code === data?.recoveryCode);
        const recoveryInactive = recovery && !recovery.active;
        return (
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs mono uppercase tracking-wider text-[#FF6B35] font-semibold">Cart recovery</span>
              <span className="px-2 py-0.5 bg-[#FF6B35]/10 text-[#FF6B35] rounded-full text-[10px] mono uppercase tracking-wider font-semibold">
                Last 30 days
              </span>
              {recoveryInactive && (
                <span className="px-2 py-0.5 bg-[#DC2626]/10 text-[#DC2626] rounded-full text-[10px] mono uppercase tracking-wider font-semibold">
                  {data?.recoveryCode} inactive
                </span>
              )}
            </div>
            <button onClick={load} disabled={loading} className="text-xs mono text-[#0B1E3F]/60 hover:text-[#0B1E3F] transition disabled:opacity-50">
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        );
      })()}

      {error && <div className="text-sm text-[#DC2626] mb-3">{error}</div>}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <Stat
          label="Exit modal shown"
          value={data ? data.exitIntent.shown.last30d : '—'}
          sub={data ? `${data.exitIntent.shown.all} all-time` : null}
        />
        <Stat
          label="Code claimed"
          value={data ? data.exitIntent.claimed.last30d : '—'}
          sub={claimRate != null ? `${claimRate}% of shown` : (data ? `${data.exitIntent.claimed.all} all-time` : null)}
        />
        <Stat
          label="Dismissed"
          value={data ? data.exitIntent.dismissed.last30d : '—'}
          sub="Closed without claim"
        />
        <Stat
          label="1h emails sent"
          value={data ? data.emails.abandoned_1h.last30d : '—'}
          sub={data ? `${data.emails.abandoned_1h.all} all-time` : null}
        />
        <Stat
          label="7d emails sent"
          value={data ? data.emails.abandoned_7d.last30d : '—'}
          sub={data ? `${data.emails.abandoned_7d.all} all-time` : null}
        />
      </div>

      <div className="p-4 bg-gradient-to-br from-[#0B1E3F] to-[#0B1E3F]/92 rounded-xl text-white">
        {(() => {
          const promos = data?.promos ?? [];
          const totalRedemptions = promos.reduce((sum, p) => sum + p.times_redeemed, 0);
          const codeCount = promos.length;
          return (
            <>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <div className="text-[10px] mono uppercase tracking-wider text-white/55 mb-1">Promo code redemptions</div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-semibold mono tracking-tight">
                      {data ? totalRedemptions : '—'}
                    </span>
                    <span className="text-xs mono text-white/60">
                      {data ? `across ${codeCount} code${codeCount === 1 ? '' : 's'}` : ''}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] mono uppercase tracking-wider text-white/55">Source</div>
                  <div className="text-xs mono text-white/75 mt-0.5">Stripe (live)</div>
                </div>
              </div>
              {data && promos.length === 0 && (
                <div className="text-xs mono text-white/55 mt-3 pt-3 border-t border-white/10">No promo codes used yet.</div>
              )}
              {promos.length > 0 && (
                <div className="mt-3 pt-3 border-t border-white/10 divide-y divide-white/10">
                  {promos.map((p) => {
                    const discountLabel =
                      p.percent_off != null ? `${p.percent_off}% off`
                      : p.amount_off != null ? `$${(p.amount_off / 100).toFixed(2)} off`
                      : '';
                    return (
                      <div key={p.id} className="flex items-center justify-between py-2 gap-3 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          <span className="text-sm mono font-semibold tracking-tight">{p.code}</span>
                          {discountLabel && (
                            <span className="text-[10px] mono uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-white/10 text-white/70">
                              {discountLabel}
                            </span>
                          )}
                          {p.duration && (
                            <span className="text-[10px] mono uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-white/10 text-white/70">
                              {p.duration}
                            </span>
                          )}
                          {!p.active && (
                            <span className="text-[10px] mono uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[#DC2626]/30 text-white/85">inactive</span>
                          )}
                        </div>
                        <span className="text-sm mono font-semibold whitespace-nowrap">
                          {p.times_redeemed}
                          {p.max_redemptions != null && <span className="text-white/45">/{p.max_redemptions}</span>}
                          <span className="text-white/45 text-xs"> {p.times_redeemed === 1 ? 'redemption' : 'redemptions'}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          );
        })()}
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
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

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

  const syncAll = async () => {
    if (!confirm('Add every confirmed Haulock user to the Resend audience? Idempotent — safe to re-run.')) return;
    setSyncing(true); setSyncResult(null); setError(null);
    try {
      const r = await fetch('/api/admin/sync-resend-audience', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `Failed (${r.status})`);
      setSyncResult(`Synced ${j.total} users · ${j.added} added · ${j.updated} updated · ${j.skipped} skipped${j.errors?.length ? ` · ${j.errors.length} errors` : ''}`);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

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
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-semibold text-[#0B1E3F]">Newsletter</h2>
          <p className="text-xs text-[#0B1E3F]/55 mt-1">Resend Audience contacts + per-contact send count from the email log.</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            onClick={syncAll}
            disabled={syncing}
            className="px-4 py-2 bg-[#0B1E3F] text-white rounded-full text-xs font-medium hover:bg-[#0B1E3F]/90 transition disabled:opacity-50"
            title="Backfill every confirmed Haulock user into the Resend audience. Idempotent."
          >
            {syncing ? 'Syncing…' : 'Sync all users → audience'}
          </button>
          {syncResult && <div className="text-[11px] mono text-[#16A34A] max-w-md text-right">{syncResult}</div>}
        </div>
      </div>

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

// ─── Sales (admin only) ─────────────────────────────────────────────────
// Every non-admin user sorted into an auto-computed funnel segment (from
// /api/admin/sales), with a suggested next step and a built-in email per
// segment. Emails go out through Resend from the composer — one person or
// a whole group — with a live per-recipient preview that can include the
// recipient's own recent lookups. Manual stage / notes / follow-up live in
// sales_leads; sends are logged in sales_campaigns.

type SalesSegment = 'paying' | 'checkout' | 'limit' | 'unconfirmed' | 'new' | 'active' | 'never_used' | 'dormant';
type SalesFilter = 'hot' | 'free' | 'followup' | SalesSegment;
type SalesTemplate = { id: string; name: string; subject: string; body: string; ctaLabel: string; ctaUrl: string; showLookups: boolean; builtIn?: boolean };

const SALES_SIGNOFF = 'Thanks,\nThe Haulock team';

const SALES_SEGMENTS: Record<SalesSegment, { label: string; tone: string; action: string; template: Omit<SalesTemplate, 'id' | 'name'> }> = {
  checkout: {
    label: 'Started checkout', tone: 'bg-[#DC2626]/10 text-[#DC2626]',
    action: 'Hottest lead. They picked a plan but didn’t pay — offer help and the NEW20 code (20% off).',
    template: {
      subject: '{{first_name}}, need a hand finishing your Haulock signup?',
      body: `Hi {{first_name}},\n\nI saw you started signing up for a Haulock plan but didn't finish. Did something get in the way? Just reply and I'll help.\n\n{{lookups}}\n\nCode **NEW20** takes 20% off your first month, so every load you book gets checked first.\n\n${SALES_SIGNOFF}`,
      ctaLabel: 'Finish with 20% off →', ctaUrl: 'https://haulock.com/pricing', showLookups: true,
    },
  },
  limit: {
    label: 'Hit free limit', tone: 'bg-[#FF6B35]/15 text-[#C2410C]',
    action: 'Used all free lookups this month — they clearly need it. Pitch the Carrier plan.',
    template: {
      subject: '{{first_name}}, you’ve used all {{free_limit}} free lookups',
      body: `Hi {{first_name}},\n\nYou've used all {{free_limit}} of your free lookups this month, so Haulock is clearly part of how you book loads.\n\n{{lookups}}\n\nThe **Carrier plan** gives you unlimited lookups, 15 rate con scans a month and alerts when a broker you watch changes, so you never book blind waiting for next month.\n\n${SALES_SIGNOFF}`,
      ctaLabel: 'See plans →', ctaUrl: 'https://haulock.com/pricing', showLookups: true,
    },
  },
  unconfirmed: {
    label: 'Email not confirmed', tone: 'bg-[#0B1E3F]/10 text-[#0B1E3F]/70',
    action: 'Never confirmed their email, so they can’t log in. Send a short personal nudge.',
    template: {
      subject: 'Finish setting up your Haulock account',
      body: `Hi {{first_name}},\n\nYou signed up for Haulock but haven't confirmed your email yet, so you can't log in. Look for our confirmation email (check spam too), or just reply here and I'll sort it out.\n\n{{lookups}}\n\n${SALES_SIGNOFF}`,
      ctaLabel: 'Log in to Haulock →', ctaUrl: 'https://haulock.com/login', showLookups: true,
    },
  },
  new: {
    label: 'New — not tried yet', tone: 'bg-[#2563EB]/10 text-[#2563EB]',
    action: 'Signed up this week but hasn’t run a lookup. Show them how to check their first broker.',
    template: {
      subject: '{{first_name}}, check your first broker in 10 seconds',
      body: `Hi {{first_name}},\n\nWelcome to Haulock! The quickest way to see what it does: pick MC or DOT, type the number from your next rate con, and you'll get a risk score and any red flags in seconds.\n\n{{lookups}}\n\nYou have {{free_limit}} free lookups every month. Any questions, just reply.\n\n${SALES_SIGNOFF}`,
      ctaLabel: 'Run my first check →', ctaUrl: 'https://haulock.com/verify', showLookups: true,
    },
  },
  active: {
    label: 'Active free user', tone: 'bg-[#16A34A]/10 text-[#16A34A]',
    action: 'Using it but still free. Check in, ask what they haul, and mention what paid plans add.',
    template: {
      subject: '{{first_name}}, how’s Haulock working for you?',
      body: `Hi {{first_name}},\n\nThanks for using Haulock.\n\n{{lookups}}\n\nWhat kind of loads are you booking, and is there anything you wish Haulock did? On a paid plan you also get unlimited lookups, rate con scans and a watchlist that emails you when a broker changes.\n\n${SALES_SIGNOFF}`,
      ctaLabel: 'Compare plans →', ctaUrl: 'https://haulock.com/pricing', showLookups: true,
    },
  },
  never_used: {
    label: 'Never used it', tone: 'bg-[#0B1E3F]/10 text-[#0B1E3F]/70',
    action: 'Signed up a while ago and never ran a lookup. Re-introduce what it does with one example.',
    template: {
      subject: 'Still booking loads without checking the broker?',
      body: `Hi {{first_name}},\n\nYou signed up for Haulock a while back but haven't run a lookup yet. Double-brokering and fake MCs are still everywhere.\n\n{{lookups}}\n\nType any MC number and you'll see in seconds if something's off. Your {{free_limit}} free lookups are waiting.\n\n${SALES_SIGNOFF}`,
      ctaLabel: 'Check a broker now →', ctaUrl: 'https://haulock.com/verify', showLookups: true,
    },
  },
  dormant: {
    label: 'Gone quiet', tone: 'bg-[#F59E0B]/15 text-[#B45309]',
    action: 'Used it before, nothing in 30+ days. Win-back: ask why, share something new.',
    template: {
      subject: '{{first_name}}, a lot has changed since your last check',
      body: `Hi {{first_name}},\n\nIt's been a while since you used Haulock.\n\n{{lookups}}\n\nSince then we've added rate con scanning and PDF forensics, which catch edited or fake rate cons. Was there a reason you stopped? Your honest answer helps a lot.\n\n${SALES_SIGNOFF}`,
      ctaLabel: 'Check a broker →', ctaUrl: 'https://haulock.com/verify', showLookups: true,
    },
  },
  paying: {
    label: 'Paying', tone: 'bg-[#0B1E3F] text-white',
    action: 'Customer. Ask for a review or referral, or offer a bigger plan if they’re near their limits.',
    template: {
      subject: 'Thanks for being a Haulock customer, {{first_name}}',
      body: `Hi {{first_name}},\n\nThanks for being a Haulock customer.\n\n{{lookups}}\n\nIs everything working the way you need? If Haulock has saved you from a bad load, would you tell a friend about it? It really helps.\n\n${SALES_SIGNOFF}`,
      ctaLabel: '', ctaUrl: '', showLookups: true,
    },
  },
};

const BUILT_IN_TEMPLATES: SalesTemplate[] = (Object.keys(SALES_SEGMENTS) as SalesSegment[]).map((k) => ({
  id: `builtin:${k}`, name: SALES_SEGMENTS[k].label, builtIn: true, ...SALES_SEGMENTS[k].template,
}));

const SALES_STAGES: { id: string; label: string }[] = [
  { id: 'new', label: 'Not contacted' },
  { id: 'contacted', label: 'Contacted' },
  { id: 'replied', label: 'Replied' },
  { id: 'offer_sent', label: 'Offer sent' },
  { id: 'won', label: 'Won' },
  { id: 'lost', label: 'Lost' },
];

const SALES_MERGE_TAGS = ['lookups', 'first_name', 'name', 'company', 'mc', 'plan', 'lookups_this_month', 'lookups_total', 'free_limit'];

const todayISO = () => new Date().toISOString().slice(0, 10);

function SalesPage() {
  const [leads, setLeads] = useState<any[] | null>(null);
  const [pipelineReady, setPipelineReady] = useState(true);
  const [adminEmail, setAdminEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'people' | 'campaigns'>('people');
  const [filter, setFilter] = useState<SalesFilter>('hot');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [composer, setComposer] = useState<{ recipients: any[]; audience: string } | null>(null);

  const load = async () => {
    setError(null);
    try {
      const res = await fetch('/api/admin/sales');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Failed (${res.status})`);
      setLeads(data.leads || []);
      setPipelineReady(Boolean(data.pipelineReady));
      setAdminEmail(data.adminEmail || '');
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
      setLeads([]);
    }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { setPage(1); setSelected(new Set()); }, [filter, search]);

  // Optimistic local update, then persist. Reload on failure so the UI
  // never shows a stage that didn't save.
  const saveLead = async (id: string, body: any, local: any) => {
    setLeads((ls) => (ls || []).map((l) => (l.id === id ? { ...l, ...local } : l)));
    setSavingId(id); setError(null);
    try {
      const res = await fetch(`/api/admin/sales/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Failed (${res.status})`);
    } catch (e: any) {
      setError(e?.message || 'Save failed');
      load();
    } finally {
      setSavingId(null);
    }
  };

  const all = leads || [];
  const today = todayISO();
  const isHot = (l: any) => l.segment === 'checkout' || l.segment === 'limit';
  const isDue = (l: any) => l.followUpAt && l.followUpAt <= today && l.stage !== 'won' && l.stage !== 'lost';

  const counts: Record<string, number> = { hot: 0, free: 0, followup: 0 };
  for (const l of all) {
    counts[l.segment] = (counts[l.segment] || 0) + 1;
    if (l.segment !== 'paying') counts.free += 1;
    if (isHot(l)) counts.hot += 1;
    if (isDue(l)) counts.followup += 1;
  }

  // Funnel: each step is a subset of the one before it.
  const funnel = [
    { label: 'Signed up', n: all.length },
    { label: 'Confirmed email', n: all.filter((l) => l.confirmed).length },
    { label: 'Ran a lookup', n: all.filter((l) => l.lookupsTotal > 0 || l.segment === 'paying').length },
    { label: 'Showed buying intent', n: all.filter((l) => isHot(l) || l.segment === 'paying').length },
    { label: 'Paying', n: counts.paying || 0 },
  ];
  const conversion = all.length ? ((counts.paying || 0) / all.length) * 100 : 0;

  const q = search.trim().toLowerCase();
  const shown = all.filter((l) => {
    if (q && !(
      (l.email || '').toLowerCase().includes(q)
      || (l.name || '').toLowerCase().includes(q)
      || (l.company || '').toLowerCase().includes(q)
      || (l.mc || '').includes(q)
    )) return false;
    if (filter === 'hot') return isHot(l);
    if (filter === 'free') return l.segment !== 'paying';
    if (filter === 'followup') return isDue(l);
    return l.segment === filter;
  });
  const PAGE_SIZE = 20;
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const pageItems = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selectedLeads = shown.filter((l) => selected.has(l.id));
  const allShownSelected = shown.length > 0 && selectedLeads.length === shown.length;

  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const bulkStage = async (stage: string) => {
    if (!stage || selectedLeads.length === 0) return;
    for (const l of selectedLeads) await saveLead(l.id, { stage }, { stage });
  };

  const exportCsv = () => {
    const rows = selectedLeads.length ? selectedLeads : shown;
    const cols = ['email', 'name', 'company', 'mc', 'plan', 'segment', 'stage', 'lookupsTotal', 'lookupsThisMonth', 'createdAt', 'lastActiveAt', 'lastEmailedAt', 'followUpAt', 'notes'];
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [cols.join(','), ...rows.map((l) => cols.map((c) => esc(c === 'segment' ? SALES_SEGMENTS[l.segment as SalesSegment]?.label : l[c])).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `haulock-sales-${filter}-${today}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const FILTERS: { id: SalesFilter; label: string }[] = [
    { id: 'hot', label: 'Hot leads' },
    { id: 'followup', label: 'Follow-up due' },
    { id: 'free', label: 'All not subscribed' },
    { id: 'checkout', label: SALES_SEGMENTS.checkout.label },
    { id: 'limit', label: SALES_SEGMENTS.limit.label },
    { id: 'active', label: SALES_SEGMENTS.active.label },
    { id: 'new', label: SALES_SEGMENTS.new.label },
    { id: 'never_used', label: SALES_SEGMENTS.never_used.label },
    { id: 'dormant', label: SALES_SEGMENTS.dormant.label },
    { id: 'unconfirmed', label: SALES_SEGMENTS.unconfirmed.label },
    { id: 'paying', label: SALES_SEGMENTS.paying.label },
  ];
  const filterLabel = FILTERS.find((f) => f.id === filter)?.label || 'Selected';

  return (
    <div className="space-y-8 text-[#0B1E3F]">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-2">Sales</div>
          <h1 className="text-4xl serif italic text-[#0B1E3F]">Turn free users into customers.</h1>
          <p className="text-[#0B1E3F]/60 mt-2 text-sm max-w-2xl">Everyone who signed up, sorted by how close they are to paying. Email one person or a whole group, personalized with their own lookups.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCsv} disabled={!shown.length} className="px-4 py-2 border border-[#0B1E3F]/15 bg-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/5 flex items-center gap-1.5 disabled:opacity-50"><Download className="w-3.5 h-3.5" /> Export CSV</button>
          <button onClick={load} className="px-4 py-2 border border-[#0B1E3F]/15 bg-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/5">Refresh</button>
        </div>
      </div>

      <div className="flex gap-1 p-1 bg-[#0B1E3F]/5 rounded-full w-fit">
        {([{ id: 'people', label: 'People' }, { id: 'campaigns', label: 'Sent emails' }] as const).map((t) => (
          <button key={t.id} onClick={() => setView(t.id)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition ${view === t.id ? 'bg-[#0B1E3F] text-white' : 'text-[#0B1E3F]/60 hover:text-[#0B1E3F]'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {!pipelineReady && (
        <div className="p-4 bg-[#F59E0B]/10 border border-[#F59E0B]/30 rounded-xl text-sm">
          <strong>Stages, notes and follow-ups are off</strong> until the <span className="mono">sales_leads</span> table exists. Run the Sales blocks at the end of <span className="mono">supabase/schema.sql</span> in the Supabase SQL editor.
        </div>
      )}
      {error && <div className="text-sm text-[#DC2626]">{error}</div>}

      {view === 'campaigns' && <SalesCampaigns />}

      {view === 'people' && (<>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-4 bg-white border border-[#0B1E3F]/10 rounded-xl"><div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">Not subscribed</div><div className="text-2xl font-semibold mt-1">{leads == null ? '—' : counts.free}</div></div>
        <div className="p-4 bg-white border border-[#0B1E3F]/10 rounded-xl"><div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">Paying</div><div className="text-2xl font-semibold mt-1">{leads == null ? '—' : (counts.paying || 0)}</div></div>
        <div className="p-4 bg-white border border-[#0B1E3F]/10 rounded-xl"><div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">Conversion</div><div className="text-2xl font-semibold mt-1">{leads == null ? '—' : `${conversion.toFixed(1)}%`}</div></div>
        <div className="p-4 bg-white border border-[#0B1E3F]/10 rounded-xl"><div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">Hot leads</div><div className="text-2xl font-semibold mt-1 text-[#DC2626]">{leads == null ? '—' : counts.hot}</div></div>
      </div>

      {/* Funnel — bar width is relative to signups; the small % is step-to-step. */}
      <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-6 card-shadow">
        <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-4">Funnel</div>
        <div className="space-y-2.5">
          {funnel.map((s, i) => {
            const pct = funnel[0].n ? (s.n / funnel[0].n) * 100 : 0;
            const prev = i > 0 ? funnel[i - 1].n : null;
            const step = prev ? Math.round((s.n / prev) * 100) : null;
            return (
              <div key={s.label} className="flex items-center gap-3 text-sm">
                <div className="w-32 md:w-48 flex-shrink-0 text-[#0B1E3F]/75">{s.label}</div>
                <div className="flex-1 h-6 bg-[#0B1E3F]/5 rounded-md overflow-hidden">
                  <div className="h-full bg-[#0B1E3F] rounded-md transition-all" style={{ width: `${Math.max(pct, s.n ? 2 : 0)}%` }} />
                </div>
                <div className="w-20 md:w-24 text-right mono text-xs">
                  <span className="font-semibold text-[#0B1E3F]">{s.n}</span>
                  {step != null && <span className="text-[#0B1E3F]/45"> · {step}%</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 card-shadow overflow-hidden">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by email, name, company, or MC…" className="w-full px-4 py-3 bg-transparent text-sm focus:outline-none placeholder:text-[#0B1E3F]/40 border-b border-[#0B1E3F]/5" />
        <div className="flex flex-wrap items-center gap-1 px-4 py-3">
          {FILTERS.filter((f) => f.id !== 'followup' || pipelineReady).map((f) => {
            const active = filter === f.id;
            return (
              <button key={f.id} type="button" onClick={() => setFilter(f.id)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition flex items-center gap-1.5 ${active ? 'bg-[#0B1E3F] text-white' : 'text-[#0B1E3F]/65 hover:text-[#0B1E3F] hover:bg-[#0B1E3F]/5'}`}>
                {f.label}
                <span className={`text-[10px] mono ${active ? 'text-white/60' : 'text-[#0B1E3F]/45'}`}>{counts[f.id] || 0}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Bulk bar — select people, then email them all or move their stage. */}
      {shown.length > 0 && (
        <div className="sticky top-16 z-10 flex flex-wrap items-center gap-3 p-3 bg-white border border-[#0B1E3F]/10 rounded-2xl card-shadow">
          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer pl-1">
            <input type="checkbox" checked={allShownSelected}
              onChange={() => setSelected(allShownSelected ? new Set() : new Set(shown.map((l) => l.id)))}
              className="w-4 h-4 accent-[#0B1E3F]" />
            {selectedLeads.length ? `${selectedLeads.length} selected` : `Select all ${shown.length}`}
          </label>
          <div className="flex-1" />
          {selectedLeads.length > 0 && pipelineReady && (
            <select value="" onChange={(e) => bulkStage(e.target.value)} className="px-3 py-2 border border-[#0B1E3F]/15 bg-white rounded-full text-sm">
              <option value="">Set stage…</option>
              {SALES_STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          )}
          <button
            onClick={() => setComposer({
              recipients: selectedLeads.length ? selectedLeads : shown,
              audience: selectedLeads.length ? `${selectedLeads.length} selected (${filterLabel})` : filterLabel,
            })}
            className="px-4 py-2 bg-[#FF6B35] text-white rounded-full text-sm font-semibold hover:bg-[#FF6B35]/90 flex items-center gap-1.5">
            <Mail className="w-3.5 h-3.5" />
            {selectedLeads.length ? `Email ${selectedLeads.length} selected` : `Email all ${shown.length} in “${filterLabel}”`}
          </button>
        </div>
      )}

      <div className="space-y-3">
        {leads == null && <div className="text-sm text-[#0B1E3F]/50">Loading…</div>}
        {leads != null && shown.length === 0 && (
          <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-10 text-center text-sm text-[#0B1E3F]/55">Nobody in this group right now.</div>
        )}
        {pageItems.map((l) => {
          const seg = SALES_SEGMENTS[l.segment as SalesSegment];
          const displayName = l.name || (l.email || '').split('@')[0];
          const open = openId === l.id;
          return (
            <div key={l.id} className={`bg-white rounded-2xl border p-5 card-shadow ${selected.has(l.id) ? 'border-[#0B1E3F]/50' : 'border-[#0B1E3F]/10'}`}>
              <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} className="hidden lg:block w-4 h-4 mt-1 accent-[#0B1E3F] flex-shrink-0" aria-label={`Select ${displayName}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} className="lg:hidden w-4 h-4 accent-[#0B1E3F]" aria-label={`Select ${displayName}`} />
                    <span className="font-semibold truncate">{displayName}</span>
                    <span className={`text-[10px] mono uppercase tracking-wider px-2 py-0.5 rounded-full font-bold ${seg.tone}`}>{seg.label}</span>
                    {isDue(l) && <span className="text-[10px] mono uppercase tracking-wider px-2 py-0.5 rounded-full font-bold bg-[#FF6B35] text-white">Follow-up due</span>}
                    {l.unsubscribed && <span className="text-[10px] mono uppercase tracking-wider px-2 py-0.5 rounded-full font-bold bg-[#0B1E3F]/10 text-[#0B1E3F]/60">Unsubscribed</span>}
                  </div>
                  <div className="text-sm text-[#0B1E3F]/60 truncate">{l.email}{l.company ? ` · ${l.company}` : ''}{l.mc ? ` · MC ${l.mc}` : ''}</div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs mono text-[#0B1E3F]/55">
                    <span>{l.planLabel}</span>
                    <span>Signed up {timeAgo(l.createdAt)}</span>
                    <span>Lookups: {l.lookupsThisMonth}{l.freeLimit != null && l.segment !== 'paying' ? `/${l.freeLimit}` : ''} this mo · {l.lookupsTotal} total</span>
                    {l.lastActiveAt && <span>Last active {timeAgo(l.lastActiveAt)}</span>}
                    {l.checkoutAt && <span className="text-[#DC2626]">Checkout {timeAgo(l.checkoutAt)}{l.checkoutPlan ? ` · ${l.checkoutPlan}` : ''}</span>}
                    {l.lastEmailedAt && <span>Emailed {timeAgo(l.lastEmailedAt)}</span>}
                  </div>
                  <div className="mt-3 text-sm text-[#0B1E3F]/80 flex items-start gap-2">
                    <Target className="w-4 h-4 text-[#FF6B35] flex-shrink-0 mt-0.5" />
                    <span>{seg.action}</span>
                  </div>
                </div>
                <div className="flex flex-wrap lg:flex-col gap-2 lg:w-48 flex-shrink-0">
                  <button type="button" onClick={() => setComposer({ recipients: [l], audience: l.email })}
                    className="px-4 py-2 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90 flex items-center justify-center gap-1.5">
                    <Mail className="w-3.5 h-3.5" /> Email
                  </button>
                  {pipelineReady && (
                    <select value={l.stage} disabled={savingId === l.id}
                      onChange={(e) => saveLead(l.id, { stage: e.target.value }, { stage: e.target.value })}
                      className="px-3 py-2 border border-[#0B1E3F]/15 bg-white rounded-full text-sm focus:outline-none focus:border-[#0B1E3F]">
                      {SALES_STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                  )}
                  {pipelineReady && (
                    <button type="button" onClick={() => setOpenId(open ? null : l.id)} className="px-4 py-2 border border-[#0B1E3F]/15 rounded-full text-sm font-medium hover:bg-[#0B1E3F]/5">
                      {open ? 'Close notes' : l.notes ? 'Notes •' : 'Notes'}
                    </button>
                  )}
                </div>
              </div>
              {open && pipelineReady && (
                <SalesNotes lead={l} onSave={(body, local) => saveLead(l.id, body, local)} />
              )}
            </div>
          );
        })}
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-[#0B1E3F]/55">{shown.length} people · page {page} of {pageCount}</span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-4 py-2 border border-[#0B1E3F]/15 bg-white rounded-full disabled:opacity-40">Previous</button>
            <button disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)} className="px-4 py-2 border border-[#0B1E3F]/15 bg-white rounded-full disabled:opacity-40">Next</button>
          </div>
        </div>
      )}
      </>)}

      {composer && (
        <SalesComposer
          recipients={composer.recipients}
          audience={composer.audience}
          adminEmail={adminEmail}
          onClose={() => setComposer(null)}
          onSent={() => { setSelected(new Set()); load(); }}
        />
      )}
    </div>
  );
}

function SalesNotes({ lead, onSave }: { lead: any; onSave: (body: any, local: any) => void }) {
  const [notes, setNotes] = useState(lead.notes || '');
  const [followUp, setFollowUp] = useState(lead.followUpAt || '');
  const dirty = notes !== (lead.notes || '') || followUp !== (lead.followUpAt || '');
  return (
    <div className="mt-4 pt-4 border-t border-[#0B1E3F]/10 grid md:grid-cols-[1fr_auto] gap-3">
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Private notes — only admins see these."
        className="w-full px-4 py-3 bg-[#F5F3EE] border border-[#0B1E3F]/15 rounded-xl text-sm focus:outline-none focus:border-[#0B1E3F] placeholder:text-[#0B1E3F]/35" />
      <div className="flex md:flex-col gap-2">
        <label className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55 flex flex-col gap-1">
          Follow up on
          <input type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} className="px-3 py-2 border border-[#0B1E3F]/15 bg-white rounded-lg text-sm normal-case tracking-normal" />
        </label>
        <button type="button" disabled={!dirty}
          onClick={() => onSave({ notes, followUpAt: followUp || null }, { notes, followUpAt: followUp || null })}
          className="px-4 py-2 bg-[#0B1E3F] text-white rounded-full text-sm font-medium disabled:opacity-40 self-end">
          Save
        </button>
      </div>
    </div>
  );
}

// Full-screen composer: template + editor on the left, the exact email
// each recipient will get on the right (rendered server-side by the same
// function the send uses), step through recipients to check personalization.
function SalesComposer({ recipients, audience, adminEmail, onClose, onSent }: {
  recipients: any[]; audience: string; adminEmail: string; onClose: () => void; onSent: () => void;
}) {
  // Default to the built-in template for the most common segment here.
  const topSegment = (() => {
    const c: Record<string, number> = {};
    for (const r of recipients) c[r.segment] = (c[r.segment] || 0) + 1;
    return (Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || 'active') as SalesSegment;
  })();
  const initial = BUILT_IN_TEMPLATES.find((t) => t.id === `builtin:${topSegment}`)!;

  const [saved, setSaved] = useState<SalesTemplate[]>([]);
  const [templatesReady, setTemplatesReady] = useState(true);
  const [templateId, setTemplateId] = useState(initial.id);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [ctaLabel, setCtaLabel] = useState(initial.ctaLabel);
  const [ctaUrl, setCtaUrl] = useState(initial.ctaUrl);
  const [showLookups, setShowLookups] = useState(initial.showLookups);
  const [cooldownDays, setCooldownDays] = useState(3);
  const [idx, setIdx] = useState(0);
  const [preview, setPreview] = useState<{ subject: string; html: string; lookupCount: number; lookupKind?: 'theirs' | 'own' | 'example' } | null>(null);
  // Progress of the pre-send re-scan; previewTick re-renders the preview after it.
  const [rescan, setRescan] = useState<{ done: number; total: number; failed: number } | null>(null);
  const [previewTick, setPreviewTick] = useState(0);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [busy, setBusy] = useState<'test' | 'send' | 'save' | 'rescan' | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [result, setResult] = useState<any | null>(null);
  const bodyRef = React.useRef<HTMLTextAreaElement | null>(null);

  const recipient = recipients[Math.min(idx, recipients.length - 1)];

  useEffect(() => {
    fetch('/api/admin/sales/templates').then((r) => r.json()).then((d) => {
      setTemplatesReady(d?.ready !== false);
      setSaved((d?.templates || []).map((t: any) => ({
        id: t.id, name: t.name, subject: t.subject, body: t.body,
        ctaLabel: t.cta_label || '', ctaUrl: t.cta_url || '', showLookups: t.show_lookups !== false,
      })));
    }).catch(() => setTemplatesReady(false));
  }, []);

  // Lock page scroll behind the modal; Esc closes it.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [busy, onClose]);

  // Debounced server-side render of the current recipient's email.
  useEffect(() => {
    if (!recipient) return;
    setPreviewLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/admin/sales/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lead: recipient, subject, body, ctaLabel, ctaUrl, showLookups }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || `Preview failed (${res.status})`);
        setPreview(data);
      } catch (e: any) {
        setPreview({ subject, html: `<div style="font-family:sans-serif;padding:24px;color:#DC2626">${String(e?.message || 'Preview failed').replace(/</g, '&lt;')}</div>`, lookupCount: 0 });
      } finally {
        setPreviewLoading(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [recipient?.id, subject, body, ctaLabel, ctaUrl, showLookups, previewTick]);

  const allTemplates = [...BUILT_IN_TEMPLATES, ...saved];
  const pickTemplate = (id: string) => {
    const t = allTemplates.find((x) => x.id === id);
    if (!t) return;
    setTemplateId(id); setSubject(t.subject); setBody(t.body); setCtaLabel(t.ctaLabel); setCtaUrl(t.ctaUrl); setShowLookups(t.showLookups);
  };
  const current = allTemplates.find((t) => t.id === templateId);

  const insertTag = (tag: string) => {
    const el = bodyRef.current;
    // The lookups block is its own paragraph.
    const token = tag === 'lookups' ? '\n\n{{lookups}}\n\n' : `{{${tag}}}`;
    if (!el) { setBody((b) => b + token); return; }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    setTimeout(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length); }, 0);
  };

  const saveTemplate = async (asNew: boolean) => {
    const name = asNew ? window.prompt('Template name', current && !current.builtIn ? `${current.name} copy` : subject.slice(0, 60)) : current?.name;
    if (!name) return;
    setBusy('save'); setNotice(null);
    try {
      const res = await fetch('/api/admin/sales/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: asNew ? undefined : templateId, name, subject, body, ctaLabel, ctaUrl, showLookups }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Save failed');
      const t = data.template;
      const mapped: SalesTemplate = { id: t.id, name: t.name, subject: t.subject, body: t.body, ctaLabel: t.cta_label || '', ctaUrl: t.cta_url || '', showLookups: t.show_lookups !== false };
      setSaved((s) => [mapped, ...s.filter((x) => x.id !== t.id)]);
      setTemplateId(t.id);
      setNotice({ tone: 'ok', text: `Saved template “${t.name}”.` });
    } catch (e: any) {
      setNotice({ tone: 'err', text: e?.message || 'Save failed' });
    } finally {
      setBusy(null);
    }
  };

  const deleteTemplate = async () => {
    if (!current || current.builtIn || !window.confirm(`Delete template “${current.name}”?`)) return;
    await fetch(`/api/admin/sales/templates?id=${encodeURIComponent(current.id)}`, { method: 'DELETE' });
    setSaved((s) => s.filter((x) => x.id !== current.id));
    pickTemplate(initial.id);
  };

  // What the server will skip — shown up front so the count isn't a surprise.
  const cooldownIso = new Date(Date.now() - cooldownDays * 86400000).toISOString();
  const unsubCount = recipients.filter((r) => r.unsubscribed).length;
  const recentCount = cooldownDays > 0 ? recipients.filter((r) => !r.unsubscribed && r.lastEmailedAt && r.lastEmailedAt > cooldownIso).length : 0;
  const willSend = recipients.length - unsubCount - recentCount;

  // Before anything goes out, re-run the full scan (the same /api/verify a
  // user gets, force=1) for every company in these emails whose last result
  // is over a week old — including a recipient's own company for the free
  // "on us" check — and store it for the emails. 3 at a time; a company that
  // fails to re-scan keeps its previous result.
  const refreshCompanies = async (ids: string[]): Promise<{ total: number; failed: number }> => {
    const planRes = await fetch('/api/admin/sales/rescans/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds: ids }),
    });
    const plan = await planRes.json();
    if (!planRes.ok) throw new Error(plan?.error || 'Could not check which companies need a re-scan');
    const companies: { key: string; query: string }[] = plan.companies || [];
    if (companies.length === 0) return { total: 0, failed: 0 };
    let done = 0, failed = 0, next = 0;
    setRescan({ done: 0, total: companies.length, failed: 0 });
    const worker = async () => {
      while (next < companies.length) {
        const c = companies[next++];
        try {
          const r = await fetch(`/api/verify?q=${encodeURIComponent(c.query)}&force=1`);
          const report = await r.json();
          if (!r.ok) throw new Error(report?.error || 'scan failed');
          const saved = await fetch('/api/admin/sales/rescans', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: c.key, report }),
          });
          if (!saved.ok) throw new Error('save failed');
        } catch {
          failed += 1;
        }
        done += 1;
        setRescan({ done, total: companies.length, failed });
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setPreviewTick((t) => t + 1);
    return { total: companies.length, failed };
  };

  const rescanPreviewed = async () => {
    if (!recipient) return;
    setBusy('rescan'); setNotice(null);
    try {
      const r = await refreshCompanies([recipient.id]);
      setNotice({ tone: 'ok', text: r.total === 0 ? 'Everything in this email was scanned in the last 7 days.' : `Re-scanned ${r.total - r.failed} of ${r.total} compan${r.total === 1 ? 'y' : 'ies'}${r.failed ? ` · ${r.failed} kept their last result` : ''}.` });
    } catch (e: any) {
      setNotice({ tone: 'err', text: e?.message || 'Re-scan failed' });
    } finally {
      setRescan(null); setBusy(null);
    }
  };

  const send = async (test: boolean) => {
    if (!subject.trim() || !body.trim()) { setNotice({ tone: 'err', text: 'Add a subject and a message first.' }); return; }
    if (!test && !window.confirm(`Send this email to ${willSend} ${willSend === 1 ? 'person' : 'people'}?${showLookups ? '\n\nCompanies in these emails that weren’t scanned in the last 7 days get a fresh scan first, so this can take a few minutes for a big group.' : ''}\n\nThis can't be undone.`)) return;
    setBusy(test ? 'test' : 'send'); setNotice(null);
    try {
      if (showLookups) {
        await refreshCompanies(test ? [recipient.id] : recipients.filter((r) => !r.unsubscribed).map((r) => r.id));
        setRescan(null);
      }
      const res = await fetch('/api/admin/sales/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject, body, ctaLabel, ctaUrl, showLookups, cooldownDays, audience,
          userIds: recipients.map((r) => r.id), test, previewUserId: recipient?.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Failed (${res.status})`);
      if (test) setNotice({ tone: 'ok', text: `Test sent to ${data.to} — it shows ${recipient?.email}'s version.` });
      else { setResult(data); onSent(); }
    } catch (e: any) {
      setNotice({ tone: 'err', text: e?.message || 'Send failed' });
    } finally {
      setRescan(null);
      setBusy(null);
    }
  };

  const SKIP_LABELS: Record<string, string> = { unsubscribed: 'unsubscribed', 'recently-emailed': 'emailed recently', 'not-found': 'not found' };
  const inputCls = 'w-full px-3 py-2.5 bg-[#F5F3EE] border border-[#0B1E3F]/15 rounded-xl text-sm focus:outline-none focus:border-[#0B1E3F] placeholder:text-[#0B1E3F]/35';

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-[#0B1E3F]/50 flex items-stretch md:items-center justify-center md:p-6" role="dialog" aria-modal="true">
      <div className="bg-[#F5F3EE] w-full max-w-7xl md:rounded-2xl shadow-2xl flex flex-col max-h-full md:max-h-[92vh] overflow-hidden text-[#0B1E3F]">
        <div className="flex items-center justify-between gap-4 px-5 py-4 bg-white border-b border-[#0B1E3F]/10">
          <div className="min-w-0">
            <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">New email</div>
            <div className="font-semibold truncate">To: {recipients.length === 1 ? recipients[0].email : `${recipients.length} people · ${audience}`}</div>
          </div>
          <button onClick={onClose} disabled={!!busy} className="p-2 rounded-full hover:bg-[#0B1E3F]/5" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>

        {result ? (
          <div className="p-10 text-center space-y-4 overflow-y-auto">
            <CheckCircle2 className="w-12 h-12 text-[#16A34A] mx-auto" />
            <div className="text-2xl font-semibold">Sent to {result.sent} {result.sent === 1 ? 'person' : 'people'}</div>
            <div className="text-sm text-[#0B1E3F]/65">
              {result.failed > 0 && <span className="text-[#DC2626]">{result.failed} failed · </span>}
              {result.skipped > 0
                ? <>Skipped {result.skipped}: {Object.entries(result.skipReasons || {}).map(([k, v]) => `${v} ${SKIP_LABELS[k] || k}`).join(', ')}</>
                : 'Nobody skipped.'}
            </div>
            <div className="text-sm text-[#0B1E3F]/55">They’re marked as contacted. Replies go to your inbox. Track results under “Sent emails”.</div>
            <button onClick={onClose} className="px-6 py-2.5 bg-[#0B1E3F] text-white rounded-full text-sm font-medium">Done</button>
          </div>
        ) : (
        <div className="flex-1 overflow-y-auto lg:overflow-hidden grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          {/* Editor */}
          <div className="p-5 space-y-4 lg:overflow-y-auto">
            <div>
              <label className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55 block mb-1.5">Template</label>
              <div className="flex gap-2">
                <select value={templateId} onChange={(e) => pickTemplate(e.target.value)} className={inputCls}>
                  <optgroup label="Built-in (one per group)">
                    {BUILT_IN_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </optgroup>
                  {saved.length > 0 && (
                    <optgroup label="Your templates">
                      {saved.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </optgroup>
                  )}
                </select>
              </div>
              {templatesReady && (
                <div className="flex flex-wrap gap-3 mt-2 text-xs">
                  <button type="button" disabled={!!busy} onClick={() => saveTemplate(true)} className="underline text-[#0B1E3F]/70 hover:text-[#0B1E3F]">Save as new template</button>
                  {current && !current.builtIn && <button type="button" disabled={!!busy} onClick={() => saveTemplate(false)} className="underline text-[#0B1E3F]/70 hover:text-[#0B1E3F]">Update “{current.name}”</button>}
                  {current && !current.builtIn && <button type="button" onClick={deleteTemplate} className="underline text-[#DC2626]/80 hover:text-[#DC2626]">Delete</button>}
                </div>
              )}
            </div>

            <div>
              <label className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55 block mb-1.5">Subject</label>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} className={inputCls} />
            </div>

            <div>
              <label className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55 block mb-1.5">Message</label>
              <textarea ref={bodyRef} value={body} onChange={(e) => setBody(e.target.value)} rows={11} className={`${inputCls} leading-relaxed font-[inherit]`} />
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/45 mr-1">Insert</span>
                {SALES_MERGE_TAGS.map((t) => (
                  <button key={t} type="button" onClick={() => insertTag(t)} className="px-2 py-0.5 bg-[#0B1E3F]/5 hover:bg-[#0B1E3F]/10 rounded-full text-[11px] mono text-[#0B1E3F]/75">{`{{${t}}}`}</button>
                ))}
              </div>
              <div className="mt-1.5 text-[11px] text-[#0B1E3F]/50">Blank line = new paragraph · **bold** · links work as-is</div>
            </div>

            <label className="flex items-start gap-3 p-3 bg-white border border-[#0B1E3F]/10 rounded-xl cursor-pointer">
              <input type="checkbox" checked={showLookups} onChange={(e) => setShowLookups(e.target.checked)} className="w-4 h-4 mt-0.5 accent-[#0B1E3F]" />
              <span className="text-sm">
                <span className="font-medium">Show their recent lookups</span>
                <span className="block text-xs text-[#0B1E3F]/55 mt-0.5">Their last 3 companies checked, with risk score and top warning sign, placed where <span className="mono">{'{{lookups}}'}</span> is in the message. People with no lookups get a free check of their own company (from their profile MC/DOT), or a labelled example if they haven&apos;t set one. The block writes its own intro line. Anything not scanned in the last 7 days is re-scanned before sending.</span>
              </span>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55 block mb-1.5">Button text</label>
                <input value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} placeholder="Optional" className={inputCls} />
              </div>
              <div>
                <label className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55 block mb-1.5">Button link</label>
                <input value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} placeholder="https://haulock.com/pricing" className={inputCls} />
              </div>
            </div>

            {recipients.length > 1 && (
              <div className="flex items-center gap-2 text-sm">
                <span>Skip anyone emailed in the last</span>
                <select value={cooldownDays} onChange={(e) => setCooldownDays(Number(e.target.value))} className="px-2 py-1 border border-[#0B1E3F]/15 bg-white rounded-lg">
                  {[0, 1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{d === 0 ? '— don’t skip' : `${d} day${d === 1 ? '' : 's'}`}</option>)}
                </select>
              </div>
            )}
          </div>

          {/* Preview */}
          <div className="p-5 bg-[#0B1E3F]/[0.03] border-t lg:border-t-0 lg:border-l border-[#0B1E3F]/10 flex flex-col min-h-[640px] lg:min-h-0">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="min-w-0">
                <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">Preview {previewLoading && '· updating…'}</div>
                <div className="text-sm truncate">For <strong>{recipient?.name || recipient?.email}</strong> <span className="text-[#0B1E3F]/50">· {recipient?.email}</span></div>
              </div>
              {recipients.length > 1 && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0} className="px-2.5 py-1 border border-[#0B1E3F]/15 bg-white rounded-full text-sm disabled:opacity-40" aria-label="Previous recipient">‹</button>
                  <span className="text-xs mono text-[#0B1E3F]/60 w-16 text-center">{idx + 1} / {recipients.length}</span>
                  <button onClick={() => setIdx((i) => Math.min(recipients.length - 1, i + 1))} disabled={idx >= recipients.length - 1} className="px-2.5 py-1 border border-[#0B1E3F]/15 bg-white rounded-full text-sm disabled:opacity-40" aria-label="Next recipient">›</button>
                </div>
              )}
            </div>
            <div className="bg-white border border-[#0B1E3F]/10 rounded-t-xl px-4 py-3 text-sm">
              <div className="truncate"><span className="text-[#0B1E3F]/50">Subject:</span> <strong>{preview?.subject || subject}</strong></div>
              {showLookups && preview && (
                <div className="text-xs text-[#0B1E3F]/50 mt-0.5 flex flex-wrap items-center gap-x-2">
                  <span>{preview.lookupKind === 'own' ? 'No lookups — shows a free check of their own company' : preview.lookupKind === 'example' ? 'No lookups or MC on profile — shows the example check' : `Includes ${preview.lookupCount} of their lookups`}</span>
                  {preview.lookupKind !== 'example' && (
                    <button type="button" onClick={rescanPreviewed} disabled={!!busy} className="underline hover:text-[#0B1E3F] disabled:opacity-50">{busy === 'rescan' ? 'Re-scanning…' : 'Re-scan now'}</button>
                  )}
                </div>
              )}
            </div>
            <iframe
              title="Email preview"
              sandbox=""
              srcDoc={preview?.html || ''}
              className="flex-1 w-full bg-[#F5F3EE] border border-t-0 border-[#0B1E3F]/10 rounded-b-xl min-h-[520px]"
            />
          </div>
        </div>
        )}

        {!result && (
          <div className="px-5 py-4 bg-white border-t border-[#0B1E3F]/10 flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex-1 text-sm min-w-0">
              {rescan
                ? (
                  <div className="space-y-1.5 max-w-md">
                    <div className="text-[#0B1E3F]/75">Re-scanning companies in {busy === 'test' || busy === 'rescan' ? 'this email' : 'these emails'} · <strong className="text-[#0B1E3F]">{rescan.done}/{rescan.total}</strong>{rescan.failed ? ` · ${rescan.failed} kept their last result` : ''}</div>
                    <div className="h-1.5 bg-[#0B1E3F]/10 rounded-full overflow-hidden"><div className="h-full bg-[#FF6B35] transition-all" style={{ width: `${rescan.total ? (rescan.done / rescan.total) * 100 : 0}%` }} /></div>
                  </div>
                )
                : notice
                ? <span className={notice.tone === 'ok' ? 'text-[#16A34A]' : 'text-[#DC2626]'}>{notice.text}</span>
                : <span className="text-[#0B1E3F]/60">
                    Will send to <strong className="text-[#0B1E3F]">{willSend}</strong>
                    {(unsubCount > 0 || recentCount > 0) && <> · skipping {[unsubCount ? `${unsubCount} unsubscribed` : '', recentCount ? `${recentCount} emailed recently` : ''].filter(Boolean).join(', ')}</>}
                    {' '}· replies go to {adminEmail || 'you'}
                  </span>}
            </div>
            <div className="flex gap-2">
              <button onClick={() => send(true)} disabled={!!busy || !adminEmail} className="px-4 py-2.5 border border-[#0B1E3F]/15 rounded-full text-sm font-medium hover:bg-[#0B1E3F]/5 disabled:opacity-50">
                {busy === 'test' ? (rescan ? 'Re-scanning…' : 'Sending test…') : 'Send test to me'}
              </button>
              <button onClick={() => send(false)} disabled={!!busy || willSend === 0} className="px-5 py-2.5 bg-[#FF6B35] text-white rounded-full text-sm font-semibold hover:bg-[#FF6B35]/90 disabled:opacity-50 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5" />
                {busy === 'send' ? (rescan ? 'Re-scanning…' : 'Sending…') : `Send to ${willSend}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function SalesCampaigns() {
  const [data, setData] = useState<{ campaigns: any[]; ready: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/admin/sales/campaigns').then(async (r) => {
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || `Failed (${r.status})`);
      setData(d);
    }).catch((e) => setError(e?.message || 'Failed to load'));
  }, []);
  if (error) return <div className="text-sm text-[#DC2626]">{error}</div>;
  if (!data) return <div className="text-sm text-[#0B1E3F]/50">Loading…</div>;
  if (!data.ready) return <div className="p-4 bg-[#F59E0B]/10 border border-[#F59E0B]/30 rounded-xl text-sm">Email history needs the <span className="mono">sales_campaigns</span> tables from <span className="mono">supabase/schema.sql</span>.</div>;
  if (data.campaigns.length === 0) return <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-10 text-center text-sm text-[#0B1E3F]/55">No emails sent yet. Pick a group under People and click “Email all”.</div>;
  return (
    <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 card-shadow overflow-x-auto">
      <table className="w-full text-sm min-w-[720px]">
        <thead>
          <tr className="text-left text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55 border-b border-[#0B1E3F]/10">
            <th className="px-4 py-3 font-medium">Sent</th>
            <th className="px-4 py-3 font-medium">Subject</th>
            <th className="px-4 py-3 font-medium">To</th>
            <th className="px-4 py-3 font-medium text-right">Delivered</th>
            <th className="px-4 py-3 font-medium text-right">Failed</th>
            <th className="px-4 py-3 font-medium text-right">Skipped</th>
            <th className="px-4 py-3 font-medium text-right" title="Recipients who are on a paid plan today">Paying now</th>
          </tr>
        </thead>
        <tbody>
          {data.campaigns.map((c) => (
            <tr key={c.id} className="border-b border-[#0B1E3F]/5 last:border-0">
              <td className="px-4 py-3 whitespace-nowrap text-[#0B1E3F]/70">{timeAgo(c.created_at)}</td>
              <td className="px-4 py-3 max-w-[280px] truncate font-medium" title={c.subject}>{c.subject}</td>
              <td className="px-4 py-3 text-[#0B1E3F]/70 max-w-[200px] truncate" title={c.audience}>{c.audience}</td>
              <td className="px-4 py-3 text-right mono">{c.sent}</td>
              <td className={`px-4 py-3 text-right mono ${c.failed ? 'text-[#DC2626]' : 'text-[#0B1E3F]/45'}`}>{c.failed}</td>
              <td className="px-4 py-3 text-right mono text-[#0B1E3F]/45">{c.skipped}</td>
              <td className={`px-4 py-3 text-right mono font-semibold ${c.nowPaying ? 'text-[#16A34A]' : 'text-[#0B1E3F]/45'}`}>{c.nowPaying}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type AdminTab = 'overview' | 'users' | 'affiliates' | 'fmcsa' | 'data' | 'newsletter' | 'support';

type PlanFilter = 'all' | 'free' | 'carrier' | 'team' | 'fleet';
type RoleFilter = 'all' | 'admin' | 'affiliate' | 'regular';

function AdminPage({ navigate }: any) {
  const [users, setUsers] = useState<any[] | null>(null);
  const [filter, setFilter] = useState('');
  const [planFilter, setPlanFilter] = useState<PlanFilter>('all');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [tab, setTab] = useState<AdminTab>('overview');
  const [affiliateUser, setAffiliateUser] = useState<any | null>(null);

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

    let confirmMsg = `Permanently delete ${label}?\n\nThis removes their login, lookups, watchlist, alerts, and team membership. Cannot be undone.`;
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
  const shown = (users || []).filter((u) => {
    // Text search runs across the full set.
    if (f && !(
      (u.email || '').toLowerCase().includes(f)
      || (u.name || '').toLowerCase().includes(f)
      || (u.company || '').toLowerCase().includes(f)
      || (u.mc || '').includes(f)
    )) return false;
    // Plan filter — compare against the lowercased plan id (free / carrier / team / fleet).
    if (planFilter !== 'all' && (u.plan || 'free').toLowerCase() !== planFilter) return false;
    // Role filter:
    //   admin     → user.isAdmin === true
    //   affiliate → user.role === 'affiliate' (and not admin, since admins skip affiliate)
    //   regular   → neither admin nor affiliate
    if (roleFilter === 'admin' && !u.isAdmin) return false;
    if (roleFilter === 'affiliate' && (u.role !== 'affiliate' || u.isAdmin)) return false;
    if (roleFilter === 'regular' && (u.isAdmin || u.role === 'affiliate')) return false;
    return true;
  });

  // Pagination — filters run across the full set, then we slice the
  // 10-per-page window. Reset to page 1 whenever any filter changes so the
  // results always start at the top of the matching subset.
  const PAGE_SIZE = 10;
  const [userPage, setUserPage] = useState(1);
  useEffect(() => { setUserPage(1); }, [filter, planFilter, roleFilter]);
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const safePage = Math.min(userPage, pageCount);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const visible = shown.slice(pageStart, pageStart + PAGE_SIZE);

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
    { id: 'affiliates', label: 'Affiliates' },
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
          <RevenueCard />
          <StripeOverviewCard />
          <CartRecoveryCard />
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

      {/* AFFILIATES: pending payout requests + roster of affiliates with live earnings */}
      {tab === 'affiliates' && <AffiliatesAdminPanel />}

      {/* USERS: filter + user list */}
      {tab === 'users' && (<>
      <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 card-shadow overflow-hidden">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by email, name, company, or MC…" className="w-full px-4 py-3 bg-transparent text-sm focus:outline-none text-[#0B1E3F] placeholder:text-[#0B1E3F]/40 border-b border-[#0B1E3F]/5" />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-xs">
          {(() => {
            // Counts per option are derived from the *text-search-filtered* set
            // (so the badge tells the operator how many users match the
            // current search + each candidate filter). Excluded admin user
            // himself from affiliate count since admins can't be affiliates.
            const baseSet = (users || []).filter((u) => !f
              || (u.email || '').toLowerCase().includes(f)
              || (u.name || '').toLowerCase().includes(f)
              || (u.company || '').toLowerCase().includes(f)
              || (u.mc || '').includes(f));
            const planCounts: Record<PlanFilter, number> = { all: baseSet.length, free: 0, carrier: 0, team: 0, fleet: 0 };
            const roleCounts: Record<RoleFilter, number> = { all: baseSet.length, admin: 0, affiliate: 0, regular: 0 };
            for (const u of baseSet) {
              const p = ((u.plan || 'free').toLowerCase() as PlanFilter);
              if (p === 'free' || p === 'carrier' || p === 'team' || p === 'fleet') planCounts[p] += 1;
              if (u.isAdmin) roleCounts.admin += 1;
              else if (u.role === 'affiliate') roleCounts.affiliate += 1;
              else roleCounts.regular += 1;
            }
            const Pill = ({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) => (
              <button
                type="button"
                onClick={onClick}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition flex items-center gap-1.5 ${active ? 'bg-[#0B1E3F] text-white' : 'text-[#0B1E3F]/65 hover:text-[#0B1E3F] hover:bg-[#0B1E3F]/5'}`}
              >
                {label}
                <span className={`text-[10px] mono ${active ? 'text-white/60' : 'text-[#0B1E3F]/45'}`}>{count}</span>
              </button>
            );
            return (
              <>
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/45 mr-1">Plan</span>
                  <Pill active={planFilter === 'all'}     onClick={() => setPlanFilter('all')}     label="All"     count={planCounts.all} />
                  <Pill active={planFilter === 'free'}    onClick={() => setPlanFilter('free')}    label="Free"    count={planCounts.free} />
                  <Pill active={planFilter === 'carrier'} onClick={() => setPlanFilter('carrier')} label="Carrier" count={planCounts.carrier} />
                  <Pill active={planFilter === 'team'}    onClick={() => setPlanFilter('team')}    label="Team"    count={planCounts.team} />
                  <Pill active={planFilter === 'fleet'}   onClick={() => setPlanFilter('fleet')}   label="Fleet"   count={planCounts.fleet} />
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/45 mr-1">Role</span>
                  <Pill active={roleFilter === 'all'}       onClick={() => setRoleFilter('all')}       label="All"       count={roleCounts.all} />
                  <Pill active={roleFilter === 'admin'}     onClick={() => setRoleFilter('admin')}     label="Admin"     count={roleCounts.admin} />
                  <Pill active={roleFilter === 'affiliate'} onClick={() => setRoleFilter('affiliate')} label="Affiliate" count={roleCounts.affiliate} />
                  <Pill active={roleFilter === 'regular'}   onClick={() => setRoleFilter('regular')}   label="Regular"   count={roleCounts.regular} />
                </div>
                {(planFilter !== 'all' || roleFilter !== 'all') && (
                  <button
                    type="button"
                    onClick={() => { setPlanFilter('all'); setRoleFilter('all'); }}
                    className="ml-auto text-[11px] mono text-[#0B1E3F]/55 hover:text-[#DC2626] transition"
                  >
                    Clear filters
                  </button>
                )}
              </>
            );
          })()}
        </div>
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
          <div className="px-5 py-3 border-b border-[#0B1E3F]/5 flex items-center justify-between text-xs mono text-[#0B1E3F]/55">
            <div>
              {f
                ? <>Matching <strong className="text-[#0B1E3F]">{shown.length}</strong> of {users!.length}</>
                : <>Showing <strong className="text-[#0B1E3F]">{pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, shown.length)}</strong> of {shown.length}</>}
            </div>
            <div>Page {safePage} / {pageCount}</div>
          </div>
          <div className="divide-y divide-[#0B1E3F]/5">
            {visible.map((u: any) => {
              const initials = (u.name || u.email || '?').split(/[\s@]/).map((p: string) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
              return (
                <div key={u.id} className={`p-5 text-[#0B1E3F] ${u.isAdmin ? 'bg-[#0B1E3F]/[0.025] border-l-4 border-[#0B1E3F]' : ''}`}>
                  <div className="flex items-start gap-4 flex-wrap">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0 ${u.isAdmin ? 'bg-[#FF6B35]' : 'bg-[#0B1E3F]'}`}>{initials}</div>
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
                  </div>
                  <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-[#0B1E3F]/5">
                    {/* Admins bypass plan + affiliate logic — they have unlimited
                        access by virtue of the admin flag, and an admin promoting
                        themselves as their own affiliate would create a feedback
                        loop in payouts. Show only the demote control. */}
                    {!u.isAdmin && (
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
                    )}
                    <button
                      onClick={() => patchUser(u.id, { isAdmin: !u.isAdmin })}
                      disabled={pendingId === u.id}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition disabled:opacity-50 ${u.isAdmin ? 'border border-[#DC2626]/30 text-[#DC2626] hover:bg-[#DC2626]/5' : 'bg-[#0B1E3F] text-white hover:bg-[#0B1E3F]/90'}`}
                    >
                      {pendingId === u.id ? 'Saving…' : u.isAdmin ? 'Revoke admin' : 'Make admin'}
                    </button>
                    {!u.isAdmin && (
                      <button
                        onClick={() => setAffiliateUser(u)}
                        disabled={pendingId === u.id}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition disabled:opacity-50 ${u.role === 'affiliate' ? 'border border-[#16A34A]/40 text-[#16A34A] hover:bg-[#16A34A]/5' : 'border border-[#0B1E3F]/15 text-[#0B1E3F]/75 hover:bg-[#0B1E3F]/5'}`}
                      >
                        {u.role === 'affiliate'
                          ? (() => {
                              const codeLabel = u.affiliateCode || '—';
                              if (u.affiliateCommissionMode === 'per_plan' && u.affiliateCommissionByPlan) {
                                const parts = (['carrier', 'team', 'fleet'] as const)
                                  .filter((p) => u.affiliateCommissionByPlan[p])
                                  .map((p) => {
                                    const r = u.affiliateCommissionByPlan[p];
                                    return `${p[0].toUpperCase()} ${r.type === 'percent' ? `${r.value}%` : `$${r.value}`}`;
                                  })
                                  .join(' · ');
                                return `Affiliate · ${codeLabel} · ${parts || 'no plans'}`;
                              }
                              return `Affiliate · ${codeLabel} · ${u.affiliateCommissionType === 'percent' ? `${u.affiliateCommissionValue}%` : `$${u.affiliateCommissionValue}`}`;
                            })()
                          : 'Make affiliate'}
                      </button>
                    )}
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
          {pageCount > 1 && (
            <div className="px-5 py-3 border-t border-[#0B1E3F]/5 flex items-center justify-between gap-2 flex-wrap">
              <button
                onClick={() => setUserPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                className="px-3 py-1.5 border border-[#0B1E3F]/15 rounded-full text-xs font-medium text-[#0B1E3F] hover:bg-[#0B1E3F]/5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ← Previous
              </button>
              <div className="flex items-center gap-1 flex-wrap">
                {Array.from({ length: pageCount }, (_, i) => i + 1)
                  .filter((p) => p === 1 || p === pageCount || Math.abs(p - safePage) <= 1)
                  .map((p, i, arr) => {
                    const prev = arr[i - 1];
                    const gap = prev != null && p - prev > 1;
                    return (
                      <span key={p} className="flex items-center gap-1">
                        {gap && <span className="px-1 text-xs mono text-[#0B1E3F]/40">…</span>}
                        <button
                          onClick={() => setUserPage(p)}
                          className={`w-8 h-8 rounded-full text-xs font-medium transition ${p === safePage ? 'bg-[#0B1E3F] text-white' : 'text-[#0B1E3F]/60 hover:bg-[#0B1E3F]/5'}`}
                        >
                          {p}
                        </button>
                      </span>
                    );
                  })}
              </div>
              <button
                onClick={() => setUserPage((p) => Math.min(pageCount, p + 1))}
                disabled={safePage >= pageCount}
                className="px-3 py-1.5 border border-[#0B1E3F]/15 rounded-full text-xs font-medium text-[#0B1E3F] hover:bg-[#0B1E3F]/5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}
      </>)}
      {affiliateUser && (
        <AffiliateAssignModal
          user={affiliateUser}
          onClose={() => setAffiliateUser(null)}
          onSaved={() => { setAffiliateUser(null); load(); }}
        />
      )}
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

// "Which company?" — shown when /api/verify answers 409: a bare number that
// is an MC for one company and a DOT for another (`ambiguous_number`), or a
// name that matches several companies / none closely enough
// (`ambiguous_name`). Picking one re-runs the lookup with its MC-/DOT-
// query (plus `searched` for names, so the report says what was typed).
type CompanyChoiceSet = {
  code: 'ambiguous_number' | 'ambiguous_name';
  searched?: string;
  candidates: any[];
  total?: number;
  exactMatchFound?: boolean;
  needsConfirmation?: boolean;
};

function CompanyChoices({ set, onPick, compact = false }: { set: CompanyChoiceSet; onPick: (query: string, searched?: string) => void; compact?: boolean }) {
  const isName = set.code === 'ambiguous_name';
  const heading = !isName
    ? 'This number belongs to two different companies. Which one?'
    : set.exactMatchFound === false || set.needsConfirmation
      ? `No registered company is named exactly “${set.searched}”. Is it one of these?`
      : `${set.total && set.total > set.candidates.length ? `${set.total} companies` : 'Several companies'} match “${set.searched}”. Which one?`;
  const matchLabel: Record<string, string> = { exact: 'Exact name', strong: 'Close match', partial: 'Partial match', unrelated: 'Linked by web results' };
  return (
    <div className={compact ? '' : 'mt-4 p-4 bg-[#F5F3EE] border border-[#0B1E3F]/15 rounded-xl'}>
      <div className={`${compact ? 'px-2 pt-1 pb-2 text-xs' : 'text-sm font-semibold mb-3'} text-[#0B1E3F]/75`}>{heading}</div>
      <div className="space-y-1">
        {set.candidates.map((c: any) => (
          <button
            key={c.query}
            type="button"
            onClick={() => onPick(c.query, isName ? set.searched : undefined)}
            className={`w-full flex items-start gap-2 ${compact ? 'px-2 py-2 rounded-md' : 'px-3 py-2.5 rounded-lg bg-white border border-[#0B1E3F]/10'} text-left text-sm text-[#0B1E3F] hover:bg-[#0B1E3F]/5 transition`}
          >
            <span className="mono text-[11px] px-1.5 py-0.5 rounded bg-[#0B1E3F]/5 flex-shrink-0 mt-0.5">{c.kind === 'mc' ? `MC ${c.mc || c.value}` : `DOT ${c.dot || c.value}`}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{c.name}{c.dba ? <span className="text-[#0B1E3F]/55 font-normal"> · DBA {c.dba}</span> : null}</span>
              {isName && (
                <span className="block text-xs text-[#0B1E3F]/55 truncate">
                  {[c.city && c.state ? `${c.city}, ${c.state}` : c.state, c.status, matchLabel[c.match]].filter(Boolean).join(' · ')}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
      {isName && set.candidates.length > 0 && (
        <div className={`${compact ? 'px-2 pt-2' : 'mt-3'} text-[11px] text-[#0B1E3F]/50`}>Not listed? Search by the MC or DOT number from the rate con instead.</div>
      )}
    </div>
  );
}

// ─── Type-ahead company suggestions ─────────────────────────────────────
// While the user types an MC, DOT or name, show matching companies from
// FMCSA's public registry (/api/search/suggest — free, no lookup credit).
// Picking one runs the full check for exactly that company.

type CompanySuggestion = {
  name: string; dba?: string; mc?: string; dot?: string; city?: string; state?: string;
  role: 'carrier' | 'broker' | 'both' | 'none' | 'dot-only'; active: boolean; powerUnits?: number;
  query: string; matchedOn: 'mc' | 'dot' | 'name' | 'dba';
};

function useCompanySuggestions(query: string, kind: 'mc' | 'dot' | 'name' | 'auto' | null) {
  const [items, setItems] = useState<CompanySuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  // What the last finished search was for, and whether it failed — so the
  // list can say "no companies found" / "unavailable" instead of vanishing.
  const [searched, setSearched] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const q = query.trim();
    const digits = q.replace(/\D/g, '');
    const isNumberish = /^(mc|dot|usdot)?[\s#-]*\d[\d\s-]*$/i.test(q);
    // Numbers need 3+ digits (and a registry choice on the Verify page);
    // names need 3+ characters.
    const ready = kind !== null && (isNumberish ? digits.length >= 3 : q.length >= 3);
    if (!ready) { setItems([]); setLoading(false); setSearched(''); setFailed(false); return; }
    const controller = new AbortController();
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const effKind = isNumberish ? kind : 'name';
        const res = await fetch(`/api/search/suggest?q=${encodeURIComponent(q)}&kind=${effKind}`, { signal: controller.signal });
        const data = await res.json().catch(() => ({}));
        setItems(Array.isArray(data?.suggestions) ? data.suggestions : []);
        setFailed(!res.ok || Boolean(data?.error));
        setSearched(q);
      } catch (e: any) {
        if (e?.name !== 'AbortError') { setItems([]); setFailed(true); setSearched(q); }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => { clearTimeout(t); controller.abort(); };
  }, [query, kind]);
  return { items, loading, searched, failed };
}

const SUGGEST_ROLE: Record<CompanySuggestion['role'], { label: string; cls: string }> = {
  carrier: { label: 'Carrier', cls: 'bg-[#0B1E3F] text-white' },
  broker: { label: 'Broker', cls: 'bg-[#FF6B35] text-white' },
  both: { label: 'Carrier + Broker', cls: 'bg-[#0B1E3F] text-white' },
  none: { label: 'No active authority', cls: 'bg-[#0B1E3F]/10 text-[#0B1E3F]/60' },
  'dot-only': { label: 'USDOT only', cls: 'bg-[#0B1E3F]/10 text-[#0B1E3F]/65' },
};

function SuggestionList({ items, loading, activeIndex, onPick, onHover, compact = false, searched = '', failed = false }: {
  items: CompanySuggestion[]; loading: boolean; activeIndex: number;
  onPick: (s: CompanySuggestion) => void; onHover: (i: number) => void; compact?: boolean;
  searched?: string; failed?: boolean;
}) {
  if (!loading && items.length === 0) {
    if (!searched) return null;
    return (
      <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-[#0B1E3F]/15 rounded-xl shadow-lg z-40 px-4 py-3 text-sm text-[#0B1E3F]/60">
        {failed
          ? 'Suggestions are unavailable right now. Press Verify to run the full check.'
          : <>No companies found starting with “{searched}”. Check the number, or press Verify to run the full check.</>}
      </div>
    );
  }
  return (
    <div role="listbox" className={`absolute left-0 right-0 top-full mt-1 bg-white border border-[#0B1E3F]/15 rounded-xl shadow-lg z-40 overflow-hidden ${compact ? 'max-h-[70vh]' : 'max-h-[420px]'} overflow-y-auto`}>
      {items.length === 0 && loading && <div className="px-4 py-3 text-sm text-[#0B1E3F]/55">Searching FMCSA…</div>}
      {items.map((s, i) => {
        const role = SUGGEST_ROLE[s.role];
        const meta = [
          s.mc ? `MC ${s.mc}` : null,
          s.dot ? `DOT ${s.dot}` : null,
          s.city && s.state ? `${s.city}, ${s.state}` : s.state,
          s.powerUnits ? `${s.powerUnits} truck${s.powerUnits === 1 ? '' : 's'}` : null,
        ].filter(Boolean).join(' · ');
        return (
          <button
            key={s.query}
            type="button"
            role="option"
            aria-selected={i === activeIndex}
            // onMouseDown so the pick lands before the input's blur closes the list.
            onMouseDown={(e) => { e.preventDefault(); onPick(s); }}
            onMouseEnter={() => onHover(i)}
            className={`w-full text-left px-4 ${compact ? 'py-2' : 'py-2.5'} flex items-start gap-3 border-b border-[#0B1E3F]/5 last:border-0 ${i === activeIndex ? 'bg-[#0B1E3F]/5' : 'bg-white'}`}
          >
            <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${s.active ? 'bg-[#16A34A]' : 'bg-[#0B1E3F]/25'}`} title={s.active ? 'Active' : 'Inactive'} />
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold text-[#0B1E3F] truncate">
                {s.name}
                {s.dba && <span className={`font-normal ${s.matchedOn === 'dba' ? 'text-[#0B1E3F]/75' : 'text-[#0B1E3F]/50'}`}> · DBA {s.dba}</span>}
              </span>
              <span className="block text-xs mono text-[#0B1E3F]/55 truncate">{meta}</span>
            </span>
            <span className="flex flex-col items-end gap-1 flex-shrink-0">
              <span className={`text-[10px] mono uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold ${role.cls}`}>{role.label}</span>
              {!s.active && <span className="text-[10px] text-[#0B1E3F]/45">Inactive</span>}
            </span>
          </button>
        );
      })}
      {items.length > 0 && (
        <div className="px-4 py-2 bg-[#F5F3EE]/70 text-[11px] text-[#0B1E3F]/50 flex items-center justify-between gap-2">
          <span>From FMCSA&apos;s public registry{loading ? ' · updating…' : ''}</span>
          <span>Picking one runs a full check</span>
        </div>
      )}
    </div>
  );
}

// Arrow keys / Enter / Escape over a suggestion list. Returns true when the
// key was handled (so the caller skips its own Enter behaviour).
function suggestionKeys(e: React.KeyboardEvent, open: boolean, count: number, index: number, setIndex: (i: number) => void, pick: (i: number) => void, close: () => void): boolean {
  if (!open || count === 0) return false;
  if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(Math.min(count - 1, index + 1)); return true; }
  if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(Math.max(-1, index - 1)); return true; }
  if (e.key === 'Escape') { close(); return true; }
  if (e.key === 'Enter' && index >= 0) { e.preventDefault(); pick(index); return true; }
  return false;
}

function HeaderSearch({ navigate }: { navigate: any }) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Number or name that matches more than one company.
  const [choices, setChoices] = useState<CompanyChoiceSet | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  // Type-ahead: bare numbers search MC and DOT at once (each suggestion
  // names its registry); anything with letters is a name search.
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestIndex, setSuggestIndex] = useState(-1);
  const { items: suggestions, loading: suggestLoading, searched: suggestSearched, failed: suggestFailed } = useCompanySuggestions(suggestOpen && !choices ? input : '', 'auto');

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

  const run = async (q: string, searched?: string) => {
    if (!q) return;
    setLoading(true); setError(null); setChoices(null); setSuggestOpen(false);
    try {
      const res = await fetch(`/api/verify?q=${encodeURIComponent(q)}${searched ? `&searched=${encodeURIComponent(searched)}` : ''}`);
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409 && Array.isArray(data?.candidates)) {
          setChoices({ code: data.code === 'ambiguous_name' ? 'ambiguous_name' : 'ambiguous_number', searched: data.searched || q, candidates: data.candidates, total: data.total, exactMatchFound: data.exactMatchFound, needsConfirmation: data.needsConfirmation });
          return;
        }
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

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    run(input.trim());
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
          onChange={(e) => { setInput(e.target.value); setSuggestOpen(true); setSuggestIndex(-1); setChoices(null); }}
          onFocus={() => setSuggestOpen(true)}
          onBlur={() => setTimeout(() => setSuggestOpen(false), 120)}
          onKeyDown={(e) => {
            suggestionKeys(e, suggestOpen, suggestions.length, suggestIndex, setSuggestIndex,
              (i) => { const s = suggestions[i]; setInput(s.query); run(s.query); },
              () => setSuggestOpen(false));
          }}
          role="combobox"
          aria-expanded={suggestOpen && suggestions.length > 0}
          aria-autocomplete="list"
          autoComplete="off"
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
      {suggestOpen && !choices && (
        <SuggestionList
          compact
          items={suggestions}
          loading={suggestLoading}
          searched={suggestSearched}
          failed={suggestFailed}
          activeIndex={suggestIndex}
          onHover={setSuggestIndex}
          onPick={(s) => { setInput(s.query); run(s.query); }}
        />
      )}
      {choices && (
        <div className="absolute left-0 right-0 top-full mt-1 p-2 bg-white border border-[#0B1E3F]/15 rounded-lg shadow-md z-30 max-h-[70vh] overflow-y-auto">
          <CompanyChoices compact set={choices} onPick={(query, searched) => { setInput(query); run(query, searched); }} />
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
  // The "your company was checked" toast's View button opens this window.
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('haulock:open-own-company', show);
    return () => window.removeEventListener('haulock:open-own-company', show);
  }, []);

  if (!data || (!data.ownMc && !data.ownDot)) {
    return (
      <button onClick={() => navigate('settings', { tab: 'profile' })} className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-[#0B1E3F]/5 hover:bg-[#0B1E3F]/10 rounded-full text-xs text-[#0B1E3F]/60 transition" title="Set your MC or DOT in Settings → Profile to see your own company's Haulock score here">
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
          title={hasUnseenChange ? `New change on your ${idLabel}: ${change?.summary}` : `Your ${idLabel} Haulock score · click for details`}
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
      {open && <OwnScoreModal report={r} cached={r.cached} cachedAt={r.cachedAt} change={change} navigate={navigate} onClose={() => setOpen(false)} onOpenFull={() => { setOpen(false); navigate('report', r); }} />}
    </>
  );
}

function OwnScoreModal({ report, cached, cachedAt, change, navigate, onClose, onOpenFull }: any) {
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
            <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-1">Your Haulock score</div>
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
        {/* How often the company is checked on Haulock + daily FMCSA monitoring. */}
        <YourCompanyCard navigate={(to: string, d?: any) => { onClose(); navigate(to, d); }} embedded />
        <div className="flex gap-2 pt-4 border-t border-[#0B1E3F]/10">
          <button onClick={onClose} className="flex-1 py-2.5 border border-[#0B1E3F]/15 rounded-full text-sm font-medium text-[#0B1E3F] hover:bg-[#0B1E3F]/5">Close</button>
          <button onClick={onOpenFull} className="flex-1 py-2.5 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90">Open full report</button>
        </div>
      </div>
    </div>
  );
}

// "Your company was checked" toast — paid accounts with a verified company.
// Polls a delayed, grouped count (never who or exactly when) and keeps its
// cursor per user on this device.
function CompanyCheckToaster({ userId }: { userId?: string }) {
  const [toast, setToast] = useState<number | null>(null);
  useEffect(() => {
    if (!userId) return;
    const key = `haulock:companyChecksSeen:${userId}`;
    let stopped = false;
    let hideTimer: any;
    const poll = async () => {
      if (stopped || document.visibilityState !== 'visible') return;
      let since: string | null = null;
      try { since = localStorage.getItem(key); } catch {}
      try {
        const r = await fetch(`/api/profile/company/new-checks${since ? `?since=${encodeURIComponent(since)}` : ''}`, { cache: 'no-store' });
        if (!r.ok) return;
        const j = await r.json();
        if (!j.enabled) { stopped = true; return; }
        if (j.until) { try { localStorage.setItem(key, j.until); } catch {} }
        if (j.count > 0) {
          setToast(j.count);
          clearTimeout(hideTimer);
          hideTimer = setTimeout(() => setToast(null), 15000);
        }
      } catch {}
    };
    const first = setTimeout(poll, 4000);
    const every = setInterval(poll, 5 * 60 * 1000);
    const onVisible = () => { if (document.visibilityState === 'visible') poll(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { stopped = true; clearTimeout(first); clearInterval(every); clearTimeout(hideTimer); document.removeEventListener('visibilitychange', onVisible); };
  }, [userId]);
  if (toast == null) return null;
  return (
    <div role="status" aria-live="polite" className="fixed bottom-5 right-5 z-[70] max-w-sm w-[calc(100%-2.5rem)] bg-white border border-[#0B1E3F]/15 rounded-2xl shadow-2xl p-4 flex items-start gap-3 text-[#0B1E3F]">
      <div className="w-9 h-9 rounded-xl bg-[#FF6B35] flex items-center justify-center flex-shrink-0"><Eye className="w-4 h-4 text-white" /></div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold">Your company was checked {toast === 1 ? 'once' : `${toast} times`} on Haulock</div>
        <div className="text-xs text-[#0B1E3F]/60 mt-0.5">Since you last looked. We never show who.</div>
        <button onClick={() => { setToast(null); window.dispatchEvent(new CustomEvent('haulock:open-own-company')); }} className="mt-2 text-xs font-semibold underline">View</button>
      </div>
      <button onClick={() => setToast(null)} className="text-[#0B1E3F]/40 hover:text-[#0B1E3F]" aria-label="Dismiss"><X className="w-4 h-4" /></button>
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
  // Badges stay live: any page that changes alerts/tickets invalidates the
  // shared cache key, and these re-check every minute while the tab is open.
  const alertsRes = useCachedFetch<{ unseenCount: number }>('alerts', '/api/alerts', { refreshMs: 60_000 });
  const alertCount = alertsRes.data?.unseenCount || 0;
  const usageRes = useCachedFetch<{ plan: any; usage: any; isAdmin?: boolean }>('usage', '/api/usage');
  const usagePlan = getPlan(user?.plan || usageRes.data?.plan?.id);
  const usageNums = usageRes.data?.usage || { fmcsaLookups: 0, rateConScans: 0 };
  // /api/usage takes a moment, so remember the last answer per user on this
  // device and show Admin / Sales immediately. The server still checks
  // admin on every admin API call — this only decides what the sidebar shows.
  const adminKey = `haulock:isAdmin:${user?.id || user?.email || ''}`;
  const [cachedAdmin] = useState<boolean>(() => {
    try { return typeof window !== 'undefined' && localStorage.getItem(adminKey) === '1'; } catch { return false; }
  });
  const isAdmin = usageRes.data ? Boolean(usageRes.data.isAdmin) : cachedAdmin;
  useEffect(() => {
    if (!usageRes.data) return;
    try { localStorage.setItem(adminKey, usageRes.data.isAdmin ? '1' : '0'); } catch {}
  }, [usageRes.data, adminKey]);
  // Open-tickets count for the Admin sidebar badge. Lightweight endpoint
  // that returns just `{ open, working, solved }` — no joins, head-only
  // count queries. Non-admins always get zeros so this hook is safe to
  // run unconditionally.
  const supportCountsRes = useCachedFetch<{ open: number; working: number; solved: number }>(
    'admin-support-counts',
    isAdmin ? '/api/admin/support/counts' : null,
    { refreshMs: 60_000 },
  );
  const openTickets = isAdmin ? (supportCountsRes.data?.open || 0) : 0;
  const lookupsLeft = isAdmin || usagePlan.limits.fmcsaLookups == null ? null : Math.max(0, usagePlan.limits.fmcsaLookups - usageNums.fmcsaLookups);
  const scansLeft = isAdmin || usagePlan.limits.rateConScans == null ? null : Math.max(0, usagePlan.limits.rateConScans - usageNums.rateConScans);
  const isAffiliate = user?.role === 'affiliate';
  const navItems: any[] = [
    { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
    { id: 'verify', label: 'Verify broker / carrier', icon: Search },
    { id: 'planner', label: 'Load planner', icon: RouteIcon },
    { id: 'history', label: 'History', icon: Clock },
    { id: 'watchlist', label: 'Watchlist', icon: Eye },
    { id: 'alerts', label: 'Alerts', icon: Bell, badge: alertCount > 0 ? alertCount : null },
    { id: 'plan', label: 'Plan & billing', icon: Zap },
    { id: 'settings', label: 'Settings', icon: Settings },
    // Admins manage tickets from the Admin → Support tickets tab, so the
    // user-facing Support entry is hidden for them.
    ...(isAdmin ? [] : [{ id: 'support', label: 'Support', icon: LifeBuoy }]),
    // Affiliate-only — the earnings dashboard appears in the same sidebar
    // slot the operator sees as Admin. A user can be either, never both.
    ...(isAffiliate && !isAdmin ? [{ id: 'earnings', label: 'My earnings', icon: TrendingUp }] : []),
    ...(isAdmin ? [{ id: 'admin', label: 'Admin', icon: ShieldCheck, badge: openTickets > 0 ? openTickets : null }] : []),
    ...(isAdmin ? [{ id: 'sales', label: 'Sales', icon: Target }] : []),
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
        <CompanyCheckToaster userId={user?.id} />
      </div>
    </div>
  );
}

// "Your company" — paid accounts: how often other Haulock users checked the
// company (verified owners only, counts never identities), and daily
// monitoring of its FMCSA record with an email on any change.
function YourCompanyCard({ navigate, embedded = false }: { navigate: any; embedded?: boolean }) {
  const res = useCachedFetch<any>('own-company', '/api/profile/company');
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState<'verify' | 'monitor' | 'code' | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  // Code route: the masked FMCSA filing email we can send a code to, and
  // whether a code is on its way.
  const [emailOnFile, setEmailOnFile] = useState<string | null>(null);
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  useEffect(() => { if (res.data) setData(res.data); }, [res.data]);
  const d = data || res.data;
  if (!d) return null;

  const reload = async () => {
    const r = await fetch('/api/profile/company', { cache: 'no-store' });
    if (r.ok) setData(await r.json());
    invalidateCache('own-company');
  };
  const act = async (body: any, kind: 'verify' | 'monitor' | 'code') => {
    setBusy(kind); setMessage(null);
    try {
      const r = await fetch('/api/profile/company', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (j.emailOnFile) setEmailOnFile(j.emailOnFile);
      if (!r.ok || j.ok === false) throw new Error(j.error || 'Something went wrong');
      if (body.action === 'verify') setMessage({ tone: 'ok', text: 'Verified — your login email is on your company’s domain.' });
      if (body.action === 'send_code') { setCodeSentTo(j.sentTo); setCode(''); setMessage({ tone: 'ok', text: `Code sent to ${j.sentTo}. It expires in 30 minutes.` }); return; }
      if (body.action === 'confirm_code') { setCodeSentTo(null); setMessage({ tone: 'ok', text: 'Verified with the code from your FMCSA email.' }); }
      await reload();
    } catch (e: any) {
      setMessage({ tone: 'err', text: e?.message || 'Something went wrong' });
    } finally {
      setBusy(null);
    }
  };

  // Embedded = inside the header chip's window (company name/score already
  // shown above it), so no card frame or title.
  const shell = (children: React.ReactNode) => embedded ? (
    <div className="text-[#0B1E3F] pt-4 mb-4 border-t border-[#0B1E3F]/10">{children}</div>
  ) : (
    <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-6 card-shadow text-[#0B1E3F]">
      <div className="flex items-center gap-2 mb-1">
        <Building2 className="w-4 h-4 text-[#0B1E3F]/60" />
        <h2 className="text-lg font-semibold">Your company</h2>
        {d.mc || d.dot ? <span className="text-xs mono text-[#0B1E3F]/50">{[d.mc && `MC-${d.mc}`, d.dot && `DOT-${d.dot}`].filter(Boolean).join(' · ')}</span> : null}
      </div>
      {children}
    </div>
  );

  if (!d.hasCompany) {
    return shell(
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mt-2">
        <p className="text-sm text-[#0B1E3F]/65">Add your MC or DOT to see how often your company is checked on Haulock, and to get an email the moment your FMCSA record changes.</p>
        <button onClick={() => navigate('settings', { tab: 'profile' })} className="px-4 py-2 bg-[#0B1E3F] text-white rounded-full text-sm font-medium whitespace-nowrap">Set your MC/DOT</button>
      </div>,
    );
  }
  if (!d.paid) {
    return shell(
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mt-2">
        <p className="text-sm text-[#0B1E3F]/65"><Lock className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />See how often brokers and carriers check your company on Haulock, and get an email the moment anything changes on your FMCSA record (insurance, authority, address, phone, email, officers). Included on paid plans.</p>
        <button onClick={() => navigate('plan')} className="px-4 py-2 bg-[#0B1E3F] text-white rounded-full text-sm font-medium whitespace-nowrap">See plans</button>
      </div>,
    );
  }

  const c = d.checks;
  const max = c ? Math.max(1, ...c.weeks.map((w: any) => w.count)) : 1;
  const fmtWeek = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return shell(
    <div className={`grid gap-6 ${embedded ? '' : 'md:grid-cols-2 mt-4'}`}>
      {/* Checked on Haulock */}
      <div>
        <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-2">Checked on Haulock</div>
        {!d.verified ? (
          <div className="space-y-3">
            <p className="text-sm text-[#0B1E3F]/70">To see how often your company is checked, confirm it&apos;s yours: sign in with an email on your company&apos;s domain, or get a code at the email on your company&apos;s FMCSA filing (MCS-150).</p>
            {codeSentTo ? (
              <div className="flex flex-wrap items-center gap-2">
                <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code" className="w-36 px-3 py-2 border border-[#0B1E3F]/20 rounded-full text-sm mono tracking-widest focus:outline-none focus:border-[#0B1E3F]" />
                <button onClick={() => act({ action: 'confirm_code', code }, 'code')} disabled={busy !== null || code.length !== 6} className="px-4 py-2 bg-[#0B1E3F] text-white rounded-full text-sm font-medium disabled:opacity-60">{busy === 'code' ? 'Checking…' : 'Confirm'}</button>
                <button onClick={() => act({ action: 'send_code' }, 'code')} disabled={busy !== null} className="text-xs underline text-[#0B1E3F]/55 hover:text-[#0B1E3F]">Send a new code</button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => act({ action: 'verify' }, 'verify')} disabled={busy !== null} className="px-4 py-2 bg-[#0B1E3F] text-white rounded-full text-sm font-medium disabled:opacity-60">{busy === 'verify' ? 'Checking FMCSA…' : 'Verify my company'}</button>
                <button onClick={() => act({ action: 'send_code' }, 'code')} disabled={busy !== null} className="px-4 py-2 border border-[#0B1E3F]/15 rounded-full text-sm font-medium hover:bg-[#0B1E3F]/5 disabled:opacity-60">{busy === 'code' ? 'Sending…' : emailOnFile ? `Email a code to ${emailOnFile}` : 'Email me a code instead'}</button>
              </div>
            )}
          </div>
        ) : c ? (
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-semibold">{c.last30}</span>
              <span className="text-sm text-[#0B1E3F]/60">{c.last30 === 1 ? 'check' : 'checks'} in the last 30 days{c.distinctAccounts30 ? ` · by ${c.distinctAccounts30} account${c.distinctAccounts30 === 1 ? '' : 's'}` : ''}</span>
            </div>
            {/* 12 weekly bars, oldest → newest; whole column is the hover target. */}
            <div className="mt-3 relative" role="img" aria-label={`Checks per week for the last 12 weeks: ${c.weeks.map((w: any) => w.count).join(', ')}`}>
              <div className="flex items-end h-16" style={{ gap: 2 }}>
                {c.weeks.map((w: any, i: number) => (
                  <div key={w.weekStart} className="flex-1 h-full flex items-end cursor-default" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                    <div className="w-full rounded-t" style={{ height: `${w.count ? Math.max(8, (w.count / max) * 100) : 4}%`, background: w.count ? (hover === i ? '#FF6B35' : '#0B1E3F') : 'rgba(11,30,63,0.12)' }} />
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-[10px] mono text-[#0B1E3F]/45 mt-1">
                <span>{fmtWeek(c.weeks[0].weekStart)}</span>
                <span>{hover != null ? `Week of ${fmtWeek(c.weeks[hover].weekStart)}: ${c.weeks[hover].count} ${c.weeks[hover].count === 1 ? 'check' : 'checks'}` : 'This week'}</span>
              </div>
            </div>
            <div className="mt-3 text-xs text-[#0B1E3F]/60">
              {c.lastCheckedDaysAgo == null ? 'Not checked in the last 12 weeks.' : `Last checked ${c.lastCheckedDaysAgo === 0 ? 'today' : c.lastCheckedDaysAgo === 1 ? 'yesterday' : `${c.lastCheckedDaysAgo} days ago`}.`}
              {c.last30 > 0 && ` ${c.byKind30.lookups} lookup${c.byKind30.lookups === 1 ? '' : 's'}, ${c.byKind30.rateCons} on a rate con, ${c.byKind30.cois} COI check${c.byKind30.cois === 1 ? '' : 's'}.`}
            </div>
            <div className="mt-1 text-[11px] text-[#0B1E3F]/45">We show how often, never who. Checks on FMCSA&apos;s own site aren&apos;t visible to anyone.</div>
          </div>
        ) : null}
      </div>

      {/* FMCSA monitoring */}
      <div>
        <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-2">FMCSA monitoring</div>
        {d.monitoring?.on ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-[#16A34A]"><span className="w-2 h-2 rounded-full bg-[#16A34A]" /> On</div>
            <p className="text-sm text-[#0B1E3F]/70">We check your FMCSA record every day and email you the moment anything changes (insurance, authority, address, phone, email or officers) and each time a new roadside inspection or crash is filed on your DOT. A change you didn&apos;t make is the first sign of a hijacked identity.</p>
            <div className="text-xs text-[#0B1E3F]/55">
              {d.monitoring.lastChecked ? `Last checked ${timeAgo(d.monitoring.lastChecked)}` : 'First check runs tonight'}
              {d.monitoring.lastChangeAt ? ` · last change found ${timeAgo(d.monitoring.lastChangeAt)}` : ' · no changes found yet'}
            </div>
            <button onClick={() => act({ action: 'monitor', on: false }, 'monitor')} disabled={busy !== null} className="text-xs underline text-[#0B1E3F]/55 hover:text-[#0B1E3F]">Turn off</button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-[#0B1E3F]/70">Get an email the moment your FMCSA record changes (insurance, authority, address, phone, email or officers) and each time a roadside inspection or crash is filed on your DOT, so you hear about it before your customers and insurer do.</p>
            <button onClick={() => act({ action: 'monitor', on: true }, 'monitor')} disabled={busy !== null} className="px-4 py-2 bg-[#0B1E3F] text-white rounded-full text-sm font-medium disabled:opacity-60">{busy === 'monitor' ? 'Turning on…' : 'Turn on monitoring'}</button>
          </div>
        )}
      </div>
      {/* Roadside inspections & crashes */}
      {d.usdot && (
        <div className={embedded ? '' : 'md:col-span-2'}>
          <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-2">Roadside inspections &amp; crashes</div>
          <OwnSafetySummary dot={String(d.usdot)} monitoringOn={Boolean(d.monitoring?.on)} />
        </div>
      )}
      {message && <div className={`${embedded ? '' : 'md:col-span-2'} text-sm ${message.tone === 'ok' ? 'text-[#16A34A]' : 'text-[#DC2626]'}`}>{message.text}</div>}
    </div>,
  );
}

// Latest inspection, last 30 days and last crash for the user's own DOT.
function OwnSafetySummary({ dot, monitoringOn, compact = false }: { dot: string; monitoringOn?: boolean; compact?: boolean }) {
  const res = useCachedFetch<any>(`safety:${dot}`, `/api/fmcsa/safety-activity?dot=${encodeURIComponent(dot)}`);
  const a = res.data;
  if (!a) return <div className="text-xs text-[#0B1E3F]/50">{res.loading ? 'Checking FMCSA inspection records…' : 'FMCSA inspection records didn’t respond.'}</div>;
  const last = a.inspections.last;
  const lastCrash = a.crashes.last;
  const l30 = a.last30;
  if (!last && !lastCrash) return <div className="text-sm text-[#0B1E3F]/65">No inspections or crashes on file in the last 24 months.</div>;
  return (
    <div className={compact ? 'space-y-1' : 'space-y-1.5'}>
      {last && (
        <div className="text-sm flex items-center gap-2 flex-wrap">
          <span className="text-[#0B1E3F]/60">Last inspection</span>
          <strong>{fmtEventDate(last.date)}</strong>
          {!compact && <span className="text-[#0B1E3F]/60">· {eventPlace(last.location, last.state)}</span>}
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${inspectionResult(last).cls}`}>{inspectionResult(last).label}</span>
        </div>
      )}
      <div className="text-xs text-[#0B1E3F]/60">
        Last 30 days: {l30.inspections} inspection{l30.inspections === 1 ? '' : 's'}
        {l30.oos > 0 && <span className="text-[#DC2626] font-medium"> · {l30.oos} out of service</span>}
        {l30.withViolations > 0 && ` · ${l30.withViolations} with violations`}
        {l30.crashes > 0 && <span className="text-[#DC2626] font-medium"> · {l30.crashes} crash{l30.crashes === 1 ? '' : 'es'}</span>}
      </div>
      {!compact && lastCrash && <div className="text-xs text-[#0B1E3F]/60">Last crash {fmtEventDate(lastCrash.date)} · {eventPlace(lastCrash.city || lastCrash.location, lastCrash.state)}</div>}
      {!compact && (
        <div className="text-[11px] text-[#0B1E3F]/45">
          {monitoringOn ? 'We email you each new inspection and crash filed on your DOT.' : 'Turn on monitoring to get an email for each new inspection and crash.'} Full history is on your report.
        </div>
      )}
    </div>
  );
}

// ---------- Load planner ----------
// Empty (deadhead) miles from the driver's location, loaded miles, drive
// time, and fuel at this week's EIA diesel price, with what's left after
// costs. Inputs can come from a scanned rate con.

const PLANNER_SETTINGS_KEY = 'haulock:plannerSettings';
type PlannerSettings = { mpg: string; driverPay: string; otherCpm: string };

function loadPlannerSettings(): PlannerSettings {
  const d = { mpg: '6.5', driverPay: '', otherCpm: '' };
  try { return { ...d, ...(JSON.parse(localStorage.getItem(PLANNER_SETTINGS_KEY) || '{}') || {}) }; } catch { return d; }
}

const money = (n: number, cents = false) => (isFinite(n) ? n : 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
const numIn = (v: string) => { const n = Number(String(v).replace(/[$,\s]/g, '')); return isFinite(n) && n > 0 ? n : 0; };

function LoadPlanner({ navigate }: { navigate: any }) {
  const lookupsRes = useCachedFetch<{ lookups: any[] }>('lookups:200', '/api/lookups?limit=200');
  const [origin, setOrigin] = useState('');
  const [originCoords, setOriginCoords] = useState<{ lat: number; lng: number } | null>(null);
  // A suggestion picked from the list (exact US place); typing clears it.
  const [originPlace, setOriginPlace] = useState<any>(null);
  const [pickupPlace, setPickupPlace] = useState<any>(null);
  const [deliveryPlace, setDeliveryPlace] = useState<any>(null);
  const [locating, setLocating] = useState(false);
  const [pickup, setPickup] = useState('');
  const [delivery, setDelivery] = useState('');
  const [rate, setRate] = useState('');
  const [extra, setExtra] = useState('');
  const [fuelOverride, setFuelOverride] = useState('');
  const [settings, setSettings] = useState<PlannerSettings>({ mpg: '6.5', driverPay: '', otherCpm: '' });
  const [showCosts, setShowCosts] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<any>(null);

  useEffect(() => { setSettings(loadPlannerSettings()); }, []);
  const saveSetting = (k: keyof PlannerSettings, v: string) => {
    setSettings((cur) => {
      const next = { ...cur, [k]: v };
      try { localStorage.setItem(PLANNER_SETTINGS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  // Prefill from "Plan this load" (rate con report) or a navigate() call.
  useEffect(() => {
    const apply = () => {
      let d: any = null;
      try { d = JSON.parse(sessionStorage.getItem('haulock:plannerPrefill') || 'null'); sessionStorage.removeItem('haulock:plannerPrefill'); } catch {}
      if (!d) return;
      if (d.pickup) { setPickup(String(d.pickup)); setPickupPlace(null); }
      if (d.delivery) { setDelivery(String(d.delivery)); setDeliveryPlace(null); }
      if (d.rate) setRate(String(d.rate));
      setPlan(null);
    };
    apply();
    window.addEventListener('haulock:planner-prefill', apply);
    return () => window.removeEventListener('haulock:planner-prefill', apply);
  }, []);

  const rateCons = (lookupsRes.data?.lookups || [])
    .filter((l: any) => l.source === 'ratecon' && (l.data?.rateCon?.origin || l.data?.rateCon?.destination))
    .slice(0, 15);

  const useMyLocation = () => {
    if (!navigator.geolocation) { setError('This browser can’t share its location. Type a city, ZIP or address instead.'); return; }
    setLocating(true); setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setOriginCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setOriginPlace(null); setOrigin('My current location'); setLocating(false); },
      () => { setLocating(false); setError('Location wasn’t shared. Type the driver’s city, ZIP or address instead.'); },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  };

  const calculate = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/planner/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: originCoords && origin === 'My current location' ? { ...originCoords, label: 'Driver’s current location' } : originPlace || origin,
          pickup: pickupPlace || pickup,
          delivery: deliveryPlace || delivery,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `Couldn’t plan the route (${r.status})`);
      setPlan(j);
      track('load_planned', { routing: j.routing, hasOrigin: Boolean(j.hasOrigin) });
    } catch (err: any) {
      setError(err?.message || 'Couldn’t plan the route');
    } finally {
      setBusy(false);
    }
  };

  // Numbers (recomputed instantly when rate or costs change).
  const legs: any[] = plan?.legs || [];
  const deadMiles = plan?.hasOrigin ? legs[0]?.miles || 0 : 0;
  const loadedMiles = legs.length ? legs[legs.length - 1].miles : 0;
  const totalMiles = deadMiles + loadedMiles;
  const driveHours = legs.reduce((s2, l) => s2 + (l.hours || 0), 0);
  const breaks = Math.max(0, Math.ceil(driveHours / 11) - 1); // 10-hour off-duty after each 11 hours driving
  const elapsedHours = driveHours + breaks * 10;
  const fuelPrice = numIn(fuelOverride) || plan?.diesel?.price || 0;
  const mpg = numIn(settings.mpg) || 6.5;
  const gallons = totalMiles / mpg;
  const fuelCost = gallons * fuelPrice;
  const revenue = numIn(rate) + numIn(extra);
  const driverCost = numIn(settings.driverPay) * totalMiles;
  const otherCost = numIn(settings.otherCpm) * totalMiles;
  const net = revenue - fuelCost - driverCost - otherCost;
  const costPerMile = totalMiles ? (fuelCost + driverCost + otherCost) / totalMiles : 0;
  const deadPct = totalMiles ? Math.round((deadMiles / totalMiles) * 100) : 0;
  const fmtHours = (h: number) => { const H = Math.floor(h), M = Math.round((h - H) * 60); return M === 60 ? `${H + 1}h` : `${H}h ${M}m`; };

  const input = 'w-full px-3.5 py-2.5 bg-white border border-[#0B1E3F]/15 rounded-xl text-sm focus:outline-none focus:border-[#0B1E3F] placeholder:text-[#0B1E3F]/35';
  const label = 'block text-[11px] mono uppercase tracking-wider text-[#0B1E3F]/60 mb-1.5';

  return (
    <div className="space-y-6 text-[#0B1E3F]">
      <div>
        <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-2">Load planner</div>
        <h1 className="text-4xl serif italic">Is this load worth it?</h1>
        <p className="text-[#0B1E3F]/60 mt-2 text-sm max-w-2xl">Empty miles from your truck, loaded miles, drive time with required breaks, and fuel at this week&apos;s diesel price. Type it in or pull it from a rate con.</p>
      </div>

      <div className="grid lg:grid-cols-[380px_minmax(0,1fr)] gap-6 items-start">
        {/* Inputs */}
        <form onSubmit={calculate} className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-5 card-shadow space-y-4">
          {rateCons.length > 0 && (
            <div>
              <label className={label}>Fill from a scanned rate con</label>
              <select
                className={input}
                value=""
                onChange={(e) => {
                  const l = rateCons.find((x: any) => x.id === e.target.value);
                  const rc = l?.data?.rateCon;
                  if (!rc) return;
                  setPickup(rc.origin || ''); setDelivery(rc.destination || ''); setPickupPlace(null); setDeliveryPlace(null);
                  if (rc.rate_amount) setRate(String(rc.rate_amount));
                  setPlan(null);
                }}
              >
                <option value="">Choose a rate con…</option>
                {rateCons.map((l: any) => (
                  <option key={l.id} value={l.id}>{[l.data.rateCon.origin, l.data.rateCon.destination].filter(Boolean).join(' → ')}{l.data.rateCon.rate_amount ? ` · ${money(l.data.rateCon.rate_amount)}` : ''}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className={label}>Driver&apos;s location now</label>
            <div className="flex gap-2">
              <div className="flex-1 min-w-0">
                <PlaceInput className={input} value={origin} picked={Boolean(originPlace || originCoords)} onText={(v) => { setOrigin(v); setOriginCoords(null); setOriginPlace(null); }} onPick={(pl) => { setOrigin(pl.label); setOriginPlace(pl); setOriginCoords(null); }} placeholder="US city, ZIP or address (optional)" />
              </div>
              <button type="button" onClick={useMyLocation} disabled={locating} title="Use this device’s location" className="px-3 border border-[#0B1E3F]/15 rounded-xl hover:bg-[#0B1E3F]/5 disabled:opacity-60 flex-shrink-0">
                {locating ? <div className="w-4 h-4 border-2 border-[#0B1E3F]/20 border-t-[#FF6B35] rounded-full animate-spin" /> : <Navigation className="w-4 h-4" />}
              </button>
            </div>
            <div className="text-[11px] text-[#0B1E3F]/45 mt-1">Used to count empty miles to the pickup.</div>
          </div>
          <div>
            <label className={label}>Pickup</label>
            <PlaceInput className={input} value={pickup} picked={Boolean(pickupPlace)} onText={(v) => { setPickup(v); setPickupPlace(null); }} onPick={(pl) => { setPickup(pl.label); setPickupPlace(pl); }} placeholder="Start typing a US city or ZIP" required />
          </div>
          <div>
            <label className={label}>Delivery</label>
            <PlaceInput className={input} value={delivery} picked={Boolean(deliveryPlace)} onText={(v) => { setDelivery(v); setDeliveryPlace(null); }} onPick={(pl) => { setDelivery(pl.label); setDeliveryPlace(pl); }} placeholder="Start typing a US city or ZIP" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Rate</label>
              <input className={input} value={rate} onChange={(e) => setRate(e.target.value)} placeholder="$2,400" inputMode="decimal" />
            </div>
            <div>
              <label className={label}>Fuel surcharge / extras</label>
              <input className={input} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="$0" inputMode="decimal" />
            </div>
          </div>

          <button type="button" onClick={() => setShowCosts((v) => !v)} className="flex items-center gap-1.5 text-xs font-medium text-[#0B1E3F]/70 hover:text-[#0B1E3F]">
            <ChevronRight className={`w-3.5 h-3.5 transition-transform ${showCosts ? 'rotate-90' : ''}`} /> Your truck &amp; costs
          </button>
          {showCosts && (
            <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-[#0B1E3F]/[0.03]">
              <div>
                <label className={label}>Miles per gallon</label>
                <input className={input} value={settings.mpg} onChange={(e) => saveSetting('mpg', e.target.value)} inputMode="decimal" />
              </div>
              <div>
                <label className={label}>Diesel $/gal</label>
                <input className={input} value={fuelOverride} onChange={(e) => setFuelOverride(e.target.value)} placeholder={plan?.diesel?.price ? `${plan.diesel.price.toFixed(3)} (EIA)` : 'This week’s average'} inputMode="decimal" />
              </div>
              <div>
                <label className={label}>Driver pay $/mile</label>
                <input className={input} value={settings.driverPay} onChange={(e) => saveSetting('driverPay', e.target.value)} placeholder="0.00" inputMode="decimal" />
              </div>
              <div>
                <label className={label}>Other costs $/mile</label>
                <input className={input} value={settings.otherCpm} onChange={(e) => saveSetting('otherCpm', e.target.value)} placeholder="e.g. 0.35" inputMode="decimal" />
              </div>
              <div className="col-span-2 text-[11px] text-[#0B1E3F]/50">Other costs: truck payment, insurance, maintenance, tires, tolls. Saved on this device.</div>
            </div>
          )}

          {error && <div className="text-sm text-[#DC2626]">{error}</div>}
          <button type="submit" disabled={busy} className="w-full py-3 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90 disabled:opacity-60 flex items-center justify-center gap-2">
            {busy ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Planning the route…</> : <><RouteIcon className="w-4 h-4" /> Plan this load</>}
          </button>
          {rateCons.length === 0 && (
            <button type="button" onClick={() => navigate('verify', { tab: 'ratecon' })} className="w-full text-xs text-[#0B1E3F]/55 hover:text-[#0B1E3F] underline">Scan a rate con to fill this in</button>
          )}
          <div className="text-[10px] text-[#0B1E3F]/40 text-center">US loads only · city &amp; ZIP list from GeoNames (CC BY 4.0)</div>
        </form>

        {/* Map + numbers */}
        <div className="space-y-4 min-w-0">
          <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 card-shadow overflow-hidden">
            <PlannerMap plan={plan} />
          </div>

          {plan ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-4 rounded-2xl bg-white border border-[#0B1E3F]/10 card-shadow">
                  <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">Empty miles</div>
                  <div className="text-2xl font-semibold mt-1">{plan.hasOrigin ? Math.round(deadMiles).toLocaleString() : '—'}</div>
                  <div className={`text-[11px] ${deadPct > 25 ? 'text-[#B45309] font-medium' : 'text-[#0B1E3F]/55'}`}>{plan.hasOrigin ? `${deadPct}% of the trip` : 'Add the driver’s location'}</div>
                </div>
                <div className="p-4 rounded-2xl bg-white border border-[#0B1E3F]/10 card-shadow">
                  <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">Loaded miles</div>
                  <div className="text-2xl font-semibold mt-1">{Math.round(loadedMiles).toLocaleString()}</div>
                  <div className="text-[11px] text-[#0B1E3F]/55">{Math.round(totalMiles).toLocaleString()} total</div>
                </div>
                <div className="p-4 rounded-2xl bg-white border border-[#0B1E3F]/10 card-shadow">
                  <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">Rate per mile</div>
                  <div className="text-2xl font-semibold mt-1">{revenue && loadedMiles ? money(revenue / loadedMiles, true) : '—'}</div>
                  <div className="text-[11px] text-[#0B1E3F]/55">{revenue && totalMiles ? `${money(revenue / totalMiles, true)} all-in with empty miles` : 'Enter the rate'}</div>
                </div>
                <div className="p-4 rounded-2xl bg-white border border-[#0B1E3F]/10 card-shadow">
                  <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">Drive time</div>
                  <div className="text-2xl font-semibold mt-1">{fmtHours(driveHours)}</div>
                  <div className="text-[11px] text-[#0B1E3F]/55">{breaks ? `≈ ${fmtHours(elapsedHours)} with ${breaks} 10-hour break${breaks === 1 ? '' : 's'}` : 'Fits in one 11-hour shift'}</div>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-5 card-shadow">
                <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                  <h2 className="text-lg font-semibold">What&apos;s left after costs</h2>
                  {revenue > 0 && <span className={`px-3 py-1 rounded-full text-sm font-semibold ${net > 0 ? 'bg-[#16A34A]/10 text-[#16A34A]' : 'bg-[#DC2626]/10 text-[#DC2626]'}`}>{money(net)}{totalMiles ? ` · ${money(net / totalMiles, true)}/mi` : ''}</span>}
                </div>
                <div className="divide-y divide-[#0B1E3F]/5 text-sm">
                  <div className="flex justify-between py-2"><span className="text-[#0B1E3F]/65">Rate{numIn(extra) ? ' + extras' : ''}</span><span className="font-medium">{revenue ? money(revenue) : '—'}</span></div>
                  <div className="flex justify-between py-2 gap-3">
                    <span className="text-[#0B1E3F]/65 flex items-center gap-1.5"><Fuel className="w-3.5 h-3.5" /> Fuel · {Math.round(gallons).toLocaleString()} gal at {fuelPrice ? money(fuelPrice, true) : '—'}/gal ({mpg} mpg)</span>
                    <span className="font-medium text-[#DC2626]">−{money(fuelCost)}</span>
                  </div>
                  {driverCost > 0 && <div className="flex justify-between py-2"><span className="text-[#0B1E3F]/65">Driver pay · {money(numIn(settings.driverPay), true)}/mi</span><span className="font-medium text-[#DC2626]">−{money(driverCost)}</span></div>}
                  {otherCost > 0 && <div className="flex justify-between py-2"><span className="text-[#0B1E3F]/65">Other costs · {money(numIn(settings.otherCpm), true)}/mi</span><span className="font-medium text-[#DC2626]">−{money(otherCost)}</span></div>}
                  <div className="flex justify-between py-2"><span className="font-semibold">What&apos;s left</span><span className={`font-semibold ${net >= 0 ? 'text-[#16A34A]' : 'text-[#DC2626]'}`}>{revenue ? money(net) : '—'}</span></div>
                </div>
                <div className="mt-3 text-xs text-[#0B1E3F]/60">
                  Break-even: <strong className="text-[#0B1E3F]">{money(costPerMile, true)}/mi</strong> all-in{!driverCost && !otherCost ? ' (fuel only — add driver pay and other costs for the real number)' : ''}.
                  {deadPct > 25 && <span className="text-[#B45309]"> Empty miles are {deadPct}% of this trip.</span>}
                </div>
                <div className="mt-3 pt-3 border-t border-[#0B1E3F]/10 text-[11px] text-[#0B1E3F]/50 space-y-0.5">
                  <div>
                    {plan.routing === 'truck' ? 'Truck route miles and times (OpenRouteService truck profile).' : 'Miles are estimated from the straight-line distance with a typical road factor, and drive time at 55 mph.'}
                  </div>
                  {plan.diesel && !numIn(fuelOverride) && (
                    <div>Diesel: EIA weekly on-highway average for {plan.diesel.regions.join(' & ')}, week of {new Date(`${plan.diesel.week}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}. Your fuel card price may differ; change it under &ldquo;Your truck &amp; costs&rdquo;.</div>
                  )}
                  {!plan.diesel && <div>This week&apos;s diesel price didn&apos;t load. Enter yours under &ldquo;Your truck &amp; costs&rdquo;.</div>}
                </div>
              </div>
            </>
          ) : (
            <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-6 card-shadow text-sm text-[#0B1E3F]/60">
              Enter a pickup and delivery (and where the truck is now) to see empty and loaded miles, drive time, fuel cost and what&apos;s left of the rate.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Type-ahead for US cities and ZIP codes (our own GeoNames list, /api/planner/suggest).
function PlaceInput({ value, onText, onPick, placeholder, required, picked, className }: {
  value: string; onText: (v: string) => void; onPick: (p: any) => void; placeholder: string; required?: boolean; picked?: boolean; className: string;
}) {
  const [items, setItems] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const seq = React.useRef(0);
  const listId = React.useId();

  useEffect(() => {
    const q = value.trim();
    if (q.length < 2 || picked || q === 'My current location') { setItems([]); return; }
    const my = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/planner/suggest?q=${encodeURIComponent(q)}`);
        const j = await r.json();
        if (my === seq.current) { setItems(j.places || []); setActive(-1); }
      } catch { /* keep typing; the server can still look it up */ }
    }, 120);
    return () => clearTimeout(t);
  }, [value, picked]);

  const choose = (p: any) => { onPick(p); setOpen(false); setItems([]); };
  return (
    <div className="relative">
      <input
        className={`${className} ${picked ? 'pr-9' : ''}`}
        value={value}
        onChange={(e) => { onText(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open || items.length === 0) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(items[active]); }
          else if (e.key === 'Escape') setOpen(false);
        }}
        placeholder={placeholder}
        required={required}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
      />
      {picked && <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#16A34A] pointer-events-none" />}
      {open && items.length > 0 && (
        <ul id={listId} role="listbox" className="absolute z-30 left-0 right-0 mt-1 bg-white border border-[#0B1E3F]/15 rounded-xl shadow-lg overflow-hidden max-h-72 overflow-y-auto">
          {items.map((p, i) => (
            <li
              key={`${p.label}-${p.lat}-${p.lng}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); choose(p); }}
              onMouseEnter={() => setActive(i)}
              className={`px-3.5 py-2 text-sm cursor-pointer flex items-center justify-between gap-3 ${i === active ? 'bg-[#0B1E3F]/5' : ''}`}
            >
              <span className="flex items-center gap-2 min-w-0"><MapPin className="w-3.5 h-3.5 text-[#0B1E3F]/40 flex-shrink-0" /><span className="truncate">{p.label}</span></span>
              {p.detail && !p.zip && <span className="text-[11px] text-[#0B1E3F]/45 whitespace-nowrap">{p.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// MapLibre map with OpenFreeMap tiles (free, no key). The library loads only
// when this page is opened; its stylesheet is served from /public.
function PlannerMap({ plan }: { plan: any }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<any>(null);
  const markersRef = React.useRef<any[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!document.querySelector('link[data-maplibre]')) {
      const l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = '/maplibre-gl-5.24.0.css'; l.setAttribute('data-maplibre', '1');
      document.head.appendChild(l);
    }
    let cancelled = false;
    let ro: ResizeObserver | null = null;
    import('maplibre-gl').then((mod) => {
      if (cancelled || !ref.current) return;
      const maplibregl: any = (mod as any).default || mod;
      const map = new maplibregl.Map({
        container: ref.current,
        style: 'https://tiles.openfreemap.org/styles/positron',
        center: [-95.7, 37.1],
        zoom: 3.3,
        attributionControl: { compact: true },
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      map.on('load', () => { if (!cancelled) setReady(true); });
      map.on('error', () => {});
      mapRef.current = { map, maplibregl };
      // The page can be hidden and shown again; keep the canvas sized.
      ro = new ResizeObserver(() => map.resize());
      ro.observe(ref.current);
    }).catch(() => setFailed(true));
    return () => {
      cancelled = true;
      ro?.disconnect();
      try { mapRef.current?.map?.remove(); } catch {}
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    const { map, maplibregl } = m;
    markersRef.current.forEach((mk) => mk.remove());
    markersRef.current = [];
    for (const id of ['leg-0', 'leg-1']) {
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
    }
    if (!plan?.points?.length) return;
    const geometry: [number, number][][] = plan.geometry || [];
    geometry.forEach((coords, i) => {
      const empty = plan.hasOrigin && i === 0;
      map.addSource(`leg-${i}`, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } } });
      map.addLayer({
        id: `leg-${i}`, type: 'line', source: `leg-${i}`,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': empty ? '#64748B' : '#FF6B35', 'line-width': empty ? 3 : 4, ...(empty ? { 'line-dasharray': [1.5, 1.5] } : {}) },
      });
    });
    const kinds = plan.hasOrigin ? ['truck', 'pickup', 'delivery'] : ['pickup', 'delivery'];
    plan.points.forEach((p: any, i: number) => {
      const kind = kinds[i];
      const el = document.createElement('div');
      el.style.cssText = `width:28px;height:28px;border-radius:999px;display:flex;align-items:center;justify-content:center;color:#fff;font:700 12px system-ui;box-shadow:0 2px 6px rgba(0,0,0,.25);border:2px solid #fff;background:${kind === 'truck' ? '#64748B' : kind === 'pickup' ? '#0B1E3F' : '#FF6B35'}`;
      el.textContent = kind === 'truck' ? '●' : kind === 'pickup' ? 'P' : 'D';
      el.title = `${kind === 'truck' ? 'Truck' : kind === 'pickup' ? 'Pickup' : 'Delivery'}: ${p.label}`;
      markersRef.current.push(new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map));
    });
    const bounds = new maplibregl.LngLatBounds();
    plan.points.forEach((p: any) => bounds.extend([p.lng, p.lat]));
    geometry.flat().forEach((c) => bounds.extend(c));
    map.fitBounds(bounds, { padding: 60, maxZoom: 9, duration: 600 });
  }, [plan, ready]);

  return (
    <div className="relative">
      <div ref={ref} className="h-[320px] md:h-[420px] w-full bg-[#E9EEF3]" />
      {failed && <div className="absolute inset-0 flex items-center justify-center text-sm text-[#0B1E3F]/55">The map couldn&apos;t load. The numbers below still work.</div>}
      {plan?.points?.length > 0 && (
        <div className="absolute left-3 bottom-3 bg-white/95 rounded-xl px-3 py-2 text-[11px] text-[#0B1E3F]/75 shadow space-y-1 max-w-[70%]">
          {plan.points.map((p: any, i: number) => {
            const kind = (plan.hasOrigin ? ['Truck', 'Pickup', 'Delivery'] : ['Pickup', 'Delivery'])[i];
            return <div key={i} className="truncate"><strong>{kind}:</strong> {p.label}</div>;
          })}
          {plan.hasOrigin && <div className="flex items-center gap-3 pt-0.5"><span className="flex items-center gap-1"><span className="w-4 border-t-2 border-dashed border-[#64748B]" />Empty</span><span className="flex items-center gap-1"><span className="w-4 border-t-[3px] border-[#FF6B35]" />Loaded</span></div>}
        </div>
      )}
    </div>
  );
}

// What a saved lookup row opens: forensics rows carry a file, not a company.
function lookupReportData(row: any) {
  return row?.source === 'forensics' ? { kind: 'forensics', filename: row.query, ...(row.data || {}) } : row?.data;
}

const LOOKUP_KIND: Record<string, { label: string; icon: any }> = {
  quick: { label: 'Lookup', icon: Search },
  ratecon: { label: 'Rate con', icon: FileText },
  coi: { label: 'COI', icon: ShieldCheck },
  forensics: { label: 'PDF check', icon: Shield },
};

function verdictPill(row: any): { label: string; cls: string } {
  const v = row.verdict || (row.score >= 61 ? 'high' : row.score >= 31 ? 'medium' : 'low');
  const cls = v === 'high' ? 'bg-[#DC2626]/10 text-[#DC2626]' : v === 'medium' ? 'bg-[#F59E0B]/15 text-[#B45309]' : 'bg-[#16A34A]/10 text-[#16A34A]';
  if (row.source === 'forensics') return { label: v === 'high' ? 'Likely edited' : v === 'medium' ? 'Worth a look' : 'Clean', cls };
  return { label: v === 'high' ? 'High risk' : v === 'medium' ? 'Caution' : 'Low risk', cls };
}

function Dashboard({ navigate, user }: any) {
  const lookupsRes = useCachedFetch<{ lookups: any[] }>('lookups:200', '/api/lookups?limit=200');
  const usageRes = useCachedFetch<any>('usage', '/api/usage');
  const alertsRes = useCachedFetch<{ alerts: any[] }>('alerts', '/api/alerts');
  const watchRes = useCachedFetch<{ watchlist: any[] }>('watchlist', '/api/watchlist');
  const ownRes = useCachedFetch<any>('own-score', '/api/profile/own-score');
  const lookups = lookupsRes.data?.lookups ?? null;
  const usage = usageRes.data;
  const plan = getPlan(user?.plan || usage?.plan?.id);
  const isAdmin = Boolean(usage?.isAdmin);
  const u = usage?.usage || { fmcsaLookups: 0, rateConScans: 0, pdfForensics: 0, coiChecks: 0, watchlist: 0 };
  const showCoi = COI_CHECK_ON || isAdmin;

  const all = lookups || [];
  const now = new Date();
  const monthStartMs = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const thisMonth = all.filter((l) => new Date(l.created_at).getTime() >= monthStartMs);
  const verdictOf = (l: any) => l.verdict || (l.score >= 61 ? 'high' : l.score >= 31 ? 'medium' : 'low');
  const mix = { low: 0, medium: 0, high: 0 } as Record<string, number>;
  for (const l of thisMonth) mix[verdictOf(l)] = (mix[verdictOf(l)] || 0) + 1;
  const flaggedMonth = mix.medium + mix.high;
  const pdfsMonth = thisMonth.filter((l) => l.source === 'forensics').length;

  // Checks per week, last 12 weeks (Monday start), oldest first.
  const weekStart = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
  const thisWeek = weekStart(Date.now());
  const weeks = Array.from({ length: 12 }, (_, i) => ({ start: thisWeek - (11 - i) * 7 * 86400000, count: 0 }));
  for (const l of all) {
    const idx = 11 - Math.round((thisWeek - weekStart(new Date(l.created_at).getTime())) / (7 * 86400000));
    if (idx >= 0 && idx < 12) weeks[idx].count += 1;
  }
  const maxWeek = Math.max(1, ...weeks.map((w) => w.count));
  const [hoverWeek, setHoverWeek] = useState<number | null>(null);

  // Needs attention: same grouping as the Alerts page and sidebar badge.
  const attention = (() => {
    const seen = new Set<string>();
    const out: any[] = [];
    for (const a of alertsRes.data?.alerts || []) {
      const key = a.source === 'forensics' ? `pdf:${(a.query || '').toLowerCase()}` : a.mc ? `mc:${a.mc}` : a.dot ? `dot:${a.dot}` : `name:${(a.name || '').toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(a);
    }
    return out;
  })();

  const watch = watchRes.data?.watchlist || [];
  const recentlyChanged = watch
    .filter((w: any) => w.data?.fmcsaWatch?.lastChangeAt && Date.now() - new Date(w.data.fmcsaWatch.lastChangeAt).getTime() < 14 * 86400000)
    .sort((a: any, b: any) => new Date(b.data.fmcsaWatch.lastChangeAt).getTime() - new Date(a.data.fmcsaWatch.lastChangeAt).getTime());

  const own = ownRes.data;
  const ownReport = own?.report;
  const hasOwn = Boolean(own && (own.ownMc || own.ownDot));

  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = String(user?.name || '').split(' ')[0] || 'there';
  const subtitle = lookups == null
    ? 'Loading your activity…'
    : attention.length > 0
      ? `${attention.length} ${attention.length === 1 ? 'company or file needs' : 'companies or files need'} a second look this week.`
      : thisMonth.length > 0
        ? `You’ve run ${thisMonth.length} check${thisMonth.length === 1 ? '' : 's'} this month. Nothing risky in the last 7 days.`
        : 'Check a broker, carrier or PDF before you book the load.';

  const quota = (used: number, limit: number | null | undefined) => {
    if (isAdmin || limit == null) return { text: 'Unlimited', pct: null as number | null, locked: false };
    if (limit === 0) return { text: 'Paid plans', pct: null, locked: true };
    const left = Math.max(0, limit - used);
    return { text: `${left} of ${limit} left this month`, pct: Math.min(100, (used / limit) * 100), locked: false };
  };
  const tools = [
    { tab: 'quick', title: 'Verify a company', desc: 'Broker or carrier, by MC, DOT or name.', icon: Search, q: quota(u.fmcsaLookups, plan.limits.fmcsaLookups) },
    { tab: 'ratecon', title: 'Scan a rate con', desc: 'We find the broker on it and check them.', icon: FileText, q: quota(u.rateConScans, plan.limits.rateConScans) },
    { tab: 'forensics', title: 'Check a PDF for edits', desc: 'See what changed and where, on the page.', icon: ScanLine, q: quota(u.pdfForensics ?? 0, plan.limits.pdfForensics) },
    ...(showCoi ? [{ tab: 'coi', title: 'Check a COI', desc: 'Certificate vs the carrier’s FMCSA filings.', icon: ShieldCheck, q: quota(u.coiChecks ?? 0, plan.limits.coiChecks) }] : []),
  ];

  return (
    <div className="space-y-6 text-[#0B1E3F]">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-2">{now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          <h1 className="text-4xl serif italic">{greeting}, {firstName}.</h1>
          <p className={`mt-2 text-sm ${attention.length ? 'text-[#B45309] font-medium' : 'text-[#0B1E3F]/60'}`}>{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {attention.length > 0 && (
            <button onClick={() => navigate('alerts')} className="px-4 py-2.5 border border-[#F59E0B]/40 bg-[#F59E0B]/10 rounded-full text-sm font-medium text-[#B45309] hover:bg-[#F59E0B]/15 flex items-center gap-2"><Bell className="w-4 h-4" /> Review alerts</button>
          )}
          <button onClick={() => navigate('verify')} className="px-5 py-2.5 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90 flex items-center gap-2 card-shadow"><Plus className="w-4 h-4" /> New check</button>
        </div>
      </div>

      {/* Tools */}
      <div className={`grid gap-3 sm:grid-cols-2 ${tools.length === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
        {tools.map((t) => (
          <button key={t.tab} onClick={() => navigate('verify', { tab: t.tab })} className="group text-left bg-white rounded-2xl border border-[#0B1E3F]/10 p-5 card-shadow hover:border-[#FF6B35]/50 hover:-translate-y-0.5 transition flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-xl bg-[#0B1E3F] flex items-center justify-center group-hover:bg-[#FF6B35] transition"><t.icon className="w-5 h-5 text-white" /></div>
              <ArrowRight className="w-4 h-4 text-[#0B1E3F]/25 group-hover:text-[#FF6B35] group-hover:translate-x-0.5 transition" />
            </div>
            <div className="font-semibold">{t.title}</div>
            <div className="text-xs text-[#0B1E3F]/60 mt-1 flex-1">{t.desc}</div>
            <div className="mt-4">
              <div className={`text-[11px] mono ${t.q.locked ? 'text-[#FF6B35]' : 'text-[#0B1E3F]/55'}`}>{t.q.locked && <Lock className="w-3 h-3 inline -mt-0.5 mr-1" />}{t.q.text}</div>
              {t.q.pct != null && (
                <div className="mt-1.5 h-1 rounded-full bg-[#0B1E3F]/8 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${t.q.pct}%`, background: t.q.pct >= 100 ? '#DC2626' : '#0B1E3F' }} />
                </div>
              )}
            </div>
          </button>
        ))}
      </div>

      {plan.id === 'free' && !isAdmin && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-[#FF6B35]/10 border border-[#FF6B35]/30 rounded-2xl">
          <div className="text-sm">
            You&rsquo;re on the <strong>Free</strong> plan: {plan.limits.fmcsaLookups} lookups and {plan.limits.pdfForensics} PDF checks a month. Carrier gets unlimited lookups and PDF checks, plus {PLANS.carrier.limits.rateConScans} rate con scans a month.
          </div>
          <button onClick={() => navigate('plan')} className="px-4 py-2 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90 whitespace-nowrap self-start sm:self-auto">See plans</button>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* This month */}
          <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-6 card-shadow">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold">This month</h2>
              <button onClick={() => navigate('history')} className="text-sm text-[#0B1E3F]/60 hover:text-[#0B1E3F] flex items-center gap-1">History <ChevronRight className="w-3.5 h-3.5" /></button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Checks run', value: lookups == null ? '—' : thisMonth.length },
                { label: 'Flagged', value: lookups == null ? '—' : flaggedMonth, warn: flaggedMonth > 0 },
                { label: 'PDFs checked', value: lookups == null ? '—' : pdfsMonth },
                { label: 'Watching', value: watchRes.data ? watch.length : '—' },
              ].map((x) => (
                <div key={x.label} className="p-3.5 rounded-xl bg-[#0B1E3F]/[0.04]">
                  <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">{x.label}</div>
                  <div className={`text-2xl font-semibold mt-1 ${x.warn ? 'text-[#B45309]' : ''}`}>{x.value}</div>
                </div>
              ))}
            </div>

            {thisMonth.length > 0 && (
              <div className="mt-5">
                <div className="flex items-center justify-between text-xs text-[#0B1E3F]/60 mb-1.5">
                  <span>Results this month</span>
                  <span className="flex items-center gap-3">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#16A34A]" />{mix.low} clear</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#F59E0B]" />{mix.medium} caution</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#DC2626]" />{mix.high} high</span>
                  </span>
                </div>
                <div className="flex h-2 rounded-full overflow-hidden gap-[2px] bg-white">
                  {(['low', 'medium', 'high'] as const).filter((k) => mix[k] > 0).map((k) => (
                    <div key={k} style={{ flexGrow: mix[k], background: k === 'low' ? '#16A34A' : k === 'medium' ? '#F59E0B' : '#DC2626' }} />
                  ))}
                </div>
              </div>
            )}

            <div className="mt-6">
              <div className="flex items-baseline justify-between mb-2">
                <div className="text-xs text-[#0B1E3F]/60">Checks per week</div>
                <div className="text-xs mono text-[#0B1E3F]/45">last 12 weeks</div>
              </div>
              <div className="relative">
                <div className="flex items-end gap-1.5 h-24" role="img" aria-label={`Checks per week: ${weeks.map((w) => w.count).join(', ')}`}>
                  {weeks.map((w, i) => {
                    const current = i === weeks.length - 1;
                    return (
                      <div key={i} className="flex-1 h-full flex items-end cursor-default" onMouseEnter={() => setHoverWeek(i)} onMouseLeave={() => setHoverWeek(null)}>
                        <div className="w-full rounded-t-[4px] transition" style={{ height: `${w.count ? Math.max(6, (w.count / maxWeek) * 100) : 3}%`, background: current ? '#FF6B35' : hoverWeek === i ? '#0B1E3F' : 'rgba(11,30,63,0.22)' }} />
                      </div>
                    );
                  })}
                </div>
                {hoverWeek != null && (
                  <div className="absolute -top-8 px-2 py-1 rounded-md bg-[#0B1E3F] text-white text-[11px] whitespace-nowrap pointer-events-none" style={{ left: `calc(${((hoverWeek + 0.5) / 12) * 100}% - 48px)` }}>
                    {weeks[hoverWeek].count} check{weeks[hoverWeek].count === 1 ? '' : 's'} · week of {new Date(weeks[hoverWeek].start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </div>
                )}
                <div className="flex justify-between text-[10px] mono text-[#0B1E3F]/40 mt-1.5">
                  <span>{new Date(weeks[0].start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                  <span>This week</span>
                </div>
              </div>
            </div>
          </div>

          {/* Recent activity */}
          <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-6 card-shadow">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Recent activity</h2>
              <button onClick={() => navigate('history')} className="text-sm text-[#0B1E3F]/60 hover:text-[#0B1E3F] flex items-center gap-1">View all <ChevronRight className="w-3.5 h-3.5" /></button>
            </div>
            {lookups == null ? (
              <div className="py-8 text-center text-sm text-[#0B1E3F]/50">Loading…</div>
            ) : all.length === 0 ? (
              <div className="py-10 text-center text-[#0B1E3F]/60">
                <Search className="w-10 h-10 mx-auto mb-3 text-[#0B1E3F]/30" />
                <div className="text-sm">No checks yet. Verify your first broker or carrier, or drop in a rate con.</div>
                <button onClick={() => navigate('verify')} className="mt-4 px-5 py-2.5 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90">Run your first check</button>
              </div>
            ) : (
              <div className="divide-y divide-[#0B1E3F]/5 -mx-2">
                {all.slice(0, 6).map((l: any) => {
                  const kind = LOOKUP_KIND[l.source] || LOOKUP_KIND.quick;
                  const pill = verdictPill(l);
                  const name = l.source === 'forensics' ? (l.query || 'PDF document') : l.name;
                  const sub = l.source === 'forensics' ? 'PDF forensics' : [l.mc && `MC-${l.mc}`, l.dot && `DOT-${l.dot}`].filter(Boolean).join(' · ') || 'No ID';
                  return (
                    <button key={l.id} onClick={() => navigate('report', lookupReportData(l))} className="w-full flex items-center gap-3 px-2 py-3 rounded-lg hover:bg-[#0B1E3F]/[0.04] transition text-left">
                      <div className="w-9 h-9 rounded-xl bg-[#0B1E3F]/5 flex items-center justify-center flex-shrink-0" title={kind.label}><kind.icon className="w-4 h-4 text-[#0B1E3F]/70" /></div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{name}</div>
                        <div className="text-xs mono text-[#0B1E3F]/50 truncate">{kind.label} · {sub} · {timeAgo(l.created_at)}</div>
                      </div>
                      <span className={`hidden sm:inline px-2 py-0.5 rounded-full text-[11px] font-semibold ${pill.cls}`}>{pill.label}</span>
                      <span className="mono text-sm font-semibold w-8 text-right text-[#0B1E3F]/70">{l.score}</span>
                      <ChevronRight className="w-4 h-4 text-[#0B1E3F]/30" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          {/* Needs attention */}
          <div className="bg-[#0B1E3F] text-white rounded-2xl p-6 relative overflow-hidden card-shadow">
            <div className="absolute inset-0 grid-bg-dark opacity-50" />
            <div className="relative">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="text-lg font-semibold">Needs attention</h2>
                  <div className="text-xs text-white/55">High risk or caution, last 7 days</div>
                </div>
                <div className="w-9 h-9 rounded-xl bg-[#FF6B35]/20 flex items-center justify-center"><AlertTriangle className="w-4 h-4 text-[#FF6B35]" /></div>
              </div>
              {alertsRes.data == null ? (
                <div className="text-sm text-white/60 py-6 text-center">Loading…</div>
              ) : attention.length === 0 ? (
                <div className="py-6 text-center">
                  <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-[#16A34A]" />
                  <div className="text-sm text-white/80">All clear. Nothing risky in the last 7 days.</div>
                </div>
              ) : (
                <div className="space-y-2">
                  {attention.slice(0, 4).map((a: any) => {
                    const pill = verdictPill(a);
                    return (
                      <button key={a.id} onClick={() => navigate('report', lookupReportData(a))} className="w-full text-left p-3 rounded-xl bg-white/5 hover:bg-white/10 transition">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium text-sm truncate">{a.source === 'forensics' ? (a.query || 'PDF document') : a.name}</div>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold flex-shrink-0 ${a.verdict === 'high' ? 'bg-[#DC2626]/25 text-[#FCA5A5]' : 'bg-[#F59E0B]/25 text-[#FCD34D]'}`}>{pill.label}</span>
                        </div>
                        <div className="text-xs text-white/55 mt-1 truncate">{(a.data?.flags || [])[0]?.title || (a.source === 'forensics' ? 'PDF forensics' : [a.mc && `MC-${a.mc}`, a.dot && `DOT-${a.dot}`].filter(Boolean).join(' · '))} · {timeAgo(a.created_at)}</div>
                      </button>
                    );
                  })}
                </div>
              )}
              <button onClick={() => navigate('alerts')} className="w-full mt-5 py-2.5 bg-white/10 hover:bg-white/15 transition rounded-full text-sm font-medium flex items-center justify-center gap-2">
                {attention.length > 4 ? `See all ${attention.length} alerts` : 'Open alerts'} <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Your company */}
          <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-6 card-shadow">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Your company</h2>
              <Building2 className="w-4 h-4 text-[#0B1E3F]/40" />
            </div>
            {!hasOwn ? (
              <div>
                <div className="text-sm text-[#0B1E3F]/65">Add your MC or DOT to see the score brokers and shippers see for you, get alerts when your FMCSA record changes, and see how often you&apos;re checked.</div>
                <button onClick={() => navigate('settings', { tab: 'profile' })} className="mt-4 px-4 py-2 border border-[#0B1E3F]/15 rounded-full text-sm font-medium hover:bg-[#0B1E3F]/5">Add your MC / DOT</button>
              </div>
            ) : !ownReport ? (
              <div className="text-sm text-[#0B1E3F]/55">Loading your company…</div>
            ) : (() => {
              const v = ownReport.verdict || (ownReport.score >= 61 ? 'high' : ownReport.score >= 31 ? 'medium' : 'low');
              const c = v === 'high' ? '#DC2626' : v === 'medium' ? '#F59E0B' : '#16A34A';
              return (
                <div>
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl flex flex-col items-center justify-center flex-shrink-0" style={{ background: `${c}18` }}>
                      <div className="text-xl font-bold leading-none" style={{ color: c }}>{ownReport.score}</div>
                      <div className="text-[9px] mono text-[#0B1E3F]/50 mt-0.5">/ 100</div>
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{ownReport.name || (own.ownMc ? `MC-${own.ownMc}` : `DOT-${own.ownDot}`)}</div>
                      <div className="text-xs mono text-[#0B1E3F]/50">{own.ownMc ? `MC-${own.ownMc}` : `DOT-${own.ownDot}`} · {v === 'high' ? 'High risk' : v === 'medium' ? 'Caution' : 'Low risk'}</div>
                    </div>
                  </div>
                  <div className="text-xs text-[#0B1E3F]/55 mt-3">This is the score others see when they check you on Haulock.</div>
                  {(ownReport.dot || own.ownDot) && (
                    <div className="mt-4 pt-4 border-t border-[#0B1E3F]/10">
                      <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/50 mb-1.5">Roadside inspections</div>
                      <OwnSafetySummary dot={String(ownReport.dot || own.ownDot)} compact />
                    </div>
                  )}
                  <button onClick={() => window.dispatchEvent(new CustomEvent('haulock:open-own-company'))} className="mt-4 w-full py-2.5 border border-[#0B1E3F]/15 rounded-full text-sm font-medium hover:bg-[#0B1E3F]/5 flex items-center justify-center gap-2">
                    <Eye className="w-4 h-4" /> Score, monitoring &amp; who&apos;s checking
                  </button>
                </div>
              );
            })()}
          </div>

          {/* Watchlist */}
          <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-6 card-shadow">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-lg font-semibold">Watchlist</h2>
              <button onClick={() => navigate('watchlist')} className="text-sm text-[#0B1E3F]/60 hover:text-[#0B1E3F] flex items-center gap-1">Open <ChevronRight className="w-3.5 h-3.5" /></button>
            </div>
            <div className="text-xs text-[#0B1E3F]/55 mb-4">
              {watchRes.data == null ? 'Loading…' : watch.length === 0 ? 'Not watching anyone yet.' : `${watch.length} ${watch.length === 1 ? 'company' : 'companies'} checked daily against FMCSA.`}
            </div>
            {recentlyChanged.length > 0 ? (
              <div className="space-y-2">
                {recentlyChanged.slice(0, 3).map((w: any) => (
                  <div key={w.id} className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[#F59E0B]/10">
                    <Radio className="w-4 h-4 text-[#B45309] flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{w.name}</div>
                      <div className="text-[11px] text-[#0B1E3F]/55">FMCSA record changed {timeAgo(w.data.fmcsaWatch.lastChangeAt)}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : watch.length > 0 ? (
              <div className="flex items-center gap-2 text-sm text-[#16A34A]"><CheckCircle2 className="w-4 h-4" /> No changes in the last 2 weeks</div>
            ) : (
              <div className="text-sm text-[#0B1E3F]/65">Watch a broker or carrier from its report and we&apos;ll email you when its authority, insurance or details change.</div>
            )}
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
  const launch = useLaunchFlags();
  useEffect(() => {
    if (launch.ready && !launch.coi && tab === 'coi') setTab('quick');
  }, [launch.ready, launch.coi, tab]);
  const [input, setInput] = useState('');
  // Identifier-type selector. MC and DOT are separate registries that
  // frequently collide on the same number — e.g. MC-1162901 (Leader
  // Group) vs DOT-1162901 (Kiril Georgiev). The user must pick which
  // registry to query before submitting a bare number. No default — the
  // whole point of removing 'auto' is to force a deliberate choice.
  const [kind, setKind] = useState<'mc' | 'dot' | null>(null);
  const [emailInput, setEmailInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorSuggestions, setErrorSuggestions] = useState<string[] | null>(null);
  // Name or number that matches more than one company — the user picks.
  const [choices, setChoices] = useState<CompanyChoiceSet | null>(null);
  // Type-ahead: numbers search the registry picked with the MC/DOT toggle
  // (none until one is picked); anything with letters is a name search.
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestIndex, setSuggestIndex] = useState(-1);
  const suggestKind: 'mc' | 'dot' | 'name' | null = /[a-z]/i.test(input.replace(/^\s*(mc|usdot|dot)\b/i, '')) ? 'name' : kind;
  const { items: suggestions, loading: suggestLoading, searched: suggestSearched, failed: suggestFailed } = useCompanySuggestions(suggestOpen ? input : '', suggestKind);
  // When the API resolves we hold the result for a brief reveal moment so
  // the scanner can paint red on whichever sources caught something spooky
  // before we navigate to the full report.
  const [scanResult, setScanResult] = useState<any | null>(null);
  const [rcFile, setRcFile] = useState<File | null>(null);
  const [rcLoading, setRcLoading] = useState(false);
  const [rcError, setRcError] = useState<string | null>(null);
  const [rcDrag, setRcDrag] = useState(false);
  const emailInputRef = React.useRef<HTMLInputElement | null>(null);
  // The radar scan replaces the form, so if the user clicked Verify (or a
  // sample) while scrolled down, it would start off-screen. Bring it into
  // view as soon as a lookup begins.
  const scanRef = React.useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (loading && tab === 'quick') {
      scanRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [loading, tab]);

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

  // Apply the MC/DOT type selector to bare numeric input. If the user
  // already typed a prefix (MC-…, DOT-…, USDOT-…) we respect it; if they
  // typed a name we leave it alone. Only bare digits get the prefix.
  const applyKind = (raw: string): string => {
    const q = raw.trim();
    if (!kind) return q;
    if (/^(?:MC|DOT|USDOT)[-#\s]?\d/i.test(q)) return q;
    const digits = q.replace(/[-\s#]/g, '');
    if (/^\d{3,9}$/.test(digits)) {
      return `${kind === 'mc' ? 'MC' : 'DOT'}-${digits}`;
    }
    return q;
  };

  const runLookup = async (override?: string, emailOverride?: string, searched?: string) => {
    const raw = (override ?? input).trim();
    const e = (emailOverride ?? emailInput).trim();
    if (!raw) { setError('Enter an MC number, DOT number, or company name.'); return; }
    // Force a registry choice for bare digits. The same 7-digit number
    // can resolve to two different carriers — one in the MC registry and
    // one in the DOT registry — so we make the user pick. Names and
    // already-prefixed inputs (MC-…, DOT-…) are exempt.
    const isBareDigits = /^\d{3,9}$/.test(raw.replace(/[-\s#]/g, ''));
    const isPrefixed = /^(?:MC|DOT|USDOT)[-#\s]?\d/i.test(raw);
    if (isBareDigits && !isPrefixed && !kind) {
      setError('Pick MC or DOT first — the same number can belong to two different carriers across registries.');
      return;
    }
    const q = applyKind(raw);
    setLoading(true); setError(null); setErrorSuggestions(null); setChoices(null); setSuggestOpen(false);
    try {
      // Pass the email field through to the verify route so it can run
      // lookalike-domain detection against the company's confirmed website
      // — catches typosquats / homograph spoofs the eye misses. `searched`
      // is the name the user typed when they picked a company from a list.
      const verifyUrl = `/api/verify?q=${encodeURIComponent(q)}${e ? `&email=${encodeURIComponent(e)}` : ''}${searched ? `&searched=${encodeURIComponent(searched)}` : ''}`;
      const promises: Promise<any>[] = [
        fetch(verifyUrl).then(async (r) => {
          const j = await r.json();
          if (!r.ok) {
            if (r.status === 402) throw new Error(j?.error || 'Monthly lookup limit reached. Upgrade your plan for more.');
            if (r.status === 429) throw new Error(j?.error || 'Too many lookups — slow down and try again shortly.');
            if (r.status === 409 && Array.isArray(j?.candidates)) {
              throw Object.assign(new Error('choose'), {
                choices: { code: j.code === 'ambiguous_name' ? 'ambiguous_name' : 'ambiguous_number', searched: j.searched || q, candidates: j.candidates, total: j.total, exactMatchFound: j.exactMatchFound, needsConfirmation: j.needsConfirmation },
              });
            }
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
      if (err?.choices) setChoices(err.choices);
      else setError(err?.message || 'Lookup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8 text-[#0B1E3F]">
      <div>
        <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-2">Verify brokers &amp; carriers</div>
        <h1 className="text-4xl serif italic text-[#0B1E3F]">Who&apos;s on the other end?</h1>
        <p className="mt-3 text-[#0B1E3F]/65 max-w-2xl leading-relaxed">
          Check any freight broker or motor carrier before you book a load. Pick what you want to check below.
        </p>
      </div>
      {/* Each check is a card with a one-line "what it does" so users can
          tell the four tools apart without trying each one. */}
      {/* Hidden while a lookup runs so the scan animation sits right under
          the heading instead of below four cards. */}
      {!(loading && tab === 'quick') && (
      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${launch.coi ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
        {([
          { id: 'quick', label: 'Look up a company', desc: 'Broker or carrier — search by MC, DOT, or company name.', icon: Search },
          { id: 'ratecon', label: 'Rate con analyzer', desc: 'Upload a rate con. We find the broker on it and check them.', icon: FileText },
          // PDF forensics is the primary feature for drivers — we tag it
          // so a driver visiting the verify page knows immediately which
          // card applies to their workflow.
          { id: 'forensics', label: 'PDF forensics', desc: 'See if a rate con PDF was edited before it reached you.', icon: Shield, tag: 'For drivers' },
          { id: 'coi', label: 'COI check', desc: 'Compare a carrier’s insurance certificate with FMCSA filings.', icon: ShieldCheck, tag: 'For brokers' },
          // Bulk verify is shipped but hidden from the picker until we
          // actually need it. Keep the route alive so existing deep-links
          // (and the underlying PageSlot) don't 404.
          // { id: 'bulk', label: 'Bulk verify' },
        ] as const).filter((t) => t.id !== 'coi' || launch.coi).map((t) => {
          const active = tab === t.id;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={active}
              className={`text-left p-4 rounded-2xl border transition flex items-start gap-3 ${active ? 'bg-[#0B1E3F] border-[#0B1E3F] text-white card-shadow' : 'bg-white border-[#0B1E3F]/10 text-[#0B1E3F] hover:border-[#0B1E3F]/40'}`}
            >
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${active ? 'bg-white/15' : 'bg-[#0B1E3F]/5'}`}>
                <Icon className={`w-4 h-4 ${active ? 'text-white' : 'text-[#0B1E3F]/70'}`} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold">{t.label}</span>
                  {('tag' in t) && t.tag && (
                    <span className={`text-[9px] mono uppercase tracking-wider px-1.5 py-0.5 rounded-full font-bold ${active ? 'bg-white/20 text-white' : 'bg-[#16A34A]/10 text-[#16A34A]'}`}>
                      {t.tag}
                    </span>
                  )}
                </div>
                <div className={`mt-1 text-xs leading-snug ${active ? 'text-white/75' : 'text-[#0B1E3F]/60'}`}>{t.desc}</div>
              </div>
            </button>
          );
        })}
      </div>
      )}
      {tab === 'quick' && (
        loading ? (
          // scroll-mt clears the sticky app header when scrolled into view.
          <div ref={scanRef} className="scroll-mt-24">
            <VerifyScanProgress query={input} result={scanResult} />
          </div>
        ) : (
        <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-8 md:p-12 card-shadow text-[#0B1E3F]">
          <label className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 block mb-3">Broker or carrier — MC number, DOT number, or company name</label>
          <div className="flex flex-col md:flex-row gap-3">
            <div className="flex-1 relative">
            <div className={`h-full flex items-stretch bg-[#F5F3EE] border rounded-xl focus-within:border-[#0B1E3F] transition overflow-hidden ${kind ? 'border-[#0B1E3F]/15' : 'border-[#FF6B35]/40'}`}>
              <div
                className="flex items-center gap-1.5 pl-2 pr-2 py-2 border-r border-[#0B1E3F]/10 bg-white"
                title="MC and DOT are separate FMCSA registries — the same number can belong to two different carriers. Pick which one you're searching."
              >
                {([
                  { id: 'mc', label: 'MC', hint: 'Motor Carrier number — search FMCSA MC registry' },
                  { id: 'dot', label: 'DOT', hint: 'USDOT number — search FMCSA DOT registry' },
                ] as const).map((k) => {
                  const active = kind === k.id;
                  return (
                    <button
                      key={k.id}
                      type="button"
                      onClick={() => { setKind(k.id); setError(null); }}
                      title={k.hint}
                      className={`px-3.5 py-2 rounded-lg text-xs font-bold mono transition border ${
                        active
                          ? 'bg-[#0B1E3F] text-white border-[#0B1E3F] shadow-sm'
                          : 'bg-white text-[#0B1E3F]/70 border-[#0B1E3F]/25 hover:border-[#0B1E3F] hover:text-[#0B1E3F]'
                      }`}
                    >
                      {k.label}
                    </button>
                  );
                })}
              </div>
              <input
                value={input}
                onChange={(e) => { setInput(e.target.value); setSuggestOpen(true); setSuggestIndex(-1); }}
                onFocus={() => setSuggestOpen(true)}
                onBlur={() => setTimeout(() => setSuggestOpen(false), 120)}
                role="combobox"
                aria-expanded={suggestOpen && suggestions.length > 0}
                aria-autocomplete="list"
                autoComplete="off"
                onKeyDown={(e) => {
                  if (suggestionKeys(e, suggestOpen, suggestions.length, suggestIndex, setSuggestIndex,
                    (i) => { const s = suggestions[i]; setInput(s.query); runLookup(s.query); },
                    () => setSuggestOpen(false))) return;
                  if (e.key === 'Enter') { runLookup(); return; }
                  // Block digit entry until the user has picked MC or DOT —
                  // bare numbers are exactly the case where the registries
                  // collide. Letters (company names) still pass through.
                  if (!kind && /^\d$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
                    e.preventDefault();
                    setError('Pick MC or DOT on the left before typing a number.');
                  }
                }}
                onPaste={(e) => {
                  if (kind) return;
                  const text = e.clipboardData.getData('text');
                  if (/\d/.test(text)) {
                    e.preventDefault();
                    setError('Pick MC or DOT on the left before pasting a number.');
                  }
                }}
                placeholder={kind === 'mc' ? 'Type the MC number, e.g. 1162901 — no prefix needed' : kind === 'dot' ? 'Type the DOT number, e.g. 3512175 — no prefix needed' : 'Select MC or DOT on the left first, then type the number'}
                className="flex-1 min-w-0 px-5 py-5 md:py-4 bg-transparent text-xl md:text-lg focus:outline-none text-[#0B1E3F] placeholder:text-[#0B1E3F]/30"
              />
            </div>
            {suggestOpen && (
              <SuggestionList
                items={suggestions}
                loading={suggestLoading}
                searched={suggestSearched}
                failed={suggestFailed}
                activeIndex={suggestIndex}
                onHover={setSuggestIndex}
                onPick={(s) => { setInput(s.query); runLookup(s.query); }}
              />
            )}
            </div>
            <button onClick={() => runLookup()} disabled={loading} className="w-full md:w-auto justify-center px-8 py-4 bg-[#0B1E3F] text-white rounded-xl font-medium hover:bg-[#0B1E3F]/90 transition flex items-center gap-2 disabled:opacity-60">
              Verify <ArrowRight className="w-4 h-4" />
            </button>
          </div>
          <div className="mt-2 text-xs text-[#0B1E3F]/55 leading-relaxed">
            {kind
              ? <>Just type the digits — we add <span className="mono">{kind === 'mc' ? 'MC-' : 'DOT-'}</span> for you, and matching companies appear after 3 digits. Searching by company name? Type it here; the {kind === 'mc' ? 'MC' : 'DOT'} toggle is ignored for names.</>
              : <>MC and DOT are separate registries — the same number can return two different carriers (e.g. <span className="mono">MC-1162901</span> = LEADER GROUP INC, <span className="mono">DOT-1162901</span> = KIRIL GEORGIEV). Pick one on the left, then type just the digits.</>
            }
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
          {choices && (
            <CompanyChoices set={choices} onPick={(query, searched) => { setInput(query); setChoices(null); runLookup(query, undefined, searched); }} />
          )}
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
      {launch.coi && tab === 'coi' && <CoiCheckPanel navigate={navigate} />}
      {launch.scanEmail && (tab === 'ratecon' || tab === 'coi') && <ForwardToScanCard />}
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

// ---------- Forward-to-scan + COI check ----------

// Each feature is hidden on the live site until its switch is on (lib/features.ts); admins see both.
function useLaunchFlags(): { coi: boolean; scanEmail: boolean; ready: boolean } {
  const usage = useCachedFetch<{ isAdmin?: boolean }>('usage', '/api/usage');
  const admin = Boolean(usage.data?.isAdmin);
  // scanEmail has no admin override: forwarding isn't set up (lib/features.ts).
  return { coi: COI_CHECK_ON || admin, scanEmail: SCAN_EMAIL_ON, ready: COI_CHECK_ON || usage.data != null };
}

const SCAN_EMAIL = process.env.NEXT_PUBLIC_SCAN_EMAIL || 'scan@haulock.com';

function ForwardToScanCard() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(SCAN_EMAIL);
      setCopied(true);
      track('scan_email_copied');
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };
  return (
    <div className="flex flex-col md:flex-row md:items-center gap-4 p-5 bg-[#0B1E3F] text-white rounded-2xl">
      <div className="w-11 h-11 rounded-xl bg-[#FF6B35] flex items-center justify-center flex-shrink-0">
        <Mail className="w-5 h-5 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold">Or just forward it to <span className="mono">{SCAN_EMAIL}</span></div>
        <div className="text-sm text-white/70 mt-0.5">Forward any rate con or insurance certificate from the email on your Haulock account. We reply in the same thread with a verdict, usually within a minute.</div>
      </div>
      <button onClick={copy} className="px-4 py-2 rounded-full bg-white text-[#0B1E3F] text-sm font-medium flex items-center justify-center gap-2 hover:bg-white/90 transition flex-shrink-0">
        <Copy className="w-4 h-4" /> {copied ? 'Copied' : 'Copy address'}
      </button>
    </div>
  );
}

function CoiCheckPanel({ navigate }: { navigate: any }) {
  const usage = useCachedFetch<any>('usage', '/api/usage');
  const notInPlan = usage.data && !usage.data.isAdmin && usage.data.plan?.limits?.coiChecks === 0;
  const [file, setFile] = useState<File | null>(null);
  const [mc, setMc] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [result, setResult] = useState<any>(null);

  const run = async (f: File) => {
    setFile(f); setLoading(true); setError(null); setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const mcDigits = mc.replace(/[^0-9]/g, '');
      if (mcDigits) fd.append('mc', mcDigits);
      const r = await fetch('/api/coi/check', { method: 'POST', body: fd });
      const j = await r.json();
      if (!r.ok) {
        if (r.status === 402) throw new Error(j?.error || 'Monthly COI check limit reached. Upgrade your plan.');
        throw new Error(j?.error || `Check failed (${r.status})`);
      }
      invalidateCache('lookups:200', 'usage', 'alerts');
      track('coi_checked', { verdict: j?.verdict || 'unknown', score: typeof j?.score === 'number' ? j.score : 0, carrier_resolved: Boolean(j?.mc || j?.dot) });
      setResult(j);
    } catch (err: any) {
      setError(err?.message || 'Check failed');
    } finally {
      setLoading(false);
    }
  };

  if (notInPlan) {
    return (
      <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-8 card-shadow text-[#0B1E3F]">
        <div className="font-semibold text-lg mb-1">COI checks are on paid plans</div>
        <p className="text-sm text-[#0B1E3F]/70 mb-5 max-w-xl">Check a carrier&rsquo;s certificate of insurance against the filings its insurer made with FMCSA. Carrier includes {PLANS.carrier.limits.coiChecks} COI checks a month, Team {PLANS.team.limits.coiChecks}, and Fleet unlimited.</p>
        <button onClick={() => navigate('plan')} className="px-5 py-2.5 bg-[#FF6B35] text-white rounded-full text-sm font-medium hover:bg-[#FF6B35]/90">See plans</button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-8 card-shadow text-[#0B1E3F]">
      <div className="flex items-start gap-4 p-4 bg-[#0B1E3F]/[0.04] border border-[#0B1E3F]/10 rounded-xl mb-6">
        <ShieldCheck className="w-5 h-5 text-[#0B1E3F] flex-shrink-0 mt-0.5" />
        <div className="text-sm text-[#0B1E3F]">
          <div className="font-medium mb-0.5">Insurance certificate (COI) check</div>
          <div className="text-[#0B1E3F]/70">We read the COI, compare the auto liability policy with what the insurer filed with FMCSA, look for pending cancellations, expired dates and low limits, and check whether the PDF was edited.</div>
        </div>
      </div>

      {!result && (
        <>
          <label className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 block mb-2">
            Carrier MC number <span className="normal-case tracking-normal text-[#0B1E3F]/40">(optional — we read it from the COI, or find it by the auto liability policy number)</span>
          </label>
          <div className="flex items-stretch bg-[#F5F3EE] border border-[#0B1E3F]/15 rounded-xl overflow-hidden mb-5 max-w-sm focus-within:border-[#0B1E3F] transition">
            <span className="px-3 flex items-center mono text-sm text-[#0B1E3F]/60 border-r border-[#0B1E3F]/10 bg-white">MC-</span>
            <input value={mc} onChange={(e) => setMc(e.target.value)} disabled={loading} inputMode="numeric" placeholder="123456" className="flex-1 bg-transparent px-3 py-3 outline-none mono text-[#0B1E3F]" />
          </div>

          <label
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f && !loading) run(f); }}
            className={`block border-2 border-dashed rounded-2xl p-12 text-center transition cursor-pointer ${drag ? 'border-[#FF6B35] bg-[#FF6B35]/5' : 'border-[#0B1E3F]/20 hover:border-[#FF6B35] hover:bg-[#FF6B35]/5'}`}
          >
            <input type="file" accept="application/pdf,image/png,image/jpeg" className="hidden" disabled={loading} onChange={(e) => { const f = e.target.files?.[0]; if (f) run(f); }} />
            <div className="w-16 h-16 bg-[#0B1E3F]/5 rounded-2xl flex items-center justify-center mx-auto mb-4">
              {loading ? <div className="w-6 h-6 border-2 border-[#0B1E3F]/20 border-t-[#FF6B35] rounded-full animate-spin" /> : <ShieldCheck className="w-8 h-8 text-[#0B1E3F]/50" />}
            </div>
            <div className="text-lg font-medium text-[#0B1E3F] mb-2">
              {loading ? 'Reading the certificate and checking FMCSA filings…' : file ? file.name : 'Drop the carrier’s certificate of insurance here'}
            </div>
            <div className="text-sm text-[#0B1E3F]/60 mb-6">{loading ? 'Usually 10–20 seconds.' : 'ACORD 25 PDF works best — PDFs also get the edit check.'}</div>
            {!loading && <span className="inline-block px-6 py-2.5 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90 transition">Choose file</span>}
            <div className="mt-4 text-xs mono text-[#0B1E3F]/40">PDF · PNG · JPG · max 10MB</div>
          </label>
        </>
      )}

      {error && <div className="mt-4 text-sm text-[#DC2626]">{error}</div>}

      {result && (
        <div className="space-y-6">
          <CoiResultBody report={result} />
          <button onClick={() => { setResult(null); setFile(null); }} className="px-5 py-2.5 border border-[#0B1E3F]/15 bg-white rounded-full text-sm font-medium text-[#0B1E3F] hover:bg-[#0B1E3F]/5">Check another certificate</button>
        </div>
      )}
    </div>
  );
}

// Full COI result page, opened from History / Alerts.
function CoiReportView({ report, navigate }: any) {
  return (
    <div className="space-y-6 text-[#0B1E3F]">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-2">Insurance certificate check</div>
          <h1 className="text-4xl serif italic">{report.name}</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={() => navigate('history')} className="px-5 py-2.5 border border-[#0B1E3F]/15 bg-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/5">Back to history</button>
          <button onClick={() => navigate('verify', { tab: 'coi' })} className="px-5 py-2.5 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90">Check another COI</button>
        </div>
      </div>
      <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-8 card-shadow">
        <CoiResultBody report={report} />
      </div>
    </div>
  );
}

function CoiResultBody({ report }: { report: any }) {
  const r = report || {};
  // Reports saved before `compared` existed: compared only if a carrier was found.
  const compared: boolean = typeof r.compared === 'boolean' ? r.compared : Boolean(r.carrier);
  const notComparedReason: string = r.notComparedReason || (r.carrier ? 'FMCSA insurance data unavailable' : 'carrier not identified');
  // Old saved reports carry an FMCSA headline even when nothing was compared;
  // don't show a finding that didn't happen.
  const headline: string = compared || typeof r.compared === 'boolean'
    ? r.verdictLabel
    : r.verdict === 'mismatch'
      ? `Problems on the certificate — not compared with FMCSA (${notComparedReason})`
      : `Not compared with FMCSA — ${notComparedReason}`;
  const tone =
    r.verdict === 'mismatch' ? { text: 'text-[#DC2626]', bg: 'bg-[#DC2626]/10', border: 'border-[#DC2626]/30' }
    : !compared ? { text: 'text-[#0B1E3F]/70', bg: 'bg-[#0B1E3F]/[0.04]', border: 'border-[#0B1E3F]/15' }
    : r.verdict === 'verify' ? { text: 'text-[#D97706]', bg: 'bg-[#F59E0B]/10', border: 'border-[#F59E0B]/30' }
    : { text: 'text-[#16A34A]', bg: 'bg-[#16A34A]/10', border: 'border-[#16A34A]/30' };
  const fmtDate = (iso?: string | null) => {
    if (!iso) return '—';
    const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
    return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  };
  const fmtUsd = (n?: number | null) => (n == null ? '—' : n >= 1_000_000 ? `$${(n / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 2 })}M` : `$${Math.round(n / 1000).toLocaleString('en-US')}K`);
  const checks: any[] = Array.isArray(r.checks) ? r.checks : [];
  const fails = checks.filter((c) => c.status === 'fail').length;
  const warns = checks.filter((c) => c.status === 'warn').length;
  const policies: any[] = Array.isArray(r.extraction?.policies) ? r.extraction.policies : [];
  const auto = policies.filter((p) => p.coverage === 'auto_liability');
  const others = policies.filter((p) => p.coverage !== 'auto_liability');
  const filings: any[] = Array.isArray(r.filings) ? r.filings : [];
  const bipd = filings.filter((f) => /^BIPD/i.test(f.coverage) || f.formCode === '91X');
  const coverageLabel: Record<string, string> = { cargo: 'Cargo', general_liability: 'General liability', workers_comp: 'Workers comp', umbrella: 'Umbrella / excess', other: 'Other' };
  const icon = (status: string) =>
    status === 'fail' ? <XCircle className="w-5 h-5 text-[#DC2626] flex-shrink-0 mt-0.5" />
    : status === 'warn' ? <AlertTriangle className="w-5 h-5 text-[#D97706] flex-shrink-0 mt-0.5" />
    : status === 'pass' ? <CheckCircle2 className="w-5 h-5 text-[#16A34A] flex-shrink-0 mt-0.5" />
    : <Shield className="w-5 h-5 text-[#0B1E3F]/50 flex-shrink-0 mt-0.5" />;

  return (
    <div className="space-y-6 text-[#0B1E3F]">
      <div className={`p-5 rounded-2xl border ${tone.bg} ${tone.border}`}>
        <div className={`text-xs mono uppercase tracking-wider ${tone.text} mb-1`}>{headline}</div>
        <div className="text-2xl font-semibold">{r.name}</div>
        <div className="text-sm text-[#0B1E3F]/60 mt-1 mono">
          {[r.mc && `MC-${r.mc}`, r.dot && `DOT-${r.dot}`].filter(Boolean).join(' · ') || 'Carrier not identified'}
          {r.filename ? ` · ${r.filename}` : ''}
        </div>
        <div className="text-sm text-[#0B1E3F]/70 mt-2">
          {compared
            ? (fails > 0 ? `${fails} thing${fails === 1 ? '' : 's'} don’t match` : 'Nothing contradicts FMCSA')
            : `Not compared — ${notComparedReason}${fails > 0 ? ` · ${fails} problem${fails === 1 ? '' : 's'} on the certificate` : ''}`}
          {warns > 0 ? ` · ${warns} to confirm` : ''}
          {compared && r.dataAsOf ? ` · checked against FMCSA data updated ${fmtDate(r.dataAsOf)}` : ''}
          {r.recheckedAt && (
            <span className="block mt-1 text-xs text-[#0B1E3F]/55">Re-checked against FMCSA on {fmtDate(r.recheckedAt)}, using the certificate as it was read the first time. Upload it again for a fresh reading.</span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {checks.map((c, i) => (
          <div key={i} className="flex items-start gap-3 p-4 bg-[#0B1E3F]/[0.03] border border-[#0B1E3F]/10 rounded-xl">
            {icon(c.status)}
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm">{c.title}</div>
              <div className="text-sm text-[#0B1E3F]/70 mt-0.5">{c.detail}</div>
              <div className="mt-1.5 inline-block text-[9px] mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#0B1E3F]/8 text-[#0B1E3F]/55">{c.source}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="p-5 rounded-xl border border-[#0B1E3F]/10">
          <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/55 mb-3">Auto liability on the certificate</div>
          {auto.length === 0 ? <div className="text-sm text-[#0B1E3F]/60">None listed.</div> : auto.map((p, i) => (
            <div key={i} className="text-sm space-y-1 mb-3 last:mb-0">
              <div className="font-semibold">{p.insurer_name || 'Insurer not shown'}</div>
              <div className="mono text-[#0B1E3F]/70">Policy {p.policy_number || '—'}</div>
              <div className="text-[#0B1E3F]/70">{fmtDate(p.effective_date)} → {fmtDate(p.expiration_date)} · {fmtUsd(p.limit_amount)}</div>
            </div>
          ))}
        </div>
        <div className="p-5 rounded-xl border border-[#0B1E3F]/10">
          <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/55 mb-3">Filed with FMCSA (liability)</div>
          {bipd.length === 0 ? <div className="text-sm text-[#0B1E3F]/60">{!r.carrier ? 'Not compared — add the carrier’s MC number to compare.' : !compared ? 'Not compared — FMCSA insurance data couldn’t be loaded.' : 'No liability filing on record.'}</div> : bipd.map((f, i) => (
            <div key={i} className="text-sm space-y-1 mb-3 last:mb-0">
              <div className="font-semibold">{f.insurer || 'Unknown insurer'}</div>
              <div className="mono text-[#0B1E3F]/70">Policy {f.policyNumber || '—'} · {f.coverage}</div>
              <div className="text-[#0B1E3F]/70">{f.maxCoverageK != null ? fmtUsd(f.maxCoverageK * 1000) : '—'}{f.cancelEffectiveDate && f.cancelEffectiveDate !== f.effectiveDate ? ` · cancellation ${fmtDate(f.cancelEffectiveDate)}` : ''}</div>
            </div>
          ))}
        </div>
      </div>

      {(others.length > 0 || r.extraction?.producer_name) && (
        <div className="grid md:grid-cols-2 gap-4">
          {others.length > 0 && (
            <div className="p-5 rounded-xl border border-[#0B1E3F]/10">
              <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/55 mb-3">Other coverage on the certificate</div>
              {others.map((p, i) => (
                <div key={i} className="text-sm mb-2 last:mb-0">
                  <span className="font-semibold">{coverageLabel[p.coverage] || 'Other'}</span>
                  <span className="text-[#0B1E3F]/70"> · {p.insurer_name || '—'} · {fmtUsd(p.limit_amount)} · exp. {fmtDate(p.expiration_date)}</span>
                </div>
              ))}
            </div>
          )}
          {r.extraction?.producer_name && (
            <div className="p-5 rounded-xl border border-[#0B1E3F]/10">
              <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/55 mb-3">Agent on the certificate</div>
              <div className="text-sm font-semibold">{r.extraction.producer_name}</div>
              <div className="text-sm text-[#0B1E3F]/70">{[r.extraction.producer_phone, r.extraction.producer_email].filter(Boolean).join(' · ') || '—'}</div>
              <div className="text-xs text-[#0B1E3F]/55 mt-2">To confirm coverage, call the insurer using a number from its own website rather than the contact details printed here.</div>
            </div>
          )}
        </div>
      )}

      <div className="p-4 bg-[#0B1E3F]/[0.03] rounded-xl text-xs text-[#0B1E3F]/60 leading-relaxed">{r.disclaimer}</div>
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
      if (j?.fileSha256) saveLocalPdf(j.fileSha256, f);
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

  return (
    <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-8 card-shadow text-[#0B1E3F]">
      <div className="flex items-start gap-4 p-4 bg-[#16A34A]/10 border border-[#16A34A]/25 rounded-xl mb-6">
        <CheckCircle2 className="w-5 h-5 text-[#16A34A] flex-shrink-0 mt-0.5" />
        <div className="text-sm text-[#0B1E3F]">
          <div className="font-medium mb-0.5">PDF forensics · 3 scans/month free, unlimited on paid</div>
          <div className="text-[#0B1E3F]/70">Opens up the file itself: every saved version inside it, what text or drawing changed between them, white-out boxes, typed-on-top text, hidden text, signatures, fonts, and the hidden metadata. We tell you what&apos;s suspicious and what&apos;s normal. No AI, no broker lookup.</div>
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
          {loading ? 'Taking the PDF apart…' : file ? file.name : 'Drop a PDF to check if it was tampered with'}
        </div>
        <div className="text-xs text-[#0B1E3F]/55">PDF only · max 15 MB · checked, never stored on our servers</div>
        {!loading && <div className="mt-4 inline-block px-5 py-2 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90 transition">Choose PDF</div>}
      </label>

      {error && <div className="mt-4 text-sm text-[#DC2626]">{error}</div>}

      {result && (
        <div className="mt-8">
          <ForensicsResultBody result={result} file={file} />
          <div className="mt-6 pt-4 border-t border-[#0B1E3F]/10 text-xs text-[#0B1E3F]/60">
            Tip: this checks the PDF file itself. To verify the BROKER on the rate con, switch to the <strong>Rate con analyzer</strong> tab.
          </div>
        </div>
      )}
    </div>
  );
}

// Saved forensics scans (History / Alerts) carry the analyzer result; older
// rows have no `kind`, so recognise them by the file metadata block.
function isForensicsReport(r: any): boolean {
  return r?.kind === 'forensics' || (r && typeof r.metadata?.pageCount === 'number' && Array.isArray(r.flags) && !r.mc && !r.dot);
}

function ForensicsReportView({ report, navigate }: any) {
  return (
    <div className="space-y-6 text-[#0B1E3F]">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-2">PDF forensics</div>
          <h1 className="text-3xl md:text-4xl serif italic break-words">{report.filename || 'PDF document'}</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={() => navigate('history')} className="px-5 py-2.5 border border-[#0B1E3F]/15 bg-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/5">Back to history</button>
          <button onClick={() => navigate('verify', { tab: 'forensics' })} className="px-5 py-2.5 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90">Check another PDF</button>
        </div>
      </div>
      <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-6 md:p-8 card-shadow">
        <ForensicsResultBody result={report} />
      </div>
    </div>
  );
}

const FORENSIC_KIND: Record<string, { label: string; tone: 'bad' | 'warn' | 'ok' | 'neutral' }> = {
  original: { label: 'Original', tone: 'neutral' },
  content: { label: 'Text changed', tone: 'bad' },
  graphics: { label: 'Drawing changed', tone: 'warn' },
  markup: { label: 'Added on top', tone: 'warn' },
  structure: { label: 'Tags only', tone: 'ok' },
  form: { label: 'Form filled', tone: 'ok' },
  signature: { label: 'Signed', tone: 'ok' },
  metadata: { label: 'Re-saved', tone: 'ok' },
  unknown: { label: 'Changed', tone: 'warn' },
};
const FORENSIC_TONE = {
  bad: { dot: '#DC2626', chip: 'bg-[#DC2626]/10 text-[#DC2626]' },
  warn: { dot: '#F59E0B', chip: 'bg-[#F59E0B]/15 text-[#B45309]' },
  ok: { dot: '#16A34A', chip: 'bg-[#16A34A]/10 text-[#16A34A]' },
  neutral: { dot: '#0B1E3F', chip: 'bg-[#0B1E3F]/8 text-[#0B1E3F]/70' },
};

// The browser that ran a PDF check keeps its own copy (IndexedDB) so History
// and Alerts can show the highlights again. Files never go to our servers.
const LOCAL_PDF_DB = 'haulock-pdf-checks';
const LOCAL_PDF_MAX = 30;
function openPdfDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(LOCAL_PDF_DB, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore('files'); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
async function saveLocalPdf(hash: string, file: File): Promise<void> {
  const db = await openPdfDb();
  if (!db || !hash) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').put({ name: file.name, type: file.type || 'application/pdf', blob: file, at: Date.now() }, hash);
      tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); tx.onabort = () => resolve();
    });
    // Keep the newest LOCAL_PDF_MAX files.
    await new Promise<void>((resolve) => {
      const tx = db.transaction('files', 'readwrite');
      const store = tx.objectStore('files');
      const all: { key: IDBValidKey; at: number }[] = [];
      const cur = store.openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (c) { all.push({ key: c.key, at: (c.value as any)?.at || 0 }); c.continue(); return; }
        all.sort((x, y) => y.at - x.at).slice(LOCAL_PDF_MAX).forEach((x) => store.delete(x.key));
      };
      tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); tx.onabort = () => resolve();
    });
  } catch { /* storage full or blocked: preview just asks for the file */ }
}
async function loadLocalPdf(hash: string): Promise<File | null> {
  const db = await openPdfDb();
  if (!db || !hash) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction('files', 'readonly').objectStore('files').get(hash);
      req.onsuccess = () => {
        const r = req.result as any;
        resolve(r?.blob ? new File([r.blob], r.name || 'document.pdf', { type: r.type || 'application/pdf' }) : null);
      };
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
async function forgetLocalPdfs(hashes: (string | null | undefined)[] | 'all'): Promise<void> {
  const db = await openPdfDb();
  if (!db) return;
  try {
    const tx = db.transaction('files', 'readwrite');
    const store = tx.objectStore('files');
    if (hashes === 'all') store.clear();
    else hashes.filter(Boolean).forEach((h) => store.delete(h as string));
  } catch { /* nothing stored */ }
}

// pdf.js is self-hosted in /public/pdfjs (the CSP only allows same-origin
// scripts) and loaded only when a preview is shown.
let pdfJsPromise: Promise<any> | null = null;
function loadPdfJs(): Promise<any> {
  if (!pdfJsPromise) {
    const url = '/pdfjs/pdf.min.mjs';
    pdfJsPromise = import(/* webpackIgnore: true */ url).then((m: any) => {
      m.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
      return m;
    }).catch((e: any) => { pdfJsPromise = null; throw e; });
  }
  return pdfJsPromise;
}

async function sha256Hex(f: File): Promise<string | null> {
  try {
    const d = await crypto.subtle.digest('SHA-256', await f.arrayBuffer());
    return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch { return null; }
}

const REGION_STYLE: Record<string, { border: string; fill: string; dashed?: boolean; name: string }> = {
  critical: { border: '#DC2626', fill: 'rgba(220,38,38,0.14)', name: 'Changed' },
  warning: { border: '#F59E0B', fill: 'rgba(245,158,11,0.16)', name: 'Check this' },
  info: { border: '#64748B', fill: 'rgba(100,116,139,0.12)', name: 'Note' },
  removed: { border: '#F59E0B', fill: 'rgba(245,158,11,0.06)', dashed: true, name: 'Was here before' },
};
const regionStyle = (g: any) => g.kind === 'text_removed' ? REGION_STYLE.removed : REGION_STYLE[g.sev] || REGION_STYLE.info;

function ForensicsPreview({ file, regions, fileSha256 }: { file: File | null; regions: any[]; fileSha256: string | null }) {
  // History rows don't keep the PDF: the user can open the same file here
  // (read in the browser only) to see the highlights again.
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [fromBrowser, setFromBrowser] = useState(false);
  const [lookedUp, setLookedUp] = useState(Boolean(file) || !fileSha256);
  const [mismatch, setMismatch] = useState(false);
  const shown = file || localFile;
  useEffect(() => {
    if (file || !fileSha256) return;
    let cancelled = false;
    loadLocalPdf(fileSha256).then((f) => {
      if (cancelled) return;
      if (f) { setLocalFile(f); setFromBrowser(true); }
      setLookedUp(true);
    });
    return () => { cancelled = true; };
  }, [file, fileSha256]);
  const [doc, setDoc] = useState<any>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [showBoxes, setShowBoxes] = useState(true);
  const [allPages, setAllPages] = useState(false);

  useEffect(() => {
    if (!shown) return;
    let cancelled = false;
    let task: any = null;
    setDoc(null); setLoadError(null); setActive(null);
    (async () => {
      const pdfjs = await loadPdfJs();
      const data = new Uint8Array(await shown.arrayBuffer());
      task = pdfjs.getDocument({ data, isEvalSupported: false });
      const d = await task.promise;
      if (!cancelled) setDoc(d);
    })().catch(() => { if (!cancelled) setLoadError('We couldn’t draw a preview of this PDF in your browser. The findings below still apply.'); });
    return () => { cancelled = true; try { task?.destroy?.(); } catch {} };
  }, [shown]);

  const openLocal = async (f: File) => {
    setMismatch(false);
    if (fileSha256) {
      const h = await sha256Hex(f);
      if (h && h !== fileSha256) setMismatch(true);
      else if (h) saveLocalPdf(fileSha256, f); // next time it opens by itself
    }
    setFromBrowser(false);
    setLocalFile(f);
  };

  const boxes = mismatch ? [] : regions;
  const numPages: number = doc?.numPages || 0;
  const regionPages = Array.from(new Set(boxes.map((g) => g.page))).sort((a, b) => a - b);
  const defaultPages = numPages <= 4
    ? Array.from({ length: numPages }, (_, i) => i + 1)
    : Array.from(new Set([1, ...regionPages])).filter((n) => n <= numPages).slice(0, 6);
  const pages = allPages ? Array.from({ length: Math.min(numPages, 30) }, (_, i) => i + 1) : defaultPages;

  const pick = (i: number) => {
    setActive(i);
    setShowBoxes(true);
    const g = boxes[i];
    if (g && !pages.includes(g.page)) setAllPages(true);
    setTimeout(() => document.getElementById(`fx-box-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  };

  if (!shown && !lookedUp) {
    return (
      <div>
        <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/55 mb-3">See it on the page</div>
        <div className="py-8 flex items-center justify-center gap-3 text-sm text-[#0B1E3F]/55 bg-[#0B1E3F]/[0.04] rounded-2xl"><div className="w-4 h-4 border-2 border-[#0B1E3F]/20 border-t-[#FF6B35] rounded-full animate-spin" /> Opening your PDF…</div>
      </div>
    );
  }
  if (!shown) {
    return (
      <div>
        <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/55 mb-3">See it on the page</div>
        <label className="block cursor-pointer border-2 border-dashed border-[#0B1E3F]/15 rounded-2xl p-6 text-center hover:border-[#FF6B35] hover:bg-[#FF6B35]/5 transition">
          <input type="file" accept="application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) openLocal(f); }} />
          <Eye className="w-6 h-6 mx-auto mb-2 text-[#0B1E3F]/40" />
          <div className="text-sm font-medium">We marked {regions.length} spot{regions.length === 1 ? '' : 's'} on this PDF</div>
          <div className="text-xs text-[#0B1E3F]/55 mt-1">This browser doesn&apos;t have a copy of it, and we never keep files on our servers. Open the same PDF to see the highlights. It stays on your device and doesn&apos;t use a scan.</div>
        </label>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/55">See it on the page</div>
        <div className="flex items-center gap-3">
          {boxes.length > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-[#0B1E3F]/70 cursor-pointer select-none">
              <input type="checkbox" checked={showBoxes} onChange={(e) => setShowBoxes(e.target.checked)} className="accent-[#FF6B35]" /> Show highlights
            </label>
          )}
          {numPages > pages.length && !allPages && (
            <button onClick={() => setAllPages(true)} className="text-xs font-medium underline text-[#0B1E3F]/70">Show all {Math.min(numPages, 30)} pages</button>
          )}
        </div>
      </div>
      {mismatch && (
        <div className="mb-3 p-3 rounded-xl bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-xs">That isn&apos;t the same file that was scanned (its fingerprint is different), so we&apos;re showing it without highlights.</div>
      )}
      {fromBrowser && <div className="mb-2 text-[11px] text-[#0B1E3F]/50">Opened from the copy this browser kept when you scanned it. It&apos;s not stored on our servers.</div>}
      <div className={`grid gap-4 ${boxes.length ? 'lg:grid-cols-[minmax(0,1fr)_280px]' : ''}`}>
        <div className="bg-[#0B1E3F]/[0.04] rounded-2xl p-3 md:p-4 space-y-4 max-h-[820px] overflow-y-auto">
          {loadError && <div className="text-sm text-[#0B1E3F]/60 p-6 text-center">{loadError}</div>}
          {!loadError && !doc && (
            <div className="py-16 flex flex-col items-center gap-3 text-sm text-[#0B1E3F]/55">
              <div className="w-5 h-5 border-2 border-[#0B1E3F]/20 border-t-[#FF6B35] rounded-full animate-spin" /> Drawing the pages…
            </div>
          )}
          {doc && pages.map((n) => (
            <ForensicsPage key={n} doc={doc} pageNo={n} boxes={boxes} showBoxes={showBoxes} active={active} onPick={pick} />
          ))}
          {doc && boxes.length === 0 && !mismatch && (
            <div className="text-xs text-center text-[#16A34A] font-medium">Nothing to mark: no changed areas found on the page.</div>
          )}
        </div>
        {boxes.length > 0 && (
          <div className="lg:sticky lg:top-4 self-start space-y-2">
            <div className="text-xs text-[#0B1E3F]/55">Click a spot to jump to it.</div>
            {boxes.map((g, i) => {
              const st = regionStyle(g);
              return (
                <button key={i} onClick={() => pick(i)} className={`w-full text-left p-3 rounded-xl border transition ${active === i ? 'border-[#0B1E3F] bg-[#0B1E3F]/[0.04]' : 'border-[#0B1E3F]/10 bg-white hover:border-[#0B1E3F]/30'}`}>
                  <div className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full text-[10px] font-bold text-white flex items-center justify-center flex-shrink-0" style={{ background: st.border }}>{i + 1}</span>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold leading-snug">{g.label}</div>
                      {g.detail && <div className="text-xs text-[#0B1E3F]/65 mt-0.5 break-words">{g.detail}</div>}
                      <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/45 mt-1">Page {g.page}</div>
                    </div>
                  </div>
                </button>
              );
            })}
            <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-[10px] text-[#0B1E3F]/55">
              {Array.from(new Set(boxes.map((g) => regionStyle(g).name))).map((name) => {
                const st = Object.values(REGION_STYLE).find((x) => x.name === name)!;
                return <span key={name} className="flex items-center gap-1"><span className="w-3 h-2.5 rounded-sm" style={{ background: st.fill, border: `1.5px ${st.dashed ? 'dashed' : 'solid'} ${st.border}` }} />{name}</span>;
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ForensicsPage({ doc, pageNo, boxes, showBoxes, active, onPick }: { doc: any; pageNo: number; boxes: any[]; showBoxes: boolean; active: number | null; onPick: (i: number) => void }) {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [viewport, setViewport] = useState<any>(null);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.floor(el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!width) return;
    let cancelled = false;
    let task: any = null;
    (async () => {
      const page = await doc.getPage(pageNo);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: width / base.width });
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(vp.width * dpr);
      canvas.height = Math.floor(vp.height * dpr);
      canvas.style.width = `${Math.floor(vp.width)}px`;
      canvas.style.height = `${Math.floor(vp.height)}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      task = page.render({ canvasContext: ctx, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      await task.promise;
      if (!cancelled) setViewport(vp);
    })().catch(() => {});
    return () => { cancelled = true; try { task?.cancel?.(); } catch {} };
  }, [doc, pageNo, width]);

  return (
    <div>
      <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/45 mb-1.5">Page {pageNo}</div>
      <div ref={wrapRef} className="relative bg-white shadow-sm rounded-md overflow-hidden">
        <canvas ref={canvasRef} className="block" />
        {viewport && showBoxes && boxes.map((g, i) => {
          if (g.page !== pageNo) return null;
          const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(g.rect);
          const left = Math.min(x1, x2), top = Math.min(y1, y2);
          const w = Math.max(Math.abs(x2 - x1), 8), h = Math.max(Math.abs(y2 - y1), 8);
          const st = regionStyle(g);
          const on = active === i || hover === i;
          return (
            <div key={i} id={`fx-box-${i}`} className="absolute" style={{ left, top, width: w, height: h }}>
              <button
                onClick={() => onPick(i)}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover((v) => (v === i ? null : v))}
                aria-label={`${g.label}${g.detail ? `: ${g.detail}` : ''}`}
                className={`absolute inset-0 rounded-[3px] transition ${active === i ? 'animate-pulse' : ''}`}
                style={{ background: st.fill, border: `2px ${st.dashed ? 'dashed' : 'solid'} ${st.border}`, boxShadow: on ? `0 0 0 3px ${st.border}33` : undefined }}
              />
              <span className="absolute -top-2.5 -left-2.5 w-5 h-5 rounded-full text-[10px] font-bold text-white flex items-center justify-center pointer-events-none shadow" style={{ background: st.border }}>{i + 1}</span>
              {on && (
                <div className={`absolute z-10 ${top > 90 ? 'bottom-full mb-2' : 'top-full mt-2'} left-0 w-60 max-w-[70vw] p-2.5 rounded-lg bg-[#0B1E3F] text-white text-xs shadow-xl pointer-events-none`}>
                  <div className="font-semibold">{g.label}</div>
                  {g.detail && <div className="text-white/75 mt-0.5 break-words">{g.detail}</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ForensicsResultBody({ result, file }: { result: any; file?: File | null }) {
  const r = result || {};
  const flags: any[] = Array.isArray(r.flags) ? r.flags : [];
  const normal: any[] = Array.isArray(r.normal) ? r.normal : [];
  const revisions: any[] = Array.isArray(r.revisions) ? r.revisions : [];
  const regions: any[] = Array.isArray(r.regions) ? r.regions : [];
  const md = r.metadata || {};
  const [showMeta, setShowMeta] = useState(false);

  const tone = r.verdict === 'likely_tampered'
    ? { bg: 'bg-[#DC2626]/10', border: 'border-[#DC2626]/30', text: 'text-[#DC2626]', label: 'Likely tampered', Icon: XCircle }
    : r.verdict === 'suspicious'
      ? { bg: 'bg-[#F59E0B]/10', border: 'border-[#F59E0B]/30', text: 'text-[#B45309]', label: 'Worth a closer look', Icon: AlertTriangle }
      : { bg: 'bg-[#16A34A]/10', border: 'border-[#16A34A]/30', text: 'text-[#16A34A]', label: 'No signs of editing', Icon: CheckCircle2 };
  const summary: string = r.summary || (r.verdict === 'likely_tampered'
    ? 'Strong signs this PDF was changed after it was made.'
    : r.verdict === 'suspicious' ? 'Some things worth a closer look, but no proof of editing.' : 'No signs of editing in what we checked.');
  const sevStyle = (sev: string) => sev === 'critical'
    ? { color: '#DC2626', label: 'Red flag' }
    : sev === 'warning' ? { color: '#F59E0B', label: 'Check this' } : { color: '#64748B', label: 'Note' };
  const fmtBytes = (n: number) => !n ? '—' : n < 1024 ? `${n} B` : n < 1_048_576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1_048_576).toFixed(1)} MB`;
  const fmtDate = (v: string | null | undefined) => v ? new Date(v).toLocaleString() : '—';
  const changedTextCount = revisions.reduce((n, v) => n + (v.textChanges?.length || 0), 0);

  return (
    <div className="space-y-7 text-[#0B1E3F]">
      {/* Verdict */}
      <div className={`p-5 rounded-2xl border ${tone.bg} ${tone.border}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className={`flex items-center gap-1.5 text-xs mono uppercase tracking-wider font-semibold ${tone.text} mb-1.5`}>
              <tone.Icon className="w-4 h-4" /> {tone.label}
            </div>
            <div className="text-lg md:text-xl font-semibold leading-snug">{summary}</div>
            <div className="text-sm text-[#0B1E3F]/60 mt-1.5">
              {flags.filter((f) => f.sev !== 'info').length} finding{flags.filter((f) => f.sev !== 'info').length === 1 ? '' : 's'} · {normal.length} thing{normal.length === 1 ? '' : 's'} checked out normal
              {revisions.length > 1 && ` · saved ${revisions.length} times`}
            </div>
          </div>
          <div className={`w-20 h-20 rounded-2xl bg-white/70 ${tone.border} border flex flex-col items-center justify-center flex-shrink-0`}>
            <div className={`text-3xl font-bold ${tone.text}`}>{r.score ?? 0}</div>
            <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">/ 100</div>
          </div>
        </div>
        <div className="mt-3 text-xs text-[#0B1E3F]/55">Tamper score: 0–19 clean · 20–49 worth a look · 50+ likely edited. Higher means more signs of editing.</div>
      </div>

      {/* The PDF itself, with the changed areas marked */}
      {(file || regions.length > 0) && <ForensicsPreview file={file || null} regions={regions} fileSha256={r.fileSha256 || null} />}

      {/* Findings */}
      {flags.length > 0 && (
        <div>
          <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/55 mb-3">What we found</div>
          <div className="space-y-2">
            {flags.map((f: any, i: number) => {
              const st = sevStyle(f.sev);
              return (
                <div key={i} className="flex items-start gap-3 p-4 bg-white border border-[#0B1E3F]/10 rounded-xl" style={{ borderLeft: `3px solid ${st.color}` }}>
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: st.color }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{f.title}</span>
                      <span className="text-[10px] mono uppercase tracking-wider font-semibold" style={{ color: st.color }}>{st.label}</span>
                    </div>
                    <div className="text-sm text-[#0B1E3F]/70 mt-0.5">{f.desc}</div>
                  </div>
                  <div className="text-xs mono text-[#0B1E3F]/45 flex-shrink-0">+{f.pts}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Saved versions */}
      {revisions.length > 1 && (
        <div>
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/55">Every saved version inside this file</div>
            {changedTextCount > 0 && <div className="text-xs text-[#DC2626] font-medium">{changedTextCount} text change{changedTextCount === 1 ? '' : 's'}</div>}
          </div>
          <div className="text-xs text-[#0B1E3F]/55 mb-3">PDFs keep earlier versions when they&apos;re saved again. We rebuilt each one and compared it with the one before.</div>
          <ol className="relative border-l-2 border-[#0B1E3F]/10 ml-2 space-y-4">
            {revisions.map((v: any) => {
              const k = FORENSIC_KIND[v.kind] || FORENSIC_KIND.unknown;
              const t = FORENSIC_TONE[k.tone];
              return (
                <li key={v.index} className="pl-5 relative">
                  <span className="absolute -left-[7px] top-1.5 w-3 h-3 rounded-full ring-4 ring-white" style={{ background: t.dot }} />
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold">Version {v.index}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] mono uppercase tracking-wider font-bold ${t.chip}`}>{k.label}</span>
                    {(v.modified || v.producer) && (
                      <span className="text-xs text-[#0B1E3F]/50">{[v.modified && fmtDate(v.modified), v.producer].filter(Boolean).join(' · ')}</span>
                    )}
                  </div>
                  <div className="text-sm text-[#0B1E3F]/75 mt-1">{v.summary}</div>
                  {Array.isArray(v.textChanges) && v.textChanges.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {v.textChanges.slice(0, 6).map((c: any, i: number) => (
                        <div key={i} className="rounded-xl border border-[#0B1E3F]/10 overflow-hidden text-sm">
                          <div className="px-3 py-1 text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/50 bg-[#0B1E3F]/[0.03]">Page {c.page}</div>
                          <div className="grid sm:grid-cols-2">
                            <div className="px-3 py-2 bg-[#DC2626]/[0.05] sm:border-r border-[#0B1E3F]/10">
                              <div className="text-[10px] mono uppercase tracking-wider text-[#DC2626] mb-0.5">Before</div>
                              <div className="break-words line-through decoration-[#DC2626]/40">{c.before || <span className="text-[#0B1E3F]/40 no-underline">(nothing)</span>}</div>
                            </div>
                            <div className="px-3 py-2 bg-[#16A34A]/[0.05]">
                              <div className="text-[10px] mono uppercase tracking-wider text-[#16A34A] mb-0.5">After</div>
                              <div className="break-words font-medium">{c.after || <span className="text-[#0B1E3F]/40">(removed)</span>}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* Normal */}
      {normal.length > 0 && (
        <div>
          <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/55 mb-3">What&apos;s normal here</div>
          <div className="grid md:grid-cols-2 gap-2">
            {normal.map((n: any, i: number) => (
              <div key={i} className="flex items-start gap-2.5 p-3 rounded-xl bg-[#16A34A]/[0.06] border border-[#16A34A]/20">
                <CheckCircle2 className="w-4 h-4 text-[#16A34A] flex-shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{n.title}</div>
                  <div className="text-xs text-[#0B1E3F]/65 mt-0.5">{n.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {flags.length === 0 && normal.length === 0 && (
        <div className="p-5 bg-[#16A34A]/5 border border-[#16A34A]/25 rounded-xl text-sm">
          <div className="font-semibold text-[#16A34A] mb-1">No red flags detected</div>
          Nothing in the file suggests it was edited after it was made. This doesn&apos;t prove the content is honest. Verify the broker too.
        </div>
      )}

      {/* Metadata */}
      <div>
        <button onClick={() => setShowMeta((v) => !v)} className="flex items-center gap-1.5 text-xs mono uppercase tracking-wider text-[#0B1E3F]/55 hover:text-[#0B1E3F]">
          <ChevronRight className={`w-3.5 h-3.5 transition-transform ${showMeta ? 'rotate-90' : ''}`} /> File details
        </button>
        {showMeta && (
          <div className="grid md:grid-cols-2 gap-3 mt-3">
            {[
              { label: 'Created', val: fmtDate(md.creationDate) },
              { label: 'Last saved', val: fmtDate(md.modificationDate) },
              { label: 'Producer', val: md.producer || '—' },
              { label: 'Creator', val: md.creator || '—' },
              { label: 'Author', val: md.author || '—' },
              { label: 'Title', val: md.title || '—' },
              { label: 'PDF version', val: md.pdfVersion || '—' },
              { label: 'Pages', val: md.pageCount != null ? String(md.pageCount) : '—' },
              { label: 'File size', val: fmtBytes(md.fileSizeBytes) },
            ].map((i, idx) => (
              <div key={idx} className="p-3 bg-[#0B1E3F]/5 rounded-lg">
                <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">{i.label}</div>
                <div className="text-sm mt-0.5 break-words">{i.val}</div>
              </div>
            ))}
          </div>
        )}
      </div>
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

// COI checks are saved to history like any other scan; route them to their
// own view so the carrier report never receives a COI payload.
function Report({ report, navigate }: any) {
  if (report?.kind === 'coi') return <CoiReportView report={report} navigate={navigate} />;
  if (isForensicsReport(report)) return <ForensicsReportView report={report} navigate={navigate} />;
  return <CarrierReport report={report} navigate={navigate} />;
}

function CarrierReport({ report, navigate }: any) {
  if (!report) {
    return (
      <div className="py-20 px-6 text-center text-[#0B1E3F]">
        <Search className="w-12 h-12 mx-auto mb-4 text-[#0B1E3F]/30" />
        <h1 className="text-2xl serif italic mb-2">No report to show yet</h1>
        <p className="text-[#0B1E3F]/60 mb-6 max-w-md mx-auto">Run a Verify lookup or open one from your History to see its report here.</p>
        <div className="flex items-center justify-center gap-2">
          <button onClick={() => navigate('verify')} className="px-5 py-2.5 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90">Verify a broker or carrier</button>
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
  // Always prefixed: bare digits can be an MC for one company and a DOT for
  // another, which made Scan again ask "which one?" or load the wrong record.
  const rescanQuery = r.mc ? `MC-${String(r.mc).replace(/\D/g, '')}` : r.dot ? `DOT-${String(r.dot).replace(/\D/g, '')}` : null;
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
            </div>
            {/* How this company was found — so a name search that landed on a
                differently-named company is obvious, not silent. */}
            {(() => {
              const id = r.mc ? `MC-${r.mc}` : r.dot ? `DOT-${r.dot}` : '';
              const typed = String(r.searchedFor || '').trim();
              if (r.matchedBy === 'name' || r.matchedBy === 'name-choice') {
                const sameName = typed && r.name && typed.toLowerCase() === String(r.name).toLowerCase();
                return (
                  <div className="mt-2 text-sm text-[#0B1E3F]/65">
                    {typed && !sameName ? <>You searched <strong className="text-[#0B1E3F]">“{typed}”</strong> → </> : null}
                    matched {r.name}{id ? ` (${id})` : ''} {r.matchedBy === 'name-choice' ? 'from the list you picked' : 'by name'}.
                    {typed && !sameName && <span className="text-[#0B1E3F]/50"> Make sure this is the company on your rate con.</span>}
                  </div>
                );
              }
              if (r.matchedBy === 'mc' || r.matchedBy === 'dot') {
                return <div className="mt-2 text-sm text-[#0B1E3F]/55">Found by {r.matchedBy === 'mc' ? 'MC' : 'USDOT'} number.</div>;
              }
              return null;
            })()}
            {/* Data that didn't come from FMCSA's live service is labelled
                with its real date, never passed off as current. */}
            {r.dataSource && r.dataSource !== 'fmcsa-live' && r.source !== 'mock' && (
              <div className="mt-3 p-3 bg-[#F59E0B]/10 border border-[#F59E0B]/30 rounded-xl text-sm text-[#0B1E3F]/80 max-w-2xl">
                <strong className="text-[#0B1E3F]">FMCSA&apos;s live service didn&apos;t respond.</strong>{' '}
                {r.dataSource === 'archive'
                  ? 'This report uses our FMCSA archive snapshot, which can be years old.'
                  : `This report uses FMCSA data from ${r.dataAsOf ? new Date(r.dataAsOf).toLocaleDateString() : 'an earlier date'}${r.dataSource === 'socrata' ? ' (FMCSA’s public dataset)' : ''}.`}{' '}
                Run <strong>Scan again</strong> for live data before you book or tender.
              </div>
            )}
            {Array.isArray(r.backfilled) && r.backfilled.length > 0 && (
              <div className="mt-2 text-xs text-[#0B1E3F]/50">
                From an earlier FMCSA record: {r.backfilled.map((b: any) => `${({ phone: 'phone', operation: 'operation type', powerUnits: 'fleet size', drivers: 'driver count' } as Record<string, string>)[b.field] || b.field} (${new Date(b.asOf).toLocaleDateString()})`).join(', ')}.
              </div>
            )}
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
          {/* What the number means: 0–100, lower is better, three bands. */}
          <div className="mt-5 w-full">
            <div className="text-[11px] text-[#0B1E3F]/55 text-center mb-2">Haulock risk score out of 100. Lower is better.</div>
            <div className="grid grid-cols-3 gap-1 text-[10px] mono uppercase tracking-wider text-center">
              {([
                { id: 'low', label: 'Low', range: '0–30', on: 'bg-[#16A34A] text-white' },
                { id: 'medium', label: 'Caution', range: '31–60', on: 'bg-[#F59E0B] text-white' },
                { id: 'high', label: 'High', range: '61–100', on: 'bg-[#DC2626] text-white' },
              ] as const).map((band) => (
                <div key={band.id} className={`rounded-md py-1.5 ${verdict === band.id ? band.on : 'bg-[#0B1E3F]/5 text-[#0B1E3F]/45'}`}>
                  <div className="font-semibold">{band.label}</div>
                  <div className="opacity-80">{band.range}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="md:col-span-3 bg-white rounded-2xl border border-[#0B1E3F]/10 p-8 card-shadow text-[#0B1E3F]">
          <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-2">Our verdict</div>
          {(() => {
            const rec = recommendationFor(r, verdict);
            // How the score was built: every finding that added points, in
            // order of weight. Informational findings (0 pts) aren't listed.
            const scored = (r.flags || []).filter((f: any) => (Number(f?.pts) || 0) > 0)
              .sort((a: any, b: any) => (b.pts || 0) - (a.pts || 0));
            const rawTotal = scored.reduce((sum: number, f: any) => sum + (Number(f.pts) || 0), 0);
            const infoCount = (r.flags || []).length - scored.length;
            // The main checks that came back fine, from the report's own data.
            const carrierActive = r.commonAuthority === 'Active' || r.contractAuthority === 'Active';
            const brokerActive = r.brokerAuthority === 'Active';
            const ok: string[] = [];
            if (carrierActive || brokerActive) ok.push(`${carrierActive && brokerActive ? 'Carrier & broker' : carrierActive ? 'Carrier' : 'Broker'} authority active`);
            if (r.authorityAge && !/reactivated/i.test(r.authorityAge)) ok.push(`${r.authorityAge} of authority`);
            if (carrierActive && r.bipdOnFile != null && r.bipdOnFile > 0 && !(r.bipdRequired != null && r.bipdOnFile < r.bipdRequired)) ok.push(`$${(r.bipdOnFile * 1000).toLocaleString()} liability on file`);
            if (brokerActive && r.bondOnFile != null && r.bondOnFile >= 75) ok.push('Broker bond on file');
            if (r.outOfService === false) ok.push('Not out of service');
            if (r.sms?.fetched && !Object.values(r.sms.basics || {}).some((b: any) => b?.alert)) ok.push('No FMCSA safety alerts');
            if (r.addressCheck?.found && !r.addressCheck.isMailbox) ok.push('Address checks out');
            if (r.webPresence?.verified) ok.push('Website confirmed');
            if (r.webReputation?.ok && (r.webReputation.hits || []).length === 0) ok.push('No fraud reports online');
            return (<>
              <div className="text-2xl text-[#0B1E3F] leading-tight mb-3">{rec.headline}</div>
              <p className="text-[#0B1E3F]/70 leading-relaxed">{rec.detail}</p>
              {/* Who to ask for, at the number FMCSA has — an impersonator
                  on a spoofed number usually can't name the officer. */}
              {(r.officers || []).length > 0 && r.phone && (
                <div className="mt-4 p-3 bg-[#F5F3EE] rounded-xl text-sm text-[#0B1E3F]/80 flex items-start gap-2">
                  <Phone className="w-4 h-4 text-[#0B1E3F]/50 flex-shrink-0 mt-0.5" />
                  <span>
                    To confirm who you&apos;re dealing with, call <strong className="text-[#0B1E3F]">{String(r.phone).replace(/^(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3')}</strong> (the number on FMCSA&apos;s record) and ask for <strong className="text-[#0B1E3F]">{r.officers[0]}</strong>{r.officers.length > 1 ? <> or <strong className="text-[#0B1E3F]">{r.officers[1]}</strong></> : null}, {r.officers.length > 1 ? 'the officers' : 'the officer'} on the company&apos;s FMCSA filing{r.censusAsOf ? ` (updated ${new Date(r.censusAsOf + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })})` : ''}.
                  </span>
                </div>
              )}

              <div className="mt-6 pt-5 border-t border-[#0B1E3F]/10">
                <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-2">How we got {r.score}/100</div>
                {scored.length === 0 ? (
                  <div className="text-sm text-[#0B1E3F]/70">Nothing added points. Every check below came back fine.</div>
                ) : (
                  <ul className="space-y-1.5">
                    {scored.map((f: any, i: number) => (
                      <li key={i} className="flex items-start gap-3 text-sm">
                        <span className={`mono text-xs font-semibold w-10 text-right flex-shrink-0 pt-0.5 ${f.sev === 'critical' ? 'text-[#DC2626]' : f.sev === 'warning' ? 'text-[#B45309]' : 'text-[#0B1E3F]/60'}`}>+{f.pts}</span>
                        <span className="text-[#0B1E3F]/80">{f.title}</span>
                      </li>
                    ))}
                    <li className="flex items-start gap-3 text-sm pt-1.5 border-t border-[#0B1E3F]/5">
                      <span className="mono text-xs font-bold w-10 text-right flex-shrink-0 pt-0.5">{r.score}</span>
                      <span className="text-[#0B1E3F]/60">Total{rawTotal > 100 ? ` (capped at 100 — findings add up to ${rawTotal})` : ''}. Details for each are under Red flags below.</span>
                    </li>
                  </ul>
                )}
                {infoCount > 0 && <div className="mt-2 text-xs text-[#0B1E3F]/50">{infoCount} other note{infoCount === 1 ? '' : 's'} below for context, not scored.</div>}
              </div>

              {ok.length > 0 && (
                <div className="mt-5">
                  <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-2">What checked out</div>
                  <div className="flex flex-wrap gap-1.5">
                    {ok.map((label) => (
                      <span key={label} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-[#16A34A]/10 text-[#16A34A] text-xs font-medium">
                        <CheckCircle2 className="w-3 h-3" /> {label}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>);
          })()}
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
                {/* Older saved reports carry the raw fetch error. */}
                <span className="opacity-75">· {/aborted|timed? ?out/i.test(String(s.note || '')) ? 'didn’t respond in time — try Scan again' : s.note}</span>
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
          // Officers and email as filed on the company's MCS-150 (FMCSA
          // census) — the person to ask for when calling the FMCSA number.
          { icon: UserCheck, label: (r.officers || []).length > 1 ? 'Company officers' : 'Company officer', val: (r.officers || []).length ? r.officers.join(' · ') : 'Not on FMCSA record' },
          r.fmcsaEmail
            ? { icon: Mail, label: 'Email on FMCSA filing', val: r.fmcsaEmail }
            : { icon: Mail, label: 'Email domain', val: r.emailDomain ? `${r.emailDomain}${(r.backfilled || []).some((b: any) => b.field === 'emailDomain') ? ' (from an earlier FMCSA record)' : ''}` : 'Not on FMCSA record' },
          // FMCSA's carrier lookup doesn't return a grant date; age comes from
          // its authority-history data and can be unavailable.
          { icon: Clock, label: 'Authority age', val: r.authorityAge || 'Unavailable', warn: r.authorityAge && /reactivated/i.test(r.authorityAge) },
        ]} />
        <DetailPanel title="FMCSA authority & insurance" items={[
          // Carrier authority (common or contract) and broker authority are
          // separate roles; red only when NEITHER is active.
          ...(() => {
            const carrierActive = r.commonAuthority === 'Active' || r.contractAuthority === 'Active';
            const brokerActive = r.brokerAuthority === 'Active';
            const known = Boolean(r.commonAuthority || r.contractAuthority || r.brokerAuthority || r.authorityStatus);
            const noneActive = known && !carrierActive && !brokerActive && !(r.authorityStatus === 'Active' && !r.commonAuthority && !r.contractAuthority && !r.brokerAuthority);
            const carrierVal = carrierAuthorityLabel(r);
            return [
              { label: 'Carrier authority', val: carrierVal, good: carrierActive, warn: noneActive },
              { label: 'Broker authority', val: r.brokerAuthority || '—', good: brokerActive, warn: noneActive },
            ];
          })(),
          { label: 'Safety rating', val: r.safetyRating || 'Not rated' },
          { label: 'Out-of-service', val: r.outOfService ? 'Yes' : 'No', good: r.outOfService === false, warn: r.outOfService === true },
          { label: 'Insurance on file', val: r.insuranceSummary || '—', warn: r.bipdOnFile === 0 || (r.cargoRequired && r.cargoOnFile === 0), good: r.bipdOnFile != null && r.bipdOnFile > 0 && !(r.cargoRequired && r.cargoOnFile === 0) },
          // Only claim a status FMCSA actually gave us: a date, or its overdue flag.
          { label: 'MCS-150', val: r.mcs150Outdated === true ? (r.mcs150Date ? `Overdue (${r.mcs150Date})` : 'Overdue') : r.mcs150Date || (r.mcs150Outdated === false ? 'Not overdue' : '—'), warn: r.mcs150Outdated === true },
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
              <div className="text-sm text-[#0B1E3F]/60 mt-1">We only treat a website as theirs when its name matches and its Google listing has their FMCSA address or phone.</div>
            </div>
            {r.webPresence.found ? (
              r.webPresence.verified === true ? (
                <span
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#16A34A]/10 text-[#16A34A]"
                  title={`The site's Google listing has the same ${r.webPresence.verifiedBy === 'phone' ? 'phone number' : 'address'} as the FMCSA record, and its name matches the company.`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Website confirmed · matches FMCSA {r.webPresence.verifiedBy === 'phone' ? 'phone' : 'address'}
                </span>
              ) : (
                <span
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#F59E0B]/10 text-[#B45309]"
                  title="We found this site by searching the company name, but couldn't tie it to the FMCSA address or phone. It may belong to someone else."
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Possible website — not confirmed as theirs
                </span>
              )
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
                  <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55 mb-1">{r.webPresence.verified === true ? 'Website' : 'Possible website'}</div>
                  <a href={r.webPresence.url} target="_blank" rel="noreferrer nofollow" className="text-sm font-semibold text-[#0B1E3F] hover:underline break-all">{r.webPresence.domain}</a>
                  {r.webPresence.title && <div className="text-xs text-[#0B1E3F]/60 mt-1 truncate">{r.webPresence.title}</div>}
                </div>
                <div className="p-4 bg-[#0B1E3F]/5 rounded-xl">
                  <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55 mb-1">Domain age</div>
                  {r.webPresence.verified === true ? (
                    <div className={`text-sm font-semibold ${r.webPresence.domainAgeDays != null && r.webPresence.domainAgeDays < 90 ? 'text-[#DC2626]' : 'text-[#0B1E3F]'}`}>
                      {r.webPresence.domainAgeDays != null
                        ? r.webPresence.domainAgeDays < 365
                          ? `${r.webPresence.domainAgeDays} days`
                          : `${(r.webPresence.domainAgeDays / 365).toFixed(1)} years`
                        : '—'}
                    </div>
                  ) : (
                    <div className="text-sm text-[#0B1E3F]/60">Not checked — site not confirmed as theirs</div>
                  )}
                </div>
              </div>
              {r.webPresence.verified !== true && (
                <div className="mb-4 p-3 rounded-lg bg-[#F59E0B]/5 border border-[#F59E0B]/25 text-xs text-[#0B1E3F]/75 leading-relaxed">
                  {r.webPresence.nameMatch
                    ? 'The name matches, but this site’s Google listing doesn’t have their FMCSA address or phone (or it has no listing), so it could be another company’s — or an impersonator’s.'
                    : 'This site came up in a search for the company, but neither its name nor its Google listing ties it to their FMCSA record.'}
                  {' '}Don’t use phone numbers or emails from it to verify this company, and don’t treat an email from this domain as proof of who sent it.
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {r.webPresence.verified === true && r.webPresence.hasMx != null && (
                  <span className={`px-2.5 py-1 rounded-full text-[11px] mono ${r.webPresence.hasMx ? 'bg-[#16A34A]/10 text-[#16A34A]' : 'bg-[#F59E0B]/10 text-[#F59E0B]'}`}>
                    {r.webPresence.hasMx ? 'MX configured' : 'No MX'}
                  </span>
                )}
                {r.webPresence.verified === true && r.webPresence.hasSpf != null && (
                  <span className={`px-2.5 py-1 rounded-full text-[11px] mono ${r.webPresence.hasSpf ? 'bg-[#16A34A]/10 text-[#16A34A]' : 'bg-[#0B1E3F]/5 text-[#0B1E3F]/60'}`}>
                    {r.webPresence.hasSpf ? 'SPF set' : 'No SPF'}
                  </span>
                )}
                {r.webPresence.verified === true && r.webPresence.addressMatch && (
                  <span className="px-2.5 py-1 bg-[#16A34A]/10 text-[#16A34A] rounded-full text-[11px] mono">Google listing at FMCSA address</span>
                )}
                {r.webPresence.verified === true && r.webPresence.phoneMatch && (
                  <span className="px-2.5 py-1 bg-[#16A34A]/10 text-[#16A34A] rounded-full text-[11px] mono">Google listing has FMCSA phone</span>
                )}
                {r.webPresence.nameMatch && (
                  <span className="px-2.5 py-1 bg-[#0B1E3F]/5 text-[#0B1E3F]/70 rounded-full text-[11px] mono">Name matches</span>
                )}
              </div>
              {r.webPresence.verified === true && Array.isArray(r.webPresence.socials) && r.webPresence.socials.length > 0 && (
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
              <div className="text-sm text-[#0B1E3F]/60 mt-1">Cross-checked the FMCSA address against Google Places. Only a listing at the exact same address (street, number, ZIP and suite) counts.</div>
            </div>
            {r.addressCheck.error ? (
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#0B1E3F]/10 text-[#0B1E3F]/70"><AlertTriangle className="w-3.5 h-3.5" /> Couldn&rsquo;t check</span>
            ) : r.addressCheck.found ? (
              r.addressCheck.isMailbox ? (
                <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#F59E0B]/10 text-[#F59E0B]"><AlertTriangle className="w-3.5 h-3.5" /> Mail-forwarding service</span>
              ) : r.addressCheck.isResidence ? (
                <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#0B1E3F]/10 text-[#0B1E3F]/75"><Building2 className="w-3.5 h-3.5" /> Likely residential address (common for owner-operators)</span>
              ) : r.addressCheck.businessStatus === 'CLOSED_PERMANENTLY' ? (
                <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#DC2626]/10 text-[#DC2626]"><XCircle className="w-3.5 h-3.5" /> Permanently closed</span>
              ) : r.addressCheck.addressMatched !== true ? (
                // Saved before exact-address matching existed: the listing
                // may be at a nearby address. Make no claim either way.
                <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#0B1E3F]/10 text-[#0B1E3F]/70"><AlertTriangle className="w-3.5 h-3.5" /> Nearby listing — address not confirmed</span>
              ) : r.addressCheck.nameMatches ? (
                <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#16A34A]/10 text-[#16A34A]"><CheckCircle2 className="w-3.5 h-3.5" /> Listed at this address under their name</span>
              ) : (
                <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#F59E0B]/10 text-[#B45309]"><AlertTriangle className="w-3.5 h-3.5" /> A different business is listed here</span>
              )
            ) : (
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#0B1E3F]/10 text-[#0B1E3F]/70"><AlertTriangle className="w-3.5 h-3.5" /> No listing at this address</span>
            )}
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="p-4 bg-[#0B1E3F]/5 rounded-xl">
              <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55 mb-1">FMCSA address</div>
              <div className="text-sm font-medium text-[#0B1E3F]">{r.address || '—'}</div>
            </div>
            <div className="p-4 bg-[#0B1E3F]/5 rounded-xl">
              <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55 mb-1">Google Places match</div>
              {r.addressCheck.error ? (
                <div className="text-sm text-[#0B1E3F]/60">Google Places didn&rsquo;t respond, so the address wasn&rsquo;t checked. This is not a finding.</div>
              ) : r.addressCheck.found && r.addressCheck.isResidence ? (
                <>
                  <div className="text-sm font-medium text-[#0B1E3F]">No business listed at this address</div>
                  <div className="text-xs text-[#0B1E3F]/60 mt-0.5">{r.addressCheck.matchedAddress || ''}{r.addressCheck.matchedAddress ? ' · ' : ''}usually a home. Normal for owner-operators.</div>
                </>
              ) : r.addressCheck.found ? (
                <>
                  <div className="text-sm font-medium text-[#0B1E3F]">{r.addressCheck.matchedName || '—'}</div>
                  <div className="text-xs text-[#0B1E3F]/60 mt-0.5">{r.addressCheck.matchedAddress || ''}</div>
                </>
              ) : (
                <div className="text-sm text-[#0B1E3F]/60">No Google listing at exactly this address</div>
              )}
            </div>
          </div>
          {r.addressCheck.found && !r.addressCheck.isResidence && (
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
            {(r.rateCon.origin || r.rateCon.destination) && (
              <button onClick={() => navigate('planner', { pickup: r.rateCon.origin || '', delivery: r.rateCon.destination || '', rate: r.rateCon.rate_amount || '' })} className="px-3.5 py-1.5 border border-[#0B1E3F]/15 rounded-full text-xs font-medium hover:bg-[#0B1E3F]/5 flex items-center gap-1.5">
                <RouteIcon className="w-3.5 h-3.5" /> Plan this load
              </button>
            )}
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
            // Email-domain-matches-website check. FMCSA lists no websites,
            // so a match only means something when we confirmed the site
            // is the company's (name + Google listing at the FMCSA address
            // or phone). Against an unconfirmed site — which could be an
            // impersonator's — a match proves nothing, and we say so.
            const queriedDomain = (r.queriedEmail || '').toLowerCase().split('@').pop()?.replace(/^www\./, '') || '';
            const carrierDomain = (r.webPresence?.domain || '').toLowerCase().replace(/^www\./, '');
            const exactMatch = queriedDomain && carrierDomain && queriedDomain === carrierDomain;
            const siteConfirmed = r.webPresence?.verified === true;
            if (exactMatch && siteConfirmed) {
              return (
                <div className="p-4 mb-5 bg-[#16A34A]/5 border border-[#16A34A]/25 rounded-xl flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#16A34A]/15 flex items-center justify-center flex-shrink-0">
                    <CheckCircle2 className="w-4 h-4 text-[#16A34A]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-[#0B1E3F]">Email matches the website we confirmed for this company</div>
                    <div className="text-xs text-[#0B1E3F]/65 mt-0.5">
                      <span className="mono">{r.queriedEmail}</span> uses <span className="mono">{queriedDomain}</span>, the same domain as the website whose Google listing has their FMCSA {r.webPresence?.verifiedBy === 'phone' ? 'phone number' : 'address'}. A good sign — spoofed rate cons usually use a near-but-different domain. Email can still be forged, so confirm big changes (like payment details) by phone.
                    </div>
                  </div>
                </div>
              );
            }
            if (exactMatch) {
              return (
                <div className="p-4 mb-5 bg-[#0B1E3F]/[0.03] border border-[#0B1E3F]/15 rounded-xl flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#0B1E3F]/10 flex items-center justify-center flex-shrink-0">
                    <AlertTriangle className="w-4 h-4 text-[#0B1E3F]/60" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-[#0B1E3F]">Email uses the same domain as a possible website — not confirmed as theirs</div>
                    <div className="text-xs text-[#0B1E3F]/65 mt-0.5">
                      <span className="mono">{queriedDomain}</span> is the domain of a site we found by searching the company name, but we couldn&rsquo;t tie that site to their FMCSA address or phone. This match doesn&rsquo;t show the email is from them. Call the company on a number you look up yourself.
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
              <div className={`text-sm font-semibold truncate ${r.domain.mx?.hasMx || r.domain.mx?.error ? 'text-[#0B1E3F]' : 'text-[#DC2626]'}`} title={r.domain.mx?.provider || (r.domain.mx?.records?.[0] ?? '')}>
                {r.domain.mx?.hasMx
                  ? (r.domain.mx.provider || 'Custom / unknown')
                  : r.domain.mx?.error ? 'Couldn’t check' : 'No email server'}
              </div>
              <div className="text-xs text-[#0B1E3F]/50 mt-1">
                {r.domain.mx?.hasMx
                  ? `${r.domain.mx.records?.length || 0} MX record${(r.domain.mx.records?.length || 0) === 1 ? '' : 's'}${r.domain.mx.provider ? '' : ' (no known provider match)'}`
                  : r.domain.mx?.error
                    ? 'The DNS lookup failed — not a finding'
                    : 'Can’t receive email, so replies to this sender bounce. Real business email domains can receive mail.'}
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
              <div className="text-sm text-[#0B1E3F]/60 mt-1">FMCSA records sharing this phone or address, and other companies named in news and industry coverage. A shared mention is not proof of a relationship.</div>
            </div>
            <span className="px-3 py-1.5 bg-[#FF6B35]/10 text-[#FF6B35] rounded-full text-xs mono uppercase tracking-wider font-semibold">
              {(r.linkedEntities?.length || 0) + (r.chameleonLinks?.length || 0)} links
            </span>
          </div>

          {r.chameleonLinks && r.chameleonLinks.length > 0 && (
            <div className="mb-6">
              <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/55 mb-3">Other FMCSA records sharing this phone or address</div>
              <div className="space-y-2">
                {/* Only FMCSA-sourced links. Older saved reports may hold
                    'our-lookup' links built from Haulock's own past verdicts;
                    those are no longer evidence and aren't shown. */}
                {r.chameleonLinks.filter((link: any) => link.source !== 'our-lookup').map((link: any, i: number) => (
                  <div key={i} className={`flex items-start gap-3 p-3 rounded-xl border ${link.badStatus ? 'bg-[#DC2626]/5 border-[#DC2626]/20' : 'bg-[#0B1E3F]/[0.03] border-[#0B1E3F]/10'}`}>
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${link.badStatus ? 'bg-[#DC2626]/15' : 'bg-[#0B1E3F]/10'}`}>
                      <AlertTriangle className={`w-4 h-4 ${link.badStatus ? 'text-[#DC2626]' : 'text-[#0B1E3F]/50'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] mono uppercase tracking-wider font-semibold ${link.badStatus ? 'bg-[#DC2626]/15 text-[#DC2626]' : 'bg-[#0B1E3F]/10 text-[#0B1E3F]/60'}`}>{link.matchedOn} match</span>
                        <span className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/50">{link.badStatus ? 'FMCSA record' : 'FMCSA record · informational, not scored'}</span>
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
              <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/55 mb-3">Other companies named in the same coverage</div>
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
                These companies were named in the same coverage as this one. That alone doesn&rsquo;t mean they&rsquo;re related. Click one to run a separate Haulock scan on it.
              </div>
            </div>
          )}
        </div>
      )}
      {r.sms?.fetched && <FmcsaSmsPanel sms={r.sms} dot={r.dot} carrier={r} />}
      {r.dot && <SafetyActivityPanel dot={String(r.dot)} />}
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
          {(r.flags || []).map((flag: any, i: number) => (
            <FlagRow key={i} {...flag} webHits={flag.links || (/^Web reputation/i.test(String(flag.title || '')) ? r.webReputation?.hits : undefined)} />
          ))}
          {(!r.flags || r.flags.length === 0) && (
            <div className="py-12 text-center text-[#0B1E3F]/60">
              <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-[#16A34A]" />
              No red flags detected for this company.
            </div>
          )}
        </div>
      </div>
    </div>
    {watchOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0B1E3F]/40 backdrop-blur-sm" onClick={() => watching !== 'saving' && setWatchOpen(false)}>
        <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 max-w-md w-full p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-[#0B1E3F]/5 flex items-center justify-center flex-shrink-0">
              <Eye className="w-5 h-5 text-[#0B1E3F]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-base font-semibold text-[#0B1E3F]">Watch this {entityBadge(r).label.toLowerCase().includes('broker') ? 'broker' : 'carrier'}?</div>
              <div className="text-xs text-[#0B1E3F]/60 mt-0.5">We&rsquo;ll email you when FMCSA&rsquo;s record changes: authority, insurance, bond, out-of-service status, safety rating, address or phone.</div>
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
// Homepage example of the report's inspections & crashes panel. All data
// here is made up (marketing never shows a real company's record).
const SHOWCASE_MONTHS = {
  clean: [2, 3, 1, 2, 4, 2, 3, 2, 1, 3, 2, 4, 3, 2, 2, 3, 1, 2, 3, 2, 4, 2, 3, 1],
  viol: [1, 0, 2, 1, 1, 2, 0, 1, 2, 1, 1, 0, 2, 1, 1, 0, 2, 1, 1, 2, 1, 1, 0, 1],
  oos: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
  crashes: [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0],
};

function InspectionShowcase({ navigate }: { navigate: any }) {
  const m = SHOWCASE_MONTHS;
  const max = Math.max(...m.clean.map((c, i) => c + m.viol[i] + m.oos[i]));
  const [open, setOpen] = useState(true);
  const rows = [
    { date: 'Oct 9', place: 'Ehrenberg, AZ', level: 'Level III · driver only', result: 'Clean', cls: 'bg-[#16A34A]/10 text-[#16A34A]' },
    { date: 'Oct 6', place: 'Gary, IN', level: 'Level II · walk-around', result: '2 violations', cls: 'bg-[#F59E0B]/15 text-[#B45309]' },
    { date: 'Oct 2', place: 'Joplin, MO', level: 'Level II · walk-around', result: 'Out of service · vehicle', cls: 'bg-[#DC2626]/10 text-[#DC2626]', details: [
      { desc: 'Brake out of adjustment', oos: true, unit: 'vehicle' },
      { desc: 'Inoperable required lamp', oos: false, unit: 'vehicle' },
    ] },
    { date: 'Sep 24', place: 'Laramie, WY', level: 'Level I · full inspection', result: 'Clean', cls: 'bg-[#16A34A]/10 text-[#16A34A]' },
  ];
  return (
    <section id="inspections" className="py-24 px-6 bg-[#F5F3EE] border-t border-[#0B1E3F]/10 text-[#0B1E3F] scroll-mt-20">
      <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
        <div>
          <div className="text-xs mono uppercase tracking-[0.2em] text-[#FF6B35] mb-4">— Inspections &amp; crashes</div>
          <h2 className="text-4xl md:text-5xl leading-[1.05] mb-6">Every roadside inspection. <span className="serif italic">Every crash.</span></h2>
          <p className="text-[#0B1E3F]/70 text-lg mb-6 leading-relaxed">
            Totals only tell you so much. Every Haulock carrier report lists each roadside inspection and crash from the last 24 months, straight from FMCSA&apos;s daily files: when, where, what the officer found, and whether a truck or driver was put out of service.
          </p>
          <ul className="space-y-3 mb-6 text-[#0B1E3F]/80">
            <li className="flex items-start gap-3"><div className="w-1.5 h-1.5 rounded-full bg-[#DC2626] flex-shrink-0 mt-2" /><span>See whether out-of-service results are getting better or worse, month by month.</span></li>
            <li className="flex items-start gap-3"><div className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] flex-shrink-0 mt-2" /><span>Open any inspection to see each violation: brakes, lights, tires, hours of service, speeding.</span></li>
            <li className="flex items-start gap-3"><div className="w-1.5 h-1.5 rounded-full bg-[#0B1E3F] flex-shrink-0 mt-2" /><span>Crashes by date and place, with injuries, fatalities and tow-aways.</span></li>
            <li className="flex items-start gap-3"><div className="w-1.5 h-1.5 rounded-full bg-[#16A34A] flex-shrink-0 mt-2" /><span>Your own company: an email for each new inspection and crash filed on your DOT (paid plans).</span></li>
          </ul>
          <p className="text-[#0B1E3F]/55 text-sm mb-8 leading-relaxed">Inspections reach FMCSA a few days after they happen. Crash records don&apos;t say who was at fault.</p>
          <div className="flex flex-col sm:flex-row gap-3">
            <button onClick={() => navigate('signup')} className="px-6 py-3.5 bg-[#0B1E3F] text-white rounded-full font-medium hover:bg-[#0B1E3F]/90 transition inline-flex items-center justify-center gap-2">
              Sign up free &amp; check a carrier <ArrowRight className="w-4 h-4" />
            </button>
            <div className="text-xs text-[#0B1E3F]/55 self-center">Included in every carrier report, free plan too</div>
          </div>
        </div>

        {/* Example panel (made-up data) */}
        <div className="bg-white rounded-3xl p-6 md:p-7 card-shadow-lg border border-[#0B1E3F]/10">
          <div className="flex items-start justify-between gap-3 pb-4 mb-4 border-b border-[#0B1E3F]/10">
            <div>
              <div className="font-semibold">Example Trucking LLC</div>
              <div className="text-[11px] mono text-[#0B1E3F]/50">Roadside inspections &amp; crashes · last 24 months</div>
            </div>
            <span className="px-2 py-0.5 rounded-full bg-[#0B1E3F]/5 text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/60 whitespace-nowrap">Example data</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: 'Inspections', value: '90', sub: '3 in last 30 days', cls: 'bg-[#0B1E3F]/[0.04]', tone: '' },
              { label: 'Clean', value: '63%', sub: '57 no violations', cls: 'bg-[#16A34A]/[0.07]', tone: 'text-[#16A34A]' },
              { label: 'Out of service', value: '8', sub: '6 vehicle · 2 driver', cls: 'bg-[#DC2626]/[0.07]', tone: 'text-[#DC2626]' },
              { label: 'Crashes', value: '3', sub: '1 with injuries', cls: 'bg-[#0B1E3F]/[0.04]', tone: '' },
            ].map((x) => (
              <div key={x.label} className={`p-3 rounded-xl ${x.cls}`}>
                <div className="text-[9px] mono uppercase tracking-wider text-[#0B1E3F]/55">{x.label}</div>
                <div className={`text-xl font-semibold mt-0.5 ${x.tone}`}>{x.value}</div>
                <div className="text-[10px] text-[#0B1E3F]/55">{x.sub}</div>
              </div>
            ))}
          </div>

          <div className="mt-5" aria-hidden="true">
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[11px] text-[#0B1E3F]/60">Inspections per month</div>
              <div className="flex items-center gap-2.5 text-[10px] text-[#0B1E3F]/55">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-[#16A34A]" />Clean</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-[#F59E0B]" />Violations</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-[#DC2626]" />OOS</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#0B1E3F]" />Crash</span>
              </div>
            </div>
            <div className="flex items-end h-20" style={{ gap: 2 }}>
              {m.clean.map((c, i) => {
                const total = c + m.viol[i] + m.oos[i];
                return (
                  <div key={i} className="flex-1 h-full flex flex-col justify-end">
                    <div className="w-full flex flex-col overflow-hidden rounded-t-[3px]" style={{ height: `${(total / max) * 100}%`, gap: 1 }}>
                      {m.oos[i] > 0 && <div className="w-full bg-[#DC2626]" style={{ flexGrow: m.oos[i] }} />}
                      {m.viol[i] > 0 && <div className="w-full bg-[#F59E0B]" style={{ flexGrow: m.viol[i] }} />}
                      {c > 0 && <div className="w-full bg-[#16A34A]" style={{ flexGrow: c }} />}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex mt-1" style={{ gap: 2 }}>
              {m.crashes.map((n, i) => (
                <div key={i} className="flex-1 flex justify-center">{n > 0 && <span className="w-3 h-3 rounded-full bg-[#0B1E3F] text-white text-[8px] font-bold flex items-center justify-center">{n}</span>}</div>
              ))}
            </div>
          </div>

          <div className="mt-5 text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55 mb-1.5">Latest inspections</div>
          <div className="divide-y divide-[#0B1E3F]/5 border border-[#0B1E3F]/10 rounded-xl overflow-hidden text-sm">
            {rows.map((r) => (
              <div key={r.date + r.place}>
                <button onClick={() => r.details && setOpen((v) => !v)} className={`w-full flex items-center gap-3 px-3 py-2 text-left ${r.details ? 'hover:bg-[#0B1E3F]/[0.03]' : 'cursor-default'}`}>
                  <div className="w-12 flex-shrink-0 font-medium">{r.date}</div>
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{r.place}</div>
                    <div className="text-[10px] text-[#0B1E3F]/50 truncate">{r.level}</div>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${r.cls}`}>{r.result}</span>
                  {r.details ? <ChevronRight className={`w-3.5 h-3.5 text-[#0B1E3F]/35 transition-transform ${open ? 'rotate-90' : ''}`} /> : <span className="w-3.5" />}
                </button>
                {r.details && open && (
                  <div className="px-3 pb-2.5 pl-[4.25rem] space-y-1">
                    {r.details.map((v) => (
                      <div key={v.desc} className="text-[11px] text-[#0B1E3F]/75 flex items-start gap-2">
                        <span className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${v.oos ? 'bg-[#DC2626]' : 'bg-[#F59E0B]'}`} />
                        <span>{v.desc}{v.oos && <strong className="text-[#DC2626]"> · out of service</strong>}<span className="text-[#0B1E3F]/40"> · {v.unit}</span></span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-4 text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55 mb-1.5">Crashes</div>
          <div className="flex items-center gap-3 px-3 py-2 border border-[#0B1E3F]/10 rounded-xl text-sm">
            <div className="w-12 flex-shrink-0 font-medium">Jul 18</div>
            <div className="flex-1 min-w-0 truncate">Amarillo, TX</div>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#F59E0B]/15 text-[#B45309]">1 injury</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#0B1E3F]/5 text-[#0B1E3F]/70">Tow-away</span>
          </div>
          <div className="mt-3 text-[10px] text-[#0B1E3F]/45">Made-up example. Real reports use FMCSA&apos;s inspection and crash files.</div>
        </div>
      </div>
    </section>
  );
}

const fmtEventDate = (d: string, withYear = true) => d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' }) : '—';
const eventPlace = (loc: string, state: string) => [loc && loc.toUpperCase() !== state ? loc : '', state].filter(Boolean).join(', ') || 'Location not reported';

function inspectionResult(e: any): { label: string; cls: string } {
  if (e.oos > 0) {
    const who = e.driverOos && !e.vehicleOos ? ' · driver' : e.vehicleOos && !e.driverOos ? ' · vehicle' : '';
    return { label: `Out of service${who}`, cls: 'bg-[#DC2626]/10 text-[#DC2626]' };
  }
  if (e.violations > 0) return { label: `${e.violations} violation${e.violations === 1 ? '' : 's'}`, cls: 'bg-[#F59E0B]/15 text-[#B45309]' };
  return { label: 'Clean', cls: 'bg-[#16A34A]/10 text-[#16A34A]' };
}

// Every roadside inspection and crash in the last 24 months, from FMCSA's
// inspection and crash files (refreshed daily).
function SafetyActivityPanel({ dot }: { dot: string }) {
  const res = useCachedFetch<any>(`safety:${dot}`, `/api/fmcsa/safety-activity?dot=${encodeURIComponent(dot)}`);
  const a = res.data;
  const [hover, setHover] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const shell = (children: React.ReactNode) => (
    <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-6 md:p-8 card-shadow text-[#0B1E3F]">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <span className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/55 font-semibold">FMCSA roadside inspections &amp; crashes</span>
        <span className="px-2 py-0.5 bg-[#0B1E3F]/5 text-[#0B1E3F]/65 rounded-full text-[10px] mono uppercase tracking-wider font-semibold">Last 24 months · updated daily</span>
      </div>
      {children}
    </div>
  );
  if (!a) {
    return shell(res.loading
      ? <div className="py-8 flex items-center gap-3 text-sm text-[#0B1E3F]/55"><div className="w-4 h-4 border-2 border-[#0B1E3F]/20 border-t-[#FF6B35] rounded-full animate-spin" /> Pulling every inspection and crash from FMCSA…</div>
      : <div className="py-6 text-sm text-[#0B1E3F]/60">FMCSA&apos;s inspection records didn&apos;t respond. <button onClick={res.refetch} className="underline font-medium">Try again</button></div>);
  }
  const ins = a.inspections, cr = a.crashes;
  if (ins.total === 0 && cr.total === 0) {
    return shell(
      <div className="mt-2">
        <h2 className="text-xl font-semibold">No inspections or crashes on file</h2>
        <p className="text-sm text-[#0B1E3F]/65 mt-1">FMCSA has no roadside inspections or reportable crashes for DOT-{dot} in the last 24 months. Common for new or small fleets. It also means there&apos;s no safety history to judge by.</p>
      </div>,
    );
  }
  const pct = (n: number) => (ins.total ? Math.round((n / ins.total) * 100) : 0);
  const months: any[] = a.byMonth || [];
  const max = Math.max(1, ...months.map((m) => m.clean + m.violations + m.oos));
  const list: any[] = showAll ? ins.recent : ins.recent.slice(0, 8);
  const last = ins.last;

  return shell(
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap mt-1 mb-5">
        <h2 className="text-xl font-semibold">Every inspection and crash</h2>
        {last && (
          <div className="text-xs text-[#0B1E3F]/60 text-right">
            Last inspected <strong className="text-[#0B1E3F]">{fmtEventDate(last.date)}</strong> · {eventPlace(last.location, last.state)}
            <span className={`ml-2 px-2 py-0.5 rounded-full text-[10px] font-semibold ${inspectionResult(last).cls}`}>{inspectionResult(last).label}</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-xl bg-[#0B1E3F]/[0.04]">
          <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">Inspections</div>
          <div className="text-2xl font-semibold mt-1">{ins.total.toLocaleString()}{ins.truncated ? '+' : ''}</div>
          <div className="text-[11px] text-[#0B1E3F]/55">{a.last30.inspections} in the last 30 days</div>
        </div>
        <div className="p-3.5 rounded-xl bg-[#16A34A]/[0.07]">
          <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">Clean</div>
          <div className="text-2xl font-semibold mt-1 text-[#16A34A]">{pct(ins.clean)}%</div>
          <div className="text-[11px] text-[#0B1E3F]/55">{ins.clean.toLocaleString()} with no violations</div>
        </div>
        <div className={`p-3.5 rounded-xl ${ins.oos ? 'bg-[#DC2626]/[0.07]' : 'bg-[#0B1E3F]/[0.04]'}`}>
          <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">Out of service</div>
          <div className={`text-2xl font-semibold mt-1 ${ins.oos ? 'text-[#DC2626]' : ''}`}>{ins.oos.toLocaleString()}</div>
          <div className="text-[11px] text-[#0B1E3F]/55">{ins.vehicleOos} vehicle · {ins.driverOos} driver</div>
        </div>
        <div className={`p-3.5 rounded-xl ${cr.fatal ? 'bg-[#DC2626]/[0.07]' : 'bg-[#0B1E3F]/[0.04]'}`}>
          <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">Crashes</div>
          <div className={`text-2xl font-semibold mt-1 ${cr.fatal ? 'text-[#DC2626]' : ''}`}>{cr.total}</div>
          <div className="text-[11px] text-[#0B1E3F]/55">{cr.fatal ? `${cr.fatal} fatal · ` : ''}{cr.injury} with injuries</div>
        </div>
      </div>

      {/* Inspections per month, split by result; crash count underneath. */}
      <div className="mt-6">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
          <div className="text-xs text-[#0B1E3F]/60">Inspections per month</div>
          <div className="flex items-center gap-3 text-[11px] text-[#0B1E3F]/60">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-[#16A34A]" />Clean</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-[#F59E0B]" />Violations</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-[#DC2626]" />Out of service</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-[#0B1E3F]" />Crash</span>
          </div>
        </div>
        <div className="relative">
          <div className="flex items-end h-28" style={{ gap: 2 }} role="img" aria-label={`Inspections per month, oldest first: ${months.map((m) => m.clean + m.violations + m.oos).join(', ')}`}>
            {months.map((m, i) => {
              const total = m.clean + m.violations + m.oos;
              const h = (n: number) => `${(n / max) * 100}%`;
              return (
                <div key={m.month} className="flex-1 h-full flex flex-col justify-end cursor-default" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ opacity: hover == null || hover === i ? 1 : 0.55 }}>
                  {total === 0 ? <div className="w-full rounded-sm bg-[#0B1E3F]/10" style={{ height: 3 }} /> : (
                    <div className="w-full flex flex-col overflow-hidden rounded-t-[4px]" style={{ height: h(total), gap: 1, minHeight: 4 }}>
                      {m.oos > 0 && <div className="w-full bg-[#DC2626]" style={{ flexGrow: m.oos }} />}
                      {m.violations > 0 && <div className="w-full bg-[#F59E0B]" style={{ flexGrow: m.violations }} />}
                      {m.clean > 0 && <div className="w-full bg-[#16A34A]" style={{ flexGrow: m.clean }} />}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex mt-1.5" style={{ gap: 2 }}>
            {months.map((m) => (
              <div key={m.month} className="flex-1 flex justify-center">
                {m.crashes > 0 && <span className="min-w-[14px] h-[14px] px-0.5 rounded-full bg-[#0B1E3F] text-white text-[9px] font-bold flex items-center justify-center">{m.crashes}</span>}
              </div>
            ))}
          </div>
          {hover != null && months[hover] && (
            <div className="absolute -top-10 px-2.5 py-1.5 rounded-lg bg-[#0B1E3F] text-white text-[11px] whitespace-nowrap pointer-events-none z-10" style={{ left: `clamp(0px, calc(${((hover + 0.5) / months.length) * 100}% - 90px), calc(100% - 180px))` }}>
              <strong>{new Date(`${months[hover].month}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })}</strong>: {months[hover].clean + months[hover].violations + months[hover].oos} inspections
              {months[hover].oos ? ` · ${months[hover].oos} out of service` : ''}{months[hover].crashes ? ` · ${months[hover].crashes} crash${months[hover].crashes === 1 ? '' : 'es'}` : ''}
            </div>
          )}
          <div className="flex justify-between text-[10px] mono text-[#0B1E3F]/40 mt-1">
            <span>{months[0] ? new Date(`${months[0].month}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : ''}</span>
            <span>This month</span>
          </div>
        </div>
      </div>

      {/* Latest inspections */}
      {ins.recent.length > 0 && (
        <div className="mt-6">
          <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/55 mb-2">Latest inspections</div>
          <div className="divide-y divide-[#0B1E3F]/5 border border-[#0B1E3F]/10 rounded-xl overflow-hidden">
            {list.map((e: any) => {
              const rs = inspectionResult(e);
              const expandable = (e.details?.length || 0) > 0;
              const isOpen = open === e.id;
              return (
                <div key={e.id}>
                  <button onClick={() => expandable && setOpen(isOpen ? null : e.id)} className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-left ${expandable ? 'hover:bg-[#0B1E3F]/[0.03]' : 'cursor-default'}`}>
                    <div className="w-24 flex-shrink-0 text-sm font-medium">{fmtEventDate(e.date)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{eventPlace(e.location, e.state)}</div>
                      <div className="text-[11px] text-[#0B1E3F]/50 truncate">{e.levelLabel}{e.postCrash ? ' · after a crash' : ''}</div>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${rs.cls}`}>{rs.label}</span>
                    {expandable ? <ChevronRight className={`w-4 h-4 text-[#0B1E3F]/35 transition-transform ${isOpen ? 'rotate-90' : ''}`} /> : <span className="w-4" />}
                  </button>
                  {isOpen && (
                    <div className="px-3.5 pb-3 pl-[7.5rem] space-y-1.5">
                      {e.details.map((v: any, k: number) => (
                        <div key={k} className="text-xs text-[#0B1E3F]/75 flex items-start gap-2">
                          <span className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${v.oos ? 'bg-[#DC2626]' : 'bg-[#F59E0B]'}`} />
                          <span>{v.desc}{v.oos && <strong className="text-[#DC2626]"> · out of service</strong>}<span className="text-[#0B1E3F]/40"> · {v.unit === 'driver' ? 'driver' : v.unit === 'vehicle' ? 'vehicle' : v.code}</span></span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {ins.recent.length > 8 && (
            <button onClick={() => setShowAll((v) => !v)} className="mt-2 text-xs font-medium underline text-[#0B1E3F]/65">{showAll ? 'Show fewer' : `Show the latest ${ins.recent.length}`}</button>
          )}
        </div>
      )}

      {/* Crashes */}
      {cr.recent.length > 0 && (
        <div className="mt-6">
          <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/55 mb-2">Crashes</div>
          <div className="divide-y divide-[#0B1E3F]/5 border border-[#0B1E3F]/10 rounded-xl overflow-hidden">
            {cr.recent.slice(0, 6).map((c: any) => (
              <div key={c.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <div className="w-24 flex-shrink-0 text-sm font-medium">{fmtEventDate(c.date)}</div>
                <div className="flex-1 min-w-0 text-sm truncate">{eventPlace(c.city || c.location, c.state)}{c.city && c.location ? <span className="text-[#0B1E3F]/45"> · {c.location}</span> : null}</div>
                <div className="flex gap-1.5 flex-shrink-0">
                  {c.fatalities > 0 && <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#DC2626]/10 text-[#DC2626]">{c.fatalities} fatal</span>}
                  {c.injuries > 0 && <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#F59E0B]/15 text-[#B45309]">{c.injuries} injur{c.injuries === 1 ? 'y' : 'ies'}</span>}
                  {c.towAway && <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#0B1E3F]/5 text-[#0B1E3F]/70">Tow-away</span>}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[11px] text-[#0B1E3F]/50">FMCSA crash records don&apos;t say who was at fault.</div>
        </div>
      )}
      <div className="mt-5 pt-4 border-t border-[#0B1E3F]/10 text-[11px] text-[#0B1E3F]/50">
        Source: FMCSA Vehicle Inspection File and Crash File on data.transportation.gov. Inspections show up a few days after they happen. Driver names aren&apos;t public.
      </div>
    </div>,
  );
}

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
  // Reports saved before the parser fix carry FMCSA's intervention threshold
  // (e.g. 80% for Hazmat) as a "percentile" on BASICs with no measure. FMCSA
  // only ranks carriers that have a measure, so drop those.
  const basics = Object.fromEntries(
    Object.entries((sms?.basics || {}) as Record<string, BasicShape | undefined>).map(([k, b]) => [
      k,
      b && b.percentile != null && !(b.measure > 0) ? { ...b, percentile: undefined } : b,
    ]),
  ) as Record<string, BasicShape | undefined>;
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
  // Plain-English crash readout, relative to fleet size: the usual benchmark
  // is ~0.2–0.4 reportable crashes per truck per year, and SMS counts 24
  // months — so 18 crashes is a lot for 10 trucks and normal for 130.
  const fleet = overview.totalTrucks ?? carrier?.powerUnits ?? null;
  const perTruckYear = crashes && fleet ? crashes.total / 2 / fleet : null;
  const crashesHigh = crashes
    ? (perTruckYear != null ? perTruckYear > 0.4 && crashes.total >= 3 : crashes.total >= 10)
    : false;
  const crashLine = crashes
    ? (crashes.total === 0
        ? 'Zero reported crashes in the last 24 months.'
        : crashes.fatal > 0 && (fleet == null || fleet < 50)
          ? `${crashes.fatal} fatal crash${crashes.fatal === 1 ? '' : 'es'} on file. Read the full SMS Crashes report before you tender.`
          : perTruckYear != null
            ? `${crashes.total} crash${crashes.total === 1 ? '' : 'es'} in 24 months across ${fleet} truck${fleet === 1 ? '' : 's'}: about ${perTruckYear.toFixed(2)} per truck per year, ${crashesHigh ? 'above' : perTruckYear < 0.2 ? 'below' : 'within'} the usual 0.2–0.4.${crashes.fatal > 0 ? ` Includes ${crashes.fatal} fatal crash${crashes.fatal === 1 ? '' : 'es'} — FMCSA counts crashes regardless of fault.` : ''}`
            : `${crashes.total} crash${crashes.total === 1 ? '' : 'es'} in 24 months. Fleet size unknown, so we can't compare this to similar carriers.`)
    : null;
  // FMCSA's carrier record and SMS update on different schedules, so their
  // crash totals can differ by one or two — say so instead of leaving it.
  const crashCountNote = crashes && carrier?.crashTotal != null && carrier.crashTotal !== crashes.total
    ? `FMCSA's carrier record shows ${carrier.crashTotal}; SMS (updated monthly) shows ${crashes.total}. The two sources update on different schedules.`
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
              (k === 'hazmat' || k === 'driverFitness' || k === 'controlledSubstances' || k === 'vehicleMaintenance')
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
            (k === 'hazmat' || k === 'driverFitness' || k === 'controlledSubstances' || k === 'vehicleMaintenance') ? 80 : 65;
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
          // FMCSA alerts on the percentile OR on acute/critical violations
          // found in an investigation — so a percentile under the line can
          // still carry an alert. Never claim "above" when it isn't.
          const alertReason = federalAlert && b.percentile != null
            ? (b.percentile >= threshold
              ? `FMCSA marked this BASIC for federal intervention. ${b.percentile}% percentile is ${b.percentile === threshold ? 'at' : 'above'} the ${threshold}% threshold. Adds +30 to the Haulock risk score.`
              : `FMCSA marked this BASIC for federal intervention. The ${b.percentile}% percentile is under the ${threshold}% threshold, so the alert likely comes from acute or critical violations found in an investigation. Adds +30 to the Haulock risk score.`)
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
                : (() => {
                    // Name exactly which rate is above / below the national average.
                    const part = (label: string, pct: number | null, nat: number | null | undefined) =>
                      pct == null || nat == null ? null : `${label} OOS is ${pct > nat ? 'above' : 'at or below'} the national average (${pct.toFixed(1)}% vs ${nat.toFixed(1)}%)`;
                    const parts = [part('Vehicle', vehOosPct, inspections.vehicleNationalAvgPct), part('driver', drvOosPct, inspections.driverNationalAvgPct)].filter(Boolean);
                    return `${inspections.vehicleInspections + inspections.driverInspections} total inspections in 24 months.${parts.length ? ` ${parts.join('; ')}.` : ''}`;
                  })()}
          </div>
        </>
      )}

      {/* Crashes summary — color-coded with severity, plus interpretation */}
      {crashes && (
        <>
          <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55 mb-2">Crashes (last 24 months)</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
            <SmsStatCard label="Total" value={String(crashes.total)} alert={crashesHigh} />
            <SmsStatCard label="Fatal" value={String(crashes.fatal)} alert={crashes.fatal > 0 && (fleet == null || fleet < 50)} />
            <SmsStatCard label="Injury" value={String(crashes.injury)} />
            <SmsStatCard label="Tow-away" value={String(crashes.towaway)} />
          </div>
          {crashLine && (
            <div className={`text-[11px] mb-6 leading-relaxed ${crashesHigh || (crashes.fatal > 0 && (fleet == null || fleet < 50)) ? 'text-[#DC2626]' : 'text-[#0B1E3F]/65'}`}>
              {crashLine}
              {crashCountNote && <span className="block mt-1 text-[#0B1E3F]/55">{crashCountNote}</span>}
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
  // Neutral on purpose: a rating from ~5 years ago is background, not a
  // current warning, and it isn't part of today's score.
  const ratingTone = { fg: '#0B1E3F', bg: 'bg-[#0B1E3F]/[0.03]', border: 'border-[#0B1E3F]/10' };
  const emailMatches: any[] = data.emailMatches || [];
  // Collapsed by default — it's old reference data, so it shouldn't compete
  // with today's findings for attention.
  const [open, setOpen] = useState(false);
  const summary = [
    data.rating?.riskOverall ? `rated ${String(data.rating.riskOverall).toLowerCase()}` : '',
    typeof data.rating?.trucksTotal === 'number' ? `${data.rating.trucksTotal} truck${data.rating.trucksTotal === 1 ? '' : 's'} then` : '',
    emailMatches.length ? `email shared with ${emailMatches.length} other record${emailMatches.length === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' · ');

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="w-full text-left bg-white rounded-2xl border border-[#0B1E3F]/10 px-6 py-4 text-[#0B1E3F] hover:bg-[#0B1E3F]/[0.02] transition flex items-center gap-3">
        <Clock className="w-4 h-4 text-[#0B1E3F]/40 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">Old FMCSA snapshot, about 5 years ago{summary ? <span className="text-[#0B1E3F]/55 font-normal"> · {summary}</span> : null}</div>
          <div className="text-xs text-[#0B1E3F]/50 mt-0.5">Background only. A lot changes in 5 years, so this isn&apos;t part of today&apos;s score.</div>
        </div>
        <span className="text-xs text-[#0B1E3F]/55 flex-shrink-0">Show</span>
        <ChevronRight className="w-4 h-4 text-[#0B1E3F]/40 flex-shrink-0" />
      </button>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-8 card-shadow text-[#0B1E3F]">
      <div className="flex items-start justify-between mb-5 flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/55 font-semibold">FMCSA archive</span>
            <span className="px-2 py-0.5 bg-[#0B1E3F]/5 text-[#0B1E3F]/65 rounded-full text-[10px] mono uppercase tracking-wider font-semibold">snapshot · ~5 years ago</span>
          </div>
          <h2 className="text-xl font-semibold text-[#0B1E3F]">Historical reference data</h2>
          <div className="text-sm text-[#0B1E3F]/60 mt-1">
            What FMCSA had on file for this company about 5 years ago. Useful for spotting big changes (new owner, new address, much bigger fleet). <span className="font-medium">It isn&apos;t part of today&apos;s score</span>, because a lot changes in 5 years.
          </div>
        </div>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-[#0B1E3F]/55 hover:text-[#0B1E3F] underline">Hide</button>
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
            <strong className="text-[#0B1E3F]">How to use this:</strong> if any of these other carriers are inactive, OOS, or have FMCSA enforcement actions, treat the shared email as a yellow flag — not proof. If they all look clean, this is probably one operator running multiple legitimate MCs.
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
  fax: 'Fax',
  emailFull: 'Email',
};

function fieldLabel(key: string): string {
  return HISTORY_FIELD_LABELS[key] || key;
}

// FMCSA writes the same address many ways ("ROAD" vs "RD", ZIP vs ZIP+4).
// Normalize before comparing so a reformatted address isn't shown as a move.
function normalizeHistoryValue(v: string): string {
  return v
    .toUpperCase()
    .replace(/\b(\d{5})-\d{4}\b/g, '$1')
    .replace(/\bROAD\b/g, 'RD').replace(/\bSTREET\b/g, 'ST').replace(/\bAVENUE\b/g, 'AVE')
    .replace(/\bDRIVE\b/g, 'DR').replace(/\bBOULEVARD\b/g, 'BLVD').replace(/\bSUITE\b/g, 'STE')
    .replace(/\bHIGHWAY\b/g, 'HWY').replace(/\bLANE\b/g, 'LN').replace(/\bCOURT\b/g, 'CT')
    .replace(/[^A-Z0-9]/g, '');
}

// FMCSA crash counts cover a rolling 24 months, so a lower number usually
// means an old crash aged out, not that a record was erased.
const ROLLING_WINDOW_FIELDS = new Set(['crashTotal', 'fatalCrash']);

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
          <div className="text-sm text-[#0B1E3F]/60 mt-1">Address, authority, insurance, and fleet-size changes Haulock has seen for this company over time.</div>
        </div>
        <span className="px-3 py-1.5 bg-[#0B1E3F]/5 rounded-full text-xs mono uppercase tracking-wider font-semibold text-[#0B1E3F]/70">
          {history.length} snapshot{history.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="mb-6 p-4 bg-[#F5F3EE]/70 rounded-xl text-xs text-[#0B1E3F]/70 leading-relaxed">
        <strong className="text-[#0B1E3F]">Where this comes from:</strong> the oldest entry is from Haulock&apos;s FMCSA archive (about 5 years ago).
        After that, Haulock saves a copy of FMCSA&apos;s record each time anyone looks this company up, and each entry shows what differs from the copy before it.
        The time shown is when Haulock noticed the difference, not when FMCSA recorded it. Fields that simply weren&apos;t in an older copy are listed separately, because they aren&apos;t real changes.
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
          // Sort this entry's fields into real changes vs. noise: a field
          // missing from the older copy (first recorded), missing from this
          // copy (not reported this time), or the same value reformatted.
          const fmtH = (v: any): string => {
            if (v == null || v === '') return '—';
            if (typeof v === 'boolean') return v ? 'Yes' : 'No';
            return String(v);
          };
          const prevData: any = history[i + 1]?.data || {};
          const real: string[] = [], formatting: string[] = [], added: string[] = [], missing: string[] = [];
          if (!isInitial) {
            for (const f of fields) {
              const b = fmtH(prevData[f]), a = fmtH(row.data?.[f]);
              if (b === a) continue;
              if (b === '—') added.push(f);
              else if (a === '—') missing.push(f);
              else if (normalizeHistoryValue(b) === normalizeHistoryValue(a)) formatting.push(f);
              else real.push(f);
            }
          }
          const summary = isInitial ? '' : [
            real.length ? `${real.length} real change${real.length === 1 ? '' : 's'}` : (added.length ? 'First full FMCSA record' : 'No real changes'),
            added.length && real.length ? `${added.length} first recorded` : '',
            formatting.length ? `${formatting.length} formatting only` : '',
          ].filter(Boolean).join(' · ');
          return (
            <li key={row.id} className="relative">
              <span className={`absolute -left-[31px] top-1.5 w-3.5 h-3.5 rounded-full border-2 border-white ${isLatest ? 'bg-[#16A34A]' : isInitial ? 'bg-[#0B1E3F]/40' : 'bg-[#FF6B35]'}`} />
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/55">{dateLabel}</span>
                {isLatest && <span className="px-1.5 py-0.5 rounded-full text-[9px] mono uppercase tracking-wider bg-[#16A34A]/10 text-[#16A34A] font-semibold">Latest</span>}
                {isInitial && <span className="px-1.5 py-0.5 rounded-full text-[9px] mono uppercase tracking-wider bg-[#0B1E3F]/5 text-[#0B1E3F]/55 font-semibold">First record</span>}
                {!isInitial && (
                  <span className={`text-[10px] ${real.length ? 'text-[#FF6B35] font-semibold' : 'text-[#0B1E3F]/45'}`}>{summary}</span>
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
                // Change entry — before → after for real changes (the
                // "before" is the previous, older row's value), then the
                // noise, clearly labelled as not-a-change.
                const changeCard = (f: string, muted: boolean) => {
                  const beforeS = fmt(prevData[f]);
                  const afterS = fmt(row.data?.[f]);
                  const agedOut = ROLLING_WINDOW_FIELDS.has(f) && Number(afterS) < Number(beforeS);
                  return (
                    <div key={f} className={`p-2.5 rounded-lg ${muted ? 'bg-[#0B1E3F]/[0.03]' : 'bg-[#F5F3EE]/60'}`}>
                      <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55 mb-1 flex items-center gap-1.5">
                        {fieldLabel(f)}
                        {muted && <span className="normal-case tracking-normal text-[#0B1E3F]/45">· formatting only</span>}
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium truncate text-[#0B1E3F]/55 line-through" title={beforeS}>{beforeS}</span>
                        <ArrowRight className={`w-3 h-3 flex-shrink-0 ${muted ? 'text-[#0B1E3F]/30' : 'text-[#FF6B35]'}`} />
                        <span className={`truncate ${muted ? 'text-[#0B1E3F]/60' : 'font-semibold text-[#0B1E3F]'}`} title={afterS}>{afterS}</span>
                      </div>
                      {agedOut && <div className="text-[11px] text-[#0B1E3F]/50 mt-1">FMCSA counts crashes over a rolling 24 months, so older ones drop off.</div>}
                    </div>
                  );
                };
                return (
                  <div className="space-y-3">
                    {(real.length > 0 || formatting.length > 0) && (
                      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-2">
                        {real.map((f) => changeCard(f, false))}
                        {formatting.map((f) => changeCard(f, true))}
                      </div>
                    )}
                    {added.length > 0 && (
                      <div className="text-xs text-[#0B1E3F]/60">
                        <div className="mb-1.5"><span className="font-semibold text-[#0B1E3F]/75">First recorded here</span> — not in the older copy, so this isn&apos;t a change:</div>
                        <div className="flex flex-wrap gap-1.5">
                          {added.map((f) => (
                            <span key={f} className="px-2 py-1 bg-[#0B1E3F]/[0.04] rounded-md" title={fmt(row.data?.[f])}>
                              {fieldLabel(f)}: <span className="text-[#0B1E3F]/80">{fmt(row.data?.[f])}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {missing.length > 0 && (
                      <div className="text-xs text-[#0B1E3F]/55">
                        <span className="font-semibold text-[#0B1E3F]/70">Not included in this copy:</span> {missing.map(fieldLabel).join(', ')}. That usually means the data source didn&apos;t return the field, not that the company removed it.
                      </div>
                    )}
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

// What kind of page a web-reputation hit is, in plain words. The search
// matches the company name next to words like "fraud" or "lawsuit", so the
// page type matters: a BBB profile exists for every listed business, and a
// court case against a carrier is often an accident claim, not fraud.
function describeWebHit(domain: string, title: string): { kind: string; note: string } {
  const d = domain.toLowerCase();
  const t = title.toLowerCase();
  if (/bbb\.org$/.test(d)) return { kind: 'BBB profile', note: 'Every listed business has a BBB page. Open it to see the rating and whether any complaints were filed.' };
  if (/complaint\.fmcsa\.dot\.gov$|nccdb\.fmcsa/.test(d)) return { kind: 'FMCSA complaint portal', note: 'A page on FMCSA’s complaint system. Open it to see whether complaints were actually filed.' };
  if (/justia\.com$|courtlistener\.com$|casetext\.com$|pacermonitor\.com$|unicourt\.com$|law\.cornell\.edu$/.test(d) || /\bv\.\s|\bvs?\.\s/.test(t)) {
    return { kind: 'Court case', note: 'The company is named in a lawsuit. For carriers this is often an accident or injury claim rather than fraud, so open it to see what the case is about.' };
  }
  if (/freightwaves\.com$|landline\.media$|ttnews\.com$|overdriveonline\.com$|ccjdigital\.com$|freightcaviar\.com$/.test(d)) return { kind: 'Trucking news', note: 'An industry news article that mentions the company.' };
  if (/truckersreport\.com$|reddit\.com$|thetruckersreport\.com$/.test(d)) return { kind: 'Forum post', note: 'A discussion where drivers or dispatchers mention the company.' };
  if (/\.gov$/.test(d)) return { kind: 'Government page', note: 'A government page that mentions the company.' };
  return { kind: 'Web page', note: 'A page that mentions the company near words like fraud, scam or lawsuit.' };
}

function FlagRow({ sev, title, desc, pts, details, metrics, recommendation, webHits }: any) {
  const [open, setOpen] = useState(false);
  const hits: any[] = Array.isArray(webHits) ? webHits.filter((h: any) => h?.url) : [];
  const bgMap: any = { critical: 'rgba(220,38,38,0.08)', warning: 'rgba(245,158,11,0.08)', info: 'rgba(11,30,63,0.05)' };
  const borderMap: any = { critical: 'rgba(220,38,38,0.2)', warning: 'rgba(245,158,11,0.2)', info: 'rgba(11,30,63,0.1)' };
  const iconColor = sev === 'critical' ? '#DC2626' : sev === 'warning' ? '#F59E0B' : 'rgba(11,30,63,0.6)';
  const expandable = Boolean(details || (metrics && metrics.length) || recommendation || hits.length);
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
          {hits.length > 0 ? (
            // Web reputation: every source as a link, what kind of page it is,
            // and the search snippet, so the user can judge each one.
            <div className={metrics && metrics.length > 0 ? '' : 'pt-4'}>
              <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55 mb-1">What this means</div>
              <div className="text-sm text-[#0B1E3F]/80 leading-relaxed mb-3">
                Haulock searched the web for this company&apos;s name together with words like fraud, scam and lawsuit, and kept results from trusted sites.
                A result means the name appears on that page, not that the page accuses the company. Open each one to see what it actually says.
              </div>
              <div className="space-y-2">
                {hits.slice(0, 8).map((h: any, i: number) => {
                  const info = describeWebHit(String(h.domain || ''), String(h.title || ''));
                  return (
                    <a key={i} href={h.url} target="_blank" rel="noopener noreferrer" className="block bg-white rounded-lg border px-3 py-2.5 hover:border-[#0B1E3F]/40 transition" style={{ borderColor: borderMap[sev] }}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#0B1E3F]/[0.06] text-[#0B1E3F]/70 font-semibold">{info.kind}</span>
                        {h.category === 'fraud' && <span className="text-[10px] mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#DC2626]/10 text-[#DC2626] font-semibold">Mentions fraud</span>}
                        {h.category && h.category !== 'fraud' && <span className="text-[10px] mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#16A34A]/10 text-[#16A34A] font-semibold">Not scored</span>}
                        <span className="text-xs mono text-[#0B1E3F]/50">{h.domain}</span>
                      </div>
                      <div className="text-sm font-medium text-[#0B1E3F] mt-1 underline decoration-[#0B1E3F]/20 underline-offset-2">{h.title}</div>
                      {h.snippet && <div className="text-xs text-[#0B1E3F]/65 mt-1 leading-relaxed line-clamp-3">{String(h.snippet).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')}</div>}
                      <div className="text-[11px] text-[#0B1E3F]/50 mt-1.5">{info.note}</div>
                    </a>
                  );
                })}
              </div>
            </div>
          ) : details && (
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
          <button onClick={() => navigate('verify')} className="px-5 py-2.5 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90">Verify a broker or carrier</button>
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
      forgetLocalPdfs([(items || []).find((x: any) => x.id === id)?.data?.fileSha256]);
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
          forgetLocalPdfs(group.rows.map((x: any) => x.data?.fileSha256));
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
        body: 'This hides every scan in your history. Your monthly quota is not refunded — these scans still count toward your plan limit. Watchlist entries and alerts are unaffected.',
        confirmLabel: 'Clear history',
        danger: true,
      },
      run: async () => {
        setDeletingAll(true); setError(null);
        try {
          const r = await fetch('/api/lookups?all=1', { method: 'DELETE' });
          const j = await r.json().catch(() => null);
          if (!r.ok) throw new Error(j?.error || `Delete failed (${r.status})`);
          forgetLocalPdfs('all');
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
    // COI rows: re-compare the saved certificate with today's FMCSA data.
    if (l.source === 'coi') {
      try {
        const r = await fetch('/api/coi/recheck', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: l.id }) });
        const data = await r.json();
        if (!r.ok) throw new Error(data?.error || `Re-check failed (${r.status})`);
        invalidateCache('lookups:200');
        navigate('report', data);
      } catch (err: any) {
        setError(err?.message || 'Re-check failed');
      } finally {
        setRescanId(null);
      }
      return;
    }
    // Re-scan the exact company the row resolved to (prefixed MC/DOT); the
    // saved free-text query could be a name that now matches someone else.
    const q = (l.mc ? `MC-${String(l.mc).replace(/\D/g, '')}` : l.dot ? `DOT-${String(l.dot).replace(/\D/g, '')}` : (l.query || '')).trim();
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
    const key = l.source === 'forensics'
      ? `forensics|${(l.query || l.data?.filename || l.id || '').toLowerCase()}`
      : `${l.mc || ''}|${l.dot || ''}|${(l.name || 'unknown').toLowerCase()}`;
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
          <div className="text-sm mb-6">{items.length === 0 ? 'Every broker or carrier you verify will be saved here.' : 'Try a different search.'}</div>
          {items.length === 0 && <button onClick={() => navigate('verify')} className="px-5 py-2.5 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90">Verify a broker or carrier</button>}
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
        // Scroll container + min-h-full inner box: centred when it fits, and
        // scrollable from the very top when it doesn't (items-center on the
        // scroll container itself pushed the top off-screen).
        <div className="fixed inset-0 z-50 bg-[#F5F3EE]/95 backdrop-blur-sm overflow-y-auto">
          <div className="min-h-full flex items-center justify-center p-3 md:p-6">
          <div className="w-full max-w-5xl">
            <div className="text-center mb-3">
              <div className="text-xs mono uppercase tracking-[0.2em] text-[#FF6B35] mb-1">Re-running scan</div>
              <div className="text-xl serif italic text-[#0B1E3F]">Pulling fresh data for {scanQuery}…</div>
            </div>
            <VerifyScanProgress query={scanQuery} result={scanResult} />
          </div>
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
  const hasCoi = l.source === 'coi' || group.rows.some((r: any) => r.source === 'coi');
  const isForensics = l.source === 'forensics';
  // Forensics rows have a file, not a company; saved results before `kind`
  // existed get it added so the report page routes to the forensics view.
  const openRow = (row: any) => navigate('report', row.source === 'forensics' ? { kind: 'forensics', filename: row.query, ...(row.data || {}) } : row.data);
  const forensicsLabel = (v: string) => v === 'high' ? 'LIKELY TAMPERED' : v === 'medium' ? 'WORTH A LOOK' : 'CLEAN';
  return (
    <div className="text-[#0B1E3F]">
      <div className="flex items-center gap-4 p-4 md:p-5 hover:bg-[#0B1E3F]/5 transition">
        <button onClick={() => openRow(l)} className={`w-12 h-12 rounded-full flex items-center justify-center mono font-semibold flex-shrink-0 transition ${verdict === 'high' ? 'bg-[#DC2626]/10 text-[#DC2626]' : verdict === 'medium' ? 'bg-[#F59E0B]/10 text-[#F59E0B]' : 'bg-[#16A34A]/10 text-[#16A34A]'}`}>{l.score}</button>
        <button onClick={() => openRow(l)} className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="font-semibold text-[#0B1E3F] truncate">{isForensics ? (l.query || l.data?.filename || 'PDF document') : l.name}</div>
            {isForensics && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[#0B1E3F]/8 text-[#0B1E3F] text-[10px] mono uppercase tracking-wider font-bold flex-shrink-0" title="A PDF checked for signs of editing.">
                <Shield className="w-3 h-3" /> PDF forensics
              </span>
            )}
            {hasRateCon && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[#FF6B35]/10 text-[#FF6B35] text-[10px] mono uppercase tracking-wider font-bold flex-shrink-0"
                title="This carrier was scanned from a PDF rate confirmation upload."
              >
                <FileText className="w-3 h-3" /> Rate con
              </span>
            )}
            {hasCoi && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[#0B1E3F]/8 text-[#0B1E3F] text-[10px] mono uppercase tracking-wider font-bold flex-shrink-0"
                title="An insurance certificate (COI) for this carrier was checked against FMCSA filings."
              >
                <ShieldCheck className="w-3 h-3" /> COI
              </span>
            )}
          </div>
          <div className="text-xs mono text-[#0B1E3F]/50 truncate">
            {isForensics ? forensicsLabel(verdict) : ([l.mc && `MC-${l.mc}`, l.dot && `DOT-${l.dot}`].filter(Boolean).join(' · ') || 'No ID')} · {count > 1 ? `${count} ${isForensics ? 'scans' : 'searches'}` : `last ${timeAgo(l.created_at)}`}
            {count === 1 && l.email_query && ` · ${l.email_query}`}
          </div>
        </button>
        <div className="hidden sm:flex items-center gap-2">
          {count > 1 && (
            <button onClick={() => setOpen((v) => !v)} className="px-3 py-1.5 text-xs bg-[#0B1E3F]/5 text-[#0B1E3F]/80 hover:bg-[#0B1E3F]/10 rounded-full transition flex items-center gap-1">
              <ChevronRight className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`} /> {count} searches
            </button>
          )}
          <button onClick={() => openRow(l)} className="px-3 py-1.5 text-xs bg-[#0B1E3F]/5 text-[#0B1E3F] hover:bg-[#0B1E3F]/10 rounded-full transition">View</button>
          {isForensics ? (
            // The PDF isn't stored, so there's nothing to re-run here.
            <button onClick={() => navigate('verify', { tab: 'forensics' })} className="px-3 py-1.5 text-xs bg-[#0B1E3F] text-white hover:bg-[#0B1E3F]/90 rounded-full transition" title="Check another PDF">Check a PDF</button>
          ) : l.source === 'coi' ? (
            // A COI row re-checks the certificate against today's FMCSA
            // filings (saved reading — the PDF isn't stored), not an MC lookup.
            <>
              <button onClick={() => onRescan(l)} disabled={rescanId === l.id} className="px-3 py-1.5 text-xs bg-[#0B1E3F] text-white hover:bg-[#0B1E3F]/90 rounded-full transition flex items-center gap-1 disabled:opacity-60" title="Compares this certificate with today's FMCSA filings again. Doesn't use a COI credit.">
                {rescanId === l.id ? (<><div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" /> Checking…</>) : (<>Re-check COI</>)}
              </button>
              <button onClick={() => navigate('verify', { tab: 'coi' })} className="px-3 py-1.5 text-xs bg-[#0B1E3F]/5 text-[#0B1E3F] hover:bg-[#0B1E3F]/10 rounded-full transition" title="Upload the certificate again for a fresh reading">Upload again</button>
            </>
          ) : (
            <button onClick={() => onRescan(l)} disabled={rescanId === l.id} className="px-3 py-1.5 text-xs bg-[#0B1E3F] text-white hover:bg-[#0B1E3F]/90 rounded-full transition flex items-center gap-1 disabled:opacity-60" title="Runs a fresh FMCSA lookup — uses 1 credit">
              {rescanId === l.id ? (<><div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" /> Scanning…</>) : (<>Scan again</>)}
            </button>
          )}
          <button onClick={() => onDeleteGroup(group)} disabled={groupBusy} className="w-8 h-8 flex items-center justify-center rounded-full text-[#0B1E3F]/50 hover:bg-[#DC2626]/10 hover:text-[#DC2626] transition disabled:opacity-60" title={count > 1 ? `Remove all ${count} lookups for this carrier (does not restore monthly quota)` : 'Remove from history (does not restore monthly quota)'}>
            {groupBusy ? <div className="w-3 h-3 border border-[#DC2626]/40 border-t-[#DC2626] rounded-full animate-spin" /> : <Trash2 className="w-4 h-4" />}
          </button>
        </div>
      </div>
      {open && count > 1 && (
        <div className="bg-[#0B1E3F]/[0.02] border-t border-[#0B1E3F]/5 divide-y divide-[#0B1E3F]/5">
          {group.rows.map((row: any) => {
            const rv = row.verdict || (row.score >= 61 ? 'high' : row.score >= 31 ? 'medium' : 'low');
            const verdictLabel = row.source === 'forensics' ? forensicsLabel(rv) : rv === 'high' ? 'HIGH RISK' : rv === 'medium' ? 'CAUTION' : 'LOW RISK';
            const verdictColor = rv === 'high' ? 'text-[#DC2626]' : rv === 'medium' ? 'text-[#F59E0B]' : 'text-[#16A34A]';
            return (
              <div key={row.id} className="w-full flex items-center gap-4 p-3 md:p-4 pl-8 hover:bg-[#0B1E3F]/5 transition text-[#0B1E3F]">
                <button onClick={() => openRow(row)} className="flex items-center gap-4 flex-1 min-w-0 text-left">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center mono text-xs font-semibold flex-shrink-0 ${rv === 'high' ? 'bg-[#DC2626]/10 text-[#DC2626]' : rv === 'medium' ? 'bg-[#F59E0B]/10 text-[#F59E0B]' : 'bg-[#16A34A]/10 text-[#16A34A]'}`}>{row.score}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`text-xs mono uppercase tracking-wider font-semibold ${verdictColor}`}>{verdictLabel}</span>
                      <span className="text-xs mono text-[#0B1E3F]/60">· score {row.score}/100</span>
                    </div>
                    <div className="text-xs text-[#0B1E3F]/60 truncate">
                      {timeAgo(row.created_at)}
                      {row.source === 'ratecon' && ' · rate con'}
                      {row.source === 'coi' && ' · COI check'}
                      {row.source === 'forensics' && ' · PDF forensics'}
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
      `Watchlist entries are unaffected.`
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
      // Same key as /api/alerts' badge count, so the two always agree.
      const key = a.source === 'forensics' ? `pdf:${(a.query || '').toLowerCase()}` : a.mc ? `mc:${a.mc}` : a.dot ? `dot:${a.dot}` : `name:${(a.name || '').toLowerCase()}`;
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
            title="Soft-delete every alert. Watchlist unaffected. Quota not refunded."
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
          <button onClick={() => navigate('verify')} className="px-5 py-2.5 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90">Verify a broker or carrier</button>
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
                onClick={() => navigate('report', a.source === 'forensics' ? { kind: 'forensics', filename: a.query, ...(a.data || {}) } : a.data)}
                className="w-full text-left flex items-start gap-4 p-5 bg-white rounded-2xl border border-[#0B1E3F]/10 hover:border-[#0B1E3F]/20 card-shadow transition text-[#0B1E3F] cursor-pointer relative"
              >
                <div className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${sev === 'critical' ? 'bg-[#DC2626]' : 'bg-[#F59E0B]'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${a.verdict === 'high' ? 'bg-[#DC2626]/10 text-[#DC2626]' : 'bg-[#F59E0B]/10 text-[#F59E0B]'}`}>{a.source === 'forensics' ? (a.verdict === 'high' ? 'LIKELY TAMPERED' : 'WORTH A LOOK') : a.verdict === 'high' ? 'HIGH RISK' : 'CAUTION'}</span>
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
                  <div className="font-semibold text-[#0B1E3F] truncate">{a.source === 'forensics' ? (a.query || 'PDF document') : a.name}</div>
                  <div className="text-sm mono text-[#0B1E3F]/50 mb-2">{a.source === 'forensics' ? 'PDF forensics' : [a.mc && `MC-${a.mc}`, a.dot && `DOT-${a.dot}`].filter(Boolean).join(' · ') || 'No ID'}</div>
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
