// Renders preview stills for quick visual checks without rendering whole videos.
// Usage: node scripts/stills.mjs <compositionId> <frame> [frame ...]
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';

const [id, ...frames] = process.argv.slice(2);
if (!id || frames.length === 0) {
  console.error('Usage: node scripts/stills.mjs <compositionId> <frame> [frame ...]');
  process.exit(1);
}

const serveUrl = await bundle({ entryPoint: path.resolve('src/index.ts') });
const timeoutInMilliseconds = 90000;
const composition = await selectComposition({ serveUrl, id, timeoutInMilliseconds });
for (const f of frames) {
  const output = path.resolve(`out/stills/${id}-${f}.jpg`);
  await renderStill({ serveUrl, composition, frame: Number(f), output, imageFormat: "jpeg", jpegQuality: 80, timeoutInMilliseconds });
  console.log(output);
}
