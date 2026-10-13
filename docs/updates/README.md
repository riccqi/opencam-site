# OpenCam update emails

The site stays on GitHub Pages. A separate Cloudflare Worker at
`https://updates-api.opencam.app` owns signup, single opt-in, unsubscribe,
administration, D1 storage, and an outbox drained by a cron trigger. Resend sends mail through the same account as TabTab. Google is only a legacy migration source, not a
runtime dependency. TestFlight contacts are excluded.

Start with [deployment](deployment.md), then use the [release runbook](release-runbook.md).
See [migration findings](migration-report.md) and [verification](verification.md).

## Local development

Use Node 24 LTS and npm.

```sh
npm ci
npm ci --prefix services/updates
npm --prefix services/updates test
npm run build
cd services/updates
cp .dev.vars.example .dev.vars
npm run migrate:local
npm run dev
```

Replace placeholder local secrets with randomly generated values. Use separate
local/test keys, an isolated D1 database, Cloudflare's documented Turnstile test
keys, and a test hostname/origin. No production credential is needed for automated
tests: all external calls are intercepted. The runtime test runs actual workerd
and D1 locally and requires loopback sockets. The SQL tests also run against
SQLite, not a mocked SQL parser.

To preview the form without enabling production signup:

```sh
PUBLIC_UPDATES_ENABLED=true PUBLIC_UPDATES_API=http://127.0.0.1:8787 \
PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA npm run dev
```

For local Worker HTTP testing, override SITE_ORIGIN, API_ORIGIN and
TURNSTILE_HOSTNAME to the exact local values. Never deploy the test Turnstile
secret/sitekey. Production signups are enabled; no confirmation email is sent; live announcements remain disabled.

## Data and behavior

- Email normalization trims and lowercases; it does not strip plus tags or dots.
- Subscriber states: pending, subscribed, unsubscribed, suppressed. An explicit form submission immediately subscribes or resubscribes an address.
  Suppression is never cleared by signup or confirmation.
- Legacy confirmation tokens (no new ones are issued): 256 random bits, SHA-256 at rest, expire after 24 hours,
  atomically consumed once. Duplicate requests return the same generic message.
- Unsubscribe tokens: keyed 256-bit HMAC per random subscriber ID, with only
  SHA-256 stored in the subscriber table. Long-lived so older emails still work.
  Protect TOKEN_KEY; rotating it requires a plan to preserve existing links.
- Confirmation outbox payloads are AES-256-GCM encrypted with DATA_KEY. Terminal
  sends clear the ciphertext; ciphertext for queued retries is retained. Pending
  signups expire after 30 days. Preserve DATA_KEY until its queue has drained.
- Current consent version `opencam-updates-single-opt-in-v3` covers OpenCam news,
  features, announcements and releases. Earlier `release-updates-2026-10-13`
  consent stays limited to releases and is excluded from general-update sends.
  Existing consent records are not rewritten. The form records explicit single-opt-in consent
  and links the privacy policy. signup_at/source record the latest explicit
  signup attempt; confirmed_at records actual successful confirmation only.
- Public GET requests never change subscription state. Confirmation requires a
  button POST. Unsubscribe supports both a button POST and RFC 8058 one-click POST.
- Origin checks, bounded bodies, Turnstile hostname/action verification, a
  honeypot, hashed IP limits (10/hour), and address limits (3/day) protect signup. Counters use D1 atomic
  updates. Only the Cloudflare-supplied client IP is used. Add edge WAF limits if
  real traffic demonstrates need; do not log raw request bodies or token URLs.
- Signup changes are atomic and create no outbox entry. D1 batches atomically commit campaign
  launch/snapshot insertion. Unique version and campaign-recipient constraints
  prevent duplicate launches and queue entries.
- Protected CLI uses an environment-held bearer token of at least 32 characters;
  every admin route enforces it. No public administration UI or credentials in JS.
- Retention: active/opt-out/suppression and delivery records remain until an
  authorized deletion request. Admin deletion cascades per-recipient deliveries.
  Event IDs expire after 30 days; rate records within a day. Restrict DB access,
  keep encrypted backups and set a backup-expiry policy before launch.

## Delivery semantics

The durable outbox sends **at most one message per minute globally**, including
test announcements, with a configurable rolling 24-hour attempt budget (1,000 in production). Failed/skipped reservations are counted conservatively. Set the budget
below the shared Resend account quota, reserving capacity for TabTab. This limit
is local to OpenCam, not an account-wide quota coordinator.
The one-per-minute rate is intentionally conservative: 1,725 messages take at
least 28.75 hours after quota approval, and longer under a daily cap. It is not a
bulk-marketing throughput service. Old queued confirmations are skipped without sending.

An atomic `queued/retry -> sending` claim prevents simultaneous workers sending
the same entry. `sent` means Resend accepted the message, not that it reached the
inbox. A network error, timeout, HTTP 5xx, missing acceptance ID, or stale sending
claim becomes `ambiguous`, **never automatically retried**. This favors avoiding
duplicates over guaranteed delivery. Each delivery uses a stable Resend idempotency key (provider window: 24 hours); exactly-once
delivery is not claimed. Only explicit HTTP 429 rejection retries, at exponential
intervals capped at one hour and five attempts. Other 4xx responses are terminal.

Signed Resend events with the delivery_id tag can reconcile ambiguous acceptance.
An administrator can resolve ambiguous entries to sent/skipped after reviewing
provider evidence, but the CLI does not silently resend them. An interruption
before provider handoff can therefore lose a send until reviewed. The recipient
state is re-read immediately before handoff; an unsubscribe after that read cannot
recall mail already in flight.

No automatic release detector or send-on-push integration exists. Launch checks
the exact public App Store version in the campaign URL's storefront. Check the
other supported storefronts manually before a worldwide announcement.

## iOS handoff URLs

After the production signup gate passes:

- Website: `https://opencam.app/updates/`
- iOS app: `https://opencam.app/updates/?source=app`
- TestFlight UI: `https://opencam.app/updates/?source=testflight`

The source parameter is attribution, never proof of consent. Until cutover these
URLs show the preserved Google Form fallback. No iOS repository was modified.

Webhook signatures cover the exact raw body and timestamp, with a five-minute
replay tolerance and event-ID deduplication. Only updates@opencam.app events
affect this database. Subscription consent stays separate between apps. Resend
may also enforce account-level bounce/complaint suppression across both senders.

General updates use `kind: "update"` and a unique `key` rather than a public
version. They require explicit launch approval but no App Store lookup. Release
campaigns keep the public-version gate. See the runbook for both formats.

## Reviewed legacy starting list

The owner-authorized form import contains 1,725 subscribed records with explicit
legacy-form consent evidence and NULL mailbox-confirmation timestamps. These are
eligible for general and release campaigns, as are new explicit single-opt-in
signups. No mailbox confirmation is required. Existing opt-outs and suppressions are never overwritten. See
[migration report](migration-report.md) for the audit and recovery artifacts.
