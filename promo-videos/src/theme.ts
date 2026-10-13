import { loadFont as loadSans } from '@remotion/google-fonts/InstrumentSans';
import { loadFont as loadSerif } from '@remotion/google-fonts/InstrumentSerif';
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono';

// Same type system as haulock.com: light Instrument Sans headlines, Instrument Serif
// italic for the accent words, JetBrains Mono uppercase labels.
const sans = loadSans('normal', { weights: ['400', '500', '600'], subsets: ['latin'] });
const serif = loadSerif('italic', { weights: ['400'], subsets: ['latin'] });
const mono = loadMono('normal', { weights: ['400', '500', '600', '700'], subsets: ['latin'] });

export const fonts = {
  sans: `${sans.fontFamily}, system-ui, sans-serif`,
  serif: `${serif.fontFamily}, Georgia, serif`,
  mono: `${mono.fontFamily}, monospace`,
};

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

// Site palette (tailwind.config.js and the landing page), plus the deep navy used for
// the "inside the machine" scenes.
export const colors = {
  navy: '#0B1E3F',
  void: '#040B1A',
  orange: '#FF6B35',
  cream: '#F5F3EE',
  red: '#DC2626',
  redGlow: '#F87171',
  amber: '#F59E0B',
  green: '#16A34A',
  greenGlow: '#4ADE80',
  ink: '#0B1E3F',
  glass: 'rgba(245,243,238,0.06)',
  line: 'rgba(245,243,238,0.16)',
  dim: 'rgba(245,243,238,0.55)',
};

export const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
