'use client';

// Shown when FMCSA's records can't be reached. Nothing is cached in that
// case, so trying again reads the record fresh.
export default function DirectoryError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="min-h-screen bg-[#F5F3EE] text-[#0B1E3F] flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h1 className="text-3xl tracking-tight">We couldn&apos;t reach FMCSA&apos;s records</h1>
        <p className="text-[#0B1E3F]/65 mt-3">This page reads the company&apos;s record from FMCSA, and FMCSA didn&apos;t answer just now. It usually works again within a minute.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button onClick={() => reset()} className="px-5 py-2.5 bg-[#0B1E3F] text-white rounded-full text-sm font-semibold hover:bg-[#0B1E3F]/90">Try again</button>
          <a href="/directory" className="px-5 py-2.5 border border-[#0B1E3F]/15 bg-white rounded-full text-sm font-medium">Back to the directory</a>
        </div>
      </div>
    </div>
  );
}
