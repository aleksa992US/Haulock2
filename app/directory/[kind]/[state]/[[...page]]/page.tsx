import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Breadcrumbs, DirectoryFooter, DirectoryHeader } from '@/components/directory/Chrome';
import DirectorySearch from '@/components/directory/DirectorySearch';
import { listCompanies } from '@/lib/directory';
import { companyPath, isDirectoryKind, KIND_LABEL, stateByCode, statePath } from '@/lib/directory-links';

// Built the first time someone opens it, then kept for a day.
export const revalidate = 86400;
export const dynamicParams = true;
export function generateStaticParams() {
  return [];
}

type Params = { kind: string; state: string; page?: string[] };

// /directory/brokers/tx is page 1; /directory/brokers/tx/2 is page 2.
// Anything else (tx/1, tx/02, tx/2/3, tx/abc) doesn't exist.
function pageNumber(seg: string[] | undefined): number | null {
  if (!seg || seg.length === 0) return 1;
  if (seg.length > 1 || !/^[1-9]\d{0,4}$/.test(seg[0])) return null;
  const n = Number(seg[0]);
  return n >= 2 ? n : null;
}

export function generateMetadata({ params }: { params: Params }): Metadata {
  const state = stateByCode(params.state);
  const page = pageNumber(params.page);
  if (!isDirectoryKind(params.kind) || !state || !page) return {};
  const k = KIND_LABEL[params.kind];
  return {
    title: `${k.title} in ${state.name}${page > 1 ? `, page ${page}` : ''}`,
    description: `${k.title} in ${state.name} with active FMCSA operating authority, with MC and USDOT numbers. Open a company to see its authority and the reports filed about it on Haulock.`,
    alternates: { canonical: statePath(params.kind, state.code, page) },
  };
}

function pageLinks(page: number, pages: number): (number | '…')[] {
  const keep = new Set([1, 2, pages - 1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  sorted.forEach((n, i) => { if (i > 0 && n - sorted[i - 1] > 1) out.push('…'); out.push(n); });
  return out;
}

export default async function StatePage({ params }: { params: Params }) {
  const state = stateByCode(params.state);
  const page = pageNumber(params.page);
  if (!isDirectoryKind(params.kind) || !state || !page) notFound();
  // Lower-case state codes only, so each list has one address.
  if (params.state !== state.code.toLowerCase()) notFound();
  const kind = params.kind;
  const k = KIND_LABEL[kind];
  const data = await listCompanies(kind, state.code, page);
  if (!data) notFound();
  return (
    <div className="min-h-screen bg-[#F5F3EE] text-[#0B1E3F]">
      <DirectoryHeader />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 pt-8">
        <Breadcrumbs items={[{ label: 'Directory', href: '/directory' }, { label: k.title, href: `/directory/${kind}` }, { label: state.name }]} />
        <h1 className="text-4xl md:text-5xl leading-[1.05] tracking-tight mt-5">{k.title} in <span className="serif italic">{state.name}</span></h1>
        <p className="text-[#0B1E3F]/65 mt-4 max-w-3xl">
          {data.total.toLocaleString('en-US')} {k.plural} in {state.name} hold active FMCSA operating authority. Open a company to see its authority and whether anyone has reported it.
        </p>
        <div className="mt-6 max-w-2xl"><DirectorySearch /></div>

        <div className="mt-8 bg-white rounded-2xl border border-[#0B1E3F]/10 card-shadow overflow-hidden">
          <div className="hidden sm:grid grid-cols-[1fr_130px_130px_180px] gap-4 px-5 py-3 text-[10px] mono uppercase tracking-wider text-[#0B1E3F]/50 border-b border-[#0B1E3F]/10 bg-[#F5F3EE]/60">
            <span>Company</span><span>MC number</span><span>USDOT number</span><span>City</span>
          </div>
          <ul>
            {data.rows.map((r) => (
              <li key={r.mc} className="border-b border-[#0B1E3F]/[0.06] last:border-0">
                <a href={companyPath(r) || '#'} className="grid sm:grid-cols-[1fr_130px_130px_180px] gap-x-4 gap-y-0.5 px-5 py-3 hover:bg-[#0B1E3F]/[0.03]">
                  <span className="font-medium text-[#0B1E3F] min-w-0 truncate">{r.name}</span>
                  <span className="text-sm mono text-[#0B1E3F]/65">MC-{r.mc}</span>
                  <span className="text-sm mono text-[#0B1E3F]/65">{r.dot ? `DOT-${r.dot}` : ''}</span>
                  <span className="text-sm text-[#0B1E3F]/65 truncate">{r.city ? `${r.city}, ${r.state || state.code}` : ''}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>

        {data.pages > 1 && (
          <nav aria-label="Pages" className="mt-6 flex flex-wrap items-center justify-center gap-1.5 text-sm">
            {page > 1 && <a href={statePath(kind, state.code, page - 1)} rel="prev" className="px-3 py-1.5 rounded-full border border-[#0B1E3F]/15 bg-white hover:border-[#0B1E3F]/40">Previous</a>}
            {pageLinks(page, data.pages).map((n, i) => n === '…'
              ? <span key={`gap-${i}`} className="px-1 text-[#0B1E3F]/40">…</span>
              : n === page
                ? <span key={n} aria-current="page" className="px-3 py-1.5 rounded-full bg-[#0B1E3F] text-white">{n}</span>
                : <a key={n} href={statePath(kind, state.code, n)} className="px-3 py-1.5 rounded-full border border-[#0B1E3F]/15 bg-white hover:border-[#0B1E3F]/40">{n}</a>)}
            {page < data.pages && <a href={statePath(kind, state.code, page + 1)} rel="next" className="px-3 py-1.5 rounded-full border border-[#0B1E3F]/15 bg-white hover:border-[#0B1E3F]/40">Next</a>}
          </nav>
        )}
      </main>
      <DirectoryFooter />
    </div>
  );
}
