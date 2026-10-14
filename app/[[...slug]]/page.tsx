import type { Metadata } from 'next';
import Haulock from '@/components/Haulock';
import { BLOG_POSTS } from '@/lib/blog-posts';

// The whole site renders client-side inside <Haulock/>, but crawlers read the
// server HTML. Without per-route metadata every URL carried the homepage's
// title and a canonical of "/", so search engines treated blog posts and
// /pricing as copies of the homepage.
const PAGES: Record<string, { title: string; description: string }> = {
  pricing: {
    title: 'Pricing',
    description: 'Haulock plans for carriers, brokers and fleets: free lookups to start, unlimited broker and carrier checks, rate con and PDF tamper checks on paid plans.',
  },
  blog: {
    title: 'Freight Fraud Blog',
    description: 'Weekly freight fraud breakdowns: identity theft, double brokering, rate confirmation scams, and how carriers and brokers can protect themselves.',
  },
  about: {
    title: 'About Haulock',
    description: 'Haulock verifies freight brokers and carriers using live FMCSA data, AI rate-con analysis, and a 14-source web-reputation scan.',
  },
  signup: { title: 'Create your account', description: 'Start free: verify any broker or carrier against FMCSA records, the web and Google Business in seconds.' },
  login: { title: 'Log in', description: 'Log in to Haulock.' },
  terms: { title: 'Terms of Service', description: 'Haulock terms of service.' },
  privacy: { title: 'Privacy Policy', description: 'How Haulock handles your data.' },
  affiliate: { title: 'Affiliate partners', description: 'Become a Haulock affiliate partner and earn recurring commission for every subscription you refer.' },
};

export function generateMetadata({ params }: { params: { slug?: string[] } }): Metadata {
  const slug = params.slug || [];
  const path = `/${slug.join('/')}`;
  if (slug[0] === 'blog' && slug[1]) {
    const post = BLOG_POSTS.find((p) => p.slug === slug[1]);
    if (post) {
      return {
        title: { absolute: `${post.title} · Haulock Blog` },
        description: post.description,
        alternates: { canonical: path },
        openGraph: { type: 'article', url: path, title: post.title, description: post.description, publishedTime: post.publishedAt },
      };
    }
  }
  const page = slug.length === 1 ? PAGES[slug[0]] : undefined;
  if (page) {
    return {
      title: page.title,
      description: page.description,
      alternates: { canonical: path },
      openGraph: { url: path, title: `${page.title} · Haulock`, description: page.description },
    };
  }
  return { alternates: { canonical: path } };
}

export default function Page() {
  return <Haulock />;
}
