'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, Building2, CheckCircle2, Clock, FileText, Flag, MessageSquare, Search, ShieldCheck, Truck, Upload, UserCheck, X,
} from 'lucide-react';
import {
  DESCRIPTION_MAX, DESCRIPTION_MIN, EVIDENCE_MAX_FILES, REPORT_RULES, RESPONSE_MAX, ROLE_LABEL,
  allowedSubjects, categoriesFor,
  type PublicReport, type ReporterRole, type SubjectType,
} from '@/lib/reports';

// Verified reports: carriers report brokers, brokers report carriers, drivers
// report the companies they hauled for, shippers report and can be reported.
// Free for every account. Rules live in lib/reports.ts.

const REPORT_SUBJECT_KEY = 'haulock:reportSubject';

const card = 'bg-white rounded-2xl border border-[#0B1E3F]/10 card-shadow text-[#0B1E3F]';
const label = 'text-xs mono uppercase tracking-wider text-[#0B1E3F]/60';
const input = 'w-full px-4 py-2.5 bg-white border border-[#0B1E3F]/20 rounded-xl text-sm text-[#0B1E3F] placeholder:text-[#0B1E3F]/35 focus:outline-none focus:border-[#0B1E3F]';
const btn = 'px-4 py-2 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90 disabled:opacity-60 transition';
const btnGhost = 'px-4 py-2 border border-[#0B1E3F]/15 rounded-full text-sm font-medium text-[#0B1E3F] hover:bg-[#0B1E3F]/5 disabled:opacity-60 transition';

function fmtDay(iso?: string | null): string {
  if (!iso) return '—';
  const t = Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }) : String(iso);
}
const usd = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const idLabel = (x: { mc?: string | null; dot?: string | null }) => [x.mc && `MC-${x.mc}`, x.dot && `DOT-${x.dot}`].filter(Boolean).join(' · ');

async function api(url: string, init?: RequestInit): Promise<any> {
  const r = await fetch(url, { cache: 'no-store', ...init });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw Object.assign(new Error(j.error || 'Something went wrong. Try again.'), { code: j.code, status: r.status });
  return j;
}

// Sends the user to the report form with this company filled in.
export function startReportAbout(navigate: any, subject: { mc?: string | null; dot?: string | null; name?: string | null; type?: SubjectType }) {
  try { sessionStorage.setItem(REPORT_SUBJECT_KEY, JSON.stringify(subject)); } catch {}
  navigate('reports');
}

// ---------- One report ----------

function ReportCard({ report, showSubject, onChanged }: { report: PublicReport; showSubject: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState(report.response?.body || '');
  const [disputes, setDisputes] = useState(Boolean(report.response?.disputes));

  const act = async (action: string, extra: any = {}) => {
    setBusy(action); setError(null);
    try {
      await api(`/api/reports/${report.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }) });
      setReplying(false);
      onChanged();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const status = report.status !== 'published'
    ? { pending: { text: 'Waiting for review', cls: 'bg-[#F59E0B]/15 text-[#B45309]' }, rejected: { text: 'Not published', cls: 'bg-[#0B1E3F]/[0.06] text-[#0B1E3F]/60' }, withdrawn: { text: 'Withdrawn', cls: 'bg-[#0B1E3F]/[0.06] text-[#0B1E3F]/60' } }[report.status as 'pending' | 'rejected' | 'withdrawn']
    : report.resolvedAt
      ? { text: `Resolved ${fmtDay(report.resolvedAt)}`, cls: 'bg-[#16A34A]/10 text-[#16A34A]' }
      : report.response?.disputes
        ? { text: 'Disputed', cls: 'bg-[#F59E0B]/15 text-[#B45309]' }
        : null;

  return (
    <div className={`${card} p-6`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-[#DC2626]/10 flex items-center justify-center shrink-0">
            <Flag className="w-5 h-5 text-[#DC2626]" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-[#0B1E3F]">{report.categoryLabel}{report.amount != null ? ` · ${usd(report.amount)}` : ''}</div>
            {showSubject && (
              <div className="text-sm text-[#0B1E3F]/75 mt-0.5">
                About <span className="font-medium text-[#0B1E3F]">{report.subject.name}</span>
                <span className="text-[#0B1E3F]/50"> · {report.subject.type}{idLabel(report.subject) ? ` · ${idLabel(report.subject)}` : report.subject.city ? ` · ${report.subject.city}, ${report.subject.state}` : ''}</span>
              </div>
            )}
            <div className="text-xs mono text-[#0B1E3F]/50 mt-1">Load {report.loadRef} · happened {fmtDay(report.incidentDate)} · {report.publishedAt ? `published ${fmtDay(report.publishedAt)}` : `filed ${fmtDay(report.createdAt)}`}</div>
          </div>
        </div>
        {status && <span className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] mono uppercase tracking-wider ${status.cls}`}>{status.text}</span>}
      </div>

      <p className="mt-4 text-sm text-[#0B1E3F]/80 leading-relaxed whitespace-pre-line">{report.description}</p>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[#0B1E3F]/60">
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-[#16A34A]" />
          {report.reporter.anonymous && !report.mine
            ? <>Reported by a <span className="font-medium text-[#0B1E3F]">verified driver</span> <span className="text-[#0B1E3F]/45">· name withheld, identity verified by Haulock</span></>
            : <>Reported by <span className="font-medium text-[#0B1E3F]">{report.reporter.name}</span> · verified {ROLE_LABEL[report.reporter.role].toLowerCase()}{idLabel(report.reporter) ? ` · ${idLabel(report.reporter)}` : ''}{report.reporter.anonymous ? <span className="text-[#0B1E3F]/45"> · shown to others as “Verified driver”</span> : null}</>}
        </span>
        <span className="inline-flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> {report.documents} supporting document{report.documents === 1 ? '' : 's'} on file</span>
      </div>

      {report.mine && report.status === 'rejected' && report.rejectReason && (
        <div className="mt-4 text-sm bg-[#0B1E3F]/[0.04] border border-[#0B1E3F]/10 rounded-xl px-4 py-3"><span className="font-medium">Why it wasn&apos;t published:</span> {report.rejectReason}</div>
      )}

      {report.response && !replying && (
        <div className="mt-4 rounded-xl bg-[#F5F3EE] border border-[#0B1E3F]/10 p-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className={label}>Reply from {report.response.name}</span>
            <span className="text-[11px] mono text-[#0B1E3F]/45">{fmtDay(report.response.at)}</span>
          </div>
          <p className="text-sm text-[#0B1E3F]/80 mt-2 leading-relaxed whitespace-pre-line">{report.response.body}</p>
        </div>
      )}

      {replying && (
        <div className="mt-4 rounded-xl bg-[#F5F3EE] border border-[#0B1E3F]/10 p-4">
          <div className={label}>Your company&apos;s public reply</div>
          <textarea value={reply} onChange={(e) => setReply(e.target.value.slice(0, RESPONSE_MAX))} rows={4} placeholder="What happened from your side: dates, amounts, what was paid or agreed." className={`${input} mt-2`} />
          <label className="mt-2 flex items-center gap-2 text-sm text-[#0B1E3F]/75">
            <input type="checkbox" checked={disputes} onChange={(e) => setDisputes(e.target.checked)} /> We dispute this report (it will be labeled “Disputed”)
          </label>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button className={btn} disabled={busy !== null || reply.trim().length < 20} onClick={() => act('respond', { body: reply, disputes })}>{busy === 'respond' ? 'Posting…' : 'Post reply'}</button>
            <button className={btnGhost} onClick={() => { setReplying(false); setError(null); }}>Cancel</button>
            <span className="text-xs text-[#0B1E3F]/45">{reply.length} / {RESPONSE_MAX}</span>
          </div>
        </div>
      )}

      {error && <div className="mt-3 text-sm text-[#DC2626]">{error}</div>}

      {(report.status === 'published' || report.mine) && (
        <div className="mt-4 pt-4 border-t border-[#0B1E3F]/5 flex flex-wrap items-center gap-2">
          {report.status === 'published' && !report.mine && !replying && (
            <button className={btnGhost} onClick={() => setReplying(true)}><MessageSquare className="w-3.5 h-3.5 inline -mt-0.5 mr-1.5" />{report.response ? 'Edit our reply' : 'This is my company: reply'}</button>
          )}
          {report.mine && report.status === 'published' && !report.resolvedAt && (
            <button className={btnGhost} disabled={busy !== null} onClick={() => act('resolve')}>{busy === 'resolve' ? 'Saving…' : 'Mark resolved'}</button>
          )}
          {report.mine && (report.status === 'published' || report.status === 'pending') && (
            <button className="px-4 py-2 text-sm text-[#0B1E3F]/55 hover:text-[#DC2626] transition" disabled={busy !== null} onClick={() => { if (window.confirm('Withdraw this report? It will no longer be shown or counted.')) act('withdraw'); }}>{busy === 'withdraw' ? 'Withdrawing…' : 'Withdraw'}</button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Reports on a company's Haulock report ----------

export function CompanyReportsSection({ r, navigate }: { r: any; navigate: any }) {
  const [data, setData] = useState<{ reports: PublicReport[]; score: any; unavailable?: boolean } | null>(null);
  const [failed, setFailed] = useState(false);
  const mc = r?.mc || '';
  const dot = r?.dot || '';
  const load = useCallback(async () => {
    if (!mc && !dot) return;
    try {
      const qs = new URLSearchParams();
      if (mc) qs.set('mc', mc);
      if (dot) qs.set('dot', dot);
      setData(await api(`/api/reports?${qs.toString()}`));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [mc, dot]);
  useEffect(() => { setData(null); load(); }, [load]);
  if (!mc && !dot) return null;

  const reports = data?.reports || [];
  const isBroker = r.brokerAuthority === 'Active' && r.commonAuthority !== 'Active' && r.contractAuthority !== 'Active';
  return (
    <div className={`${card} p-8`}>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div>
          <h2 className="text-xl font-semibold text-[#0B1E3F]">Reports from verified users</h2>
          <div className="text-sm text-[#0B1E3F]/60 mt-1 max-w-2xl">
            Filed by verified carriers, brokers, drivers and shippers, one load each, with documents. They are the reporters&apos; statements, not findings by Haulock; the company can reply under each one.
          </div>
        </div>
        <button className={btn} onClick={() => startReportAbout(navigate, { mc, dot, name: r.name, type: isBroker ? 'broker' : undefined })}>
          <Flag className="w-3.5 h-3.5 inline -mt-0.5 mr-1.5" /> Report this company
        </button>
      </div>
      {failed || data?.unavailable ? (
        <div className="text-sm text-[#0B1E3F]/60">Reports couldn&apos;t be loaded right now.</div>
      ) : !data ? (
        <div className="text-sm text-[#0B1E3F]/50">Loading reports…</div>
      ) : reports.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-[#0B1E3F]/70"><CheckCircle2 className="w-4 h-4 text-[#16A34A]" /> No reports on record for this company.</div>
      ) : (
        <div className="space-y-4">
          {data.score && (
            <div className="text-xs mono text-[#0B1E3F]/55">
              {data.score.published} published · {data.score.open} open · {data.score.resolved} resolved · from {data.score.reporters} reporter{data.score.reporters === 1 ? '' : 's'} · adds {data.score.points} point{data.score.points === 1 ? '' : 's'} to the score
            </div>
          )}
          {reports.map((rep) => <ReportCard key={rep.id} report={rep} showSubject={false} onChanged={load} />)}
        </div>
      )}
    </div>
  );
}

// ---------- Who you can report as ----------

type Me = {
  configured: boolean;
  email: string;
  company: { mc: string | null; dot: string | null; name: string; roles: ReporterRole[]; lookupFailed?: boolean } | null;
  driver: { name: string; state?: string | null } | null;
  shipper: { company: string; domain: string } | null;
  claimedCompany: { mc: string | null; dot: string | null } | null;
  driverCheckAvailable: boolean;
};

function ReporterSetup({ me, reload, navigate }: { me: Me; reload: () => Promise<void>; navigate: any }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ where: string; tone: 'ok' | 'err'; text: string } | null>(null);
  const [emailOnFile, setEmailOnFile] = useState<string | null>(null);
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [shipCompany, setShipCompany] = useState('');
  const [shipSite, setShipSite] = useState('');

  const company = async (body: any) => {
    setBusy(body.action); setMsg(null);
    try {
      const r = await fetch('/api/profile/company', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (j.emailOnFile) setEmailOnFile(j.emailOnFile);
      if (!r.ok || j.ok === false) throw new Error(j.error || 'Something went wrong');
      if (body.action === 'send_code') { setCodeSentTo(j.sentTo); setCode(''); setMsg({ where: 'company', tone: 'ok', text: `Code sent to ${j.sentTo}. It expires in 30 minutes.` }); return; }
      setCodeSentTo(null);
      await reload();
    } catch (e: any) {
      setMsg({ where: 'company', tone: 'err', text: e.message });
    } finally {
      setBusy(null);
    }
  };
  const driverStart = async () => {
    setBusy('driver'); setMsg(null);
    try {
      const j = await api('/api/reports/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'driver', action: 'start' }) });
      window.location.href = j.url;
    } catch (e: any) {
      setMsg({ where: 'driver', tone: 'err', text: e.message });
      setBusy(null);
    }
  };
  const shipper = async () => {
    setBusy('shipper'); setMsg(null);
    try {
      await api('/api/reports/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'shipper', company: shipCompany, website: shipSite }) });
      await reload();
    } catch (e: any) {
      setMsg({ where: 'shipper', tone: 'err', text: e.message });
    } finally {
      setBusy(null);
    }
  };
  const note = (where: string) => msg?.where === where ? <div className={`mt-2 text-sm ${msg.tone === 'ok' ? 'text-[#16A34A]' : 'text-[#DC2626]'}`}>{msg.text}</div> : null;
  const verified = (text: React.ReactNode) => <div className="mt-2 flex items-start gap-2 text-sm text-[#0B1E3F]"><CheckCircle2 className="w-4 h-4 text-[#16A34A] mt-0.5 shrink-0" /><span>{text}</span></div>;

  return (
    <div className="grid md:grid-cols-3 gap-4">
      {/* Carrier / broker */}
      <div className={`${card} p-5`}>
        <div className="flex items-center gap-2"><Building2 className="w-4 h-4 text-[#0B1E3F]/60" /><span className="font-semibold">Carrier or broker</span></div>
        {me.company ? (
          <>
            {verified(<><span className="font-medium">{me.company.name}</span> <span className="text-[#0B1E3F]/55">· {idLabel(me.company)}</span></>)}
            <div className="mt-1 text-xs text-[#0B1E3F]/55">
              {me.company.roles.length ? `Can report as a ${me.company.roles.join(' or a ')}.` : me.company.lookupFailed ? 'FMCSA’s records didn’t answer just now; try again in a minute.' : 'FMCSA shows no active carrier or broker authority, so this company can’t file reports. It can still reply to them.'}
            </div>
          </>
        ) : me.claimedCompany ? (
          <>
            <p className="mt-2 text-sm text-[#0B1E3F]/70">Confirm {idLabel(me.claimedCompany)} is yours: sign in with an email on the company&apos;s domain, or get a code at the email on its FMCSA filing.</p>
            {codeSentTo ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code" className="w-32 px-3 py-2 border border-[#0B1E3F]/20 rounded-full text-sm mono tracking-widest focus:outline-none focus:border-[#0B1E3F]" />
                <button className={btn} disabled={busy !== null || code.length !== 6} onClick={() => company({ action: 'confirm_code', code })}>{busy === 'confirm_code' ? 'Checking…' : 'Confirm'}</button>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button className={btn} disabled={busy !== null} onClick={() => company({ action: 'verify' })}>{busy === 'verify' ? 'Checking FMCSA…' : 'Verify my company'}</button>
                <button className={btnGhost} disabled={busy !== null} onClick={() => company({ action: 'send_code' })}>{busy === 'send_code' ? 'Sending…' : emailOnFile ? `Email a code to ${emailOnFile}` : 'Email me a code'}</button>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-[#0B1E3F]/70">Add your company&apos;s MC or DOT number to your profile, then confirm it&apos;s yours with the email on its FMCSA filing.</p>
            <button className={`${btn} mt-3`} onClick={() => navigate('settings', { tab: 'profile' })}>Add my MC / DOT</button>
          </>
        )}
        {note('company')}
      </div>

      {/* Driver */}
      <div className={`${card} p-5`}>
        <div className="flex items-center gap-2"><Truck className="w-4 h-4 text-[#0B1E3F]/60" /><span className="font-semibold">Driver</span></div>
        {me.driver ? (
          verified(<><span className="font-medium">{me.driver.name}</span>{me.driver.state ? <span className="text-[#0B1E3F]/55"> · {me.driver.state}</span> : null} <span className="text-[#0B1E3F]/55">· ID checked</span></>)
        ) : (
          <>
            <p className="mt-2 text-sm text-[#0B1E3F]/70">A quick ID check: a photo of your driver&apos;s license and a selfie, on your phone. Your name shows on reports you file; the photos stay with the ID service, not Haulock.</p>
            <button className={`${btn} mt-3`} disabled={busy !== null || !me.driverCheckAvailable} onClick={driverStart}>{busy === 'driver' ? 'Opening…' : 'Verify with my license'}</button>
            {!me.driverCheckAvailable && <div className="mt-2 text-xs text-[#0B1E3F]/50">ID checks aren&apos;t switched on yet.</div>}
          </>
        )}
        {note('driver')}
      </div>

      {/* Shipper */}
      <div className={`${card} p-5`}>
        <div className="flex items-center gap-2"><UserCheck className="w-4 h-4 text-[#0B1E3F]/60" /><span className="font-semibold">Shipper</span></div>
        {me.shipper ? (
          verified(<><span className="font-medium">{me.shipper.company}</span> <span className="text-[#0B1E3F]/55">· {me.shipper.domain}</span></>)
        ) : (
          <>
            <p className="mt-2 text-sm text-[#0B1E3F]/70">You&apos;re signed in as {me.email}. That email has to be on your company&apos;s own website domain.</p>
            <div className="mt-3 space-y-2">
              <input className={input} placeholder="Company name" value={shipCompany} onChange={(e) => setShipCompany(e.target.value)} />
              <input className={input} placeholder="Company website, e.g. acmefoods.com" value={shipSite} onChange={(e) => setShipSite(e.target.value)} />
              <button className={btn} disabled={busy !== null || !shipCompany.trim() || !shipSite.trim()} onClick={shipper}>{busy === 'shipper' ? 'Checking…' : 'Verify my company'}</button>
            </div>
          </>
        )}
        {note('shipper')}
      </div>
    </div>
  );
}

// ---------- File a report ----------

type Picked = { mc?: string | null; dot?: string | null; name: string; city?: string; state?: string };

function CompanyPicker({ value, onPick }: { value: Picked | null; onPick: (p: Picked | null) => void }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    const query = q.trim();
    if (query.length < 3) { setList([]); return; }
    const mine = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const j = await api(`/api/search/suggest?q=${encodeURIComponent(query)}`);
        if (seq.current === mine) setList(j.suggestions || []);
      } catch {
        if (seq.current === mine) setList([]);
      } finally {
        if (seq.current === mine) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-[#F5F3EE] border border-[#0B1E3F]/10">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[#0B1E3F] truncate">{value.name}</div>
          <div className="text-xs mono text-[#0B1E3F]/55">{idLabel(value)}{value.city ? ` · ${value.city}, ${value.state}` : ''}</div>
        </div>
        <button type="button" aria-label="Choose a different company" className="text-[#0B1E3F]/50 hover:text-[#0B1E3F]" onClick={() => { onPick(null); setQ(''); }}><X className="w-4 h-4" /></button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Search className="absolute left-3.5 top-3 w-4 h-4 text-[#0B1E3F]/40" />
      <input className={`${input} pl-10`} placeholder="MC, DOT or company name" value={q} onChange={(e) => setQ(e.target.value)} />
      {(list.length > 0 || loading) && (
        <div className="absolute z-10 mt-1 w-full bg-white border border-[#0B1E3F]/15 rounded-xl card-shadow-lg overflow-hidden">
          {loading && list.length === 0 && <div className="px-4 py-3 text-sm text-[#0B1E3F]/50">Searching FMCSA…</div>}
          {list.slice(0, 6).map((s) => (
            <button type="button" key={s.query} className="w-full text-left px-4 py-2.5 hover:bg-[#0B1E3F]/5 border-b border-[#0B1E3F]/5 last:border-0" onClick={() => { onPick({ mc: s.mc || null, dot: s.dot || null, name: s.name, city: s.city, state: s.state }); setList([]); }}>
              <div className="text-sm font-medium text-[#0B1E3F]">{s.name}</div>
              <div className="text-xs mono text-[#0B1E3F]/55">{idLabel(s)}{s.city ? ` · ${s.city}, ${s.state}` : ''} · {s.role === 'both' ? 'carrier + broker' : s.role === 'dot-only' ? 'USDOT only' : s.role}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ReportForm({ me, onFiled }: { me: Me; onFiled: () => void }) {
  const roles: ReporterRole[] = [...(me.company?.roles || []), ...(me.driver ? ['driver' as const] : []), ...(me.shipper ? ['shipper' as const] : [])];
  const [role, setRole] = useState<ReporterRole | ''>(roles.length === 1 ? roles[0] : '');
  const [subjectType, setSubjectType] = useState<SubjectType | ''>('');
  const [picked, setPicked] = useState<Picked | null>(null);
  const [shipper, setShipper] = useState({ name: '', city: '', state: '' });
  const [category, setCategory] = useState('');
  const [loadRef, setLoadRef] = useState('');
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [proofFiles, setProofFiles] = useState<File[]>([]);
  const [anonymous, setAnonymous] = useState(false);
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // A company handed over by "Report this company" (its Haulock report, or
  // the search on the Reports page). Until the reporter is verified there is
  // no form to fill, so the company waits and is only named.
  const [waiting, setWaiting] = useState<string | null>(null);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(REPORT_SUBJECT_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (roles.length === 0) { setWaiting(s?.name || idLabel(s || {}) || null); return; }
      sessionStorage.removeItem(REPORT_SUBJECT_KEY);
      if (s?.mc || s?.dot) setPicked({ mc: s.mc || null, dot: s.dot || null, name: s.name || idLabel(s) });
      if (s?.type) setSubjectType(s.type);
      if (s?.type === 'shipper' && s?.name) setShipper({ name: String(s.name), city: String(s.city || ''), state: String(s.state || '').toUpperCase().slice(0, 2) });
    } catch {}
  }, []);

  const subjects = role ? allowedSubjects(role) : [];
  useEffect(() => { if (subjectType && !subjects.includes(subjectType)) setSubjectType(''); }, [role]); // eslint-disable-line react-hooks/exhaustive-deps
  const cats = role && subjectType ? categoriesFor(role, subjectType) : [];
  const cat = cats.find((c) => c.id === category);
  useEffect(() => { if (category && !cats.some((c) => c.id === category)) setCategory(''); }, [role, subjectType]); // eslint-disable-line react-hooks/exhaustive-deps

  const reporterName = role === 'driver' ? me.driver?.name : role === 'shipper' ? me.shipper?.company : me.company?.name;
  const subjectLabel: Record<SubjectType, string> = { broker: 'The broker', carrier: 'The carrier', shipper: 'The shipper or receiver' };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!role) return setError('Choose who you’re reporting as.');
    if (!subjectType) return setError('Choose who you’re reporting.');
    if (subjectType !== 'shipper' && !picked) return setError('Search for the company and pick it from the list.');
    const fd = new FormData();
    fd.set('reporterRole', role);
    fd.set('subjectType', subjectType);
    if (subjectType === 'shipper') {
      fd.set('subjectName', shipper.name); fd.set('subjectCity', shipper.city); fd.set('subjectState', shipper.state);
    } else if (picked) {
      if (picked.mc) fd.set('subjectMc', picked.mc);
      if (picked.dot) fd.set('subjectDot', picked.dot);
    }
    fd.set('category', category);
    fd.set('loadRef', loadRef);
    fd.set('incidentDate', date);
    fd.set('amount', amount);
    fd.set('description', description);
    fd.set('attested', attested ? 'yes' : 'no');
    for (const f of files) fd.append('evidence', f);
    if (role === 'driver') {
      for (const f of proofFiles) fd.append('proof', f);
      fd.set('anonymous', anonymous ? 'yes' : 'no');
    }
    setBusy(true);
    try {
      await api('/api/reports', { method: 'POST', body: fd });
      setDone(true);
      onFiled();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (roles.length === 0) {
    return (
      <div className={`${card} p-6 text-sm text-[#0B1E3F]/70`}>
        {waiting && <div className="mb-2 text-[#0B1E3F]">Your report will be about <span className="font-semibold">{waiting}</span>.</div>}
        To file a report, verify who you are first: use one of the three options above. It&apos;s free and takes a couple of minutes.
      </div>
    );
  }
  if (done) {
    return (
      <div className={`${card} p-8 text-center`}>
        <CheckCircle2 className="w-10 h-10 text-[#16A34A] mx-auto" />
        <h3 className="text-xl font-semibold mt-3">Report received</h3>
        <p className="text-sm text-[#0B1E3F]/70 mt-2 max-w-md mx-auto">We check every report and its documents before it&apos;s shown, usually within one business day. You&apos;ll get an email either way, and you can follow it under My reports.</p>
        <button className={`${btnGhost} mt-5`} onClick={() => { setDone(false); setPicked(null); setCategory(''); setLoadRef(''); setDate(''); setAmount(''); setDescription(''); setFiles([]); setProofFiles([]); setAnonymous(false); setAttested(false); }}>File another report</button>
      </div>
    );
  }

  const field = (title: string, children: React.ReactNode, hint?: string) => (
    <div>
      <div className={`${label} mb-1.5`}>{title}</div>
      {children}
      {hint && <div className="text-xs text-[#0B1E3F]/50 mt-1">{hint}</div>}
    </div>
  );
  const chip = (active: boolean) => `px-4 py-2 rounded-full text-sm border transition ${active ? 'bg-[#0B1E3F] text-white border-[#0B1E3F]' : 'bg-white text-[#0B1E3F]/75 border-[#0B1E3F]/15 hover:border-[#0B1E3F]/40'}`;

  return (
    <form onSubmit={submit} className={`${card} p-6 md:p-8 space-y-6`}>
      <div>
        <h3 className="text-xl font-semibold">File a report</h3>
        <p className="text-sm text-[#0B1E3F]/60 mt-1">One load per report. State what happened, with a document that shows it. It&apos;s published under your {role === 'driver' ? 'name' : 'company’s name'} after we review it, and the other side can reply.</p>
      </div>

      {field('I’m reporting as', (
        <div className="flex flex-wrap gap-2">
          {roles.map((r) => (
            <button type="button" key={r} className={chip(role === r)} onClick={() => setRole(r)}>
              {ROLE_LABEL[r]}{r === 'driver' ? ` · ${me.driver?.name}` : r === 'shipper' ? ` · ${me.shipper?.company}` : ` · ${me.company?.name}`}
            </button>
          ))}
        </div>
      ))}

      {role && field('Who is the report about', (
        <div className="flex flex-wrap gap-2">
          {subjects.map((s) => <button type="button" key={s} className={chip(subjectType === s)} onClick={() => setSubjectType(s)}>{subjectLabel[s]}</button>)}
        </div>
      ))}

      {subjectType && subjectType !== 'shipper' && field('Company', <CompanyPicker value={picked} onPick={setPicked} />, 'Pick it from FMCSA’s registry so the report lands on the right company.')}
      {subjectType === 'shipper' && field('Shipper or receiver', (
        <div className="grid sm:grid-cols-[1fr_180px_90px] gap-2">
          <input className={input} placeholder="Company name" value={shipper.name} onChange={(e) => setShipper({ ...shipper, name: e.target.value })} />
          <input className={input} placeholder="City" value={shipper.city} onChange={(e) => setShipper({ ...shipper, city: e.target.value })} />
          <input className={input} placeholder="State" maxLength={2} value={shipper.state} onChange={(e) => setShipper({ ...shipper, state: e.target.value.toUpperCase() })} />
        </div>
      ), 'The facility where the load was picked up or delivered.')}

      {subjectType && field('What happened', (
        <select className={input} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Choose one…</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      ))}

      {category && (
        <>
          <div className="grid sm:grid-cols-3 gap-4">
            {field('Load / reference number', <input className={input} placeholder="From the rate con or BOL" value={loadRef} onChange={(e) => setLoadRef(e.target.value)} maxLength={60} />)}
            {field('Date it happened', <input type="date" className={input} value={date} onChange={(e) => setDate(e.target.value)} max={new Date().toISOString().slice(0, 10)} />)}
            {cat?.amount && field(`Amount${cat.amount === 'optional' ? ' (optional)' : ''}`, <input className={input} inputMode="decimal" placeholder="$" value={amount} onChange={(e) => setAmount(e.target.value)} />)}
          </div>

          {field('What happened, in your words', (
            <>
              <textarea className={input} rows={5} value={description} onChange={(e) => setDescription(e.target.value.slice(0, DESCRIPTION_MAX))} placeholder="Stick to facts: dates, amounts, what was agreed, what was paid, who you spoke to and when." />
              <div className="text-xs text-[#0B1E3F]/45 mt-1">{description.trim().length < DESCRIPTION_MIN ? `At least ${DESCRIPTION_MIN} characters` : ''} {description.length} / {DESCRIPTION_MAX}</div>
            </>
          ), 'Facts only. Reports with insults, guesses or opinions about people aren’t published.')}

          {field('Documents that show it', (
            <>
              <label className="flex items-center gap-3 px-4 py-3 rounded-xl border border-dashed border-[#0B1E3F]/25 bg-[#F5F3EE]/60 cursor-pointer hover:border-[#0B1E3F]/50 transition">
                <Upload className="w-4 h-4 text-[#0B1E3F]/60" />
                <span className="text-sm text-[#0B1E3F]/75">{files.length ? `${files.length} file${files.length === 1 ? '' : 's'} attached` : 'Attach the rate con, BOL, invoice, settlement or messages'}</span>
                <input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => setFiles(Array.from(e.target.files || []).slice(0, EVIDENCE_MAX_FILES))} />
              </label>
              {files.length > 0 && <ul className="mt-2 text-xs mono text-[#0B1E3F]/60 space-y-0.5">{files.map((f, i) => <li key={i}>{f.name} · {(f.size / 1024 / 1024).toFixed(1)} MB</li>)}</ul>}
            </>
          ), `Up to ${EVIDENCE_MAX_FILES} PDFs or photos, 10 MB each. Only Haulock’s reviewers see them; they aren’t shown on the report.`)}

          {role === 'driver' && field('Proof you drove for this company', (
            <>
              <label className="flex items-center gap-3 px-4 py-3 rounded-xl border border-dashed border-[#0B1E3F]/25 bg-[#F5F3EE]/60 cursor-pointer hover:border-[#0B1E3F]/50 transition">
                <Upload className="w-4 h-4 text-[#0B1E3F]/60" />
                <span className="text-sm text-[#0B1E3F]/75">{proofFiles.length ? `${proofFiles.length} file${proofFiles.length === 1 ? '' : 's'} attached` : 'Attach a settlement, pay stub, dispatch sheet, lease or onboarding form'}</span>
                <input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" data-testid="proof-input" onChange={(e) => setProofFiles(Array.from(e.target.files || []).slice(0, EVIDENCE_MAX_FILES))} />
              </label>
              {proofFiles.length > 0 && <ul className="mt-2 text-xs mono text-[#0B1E3F]/60 space-y-0.5">{proofFiles.map((f, i) => <li key={i}>{f.name} · {(f.size / 1024 / 1024).toFixed(1)} MB</li>)}</ul>}
            </>
          ), 'Required. One document that shows your name, the company and a date while you drove for them. Only Haulock’s reviewers see it.')}

          {role === 'driver' && (
            <label className="flex items-start gap-3 p-4 rounded-xl border border-[#0B1E3F]/10 text-sm text-[#0B1E3F]/80 cursor-pointer">
              <input type="checkbox" className="mt-1" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
              <span>
                <strong className="text-[#0B1E3F]">Keep my name off the public report.</strong> It will show &ldquo;Verified driver&rdquo; instead of your name. Haulock still verifies who you are and keeps that on file; the company can still reply, and we would disclose your name only if a court requires it.
              </span>
            </label>
          )}

          <label className="flex items-start gap-3 p-4 rounded-xl bg-[#F5F3EE] border border-[#0B1E3F]/10 text-sm text-[#0B1E3F]/80 cursor-pointer">
            <input type="checkbox" className="mt-1" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
            <span>
              I confirm this report is true and comes from my own dealings with this company on this load. I understand it will be published with {role === 'driver' && anonymous ? <strong className="text-[#0B1E3F]">&ldquo;Verified driver&rdquo;</strong> : reporterName ? <strong className="text-[#0B1E3F]">{reporterName}</strong> : 'my name'} as the reporter, that the company can reply, and that I am responsible for what it says.
            </span>
          </label>
        </>
      )}

      {error && <div className="flex items-start gap-2 text-sm text-[#DC2626]"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />{error}</div>}
      <div><button type="submit" className={btn} disabled={busy || !category}>{busy ? 'Sending…' : 'Send for review'}</button></div>
    </form>
  );
}

// The rules every reporter agrees to, shown before the form.
function ReportRules() {
  return (
    <div className={`${card} p-6`}>
      <div className="flex items-center gap-2 mb-4"><ShieldCheck className="w-4 h-4 text-[#16A34A]" /><h3 className="font-semibold">Reporting rules</h3></div>
      <ol className="grid md:grid-cols-2 gap-x-8 gap-y-3">
        {REPORT_RULES.map((rule, i) => (
          <li key={rule.title} className="flex items-start gap-3">
            <span className="w-6 h-6 rounded-full bg-[#0B1E3F] text-white text-[11px] mono flex items-center justify-center shrink-0">{i + 1}</span>
            <div className="text-sm"><span className="font-semibold text-[#0B1E3F]">{rule.title}.</span> <span className="text-[#0B1E3F]/70">{rule.text}</span></div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------- Find a company's reports ----------

// One row in the live search: a company in FMCSA's records, or one that
// already has reports here (the only way a shipper shows up).
type CompanyHit = {
  key: string;
  name: string;
  type?: SubjectType;       // known when it already has reports
  role?: string;            // FMCSA: carrier / broker / both / dot-only / none
  mc: string | null;
  dot: string | null;
  city?: string | null;
  state?: string | null;
  reports: number | null;   // null = couldn't be counted
  subjectKey?: string;      // shippers are looked up by this
  query?: string;           // "MC-123" / "DOT-123", for the full check
};

// What the user says they are looking for. "driver" has no search: reports
// are about companies, never about a person.
type LookKind = 'broker' | 'carrier' | 'shipper' | 'driver';
const LOOK: { id: LookKind; label: string; icon: any; placeholder: string; help: string }[] = [
  { id: 'broker', label: 'Broker', icon: Building2, placeholder: 'Broker name, MC or DOT number', help: 'Searches every freight broker in FMCSA and Motus records. Pick one to see the reports filed about it.' },
  { id: 'carrier', label: 'Carrier', icon: Truck, placeholder: 'Carrier name, MC or DOT number', help: 'Searches every trucking company in FMCSA and Motus records. Pick one to see the reports filed about it.' },
  { id: 'shipper', label: 'Shipper', icon: Flag, placeholder: 'Shipper or receiver name', help: 'Shippers aren’t in FMCSA’s records, so this searches the shippers that already have a report here. No result means nobody has reported it yet.' },
  { id: 'driver', label: 'Driver', icon: UserCheck, placeholder: '', help: '' },
];
const kindOfHit = (h: CompanyHit): 'broker' | 'carrier' | 'shipper' | 'either' =>
  h.type === 'shipper' ? 'shipper'
    : h.role === 'both' || h.role === 'none' ? 'either'
      : h.role === 'broker' || (!h.role && h.type === 'broker') ? 'broker'
        : 'carrier';

const hitRole = (h: CompanyHit) => h.type === 'shipper' ? 'shipper' : h.role === 'both' ? 'carrier + broker' : h.role === 'dot-only' ? 'USDOT only' : h.role === 'none' ? 'no active authority' : h.role || h.type || '';
const hitLine = (h: CompanyHit) => [idLabel(h), h.city ? `${h.city}${h.state ? `, ${h.state}` : ''}` : '', hitRole(h)].filter(Boolean).join(' · ');

// Results as you type: FMCSA + Motus records for carriers and brokers, plus
// every company that already has reports here, with its report count.
// Companies only. People (drivers included) can't be searched by name.
function ReportsSearch({ kind, initial = '', onPick }: { kind: 'broker' | 'carrier' | 'shipper'; initial?: string; onPick: (hit: CompanyHit) => void }) {
  const [q, setQ] = useState(initial);
  const [hits, setHits] = useState<CompanyHit[]>([]);
  const [others, setOthers] = useState<CompanyHit[]>([]);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'done'>('idle');
  const [open, setOpen] = useState(Boolean(initial));
  const [active, setActive] = useState(0);
  const seq = useRef(0);
  const wrap = useRef<HTMLDivElement>(null);
  const query = q.trim();

  useEffect(() => {
    const mine = ++seq.current;
    if (query.length < 3) { setHits([]); setOthers([]); setPhase('idle'); return; }
    setPhase('loading');
    const t = setTimeout(async () => {
      // Shippers exist only in our own reports; FMCSA isn't asked for them.
      const [fm, db] = await Promise.allSettled([
        kind === 'shipper' ? Promise.resolve({ suggestions: [] }) : api(`/api/search/suggest?q=${encodeURIComponent(query)}`),
        api(`/api/reports?search=${encodeURIComponent(query)}${kind === 'shipper' ? '&type=shipper' : ''}`),
      ]);
      if (seq.current !== mine) return;
      const fmcsa: any[] = fm.status === 'fulfilled' ? fm.value.suggestions || [] : [];
      const counted = db.status === 'fulfilled';
      const subjects: any[] = counted ? (db as PromiseFulfilledResult<any>).value.subjects || [] : [];
      const used = new Set<string>();
      const fromFmcsa: CompanyHit[] = fmcsa.map((s) => {
        const same = subjects.filter((x) => (s.dot && x.dot === s.dot) || (s.mc && x.mc === s.mc));
        same.forEach((x) => used.add(x.key));
        return {
          key: s.query, query: s.query, name: s.name, role: s.role, mc: s.mc || null, dot: s.dot || null, city: s.city, state: s.state,
          reports: counted ? same.reduce((n: number, x: any) => n + x.count, 0) : null,
        };
      });
      const ownOnly: CompanyHit[] = subjects.filter((x) => !used.has(x.key)).map((x) => ({
        key: x.key, name: x.name, type: x.type, mc: x.mc, dot: x.dot, city: x.city, state: x.state, reports: x.count,
        subjectKey: x.type === 'shipper' ? x.key : undefined,
        query: x.mc ? `MC-${x.mc}` : x.dot ? `DOT-${x.dot}` : undefined,
      }));
      // Companies with reports first; FMCSA's own order after that. What the
      // user asked for (broker, carrier or shipper) leads; anything else that
      // matches the text is kept apart so it isn't mistaken for one.
      const all = [...ownOnly, ...fromFmcsa].sort((a, b) => (b.reports || 0) - (a.reports || 0));
      const wanted = all.filter((h) => { const k = kindOfHit(h); return k === kind || (k === 'either' && kind !== 'shipper'); });
      setHits(wanted.slice(0, 8));
      setOthers(all.filter((h) => !wanted.includes(h)).slice(0, Math.max(0, 8 - wanted.length)));
      setPhase('done');
      setActive(0);
    }, 250);
    return () => clearTimeout(t);
  }, [query, kind]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const pick = (h: CompanyHit) => { setOpen(false); setQ(''); onPick(h); };
  const showList = open && query.length > 0;
  const look = LOOK.find((l) => l.id === kind)!;
  const rows = [...hits, ...others]; // one keyboard order across both groups
  const row = (h: CompanyHit, i: number) => (
    <button
      type="button"
      role="option"
      id={`reports-hit-${i}`}
      aria-selected={i === active}
      key={h.key}
      onMouseEnter={() => setActive(i)}
      onClick={() => pick(h)}
      className={`w-full text-left px-4 py-2.5 flex items-center gap-3 border-b border-[#0B1E3F]/5 last:border-0 ${i === active ? 'bg-[#0B1E3F]/[0.05]' : ''}`}
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-[#0B1E3F] truncate">{h.name}</div>
        <div className="text-xs mono text-[#0B1E3F]/55 truncate">{hitLine(h)}</div>
      </div>
      {h.reports
        ? <span className="shrink-0 px-2 py-0.5 rounded-full bg-[#DC2626]/10 text-[#DC2626] text-[10px] mono uppercase tracking-wider">{h.reports} report{h.reports === 1 ? '' : 's'}</span>
        : h.reports === 0 ? <span className="shrink-0 text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/35">No reports</span> : null}
    </button>
  );
  return (
    <div ref={wrap} className="relative">
      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#0B1E3F]/40 pointer-events-none" />
      <input
        role="combobox"
        aria-expanded={showList}
        aria-controls="reports-search-list"
        aria-autocomplete="list"
        aria-activedescendant={showList && rows[active] ? `reports-hit-${active}` : undefined}
        aria-label={`Search a ${kind}: ${look.placeholder}`}
        autoComplete="off"
        className="w-full pl-11 pr-11 py-3 bg-white border border-[#0B1E3F]/20 rounded-full text-sm text-[#0B1E3F] placeholder:text-[#0B1E3F]/40 focus:outline-none focus:border-[#0B1E3F]"
        placeholder={look.placeholder}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, Math.max(rows.length - 1, 0))); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); if (showList && rows[active]) pick(rows[active]); }
          else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {q && (
        <button type="button" aria-label="Clear search" className="absolute right-4 top-1/2 -translate-y-1/2 text-[#0B1E3F]/40 hover:text-[#0B1E3F]" onClick={() => setQ('')}><X className="w-4 h-4" /></button>
      )}
      {showList && (
        <div id="reports-search-list" role="listbox" aria-label="Matching companies" className="absolute z-20 mt-2 w-full bg-white border border-[#0B1E3F]/15 rounded-2xl card-shadow-lg overflow-hidden">
          {query.length < 3 && <div className="px-4 py-3 text-sm text-[#0B1E3F]/50">Keep typing: at least 3 letters or digits.</div>}
          {query.length >= 3 && phase !== 'done' && rows.length === 0 && <div className="px-4 py-3 text-sm text-[#0B1E3F]/50">Searching…</div>}
          {query.length >= 3 && phase === 'done' && hits.length === 0 && (
            <div className="px-4 py-3 text-sm text-[#0B1E3F]/65">
              {kind === 'shipper'
                ? <>No shipper named “{query}” has a report here. That means nobody has reported it yet.</>
                : <>No {kind} found for “{query}”. Check the spelling, or try its MC or DOT number.</>}
            </div>
          )}
          {query.length >= 3 && hits.map((h, i) => row(h, i))}
          {query.length >= 3 && others.length > 0 && (
            <>
              <div className="px-4 py-2 text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/50 bg-[#F5F3EE] border-y border-[#0B1E3F]/5">Same name, but not a {kind}</div>
              {others.map((h, i) => row(h, hits.length + i))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- The Reports page ----------

// A company handed over from its public profile page ("Read the reports").
const REPORTS_COMPANY_KEY = 'haulock:reportsCompany';
// What a visitor typed into the directory's search box before they had an
// account; it's typed in for them here once they're signed in.
const REPORTS_SEARCH_KEY = 'haulock:reportsSearch';

export function ReportsPage({ navigate, plan }: { navigate: any; plan?: string }) {
  const [tab, setTab] = useState<'latest' | 'file' | 'mine'>(() => {
    if (typeof window === 'undefined') return 'latest';
    try { return sessionStorage.getItem(REPORT_SUBJECT_KEY) ? 'file' : 'latest'; } catch { return 'latest'; }
  });
  const [me, setMe] = useState<Me | null>(null);
  const [latest, setLatest] = useState<PublicReport[] | null>(null);
  const [mine, setMine] = useState<PublicReport[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [company, setCompany] = useState<{ hit: CompanyHit; reports: PublicReport[] | null; error?: string } | null>(null);
  const [kind, setKind] = useState<LookKind>('broker');
  const [seed, setSeed] = useState('');
  const kindChosen = useRef(false);
  const paid = Boolean(plan && plan !== 'free');

  const loadMe = useCallback(async () => { try { setMe(await api('/api/reports/me')); } catch {} }, []);
  const loadLatest = useCallback(async () => {
    try { setLatest((await api('/api/reports')).reports || []); setLoadError(null); } catch (e: any) { setLoadError(e.message); setLatest([]); }
  }, []);
  const loadMine = useCallback(async () => { try { setMine((await api('/api/reports?mine=1')).reports || []); } catch { setMine([]); } }, []);

  useEffect(() => {
    loadMe(); loadLatest(); loadMine();
    // Back from the driver ID check.
    const params = new URLSearchParams(window.location.search);
    if (params.get('driver') === 'check') {
      window.history.replaceState({}, '', window.location.pathname);
      setTab('file');
      (async () => {
        try {
          const j = await fetch('/api/reports/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'driver', action: 'check' }) }).then((r) => r.json());
          setNotice(j.ok ? `ID check passed. You can now report as ${j.driver?.name}.` : j.error || 'The ID check wasn’t completed.');
          await loadMe();
        } catch {
          setNotice('We couldn’t read the ID check result. Reload the page in a minute.');
        }
      })();
    }
  }, [loadMe, loadLatest, loadMine]);

  // The reports about the company picked in the search.
  const showCompany = useCallback(async (hit: CompanyHit) => {
    setCompany((c) => (c && c.hit.key === hit.key ? c : { hit, reports: null }));
    try {
      const qs = new URLSearchParams();
      if (hit.subjectKey) qs.set('subject', hit.subjectKey);
      else { if (hit.mc) qs.set('mc', hit.mc); if (hit.dot) qs.set('dot', hit.dot); }
      const j = await api(`/api/reports?${qs.toString()}`);
      setCompany(j.unavailable
        ? { hit, reports: [], error: 'We couldn’t read this company’s reports right now. Try again in a minute.' }
        : { hit, reports: j.reports || [] });
    } catch (e: any) {
      setCompany({ hit, reports: [], error: e.message });
    }
  }, []);
  // Carriers mostly look up brokers and brokers look up carriers, so start
  // there unless the user has already chosen.
  useEffect(() => {
    if (kindChosen.current || !me?.company) return;
    const roles = me.company.roles || [];
    if (roles.includes('broker') && !roles.includes('carrier')) setKind('carrier');
  }, [me]);
  useEffect(() => {
    try {
      const typed = sessionStorage.getItem(REPORTS_SEARCH_KEY);
      if (typed) {
        sessionStorage.removeItem(REPORTS_SEARCH_KEY);
        setSeed(String(typed).replace(/[^\w\s.,&'#-]/g, '').slice(0, 80));
        setTab('latest');
      }
      const raw = sessionStorage.getItem(REPORTS_COMPANY_KEY);
      if (!raw) return;
      sessionStorage.removeItem(REPORTS_COMPANY_KEY);
      const c = JSON.parse(raw);
      // Only what a company page writes: plain numbers and plain text.
      const num = (v: unknown) => (typeof v === 'string' && /^\d{1,9}$/.test(v) ? v.replace(/^0+/, '') || null : null);
      const txt = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
      const mc = num(c?.mc);
      const dot = num(c?.dot);
      if (!mc && !dot) return;
      const id = mc ? `MC-${mc}` : `DOT-${dot}`;
      const hit: CompanyHit = { key: id, query: id, name: txt(c.name, 120) || id, role: txt(c.role, 12) || undefined, mc, dot, city: txt(c.city, 60), state: txt(c.state, 2), reports: null };
      kindChosen.current = true;
      setKind(kindOfHit(hit) === 'broker' ? 'broker' : 'carrier');
      setTab('latest');
      showCompany(hit);
    } catch {}
  }, [showCompany]);
  const reportCompany = (hit: CompanyHit) => {
    const type: SubjectType | undefined = hit.type || (hit.role === 'broker' ? 'broker' : hit.role === 'carrier' || hit.role === 'dot-only' ? 'carrier' : undefined);
    try { sessionStorage.setItem(REPORT_SUBJECT_KEY, JSON.stringify({ mc: hit.mc, dot: hit.dot, name: hit.name, type, city: hit.city, state: hit.state })); } catch {}
    setTab('file');
  };
  const checkCompany = (hit: CompanyHit) => {
    try { sessionStorage.setItem('haulock:verifyQuery', hit.query || ''); } catch {}
    navigate('verify');
  };

  const tabs: { id: typeof tab; text: string }[] = [
    { id: 'latest', text: 'Find reports' },
    { id: 'file', text: 'File a report' },
    { id: 'mine', text: `My reports${mine && mine.length ? ` (${mine.length})` : ''}` },
  ];
  return (
    <div className="max-w-5xl mx-auto space-y-6 text-[#0B1E3F]">
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-3xl font-semibold">Reports</h1>
          <span className="px-2 py-0.5 rounded-full bg-[#16A34A]/10 text-[#16A34A] text-[10px] mono uppercase tracking-wider">Free on every plan</span>
        </div>
        <p className="text-[#0B1E3F]/65 mt-2 max-w-3xl">
          Look up whether anyone has reported a broker, carrier or shipper, and file your own report when a load goes wrong. Reports are free. The safety check on a company (score, insurance, inspections) is separate, under Verify.
        </p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`px-4 py-2 rounded-full text-sm font-medium border transition ${tab === t.id ? 'bg-[#0B1E3F] text-white border-[#0B1E3F]' : 'bg-white text-[#0B1E3F]/70 border-[#0B1E3F]/10 hover:text-[#0B1E3F]'}`}>{t.text}</button>
        ))}
      </div>

      {notice && <div className={`${card} px-5 py-3 text-sm`}>{notice}</div>}
      {me && !me.configured && <div className={`${card} px-5 py-3 text-sm text-[#B45309]`}>Reports aren&apos;t set up on this server yet (the server key is missing).</div>}

      {tab === 'latest' && (
        <div className="space-y-4">
          <div className={`${card} p-5 sm:p-6`}>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold">Look up reports</h2>
              <span className="px-2 py-0.5 rounded-full bg-[#16A34A]/10 text-[#16A34A] text-[10px] mono uppercase tracking-wider">Free · doesn&apos;t use a lookup</span>
            </div>
            <p className="text-sm text-[#0B1E3F]/65 mt-1">See whether anyone has filed a report about a company before you work with it.</p>

            <div className={`${label} mt-5 mb-2`}>1 · What are you looking for?</div>
            <div role="radiogroup" aria-label="What are you looking for?" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {LOOK.map((l) => {
                const Icon = l.icon;
                const on = kind === l.id;
                return (
                  <button
                    key={l.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => { kindChosen.current = true; setSeed(''); setKind(l.id); }}
                    className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border text-sm font-medium transition ${on ? 'bg-[#0B1E3F] text-white border-[#0B1E3F]' : 'bg-white text-[#0B1E3F]/75 border-[#0B1E3F]/15 hover:border-[#0B1E3F]/40'}`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${on ? 'text-[#FF6B35]' : 'text-[#0B1E3F]/45'}`} /> {l.label}
                  </button>
                );
              })}
            </div>

            {kind === 'driver' ? (
              <div className="mt-5 rounded-xl bg-[#F5F3EE] border border-[#0B1E3F]/10 p-4 text-sm text-[#0B1E3F]/75">
                <div className="font-semibold text-[#0B1E3F]">There are no reports about drivers.</div>
                <p className="mt-1">Reports on Haulock are about companies, never about a person, so there is nothing to search for a driver.</p>
                <p className="mt-1">Drivers can report the carriers and brokers they hauled for. To look up a trucking company, choose <button type="button" className="underline font-medium text-[#0B1E3F]" onClick={() => { kindChosen.current = true; setKind('carrier'); }}>Carrier</button>.</p>
              </div>
            ) : (
              <>
                <div className={`${label} mt-5 mb-2`}>2 · Search for the {kind}</div>
                <ReportsSearch key={`${kind}|${seed}`} kind={kind} initial={seed} onPick={(h) => { setSeed(''); showCompany(h); }} />
                <p className="text-xs text-[#0B1E3F]/55 mt-2.5">{LOOK.find((l) => l.id === kind)!.help} Results show as you type.</p>
                {kind !== 'shipper' && (
                  <p className="text-xs text-[#0B1E3F]/55 mt-1.5">
                    This search shows reports only. The safety check on a {kind} (risk score, insurance, inspections, audits) is the full check: {paid ? 'unlimited on your plan.' : '3 a month on the Free plan, unlimited on paid plans.'}
                  </p>
                )}
              </>
            )}
          </div>

          {company && (
            <div className={`${card} overflow-hidden`}>
              <div className="p-5 flex flex-wrap items-center gap-4">
                <div className="w-11 h-11 rounded-xl bg-[#0B1E3F] flex items-center justify-center shrink-0"><Building2 className="w-5 h-5 text-white" /></div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate">{company.hit.name}</div>
                  <div className="text-xs mono text-[#0B1E3F]/55 truncate">{hitLine(company.hit)}</div>
                </div>
                {company.reports !== null && !company.error && (
                  <div className="text-center shrink-0 px-2">
                    <div className="text-2xl font-semibold leading-none">{company.reports.length}</div>
                    <div className="text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/50 mt-1">report{company.reports.length === 1 ? '' : 's'}</div>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <button className={btn} onClick={() => reportCompany(company.hit)}>Report this company</button>
                  <button className={btnGhost} onClick={() => setCompany(null)}>Back to latest reports</button>
                </div>
              </div>
              {/* Reports are the free part; the safety check is the paid one. */}
              {company.hit.query && (
                <div className="px-5 py-4 bg-[#0B1E3F] text-white flex flex-wrap items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-[#FF6B35] flex items-center justify-center shrink-0"><ShieldCheck className="w-5 h-5 text-white" /></div>
                  <div className="min-w-0 flex-1 basis-64">
                    <div className="font-semibold">Reports are one part. The safety check is the rest.</div>
                    <p className="text-sm text-white/70 mt-0.5">
                      Risk score, operating authority, insurance on file and cancellations, inspections and crashes, FMCSA audits and Motus records for {company.hit.name}.
                      {' '}{paid ? 'Unlimited on your plan.' : 'You get 3 full checks a month on the Free plan. Paid plans are unlimited.'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button className="px-4 py-2 bg-[#FF6B35] text-white rounded-full text-sm font-semibold hover:bg-[#FF6B35]/90 transition" onClick={() => checkCompany(company.hit)}>Run the safety check</button>
                    {!paid && <button className="px-4 py-2 border border-white/25 rounded-full text-sm font-medium text-white hover:bg-white/10 transition" onClick={() => navigate('plan')}>See paid plans</button>}
                  </div>
                </div>
              )}
            </div>
          )}
          {!company && <div className={`${label} pt-2`}>Latest reports</div>}
          {company ? (
            company.reports === null ? <div className="text-sm text-[#0B1E3F]/50">Loading…</div>
              : company.error ? <div className={`${card} p-6 text-sm text-[#0B1E3F]/70`}>{company.error}</div>
              : company.reports.length === 0
                ? <div className={`${card} p-6 text-sm text-[#0B1E3F]/70`}><CheckCircle2 className="w-4 h-4 text-[#16A34A] inline -mt-0.5 mr-1.5" />No reports on record for {company.hit.name}.</div>
                : company.reports.map((r) => <ReportCard key={r.id} report={r} showSubject={false} onChanged={() => { showCompany(company.hit); loadLatest(); loadMine(); }} />)
          ) : latest === null ? (
            <div className="text-sm text-[#0B1E3F]/50">Loading…</div>
          ) : loadError ? (
            <div className={`${card} p-6 text-sm text-[#0B1E3F]/70`}>{loadError}</div>
          ) : latest.length === 0 ? (
            <div className={`${card} p-8 text-center`}>
              <Flag className="w-8 h-8 text-[#0B1E3F]/30 mx-auto" />
              <div className="font-semibold mt-3">No reports published yet</div>
              <p className="text-sm text-[#0B1E3F]/60 mt-1 max-w-md mx-auto">Had a load go wrong? File the first report. It helps the next carrier, broker or driver who deals with that company.</p>
              <button className={`${btn} mt-4`} onClick={() => setTab('file')}>File a report</button>
            </div>
          ) : latest.map((r) => <ReportCard key={r.id} report={r} showSubject onChanged={() => { loadLatest(); loadMine(); }} />)}

          <div className={`${card} px-5 py-4 flex flex-wrap items-center justify-between gap-3`}>
            <div className="text-sm text-[#0B1E3F]/75 max-w-2xl">
              <span className="font-semibold text-[#0B1E3F]">Report alerts.</span> Get an email the moment a report is published about your company or a company on your watchlist. Included on paid plans; reading, filing and replying to reports is free.
            </div>
            <div className="flex gap-2">
              <button className={btnGhost} onClick={() => navigate('watchlist')}>My watchlist</button>
              {!paid && <button className={btn} onClick={() => navigate('plan')}>See plans</button>}
            </div>
          </div>
        </div>
      )}

      {tab === 'file' && (
        <div className="space-y-6">
          <ReportRules />
          {me ? (
            <>
              <div>
                <div className={`${label} mb-2`}>Step 1 · Who you are (verified once)</div>
                <ReporterSetup me={me} reload={loadMe} navigate={navigate} />
              </div>
              <div>
                <div className={`${label} mb-2`}>Step 2 · The report</div>
                <ReportForm key={`${me.company?.dot || ''}|${me.driver?.name || ''}|${me.shipper?.domain || ''}`} me={me} onFiled={loadMine} />
              </div>
            </>
          ) : <div className="text-sm text-[#0B1E3F]/50">Loading…</div>}
        </div>
      )}

      {tab === 'mine' && (
        <div className="space-y-4">
          {mine === null ? <div className="text-sm text-[#0B1E3F]/50">Loading…</div>
            : mine.length === 0 ? <div className={`${card} p-6 text-sm text-[#0B1E3F]/70`}>You haven&apos;t filed any reports.</div>
            : mine.map((r) => <ReportCard key={r.id} report={r} showSubject onChanged={() => { loadMine(); loadLatest(); }} />)}
        </div>
      )}
    </div>
  );
}

// ---------- "New in Haulock" ----------
// Opens by itself once per browser, on the dashboard, and any time from the
// "What's new" button in the app header. Bump the key for the next release
// so it shows again.
const WHATS_NEW_KEY = 'haulock:whatsNew:2026-11';
const WHATS_NEW_EVENT = 'haulock:whatsnew';

function whatsNewSeen(): boolean {
  try { return Boolean(localStorage.getItem(WHATS_NEW_KEY)); } catch { return true; }
}

// Who can report whom, one line each.
const WHO_REPORTS: { who: string; whom: React.ReactNode }[] = [
  { who: 'Carriers', whom: <>can report <strong>brokers</strong> and <strong>shippers</strong></> },
  { who: 'Brokers', whom: <>can report <strong>carriers</strong> and <strong>shippers</strong></> },
  { who: 'Drivers', whom: <>can report the <strong>carriers</strong> and <strong>brokers</strong> they hauled for</> },
  { who: 'Shippers', whom: <>can report <strong>carriers</strong> and <strong>brokers</strong>, and can be reported themselves</> },
];

const WHATS_NEW_MORE: { icon: any; title: string; text: string; tag: 'New' | 'Paid plans' }[] = [
  { icon: Clock, tag: 'New', title: 'Insurance cancellation countdown', text: 'Each insurance filing shows the date it started. When an insurer files to cancel, you see the end date and the days left. Your watchlist emails you that same day.' },
  { icon: ShieldCheck, tag: 'New', title: 'FMCSA Motus, side by side', text: 'FMCSA now records changes in its Motus system first. When Motus is newer, your report shows both versions with their dates, plus the last FMCSA audit.' },
  { icon: MessageSquare, tag: 'Paid plans', title: 'Report alerts', text: 'An email the moment a report is published about your company, or about a company on your watchlist.' },
];

// The header button. An orange dot shows until the news has been opened.
export function WhatsNewButton() {
  const [unseen, setUnseen] = useState(false);
  useEffect(() => {
    setUnseen(!whatsNewSeen());
    const onSeen = () => setUnseen(false);
    window.addEventListener(`${WHATS_NEW_EVENT}:seen`, onSeen);
    return () => window.removeEventListener(`${WHATS_NEW_EVENT}:seen`, onSeen);
  }, []);
  return (
    <button
      onClick={() => window.dispatchEvent(new Event(WHATS_NEW_EVENT))}
      className="relative shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-full border border-[#0B1E3F]/10 bg-white text-sm font-medium text-[#0B1E3F] hover:bg-[#0B1E3F]/5 transition"
    >
      <Flag className="w-4 h-4 text-[#FF6B35]" />
      <span className="hidden sm:inline">What&apos;s new</span>
      {unseen && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#FF6B35] ring-2 ring-white" aria-label="New" />}
    </button>
  );
}

export function WhatsNewModal({ navigate, autoOpen }: { navigate: any; autoOpen: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(WHATS_NEW_EVENT, onOpen);
    return () => window.removeEventListener(WHATS_NEW_EVENT, onOpen);
  }, []);
  useEffect(() => { if (autoOpen && !whatsNewSeen()) setOpen(true); }, [autoOpen]);
  const close = useCallback(() => {
    try { localStorage.setItem(WHATS_NEW_KEY, new Date().toISOString()); } catch {}
    window.dispatchEvent(new Event(`${WHATS_NEW_EVENT}:seen`));
    setOpen(false);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);
  if (!open) return null;
  const tagCls = (tag: string) => tag === 'Free' ? 'bg-[#16A34A]/10 text-[#16A34A]' : tag === 'New' ? 'bg-[#FF6B35]/10 text-[#FF6B35]' : 'bg-[#0B1E3F]/[0.07] text-[#0B1E3F]/65';
  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-6" role="dialog" aria-modal="true" aria-label="New in Haulock">
      <div className="absolute inset-0 bg-[#0B1E3F]/60 backdrop-blur-sm" onClick={close} />
      <div className="relative w-full sm:max-w-xl max-h-[92vh] overflow-y-auto bg-white rounded-t-3xl sm:rounded-3xl card-shadow-lg text-[#0B1E3F]">
        <div className="relative bg-[#0B1E3F] text-white px-7 pt-7 pb-6 overflow-hidden">
          <div className="absolute -top-16 -right-10 w-56 h-56 rounded-full bg-[#FF6B35]/35 blur-3xl pointer-events-none" />
          <button onClick={close} aria-label="Close" className="absolute top-4 right-4 text-white/60 hover:text-white"><X className="w-5 h-5" /></button>
          <div className="relative inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#FF6B35] text-white text-[10px] mono uppercase tracking-[0.18em]">New in Haulock</div>
          <h2 className="relative text-3xl mt-3 leading-tight">Report a broker, carrier or shipper. <span className="serif italic block">Read any company&apos;s reports.</span></h2>
        </div>

        <div className="px-7 pt-6">
          <div className="flex flex-wrap items-center gap-2">
            <Flag className="w-4 h-4 text-[#DC2626]" />
            <span className="font-semibold text-lg">Verified reports</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] mono uppercase tracking-wider ${tagCls('Free')}`}>Free on every plan</span>
          </div>
          <p className="text-sm text-[#0B1E3F]/65 mt-1">File a report when a load goes wrong. It stays on that company&apos;s record for everyone who checks it next. Who can report whom:</p>
          <ul className="mt-3 rounded-2xl border border-[#0B1E3F]/10 divide-y divide-[#0B1E3F]/[0.06] overflow-hidden">
            {WHO_REPORTS.map((x) => (
              <li key={x.who} className="flex items-baseline gap-2 px-4 py-2.5 text-sm bg-[#F5F3EE]/50">
                <strong className="w-20 shrink-0 text-[#0B1E3F]">{x.who}</strong>
                <span className="text-[#0B1E3F]/75 [&_strong]:text-[#0B1E3F]">{x.whom}</span>
              </li>
            ))}
          </ul>
          <ul className="mt-3 space-y-1.5 text-sm text-[#0B1E3F]/75">
            <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-[#16A34A] mt-0.5 shrink-0" /><span><strong className="text-[#0B1E3F]">Verified reporters only.</strong> Drivers can keep their name off the report; we still verify who they are.</span></li>
            <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-[#16A34A] mt-0.5 shrink-0" /><span><strong className="text-[#0B1E3F]">One load per report,</strong> with documents that show it.</span></li>
            <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-[#16A34A] mt-0.5 shrink-0" /><span><strong className="text-[#0B1E3F]">Reviewed before it&apos;s shown,</strong> and the company can reply.</span></li>
          </ul>
        </div>

        <ul className="px-7 pt-5 pb-2 space-y-4 mt-5 border-t border-[#0B1E3F]/[0.07]">
          {WHATS_NEW_MORE.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.title} className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#0B1E3F] flex items-center justify-center shrink-0"><Icon className="w-4 h-4 text-white" /></div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{item.title}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] mono uppercase tracking-wider ${tagCls(item.tag)}`}>{item.tag}</span>
                  </div>
                  <p className="text-sm text-[#0B1E3F]/65 leading-relaxed mt-0.5">{item.text}</p>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="sticky bottom-0 bg-white border-t border-[#0B1E3F]/[0.07] px-7 py-4 mt-4 flex flex-wrap gap-2">
          <button className={btn} onClick={() => { close(); navigate('reports'); }}>Open Reports</button>
          <button className={btnGhost} onClick={() => { close(); navigate('verify'); }}>Run a check</button>
          <button className="px-4 py-2 text-sm text-[#0B1E3F]/55 hover:text-[#0B1E3F]" onClick={close}>Got it</button>
        </div>
      </div>
    </div>
  );
}

// ---------- Admin review ----------

export function ReportsAdminPanel() {
  const [status, setStatus] = useState<'pending' | 'published' | 'rejected' | 'withdrawn'>('pending');
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setError(null);
    try { setData(await api(`/api/admin/reports?status=${status}`)); } catch (e: any) { setError(e.message); setData(null); }
  }, [status]);
  useEffect(() => { setData(null); load(); }, [load]);

  const act = async (id: string, action: string) => {
    const reason = (reasons[id] || '').trim();
    if ((action === 'reject' || action === 'unpublish') && !reason) { setError('Write the reason first. The reporter sees it.'); return; }
    setBusy(`${id}:${action}`); setError(null);
    try {
      await api('/api/admin/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action, reason }) });
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4 text-[#0B1E3F]">
      <div className="flex flex-wrap items-center gap-2">
        {(['pending', 'published', 'rejected', 'withdrawn'] as const).map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={`px-3 py-1.5 rounded-full text-xs mono uppercase tracking-wider border ${status === s ? 'bg-[#0B1E3F] text-white border-[#0B1E3F]' : 'bg-white text-[#0B1E3F]/65 border-[#0B1E3F]/10'}`}>
            {s}{s === 'pending' && data?.pending ? ` (${data.pending})` : ''}
          </button>
        ))}
      </div>
      <div className={`${card} px-5 py-3 text-xs text-[#0B1E3F]/65 leading-relaxed`}>
        Publish when the report states facts about one load and a document backs them. Decline it when it&apos;s opinion or insult, when the documents don&apos;t show what&apos;s claimed, or when it reads like one side of a quarrel with nothing to check. Never edit the text: it has to stay the reporter&apos;s own statement.
      </div>
      {error && <div className="text-sm text-[#DC2626]">{error}</div>}
      {!data && !error && <div className="text-sm text-[#0B1E3F]/50">Loading…</div>}
      {data && data.reports.length === 0 && <div className={`${card} p-6 text-sm text-[#0B1E3F]/60`}>Nothing {status}.</div>}
      {data?.reports.map((r: any) => (
        <div key={r.id} className={`${card} p-6`}>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="font-semibold">{r.categoryLabel}{r.amount != null ? ` · ${usd(r.amount)}` : ''}</div>
              <div className="text-sm text-[#0B1E3F]/75 mt-0.5">About <span className="font-medium text-[#0B1E3F]">{r.subject.name}</span> <span className="text-[#0B1E3F]/50">· {r.subject.type}{idLabel(r.subject) ? ` · ${idLabel(r.subject)}` : r.subject.city ? ` · ${r.subject.city}, ${r.subject.state}` : ''}</span></div>
              <div className="text-xs mono text-[#0B1E3F]/50 mt-1">Load {r.loadRef} · happened {fmtDay(r.incidentDate)} · filed {fmtDay(r.createdAt)}</div>
            </div>
            <span className="text-[11px] mono uppercase tracking-wider text-[#0B1E3F]/45 inline-flex items-center gap-1"><Clock className="w-3 h-3" /> {r.status}</span>
          </div>
          <p className="mt-3 text-sm text-[#0B1E3F]/85 leading-relaxed whitespace-pre-line">{r.description}</p>

          <div className="mt-4 grid md:grid-cols-2 gap-4 text-xs">
            <div className="rounded-xl bg-[#F5F3EE] border border-[#0B1E3F]/10 p-3 space-y-1">
              <div className={label}>Reporter</div>
              <div><span className="font-medium">{r.reporter.name}</span> · {ROLE_LABEL[r.reporter.role as ReporterRole]}{idLabel(r.reporter) ? ` · ${idLabel(r.reporter)}` : ''}</div>
              {r.reporter.anonymous && <div className="text-[#B45309]">Name withheld on the public report (shown as &ldquo;Verified driver&rdquo;)</div>}
              <div className="text-[#0B1E3F]/60">Account: {r.reporterEmail || '—'}</div>
              <div className="text-[#0B1E3F]/60">Verified by: {({ email: 'login email matches the FMCSA filing email', domain: 'login email on the FMCSA filing’s domain', code: 'code sent to the FMCSA filing email', identity: 'ID check (license + selfie)', work_email: 'work email on the company website’s domain' } as any)[r.reporterVerifiedBy] || r.reporterVerifiedBy}</div>
              <div className="text-[#0B1E3F]/60">Signed: {r.attestedAt ? new Date(r.attestedAt).toLocaleString() : '—'}{r.attestedIp ? ` · IP ${r.attestedIp}` : ''}</div>
            </div>
            <div className="rounded-xl bg-[#F5F3EE] border border-[#0B1E3F]/10 p-3 space-y-1">
              <div className={label}>Documents ({r.docs.length})</div>
              {r.docs.length === 0 && <div className="text-[#0B1E3F]/60">None</div>}
              {r.docs.map((d: any, i: number) => (
                <div key={i}>{d.url ? <a href={d.url} target="_blank" rel="noreferrer" className="underline text-[#0B1E3F]">{d.name}</a> : <span>{d.name} (link unavailable)</span>} <span className="text-[#0B1E3F]/50">· {(d.size / 1024 / 1024).toFixed(1)} MB</span></div>
              ))}
              {(r.proofDocs || []).length > 0 && (
                <>
                  <div className={`${label} pt-2`}>Proof they drove for the company ({r.proofDocs.length})</div>
                  {r.proofDocs.map((d: any, i: number) => (
                    <div key={`p${i}`}>{d.url ? <a href={d.url} target="_blank" rel="noreferrer" className="underline text-[#0B1E3F]">{d.name}</a> : <span>{d.name} (link unavailable)</span>}</div>
                  ))}
                </>
              )}
              <div className="text-[#0B1E3F]/45 pt-1">Links work for 15 minutes.</div>
            </div>
          </div>

          {r.response && (
            <div className="mt-3 rounded-xl border border-[#0B1E3F]/10 p-3 text-sm">
              <div className={label}>Reply from {r.response.name}{r.response.disputes ? ' · disputes it' : ''}</div>
              <p className="mt-1 text-[#0B1E3F]/80 whitespace-pre-line">{r.response.body}</p>
            </div>
          )}
          {r.rejectReason && <div className="mt-3 text-xs text-[#0B1E3F]/60">Reason given: {r.rejectReason}</div>}
          {r.events?.length > 0 && (
            <div className="mt-3 text-[11px] mono text-[#0B1E3F]/45 space-y-0.5">
              {r.events.map((ev: any, i: number) => <div key={i}>{new Date(ev.created_at).toLocaleString()} · {ev.action}{ev.actor ? ` · ${ev.actor}` : ''}{ev.note ? ` · ${ev.note}` : ''}</div>)}
            </div>
          )}

          {(r.status === 'pending' || r.status === 'published' || r.status === 'rejected') && (
            <div className="mt-4 pt-4 border-t border-[#0B1E3F]/5 flex flex-wrap items-center gap-2">
              {(r.status === 'pending' || r.status === 'rejected') && <button className={btn} disabled={busy !== null} onClick={() => act(r.id, 'publish')}>{busy === `${r.id}:publish` ? 'Publishing…' : 'Publish'}</button>}
              {(r.status === 'pending' || r.status === 'published') && (
                <>
                  <input className="flex-1 min-w-[220px] px-4 py-2 border border-[#0B1E3F]/20 rounded-full text-sm focus:outline-none focus:border-[#0B1E3F]" placeholder="Reason (the reporter sees it)" value={reasons[r.id] || ''} onChange={(e) => setReasons({ ...reasons, [r.id]: e.target.value })} />
                  <button className={btnGhost} disabled={busy !== null} onClick={() => act(r.id, r.status === 'pending' ? 'reject' : 'unpublish')}>{r.status === 'pending' ? 'Decline' : 'Take down'}</button>
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
