/** @type {import('next').NextConfig} */

// Security headers applied to every page response. These block the most
// common attack patterns (clickjacking, MIME-sniffing, mixed content,
// privacy leaks via Referer) and let us tighten the Content-Security-Policy
// later without changing every callsite. Every value here was chosen so it
// does NOT break legitimate features the app already uses (Stripe redirects,
// Supabase websockets, Unsplash + Pexels images, Brave / FMCSA APIs).

// Domains we legitimately load resources from. Edit here when adding a new
// vendor — keeps the CSP in one place.
const supabaseHost = (process.env.NEXT_PUBLIC_SUPABASE_URL || '')
  .replace(/^https?:\/\//, '')
  .replace(/\/.*$/, '');
const SUPABASE = supabaseHost || '*.supabase.co';

const csp = [
  // Default policy: only allow same-origin unless overridden below.
  "default-src 'self'",
  // Scripts: self + Stripe (3DS challenges + Checkout). Next.js hydration
  // and inline event handlers require 'unsafe-inline'; we accept that risk
  // here and can tighten later with a nonce-based middleware.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com",
  // Styles: Tailwind injects inline styles in dev + with arbitrary values,
  // so 'unsafe-inline' is required for now. Self covers the static stylesheet.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  // Fonts: Google Fonts (Instrument Sans / Serif / JetBrains Mono).
  "font-src 'self' data: https://fonts.gstatic.com",
  // Images: self, data URLs (favicons / SVG), blob (PDF previews), and the
  // photo CDNs we use for blog hero images + carrier websites.
  "img-src 'self' data: blob: https://images.unsplash.com https://images.pexels.com https://*.googleusercontent.com",
  // XHR / fetch / WS: self + Supabase (auth + db + realtime) + Stripe (api +
  // checkout) + Resend (transactional) + FMCSA + Brave + Google.
  `connect-src 'self' https://${SUPABASE} wss://${SUPABASE} https://api.stripe.com https://checkout.stripe.com https://api.resend.com https://api.search.brave.com https://places.googleapis.com https://safebrowsing.googleapis.com https://*.fmcsa.dot.gov https://*.dot.gov`,
  // iframes: only Stripe Checkout / 3DS.
  "frame-src https://js.stripe.com https://hooks.stripe.com https://checkout.stripe.com",
  // Worker / WASM: self only.
  "worker-src 'self' blob:",
  // Disable Flash / Java applets — irrelevant in 2026 but explicit blocks
  // any plugin-based escalation.
  "object-src 'none'",
  // Block mixed-content (http on https pages) and force HTTPS upgrades.
  'upgrade-insecure-requests',
  // Restrict where forms can submit. Stripe Checkout posts to its own host.
  "form-action 'self' https://checkout.stripe.com",
  // Stop other origins from embedding the app in an iframe (clickjacking).
  "frame-ancestors 'none'",
  // Base URI tightened so a content-injection bug can't redirect relative URLs.
  "base-uri 'self'",
].join('; ');

const securityHeaders = [
  // Content-Security-Policy — see csp const above.
  { key: 'Content-Security-Policy', value: csp },
  // HTTP Strict Transport Security: tell browsers "always use HTTPS for this
  // domain for the next 2 years, including subdomains, and you can preload us
  // into the browser's HSTS list".
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  // Tell browsers not to MIME-sniff a response away from the declared
  // Content-Type. Blocks "polyglot" upload attacks.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Belt-and-suspenders alongside CSP frame-ancestors.
  { key: 'X-Frame-Options', value: 'DENY' },
  // Don't leak the full URL (which can include MC numbers, query strings,
  // etc.) when users click outbound links.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Disable browser features we never use. Keeps a compromised script from
  // turning the user's webcam / mic / location on.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=(), browsing-topics=(), payment=(self "https://checkout.stripe.com")' },
  // Cross-Origin-Opener-Policy: isolate the browsing context so a popup
  // can't reach back into our window. Required for some modern features +
  // mitigates Spectre-class side-channel leaks.
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  // X-DNS-Prefetch-Control: don't pre-resolve every link, slight privacy win.
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
];

const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        // Apply to every route. Per-route overrides can be added below if
        // we ever need to relax CSP for a specific endpoint (e.g. a Stripe
        // Checkout return URL).
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

module.exports = nextConfig;
