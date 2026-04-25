// Twitter renders its own image card and falls back to og:image when
// twitter:image is missing, but some clients (and the Twitter Card
// Validator) only honor an explicit twitter:image. We reuse the exact
// same JSX as the Open Graph image — Next.js' file convention picks this
// up at /twitter-image and auto-wires the meta tag.
export { runtime, alt, size, contentType, default } from './opengraph-image';
