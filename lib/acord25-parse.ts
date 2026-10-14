// Deterministic reading of the parts of an ACORD 25 certificate that have a
// fixed layout in OCR text, used to correct the model's extraction:
//   - "INSURER A : <name> <5-digit NAIC>" lines (name may be on the next line)
//   - the INSURED company name (first non-insurer, non-address line after
//     the "INSURED" label — OCR often interleaves insurer lines there)
//   - each policy row's INSR LTR letter ("B TINCA1444040-25 …", or a lone
//     letter a few lines above the policy number, e.g. "C Y OFFICER/MEMBER …")
// Anything it can't read confidently is left null; the model's value stands.

import type { CoiExtraction, CoiInsurer } from './anthropic';

const INSURER_WORDS = /\b(INSURANCE|INS|ASSURANCE|CASUALTY|INDEMNITY|UNDERWRITERS?|MUTUAL|EXCHANGE|RECIPROCAL|LLOYD'?S|SURETY|REINSURANCE|RE|GUARANTY|FIDELITY|SPECIALTY|RISK|COMPANY)\b/i;
// "Dyer IN 46311" / "Oak Lawn IL 60453-1234" — an address line, whose ZIP
// would otherwise look like a 5-digit NAIC number.
const CITY_STATE_ZIP = /\b[A-Z][A-Za-z.' -]*\s+[A-Z]{2}\s+\d{5}(?:-\d{4})?\s*$/;
const LABEL = /^(INSURER\b|INSURED\b|PRODUCER\b|CONTACT\b|NAME:|PHONE\b|E-?MAIL\b|ADDRESS:|FAX\b|NAIC\b|COVERAGES\b|CERTIFICATE\b|\(A\/C)/i;

export type Acord25Parse = {
  insurers: CoiInsurer[];
  insuredName: string | null;
  letterForPolicy: (policyNumber: string | null | undefined) => string | null;
};

const squash = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

function readInsurerName(raw: string): { name: string; naic: string | null } | null {
  const line = raw.trim();
  if (!line || LABEL.test(line)) return null;
  if (CITY_STATE_ZIP.test(line)) return null;
  const m = line.match(/^(.*?)[\s#]+(\d{5})\s*$/);
  const name = (m ? m[1] : line).replace(/\s+/g, ' ').trim();
  const naic = m ? m[2] : null;
  if (name.length < 3 || /^\d/.test(name)) return null;
  // Needs a NAIC number or an insurer-ish word to count as an insurer.
  if (!naic && !INSURER_WORDS.test(name)) return null;
  return { name, naic };
}

// "Leader Group Inc Leader Group Inc" → "Leader Group Inc" (OCR doubling).
function undouble(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  const words = t.split(' ');
  if (words.length % 2 === 0) {
    const half = words.length / 2;
    if (words.slice(0, half).join(' ').toUpperCase() === words.slice(half).join(' ').toUpperCase()) return words.slice(0, half).join(' ');
  }
  return t;
}

export function parseAcord25Text(text: string): Acord25Parse {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // INSURER A–F
  const insurers: CoiInsurer[] = [];
  const insurerLineIdx = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^INSURER\s+([A-F])\b\s*:?\s*(.*)$/i);
    if (!m) continue;
    insurerLineIdx.add(i);
    const letter = m[1].toUpperCase();
    let read = m[2] ? readInsurerName(m[2]) : null;
    if (!read && !m[2] && i + 1 < lines.length) {
      read = readInsurerName(lines[i + 1]);
      if (read) insurerLineIdx.add(i + 1);
    }
    if (read && !insurers.some((x) => x.letter === letter)) insurers.push({ letter, name: read.name, naic: read.naic });
  }

  // INSURED name: the first line after the label that isn't an insurer
  // line, a label, or an address.
  let insuredName: string | null = null;
  const insuredIdx = lines.findIndex((l) => /^INSURED$/i.test(l) || /^INSURED\s*:/i.test(l));
  if (insuredIdx >= 0) {
    const inline = lines[insuredIdx].replace(/^INSURED\s*:?\s*/i, '');
    const candidates = inline ? [inline, ...lines.slice(insuredIdx + 1, insuredIdx + 10)] : lines.slice(insuredIdx + 1, insuredIdx + 10);
    const insurerNames = new Set(insurers.map((x) => squash(x.name)));
    for (let k = 0; k < candidates.length; k++) {
      const line = candidates[k];
      const absolute = inline ? insuredIdx + k : insuredIdx + 1 + k;
      if (insurerLineIdx.has(absolute) || LABEL.test(line)) continue;
      if (insurerNames.has(squash(line.replace(/\s+\d{5}\s*$/, '')))) continue;
      if (/^\d/.test(line) || CITY_STATE_ZIP.test(line) || /^(SUITE|STE|P\.?O\.? BOX)\b/i.test(line)) continue;
      if (line.length < 3) continue;
      insuredName = undouble(line);
      break;
    }
  }

  const letterForPolicy = (policyNumber: string | null | undefined): string | null => {
    const key = squash(String(policyNumber || ''));
    if (key.length < 4) return null;
    const at = lines.findIndex((l) => squash(l).includes(key));
    if (at < 0) return null;
    // Only a letter on the policy number's own line ("B TINCA1444040-25 …").
    // Walking up the text to find one proved unreliable: OCR column order
    // differs between engines, and a wrong letter is worse than none.
    const own = lines[at].match(/^([A-F])\s+\S/);
    if (own && !/^INSURER/i.test(lines[at])) return own[1].toUpperCase();
    return null;
  };

  return { insurers, insuredName, letterForPolicy };
}

// True when an "insured name" is clearly not a company: empty, a ZIP or
// "IL 60453", or just the city from the insured's address ("Dyer").
export function implausibleInsuredName(name: string | null | undefined, address?: string | null): boolean {
  const n = String(name || '').trim();
  if (n.length < 3) return true;
  if (/\d{5}/.test(n) || /^[A-Z]{2}(\s+\d|$)/.test(n)) return true;
  if (!/[A-Za-z]{2,}/.test(n)) return true;
  const words = n.split(/\s+/);
  if (address && words.length <= 2 && new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(address)) return true;
  return false;
}

// Correct the model's extraction only where the text is unambiguous AND the
// model's reading is clearly wrong or missing. The model now reads the PDF
// itself, so this is a safety net, never an override of a sane reading.
export function repairWithAcord25Text(ex: CoiExtraction, text: string): CoiExtraction {
  const p = parseAcord25Text(text);
  const out: CoiExtraction = { ...ex };
  const modelInsurers = ex.insurers || [];
  const parsedClean = p.insurers.length >= 2 && p.insurers.every((i) => i.naic);
  const modelWeak = modelInsurers.length === 0 || modelInsurers.some((i) => !i.naic);
  if (parsedClean && modelWeak) out.insurers = p.insurers;
  if (p.insuredName && implausibleInsuredName(ex.insured_name, ex.insured_address) && !implausibleInsuredName(p.insuredName, ex.insured_address)) {
    out.insured_name = p.insuredName;
  }
  out.policies = (ex.policies || []).map((pol) => {
    if (pol.insurer_letter) return pol;
    const letter = p.letterForPolicy(pol.policy_number);
    const listed = letter ? (out.insurers || []).find((x) => x.letter === letter) : undefined;
    return listed ? { ...pol, insurer_letter: letter, insurer_name: listed.name, naic: listed.naic } : pol;
  });
  return out;
}
