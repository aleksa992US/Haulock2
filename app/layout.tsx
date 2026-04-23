import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Haulock — Verify every broker. Protect every load.',
  description:
    'Haulock verifies every freight broker in seconds. Flags double-brokers, identity fraud, and ghost MCs before you ever hook the trailer. Trusted by 4,200+ carriers.',
  keywords: [
    'freight fraud',
    'broker verification',
    'double brokering',
    'MC number lookup',
    'FMCSA',
    'trucking',
    'carrier safety',
  ],
  openGraph: {
    title: 'Haulock — Verify every broker. Protect every load.',
    description:
      'Know who\'s on the other end of every rate con. Haulock catches double-brokers, identity fraud, and ghost MCs in 2.1 seconds.',
    type: 'website',
  },
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
      </head>
      <body>{children}</body>
    </html>
  );
}
