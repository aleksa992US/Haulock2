import { DRIVER_REPORTS_ON, REPORTS_ON } from '@/lib/features';
import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getServerSupabase } from '@/lib/supabase/server';
import { getServiceSupabase } from '@/lib/supabase/service';
import { checkSimpleRateLimit } from '@/lib/rate-limit';
import {
  EVIDENCE_MAX_BYTES, EVIDENCE_MAX_FILES, EVIDENCE_TYPES, ROLE_LABEL,
  reporterKey, subjectKey, validateReportInput,
  type ReporterRole, type SubjectType,
} from '@/lib/reports';
import {
  logReportEvent, publishedReportsBySubjectKey, publishedReportsFor, recentPublishedReports, reporterIdentities, reportsByUser, resolveCompany, searchReportSubjects,
} from '@/lib/reports-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Verified reports. Free for every signed-in account.
//   GET ?mc=&dot=      → published reports about that carrier/broker + score
//   GET ?subject=<key> → published reports about a shipper
//   GET ?search=<text> → companies that already have published reports (type-ahead)
//   GET ?mine=1        → the caller's own reports, any status
//   GET                → latest published reports
//   POST (multipart)   → file a report; goes to an admin before it's shown

async function signedIn() {
  const supabase = getServerSupabase();
  if (!supabase) return { error: NextResponse.json({ error: 'Supabase not configured' }, { status: 500 }) };
  const { data } = await supabase.auth.getUser();
  if (!data?.user) return { error: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
  return { user: data.user };
}

export async function GET(req: Request) {
  if (!REPORTS_ON) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const s = await signedIn();
  if ('error' in s) return s.error;
  const { user } = s;
  if (!getServiceSupabase()) return NextResponse.json({ error: 'Reports aren’t set up on this server yet.', code: 'not_configured' }, { status: 503 });

  const { searchParams } = new URL(req.url);
  if (searchParams.get('mine') === '1') return NextResponse.json({ reports: await reportsByUser(user.id) });
  const search = searchParams.get('search');
  if (search !== null) {
    const rl = checkSimpleRateLimit({ bucket: 'report-search', identity: user.id, max: 120, windowMs: 60_000 });
    if (!rl.ok) return NextResponse.json({ subjects: [], rateLimited: true }, { status: 429 });
    const type = searchParams.get('type');
    return NextResponse.json({ subjects: await searchReportSubjects(search, type === 'shipper' || type === 'broker' || type === 'carrier' ? type : undefined) });
  }
  const subject = searchParams.get('subject');
  if (subject) return NextResponse.json({ reports: await publishedReportsBySubjectKey(subject.slice(0, 200), user.id) });
  const mc = searchParams.get('mc');
  const dot = searchParams.get('dot');
  if (mc || dot) {
    const r = await publishedReportsFor({ mc, dot }, user.id);
    if (!r) return NextResponse.json({ reports: [], score: null, unavailable: true });
    return NextResponse.json(r);
  }
  return NextResponse.json({ reports: await recentPublishedReports(50, user.id) });
}

const str = (v: FormDataEntryValue | null, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const safeFileName = (name: string) => name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+/, '').slice(-80) || 'document';

export async function POST(req: Request) {
  if (!REPORTS_ON) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const s = await signedIn();
  if ('error' in s) return s.error;
  const { user } = s;
  const svc = getServiceSupabase();
  if (!svc) return NextResponse.json({ error: 'Reports aren’t set up on this server yet.', code: 'not_configured' }, { status: 503 });

  const rl = checkSimpleRateLimit({ bucket: 'report-create', identity: user.id, max: 5, windowMs: 24 * 60 * 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'You can file up to 5 reports a day. Try again tomorrow.' }, { status: 429 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Couldn’t read the form. Files can be up to 10 MB each.' }, { status: 400 });
  }

  const reporterRole = str(form.get('reporterRole'), 20) as ReporterRole;
  const subjectType = str(form.get('subjectType'), 20) as SubjectType;
  if (!ROLE_LABEL[reporterRole]) return NextResponse.json({ error: 'Choose who you’re reporting as.' }, { status: 400 });

  // ---- Who is reporting: must be verified for the role they pick ----
  const identities = reporterIdentities(user);
  let reporter: { name: string; mc: string | null; dot: string | null; key: string; verifiedBy: string };
  if (reporterRole === 'carrier' || reporterRole === 'broker') {
    const id = identities.find((i) => i.kind === 'company');
    if (!id || id.kind !== 'company') return NextResponse.json({ error: 'Verify your company first.', code: 'not_verified' }, { status: 403 });
    const company = await resolveCompany({ mc: id.mc, dot: id.dot });
    if (!company) return NextResponse.json({ error: 'We couldn’t reach FMCSA’s records for your company. Try again in a minute.' }, { status: 503 });
    const isCarrier = company.role === 'carrier' || company.role === 'both' || company.role === 'dot-only';
    const isBroker = company.role === 'broker' || company.role === 'both';
    if ((reporterRole === 'carrier' && !isCarrier) || (reporterRole === 'broker' && !isBroker)) {
      return NextResponse.json({ error: `FMCSA doesn’t show active ${reporterRole} authority for ${company.name}, so it can’t report as a ${reporterRole}.` }, { status: 400 });
    }
    const dot = company.dot || id.dot;
    reporter = { name: company.name, mc: company.mc || id.mc, dot, key: reporterKey({ role: reporterRole, dot, mc: company.mc || id.mc }), verifiedBy: id.verifiedBy };
  } else if (reporterRole === 'driver') {
    if (!DRIVER_REPORTS_ON) return NextResponse.json({ error: 'Driver reports aren’t available.', code: 'driver_reports_off' }, { status: 403 });
    const id = identities.find((i) => i.kind === 'driver');
    if (!id || id.kind !== 'driver') return NextResponse.json({ error: 'Verify your identity as a driver first.', code: 'not_verified' }, { status: 403 });
    reporter = { name: id.name, mc: null, dot: null, key: reporterKey({ role: 'driver', userId: user.id }), verifiedBy: id.verifiedBy };
  } else {
    const id = identities.find((i) => i.kind === 'shipper');
    if (!id || id.kind !== 'shipper') return NextResponse.json({ error: 'Verify your company as a shipper first.', code: 'not_verified' }, { status: 403 });
    reporter = { name: id.company, mc: null, dot: null, key: reporterKey({ role: 'shipper', domain: id.domain }), verifiedBy: id.verifiedBy };
  }

  // ---- Who it's about ----
  let subject: { name: string; mc: string | null; dot: string | null; city: string | null; state: string | null; key: string };
  if (subjectType === 'shipper') {
    const name = str(form.get('subjectName'), 120);
    const city = str(form.get('subjectCity'), 80);
    const state = str(form.get('subjectState'), 2).toUpperCase();
    if (name.length < 3) return NextResponse.json({ error: 'Enter the shipper’s company name.' }, { status: 400 });
    if (!city || !/^[A-Z]{2}$/.test(state)) return NextResponse.json({ error: 'Enter the shipper’s city and 2-letter state.' }, { status: 400 });
    subject = { name, mc: null, dot: null, city, state, key: subjectKey({ type: 'shipper', name, state }) };
  } else if (subjectType === 'carrier' || subjectType === 'broker') {
    const company = await resolveCompany({ mc: str(form.get('subjectMc'), 12), dot: str(form.get('subjectDot'), 12) });
    if (!company) return NextResponse.json({ error: 'We couldn’t find that MC or DOT number in FMCSA’s records. Pick the company from the search.' }, { status: 400 });
    if (reporter.dot && company.dot && reporter.dot === company.dot) return NextResponse.json({ error: 'You can’t report your own company.' }, { status: 400 });
    subject = { name: company.name, mc: company.mc, dot: company.dot, city: null, state: null, key: subjectKey({ type: subjectType, dot: company.dot, mc: company.mc }) };
  } else {
    return NextResponse.json({ error: 'Choose who you’re reporting.' }, { status: 400 });
  }

  // ---- What happened ----
  const files = form.getAll('evidence').filter((f): f is File => typeof f !== 'string' && f.size > 0);
  // Drivers: proof they drove for the company, and whether to withhold their name.
  const proofFiles = reporterRole === 'driver' ? form.getAll('proof').filter((f): f is File => typeof f !== 'string' && f.size > 0) : [];
  const anonymous = form.get('anonymous') === 'yes';
  const amountRaw = str(form.get('amount'), 20).replace(/[$,\s]/g, '');
  const amount = amountRaw === '' ? null : Number(amountRaw);
  const input = {
    reporterRole,
    subjectType,
    category: str(form.get('category'), 40),
    loadRef: str(form.get('loadRef'), 60),
    incidentDate: str(form.get('incidentDate'), 10),
    amount,
    description: str(form.get('description'), 4000),
    attested: form.get('attested') === 'yes',
    evidenceCount: files.length,
    proofCount: proofFiles.length,
    anonymous,
  };
  const errors = validateReportInput(input);
  for (const f of [...files.slice(0, EVIDENCE_MAX_FILES), ...proofFiles.slice(0, EVIDENCE_MAX_FILES)]) {
    if (!EVIDENCE_TYPES.includes(f.type)) errors.push(`${f.name}: attach PDFs or photos (JPG, PNG).`);
    else if (f.size > EVIDENCE_MAX_BYTES) errors.push(`${f.name} is over 10 MB.`);
  }
  if (errors.length) return NextResponse.json({ error: errors[0], errors }, { status: 400 });

  // ---- Store the documents (private), then the report ----
  const id = randomUUID();
  type Stored = { path: string; name: string; type: string; size: number };
  const evidence: Stored[] = [];
  const proof: Stored[] = [];
  const cleanUp = async () => {
    const paths = [...evidence, ...proof].map((e) => e.path);
    if (paths.length) await svc.storage.from('report-evidence').remove(paths);
  };
  // Both kinds go in the same private bucket; proof files are prefixed so
  // the admin view can tell them apart.
  const store = async (list: File[], into: Stored[], prefix: string) => {
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      const path = `${id}/${prefix}${i + 1}-${safeFileName(f.name)}`;
      const { error } = await svc.storage.from('report-evidence').upload(path, Buffer.from(await f.arrayBuffer()), { contentType: f.type, upsert: false });
      if (error) {
        await cleanUp();
        console.error('[reports] evidence upload failed', error.message);
        return false;
      }
      into.push({ path, name: f.name.slice(0, 120), type: f.type, size: f.size });
    }
    return true;
  };
  if (!(await store(files, evidence, '')) || !(await store(proofFiles, proof, 'proof-'))) {
    return NextResponse.json({ error: 'We couldn’t save your documents. Try again in a minute.' }, { status: 500 });
  }

  const fwd = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  const { data: row, error } = await svc.from('company_reports').insert({
    id,
    reporter_user_id: user.id,
    reporter_role: reporterRole,
    reporter_name: reporter.name,
    reporter_mc: reporter.mc,
    reporter_dot: reporter.dot,
    reporter_key: reporter.key,
    reporter_verified_by: reporter.verifiedBy,
    subject_type: subjectType,
    subject_mc: subject.mc,
    subject_dot: subject.dot,
    subject_name: subject.name,
    subject_city: subject.city,
    subject_state: subject.state,
    subject_key: subject.key,
    category: input.category,
    load_ref: input.loadRef,
    incident_date: input.incidentDate,
    amount: input.amount,
    description: input.description.trim(),
    evidence,
    proof,
    reporter_anonymous: reporterRole === 'driver' && anonymous,
    attested_at: new Date().toISOString(),
    attested_ip: fwd || req.headers.get('x-real-ip') || null,
    status: 'pending',
  }).select('id, status, created_at').single();
  if (error) {
    await cleanUp();
    if ((error as any).code === '23505') return NextResponse.json({ error: 'You’ve already reported this load for this company.' }, { status: 409 });
    console.error('[reports] insert failed', error.message);
    return NextResponse.json({ error: 'We couldn’t save the report. Try again in a minute.' }, { status: 500 });
  }
  await logReportEvent(svc, id, user.email, 'submitted');
  return NextResponse.json({ ok: true, report: row });
}
