# GA4 — 24-hour follow-up checklist

After the first events have flowed for ~24 hours, GA4's Events list (Admin → Data display → Events) will populate. Run through this once, then you're done.

Property: **Haulock** · Measurement ID: **G-3CEQEXTJZW**

---

## 1. Mark key events (conversions)

GA4 → **Admin → Data display → Events** → find each event in the list → toggle **"Mark as key event"** ON.

Mark these 4:

- [ ] `signup_complete`
- [ ] `subscription_started`
- [ ] `verify_completed`
- [ ] `rate_con_uploaded`

Why: key events show up in the dedicated Conversions report and can be imported as Google Ads conversion goals. The other events (`login`, `logout`, `watchlist_added`, `pdf_forensics_scanned`, `report_shared_email`, `report_exported_pdf`, `fraud_report_submitted`, `newsletter_subscribed`, `support_ticket_created`, `plan_changed`) stay as regular events — track-only, not conversions.

---

## 2. Register custom dimensions

GA4 → **Admin → Data display → Custom definitions → Custom dimensions** → **Create custom dimension**.

For each row below: scope = **Event**, dimension name = same as the parameter, event parameter = same as the parameter.

- [ ] `plan` — which plan the user is on (free / pro / etc.)
- [ ] `verdict` — verify result (low / medium / high)
- [ ] `billing` — monthly / annual
- [ ] `source` — where the action came from (e.g. nav, modal)
- [ ] `currency` — already auto-tracked for purchases, skip if it appears

Without this step the parameters are stored but invisible in the Explore / Reports UI.

---

## 3. Bump data retention to 14 months

GA4 → **Admin → Data display → Data retention** → change **Event data retention** from 2 months to **14 months** → Save.

Free, but defaults to the shortest period. 14 months lets you do year-over-year comparisons.

---

## 4. Turn on Google Signals (optional)

GA4 → **Admin → Data display → Data collection** → enable **Google signals data collection**.

Adds demographics + cross-device tracking for users signed into Google. Useful for audience insights. Skip if you want to stay strictly first-party only.

---

## 5. Cross-domain (skip — single domain)

We only run on `haulock.com`. No setup needed.

---

## 6. Link Google Ads (only if/when running ads)

GA4 → **Admin → Product links → Google Ads links** → Link.

Then in Google Ads → Tools → Conversions → import the 4 key events from above.

Skip until ads are actually running.

---

## 7. Set up Search Console link

GA4 → **Admin → Product links → Search Console links** → Link the `haulock.com` property.

Surfaces organic search queries inside GA4 reports. Free, takes 60 seconds.

---

## 8. Verify it's working

After all of the above:

1. Open `https://haulock.com/?debug_mode=1` in incognito.
2. Go to GA4 → **Admin → DebugView**.
3. Sign up, run a verify, upload a rate-con — confirm each event appears with the right parameters (`plan`, `verdict`, etc.).

If `verdict` shows `(not set)` in DebugView, the parameter isn't being passed from the call site — open `lib/analytics.ts` callers and check.

---

## Reference: where events fire

| Event | Source file |
|---|---|
| `signup_complete`, `login`, `logout` | `components/Haulock.tsx` (auth handlers) |
| `verify_completed` | `components/Haulock.tsx` (after `/api/verify` returns) |
| `rate_con_uploaded` | `components/Haulock.tsx` (rate-con upload handler) |
| `pdf_forensics_scanned` | `components/Haulock.tsx` (PDF forensics tab) |
| `watchlist_added` | `components/Haulock.tsx` (watchlist add button) |
| `fraud_report_submitted` | `components/Haulock.tsx` (fraud report modal submit) |
| `newsletter_subscribed` | `components/Haulock.tsx` (newsletter form) |
| `support_ticket_created` | `components/Haulock.tsx` (support form submit) |
| `report_shared_email`, `report_exported_pdf` | `components/Haulock.tsx` (verify result actions) |
| `subscription_started` | `components/Haulock.tsx` (Stripe success return) — uses `trackPurchase()` |
| `plan_changed` | `components/Haulock.tsx` (plan change handler) |

To add a new event, edit the `EventName` union in `lib/analytics.ts` and call `track('your_event', { ... })`.
