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

## `pdf-tamper` — 20 s, "now see by how much": the PDF tamper check in the real app

Not just "your rate con was edited" (that's `rate-con-edited`) but by how much, and what else changed.

> Your rate con was edited… now see by HOW MUCH. Fourteen hundred… cut to ELEVEN hundred.
> Detention — gone. Lumper — hidden. Page two — deleted. Haulock shows you exactly what changed.
> Check yours free… at haulock.com.

VO: take C of four (Desmond, `eleven_v4`, flow "Haulock promo reels — pdf-tamper"). Word timings
from ElevenLabs Scribe, with "hidden" and "deleted" moved to where the take actually says them
(Scribe had them ~0.5 s late); phrase ranges in `src/spots/PdfTamper.tsx` were measured from the
take. Music: "Epical Drums 03" from 2.9 s, as in `rate-con-edited`. Says "exactly what changed",
not "everything": a rate con that was retyped from scratch has no earlier versions to compare.

| Time | Voice | Picture |
|---|---|---|
| 0–1.7 s | Your rate con was edited… | The sample rate con as signed; camera pushes in, glitches to the received version |
| 1.7–4.2 s | now see by HOW MUCH. | Recording: tap Choose PDF → "Taking the PDF apart…" → Likely tampered · 100 |
| 4.2–7.5 s | Fourteen hundred… cut to ELEVEN hundred. | Version 3 card (Line haul $1,400.00 → $1,100.00); captions $1,400 → $1,100; "−$300 LINE HAUL CUT" stamp |
| 7.5–12.3 s | Detention — gone. Lumper — hidden. Page two — deleted. | Hard cut on each word to versions 4, 5, 6 |
| 12.3–15.5 s | Haulock shows you exactly what changed. | Recap card: the four changes, before → after (held to read) |
| 15.5–20 s | Check yours free… at haulock.com. | End card "Check yours *free.*" · "3 free PDF scans a month" · "No credit card" |

The recap card is a reel graphic listing the analyzer's findings for the sample, not app UI.
`out/pdf-tamper-v1.mp4` is the first cut (white-out / hidden text / after signing / boxed page,
with the close-up take `pdf-tamper-zoom.mp4`); its source was replaced by this version.

Carousel (4:5, English and Serbian): `src/posts/TamperCarousel.tsx`, compositions
`tamper-{en,sr}-{1..4}` — 1 "Your rate con was edited": the received rate con in a PDF viewer on a laptop
mockup · 2 $1,400 → $1,100: the app's before/after cards on a phone mockup (`public/recordings/phone-v3.png`,
captured by `npm run record`) with the −$300 stamp · 3 the same "What changed" card as the reel
(`src/components/ChangesCard.tsx`) · 4 cream CTA with three steps. Device frames are generic
(no maker logos): `src/components/Devices.tsx`. Rendered slides and the EN/SR
articles live in `out/posts/pdf-tamper/` (not in git).

How the recording is made (`npm run record`, app running locally **without** Supabase env so the
login form signs in a demo user):
- `scripts/make-tampered-pdf.mjs` writes `public/recordings/rate-con-4821.pdf`: a two-page rate con
  from Quillmont Freight Solutions (fictional, from the site's vetted names) to Keystone Freight
  Network, signed, then saved four more times — each edit is a real incremental update.
- `/api/pdf-forensics` needs a real login, so `scripts/record-screens.mjs` answers it with
  `scripts/analyze-pdf.cts` — the app's own `lib/pdf-forensics.ts` run on the same file. The
  verdict, versions, flags and boxes on screen are what the analyzer returns for that file.
- Live moments (upload, spinner, box taps) are back-to-back screenshots at 3× (15–20 fps; CDP
  screencasts come out at CSS size). Scrolls are captured frame by frame at 30 fps. The reel cuts
  the take on the voice using `public/recordings/*.marks.json`.
- `scripts/render-pdf-pages.mjs` renders page 1 as signed / as received for the hook.

## `inspections` — 26.5 s, every inspection and crash, and alerts on your own DOT

> Totals only tell you so much. Haulock shows EVERY roadside inspection… and every crash, from
> the last twenty-four months. When, where, and what the officer found. And for your own company —
> know as soon as FMCSA posts a new inspection or crash on your DOT. Fix it… or challenge it…
> before it hits your safety scores. Check any carrier free… at haulock.com.

VO: take B of four (Desmond, `eleven_v4`; "F-M-C-S-A" / "D-O-T" in the prompt so they're spelled
out). Scribe timings for "and every crash … twenty-four months" and "posts … DOT" ran 0.3–0.7 s late
and were moved to the take's measured speech. Music: "Epic Games" (Ahjay Stelino, Mixkit free
license, `public/music/epic-games.mp3`), from 0 s; it builds ~7 dB by 16 s, so its bed steps down
0.45 → 0.35 → 0.24 under the voice, then swells.

| Time | Voice | Picture |
|---|---|---|
| 0–2 s | Totals only tell you so much. | Truck-fog footage; 90 inspections · 8 out of service · 3 crashes, cracking on "much" |
| 2–11 s | Haulock shows EVERY roadside inspection… and every crash, from the last 24 months. When, where, and what the officer found. | Phone mockup playing a full-height recording (430×880 pt) of the homepage's example panel: totals → the crash → the monthly chart → latest inspections, tap opens the out-of-service one (each violation) |
| 11–20 s | And for your own company — know as soon as FMCSA posts… Fix it… or challenge it… before it hits your safety scores. | Phone: lock-screen notification "Out-of-service inspection on your DOT", tap, the real alert email scrolls to the DataQs advice |
| 20–26.5 s | Check any carrier free… at haulock.com. | End card "Check any carrier *free.*" · "Free plan: 3 lookups a month" · "Alerts on paid plans" |

Everything is example data: the homepage's "Example Trucking LLC" panel (labelled "Example data" /
"Made-up example") and `lib/email.ts` `safetyEventsTemplate` rendered with the same inspection and a
masked DOT (`scripts/render-alert-email.cts`). HUD says EXAMPLE DATA. Own-company alerts are a paid
feature; inspections and crashes are in every report, free plan too. Recorded by
`scripts/record-inspections.mjs` (app running locally; no login needed) with the shared
`scripts/capture-kit.mjs`. Carousel (4:5, EN/SR): `src/posts/InspectionsCarousel.tsx`,
compositions `inspections-{en,sr}-{1..4}`; slides, the reel and EN/SR promo texts are in
`out/posts/inspections/` (not in git).

Shared pieces: `vo.ts` (`makeVo` re-times a take phrase by phrase), `components/audio.tsx`
(`VoTrack`, `Music`, `Sfx`), `components/hook.tsx` (scanner opening), `Captions`, `EndCard`.
Word timings for the three new reels come from ElevenLabs Scribe transcriptions of the exact takes.

## Feature reels — load planner, COI check, your company, officers, authority history, PDF report

Six 18–23 s reels on one template, `components/FeatureReel.tsx`: a hook card over footage, the
real app on a phone mockup (`PhoneRecording`: a full-height 430×880 pt recording, cut to the voice,
with taps and highlight rings), voice-synced captions, stamps, and the cream end card. Each VO is
one ElevenLabs take (Desmond, `eleven_v4`, take A) cut into phrases at its measured pauses
(`phraseVo`: one "word" per phrase, so `vo.at(i)` is phrase i). Everything on screen is example
data with fictional companies (`scripts/examples.mjs`), 555 phone numbers and masked MC/DOT.

| Composition | Length | Story | Recording | Music (Mixkit free license) |
|---|---|---|---|---|
| `load-planner` | 19 s | Is this load worth it? Gary, IN → Joliet → Dallas, $2,400: 44 mi empty, 927 loaded, 15h 10m, $1,194 left, break-even $1.24/mi. "Plan 10 loads a month free." | `record-planner.mjs` (the real planner; diesel typed at $3.85) | "Driving Ambition", bed 0.19 |
| `coi-check` | 23 s | The COI says $1M, but FMCSA shows a cancellation in 12 days. Match / verify / mismatch. "COI checks on every paid plan." | `record-reports.mjs` take `coi` | "Training", bed 0.13 |
| `whos-checking` | 18 s | Brokers are looking up your MC. How often? 23 checks in 30 days, counts only, never who; daily FMCSA watch; your score. "Included on paid plans." | take `company` | "Games Music", bed 0.11 |
| `officers` | 20 s | A broker calls. Is it really them? Officers, phone and email on the FMCSA filing; hang up, call that number, ask by name. "Check any company free." | take `report-officers` | "Shark Thank", bed 0.35 |
| `authority-history` | 21 s | 12 years old, looks clean, but dormant 2y 3m and reactivated in April: +30 red flag. "Check any carrier free." | take `report-authority` | "Epical Drums 04", bed 0.24 |
| `pdf-report` | 18 s | Checked a carrier? Share the proof: the app's PDF, section by section, then Export PDF and Email to dispatch. "Check any carrier free." | take `report-pdf` + `report-braxtone-p1/p2.png` | "Epical Drums 02", bed 0.21 |

Beds are set per track so the voice sits ~9 dB over the music; each swells after the last word.
Plan facts follow `lib/plans.ts`: free plan 3 lookups, 3 PDF checks and 10 load plans a month; COI
checks and Your company from the $49 Carrier plan; PDF export and email on every plan.

Recordings: `scripts/record-reports.mjs` (app running locally without Supabase env and with
`NEXT_PUBLIC_COI_CHECK=on`; `--only officers,authority,pdf,coi,company` re-records some takes) serves
the API answers from `scripts/examples.mjs` — Quillmont Freight Solutions (clean broker), Ironvale
Freight Lines (reactivated carrier), Braxtone Transport (clean carrier, for the PDF), Kestrelon
Freight Group (COI mismatch), Keystone Freight Network (your company). `scripts/render-report-pdf.cts`
builds the app's own PDF for Braxtone (FMCSA inspection files stubbed with the example's rows) and
`render-pdf-pages.mjs --pdf … --name report-braxtone` renders its pages.

Carousels (4:5, EN/SR, 4 slides each): `src/posts/FeatureCarousels.tsx`, compositions
`{planner,coi,company,officers,authority,pdfreport}-{en,sr}-{1..4}`. Slides, the reel and EN/SR
promo texts for each feature are in `out/posts/<reel>/` (not in git).

## `demo-60` — 60 s, 16:9 (1920×1080): six features, ~10 s each

> Was your rate con edited? Haulock shows exactly what changed. Fourteen hundred… cut to ELEVEN
> hundred. / This COI says one MILLION in coverage. But the insurer's FMCSA filing? Cancelling in
> twelve days. / A broker calls with a perfect load. Hang up. Call the number FMCSA has… and ask
> for the officers by name. / This MC looks twelve years old. But it sat DEAD for over two years…
> then came back to life. Haulock flags it. / Every roadside inspection and crash. And an email as
> soon as FMCSA posts a new one on your DOT. / Is the load worth it? See the route, the miles… and
> what's really left. / Check any carrier free… at haulock.com.

`src/spots/DemoWide.tsx`. One phone on the right switches between the reels' recordings (the PDF
check from `record-screens.mjs --tall`, a full-height take, `pdf-tamper-tall.mp4`); the left
column has the feature number, name and plan tag, voice-synced captions, stamps and a 6-step
progress bar. Block 3 opens on an incoming-call screen (Quillmont Freight, a 555 number) that is
declined on "Hang up"; block 5 ends on the own-company alert notification and email. Cream end
card lists all six. VO: take A (`public/voiceovers/demo-60.mp3`), each block's first phrase placed
on its 10-second mark. Music: "Driving Ambition", bed 0.19, down to 0.13 from ~35 s where the
track gets louder.

## `demo-60-laptop` — the same 60 s demo on a laptop (16:9)

`src/spots/DemoLaptop.tsx`: the `demo-60` voice, captions, stamps and end card, with the real app at
desktop size (`scripts/record-desktop.mjs`: 1280×770 at 2×, takes `desk-pdf`, `desk-coi`,
`desk-officers`, `desk-authority`, `desk-inspections`, `desk-planner`) on a large laptop screen. A
camera zooms into each detail (1.15–1.7×) with highlight rings and a mouse cursor on clicks, so the
app's text reads at 1080p. The certificate drops into the COI check; the incoming call and the
own-company alert come in on a phone beside the laptop. Rendered at `--crf=16` to keep the small
UI text sharp.

## Assets

| Folder | What | Source |
|---|---|---|
| `public/voiceovers/` | `rate-con-edited.mp3` + word timings | ElevenLabs |
| `public/music/epical-drums-05.mp3`, `epical-drums-06.mp3` | "Epical Drums 05/06" (Grigoriy Nuzhny) for the broker / carrier reels | [Mixkit](https://mixkit.co/free-stock-music/) free license |
| `public/music/epical-drums-03.mp3` | "Epical Drums 03" (Grigoriy Nuzhny), dark C#-minor drums, used from 2.9 s | [Mixkit](https://mixkit.co/free-stock-music/) free license |
| `public/sfx/` | riser, glitch ×2, scanner, beep, impact | ElevenLabs sound effects |
| `public/footage/highway-pov.mp4` | Driver-POV interstate (hook) | Mixkit free license |
| `public/brand/logo.png` | Haulock logo (`public/haulock-logo.png` from the site) | site |
| `public/voiceovers/pdf-tamper.mp3` + `.words.json` | `pdf-tamper` VO, take C | ElevenLabs |
| `public/music/epic-games.mp3` | "Epic Games" (Ahjay Stelino) for `inspections` | [Mixkit](https://mixkit.co/free-stock-music/) free license |
| `public/voiceovers/inspections.mp3` + `.words.json` | `inspections` VO, take B | ElevenLabs |
| `public/recordings/` | sample rate con PDF, its page renders, the app screen recordings and their marks | `scripts/make-tampered-pdf.mjs`, `render-pdf-pages.mjs`, `record-screens.mjs` |
| `public/music/driving-ambition.mp3`, `training.mp3`, `games-music.mp3`, `shark-thank.mp3`, `epical-drums-02.mp3`, `epical-drums-04.mp3` | music for the feature reels | [Mixkit](https://mixkit.co/free-stock-music/) free license |
| `public/music/running-out-of-time.mp3` | not used: license unknown | — |
| `public/voiceovers/load-planner.mp3`, `coi-check.mp3`, `whos-checking.mp3`, `officers.mp3`, `authority-history.mp3`, `pdf-report.mp3` | feature reel VOs, take A each | ElevenLabs |

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

# pdf-tamper: rebuild the sample PDF and recordings (app running at :3000, no Supabase env)
node scripts/make-tampered-pdf.mjs
node scripts/render-pdf-pages.mjs
npm run record
npm run render -- pdf-tamper out/pdf-tamper.mp4
node scripts/posts.mjs tamper-en-1 tamper-en-2 tamper-en-3 tamper-en-4 tamper-sr-1 tamper-sr-2 tamper-sr-3 tamper-sr-4

# inspections: recording, alert email, reel, carousel (app running at :3000)
node scripts/record-inspections.mjs
npm run render -- inspections out/inspections.mp4
node scripts/posts.mjs inspections-en-1 inspections-en-2 inspections-en-3 inspections-en-4 inspections-sr-1 inspections-sr-2 inspections-sr-3 inspections-sr-4

# feature reels (app running at :3000 without Supabase env, NEXT_PUBLIC_COI_CHECK=on)
node scripts/record-planner.mjs
(cd .. && npx tsx promo-videos/scripts/render-report-pdf.cts)
node scripts/render-pdf-pages.mjs --pdf public/recordings/report-braxtone.pdf --name report-braxtone
node scripts/record-reports.mjs                       # or --only pdf,authority
for id in load-planner coi-check whos-checking officers authority-history pdf-report; do npm run render -- $id out/$id.mp4; done
node scripts/posts.mjs coi-en-1 coi-en-2 coi-en-3 coi-en-4   # …and the other features/languages

# demo-60 (16:9): the PDF check on a full phone screen, then the video
node scripts/record-screens.mjs --tall
npm run render -- demo-60 out/demo-60.mp4

# demo-60-laptop: desktop recordings, then the video
node scripts/record-desktop.mjs                       # or --only pdf,coi,officers,authority,inspections,planner
npm run render -- demo-60-laptop out/demo-60-laptop.mp4 --crf=16

# "What's new" email preview (sends nothing; images from the local app's public/email/whats-new/)
(cd .. && npx tsx promo-videos/scripts/preview-whats-new.cts)
```

The root `tsconfig.json` excludes `promo-videos/` so `next build` on Vercel never type-checks Remotion code.
