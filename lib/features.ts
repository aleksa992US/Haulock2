// COI check and forward-to-scan (scan@haulock.com) stay off the live site until
// launch. NEXT_PUBLIC_NEW_FEATURES=on turns them on for everyone; admins always
// get them so they can be tested on production first.
export const NEW_FEATURES_ON = process.env.NEXT_PUBLIC_NEW_FEATURES === 'on';
