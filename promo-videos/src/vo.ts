import { FPS } from './theme';

// ElevenLabs takes (Desmond – Trailer & Ad Voice, eleven_v4, flow "Haulock promo reels") read
// a little slow for a reel, so each phrase is cut out of the take at the silences around it
// and re-placed with shorter pauses. `speech` is where the phrase is audible in the take
// (measured), `gap` the silence before it in the reel (for the first phrase: the lead-in).
export type Phrase = { speech: [number, number]; gap: number };
export type RawWord = { text: string; start: number; end: number };
export type VoSegment = { srcFrom: number; srcTo: number; speechEnd: number; offset: number };

export type Vo = {
  src: string;
  segments: VoSegment[];
  // Word timings in reel seconds; indices match the words.json file.
  words: RawWord[];
  // Frame at which word `i` starts.
  at: (i: number) => number;
  // Frame at which the voice ends.
  end: number;
};

const PAD = 0.05;

export const makeVo = (src: string, raw: RawWord[], phrases: Phrase[], takeEnd: number): Vo => {
  let cursor = 0;
  const segments = phrases.map((p, i) => {
    const start = cursor + p.gap;
    cursor = start + (p.speech[1] - p.speech[0]);
    return {
      srcFrom: Math.max(0, p.speech[0] - PAD),
      srcTo: i === phrases.length - 1 ? takeEnd : p.speech[1] + PAD,
      speechEnd: p.speech[1],
      offset: start - p.speech[0],
    };
  });
  const segmentAt = (t: number) => [...segments].reverse().find((s) => s.srcFrom <= t + PAD) ?? segments[0];
  const words = raw.map((w) => {
    const seg = segmentAt(w.start);
    return { text: w.text, start: w.start + seg.offset, end: Math.min(w.end, seg.speechEnd) + seg.offset };
  });
  return {
    src,
    segments,
    words,
    at: (i) => Math.round(words[i].start * FPS),
    end: Math.round(words[words.length - 1].end * FPS),
  };
};
