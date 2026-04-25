// Twitter card image. Same render as the OG image — Next.js requires the
// `runtime`, `alt`, `size`, `contentType` exports be string literals
// directly in this file (not re-exported), so we duplicate them rather
// than re-export from opengraph-image.
export { default } from './opengraph-image';

export const runtime = 'edge';
export const alt = 'Haulock — Verify any broker or carrier. Stop freight fraud.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
