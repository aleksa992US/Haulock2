import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Haulock — Verify any broker or carrier. Stop freight fraud.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: 'linear-gradient(135deg, #0B1E3F 0%, #0B1E3F 55%, #122A57 100%)',
          padding: '72px',
          color: 'white',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: '#FF6B35',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 28,
              fontWeight: 700,
            }}
          >
            H
          </div>
          <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em' }}>Haulock</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div
            style={{
              display: 'inline-flex',
              alignSelf: 'flex-start',
              padding: '8px 18px',
              borderRadius: 999,
              background: 'rgba(255, 107, 53, 0.15)',
              color: '#FF6B35',
              fontSize: 18,
              fontWeight: 500,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
            }}
          >
            Freight fraud protection
          </div>
          <div
            style={{
              fontSize: 76,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: '-0.03em',
              maxWidth: 1000,
            }}
          >
            Verify any broker or carrier.
            <br />
            <span style={{ color: '#FF6B35', fontStyle: 'italic', fontWeight: 500 }}>
              Stop freight fraud.
            </span>
          </div>
          <div
            style={{
              fontSize: 26,
              color: 'rgba(255, 255, 255, 0.7)',
              maxWidth: 900,
              lineHeight: 1.35,
            }}
          >
            FMCSA · Website · Social profiles · Google Business · Domain WHOIS — cross-checked in 2.1 seconds.
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 32,
            fontSize: 20,
            color: 'rgba(255, 255, 255, 0.55)',
            paddingTop: 24,
            borderTop: '1px solid rgba(255, 255, 255, 0.12)',
          }}
        >
          <span>✓ For carriers and brokers</span>
          <span>✓ 14 data sources</span>
          <span>✓ Community fraud network</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
