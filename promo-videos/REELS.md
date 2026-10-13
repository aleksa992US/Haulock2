# Haulock promo reels

Format: vertical 9:16 (1080×1920), 30fps, 15 s. Built with [Remotion](https://www.remotion.dev).
Design follows haulock.com: light Instrument Sans headlines, Instrument Serif italic accents,
JetBrains Mono uppercase labels, navy `#0B1E3F` / orange `#FF6B35` / cream `#F5F3EE`, the risk gauge
and the HIGH RISK / CAUTION ticker. The middle of the reel is a dark "inside the scanner" space
(HUD frame, node network, grid floor, glitches); the end card is the site's cream hero.

## `rate-con-edited` — drivers, "has your rate con been edited?"

VO (ElevenLabs, voice "Desmond – Trailer & Ad Voice", `eleven_v4`, flow "Haulock promo reels"):

> Driver… has your rate con been EDITED? The broker paid fourteen hundred. You got eleven hundred.
> Haulock reads the hidden data inside the PDF — and catches the edit. Check yours free… at haulock.com.

The take is 14.3 s; `src/vo.ts` cuts it into phrases and re-places them with shorter pauses so the
voice ends at ~12.5 s. Captions, cuts, glitches and SFX all hang off word indices from
`public/voiceovers/rate-con-edited.words.json` (ElevenLabs transcription of the take).

| Time | Voice | Picture |
|---|---|---|
| 0–3.2 s | Driver… has your rate con been edited? | Driver-POV highway through a scanner reticle; glitch + "ANOMALY DETECTED" on "edited" |
| 3.2–6.5 s | The broker paid $1,400. You got $1,100. | Glass rate con; pay glitches $1,400 → $1,100; sent / received / missing −$300 |
| 6.5–10.3 s | Haulock reads the hidden data inside the PDF — and catches the edit. | Scan beam, metadata panel (producer: online PDF editor, modified after creation), tamper score 72, LIKELY TAMPERED |
| 10.3–15 s | Check yours free… at haulock.com. | Cream site-style end card: logo, "Check your rate con *free.*", navy haulock.com pill, ticker |

Accuracy notes: the edit is caught by PDF metadata forensics (`lib/pdf-forensics.ts`), not the AI
rate-con scan, so the VO says "reads the hidden data". Free plan = 3 PDF scans / month (`lib/plans.ts`).

## `for-brokers` — 19.8 s, the site's three steps for brokers

> Hey, brokers. Before you tender… type in the MC. Haulock cross-checks FOURTEEN data sources —
> authority, insurance, safety and BASIC scores, inspections, lookalike emails, chameleon networks.
> One score. One verdict: book it… or WALK AWAY. Verify carriers free, at haulock.com.

STEP 01: site search box over the `trucker` clip, "MC-441•••" typed on "type in the MC" (`SearchHook`).
STEP 02: 14-source radar; each named check pulses (SAFER, insurance & bond, SMS·BASICs, lookalike
domains, cross-reference). STEP 03: one score card (`VerdictCard`): 12 · BOOK THIS LOAD on "book it",
swings to 86–88 · WALK AWAY on "walk away", "Share with ops team". Brokers look carriers up by
MC/DOT/name — no rate con in this reel. Music: "Epical Drums 05" (Mixkit) from 1.0 s, bed 0.44.

## `for-carriers` — 19.5 s, carriers checking a broker before taking the load

> Hey, carriers. Before you hook that trailer… check the broker. Type in the MC — Haulock cross-checks
> FOURTEEN data sources: authority, surety bond, address, website. Take the load… or WALK AWAY.
> Watchlist re-checks them daily. Try for free… at haulock.com.

STEP 01: site search box over `highway-pov`, broker "MC-612•••" typed on "type in the MC".
STEP 02: 14-source radar; SAFER + MC lookup, insurance & bond, Google Places, web presence + WHOIS
pulse as they're named. STEP 03: `VerdictCard` as a broker lookup: 12 · TAKE THIS LOAD, then
88 · WALK AWAY ("Lookalike email · authority only 3 weeks old"). Then `WatchlistPanel`: saved brokers
re-check, one flips to CHANGED (surety bond cancelled) and an alert email drops in. End card
"Try for *free!*" · "3 free lookups a month" · "No credit card" (Free plan in `lib/plans.ts`; there is
no time-limited trial, so don't say "free trial"). No rate con / PDF upload in this reel.

VO: `for-carriers.wav` = the take up to "daily." + a separate "Try for free… at haulock.com." take
from 16.4 s, level-matched. Music: "Epical Drums 06" (Mixkit) from 1.0 s, bed 0.31.

## `broker-pricing` — 17.5 s, "Hey, brokers. What are you paying for carrier vetting?"

> Hey, brokers. What are you paying for carrier vetting? Some platforms start at five hundred fifteen
> dollars a month. Others charge three forty… one forty-nine… ninety-nine. Haulock? Start FREE — with
> fourteen data sources on every lookup. haulock.com.

`PriceBoard` bars appear as each price is spoken; Haulock row lands on "free" with "paid plans from
$49/mo" (`HAULOCK_PAID_FROM` in `src/spots/BrokerPricing.tsx`). On-screen disclaimer: lowest published
monthly price on each vendor's site, checked Oct 2026; plans, users and features differ.

Competitor prices (lowest published monthly price, vendor pages, checked 12 Oct 2026) —
**re-check and screenshot each page before publishing**:

| Shown | Price | Source |
|---|---|---|
| MyCarrierPortal (Descartes) | from $515 | https://www.mycarrierportal.com/features/pricing/ |
| RMIS Lite (Truckstop) | from $340 | https://truckstop.com/product/carrier-onboarding/ |
| DAT CarrierWatch | from $149 | https://www.dat.com/carrierwatch |
| Carrier Assure Premium | $149 | https://carrierassure.com/pricing |
| Truckstop Carrier Hub Basic | from $99 | https://truckstop.com/product/carrier-hub/ |
| Carrier411 | from $99 | https://web.archive.org/web/20260516135345/https://www.carrier411.com/ (live site blocks bots — verify in a browser) |

Left out on purpose: Highway (prices removed from its site mid-2026), SaferWatch and FreightValidate
(quote-only / revenue-based).

Shared pieces: `vo.ts` (`makeVo` re-times a take phrase by phrase), `components/audio.tsx`
(`VoTrack`, `Music`, `Sfx`), `components/hook.tsx` (scanner opening), `Captions`, `EndCard`.
Word timings for the three new reels come from ElevenLabs Scribe transcriptions of the exact takes.

## Assets

| Folder | What | Source |
|---|---|---|
| `public/voiceovers/` | `rate-con-edited.mp3` + word timings | ElevenLabs |
| `public/music/epical-drums-05.mp3`, `epical-drums-06.mp3` | "Epical Drums 05/06" (Grigoriy Nuzhny) for the broker / carrier reels | [Mixkit](https://mixkit.co/free-stock-music/) free license |
| `public/music/epical-drums-03.mp3` | "Epical Drums 03" (Grigoriy Nuzhny), dark C#-minor drums, used from 2.9 s | [Mixkit](https://mixkit.co/free-stock-music/) free license |
| `public/sfx/` | riser, glitch ×2, scanner, beep, impact | ElevenLabs sound effects |
| `public/footage/highway-pov.mp4` | Driver-POV interstate (hook) | Mixkit free license |
| `public/brand/logo.png` | Haulock logo (`public/haulock-logo.png` from the site) | site |

Mix: voice ~9 dB over the drums (bed 0.3), drums swell to 0.62 after the last word, fade on the last 24 frames.

## Commands

```bash
npm install
npm run studio                                         # preview/edit in the browser
node scripts/stills.mjs rate-con-edited 80 185 300 375 # preview single frames
npm run render -- rate-con-edited out/rate-con-edited.mp4
npm run render -- for-brokers out/for-brokers.mp4
npm run render -- for-carriers out/for-carriers.mp4
npm run render -- broker-pricing out/broker-pricing.mp4
```

The root `tsconfig.json` excludes `promo-videos/` so `next build` on Vercel never type-checks Remotion code.
