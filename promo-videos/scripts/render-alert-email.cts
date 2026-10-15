// Renders the app's own-company inspection alert (lib/email.ts safetyEventsTemplate)
// with the homepage's example inspection (Example Trucking LLC, Oct 2, Joplin MO) and
// prints { subject, html }. The DOT is masked, as in the reels, so no real carrier's
// number appears. Used by record-inspections.mjs.
// Usage (from the repo root): npx tsx promo-videos/scripts/render-alert-email.cts
import { safetyEventsTemplate } from '../../lib/email';

const email = safetyEventsTemplate({
  carrier: { name: 'Example Trucking LLC', dot: '3271•••' },
  inspections: [
    {
      date: '2026-10-02',
      state: 'MO',
      location: 'Joplin',
      levelLabel: 'Level II · walk-around',
      violations: 2,
      oos: 1,
      driverOos: 0,
      vehicleOos: 1,
      postCrash: false,
      details: [
        { desc: 'Brake out of adjustment', oos: true },
        { desc: 'Inoperable required lamp', oos: false },
      ],
    },
  ],
  crashes: [],
  recipientEmail: 'dispatch@example.com',
  siteUrl: 'https://haulock.com',
});
process.stdout.write(JSON.stringify(email));
