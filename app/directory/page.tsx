import type { Metadata } from 'next';
import { REPORTS_ON } from '@/lib/features';
import { notFound } from 'next/navigation';
import { DirectoryFooter, DirectoryHeader, FreeVsPaid } from '@/components/directory/Chrome';
import DirectorySearch from '@/components/directory/DirectorySearch';
import { listStates, type StateCount } from '@/lib/directory';
import { statePath, US_STATES, type DirectoryKind } from '@/lib/directory-links';

// Rebuilt once a day; the counts come from FMCSA's open data.
export const revalidate = 86400;

export const metadata: Metadata = {
  title: 'Freight broker and carrier directory',
  description: 'Look up any freight broker or trucking company by name, MC or DOT number. See its FMCSA operating authority and whether carriers, brokers or shippers have reported it on Haulock.',
  alternates: { canonical: '/directory' },
  openGraph: { url: '/directory', title: 'Freight broker and carrier directory · Haulock', description: 'Every freight broker and carrier with FMCSA operating authority, with the reports filed about them.' },
};

// FMCSA being unreachable must not break the page (or a deploy): the states
// are still listed, without counts.
async function safeStates(kind: DirectoryKind): Promise<StateCount[]> {
  try { return await listStates(kind); } catch { return US_STATES.map((s) => ({ ...s, count: 0 })); }
}

function StateGrid({ kind, states }: { kind: DirectoryKind; states: StateCount[] }) {
  return (
    <ul className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 text-sm">
      {states.map((s) => (
        <li key={s.code}>
          <a href={statePath(kind, s.code)} className="group flex items-baseline justify-between gap-2 py-1 border-b border-[#0B1E3F]/[0.06] hover:border-[#0B1E3F]/30">
            <span className="text-[#0B1E3F] group-hover:underline truncate">{s.name}</span>
            {s.count > 0 && <span className="text-[11px] mono text-[#0B1E3F]/45 shrink-0">{s.count.toLocaleString('en-US')}</span>}
          </a>
        </li>
      ))}
    </ul>
  );
}

export default async function DirectoryPage() {
  if (!REPORTS_ON) notFound(); // the directory is off with Reports (lib/features.ts)
  const [brokers, carriers] = await Promise.all([safeStates('brokers'), safeStates('carriers')]);
  const total = (list: StateCount[]) => list.reduce((n, s) => n + s.count, 0);
  const brokerTotal = total(brokers);
  const carrierTotal = total(carriers);
  return (
    <div className="min-h-screen bg-[#F5F3EE] text-[#0B1E3F]">
      <DirectoryHeader />
      <main className="max-w-6xl mx-auto px-4 sm:px-6">
        <section className="pt-12 pb-10 text-center max-w-3xl mx-auto">
          <div className="text-xs mono uppercase tracking-[0.2em] text-[#FF6B35] mb-4">Directory · FMCSA and Motus records</div>
          <h1 className="text-4xl md:text-5xl leading-[1.05] tracking-tight">
            Find any freight broker or carrier. <span className="serif italic block">See if it&apos;s been reported.</span>
          </h1>
          <p className="text-lg text-[#0B1E3F]/65 mt-5">
            Search by company name, MC number or DOT number with a free account, or browse by state below. Every company page shows its operating authority and how many reports verified carriers, brokers and drivers have filed about it.
          </p>
          <div className="mt-8"><DirectorySearch /></div>
          {(brokerTotal > 0 || carrierTotal > 0) && (
            <p className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/45 mt-4">
              {brokerTotal.toLocaleString('en-US')} brokers · {carrierTotal.toLocaleString('en-US')} carriers with active authority in the US
            </p>
          )}
        </section>

        <section className="pb-12"><FreeVsPaid /></section>

        <section className="grid lg:grid-cols-2 gap-8 pb-6">
          <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 card-shadow p-6">
            <div className="flex items-baseline justify-between gap-3 mb-4">
              <h2 className="text-xl font-semibold">Freight brokers by state</h2>
              <a href="/directory/brokers" className="text-sm text-[#0B1E3F]/60 hover:text-[#0B1E3F] underline">All states</a>
            </div>
            <StateGrid kind="brokers" states={brokers} />
          </div>
          <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 card-shadow p-6">
            <div className="flex items-baseline justify-between gap-3 mb-4">
              <h2 className="text-xl font-semibold">Trucking companies by state</h2>
              <a href="/directory/carriers" className="text-sm text-[#0B1E3F]/60 hover:text-[#0B1E3F] underline">All states</a>
            </div>
            <StateGrid kind="carriers" states={carriers} />
          </div>
        </section>
      </main>
      <DirectoryFooter />
    </div>
  );
}
