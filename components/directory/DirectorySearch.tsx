'use client';

// The search box on the public directory pages. Searching needs an account:
// it uses the same signed-in endpoints as the app, so a signed-in visitor
// gets live results that open company pages, and anyone else is asked to
// create a free account. What they typed is kept and waits for them in
// Reports after they sign up or log in.

import React, { useEffect, useRef, useState } from 'react';
import { companyPath } from '@/lib/directory-links';

type Hit = { name: string; mc: string | null; dot: string | null; city: string | null; state: string | null; role: string; href: string; reports: number | null };

const roleText = (r: string) => (r === 'both' ? 'carrier + broker' : r === 'dot-only' ? 'USDOT only' : r === 'none' ? 'no active authority' : r);
const line = (h: Hit) => [[h.mc && `MC-${h.mc}`, h.dot && `DOT-${h.dot}`].filter(Boolean).join(' · '), h.city ? `${h.city}${h.state ? `, ${h.state}` : ''}` : '', roleText(h.role)].filter(Boolean).join(' · ');

// Send the visitor to sign up or log in; afterwards the app opens Reports
// with their search already typed in.
function toAccount(path: '/signup' | '/login', query: string) {
  try {
    sessionStorage.setItem('haulock:reportsSearch', query.slice(0, 80));
    sessionStorage.setItem('haulock:postLoginRedirect', '/reports');
  } catch {}
  window.location.assign(path);
}

export default function DirectorySearch() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'done' | 'failed' | 'account'>('idle');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const seq = useRef(0);
  const noAccount = useRef(false); // learned from the first answer; no point asking again
  const wrap = useRef<HTMLDivElement>(null);
  const query = q.trim();

  useEffect(() => {
    const mine = ++seq.current;
    if (query.length < 3) { setHits([]); setPhase('idle'); return; }
    if (noAccount.current) { setPhase('account'); return; }
    setPhase('loading');
    const t = setTimeout(async () => {
      try {
        const [fm, own] = await Promise.all([
          fetch(`/api/search/suggest?q=${encodeURIComponent(query)}`, { cache: 'no-store' }),
          fetch(`/api/reports?search=${encodeURIComponent(query)}`, { cache: 'no-store' }).catch(() => null),
        ]);
        if (seq.current !== mine) return;
        if (fm.status === 401) { noAccount.current = true; setHits([]); setPhase('account'); return; }
        const j = await fm.json().catch(() => ({}));
        const ownJson = own && own.ok ? await own.json().catch(() => null) : null;
        if (seq.current !== mine) return;
        // Counts only when our own records could be read; otherwise no claim.
        const subjects: any[] | null = ownJson ? ownJson.subjects || [] : null;
        const list: Hit[] = (Array.isArray(j.suggestions) ? j.suggestions : []).map((s: any) => {
          const href = companyPath(s);
          if (!href) return null;
          const same = subjects ? subjects.filter((x) => (s.dot && x.dot === s.dot) || (s.mc && x.mc === s.mc)) : [];
          return { name: s.name, mc: s.mc || null, dot: s.dot || null, city: s.city || null, state: s.state || null, role: s.role, href, reports: same.length ? same.reduce((n: number, x: any) => n + x.count, 0) : null };
        }).filter(Boolean) as Hit[];
        setHits(list);
        setPhase(!fm.ok || (j.error && list.length === 0) ? 'failed' : 'done');
        setActive(0);
      } catch {
        if (seq.current === mine) { setHits([]); setPhase('failed'); }
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const showList = open && query.length > 0;
  return (
    <div ref={wrap} className="relative">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-[#0B1E3F]/40 pointer-events-none" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
      <input
        role="combobox"
        aria-expanded={showList}
        aria-controls="directory-search-list"
        aria-autocomplete="list"
        aria-activedescendant={showList && hits[active] ? `directory-hit-${active}` : undefined}
        aria-label="Search a broker or carrier by name, MC or DOT number"
        autoComplete="off"
        className="w-full pl-14 pr-5 py-4 bg-white border border-[#0B1E3F]/20 rounded-full text-base text-[#0B1E3F] placeholder:text-[#0B1E3F]/40 focus:outline-none focus:border-[#0B1E3F] card-shadow"
        placeholder="Company name, MC or DOT number"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, Math.max(hits.length - 1, 0))); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          else if (e.key === 'Enter') {
            e.preventDefault();
            if (phase === 'account' && query.length >= 3) toAccount('/signup', query);
            else if (showList && hits[active]) window.location.assign(hits[active].href);
          }
          else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {showList && (
        <div id="directory-search-list" role={phase === 'account' ? undefined : 'listbox'} aria-label="Matching companies" className="absolute z-20 mt-2 w-full bg-white border border-[#0B1E3F]/15 rounded-2xl card-shadow-lg overflow-hidden text-left">
          {query.length < 3 && <div className="px-5 py-3 text-sm text-[#0B1E3F]/50">Keep typing: at least 3 letters or digits.</div>}
          {query.length >= 3 && phase === 'loading' && hits.length === 0 && <div className="px-5 py-3 text-sm text-[#0B1E3F]/50">Searching…</div>}
          {query.length >= 3 && phase === 'account' && (
            <div className="px-5 py-5">
              <div className="font-semibold text-[#0B1E3F]">Create a free account to search</div>
              <p className="text-sm text-[#0B1E3F]/65 mt-1">Search any broker or carrier by name, MC or DOT number and see the reports filed about it. It&apos;s free, and we&apos;ll keep “{query}” for you.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => toAccount('/signup', query)} className="px-5 py-2.5 bg-[#FF6B35] text-white rounded-full text-sm font-semibold hover:bg-[#FF6B35]/90 transition">Create a free account</button>
                <button type="button" onClick={() => toAccount('/login', query)} className="px-5 py-2.5 border border-[#0B1E3F]/15 rounded-full text-sm font-medium text-[#0B1E3F] hover:border-[#0B1E3F]/40 transition">Log in</button>
              </div>
            </div>
          )}
          {query.length >= 3 && phase === 'done' && hits.length === 0 && <div className="px-5 py-3 text-sm text-[#0B1E3F]/65">No company found for “{query}”. Check the spelling, or try its MC or DOT number.</div>}
          {query.length >= 3 && phase === 'failed' && <div className="px-5 py-3 text-sm text-[#0B1E3F]/65">We couldn’t reach FMCSA’s records just now. Try again in a moment.</div>}
          {query.length >= 3 && phase !== 'account' && hits.map((h, i) => (
            <a
              role="option"
              id={`directory-hit-${i}`}
              aria-selected={i === active}
              key={h.href}
              href={h.href}
              onMouseEnter={() => setActive(i)}
              className={`flex items-center gap-3 px-5 py-3 border-b border-[#0B1E3F]/5 last:border-0 ${i === active ? 'bg-[#0B1E3F]/[0.05]' : ''}`}
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-[#0B1E3F] truncate">{h.name}</div>
                <div className="text-xs mono text-[#0B1E3F]/55 truncate">{line(h)}</div>
              </div>
              {h.reports ? <span className="shrink-0 px-2 py-0.5 rounded-full bg-[#DC2626]/10 text-[#DC2626] text-[10px] mono uppercase tracking-wider">{h.reports} report{h.reports === 1 ? '' : 's'}</span> : null}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
