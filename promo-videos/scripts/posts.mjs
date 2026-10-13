// Renders the feed posts (src/posts) to PNG at the frame where everything has settled.
// Usage: node scripts/posts.mjs [post-brokers post-carriers post-drivers]
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';

const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['post-brokers', 'post-carriers', 'post-drivers'];
const FRAME = 140; // POST_FRAME in src/posts/Posts.tsx
const serveUrl = await bundle({ entryPoint: path.resolve('src/index.ts') });
const timeoutInMilliseconds = 90000;
for (const id of ids) {
  const composition = await selectComposition({ serveUrl, id, timeoutInMilliseconds });
  const output = path.resolve(`out/posts/${id}.png`);
  await renderStill({ serveUrl, composition, frame: FRAME, output, imageFormat: 'png', timeoutInMilliseconds });
  console.log(output);
}
