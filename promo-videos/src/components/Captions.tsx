import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import type { Vo } from '../vo';
import { clamp, colors, fonts } from '../theme';
import { glitchAt, rgbSplit } from './fx';

// One caption token: shown from the moment word `at` is spoken.
export type Token = { text: string; at: number; accent?: 'serif' | 'money'; color?: string; size?: number };
export type CaptionChunk = { lines: Token[][]; layout: 'hero' | 'top'; until: number; glitchAt?: number };

// Voice-synced captions in the site's type: light Instrument Sans with Instrument Serif
// italic accents. Each word slides up out of a blur as it is spoken.
export const Captions: React.FC<{ vo: Vo; chunks: CaptionChunk[] }> = ({ vo, chunks }) => {
  const frame = useCurrentFrame();
  const chunk = chunks.find((c) => frame >= vo.at(c.lines[0][0].at) - 3 && frame < c.until);
  if (!chunk) return null;
  const hero = chunk.layout === 'hero';
  const g = chunk.glitchAt !== undefined ? glitchAt(frame, chunk.glitchAt, 12) : 0;
  return (
    <div
      style={{
        position: 'absolute',
        left: 60,
        right: 60,
        top: hero ? 640 : 300,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        transform: g ? `translateX(${(g * 18) * (frame % 2 ? 1 : -1)}px)` : undefined,
      }}
    >
      {chunk.lines.map((line, li) => (
        <div key={li} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'baseline', columnGap: hero ? 26 : 22 }}>
          {line.map((tok, ti) => (
            <Word key={ti} vo={vo} tok={tok} hero={hero} big={li > 0} split={g * 9} />
          ))}
        </div>
      ))}
    </div>
  );
};

const Word: React.FC<{ vo: Vo; tok: Token; hero: boolean; big: boolean; split: number }> = ({ vo, tok, hero, big, split }) => {
  const frame = useCurrentFrame();
  const at = vo.at(tok.at) - 2;
  if (frame < at) return null;
  const p = interpolate(frame, [at, at + 7], [0, 1], { ...clamp, easing: (x) => 1 - Math.pow(1 - x, 3) });
  const spoken = frame >= vo.at(tok.at);
  const base: React.CSSProperties = {
    display: 'inline-block',
    opacity: p,
    transform: `translateY(${(1 - p) * 30}px)`,
    filter: `blur(${(1 - p) * 10}px)`,
    color: tok.color ?? colors.cream,
    textShadow: rgbSplit(split) ?? '0 6px 30px rgba(0,0,0,0.55)',
    lineHeight: 1.04,
  };
  if (tok.accent === 'serif') {
    return (
      <span style={{ ...base, fontFamily: fonts.serif, fontStyle: 'italic', fontSize: tok.size ?? (hero ? 190 : 150), letterSpacing: -2 }}>
        {tok.text}
      </span>
    );
  }
  if (tok.accent === 'money') {
    return (
      <span style={{ ...base, fontFamily: fonts.sans, fontWeight: 500, fontSize: 168, letterSpacing: -6, opacity: spoken ? p : p * 0.6 }}>
        {tok.text}
      </span>
    );
  }
  return (
    <span style={{ ...base, fontFamily: fonts.sans, fontWeight: 400, fontSize: hero ? (big ? 120 : 112) : 76, letterSpacing: hero ? -4 : -2 }}>
      {tok.text}
    </span>
  );
};
