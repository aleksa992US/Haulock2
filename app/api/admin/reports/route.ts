import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { isAdmin } from '@/lib/admin';
import { fetchCensusContact } from '@/lib/fmcsa-census';
import { getEmailSiteUrl, isResendConfigured, reportDecisionTemplate, reportNoticeTemplate, sendEmail, type ReportEmailFacts } from '@/lib/email';
import { REPORT_COLUMNS, ROLE_LABEL, categoryLabel, toPublicReport, type ReporterRole } from '@/lib/reports';
import { logReportEvent, notifyReportWatchers, refreshCompanyPage } from '@/lib/reports-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Admin review of verified reports. Nothing is shown to other users until an
// admin publishes it. Admins approve or decline; they never edit a report's
// text (it has to stay the reporter's own statement).
//   GET ?status=pending|published|rejected|withdrawn → reports with their
//       documents (signed links, 15 minutes) and history
//   POST { id, action: 'publish' | 'reject' | 'unpublish', reason? }

async function admin() {
  const supabase = getServerSupabase();
  if (!supabase) return { error: NextResponse.json({ error: 'Supabase not configured' }, { status: 500 }) };
  const { data } = await supabase.auth.getUser();
  const me = data?.user;
  if (!me?.email || !(await isAdmin(me.email))) return { error: NextResponse.json({ error: 'Not authorized' }, { status: 403 }) };
  const svc = getServiceSupabase();
  if (!svc) return { error: NextResponse.json({ error: 'Service role not configured' }, { status: 500 }) };
  return { me, svc };
}

export async function GET(req: Request) {
  const a = await admin();
  if ('error' in a) return a.error;
  const { svc } = a;
  const { searchParams } = new URL(req.url);
  const status = ['pending', 'published', 'rejected', 'withdrawn'].includes(searchParams.get('status') || '') ? searchParams.get('status')! : 'pending';

  const [{ data: rows, error }, pendingCount] = await Promise.all([
    svc.from('company_reports').select(`${REPORT_COLUMNS}, attested_at, attested_ip, reviewed_by, reviewed_at`).eq('status', status).order('created_at', { ascending: status === 'pending' }).limit(100),
    svc.from('company_reports').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
  ]);
  if (error) {
    // 42P01: the tables aren't there yet.
    const missing = (error as any).code === '42P01' || /does not exist|schema cache/i.test(error.message);
    return NextResponse.json({ error: missing ? 'The report tables aren’t in the database yet. Run supabase/migrations/20261115_company_reports.sql.' : error.message, code: missing ? 'not_migrated' : undefined }, { status: missing ? 503 : 500 });
  }
  const list = rows || [];
  const ids = list.map((r: any) => r.id);
  const [{ data: responses }, { data: events }] = await Promise.all([
    ids.length ? svc.from('company_report_responses').select('report_id, responder_name, body, disputes, created_at, updated_at').in('report_id', ids) : Promise.resolve({ data: [] as any[] }),
    ids.length ? svc.from('company_report_events').select('report_id, actor, action, note, created_at').in('report_id', ids).order('created_at') : Promise.resolve({ data: [] as any[] }),
  ]);
  const responseBy = new Map((responses || []).map((r: any) => [r.report_id, r]));

  const out = [];
  for (const r of list as any[]) {
    const sign = async (list: any[]) => {
      const out = [];
      for (const e of Array.isArray(list) ? list : []) {
        const { data: signed } = await svc.storage.from('report-evidence').createSignedUrl(e.path, 15 * 60);
        out.push({ name: e.name, type: e.type, size: e.size, url: signed?.signedUrl || null });
      }
      return out;
    };
    const docs = await sign(r.evidence);
    const proofDocs = await sign(r.proof);
    let reporterEmail: string | null = null;
    if (r.reporter_user_id) {
      const { data: u } = await svc.auth.admin.getUserById(r.reporter_user_id);
      reporterEmail = u?.user?.email || null;
    }
    const pub = toPublicReport(r, responseBy.get(r.id));
    out.push({
      ...pub,
      // Admins see the real name; the public shape hides it for anonymous drivers.
      reporter: { ...pub.reporter, name: r.reporter_name, anonymous: Boolean(r.reporter_anonymous) },
      proofDocs,
      reporterEmail,
      reporterVerifiedBy: r.reporter_verified_by,
      attestedAt: r.attested_at,
      attestedIp: r.attested_ip,
      reviewedBy: r.reviewed_by,
      reviewedAt: r.reviewed_at,
      rejectReason: r.reject_reason,
      docs,
      events: (events || []).filter((ev: any) => ev.report_id === r.id),
    });
  }
  return NextResponse.json({ status, reports: out, pending: pendingCount.count || 0 });
}

export async function POST(req: Request) {
  const a = await admin();
  if ('error' in a) return a.error;
  const { me, svc } = a;
  const b = (await req.json().catch(() => null)) as { id?: string; action?: string; reason?: string } | null;
  const id = String(b?.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Report not found' }, { status: 404 });
  const { data: r } = await svc.from('company_reports').select(`${REPORT_COLUMNS}`).eq('id', id).maybeSingle();
  if (!r) return NextResponse.json({ error: 'Report not found' }, { status: 404 });
  const row: any = r;
  const now = new Date().toISOString();
  const reason = String(b?.reason || '').trim().slice(0, 500) || null;

  // The company and watchers see "A verified driver" when the driver withheld
  // their name; the driver's own emails use their name.
  const facts: ReportEmailFacts = {
    reporterName: row.reporter_anonymous ? 'A verified driver' : row.reporter_name,
    reporterRole: ROLE_LABEL[row.reporter_role as ReporterRole] || 'User',
    subjectName: row.subject_name,
    categoryLabel: categoryLabel(row.category),
    loadRef: row.load_ref,
    incidentDate: row.incident_date,
    amount: row.amount != null ? Number(row.amount) : null,
  };
  const siteUrl = getEmailSiteUrl();
  const emailReporter = async (published: boolean) => {
    if (!isResendConfigured() || !row.reporter_user_id) return;
    try {
      const { data: u } = await svc.auth.admin.getUserById(row.reporter_user_id);
      const to = u?.user?.email;
      if (!to) return;
      const tpl = reportDecisionTemplate({ facts: { ...facts, reporterName: row.reporter_name }, published, reason, siteUrl });
      await sendEmail({ to, subject: tpl.subject, html: tpl.html, kind: 'other' });
    } catch (e: any) {
      console.warn('[reports] reporter email failed', e?.message);
    }
  };

  if (b?.action === 'publish') {
    if (row.status !== 'pending' && row.status !== 'rejected') return NextResponse.json({ error: `This report is ${row.status}.` }, { status: 400 });
    const firstPublish = !row.published_at;
    const { error } = await svc.from('company_reports').update({ status: 'published', published_at: row.published_at || now, reviewed_by: me.email, reviewed_at: now, reject_reason: null }).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logReportEvent(svc, id, me.email, 'published');
    refreshCompanyPage(row);

    // Tell the reported company, at the email on its FMCSA filing, so it can
    // reply. Once per report; shippers have no FMCSA record to write to.
    let notified: string | null = null;
    if (firstPublish && isResendConfigured() && row.subject_dot) {
      try {
        const census = await fetchCensusContact(row.subject_dot);
        if (census?.email) {
          const tpl = reportNoticeTemplate({ facts, siteUrl });
          await sendEmail({ to: census.email, subject: tpl.subject, html: tpl.html, kind: 'other' });
          notified = census.email;
          await logReportEvent(svc, id, me.email, 'company_notified', census.email);
        }
      } catch (e: any) {
        console.warn('[reports] company notice failed', e?.message);
      }
    }
    let alerts = 0;
    if (firstPublish) {
      await emailReporter(true);
      // Paid report alerts: accounts monitoring or watching this company.
      alerts = await notifyReportWatchers(svc, row, facts);
    }
    return NextResponse.json({ ok: true, status: 'published', notified, alerts });
  }

  if (b?.action === 'reject' || b?.action === 'unpublish') {
    if (b.action === 'reject' && row.status !== 'pending') return NextResponse.json({ error: `This report is ${row.status}.` }, { status: 400 });
    if (b.action === 'unpublish' && row.status !== 'published') return NextResponse.json({ error: `This report is ${row.status}.` }, { status: 400 });
    if (!reason) return NextResponse.json({ error: 'Give the reason. The reporter sees it.' }, { status: 400 });
    const { error } = await svc.from('company_reports').update({ status: 'rejected', reviewed_by: me.email, reviewed_at: now, reject_reason: reason }).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logReportEvent(svc, id, me.email, b.action === 'reject' ? 'rejected' : 'unpublished', reason);
    refreshCompanyPage(row);
    await emailReporter(false);
    return NextResponse.json({ ok: true, status: 'rejected' });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
