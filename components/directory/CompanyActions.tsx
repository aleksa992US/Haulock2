'use client';

// Buttons on a public company page. Each hands the company to the app through
// sessionStorage (the same hand-offs the app already uses) and opens the
// screen. A visitor who isn't signed in is sent to log in or sign up first
// and lands on that screen afterwards, with the company still chosen.

import React from 'react';

export type ActionCompany = { mc?: string; dot?: string; name: string; city?: string; state?: string; role: string };

function go(key: string, value: string, path: string) {
  try { sessionStorage.setItem(key, value); } catch {}
  window.location.assign(path);
}

const subjectType = (role: string) => (role === 'broker' ? 'broker' : role === 'carrier' || role === 'dot-only' ? 'carrier' : undefined);

export function ReadReportsButton({ company, label, className }: { company: ActionCompany; label: string; className: string }) {
  return (
    <button type="button" className={className} onClick={() => go('haulock:reportsCompany', JSON.stringify(company), '/reports')}>{label}</button>
  );
}

export function ReportCompanyButton({ company, className }: { company: ActionCompany; className: string }) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => go('haulock:reportSubject', JSON.stringify({ mc: company.mc || null, dot: company.dot || null, name: company.name, type: subjectType(company.role), city: company.city, state: company.state }), '/reports')}
    >
      Report this company
    </button>
  );
}

export function SafetyCheckButton({ company, className }: { company: ActionCompany; className: string }) {
  const query = company.mc ? `MC-${company.mc}` : `DOT-${company.dot}`;
  return (
    <button type="button" className={className} onClick={() => go('haulock:verifyQuery', query, '/verify')}>Run the safety check</button>
  );
}
