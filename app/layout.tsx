import type { Metadata, Viewport } from 'next';
import './globals.css';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://haulock.com';

const TITLE = 'Haulock — Verify any broker or carrier. Stop freight fraud.';
const DESCRIPTION =
  'Haulock verifies freight brokers and carriers in seconds using official data from the Federal Motor Carrier Safety Administration (FMCSA). Cross-checks FMCSA SAFER, company website, social profiles, Google Business address, and domain records to catch double-brokers, ghost MCs, and spoofed identities — before you hook the trailer or hand off the load.';
const SHORT_DESC = 'Official FMCSA data + website, social, and domain checks. Verify any broker or carrier in 2.1 seconds.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: '%s · Haulock',
  },
  description: DESCRIPTION,
  applicationName: 'Haulock',
  generator: 'Next.js',
  keywords: [
    'freight fraud',
    'freight fraud protection',
    'broker verification',
    'carrier verification',
    'double brokering',
    'double-broker detection',
    'MC number lookup',
    'DOT number lookup',
    'FMCSA lookup',
    'FMCSA SAFER',
    'Federal Motor Carrier Safety Administration',
    'official FMCSA data',
    'carrier safety rating',
    'rate confirmation scam',
    'rate con fraud',
    'trucking fraud',
    'ghost MC',
    'identity fraud trucking',
    'freight broker vetting',
    'carrier vetting',
    'broker risk score',
    'freight industry fraud',
    'logistics fraud',
  ],
  authors: [{ name: 'Haulock' }],
  creator: 'Haulock',
  publisher: 'Haulock',
  category: 'business',
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: SITE_URL,
    siteName: 'Haulock',
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: SHORT_DESC,
    creator: '@haulock',
    site: '@haulock',
  },
  robots: {
    index: true,
    follow: true,
    nocache: false,
    googleBot: {
      index: true,
      follow: true,
      noimageindex: false,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  icons: {
    icon: [
      { url: '/favicon.png', type: 'image/png' },
    ],
    shortcut: '/favicon.png',
    apple: '/favicon.png',
  },
  formatDetection: {
    email: false,
    telephone: false,
    address: false,
  },
  referrer: 'strict-origin-when-cross-origin',
};

export const viewport: Viewport = {
  themeColor: '#0B1E3F',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}#organization`,
      name: 'Haulock',
      url: SITE_URL,
      logo: {
        '@type': 'ImageObject',
        url: `${SITE_URL}/haulock-logo.png`,
        width: 1254,
        height: 288,
      },
      description:
        'Freight fraud protection for carriers and brokers. Verify any MC or DOT in seconds using official data from the Federal Motor Carrier Safety Administration (FMCSA).',
      sameAs: [],
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}#website`,
      url: SITE_URL,
      name: 'Haulock',
      description: DESCRIPTION,
      publisher: { '@id': `${SITE_URL}#organization` },
      inLanguage: 'en-US',
    },
    {
      '@type': 'SoftwareApplication',
      name: 'Haulock',
      description: DESCRIPTION,
      url: SITE_URL,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
        description: '5 free verifications per month. No credit card required.',
      },
      audience: [
        { '@type': 'Audience', audienceType: 'Freight Carriers' },
        { '@type': 'Audience', audienceType: 'Freight Brokers' },
        { '@type': 'Audience', audienceType: 'Owner-operators' },
        { '@type': 'Audience', audienceType: 'Dispatchers' },
      ],
      featureList: [
        'FMCSA SAFER verification',
        'L&I authority status',
        'MCS-150 filings',
        'Insurance filings',
        'Crash and inspection history',
        'Company website detection',
        'Domain WHOIS and age check',
        'DNS (MX/SPF) verification',
        'Google Safe Browsing check',
        'Google Business address match',
        'Social profile discovery (Facebook, LinkedIn, Twitter/X, Instagram, YouTube, TikTok)',
        'Disposable email detection',
        'Rate confirmation PDF analysis',
        'Community fraud network alerts',
      ],
    },
    {
      '@type': 'Service',
      name: 'Freight broker and carrier verification',
      provider: { '@id': `${SITE_URL}#organization` },
      areaServed: { '@type': 'Country', name: 'United States' },
      description:
        'Real-time verification of freight brokers and motor carriers using official data from the Federal Motor Carrier Safety Administration (FMCSA), website checks, social footprint analysis, Google Business address matching, and community fraud reports.',
      serviceType: 'Fraud protection',
      isBasedOn: {
        '@type': 'GovernmentService',
        name: 'FMCSA Safety and Fitness Electronic Records (SAFER) System',
        provider: {
          '@type': 'GovernmentOrganization',
          name: 'Federal Motor Carrier Safety Administration',
          alternateName: 'FMCSA',
          url: 'https://www.fmcsa.dot.gov',
          parentOrganization: {
            '@type': 'GovernmentOrganization',
            name: 'U.S. Department of Transportation',
            url: 'https://www.transportation.gov',
          },
        },
      },
    },
    {
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'Where does Haulock get its data?',
          acceptedAnswer: {
            '@type': 'Answer',
            text:
              'FMCSA for authority, insurance, and safety history. WHOIS and DNS for domain age and email infrastructure. Google Places for address verification. Public social networks for company footprint. Plus a community-reported fraud network with 4,200+ verified carriers and brokers.',
          },
        },
        {
          '@type': 'Question',
          name: 'Does Haulock work for freight brokers too?',
          acceptedAnswer: {
            '@type': 'Answer',
            text:
              'Yes. Haulock is bidirectional — carriers use it to verify brokers before booking, and brokers use it to verify carriers before dispatching a load or entering co-brokering relationships.',
          },
        },
        {
          '@type': 'Question',
          name: 'How fast is a lookup?',
          acceptedAnswer: {
            '@type': 'Answer',
            text:
              'Most lookups complete in about 2.1 seconds, cross-checking 14 data sources in parallel.',
          },
        },
      ],
    },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
