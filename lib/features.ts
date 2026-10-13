// Launch switches. Each feature stays off the live site until its variable is
// "on"; admins always get both so they can be tested on production first.
//   NEXT_PUBLIC_COI_CHECK=on        COI check: homepage section, Verify tab,
//                                   plan lines, FAQ, /api/coi/check
//   NEXT_PUBLIC_FORWARD_TO_SCAN=on  forward-to-scan: scan@ strip and card,
//                                   FAQ, /api/inbound/email
export const COI_CHECK_ON = process.env.NEXT_PUBLIC_COI_CHECK === 'on';
export const SCAN_EMAIL_ON = process.env.NEXT_PUBLIC_FORWARD_TO_SCAN === 'on';
