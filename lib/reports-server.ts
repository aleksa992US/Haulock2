import type { SupabaseClient, User } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import { currentVerification } from './company-profile';
import { getServiceSupabase } from './supabase/service';
import { REPORT_COLUMNS, scoreReports, toPublicReport, type DriverVerification, type PublicReport, type ReportScore, type ReporterIdentity, type ShipperVerification } from './reports';

// Server-side reads and the audit trail for verified reports. Every query
// goes through the service role: the tables have no client policies.

const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '').replace(/^0+/, '');

async function attachResponses(svc: SupabaseClient, rows: any[], viewerId?: string | null): Promise<PublicReport[]> {
  if (rows.length === 0) return [];
  const { data: responses } = await svc
    .from('company_report_responses')
    .select('report_id, responder_name, body, disputes, created_at, updated_at')
    .in('report_id', rows.map((r) => r.id));
  const byReport = new Map((responses || []).map((r: any) => [r.report_id, r]));
  return rows.map((r) => toPublicReport(r, byReport.get(r.id), viewerId));
}

// Published reports about one carrier or broker, newest first, with the
// score they add. null when reports can't be read (not configured, or the
// tables aren't there yet), so callers treat it as "not checked".
export async function publishedReportsFor(
  ids: { mc?: string | null; dot?: string | null },
  viewerId?: string | null,
): Promise<{ reports: PublicReport[]; score: ReportScore } | null> {
  const svc = getServiceSupabase();
  const mc = digits(ids.mc);
  const dot = digits(ids.dot);
  if (!svc || (!mc && !dot)) return null;
  // A company is its USDOT number. The MC is used only for reports saved
  // without one, so a report object carrying a wrong or outdated MC can never
  // pull in another company's reports.
  const or = dot
    ? [`subject_dot.eq.${dot}`, mc ? `and(subject_dot.is.null,subject_mc.eq.${mc})` : null].filter(Boolean).join(',')
    : `subject_mc.eq.${mc}`;
  const { data, error } = await svc
    .from('company_reports')
    .select(REPORT_COLUMNS)
    .eq('status', 'published')
    .or(or)
    .order('published_at', { ascending: false })
    .limit(200);
  if (error) return null;
  const rows = data || [];
  return { reports: await attachResponses(svc, rows, viewerId), score: scoreReports(rows as any[]) };
}

export async function publishedReportsBySubjectKey(key: string, viewerId?: string | null): Promise<PublicReport[]> {
  const svc = getServiceSupabase();
  if (!svc) return [];
  const { data } = await svc.from('company_reports').select(REPORT_COLUMNS).eq('status', 'published').eq('subject_key', key).order('published_at', { ascending: false }).limit(200);
  return attachResponses(svc, data || [], viewerId);
}

// The public company page shows how many published reports a company has.
// Rebuild it as soon as that number changes instead of waiting for its hourly
// refresh. Never fails the request that called it.
export function refreshCompanyPage(subject: { subject_mc?: string | null; subject_dot?: string | null }) {
  try {
    const mc = digits(subject.subject_mc);
    const dot = digits(subject.subject_dot);
    if (mc) revalidatePath(`/company/mc-${mc}`);
    if (dot) revalidatePath(`/company/dot-${dot}`);
  } catch {}
}

export type ReportSubjectHit = {
  key: string;
  type: 'carrier' | 'broker' | 'shipper';
  name: string;
  mc: string | null;
  dot: string | null;
  city: string | null;
  state: string | null;
  count: number;       // published reports about this company
  latest: string | null;
};

// Companies that already have published reports, matched by name, MC or USDOT
// number as the user types. This is the only way to find a shipper, since
// shippers aren't in FMCSA's records. Companies only: reporters (drivers
// included) are never searchable by name.
export async function searchReportSubjects(raw: string, type?: 'carrier' | 'broker' | 'shipper'): Promise<ReportSubjectHit[]> {
  const svc = getServiceSupabase();
  const q = String(raw || '').trim().slice(0, 80);
  if (!svc || q.length < 3) return [];
  const cols = 'id, subject_key, subject_type, subject_name, subject_mc, subject_dot, subject_city, subject_state, published_at';
  const base = () => {
    const query = svc.from('company_reports').select(cols).eq('status', 'published');
    return (type ? query.eq('subject_type', type) : query).order('published_at', { ascending: false }).limit(300);
  };

  const pinned = q.match(/^(MC|U?S?DOT)[\s#-]*(\d+)$/i);
  const number = pinned ? pinned[2] : /^[\d\s#-]+$/.test(q) ? q.replace(/\D/g, '') : '';
  let rows: any[] = [];
  if (pinned || number) {
    const d = number.replace(/^0+/, '');
    if (d.length < 3) return [];
    const wantMc = !pinned || /^MC/i.test(pinned[1]);
    const wantDot = !pinned || !/^MC/i.test(pinned[1]);
    const results = await Promise.all([
      wantMc ? base().like('subject_mc', `${d}%`) : null,
      wantDot ? base().like('subject_dot', `${d}%`) : null,
    ]);
    rows = results.flatMap((r) => r?.data || []);
  } else {
    // Pattern characters out, so the text is matched as typed.
    const name = q.replace(/[%_*\\(),]/g, ' ').replace(/\s+/g, ' ').trim();
    if (name.length < 3) return [];
    const { data } = await base().ilike('subject_name', `%${name}%`);
    rows = data || [];
  }

  const seen = new Set<string>();
  const bySubject = new Map<string, ReportSubjectHit>();
  for (const r of rows) {
    if (seen.has(r.id)) continue; // matched on both MC and USDOT
    seen.add(r.id);
    const hit = bySubject.get(r.subject_key);
    if (hit) { hit.count += 1; continue; }
    bySubject.set(r.subject_key, {
      key: r.subject_key,
      type: r.subject_type,
      name: r.subject_name,
      mc: r.subject_mc || null,
      dot: r.subject_dot || null,
      city: r.subject_city || null,
      state: r.subject_state || null,
      count: 1,
      latest: r.published_at || null,
    });
  }
  return [...bySubject.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 8);
}

export async function recentPublishedReports(limit: number, viewerId?: string | null): Promise<PublicReport[]> {
  const svc = getServiceSupabase();
  if (!svc) return [];
  const { data } = await svc.from('company_reports').select(REPORT_COLUMNS).eq('status', 'published').order('published_at', { ascending: false }).limit(limit);
  return attachResponses(svc, data || [], viewerId);
}

export async function reportsByUser(userId: string): Promise<PublicReport[]> {
  const svc = getServiceSupabase();
  if (!svc) return [];
  const { data } = await svc.from('company_reports').select(REPORT_COLUMNS).eq('reporter_user_id', userId).order('created_at', { ascending: false }).limit(200);
  return attachResponses(svc, data || [], userId);
}

export type ResolvedCompany = { name: string; mc: string | null; dot: string | null; role: 'carrier' | 'broker' | 'both' | 'none' | 'dot-only' };

// The company FMCSA has for an MC or USDOT number: its registered name and
// whether it holds carrier and/or broker authority. Reports name companies
// as FMCSA does, never as the reporter typed them.
export async function resolveCompany(ids: { mc?: string | null; dot?: string | null }): Promise<ResolvedCompany | null> {
  const mc = digits(ids.mc);
  const dot = digits(ids.dot);
  if (!mc && !dot) return null;
  const { suggestCompanies } = await import('./company-search');
  const { dotForMc, fetchCensusContact } = await import('./fmcsa-census');
  try {
    const list = await suggestCompanies(mc ? `MC-${mc}` : `DOT-${dot}`);
    const hit = list.find((s) => (mc ? s.mc === mc : s.dot === dot));
    if (hit) {
      return { name: hit.name, mc: hit.mc || null, dot: hit.dot || (hit.mc ? await dotForMc(hit.mc) : null), role: hit.role };
    }
  } catch {
    // fall through to the census
  }
  const usdot = dot || (mc ? await dotForMc(mc) : null);
  const census = usdot ? await fetchCensusContact(usdot) : null;
  if (!census?.legalName) return null;
  return { name: census.legalName, mc: mc || null, dot: usdot, role: mc ? 'none' : 'dot-only' };
}

export async function logReportEvent(svc: SupabaseClient, reportId: string, actor: string | null | undefined, action: string, note?: string | null): Promise<void> {
  await svc.from('company_report_events').insert({ report_id: reportId, actor: actor || null, action, note: note || null });
}

// Report alerts, a paid-plan feature: when a report is published, email the
// accounts that monitor that company as their own or have it on their
// watchlist. Free accounts aren't emailed (the reported company still gets
// the one-time notice at its FMCSA email, so it can always reply). Returns
// how many emails went out; never throws.
export async function notifyReportWatchers(
  svc: SupabaseClient,
  report: { subject_mc: string | null; subject_dot: string | null; reporter_user_id: string | null },
  facts: import('./email').ReportEmailFacts,
): Promise<number> {
  try {
    const { isResendConfigured, sendEmail, reportAlertTemplate, getEmailSiteUrl } = await import('./email');
    if (!isResendConfigured()) return 0;
    const or = [report.subject_dot ? `dot.eq.${report.subject_dot}` : null, report.subject_mc ? `mc.eq.${report.subject_mc}` : null].filter(Boolean).join(',');
    if (!or) return 0;
    const { data: rows } = await svc.from('watchlist').select('user_id, data').or(or).limit(300);
    const own = new Map<string, boolean>();
    for (const r of (rows || []) as any[]) {
      if (r.user_id === report.reporter_user_id) continue;
      own.set(r.user_id, own.get(r.user_id) || r.data?.own === true);
    }
    const ids = Array.from(own.keys());
    if (ids.length === 0) return 0;
    const { currentPlansFor } = await import('./teams');
    const { isAdmin } = await import('./admin');
    const plans = await currentPlansFor(ids);
    const siteUrl = getEmailSiteUrl();
    let sent = 0;
    for (const id of ids) {
      const { data } = await svc.auth.admin.getUserById(id);
      const u = data?.user;
      if (!u?.email) continue;
      const paid = (plans.get(id) || 'free') !== 'free' || (await isAdmin(u.email));
      const meta: any = u.user_metadata || {};
      if (!paid || meta.notify_watchlist === false) continue;
      const to = typeof meta.notification_email === 'string' && meta.notification_email.trim() ? meta.notification_email.trim() : u.email;
      try {
        const tpl = reportAlertTemplate({ facts, own: own.get(id) === true, recipientEmail: to, siteUrl });
        await sendEmail({ to, subject: tpl.subject, html: tpl.html, kind: 'newsletter' });
        sent += 1;
      } catch (e: any) {
        console.warn('[reports] alert email failed', e?.message);
      }
    }
    return sent;
  } catch (e: any) {
    console.warn('[reports] alerts failed', e?.message);
    return 0;
  }
}

// Everything this account has proved about itself. All of it lives in
// app_metadata, which only the server can write.
export function reporterIdentities(user: User): ReporterIdentity[] {
  const out: ReporterIdentity[] = [];
  const company = currentVerification(user);
  if (company) out.push({ kind: 'company', mc: company.mc, dot: company.dot, verifiedBy: company.by, at: company.at });
  const meta: any = user.app_metadata || {};
  const d = meta.driver_verification as DriverVerification | undefined;
  if (d?.name && d.at) out.push({ kind: 'driver', name: d.name, state: d.state ?? null, verifiedBy: 'identity', at: d.at });
  const s = meta.shipper_verification as ShipperVerification | undefined;
  if (s?.company && s.domain && s.at) out.push({ kind: 'shipper', company: s.company, domain: s.domain, verifiedBy: 'work_email', at: s.at });
  return out;
}
