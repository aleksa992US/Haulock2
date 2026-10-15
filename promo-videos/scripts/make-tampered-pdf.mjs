// Builds the sample rate con for the `pdf-tamper` reel: a two-page rate con from a
// fictional broker, signed, then edited in four later saves, each kept inside the
// file as an incremental update the way real PDF editors save:
//   v1 original · v2 broker signs · v3 line-haul rate changed $1,400 → $1,100 ·
//   v4 white box over the detention terms with "Not paid" typed on top ·
//   v5 lumper line made invisible · v6 page 2 (TONU / layover terms) removed.
// Names come from the site's vetted fictional companies (commit 84f1862).
// Usage: node scripts/make-tampered-pdf.mjs [out.pdf]
import fs from 'node:fs';
import path from 'node:path';

const out = path.resolve(process.argv[2] || 'public/recordings/rate-con-4821.pdf');

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const t = (x, y, size, font, str, gray = 0) => `BT /${font} ${size} Tf ${gray} g 1 0 0 1 ${x} ${y} Tm (${esc(str)}) Tj ET`;
const hr = (x1, x2, y, gray = 0.82, w = 0.6) => `q ${gray} G ${w} w ${x1} ${y} m ${x2} ${y} l S Q`;

// ---------- page content ----------
const page1 = ({ whiteOut = false, lumperHidden = false } = {}) =>
  [
    // Header band
    'q 0.94 0.95 0.97 rg 48 712 516 52 re f Q',
    t(62, 731, 19, 'F2', 'RATE CONFIRMATION'),
    t(430, 742, 12, 'F2', 'Load #4821'),
    t(430, 727, 9, 'F1', 'Issued 10/14/2026', 0.35),
    // Parties
    t(62, 688, 8, 'F2', 'BROKER', 0.45),
    t(62, 673, 12, 'F2', 'Quillmont Freight Solutions'),
    t(62, 659, 9, 'F1', 'Dispatch (555) 014-2290', 0.35),
    t(330, 688, 8, 'F2', 'CARRIER', 0.45),
    t(330, 673, 12, 'F2', 'Keystone Freight Network'),
    t(330, 659, 9, 'F1', 'Truck #18 · 53 ft dry van', 0.35),
    hr(62, 550, 642),
    // Stops
    t(62, 622, 8, 'F2', 'PICKUP', 0.45),
    t(62, 607, 11, 'F1', 'Dallas, TX 75212'),
    t(62, 593, 9, 'F1', 'Thu 10/16/2026 · 08:00', 0.35),
    t(330, 622, 8, 'F2', 'DELIVERY', 0.45),
    t(330, 607, 11, 'F1', 'Atlanta, GA 30336'),
    t(330, 593, 9, 'F1', 'Fri 10/17/2026 · 14:00', 0.35),
    t(62, 568, 9, 'F1', 'Commodity: packaged foods · 38,000 lbs · no tarps', 0.35),
    hr(62, 550, 552),
    // Rate & accessorials
    t(62, 532, 8, 'F2', 'RATE & ACCESSORIALS', 0.45),
    t(62, 511, 11, 'F1', 'Line haul (all-in)'),
    hr(62, 550, 499, 0.9),
    t(62, 483, 11, 'F1', 'Detention'),
    ...(whiteOut
      ? ['q 1 1 1 rg 326 477 200 19 re f Q', t(330, 483, 11, 'F1', 'Not paid')]
      : [t(330, 483, 11, 'F1', '$50/hr after 2 hrs free')]),
    hr(62, 550, 471, 0.9),
    t(62, 455, 11, 'F1', 'Lumper'),
    lumperHidden
      ? `BT /F1 11 Tf 0 g 3 Tr 1 0 0 1 330 455 Tm (${esc('Reimbursed with receipt')}) Tj 0 Tr ET`
      : t(330, 455, 11, 'F1', 'Reimbursed with receipt'),
    hr(62, 550, 443, 0.9),
    t(62, 427, 11, 'F1', 'Payment terms'),
    t(330, 427, 11, 'F1', 'Quick pay, 2 business days'),
    hr(62, 550, 415, 0.9),
    t(62, 397, 9, 'F3', 'See page 2 for TONU, layover and fuel advance terms.', 0.35),
    // Signatures
    t(62, 352, 8, 'F2', 'BROKER SIGNATURE', 0.45),
    hr(62, 290, 306, 0.6),
    t(330, 352, 8, 'F2', 'CARRIER SIGNATURE', 0.45),
    hr(330, 550, 306, 0.6),
    t(500, 40, 8, 'F1', 'Page 1 of 2', 0.45),
  ].join('\n');

const page2 = [
  t(62, 731, 15, 'F2', 'CARRIER TERMS & ACCESSORIALS'),
  t(62, 714, 9, 'F1', 'Load #4821 · Quillmont Freight Solutions', 0.35),
  hr(62, 550, 700),
  t(62, 676, 11, 'F1', 'Truck order not used (TONU): $150'),
  t(62, 654, 11, 'F1', 'Layover: $250 per day'),
  t(62, 632, 11, 'F1', 'Fuel advance: up to 40% of line haul'),
  t(62, 610, 11, 'F1', 'Detention billed hourly after 2 free hours, signed in/out times required'),
  t(62, 588, 11, 'F1', 'Rate is all-in. Broker pays within 2 business days of POD.'),
  t(500, 40, 8, 'F1', 'Page 2 of 2', 0.45),
].join('\n');

const fieldAp = (value) => `/Tx BMC q BT /F2 12 Tf 0 g 1 0 0 1 4 6 Tm (${esc(value)}) Tj ET Q EMC`;
const sigAp = [
  'q 0.11 0.17 0.42 RG 1.2 w 6 18 m 30 34 42 6 66 24 c 80 34 92 10 110 22 c S Q',
  t(124, 20, 12, 'F3', 'Quillmont Freight', 0.1),
  t(6, 5, 7, 'F1', 'Digitally signed 10/14/2026 09:15 CT', 0.35),
].join('\n');

// ---------- writer ----------
const stream = (dict, body) => `<< ${dict} /Length ${Buffer.byteLength(body, 'latin1')} >>\nstream\n${body}\nendstream`;
const FONTS = '/Font << /F1 7 0 R /F2 8 0 R /F3 13 0 R >>';
const info = (producer, mod) =>
  `<< /Title (Rate Confirmation - Load 4821) /Author (Quillmont Freight Solutions) /Creator (Quillmont TMS) /Producer (${producer}) /CreationDate (D:20261014091200-05'00') /ModDate (${mod}) >>`;
const ID1 = '<6A1F3C92E07B4D18A55C0E7D93B2F416>';
const id = (second) => `/ID [${ID1} ${second}]`;

let file = '';
let lastXref = 0;
let size = 0;

const section = (objs, trailerExtra, { first = false } = {}) => {
  const offsets = [];
  if (first) file += '%PDF-1.7\n%\xE2\xE3\xCF\xD3\n';
  for (const [num, body] of objs) {
    offsets.push([num, file.length]);
    file += `${num} 0 obj\n${body}\nendobj\n`;
    size = Math.max(size, num + 1);
  }
  const xref = file.length;
  file += 'xref\n';
  if (first) file += '0 1\n0000000000 65535 f\r\n';
  for (const [num, off] of offsets.sort((a, b) => a[0] - b[0])) file += `${num} 1\n${String(off).padStart(10, '0')} 00000 n\r\n`;
  file += `trailer\n<< /Size ${size} /Root 1 0 R /Info 9 0 R ${trailerExtra}${first ? '' : ` /Prev ${lastXref}`} >>\nstartxref\n${xref}\n%%EOF\n`;
  lastXref = xref;
};

// v1 — original from the broker's TMS (Chrome print engine), rate filled in.
const RATE_RECT = '[326 503 470 523]';
const rateField = (value) =>
  `<< /Type /Annot /Subtype /Widget /FT /Tx /T (Line haul) /V (${esc(value)}) /Rect ${RATE_RECT} /P 3 0 R /F 4 /DA (/F2 12 Tf 0 g) /AP << /N 12 0 R >> >>`;
const catalog = (fields, sigFlags = '') => `<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [${fields}] /DA (/F1 10 Tf 0 g) /DR << ${FONTS} >>${sigFlags} >> >>`;
const page1Obj = (annots) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << ${FONTS} >> /Contents 4 0 R /Annots [${annots}] >>`;

section(
  [
    [1, catalog('10 0 R')],
    [2, '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>'],
    [3, page1Obj('10 0 R')],
    [4, stream('', page1())],
    [5, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R /F2 8 0 R >> >> /Contents 6 0 R >>'],
    [6, stream('', page2)],
    [7, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'],
    [8, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'],
    [9, info('Skia/PDF m118', "D:20261014091200-05'00'")],
    [10, rateField('$1,400.00')],
    [12, stream(`/Type /XObject /Subtype /Form /BBox [0 0 144 20] /Resources << ${FONTS} >>`, fieldAp('$1,400.00'))],
    [13, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>'],
  ],
  id(ID1),
  { first: true }
);

// v2 — broker signs. The signature's /ByteRange covers this whole save.
const CONTENTS_HEX = 8192;
const BR_PLACEHOLDER = '/ByteRange [0 0000000000 0000000000 0000000000]';
section(
  [
    [1, catalog('10 0 R 14 0 R', ' /SigFlags 3')],
    [3, page1Obj('10 0 R 14 0 R')],
    [9, info('Skia/PDF m118', "D:20261014091500-05'00'")],
    [14, `<< /Type /Annot /Subtype /Widget /FT /Sig /T (BrokerSignature) /V 15 0 R /Rect [62 310 290 346] /P 3 0 R /F 4 /AP << /N 16 0 R >> >>`],
    [15, `<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /Name (Quillmont Freight Solutions) /M (D:20261014091500-05'00') ${BR_PLACEHOLDER} /Contents <${'0'.repeat(CONTENTS_HEX)}> >>`],
    [16, stream(`/Type /XObject /Subtype /Form /BBox [0 0 228 36] /Resources << ${FONTS} >>`, sigAp)],
  ],
  id('<9C04D7E2B15A4F3E8D61A0C47F2E9B05>')
);
{
  const contentsAt = file.lastIndexOf('/Contents <') + '/Contents '.length;
  const afterContents = contentsAt + CONTENTS_HEX + 2;
  // Covers the save up to and including %%EOF.
  const signedEnd = file.length - 1;
  const br = `/ByteRange [0 ${String(contentsAt).padStart(10, '0')} ${String(afterContents).padStart(10, '0')} ${String(signedEnd - afterContents).padStart(10, '0')}]`;
  file = file.replace(BR_PLACEHOLDER, br);
}

// v3 — the line-haul rate is changed after signing.
const EDITOR = 'Online PDF Editor 4.2';
section(
  [
    [9, info(EDITOR, "D:20261015214000-05'00'")],
    [10, rateField('$1,100.00')],
    [12, stream(`/Type /XObject /Subtype /Form /BBox [0 0 144 20] /Resources << ${FONTS} >>`, fieldAp('$1,100.00'))],
  ],
  id('<3E7A91C5D2084B6F9A1E5C03B7D48F21>')
);

// v4 — white box over the detention terms, "Not paid" typed on top.
section(
  [
    [4, stream('', page1({ whiteOut: true }))],
    [9, info(EDITOR, "D:20261015214300-05'00'")],
  ],
  id('<B82D4F06A93E4C71852F0D6E1A7C3B94>')
);

// v5 — the lumper line is made invisible.
section(
  [
    [4, stream('', page1({ whiteOut: true, lumperHidden: true }))],
    [9, info(EDITOR, "D:20261015214500-05'00'")],
  ],
  id('<D5C1E8A2F7034B9D96E4A1B08C2F5E37>')
);

// v6 — page 2 (TONU, layover, fuel advance) removed.
section(
  [
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [9, info(EDITOR, "D:20261015214700-05'00'")],
  ],
  id('<7F3B2A9E0C6D4E15B8A7D2F49E1C0A63>')
);

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.from(file, 'latin1'));
console.log(out, file.length, 'bytes');
