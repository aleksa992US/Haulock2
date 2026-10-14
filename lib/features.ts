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
