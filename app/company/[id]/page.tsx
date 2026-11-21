import type { Metadata } from 'next';
import { REPORTS_ON } from '@/lib/features';
import { notFound } from 'next/navigation';
import { AlertTriangle, Building2, CheckCircle2, Lock, ShieldCheck } from 'lucide-react';
import { Breadcrumbs, DirectoryFooter, DirectoryHeader } from '@/components/directory/Chrome';
import { SafetyCheckButton, type ActionCompany } from '@/components/directory/CompanyActions';
import ReportsSummary from '@/components/directory/ReportsSummary';
import { getCompany, type PublicCompany } from '@/lib/directory';
import { companyPath, KIND_LABEL, parseCompanyId, roleLabel, stateByCode, statePath, type DirectoryKind } from '@/lib/directory-links';
import { publishedReportsFor } from '@/lib/reports-server';

// A public page for one broker or carrier: /company/mc-123456 or
// /company/dot-1234567. What it shows is free on purpose and stops there:
// registry facts (name, numbers, city, authority) and how many reports the
// company has. Report text needs a (free) account; the safety check is the
// paid product and is only described here.
//
// Built the first time someone opens it, kept for an hour, and rebuilt
// straight away when a report about the company is published or withdrawn.
export const revalidate = 3600;
export const dynamicParams = true;
export function generateStaticParams() {
  return [];
}

type Params = { id: string };

async function load(id: string): Promise<PublicCompany | null> {
  const parsed = parseCompanyId(id);
  if (!parsed) return null;
  return getCompany(parsed);
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://haulock.com';
const idText = (c: PublicCompany) => [c.mc && `MC-${c.mc}`, c.dot && `USDOT-${c.dot}`].filter(Boolean).join(', ');
const placeText = (c: PublicCompany) => (c.city ? `${c.city}${c.state ? `, ${c.state}` : ''}` : c.state || '');
const noun = (c: PublicCompany) => (c.role === 'both' ? 'carrier and freight broker' : c.role === 'broker' ? 'freight broker' : c.role === 'none' ? 'company' : 'trucking company');

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  let c: PublicCompany | null = null;
  try { c = await load(params.id); } catch { return { title: 'Company record', robots: { index: false } }; }
  if (!c) return { title: 'Company not found', robots: { index: false } };
  const place = placeText(c);
  const title = `${c.name} (${c.mc ? `MC-${c.mc}` : `USDOT-${c.dot}`}): ${noun(c)}${place ? ` in ${place}` : ''}`;
  const description = `${c.name} is a ${noun(c)}${place ? ` in ${place}` : ''} (${idText(c)}). See its FMCSA operating authority and whether carriers, brokers or shippers have reported it on Haulock.`;
  const canonical = companyPath(c) || `/company/${params.id.toLowerCase()}`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { url: canonical, title: `${title} · Haulock`, description },
    // Companies with no active authority can be opened, but aren't offered to search engines.
    robots: c.active ? undefined : { index: false, follow: true },
  };
}

const btnOrange = 'px-5 py-2.5 bg-[#FF6B35] text-white rounded-full text-sm font-semibold hover:bg-[#FF6B35]/90 transition';

function Status({ on, label }: { on: boolean; label: string }) {
  return on
    ? <span className="inline-flex items-center gap-1.5 text-[#16A34A] font-medium"><CheckCircle2 className="w-4 h-4" /> {label}</span>
    : <span className="inline-flex items-center gap-1.5 text-[#0B1E3F]/55">Not active</span>;
}

export default async function CompanyPage({ params }: { params: Params }) {
  if (!REPORTS_ON) notFound(); // the directory is off with Reports (lib/features.ts)
  const c = await load(params.id);
  if (!c) notFound();

  // null = reports couldn't be read; the page then makes no claim either way.
  let reports: { published: number; open: number } | null = null;
  try {
    const r = await publishedReportsFor({ mc: c.mc, dot: c.dot });
    if (r) reports = { published: r.score.published, open: r.score.open };
  } catch {}

  const kind: DirectoryKind = c.brokerActive && !c.carrierActive ? 'brokers' : 'carriers';
  const state = stateByCode(c.state);
  const place = placeText(c);
  const action: ActionCompany = { mc: c.mc, dot: c.dot, name: c.name, city: c.city, state: c.state, role: c.role };
  const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const sourceName = c.source === 'motus' ? 'FMCSA Motus' : c.source === 'registry' ? 'FMCSA licensing records' : 'FMCSA company census';
  // The site layout already describes Haulock itself as an Organization on
  // every page, so this says the page is *about* a different company.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    url: `${SITE_URL}${companyPath(c) || ''}`,
    name: `${c.name} (${c.mc ? `MC-${c.mc}` : `USDOT-${c.dot}`})`,
    about: {
      '@type': 'Organization',
      name: c.name,
      ...(c.dba ? { alternateName: c.dba } : {}),
      identifier: [
        ...(c.mc ? [{ '@type': 'PropertyValue', propertyID: 'MC number', value: c.mc }] : []),
        ...(c.dot ? [{ '@type': 'PropertyValue', propertyID: 'USDOT number', value: c.dot }] : []),
      ],
      ...(c.city || c.state ? { address: { '@type': 'PostalAddress', ...(c.city ? { addressLocality: c.city } : {}), ...(c.state ? { addressRegion: c.state } : {}), addressCountry: 'US' } } : {}),
    },
  };

  return (
    <div className="min-h-screen bg-[#F5F3EE] text-[#0B1E3F]">
      <DirectoryHeader />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 pt-8">
        <Breadcrumbs items={[
          { label: 'Directory', href: '/directory' },
          { label: KIND_LABEL[kind].title, href: `/directory/${kind}` },
          ...(state && c.active && c.role !== 'dot-only' ? [{ label: state.name, href: statePath(kind, state.code) }] : []),
          { label: c.name },
        ]} />

        <header className="mt-6 flex items-start gap-4">
          <div className="w-14 h-14 rounded-2xl bg-[#0B1E3F] flex items-center justify-center shrink-0"><Building2 className="w-7 h-7 text-white" /></div>
          <div className="min-w-0">
            <h1 className="text-3xl md:text-4xl leading-tight tracking-tight break-words">{c.name}</h1>
            {c.dba && c.dba.toUpperCase() !== c.name.toUpperCase() && <div className="text-[#0B1E3F]/60 mt-1">Also operates as {c.dba}</div>}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs mono uppercase tracking-wider">
              <span className="px-2.5 py-1 rounded-full bg-white border border-[#0B1E3F]/15">{roleLabel(c.role)}</span>
              {c.mc && <span className="px-2.5 py-1 rounded-full bg-white border border-[#0B1E3F]/15">MC-{c.mc}</span>}
              {c.dot && <span className="px-2.5 py-1 rounded-full bg-white border border-[#0B1E3F]/15">USDOT-{c.dot}</span>}
              {place && <span className="px-2.5 py-1 rounded-full bg-white border border-[#0B1E3F]/15">{place}</span>}
            </div>
          </div>
        </header>

        <div className="mt-8 grid lg:grid-cols-5 gap-6 items-start">
          {/* ---- free: registry facts ---- */}
          <section className="lg:col-span-2 bg-white rounded-2xl border border-[#0B1E3F]/10 card-shadow p-6">
            <h2 className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/55">FMCSA record</h2>
            <dl className="mt-4 divide-y divide-[#0B1E3F]/[0.06] text-sm">
              <div className="flex justify-between gap-4 py-2.5"><dt className="text-[#0B1E3F]/60">Legal name</dt><dd className="font-medium text-right break-words min-w-0">{c.name}</dd></div>
              {c.mc && <div className="flex justify-between gap-4 py-2.5"><dt className="text-[#0B1E3F]/60">MC number</dt><dd className="font-medium mono">{c.mc}</dd></div>}
              {c.dot && <div className="flex justify-between gap-4 py-2.5"><dt className="text-[#0B1E3F]/60">USDOT number</dt><dd className="font-medium mono">{c.dot}</dd></div>}
              {place && <div className="flex justify-between gap-4 py-2.5"><dt className="text-[#0B1E3F]/60">Location</dt><dd className="font-medium text-right">{place}</dd></div>}
              {c.role === 'dot-only' ? (
                <div className="flex justify-between gap-4 py-2.5"><dt className="text-[#0B1E3F]/60">USDOT status</dt><dd><Status on={c.active} label="Active" /></dd></div>
              ) : (
                <>
                  <div className="flex justify-between gap-4 py-2.5"><dt className="text-[#0B1E3F]/60">Carrier authority</dt><dd><Status on={c.carrierActive} label="Active" /></dd></div>
                  <div className="flex justify-between gap-4 py-2.5"><dt className="text-[#0B1E3F]/60">Broker authority</dt><dd><Status on={c.brokerActive} label="Active" /></dd></div>
                </>
              )}
            </dl>
            {c.role === 'dot-only' && (
              <p className="mt-4 text-sm text-[#0B1E3F]/65 leading-relaxed">This company has a USDOT number and no MC docket, so FMCSA has no interstate operating authority on file for it. That is normal for private fleets and for carriers that only haul inside one state.</p>
            )}
            {c.role === 'none' && (
              <p className="mt-4 text-sm text-[#B45309] leading-relaxed flex items-start gap-2"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> FMCSA&apos;s record shows no active carrier or broker authority for this company.</p>
            )}
            <p className="mt-4 text-xs text-[#0B1E3F]/45">From {sourceName}, read on {today}.</p>
          </section>

          <div className="lg:col-span-3 space-y-6">
            {/* ---- free with an account: reports ---- */}
            <ReportsSummary name={c.name} action={action} reports={reports} />

            {/* ---- paid: the safety check ---- */}
            <section className="bg-[#0B1E3F] text-white rounded-2xl card-shadow p-6">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xs mono uppercase tracking-wider text-white/55">Safety check</h2>
                <span className="px-2 py-0.5 rounded-full bg-[#FF6B35] text-white text-[10px] mono uppercase tracking-wider">Paid plans</span>
              </div>
              <div className="mt-4 flex items-start gap-3">
                <div className="w-11 h-11 rounded-xl bg-[#FF6B35] flex items-center justify-center shrink-0"><ShieldCheck className="w-5 h-5 text-white" /></div>
                <div>
                  <div className="text-lg font-semibold">Is {c.name} safe to work with?</div>
                  <p className="text-sm text-white/70 mt-1">The registry facts on this page are the start. The safety check reads the rest of the record and scores it.</p>
                </div>
              </div>
              <ul className="mt-5 grid sm:grid-cols-2 gap-x-6 gap-y-2.5 text-sm text-white/85">
                {[
                  'Haulock risk score',
                  'Insurance on file, with cancellation dates',
                  'Inspections, crashes and out-of-service rates',
                  'Last FMCSA audit and safety rating',
                  'Motus compared with the older FMCSA record',
                  'Website, phone, address and web reputation checks',
                ].map((t) => (
                  <li key={t} className="flex items-start gap-2"><Lock className="w-3.5 h-3.5 mt-1 text-[#FF6B35] shrink-0" /> {t}</li>
                ))}
              </ul>
              <div className="mt-6 flex flex-wrap items-center gap-2">
                <SafetyCheckButton company={action} className={btnOrange} />
                <a href="/pricing" className="px-5 py-2.5 border border-white/25 rounded-full text-sm font-medium text-white hover:bg-white/10 transition">See plans</a>
              </div>
              <p className="mt-4 text-xs text-white/50">3 checks a month on the Free plan. Unlimited on paid plans.</p>
            </section>

            <section className="rounded-2xl border border-[#0B1E3F]/10 bg-white/60 p-6">
              <h2 className="font-semibold">Is this your company?</h2>
              <p className="text-sm text-[#0B1E3F]/65 mt-1 leading-relaxed">
                Verify it for free with a code sent to the email on your FMCSA filing, and you can reply to any report about it. Paid plans add an email the moment a report about your company is published.
              </p>
              <a href="/signup" className="inline-block mt-3 text-sm font-medium underline">Create a free account</a>
            </section>
          </div>
        </div>
      </main>
      <DirectoryFooter />
    </div>
  );
}
