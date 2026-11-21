import { REPORTERS_TEXT } from '@/lib/features';
import { CheckCircle2, Flag } from 'lucide-react';
import { ReadReportsButton, ReportCompanyButton, type ActionCompany } from './CompanyActions';

// The reports block on a public company page. It says how many published
// reports the company has, never what they say: reading them needs a (free)
// account. `reports` is null when the count couldn't be read, and then the
// page makes no claim either way.

const btnDark = 'px-5 py-2.5 bg-[#0B1E3F] text-white rounded-full text-sm font-semibold hover:bg-[#0B1E3F]/90 transition';
const btnLight = 'px-5 py-2.5 border border-[#0B1E3F]/15 bg-white rounded-full text-sm font-medium text-[#0B1E3F] hover:border-[#0B1E3F]/40 transition';

export default function ReportsSummary({ name, action, reports }: { name: string; action: ActionCompany; reports: { published: number; open: number } | null }) {
  return (
    <section className="bg-white rounded-2xl border border-[#0B1E3F]/10 card-shadow p-6">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/55">Reports on Haulock</h2>
        <span className="px-2 py-0.5 rounded-full bg-[#16A34A]/10 text-[#16A34A] text-[10px] mono uppercase tracking-wider">Free</span>
      </div>
      {reports === null ? (
        <>
          <div className="mt-4 flex items-start gap-3">
            <div className="w-11 h-11 rounded-xl bg-[#0B1E3F]/[0.06] flex items-center justify-center shrink-0"><Flag className="w-5 h-5 text-[#0B1E3F]/60" /></div>
            <div>
              <div className="text-lg font-semibold">Has anyone reported this company?</div>
              <p className="text-sm text-[#0B1E3F]/65 mt-1">Sign in with a free account to see the reports filed about {name.replace(/\.$/, '')}.</p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <ReadReportsButton company={action} label="Check for reports" className={btnDark} />
            <ReportCompanyButton company={action} className={btnLight} />
          </div>
        </>
      ) : reports.published > 0 ? (
        <>
          <div className="mt-4 flex items-start gap-4">
            <div className="w-14 h-14 rounded-xl bg-[#DC2626]/10 flex flex-col items-center justify-center shrink-0">
              <span className="text-2xl font-semibold leading-none text-[#DC2626]">{reports.published}</span>
            </div>
            <div>
              <div className="text-lg font-semibold">{reports.published} verified report{reports.published === 1 ? '' : 's'} filed about this company</div>
              <p className="text-sm text-[#0B1E3F]/65 mt-1">
                {reports.open === 0 ? 'All marked resolved by the reporter.' : reports.open === reports.published ? 'None marked resolved yet.' : `${reports.open} not marked resolved.`}
                {' '}Sign in with a free account to read what happened and the company&apos;s reply.
              </p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <ReadReportsButton company={action} label="Read the reports" className={btnDark} />
            <ReportCompanyButton company={action} className={btnLight} />
          </div>
        </>
      ) : (
        <>
          <div className="mt-4 flex items-start gap-3">
            <div className="w-11 h-11 rounded-xl bg-[#16A34A]/10 flex items-center justify-center shrink-0"><CheckCircle2 className="w-5 h-5 text-[#16A34A]" /></div>
            <div>
              <div className="text-lg font-semibold">No reports on record</div>
              <p className="text-sm text-[#0B1E3F]/65 mt-1">Nobody has filed a report about {name} on Haulock. Had a load go wrong with this company? You can file one.</p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <ReportCompanyButton company={action} className={btnDark} />
          </div>
        </>
      )}
      <p className="mt-4 text-xs text-[#0B1E3F]/50 leading-relaxed">Only verified {REPORTERS_TEXT} can file a report: one load per report, with documents, reviewed before it is shown. The company can reply.</p>
    </section>
  );
}
