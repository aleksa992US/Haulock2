'use client';

import React, { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import {
  Shield, Search, AlertTriangle, CheckCircle2, XCircle, TrendingUp, FileText, Bell,
  Users, Settings, LogOut, ChevronRight, ArrowRight, Lock, Zap, Database, Eye, Flag,
  Clock, MapPin, Phone, Mail, Building2, Download, Share2, Plus, BarChart3, Menu,
  Command, ShieldCheck, Star, Quote, Radio, PlayCircle, Target,
  Facebook, Instagram, Linkedin, Twitter, Youtube, Globe, Trash2, Copy, Key, ScanLine, Sparkles, Upload,
} from 'lucide-react';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase/client';
import { timeAgo } from '@/lib/timeago';
import { PLANS, getPlan, formatLimit } from '@/lib/plans';
import { useCachedFetch, invalidateCache } from '@/lib/data-cache';

const APP_ROUTES = ['dashboard', 'verify', 'history', 'reports', 'watchlist', 'alerts', 'plan', 'settings', 'report', 'admin'];
const AUTH_ROUTES = ['login', 'signup', 'pricing'];
const ALL_ROUTES = [...APP_ROUTES, ...AUTH_ROUTES, 'landing'];

function pathToRoute(pathname: string): string {
  const seg = (pathname || '/').split('/').filter(Boolean)[0] || 'landing';
  return ALL_ROUTES.includes(seg) ? seg : 'landing';
}

function routeToPath(route: string): string {
  return route === 'landing' ? '/' : `/${route}`;
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
    plan: meta.plan || '',
    planChangedAt: meta.plan_changed_at || null,
    stripeCustomerId: meta.stripe_customer_id || null,
    fleet_size: meta.fleet_size || 1,
    createdAt: u.created_at || null,
    notificationEmail: meta.notification_email || '',
    notifyWatchlist: meta.notify_watchlist !== false,
    notifyWeeklyDigest: meta.notify_weekly_digest !== false,
    notifyCommunity: meta.notify_community !== false,
  };
}

export default function Haulock() {
  // usePathname is hydration-safe — same value on server and client for the initial request.
  // After the first render we drive `route` purely from local state via history.pushState.
  const initialPath = usePathname();
  const [route, setRoute] = useState<string>(() => pathToRoute(initialPath || '/'));
  // Sync state when the user uses browser back/forward.
  useEffect(() => {
    const onPop = () => setRoute(pathToRoute(window.location.pathname));
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
    sb.auth.getUser().then(({ data }) => {
      if (data?.user) {
        const u = userFromSession(data.user);
        setUser(u);
        const r = typeof window !== 'undefined' ? pathToRoute(window.location.pathname) : 'landing';
        if (r === 'landing' || r === 'login' || r === 'signup') {
          const target = u.plan ? '/dashboard' : '/plan';
          if (typeof window !== 'undefined') window.history.replaceState({}, '', target);
          setRoute(u.plan ? 'dashboard' : 'plan');
        }
      }
    });
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      if (session?.user) setUser(userFromSession(session.user));
      else setUser(null);
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
    const path = routeToPath(to);
    if (typeof window !== 'undefined' && window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
    setRoute(to);
    if (typeof window !== 'undefined') window.scrollTo(0, 0);
  };

  return (
    <div className="min-h-screen bg-[#F5F3EE] text-[#0B1E3F]">
      {route === 'landing' && <Landing navigate={navigate} />}
      {route === 'login' && <Login navigate={navigate} loginAs={loginAs} />}
      {route === 'signup' && <Signup navigate={navigate} loginAs={loginAs} />}
      {route === 'pricing' && <Pricing navigate={navigate} />}
      {user && ['dashboard', 'verify', 'report', 'reports', 'watchlist', 'alerts', 'settings', 'plan', 'history', 'admin'].includes(route) && (
        <AppShell user={user} route={route} navigate={navigate} logout={logout}>
          <PageSlot routeId="dashboard" current={route}><Dashboard navigate={navigate} user={user} /></PageSlot>
          <PageSlot routeId="verify" current={route}><VerifyTool navigate={navigate} /></PageSlot>
          <PageSlot routeId="report" current={route}><Report report={currentReport} navigate={navigate} /></PageSlot>
          <PageSlot routeId="reports" current={route}><FraudReports navigate={navigate} /></PageSlot>
          <PageSlot routeId="watchlist" current={route}><Watchlist navigate={navigate} /></PageSlot>
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

function Landing({ navigate }: any) {
  return (
    <div className="min-h-screen bg-[#F5F3EE] text-[#0B1E3F]">
      <Nav navigate={navigate} />

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
            <HeroDashboardMockup />
          </div>
        </div>
      </section>

      <section className="border-y border-[#0B1E3F]/10 bg-white overflow-hidden py-5 text-[#0B1E3F]">
        <div className="flex gap-16 ticker whitespace-nowrap">
          {[...Array(2)].map((_, round) => (
            <div key={round} className="flex gap-16 items-center">
              {[
                { mc: 'MC-847•••', v: 'HIGH RISK', color: '#DC2626' },
                { mc: 'MC-226•••', v: 'VERIFIED', color: '#16A34A' },
                { mc: 'MC-498•••', v: 'CAUTION', color: '#F59E0B' },
                { mc: 'MC-329•••', v: 'HIGH RISK', color: '#DC2626' },
                { mc: 'MC-671•••', v: 'VERIFIED', color: '#16A34A' },
                { mc: 'MC-552•••', v: 'HIGH RISK', color: '#DC2626' },
                { mc: 'MC-112•••', v: 'CAUTION', color: '#F59E0B' },
                { mc: 'MC-283•••', v: 'HIGH RISK', color: '#DC2626' },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-3 text-sm shrink-0">
                  <span className="mono" style={{ color: 'rgba(11,30,63,0.6)' }}>{item.mc}</span>
                  <span className="mono font-semibold" style={{ color: item.color }}>{item.v}</span>
                  <span style={{ color: 'rgba(11,30,63,0.3)' }}>·</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="py-20 px-6 bg-[#F5F3EE] text-[#0B1E3F]">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <BigStat value="$47M" label="prevented fraud losses" />
            <BigStat value="4,247" label="active carriers & brokers" />
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

            <div className="bg-white rounded-2xl p-8 relative overflow-hidden card-shadow-lg text-[#0B1E3F]">
              <div className="flex items-center justify-between mb-6">
                <div className="text-[#0B1E3F]">
                  <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/50 mb-1">Haulock scan · 2.1s</div>
                  <div className="text-2xl font-semibold text-[#0B1E3F]">Westport Logistics Group LLC</div>
                  <div className="text-sm mono text-[#0B1E3F]/50">MC-637••• · DOT-3019•••</div>
                </div>
                <RiskGauge score={78} size="sm" />
              </div>

              <div className="p-4 bg-[#DC2626]/10 border border-[#DC2626]/30 rounded-xl mb-6">
                <div className="flex items-center gap-2 text-xs mono uppercase tracking-wider text-[#DC2626] mb-1">
                  <AlertTriangle className="w-3.5 h-3.5" /> Do not book
                </div>
                <div className="text-sm font-medium text-[#0B1E3F]">4 critical red flags · 2 community reports</div>
              </div>

              <div className="space-y-2">
                {[
                  { s: 'critical', t: 'Authority reactivated 12 days ago', d: 'Dormant 3 years prior', p: 30 },
                  { s: 'warning', t: 'Address flipped 3× this year', d: 'Chicago → Atlanta → Miami', p: 30 },
                  { s: 'warning', t: 'Insurance lapsed 8 days ago', d: 'No replacement policy filed', p: 20 },
                  { s: 'info', t: '2 verified fraud reports', d: 'Non-payment complaints', p: 30 },
                ].map((flag, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-lg text-[#0B1E3F]" style={{ backgroundColor: 'rgba(11,30,63,0.05)' }}>
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: flag.s === 'critical' ? '#DC2626' : flag.s === 'warning' ? '#F59E0B' : 'rgba(11,30,63,0.4)' }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-[#0B1E3F]">{flag.t}</div>
                      <div className="text-xs text-[#0B1E3F]/60">{flag.d}</div>
                    </div>
                    <div className="mono text-xs text-[#0B1E3F]/40">+{flag.p}</div>
                  </div>
                ))}
              </div>
            </div>
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
              { q: 'Where does Haulock get its data?', a: 'FMCSA for authority, insurance, and safety history. WHOIS and DNS for domain age and email infrastructure. Google Places for address verification. Public social networks for company footprint. Plus a proprietary community-reported fraud network with 4,200+ verified carriers and brokers.' },
              { q: 'How is this different from Carrier411 or DAT CarrierWatch?', a: 'Most tools only vet in one direction — brokers checking carriers. Haulock works both ways: carriers verifying brokers, brokers verifying carriers, and either side verifying shippers. Fraud flows both directions.' },
              { q: 'Can I cancel anytime?', a: 'Yes. No contracts, no questions. Cancel in one click from your settings.' },
              { q: 'Does it work for freight brokers?', a: 'Yes — Haulock is bidirectional. Brokers use it to verify carriers before dispatching a load, and to vet other brokers before entering co-brokering relationships. Same website, social, and Google Business checks apply in both directions.' },
              { q: 'What about my existing TMS?', a: 'Haulock plugs into your workflow without replacing anything. On the Fleet plan, use our API to bring verification directly into your TMS.' },
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

      <Footer />
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

function HeroDashboardMockup() {
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
  const s = HERO_SCENARIOS[idx];
  const toneBg = s.verdictTone === 'danger' ? 'bg-[#DC2626]/10 border-[#DC2626]/30' : s.verdictTone === 'warn' ? 'bg-[#F59E0B]/10 border-[#F59E0B]/30' : 'bg-[#16A34A]/10 border-[#16A34A]/30';
  const toneText = s.verdictTone === 'danger' ? 'text-[#DC2626]' : s.verdictTone === 'warn' ? 'text-[#F59E0B]' : 'text-[#16A34A]';
  const VerdictIcon = s.verdictTone === 'good' ? CheckCircle2 : AlertTriangle;
  const flagColor = (level: 'critical' | 'warning' | 'good') => level === 'critical' ? '#DC2626' : level === 'warning' ? '#F59E0B' : '#16A34A';
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
            <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/50 mb-1">Broker lookup</div>
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

function RateConMockup() {
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
              <div className="text-xl font-bold tracking-tight text-[#0B1E3F]">WESTPORT LOGISTICS GROUP</div>
              <div className="text-xs mono text-[#0B1E3F]/60">Professional Logistics Solutions</div>
            </div>
            <div className="text-right text-xs mono text-[#0B1E3F]/70">
              <div>MC-637•••</div>
              <div>DOT-3019•••</div>
            </div>
          </div>
          <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-3">RATE CONFIRMATION</div>
          <div className="space-y-3 text-sm text-[#0B1E3F]">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-[#0B1E3F]/60 mb-0.5">Load #</div>
                <div className="mono font-medium text-[#0B1E3F]">RC-2026-0481</div>
              </div>
              <div>
                <div className="text-xs text-[#0B1E3F]/60 mb-0.5">Date</div>
                <div className="mono font-medium text-[#0B1E3F]">04/23/2026</div>
              </div>
            </div>
            <div className="p-3 rounded text-[#0B1E3F]" style={{ backgroundColor: 'rgba(11,30,63,0.05)' }}>
              <div className="text-xs text-[#0B1E3F]/60 mb-1">PICKUP</div>
              <div className="font-medium text-[#0B1E3F]">Thompson Distribution Center</div>
              <div className="text-xs mono text-[#0B1E3F]/70">Dallas, TX 75201 · 04/24 08:00</div>
            </div>
            <div className="p-3 rounded text-[#0B1E3F]" style={{ backgroundColor: 'rgba(11,30,63,0.05)' }}>
              <div className="text-xs text-[#0B1E3F]/60 mb-1">DELIVERY</div>
              <div className="font-medium text-[#0B1E3F]">Atlanta Warehouse Co.</div>
              <div className="text-xs mono text-[#0B1E3F]/70">Atlanta, GA 30303 · 04/26 14:00</div>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <div>
                <div className="text-xs text-[#0B1E3F]/60">Miles</div>
                <div className="mono text-[#0B1E3F]">790</div>
              </div>
              <div>
                <div className="text-xs text-[#0B1E3F]/60">Rate</div>
                <div className="mono font-bold text-lg text-[#0B1E3F]">$2,450.00</div>
              </div>
            </div>
            <div className="pt-4 mt-4 border-t border-[#0B1E3F]/15 text-xs text-[#0B1E3F]">
              <div className="text-[#0B1E3F]/60 mb-1">Contact</div>
              <div className="mono text-[#0B1E3F]">dispatch@westport-logistics.net</div>
              <div className="mono text-[#0B1E3F]/70">(305) 555-0183</div>
            </div>
          </div>
          <div className="absolute top-28 -right-2 flex items-center gap-2 px-2 py-1 bg-[#DC2626] text-white text-xs mono rounded-full">
            <XCircle className="w-3 h-3 text-white" /> spoofed
          </div>
          <div className="absolute bottom-20 -right-2 flex items-center gap-2 px-2 py-1 bg-[#DC2626] text-white text-xs mono rounded-full">
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

function Nav({ navigate }: any) {
  const scrollTo = (id: string) => {
    const el = typeof document !== 'undefined' ? document.getElementById(id) : null;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      navigate('landing');
      setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    }
  };
  return (
    <nav className="sticky top-0 z-50 bg-[#F5F3EE] border-b border-[#0B1E3F]/10 text-[#0B1E3F]">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <Logo />
        <div className="hidden md:flex items-center gap-8 text-sm text-[#0B1E3F]/70">
          <button onClick={() => { navigate('landing'); setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 60); }} className="hover:text-[#0B1E3F]">Home</button>
          <button onClick={() => scrollTo('product')} className="hover:text-[#0B1E3F]">What we check</button>
          <button onClick={() => scrollTo('pricing')} className="hover:text-[#0B1E3F]">Pricing</button>
          <button onClick={() => scrollTo('resources')} className="hover:text-[#0B1E3F]">Resources</button>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('login')} className="px-4 py-2 text-sm text-[#0B1E3F]/70 hover:text-[#0B1E3F]">Log in</button>
          <button onClick={() => navigate('signup')} className="px-4 py-2 bg-[#0B1E3F] text-white text-sm rounded-full hover:bg-[#0B1E3F]/90 transition">Get started</button>
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

function Footer() {
  return (
    <footer className="bg-[#0B1E3F] text-white px-6 pt-20 pb-10">
      <div className="max-w-7xl mx-auto">
        <div className="grid md:grid-cols-5 gap-12 pb-12 border-b border-white/10">
          <div className="md:col-span-2">
            <Logo white />
            <div className="text-sm text-white/70 mt-4 max-w-xs">Know who&apos;s on the other end of every rate con. Trusted by 4,200+ carriers.</div>
          </div>
          {[
            { t: 'Product', items: ['Broker verify', 'Rate con analyzer', 'Community network', 'API'] },
            { t: 'Company', items: ['About', 'Blog', 'Careers', 'Contact'] },
            { t: 'Legal', items: ['Privacy', 'Terms', 'Security', 'Status'] },
          ].map((col, i) => (
            <div key={i}>
              <div className="text-xs mono uppercase tracking-wider text-white/50 mb-4">{col.t}</div>
              <div className="space-y-2.5 text-sm text-white/90">
                {col.items.map((item, j) => <div key={j} className="hover:text-white cursor-pointer">{item}</div>)}
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

function Login({ navigate, loginAs }: any) {
  const [mode, setMode] = useState<'signin' | 'forgot'>('signin');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const configured = isSupabaseConfigured();

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
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${site}/auth/callback` },
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
        <button type="submit" disabled={loading} className="w-full py-3.5 bg-[#0B1E3F] text-white rounded-full font-medium hover:bg-[#0B1E3F]/90 transition card-shadow disabled:opacity-60">
          {loading ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <Divider />
      <button type="button" onClick={onGoogle} className="w-full py-3.5 border border-[#0B1E3F]/20 rounded-full font-medium text-[#0B1E3F] hover:bg-[#0B1E3F]/5 flex items-center justify-center gap-3 bg-white">
        <GoogleIcon /> Continue with Google
      </button>
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
      navigate('plan');
    } else {
      setInfo('Check your email to confirm your account.');
    }
  };

  const onGoogle = async () => {
    if (!configured) { loginAs(); return; }
    const sb = getSupabase()!;
    const site = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${site}/auth/callback` },
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

function AuthShell({ title, subtitle, children, navigate }: any) {
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
            &ldquo;Haulock caught a double-broker scam before I hooked the trailer. Saved me $8,400.&rdquo;
          </div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#FF6B35] flex items-center justify-center font-semibold text-white">JT</div>
            <div>
              <div className="text-sm font-medium text-white">Jamie Thompson</div>
              <div className="text-xs text-white/70">Owner-operator · Kansas City, MO</div>
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

function Pricing({ navigate }: any) {
  return (
    <div className="min-h-screen bg-[#F5F3EE] text-[#0B1E3F]">
      <Nav navigate={navigate} />
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
      <Footer />
    </div>
  );
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

function AdminPage({ navigate }: any) {
  const [users, setUsers] = useState<any[] | null>(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

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

  const f = filter.trim().toLowerCase();
  const shown = (users || []).filter((u) => !f || (u.email || '').toLowerCase().includes(f) || (u.name || '').toLowerCase().includes(f) || (u.company || '').toLowerCase().includes(f) || (u.mc || '').includes(f));

  const totals = (users || []).reduce((acc, u) => ({
    users: acc.users + 1,
    admins: acc.admins + (u.isAdmin ? 1 : 0),
    lookupsThisMonth: acc.lookupsThisMonth + (u.usage?.lookupsThisMonth || 0),
    scansThisMonth: acc.scansThisMonth + (u.usage?.scansThisMonth || 0),
    watchlist: acc.watchlist + (u.usage?.watchlist || 0),
  }), { users: 0, admins: 0, lookupsThisMonth: 0, scansThisMonth: 0, watchlist: 0 });

  return (
    <div className="space-y-8 text-[#0B1E3F]">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-2">Admin</div>
          <h1 className="text-4xl serif italic text-[#0B1E3F]">All Haulock users.</h1>
          <p className="text-[#0B1E3F]/60 mt-2 text-sm">Usage, plans, and admin status per account.</p>
        </div>
        <button onClick={load} className="px-4 py-2 border border-[#0B1E3F]/15 bg-white rounded-full text-sm font-medium text-[#0B1E3F] hover:bg-[#0B1E3F]/5 w-fit">Refresh</button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="p-4 bg-white border border-[#0B1E3F]/10 rounded-xl"><div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">Users</div><div className="text-2xl font-semibold mt-1">{users == null ? '—' : totals.users}</div></div>
        <div className="p-4 bg-white border border-[#0B1E3F]/10 rounded-xl"><div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">Admins</div><div className="text-2xl font-semibold mt-1">{users == null ? '—' : totals.admins}</div></div>
        <div className="p-4 bg-white border border-[#0B1E3F]/10 rounded-xl"><div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">Lookups this mo.</div><div className="text-2xl font-semibold mt-1">{users == null ? '—' : totals.lookupsThisMonth}</div></div>
        <div className="p-4 bg-white border border-[#0B1E3F]/10 rounded-xl"><div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">Scans this mo.</div><div className="text-2xl font-semibold mt-1">{users == null ? '—' : totals.scansThisMonth}</div></div>
        <div className="p-4 bg-white border border-[#0B1E3F]/10 rounded-xl"><div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/55">Watchlist rows</div><div className="text-2xl font-semibold mt-1">{users == null ? '—' : totals.watchlist}</div></div>
      </div>

      <FmcsaStatsCard />

      <FmcsaPrewarmCard />

      <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-3 card-shadow">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by email, name, company, or MC…" className="w-full px-4 py-2.5 bg-transparent rounded-lg text-sm focus:outline-none text-[#0B1E3F] placeholder:text-[#0B1E3F]/40" />
      </div>

      {error && <div className="text-sm text-[#DC2626]">{error}</div>}

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

function OwnScoreChip({ navigate }: { navigate: any }) {
  const res = useCachedFetch<any>('own-score', '/api/profile/own-score');
  const [open, setOpen] = useState(false);
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
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`flex items-center gap-2 pl-1.5 pr-3 py-1 rounded-full transition ${bgClass}`}
        title={`Your ${idLabel} broker score · click for details`}
      >
        <MiniRing score={r.score} color={colorHex} />
        <div className="text-left leading-tight">
          <div className="text-[11px] mono text-[#0B1E3F] font-semibold">{idLabel}</div>
          <div className="text-[10px] mono uppercase tracking-wider font-bold" style={{ color: colorHex }}>{verdictLabel}</div>
        </div>
      </button>
      {open && <OwnScoreModal report={r} cached={r.cached} cachedAt={r.cachedAt} onClose={() => setOpen(false)} onOpenFull={() => { setOpen(false); navigate('report', r); }} />}
    </>
  );
}

function OwnScoreModal({ report, cached, cachedAt, onClose, onOpenFull }: any) {
  const r = report;
  const verdict = r.verdict || (r.score >= 61 ? 'high' : r.score >= 31 ? 'medium' : 'low');
  const verdictColor = verdict === 'high' ? 'text-[#DC2626]' : verdict === 'medium' ? 'text-[#F59E0B]' : 'text-[#16A34A]';
  const verdictBg = verdict === 'high' ? 'bg-[#DC2626]/10' : verdict === 'medium' ? 'bg-[#F59E0B]/10' : 'bg-[#16A34A]/10';
  const verdictLabel = verdict === 'high' ? 'HIGH RISK' : verdict === 'medium' ? 'CAUTION' : 'LOW RISK';
  const flags = r.flags || [];
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
    ...(isAdmin ? [{ id: 'admin', label: 'Admin', icon: ShieldCheck }] : []),
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
  const [tab, setTab] = useState('quick');
  const [input, setInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rcFile, setRcFile] = useState<File | null>(null);
  const [rcLoading, setRcLoading] = useState(false);
  const [rcError, setRcError] = useState<string | null>(null);
  const [rcDrag, setRcDrag] = useState(false);

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
    setLoading(true); setError(null);
    try {
      const promises: Promise<any>[] = [
        fetch(`/api/verify?q=${encodeURIComponent(q)}`).then(async (r) => {
          const j = await r.json();
          if (!r.ok) {
            if (r.status === 402) throw new Error(j?.error || 'Monthly lookup limit reached. Upgrade your plan for more.');
            if (r.status === 503) throw new Error(j?.error || 'FMCSA is temporarily unavailable. Please try again in a minute.');
            if (r.status === 429) throw new Error(j?.error || 'Too many lookups — slow down and try again shortly.');
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
      navigate('report', merged);
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
        {[{ id: 'quick', label: 'Quick lookup' }, { id: 'ratecon', label: 'Rate con analyzer' }, { id: 'bulk', label: 'Bulk verify' }].map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`px-4 py-2 rounded-full text-sm font-medium transition ${tab === t.id ? 'bg-[#0B1E3F] text-white' : 'text-[#0B1E3F]/60 hover:text-[#0B1E3F]'}`}>{t.label}</button>
        ))}
      </div>
      {tab === 'quick' && (
        <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-8 md:p-12 card-shadow text-[#0B1E3F]">
          <label className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 block mb-3">MC number, DOT number, or company name</label>
          <div className="flex gap-3">
            <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') runLookup(); }} placeholder="e.g., MC-847291 or Acme Freight Brokers" className="flex-1 px-5 py-4 bg-[#F5F3EE] border border-[#0B1E3F]/15 rounded-xl text-lg focus:outline-none focus:border-[#0B1E3F] transition text-[#0B1E3F] placeholder:text-[#0B1E3F]/30" />
            <button onClick={() => runLookup()} disabled={loading} className="px-8 py-4 bg-[#0B1E3F] text-white rounded-xl font-medium hover:bg-[#0B1E3F]/90 transition flex items-center gap-2 disabled:opacity-60">
              {loading ? (<><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Checking...</>) : (<>Verify <ArrowRight className="w-4 h-4" /></>)}
            </button>
          </div>
          <div className="mt-5">
            <label className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 block mb-3">Email or domain from the rate con <span className="normal-case text-[#0B1E3F]/40 tracking-normal">(optional — checks domain age, MX, SPF)</span></label>
            <input value={emailInput} onChange={(e) => setEmailInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') runLookup(); }} placeholder="dispatch@acmefreight.com or acmefreight.com" className="w-full px-5 py-4 bg-[#F5F3EE] border border-[#0B1E3F]/15 rounded-xl text-lg focus:outline-none focus:border-[#0B1E3F] transition text-[#0B1E3F] placeholder:text-[#0B1E3F]/30" />
          </div>
          {error && <div className="mt-4 text-sm text-[#DC2626]">{error}</div>}
          <div className="mt-8 pt-8 border-t border-[#0B1E3F]/10">
            <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-4">Try a sample</div>
            <div className="flex flex-wrap gap-2">
              {['MC-847291', 'MC-226104', 'MC-498732', 'Summit Logistics'].map((s) => (
                <button key={s} onClick={() => { setInput(s); runLookup(s); }} className="px-3 py-1.5 bg-[#0B1E3F]/5 hover:bg-[#0B1E3F]/10 rounded-full text-sm font-medium mono text-[#0B1E3F]/80 transition">{s}</button>
              ))}
            </div>
          </div>
        </div>
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
  const rescanQuery = r.mc || r.dot;
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

  const onWatch = async () => {
    if (watching === 'saving' || !r?.name || (!r.mc && !r.dot)) return;
    setWatching('saving');
    try {
      const res = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(r),
      });
      if (res.ok) invalidateCache('watchlist', 'usage');
      setWatching(res.ok ? 'saved' : 'error');
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
            {r.source === 'mock' && (
              <div className="mt-2 p-3 bg-[#F59E0B]/10 border border-[#F59E0B]/30 rounded-lg text-xs text-[#0B1E3F] max-w-xl">
                {(r.flags || []).some((f: any) => /FMCSA (lookup failed|temporarily)/i.test(f.title)) ? (
                  <>
                    <div className="font-semibold text-[#F59E0B] mb-1 mono uppercase tracking-wider text-[10px]">FMCSA unavailable</div>
                    <div>Identity fields (name, MC, DOT) show what Claude pulled from your PDF. Authority status, insurance, crash history, and fleet size below are placeholder demo values — retry in a minute to get FMCSA&apos;s real data.</div>
                  </>
                ) : (
                  <>Demo data — set FMCSA_WEB_KEY in .env.local for live lookups.</>
                )}
              </div>
            )}
            {r.cached && (
              <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 bg-[#0B1E3F]/5 border border-[#0B1E3F]/10 rounded-full text-xs text-[#0B1E3F]/70">
                <Clock className="w-3.5 h-3.5" /> Cached from {r.cachedAt ? timeAgo(r.cachedAt) : 'earlier'} · no credit used
              </div>
            )}
            {rescanError && <div className="mt-2 text-sm text-[#DC2626]">{rescanError}</div>}
          </div>
          <div className="flex gap-2">
            <button className="px-4 py-2 border border-[#0B1E3F]/15 bg-white rounded-full text-sm font-medium text-[#0B1E3F] hover:bg-[#0B1E3F]/5 transition flex items-center gap-2"><Share2 className="w-4 h-4" /> Share</button>
            <button className="px-4 py-2 border border-[#0B1E3F]/15 bg-white rounded-full text-sm font-medium text-[#0B1E3F] hover:bg-[#0B1E3F]/5 transition flex items-center gap-2"><Download className="w-4 h-4" /> Export PDF</button>
            <button onClick={onRescan} disabled={!rescanQuery || rescanning} className="px-4 py-2 border border-[#0B1E3F]/15 bg-white rounded-full text-sm font-medium text-[#0B1E3F] hover:bg-[#0B1E3F]/5 transition flex items-center gap-2 disabled:opacity-50" title="Runs a fresh FMCSA lookup — uses 1 credit">
              {rescanning ? <><div className="w-3.5 h-3.5 border-2 border-[#0B1E3F]/30 border-t-[#0B1E3F] rounded-full animate-spin" /> Scanning…</> : <><Search className="w-4 h-4" /> Scan again</>}
            </button>
            <button onClick={() => setReportOpen(true)} disabled={!r.mc && !r.dot} className="px-4 py-2 border border-[#DC2626]/30 bg-white rounded-full text-sm font-medium text-[#DC2626] hover:bg-[#DC2626]/5 transition flex items-center gap-2 disabled:opacity-50"><Flag className="w-4 h-4" /> Report fraud</button>
            <button onClick={onWatch} disabled={watching === 'saving' || watching === 'saved' || (!r.mc && !r.dot)} className={`px-4 py-2 rounded-full text-sm font-medium transition flex items-center gap-2 disabled:opacity-60 ${watching === 'saved' ? 'bg-[#16A34A] text-white' : 'bg-[#0B1E3F] text-white hover:bg-[#0B1E3F]/90'}`}><Eye className="w-4 h-4" /> {watching === 'saving' ? 'Saving…' : watching === 'saved' ? 'Watching' : watching === 'error' ? 'Error — retry' : 'Watch'}</button>
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
      {(r.crashTotal != null || r.drivers != null || r.vehicleOosRate != null) && (
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
      )}
      {r.webPresence?.configured && (
        <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-8 card-shadow text-[#0B1E3F]">
          <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
            <div>
              <h2 className="text-xl font-semibold text-[#0B1E3F]">Web presence</h2>
              <div className="text-sm text-[#0B1E3F]/60 mt-1">Carrier website found via Google + checked for legitimacy.</div>
            </div>
            {r.webPresence.found ? (
              <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold ${r.webPresence.nameMatch ? 'bg-[#16A34A]/10 text-[#16A34A]' : 'bg-[#F59E0B]/10 text-[#F59E0B]'}`}>
                {r.webPresence.nameMatch ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                {r.webPresence.nameMatch ? 'Website found · name matches' : 'Website found · name mismatch'}
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
                <div className="mt-4 p-4 bg-[#0B1E3F]/[0.03] rounded-lg text-sm text-[#0B1E3F]/75 italic leading-relaxed">&ldquo;{r.webPresence.snippet}&rdquo;</div>
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
              <div className="text-sm mono text-[#0B1E3F]/60 mt-1">{r.domain.domain}{r.domain.whois?.registrar ? ` · ${r.domain.whois.registrar}` : ''}</div>
            </div>
            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap ${r.domain.verdict === 'high' ? 'bg-[#DC2626]/10 text-[#DC2626]' : r.domain.verdict === 'medium' ? 'bg-[#F59E0B]/10 text-[#F59E0B]' : r.domain.verdict === 'low' ? 'bg-[#16A34A]/10 text-[#16A34A]' : 'bg-[#0B1E3F]/10 text-[#0B1E3F]'}`}>
              {r.domain.verdict === 'high' ? 'HIGH RISK' : r.domain.verdict === 'medium' ? 'CAUTION' : r.domain.verdict === 'low' ? 'LOW RISK' : 'UNKNOWN'} · {r.domain.score}/100
            </div>
          </div>
          <div className="grid md:grid-cols-3 gap-4 mb-6">
            <div className="p-4 bg-[#0B1E3F]/5 rounded-xl">
              <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-1">Domain age</div>
              <div className="text-lg font-semibold text-[#0B1E3F]">{r.domain.whois?.ageDays != null ? (r.domain.whois.ageDays < 365 ? `${r.domain.whois.ageDays} days` : `${(r.domain.whois.ageDays / 365).toFixed(1)} years`) : '—'}</div>
              {r.domain.whois?.creationDate && <div className="text-xs text-[#0B1E3F]/50 mt-1">Registered {new Date(r.domain.whois.creationDate).toLocaleDateString()}</div>}
            </div>
            <div className="p-4 bg-[#0B1E3F]/5 rounded-xl">
              <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-1">MX records</div>
              <div className={`text-lg font-semibold ${r.domain.mx?.hasMx ? 'text-[#16A34A]' : 'text-[#DC2626]'}`}>{r.domain.mx?.hasMx ? 'Present' : 'None'}</div>
              <div className="text-xs text-[#0B1E3F]/50 mt-1">{r.domain.mx?.hasMx ? `${r.domain.mx.records?.length || 0} mail server${(r.domain.mx.records?.length || 0) === 1 ? '' : 's'}` : 'Cannot receive email'}</div>
            </div>
            <div className="p-4 bg-[#0B1E3F]/5 rounded-xl">
              <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-1">SPF record</div>
              <div className={`text-lg font-semibold ${r.domain.spf?.hasSpf ? 'text-[#16A34A]' : 'text-[#0B1E3F]/60'}`}>{r.domain.spf?.hasSpf ? 'Configured' : 'Not set'}</div>
              <div className="text-xs text-[#0B1E3F]/50 mt-1">{r.domain.spf?.hasSpf ? 'Anti-spoofing in place' : 'No sender policy'}</div>
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
    </>
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
          description: description.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Failed (${res.status})`);
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
            <label className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 block mb-2">What happened? (optional)</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} maxLength={2000} placeholder="Brief description of what happened. Other carriers will see this." className="w-full px-4 py-3 bg-white border border-[#0B1E3F]/15 rounded-xl text-[#0B1E3F] focus:outline-none focus:border-[#0B1E3F] placeholder:text-[#0B1E3F]/30 resize-none" />
          </div>
          {error && <div className="text-sm text-[#DC2626]">{error}</div>}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-3 border border-[#0B1E3F]/15 rounded-full font-medium text-[#0B1E3F] hover:bg-[#0B1E3F]/5">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 py-3 bg-[#DC2626] text-white rounded-full font-medium hover:bg-[#DC2626]/90 transition disabled:opacity-60">{saving ? 'Submitting…' : 'Submit report'}</button>
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

function SearchHistory({ navigate }: any) {
  const res = useCachedFetch<{ lookups: any[] }>('lookups:200', '/api/lookups?limit=200');
  const items = res.data?.lookups ?? null;
  const [filter, setFilter] = useState('');
  const [rescanId, setRescanId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onDelete = async (id: string) => {
    if (!window.confirm('Remove this lookup from your history? This does not restore your monthly quota.')) return;
    setDeletingId(id); setError(null);
    try {
      const r = await fetch(`/api/lookups?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error || `Delete failed (${r.status})`);
      invalidateCache('lookups:200');
      res.refetch();
    } catch (err: any) {
      setError(err?.message || 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  const onRescan = async (l: any) => {
    setRescanId(l.id); setError(null);
    const q = (l.query || l.mc || l.dot || '').trim();
    const e = (l.email_query || '').trim();
    if (!q) { setError('Saved query is empty — open the report and re-run from Verify.'); setRescanId(null); return; }
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
      if (!data?.cached) {
        fetch('/api/lookups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(merged) })
          .then(() => invalidateCache('lookups:200', 'usage', 'alerts')).catch(() => {});
        if (data?.verdict === 'high') {
          fetch('/api/email/high-risk-alert', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ report: data }) }).catch(() => {});
        }
      }
      navigate('report', merged);
    } catch (err: any) {
      setError(err?.message || 'Re-scan failed');
    } finally {
      setRescanId(null);
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
        <button onClick={() => navigate('verify')} className="px-5 py-2.5 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90 flex items-center gap-2 card-shadow"><Search className="w-4 h-4" /> New lookup</button>
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
            {groups.map((g) => <HistoryGroup key={g.key} group={g} navigate={navigate} onRescan={onRescan} rescanId={rescanId} onDelete={onDelete} deletingId={deletingId} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryGroup({ group, navigate, onRescan, rescanId, onDelete, deletingId }: any) {
  const [open, setOpen] = useState(false);
  const l = group.latest;
  const verdict = l.verdict || (l.score >= 61 ? 'high' : l.score >= 31 ? 'medium' : 'low');
  const count = group.rows.length;
  return (
    <div className="text-[#0B1E3F]">
      <div className="flex items-center gap-4 p-4 md:p-5 hover:bg-[#0B1E3F]/5 transition">
        <button onClick={() => navigate('report', l.data)} className={`w-12 h-12 rounded-full flex items-center justify-center mono font-semibold flex-shrink-0 transition ${verdict === 'high' ? 'bg-[#DC2626]/10 text-[#DC2626]' : verdict === 'medium' ? 'bg-[#F59E0B]/10 text-[#F59E0B]' : 'bg-[#16A34A]/10 text-[#16A34A]'}`}>{l.score}</button>
        <button onClick={() => navigate('report', l.data)} className="flex-1 min-w-0 text-left">
          <div className="font-semibold text-[#0B1E3F] truncate">{l.name}</div>
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
          <button onClick={() => onDelete(l.id)} disabled={deletingId === l.id} className="w-8 h-8 flex items-center justify-center rounded-full text-[#0B1E3F]/50 hover:bg-[#DC2626]/10 hover:text-[#DC2626] transition disabled:opacity-60" title="Remove from history (does not restore monthly quota)">
            {deletingId === l.id ? <div className="w-3 h-3 border border-[#DC2626]/40 border-t-[#DC2626] rounded-full animate-spin" /> : <Trash2 className="w-4 h-4" />}
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

  return (
    <div className="space-y-8 text-[#0B1E3F]">
      <div>
        <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-2">Alerts</div>
        <h1 className="text-4xl serif italic text-[#0B1E3F]">Recent risk signals from your lookups.</h1>
      </div>
      {alerts == null ? (
        <div className="py-12 text-center text-sm text-[#0B1E3F]/50">Loading…</div>
      ) : alerts.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 p-16 text-center text-[#0B1E3F]/60 card-shadow">
          <Bell className="w-12 h-12 mx-auto mb-4 text-[#0B1E3F]/30" />
          <div className="text-lg font-medium text-[#0B1E3F] mb-2">No alerts yet</div>
          <div className="text-sm mb-6">Alerts show up when a broker lookup returns HIGH or CAUTION in the past 7 days.</div>
          <button onClick={() => navigate('verify')} className="px-5 py-2.5 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90">Verify a broker</button>
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((a: any) => {
            const sev = a.verdict === 'high' ? 'critical' : 'warning';
            const topFlag = (a.data?.flags || [])[0];
            return (
              <button key={a.id} onClick={() => navigate('report', a.data)} className="w-full text-left flex items-start gap-4 p-5 bg-white rounded-2xl border border-[#0B1E3F]/10 hover:border-[#0B1E3F]/20 card-shadow transition text-[#0B1E3F]">
                <div className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${sev === 'critical' ? 'bg-[#DC2626]' : 'bg-[#F59E0B]'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${a.verdict === 'high' ? 'bg-[#DC2626]/10 text-[#DC2626]' : 'bg-[#F59E0B]/10 text-[#F59E0B]'}`}>{a.verdict === 'high' ? 'HIGH RISK' : 'CAUTION'}</span>
                    <span className="text-xs mono text-[#0B1E3F]/50">· {timeAgo(a.created_at)}</span>
                  </div>
                  <div className="font-semibold text-[#0B1E3F] truncate">{a.name}</div>
                  <div className="text-sm mono text-[#0B1E3F]/50 mb-2">{[a.mc && `MC-${a.mc}`, a.dot && `DOT-${a.dot}`].filter(Boolean).join(' · ') || 'No ID'}</div>
                  {topFlag && <div className="text-sm text-[#0B1E3F]/75">{topFlag.title} — {topFlag.desc}</div>}
                </div>
                <div className={`mono text-lg font-semibold ${a.verdict === 'high' ? 'text-[#DC2626]' : 'text-[#F59E0B]'}`}>{a.score}</div>
              </button>
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

function NotificationsTab({ user }: any) {
  const [notifEmail, setNotifEmail] = useState<string>(user?.notificationEmail || '');
  const [watchlist, setWatchlist] = useState<boolean>(user?.notifyWatchlist !== false);
  const [digest, setDigest] = useState<boolean>(user?.notifyWeeklyDigest !== false);
  const [community, setCommunity] = useState<boolean>(user?.notifyCommunity !== false);
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
        notify_watchlist: watchlist,
        notify_weekly_digest: digest,
        notify_community: community,
      },
    });
    setSaving(false);
    if (err) setError(err.message);
    else setInfo('Notification preferences saved.');
  };

  const deliveryEmail = notifEmail.trim() || user?.email || '';

  return (
    <div>
      <h2 className="text-xl font-semibold text-[#0B1E3F] mb-6">Notifications</h2>

      <div className="mb-6">
        <label className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 block mb-2">Notification email <span className="normal-case tracking-normal text-[#0B1E3F]/40">(optional)</span></label>
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
            ? <>Alerts will go to <span className="mono text-[#0B1E3F]">{deliveryEmail}</span></>
            : <>Leave empty to use your profile email: <span className="mono text-[#0B1E3F]">{user?.email}</span></>}
        </div>
      </div>

      <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/60 mb-3">What to notify me about</div>
      <div className="space-y-2 mb-6">
        <label className="flex items-center gap-3 p-4 bg-[#0B1E3F]/5 rounded-xl cursor-pointer hover:bg-[#0B1E3F]/10 transition text-[#0B1E3F]">
          <input type="checkbox" checked={watchlist} onChange={(e) => setWatchlist(e.target.checked)} className="w-4 h-4 rounded" />
          <span className="text-sm">Email alerts for watchlist changes</span>
        </label>
        <label className="flex items-center gap-3 p-4 bg-[#0B1E3F]/5 rounded-xl cursor-pointer hover:bg-[#0B1E3F]/10 transition text-[#0B1E3F]">
          <input type="checkbox" checked={digest} onChange={(e) => setDigest(e.target.checked)} className="w-4 h-4 rounded" />
          <span className="text-sm">Weekly fraud report digest</span>
        </label>
        <label className="flex items-center gap-3 p-4 bg-[#0B1E3F]/5 rounded-xl cursor-pointer hover:bg-[#0B1E3F]/10 transition text-[#0B1E3F]">
          <input type="checkbox" checked={community} onChange={(e) => setCommunity(e.target.checked)} className="w-4 h-4 rounded" />
          <span className="text-sm">New community report notifications</span>
        </label>
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

function BillingTab({ user, navigate, planId, plan, upgradeTarget }: any) {
  const isPaid = PAID_PLANS.has(planId);
  const memberSince = user?.createdAt ? new Date(user.createdAt) : null;
  const planSince = user?.planChangedAt ? new Date(user.planChangedAt) : memberSince;
  const fmt = (d: Date | null) => d ? d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '—';

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-[#0B1E3F]">Billing</h2>
        <div className="text-xs mono text-[#0B1E3F]/50">Account {user?.id ? `· ${String(user.id).slice(0, 8)}` : ''}</div>
      </div>

      {!isPaid && (
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

      {isPaid && user?.stripeCustomerId && (
        <div className="mb-6 p-5 bg-[#16A34A]/5 border border-[#16A34A]/25 rounded-xl">
          <div className="flex items-start gap-3 mb-3">
            <FileText className="w-5 h-5 text-[#16A34A] mt-0.5 flex-shrink-0" />
            <div>
              <div className="font-semibold text-[#0B1E3F] mb-1">Invoices &amp; payment method live in Stripe</div>
              <div className="text-sm text-[#0B1E3F]/70">
                Click below to open your secure Stripe billing portal — update your card, download every invoice,
                switch between monthly and annual, or cancel. You return here when you&apos;re done.
              </div>
            </div>
          </div>
          <BillingPortalButton />
        </div>
      )}

      {isPaid && !user?.stripeCustomerId && (
        <div className="mb-6 p-5 bg-[#F59E0B]/10 border border-[#F59E0B]/30 rounded-xl">
          <div className="flex items-start gap-3 mb-3">
            <AlertTriangle className="w-5 h-5 text-[#F59E0B] mt-0.5 flex-shrink-0" />
            <div>
              <div className="font-semibold text-[#0B1E3F] mb-1">Subscription not active yet</div>
              <div className="text-sm text-[#0B1E3F]/70">
                Your plan is set to <strong>{plan?.label}</strong> in your profile, but you haven&apos;t completed Stripe checkout yet — so there&apos;s no invoice or billing history to show. Complete checkout to activate billing.
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
      setCheckoutSuccess({ promo: params.get('promo') });
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

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
