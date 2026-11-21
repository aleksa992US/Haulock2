// Header, footer and breadcrumbs for the public directory and company pages.
// These pages are rendered on the server (so search engines read them), so
// they can't use the client-side <Nav/> inside components/Haulock.tsx; plain
// links take the visitor into the app.

import React from 'react';

export function DirectoryHeader() {
  return (
    <nav className="sticky top-0 z-50 bg-[#F5F3EE] border-b border-[#0B1E3F]/10 text-[#0B1E3F]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
        <a href="/" aria-label="Haulock home" className="hover:opacity-80 transition min-w-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/haulock-logo.png" alt="Haulock" className="h-8 sm:h-10 w-auto object-contain" />
        </a>
        <div className="hidden md:flex items-center gap-8 text-sm text-[#0B1E3F]/70">
          <a href="/directory" className="hover:text-[#0B1E3F]">Directory</a>
          <a href="/directory/brokers" className="hover:text-[#0B1E3F]">Brokers</a>
          <a href="/directory/carriers" className="hover:text-[#0B1E3F]">Carriers</a>
          <a href="/pricing" className="hover:text-[#0B1E3F]">Pricing</a>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a href="/login" className="px-4 py-2 text-sm font-medium rounded-full border border-[#0B1E3F]/15 bg-white hover:border-[#0B1E3F]/30 transition">Log in</a>
          <a href="/signup" className="px-4 py-2 text-sm font-semibold rounded-full bg-[#0B1E3F] text-white hover:bg-[#0B1E3F]/90 transition">Get started</a>
        </div>
      </div>
    </nav>
  );
}

export function DirectoryFooter() {
  return (
    <footer className="border-t border-[#0B1E3F]/10 mt-16">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 text-sm text-[#0B1E3F]/60 space-y-4">
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <a href="/directory" className="hover:text-[#0B1E3F]">Directory</a>
          <a href="/directory/brokers" className="hover:text-[#0B1E3F]">Freight brokers by state</a>
          <a href="/directory/carriers" className="hover:text-[#0B1E3F]">Trucking companies by state</a>
          <a href="/pricing" className="hover:text-[#0B1E3F]">Pricing</a>
          <a href="/terms" className="hover:text-[#0B1E3F]">Terms</a>
          <a href="/privacy" className="hover:text-[#0B1E3F]">Privacy</a>
        </div>
        <p className="max-w-3xl text-xs leading-relaxed text-[#0B1E3F]/50">
          Company names, numbers, locations and operating authority on these pages come from public records of the Federal Motor Carrier Safety Administration (FMCSA).
          Haulock is not affiliated with FMCSA or with the companies listed. Reports are statements by the verified company or driver that filed them.
          If a detail about your company is wrong, it is corrected in FMCSA&apos;s record; for anything else write to contact@haulock.com.
        </p>
        <p className="text-xs text-[#0B1E3F]/40">© {new Date().getFullYear()} Haulock, a trade name of Ella AI LLC</p>
      </div>
    </footer>
  );
}

export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/50 flex flex-wrap items-center gap-x-2 gap-y-1">
      {items.map((it, i) => (
        <React.Fragment key={`${it.label}-${i}`}>
          {i > 0 && <span aria-hidden="true">/</span>}
          {it.href ? <a href={it.href} className="hover:text-[#0B1E3F]">{it.label}</a> : <span className="text-[#0B1E3F]/75" aria-current="page">{it.label}</span>}
        </React.Fragment>
      ))}
    </nav>
  );
}

// What is free and what is paid, in the same words everywhere.
export function FreeVsPaid() {
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="bg-white rounded-2xl border border-[#0B1E3F]/10 card-shadow p-6">
        <div className="inline-flex px-2 py-0.5 rounded-full bg-[#16A34A]/10 text-[#16A34A] text-[10px] mono uppercase tracking-wider">Free</div>
        <h3 className="text-lg font-semibold mt-3">Reports on a company</h3>
        <p className="text-sm text-[#0B1E3F]/65 mt-1.5 leading-relaxed">
          See whether a carrier, broker, driver or shipper has reported a company, read what happened and the company&apos;s reply, and file your own report. Free with an account.
        </p>
      </div>
      <div className="bg-[#0B1E3F] text-white rounded-2xl card-shadow p-6">
        <div className="inline-flex px-2 py-0.5 rounded-full bg-[#FF6B35] text-white text-[10px] mono uppercase tracking-wider">Paid plans</div>
        <h3 className="text-lg font-semibold mt-3">The safety check</h3>
        <p className="text-sm text-white/70 mt-1.5 leading-relaxed">
          Risk score, insurance on file and cancellations, inspections and crashes, FMCSA audits, Motus records and a web reputation scan. 3 checks a month on the Free plan, unlimited on paid plans.
        </p>
      </div>
    </div>
  );
}
