import { DirectoryFooter, DirectoryHeader } from '@/components/directory/Chrome';
import DirectorySearch from '@/components/directory/DirectorySearch';

export default function CompanyNotFound() {
  return (
    <div className="min-h-screen bg-[#F5F3EE] text-[#0B1E3F]">
      <DirectoryHeader />
      <main className="max-w-2xl mx-auto px-4 sm:px-6 pt-16 text-center">
        <h1 className="text-3xl md:text-4xl tracking-tight">We couldn&apos;t find that company</h1>
        <p className="text-[#0B1E3F]/65 mt-3">FMCSA has no company on record with that MC or USDOT number. Check the number, or search by name (free with an account).</p>
        <div className="mt-8"><DirectorySearch /></div>
        <a href="/directory" className="inline-block mt-6 text-sm underline text-[#0B1E3F]/70">Back to the directory</a>
      </main>
      <DirectoryFooter />
    </div>
  );
}
