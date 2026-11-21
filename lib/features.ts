// Launch switches. Each feature stays off the live site until its variable is
// "on"; admins always get both so they can be tested on production first.
//   NEXT_PUBLIC_COI_CHECK=on        COI check: homepage section, Verify tab,
//                                   plan lines, FAQ, /api/coi/check
//   NEXT_PUBLIC_FORWARD_TO_SCAN=on  forward-to-scan: scan@ strip and card,
//                                   FAQ, /api/inbound/email
export const COI_CHECK_ON = process.env.NEXT_PUBLIC_COI_CHECK === 'on';
// Forward-to-scan (scan@haulock.com) is OFF and hidden everywhere: haulock.com's
// MX points to Google Workspace, so mail to scan@ never reaches the Resend
// inbound webhook (app/api/inbound/email) — inbound_scans has never received
// one. To bring it back: route scan@ (or a subdomain) to Resend inbound, set
// RESEND_INBOUND_WEBHOOK_SECRET, then restore
// `process.env.NEXT_PUBLIC_FORWARD_TO_SCAN === 'on'` here.
export const SCAN_EMAIL_ON = false;
// Verified reports (file a report about a company, read a company's reports)
// and the public directory built around them (/directory, /company/*) are OFF
// and hidden everywhere: the Reports page and menu item, the reports section
// on a carrier report, the reports flag in the score, the admin Reports tab,
// /api/reports/* and /api/admin/reports (404). The tables and code stay.
// NEXT_PUBLIC_REPORTS=on brings it all back.
export const REPORTS_ON = process.env.NEXT_PUBLIC_REPORTS === 'on';
// Drivers as reporters (the driver's-license ID check, the "Driver" role on
// the report form, "Driver" in the reports search) are OFF and hidden: they
// bring individual people's ID data into Haulock. Reports already filed by
// drivers still show. NEXT_PUBLIC_DRIVER_REPORTS=on brings it all back.
export const DRIVER_REPORTS_ON = process.env.NEXT_PUBLIC_DRIVER_REPORTS === 'on' && process.env.NEXT_PUBLIC_REPORTS === 'on';
// Who can file a report, for copy.
export const REPORTERS_TEXT = DRIVER_REPORTS_ON ? 'carriers, brokers, drivers and shippers' : 'carriers, brokers and shippers';
