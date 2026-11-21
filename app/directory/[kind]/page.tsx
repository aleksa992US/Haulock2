import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Breadcrumbs, DirectoryFooter, DirectoryHeader } from '@/components/directory/Chrome';
import DirectorySearch from '@/components/directory/DirectorySearch';
import { listStates, type StateCount } from '@/lib/directory';
import { isDirectoryKind, KIND_LABEL, statePath, US_STATES } from '@/lib/directory-links';

export const revalidate = 86400;
export function generateStaticParams() {
  return [{ kind: 'brokers' }, { kind: 'carriers' }];
}

export function generateMetadata({ params }: { params: { kind: string } }): Metadata {
  if (!isDirectoryKind(params.kind)) return {};
  const k = KIND_LABEL[params.kind];
  return {
    title: `${k.title} by state`,
    description: `Browse ${k.plural} with active FMCSA operating authority, state by state. Open any company to see its authority and the reports filed about it on Haulock.`,
    alternates: { canonical: `/directory/${params.kind}` },
  };
}

export default async function KindPage({ params }: { params: { kind: string } }) {
  if (!isDirectoryKind(params.kind)) notFound();
  const kind = params.kind;
  const k = KIND_LABEL[kind];
  let states: StateCount[];
  try { states = await listStates(kind); } catch { states = US_STATES.map((s) => ({ ...s, count: 0 })); }
  const total = states.reduce((n, s) => n + s.count, 0);
  return (
    <div className="min-h-screen bg-[#F5F3EE] text-[#0B1E3F]">
      <DirectoryHeader />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 pt-8">
        <Breadcrumbs items={[{ label: 'Directory', href: '/directory' }, { label: k.title }]} />
        <h1 className="text-4xl md:text-5xl leading-[1.05] tracking-tight mt-5">{k.title} <span className="serif italic">by state</span></h1>
        <p className="text-lg text-[#0B1E3F]/65 mt-4 max-w-3xl">
          {total > 0 ? `${total.toLocaleString('en-US')} ${k.plural}` : `Every ${k.singular}`} with active FMCSA operating authority, listed by the state on the FMCSA filing. Pick a state, or search for a company (free with an account).
        </p>
        <div className="mt-6 max-w-2xl"><DirectorySearch /></div>
        <ul className="mt-10 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {states.map((s) => (
            <li key={s.code}>
              <a href={statePath(kind, s.code)} className="block bg-white rounded-xl border border-[#0B1E3F]/10 px-4 py-3 hover:border-[#0B1E3F]/40 transition">
                <div className="font-medium">{s.name}</div>
                <div className="text-[11px] mono text-[#0B1E3F]/50 mt-0.5">{s.count > 0 ? `${s.count.toLocaleString('en-US')} ${kind}` : `${k.title}`}</div>
              </a>
            </li>
          ))}
        </ul>
      </main>
      <DirectoryFooter />
    </div>
  );
}
