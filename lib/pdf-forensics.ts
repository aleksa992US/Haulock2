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
  // What the change on each changed page actually was:
  textChanges: { page: number; before: string; after: string }[]; // readable text that changed
  pagesGraphicsOnly: number[]; // drawing changed, text identical
  pagesTagsOnly: number[];     // only accessibility tags / structure markers
  kind: 'original' | 'content' | 'graphics' | 'structure' | 'markup' | 'form' | 'signature' | 'metadata' | 'unknown';
  summary: string;
};

// Where on the page a finding is, in PDF user space (origin bottom-left),
// so the preview can draw a box around it.
export type ForensicRegion = {
  page: number;                              // 1-based
  rect: [number, number, number, number];    // x1, y1, x2, y2
  kind: 'text_changed' | 'text_removed' | 'cover_box' | 'overlay' | 'markup' | 'invisible_text' | 'touchup' | 'drawing_added';
  sev: 'critical' | 'warning' | 'info';
  label: string;
  detail?: string;
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
  regions?: ForensicRegion[];
  fileSha256?: string;
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
  textSig: string;             // every text string drawn, raw, in order
  textBag: string;             // the same strings ignoring order (reordering ≠ editing)
  text: string;                // the readable part of it, for showing what changed
  drawSig: string;             // drawing with tags/structure markers and spacing removed
  annots: string[];            // annotation subtypes
  annotRects: { sub: string; rect: [number, number, number, number] | null; contents: string }[];
  freeTextContents: string[];
  type0Fonts: Set<string>;     // font resource names that use 2-byte codes
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
  const annotRects: PageScan['annotRects'] = [];
  const freeTextContents: string[] = [];
  const type0Fonts = new Set<string>();
  let hasImage = false;
  const fonts: string[] = [];
  try {
    const arr = page.node.Annots();
    for (const ref of arr ? arr.asArray() : []) {
      const a = (ref instanceof PDFRef ? doc.context.lookup(ref) : ref) as PDFDict;
      if (!(a instanceof PDFDict)) continue;
      const sub = nameOf(a.get(PDFName.of('Subtype'))) || 'Unknown';
      annots.push(sub);
      const contents = (textOf(a.get(PDFName.of('Contents'))) || '').slice(0, 120);
      if (sub === 'FreeText') freeTextContents.push(contents);
      let rect: [number, number, number, number] | null = null;
      try {
        const r = a.lookup(PDFName.of('Rect'));
        const nums = r instanceof PDFArray ? r.asArray().map((v: any) => Number(v?.asNumber?.() ?? NaN)) : [];
        if (nums.length === 4 && nums.every(isFinite)) rect = [Math.min(nums[0], nums[2]), Math.min(nums[1], nums[3]), Math.max(nums[0], nums[2]), Math.max(nums[1], nums[3])];
      } catch { /* no rect */ }
      annotRects.push({ sub, rect, contents });
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
      for (const [k, v] of fd.entries()) {
        const f = v instanceof PDFRef ? doc.context.lookup(v) : v;
        if (f instanceof PDFDict) {
          const base = nameOf(f.get(PDFName.of('BaseFont')));
          if (base) fonts.push(base);
          if (nameOf(f.get(PDFName.of('Subtype'))) === 'Type0') type0Fonts.add(k.asString().replace(/^\//, ''));
        }
      }
    }
  } catch { /* none */ }
  if (!hasImage && streams.some((s) => /\bBI\b[\s\S]*?\bID\b/.test(s))) hasImage = true; // inline image
  let width = 612, height = 792;
  try { const sz = page.getSize(); width = sz.width; height = sz.height; } catch { /* default letter */ }
  const joined = streams.join('\n');
  const runs = textRuns(joined);
  return {
    streams, hash: sha(joined),
    textSig: sha(runs.map((r) => r.raw).join('\u0001')),
    textBag: sha(runs.map((r) => r.raw).sort().join('\u0001')),
    text: runs.map((r) => r.text).join(''),
    // What gets painted (shapes, fills, images) as an unordered set. Tagging
    // tools reorder commands and re-write colour/positioning state without
    // changing what's drawn; a new box, line or image still shows.
    drawSig: sha(drawStatements(stripStructure(joined)).filter(isPaintStatement).sort().join('\n')),
    annots, annotRects, freeTextContents, type0Fonts, hasImage, fonts, width, height,
  };
}

// ---------- page layout (where things are drawn) ----------

type Mat = [number, number, number, number, number, number];
type Box = [number, number, number, number];
type LaidRun = { raw: string; text: string; box: Box; invisible: boolean; touchup: boolean };
type LaidRect = { key: string; box: Box; white: boolean; filled: boolean };
type Layout = { runs: LaidRun[]; rects: LaidRect[]; images: { key: string; box: Box }[] };

const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];
const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
];
function boxOf(m: Mat, x1: number, y1: number, x2: number, y2: number): Box {
  const pts = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function literalBody(tok: string): string {
  return tok.slice(1, -1).replace(/\\([nrtbf()\\]|[0-7]{1,3}|\r?\n)/g, (_x, e) =>
    /^[0-7]+$/.test(e) ? String.fromCharCode(parseInt(e, 8)) : ({ n: '\n', r: '', t: ' ', b: '', f: '' } as Record<string, string>)[e] ?? (/^\r?\n$/.test(e) ? '' : e));
}

const layoutCache = new WeakMap<PageScan, Layout>();

// A small content-stream interpreter: tracks the transformation and text
// matrices so each text string, rectangle and image gets a page position.
// Glyph widths are estimated (half an em), which is close enough to draw a
// highlight around a value.
function layoutOf(page: PageScan): Layout {
  const hit = layoutCache.get(page);
  if (hit) return hit;
  const out: Layout = { runs: [], rects: [], images: [] };
  const content = page.streams.join('\n').replace(/\bBI\b[\s\S]*?\bID\b[\s\S]*?\bEI\b/g, ' __INLINE_IMAGE__ ');
  type GS = { ctm: Mat; white: boolean; Tr: number; font: string; Tfs: number; TL: number; Th: number; Tc: number; Trise: number };
  let gs: GS = { ctm: IDENTITY, white: false, Tr: 0, font: '', Tfs: 12, TL: 0, Th: 1, Tc: 0, Trise: 0 };
  const stack: GS[] = [];
  let Tm: Mat = IDENTITY, Tlm: Mat = IDENTITY;
  let pending: { key: string; box: Box }[] = [];
  let touchupNext = false;
  let ops: string[] = [];
  let depth = 0;
  let arr: string[] | null = null;       // array being read
  let lastArr: string[] | null = null;   // last complete array operand (for TJ)

  const show = (tok: string) => {
    let n: number, text: string;
    if (tok.startsWith('(')) {
      text = literalBody(tok);
      n = text.length;
      if (!/^[\x20-\x7E\u00A0-\u00FF\n]*$/.test(text)) text = '';
    } else {
      const hex = tok.slice(1, -1).replace(/\s+/g, '');
      n = Math.ceil(hex.length / 2);
      text = '';
      if (hex.length % 2 === 0 && !page.type0Fonts.has(gs.font)) {
        let d = '';
        for (let i = 0; i < hex.length; i += 2) d += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
        text = /^[\x20-\x7E]*$/.test(d) ? d : '';
      }
    }
    if (page.type0Fonts.has(gs.font)) n = Math.ceil(n / 2); // 2-byte character codes
    const advance = n * (0.5 * gs.Tfs + gs.Tc) * gs.Th;
    const m = mul(Tm, gs.ctm);
    const box = boxOf(m, 0, gs.Trise - 0.22 * gs.Tfs, Math.max(advance, 0.3 * gs.Tfs), gs.Trise + 0.9 * gs.Tfs);
    out.runs.push({ raw: tok.startsWith('<') ? `<${tok.slice(1, -1).replace(/\s+/g, '')}>` : tok, text, box, invisible: gs.Tr === 3 || gs.Tr === 7, touchup: touchupNext });
    Tm = mul([1, 0, 0, 1, advance, 0], Tm);
  };
  const nextLine = (tx: number, ty: number) => { Tlm = mul([1, 0, 0, 1, tx, ty], Tlm); Tm = Tlm; };
  const num = (i: number) => Number(ops[ops.length - i]);

  const re = /\((?:\\[\s\S]|[^\\)])*\)|<<|>>|<[0-9A-Fa-f\s]*>|\[|\]|\/[^\s/<>\[\]()%]+|[-+]?(?:\d+\.?\d*|\.\d+)|[A-Za-z'"_][A-Za-z0-9*'"_]*|%[^\r\n]*/g;
  for (const mt of Array.from(content.matchAll(re))) {
    const t = mt[0];
    if (t.startsWith('%')) continue;
    if (t === '<<') { depth += 1; continue; }
    if (t === '>>') { depth = Math.max(0, depth - 1); continue; }
    if (depth > 0) continue; // inline dictionaries (marked-content properties)
    if (t === '[') { arr = []; continue; }
    if (t === ']') { lastArr = arr || []; arr = null; ops.push('__ARRAY__'); continue; }
    if (arr) { arr.push(t); continue; }
    if (!/^[A-Za-z'"_]/.test(t) || /^(true|false|null)$/.test(t)) { ops.push(t); continue; }
    const op = t;
    try {
      switch (op) {
        case 'q': stack.push({ ...gs }); break;
        case 'Q': gs = stack.pop() || gs; break;
        case 'cm': gs.ctm = mul([num(6), num(5), num(4), num(3), num(2), num(1)], gs.ctm); break;
        case 'rg': gs.white = num(3) === 1 && num(2) === 1 && num(1) === 1; break;
        case 'g': gs.white = num(1) === 1; break;
        case 'k': gs.white = num(4) === 0 && num(3) === 0 && num(2) === 0 && num(1) === 0; break;
        case 'sc': case 'scn': {
          const vals = ops.filter((o) => !o.startsWith('/')).map(Number).filter((x) => isFinite(x));
          gs.white = vals.length > 0 && (vals.length === 4 ? vals.every((v) => v === 0) : vals.every((v) => v === 1));
          break;
        }
        case 'cs': gs.white = false; break;
        case 're': {
          const [x, y, w, h] = [num(4), num(3), num(2), num(1)];
          pending.push({ key: `${ops.slice(-4).join(' ')}`, box: boxOf(gs.ctm, x, y, x + w, y + h) });
          break;
        }
        case 'f': case 'F': case 'f*': case 'B': case 'B*': case 'b': case 'b*':
          for (const r of pending) out.rects.push({ key: r.key, box: r.box, white: gs.white, filled: true });
          pending = []; break;
        case 'S': case 's':
          for (const r of pending) out.rects.push({ key: r.key, box: r.box, white: false, filled: false });
          pending = []; break;
        case 'n': pending = []; break;
        case 'Do': out.images.push({ key: `${ops[ops.length - 1]} ${gs.ctm.map((v) => v.toFixed(1)).join(' ')}`, box: boxOf(gs.ctm, 0, 0, 1, 1) }); break;
        case '__INLINE_IMAGE__': out.images.push({ key: `inline ${gs.ctm.map((v) => v.toFixed(1)).join(' ')}`, box: boxOf(gs.ctm, 0, 0, 1, 1) }); break;
        case 'BT': Tm = IDENTITY; Tlm = IDENTITY; break;
        case 'ET': touchupNext = false; break; // the edit marker covers one text block
        case 'Tf': gs.font = String(ops[ops.length - 2] || '').replace(/^\//, ''); gs.Tfs = num(1) || gs.Tfs; break;
        case 'TL': gs.TL = num(1); break;
        case 'Tz': gs.Th = num(1) / 100; break;
        case 'Tc': gs.Tc = num(1); break;
        case 'Ts': gs.Trise = num(1); break;
        case 'Tr': gs.Tr = num(1); break;
        case 'Td': nextLine(num(2), num(1)); break;
        case 'TD': gs.TL = -num(1); nextLine(num(2), num(1)); break;
        case 'Tm': Tlm = [num(6), num(5), num(4), num(3), num(2), num(1)]; Tm = Tlm; break;
        case 'T*': nextLine(0, -gs.TL); break;
        case 'Tj': { const s0 = ops[ops.length - 1]; if (s0) show(s0); break; }
        case "'": { nextLine(0, -gs.TL); const s0 = ops[ops.length - 1]; if (s0) show(s0); break; }
        case '"': { gs.Tc = num(2); nextLine(0, -gs.TL); const s0 = ops[ops.length - 1]; if (s0) show(s0); break; }
        case 'TJ':
          for (const el of lastArr || []) {
            if (el.startsWith('(') || el.startsWith('<')) show(el);
            else if (isFinite(Number(el))) Tm = mul([1, 0, 0, 1, (-Number(el) / 1000) * gs.Tfs * gs.Th, 0], Tm);
          }
          break;
        case 'MP': case 'BDC': case 'BMC': case 'DP':
          if (ops.some((o) => o === '/TouchUp_TextEdit')) touchupNext = true;
          break;
        default: break;
      }
    } catch { /* malformed operands: skip the operator */ }
    ops = [];
    lastArr = null;
  }
  layoutCache.set(page, out);
  return out;
}

// Merge nearby boxes (pieces of the same word or line) into one highlight.
function mergeBoxes(items: { box: Box; text: string }[], max = 12): { box: Box; text: string }[] {
  const sorted = items.slice().sort((a, b) => (b.box[1] - a.box[1]) || (a.box[0] - b.box[0]));
  const out: { box: Box; text: string }[] = [];
  for (const it of sorted) {
    const h = it.box[3] - it.box[1];
    const last = out[out.length - 1];
    if (last) {
      const lh = last.box[3] - last.box[1];
      const overlapY = Math.min(last.box[3], it.box[3]) - Math.max(last.box[1], it.box[1]);
      const gapX = it.box[0] - last.box[2];
      if (overlapY > 0.5 * Math.min(h, lh) && gapX < 1.5 * Math.max(h, lh) && gapX > -Math.max(h, lh) * 20) {
        last.box = [Math.min(last.box[0], it.box[0]), Math.min(last.box[1], it.box[1]), Math.max(last.box[2], it.box[2]), Math.max(last.box[3], it.box[3])];
        last.text = `${last.text}${it.text}`;
        continue;
      }
    }
    out.push({ box: [...it.box] as Box, text: it.text });
  }
  return out.slice(0, max);
}

// Overlap area as a share of the smaller box.
function overlapRatio(a: Box, b: Box): number {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return 0;
  const small = Math.min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]));
  return small > 0 ? (w * h) / small : 0;
}

// Runs in `b` that aren't in `a` (as a multiset of exact strings).
function unmatchedRuns(a: LaidRun[], b: LaidRun[]): LaidRun[] {
  const left = new Map<string, number>();
  for (const r of a) left.set(r.raw, (left.get(r.raw) || 0) + 1);
  const out: LaidRun[] = [];
  for (const r of b) {
    const n = left.get(r.raw) || 0;
    if (n > 0) left.set(r.raw, n - 1);
    else out.push(r);
  }
  return out;
}

function sane(box: Box, page: PageScan): boolean {
  const [x1, y1, x2, y2] = box;
  if (![x1, y1, x2, y2].every(isFinite)) return false;
  if (x2 - x1 < 1 || y2 - y1 < 1) return false;
  // Allow for MediaBox offsets; reject boxes clearly off the page.
  return x2 > -page.width && x1 < page.width * 2 && y2 > -page.height && y1 < page.height * 2;
}

// Text strings drawn inside BT…ET blocks. `raw` is exact (any change shows);
// `text` is the readable form when the font encoding is plain (literal
// strings or single-byte hex) — CID fonts stay unreadable but still compare.
function textRuns(content: string): { raw: string; text: string }[] {
  const out: { raw: string; text: string }[] = [];
  for (const block of Array.from(content.matchAll(/\bBT\b([\s\S]*?)\bET\b/g))) {
    for (const m of Array.from(block[1].matchAll(/\((?:\\[\s\S]|[^\\)])*\)|(?<!<)<([0-9A-Fa-f\s]+)>(?!>)/g))) {
      if (m[0].startsWith('(')) {
        const body = m[0].slice(1, -1).replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_x, e) =>
          /^[0-7]+$/.test(e) ? String.fromCharCode(parseInt(e, 8)) : ({ n: '\n', r: '', t: ' ', b: '', f: '' } as Record<string, string>)[e] ?? e);
        out.push({ raw: m[0], text: /^[\x20-\x7E\u00A0-\u00FF\n]*$/.test(body) ? body : '' });
      } else {
        const hex = (m[1] || '').replace(/\s+/g, '');
        let decoded = '';
        if (hex.length % 2 === 0) {
          for (let i = 0; i < hex.length; i += 2) decoded += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
        }
        out.push({ raw: `<${hex}>`, text: /^[\x20-\x7E]*$/.test(decoded) ? decoded : '' });
      }
    }
  }
  return out;
}

// Remove tagged-PDF / structure markers (BDC…EMC, BMC, MP, DP) and spacing,
// so adding accessibility tags isn't mistaken for changing the page.
function stripStructure(content: string): string {
  return content
    .replace(/\/[^\s/<>\[\]()]+\s*(?:<<(?:[^<>]|<<[^<>]*>>)*>>|\/[^\s/<>\[\]()]+)?\s*(?:BDC|BMC|MP|DP)\b/g, ' ')
    .replace(/\bEMC\b/g, ' ')
    .replace(/%[^\n\r]*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Split a content stream into drawing statements ("operands operator").
function drawStatements(content: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let depth = 0;
  const re = /\((?:\\[\s\S]|[^\\)])*\)|<<|>>|<[0-9A-Fa-f\s]*>|\[|\]|\/[^\s/<>\[\]()%]+|[-+]?(?:\d+\.?\d*|\.\d+)|[A-Za-z'"][A-Za-z0-9*'"]*/g;
  for (const m of Array.from(content.matchAll(re))) {
    const t = m[0];
    if (t === '[' || t === '<<') { depth += 1; cur.push(t); continue; }
    if (t === ']' || t === '>>') { depth = Math.max(0, depth - 1); cur.push(t); continue; }
    if (depth === 0 && /^[A-Za-z'"]/.test(t) && !/^(true|false|null)$/.test(t)) {
      cur.push(t);
      out.push(cur.join(' '));
      cur = [];
      continue;
    }
    cur.push(t);
  }
  return out;
}

// Path construction, painting, images and shadings. Graphics state (colour,
// line width, q/Q, cm) and text positioning are left out: Acrobat re-emits
// those freely when it re-saves or tags a page.
const PAINT_OPS = new Set(['m', 'l', 'c', 'v', 'y', 'h', 're', 'f', 'F', 'f*', 'S', 's', 'B', 'B*', 'b', 'b*', 'Do', 'sh']);
function isPaintStatement(statement: string): boolean {
  return PAINT_OPS.has(statement.slice(statement.lastIndexOf(' ') + 1));
}

// The part of the readable text that differs: common start and end trimmed.
function textDelta(a: string, b: string): { before: string; after: string } | null {
  if (!a && !b) return null;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  const clip = (x: string) => x.replace(/\s+/g, ' ').trim().slice(0, 80);
  // Widen to whole words for context.
  let s = i; while (s > 0 && /\S/.test(a[s - 1] || '') && i - s < 20) s--;
  let e = 0; while (e < j && /\S/.test(a[a.length - j + e] || '') && e < 20) e++; // shared tail: same in both
  const before = clip(a.slice(s, a.length - j + e));
  const after = clip(b.slice(s, b.length - j + e));
  return before || after ? { before, after } : null;
}

const TEXT_OP = /\b(Tj|TJ|'|")\s/;
// White fill colour (RGB 1 1 1, gray 1, or CMYK 0 0 0 0) followed by a filled rectangle.
const WHITE_RECT = /(?:(?:^|\s)1(?:\.0+)?\s+1(?:\.0+)?\s+1(?:\.0+)?\s+(?:rg|sc|scn)|(?:^|\s)1(?:\.0+)?\s+g|(?:^|\s)0(?:\.0+)?\s+0(?:\.0+)?\s+0(?:\.0+)?\s+0(?:\.0+)?\s+k)\s+(?:[^\n]{0,200}?\s)?(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+re\s+(?:[\s\S]{0,20}?)\bf\*?(?=\s)/g;

// A white rectangle drawn AFTER text and FOLLOWED by more text in the same
// stream is the classic cover-up: hide a value, type a new one on top.
// Full-page or tiny rectangles (backgrounds, rules) are ignored.
function coverBoxes(stream: string, pageW: number, pageH: number, textInEarlierLayer = false): string[] {
  const hits: string[] = []; // "x y w h" as written, to find the box on the page
  for (const m of Array.from(stream.matchAll(WHITE_RECT))) {
    const w = Math.abs(Number(m[3]));
    const h = Math.abs(Number(m[4]));
    if (!isFinite(w) || !isFinite(h) || w < 4 || h < 4) continue;
    if (w * h > pageW * pageH * 0.6) continue; // background
    const at = m.index as number;
    const before = stream.slice(0, at);
    const after = stream.slice(at + m[0].length);
    if ((textInEarlierLayer || TEXT_OP.test(before)) && TEXT_OP.test(after)) hits.push(`${m[1]} ${m[2]} ${m[3]} ${m[4]}`);
  }
  return hits;
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
  const pagesGraphicsOnly: number[] = [];
  const pagesTagsOnly: number[] = [];
  const textChanges: RevisionInfo['textChanges'] = [];
  const shared = Math.min(prev.pages.length, next.pages.length);
  for (let i = 0; i < shared; i++) {
    const a = prev.pages[i], b = next.pages[i];
    if (a.hash === b.hash) continue;
    if (a.textSig !== b.textSig && a.textBag !== b.textBag) {
      pagesChanged.push(i + 1);
      const d = textDelta(a.text, b.text);
      if (d) textChanges.push({ page: i + 1, ...d });
    } else if (a.drawSig !== b.drawSig) {
      pagesGraphicsOnly.push(i + 1);
    } else {
      pagesTagsOnly.push(i + 1);
    }
  }
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
    const shown = textChanges.find((t) => t.before || t.after);
    summary = shown
      ? `Changed the text on ${pageList(pagesChanged)}${by}: “${shown.before || '(nothing)'}” became “${shown.after || '(removed)'}”.`
      : `Changed the text on ${pageList(pagesChanged)}${by}.`;
  } else if (pagesGraphicsOnly.length) {
    kind = 'graphics';
    summary = `Changed the drawing on ${pageList(pagesGraphicsOnly)}${by}; the text is the same.`;
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
  } else if (pagesTagsOnly.length) {
    kind = 'structure';
    summary = `Added accessibility tags or structure to ${pageList(pagesTagsOnly)}; the visible text and drawing didn’t change.`;
  } else {
    kind = 'metadata';
    summary = 'Re-saved without changing the pages (metadata only).';
  }
  return { index, producer: next.producer, modified: next.modified, pagesChanged, pagesAdded, annotationsAdded, formFieldsChanged, signed: signedHere, textChanges, pagesGraphicsOnly, pagesTagsOnly, kind, summary };
}

// ---------- main ----------

export async function analyzePdfForensics(buffer: Buffer): Promise<PdfForensics> {
  const doc = await PDFDocument.load(buffer, { updateMetadata: false, ignoreEncryption: true, throwOnInvalidObject: false });
  const raw = scanRaw(buffer);
  const flags: ForensicFlag[] = [];
  const normal: NormalNote[] = [];
  const flag = (f: ForensicFlag) => flags.push(f);
  const ok = (code: string, title: string, desc: string) => normal.push({ code, title, desc });
  const regions: ForensicRegion[] = [];
  const region = (page: PageScan, pageNo: number, box: Box, kind: ForensicRegion['kind'], sev: ForensicRegion['sev'], label: string, detail?: string) => {
    if (regions.length >= 80 || !sane(box, page)) return;
    const pad = kind === 'text_changed' || kind === 'text_removed' || kind === 'touchup' || kind === 'invisible_text' ? 1.5 : 0;
    regions.push({
      page: pageNo,
      rect: [box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad].map((v) => Math.round(v * 10) / 10) as Box,
      kind, sev, label,
      ...(detail ? { detail: detail.replace(/\s+/g, ' ').trim().slice(0, 120) } : {}),
    });
  };

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
      if (i === ends.length - 1) { prints.push(finalPrint); continue; }
      const d = await loadDoc(buffer.subarray(0, ends[i]));
      let pr: DocPrint | null = null;
      try { pr = d ? printDoc(d) : null; } catch { pr = null; } // e.g. no catalog yet
      prints.push(pr);
    }
    const sigEndsByRev = (end: number, prevEnd: number) => raw.signatures.some((sg) => sg.coveredEnd > prevEnd && sg.coveredEnd <= end + 2);
    prints.forEach((p, i) => {
      if (i === 0) {
        revisions.push({ index: 1, producer: p?.producer ?? null, modified: p?.modified ?? null, pagesChanged: [], pagesAdded: 0, annotationsAdded: [], formFieldsChanged: 0, signed: false, textChanges: [], pagesGraphicsOnly: [], pagesTagsOnly: [], kind: 'original', summary: `Original document${p?.producer ? `, made with ${p.producer}` : ''}.` });
        return;
      }
      const prev = prints[i - 1];
      if (!p || !prev) {
        revisions.push({ index: i + 1, producer: p?.producer ?? null, modified: p?.modified ?? null, pagesChanged: [], pagesAdded: 0, annotationsAdded: [], formFieldsChanged: 0, signed: false, textChanges: [], pagesGraphicsOnly: [], pagesTagsOnly: [], kind: 'unknown', summary: 'Saved again; this version couldn’t be rebuilt to compare.' });
        return;
      }
      revisions.push(diffPrints(prev, p, sigEndsByRev(ends[i], ends[i - 1]), i + 1));
    });

    // Where each change is on the page.
    revisions.forEach((r, i) => {
      const prev = prints[i - 1], next = prints[i];
      if (!prev || !next || i === 0) return;
      for (const pg of r.pagesChanged) {
        const a = prev.pages[pg - 1], b = next.pages[pg - 1];
        if (!a || !b) continue;
        const la = layoutOf(a), lb = layoutOf(b);
        const added = unmatchedRuns(la.runs, lb.runs);
        const removed = unmatchedRuns(lb.runs, la.runs);
        // A page whose text was re-encoded throughout has nothing specific to point at.
        if (added.length > 40 && added.length > 0.6 * lb.runs.length) continue;
        const gone = mergeBoxes(removed.map((x) => ({ box: x.box, text: x.text })), 8);
        const used = new Set<number>();
        for (const m of mergeBoxes(added.map((x) => ({ box: x.box, text: x.text })))) {
          // Old text in the same spot: one box showing "before → after".
          const k = gone.findIndex((g, gi) => !used.has(gi) && overlapRatio(g.box, m.box) > 0.5);
          if (k >= 0) {
            used.add(k);
            const d = textDelta(gone[k].text, m.text);
            region(b, pg, m.box, 'text_changed', 'critical', `Text changed in version ${r.index}`,
              d && (d.before || d.after) ? `“${d.before || '(nothing)'}” → “${d.after || '(removed)'}”` : m.text ? `Now reads “${m.text}”` : undefined);
          } else {
            region(b, pg, m.box, 'text_changed', 'critical', `Text added in version ${r.index}`, m.text ? `Reads “${m.text}”` : undefined);
          }
        }
        gone.forEach((g, gi) => {
          if (!used.has(gi)) region(a, pg, g.box, 'text_removed', 'warning', `Text removed in version ${r.index}`, g.text ? `Used to read “${g.text}”` : undefined);
        });
      }
      for (const pg of [...r.pagesChanged, ...r.pagesGraphicsOnly]) {
        const a = prev.pages[pg - 1], b = next.pages[pg - 1];
        if (!a || !b) continue;
        const area = b.width * b.height;
        const left = new Map<string, number>();
        const key = (x: LaidRect) => `${x.key}|${x.filled}|${x.white}`;
        for (const x of layoutOf(a).rects) left.set(key(x), (left.get(key(x)) || 0) + 1);
        let shown = 0;
        for (const x of layoutOf(b).rects) {
          const n = left.get(key(x)) || 0;
          if (n > 0) { left.set(key(x), n - 1); continue; }
          const w = x.box[2] - x.box[0], h = x.box[3] - x.box[1];
          if (w < 3 || h < 3 || w * h > area * 0.6 || shown >= 6) continue; // rules and backgrounds
          shown += 1;
          region(b, pg, x.box, 'drawing_added', x.white ? 'critical' : 'warning', x.white ? `White box added in version ${r.index}` : `Shape added in version ${r.index}`,
            x.white ? 'Covers whatever was underneath it' : undefined);
        }
        const imgs = new Map<string, number>();
        for (const x of layoutOf(a).images) imgs.set(x.key, (imgs.get(x.key) || 0) + 1);
        for (const x of layoutOf(b).images) {
          const n = imgs.get(x.key) || 0;
          if (n > 0) { imgs.set(x.key, n - 1); continue; }
          const w = x.box[2] - x.box[0], h = x.box[3] - x.box[1];
          if (w * h > area * 0.9) continue; // full-page scan
          region(b, pg, x.box, 'drawing_added', 'warning', `Image added in version ${r.index}`, 'Stamps and logos look like this; so does a pasted-in value');
        }
      }
      if (r.kind === 'markup') {
        for (let pg = 1; pg <= next.pages.length; pg++) {
          const a = prev.pages[pg - 1], b = next.pages[pg - 1];
          if (!b) continue;
          const had = new Set((a?.annotRects || []).map((x) => `${x.sub}|${x.rect?.join(',')}`));
          for (const x of b.annotRects) {
            if (!x.rect || x.sub === 'Widget' || x.sub === 'Link' || x.sub === 'FreeText' || had.has(`${x.sub}|${x.rect.join(',')}`)) continue;
            region(b, pg, x.rect, 'markup', 'warning', `${x.sub} added in version ${r.index}`, x.contents || undefined);
          }
        }
      }
    });

    const content = revisions.filter((r) => r.kind === 'content');
    const graphics = revisions.filter((r) => r.kind === 'graphics');
    const markup = revisions.filter((r) => r.kind === 'markup');
    const benign = revisions.filter((r) => r.kind === 'form' || r.kind === 'signature' || r.kind === 'metadata' || r.kind === 'structure');
    for (const r of content) {
      const shown = r.textChanges.find((t) => t.before || t.after);
      flag({
        sev: 'critical', code: 'VERSION_CONTENT_CHANGED',
        title: shown
          ? `Text changed after it was created: “${shown.before || '(nothing)'}” → “${shown.after || '(removed)'}”`
          : `Text changed after it was created (${pageList(r.pagesChanged)})`,
        desc: `The file still contains the earlier version. Version ${r.index}${r.modified ? ` (saved ${fmtDate(r.modified)})` : ''} ${r.summary.charAt(0).toLowerCase() + r.summary.slice(1)} Compare it with what the sender confirmed.`,
        pts: 45,
      });
    }
    for (const r of graphics) {
      flag({
        sev: 'warning', code: 'VERSION_GRAPHICS_CHANGED',
        title: `Drawing changed in a later save (${pageList(r.pagesGraphicsOnly)})`,
        desc: `Version ${r.index} changed lines, shapes or images, but none of the text. Often harmless (a logo or stamp), but a box drawn over a value looks like this too.`,
        pts: 15,
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
    if (!content.length && !graphics.length && !markup.length && benign.length) {
      ok('LATER_SAVES_BENIGN', `Saved ${benign.length + 1} times — only ${Array.from(new Set(benign.map((r) => r.kind === 'form' ? 'form filling' : r.kind === 'signature' ? 'signing' : r.kind === 'structure' ? 'accessibility tags' : 'metadata updates'))).join(' and ')}`,
        'The later saves didn’t change any visible text or drawing. Filling in form fields, signing, adding accessibility tags or re-saving is normal.');
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
  const coverKeys: { page: number; key: string }[] = [];
  pages.forEach((p, i) => {
    p.streams.forEach((s, j) => {
      // In an added layer (j > 0) the covered text sits in an earlier layer.
      const earlierText = j > 0 && p.streams.slice(0, j).some((x) => TEXT_OP.test(x));
      const keys = coverBoxes(s, p.width, p.height, earlierText);
      if (keys.length) {
        coverHits += keys.length;
        if (!coverPages.includes(i + 1)) coverPages.push(i + 1);
        if (j > 0) appendedCover = true;
        for (const key of keys) coverKeys.push({ page: i + 1, key });
      }
    });
  });
  // Editors that "edit" text usually append a new drawing layer: white box over
  // the old value, new text on top. In an added layer or a later save it's strong.
  const coverInChangedVersion = revisions.some((r) => (r.kind === 'content' || r.kind === 'graphics') && [...r.pagesChanged, ...r.pagesGraphicsOnly].some((pg) => coverPages.includes(pg)));
  if (coverHits) {
    const strong = appendedCover || coverInChangedVersion;
    flag({
      sev: strong ? 'critical' : 'info', code: 'COVER_BOX',
      title: `White box drawn over text, with new text on top (${pageList(coverPages)})`,
      desc: strong
        ? 'A white box was drawn over existing text and new text was written on it, in a layer added after the page was made. This is how values get covered and retyped.'
        : 'A white box sits between pieces of text. Many generators draw table cells this way, so on its own it’s just a note.',
      pts: strong ? 40 : 4,
    });
    if (strong) {
      for (const c of coverKeys) {
        const p = pages[c.page - 1];
        const rect = layoutOf(p).rects.find((x) => x.white && x.filled && x.key === c.key);
        if (rect) region(p, c.page, rect.box, 'cover_box', 'critical', 'White box over the original text', 'New text was written on top of it');
      }
    }
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
  pages.forEach((p, i) => {
    for (const a of p.annotRects) {
      if (a.sub === 'FreeText' && a.rect) region(p, i + 1, a.rect, 'overlay', 'warning', 'Typed text box on top of the page', a.contents ? `Reads “${a.contents}”` : undefined);
    }
  });
  const widgets = pages.reduce((n, p) => n + p.annots.filter((a) => a === 'Widget').length, 0);
  if (widgets) ok('FORM_FIELDS', `Fillable form (${widgets} field${widgets === 1 ? '' : 's'})`, 'Form fields are meant to be filled in after the document is made. That’s normal.');

  // ---- 6. Invisible text ----
  const invisible = pages.map((p, i) => ({ i: i + 1, inv: p.streams.some((s) => /(?:^|\s)3\s+Tr\b/.test(s)), img: p.hasImage })).filter((x) => x.inv);
  const ocr = invisible.filter((x) => x.img);
  const hidden = invisible.filter((x) => !x.img);
  if (ocr.length) ok('OCR_LAYER', `Scanned page with a searchable text layer (${pageList(ocr.map((x) => x.i))})`, 'Invisible text over a scanned image is how OCR makes scans searchable. Normal.');
  if (hidden.length) {
    flag({ sev: 'warning', code: 'INVISIBLE_TEXT', title: `Invisible text on ${pageList(hidden.map((x) => x.i))}`, desc: 'The page contains text that’s drawn invisibly, with no scanned image behind it. It can be used to hide or plant content that copy-paste and search will pick up.', pts: 15 });
    for (const h of hidden) {
      const p = pages[h.i - 1];
      for (const m of mergeBoxes(layoutOf(p).runs.filter((r) => r.invisible).map((r) => ({ box: r.box, text: r.text })), 8)) {
        region(p, h.i, m.box, 'invisible_text', 'warning', 'Invisible text', m.text ? `Hidden text reads “${m.text}”` : undefined);
      }
    }
  }
  touchPages.forEach((pg) => {
    const p = pages[pg - 1];
    for (const m of mergeBoxes(layoutOf(p).runs.filter((r) => r.touchup).map((r) => ({ box: r.box, text: r.text })), 8)) {
      region(p, pg, m.box, 'touchup', 'critical', 'Retyped with Acrobat “Edit Text”', m.text ? `Reads “${m.text}”` : undefined);
    }
  });

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
    flag({ sev: 'warning', code: 'METADATA_STRIPPED', title: 'No metadata at all', desc: 'Most business software records when and how a PDF was made. Some simple generators don’t, but stripping it is also how an editing tool gets hidden. On its own it’s only worth a look.', pts: 12 });
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
  // Any single warning worth 15+ (typed text on top, invisible text, a
  // later markup save…) makes it at least "worth a closer look", whatever
  // the producer bonus does to the score.
  const verdict: PdfForensics['verdict'] = score >= 50 || flags.some((f) => f.sev === 'critical' && f.pts >= 40)
    ? 'likely_tampered'
    : score >= 20 || flags.some((f) => f.sev !== 'info' && f.pts >= 15) ? 'suspicious' : 'clean';
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
    regions: regions.length ? regions : undefined,
    fileSha256: sha(buffer),
    summary,
    score,
    verdict,
  };
}
