import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'API documentation',
  description:
    'Haulock API reference. Authenticate with a Bearer token, verify any MC, DOT, or company name, and receive a risk score based on FMCSA data, website checks, social profiles, and Google Business address matching.',
  alternates: { canonical: '/docs/api' },
  openGraph: {
    title: 'Haulock API documentation',
    description: 'Verify brokers and carriers programmatically. Same FMCSA, website, social, and Google Business checks as the web app.',
    url: '/docs/api',
  },
};

export default function ApiDocsPage() {
  return (
    <div className="min-h-screen bg-[#F5F3EE] text-[#0B1E3F]">
      <nav className="sticky top-0 z-50 bg-[#F5F3EE] border-b border-[#0B1E3F]/10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#FF6B35] flex items-center justify-center text-white font-bold">H</div>
            <span className="font-semibold">Haulock</span>
            <span className="text-[#0B1E3F]/40 text-sm ml-2">· Docs</span>
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/settings" className="text-[#0B1E3F]/70 hover:text-[#0B1E3F]">Get API key</Link>
            <Link href="/" className="text-[#0B1E3F]/70 hover:text-[#0B1E3F]">Back to app</Link>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-12">
        <div className="grid lg:grid-cols-[220px_1fr] gap-12">
          <aside className="lg:sticky lg:top-24 lg:self-start text-sm text-[#0B1E3F]/70 space-y-1">
            <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/50 mb-2">On this page</div>
            <a href="#overview" className="block py-1 hover:text-[#0B1E3F]">Overview</a>
            <a href="#authentication" className="block py-1 hover:text-[#0B1E3F]">Authentication</a>
            <a href="#rate-limits" className="block py-1 hover:text-[#0B1E3F]">Rate limits</a>
            <a href="#verify" className="block py-1 hover:text-[#0B1E3F]">GET /v1/verify</a>
            <a href="#response" className="block py-1 hover:text-[#0B1E3F]">Response schema</a>
            <a href="#errors" className="block py-1 hover:text-[#0B1E3F]">Errors</a>
            <a href="#examples" className="block py-1 hover:text-[#0B1E3F]">Examples</a>
          </aside>

          <article className="prose-haulock max-w-none text-[#0B1E3F]">
            <div className="mb-10">
              <div className="text-xs mono uppercase tracking-[0.2em] text-[#FF6B35] mb-3">— API reference</div>
              <h1 className="text-5xl serif italic leading-tight mb-4">Haulock API</h1>
              <p className="text-lg text-[#0B1E3F]/70 max-w-2xl">
                Verify any freight broker or motor carrier programmatically. Same checks as the web app — FMCSA
                authority, insurance, crash history, company website, domain WHOIS, social profiles, Google
                Business address match — returned as a single scored JSON payload.
              </p>
            </div>

            <section id="overview" className="mb-12">
              <h2 className="text-2xl font-semibold mb-3">Overview</h2>
              <p className="text-[#0B1E3F]/70 mb-3">
                The API is a thin HTTP layer over the same verification pipeline the Haulock dashboard uses.
                All endpoints return JSON. The base URL is your Haulock domain plus <Code>/api/v1</Code>.
              </p>
              <div className="p-4 bg-white border border-[#0B1E3F]/10 rounded-xl">
                <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/55 mb-1">Base URL</div>
                <code className="mono text-sm text-[#0B1E3F]">https://haulock.com/api/v1</code>
              </div>
            </section>

            <section id="authentication" className="mb-12">
              <h2 className="text-2xl font-semibold mb-3">Authentication</h2>
              <p className="text-[#0B1E3F]/70 mb-4">
                Every request must include a Bearer token in the <Code>Authorization</Code> header.
                Generate keys in <Link href="/settings" className="underline text-[#0B1E3F] hover:text-[#FF6B35]">Settings → API keys</Link>.
              </p>
              <CodeBlock>{`Authorization: Bearer hlk_abc123…`}</CodeBlock>
              <div className="mt-4 p-4 bg-[#FF6B35]/10 border border-[#FF6B35]/25 rounded-xl text-sm text-[#0B1E3F]/80">
                <strong className="font-semibold">Key safety:</strong> tokens are shown only once at creation. Haulock
                stores a SHA-256 hash — we can&apos;t recover a lost key. Revoke and re-issue instead.
              </div>
            </section>

            <section id="rate-limits" className="mb-12">
              <h2 className="text-2xl font-semibold mb-3">Rate limits &amp; quotas</h2>
              <p className="text-[#0B1E3F]/70 mb-3">
                API usage counts against the same monthly quota as in-app lookups. All of your API keys share one
                allowance, and team members pool together.
              </p>
              <div className="overflow-hidden rounded-xl border border-[#0B1E3F]/10 bg-white">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#0B1E3F]/5 text-xs mono uppercase tracking-wider text-[#0B1E3F]/60">
                      <th className="text-left px-4 py-2.5">Plan</th>
                      <th className="text-left px-4 py-2.5">Monthly lookups</th>
                      <th className="text-left px-4 py-2.5">API access</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#0B1E3F]/5">
                    <tr><td className="px-4 py-2.5 font-medium">Free</td><td className="px-4 py-2.5">5</td><td className="px-4 py-2.5">Yes</td></tr>
                    <tr><td className="px-4 py-2.5 font-medium">Carrier</td><td className="px-4 py-2.5">250</td><td className="px-4 py-2.5">Yes</td></tr>
                    <tr><td className="px-4 py-2.5 font-medium">Fleet</td><td className="px-4 py-2.5">Unlimited</td><td className="px-4 py-2.5">Yes</td></tr>
                  </tbody>
                </table>
              </div>
              <p className="text-sm text-[#0B1E3F]/60 mt-3">
                <strong className="text-[#0B1E3F]/80">Cache hits are free.</strong> Querying the same MC or DOT returns
                the last saved record without consuming quota. Pass <Code>force=1</Code> to bypass the cache.
              </p>
            </section>

            <section id="verify" className="mb-12">
              <div className="flex items-center gap-3 mb-3">
                <span className="px-2 py-1 bg-[#16A34A] text-white text-xs mono uppercase rounded">GET</span>
                <h2 className="text-2xl font-semibold m-0">/v1/verify</h2>
              </div>
              <p className="text-[#0B1E3F]/70 mb-4">
                Verify a broker or carrier by MC number, DOT number, or company name.
              </p>

              <h3 className="text-sm mono uppercase tracking-wider text-[#0B1E3F]/60 mb-2">Query parameters</h3>
              <div className="overflow-hidden rounded-xl border border-[#0B1E3F]/10 bg-white mb-6">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#0B1E3F]/5 text-xs mono uppercase tracking-wider text-[#0B1E3F]/60">
                      <th className="text-left px-4 py-2.5">Name</th>
                      <th className="text-left px-4 py-2.5">Required</th>
                      <th className="text-left px-4 py-2.5">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#0B1E3F]/5">
                    <tr>
                      <td className="px-4 py-3 align-top"><Code>q</Code></td>
                      <td className="px-4 py-3 align-top">yes</td>
                      <td className="px-4 py-3 align-top text-[#0B1E3F]/70">MC number (e.g. <Code>MC-123456</Code> or <Code>123456</Code>), DOT number (<Code>DOT-9876543</Code>), or company name.</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 align-top"><Code>force</Code></td>
                      <td className="px-4 py-3 align-top">no</td>
                      <td className="px-4 py-3 align-top text-[#0B1E3F]/70">Set to <Code>1</Code> to bypass the cache and charge a fresh lookup against your quota.</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h3 className="text-sm mono uppercase tracking-wider text-[#0B1E3F]/60 mb-2">Example request</h3>
              <CodeBlock>{`curl -H "Authorization: Bearer $HAULOCK_API_KEY" \\
  "https://haulock.com/api/v1/verify?q=MC-123456"`}</CodeBlock>
            </section>

            <section id="response" className="mb-12">
              <h2 className="text-2xl font-semibold mb-3">Response schema</h2>
              <p className="text-[#0B1E3F]/70 mb-4">
                Successful responses return <Code>200 OK</Code> with the carrier&apos;s scored report.
              </p>
              <CodeBlock>{`{
  "name": "Sample Brokerage LLC",
  "mc": "123456",
  "dot": "9876543",
  "address": "123 Main St, Dallas, TX 75201",
  "phone": "(555) 555-0000",
  "emailDomain": "samplebrokerage.com",
  "authorityStatus": "Active",
  "commonAuthority": "Active",
  "brokerAuthority": null,
  "authorityAge": "8 years",
  "safetyRating": "Satisfactory",
  "outOfService": false,
  "bipdOnFile": 1000,
  "cargoOnFile": 250,
  "insuranceSummary": "$1,000,000 liability · $250,000 cargo",
  "drivers": 24,
  "powerUnits": 18,
  "crashTotal": 1,
  "addressCheck": {
    "configured": true,
    "found": true,
    "matchedName": "Sample Brokerage LLC",
    "matchedAddress": "123 Main St, Dallas, TX 75201",
    "isMailbox": false,
    "isResidence": false
  },
  "webPresence": {
    "configured": true,
    "found": true,
    "domain": "samplebrokerage.com",
    "url": "https://samplebrokerage.com",
    "nameMatch": true,
    "domainAgeDays": 4210,
    "hasMx": true,
    "hasSpf": true,
    "socials": [
      { "platform": "linkedin", "url": "https://linkedin.com/company/sample" }
    ]
  },
  "source": "fmcsa",
  "fetchedAt": "2026-04-23T21:05:00.000Z",
  "score": 12,
  "verdict": "low",
  "flags": [],
  "cached": false
}`}</CodeBlock>
              <p className="text-sm text-[#0B1E3F]/60 mt-3">
                <strong>Score</strong> is 0–100 (lower = safer). <strong>Verdict</strong> is one of
                {' '}<Code>low</Code>, <Code>medium</Code>, <Code>high</Code>.
                {' '}<Code>flags</Code> is an array of risk signals with <Code>sev</Code>, <Code>title</Code>, <Code>desc</Code>, and <Code>pts</Code>.
              </p>
            </section>

            <section id="errors" className="mb-12">
              <h2 className="text-2xl font-semibold mb-3">Errors</h2>
              <div className="overflow-hidden rounded-xl border border-[#0B1E3F]/10 bg-white">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#0B1E3F]/5 text-xs mono uppercase tracking-wider text-[#0B1E3F]/60">
                      <th className="text-left px-4 py-2.5">Status</th>
                      <th className="text-left px-4 py-2.5">Code</th>
                      <th className="text-left px-4 py-2.5">Meaning</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#0B1E3F]/5">
                    <tr><td className="px-4 py-3 mono">400</td><td className="px-4 py-3 mono">—</td><td className="px-4 py-3 text-[#0B1E3F]/70">Missing or empty <Code>q</Code>.</td></tr>
                    <tr><td className="px-4 py-3 mono">401</td><td className="px-4 py-3 mono">—</td><td className="px-4 py-3 text-[#0B1E3F]/70">Missing, invalid, or revoked API key.</td></tr>
                    <tr><td className="px-4 py-3 mono">402</td><td className="px-4 py-3 mono">limit_reached</td><td className="px-4 py-3 text-[#0B1E3F]/70">Monthly plan quota exhausted. Response includes <Code>plan</Code>, <Code>limit</Code>, and <Code>used</Code>.</td></tr>
                    <tr><td className="px-4 py-3 mono">500</td><td className="px-4 py-3 mono">—</td><td className="px-4 py-3 text-[#0B1E3F]/70">Upstream error (FMCSA, Google, etc.). Retry after a short backoff.</td></tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section id="examples" className="mb-12">
              <h2 className="text-2xl font-semibold mb-4">Examples</h2>

              <h3 className="text-sm mono uppercase tracking-wider text-[#0B1E3F]/60 mb-2">JavaScript (fetch)</h3>
              <CodeBlock>{`const res = await fetch(
  'https://haulock.com/api/v1/verify?q=MC-123456',
  { headers: { Authorization: \`Bearer \${process.env.HAULOCK_API_KEY}\` } }
);
if (!res.ok) throw new Error(\`Haulock \${res.status}\`);
const report = await res.json();
console.log(report.score, report.verdict, report.flags);`}</CodeBlock>

              <h3 className="text-sm mono uppercase tracking-wider text-[#0B1E3F]/60 mt-6 mb-2">Node.js (axios)</h3>
              <CodeBlock>{`import axios from 'axios';

const haulock = axios.create({
  baseURL: 'https://haulock.com/api/v1',
  headers: { Authorization: \`Bearer \${process.env.HAULOCK_API_KEY}\` },
});

const { data } = await haulock.get('/verify', { params: { q: 'MC-123456' } });`}</CodeBlock>

              <h3 className="text-sm mono uppercase tracking-wider text-[#0B1E3F]/60 mt-6 mb-2">Python (requests)</h3>
              <CodeBlock>{`import os, requests

r = requests.get(
    'https://haulock.com/api/v1/verify',
    headers={'Authorization': f"Bearer {os.environ['HAULOCK_API_KEY']}"},
    params={'q': 'MC-123456'},
    timeout=30,
)
r.raise_for_status()
report = r.json()
print(report['score'], report['verdict'])`}</CodeBlock>
            </section>

            <div className="mt-16 p-6 bg-white border border-[#0B1E3F]/10 rounded-2xl">
              <div className="text-xs mono uppercase tracking-wider text-[#0B1E3F]/55 mb-2">Ready to start?</div>
              <div className="text-2xl font-semibold mb-3">Generate your first API key.</div>
              <Link href="/settings" className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#0B1E3F] text-white rounded-full text-sm font-medium hover:bg-[#0B1E3F]/90 transition">
                Go to Settings
              </Link>
            </div>
          </article>
        </div>
      </main>

      <footer className="border-t border-[#0B1E3F]/10 py-6 text-center text-xs text-[#0B1E3F]/55 mono">
        Haulock API · v1
      </footer>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="px-1.5 py-0.5 rounded bg-[#0B1E3F]/5 text-[#0B1E3F] mono text-[0.85em]">{children}</code>;
}

function CodeBlock({ children }: { children: string }) {
  return (
    <div className="bg-[#0B1E3F] rounded-xl p-5 overflow-x-auto">
      <pre className="text-xs mono text-white/90 whitespace-pre leading-relaxed">{children}</pre>
    </div>
  );
}
