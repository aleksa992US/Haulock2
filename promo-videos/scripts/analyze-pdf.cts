// Runs the app's own PDF tamper check (lib/pdf-forensics.ts) on a file and prints
// the JSON /api/pdf-forensics would return. record-screens.mjs serves this to the
// page, because the API itself needs a Supabase login.
// Usage (from the repo root): npx tsx promo-videos/scripts/analyze-pdf.cts file.pdf
import fs from 'node:fs';
import path from 'node:path';
import { analyzePdfForensics } from '../../lib/pdf-forensics';

const file = process.argv[2];
analyzePdfForensics(fs.readFileSync(file)).then((r) => {
  process.stdout.write(JSON.stringify({ kind: 'forensics', ...r, filename: path.basename(file) }));
});
