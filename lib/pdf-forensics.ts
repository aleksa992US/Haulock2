import { createHash } from 'crypto';
import {
  PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFRef, PDFStream, PDFString, decodePDFRawStream,
} from 'pdf-lib';

// PDF tamper analysis. Two layers:
//   1. Metadata: dates, producer/creator, XMP vs Info, editing tools.
//   2. Structure: every saved version inside the file (incremental updates),
//      rebuilt and compared page by page; Acrobat's TouchUp edit marker;
//      white boxes drawn over text; typed-on-top text boxes; invisible text;
//      leftover duplicate objects; signatures with changes after signing;
//      document IDs; duplicate font subsets; JavaScript.
// Every check that passes — or that finds something normal, like filled-in
// form fields or an OCR text layer — is reported in `normal` with a plain
// explanation, so the user knows what's fine as well as what isn't.
// Indicator ideas follow PDFRecon (MIT, github.com/Rasmus-Riis/PDFRecon);
// this is an independent TypeScript implementation on pdf-lib (MIT).

export type ForensicFlag = {
  sev: 'info' | 'warning' | 'critical';
  code: string;
  title: string;
  desc: string;
  pts: number;
};

export type NormalNote = { code: string; title: string; desc: string };

export type RevisionInfo = {
  index: number;               // 1 = original
  producer: string | null;
  modified: string | null;     // ISO, from that version's Info dict
  pagesChanged: number[];      // 1-based, vs the previous version
  pagesAdded: number;
  annotationsAdded: string[];  // annotation subtypes added (FreeText, Stamp, …)
  formFieldsChanged: number;
  signed: boolean;             // this version added a digital signature
  kind: 'original' | 'content' | 'markup' | 'form' | 'signature' | 'metadata' | 'unknown';
  summary: string;
};

export type PdfForensics = {
  metadata: {
    creationDate: string | null;
    modificationDate: string | null;
    producer: string | null;
    creator: string | null;
    author: string | null;
    title: string | null;
    subject: string | null;
    keywords: string | null;
    pdfVersion: string | null;
    pageCount: number;
    fileSizeBytes: number;
    xmpCreatorTool?: string | null;
    xmpProducer?: string | null;
  };
  flags: ForensicFlag[];
  normal?: NormalNote[];
  revisions?: RevisionInfo[];
  summary?: string;
  score: number; // 0-100, higher = more likely tampered
  verdict: 'clean' | 'suspicious' | 'likely_tampered';
};

// Free online editors and desktop editors commonly used to alter documents.
const SUSPICIOUS_EDITORS = [
  'ilovepdf', 'smallpdf', 'pdf24', 'sejda', 'pdfescape', 'dochub', 'pdffiller', 'pdf filler', 'foxit online',
  'lumin pdf', 'deftpdf', 'hipdf', 'nitro online', 'pdf candy', 'pdfcandy', 'soda pdf online', 'pdfelement',
  'lightpdf', 'pdf2go', 'pdfsimpli', 'formswift', 'pdfguru', 'pdf.io', 'sodapdf', 'edit-pdf', 'pdfzorro', 'pdfbuddy',
];

// Software that normally CREATES documents (TMS, office, print-to-PDF).
const LEGITIMATE_PRODUCERS = [
  'microsoft word', 'microsoft office', 'microsoft® word', 'microsoft® office', 'microsoft: print to pdf',
  'adobe indesign', 'adobe illustrator', 'quickbooks', 'latex', 'pdftex', 'wkhtmltopdf', 'prince', 'weasyprint',
  'chromium', 'skia/pdf', 'mac os', 'quartz', 'reportlab', 'itext', 'aspose', 'telerik', 'crystal reports',
  'jasperreports', 'dompdf', 'tcpdf', 'fpdf', 'mpdf', 'pdfsharp', 'apache fop', 'libreoffice', 'openoffice',
  'mcleod', 'tmw', 'truckbase', 'rose rocket', 'tai software', 'prophesy', 'axon', 'transflo', 'truckingoffice',
  'dispatchware', 'docusign', 'adobe sign', 'acord',
];

const MAX_REVISIONS = 8;
const MAX_PAGES_HASHED = 40;

// ---------- small helpers ----------

function toIso(d: Date | undefined | null): string | null {
  if (!d || isNaN(d.getTime())) return null;
  return d.toISOString();
}

function getText(getter: () => string | undefined): string | null {
  try {
    const v = getter();
    if (v == null) return null;
    const s = String(v).trim();
    return s || null;
  } catch {
    return null;
  }
}

function sha(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
}

function decodeStream(obj: unknown): Uint8Array | null {
  try {
    if (obj instanceof PDFRawStream) return decodePDFRawStream(obj).decode();
    if (obj instanceof PDFStream) return (obj as any).getUnencodedContents?.() ?? (obj as any).getContents?.() ?? null;
  } catch { /* unsupported filter or encrypted */ }
  return null;
}

function nameOf(v: unknown): string | null {
  return v instanceof PDFName ? v.decodeText() : null;
}

function textOf(v: unknown): string | null {
  if (v instanceof PDFString || v instanceof PDFHexString) {
    try { return v.decodeText(); } catch { return null; }
  }
  return null;
}

function editorHit(s: string | null | undefined): string | null {
  if (!s) return null;
  const low = s.toLowerCase();
  return SUSPICIOUS_EDITORS.find((e) => low.includes(e)) || null;
}

function isLegitProducer(s: string | null | undefined): boolean {
  if (!s) return false;
  const low = s.toLowerCase();
  return LEGITIMATE_PRODUCERS.some((p) => low.includes(p));
}

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'an unknown date';
}

function pageList(pages: number[]): string {
  if (pages.length === 1) return `page ${pages[0]}`;
  return `pages ${pages.slice(0, 5).join(', ')}${pages.length > 5 ? '…' : ''}`;
}

// ---------- raw byte scan (works even when pdf-lib can't parse) ----------

type RawScan = {
  eofEnds: number[];          // byte offset just after each %%EOF
  linearized: boolean;
  objCounts: Map<string, number>;
  genAbove0: number;
  signatures: { coveredEnd: number }[];
  hasJavaScript: boolean;
  encrypted: boolean;
  touchUpRaw: boolean;
  xmpPackets: string[];
};

function scanRaw(buf: Buffer): RawScan {
  const s = buf.toString('latin1');
  const eofEnds: number[] = [];
  for (const m of Array.from(s.matchAll(/%%EOF/g))) eofEnds.push((m.index as number) + 5);
  const objCounts = new Map<string, number>();
  let genAbove0 = 0;
  for (const m of Array.from(s.matchAll(/(?:^|[\r\n\s])(\d{1,7})\s+(\d{1,5})\s+obj\b/g))) {
    const key = `${m[1]} ${m[2]}`;
    objCounts.set(key, (objCounts.get(key) || 0) + 1);
    if (m[2] !== '0') genAbove0 += 1;
  }
  const signatures = Array.from(s.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g))
    .map((m) => ({ coveredEnd: Number(m[3]) + Number(m[4]) }))
    .filter((x) => x.coveredEnd > 0);
  const xmpPackets = Array.from(s.matchAll(/<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/g)).map((m) => m[0]);
  return {
    eofEnds,
    linearized: /\/Linearized\s/.test(s.slice(0, 2048)),
    objCounts,
    genAbove0,
    signatures,
    hasJavaScript: /\/JavaScript\b|\/JS\s*[(<\[]|\/JS\s+\d+\s+\d+\s+R/.test(s),
    encrypted: /\/Encrypt\s+(\d+\s+\d+\s+R|<<)/.test(s),
    touchUpRaw: /TouchUp_TextEdit/.test(s),
    xmpPackets,
  };
}

// ---------- XMP ----------

type Xmp = {
  createDate?: string; modifyDate?: string; creatorTool?: string; producer?: string;
  documentId?: string; instanceId?: string;
  history: { action: string; agent?: string; when?: string }[];
};

function xmpField(x: string, tag: string): string | undefined {
  const attr = x.match(new RegExp(`${tag}="([^"]*)"`));
  if (attr) return attr[1].trim() || undefined;
  const el = x.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  if (!el) return undefined;
  return el[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || undefined;
}

function parseXmp(x: string): Xmp {
  const history: Xmp['history'] = [];
  const hist = x.match(/<xmpMM:History>([\s\S]*?)<\/xmpMM:History>/);
  if (hist) {
    for (const li of Array.from(hist[1].matchAll(/<rdf:li\b([\s\S]*?)(?:\/>|<\/rdf:li>)/g))) {
      const body = li[1];
      const get = (k: string) => (body.match(new RegExp(`stEvt:${k}="([^"]*)"`)) || body.match(new RegExp(`<stEvt:${k}>([^<]*)</stEvt:${k}>`)))?.[1];
      const action = get('action');
      if (action) history.push({ action, agent: get('softwareAgent'), when: get('when') });
    }
  }
  return {
    createDate: xmpField(x, 'xmp:CreateDate'),
    modifyDate: xmpField(x, 'xmp:ModifyDate'),
    creatorTool: xmpField(x, 'xmp:CreatorTool'),
    producer: xmpField(x, 'pdf:Producer'),
    documentId: xmpField(x, 'xmpMM:DocumentID'),
    instanceId: xmpField(x, 'xmpMM:InstanceID'),
    history,
  };
}

// ---------- page content ----------

type PageScan = {
  streams: string[];           // decoded content streams, in drawing order
  hash: string;
  annots: string[];            // annotation subtypes
  freeTextContents: string[];
  hasImage: boolean;
  fonts: string[];             // BaseFont names
  width: number;
  height: number;
};

function pageStreams(doc: PDFDocument, page: any): string[] {
  const out: string[] = [];
  try {
    const contents = page.node.Contents();
    const items = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
    for (const it of items) {
      const obj = it instanceof PDFRef ? doc.context.lookup(it) : it;
      const bytes = decodeStream(obj);
      if (bytes) out.push(latin1(bytes));
    }
  } catch { /* unreadable */ }
  return out;
}

function scanPage(doc: PDFDocument, page: any): PageScan {
  const streams = pageStreams(doc, page);
  const annots: string[] = [];
  const freeTextContents: string[] = [];
  let hasImage = false;
  const fonts: string[] = [];
  try {
    const arr = page.node.Annots();
    for (const ref of arr ? arr.asArray() : []) {
      const a = (ref instanceof PDFRef ? doc.context.lookup(ref) : ref) as PDFDict;
      if (!(a instanceof PDFDict)) continue;
      const sub = nameOf(a.get(PDFName.of('Subtype'))) || 'Unknown';
      annots.push(sub);
      if (sub === 'FreeText') freeTextContents.push((textOf(a.get(PDFName.of('Contents'))) || '').slice(0, 120));
    }
  } catch { /* none */ }
  try {
    const res = page.node.Resources();
    const xo = res?.lookup(PDFName.of('XObject'));
    if (xo instanceof PDFDict) {
      for (const [, v] of xo.entries()) {
        const o = v instanceof PDFRef ? doc.context.lookup(v) : v;
        const dict = o instanceof PDFStream ? o.dict : null;
        if (dict && nameOf(dict.get(PDFName.of('Subtype'))) === 'Image') hasImage = true;
      }
    }
    const fd = res?.lookup(PDFName.of('Font'));
    if (fd instanceof PDFDict) {
      for (const [, v] of fd.entries()) {
        const f = v instanceof PDFRef ? doc.context.lookup(v) : v;
        if (f instanceof PDFDict) {
          const base = nameOf(f.get(PDFName.of('BaseFont')));
          if (base) fonts.push(base);
        }
      }
    }
  } catch { /* none */ }
  if (!hasImage && streams.some((s) => /\bBI\b[\s\S]*?\bID\b/.test(s))) hasImage = true; // inline image
  let width = 612, height = 792;
  try { const sz = page.getSize(); width = sz.width; height = sz.height; } catch { /* default letter */ }
  return { streams, hash: sha(streams.join('\n')), annots, freeTextContents, hasImage, fonts, width, height };
}

const TEXT_OP = /\b(Tj|TJ|'|")\s/;
// White fill colour (RGB 1 1 1, gray 1, or CMYK 0 0 0 0) followed by a filled rectangle.
const WHITE_RECT = /(?:(?:^|\s)1(?:\.0+)?\s+1(?:\.0+)?\s+1(?:\.0+)?\s+(?:rg|sc|scn)|(?:^|\s)1(?:\.0+)?\s+g|(?:^|\s)0(?:\.0+)?\s+0(?:\.0+)?\s+0(?:\.0+)?\s+0(?:\.0+)?\s+k)\s+(?:[^\n]{0,200}?\s)?(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+re\s+(?:[\s\S]{0,20}?)\bf\*?(?=\s)/g;

// A white rectangle drawn AFTER text and FOLLOWED by more text in the same
// stream is the classic cover-up: hide a value, type a new one on top.
// Full-page or tiny rectangles (backgrounds, rules) are ignored.
function coverBoxes(stream: string, pageW: number, pageH: number, textInEarlierLayer = false): number {
  let n = 0;
  for (const m of Array.from(stream.matchAll(WHITE_RECT))) {
    const w = Math.abs(Number(m[3]));
    const h = Math.abs(Number(m[4]));
    if (!isFinite(w) || !isFinite(h) || w < 4 || h < 4) continue;
    if (w * h > pageW * pageH * 0.6) continue; // background
    const at = m.index as number;
    const before = stream.slice(0, at);
    const after = stream.slice(at + m[0].length);
    if ((textInEarlierLayer || TEXT_OP.test(before)) && TEXT_OP.test(after)) n += 1;
  }
  return n;
}

// ---------- document fingerprint (per saved version) ----------

type DocPrint = {
  pages: PageScan[];
  producer: string | null;
  modified: string | null;
  formValues: Map<string, string>;
};

async function loadDoc(bytes: Uint8Array): Promise<PDFDocument | null> {
  try {
    return await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  } catch {
    return null;
  }
}

function formValues(doc: PDFDocument): Map<string, string> {
  const out = new Map<string, string>();
  try {
    for (const f of doc.getForm().getFields()) {
      const v = (f as any).acroField?.dict?.get(PDFName.of('V'));
      out.set(f.getName(), v ? String(v) : '');
    }
  } catch { /* no form */ }
  return out;
}

function printDoc(doc: PDFDocument): DocPrint {
  const pages = doc.getPages().slice(0, MAX_PAGES_HASHED).map((p) => scanPage(doc, p));
  return {
    pages,
    producer: getText(() => doc.getProducer()),
    modified: toIso(doc.getModificationDate() ?? null),
    formValues: formValues(doc),
  };
}

function diffPrints(prev: DocPrint, next: DocPrint, signedHere: boolean, index: number): RevisionInfo {
  const pagesChanged: number[] = [];
  const shared = Math.min(prev.pages.length, next.pages.length);
  for (let i = 0; i < shared; i++) if (prev.pages[i].hash !== next.pages[i].hash) pagesChanged.push(i + 1);
  const pagesAdded = Math.max(0, next.pages.length - prev.pages.length);
  const count = (pages: PageScan[]) => {
    const m = new Map<string, number>();
    for (const p of pages) for (const a of p.annots) m.set(a, (m.get(a) || 0) + 1);
    return m;
  };
  const before = count(prev.pages);
  const annotationsAdded: string[] = [];
  for (const [sub, n] of Array.from(count(next.pages).entries())) {
    for (let k = before.get(sub) || 0; k < n; k++) annotationsAdded.push(sub);
  }
  let formFieldsChanged = 0;
  for (const [name, v] of Array.from(next.formValues.entries())) if (prev.formValues.get(name) !== v) formFieldsChanged += 1;
  const markup = annotationsAdded.filter((a) => a !== 'Widget' && a !== 'Link');
  let kind: RevisionInfo['kind'];
  let summary: string;
  const by = next.producer ? ` with ${next.producer}` : '';
  if (pagesChanged.length) {
    kind = 'content';
    summary = `Changed the content of ${pageList(pagesChanged)}${by}.`;
  } else if (markup.length) {
    kind = 'markup';
    summary = `Added ${markup.includes('FreeText') ? 'a typed text box on top of the page' : `markup (${Array.from(new Set(markup)).join(', ')})`}${by}.`;
  } else if (signedHere) {
    kind = 'signature';
    summary = 'Added a digital signature. Normal for signed documents.';
  } else if (formFieldsChanged || annotationsAdded.includes('Widget')) {
    kind = 'form';
    summary = `Filled in ${formFieldsChanged || 'some'} form field${formFieldsChanged === 1 ? '' : 's'}. Normal for fillable documents.`;
  } else if (pagesAdded) {
    kind = 'content';
    summary = `Added ${pagesAdded} page${pagesAdded === 1 ? '' : 's'}${by}.`;
  } else {
    kind = 'metadata';
    summary = 'Re-saved without changing the pages (metadata only).';
  }
  return { index, producer: next.producer, modified: next.modified, pagesChanged, pagesAdded, annotationsAdded, formFieldsChanged, signed: signedHere, kind, summary };
}

// ---------- main ----------

export async function analyzePdfForensics(buffer: Buffer): Promise<PdfForensics> {
  const doc = await PDFDocument.load(buffer, { updateMetadata: false, ignoreEncryption: true, throwOnInvalidObject: false });
  const raw = scanRaw(buffer);
  const flags: ForensicFlag[] = [];
  const normal: NormalNote[] = [];
  const flag = (f: ForensicFlag) => flags.push(f);
  const ok = (code: string, title: string, desc: string) => normal.push({ code, title, desc });

  const creationDate = toIso(doc.getCreationDate() ?? null);
  const modificationDate = toIso(doc.getModificationDate() ?? null);
  const producer = getText(() => doc.getProducer());
  const creator = getText(() => doc.getCreator());
  const author = getText(() => doc.getAuthor());
  const title = getText(() => doc.getTitle());
  const subject = getText(() => doc.getSubject());
  const keywords = getText(() => doc.getKeywords());
  const pdfVersion = buffer.subarray(0, 16).toString('latin1').match(/%PDF-(\d\.\d)/)?.[1] || null;

  // XMP: raw packets (one per saved version when uncompressed) + the
  // catalog's current metadata stream (may be compressed).
  const packets = [...raw.xmpPackets];
  try {
    const md = doc.catalog.lookup(PDFName.of('Metadata'));
    const bytes = decodeStream(md);
    if (bytes) {
      const x = latin1(bytes);
      if (x.includes('xmpmeta') && !packets.includes(x)) packets.push(x);
    }
  } catch { /* none */ }
  const xmps = packets.map(parseXmp);
  const xmp = xmps[xmps.length - 1];

  const encryptedContent = raw.encrypted;
  const finalPrint = printDoc(doc);
  const pages = finalPrint.pages;

  // ---- 1. Saved versions (incremental updates) ----
  // A linearized ("fast web view") file legitimately has two %%EOF markers.
  const eofs = raw.eofEnds;
  const baseEofs = raw.linearized && eofs.length >= 2 ? 2 : 1;
  const laterSaves = Math.max(0, eofs.length - baseEofs);
  const revisions: RevisionInfo[] = [];
  if (laterSaves > 0 && !encryptedContent) {
    // Rebuild each version from the bytes up to its %%EOF and compare.
    const ends = eofs.slice(baseEofs - 1).slice(-MAX_REVISIONS);
    const prints: (DocPrint | null)[] = [];
    for (let i = 0; i < ends.length; i++) {
      const d = i === ends.length - 1 ? doc : await loadDoc(buffer.subarray(0, ends[i]));
      prints.push(d ? (i === ends.length - 1 ? finalPrint : printDoc(d)) : null);
    }
    const sigEndsByRev = (end: number, prevEnd: number) => raw.signatures.some((sg) => sg.coveredEnd > prevEnd && sg.coveredEnd <= end + 2);
    prints.forEach((p, i) => {
      if (i === 0) {
        revisions.push({ index: 1, producer: p?.producer ?? null, modified: p?.modified ?? null, pagesChanged: [], pagesAdded: 0, annotationsAdded: [], formFieldsChanged: 0, signed: false, kind: 'original', summary: `Original document${p?.producer ? `, made with ${p.producer}` : ''}.` });
        return;
      }
      const prev = prints[i - 1];
      if (!p || !prev) {
        revisions.push({ index: i + 1, producer: p?.producer ?? null, modified: p?.modified ?? null, pagesChanged: [], pagesAdded: 0, annotationsAdded: [], formFieldsChanged: 0, signed: false, kind: 'unknown', summary: 'Saved again; this version couldn’t be rebuilt to compare.' });
        return;
      }
      revisions.push(diffPrints(prev, p, sigEndsByRev(ends[i], ends[i - 1]), i + 1));
    });

    const content = revisions.filter((r) => r.kind === 'content');
    const markup = revisions.filter((r) => r.kind === 'markup');
    const benign = revisions.filter((r) => r.kind === 'form' || r.kind === 'signature' || r.kind === 'metadata');
    for (const r of content) {
      flag({
        sev: 'critical', code: 'VERSION_CONTENT_CHANGED',
        title: `Edited after it was created: ${r.pagesChanged.length ? pageList(r.pagesChanged) : 'pages'} changed`,
        desc: `The file still contains the earlier version. Version ${r.index}${r.modified ? ` (saved ${fmtDate(r.modified)})` : ''} ${r.summary.charAt(0).toLowerCase() + r.summary.slice(1)} Compare the numbers with what the sender confirmed.`,
        pts: 45,
      });
    }
    for (const r of markup) {
      const typed = r.annotationsAdded.includes('FreeText');
      flag({
        sev: 'warning', code: 'VERSION_MARKUP_ADDED',
        title: typed ? 'Text typed on top in a later save' : 'Markup added in a later save',
        desc: `Version ${r.index} ${r.summary.charAt(0).toLowerCase() + r.summary.slice(1)} Typed text boxes can cover the original numbers.`,
        pts: typed ? 25 : 10,
      });
    }
    if (!content.length && !markup.length && benign.length) {
      ok('LATER_SAVES_BENIGN', `Saved ${benign.length + 1} times — only ${Array.from(new Set(benign.map((r) => r.kind === 'form' ? 'form filling' : r.kind === 'signature' ? 'signing' : 'metadata updates'))).join(' and ')}`,
        'The later saves didn’t change any page content. Filling in form fields, signing, or re-saving is normal.');
    }
  } else if (laterSaves > 0 && encryptedContent) {
    flag({ sev: 'warning', code: 'VERSIONS_ENCRYPTED', title: `Saved ${laterSaves + 1} times (encrypted, couldn’t compare)`, desc: 'The file contains later saves, but it’s encrypted so we couldn’t see what changed.', pts: 10 });
  } else {
    ok('SINGLE_SAVE', 'Saved once', raw.linearized
      ? 'No later versions inside the file. Its two internal end markers come from “fast web view” formatting, which is normal.'
      : 'No later versions inside the file — it hasn’t been re-saved since it was made.');
  }

  // ---- 2. Digital signatures ----
  if (raw.signatures.length) {
    const lastCovered = Math.max(...raw.signatures.map((s) => s.coveredEnd));
    const fileEnd = eofs.length ? eofs[eofs.length - 1] : buffer.length;
    const changedAfter = revisions.some((r) => r.kind === 'content' || r.kind === 'markup') && fileEnd - lastCovered > 64;
    if (fileEnd - lastCovered > 64) {
      flag({
        sev: changedAfter ? 'critical' : 'warning', code: 'CHANGED_AFTER_SIGNING',
        title: changedAfter ? 'Pages changed after it was signed' : 'Saved again after it was signed',
        desc: changedAfter
          ? 'The digital signature covers an earlier version; the pages were changed afterwards. The signature doesn’t vouch for what you see now.'
          : 'Something was added after signing. It may only be another signature or form data — open it in Adobe Reader to see the signature status.',
        pts: changedAfter ? 45 : 10,
      });
    } else {
      ok('SIGNED_INTACT', 'Digitally signed, nothing changed since', 'The signature covers the whole file. That’s a good sign — but check in Adobe Reader that the signer is who you expect.');
    }
  }

  // ---- 3. Acrobat "Edit Text" marker ----
  const touchPages = pages.map((p, i) => (p.streams.some((s) => /TouchUp_TextEdit/.test(s)) ? i + 1 : 0)).filter(Boolean);
  if (touchPages.length || raw.touchUpRaw) {
    flag({
      sev: 'critical', code: 'TOUCHUP_TEXTEDIT',
      title: `Text was edited with Acrobat’s “Edit Text” tool${touchPages.length ? ` (${pageList(touchPages)})` : ''}`,
      desc: 'Acrobat leaves this marker on text someone retyped after the document was made. Look closely at amounts, dates and names.',
      pts: 45,
    });
  }

  // ---- 4. Cover-up boxes ----
  let coverHits = 0; const coverPages: number[] = []; let appendedCover = false;
  pages.forEach((p, i) => {
    p.streams.forEach((s, j) => {
      // In an added layer (j > 0) the covered text sits in an earlier layer.
      const earlierText = j > 0 && p.streams.slice(0, j).some((x) => TEXT_OP.test(x));
      const n = coverBoxes(s, p.width, p.height, earlierText);
      if (n) { coverHits += n; if (!coverPages.includes(i + 1)) coverPages.push(i + 1); if (j > 0) appendedCover = true; }
    });
  });
  // Editors that "edit" text usually append a new drawing layer: white box over
  // the old value, new text on top. In an added layer or a later save it's strong.
  const coverInChangedVersion = revisions.some((r) => r.kind === 'content' && r.pagesChanged.some((pg) => coverPages.includes(pg)));
  if (coverHits) {
    const strong = appendedCover || coverInChangedVersion;
    flag({
      sev: strong ? 'critical' : 'warning', code: 'COVER_BOX',
      title: `White box drawn over text, with new text on top (${pageList(coverPages)})`,
      desc: strong
        ? 'A white box was drawn over existing text and new text was written on it, in a layer added after the page was made. This is how values get covered and retyped.'
        : 'A white box sits between pieces of text. Some generators draw table cells this way, so on its own it’s only worth a look.',
      pts: strong ? 40 : 10,
    });
  }

  // ---- 5. Typed text boxes and other markup (final file) ----
  const freeText = pages.flatMap((p, i) => p.freeTextContents.map((c) => ({ page: i + 1, text: c })));
  if (freeText.length && !flags.some((f) => f.code === 'VERSION_MARKUP_ADDED')) {
    flag({
      sev: 'warning', code: 'FREETEXT_OVERLAY',
      title: `Text box typed on top of the page (${pageList(Array.from(new Set(freeText.map((f) => f.page))))})`,
      desc: `Someone added a typed text box${freeText[0].text ? ` reading “${freeText[0].text}”` : ''}. It can sit on top of the original value — click it in a PDF viewer to see what’s underneath.`,
      pts: 20,
    });
  }
  const widgets = pages.reduce((n, p) => n + p.annots.filter((a) => a === 'Widget').length, 0);
  if (widgets) ok('FORM_FIELDS', `Fillable form (${widgets} field${widgets === 1 ? '' : 's'})`, 'Form fields are meant to be filled in after the document is made. That’s normal.');

  // ---- 6. Invisible text ----
  const invisible = pages.map((p, i) => ({ i: i + 1, inv: p.streams.some((s) => /(?:^|\s)3\s+Tr\b/.test(s)), img: p.hasImage })).filter((x) => x.inv);
  const ocr = invisible.filter((x) => x.img);
  const hidden = invisible.filter((x) => !x.img);
  if (ocr.length) ok('OCR_LAYER', `Scanned page with a searchable text layer (${pageList(ocr.map((x) => x.i))})`, 'Invisible text over a scanned image is how OCR makes scans searchable. Normal.');
  if (hidden.length) {
    flag({ sev: 'warning', code: 'INVISIBLE_TEXT', title: `Invisible text on ${pageList(hidden.map((x) => x.i))}`, desc: 'The page contains text that’s drawn invisibly, with no scanned image behind it. It can be used to hide or plant content that copy-paste and search will pick up.', pts: 15 });
  }

  // ---- 7. Leftover duplicate objects (single-save files) ----
  if (laterSaves === 0) {
    const dupes = Array.from(raw.objCounts.values()).filter((n) => n > 1).length;
    if (dupes >= 2) {
      flag({ sev: 'warning', code: 'DUPLICATE_OBJECTS', title: `${dupes} leftover duplicate objects`, desc: 'The same internal objects appear more than once without a matching later save. Editing tools sometimes leave old copies behind.', pts: 12 });
    }
  }
  if (raw.genAbove0 > 0) {
    flag({ sev: 'info', code: 'OBJECT_GENERATIONS', title: 'Reused internal object numbers', desc: 'Some objects were deleted and their numbers reused, which happens when a file is edited and re-saved.', pts: 4 });
  }

  // ---- 8. Document IDs ----
  try {
    const id = (doc.context as any).trailerInfo?.ID;
    const parts = id instanceof PDFArray ? id.asArray().map((v) => (v instanceof PDFHexString || v instanceof PDFString ? v.asString() : '')) : [];
    if (parts.length === 2 && parts[0] && parts[1]) {
      if (parts[0] !== parts[1]) {
        // Expected when later saves exist; on its own it means the file was
        // rewritten by a program that kept the original ID.
        if (laterSaves === 0) flag({ sev: 'warning', code: 'DOCUMENT_ID_CHANGED', title: 'Document ID shows it was changed after creation', desc: 'PDFs carry two IDs: one from creation and one updated on each save. Here they differ, so a program re-saved the file after it was first made.', pts: 12 });
      } else {
        ok('DOCUMENT_ID_SAME', 'Document ID unchanged since creation', 'The file’s “created” and “last saved” IDs are the same.');
      }
    }
  } catch { /* no IDs */ }

  // ---- 9. Dates ----
  const now = Date.now();
  if (creationDate && modificationDate && Date.parse(modificationDate) < Date.parse(creationDate) - 60_000) {
    flag({ sev: 'critical', code: 'IMPOSSIBLE_DATES', title: 'Last-modified date is before the creation date', desc: 'That can’t happen naturally — the dates were set by hand or by a tool that rewrote them.', pts: 30 });
  }
  for (const [label, iso] of [['creation', creationDate], ['modified', modificationDate]] as const) {
    if (iso && Date.parse(iso) > now + 2 * 86_400_000) {
      flag({ sev: 'warning', code: 'FUTURE_DATE', title: `The ${label} date is in the future (${fmtDate(iso)})`, desc: 'A future date means the dates were set by hand or the computer’s clock was wrong.', pts: 15 });
    }
  }
  if (creationDate && modificationDate) {
    const diffMs = Date.parse(modificationDate) - Date.parse(creationDate);
    const days = diffMs / 86_400_000;
    const versionsExplain = revisions.length > 0;
    if (days > 30 && !versionsExplain) {
      flag({ sev: 'warning', code: 'EDITED_LONG_AFTER_CREATION', title: `Re-saved ${Math.floor(days)} days after it was created`, desc: 'The file was saved again weeks after it was made. Rate cons are rarely changed that long after.', pts: 20 });
    } else if (days > 1 && !versionsExplain) {
      flag({ sev: 'info', code: 'EDITED_AFTER_CREATION', title: `Re-saved ${Math.floor(days)} day${Math.floor(days) === 1 ? '' : 's'} after it was created`, desc: 'Could be a correction. Check the amounts match what you agreed.', pts: 8 });
    } else if (diffMs >= 0 && diffMs <= 60_000) {
      ok('DATES_CONSISTENT', 'Created and last saved at the same time', 'The creation and modification dates match — typical of a document generated in one go.');
    }
  }

  // ---- 10. XMP vs Info, and edit history ----
  if (xmp) {
    const infoProd = (producer || '').toLowerCase();
    const xmpProd = (xmp.producer || '').toLowerCase();
    if (infoProd && xmpProd && infoProd !== xmpProd && !infoProd.includes(xmpProd) && !xmpProd.includes(infoProd)) {
      flag({ sev: 'warning', code: 'XMP_PRODUCER_MISMATCH', title: 'The two metadata blocks disagree on the producing software', desc: `One says “${producer}”, the other “${xmp.producer}”. A second program saved the file and only updated one of them.`, pts: 12 });
    }
    if (xmp.modifyDate && modificationDate && Math.abs(Date.parse(xmp.modifyDate) - Date.parse(modificationDate)) > 5 * 60_000) {
      flag({ sev: 'info', code: 'XMP_DATE_MISMATCH', title: 'The two metadata blocks disagree on the last-saved date', desc: `One says ${fmtDate(modificationDate)}, the other ${fmtDate(new Date(xmp.modifyDate).toISOString())}. Usually means a second program re-saved the file.`, pts: 6 });
    }
    const agents = Array.from(new Set(xmps.flatMap((x) => x.history.map((h) => h.agent).filter(Boolean) as string[])));
    const editorInHistory = agents.map(editorHit).find(Boolean);
    if (editorInHistory) {
      flag({ sev: 'critical', code: 'XMP_HISTORY_EDITOR', title: `Edit history includes an online PDF editor (${editorInHistory})`, desc: `The file’s own edit history lists: ${agents.join(', ')}.`, pts: 35 });
    } else if (agents.length > 1) {
      flag({ sev: 'info', code: 'XMP_HISTORY_MULTIPLE', title: `Edit history lists ${agents.length} programs`, desc: `${agents.join(', ')}. Often just export plus a re-save; check it against the other findings.`, pts: 5 });
    }
  }

  // ---- 11. Producing software ----
  const editor = editorHit(producer) || editorHit(creator) || editorHit(xmp?.creatorTool) || editorHit(xmp?.producer);
  if (editor && !flags.some((f) => f.code === 'XMP_HISTORY_EDITOR')) {
    flag({ sev: 'critical', code: 'SUSPICIOUS_EDITOR', title: `Saved with an online PDF editor (${producer || creator || editor})`, desc: 'Free online PDF editors are a common way to alter a real document. Brokers and agents normally generate PDFs from their TMS or office software.', pts: 40 });
  } else if (isLegitProducer(producer) || isLegitProducer(creator)) {
    ok('KNOWN_PRODUCER', `Made with ${producer || creator}`, 'Typical software for generating business documents.');
  }
  if (producer && creator && !editor) {
    const p = producer.toLowerCase(), c = creator.toLowerCase();
    if ((p.includes('acrobat') || p.includes('preview') || p.includes('quartz')) && (c.includes('word') || c.includes('excel') || c.includes('office')) && laterSaves === 0) {
      flag({ sev: 'info', code: 'CREATOR_PRODUCER_MISMATCH', title: 'Made in one program, saved by another', desc: `Created in ${creator}, last saved by ${producer}. Often just print-to-PDF, but it’s also what downloading and re-saving looks like.`, pts: 6 });
    }
  }
  if (!creationDate && !modificationDate && !producer && !creator && !author && !xmp) {
    flag({ sev: 'warning', code: 'METADATA_STRIPPED', title: 'All metadata has been removed', desc: 'Business software normally records when and how a PDF was made. Stripping it hides the tool that last touched the file.', pts: 20 });
  }

  // ---- 12. Fonts ----
  const subsetsByFamily = new Map<string, Set<string>>();
  pages.forEach((p, i) => {
    for (const f of p.fonts) {
      const m = f.match(/^([A-Z]{6})\+(.+)$/);
      if (!m) continue;
      const key = `${i}:${m[2]}`;
      if (!subsetsByFamily.has(key)) subsetsByFamily.set(key, new Set());
      subsetsByFamily.get(key)!.add(m[1]);
    }
  });
  const dupFamilies = Array.from(subsetsByFamily.entries()).filter(([, s]) => s.size > 1).map(([k]) => k.split(':').slice(1).join(':'));
  if (dupFamilies.length) {
    flag({ sev: 'warning', code: 'FONT_SUBSETS', title: `Same font embedded twice on one page (${Array.from(new Set(dupFamilies)).slice(0, 2).join(', ')})`, desc: 'When text is added in a separate editing session the font is often embedded a second time. Worth comparing the text in that font.', pts: 12 });
  } else if (pages.some((p) => p.fonts.some((f) => /^[A-Z]{6}\+/.test(f)))) {
    ok('FONTS_NORMAL', 'Fonts look consistent', 'Each font is embedded once per page — no sign of text added in a separate session.');
  }

  // ---- 13. JavaScript ----
  if (raw.hasJavaScript) {
    flag({ sev: 'warning', code: 'JAVASCRIPT', title: 'Contains JavaScript', desc: 'Business documents like rate cons and certificates don’t need scripts. Don’t open it in a browser plugin you don’t trust.', pts: 15 });
  }
  if (encryptedContent && !laterSaves) {
    ok('ENCRYPTED', 'Password-protected or permission-locked', 'Some page checks couldn’t run because the content is encrypted. Locking a PDF is common and not suspicious by itself.');
  }

  // ---- score & verdict ----
  const raw100 = flags.reduce((s, f) => s + f.pts, 0);
  const legit = isLegitProducer(producer) || isLegitProducer(creator);
  const score = Math.min(100, Math.max(0, legit && !flags.some((f) => f.sev === 'critical') ? raw100 - 5 : raw100));
  const verdict: PdfForensics['verdict'] = score >= 50 || flags.some((f) => f.sev === 'critical' && f.pts >= 40) ? 'likely_tampered' : score >= 20 ? 'suspicious' : 'clean';
  const summary = verdict === 'likely_tampered'
    ? 'Strong signs this PDF was changed after it was made. See what changed below.'
    : verdict === 'suspicious'
      ? 'Some things worth a closer look, but no proof of editing.'
      : 'No signs of editing. Everything we checked looks normal.';

  return {
    metadata: {
      creationDate, modificationDate, producer, creator, author, title, subject, keywords, pdfVersion,
      pageCount: doc.getPageCount(), fileSizeBytes: buffer.length,
      xmpCreatorTool: xmp?.creatorTool || null, xmpProducer: xmp?.producer || null,
    },
    flags: flags.sort((a, b) => b.pts - a.pts),
    normal,
    revisions: revisions.length ? revisions : undefined,
    summary,
    score,
    verdict,
  };
}
